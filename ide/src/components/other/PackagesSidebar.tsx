'use client'
import { useStore } from '@/lib/store'
import { useState } from 'react'
import {
  Package, RefreshCw, Plus, Minus, Search,
  ExternalLink,
} from 'lucide-react'
import { clsx } from 'clsx'

export default function PackagesSidebar() {
  const {
    packages, togglePackage, setPackageInstalling,
    addLog, settings, projectPath,
    dispatchCommand, setBottomTab,
  } = useStore()
  const [query, setQuery] = useState('')

  const tsuki = (settings.tsukiPath?.trim() || 'tsuki').replace(/^"|"$/g, '')
  const cwd   = projectPath || undefined

  const filtered = packages.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    p.desc.toLowerCase().includes(query.toLowerCase())
  )

  const installed = filtered.filter(p => p.installed)
  const available = filtered.filter(p => !p.installed)

  async function handleToggle(name: string, currentlyInstalled: boolean) {
    setPackageInstalling(name, true)
    setBottomTab('terminal')

    const args = currentlyInstalled
      ? ['deps', 'remove', name]
      : ['deps', 'add', name]

    addLog('info', `> ${tsuki} ${args.join(' ')}`)
    dispatchCommand(tsuki, args, cwd)

    await new Promise(r => setTimeout(r, 800))
    setPackageInstalling(name, false)
    togglePackage(name)
  }

  async function handleInstallDef(name: string) {
    setBottomTab('terminal')
    addLog('info', `> ${tsuki} pkg install ${name}`)
    dispatchCommand(tsuki, ['pkg', 'install', name], cwd)
  }

  async function handleRefresh() {
    setBottomTab('terminal')
    addLog('info', `> ${tsuki} pkg list`)
    dispatchCommand(tsuki, ['pkg', 'list'], cwd)
  }

  async function handleSearch() {
    setBottomTab('terminal')
    addLog('info', `> ${tsuki} pkg search`)
    dispatchCommand(tsuki, ['pkg', 'search'], cwd)
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
            <RefreshCw size={11} />
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

        {filtered.length === 0 && (
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