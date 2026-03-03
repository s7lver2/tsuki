'use client'
import { useStore, BottomTab } from '@/lib/store'
import { useEffect, useRef, useState, useCallback } from 'react'
import { IconBtn } from '@/components/ui/primitives'
import { Trash2, GripHorizontal, AlertTriangle, Info, AlertCircle, Square } from 'lucide-react'
import { clsx } from 'clsx'
import { spawnShell, listShells, type ProcessHandle, type ShellInfo } from '@/lib/tauri'

// ── Tab config ────────────────────────────────────────────────────────────────

const TABS: { id: BottomTab; label: string }[] = [
  { id: 'output',   label: 'Output'   },
  { id: 'problems', label: 'Problems' },
  { id: 'terminal', label: 'Terminal' },
]

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
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
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

// ── Terminal line type ────────────────────────────────────────────────────────

interface TerminalLine {
  id:   number
  text: string
  type: 'out' | 'err' | 'info' | 'prompt'
}

let _lineId = 0

// ── Shell session state ───────────────────────────────────────────────────────

interface ShellSession {
  id:      number          // session index (for React key)
  shell:   ShellInfo
  lines:   TerminalLine[]
  history: string[]
  histIdx: number
  running: boolean
  process: ProcessHandle | null
}

let _sessionId = 0

function makeSession(shell: ShellInfo): ShellSession {
  return {
    id:      _sessionId++,
    shell,
    lines:   [],
    history: [],
    histIdx: -1,
    running: false,
    process: null,
  }
}

// ── ShellTabBar ───────────────────────────────────────────────────────────────

interface ShellTabBarProps {
  shells:       ShellInfo[]
  sessions:     ShellSession[]
  activeIdx:    number
  onSelect:     (idx: number) => void
  onNewSession: (shell: ShellInfo) => void
  onClose:      (idx: number) => void
  loading:      boolean
}

