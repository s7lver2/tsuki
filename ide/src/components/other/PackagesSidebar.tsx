'use client'
import { useStore } from '@/lib/store'
import { useState, useEffect } from 'react'
import { loadRegistry } from '@/lib/packageRegistry'
import {
  Package, RefreshCw, Search, Download, Plus, Minus,
  ExternalLink, CheckCircle2, AlertCircle, Loader2,
} from 'lucide-react'
import { clsx } from 'clsx'

// ── Per-package operation state ───────────────────────────────────────────────

type PkgOpState = {
  downloading?: boolean   // tsuki pkg install <n>  (fetches C++ lib to disk)
  adding?:      boolean   // tsuki deps add <n>     (adds to tsuki_package.json)
  removing?:    boolean   // tsuki deps remove <n>
  progress?:    number    // 0–100 shown as a bar while downloading
  error?:       string
  done?:        boolean   // flash ✓ for 1.8 s then clear
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={clsx('w-full h-0.5 bg-[var(--surface-3)] rounded-full overflow-hidden', className)}>
      <div
        className="h-full bg-[var(--fg-muted)] rounded-full transition-all duration-200"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}

function IndeterminateBar({ className }: { className?: string }) {
  return (
    <div className={clsx('w-full h-0.5 bg-[var(--surface-3)] rounded-full overflow-hidden relative', className)}>
      <div
        className="absolute h-full w-1/3 bg-[var(--fg-muted)] rounded-full"
        style={{ animation: 'indeterminate 1.2s ease-in-out infinite' }}
      />
      <style>{`@keyframes indeterminate{0%{left:-33%}100%{left:100%}}`}</style>
    </div>
  )
}

// ── Main sidebar ──────────────────────────────────────────────────────────────

