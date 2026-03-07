'use client'
import { useState, useMemo } from 'react'
import { useStore, GitCommitNode } from '@/lib/store'
import { Textarea, Btn } from '@/components/shared/primitives'
import {
  GitBranch, Check, ChevronDown, ChevronRight,
  FileText, Plus, Minus, Edit3, Info, GitMerge,
} from 'lucide-react'
import { clsx } from 'clsx'

// ── Color from hash ──────────────────────────────────────────────────────────
function hashColor(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return `hsl(${h % 360},65%,55%)`
}

// ── Relative time ─────────────────────────────────────────────────────────────
function relativeTime(timeStr: string): string {
  // timeStr comes from toLocaleTimeString — we fake relative time for now
  // In a real implementation you'd store timestamps; here we just show the time
  return timeStr
}

// ── Lane computation for graph ────────────────────────────────────────────────
interface LanedCommit extends GitCommitNode {
  lane: number
  maxLane: number
  mergeFromLane?: number
}

function computeLanes(commits: GitCommitNode[]): LanedCommit[] {
  // Simple lane assignment: each open branch tip gets a lane.
  // For linear history everything is lane 0.
  const laned: LanedCommit[] = []
  const laneOf = new Map<string, number>() // hash → lane
  const activeLanes: (string | null)[] = [] // lane idx → current hash occupying it

  function allocLane(hash: string): number {
    // Reuse the first free lane, or open a new one
    const free = activeLanes.indexOf(null)
    const lane = free >= 0 ? free : activeLanes.length
    activeLanes[lane] = hash
    laneOf.set(hash, lane)
    return lane
  }

  function freeLane(lane: number) {
    activeLanes[lane] = null
  }

  for (const commit of commits) {
    let lane = laneOf.get(commit.hash)
    if (lane === undefined) lane = allocLane(commit.hash)

    const maxLane = Math.max(0, activeLanes.filter(l => l !== null).length - 1)
    const isMerge = commit.parents.length > 1

    // Free this commit's lane; the first parent inherits it
    freeLane(lane)
    if (commit.parents.length > 0) {
      const [p1, p2] = commit.parents
      laneOf.set(p1, lane)
      activeLanes[lane] = p1

      let mergeFromLane: number | undefined
      if (p2) {
        // Second parent goes to new lane (branch lane)
        const bl = allocLane(p2)
        mergeFromLane = bl
      }

      laned.push({ ...commit, lane, maxLane, mergeFromLane })
    } else {
      laned.push({ ...commit, lane, maxLane })
    }
  }

  return laned
}

// ── Commit dot + connector SVG ────────────────────────────────────────────────
const LANE_W = 16  // px per lane
const DOT_R  = 5   // dot radius
const ROW_H  = 56  // must match the commit row height

interface GraphColProps {
  commit: LanedCommit
  isFirst: boolean
  isLast: boolean
}

function GraphCol({ commit, isFirst, isLast }: GraphColProps) {
  const color   = hashColor(commit.hash)
  const width   = Math.max(LANE_W, (commit.maxLane + 1) * LANE_W + DOT_R * 2)
  const cx      = commit.lane * LANE_W + DOT_R + 2
  const midY    = ROW_H / 2

  return (
    <svg
      width={width}
      height={ROW_H}
      className="flex-shrink-0 overflow-visible"
      style={{ minWidth: width }}
    >
      {/* Vertical line above dot */}
      {!isFirst && (
        <line x1={cx} y1={0} x2={cx} y2={midY - DOT_R - 1}
          stroke={color} strokeWidth={2} opacity={0.5} />
      )}
      {/* Vertical line below dot */}
      {!isLast && (
        <line x1={cx} y1={midY + DOT_R + 1} x2={cx} y2={ROW_H}
          stroke={color} strokeWidth={2} opacity={0.5} />
      )}
      {/* Merge arc */}
      {commit.mergeFromLane !== undefined && (
        <path
          d={`M ${commit.mergeFromLane * LANE_W + DOT_R + 2} ${ROW_H}
              Q ${commit.mergeFromLane * LANE_W + DOT_R + 2} ${midY}
                ${cx} ${midY}`}
          fill="none"
          stroke={hashColor(commit.parents[1] ?? '')}
          strokeWidth={2}
          opacity={0.4}
        />
      )}
      {/* Commit dot */}
      <circle cx={cx} cy={midY} r={DOT_R} fill={color} />
      {/* Inner highlight on tip commit */}
      {commit.parents.length > 0 && (
        <circle cx={cx} cy={midY} r={2} fill="white" opacity={0.6} />
      )}
    </svg>
  )
}

// ── Single commit row ─────────────────────────────────────────────────────────
interface CommitRowProps {
  commit: LanedCommit
  isFirst: boolean
  isLast: boolean
  branchName: string
}