function ShellTabBar({ shells, sessions, activeIdx, onSelect, onNewSession, onClose, loading }: ShellTabBarProps) {
  const [open, setOpen] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="flex items-center gap-0.5 px-1 border-b border-[var(--border)] h-7 flex-shrink-0 overflow-x-auto">
      {/* Session tabs */}
      {sessions.map((s, i) => (
        <div
          key={s.id}
          className={clsx(
            'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] cursor-pointer border border-transparent select-none flex-shrink-0 group',
            i === activeIdx
              ? 'bg-[var(--active)] text-[var(--fg)] border-[var(--border)]'
              : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
          )}
          onClick={() => onSelect(i)}
        >
          <span>{s.shell.icon}</span>
          <span className="max-w-[80px] truncate">{s.shell.name}</span>
          {s.running && (
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" title="running" />
          )}
          <button
            className={clsx(
              'ml-0.5 rounded-sm hover:bg-red-500/30 hover:text-red-400 transition-colors px-0.5 border-0 bg-transparent cursor-pointer leading-none',
              i === activeIdx ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100',
            )}
            onClick={e => { e.stopPropagation(); onClose(i) }}
            title="Close session"
          >
            ×
          </button>
        </div>
      ))}

      {/* New session dropdown */}
      <div className="relative flex-shrink-0" ref={dropRef}>
        <button
          onClick={() => setOpen(o => !o)}
          disabled={loading || shells.length === 0}
          title="New terminal session"
          className={clsx(
            'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border-0 bg-transparent cursor-pointer transition-colors',
            'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {loading ? (
            <span className="animate-spin inline-block">⟳</span>
          ) : (
            <span className="text-[11px] font-bold">+</span>
          )}
          {shells.length > 0 && <span>{shells[0]?.icon}</span>}
          <span style={{ fontSize: '8px' }}>▾</span>
        </button>

        {open && shells.length > 0 && (
          <div className="absolute left-0 top-full mt-0.5 z-50 min-w-[160px] rounded border border-[var(--border)] bg-[var(--surface-2,var(--surface-1))] shadow-lg py-1">
            {shells.map(sh => (
              <button
                key={sh.id}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] text-left border-0 bg-transparent cursor-pointer transition-colors"
                onClick={() => { setOpen(false); onNewSession(sh) }}
              >
                <span>{sh.icon}</span>
                <span>{sh.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Single shell session view ─────────────────────────────────────────────────

interface SessionViewProps {
  session:     ShellSession
  projectPath: string | null
  onUpdate:    (patch: Partial<ShellSession>) => void
  onSpawn:     (fn: (cmd: string, args: string[], cwd?: string) => Promise<ProcessHandle>) => void
}

const typeClass: Record<TerminalLine['type'], string> = {
  out:    'text-[var(--fg-muted)]',
  err:    'text-red-400',
  info:   'text-[var(--info,#60a5fa)]',
  prompt: 'text-[var(--fg)] font-semibold',
}

function SessionView({ session, projectPath, onUpdate, onSpawn }: SessionViewProps) {
  const { addLog, setBottomTab, refreshTree } = useStore()
  const [input, setInput] = useState('')

  const endRef   = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Stable refs
  const sessionRef      = useRef(session)
  const addLogRef       = useRef(addLog)
  const setBottomTabRef = useRef(setBottomTab)
  const projectPathRef  = useRef(projectPath)
  const onUpdateRef     = useRef(onUpdate)
  // When a button command is running, this intercepts shell output lines
  const interceptRef    = useRef<((line: string, isErr: boolean) => void) | null>(null)

  useEffect(() => { sessionRef.current     = session   }, [session])
  useEffect(() => { addLogRef.current      = addLog    }, [addLog])
  useEffect(() => { setBottomTabRef.current = setBottomTab }, [setBottomTab])
  useEffect(() => { projectPathRef.current = projectPath  }, [projectPath])
  useEffect(() => { onUpdateRef.current    = onUpdate     }, [onUpdate])

  // Auto-scroll on new lines
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [session.lines])

  // Focus input when session becomes active
  useEffect(() => { inputRef.current?.focus() }, [session.id])

  function addLine(text: string, type: TerminalLine['type'] = 'out') {
    onUpdateRef.current({
      lines: [...sessionRef.current.lines, { id: _lineId++, text, type }],
    })
  }

  // ── Send a command to this session ─────────────────────────────────────
  // Instead of spawning a separate process (which has PATH issues on Windows),
  // we write the command line directly into the shell's stdin — exactly as if
  // the user typed it.  The shell resolves the executable, inherits its own
  // PATH, and output streams back through the existing listeners.
  const spawnInSession = useCallback(async (
    cmd: string,
    args: string[],
    _cwd?: string,
  ): Promise<ProcessHandle> => {
    const sess = sessionRef.current

    const label = [cmd, ...args].join(' ')
    addLine(`❯ ${label}`, 'prompt')
    setBottomTabRef.current('terminal')

    // Build a promise that resolves when the command finishes.
    // We detect completion via a sentinel echo printed after the command.
    // The sentinel is unique per invocation so concurrent calls don't mix up.
    const sentinel = `__tsuki_done_${Date.now()}__`

    let resolveDone!: (code: number) => void
    const done = new Promise<number>(r => { resolveDone = r })

    // Intercept lines looking for the sentinel before forwarding to display
    const origOnLine = (line: string, isErr: boolean) => {
      if (line.includes(sentinel)) {
        resolveDone(0)
        refreshTree().catch(() => {})
        return
      }
      addLine(line, isErr ? 'err' : 'out')
      addLogRef.current(isErr ? 'err' : 'ok', line)
    }

    // Temporarily patch the session's process onLine — we do this by
    // storing a callback ref the listeners can consult.
    interceptRef.current = origOnLine

    onUpdateRef.current({ running: true })

    if (sess.process) {
      // Shell is live — write the command + sentinel echo into stdin
      const shellId = sess.shell.id
      const echoCmd = (shellId === 'cmd')
        ? `${label} & echo ${sentinel}`
        : `${label}; echo ${sentinel}`
      await sess.process.write(echoCmd)
    } else {
      addLine('[no shell running — cannot execute command]', 'err')
      resolveDone(1)
    }

    done.then(code => {
      interceptRef.current = null
      onUpdateRef.current({ running: false })
      if (code !== 0) {
        addLine(`[exit ${code}]`, 'err')
        addLogRef.current('err', `process exited with code ${code}`)
      }
    })

    // Return a compatible ProcessHandle
    const handle: ProcessHandle = {
      pid: sess.process?.pid ?? -1,
      done,
      write: async () => {},
      kill:  async () => { sess.process?.write('\x03').catch(() => {}) },
      dispose: () => {},
    }
    return handle
  }, []) // eslint-disable-line

  // Expose spawn function to parent (for window.__terminalSpawn)
  useEffect(() => { onSpawn(spawnInSession) }, [onSpawn, spawnInSession])

  // ── Launch the shell for this session ──────────────────────────────────
  useEffect(() => {
    const shell = sessionRef.current.shell
    const cwd_  = projectPathRef.current ?? undefined

    addLine(`Launching ${shell.name}…`, 'info')
    onUpdateRef.current({ running: true })
    setBottomTabRef.current('terminal')

    spawnShell(shell, cwd_, (line, isErr) => {
      // If a button command is running, let its interceptor handle the line
      if (interceptRef.current) {
        interceptRef.current(line, isErr)
      } else {
        addLine(line, isErr ? 'err' : 'out')
        addLogRef.current(isErr ? 'err' : 'ok', line)
      }
    }).then(handle => {
      onUpdateRef.current({ process: handle })
      handle.done.then(code => {
        onUpdateRef.current({ process: null, running: false })
        addLine(
          code === 0 || code === 130
            ? `[${shell.name} session ended]`
            : `[${shell.name} exited with code ${code}]`,
          code === 0 || code === 130 ? 'info' : 'err',
        )
      })
    }).catch(err => {
      addLine(`Failed to launch ${shell.name}: ${err}`, 'err')
      onUpdateRef.current({ running: false })
    })
  }, []) // eslint-disable-line — run once per session mount

  // ── Input handling ─────────────────────────────────────────────────────
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const val = input.trim()
      setInput('')
      if (!val) return

      // Update history
      const newHistory = [val, ...session.history.slice(0, 49)]
      onUpdateRef.current({ history: newHistory, histIdx: -1 })

      if (val === 'clear' || val === 'cls') {
        onUpdateRef.current({ lines: [] })
        return
      }

      // If a shell or process is running, send to its stdin
      if (session.process) {
        session.process.write(val).catch(() => {})
        addLine(val, 'prompt')
      } else {
        // No shell running — spawn command directly
        const [exe, ...args] = val.split(/\s+/)
        spawnInSession(exe, args)
      }

    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.min(session.histIdx + 1, session.history.length - 1)
      onUpdateRef.current({ histIdx: next })
      setInput(session.history[next] ?? '')

    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.max(session.histIdx - 1, -1)
      onUpdateRef.current({ histIdx: next })
      setInput(next === -1 ? '' : session.history[next] ?? '')

    } else if (e.key === 'c' && e.ctrlKey) {
      if (session.process) {
        session.process.kill().then(() => {
          addLine('^C', 'info')
          onUpdateRef.current({ process: null, running: false })
        })
      }

    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault()
      onUpdateRef.current({ lines: [] })
      setInput('')
    }
  }

  function stopProcess() {
    if (!session.process) return
    session.process.kill().then(() => {
      session.process?.dispose()
      addLine('^C  process terminated', 'info')
      onUpdateRef.current({ process: null, running: false })
    })
  }

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden font-mono text-xs select-text"
      onClick={() => inputRef.current?.focus()}
    >
      {/* Shell name badge */}
      <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-0.5 flex-shrink-0">
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--hover)] text-[var(--fg-muted)]">
          {session.shell.icon} {session.shell.name}
        </span>
        {session.running && (
          <span className="text-[9px] text-green-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block animate-pulse" />
            running
          </span>
        )}
      </div>

      {/* Output */}
      <div className="flex-1 overflow-y-auto px-3 py-1">
        {session.lines.map(l => (
          <div
            key={l.id}
            className={clsx('leading-[18px] whitespace-pre-wrap break-all', typeClass[l.type])}
          >
            {l.text}
          </div>
        ))}

        {/* Input line */}
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={clsx(
            'flex-shrink-0 text-[10px]',
            session.running ? 'text-yellow-400' : 'text-green-400',
          )}>
            {session.running ? '◉' : '❯'}
          </span>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            className="flex-1 bg-transparent outline-none text-[var(--fg)] caret-[var(--fg)] border-0 font-mono text-xs"
            placeholder={session.running ? 'Enter → send  ·  Ctrl+C → kill  ·  Ctrl+L → clear' : 'command…  (Ctrl+L to clear)'}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          {session.running && (
            <button
              onClick={stopProcess}
              title="Kill process (Ctrl+C)"
              className="flex items-center justify-center w-5 h-5 rounded text-red-400 hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer transition-colors"
            >
              <Square size={10} />
            </button>
          )}
        </div>

        <div ref={endRef} />
      </div>
    </div>
  )
}