export default function PackagesSidebar() {
  const {
    packages, togglePackage, setPackageInstalling,
    addLog, settings, projectPath,
    dispatchCommand, setBottomTab,
    setPackages, packagesLoaded,
    syncInstalledPackages, openTabs, tree,
  } = useStore()

  const [query,      setQuery     ] = useState('')
  const [loadError,  setLoadError ] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [opState,    setOpState   ] = useState<Record<string, PkgOpState>>({})

  const tsuki = (settings.tsukiPath?.trim() || 'tsuki').replace(/^"|"$/g, '')
  const cwd   = projectPath || undefined

  function patchOp(name: string, patch: Partial<PkgOpState>) {
    setOpState(prev => ({ ...prev, [name]: { ...prev[name], ...patch } }))
  }
  function clearOp(name: string) {
    setOpState(prev => { const n = { ...prev }; delete n[name]; return n })
  }
  function flashDone(name: string) {
    patchOp(name, { done: true })
    setTimeout(() => clearOp(name), 1800)
  }

  // Sync installed state from manifest whenever it changes
  useEffect(() => {
    const manifestNode = tree.find(n => n.name === 'tsuki_package.json' || n.name === 'goduino.json')
    if (!manifestNode) return
    const tabContent = openTabs.find(t => t.fileId === manifestNode.id)?.content ?? manifestNode.content
    if (!tabContent) return
    try {
      const mf = JSON.parse(tabContent)
      if (Array.isArray(mf.packages)) syncInstalledPackages(mf.packages)
    } catch { /* invalid JSON while typing */ }
  }, [openTabs, tree, syncInstalledPackages])

  // Load registry on first mount
  useEffect(() => {
    if (packagesLoaded) return
    const url = settings.registryUrl?.trim()
    if (!url) return
    loadRegistry(url, packages, false, settings.registryUrls ?? []).then(entries => {
      setPackages(entries)
      setLoadError(false)
    }).catch(() => setLoadError(true))
  }, [settings.registryUrl]) // eslint-disable-line

  // ── Download C++ lib to disk: tsuki pkg install <n> ───────────────────────
  function handleDownload(name: string) {
    const args = ['pkg', 'install', name]
    const cmd  = `${tsuki} ${args.join(' ')}`
    patchOp(name, { downloading: true, progress: 0, error: undefined, done: false })
    setBottomTab('terminal')
    addLog('info', `[pkg] Downloading: ${cmd}`)
    let pct = 0
    const ticker = setInterval(() => {
      pct = Math.min(pct + Math.random() * 20, 90)
      patchOp(name, { progress: pct })
    }, 280)
    dispatchCommand(tsuki, args, cwd)
    setTimeout(() => {
      clearInterval(ticker)
      patchOp(name, { downloading: false, progress: 100 })
      addLog('ok', `[pkg] Library "${name}" downloaded`)
      flashDone(name)
    }, 2500)
  }

  // ── Add to tsuki_package.json: tsuki deps add <n> ─────────────────────────
  async function handleAdd(name: string) {
    const args = ['pkg', 'add', name]
    const cmd  = `${tsuki} ${args.join(' ')}`
    patchOp(name, { adding: true, error: undefined })
    setBottomTab('terminal')
    addLog('info', `[pkg] Adding to project: ${cmd}`)
    setPackageInstalling(name, true)
    dispatchCommand(tsuki, args, cwd)
    await new Promise(r => setTimeout(r, 900))
    setPackageInstalling(name, false)
    togglePackage(name)
    patchOp(name, { adding: false })
    addLog('ok', `[pkg] "${name}" added to project dependencies`)
    flashDone(name)
  }

  // ── Remove from manifest: tsuki deps remove <n> ───────────────────────────
  async function handleRemove(name: string) {
    const args = ['pkg', 'remove', '--manifest', name]
    const cmd  = `${tsuki} ${args.join(' ')}`
    patchOp(name, { removing: true, error: undefined })
    setBottomTab('terminal')
    addLog('info', `[pkg] Removing from project: ${cmd}`)
    setPackageInstalling(name, true)
    dispatchCommand(tsuki, args, cwd)
    await new Promise(r => setTimeout(r, 900))
    setPackageInstalling(name, false)
    togglePackage(name)
    patchOp(name, { removing: false })
    addLog('ok', `[pkg] "${name}" removed from project dependencies`)
    flashDone(name)
  }

  async function handleRefresh() {
    const url = settings.registryUrl?.trim()
    if (!url) return
    setRefreshing(true)
    setLoadError(false)
    const { loadRegistry: lr, invalidateRegistryCache } = await import('@/lib/packageRegistry')
    invalidateRegistryCache()
    lr(url, packages, true, settings.registryUrls ?? [])
      .then(entries => {
        setPackages(entries)
        addLog('info', `[pkg] Registry refreshed — ${entries.length} packages`)
      })
      .catch(() => setLoadError(true))
      .finally(() => setRefreshing(false))
  }

  const filtered  = packages.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    (p.desc ?? '').toLowerCase().includes(query.toLowerCase())
  )
  const installed = filtered.filter(p =>  p.installed)
  const available = filtered.filter(p => !p.installed)

  return (
    <div className="flex flex-col h-full text-[var(--fg)] text-xs">

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] flex-shrink-0">
        <span className="font-semibold text-[10px] uppercase tracking-widest text-[var(--fg-faint)]">
          Packages
        </span>
        <div className="flex items-center gap-0.5">
          <button
            title="Open registry in browser"
            onClick={() => {
              const url = settings.registryUrl?.trim()
              if (url) try { (window as any).__TAURI__?.shell?.open(url) } catch {}
            }}
            className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] cursor-pointer border-0 bg-transparent transition-colors"
          >
            <ExternalLink size={10} />
          </button>
          <button
            title="Refresh registry"
            onClick={handleRefresh}
            disabled={refreshing}
            className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] cursor-pointer border-0 bg-transparent transition-colors disabled:cursor-not-allowed"
          >
            <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 flex-shrink-0">
        <div className="flex items-center gap-1.5 bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1">
          <Search size={10} className="text-[var(--fg-faint)] flex-shrink-0" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter packages…"
            className="flex-1 bg-transparent outline-none text-xs text-[var(--fg)] placeholder:text-[var(--fg-faint)] border-0"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer leading-none p-0"
            >×</button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">

        {!packagesLoaded && !loadError && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-[var(--fg-faint)]">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-xs">Loading registry…</span>
            <ProgressBar value={30} className="w-20 mx-auto" />
          </div>
        )}

        {loadError && (
          <div className="flex flex-col items-center justify-center gap-2 py-6 px-3 text-center">
            <AlertCircle size={18} className="text-[var(--err)]" />
            <span className="text-[11px] text-[var(--err)]">Failed to load registry</span>
            <span className="text-[10px] text-[var(--fg-faint)]">Check registry URL in Settings → CLI</span>
            <button
              onClick={handleRefresh}
              className="mt-1 text-[10px] text-[var(--fg-faint)] hover:text-[var(--fg)] border border-[var(--border)] rounded px-2 py-0.5 bg-transparent cursor-pointer transition-colors"
            >Retry</button>
          </div>
        )}

        {installed.length > 0 && (
          <>
            <SectionLabel label={`In project (${installed.length})`} />
            {installed.map(pkg => (
              <PkgRow
                key={pkg.name} pkg={pkg} op={opState[pkg.name] ?? {}}
                onDownload={() => handleDownload(pkg.name)}
                onAdd={() => handleAdd(pkg.name)}
                onRemove={() => handleRemove(pkg.name)}
              />
            ))}
          </>
        )}

        {available.length > 0 && (
          <>
            <SectionLabel label={`Available (${available.length})`} />
            {available.map(pkg => (
              <PkgRow
                key={pkg.name} pkg={pkg} op={opState[pkg.name] ?? {}}
                onDownload={() => handleDownload(pkg.name)}
                onAdd={() => handleAdd(pkg.name)}
                onRemove={() => handleRemove(pkg.name)}
              />
            ))}
          </>
        )}

        {packagesLoaded && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--fg-faint)]">
            <Package size={20} />
            <span className="text-xs">No packages found</span>
          </div>
        )}
      </div>

      {/* Footer legend */}
      <div className="px-3 py-2 border-t border-[var(--border)] flex-shrink-0 space-y-0.5">
        <div className="flex items-center gap-1.5 text-[9px] text-[var(--fg-faint)] font-mono">
          <Download size={8} />
          <span>download C++ lib to disk</span>
        </div>
        <div className="flex items-center gap-1.5 text-[9px] text-[var(--fg-faint)] font-mono">
          <Plus size={8} />
          <span>add to project deps</span>
        </div>
      </div>

    </div>
  )
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-3 py-1 mt-1.5">
      <span className="text-[10px] font-semibold text-[var(--fg-faint)] uppercase tracking-widest">
        {label}
      </span>
    </div>
  )
}

