'use client'
import { useStore } from '@/lib/store'
import { useState, useEffect } from 'react'
import { loadRegistry } from '@/lib/packageRegistry'
import {
  Package, RefreshCw, Plus, Minus, Search,
  ExternalLink,
} from 'lucide-react'
import { clsx } from 'clsx'
import ExeWarningModal from '@/components/other/ExeWarningModal'

export default function PackagesSidebar() {
  const {
    packages, togglePackage, setPackageInstalling,
    addLog, settings, projectPath,
    dispatchCommand, setBottomTab,
    setPackages, packagesLoaded,
    syncInstalledPackages, openTabs, activeTabIdx, tree,
  } = useStore()
  const [query, setQuery] = useState('')

  const tsuki = (settings.tsukiPath?.trim() || 'tsuki').replace(/^"|"$/g, '')
  const cwd   = projectPath || undefined

  const [exeWarning, setExeWarning] = useState<{ command: string; action: () => void } | null>(null)
  const [loadError, setLoadError]   = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // ── Sync installed state from tsuki_package.json whenever the editor changes it ──
  useEffect(() => {
    // Find the manifest node in the tree and read its content
    const manifestNode = tree.find(n => n.name === 'tsuki_package.json' || n.name === 'goduino.json')
    if (!manifestNode) return
    // Prefer the open tab content (live edits), fall back to tree node content
    const tabContent = openTabs.find(t => t.fileId === manifestNode.id)?.content ?? manifestNode.content
    if (!tabContent) return
    try {
      const mf = JSON.parse(tabContent)
      if (Array.isArray(mf.packages)) syncInstalledPackages(mf.packages)
    } catch { /* invalid JSON while typing */ }
  }, [openTabs, tree, syncInstalledPackages])

  // Load package list from registry on first mount (or when URL changes)
  useEffect(() => {
    if (packagesLoaded) return
    const url = settings.registryUrl?.trim()
    if (!url) return
    loadRegistry(url, packages).then(entries => {
      setPackages(entries)
      setLoadError(false)
    }).catch(() => setLoadError(true))
  }, [settings.registryUrl]) // eslint-disable-line


  function guardExe(command: string, action: () => void) {
    if (tsuki.toLowerCase().endsWith('.exe')) setExeWarning({ command, action })
    else action()
  }

  const filtered = packages.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    p.desc.toLowerCase().includes(query.toLowerCase())
  )

  const installed = filtered.filter(p => p.installed)
  const available = filtered.filter(p => !p.installed)

  async function handleToggle(name: string, currentlyInstalled: boolean) {
    const args = currentlyInstalled ? ['deps', 'remove', name] : ['deps', 'add', name]
    const cmd = `${tsuki} ${args.join(' ')}`
    guardExe(cmd, async () => {
      setPackageInstalling(name, true)
      setBottomTab('terminal')
      addLog('info', `> ${cmd}`)
      dispatchCommand(tsuki, args, cwd)
      await new Promise(r => setTimeout(r, 800))
      setPackageInstalling(name, false)
      togglePackage(name)
    })
  }

  async function handleInstallDef(name: string) {
    const args = ['pkg', 'install', name]
    const cmd = `${tsuki} ${args.join(' ')}`
    guardExe(cmd, () => {
      setBottomTab('terminal')
      addLog('info', `> ${cmd}`)
      dispatchCommand(tsuki, args, cwd)
    })
  }

  async function handleRefresh() {
    const url = settings.registryUrl?.trim()
    if (url) {
      setRefreshing(true)
      setLoadError(false)
      import('@/lib/packageRegistry').then(({ loadRegistry, invalidateRegistryCache }) => {
        invalidateRegistryCache()
        loadRegistry(url, packages, true).then(entries => {
          setPackages(entries)
        }).catch(() => setLoadError(true)).finally(() => setRefreshing(false))
      })
    }
    // Also run CLI list for terminal feedback
    const args = ['pkg', 'list']
    const cmd = `${tsuki} ${args.join(' ')}`
    guardExe(cmd, () => {
      setBottomTab('terminal')
      addLog('info', `> ${cmd}`)
      dispatchCommand(tsuki, args, cwd)
    })
  }

  async function handleSearch() {
    const args = ['pkg', 'search']
    const cmd = `${tsuki} ${args.join(' ')}`
    guardExe(cmd, () => {
      setBottomTab('terminal')
      addLog('info', `> ${cmd}`)
      dispatchCommand(tsuki, args, cwd)
    })
  }

  return (
    <div className="flex flex-col h-full text-[var(--fg)] text-xs">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] flex-shrink-0">
        <span className="font-semibold text-[10px] uppercase tracking-widest text-[var(--fg-faint)]">
          Packages
        </span>
        <div className="flex items-center gap-0.5">
          <button
            title={`${tsuki} pkg search`}
            onClick={handleSearch}
            className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] cursor-pointer border-0 bg-transparent transition-colors"
          >
            <ExternalLink size={10} />
          </button>
          <button
            title={`${tsuki} pkg list`}
            onClick={handleRefresh}
            className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] cursor-pointer border-0 bg-transparent transition-colors"
          >
            <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="px-2 py-1.5 flex-shrink-0">
        <div className="flex items-center gap-1.5 bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1">
          <Search size={10} className="text-[var(--fg-faint)] flex-shrink-0" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter packages…"
            className="flex-1 bg-transparent outline-none text-xs text-[var(--fg)] placeholder:text-[var(--fg-faint)] border-0"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {installed.length > 0 && (
          <>
            <SectionLabel label={`In project (${installed.length})`} />
            {installed.map(pkg => (
              <PkgRow key={pkg.name} pkg={pkg} tsuki={tsuki} onToggle={handleToggle} onInstallDef={handleInstallDef} />
            ))}
          </>
        )}

        {available.length > 0 && (
          <>
            <SectionLabel label={`Available (${available.length})`} />
            {available.map(pkg => (
              <PkgRow key={pkg.name} pkg={pkg} tsuki={tsuki} onToggle={handleToggle} onInstallDef={handleInstallDef} />
            ))}
          </>
        )}

        {!packagesLoaded && !loadError && (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--fg-faint)]">
            <RefreshCw size={16} className="animate-spin" />
            <span className="text-xs">Loading registry…</span>
          </div>
        )}
        {loadError && (
          <div className="flex flex-col items-center justify-center gap-2 py-6 px-3 text-center">
            <span className="text-[11px] text-[var(--err)]">Failed to load registry</span>
            <span className="text-[10px] text-[var(--fg-faint)]">Check your registry URL in settings</span>
          </div>
        )}
        {packagesLoaded && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--fg-faint)]">
            <Package size={20} />
            <span className="text-xs">No packages found</span>
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-[var(--border)] flex-shrink-0">
        <span className="text-[10px] text-[var(--fg-faint)] font-mono">
          {tsuki} pkg install &lt;name&gt;
        </span>
      </div>

      {exeWarning && (
        <ExeWarningModal
          command={exeWarning.command}
          onCancel={() => setExeWarning(null)}
          onTryAnyway={() => { const a = exeWarning.action; setExeWarning(null); a() }}
        />
      )}
    </div>
  )
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-3 py-1 mt-1.5">
      <span className="text-[10px] font-semibold text-[var(--fg-faint)] uppercase tracking-widest">
        {label}
      </span>
    </div>
  )
}

