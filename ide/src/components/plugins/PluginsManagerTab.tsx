'use client'
/**
 * tsuki-ide :: PluginsManagerTab
 *
 * Two modes:
 *   initialTab = 'core' | 'community'  → plugin list for that section
 *   initialTab = 'plugin:<owner>/<name>' → dedicated settings page for one plugin
 *
 * Navigation: clicking "Configure" on a card calls setSettingsTab('plugin:<id>')
 * which the SettingsScreen routes back here with that initialTab.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  Search, X, RefreshCw, ChevronRight, ArrowLeft,
  AlertTriangle, Check, Puzzle, Star,
  Shield, ShieldAlert, ShieldCheck, AlertCircle,
  BadgeCheck, Users, Settings2, ExternalLink,
  ToggleLeft, Type, Hash, List, Globe, Download,
} from 'lucide-react'
import { invoke } from '@tauri-apps/api/tauri'
import { Toggle } from '@/components/shared/primitives'
import { PERMISSION_META } from '@/lib/pluginLoader'
import {
  getLoadedPlugins, reloadPlugin, unloadPlugin,
  type PermissionId, type IdePluginMeta,
} from '@/lib/pluginLoader'
import { notifyPluginsChanged, subscribeToPluginChanges } from '@/lib/usePlugins'
import { useStore } from '@/lib/store'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RegistryVersion { version: string; url?: string }

interface PluginSettingDef {
  key:          string
  label:        string
  description?: string
  type:         'toggle' | 'text' | 'number' | 'select'
  default?:     string | boolean | number
  options?:     string[]
}

interface IndexEntry {
  name: string; owner: string; type: string
  description?: string; icon?: string; tags?: string[]
  repository?: string; downloads?: number; rating?: number
  permissions?: string[]; slots?: string[]
  versions: RegistryVersion[]; latest_version?: string
  settings_schema?: PluginSettingDef[]
}

interface KeyEntry {
  public_key: string; display_name?: string; avatar_url?: string
  bio?: string; website?: string; verified?: boolean; role?: string
}

interface PluginView extends IndexEntry {
  sourceUrl: string; authorEntry?: KeyEntry; isCore: boolean
}

type FilterStatus = 'all' | 'installed' | 'available'

// ─── Constants ────────────────────────────────────────────────────────────────

const BUILTIN_SOURCE = 'https://raw.githubusercontent.com/s7lver2/tsuki/refs/heads/main/pkg'

const PERM_RISK: Record<string, 'low' | 'medium' | 'high'> = {
  'fs:read': 'low', 'fs:write': 'medium', 'shell:execute': 'high',
  'network:fetch': 'medium', 'network:local': 'low',
  'settings:read': 'low', 'settings:write': 'medium',
  'state:read:tabs': 'low', 'state:read:git': 'low', 'state:read:settings': 'low',
  'state:mutate:git': 'high', 'state:mutate:sandbox': 'low',
  'state:mutate:problems': 'low', 'state:mutate:log': 'low',
}

function riskColor(r: 'low' | 'medium' | 'high') {
  return r === 'high'   ? 'text-red-400 bg-red-400/10 border-red-400/20'
       : r === 'medium' ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20'
       :                  'text-blue-400 bg-blue-400/10 border-blue-400/20'
}

function maxRisk(perms: string[]): 'low' | 'medium' | 'high' {
  if (perms.some(p => PERM_RISK[p] === 'high'))   return 'high'
  if (perms.some(p => PERM_RISK[p] === 'medium')) return 'medium'
  return 'low'
}

function latestVer(p: IndexEntry): string {
  if (p.latest_version) return p.latest_version
  return p.versions?.length ? p.versions[p.versions.length - 1].version : '—'
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

function baseUrl(src: string): string {
  const s = src.trim().replace(/\/$/, '')
  if (s.endsWith('/packages.json')) return s.slice(0, -'/packages.json'.length)
  if (s.endsWith('.json'))          return s.slice(0, s.lastIndexOf('/'))
  return s
}

async function fetchSource(src: string): Promise<{ packages: IndexEntry[]; keys: Record<string, KeyEntry> }> {
  const base    = baseUrl(src)
  const pkgUrl  = src.trim().endsWith('.json') ? src.trim() : `${base}/packages.json`
  const keysUrl = `${base}/tsuki-keys.json`
  const [pkgRes, keyRes] = await Promise.allSettled([
    fetch(pkgUrl,  { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
    fetch(keysUrl, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
  ])
  const packages: IndexEntry[] = pkgRes.status === 'fulfilled' ? (pkgRes.value?.packages ?? []) : []
  let keys: Record<string, KeyEntry> = {}
  if (keyRes.status === 'fulfilled') {
    const ki = keyRes.value
    if (ki?.signers) { keys = ki.signers }
    else if (ki?.keys) {
      for (const [n, v] of Object.entries(ki.keys as Record<string, string>))
        keys[n] = { public_key: v }
    }
  }
  return { packages, keys }
}

// ─── Shared state hook (keeps data between tab switches) ─────────────────────
// We use module-level cache so Core and Community tabs share the same fetch.

let _cache: { plugins: PluginView[]; ts: number } | null = null
let _fetchPromise: Promise<PluginView[]> | null = null

async function loadPlugins(registryUrls: string[]): Promise<PluginView[]> {
  if (_cache && Date.now() - _cache.ts < 60_000) return _cache.plugins

  if (_fetchPromise) return _fetchPromise

  _fetchPromise = (async () => {
    const seenBases = new Set<string>()
    const sources: string[] = []
    for (const u of [...registryUrls, BUILTIN_SOURCE]) {
      const b = baseUrl(u)
      if (!seenBases.has(b)) { seenBases.add(b); sources.push(u) }
    }

    const seen = new Set<string>()
    const merged: PluginView[] = []
    for (const src of sources) {
      try {
        const { packages, keys } = await fetchSource(src)
        for (const pkg of packages) {
          if (pkg.type !== 'ide-plugin') continue
          const id = `${pkg.owner}/${pkg.name}`
          if (seen.has(id)) continue
          seen.add(id)
          const authorEntry = keys[pkg.owner]
          const isCore = authorEntry?.verified === true || pkg.owner === 'tsuki-team'
          merged.push({ ...pkg, sourceUrl: src, authorEntry, isCore })
        }
      } catch { /* skip unreachable source */ }
    }

    _cache = { plugins: merged, ts: Date.now() }
    _fetchPromise = null
    return merged
  })()

  return _fetchPromise
}

