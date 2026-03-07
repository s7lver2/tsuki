'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { clsx } from 'clsx'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ContextMenuItem {
  label:    string
  icon?:    React.ReactNode
  shortcut?: string
  danger?:  boolean
  disabled?: boolean
  /** Renders a separator line before this item */
  sep?:     boolean
  action:   () => void
}

interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

// ── Global singleton ──────────────────────────────────────────────────────────
// One menu at a time, rendered via a portal-like div at the root.

let _setMenu: ((m: ContextMenuState | null) => void) | null = null

export function showContextMenu(e: React.MouseEvent | MouseEvent, items: ContextMenuItem[]) {
  e.preventDefault()
  e.stopPropagation()
  _setMenu?.({ x: e.clientX, y: e.clientY, items })
}

// ── Root provider — mount once in layout/page ─────────────────────────────────

export function ContextMenuProvider() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Register global setter
  useEffect(() => {
    _setMenu = setMenu
    return () => { _setMenu = null }
  }, [])

  // Close on any outside interaction
  useEffect(() => {
    if (!menu) return
    function close(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      setMenu(null)
    }
    // Small delay so the triggering mousedown doesn't immediately close it
    const t = setTimeout(() => {
      window.addEventListener('mousedown', close)
      window.addEventListener('keydown', close)
    }, 50)
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [menu])

  // Suppress native browser context menu everywhere
  useEffect(() => {
    function suppress(e: MouseEvent) { e.preventDefault() }
    window.addEventListener('contextmenu', suppress)
    return () => window.removeEventListener('contextmenu', suppress)
  }, [])

  if (!menu) return null

  // Clamp position so menu stays on screen
  const W = typeof window !== 'undefined' ? window.innerWidth  : 1280
  const H = typeof window !== 'undefined' ? window.innerHeight : 800
  const menuW = 200
  const estimatedH = menu.items.length * 26 + 8
  const x = Math.min(menu.x, W - menuW - 8)
  const y = Math.min(menu.y, H - estimatedH - 8)

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top: y, left: x, zIndex: 9999, minWidth: menuW }}
      className={clsx(
        'bg-[var(--surface-2)] border border-[var(--border)] rounded-md shadow-xl',
        'py-1 select-none',
      )}
      onMouseDown={e => e.stopPropagation()}
    >
      {menu.items.map((item, i) => (
        <div key={i}>
          {item.sep && <div className="my-1 h-px bg-[var(--border)]" />}
          <button
            disabled={item.disabled}
            onClick={() => { if (!item.disabled) { item.action(); setMenu(null) } }}
            className={clsx(
              'w-full flex items-center gap-2 px-3 py-1 text-xs text-left',
              'border-0 bg-transparent cursor-pointer transition-colors',
              item.disabled
                ? 'opacity-30 cursor-not-allowed'
                : item.danger
                  ? 'text-[var(--err)] hover:bg-[color-mix(in_srgb,var(--err)_10%,transparent)]'
                  : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
            )}
          >
            {item.icon && (
              <span className="w-3.5 flex items-center justify-center flex-shrink-0 opacity-70">
                {item.icon}
              </span>
            )}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <span className="text-[var(--fg-faint)] font-mono text-[10px] ml-4">
                {item.shortcut}
              </span>
            )}
          </button>
        </div>
      ))}
    </div>
  )
}