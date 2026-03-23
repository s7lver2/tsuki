'use client'
/**
 * tsuki-ide :: PluginsSettingsPanel
 *
 * Rendered under Settings → Plugins.
 * Shows all installed plugins and lets the user review / change their permissions.
 */

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { clsx } from 'clsx'
import { Shield, ShieldAlert, ShieldOff, ChevronDown, ChevronRight, RefreshCw, Trash2 } from 'lucide-react'
import type { PermissionId } from '@/lib/pluginLoader'
import { PERMISSION_META } from '@/lib/pluginLoader'
import { useT } from '@/lib/i18n'

interface PluginPermRow {
  pluginId:  string
  declared:  PermissionId[]
  granted:   Record<string, boolean>
  reviewed:  boolean
}

export default function PluginsSettingsPanel() {
  const t = useT()
  const [rows,    setRows]    = useState<PluginPermRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [saving,   setSaving]   = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      // Get all installed plugins
      const plugins = await invoke<Array<{ id: string; declaredPermissions: string[] }>>('list_ide_plugins')

      const rowData = await Promise.all(
        plugins.map(async plugin => {
          const info = await invoke<{ granted: Record<string, boolean>; reviewed: boolean }>(
            'get_plugin_permissions',
            { pluginId: plugin.id, declared: plugin.declaredPermissions }
          ).catch(() => ({ granted: {}, reviewed: false }))

          return {
            pluginId: plugin.id,
            declared: plugin.declaredPermissions as PermissionId[],
            granted:  info.granted,
            reviewed: info.reviewed,
          }
        })
      )
      setRows(rowData)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function saveRow(row: PluginPermRow, newGrants: Record<string, boolean>) {
    setSaving(row.pluginId)
    try {
      await invoke('set_plugin_permissions', { pluginId: row.pluginId, grants: newGrants })
      setRows(r => r.map(x => x.pluginId === row.pluginId ? { ...x, granted: newGrants, reviewed: true } : x))
    } finally {
      setSaving(null)
    }
  }

  async function revokeAll(pluginId: string) {
    setSaving(pluginId)
    try {
      await invoke('revoke_plugin_permissions', { pluginId })
      setRows(r => r.map(x => x.pluginId === pluginId
        ? { ...x, granted: Object.fromEntries(x.declared.map(p => [p, false])), reviewed: false }
        : x
      ))
    } finally {
      setSaving(null)
    }
  }

  function toggleExpand(id: string) {
    setExpanded(e => { const n = new Set(e); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  if (loading) {
    return <div className="p-4 text-xs text-[var(--fg-faint)]">Loading plugins…</div>
  }

  if (rows.length === 0) {
    return (
      <div className="p-4 flex flex-col items-center gap-3 py-10 text-[var(--fg-faint)]">
        <ShieldOff size={24} strokeWidth={1.2} />
        <p className="text-xs text-center">No plugins installed.</p>
        <p className="text-[10px] text-center opacity-60 max-w-xs leading-relaxed">
          Install plugins with <code className="font-mono bg-[var(--surface-2)] px-1 rounded">tsuki install &lt;plugin&gt;</code>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3 p-1">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] text-[var(--fg-faint)] leading-relaxed">
          Control what each plugin can access. Changes take effect on the next IDE restart.
        </p>
        <button
          onClick={load}
          className="flex items-center gap-1 text-[10px] text-[var(--fg-faint)] hover:text-[var(--fg)] transition-colors"
        >
          <RefreshCw size={10} /> Refresh
        </button>
      </div>

      {rows.map(row => {
        const isExpanded = expanded.has(row.pluginId)
        const grantedCount = Object.values(row.granted).filter(Boolean).length
        const hasHighRisk = row.declared.some(
          p => row.granted[p] && PERMISSION_META[p]?.risk === 'high'
        )
        const isSaving = saving === row.pluginId

        return (
          <div
            key={row.pluginId}
            className="border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--surface-2)]"
          >
            {/* Plugin header row */}
            <button
              className="w-full flex items-center gap-3 p-3 text-left hover:bg-[var(--hover)] transition-colors"
              onClick={() => toggleExpand(row.pluginId)}
            >
              <div className={clsx(
                'w-6 h-6 rounded flex items-center justify-center flex-shrink-0',
                hasHighRisk ? 'bg-yellow-500/15' : 'bg-[var(--surface-3)]'
              )}>
                {hasHighRisk
                  ? <ShieldAlert size={12} className="text-yellow-400" />
                  : <Shield size={12} className="text-[var(--fg-faint)]" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[var(--fg)] truncate">{row.pluginId}</p>
                <p className="text-[10px] text-[var(--fg-faint)]">
                  {row.declared.length === 0
                    ? 'No permissions declared'
                    : `${grantedCount} / ${row.declared.length} permissions granted`
                  }
                  {!row.reviewed && row.declared.length > 0 && (
                    <span className="ml-1.5 text-[9px] font-semibold px-1 py-0.5 rounded bg-[var(--fg-faint)]/20 uppercase tracking-wide">
                      pending review
                    </span>
                  )}
                </p>
              </div>
              {isExpanded
                ? <ChevronDown size={13} className="text-[var(--fg-faint)] flex-shrink-0" />
                : <ChevronRight size={13} className="text-[var(--fg-faint)] flex-shrink-0" />
              }
            </button>

            {/* Expanded permissions */}
            {isExpanded && (
              <div className="border-t border-[var(--border)] p-3 space-y-2">
                {row.declared.length === 0 ? (
                  <p className="text-[10px] text-[var(--fg-faint)]">
                    This plugin declares no permissions.
                  </p>
                ) : (
                  row.declared.map(perm => {
                    const meta = PERMISSION_META[perm]
                    if (!meta) return null
                    const isOn = row.granted[perm] ?? false

                    return (
                      <div key={perm} className="flex items-center gap-3">
                        <button
                          disabled={isSaving}
                          onClick={() => {
                            const next = { ...row.granted, [perm]: !isOn }
                            saveRow(row, next)
                          }}
                          className={clsx(
                            'w-8 h-4 rounded-full transition-colors flex-shrink-0 relative',
                            isSaving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                            isOn ? 'bg-[var(--fg)]' : 'bg-[var(--surface-3)]'
                          )}
                        >
                          <span className={clsx(
                            'absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform',
                            isOn ? 'translate-x-4' : 'translate-x-0.5'
                          )} />
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-medium text-[var(--fg)]">{meta.label}</span>
                            {meta.risk === 'high' && (
                              <span className="text-[8px] font-semibold px-1 py-px rounded bg-yellow-500/20 text-yellow-400 uppercase">
                                sensitive
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-[var(--fg-faint)] truncate">{meta.description}</p>
                        </div>
                      </div>
                    )
                  })
                )}

                {/* Revoke all */}
                <div className="flex justify-end pt-1 border-t border-[var(--border)]/50">
                  <button
                    disabled={isSaving}
                    onClick={() => revokeAll(row.pluginId)}
                    className="flex items-center gap-1 text-[10px] text-red-400/70 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={10} /> Revoke all &amp; reset
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}