function invalidateCache() { _cache = null; _fetchPromise = null }

// ─── Community warning modal ──────────────────────────────────────────────────

function CommunityWarningModal({ plugin, onConfirm, onCancel }: {
  plugin: PluginView; onConfirm: () => void; onCancel: () => void
}) {
  const [remaining, setRemaining] = useState(10)
  const [canConfirm, setCanConfirm] = useState(false)
  useEffect(() => {
    if (remaining <= 0) { setCanConfirm(true); return }
    const t = setTimeout(() => setRemaining(r => r - 1), 1000)
    return () => clearTimeout(t)
  }, [remaining])
  const perms = plugin.permissions ?? []
  const risk  = maxRisk(perms)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 flex flex-col rounded-2xl overflow-hidden shadow-2xl border border-yellow-500/30"
        style={{ background: 'var(--surface-1)', maxHeight: '92vh' }}>
        <div className="h-1.5 w-full" style={{ background: 'linear-gradient(90deg,#ef4444,#f97316)' }} />
        <div className="px-6 pt-6 pb-4 flex items-start gap-4 border-b border-[var(--border)]">
          <div className="w-12 h-12 rounded-xl bg-yellow-500/15 border border-yellow-500/30 flex items-center justify-center flex-shrink-0">
            <ShieldAlert size={24} className="text-yellow-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[var(--fg)] leading-tight">Community Plugin Warning</h2>
            <p className="text-sm text-[var(--fg-muted)] mt-1">
              <span className="font-semibold text-[var(--fg)]">{plugin.owner}/{plugin.name}</span>
              {' '}— <strong className="text-yellow-400">not published by tsuki-team</strong>.
            </p>
          </div>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto flex-1">
          <div className="rounded-xl border border-yellow-500/25 bg-yellow-500/5 p-4 flex flex-col gap-3">
            <p className="text-xs font-semibold text-yellow-400 uppercase tracking-widest flex items-center gap-2">
              <AlertTriangle size={12} /> Read carefully before continuing
            </p>
            {[
              'Community plugins are NOT reviewed or audited by tsuki-team.',
              'A plugin can read your project files, execute shell commands, or make network requests.',
              'A malicious plugin could steal source code, modify files, or exfiltrate data.',
              'Only install plugins from authors you personally trust.',
              'Verify the plugin\'s source code on its repository before activating it.',
            ].map((text, i) => (
              <div key={i} className="flex items-start gap-2.5 text-xs text-[var(--fg-muted)]">
                <span className="text-yellow-500 font-bold mt-0.5 flex-shrink-0">•</span>
                <span className="leading-relaxed">{text}</span>
              </div>
            ))}
          </div>
          {perms.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {perms.map(p => (
                <span key={p} className={clsx('text-[10px] font-mono px-2 py-0.5 rounded border', riskColor(PERM_RISK[p] ?? 'low'))}>{p}</span>
              ))}
            </div>
          )}
          {risk === 'high' && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/8 p-3.5 flex items-start gap-2.5">
              <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300 leading-relaxed">
                This plugin requests <strong>shell:execute</strong> — it can run arbitrary commands on your machine.
              </p>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-[var(--border)] flex items-center gap-3">
          <button onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer bg-transparent">
            Cancel
          </button>
          <button onClick={canConfirm ? onConfirm : undefined} disabled={!canConfirm}
            className={clsx(
              'flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2',
              canConfirm ? 'bg-yellow-500 text-black hover:bg-yellow-400 cursor-pointer' : 'bg-[var(--surface-3)] text-[var(--fg-faint)] cursor-not-allowed',
            )}>
            {canConfirm
              ? <><Check size={14} /> I understand, activate</>
              : <><span className="tabular-nums font-mono text-base leading-none">{remaining}</span><span className="text-xs font-normal opacity-75">Please read above…</span></>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Plugin list card (compact, with Configure button) ───────────────────────

function PluginListCard({ plugin, enabled, loading, onToggle, onConfigure }: {
  plugin:      PluginView
  enabled:     boolean
  loading:     boolean
  onToggle:    () => void
  onConfigure: () => void
}) {
  const perms = plugin.permissions ?? []
  const risk  = maxRisk(perms)

  return (
    <div className={clsx(
      'group flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all duration-150 cursor-default',
      enabled ? 'border-[var(--fg-faint)]/35 bg-[var(--surface-1)]'
              : 'border-[var(--border)] bg-[var(--surface-1)] opacity-65',
    )}>
      {/* Icon */}
      <div className={clsx(
        'w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 text-lg leading-none',
        enabled ? 'border-[var(--fg-faint)]/20 bg-[var(--surface-2)]' : 'border-[var(--border)] bg-[var(--surface)]',
      )}>
        {plugin.icon ?? '🧩'}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="text-sm font-semibold text-[var(--fg)] leading-tight">{plugin.name}</span>
          <span className="text-[10px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1.5 rounded">
            v{latestVer(plugin)}
          </span>
          {perms.length > 0 && (
            <span className={clsx('flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border', riskColor(risk))}>
              <Shield size={8} />{risk}
            </span>
          )}
        </div>
        {plugin.description && (
          <p className="text-[11px] text-[var(--fg-muted)] leading-relaxed line-clamp-1">{plugin.description}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onConfigure}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-[11px] font-medium text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] hover:border-[var(--fg-faint)] transition-colors cursor-pointer bg-transparent"
        >
          <Settings2 size={11} />
          Configure
          <ChevronRight size={10} />
        </button>
        <Toggle on={enabled} onToggle={onToggle} loading={loading} />
      </div>
    </div>
  )
}

// ─── Per-plugin settings page ─────────────────────────────────────────────────

// ── Settings page primitives (mirrors SettingsScreen patterns) ────────────────

function PField({ name, desc, icon, children, disabled }: {
  name: string; desc?: string; icon?: string; children: React.ReactNode; disabled?: boolean
}) {
  return (
    <div className={clsx(
      'flex items-center gap-4 py-3.5 border-b border-[var(--border-subtle)] last:border-0',
      disabled && 'opacity-35 pointer-events-none select-none',
    )}>
      <div className="flex items-start gap-2.5 flex-1 min-w-0">
        {icon && (
          <span className="text-base leading-none mt-0.5 flex-shrink-0 select-none">{icon}</span>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--fg)]">{name}</div>
          {desc && <div className="text-xs text-[var(--fg-muted)] mt-0.5 leading-relaxed">{desc}</div>}
        </div>
      </div>
      <div className="flex-shrink-0" style={{ width: 'clamp(140px,18vw,200px)' }}>
        {children}
      </div>
    </div>
  )
}

function PGroup({ title, emoji, children }: { title: string; emoji?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mt-7 mb-1 pb-2 border-b border-[var(--border)] flex items-center gap-2">
        {emoji && <span className="text-sm leading-none select-none">{emoji}</span>}
        <span className="text-[10px] font-semibold text-[var(--fg-faint)] uppercase tracking-widest">{title}</span>
      </div>
      {children}
    </div>
  )
}

function PTextInput({ value, onChange, mono, placeholder }: {
  value: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string
}) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={clsx(
        'w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--fg)]',
        'outline-none focus:border-[var(--fg-faint)] transition-colors',
        mono && 'font-mono',
      )}
    />
  )
}

