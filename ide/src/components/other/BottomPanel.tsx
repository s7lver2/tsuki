'use client'
import { useStore, BottomTab } from '@/lib/store'
import { useEffect, useRef, useState, useCallback, KeyboardEvent as RKE } from 'react'
import { IconBtn } from '@/components/shared/primitives'
import { Trash2, GripHorizontal, AlertTriangle, Info, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { useT } from '@/lib/i18n'
import { spawnShell, spawnProcess, listShells, type ShellInfo, isTauri } from '@/lib/tauri'

// ── Tab config ────────────────────────────────────────────────────────────────

function useTabs() {
  const t = useT()
  return [
    { id: 'output'   as BottomTab, label: t('bottomPanel.output')   },
    { id: 'problems' as BottomTab, label: t('bottomPanel.problems') },
    { id: 'terminal' as BottomTab, label: t('bottomPanel.terminal') },
  ]
}

// ── Resize handle ─────────────────────────────────────────────────────────────

function ResizeHandle() {
  const { setBottomHeight, bottomHeight } = useStore()
  const dragging = useRef(false)
  const startY   = useRef(0)
  const startH   = useRef(0)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    startY.current   = e.clientY
    startH.current   = bottomHeight
    document.body.style.cursor     = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [bottomHeight])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      setBottomHeight(startH.current + (startY.current - e.clientY))
    }
    function onUp() {
      dragging.current = false
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [setBottomHeight])

  return (
    <div
      onMouseDown={onMouseDown}
      className="h-[3px] flex items-center justify-center cursor-row-resize border-t border-[var(--border)] hover:border-[var(--fg-faint)] group transition-colors flex-shrink-0"
    >
      <GripHorizontal size={12} className="text-[var(--fg-faint)] opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  )
}

// ── PTY session state ─────────────────────────────────────────────────────────

interface PtySession {
  id:      string
  numId:   number
  shell:   ShellInfo
  alive:   boolean
  running: boolean
}

let _sessionCounter = 0
function makePtyId() { return `pty-${Date.now()}-${_sessionCounter++}` }

// ── ShellTabBar ───────────────────────────────────────────────────────────────

interface ShellTabBarProps {
  shells: ShellInfo[]; sessions: PtySession[]; activeIdx: number
  onSelect: (i: number) => void; onNewSession: (s: ShellInfo) => void
  onClose: (i: number) => void; loading: boolean
}

