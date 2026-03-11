'use client'
import { useStore, BottomTab } from '@/lib/store'
import { useEffect, useRef, useState, useCallback } from 'react'
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
            onClick={e => { e.stopPropagation(); onClose(i) }} title={t('bottomPanel.closeSession')}>×</button>
        </div>
      ))}
      <div className="relative flex-shrink-0" ref={dropRef}>
        <button onClick={() => setOpen(o => !o)} disabled={loading || shells.length === 0}
          title={t('bottomPanel.newSession')}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border-0 bg-transparent cursor-pointer transition-colors text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed">
          {loading ? <span className="animate-spin inline-block">⟳</span> : <span className="text-[11px] font-bold">+</span>}
          {shells.length > 0 && <span>{shells[0]?.icon}</span>}
          <span style={{ fontSize: '8px' }}>▾</span>
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

// ── XtermView — xterm.js display + spawnShell backend ────────────────────────

interface XtermViewProps {
  session: PtySession; projectPath: string | null
  isActive: boolean
  onAlive: (b: boolean) => void; onRunning: (b: boolean) => void
  onReady: (sendFn: (cmd: string, args: string[]) => Promise<number>) => void
}

let _xtermLoading: Promise<void> | null = null
function loadXterm(): Promise<void> {
  if (_xtermLoading) return _xtermLoading
  _xtermLoading = new Promise<void>((resolve, reject) => {
    const fail = (e: Error) => { _xtermLoading = null; reject(e) }
    if (typeof window === 'undefined') { reject(new Error('no window')); return }
    if ((window as any).Terminal) { resolve(); return }
    const CSS = `https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css`
    const JS  = `https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js`
    const FIT = `https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js`
    if (!document.querySelector(`link[href="${CSS}"]`)) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = CSS
      document.head.appendChild(l)
    }
    const s1 = document.createElement('script'); s1.src = JS
    s1.onerror = () => fail(new Error('Failed to load xterm from CDN'))
    s1.onload  = () => {
      const s2 = document.createElement('script'); s2.src = FIT
      s2.onerror = () => fail(new Error('Failed to load addon-fit from CDN'))
      s2.onload  = () => resolve()
      document.head.appendChild(s2)
    }
    document.head.appendChild(s1)
  })
  return _xtermLoading
}