function PNumberInput({ value, onChange, min, max, step, unit }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number" value={value} min={min} max={max} step={step ?? 1}
        onChange={e => onChange(Number(e.target.value))}
        className="w-24 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--fg)] outline-none focus:border-[var(--fg-faint)] font-mono text-right transition-colors"
      />
      {unit && <span className="text-xs text-[var(--fg-faint)]">{unit}</span>}
    </div>
  )
}

function PSelect({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: string[]
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--fg)] outline-none focus:border-[var(--fg-faint)] cursor-pointer transition-colors"
    >
      {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  )
}

// ── PluginSettingsPage ────────────────────────────────────────────────────────

// Per-group emoji and per-field icon metadata for known plugins
const LSP_GROUPS: { key: string; title: string; emoji: string; keys: string[] }[] = [
  { key: 'general',   title: 'General',          emoji: '⚙️',  keys: ['lspEnabled', 'lspPath'] },
  { key: 'features',  title: 'Editor features',  emoji: '✨',  keys: ['lspDiagnosticsEnabled', 'lspCompletionsEnabled', 'lspHoverEnabled', 'lspSignatureHelp', 'lspInlayHints', 'lspDiagnosticDelay'] },
  { key: 'languages', title: 'Language support', emoji: '🔤',  keys: ['lspGoEnabled', 'lspCppEnabled', 'lspInoEnabled'] },
  { key: 'libs',      title: 'Library detection',emoji: '📦',  keys: ['lspShowLibPrompt', 'lspAutoDownloadLibs'] },
]

const LSP_FIELD_ICONS: Record<string, string> = {
  lspEnabled:            '🔌',
  lspPath:               '📂',
  lspDiagnosticsEnabled: '🔴',
  lspCompletionsEnabled: '💡',
  lspHoverEnabled:       '🔍',
  lspSignatureHelp:      '📋',
  lspInlayHints:         '🏷️',
  lspDiagnosticDelay:    '⏱️',
  lspGoEnabled:          '🐹',
  lspCppEnabled:         '⚡',
  lspInoEnabled:         '🤖',
  lspShowLibPrompt:      '📬',
  lspAutoDownloadLibs:   '⬇️',
}

