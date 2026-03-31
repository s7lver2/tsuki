'use client'
/**
 * AppChrome — barra unificada estilo DaVinci Resolve para tsuki IDE.
 *
 * Fusiona en una sola barra de 48px:
 *  · Drag region nativo de Tauri  (data-tauri-drag-region)
 *  · Logo + nombre del proyecto
 *  · Selector de board
 *  · Grupo de acciones: Check / Build / Flash / Monitor
 *  · Botón Run (acento)
 *  · Theme toggle + Settings + Home
 *  · Controles de ventana: Minimize / Maximize / Close
 *
 * Las pantallas que NO son el IDE (Welcome, Settings, Docs) usan
 * <MinimalChrome> — mismo drag region + controles, sin las acciones.
 */

import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import TsukiLogo from './TsukiLogo'

// ── Tauri API (lazy, SSR-safe) ────────────────────────────────────────────────
async function tauriWin() {
  try {
    const { appWindow } = await import('@tauri-apps/api/window')
    return appWindow
  } catch { return null }
}

// ── Hook: estado maximizado ────────────────────────────────────────────────────
function useMaximized() {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    let unlisten: (() => void) | null = null
    tauriWin().then(async win => {
      if (!win) return
      setMaximized(await win.isMaximized())
      unlisten = await win.onResized(async () => setMaximized(await win.isMaximized()))
    })
    return () => { unlisten?.() }
  }, [])
  return maximized
}

// ── Acciones de ventana ───────────────────────────────────────────────────────
async function winMinimize()       { (await tauriWin())?.minimize() }
async function winToggleMaximize(isMax: boolean) {
  const w = await tauriWin()
  if (!w) return
  isMax ? w.unmaximize() : w.maximize()
}
async function winClose()          { (await tauriWin())?.close() }

// ─────────────────────────────────────────────────────────────────────────────
//  AppChrome — versión completa para IdeScreen
// ─────────────────────────────────────────────────────────────────────────────

interface AppChromeProps {
  // Proyecto
  projectName:     string
  projectPath?:    string
  projectLanguage: string
  // Board
  board:        string
  boards:       string[]
  onBoardChange: (b: string) => void
  // Acciones
  onCheck?:   () => void
  onBuild:    () => void
  onFlash:    () => void
  onRun:      () => void
  onMonitor:  () => void
  // Utilidades
  theme:       string
  onTheme:     () => void
  onSettings:  () => void
  onHome:      () => void
  onNew:       () => void
  // Experimentales
  sandboxEnabled?:     boolean
  workstationsEnabled?: boolean
  sandboxOpen?:        boolean
  onSandboxToggle?:    () => void
}

