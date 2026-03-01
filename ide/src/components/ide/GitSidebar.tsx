'use client'
import { useState } from 'react'
import { useStore } from '@/lib/store'
import { Textarea, Btn } from '@/components/ui/primitives'
import { GitBranch, Check, ChevronDown, ChevronRight } from 'lucide-react'

// ── tiny hash-to-color ──────────────────────────────────────────────────────
function hashColor(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  const hue = h % 360
  return `hsl(${hue},65%,55%)`
}

// ── GitTree ─────────────────────────────────────────────────────────────────
function GitTree() {
  const { commitHistory, gitBranch, gitChanges } = useStore()
  const [collapsed, setCollapsed] = useState(false)

  const hasUncommitted = gitChanges.length > 0

  if (commitHistory.length === 0 && !hasUncommitted) {
    return (
      <div className="text-xs text-[var(--fg-faint)] text-center mt-4 px-3">
        No commits yet
      </div>
    )
  }

  return (
    <div className="select-none">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-2xs font-semibold text-[var(--fg-faint)] uppercase tracking-widest hover:text-[var(--fg)] transition-colors border-0 bg-transparent cursor-pointer"
      >
        {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
        History
        <span className="ml-auto font-mono normal-case">{commitHistory.length}</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-2">
          {hasUncommitted && (
            <div className="flex items-start">
              <div className="flex flex-col items-center w-6 flex-shrink-0">
                <div
                  className="w-3 h-3 rounded-full border-2 flex-shrink-0 mt-0.5"
                  style={{ borderColor: 'var(--warn)', background: 'var(--surface-1)' }}
                />
                {commitHistory.length > 0 && (
                  <div className="w-px flex-1 min-h-[20px]" style={{ background: 'var(--border)' }} />
                )}
              </div>
              <div className="flex-1 min-w-0 pb-2 pl-1.5">
                <div className="text-xs font-medium text-[var(--warn)]">Uncommitted changes</div>
                <div className="text-2xs text-[var(--fg-faint)] font-mono mt-0.5">
                  {gitChanges.length} file{gitChanges.length !== 1 ? 's' : ''} staged
                </div>
              </div>
            </div>
          )}

          {commitHistory.map((commit, idx) => {
            const isLast = idx === commitHistory.length - 1
            const dotColor = hashColor(commit.hash)
            const isBranchTip = idx === 0
            return (
              <div key={commit.hash} className="flex items-start">
                <div className="flex flex-col items-center w-6 flex-shrink-0">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0 mt-0.5 flex items-center justify-center"
                    style={{
                      background: dotColor,
                      boxShadow: isBranchTip ? `0 0 0 2px var(--surface-1), 0 0 0 3.5px ${dotColor}` : undefined
                    }}
                  >
                    {isBranchTip && <div className="w-1 h-1 rounded-full bg-white opacity-70" />}
                  </div>
                  {!isLast && (
                    <div className="w-px flex-1 min-h-[20px]" style={{ background: 'var(--border)' }} />
                  )}
                </div>
                <div className="flex-1 min-w-0 pb-2 pl-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs text-[var(--fg)] truncate max-w-[120px]">{commit.message}</span>
                    {isBranchTip && (
                      <span
                        className="text-2xs px-1 rounded font-mono flex-shrink-0"
                        style={{ background: dotColor + '22', color: dotColor, border: `1px solid ${dotColor}55` }}
                      >
                        {commit.branch ?? gitBranch}
                      </span>
                    )}
                  </div>
                  <div className="text-2xs text-[var(--fg-faint)] font-mono mt-0.5 flex items-center gap-2">
                    <span style={{ color: dotColor }}>{commit.shortHash}</span>
                    <span>{commit.time}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function GitSidebar() {
  const { gitChanges, gitBranch, doCommit } = useStore()
  const [msg, setMsg] = useState('')
  const [committing, setCommitting] = useState(false)

  async function commit() {
    if (!msg.trim() || committing) return
    setCommitting(true)
    await doCommit(msg.trim())
    setMsg('')
    setCommitting(false)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="h-8 flex items-center px-3 border-b border-[var(--border)] flex-shrink-0">
        <span className="text-2xs font-semibold text-[var(--fg-faint)] uppercase tracking-widest">Source Control</span>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] text-xs text-[var(--fg-muted)]">
        <GitBranch size={11} />
        <span className="font-medium text-[var(--fg)]">{gitBranch}</span>
        <span className="ml-auto font-mono text-[var(--fg-faint)]">↑0 ↓0</span>
      </div>

      <div className="p-3 border-b border-[var(--border)]">
        <div className="text-2xs font-semibold text-[var(--fg-faint)] uppercase tracking-widest mb-2">Commit</div>
        <Textarea
          value={msg}
          onChange={e => setMsg(e.target.value)}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') commit() }}
          placeholder="Message (⌘↵ to commit)..."
          rows={3}
          className="text-xs mb-2"
        />
        <Btn
          variant="solid"
          size="sm"
          className="w-full justify-center gap-2"
          onClick={commit}
          disabled={!msg.trim() || committing}
        >
          {committing
            ? <span className="animate-pulse">Committing…</span>
            : <><Check size={12} /> Commit to {gitBranch}</>
          }
        </Btn>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-3 border-b border-[var(--border)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-2xs font-semibold text-[var(--fg-faint)] uppercase tracking-widest">Changes</span>
            <span className="text-2xs text-[var(--fg-faint)] font-mono">{gitChanges.length}</span>
          </div>

          {gitChanges.length === 0 ? (
            <div className="text-xs text-[var(--fg-faint)] text-center mt-2">No changes</div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {gitChanges.map((c, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--hover)] cursor-default text-xs">
                  <span className={`font-mono font-bold w-3 flex-shrink-0 text-center ${
                    c.letter === 'A' ? 'text-[var(--ok)]' :
                    c.letter === 'M' ? 'text-[var(--warn)]' :
                    'text-[var(--err)]'
                  }`}>{c.letter}</span>
                  <span className="flex-1 truncate text-[var(--fg)]">{c.name}</span>
                  <span className="text-[var(--fg-faint)] font-mono truncate text-2xs">{c.path}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <GitTree />
      </div>
    </div>
  )
}