function PkgRow({
  pkg, tsuki, onToggle, onInstallDef,
}: {
  pkg: import('@/lib/store').PackageEntry
  tsuki: string
  onToggle: (name: string, installed: boolean) => void
  onInstallDef: (name: string) => void
}) {
  const depsCmd    = pkg.installed ? `${tsuki} deps remove ${pkg.name}` : `${tsuki} deps add ${pkg.name}`
  const installCmd = `${tsuki} pkg install ${pkg.name}`

  return (
    <div
      className="group flex items-start gap-2 px-3 py-1.5 hover:bg-[var(--hover)] transition-colors cursor-default"
      title={depsCmd}
    >
      <div className={clsx(
        'w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0',
        pkg.installed ? 'bg-[var(--ok)]' : 'bg-[var(--border)]'
      )} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-semibold text-[var(--fg)] truncate">{pkg.name}</span>
          <span className="text-[10px] text-[var(--fg-faint)] font-mono flex-shrink-0">{pkg.version}</span>
        </div>
        <div className="text-[var(--fg-muted)] text-[10px] leading-tight mt-0.5 truncate">{pkg.desc}</div>
        <div className="hidden group-hover:flex items-center gap-2 mt-1">
          <button
            onClick={() => onInstallDef(pkg.name)}
            title={installCmd}
            className="text-[9px] text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer p-0 transition-colors"
          >
            ↓ pkg install
          </button>
        </div>
      </div>

      <button
        onClick={() => !pkg.installing && onToggle(pkg.name, pkg.installed)}
        disabled={pkg.installing}
        title={depsCmd}
        className={clsx(
          'w-5 h-5 flex items-center justify-center rounded cursor-pointer border-0 transition-colors flex-shrink-0',
          'opacity-0 group-hover:opacity-100',
          pkg.installed
            ? 'text-[var(--err)] hover:bg-[var(--hover)]'
            : 'text-[var(--ok)] hover:bg-[var(--hover)]'
        )}
      >
        {pkg.installing
          ? <RefreshCw size={10} className="animate-spin" />
          : pkg.installed ? <Minus size={10} /> : <Plus size={10} />
        }
      </button>
    </div>
  )
}