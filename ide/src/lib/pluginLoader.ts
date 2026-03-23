/**
 * tsuki-ide :: pluginLoader
 *
 * Loads IDE plugins from ~/.tsuki/plugins/ at runtime and injects the
 * @tsuki/plugin-sdk module into each plugin bundle.
 *
 * ── How it works ──────────────────────────────────────────────────────────────
 *
 * 1. Rust (plugin_loader.rs) scans ~/.tsuki/plugins/ and returns plugin metadata.
 * 2. For each plugin, the user is asked to consent to the declared permissions.
 * 3. The plugin's index.js bundle is evaluated in a sandboxed Function scope.
 *    `require('@tsuki/plugin-sdk')` is intercepted and returns a live SDK object
 *    whose methods are gated by the granted permissions.
 * 4. If the bundle exports `activate()`, it is called after module evaluation.
 *    If it exports `deactivate()`, it is called on unload.
 *
 * ── Generic permissions ────────────────────────────────────────────────────────
 *
 *   filesystem   read_file, write_file, read_dir_entries, delete_file,
 *                rename_path, create_dir, check_path_exists, get_home_dir
 *   network      net_fetch (HTTP requests through Tauri backend)
 *   shell        spawn_process, run_shell, run_git, transpile_source,
 *                get_tsuki_bin, get_tsuki_core_bin, get_tsuki_sim_bin,
 *                emit_sim_bundle, run_simulator, stop_simulator
 *   ide:state    openTabs, activeTabIdx, gitChanges, gitBranch,
 *                commitHistory, settings
 *   ide:mutate   git:commit, sandbox:setCircuit, lsp:setProblems, lsp:addLog
 */

import { invoke } from '@tauri-apps/api/tauri'
import { isTauri } from './tauri'
import * as React from 'react'
import * as ReactDOM from 'react-dom/client'
import type {
  TsukiSDK, UIModule, EditorModule, FsModule, ShellModule, NetModule,
  StateModule, MutateModule, EventsModule, PluginMeta,
  SidebarTabContribution, BottomTabContribution, ToolbarActionContribution,
  SettingsPanelContribution, WorkstationContribution, StatusBarItemContribution,
  EditorExtensionContribution, IdeStateSnapshot, MutateAction, Permission,
  TabItem, GitChange, GitCommitNode, IdeSettings,
  Diagnostic, CompletionItem, InlayHint, EditorFileContext, EditorPosition,
  DirEntry, ExecOptions, ExecResult, NetFetchOptions, NetResponse,
} from '@tsuki/plugin-sdk'

// Re-export types consumers need
export type {
  Permission, IdeStateSnapshot, MutateAction, TsukiSDK,
  SidebarTabContribution, BottomTabContribution, ToolbarActionContribution,
  SettingsPanelContribution, WorkstationContribution, StatusBarItemContribution,
  EditorExtensionContribution, Diagnostic, CompletionItem, InlayHint,
  EditorFileContext, EditorPosition, TabItem, GitChange, GitCommitNode, IdeSettings,
}

// ── Permission metadata ───────────────────────────────────────────────────────

export const PERMISSION_META: Record<Permission, {
  label:       string
  description: string
  risk:        'low' | 'medium' | 'high'
}> = {
  'filesystem': {
    label:       'Access files',
    description: 'Read and write files anywhere on your system.',
    risk:        'high',
  },
  'network': {
    label:       'Network access',
    description: 'Make outgoing HTTP requests to external servers.',
    risk:        'medium',
  },
  'shell': {
    label:       'Run commands',
    description: 'Execute shell commands and spawn processes on your system.',
    risk:        'high',
  },
  'ide:state': {
    label:       'Read IDE state',
    description: 'Access open files, Git history, branches, and IDE settings.',
    risk:        'medium',
  },
  'ide:mutate': {
    label:       'Modify IDE state',
    description: 'Push diagnostics, write output logs, control the sandbox, and create Git commits.',
    risk:        'medium',
  },
}

// ── Tauri command → required permission ───────────────────────────────────────
// Mirrors plugin_permissions.rs command_requires_permission().

const COMMAND_PERMISSION: Record<string, Permission> = {
  // filesystem
  read_file:          'filesystem',
  read_dir_entries:   'filesystem',
  check_path_exists:  'filesystem',
  get_home_dir:       'filesystem',
  load_settings:      'filesystem',
  write_file:         'filesystem',
  delete_file:        'filesystem',
  rename_path:        'filesystem',
  create_dir:         'filesystem',
  save_settings:      'filesystem',
  // shell
  run_shell:          'shell',
  spawn_process:      'shell',
  spawn_shell:        'shell',
  emit_sim_bundle:    'shell',
  run_simulator:      'shell',
  stop_simulator:     'shell',
  run_diagnostics:    'shell',
  run_git:            'shell',
  transpile_source:   'shell',
  get_tsuki_bin:      'shell',
  get_tsuki_core_bin: 'shell',
  get_tsuki_sim_bin:  'shell',
  get_tmp_go_path:    'shell',
  // network
  net_fetch:          'network',
}