// ── Terminal: multi-session manager ──────────────────────────────────────────

function Terminal() {
  const { projectPath } = useStore()

  const [shells,     setShells    ] = useState<ShellInfo[]>([])
  const [sessions,   setSessions  ] = useState<ShellSession[]>([])
  const [activeIdx,  setActiveIdx ] = useState(0)
  const [loadingShells, setLoadingShells] = useState(true)

  // Load available shells once
  useEffect(() => {
    listShells().then(list => {
      setShells(list)
      setLoadingShells(false)
      // Auto-open a session with the first shell
      if (list.length > 0) {
        setSessions([makeSession(list[0])])
        setActiveIdx(0)
      }
    }).catch(() => setLoadingShells(false))
  }, [])

  // Update a session by index
  function updateSession(idx: number, patch: Partial<ShellSession>) {
    setSessions(prev => {
      const next = [...prev]
      if (next[idx]) next[idx] = { ...next[idx], ...patch }
      return next
    })
  }

  // Open a new shell session
  function newSession(shell: ShellInfo) {
    setSessions(prev => {
      const next = [...prev, makeSession(shell)]
      setActiveIdx(next.length - 1)
      return next
    })
  }

  // Close a session
  function closeSession(idx: number) {
    setSessions(prev => {
      const s = prev[idx]
      s?.process?.kill().catch(() => {})
      s?.process?.dispose()
      const next = prev.filter((_, i) => i !== idx)
      setActiveIdx(i => Math.min(i, Math.max(0, next.length - 1)))
      return next
    })
  }

  // Expose window.__terminalSpawn for other parts of the IDE
  const spawnFnRef = useRef<((cmd: string, args: string[], cwd?: string) => Promise<ProcessHandle>) | null>(null)
  useEffect(() => {
    ;(window as any).__terminalSpawn = (...a: [string, string[], string?]) =>
      spawnFnRef.current?.(...a)
    return () => { delete (window as any).__terminalSpawn }
  }, [])

  // ── Render ────────────────────────────────────────────────────────────
  if (loadingShells) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-[var(--fg-faint)]">
        <span className="animate-spin mr-2">⟳</span> Detecting shells…
      </div>
    )
  }

  if (shells.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-xs text-[var(--fg-faint)] p-4 text-center">
        <span className="text-2xl">🐚</span>
        <span>No shells detected on this system.</span>
        <span className="text-[10px]">Install Git Bash, PowerShell, or a POSIX shell to use the terminal.</span>
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-xs text-[var(--fg-faint)]">
        <span className="text-2xl">🖥️</span>
        <span>No terminal sessions open.</span>
        <div className="flex gap-1 flex-wrap justify-center">
          {shells.map(sh => (
            <button
              key={sh.id}
              onClick={() => newSession(sh)}
              className="flex items-center gap-1 px-3 py-1.5 rounded border border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] bg-transparent cursor-pointer text-xs transition-colors"
            >
              {sh.icon} {sh.name}
            </button>
          ))}
        </div>
      </div>
    )
  }

  const active = sessions[activeIdx]

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ShellTabBar
        shells={shells}
        sessions={sessions}
        activeIdx={activeIdx}
        onSelect={setActiveIdx}
        onNewSession={newSession}
        onClose={closeSession}
        loading={loadingShells}
      />

      {active && (
        <SessionView
          key={active.id}
          session={active}
          projectPath={projectPath}
          onUpdate={patch => updateSession(activeIdx, patch)}
          onSpawn={fn => { spawnFnRef.current = fn }}
        />
      )}
    </div>
  )
}

