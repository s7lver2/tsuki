'use client'
import { useState } from 'react'
import { AlertTriangle, Copy, Check, Terminal, X, ChevronRight } from 'lucide-react'
import { Btn } from '@/components/shared/primitives'

interface Props {
  /** Full command string e.g. "tsuki.exe build --compile --board uno" */
  command: string
  onCancel: () => void
  onTryAnyway: () => void
}

export default function ExeWarningModal({ command, onCancel, onTryAnyway }: Props) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(command).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Split command into binary + args for syntax highlighting
  const parts = command.trim().split(/\s+/)
  const binary = parts[0]
  const args = parts.slice(1)

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      {/* Modal card */}
      <div
        className="relative w-[480px] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-2xl overflow-hidden"
        style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
      >
        {/* Amber accent strip */}
        <div className="h-[3px] w-full" style={{ background: 'linear-gradient(90deg, #f59e0b, #ef4444 80%)' }} />

        {/* Header */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-4">
          <div className="mt-0.5 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'color-mix(in srgb, #f59e0b 12%, transparent)' }}>
            <AlertTriangle size={16} className="text-yellow-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-[var(--fg)] leading-tight">
              No se puede ejecutar <code className="font-mono text-yellow-400">.exe</code> directamente
            </h3>
            <p className="mt-1.5 text-xs text-[var(--fg-muted)] leading-relaxed">
              We're Having some issues with the execution of <code className="font-mono text-[var(--fg)]">.exe</code> until we 
              fix it manual intervention is required. Please, copy the following command into tsuki terminal and run it:
            </p>
          </div>
          <button
            onClick={onCancel}
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer border-0 bg-transparent flex-shrink-0"
          >
            <X size={13} />
          </button>
        </div>

        {/* Command box */}
        <div className="mx-5 mb-5 rounded border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          {/* Titlebar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--surface-2)]">
            <Terminal size={11} className="text-[var(--fg-faint)]" />
            <span className="text-[10px] font-mono text-[var(--fg-faint)] uppercase tracking-widest">terminal</span>
            <div className="flex-1" />
            {/* Copy button */}
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-all cursor-pointer border-0"
              style={{
                background: copied
                  ? 'color-mix(in srgb, #4ade80 10%, transparent)'
                  : 'color-mix(in srgb, var(--fg) 6%, transparent)',
                color: copied ? '#4ade80' : 'var(--fg-muted)',
              }}
            >
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {copied ? 'copiado' : 'copiar'}
            </button>
          </div>

          {/* Command syntax */}
          <div className="px-4 py-3 font-mono text-sm leading-relaxed overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
            <span className="text-[var(--fg)] select-all">{binary}</span>
            {args.map((arg, i) => (
              <span key={i}>
                {' '}
                <span className={
                  arg.startsWith('--') ? 'text-blue-400'
                  : arg.startsWith('-') ? 'text-cyan-400'
                  : 'text-[var(--fg-muted)]'
                }>
                  {arg}
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 pb-5">
          <p className="text-[10px] text-[var(--fg-faint)] leading-tight flex-1">
            ¿No tienes el binario? Descárgalo en{' '}
            <a
              href="https://tsuki.dev"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--fg-muted)] underline underline-offset-2 hover:text-[var(--fg)] transition-colors"
            >
              tsuki.dev
            </a>
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Btn variant="ghost" size="sm" onClick={onCancel}>
              Cancelar
            </Btn>
            <button
              onClick={onTryAnyway}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-all cursor-pointer border border-[var(--border)] bg-transparent text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]"
            >
              Intentar de todos modos
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}