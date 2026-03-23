/**
 * @tsuki/plugin-sdk
 *
 * Type definitions and development stubs for tsuki IDE plugins.
 *
 * At runtime the IDE injects the real implementation via require('@tsuki/plugin-sdk').
 * During development (tsc, tests) the stubs below are used — they are no-ops that
 * let you compile and type-check your plugin without the IDE running.
 *
 * Usage in a plugin:
 *
 *   import { ui, editor, fs, shell, state, events, meta } from '@tsuki/plugin-sdk'
 *
 *   editor.registerExtension({ id: 'my-ext', async getDiagnostics(ctx) { ... } })
 *
 *   export function activate() {
 *     // optional lifecycle hook — called after module evaluation
 *   }
 *   export function deactivate() {
 *     // optional cleanup — called on unload
 *   }
 */

// ─── Permission types ─────────────────────────────────────────────────────────

/**
 * Generic SDK capabilities. Declare these in tsuki.toml under [ide-plugin].
 * The user is shown a consent dialog before the plugin loads.
 *
 *   filesystem  — read and write files on the user's system
 *   network     — make outgoing HTTP requests or open local TCP ports
 *   shell       — spawn processes and run shell commands
 *   ide:state   — read IDE state (open tabs, git info, settings)
 *   ide:mutate  — push diagnostics, write logs, control sandbox, commit git
 */
export type Permission =
  | 'filesystem'
  | 'network'
  | 'shell'
  | 'ide:state'
  | 'ide:mutate'

// ─── Slot / contribution types ────────────────────────────────────────────────

export interface SidebarTabContribution {
  id:      string
  label:   string
  icon?:   string
  render:  () => HTMLElement
}

export interface BottomTabContribution {
  id:     string
  label:  string
  render: () => HTMLElement
}

export interface ToolbarActionContribution {
  id:      string
  label:   string
  icon?:   string
  onClick: () => void
}

export interface SettingsPanelContribution {
  id:     string
  label:  string
  render: () => HTMLElement
}

export interface WorkstationContribution {
  id:        string
  label:     string
  icon?:     string
  shortcut?: string
  render:    () => HTMLElement
}

export interface StatusBarItemContribution {
  id:       string
  position: 'left' | 'right'
  render:   () => HTMLElement
}

// ─── Editor types ─────────────────────────────────────────────────────────────

export interface EditorFileContext {
  fileId:   string
  filename: string
  ext:      string
  content:  string
  board:    string
  language: string
}

export interface EditorPosition {
  line:   number
  column: number
}

export interface CompletionItem {
  label:      string
  detail?:    string
  kind?:      'function' | 'variable' | 'type' | 'keyword' | 'snippet' | 'constant'
  insertText?: string
  sortText?:  string
}

export interface Diagnostic {
  fileId:    string
  line:      number
  col:       number
  endLine?:  number
  endCol?:   number
  message:   string
  severity:  'error' | 'warning' | 'info' | 'hint'
  source?:   string
}

export interface InlayHint {
  line:  number
  col:   number
  label: string
  kind?: 'type' | 'parameter'
}

export interface EditorExtensionContribution {
  id:              string
  onFileChange?:   (ctx: EditorFileContext) => void
  getCompletions?: (ctx: EditorFileContext, pos: EditorPosition) => Promise<CompletionItem[]>
  getDiagnostics?: (ctx: EditorFileContext) => Promise<Diagnostic[]>
  getInlayHints?:  (ctx: EditorFileContext) => Promise<InlayHint[]>
  dispose?:        () => void
}

// ─── IDE state snapshot ───────────────────────────────────────────────────────

export interface TabItem {
  id:       string
  filename: string
  content:  string
  modified: boolean
}

export interface GitChange {
  path:   string
  status: 'modified' | 'added' | 'deleted' | 'untracked'
}

export interface GitCommitNode {
  hash:    string
  message: string
  author:  string
  date:    string
}

export interface IdeSettings {
  [key: string]: unknown
}

