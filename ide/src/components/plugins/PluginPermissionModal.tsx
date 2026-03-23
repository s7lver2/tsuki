'use client'
/**
 * tsuki-ide :: PluginPermissionsModal
 *
 * Shown the first time a plugin loads (or when its declared permissions change).
 * The user can grant or deny each permission individually.
 * Their choices are persisted via Tauri's set_plugin_permissions command.
 */

import { useState } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { clsx } from 'clsx'
import { Shield, ShieldAlert, ShieldCheck, ChevronDown, ChevronRight } from 'lucide-react'
import type { IdePluginMeta, PermissionId } from '@/lib/pluginLoader'
import { PERMISSION_META } from '@/lib/pluginLoader'

interface Props {
  meta:     IdePluginMeta
  onGrant:  (granted: Set<PermissionId>) => void
  onDeny:   () => void        // deny all / skip — plugin loads with no permissions
}

export default function PluginPermissionsModal({ meta, onGrant, onDeny }: Props) {
  const declared = meta.declaredPermissions as PermissionId[]

  // Default: all off — user must explicitly enable each permission
  const [grants, setGrants] = useState<Record<PermissionId, boolean>>(
    () => Object.fromEntries(declared.map(p => [p, false])) as Record<PermissionId, boolean>
  )
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<Set<PermissionId>>(new Set())

  function toggle(perm: PermissionId) {
    setGrants(g => ({ ...g, [perm]: !g[perm] }))
  }

  function toggleExpand(perm: PermissionId) {
    setExpanded(e => {
      const next = new Set(e)
      next.has(perm) ? next.delete(perm) : next.add(perm)
      return next
    })
  }

  async function handleGrant() {
    setSaving(true)
    try {
      await invoke('set_plugin_permissions', {
        pluginId: meta.id,
        grants,
      })
      const grantedSet = new Set(
        Object.entries(grants)
          .filter(([, v]) => v)
          .map(([k]) => k as PermissionId)
      )
      onGrant(grantedSet)
    } catch (e) {
      console.error('[permissions] save failed:', e)
    } finally {
      setSaving(false)
    }
  }

  async function handleDenyAll() {
    setSaving(true)
    try {
      await invoke('set_plugin_permissions', {
        pluginId: meta.id,
        grants: Object.fromEntries(declared.map(p => [p, false])),
      })
      onDeny()
    } finally {
      setSaving(false)
    }
  }

  const grantedCount = Object.values(grants).filter(Boolean).length
  const hasHighRisk  = declared.some(
    p => grants[p] && PERMISSION_META[p]?.risk === 'high'
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="w-full max-w-md mx-4 bg-[var(--surface-1)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col"
        style={{ maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-[var(--border)]">
          <div className={clsx(
            'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
            hasHighRisk ? 'bg-yellow-500/15' : 'bg-[var(--surface-2)]'
          )}>
            {hasHighRisk
              ? <ShieldAlert size={20} className="text-yellow-400" />
              : <Shield size={20} className="text-[var(--fg-muted)]" />
            }
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--fg)] truncate">
              Permission request
            </h2>
            <p className="text-xs text-[var(--fg-faint)] mt-0.5">
              <span className="font-medium text-[var(--fg-muted)]">
                {meta.owner}/{meta.name}
              </span>
              {' '}v{meta.version} is asking for access
            </p>
            {meta.description && (
              <p className="text-xs text-[var(--fg-faint)] mt-1 leading-relaxed">
                {meta.description}
              </p>
            )}
          </div>
        </div>

        {/* Permission list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {declared.length === 0 ? (
            <p className="text-xs text-[var(--fg-faint)] text-center py-4">
              This plugin requests no permissions.
            </p>
          ) : (
            declared.map(perm => {
              const meta_p = PERMISSION_META[perm]
              if (!meta_p) return null
              const isExpanded = expanded.has(perm)
              const isGranted  = grants[perm]

              return (
                <div
                  key={perm}
                  className={clsx(
                    'rounded-lg border transition-colors',
                    isGranted
                      ? meta_p.risk === 'high'
                        ? 'border-yellow-500/40 bg-yellow-500/8'
                        : 'border-[var(--fg-faint)]/30 bg-[var(--surface-2)]'
                      : 'border-[var(--border)] bg-[var(--surface)]'
                  )}
                >
                  <div className="flex items-center gap-3 p-3">
                    {/* Toggle */}
                    <button
                      onClick={() => toggle(perm)}
                      className={clsx(
                        'w-9 h-5 rounded-full transition-colors flex-shrink-0 relative',
                        isGranted ? 'bg-[var(--fg)]' : 'bg-[var(--surface-3)]'
                      )}
                    >
                      <span className={clsx(
                        'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                        isGranted ? 'translate-x-4' : 'translate-x-0.5'
                      )} />
                    </button>

                    {/* Label + risk */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-[var(--fg)]">
                          {meta_p.label}
                        </span>
                        {meta_p.risk === 'high' && (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 uppercase tracking-wide">
                            sensitive
                          </span>
                        )}
                      </div>
                      {!isExpanded && (
                        <p className="text-[10px] text-[var(--fg-faint)] mt-0.5 truncate">
                          {meta_p.description}
                        </p>
                      )}
                      {isExpanded && (
                        <p className="text-[10px] text-[var(--fg-faint)] mt-1 leading-relaxed">
                          {meta_p.description}
                          <span className="ml-1 font-mono text-[9px] text-[var(--fg-faint)]/60">
                            ({perm})
                          </span>
                        </p>
                      )}
                    </div>

                    {/* Expand toggle */}
                    <button
                      onClick={() => toggleExpand(perm)}
                      className="text-[var(--fg-faint)] hover:text-[var(--fg)] transition-colors flex-shrink-0"
                    >
                      {isExpanded
                        ? <ChevronDown size={13} />
                        : <ChevronRight size={13} />
                      }
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border)] space-y-3">
          {hasHighRisk && (
            <p className="text-[10px] text-yellow-400/80 leading-relaxed flex items-start gap-1.5">
              <ShieldAlert size={11} className="flex-shrink-0 mt-0.5" />
              This plugin is requesting high-risk permissions. Only grant them if you trust the publisher.
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleDenyAll}
              disabled={saving}
              className="flex-1 px-3 py-2 rounded-lg text-xs font-medium border border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer bg-transparent"
            >
              Load without permissions
            </button>
            <button
              onClick={handleGrant}
              disabled={saving}
              className={clsx(
                'flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer border-0',
                grantedCount > 0
                  ? 'bg-[var(--fg)] text-[var(--bg)] hover:opacity-90'
                  : 'bg-[var(--surface-2)] text-[var(--fg-faint)]'
              )}
            >
              {saving ? 'Saving…' : grantedCount > 0 ? `Grant ${grantedCount} permission${grantedCount !== 1 ? 's' : ''}` : 'Confirm'}
            </button>
          </div>

          <p className="text-[9px] text-[var(--fg-faint)] text-center leading-relaxed">
            Permissions can be changed at any time in Settings → Plugins.
            Verified by Ed25519 signature at install time.
          </p>
        </div>
      </div>
    </div>
  )
}