function CommitRow({ commit, isFirst, isLast, branchName }: CommitRowProps) {
  const [open, setOpen] = useState(false)
  const color = hashColor(commit.hash)
  const isTip = isFirst

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-stretch gap-0 hover:bg-[var(--hover)] transition-colors text-left border-0 bg-transparent cursor-pointer"
        style={{ height: ROW_H }}
      >
        {/* Graph column */}
        <GraphCol commit={commit} isFirst={isFirst} isLast={isLast} />

        {/* Text */}
        <div className="flex-1 min-w-0 flex flex-col justify-center py-1 pr-2 gap-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium text-[var(--fg)] truncate max-w-[140px] leading-tight">
              {commit.message}
            </span>
            {isTip && (
              <span
                className="text-[9px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0 flex items-center gap-1"
                style={{ background: color + '22', color, border: `1px solid ${color}55` }}
              >
                <GitBranch size={8} />
                {commit.branch ?? branchName}
              </span>
            )}
            {commit.isMerge && (
              <span className="text-[9px] px-1 rounded bg-purple-500/15 text-purple-400 flex-shrink-0">merge</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[var(--fg-faint)] font-mono">
            <span style={{ color }}>{commit.shortHash}</span>
            <span>·</span>
            <span>{commit.time}</span>
            <span>·</span>
            <span>{commit.author}</span>
          </div>
        </div>

        {/* Expand chevron */}
        <div className="flex items-center pr-2 flex-shrink-0">
          {open
            ? <ChevronDown size={11} className="text-[var(--fg-faint)]" />
            : <ChevronRight size={11} className="text-[var(--fg-faint)]" />
          }
        </div>
      </button>

      {/* Expanded details */}
      {open && (
        <div className="mx-3 mb-2 px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-xs">
          <div className="font-medium text-[var(--fg)] mb-2">{commit.message}</div>
          <div className="flex flex-col gap-1 text-[var(--fg-muted)]">
            <div className="flex gap-2">
              <span className="text-[var(--fg-faint)] w-14 flex-shrink-0">hash</span>
              <span className="font-mono" style={{ color }}>{commit.hash}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-[var(--fg-faint)] w-14 flex-shrink-0">author</span>
              <span>{commit.author}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-[var(--fg-faint)] w-14 flex-shrink-0">time</span>
              <span>{commit.time}</span>
            </div>
            {commit.parents.length > 0 && (
              <div className="flex gap-2">
                <span className="text-[var(--fg-faint)] w-14 flex-shrink-0">parent</span>
                <span className="font-mono text-[var(--fg-faint)]">{commit.parents[0].slice(0, 7)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Uncommitted changes section ───────────────────────────────────────────────
function UncommittedSection({ hasHistory }: { hasHistory: boolean }) {
  const { gitChanges, gitBranch, doCommit } = useStore()
  const [msg, setMsg] = useState('')
  const [committing, setCommitting] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  async function commit() {
    if (!msg.trim() || committing) return
    setCommitting(true)
    await doCommit(msg.trim())
    setMsg('')
    setCommitting(false)
  }

  if (gitChanges.length === 0) return null

  const added    = gitChanges.filter(c => c.letter === 'A')
  const modified = gitChanges.filter(c => c.letter === 'M')
  const deleted  = gitChanges.filter(c => c.letter === 'D')

  return (
    <div className="border-b border-[var(--border)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="w-2 h-2 rounded-full bg-[var(--warn)] flex-shrink-0" />
        <span className="text-xs font-semibold text-[var(--fg)]">
          {gitChanges.length} unsaved change{gitChanges.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => setShowHelp(h => !h)}
          className="ml-auto text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer"
          title="What is this?"
        >
          <Info size={11} />
        </button>
      </div>

      {/* Beginner explanation */}
      {showHelp && (
        <div className="mx-3 mb-2 px-3 py-2 rounded-lg bg-[var(--info)]/10 border border-[var(--info)]/20 text-[10px] text-[var(--fg-muted)] leading-relaxed">
          <strong className="text-[var(--fg)]">What is this?</strong> Git tracks changes to your files.
          These files have been modified since your last commit (save point).
          Write a short description and click <em>Commit</em> to create a save point you can return to later.
        </div>
      )}

      {/* File list */}
      <div className="px-3 pb-2 flex flex-col gap-0.5">
        {gitChanges.map((c, i) => (
          <div key={i} className="flex items-center gap-2 py-0.5">
            <FileIcon letter={c.letter} />
            <span className="flex-1 truncate text-xs text-[var(--fg)]">{c.name}</span>
            <span className="text-[10px] font-mono text-[var(--fg-faint)] truncate max-w-[60px]">{c.path.split('/').slice(0, -1).join('/')}</span>
          </div>
        ))}

        {/* Summary badges */}
        <div className="flex gap-1.5 mt-1 flex-wrap">
          {added.length > 0    && <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 font-semibold">+{added.length} new</span>}
          {modified.length > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 font-semibold">~{modified.length} edited</span>}
          {deleted.length > 0  && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-semibold">-{deleted.length} deleted</span>}
        </div>
      </div>

      {/* Commit form */}
      <div className="px-3 pb-3">
        <label className="text-[10px] text-[var(--fg-faint)] uppercase tracking-widest font-semibold block mb-1.5">
          Describe your changes
        </label>
        <Textarea
          value={msg}
          onChange={e => setMsg(e.target.value)}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') commit() }}
          placeholder={`e.g. "Add blink functionality" or "Fix sensor reading"…`}
          rows={2}
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
            ? <span className="animate-pulse">Saving…</span>
            : <><Check size={12} /> Save snapshot to <strong>{gitBranch}</strong></>
          }
        </Btn>
        <p className="text-[9px] text-[var(--fg-faint)] text-center mt-1.5">⌘↵ to commit quickly</p>
      </div>
    </div>
  )
}

function FileIcon({ letter }: { letter: 'A' | 'M' | 'D' }) {
  if (letter === 'A') return <Plus  size={11} className="text-green-400  flex-shrink-0" />
  if (letter === 'D') return <Minus size={11} className="text-red-400    flex-shrink-0" />
  return                      <Edit3 size={11} className="text-yellow-400 flex-shrink-0" />
}

// ── History section ───────────────────────────────────────────────────────────
function HistorySection() {
  const { commitHistory, gitBranch, gitChanges } = useStore()
  const [collapsed, setCollapsed] = useState(false)

  const laned = useMemo(() => computeLanes(commitHistory), [commitHistory])

  if (commitHistory.length === 0) {
    return (
      <div className="px-4 py-6 flex flex-col items-center gap-2 text-center">
        <GitMerge size={20} className="text-[var(--fg-faint)]" />
        <p className="text-xs text-[var(--fg-faint)]">No commits yet.</p>
        <p className="text-[10px] text-[var(--fg-faint)] leading-relaxed max-w-[180px]">
          Once you commit your changes above, a history of your project's save points will appear here.
        </p>
      </div>
    )
  }

  return (
    <div>
      {/* Section header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center gap-1.5 w-full px-3 py-2 text-[10px] font-semibold text-[var(--fg-faint)] uppercase tracking-widest hover:text-[var(--fg)] transition-colors border-0 bg-transparent cursor-pointer"
      >
        {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
        History
        <span className="ml-auto font-mono normal-case bg-[var(--surface-3)] px-1.5 py-0.5 rounded text-[var(--fg-muted)]">
          {commitHistory.length}
        </span>
      </button>

      {/* "Working tree" row — shows uncommitted state above first commit */}
      {!collapsed && gitChanges.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5">
          <svg width={DOT_R * 2 + 4} height={24} className="flex-shrink-0">
            <circle cx={DOT_R + 2} cy={12} r={DOT_R - 1}
              fill="none"
              stroke="var(--warn)"
              strokeWidth={2}
              strokeDasharray="3 2"
            />
            <line x1={DOT_R + 2} y1={DOT_R + 14} x2={DOT_R + 2} y2={24}
              stroke={hashColor(commitHistory[0]?.hash ?? '')}
              strokeWidth={2} opacity={0.4}
            />
          </svg>
          <span className="text-[10px] text-[var(--warn)] italic">
            {gitChanges.length} unsaved change{gitChanges.length !== 1 ? 's' : ''} (not committed yet)
          </span>
        </div>
      )}

      {/* Commit rows */}
      {!collapsed && laned.map((commit, idx) => (
        <CommitRow
          key={commit.hash}
          commit={commit}
          isFirst={idx === 0}
          isLast={idx === laned.length - 1}
          branchName={gitBranch}
        />
      ))}
    </div>
  )
}

// ── Branch info bar ───────────────────────────────────────────────────────────
function BranchBar() {
  const { gitBranch, commitHistory } = useStore()

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] text-xs">
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <GitBranch size={11} className="text-[var(--fg-faint)] flex-shrink-0" />
        <span className="font-semibold text-[var(--fg)]">{gitBranch}</span>
        <span className="text-[var(--fg-faint)]">·</span>
        <span className="text-[var(--fg-faint)] text-[10px]">
          {commitHistory.length} commit{commitHistory.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function GitSidebar() {
  const { commitHistory, gitChanges } = useStore()

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-8 flex items-center px-3 border-b border-[var(--border)] flex-shrink-0">
        <span className="text-[10px] font-semibold text-[var(--fg-faint)] uppercase tracking-widest">Source Control</span>
      </div>

      <BranchBar />

      <div className="flex-1 overflow-y-auto">
        <UncommittedSection hasHistory={commitHistory.length > 0} />
        <HistorySection />
      </div>
    </div>
  )
}