function XtermView({ session, projectPath, isActive, onAlive, onRunning, onReady }: XtermViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef      = useRef<any>(null)
  const fitRef       = useRef<any>(null)
  const handleRef    = useRef<any>(null)
  const resolveRef   = useRef<((code: number) => void) | null>(null)

  // Re-fit whenever the tab becomes visible (xterm can't measure a display:none container)
  useEffect(() => {
    if (!isActive || !fitRef.current || !termRef.current) return
    // rAF ensures the browser has painted and the container has real dimensions
    const id = requestAnimationFrame(() => {
      try { fitRef.current?.fit() } catch { /* ignore */ }
    })
    return () => cancelAnimationFrame(id)
  }, [isActive])

  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false

    const init = async () => {
      try {
        await loadXterm()
        if (cancelled || !containerRef.current) return

        const w        = window as any
        const Terminal = w.Terminal
        const FitAddon = w.FitAddon?.FitAddon ?? w.FitAddon
        if (typeof Terminal !== 'function') throw new Error(`Terminal not a function (got ${typeof Terminal})`)
        if (typeof FitAddon  !== 'function') throw new Error(`FitAddon not a function (got ${typeof w.FitAddon})`)

        const cs = getComputedStyle(document.documentElement)
        const v  = (k: string) => cs.getPropertyValue(k).trim() || undefined

        const term = new Terminal({
          fontFamily:       'JetBrains Mono, Menlo, Consolas, "Courier New", monospace',
          fontSize:         12, lineHeight: 1.4,
          cursorBlink:      true, cursorStyle: 'bar',
          scrollback:       5000,
          convertEol:       true,
          allowProposedApi: true,
          theme: {
            background:          v('--surface-1') ?? '#1a1a1a',
            foreground:          v('--fg')        ?? '#d4d4d4',
            cursor:              v('--fg')        ?? '#d4d4d4',
            cursorAccent:        v('--surface-1') ?? '#1a1a1a',
            selectionBackground: 'rgba(255,255,255,0.2)',
            black:   '#1e1e1e', brightBlack:   '#666666',
            red:     '#f44747', brightRed:     '#f44747',
            green:   '#4ec94e', brightGreen:   '#4ec94e',
            yellow:  '#dcdcaa', brightYellow:  '#dcdcaa',
            blue:    '#569cd6', brightBlue:    '#569cd6',
            magenta: '#c586c0', brightMagenta: '#c586c0',
            cyan:    '#9cdcfe', brightCyan:    '#9cdcfe',
            white:   '#d4d4d4', brightWhite:   '#ffffff',
          },
        })

        const fitAddon = new FitAddon()
        term.loadAddon(fitAddon)
        term.open(containerRef.current!)
        fitAddon.fit()
        termRef.current = term
        fitRef.current  = fitAddon

        term.writeln(`\x1b[90mLaunching ${session.shell.name}…\x1b[0m`)

        const handle = await spawnShell(session.shell, projectPath ?? undefined, (line, isErr) => {
          term.writeln(isErr ? `\x1b[31m${line}\x1b[0m` : line)
        })

        if (cancelled) { handle.kill().catch(() => {}); handle.dispose(); return }
        handleRef.current = handle

        handle.done.then(code => {
          term.writeln(`\r\n\x1b[90m[${session.shell.name} exited — code ${code}]\x1b[0m`)
          onAlive(false); onRunning(false)
          resolveRef.current?.(code)
          resolveRef.current = null
        })

        let lineBuf = ''
        term.onData((data: string) => {
          const code = data.charCodeAt(0)
          if (data === '\r' || data === '\n') {
            term.write('\r\n')
            if (lineBuf.trim()) handle.write(lineBuf + '\r\n').catch(() => {})
            lineBuf = ''
          } else if (code === 127 || code === 8) {
            if (lineBuf.length > 0) { lineBuf = lineBuf.slice(0, -1); term.write('\b \b') }
          } else if (code === 3) {
            handle.write('\x03').catch(() => {}); lineBuf = ''; term.write('^C\r\n')
          } else if (code === 12) {
            term.clear(); lineBuf = ''
          } else if (code >= 32) {
            lineBuf += data; term.write(data)
          }
        })

        onReady((cmd: string, args: string[]): Promise<number> => {
          const p = new Promise<number>(r => { resolveRef.current = r })
          onRunning(true)
          const label = [cmd, ...args].join(' ')
          term.writeln(`\x1b[90m❯ ${label}\x1b[0m`)

          spawnProcess(cmd, args, projectPath ?? undefined, (line, isErr) => {
            term.writeln(isErr ? `\x1b[31m${line}\x1b[0m` : line)
          }).then(h => {
            h.done.then(code => {
              h.dispose()
              resolveRef.current?.(code)
              resolveRef.current = null
              onRunning(false)
              if (code !== 0) term.writeln(`\x1b[31m[exit ${code}]\x1b[0m`)
              useStore.getState().refreshTree().catch(() => {})
            })
          }).catch(e => {
            term.writeln(`\x1b[31m[error: ${e}]\x1b[0m`)
            resolveRef.current?.(1)
            resolveRef.current = null
            onRunning(false)
          })

          return p
        })

      } catch (err) {
        console.error('[XtermView] init failed:', err)
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = `
            <div style="padding:16px;font-family:monospace;font-size:11px;color:var(--fg-muted);line-height:1.8">
              <div style="color:#f44747;font-weight:600;margin-bottom:6px">Terminal init failed</div>
              <div style="color:var(--fg-faint)">${String(err)}</div>
            </div>`
        }
      }
    }

    init()

    return () => {
      cancelled = true
      handleRef.current?.kill().catch(() => {})
      handleRef.current?.dispose()
      handleRef.current = null
      termRef.current?.dispose()
      termRef.current = null
      fitRef.current  = null
    }
  }, []) // eslint-disable-line

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (!fitRef.current || !termRef.current) return
      try { fitRef.current.fit() } catch { /* ignore */ }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [session.id])

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden"
      style={{ background: 'var(--surface-1)', padding: '4px 2px 2px' }}
      onClick={() => termRef.current?.focus()}
    />
  )
}

// ── Fallback line type (Path B direct-spawn output) ───────────────────────────

interface FbLine { id: number; text: string; type: 'out'|'err'|'info'|'prompt' }
let _lid = 0

// ── Terminal: session manager ─────────────────────────────────────────────────