export interface IdeStateSnapshot {
  /** Always available — no permission required. */
  projectPath:     string
  projectName:     string
  projectLanguage: string
  board:           string
  theme:           'dark' | 'light'
  sidebarOpen:     boolean
  /** Requires ide:state */
  openTabs:        TabItem[]
  activeTabIdx:    number
  gitChanges:      GitChange[]
  gitBranch:       string
  commitHistory:   GitCommitNode[]
  settings:        IdeSettings
}

// ─── Dispatch actions ─────────────────────────────────────────────────────────

export type LogLevel = 'ok' | 'err' | 'warn' | 'info'

export type MutateAction =
  | { type: 'git:commit';           payload: string }
  | { type: 'sandbox:setCircuit';   payload: Record<string, unknown> }
  | { type: 'sandbox:clearPending' }
  | { type: 'lsp:setProblems';      payload: Diagnostic[] }
  | { type: 'lsp:addLog';           payload: { type: LogLevel; msg: string } }

// ─── Module interfaces ────────────────────────────────────────────────────────

/** UI slot registration. No special permission required. */
export interface UIModule {
  registerSidebarTab(contribution: SidebarTabContribution):    void
  registerBottomTab(contribution: BottomTabContribution):      void
  registerToolbarAction(contribution: ToolbarActionContribution): void
  registerSettingsPanel(contribution: SettingsPanelContribution): void
  registerWorkstation(contribution: WorkstationContribution):  void
  registerStatusBarItem(contribution: StatusBarItemContribution): void
  /** Show a toast message in the IDE. */
  showMessage(msg: string, type?: 'info' | 'warn' | 'error'): void
  /** Mount a React element into a container. Returns a React root for cleanup. */
  renderReact(container: HTMLElement, element: unknown): { unmount(): void }
}

/** Editor extension registration. No special permission required. */
export interface EditorModule {
  registerExtension(contribution: EditorExtensionContribution): void
}

/**
 * Filesystem access. Requires the `filesystem` permission.
 * All paths are absolute. Relative paths are resolved from the active project root.
 */
export interface FsModule {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  deleteFile(path: string): Promise<void>
  renameFile(from: string, to: string): Promise<void>
  createDir(path: string): Promise<void>
  readDir(path: string): Promise<DirEntry[]>
  exists(path: string): Promise<boolean>
}

export interface DirEntry {
  name:    string
  path:    string
  isDir:   boolean
  isFile:  boolean
}

/**
 * Shell / process execution. Requires the `shell` permission.
 */
export interface ShellModule {
  /** Spawn a process and return its stdout/stderr as strings. */
  exec(cmd: string, args?: string[], options?: ExecOptions): Promise<ExecResult>
  /** Run a raw shell command string. */
  run(command: string, options?: ExecOptions): Promise<ExecResult>
}

export interface ExecOptions {
  cwd?:    string
  env?:    Record<string, string>
  /** If true, throws on non-zero exit code. Default: false. */
  strict?: boolean
}

export interface ExecResult {
  stdout:   string
  stderr:   string
  exitCode: number
}

/**
 * Network access. Requires the `network` permission.
 * HTTP requests are routed through the Tauri backend.
 */
export interface NetModule {
  /** Make an HTTP request. Returns the response body as a string. */
  fetch(url: string, options?: NetFetchOptions): Promise<NetResponse>
}

export interface NetFetchOptions {
  method?:  'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  headers?: Record<string, string>
  body?:    string
}

export interface NetResponse {
  status:  number
  headers: Record<string, string>
  body:    string
  ok:      boolean
}

/**
 * IDE state access. Requires the `ide:state` permission for gated fields.
 * Basic project info (path, board, theme) is always available.
 */
export interface StateModule {
  /** Returns a snapshot of the current IDE state. */
  get(): IdeStateSnapshot
  /**
   * Subscribe to state changes. The selector narrows what to watch.
   * Returns an unsubscribe function.
   */
  subscribe<T>(selector: (s: IdeStateSnapshot) => T, handler: (value: T) => void): () => void
}

/**
 * IDE state mutations. Requires the `ide:mutate` permission.
 */