const PERM_ICONS: Record<string, string> = {
  'fs:read':               '📂',
  'fs:write':              '💾',
  'shell:execute':         '💻',
  'network:fetch':         '🌐',
  'network:local':         '🔗',
  'settings:read':         '⚙️',
  'settings:write':        '🔧',
  'state:read:tabs':       '📄',
  'state:read:git':        '🌿',
  'state:read:settings':   '⚙️',
  'state:mutate:git':      '✍️',
  'state:mutate:sandbox':  '🧪',
  'state:mutate:problems': '⚠️',
  'state:mutate:log':      '📝',
}

function groupSchema(schema: PluginSettingDef[], pluginName: string) {
  const isLsp = pluginName === 'ide-lsp'
  if (!isLsp) {
    return [{ key: 'all', title: 'Configuration', emoji: '⚙️', defs: schema }]
  }
  const byKey = new Map(schema.map(d => [d.key, d]))
  const groups = LSP_GROUPS.map(g => ({
    key:   g.key,
    title: g.title,
    emoji: g.emoji,
    defs:  g.keys.map(k => byKey.get(k)).filter((d): d is PluginSettingDef => !!d),
  })).filter(g => g.defs.length > 0)
  const extras = schema.filter(d => !groups.some(g => g.defs.includes(d)))
  if (extras.length > 0) groups.push({ key: 'other', title: 'Other', emoji: '🔩', defs: extras })
  return groups
}