function Terminal() {
  const { projectPath, pendingCommand, clearPendingCommand, settings, bottomTab } = useStore()
  const t = useT()
  const [shells,        setShells       ] = useState<ShellInfo[]>([])
  const [sessions,      setSessions     ] = useState<PtySession[]>([])
  const [activeIdx,     setActiveIdx    ] = useState(0)
  const [loadingShells, setLoadingShells] = useState(true)
  const [fbLines,       setFbLines      ] = useState<FbLine[]>([])
  const fbEndRef     = useRef<HTMLDivElement>(null)
  const settingsRef  = useRef(settings)
  const activeIdxRef = useRef(activeIdx)
  const sendFnsRef   = useRef<Record<string, (cmd: string, args: string[]) => Promise<number>>>({})

  useEffect(() => { settingsRef.current = settings   }, [settings])
  useEffect(() => { activeIdxRef.current = activeIdx }, [activeIdx])
  useEffect(() => { fbEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [fbLines])

  const addFb = useCallback((text: string, type: FbLine['type'] = 'out') => {
    setFbLines(prev => [...prev, { id: _lid++, text, type }])
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
    setSessions(prev => { const n = [...prev, { id, numId: _sessionCounter - 1, shell, alive: true, running: false }]; setActiveIdx(n.length - 1); return n })
  }

  function closeSession(idx: number) {
    setSessions(prev => {
      const s = prev[idx]
      if (s) { delete sendFnsRef.current[s.id] }
      const n = prev.filter((_, i) => i !== idx)
      setActiveIdx(i => Math.min(i, Math.max(0, n.length - 1)))
      return n
    })
  }

  useEffect(() => {
    if (!pendingCommand) return
    const { cmd, args, cwd, chainArgs } = pendingCommand
    clearPendingCommand()
    const method = settingsRef.current.winSpawnMethod ?? 'shell'

    const run = async (cmdStr: string, argsArr: string[], cwdStr?: string): Promise<number> => {
      if (method === 'shell') {
        const sess   = sessions[activeIdxRef.current]
        const sendFn = sess ? sendFnsRef.current[sess.id] : null

        if (!sendFn) {
          await new Promise<void>(res => {
            const t0 = Date.now()
            const iv = setInterval(() => {
              const s = sessions[activeIdxRef.current]
              if ((s && sendFnsRef.current[s.id]) || Date.now() - t0 > 4000) { clearInterval(iv); res() }
            }, 100)
          })
        }

        const fn = sessions[activeIdxRef.current]
          ? sendFnsRef.current[sessions[activeIdxRef.current].id] : null

        if (fn) {
          try {
            const code = await fn(cmdStr, argsArr)
            useStore.getState().refreshTree().catch(() => {})
            return code
          } catch (e) { addFb(`[dispatch error: ${e}]`, 'err') }
        }
      }

      const label = [cmdStr, ...argsArr].join(' ')
      addFb(`❯ ${label}`, 'prompt')
      updateSession(activeIdxRef.current, { running: true })
      try {
        const handle = await spawnProcess(cmdStr, argsArr, cwdStr, (line, isErr) => {
          addFb(line, isErr ? 'err' : 'out')
          useStore.getState().addLog(isErr ? 'err' : 'ok', line)
        })
        const code = await handle.done
        handle.dispose()
        updateSession(activeIdxRef.current, { running: false })
        useStore.getState().refreshTree().catch(() => {})
        if (code !== 0) addFb(`[exit ${code}]`, 'err')
        return code
      } catch (e) {
        addFb(`[error: ${e}]`, 'err')
        addFb(`Spawn method: ${method} — change in Settings → Developer`, 'info')
        useStore.getState().addLog('err', String(e))
        updateSession(activeIdxRef.current, { running: false })
        return 1
      }
    }

    if (chainArgs) {
      run(cmd, args, cwd).then(code => { if (code === 0) run(cmd, chainArgs, cwd) })
    } else {
      run(cmd, args, cwd)
    }
  }, [pendingCommand, clearPendingCommand, addFb, sessions])

  if (loadingShells) return (
    <div className="flex-1 flex items-center justify-center text-xs text-[var(--fg-faint)]">
      <span className="animate-spin mr-2">⟳</span>Detecting shells…
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
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <ShellTabBar shells={shells} sessions={sessions} activeIdx={activeIdx}
        onSelect={setActiveIdx} onNewSession={newSession} onClose={closeSession} loading={loadingShells} />

      {sessions.map((s, i) => (
        <div key={s.id} className={clsx('flex-1 flex flex-col overflow-hidden', i !== activeIdx && 'hidden')}>
          <XtermView
            session={s} projectPath={projectPath}
            isActive={i === activeIdx && bottomTab === 'terminal'}
            onAlive={b  => updateSession(i, { alive: b })}
            onRunning={b => updateSession(i, { running: b })}
            onReady={fn  => { sendFnsRef.current[s.id] = fn }}
          />
        </div>
      ))}

      {fbLines.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 max-h-40 overflow-y-auto bg-[var(--surface-1)]/95 border-t border-[var(--border)] px-3 py-2 font-mono text-[11px] z-20">
          {fbLines.map(l => (
            <div key={l.id} className={clsx('leading-[18px] whitespace-pre-wrap break-all', {
              'text-[var(--fg-muted)]': l.type === 'out', 'text-red-400': l.type === 'err',
              'text-blue-400': l.type === 'info', 'text-[var(--fg)] font-semibold': l.type === 'prompt',
            })}>{l.text}</div>
          ))}
          <div ref={fbEndRef} />
        </div>
      )}
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