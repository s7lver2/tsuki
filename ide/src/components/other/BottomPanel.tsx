'use client'
import { useStore, BottomTab } from '@/lib/store'
import { useEffect, useRef, useState, useCallback } from 'react'
import { IconBtn } from '@/components/shared/primitives'
import { Trash2, GripHorizontal, AlertTriangle, Info, AlertCircle, Square } from 'lucide-react'
import { clsx } from 'clsx'
import { useT } from '@/lib/i18n'
import { spawnShell, listShells, spawnProcess, type ProcessHandle, type ShellInfo } from '@/lib/tauri'

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

// ── Terminal line type ────────────────────────────────────────────────────────

interface TerminalLine {
  id:   number
  text: string
  type: 'out' | 'err' | 'info' | 'prompt'
}

let _lineId = 0

// ── Shell session state ───────────────────────────────────────────────────────

interface ShellSession {
  id:      number
  shell:   ShellInfo
  lines:   TerminalLine[]
  history: string[]
  histIdx: number
  running: boolean
  process: ProcessHandle | null
}

let _sessionId = 0

function makeSession(shell: ShellInfo): ShellSession {
  return { id: _sessionId++, shell, lines: [], history: [], histIdx: -1, running: false, process: null }
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
  const t = useT()
  const [open, setOpen] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="flex items-center gap-0.5 px-1 border-b border-[var(--border)] h-7 flex-shrink-0 overflow-x-auto">
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
          {s.running && <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" title="running" />}
          <button
            className={clsx(
              'ml-0.5 rounded-sm hover:bg-red-500/30 hover:text-red-400 transition-colors px-0.5 border-0 bg-transparent cursor-pointer leading-none',
              i === activeIdx ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100',
            )}
            onClick={e => { e.stopPropagation(); onClose(i) }}
            title={t('bottomPanel.closeSession')}
          >×</button>
        </div>
      ))}

      <div className="relative flex-shrink-0" ref={dropRef}>
        <button
          onClick={() => setOpen(o => !o)}
          disabled={loading || shells.length === 0}
          title={t('bottomPanel.newSession')}
          className={clsx(
            'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border-0 bg-transparent cursor-pointer transition-colors',
            'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {loading ? <span className="animate-spin inline-block">⟳</span> : <span className="text-[11px] font-bold">+</span>}
          {shells.length > 0 && <span>{shells[0]?.icon}</span>}
          <span style={{ fontSize: '8px' }}>▾</span>
        </button>

        {open && shells.length > 0 && (
          <div className="absolute left-0 top-full mt-0.5 z-50 min-w-[160px] rounded border border-[var(--border)] bg-[var(--surface-2)] shadow-lg py-1">
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

  const sessionRef      = useRef(session)
  const addLogRef       = useRef(addLog)
  const setBottomTabRef = useRef(setBottomTab)
  const projectPathRef  = useRef(projectPath)
  const onUpdateRef     = useRef(onUpdate)
  const interceptRef    = useRef<((line: string, isErr: boolean) => void) | null>(null)

  useEffect(() => { sessionRef.current      = session    }, [session])
  useEffect(() => { addLogRef.current       = addLog     }, [addLog])
  useEffect(() => { setBottomTabRef.current = setBottomTab }, [setBottomTab])
  useEffect(() => { projectPathRef.current  = projectPath  }, [projectPath])
  useEffect(() => { onUpdateRef.current     = onUpdate     }, [onUpdate])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [session.lines])
  useEffect(() => { inputRef.current?.focus() }, [session.id])

  function addLine(text: string, type: TerminalLine['type'] = 'out') {
    onUpdateRef.current({ lines: [...sessionRef.current.lines, { id: _lineId++, text, type }] })
  }

  const spawnInSession = useCallback(async (
    cmd: string,
    args: string[],
    _cwd?: string,
  ): Promise<ProcessHandle> => {
    const sess = sessionRef.current
    const label = [cmd, ...args].join(' ')
    addLine(`❯ ${label}`, 'prompt')
    setBottomTabRef.current('terminal')

    const sentinel = `__tsuki_done_${Date.now()}__`
    let resolveDone!: (code: number) => void
    const done = new Promise<number>(r => { resolveDone = r })

    const origOnLine = (line: string, isErr: boolean) => {
      if (line.includes(sentinel)) {
        resolveDone(0)
        refreshTree().catch(() => {})
        return
      }
      addLine(line, isErr ? 'err' : 'out')
      addLogRef.current(isErr ? 'err' : 'ok', line)
    }

    interceptRef.current = origOnLine
    onUpdateRef.current({ running: true })

    if (sess.process) {
      const shellId  = sess.shell.id
      const echoCmd  = (shellId === 'cmd')
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

    return {
      pid:     sess.process?.pid ?? -1,
      done,
      write:   async () => {},
      kill:    async () => { sess.process?.write('\x03').catch(() => {}) },
      dispose: () => {},
    }
  }, []) // eslint-disable-line

  useEffect(() => { onSpawn(spawnInSession) }, [onSpawn, spawnInSession])

  // Launch the shell once when the session is first created
  useEffect(() => {
    const shell = sessionRef.current.shell
    const cwd_  = projectPathRef.current ?? undefined
    addLine(`Launching ${shell.name}…`, 'info')
    onUpdateRef.current({ running: true })
    setBottomTabRef.current('terminal')

    spawnShell(shell, cwd_, (line, isErr) => {
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

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const val = input.trim()
      setInput('')
      if (!val) return
      const newHistory = [val, ...session.history.slice(0, 49)]
      onUpdateRef.current({ history: newHistory, histIdx: -1 })
      if (val === 'clear' || val === 'cls') { onUpdateRef.current({ lines: [] }); return }
      if (session.process) { session.process.write(val).catch(() => {}); addLine(val, 'prompt') }
      else { const [exe, ...args] = val.split(/\s+/); spawnInSession(exe, args) }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.min(session.histIdx + 1, session.history.length - 1)
      onUpdateRef.current({ histIdx: next }); setInput(session.history[next] ?? '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.max(session.histIdx - 1, -1)
      onUpdateRef.current({ histIdx: next }); setInput(next === -1 ? '' : session.history[next] ?? '')
    } else if (e.key === 'c' && e.ctrlKey) {
      if (session.process) { session.process.kill().then(() => { addLine('^C', 'info'); onUpdateRef.current({ process: null, running: false }) }) }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault(); onUpdateRef.current({ lines: [] }); setInput('')
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
    <div className="flex-1 flex flex-col overflow-hidden font-mono text-xs select-text" onClick={() => inputRef.current?.focus()}>
      <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-0.5 flex-shrink-0">
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--hover)] text-[var(--fg-muted)]">
          {session.shell.icon} {session.shell.name}
        </span>
        {session.running && (
          <span className="text-[9px] text-green-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block animate-pulse" /> running
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-1">
        {session.lines.map(l => (
          <div key={l.id} className={clsx('leading-[18px] whitespace-pre-wrap break-all', typeClass[l.type])}>
            {l.text}
          </div>
        ))}

        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={clsx('flex-shrink-0 text-[10px]', session.running ? 'text-yellow-400' : 'text-green-400')}>
            {session.running ? '◉' : '❯'}
          </span>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            className="flex-1 bg-transparent outline-none text-[var(--fg)] caret-[var(--fg)] border-0 font-mono text-xs"
            placeholder={session.running ? 'Enter → send  ·  Ctrl+C → kill  ·  Ctrl+L → clear' : 'command…  (Ctrl+L to clear)'}
            spellCheck={false} autoCorrect="off" autoCapitalize="off"
          />
          {session.running && (
            <button onClick={stopProcess} title="Kill process" className="flex items-center justify-center w-5 h-5 rounded text-red-400 hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer transition-colors">
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
  const { projectPath, pendingCommand, clearPendingCommand } = useStore()
  const t = useT()
  const [shells,        setShells       ] = useState<ShellInfo[]>([])
  const [sessions,      setSessions     ] = useState<ShellSession[]>([])
  const [activeIdx,     setActiveIdx    ] = useState(0)
  const [loadingShells, setLoadingShells] = useState(true)

  useEffect(() => {
    listShells().then(list => {
      setShells(list)
      setLoadingShells(false)
      if (list.length > 0) { setSessions([makeSession(list[0])]); setActiveIdx(0) }
    }).catch(() => setLoadingShells(false))
  }, [])

  function updateSession(idx: number, patch: Partial<ShellSession>) {
    setSessions(prev => { const next = [...prev]; if (next[idx]) next[idx] = { ...next[idx], ...patch }; return next })
  }

  function newSession(shell: ShellInfo) {
    setSessions(prev => { const next = [...prev, makeSession(shell)]; setActiveIdx(next.length - 1); return next })
  }

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

  // ── Direct spawn infrastructure ───────────────────────────────────────────
  // Keeps stable refs so addLineToActive can be called from async contexts
  // without stale-closure problems.
  const activeIdxRef = useRef(activeIdx)
  useEffect(() => { activeIdxRef.current = activeIdx }, [activeIdx])

  // Appends a line directly into the active session's line list.
  // Stable identity (useCallback + no deps) so it never goes stale.
  const addLineToActive = useCallback((text: string, type: TerminalLine['type'] = 'out') => {
    setSessions(prev => {
      const idx   = activeIdxRef.current
      const next  = [...prev]
      const target = next[idx] ?? next[0]  // fallback to first session if index is off
      if (!target) return prev
      const ti = next.indexOf(target)
      next[ti] = { ...target, lines: [...target.lines, { id: _lineId++, text, type }] }
      return next
    })
  }, []) // eslint-disable-line

  const setActiveRunning = useCallback((running: boolean) => {
    setSessions(prev => {
      const idx    = activeIdxRef.current
      const next   = [...prev]
      const target = next[idx] ?? next[0]
      if (!target) return prev
      const ti = next.indexOf(target)
      next[ti] = { ...target, running }
      return next
    })
  }, []) // eslint-disable-line

  const spawnFnRef = useRef<((cmd: string, args: string[], cwd?: string) => Promise<ProcessHandle>) | null>(null)

  // ── Consume pendingCommand via DIRECT process spawn ───────────────────────
  // Button actions (Check / Build / Flash / Run / Monitor) bypass the
  // interactive shell entirely and call Rust's spawn_process directly.
  //
  // Why this fixes the Windows bug:
  //   • spawn_process calls resolve_cmd() which runs `where.exe` with an
  //     enriched PATH that includes all common per-user install locations.
  //   • The enriched PATH is also passed as env to the child process.
  //   • No shell is involved, so there are no cmd.exe PATH-resolution quirks,
  //     no CREATE_NO_WINDOW races, and no piped-stdin timing issues.
  //   • Works identically on macOS/Linux (which keyword via which(1)).
  //
  // Interactive commands typed by the user still go through the shell session
  // (spawnFnRef / spawnInSession) — full shell experience preserved.
  useEffect(() => {
    if (!pendingCommand) return
    const { cmd, args, cwd, chainArgs } = pendingCommand
    clearPendingCommand()

    const runDirect = async (cmdStr: string, argsArr: string[], cwdStr?: string): Promise<number> => {
      const label = [cmdStr, ...argsArr].join(' ')
      addLineToActive(`❯ ${label}`, 'prompt')
      setActiveRunning(true)

      try {
        const handle = await spawnProcess(cmdStr, argsArr, cwdStr, (line, isErr) => {
          addLineToActive(line, isErr ? 'err' : 'out')
          useStore.getState().addLog(isErr ? 'err' : 'ok', line)
        })
        const code = await handle.done
        handle.dispose()
        setActiveRunning(false)
        useStore.getState().refreshTree().catch(() => {})
        if (code !== 0) addLineToActive(`[exit ${code}]`, 'err')
        return code
      } catch (e) {
        const msg = String(e)
        addLineToActive(`[error: ${msg}]`, 'err')
        useStore.getState().addLog('err', msg)
        setActiveRunning(false)
        return 1
      }
    }

    if (chainArgs) {
      runDirect(cmd, args, cwd).then(code => {
        if (code === 0) runDirect(cmd, chainArgs, cwd)
      })
    } else {
      runDirect(cmd, args, cwd)
    }
  }, [pendingCommand, clearPendingCommand, addLineToActive, setActiveRunning])

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
        <span>{t('bottomPanel.noShells')}</span>
        <span className="text-[10px]">Install Git Bash, PowerShell, or a POSIX shell to use the terminal.</span>
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-xs text-[var(--fg-faint)]">
        <span className="text-2xl">🖥️</span>
        <span>{t('bottomPanel.noSessions')}</span>
        <div className="flex gap-1 flex-wrap justify-center">
          {shells.map(sh => (
            <button key={sh.id} onClick={() => newSession(sh)} className="flex items-center gap-1 px-3 py-1.5 rounded border border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] bg-transparent cursor-pointer text-xs transition-colors">
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
      <ShellTabBar shells={shells} sessions={sessions} activeIdx={activeIdx} onSelect={setActiveIdx} onNewSession={newSession} onClose={closeSession} loading={loadingShells} />
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
    return <div className="flex items-center gap-2 px-3 py-3 text-xs text-[var(--fg-faint)]"><span className="text-green-400">✓</span>No problems detected.</div>
  }
  const icons = {
    error:   <AlertCircle   size={12} className="text-red-400   flex-shrink-0" />,
    warning: <AlertTriangle size={12} className="text-yellow-400 flex-shrink-0" />,
    info:    <Info          size={12} className="text-blue-400  flex-shrink-0" />,
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

  // KEY FIX: Terminal is mounted lazily on first open, then kept alive with CSS.
  // This prevents shell sessions from being destroyed when switching tabs.
  const terminalMounted = useRef(false)
  if (bottomTab === 'terminal') terminalMounted.current = true

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
        {useTabs().map(t => (
          <button
            key={t.id}
            onClick={() => setBottomTab(t.id)}
            className={clsx(
              'px-3 py-1 rounded text-xs cursor-pointer border-0 bg-transparent transition-colors flex items-center gap-1.5',
              bottomTab === t.id ? 'text-[var(--fg)] bg-[var(--active)]' : 'text-[var(--fg-muted)] hover:text-[var(--fg)]',
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
          <IconBtn tooltip="Clear output" onClick={clearLogs}><Trash2 size={11} /></IconBtn>
        )}
      </div>

      {/* Output tab */}
      {bottomTab === 'output' && (
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {logs.length === 0 && <span className="text-xs text-[var(--fg-faint)]">No output yet.</span>}
          {logs.map(l => (
            <div key={l.id} className="flex gap-3 font-mono text-xs leading-[18px]">
              <span className="text-[var(--fg-faint)] flex-shrink-0 select-none">{l.time}</span>
              <span className={clsx({ 'text-green-400': l.type === 'ok', 'text-red-400': l.type === 'err', 'text-yellow-400': l.type === 'warn', 'text-[var(--fg-muted)]': l.type === 'info' })}>
                {l.msg}
              </span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      {/* Problems tab */}
      {bottomTab === 'problems' && <ProblemsTab />}

      {/* Terminal — mounted once, then hidden via CSS to preserve sessions */}
      {terminalMounted.current && (
        <div className={clsx('flex-1 flex flex-col overflow-hidden', bottomTab !== 'terminal' && 'hidden')}>
          <Terminal />
        </div>
      )}
    </div>
  )
}