function ShellTabBar({ shells, sessions, activeIdx, onSelect, onNewSession, onClose, loading }: ShellTabBarProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div className="flex items-center gap-0.5 px-1 border-b border-[var(--border)] h-7 flex-shrink-0 overflow-x-auto">
      {sessions.map((s, i) => (
        <div key={s.id}
          className={clsx('flex items-center gap-1 px-2 py-0.5 rounded text-[10px] cursor-pointer border border-transparent select-none flex-shrink-0 group',
            i === activeIdx ? 'bg-[var(--active)] text-[var(--fg)] border-[var(--border)]' : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]')}
          onClick={() => onSelect(i)}>
          <span>{s.shell.icon}</span>
          <span className="max-w-[80px] truncate">{s.shell.name}</span>
          {s.running && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0 animate-pulse" title="running" />}
          {!s.alive  && <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" title="ended" />}
          <button className={clsx('ml-0.5 rounded-sm hover:bg-red-500/30 hover:text-red-400 transition-colors px-0.5 border-0 bg-transparent cursor-pointer leading-none',
              i === activeIdx ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100')}
            onClick={e => { e.stopPropagation(); onClose(i) }} title={t('bottomPanel.closeSession')}>x</button>
        </div>
      ))}
      <div className="relative flex-shrink-0" ref={dropRef}>
        <button onClick={() => setOpen(o => !o)} disabled={loading || shells.length === 0}
          title={t('bottomPanel.newSession')}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border-0 bg-transparent cursor-pointer transition-colors text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed">
          {loading ? <span className="animate-spin inline-block">x</span> : <span className="text-[11px] font-bold">+</span>}
          {shells.length > 0 && <span>{shells[0]?.icon}</span>}
          <span style={{ fontSize: '8px' }}>v</span>
        </button>
        {open && shells.length > 0 && (
          <div className="absolute left-0 top-full mt-0.5 z-50 min-w-[160px] rounded border border-[var(--border)] bg-[var(--surface-2)] shadow-lg py-1">
            {shells.map(sh => (
              <button key={sh.id} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] text-left border-0 bg-transparent cursor-pointer"
                onClick={() => { setOpen(false); onNewSession(sh) }}>
                <span>{sh.icon}</span><span>{sh.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── ANSI parser ───────────────────────────────────────────────────────────────
// Handles SGR sequences: colors (30-37,39,90-97), bold (1), dim (2), reset (0)

interface AnsiSpan { text: string; color?: string; bold?: boolean; dim?: boolean }

const ANSI_FG: Record<number, string> = {
  30: '#606366', 31: '#e06c75', 32: '#98c379', 33: '#e5c07b',
  34: '#61afef', 35: '#c678dd', 36: '#56b6c2', 37: '#abb2bf',
  90: '#5c6370', 91: '#ff7b7b', 92: '#b5e890', 93: '#ffd080',
  94: '#80c8ff', 95: '#e0a0ff', 96: '#80e0f0', 97: '#ffffff',
}

function parseAnsi(raw: string): AnsiSpan[] {
  const spans: AnsiSpan[] = []
  let color = ''; let bold = false; let dim = false
  const parts = raw.split(/\x1b\[([0-9;]*)m/)
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) spans.push({ text: parts[i], color: color || undefined, bold: bold || undefined, dim: dim || undefined })
    } else {
      const codes = parts[i] === '' ? [0] : parts[i].split(';').map(Number)
      for (const c of codes) {
        if      (c === 0)              { color = ''; bold = false; dim = false }
        else if (c === 1)              bold = true
        else if (c === 2)              dim  = true
        else if (c === 22)             { bold = false; dim = false }
        else if (c === 39)             color = ''
        else if (c in ANSI_FG)        color = ANSI_FG[c]
      }
    }
  }
  return spans.length ? spans : [{ text: raw }]
}

// Strip non-SGR escape sequences (cursor movement, etc.) then parse ANSI colors
function cleanAndParse(raw: string): AnsiSpan[] {
  const stripped = raw
    .replace(/\x1b\[[^A-Za-z]*[A-BCDEGHJKST]/g, '')  // cursor movement etc.
    .replace(/\x1b[^[]/g, '')                          // ESC + single char
  return parseAnsi(stripped)
}

// ── TermLine ──────────────────────────────────────────────────────────────────

type LineKind = 'output' | 'error' | 'prompt' | 'info' | 'system'

interface TermLine {
  id:    number
  spans: AnsiSpan[]
  kind:  LineKind
  raw:   string
}

let _lid = 0
function makeLine(raw: string, kind: LineKind): TermLine {
  return { id: _lid++, raw, spans: cleanAndParse(raw), kind }
}

// ── TermView — custom React terminal ─────────────────────────────────────────

interface TermViewProps {
  session:     PtySession
  projectPath: string | null
  onAlive:     (b: boolean) => void
  onRunning:   (b: boolean) => void
}

function TermView({ session, projectPath, onAlive, onRunning }: TermViewProps) {
  const [lines,   setLines  ] = useState<TermLine[]>([makeLine(`Launching ${session.shell.name}…`, 'system')])
  const [input,   setInput  ] = useState('')
  const [ready,   setReady  ] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)

  const scrollRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)
  const handleRef  = useRef<any>(null)
  const resolveRef = useRef<((code: number) => void) | null>(null)

  const push = useCallback((raw: string, kind: LineKind = 'output') => {
    setLines(prev => [...prev, makeLine(raw, kind)])
  }, [])

  // Auto-scroll on new lines
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  // ── Spawn interactive shell ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    spawnShell(session.shell, projectPath ?? undefined, (line, isErr) => {
      push(line, isErr ? 'error' : 'output')
    }).then(handle => {
      if (cancelled) { handle.kill().catch(() => {}); handle.dispose(); return }
      handleRef.current = handle
      setReady(true)
      setTimeout(() => inputRef.current?.focus(), 50)

      handle.done.then(code => {
        push(`[${session.shell.name} exited — code ${code}]`, 'system')
        onAlive(false)
        onRunning(false)
        resolveRef.current?.(code)
        resolveRef.current = null
        setReady(false)
      })
    }).catch(e => {
      if (!cancelled) push(`Failed to start shell: ${e}`, 'error')
    })

    return () => {
      cancelled = true
      handleRef.current?.kill().catch(() => {})
      handleRef.current?.dispose()
      handleRef.current = null
    }
  }, []) // eslint-disable-line

  const submitLine = useCallback((line: string) => {
    if (!handleRef.current) return
    push(`> ${line}`, 'prompt')
    if (line.trim()) setHistory(h => [line, ...h.slice(0, 199)])
    handleRef.current.write(line + '\r\n').catch(() => {})
    setInput('')
    setHistIdx(-1)
  }, [push])

  const onKeyDown = useCallback((e: RKE<HTMLInputElement>) => {
    if (!ready || !handleRef.current) return

    if (e.key === 'Enter') {
      e.preventDefault()
      submitLine(input)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHistory(h => {
        const next = Math.min(histIdx + 1, h.length - 1)
        setHistIdx(next)
        if (h[next] !== undefined) setInput(h[next])
        return h
      })
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = histIdx - 1
      setHistIdx(next)
      setInput(next < 0 ? '' : history[next] ?? '')
    } else if (e.key === 'c' && e.ctrlKey) {
      e.preventDefault()
      handleRef.current.write('\x03').catch(() => {})
      push('^C', 'system')
      setInput('')
      setHistIdx(-1)
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault()
      setLines([])
    } else if (e.key === 'Tab') {
      e.preventDefault()
      handleRef.current.write('\t').catch(() => {})
    }
  }, [ready, input, history, histIdx, push, submitLine])

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{ background: 'var(--surface-1)', fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, "Courier New", monospace' }}
      onClick={() => inputRef.current?.focus()}
    >
      {/* ── Scrollback ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 pt-2 pb-1 select-text"
        style={{ fontSize: 12, lineHeight: 1.65, scrollbarWidth: 'thin' }}
      >
        {lines.map(l => (
          <div
            key={l.id}
            className="whitespace-pre-wrap break-all"
            style={{
              color: l.kind === 'error'  ? '#e06c75'
                   : l.kind === 'prompt' ? 'var(--fg)'
                   : l.kind === 'system' ? 'var(--fg-faint)'
                   : l.kind === 'info'   ? '#61afef'
                   : 'var(--fg-muted)',
              fontWeight: l.kind === 'prompt' ? 600 : undefined,
              fontStyle:  l.kind === 'system' ? 'italic' : undefined,
              opacity:    l.kind === 'system' ? 0.7 : 1,
            }}
          >
            {/* Use ANSI spans only for output/error lines; others render raw */}
            {(l.kind === 'output' || l.kind === 'error')
              ? l.spans.map((s, i) => (
                  <span key={i} style={{
                    color:      s.color  || undefined,
                    fontWeight: s.bold   ? 700 : undefined,
                    opacity:    s.dim    ? 0.5 : undefined,
                  }}>{s.text}</span>
                ))
              : l.raw
            }
          </div>
        ))}
      </div>

      {/* ── Input row ── */}
      <div
        className="flex items-center gap-2 px-3 border-t flex-shrink-0"
        style={{
          borderColor: 'var(--border)',
          paddingTop: 5, paddingBottom: 5,
          opacity: ready ? 1 : 0.45,
          pointerEvents: ready ? 'auto' : 'none',
        }}
      >
        <span style={{ color: '#98c379', fontSize: 11, flexShrink: 0, userSelect: 'none' }}>❯</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!ready}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          className="flex-1 border-0 outline-none bg-transparent min-w-0"
          style={{
            fontFamily: 'inherit',
            fontSize: 12,
            color: 'var(--fg)',
            caretColor: '#98c379',
          }}
          placeholder={ready ? '' : 'Waiting for shell…'}
        />
      </div>
    </div>
  )
}

// ── Terminal: session manager + direct command output ────────────────────────

function Terminal() {
  const { projectPath, pendingCommand, clearPendingCommand } = useStore()
  const t = useT()
  const [shells,        setShells       ] = useState<ShellInfo[]>([])
  const [sessions,      setSessions     ] = useState<PtySession[]>([])
  const [activeIdx,     setActiveIdx    ] = useState(0)
  const [loadingShells, setLoadingShells] = useState(true)

  // ── Dedicated output lines for toolbar commands (spawnProcess) ───────────
  // These are rendered above the interactive shell and persist independently
  // of session lifecycle. No race condition — no session needed.
  const [cmdLines,    setCmdLines   ] = useState<TermLine[]>([])
  const [cmdRunning,  setCmdRunning ] = useState(false)
  const cmdScrollRef  = useRef<HTMLDivElement>(null)
  const projectPathRef = useRef(projectPath)

  useEffect(() => { projectPathRef.current = projectPath }, [projectPath])
  useEffect(() => {
    if (cmdScrollRef.current) cmdScrollRef.current.scrollTop = cmdScrollRef.current.scrollHeight
  }, [cmdLines])

  const pushCmd = useCallback((raw: string, kind: LineKind = 'output') => {
    setCmdLines(prev => [...prev, makeLine(raw, kind)])
  }, [])

  useEffect(() => {
    listShells().then(list => {
      setShells(list)
      setLoadingShells(false)
      if (list.length > 0 && isTauri()) {
        setSessions([{ id: makePtyId(), numId: _sessionCounter - 1, shell: list[0], alive: true, running: false }])
        setActiveIdx(0)
      }
    }).catch(() => setLoadingShells(false))
  }, [])

  function updateSession(idx: number, patch: Partial<PtySession>) {
    setSessions(prev => { const n = [...prev]; if (n[idx]) n[idx] = { ...n[idx], ...patch }; return n })
  }

  function newSession(shell: ShellInfo) {
    const id = makePtyId()
    setSessions(prev => {
      const n = [...prev, { id, numId: _sessionCounter - 1, shell, alive: true, running: false }]
      setActiveIdx(n.length - 1)
      return n
    })
  }

  function closeSession(idx: number) {
    setSessions(prev => {
      const s = prev[idx]
      const n = prev.filter((_, i) => i !== idx)
      setActiveIdx(i => Math.min(i, Math.max(0, n.length - 1)))
      return n
    })
  }

  // ── pendingCommand: runs directly via spawnProcess, no session needed ─────
  useEffect(() => {
    if (!pendingCommand) return
    const { cmd, args, cwd, chainArgs } = pendingCommand
    clearPendingCommand()

    const run = (cmdStr: string, argsArr: string[]): Promise<number> => {
      pushCmd(`> ${[cmdStr, ...argsArr].join(' ')}`, 'prompt')
      setCmdRunning(true)
      return new Promise<number>(resolve => {
        spawnProcess(cmdStr, argsArr, cwd ?? projectPathRef.current ?? undefined, (line, isErr) => {
          pushCmd(line, isErr ? 'error' : 'output')
        }).then(handle => {
          handle.done.then(code => {
            handle.dispose()
            setCmdRunning(false)
            if (code !== 0) pushCmd(`[exit ${code}]`, 'error')
            else pushCmd('[done]', 'system')
            useStore.getState().refreshTree().catch(() => {})
            resolve(code)
          })
        }).catch(e => {
          pushCmd(`[error: ${e}]`, 'error')
          setCmdRunning(false)
          resolve(1)
        })
      })
    }

    if (chainArgs) {
      run(cmd, args).then(code => { if (code === 0) run(cmd, chainArgs) })
    } else {
      run(cmd, args)
    }
  }, [pendingCommand, clearPendingCommand, pushCmd]) // eslint-disable-line

  if (loadingShells) return (
    <div className="flex-1 flex items-center justify-center text-xs text-[var(--fg-faint)]">
      <span className="animate-spin mr-2">x</span>Detecting shells…
    </div>
  )

  if (shells.length === 0 || !isTauri()) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-xs text-[var(--fg-faint)] p-4 text-center">
      <span className="text-2xl">🐚</span>
      <span>{t('bottomPanel.noShells')}</span>
    </div>
  )

  if (sessions.length === 0) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-xs text-[var(--fg-faint)]">
      <span className="text-2xl">🖥️</span>
      <span>{t('bottomPanel.noSessions')}</span>
      <div className="flex gap-1 flex-wrap justify-center">
        {shells.map(sh => (
          <button key={sh.id} onClick={() => newSession(sh)}
            className="flex items-center gap-1 px-3 py-1.5 rounded border border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] bg-transparent cursor-pointer text-xs">
            {sh.icon} {sh.name}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* ── Toolbar command output (always visible, no session dependency) ── */}
      {cmdLines.length > 0 && (
        <div className="flex flex-col border-b border-[var(--border)]" style={{ maxHeight: '45%', minHeight: 60 }}>
          <div className="flex items-center justify-between px-3 py-0.5 border-b border-[var(--border)] flex-shrink-0"
            style={{ background: 'var(--surface-2)' }}>
            <span className="text-[10px] text-[var(--fg-faint)] font-mono select-none flex items-center gap-1.5">
              {cmdRunning && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse inline-block" />}
              output
            </span>
            <button onClick={() => setCmdLines([])}
              className="text-[10px] text-[var(--fg-faint)] hover:text-[var(--fg)] bg-transparent border-0 cursor-pointer px-1 leading-none">
              ✕
            </button>
          </div>
          <div ref={cmdScrollRef} className="overflow-y-auto px-3 py-1.5 flex-1"
            style={{ fontFamily: '"JetBrains Mono", Consolas, monospace', fontSize: 11, lineHeight: 1.6, scrollbarWidth: 'thin' as const }}>
            {cmdLines.map(l => (
              <div key={l.id} className="whitespace-pre-wrap break-all" style={{
                color: l.kind === 'error'  ? '#e06c75'
                     : l.kind === 'prompt' ? 'var(--fg)'
                     : l.kind === 'system' ? 'var(--fg-faint)'
                     : 'var(--fg-muted)',
                fontWeight: l.kind === 'prompt' ? 600 : undefined,
                fontStyle: l.kind === 'system' ? 'italic' : undefined,
                opacity: l.kind === 'system' ? 0.7 : 1,
              }}>
                {(l.kind === 'output' || l.kind === 'error')
                  ? l.spans.map((s, i) => (
                      <span key={i} style={{ color: s.color || undefined, fontWeight: s.bold ? 700 : undefined, opacity: s.dim ? 0.5 : undefined }}>{s.text}</span>
                    ))
                  : l.raw
                }
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Interactive shell sessions ── */}
      <ShellTabBar shells={shells} sessions={sessions} activeIdx={activeIdx}
        onSelect={setActiveIdx} onNewSession={newSession} onClose={closeSession} loading={loadingShells} />

      {sessions.map((s, i) => (
        <div key={s.id} className={clsx('flex-1 flex flex-col overflow-hidden', i !== activeIdx && 'hidden')}>
          <TermView
            session={s}
            projectPath={projectPath}
            onAlive={b  => updateSession(i, { alive: b })}
            onRunning={b => updateSession(i, { running: b })}
          />
        </div>
      ))}
    </div>
  )
}

// ── Problems tab ──────────────────────────────────────────────────────────────

function ProblemsTab() {
  const { problems } = useStore()
  if (!problems.length) return (
    <div className="flex items-center gap-2 px-3 py-3 text-xs text-[var(--fg-faint)]">
      <span className="text-green-400">✓</span>No problems detected.
    </div>
  )
  const icons = {
    error:   <AlertCircle   size={12} className="text-red-400    flex-shrink-0" />,
    warning: <AlertTriangle size={12} className="text-yellow-400 flex-shrink-0" />,
    info:    <Info          size={12} className="text-blue-400   flex-shrink-0" />,
  }
  return (
    <div className="flex-1 overflow-y-auto">
      {problems.map(p => (
        <div key={p.id} className="flex items-start gap-2 px-3 py-1.5 hover:bg-[var(--hover)]">
          {icons[p.severity]}
          <div className="flex-1 min-w-0">
            <span className="text-xs text-[var(--fg)]">{p.message}</span>
            <span className="text-2xs text-[var(--fg-faint)] font-mono ml-2">{p.file}:{p.line}:{p.col}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main BottomPanel ──────────────────────────────────────────────────────────

export default function BottomPanel() {
  const { bottomTab, setBottomTab, logs, clearLogs, problems, bottomHeight } = useStore()
  const t = useT()
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (bottomTab === 'output') endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, bottomTab])

  const errCount  = problems.filter(p => p.severity === 'error').length
  const warnCount = problems.filter(p => p.severity === 'warning').length

  return (
    <div className="flex flex-col border-t border-[var(--border)] bg-[var(--surface-1)] flex-shrink-0 relative"
      style={{ height: bottomHeight }}>
      <ResizeHandle />

      <div className="h-8 flex items-center px-2 gap-0.5 border-b border-[var(--border)] flex-shrink-0">
        {useTabs().map(tab => (
          <button key={tab.id} onClick={() => setBottomTab(tab.id)}
            className={clsx('px-3 py-1 rounded text-xs cursor-pointer border-0 bg-transparent transition-colors flex items-center gap-1.5',
              bottomTab === tab.id ? 'text-[var(--fg)] bg-[var(--active)]' : 'text-[var(--fg-muted)] hover:text-[var(--fg)]')}>
            {tab.label}
            {tab.id === 'problems' && (errCount + warnCount) > 0 && (
              <span className="flex items-center gap-1 text-2xs font-mono">
                {errCount  > 0 && <span className="text-red-400">{errCount}</span>}
                {warnCount > 0 && <span className="text-yellow-400">{warnCount}</span>}
              </span>
            )}
          </button>
        ))}
        <div className="flex-1" />
        {bottomTab === 'output' && <IconBtn tooltip="Clear output" onClick={clearLogs}><Trash2 size={11} /></IconBtn>}
      </div>

      {bottomTab === 'output' && (
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {!logs.length && <span className="text-xs text-[var(--fg-faint)]">No output yet.</span>}
          {logs.map(l => (
            <div key={l.id} className="flex gap-3 font-mono text-xs leading-[18px]">
              <span className="text-[var(--fg-faint)] flex-shrink-0 select-none">{l.time}</span>
              <span className={clsx({ 'text-green-400': l.type==='ok', 'text-red-400': l.type==='err',
                'text-yellow-400': l.type==='warn', 'text-[var(--fg-muted)]': l.type==='info' })}>{l.msg}</span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      {bottomTab === 'problems' && <ProblemsTab />}

      <div className={clsx('flex-1 flex flex-col overflow-hidden', bottomTab !== 'terminal' && 'hidden')}>
        <Terminal />
      </div>
    </div>
  )
}