// ── Package row ───────────────────────────────────────────────────────────────

function PkgRow({
  pkg, op, onDownload, onAdd, onRemove,
}: {
  pkg:        import('@/lib/store').PackageEntry
  op:         PkgOpState
  onDownload: () => void
  onAdd:      () => void
  onRemove:   () => void
}) {
  const busy = !!(op.downloading || op.adding || op.removing)

  return (
    <div className={clsx(
      'flex flex-col px-3 py-1.5 transition-colors cursor-default',
      busy ? 'bg-[var(--surface-1)]' : 'hover:bg-[var(--hover)]',
    )}>
      <div className="flex items-center gap-2">
        {/* Status dot */}
        <div className={clsx(
          'w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors mt-0.5',
          op.done         ? 'bg-green-400'
          : pkg.installed ? 'bg-[var(--ok)]'
          :                 'bg-[var(--border)]'
        )} />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-semibold text-[var(--fg)] truncate">{pkg.name}</span>
            <span className="text-[10px] text-[var(--fg-faint)] font-mono flex-shrink-0">{pkg.version}</span>
          </div>
          {pkg.desc && (
            <div className="text-[var(--fg-muted)] text-[10px] leading-tight mt-0.5 truncate">{pkg.desc}</div>
          )}
        </div>

        {/* Action buttons — always visible */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {op.done ? (
            <CheckCircle2 size={13} className="text-green-400" />
          ) : pkg.installed ? (
            <button
              onClick={onRemove}
              disabled={busy}
              title="Remove from project (tsuki deps remove)"
              className={clsx(
                'w-5 h-5 flex items-center justify-center rounded cursor-pointer border-0 transition-colors',
                busy ? 'text-[var(--fg-faint)] cursor-not-allowed'
                     : 'text-[var(--err)] hover:bg-[var(--hover)]'
              )}
            >
              {op.removing ? <Loader2 size={10} className="animate-spin" /> : <Minus size={10} />}
            </button>
          ) : (
            <>
              <button
                onClick={onDownload}
                disabled={busy}
                title="Download C++ library to disk (tsuki pkg install)"
                className={clsx(
                  'w-5 h-5 flex items-center justify-center rounded cursor-pointer border-0 transition-colors',
                  busy ? 'text-[var(--fg-faint)] cursor-not-allowed'
                       : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
                )}
              >
                {op.downloading ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
              </button>
              <button
                onClick={onAdd}
                disabled={busy}
                title="Add to project manifest (tsuki pkg add)"
                className={clsx(
                  'w-5 h-5 flex items-center justify-center rounded cursor-pointer border-0 transition-colors',
                  busy ? 'text-[var(--fg-faint)] cursor-not-allowed'
                       : 'text-[var(--ok)] hover:bg-[var(--hover)]'
                )}
              >
                {op.adding ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Download progress bar */}
      {op.downloading && (
        <div className="mt-1.5 pl-3.5">
          <ProgressBar value={op.progress ?? 0} />
          <span className="text-[9px] text-[var(--fg-faint)] mt-0.5 block">
            Downloading… {op.progress != null ? `${Math.round(op.progress)}%` : ''}
          </span>
        </div>
      )}

      {/* Add/remove indeterminate bar */}
      {(op.adding || op.removing) && (
        <div className="mt-1.5 pl-3.5">
          <IndeterminateBar />
          <span className="text-[9px] text-[var(--fg-faint)] mt-0.5 block">
            {op.adding ? 'Adding to project…' : 'Removing…'}
          </span>
        </div>
      )}

      {op.error && (
        <div className="mt-1 flex items-center gap-1 text-[9px] text-[var(--err)] pl-3.5">
          <AlertCircle size={9} /> {op.error}
        </div>
      )}
    </div>
  )
}