// ── IdePluginMeta ─────────────────────────────────────────────────────────────
// Returned by Rust's list_ide_plugins Tauri command.

export interface IdePluginMeta {
  id:                  string
  owner:               string
  name:                string
  version:             string
  description:         string
  dir:                 string
  entry:               string
  styles:              string
  slots:               string[]
  declaredPermissions: string[]
}

// ── Slot id ───────────────────────────────────────────────────────────────────

export type PluginSlotId =
  | 'sidebar-tab' | 'bottom-tab' | 'toolbar-action' | 'settings-panel'
  | 'workstation'  | 'status-bar' | 'editor-extension'

// ── LoadedPlugin ──────────────────────────────────────────────────────────────

export interface LoadedPlugin {
  meta:               IdePluginMeta
  grantedPermissions: Set<Permission>
  sidebarTabs:        SidebarTabContribution[]
  bottomTabs:         BottomTabContribution[]
  toolbarActions:     ToolbarActionContribution[]
  settingsPanels:     SettingsPanelContribution[]
  workstations:       WorkstationContribution[]
  statusBarItems:     StatusBarItemContribution[]
  editorExtensions:   EditorExtensionContribution[]
  /** deactivate() exported by the plugin bundle, if any. */
  deactivate?:        () => void
  error?:             string
}

// ── Registry ──────────────────────────────────────────────────────────────────

const _loaded:    Map<string, LoadedPlugin>     = new Map()
const _listeners: Map<string, Set<Function>>    = new Map()

let _getState:  () => IdeStateSnapshot           = () => { throw new Error('[pluginLoader] not initialized') }
let _subscribe: (cb: () => void) => () => void   = () => () => {}
let _dispatch:  (action: MutateAction) => void   = () => {}

