'use client'
import { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef } from 'react'
import { clsx } from 'clsx'

/* ── Button ── */
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'ghost' | 'solid' | 'outline' | 'danger'
  size?: 'xs' | 'sm' | 'md'
}
export const Btn = forwardRef<HTMLButtonElement, BtnProps>(
  ({ variant = 'ghost', size = 'sm', className, children, ...p }, ref) => {
    const base = 'inline-flex items-center gap-1.5 font-medium rounded transition-colors cursor-pointer border-0 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap'
    const sizes = {
      xs: 'px-1.5 py-0.5 text-xs',
      sm: 'px-2.5 py-1 text-sm',
      md: 'px-3.5 py-1.5 text-base',
    }
    const variants = {
      ghost:   'bg-transparent text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
      solid:   'bg-[var(--fg)] text-[var(--accent-inv)] hover:opacity-80',
      outline: 'border border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
      danger:  'bg-transparent text-[var(--err)] hover:bg-[color-mix(in_srgb,var(--err)_8%,transparent)]',
    }
    return (
      <button ref={ref} className={clsx(base, sizes[size], variants[variant], className)} {...p}>
        {children}
      </button>
    )
  }
)
Btn.displayName = 'Btn'

/* ── Input ── */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => (
    <input
      ref={ref}
      className={clsx(
        'w-full bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--fg)] text-sm placeholder-[var(--fg-faint)]',
        'px-2.5 py-1.5 outline-none transition-colors',
        'focus:border-[var(--fg-muted)]',
        className
      )}
      {...p}
    />
  )
)
Input.displayName = 'Input'

/* ── Select ── */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...p }, ref) => (
    <select
      ref={ref}
      className={clsx(
        'w-full bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--fg)] text-sm',
        'px-2.5 py-1.5 outline-none appearance-none cursor-pointer transition-colors',
        'focus:border-[var(--fg-muted)]',
        className
      )}
      {...p}
    />
  )
)
Select.displayName = 'Select'

/* ── Textarea ── */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...p }, ref) => (
    <textarea
      ref={ref}
      className={clsx(
        'w-full bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--fg)] text-sm',
        'px-2.5 py-1.5 outline-none resize-none transition-colors placeholder-[var(--fg-faint)]',
        'focus:border-[var(--fg-muted)]',
        className
      )}
      {...p}
    />
  )
)
Textarea.displayName = 'Textarea'

/* ── Toggle ── */
export function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={clsx(
        'relative w-8 h-[18px] rounded-full transition-colors cursor-pointer border-0',
        on ? 'bg-[var(--fg)]' : 'bg-[var(--surface-4)]'
      )}
      aria-checked={on}
      role="switch"
    >
      <span className={clsx(
        'absolute top-[2px] w-[14px] h-[14px] rounded-full bg-[var(--surface)] transition-all',
        on ? 'left-[calc(100%-16px)]' : 'left-[2px]'
      )} />
    </button>
  )
}

/* ── Badge ── */
export function Badge({ children, variant = 'default' }: {
  children: React.ReactNode
  variant?: 'default' | 'ok' | 'warn' | 'err'
}) {
  const colors = {
    default: 'bg-[var(--surface-3)] text-[var(--fg-muted)]',
    ok:      'bg-[color-mix(in_srgb,var(--ok)_10%,transparent)] text-[var(--ok)]',
    warn:    'bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] text-[var(--warn)]',
    err:     'bg-[color-mix(in_srgb,var(--err)_10%,transparent)] text-[var(--err)]',
  }
  return (
    <span className={clsx('text-xs px-1.5 py-0.5 rounded font-mono', colors[variant])}>
      {children}
    </span>
  )
}

/* ── IconBtn (square icon button) ── */
export function IconBtn({ children, tooltip, onClick, className }: {
  children: React.ReactNode
  tooltip?: string
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      title={tooltip}
      className={clsx(
        'w-6 h-6 flex items-center justify-center rounded text-[var(--fg-faint)]',
        'hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer border-0 bg-transparent',
        className
      )}
    >
      {children}
    </button>
  )
}

/* ── Divider ── */
export function Divider({ vertical }: { vertical?: boolean }) {
  return (
    <div className={clsx(
      'bg-[var(--border)] flex-shrink-0',
      vertical ? 'w-px h-4' : 'h-px w-full'
    )} />
  )
}

/* ── Label ── */
export function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-2xs font-semibold text-[var(--fg-faint)] uppercase tracking-widest">
      {children}
    </span>
  )
}
