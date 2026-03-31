'use client'
/**
 * TitleBar — custom window titlebar integrado con la UI de tsuki.
 *
 * Reemplaza el borde nativo de Windows/macOS con uno que comparte
 * los CSS-variables del tema activo.  Incluye:
 *   - Área de arrastre (data-tauri-drag-region)
 *   - Botones Minimize / Maximize / Close al estilo Windows
 *   - Reflejo del título de la ventana o del proyecto activo
 *
 * Uso: montar como primer hijo del root layout, con tauri.conf.json
 * configurado con `"decorations": false`.
 */

import { useEffect, useState } from 'react'
import TsukiLogo from './TsukiLogo'

// ── Tauri window API (lazy import para que Next.js no explote en SSR) ─────────
async function tauriWindow() {
  const { appWindow } = await import('@tauri-apps/api/window')
  return appWindow
}

export default function TitleBar({ title }: { title?: string }) {
  const [maximized, setMaximized] = useState(false)

  // Sincronizar estado maximizado con la ventana real
  useEffect(() => {
    let unlisten: (() => void) | null = null

    tauriWindow().then(async (win) => {
      setMaximized(await win.isMaximized())

      unlisten = await win.onResized(async () => {
        setMaximized(await win.isMaximized())
      })
    }).catch(() => {/* web/dev mode — no-op */})

    return () => { unlisten?.() }
  }, [])

  async function minimize() {
    const win = await tauriWindow().catch(() => null)
    win?.minimize()
  }

  async function toggleMaximize() {
    const win = await tauriWindow().catch(() => null)
    if (!win) return
    maximized ? await win.unmaximize() : await win.maximize()
  }

  async function close() {
    const win = await tauriWindow().catch(() => null)
    win?.close()
  }

  return (
    <div
      className="titlebar flex items-center h-8 select-none flex-shrink-0
                 bg-[var(--surface-1)] border-b border-[var(--border)]"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Logo + título — drag region */}
      <div
        className="flex items-center gap-2 px-3 flex-1 min-w-0 h-full"
        data-tauri-drag-region
      >
        <TsukiLogo size="xs" />
        <span className="text-[11px] font-semibold text-[var(--fg-muted)] tracking-tight truncate leading-none">
          {title ?? 'Tsuki IDE'}
        </span>
      </div>

      {/* Controles de ventana — NO drag region */}
      <div
        className="flex items-stretch h-full flex-shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Minimize */}
        <WinBtn onClick={minimize} label="Minimizar" type="normal">
          <svg width="10" height="1" viewBox="0 0 10 1" fill="none">
            <rect width="10" height="1" fill="currentColor" />
          </svg>
        </WinBtn>

        {/* Maximize / Restore */}
        <WinBtn onClick={toggleMaximize} label={maximized ? 'Restaurar' : 'Maximizar'} type="normal">
          {maximized ? (
            /* restore icon — two overlapping squares */
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect x="2" y="0" width="8" height="8" rx="0.5" stroke="currentColor" strokeWidth="1" fill="none" />
              <rect x="0" y="2" width="8" height="8" rx="0.5" stroke="currentColor" strokeWidth="1" fill="none" />
            </svg>
          ) : (
            /* maximize icon — single square */
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" stroke="currentColor" strokeWidth="1" fill="none" />
            </svg>
          )}
        </WinBtn>

        {/* Close */}
        <WinBtn onClick={close} label="Cerrar" type="close">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
            <line x1="10" y1="0" x2="0"  y2="10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </WinBtn>
      </div>
    </div>
  )
}

// ── WinBtn ─────────────────────────────────────────────────────────────────────

function WinBtn({
  onClick, label, type, children,
}: {
  onClick: () => void
  label: string
  type: 'normal' | 'close'
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={[
        'w-11 h-full flex items-center justify-center border-0 cursor-pointer transition-colors duration-100',
        type === 'close'
          ? 'text-[var(--fg-faint)] hover:bg-red-500 hover:text-white'
          : 'text-[var(--fg-faint)] hover:bg-[var(--hover)] hover:text-[var(--fg)]',
      ].join(' ')}
    >
      {children}
    </button>
  )
}