export function injectStoreAccess(
  getState:  () => IdeStateSnapshot,
  subscribe: (cb: () => void) => () => void,
  dispatch:  (action: MutateAction) => void,
) {
  _getState  = getState
  _subscribe = subscribe
  _dispatch  = dispatch
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getLoadedPlugins(): LoadedPlugin[] {
  return Array.from(_loaded.values())
}

export function getSlotContributions(slot: PluginSlotId) {
  const result: Array<{ plugin: LoadedPlugin; contribution: unknown }> = []
  for (const plugin of Array.from(_loaded.values())) {
    let list: unknown[] = []
    if (slot === 'sidebar-tab')      list = plugin.sidebarTabs
    if (slot === 'bottom-tab')       list = plugin.bottomTabs
    if (slot === 'toolbar-action')   list = plugin.toolbarActions
    if (slot === 'settings-panel')   list = plugin.settingsPanels
    if (slot === 'workstation')      list = plugin.workstations
    if (slot === 'status-bar')       list = plugin.statusBarItems
    if (slot === 'editor-extension') list = plugin.editorExtensions
    for (const c of list) result.push({ plugin, contribution: c })
  }
  return result
}

export function getEditorExtensions(): EditorExtensionContribution[] {
  return getSlotContributions('editor-extension').map(x => x.contribution as EditorExtensionContribution)
}

export function emitPluginEvent(event: string, data?: unknown) {
  const handlers = _listeners.get(event)
  if (!handlers) return
  for (const h of Array.from(handlers)) {
    try { h(data) } catch { /* never crash the IDE */ }
  }
}

export async function loadAllPlugins(
  getProjectPath: () => string,
  showMessage: (msg: string, type?: 'info' | 'warn' | 'error') => void,
  requestPermissions: (meta: IdePluginMeta) => Promise<Set<Permission>>,
): Promise<LoadedPlugin[]> {
  if (!isTauri()) return []

  let metas: IdePluginMeta[] = []
  try { metas = await invoke<IdePluginMeta[]>('list_ide_plugins') }
  catch (e) { console.warn('[plugins] list_ide_plugins failed:', e); return [] }

  const results: LoadedPlugin[] = []
  for (const meta of metas) {
    const granted = await requestPermissions(meta)
    const loaded  = await _loadPlugin(meta, granted, getProjectPath, showMessage)
    _loaded.set(meta.id, loaded)
    results.push(loaded)
    if (!loaded.error) console.log(`[plugins] loaded ${meta.id} (${[...granted].join(', ') || 'no permissions'})`)
    else               console.warn(`[plugins] ${meta.id} error:`, loaded.error)
  }
  return results
}

export async function reloadPlugin(
  pluginId: string,
  getProjectPath: () => string,
  showMessage: (msg: string, type?: 'info' | 'warn' | 'error') => void,
  requestPermissions: (meta: IdePluginMeta) => Promise<Set<Permission>>,
): Promise<LoadedPlugin | null> {
  const metas = await invoke<IdePluginMeta[]>('list_ide_plugins').catch(() => [])
  const meta  = metas.find(m => m.id === pluginId)
  if (!meta) return null
  unloadPlugin(pluginId)
  const granted = await requestPermissions(meta)
  const loaded  = await _loadPlugin(meta, granted, getProjectPath, showMessage)
  _loaded.set(meta.id, loaded)
  return loaded
}

export function unloadPlugin(pluginId: string) {
  const plugin = _loaded.get(pluginId)
  if (plugin) {
    try { plugin.deactivate?.() } catch {}
    for (const ext of plugin.editorExtensions) {
      try { ext.dispose?.() } catch {}
    }
  }
  _loaded.delete(pluginId)
}

// ── Loader internals ──────────────────────────────────────────────────────────

/**
 * CommonJS shim injected before the plugin bundle.
 * Intercepts require() — only react, react-dom, and @tsuki/plugin-sdk
 * are allowed. All other dependencies must be bundled.
 */
const REQUIRE_SHIM = `
var module  = { exports: {} };
var exports = module.exports;
var require = function(mod) {
  if (mod === 'react')              return React;
  if (mod === 'react-dom')          return ReactDOM;
  if (mod === 'react-dom/client')   return ReactDOM;
  if (mod === '@tsuki/plugin-sdk')  return __tsukiSdk;
  throw new Error('[tsuki-plugin] unsupported require("' + mod + '"). Bundle all deps except react, react-dom, and @tsuki/plugin-sdk.');
};
`

async function _loadPlugin(
  meta: IdePluginMeta,
  granted: Set<Permission>,
  getProjectPath: () => string,
  showMessage: (msg: string, type?: 'info' | 'warn' | 'error') => void,
): Promise<LoadedPlugin> {
  const loaded: LoadedPlugin = {
    meta, grantedPermissions: granted,
    sidebarTabs: [], bottomTabs: [], toolbarActions: [],
    settingsPanels: [], workstations: [], statusBarItems: [], editorExtensions: [],
  }

  if (!meta.entry) { loaded.error = 'no entry point'; return loaded }

  // Inject styles
  if (meta.styles) {
    try {
      const css = await invoke<string>('read_plugin_styles', { stylesPath: meta.styles })
      _injectStyles(meta.id, css)
    } catch { /* styles are optional */ }
  }

  // Read bundle
  let source: string
  try { source = await invoke<string>('read_plugin_entry', { entryPath: meta.entry }) }
  catch (e) { loaded.error = `cannot read entry: ${e}`; return loaded }

  // Build the SDK object for this plugin
  const sdk = _buildSdk(meta, loaded, granted, getProjectPath, showMessage)

  try {
    // Evaluate the bundle.
    // The plugin can use:
    //   require('@tsuki/plugin-sdk')         — the SDK
    //   module.exports.activate              — lifecycle hook (called below)
    //   module.exports.deactivate            — lifecycle hook (stored for unload)
    const fn = new Function(
      'context',       // legacy compat — unused in SDK-style plugins, but kept so old plugins don't crash
      'React',
      'ReactDOM',
      '__tsukiSdk',    // injected as require('@tsuki/plugin-sdk')
      REQUIRE_SHIM +
      source +
      '\n;(function(){' +
      'var _e = module.exports;' +
      // Store deactivate before calling activate (activate may mutate exports)
      'if (_e && typeof _e.deactivate === "function") __deactivate = _e.deactivate;' +
      'if (_e && typeof _e.activate   === "function") return _e.activate(__tsukiSdk);' +
      'if (typeof activate            === "function") return activate(__tsukiSdk);' +
      '})();',
    )
    // We also pass `context` as the legacy compat parameter — it's the same
    // as the old context API, built from the SDK, so old plugins still work.
    const legacyContext = _buildLegacyContext(meta, loaded, granted, getProjectPath, showMessage, sdk)
    const deactivateFn = { current: undefined as (() => void) | undefined }

    // Wrap fn to capture deactivate
    const wrappedFn = new Function(
      'context', 'React', 'ReactDOM', '__tsukiSdk', '__deactivate_capture',
      REQUIRE_SHIM +
      'var __deactivate;\n' +
      source +
      '\n;(function(){' +
      'var _e = module.exports;' +
      'if (_e && typeof _e.deactivate === "function") { __deactivate = _e.deactivate; }' +
      'if (_e && typeof _e.activate   === "function") { _e.activate(__tsukiSdk); }' +
      'else if (typeof activate       === "function") { activate(__tsukiSdk); }' +
      '__deactivate_capture(__deactivate);' +
      '})();',
    )
    wrappedFn(legacyContext, React, ReactDOM, sdk, (fn: (() => void) | undefined) => {
      deactivateFn.current = fn
    })
    loaded.deactivate = deactivateFn.current
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    loaded.error = `activate() threw: ${msg}`
  }

  return loaded
}

// ── SDK builder ───────────────────────────────────────────────────────────────

function _buildSdk(
  meta: IdePluginMeta,
  loaded: LoadedPlugin,
  granted: Set<Permission>,
  getProjectPath: () => string,
  showMessage: (msg: string, type?: 'info' | 'warn' | 'error') => void,
): TsukiSDK {

  function requirePerm(perm: Permission, method: string) {
    if (!granted.has(perm)) {
      throw new Error(
        `[${meta.name}] Permission denied: "${perm}" is required for ${method}.\n` +
        `Declare it in tsuki.toml → [ide-plugin] permissions and the user must grant it.`
      )
    }
  }

  // ── ide:state helpers ────────────────────────────────────────────────────
  function getRedactedState(): IdeStateSnapshot {
    const full = _getState()
    const canRead = granted.has('ide:state')
    return {
      projectPath:     full.projectPath,
      projectName:     full.projectName,
      projectLanguage: full.projectLanguage,
      board:           full.board,
      theme:           full.theme,
      sidebarOpen:     full.sidebarOpen,
      openTabs:        canRead ? full.openTabs      : [],
      activeTabIdx:    canRead ? full.activeTabIdx  : -1,
      gitChanges:      canRead ? full.gitChanges    : [],
      gitBranch:       canRead ? full.gitBranch     : '',
      commitHistory:   canRead ? full.commitHistory : [],
      settings:        canRead ? full.settings      : {} as IdeSettings,
    }
  }

  // ── ui ───────────────────────────────────────────────────────────────────
  const ui: UIModule = {
    registerSidebarTab(c)    { loaded.sidebarTabs.push(c)     },
    registerBottomTab(c)     { loaded.bottomTabs.push(c)      },
    registerToolbarAction(c) { loaded.toolbarActions.push(c)  },
    registerSettingsPanel(c) { loaded.settingsPanels.push(c)  },
    registerWorkstation(c)   { loaded.workstations.push(c)    },
    registerStatusBarItem(c) { loaded.statusBarItems.push(c)  },
    showMessage(msg, type = 'info') {
      showMessage(`[${meta.name}] ${msg}`, type)
    },
    renderReact(container, element) {
      const root = ReactDOM.createRoot(container)
      root.render(element as React.ReactElement)
      return root
    },
  }

  // ── editor ───────────────────────────────────────────────────────────────
  const editor: EditorModule = {
    registerExtension(c) { loaded.editorExtensions.push(c) },
  }

  // ── fs ───────────────────────────────────────────────────────────────────
  const fs: FsModule = {
    async readFile(path) {
      requirePerm('filesystem', 'fs.readFile')
      return invoke<string>('read_file', { path })
    },
    async writeFile(path, content) {
      requirePerm('filesystem', 'fs.writeFile')
      await invoke('write_file', { path, content })
    },
    async deleteFile(path) {
      requirePerm('filesystem', 'fs.deleteFile')
      await invoke('delete_file', { path })
    },
    async renameFile(from, to) {
      requirePerm('filesystem', 'fs.renameFile')
      await invoke('rename_path', { from, to })
    },
    async createDir(path) {
      requirePerm('filesystem', 'fs.createDir')
      await invoke('create_dir', { path })
    },
    async readDir(path) {
      requirePerm('filesystem', 'fs.readDir')
      return invoke<DirEntry[]>('read_dir_entries', { path })
    },
    async exists(path) {
      requirePerm('filesystem', 'fs.exists')
      return invoke<boolean>('check_path_exists', { path })
    },
  }

  // ── shell ────────────────────────────────────────────────────────────────
  const shell: ShellModule = {
    async exec(cmd, args = [], options = {}) {
      requirePerm('shell', 'shell.exec')
      return invoke<ExecResult>('spawn_process', { cmd, args, cwd: options.cwd, env: options.env })
    },
    async run(command, options = {}) {
      requirePerm('shell', 'shell.run')
      return invoke<ExecResult>('run_shell', { command, cwd: options.cwd, env: options.env })
    },
  }

  // ── net ──────────────────────────────────────────────────────────────────
  const net: NetModule = {
    async fetch(url, options = {}) {
      requirePerm('network', 'net.fetch')
      return invoke<NetResponse>('net_fetch', { url, ...options })
    },
  }

  // ── state ────────────────────────────────────────────────────────────────
  const state: StateModule = {
    get() {
      return getRedactedState()
    },
    subscribe<T>(selector: (s: IdeStateSnapshot) => T, handler: (value: T) => void): () => void {
      let prev = selector(getRedactedState())
      return _subscribe(() => {
        const next = selector(getRedactedState())
        if (next !== prev) { prev = next; handler(next) }
      })
    },
  }

  // ── mutate ───────────────────────────────────────────────────────────────
  const mutate: MutateModule = {
    dispatch(action) {
      requirePerm('ide:mutate', `mutate.dispatch("${action.type}")`)
      _dispatch(action)
    },
  }

  // ── events ───────────────────────────────────────────────────────────────
  const events: EventsModule = {
    on(event, handler) {
      if (!_listeners.has(event)) _listeners.set(event, new Set())
      _listeners.get(event)!.add(handler)
    },
    off(event, handler) {
      _listeners.get(event)?.delete(handler)
    },
    emit(event, data) {
      emitPluginEvent(event, data)
    },
  }

  // ── meta ─────────────────────────────────────────────────────────────────
  const pluginMeta: PluginMeta = {
    id:          meta.id,
    owner:       meta.owner,
    name:        meta.name,
    version:     meta.version,
    description: meta.description,
    granted:     Array.from(granted),
    hasPermission(p: Permission) { return granted.has(p) },
  }

  return { ui, editor, fs, shell, net, state, mutate, events, meta: pluginMeta }
}

// ── Legacy context compat ─────────────────────────────────────────────────────
// Allows old-style plugins (activate(context)) to still function.
// New plugins should use the SDK directly.

function _buildLegacyContext(
  meta: IdePluginMeta,
  loaded: LoadedPlugin,
  granted: Set<Permission>,
  getProjectPath: () => string,
  showMessage: (msg: string, type?: 'info' | 'warn' | 'error') => void,
  sdk: TsukiSDK,
) {
  return {
    pluginId: meta.id,
    registerSidebarTab:     sdk.ui.registerSidebarTab.bind(sdk.ui),
    registerBottomTab:      sdk.ui.registerBottomTab.bind(sdk.ui),
    registerToolbarAction:  sdk.ui.registerToolbarAction.bind(sdk.ui),
    registerSettingsPanel:  sdk.ui.registerSettingsPanel.bind(sdk.ui),
    registerWorkstation:    sdk.ui.registerWorkstation.bind(sdk.ui),
    registerStatusBarItem:  sdk.ui.registerStatusBarItem.bind(sdk.ui),
    registerEditorExtension: sdk.editor.registerExtension.bind(sdk.editor),
    getState:         sdk.state.get.bind(sdk.state),
    onStateChange:    sdk.state.subscribe.bind(sdk.state),
    dispatch:         sdk.mutate.dispatch.bind(sdk.mutate),
    showMessage:      sdk.ui.showMessage.bind(sdk.ui),
    getProjectPath,
    renderReact:      sdk.ui.renderReact.bind(sdk.ui),
    on:               sdk.events.on.bind(sdk.events),
    off:              sdk.events.off.bind(sdk.events),
    hasPermission:    sdk.meta.hasPermission.bind(sdk.meta),
    getGrantedPermissions: () => sdk.meta.granted,
    React,
    async invokeCommand(cmd: string, args?: Record<string, unknown>) {
      const requiredPerm = COMMAND_PERMISSION[cmd]
      if (requiredPerm && !granted.has(requiredPerm)) {
        throw new Error(
          `[${meta.name}] Permission denied: "${requiredPerm}" is required to invoke "${cmd}".`
        )
      }
      return invoke(cmd, args)
    },
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function _injectStyles(id: string, css: string) {
  const existing = document.getElementById(`plugin-styles-${CSS.escape(id)}`)
  if (existing) existing.remove()
  const style = document.createElement('style')
  style.id          = `plugin-styles-${CSS.escape(id)}`
  style.textContent = css
  document.head.appendChild(style)
}