export function AppChrome({
  projectName, projectPath, projectLanguage, board, boards,
  onBoardChange, onCheck, onBuild, onFlash, onRun, onMonitor,
  theme, onTheme, onSettings, onHome, onNew,
  sandboxEnabled, workstationsEnabled, sandboxOpen, onSandboxToggle,
}: AppChromeProps) {
  const maximized = useMaximized()

  return (
    <div
      className="chrome-bar h-11 flex items-stretch flex-shrink-0 select-none"
      style={{
        background: 'var(--chrome-bg, #0e0f10)',
        borderBottom: '1px solid var(--chrome-border, #1e2022)',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* ── LEFT: Logo + proyecto ──────────────────────────────── */}
      <div
        className="flex items-center gap-2.5 pl-3.5 pr-3"
        data-tauri-drag-region
        style={{ minWidth: 0, flex: '0 0 auto' }}
      >
        <TsukiLogo size="xs" />

        <div className="min-w-0 leading-none" data-tauri-drag-region>
          <div className="text-[11px] font-semibold truncate"
            style={{ color: 'var(--chrome-fg, #c8ccd0)', letterSpacing: '-0.01em' }}>
            {projectName || 'Tsuki IDE'}
          </div>
          {projectPath && (
            <div className="text-[9px] font-mono mt-[3px] truncate"
              style={{ color: 'var(--chrome-fg-muted, #6b6f72)', maxWidth: 180 }}>
              {projectPath}
            </div>
          )}
        </div>
      </div>

      <ChromeSep />

      {/* Board selector */}
      <div className="flex items-center px-2.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <select
          value={board}
          onChange={e => onBoardChange(e.target.value)}
          className="text-[10px] font-mono px-2 h-[26px] rounded-md cursor-pointer outline-none appearance-none transition-colors"
          style={{
            background: 'var(--chrome-input, #181a1b)',
            border: '1px solid var(--chrome-sep, #242628)',
            color: 'var(--chrome-fg-muted, #7a7f84)',
            letterSpacing: '0.01em',
          }}
        >
          {boards.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      <ChromeSep />

      {/* ── CENTER: Acción buttons ─────────────────────────────── */}
      <div
        className="flex items-center gap-1.5 px-2.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Action group pill */}
        <div className="flex items-center h-[26px] rounded-md overflow-hidden"
          style={{ background: 'var(--chrome-group, #141618)', border: '1px solid var(--chrome-sep, #242628)' }}>

          {/* Check (solo Go) */}
          {projectLanguage === 'go' && onCheck && (
            <>
              <ActionBtn
                onClick={onCheck}
                label="Check"
                shortcut="Ctrl+Shift+T"
                iconColor="#5a9a5a"
              >
                <CheckIcon />
              </ActionBtn>
              <ActionSep />
            </>
          )}

          {/* Build */}
          <ActionBtn onClick={onBuild} label="Build" shortcut="Ctrl+Shift+B" iconColor="#a0a6ac">
            <ZapIcon />
          </ActionBtn>

          <ActionSep />

          {/* Flash */}
          <ActionBtn onClick={onFlash} label="Flash" shortcut="Ctrl+Shift+U" iconColor="#4e80a0">
            <UploadIcon />
          </ActionBtn>

          <ActionSep />

          {/* Monitor */}
          <ActionBtn onClick={onMonitor} label="Monitor" shortcut="Ctrl+M" iconColor="#a0a6ac">
            <TerminalIcon />
          </ActionBtn>
        </div>

        {/* RUN — standalone accent */}
        <button
          onClick={onRun}
          title="Run — build + flash (Ctrl+B)"
          className="h-[26px] px-3.5 rounded-md flex items-center gap-1.5 text-[10px] font-bold cursor-pointer border-0 transition-opacity hover:opacity-80 tracking-wide"
          style={{ background: '#00b87a', color: '#001a10', letterSpacing: '0.05em' }}
          type="button"
        >
          <PlayIcon />
        </button>
      </div>

      {/* Spacer (drag region) */}
      <div className="flex-1" data-tauri-drag-region />

      {/* ── RIGHT: Utilidades ─────────────────────────────────── */}
      <div
        className="flex items-center gap-0 px-1.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <IconBtn onClick={onTheme} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </IconBtn>
        <IconBtn onClick={onNew} title="New project">
          <PlusIcon />
        </IconBtn>
        <IconBtn onClick={onSettings} title="Settings">
          <GearIcon />
        </IconBtn>
        <IconBtn onClick={onHome} title="Welcome screen">
          <HomeIcon />
        </IconBtn>
      </div>

      <ChromeSep />

      {/* ── Window controls ───────────────────────────────────── */}
      <div
        className="flex items-stretch"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <WinCtrl onClick={winMinimize} title="Minimize">
          <MinimizeIcon />
        </WinCtrl>
        <WinCtrl onClick={() => winToggleMaximize(maximized)} title={maximized ? 'Restore' : 'Maximize'}>
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </WinCtrl>
        <WinCtrl onClick={winClose} title="Close" isClose>
          <CloseIcon />
        </WinCtrl>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  MinimalChrome — para Welcome / Settings / Docs
// ─────────────────────────────────────────────────────────────────────────────

interface MinimalChromeProps {
  title?:    string
  children?: React.ReactNode   // botones extra (theme toggle, back, etc.)
}

export function MinimalChrome({ title, children }: MinimalChromeProps) {
  const maximized = useMaximized()

  return (
    <div
      className="chrome-bar h-10 flex items-stretch flex-shrink-0 select-none"
      style={{
        background: 'var(--chrome-bg, #0e0f10)',
        borderBottom: '1px solid var(--chrome-border, #1e2022)',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* Logo + title */}
      <div className="flex items-center gap-2 pl-3 flex-1 min-w-0" data-tauri-drag-region>
        <TsukiLogo size="xs" />
        {title && (
          <span className="text-[11px] font-semibold truncate"
            style={{ color: 'var(--chrome-fg-muted, #6b6f72)' }}>
            {title}
          </span>
        )}
      </div>

      {/* Slot: botones extra */}
      {children && (
        <div
          className="flex items-center gap-0.5 px-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {children}
        </div>
      )}

      <ChromeSep />

      {/* Window controls */}
      <div className="flex items-stretch" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <WinCtrl onClick={winMinimize} title="Minimize"><MinimizeIcon /></WinCtrl>
        <WinCtrl onClick={() => winToggleMaximize(maximized)} title={maximized ? 'Restore' : 'Maximize'}>
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </WinCtrl>
        <WinCtrl onClick={winClose} title="Close" isClose><CloseIcon /></WinCtrl>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ChromeSep() {
  return (
    <div className="w-px self-stretch mx-0.5 flex-shrink-0"
      style={{ background: 'var(--chrome-sep, #252729)' }} />
  )
}

function ActionSep() {
  return (
    <div className="w-px self-stretch flex-shrink-0"
      style={{ background: 'var(--chrome-sep, #242628)', margin: '4px 0' }} />
  )
}

function ActionBtn({ onClick, label, shortcut, iconColor, children }: {
  onClick: () => void
  label: string
  shortcut?: string
  iconColor?: string
  children: React.ReactNode
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      title={shortcut ? `${label} (${shortcut})` : label}
      type="button"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="flex items-center gap-[5px] px-3 h-full cursor-pointer border-0 transition-colors"
      style={{
        background: hover ? 'rgba(255,255,255,0.06)' : 'transparent',
        color: hover ? (iconColor || '#a0a6ac') : '#585e64',
      }}
    >
      <span style={{ lineHeight: 1, display: 'flex', alignItems: 'center' }}>{children}</span>
      <span style={{ fontSize: 10, letterSpacing: '0.04em', fontWeight: 500, color: 'inherit' }}>
        {label.toLowerCase()}
      </span>
    </button>
  )
}

function IconBtn({ onClick, title, children }: {
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      type="button"
      className="w-7 h-7 flex items-center justify-center rounded-md cursor-pointer border-0 transition-colors hover:bg-white/[0.06]"
      style={{ color: '#585d62', background: 'transparent' }}
    >
      {children}
    </button>
  )
}

function WinCtrl({ onClick, title, isClose, children }: {
  onClick: () => void
  title: string
  isClose?: boolean
  children: React.ReactNode
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      title={title}
      type="button"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="w-11 flex items-center justify-center cursor-pointer border-0 transition-colors"
      style={{
        background: isClose && hover ? '#c0392b' : hover ? 'rgba(255,255,255,0.08)' : 'transparent',
        color: isClose
          ? (hover ? '#fff' : '#6b3b3b')
          : (hover ? '#c8ccd0' : '#5a5e62'),
      }}
    >
      {children}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Inline SVG icons (12×12)
// ─────────────────────────────────────────────────────────────────────────────

const s = { width: 12, height: 12 } as const

function CheckIcon()    { return <svg {...s} viewBox="0 0 12 12" fill="none"><polyline points="1,6 4.5,10 11,2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> }
function ZapIcon()      { return <svg {...s} viewBox="0 0 12 12" fill="none"><polygon points="7,1 2,7 6,7 5,11 10,5 6,5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round"/></svg> }
function UploadIcon()   { return <svg {...s} viewBox="0 0 12 12" fill="none"><path d="M6 8V2M3 5l3-3 3 3M2 10h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg> }
function TerminalIcon() { return <svg {...s} viewBox="0 0 12 12" fill="none"><polyline points="2,4 5,6 2,8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><line x1="6" y1="8" x2="10" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg> }
function PlayIcon()     { return <svg width="9" height="10" viewBox="0 0 9 10" fill="none"><polygon points="1,1 8,5 1,9" fill="currentColor"/></svg> }
function SunIcon()      { return <svg {...s} viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.2"/><line x1="6" y1="0.5" x2="6" y2="2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="6" y1="10" x2="6" y2="11.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="0.5" y1="6" x2="2" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="10" y1="6" x2="11.5" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg> }
function MoonIcon()     { return <svg {...s} viewBox="0 0 12 12" fill="none"><path d="M9.5 7A4 4 0 015 2.5a4.5 4.5 0 100 9A4 4 0 019.5 7z" stroke="currentColor" strokeWidth="1.2"/></svg> }
function GearIcon()     { return <svg {...s} viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="1.8" stroke="currentColor" strokeWidth="1.2"/><path d="M6 1v1.5M6 9.5V11M1 6h1.5M9.5 6H11M2.6 2.6l1 1M8.4 8.4l1 1M9.4 2.6l-1 1M3.6 8.4l-1 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg> }
function HomeIcon()     { return <svg {...s} viewBox="0 0 12 12" fill="none"><path d="M1 6L6 1l5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M2.5 4.5V10.5h2.5V7.5h2v3h2.5V4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg> }
function PlusIcon()     { return <svg {...s} viewBox="0 0 12 12" fill="none"><line x1="6" y1="1" x2="6" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg> }
function MinimizeIcon() { return <svg {...s} viewBox="0 0 12 12" fill="none"><line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg> }
function MaximizeIcon() { return <svg {...s} viewBox="0 0 12 12" fill="none"><rect x="1.5" y="1.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg> }
function RestoreIcon()  { return <svg {...s} viewBox="0 0 12 12" fill="none"><rect x="3" y="1" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M1 4v6a1 1 0 001 1h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg> }
function CloseIcon()    { return <svg {...s} viewBox="0 0 12 12" fill="none"><line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg> }