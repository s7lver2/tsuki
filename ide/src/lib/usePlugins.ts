/**
 * tsuki-ide :: usePlugins
 *
 * Boots the plugin system:
 *   1. injectStoreAccess()
 *   2. For each plugin: check / request permissions via consent dialog
 *   3. loadAllPlugins() — pass the permission-resolution callback
 */

import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { useStore } from './store'
import {
  loadAllPlugins, getLoadedPlugins, emitPluginEvent, injectStoreAccess,
  type LoadedPlugin, type IdeStateSnapshot, type DispatchAction,
  type IdePluginMeta, type PermissionId,
} from './pluginLoader'

// ── Permission resolution ─────────────────────────────────────────────────────

/**
 * Per-plugin permission consent state managed in the hook.
 * We queue plugins that need consent and show one dialog at a time.
 */
let _permissionQueue: Array<{
  meta:    IdePluginMeta
  resolve: (granted: Set<PermissionId>) => void
}> = []

let _showConsent: ((meta: IdePluginMeta, resolve: (g: Set<PermissionId>) => void) => void) | null = null

// ── Subscribers ───────────────────────────────────────────────────────────────

let _initialized = false
let _subscribers = new Set<() => void>()

export function notifyPluginsChanged() {
  for (const sub of Array.from(_subscribers)) sub()
}

/** Subscribe to any plugin load/unload event. Returns an unsubscribe fn. */
export function subscribeToPluginChanges(cb: () => void): () => void {
  _subscribers.add(cb)
  return () => { _subscribers.delete(cb) }
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export interface PluginConsentRequest {
  meta:    IdePluginMeta
  resolve: (granted: Set<PermissionId>) => void
}

export function usePlugins(): {
  plugins:        LoadedPlugin[]
  loading:        boolean
  consentRequest: PluginConsentRequest | null
  dismissConsent: (granted: Set<PermissionId>) => void
} {
  const projectPath = useStore(s => s.projectPath ?? '')
  const board       = useStore(s => s.board       ?? 'uno')
  const theme       = useStore(s => s.theme       ?? 'dark')

  const [tick,           setTick]           = useState(0)
  const [loading,        setLoading]        = useState(!_initialized)
  const [consentRequest, setConsentRequest] = useState<PluginConsentRequest | null>(null)

  // Subscribe to plugin registry changes
  useEffect(() => {
    const rerender = () => setTick(t => t + 1)
    _subscribers.add(rerender)
    return () => { _subscribers.delete(rerender) }
  }, [])

  // Wire consent dialog trigger
  useEffect(() => {
    _showConsent = (meta, resolve) => setConsentRequest({ meta, resolve })
  }, [])

  const dismissConsent = useCallback((granted: Set<PermissionId>) => {
    if (consentRequest) {
      consentRequest.resolve(granted)
      setConsentRequest(null)
    }
  }, [consentRequest])

  // Initialize once
  useEffect(() => {
    if (_initialized) return
    _initialized = true

    // ── 1. Wire store access ────────────────────────────────────────────
    injectStoreAccess(
      (): IdeStateSnapshot => {
        const s = useStore.getState()
        return {
          projectPath:     s.projectPath     ?? '',
          projectName:     s.projectName     ?? '',
          projectLanguage: s.projectLanguage ?? 'go',
          board:           s.board           ?? 'uno',
          theme:           s.theme           ?? 'dark',
          sidebarOpen:     s.sidebarOpen     ?? false,
          openTabs:        s.openTabs        ?? [],
          activeTabIdx:    s.activeTabIdx    ?? -1,
          gitChanges:      s.gitChanges      ?? [],
          gitBranch:       s.gitBranch       ?? 'main',
          commitHistory:   s.commitHistory   ?? [],
          settings:        s.settings,
        }
      },
      (cb) => useStore.subscribe(cb),
      (action: DispatchAction) => {
        const store = useStore.getState()
        switch (action.type) {
          case 'git:commit':
            store.doCommit(action.payload)
            break
          case 'sandbox:setCircuit':
            store.setSandboxCircuit(action.payload as Record<string, unknown>)
            break
          case 'sandbox:clearPending':
            store.clearPendingCircuit()
            break
          case 'lsp:setProblems':
            store.setProblems(action.payload)
            break
          case 'lsp:addLog':
            store.addLog(action.payload.type, action.payload.msg)
            break
        }
      },
    )

    // ── 2. Load plugins with permission resolution ──────────────────────
    const showMessage = (msg: string, type: 'info' | 'warn' | 'error' = 'info') => {
      if (type === 'error') console.error(msg)
      else if (type === 'warn') console.warn(msg)
      else console.info(msg)
    }

    /**
     * Permission resolution callback:
     * - Checks if the plugin has been reviewed before (via Rust)
     * - If reviewed: returns stored grants silently
     * - If not reviewed: shows the consent dialog (serial, one at a time)
     */
    const requestPermissions = async (meta: IdePluginMeta): Promise<Set<PermissionId>> => {
      if (meta.declaredPermissions.length === 0) {
        // No permissions declared — always allowed, no dialog needed
        await invoke('set_plugin_permissions', { pluginId: meta.id, grants: {} }).catch(() => {})
        return new Set()
      }

      let info: { reviewed: boolean; granted: Record<string, boolean> }
      try {
        info = await invoke('get_plugin_permissions', {
          pluginId: meta.id,
          declared: meta.declaredPermissions,
        })
      } catch {
        return new Set()
      }

      if (info.reviewed) {
        // Already reviewed — use stored grants
        return new Set(
          Object.entries(info.granted)
            .filter(([, v]) => v)
            .map(([k]) => k as PermissionId)
        )
      }

      // Not yet reviewed — show consent dialog and wait for user
      return new Promise<Set<PermissionId>>(resolve => {
        if (_showConsent) {
          _showConsent(meta, resolve)
        } else {
          // Dialog not ready yet — deny all (safe default)
          resolve(new Set())
        }
      })
    }

    loadAllPlugins(
      () => useStore.getState().projectPath ?? '',
      showMessage,
      requestPermissions,
    ).then(() => {
      setLoading(false)
      setTick(t => t + 1)
    })
  }, []) // eslint-disable-line

  // Forward IDE events to plugins
  useEffect(() => {
    if (!_initialized || !projectPath) return
    emitPluginEvent('project:open', { path: projectPath })
  }, [projectPath])

  useEffect(() => {
    if (!_initialized) return
    emitPluginEvent('board:change', { board })
  }, [board])

  useEffect(() => {
    if (!_initialized) return
    emitPluginEvent('theme:change', { theme })
  }, [theme])

  return { plugins: getLoadedPlugins(), loading, consentRequest, dismissConsent }
}

// ── Refresh after install ─────────────────────────────────────────────────────

export async function refreshPlugins(
  requestPermissions: (meta: IdePluginMeta) => Promise<Set<PermissionId>>,
) {
  const showMessage = (msg: string) => console.info(msg)
  await loadAllPlugins(
    () => useStore.getState().projectPath ?? '',
    showMessage,
    requestPermissions,
  )
  notifyPluginsChanged()
  emitPluginEvent('plugins:reloaded')
}