function PluginSettingsPage({ plugin, enabled, loading, grants, pluginSettings, onToggle, onGrantChange, onSettingChange, onBack }: {
  plugin:         PluginView
  enabled:        boolean
  loading:        boolean
  grants:         Record<string, boolean>
  pluginSettings: Record<string, string | boolean | number>
  onToggle:       () => void
  onGrantChange:  (perm: string, val: boolean) => void
  onSettingChange:(key: string, val: string | boolean | number) => void
  onBack:         () => void
}) {
  const perms   = plugin.permissions ?? []
  const schema  = plugin.settings_schema ?? []
  const author  = plugin.authorEntry
  const risk    = maxRisk(perms)
  const groups  = groupSchema(schema, plugin.name)
  const isLsp   = plugin.name === 'ide-lsp'
  const lspOn   = isLsp ? (pluginSettings['lspEnabled'] === true || pluginSettings['lspEnabled'] === 'true') : true

  function ctrl(def: PluginSettingDef) {
    const val = pluginSettings[def.key] ?? def.default
    if (def.type === 'toggle') {
      const boolVal = val === true || val === 'true'
      return <Toggle on={boolVal} onToggle={() => onSettingChange(def.key, !boolVal)} />
    }
    if (def.type === 'number') {
      const unit = def.key.toLowerCase().includes('delay') || def.key.toLowerCase().includes('ms') ? 'ms' : undefined
      return <PNumberInput value={Number(val ?? 0)} onChange={v => onSettingChange(def.key, v)} min={0} unit={unit} />
    }
    if (def.type === 'select') {
      return <PSelect value={String(val ?? '')} onChange={v => onSettingChange(def.key, v)} options={def.options ?? []} />
    }
    return <PTextInput value={String(val ?? '')} onChange={v => onSettingChange(def.key, v)} mono placeholder={def.key === 'lspPath' ? '/path/to/tsuki-lsp' : undefined} />
  }

  function isGatedByLsp(key: string) {
    if (!isLsp) return false
    return key !== 'lspEnabled' && key !== 'lspPath'
  }

  return (
    <div className="flex flex-col" style={{ '--settings-field-ctrl': 'clamp(140px,18vw,200px)' } as any}>

      {/* ── Breadcrumb ── */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors border-0 bg-transparent cursor-pointer p-0 mb-6 w-fit"
      >
        <ArrowLeft size={12} />
        {plugin.isCore ? 'Core Plugins' : 'Community Plugins'}
      </button>

      {/* ── Plugin hero ── */}
      <div className="flex items-start gap-4 mb-2">
        <div className="w-16 h-16 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-center text-4xl leading-none flex-shrink-0 select-none">
          {plugin.icon ?? '🧩'}
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h2 className="text-xl font-bold text-[var(--fg)] tracking-tight leading-tight">{plugin.name}</h2>
            <span className="text-[10px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded">
              v{latestVer(plugin)}
            </span>
            {plugin.isCore
              ? <span className="flex items-center gap-1 text-[9px] font-semibold text-sky-400 bg-sky-400/10 px-1.5 py-0.5 rounded border border-sky-400/20"><BadgeCheck size={9} /> official</span>
              : <span className="flex items-center gap-1 text-[9px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20"><Users size={9} /> community</span>
            }
            {perms.length > 0 && (
              <span className={clsx('flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border', riskColor(risk))}>
                <Shield size={8} />{risk} risk
              </span>
            )}
          </div>
          {plugin.description && (
            <p className="text-sm text-[var(--fg-muted)] leading-relaxed">{plugin.description}</p>
          )}
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {author?.display_name && (
              <span className="text-[10px] text-[var(--fg-faint)]">
                by <span className="text-[var(--fg-muted)]">{author.display_name}</span>
              </span>
            )}
            {typeof plugin.downloads === 'number' && (
              <span className="flex items-center gap-1 text-[10px] text-[var(--fg-faint)]">
                <Download size={9} />{plugin.downloads.toLocaleString()} installs
              </span>
            )}
            {typeof plugin.rating === 'number' && (
              <span className="flex items-center gap-1 text-[10px] text-[var(--fg-faint)]">
                <Star size={9} />{plugin.rating.toFixed(1)}
              </span>
            )}
            {plugin.repository && (
              <a href={plugin.repository} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300 transition-colors">
                <Globe size={9} /> Source
              </a>
            )}
          </div>
        </div>

        {/* Enable toggle */}
        <div className="flex flex-col items-center gap-1.5 flex-shrink-0 pt-1">
          <Toggle on={enabled} onToggle={onToggle} loading={loading} />
          <span className="text-[9px] text-[var(--fg-faint)] font-medium">
            {loading ? 'loading…' : enabled ? 'enabled' : 'disabled'}
          </span>
        </div>
      </div>

      {/* ── "LSP disabled" notice ── */}
      {isLsp && !lspOn && enabled && (
        <div className="mt-4 flex items-center gap-2.5 px-3.5 py-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] text-xs text-[var(--fg-muted)]">
          <span className="text-base leading-none">💤</span>
          <span>Language features are paused. Toggle <strong className="text-[var(--fg)]">Enable LSP</strong> below to activate them.</span>
        </div>
      )}
      {!enabled && (
        <div className="mt-4 flex items-center gap-2.5 px-3.5 py-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] text-xs text-[var(--fg-muted)]">
          <span className="text-base leading-none">🔌</span>
          <span>This plugin is <strong className="text-[var(--fg)]">not loaded</strong>. Enable it above to activate its features.</span>
        </div>
      )}

      {/* ── Settings groups ── */}
      {schema.length > 0 && groups.map(group => (
        <PGroup key={group.key} title={group.title} emoji={group.emoji}>
          {group.defs.map(def => (
            <PField
              key={def.key}
              name={def.label}
              desc={def.description}
              icon={isLsp ? LSP_FIELD_ICONS[def.key] : undefined}
              disabled={isGatedByLsp(def.key) && !lspOn}
            >
              {ctrl(def)}
            </PField>
          ))}
        </PGroup>
      ))}

      {/* ── Permissions ── */}
      {perms.length > 0 && (
        <PGroup title="Permissions" emoji="🔐">
          {perms.map(perm => {
            const meta = PERMISSION_META[perm as PermissionId]
            const r    = PERM_RISK[perm] ?? 'low'
            return (
              <PField
                key={perm}
                name={meta?.label ?? perm}
                desc={meta?.description}
                icon={PERM_ICONS[perm]}
              >
                <div className="flex items-center gap-2 justify-end">
                  <span className={clsx('text-[9px] font-mono px-1.5 py-0.5 rounded border', riskColor(r as 'low'|'medium'|'high'))}>
                    {r}
                  </span>
                  <Toggle on={grants[perm] ?? false} onToggle={() => onGrantChange(perm, !(grants[perm] ?? false))} />
                </div>
              </PField>
            )
          })}
          <p className="text-[10px] text-[var(--fg-faint)] pt-3 leading-relaxed">
            🛡️ Disabling a permission revokes it immediately. Re-enabling requires reloading the plugin.
          </p>
        </PGroup>
      )}

      {/* ── About ── */}
      <PGroup title="About" emoji="ℹ️">
        {[
          ['🏷️', 'Owner',   plugin.owner],
          ['📦', 'Version', latestVer(plugin)],
          ...(author?.display_name ? [['👤', 'Author', author.display_name]] : []),
          ...(author?.role         ? [['🎖️', 'Role',   author.role]]         : []),
          ...(plugin.slots?.length ? [['🧩', 'Slots',  plugin.slots.join(', ')]] : []),
          ...(plugin.tags?.length  ? [['🔖', 'Tags',   plugin.tags.join(', ')]]  : []),
        ].map(([icon, label, value]) => (
          <div key={label} className="flex items-center justify-between py-2.5 border-b border-[var(--border-subtle)] last:border-0">
            <span className="flex items-center gap-2 text-sm text-[var(--fg-muted)]">
              <span className="text-sm leading-none select-none">{icon}</span>
              {label}
            </span>
            <span className="text-xs font-mono text-[var(--fg-faint)]">{value}</span>
          </div>
        ))}
        {plugin.repository && (
          <div className="flex items-center justify-between py-2.5">
            <span className="flex items-center gap-2 text-sm text-[var(--fg-muted)]">
              <span className="text-sm leading-none select-none">🔗</span>
              Repository
            </span>
            <a href={plugin.repository} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 transition-colors">
              <ExternalLink size={10} /> Open source
            </a>
          </div>
        )}
      </PGroup>

    </div>
  )
}

// ─── Plugin list ──────────────────────────────────────────────────────────────

function PluginList({ isCore, plugins, loading, fetchErr, enabledSet, loadingIds, grantsMap, pluginSettings, ackedComm, onToggle, onOpenSettings, onRefresh }: {
  isCore:         boolean
  plugins:        PluginView[]
  loading:        boolean
  fetchErr:       string | null
  enabledSet:     Set<string>
  loadingIds:     Set<string>
  grantsMap:      Record<string, Record<string, boolean>>
  pluginSettings: Record<string, Record<string, string | boolean | number>>
  ackedComm:      Set<string>
  onToggle:       (p: PluginView) => void
  onOpenSettings: (p: PluginView) => void
  onRefresh:      () => void
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterStatus>('all')

  const filtered = plugins.filter(p => {
    const id = `${p.owner}/${p.name}`
    if (filter === 'installed' && !enabledSet.has(id)) return false
    if (filter === 'available'  &&  enabledSet.has(id)) return false
    if (!search) return true
    const q = search.toLowerCase()
    return p.name.toLowerCase().includes(q) || p.owner.toLowerCase().includes(q) ||
           (p.description ?? '').toLowerCase().includes(q) || (p.tags ?? []).some(t => t.includes(q))
  })

  const activeCount = plugins.filter(p => enabledSet.has(`${p.owner}/${p.name}`)).length

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          {isCore
            ? <BadgeCheck size={18} className="text-sky-400 flex-shrink-0" />
            : <Users      size={18} className="text-amber-400 flex-shrink-0" />
          }
          <div>
            <h2 className="text-lg font-bold tracking-tight text-[var(--fg)] leading-tight">
              {isCore ? 'Core Plugins' : 'Community Plugins'}
            </h2>
            <p className="text-xs text-[var(--fg-muted)]">
              {isCore ? `Verified by tsuki-team` : `Third-party plugins`}
              {' · '}{activeCount} of {plugins.length} active
            </p>
          </div>
        </div>
        <button onClick={onRefresh} disabled={loading} title="Refresh"
          className="p-1.5 rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer transition-colors flex-shrink-0">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Trust banner */}
      {isCore ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-400/5 border border-sky-400/15">
          <ShieldCheck size={12} className="text-sky-400 flex-shrink-0" />
          <p className="text-[10px] text-sky-300/80 leading-relaxed">
            Core plugins are developed and signed by <strong className="text-sky-300">tsuki-team</strong> or
            verified publishers. Security-reviewed before each release.
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
          <AlertTriangle size={12} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-[var(--fg-muted)] leading-relaxed">
            Community plugins are <strong className="text-[var(--fg)]">not reviewed by tsuki-team</strong>.
            First activation shows a mandatory 10-second warning. Always verify source code before enabling.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-14 text-[var(--fg-faint)]">
          <RefreshCw size={16} className="animate-spin" />
          <span className="text-sm">Fetching registry…</span>
        </div>
      ) : fetchErr ? (
        <div className="flex items-start gap-3 px-4 py-4 rounded-xl border border-red-500/30 bg-red-500/5">
          <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-400 mb-1">Could not load plugins</p>
            <p className="text-xs text-[var(--fg-muted)] leading-relaxed">{fetchErr}</p>
          </div>
        </div>
      ) : (
        <>
          {/* Search + filter */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] pointer-events-none" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                className="w-full pl-7 pr-7 py-1.5 text-xs bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--fg)] placeholder-[var(--fg-faint)] outline-none focus:border-[var(--fg-faint)] transition-colors" />
              {search && (
                <button onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer">
                  <X size={10} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              {(['all', 'installed', 'available'] as FilterStatus[]).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={clsx(
                    'px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors cursor-pointer border whitespace-nowrap',
                    filter === f ? 'bg-[var(--active)] border-[var(--fg-faint)]/30 text-[var(--fg)]'
                                 : 'bg-transparent border-[var(--border)] text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
                  )}>
                  {f === 'all' ? `All (${filtered.length})` : f === 'installed' ? 'Active' : 'Available'}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-[var(--fg-faint)]">
              {plugins.length === 0
                ? <><Puzzle size={20} strokeWidth={1.2} /><p className="text-xs">No plugins available from your sources.</p></>
                : <><Search size={20} strokeWidth={1.2} /><p className="text-xs">No plugins match your search.</p></>
              }
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filtered.map(p => {
                const id = `${p.owner}/${p.name}`
                return (
                  <PluginListCard key={id} plugin={p}
                    enabled={enabledSet.has(id)}
                    loading={loadingIds.has(id)}
                    onToggle={() => onToggle(p)}
                    onConfigure={() => onOpenSettings(p)}
                  />
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// Converts the IdePluginMeta id format "owner/name@version" → "owner/name"
function metaIdToPluginId(metaId: string): string {
  return metaId.includes('@') ? metaId.slice(0, metaId.lastIndexOf('@')) : metaId
}

export default function PluginsManagerTab({ initialTab = 'core' }: { initialTab?: 'core' | 'community' | (string & {}) }) {
  const { settings, setSettingsTab } = useStore()
  const registryUrls: string[] = (settings as any).registryUrls ?? []

  // ── Registry data ─────────────────────────────────────────────────────────
  const [allPlugins,     setAllPlugins    ] = useState<PluginView[]>([])
  const [loading,        setLoading       ] = useState(true)
  const [fetchErr,       setFetchErr      ] = useState<string | null>(null)

  // ── Enabled state — derived from the real plugin system ───────────────────
  // tick increments after every load/unload to force re-derivation.
  const [tick, setTick] = useState(0)

  // loadingIds: plugin IDs currently mid-toggle — toggle is disabled + shows spinner
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())
  const addLoading    = (id: string) => setLoadingIds(p => new Set([...p, id]))
  const removeLoading = (id: string) => setLoadingIds(p => { const n = new Set(p); n.delete(id); return n })

  // Read directly inside render (not in useMemo) so the value is always fresh
  const _loaded = getLoadedPlugins()

  const enabledSet = useMemo(() =>
    new Set(_loaded.map(p => metaIdToPluginId(p.meta.id))),
  [tick]) // eslint-disable-line react-hooks/exhaustive-deps

  const grantsMap = useMemo(() => {
    const map: Record<string, Record<string, boolean>> = {}
    for (const lp of _loaded) {
      const id = metaIdToPluginId(lp.meta.id)
      map[id] = Object.fromEntries(
        lp.meta.declaredPermissions.map(p => [p, lp.grantedPermissions.has(p as PermissionId)])
      )
    }
    return map
  }, [tick]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Plugin settings (local — persisted in component while mounted) ────────
  const [pluginSettings, setPluginSettings] = useState<Record<string, Record<string, string | boolean | number>>>({})

  // ── Community warning ─────────────────────────────────────────────────────
  const [ackedComm,  setAckedComm ] = useState<Set<string>>(new Set())
  const [warnPlugin, setWarnPlugin ] = useState<PluginView | null>(null)

  // ── Subscribe to external plugin changes (IdeScreen, CLI install, etc.) ──
  useEffect(() => subscribeToPluginChanges(() => setTick(t => t + 1)), [])

  const fetchAll = useCallback(async (force = false) => {
    setLoading(true); setFetchErr(null)
    if (force) invalidateCache()
    try {
      const merged = await loadPlugins(registryUrls)
      if (merged.length === 0)
        setFetchErr('No plugins found. Check your registry sources in Settings → Defaults → Package registries.')
      setAllPlugins(merged)
      setPluginSettings((prev: Record<string, Record<string, string | boolean | number>>) => {
        const storeSettings = useStore.getState().settings
        const next = { ...prev }
        for (const p of merged) {
          const id = `${p.owner}/${p.name}`
          if (!next[id]) {
            // Start from schema defaults
            const defaults = Object.fromEntries((p.settings_schema ?? []).map(d => [d.key, d.default ?? '']))
            // For the LSP plugin, seed from the real store so values are correct on first open
            if (id === 'tsuki-team/ide-lsp' || p.name === 'ide-lsp') {
              const lspOverrides: Record<string, string | boolean | number> = {
                lspEnabled:            storeSettings.lspEnabled           ?? false,
                lspDiagnosticsEnabled: storeSettings.lspDiagnosticsEnabled ?? true,
                lspCompletionsEnabled: storeSettings.lspCompletionsEnabled ?? true,
                lspHoverEnabled:       storeSettings.lspHoverEnabled       ?? true,
                lspSignatureHelp:      storeSettings.lspSignatureHelp      ?? true,
                lspInlayHints:         storeSettings.lspInlayHints         ?? false,
                lspDiagnosticDelay:    storeSettings.lspDiagnosticDelay    ?? 600,
                lspGoEnabled:          storeSettings.lspGoEnabled          ?? true,
                lspCppEnabled:         storeSettings.lspCppEnabled         ?? true,
                lspInoEnabled:         storeSettings.lspInoEnabled         ?? true,
                lspShowLibPrompt:      storeSettings.lspShowLibPrompt      ?? true,
                lspAutoDownloadLibs:   storeSettings.lspAutoDownloadLibs   ?? false,
                lspPath:               storeSettings.lspPath               ?? '',
              }
              next[id] = { ...defaults, ...lspOverrides }
            } else {
              next[id] = defaults
            }
          }
        }
        return next
      })
    } catch (e: any) {
      setFetchErr(e?.message ?? 'Unknown error')
    }
    setLoading(false)
  }, [registryUrls.join(',')]) // eslint-disable-line

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Toggle enable — calls real plugin system ──────────────────────────────
  async function handleToggle(plugin: PluginView) {
    const id = `${plugin.owner}/${plugin.name}`
    if (loadingIds.has(id)) return  // already in progress

    if (enabledSet.has(id)) {
      addLoading(id)
      try {
        const loaded = getLoadedPlugins().find(lp => metaIdToPluginId(lp.meta.id) === id)
        if (loaded) { unloadPlugin(loaded.meta.id); notifyPluginsChanged() }
        setTick(t => t + 1)
      } finally { removeLoading(id) }
      return
    }

    if (!plugin.isCore && !ackedComm.has(id)) { setWarnPlugin(plugin); return }
    await doEnablePlugin(plugin)
  }

  async function doEnablePlugin(plugin: PluginView) {
    const id = `${plugin.owner}/${plugin.name}`
    addLoading(id)
    try {
      // list_ide_plugins returns IdePluginMeta[] — use the generic form for safety
      const metas = await (invoke as <T>(cmd: string) => Promise<T>)<IdePluginMeta[]>('list_ide_plugins').catch((): IdePluginMeta[] => [])
      const meta = metas.find(m => metaIdToPluginId(m.id) === id)
      if (!meta) {
        console.warn(`[plugins] ${id} not found on disk — run tsuki-dk sandbox first`)
        return
      }

      // reloadPlugin handles the invoke internally; we just supply the permission resolver
      await reloadPlugin(
        meta.id,
        () => useStore.getState().projectPath ?? '',
        (msg, type) => {
          if (type === 'error') console.error(msg)
          else if (type === 'warn') console.warn(msg)
          else console.info(msg)
        },
        async (m) => {
          try {
            const info = await (invoke as <T>(cmd: string, args?: object) => Promise<T>)<{ reviewed: boolean; granted: Record<string, boolean> }>(
              'get_plugin_permissions',
              { pluginId: m.id, declared: m.declaredPermissions },
            )
            if (info.reviewed) {
              return new Set(
                Object.entries(info.granted)
                  .filter(([, v]) => v)
                  .map(([k]) => k as PermissionId),
              )
            }
          } catch { /* no stored grants yet */ }
          // First enable: grant all declared permissions
          return new Set(m.declaredPermissions as PermissionId[])
        },
      )

      notifyPluginsChanged()
      setTick(t => t + 1)
    } catch (e) {
      console.error('[plugins] enable failed:', e)
    } finally {
      removeLoading(id)
    }
  }

  function handleWarningConfirm() {
    if (!warnPlugin) return
    const id = `${warnPlugin.owner}/${warnPlugin.name}`
    setAckedComm(prev => new Set([...prev, id]))
    setWarnPlugin(null)
    doEnablePlugin(warnPlugin)
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  const isPluginPage = initialTab.startsWith('plugin:')
  const pluginPageId = isPluginPage ? initialTab.slice('plugin:'.length) : null
  const currentPlugin = pluginPageId ? allPlugins.find(p => `${p.owner}/${p.name}` === pluginPageId) : null

  const isCore   = !isPluginPage ? initialTab !== 'community' : (currentPlugin?.isCore ?? true)
  const backTab  = isCore ? 'plugins-core' : 'plugins-community'

  const corePlugins = allPlugins.filter(p =>  p.isCore)
  const commPlugins = allPlugins.filter(p => !p.isCore)
  const currentList = isCore ? corePlugins : commPlugins

  // ─────────────────────────────────────────────────────────────────────────

  // Plugin settings page
  if (isPluginPage) {
    const id = pluginPageId!
    if (!currentPlugin && !loading) {
      return (
        <div className="flex flex-col items-center gap-3 py-16 text-[var(--fg-faint)]">
          <Puzzle size={20} strokeWidth={1.2} />
          <p className="text-xs">Plugin not found: {id}</p>
          <button onClick={() => setSettingsTab(backTab)}
            className="flex items-center gap-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors border-0 bg-transparent cursor-pointer mt-2">
            <ArrowLeft size={12} /> Go back
          </button>
        </div>
      )
    }
    if (loading && !currentPlugin) {
      return (
        <div className="flex items-center justify-center gap-3 py-16 text-[var(--fg-faint)]">
          <RefreshCw size={16} className="animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      )
    }
    return (
      <>
        <PluginSettingsPage
          plugin={currentPlugin!}
          enabled={enabledSet.has(id)}
          loading={loadingIds.has(id)}
          grants={grantsMap[id] ?? {}}
          pluginSettings={pluginSettings[id] ?? {}}
          onToggle={() => handleToggle(currentPlugin!)}
          onGrantChange={async (pm, v) => {
            const loaded = getLoadedPlugins().find(lp => metaIdToPluginId(lp.meta.id) === id)
            if (!loaded) return
            const next = { ...Object.fromEntries(loaded.meta.declaredPermissions.map(p => [p, loaded.grantedPermissions.has(p as PermissionId)])), [pm]: v }
            await (invoke as <T>(cmd: string, args?: object) => Promise<T>)<void>('set_plugin_permissions', { pluginId: loaded.meta.id, grants: next }).catch(() => {})
            setTick(t => t + 1)
          }}
          onSettingChange={(k, v) => {
            // Update local pluginSettings state
            setPluginSettings((prev: Record<string, Record<string, string | boolean | number>>) => ({ ...prev, [id]: { ...prev[id], [k]: v } }))
            // For LSP plugin: also persist to the real IDE store so changes take effect immediately
            const isLsp = id === 'tsuki-team/ide-lsp' || (currentPlugin?.name === 'ide-lsp')
            if (isLsp) {
              const lspKeys = new Set([
                'lspEnabled','lspDiagnosticsEnabled','lspCompletionsEnabled','lspHoverEnabled',
                'lspSignatureHelp','lspInlayHints','lspDiagnosticDelay','lspGoEnabled',
                'lspCppEnabled','lspInoEnabled','lspShowLibPrompt','lspAutoDownloadLibs','lspPath',
              ])
              if (lspKeys.has(k)) {
                useStore.getState().updateSetting(k as any, v)
              }
            }
          }}
          onBack={() => setSettingsTab(backTab)}
        />
        {warnPlugin && (
          <CommunityWarningModal plugin={warnPlugin} onConfirm={handleWarningConfirm} onCancel={() => setWarnPlugin(null)} />
        )}
      </>
    )
  }

  // Plugin list
  return (
    <>
      <PluginList
        isCore={isCore}
        plugins={currentList}
        loading={loading}
        fetchErr={fetchErr}
        enabledSet={enabledSet}
        loadingIds={loadingIds}
        grantsMap={grantsMap}
        pluginSettings={pluginSettings}
        ackedComm={ackedComm}
        onToggle={handleToggle}
        onOpenSettings={p => setSettingsTab(`plugin:${p.owner}/${p.name}` as import('@/lib/store').SettingsTab)}
        onRefresh={() => fetchAll(true)}
      />
      {warnPlugin && (
        <CommunityWarningModal plugin={warnPlugin} onConfirm={handleWarningConfirm} onCancel={() => setWarnPlugin(null)} />
      )}
    </>
  )
}