// ── Problems tab ──────────────────────────────────────────────────────────────

function ProblemsTab() {
  const { problems } = useStore()

  if (problems.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-xs text-[var(--fg-faint)]">
        <span className="text-green-400">✓</span>No problems detected.
      </div>
    )
  }

  const icons = {
    error:   <AlertCircle   size={12} className="text-red-400  flex-shrink-0" />,
    warning: <AlertTriangle size={12} className="text-yellow-400 flex-shrink-0" />,
    info:    <Info          size={12} className="text-blue-400 flex-shrink-0" />,
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {problems.map(p => (
        <div key={p.id} className="flex items-start gap-2 px-3 py-1.5 hover:bg-[var(--hover)]">
          {icons[p.severity]}
          <div className="flex-1 min-w-0">
            <span className="text-xs text-[var(--fg)]">{p.message}</span>
            <span className="text-2xs text-[var(--fg-faint)] font-mono ml-2">
              {p.file}:{p.line}:{p.col}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main BottomPanel ──────────────────────────────────────────────────────────

export default function BottomPanel() {
  const {
    bottomTab, setBottomTab, logs, clearLogs,
    problems, bottomHeight,
  } = useStore()

  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (bottomTab === 'output') endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, bottomTab])

  const errCount  = problems.filter(p => p.severity === 'error').length
  const warnCount = problems.filter(p => p.severity === 'warning').length

  return (
    <div
      className="flex flex-col border-t border-[var(--border)] bg-[var(--surface-1)] flex-shrink-0"
      style={{ height: bottomHeight }}
    >
      <ResizeHandle />

      {/* Tab bar */}
      <div className="h-8 flex items-center px-2 gap-0.5 border-b border-[var(--border)] flex-shrink-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setBottomTab(t.id)}
            className={clsx(
              'px-3 py-1 rounded text-xs cursor-pointer border-0 bg-transparent transition-colors flex items-center gap-1.5',
              bottomTab === t.id
                ? 'text-[var(--fg)] bg-[var(--active)]'
                : 'text-[var(--fg-muted)] hover:text-[var(--fg)]',
            )}
          >
            {t.label}
            {t.id === 'problems' && (errCount + warnCount) > 0 && (
              <span className="flex items-center gap-1 text-2xs font-mono">
                {errCount  > 0 && <span className="text-red-400">{errCount}</span>}
                {warnCount > 0 && <span className="text-yellow-400">{warnCount}</span>}
              </span>
            )}
          </button>
        ))}
        <div className="flex-1" />
        {bottomTab === 'output' && (
          <IconBtn tooltip="Clear output" onClick={clearLogs}>
            <Trash2 size={11} />
          </IconBtn>
        )}
      </div>

      {/* Content */}
      {bottomTab === 'output' && (
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {logs.length === 0 && (
            <span className="text-xs text-[var(--fg-faint)]">No output yet.</span>
          )}
          {logs.map(l => (
            <div key={l.id} className="flex gap-3 font-mono text-xs leading-[18px]">
              <span className="text-[var(--fg-faint)] flex-shrink-0 select-none">{l.time}</span>
              <span className={clsx({
                'text-green-400':          l.type === 'ok',
                'text-red-400':            l.type === 'err',
                'text-yellow-400':         l.type === 'warn',
                'text-[var(--fg-muted)]':  l.type === 'info',
              })}>
                {l.msg}
              </span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      {bottomTab === 'problems' && <ProblemsTab />}

      {/* Terminal — multi-session */}
      {bottomTab === 'terminal' && <Terminal />}
    </div>
  )
}