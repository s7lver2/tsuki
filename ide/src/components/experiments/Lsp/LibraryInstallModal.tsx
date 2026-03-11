'use client'
import { useState } from 'react'
import { Package, X, Download, ArrowRight, EyeOff, Terminal, Check, Loader } from 'lucide-react'
import { Btn } from '@/components/shared/primitives'
import { clsx } from 'clsx'
import type { LibraryInfo } from '@/components/experiments/Lsp/LspEngine'

export interface LibraryInstallModalProps {
  libs: Array<LibraryInfo & { importName: string }>
  onInstall:  (lib: LibraryInfo & { importName: string }) => Promise<void>
  onIgnore:   (importName: string) => void
  onNeverAsk: (importName: string) => void
  onClose:    () => void
  tsukiPath?: string
}

export default function LibraryInstallModal({
  libs, onInstall, onIgnore, onNeverAsk, onClose, tsukiPath = 'tsuki',
}: LibraryInstallModalProps) {
  const [activeIdx, setActiveIdx]     = useState(0)
  const [installing, setInstalling]   = useState<string | null>(null)
  const [installed, setInstalled]     = useState<Set<string>>(new Set())

  const lib = libs[activeIdx]
  if (!lib) return null

  const tsuki      = (tsukiPath || 'tsuki').replace(/^"|"$/g, '')
  const tsukiDisplay = tsuki.split(/[/\\]/).pop() || 'tsuki'
  const isDone     = installed.has(lib.importName)
  const isWorking  = installing === lib.importName

  async function handleInstall() {
    setInstalling(lib.importName)
    try { await onInstall(lib) } catch { /* handled upstream */ }
    setInstalled(p => new Set(p).add(lib.importName))
    setInstalling(null)
    if (activeIdx < libs.length - 1)
      setTimeout(() => setActiveIdx(i => i + 1), 600)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end p-4"
      style={{ pointerEvents: 'none' }}
    >
      {/* Card — bottom-right, non-blocking */}
      <div
        className="w-[400px] rounded-xl border border-[var(--border)] bg-[var(--surface-1)] shadow-2xl overflow-hidden"
        style={{
          pointerEvents: 'all',
          boxShadow: '0 16px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(59,130,246,0.15)',
          animation: 'slideUp 0.18s ease-out',
        }}
      >
        <style>{`@keyframes slideUp { from { transform: translateY(12px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>

        {/* Accent strip */}
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)' }} />

        {/* Header */}
        <div className="flex items-start gap-2.5 px-4 pt-3.5 pb-3 border-b border-[var(--border)]">
          <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ background: 'color-mix(in srgb, #3b82f6 12%, transparent)' }}>
            <Package size={14} className="text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[var(--fg)]">
              {libs.length > 1 ? `${libs.length} librerías no instaladas` : 'Librería no instalada'}
            </p>
            <p className="text-[11px] text-[var(--fg-muted)] mt-0.5 leading-tight">
              {lib.displayName}
              {lib.version && <span className="text-[var(--fg-faint)] ml-1">v{lib.version}</span>}
              {' '}— {lib.description}
            </p>
          </div>
          <button onClick={onClose}
            className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer border-0 bg-transparent flex-shrink-0">
            <X size={11} />
          </button>
        </div>

        {/* Lib tabs when multiple */}
        {libs.length > 1 && (
          <div className="flex gap-0.5 px-4 pt-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {libs.map((l, i) => (
              <button key={l.importName} onClick={() => setActiveIdx(i)}
                className={clsx(
                  'flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono transition-colors cursor-pointer border-0 flex-shrink-0',
                  activeIdx === i ? 'bg-[var(--active)] text-[var(--fg)]' : 'bg-transparent text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
                )}>
                {installed.has(l.importName) && <Check size={8} className="text-green-400" />}
                {l.importName}
              </button>
            ))}
          </div>
        )}

        {/* Command */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] font-mono text-xs">
            <Terminal size={10} className="text-[var(--fg-faint)] flex-shrink-0" />
            <span className="text-[var(--fg-faint)]">$</span>
            <span className="text-blue-400">{tsukiDisplay}</span>
            <span className="text-[var(--fg-muted)]">pkg add</span>
            <span className="text-[var(--fg)]">{lib.packageId}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between px-4 pb-3.5 gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => { onIgnore(lib.importName); libs.length <= 1 && onClose() }}
              className="text-[11px] text-[var(--fg-faint)] hover:text-[var(--fg-muted)] transition-colors cursor-pointer border-0 bg-transparent">
              Ignorar
            </button>
            <button
              onClick={() => {
                onNeverAsk(lib.importName)
                if (libs.length <= 1) onClose()
                else if (activeIdx < libs.length - 1) setActiveIdx(i => i + 1)
                else onClose()
              }}
              className="flex items-center gap-1 text-[11px] text-[var(--fg-faint)] hover:text-[var(--fg-muted)] transition-colors cursor-pointer border-0 bg-transparent">
              <EyeOff size={10} /> No preguntar más
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {libs.length > 1 && activeIdx < libs.length - 1 && !isDone && (
              <Btn variant="ghost" size="xs" onClick={() => setActiveIdx(i => i + 1)}>
                Sig. <ArrowRight size={10} />
              </Btn>
            )}
            <button onClick={handleInstall} disabled={isWorking || isDone}
              className={clsx(
                'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-all cursor-pointer border-0',
                isDone ? 'bg-green-500/15 text-green-400 cursor-default' : 'bg-[var(--fg)] text-[var(--accent-inv)] hover:opacity-85',
                isWorking && 'opacity-60 cursor-wait',
              )}>
              {isDone ? <><Check size={11} /> Instalada</>
               : isWorking ? <><Loader size={11} className="animate-spin" /> Instalando…</>
               : <><Download size={11} /> Instalar</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}