export interface MutateModule {
  dispatch(action: MutateAction): void
}

/**
 * Plugin event bus. No special permission required.
 * Events are local to the IDE process — not persisted.
 */
export interface EventsModule {
  on(event: string,  handler: (data?: unknown) => void): void
  off(event: string, handler: (data?: unknown) => void): void
  emit(event: string, data?: unknown): void
}

/** Static plugin metadata. */
export interface PluginMeta {
  id:          string
  owner:       string
  name:        string
  version:     string
  description: string
  /** Permissions the user has actually granted. */
  granted:     Permission[]
  /** Returns true if the user has granted a permission. */
  hasPermission(p: Permission): boolean
}

// ─── Root SDK export ──────────────────────────────────────────────────────────

export interface TsukiSDK {
  /** UI slot registration */
  ui:     UIModule
  /** Editor extension hooks */
  editor: EditorModule
  /** Filesystem access — requires `filesystem` */
  fs:     FsModule
  /** Shell / process execution — requires `shell` */
  shell:  ShellModule
  /** Network / HTTP — requires `network` */
  net:    NetModule
  /** Read IDE state — requires `ide:state` for gated fields */
  state:  StateModule
  /** Mutate IDE state — requires `ide:mutate` */
  mutate: MutateModule
  /** Plugin event bus */
  events: EventsModule
  /** Plugin metadata */
  meta:   PluginMeta
}

// ─── Dev stubs (no-ops used during tsc / unit tests) ─────────────────────────
//
// The IDE overwrites these at runtime via require('@tsuki/plugin-sdk').
// Do NOT rely on them producing real values outside the IDE.

function _permDenied(name: string): () => never {
  return () => { throw new Error(`[@tsuki/plugin-sdk] '${name}' is not available outside the IDE.`) }
}

const _stub: TsukiSDK = {
  ui: {
    registerSidebarTab:    () => {},
    registerBottomTab:     () => {},
    registerToolbarAction: () => {},
    registerSettingsPanel: () => {},
    registerWorkstation:   () => {},
    registerStatusBarItem: () => {},
    showMessage:           () => {},
    renderReact:           () => ({ unmount: () => {} }),
  },
  editor: {
    registerExtension: () => {},
  },
  fs: {
    readFile:   _permDenied('fs.readFile'),
    writeFile:  _permDenied('fs.writeFile'),
    deleteFile: _permDenied('fs.deleteFile'),
    renameFile: _permDenied('fs.renameFile'),
    createDir:  _permDenied('fs.createDir'),
    readDir:    _permDenied('fs.readDir'),
    exists:     _permDenied('fs.exists'),
  },
  shell: {
    exec: _permDenied('shell.exec'),
    run:  _permDenied('shell.run'),
  },
  net: {
    fetch: _permDenied('net.fetch'),
  },
  state: {
    get:       () => ({
      projectPath: '', projectName: '', projectLanguage: 'go', board: 'uno',
      theme: 'dark', sidebarOpen: false,
      openTabs: [], activeTabIdx: -1,
      gitChanges: [], gitBranch: '', commitHistory: [],
      settings: {},
    }),
    subscribe: () => () => {},
  },
  mutate: {
    dispatch: _permDenied('mutate.dispatch'),
  },
  events: {
    on:   () => {},
    off:  () => {},
    emit: () => {},
  },
  meta: {
    id: '', owner: '', name: '', version: '', description: '',
    granted: [],
    hasPermission: () => false,
  },
}

// Named exports for tree-shaking / destructured imports
export const ui:     UIModule      = _stub.ui
export const editor: EditorModule  = _stub.editor
export const fs:     FsModule      = _stub.fs
export const shell:  ShellModule   = _stub.shell
export const net:    NetModule     = _stub.net
export const state:  StateModule   = _stub.state
export const mutate: MutateModule  = _stub.mutate
export const events: EventsModule  = _stub.events
export const meta:   PluginMeta    = _stub.meta

/** The full SDK object — same as the named exports above, bundled together. */
export const sdk: TsukiSDK = _stub
export default _stub