'use client'
import { useStore, BottomTab } from '@/lib/store'
import { useEffect, useRef, useState, useCallback, KeyboardEvent as RKE } from 'react'
import { IconBtn } from '@/components/shared/primitives'
import { Trash2, GripHorizontal, AlertTriangle, Info, AlertCircle, Filter, Copy, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { useT } from '@/lib/i18n'
import { ptyCreate, ptyWrite, ptyKill, ptyOnData, ptyOnExit, spawnProcess, listShells, pathExists, type ShellInfo, isTauri } from '@/lib/tauri'

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
  const { setBottomHeight, bottomHeight, updateSetting } = useStore()
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
    function onUp(e: MouseEvent) {
      if (dragging.current) {
        // Use e.clientY directly — more accurate than the stale __lastMouseY global
        const h = startH.current + (startY.current - e.clientY)
        updateSetting('bottomPanelHeight', Math.max(80, Math.min(600, h)))
        updateSetting('ideLayout', 'custom')
      }
      dragging.current = false
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [setBottomHeight, updateSetting]) // eslint-disable-line

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
    // OSC sequences: ESC ] ... ST  (window title, hyperlinks, etc.)
    // ST is either BEL (\x07) or ESC\
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // CSI sequences: ESC [ ... <any letter>  (covers ALL parameter/final bytes)
    // This replaces the old narrow regex that only matched [A-BCDEGHJKST]
    // and missed h, l, X, m, n, r, etc.
    .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, '')
    // DEC private sequences not caught above (shouldn't remain but safety net)
    .replace(/\x1b[^\[\]][^\x1b]*/g, '')
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

  const scrollRef      = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLInputElement>(null)
  // PTY session id (stable for the lifetime of this TermView mount)
  const ptyIdRef       = useRef<string>(session.id)
  // Buffer for partial lines arriving from the PTY in chunks
  const lineBuffRef    = useRef<string>('')
  // Track ready state in a ref so the projectPath effect can read it
  const readyRef       = useRef(false)
  // Track the last path we cd'd into so we don't repeat it
  const lastCdPathRef  = useRef<string | null>(null)

  const push = useCallback((raw: string, kind: LineKind = 'output') => {
    setLines(prev => [...prev, makeLine(raw, kind)])
  }, [])

  // Auto-scroll on new lines
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  // ── Spawn PTY shell ───────────────────────────────────────────────────────
  // Uses pty_create (portable-pty) instead of the old spawn_shell (piped stdio).
  //
  // Why PTY matters:
  //   • child sees isatty()=true → prompt flushes immediately without trailing \n
  //   • ANSI colours enabled automatically (TERM=xterm-256color)
  //   • Ctrl-C / Tab / arrow keys work via raw escape sequences
  //
  // Output arrives as raw PTY chunks (not pre-split lines), so we buffer here
  // and split on \n ourselves.
  //
  // cwd safety: if projectPath points to a directory that doesn't exist yet
  //   (race on first-project creation), pty_create would fail with ENOENT.
  //   We pass null and let the shell start in its home dir; the user can cd
  //   manually or open a fresh session once the project dir is ready.
  useEffect(() => {
    let cancelled = false
    const ptyId   = ptyIdRef.current
    const unsubs: Array<() => void> = []

    const shell     = session.shell
    const shellArgs = ((): string[] => {
      switch (shell.id) {
        case 'bash':
        case 'git-bash':   return ['-i']
        case 'zsh':        return ['-i']
        case 'fish':       return ['--interactive']
        case 'powershell': return ['-NoLogo', '-NoExit', '-NoProfile']
        case 'pwsh':       return ['-NoLogo', '-NoExit', '-NoProfile']
        default:           return []
      }
    })()

    // On Windows, passing a cwd to portable-pty causes ConPTY to fail with a
    // misleading "command X not found" error (os_error=2 from CreateProcess),
    // even when the shell exe and directory both exist. The root cause is a
    // known portable-pty + ConPTY interaction in Tauri builds on Windows.
    //
    // Fix: always spawn the shell with cwd=null (its default home dir), then
    // send an initial `cd` command once the shell is ready. This is the same
    // pattern used by VS Code's integrated terminal.
    //
    // IMPORTANT: the store uses forward-slash paths (pathJoin returns '/').
    // cmd.exe / PowerShell on Windows require backslashes for cd to work
    // reliably — forward slashes inside quoted paths confuse the drive-relative
    // cd parser and produce error 123 ("nombre de archivo... no son correctos").
    // We normalise to backslashes before building any cd command.
    const toNativePath = (p: string) =>
      p.replace(/\//g, '\\')
    const rawCwd = projectPath ? toNativePath(projectPath) : undefined
    const cols = 220, rows = 40

    ;(async () => {
      try {
        // Register listeners BEFORE ptyCreate to avoid missing early output
        const unsubData = await ptyOnData(ptyId, (chunk: string) => {
          if (cancelled) return
          // Accumulate chunks and split on newlines; keep trailing partial line
          const raw        = lineBuffRef.current + chunk
          const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
          const parts      = normalized.split('\n')
          lineBuffRef.current = parts.pop() ?? ''
          for (const part of parts) {
            if (part) push(part, 'output')
          }
        })
        const unsubExit = await ptyOnExit(ptyId, (code: number) => {
          if (cancelled) return
          // Flush any remaining buffered text (e.g. final prompt without \n)
          if (lineBuffRef.current) {
            push(lineBuffRef.current, 'output')
            lineBuffRef.current = ''
          }
          push(`[${shell.name} exited — code ${code}]`, 'system')
          onAlive(false)
          onRunning(false)
          setReady(false)
          readyRef.current = false
        })
        unsubs.push(unsubData, unsubExit)

        if (cancelled) return

        // Always spawn without cwd — avoids ConPTY/CreateProcess failure on Windows.
        await ptyCreate(ptyId, shell.path, shellArgs, undefined, cols, rows)

        if (cancelled) {
          ptyKill(ptyId).catch(() => {})
          return
        }

        // After the shell starts, cd into the project directory.
        // Wait a tick so the shell prompt is ready, then verify the path
        // actually exists before sending cd — avoids "El nombre de archivo…"
        // errors when the directory was never created on disk.
        if (rawCwd) {
          setTimeout(() => {
            if (cancelled) return
            pathExists(rawCwd).then(exists => {
              if (!exists || cancelled) return
              const cdCmd = (() => {
                switch (shell.id) {
                  case 'cmd':        return `cd /d "${rawCwd}"\r\n`
                  case 'powershell':
                  case 'pwsh':       return `Set-Location -LiteralPath '${rawCwd}'\r\n`
                  default:           return `cd ${JSON.stringify(rawCwd)}\n`
                }
              })()
              ptyWrite(ptyId, cdCmd).catch(() => {})
            }).catch(() => {})
          }, 300)
        }

        setReady(true)
        readyRef.current = true
        setTimeout(() => inputRef.current?.focus(), 50)
      } catch (e) {
        if (!cancelled) {
          // Rich error — include shell metadata so the log shows exactly what path failed
          const shellDump = JSON.stringify({
            id:   shell.id,
            name: shell.name,
            path: shell.path,
          })
          console.error(
            `[TermView] pty_create FAILED shell=${shellDump} ` +
            `cwd=${rawCwd ?? 'null'} err=${e}`
          )
          push(
            `Failed to start ${shell.name}: ${e}` +
            `\n  shell path: ${shell.path}` +
            `\n  (check the IDE debug log for more details)`,
            'error'
          )
        }
      }
    })()

    return () => {
      cancelled = true
      ptyKill(ptyId).catch(() => {})
      unsubs.forEach(f => f())
    }
  }, []) // eslint-disable-line

  // ── React to project path changes — send cd when ready ───────────────────
  useEffect(() => {
    if (!projectPath) return
    if (projectPath === lastCdPathRef.current) return

    // Normalise separators: store uses '/', shells on Windows need '\'
    const nativePath = projectPath.replace(/\//g, '\\')

    const sendCd = () => {
      if (!readyRef.current) return
      // Verify the path exists before trying to cd — avoids the
      // "El nombre de archivo..." error when a project path is stale or
      // the directory hasn't been created yet.
      pathExists(projectPath).then(exists => {
        if (!exists) {
          // Path doesn't exist — show a warning in the terminal instead of
          // silently staying in TEMP.
          push(`⚠ Project directory not found: ${nativePath}`, 'system')
          return
        }
        lastCdPathRef.current = projectPath
        const shell  = session.shell
        const cdCmd  = (() => {
          switch (shell.id) {
            case 'cmd':        return `cd /d "${nativePath}"\r\n`
            case 'powershell':
            case 'pwsh':       return `Set-Location -LiteralPath '${nativePath}'\r\n`
            default:           return `cd ${JSON.stringify(nativePath)}\n`
          }
        })()
        ptyWrite(ptyIdRef.current, cdCmd).catch(() => {})
      }).catch(() => {})
    }

    if (readyRef.current) {
      sendCd()
    } else {
      const t = setTimeout(sendCd, 600)
      return () => clearTimeout(t)
    }
  }, [projectPath, session.shell]) // eslint-disable-line

  const submitLine = useCallback((line: string) => {
    push(`> ${line}`, 'prompt')
    if (line.trim()) setHistory(h => [line, ...h.slice(0, 199)])
    ptyWrite(ptyIdRef.current, line + '\r\n').catch(() => {})
    setInput('')
    setHistIdx(-1)
  }, [push])

  const onKeyDown = useCallback((e: RKE<HTMLInputElement>) => {
    if (!ready) return

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
      ptyWrite(ptyIdRef.current, '\x03').catch(() => {})
      push('^C', 'system')
      setInput('')
      setHistIdx(-1)
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault()
      setLines([])
    } else if (e.key === 'Tab') {
      e.preventDefault()
      ptyWrite(ptyIdRef.current, '\t').catch(() => {})
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
  const pendingBuild     = useStore(s => s.pendingBuild)
  const clearPendingBuild = useStore(s => s.clearPendingBuild)

  // ── pendingBuild: streams output to Output (addLog) tab, not the terminal ─
  useEffect(() => {
    if (!pendingBuild) return
    const { cmd, args, cwd, chainArgs } = pendingBuild
    clearPendingBuild()

    const { addLog, setBottomTab } = useStore.getState()
    setBottomTab('output')

    const run = (cmdStr: string, argsArr: string[]): Promise<number> => {
      addLog('info', `> ${[cmdStr, ...argsArr].join(' ')}`)
      return new Promise<number>(resolve => {
        spawnProcess(cmdStr, argsArr, cwd ?? projectPathRef.current ?? undefined, (line, isErr) => {
          if (line.trim()) addLog(isErr ? 'err' : 'info', line)
        }).then(handle => {
          handle.done.then(code => {
            handle.dispose()
            if (code !== 0) addLog('err', `[exit ${code}]`)
            else addLog('ok', '[done]')
            useStore.getState().refreshTree().catch(() => {})
            resolve(code)
          })
        }).catch(e => {
          addLog('err', `[error: ${e}]`)
          resolve(1)
        })
      })
    }

    if (chainArgs) {
      run(cmd, args).then(code => { if (code === 0) run(cmd, chainArgs) })
    } else {
      run(cmd, args)
    }
  }, [pendingBuild, clearPendingBuild]) // eslint-disable-line
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
  const shellsInitRef  = useRef(false)   // guard against StrictMode double-fire

  useEffect(() => { projectPathRef.current = projectPath }, [projectPath])
  useEffect(() => {
    if (cmdScrollRef.current) cmdScrollRef.current.scrollTop = cmdScrollRef.current.scrollHeight
  }, [cmdLines])

  const pushCmd = useCallback((raw: string, kind: LineKind = 'output') => {
    setCmdLines(prev => [...prev, makeLine(raw, kind)])
  }, [])

  useEffect(() => {
    if (shellsInitRef.current) return
    shellsInitRef.current = true
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

  // ── Output filter state ───────────────────────────────────────────────────
  const [logFilter,   setLogFilter]   = useState<'all' | 'ok' | 'err' | 'warn' | 'info'>('all')
  const [logSearch,   setLogSearch]   = useState('')
  const [showSearch,  setShowSearch]  = useState(false)
  const [autoScroll,  setAutoScroll]  = useState(true)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (bottomTab === 'output' && autoScroll) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, bottomTab, autoScroll])

  useEffect(() => {
    if (showSearch) searchRef.current?.focus()
  }, [showSearch])

  const errCount  = problems.filter(p => p.severity === 'error').length
  const warnCount = problems.filter(p => p.severity === 'warning').length

  // ── Log counters ──────────────────────────────────────────────────────────
  const logCounts = {
    ok:   logs.filter(l => l.type === 'ok').length,
    err:  logs.filter(l => l.type === 'err').length,
    warn: logs.filter(l => l.type === 'warn').length,
    info: logs.filter(l => l.type === 'info').length,
  }

  // ── Filtered logs ─────────────────────────────────────────────────────────
  const filteredLogs = logs.filter(l => {
    if (logFilter !== 'all' && l.type !== logFilter) return false
    if (logSearch && !l.msg.toLowerCase().includes(logSearch.toLowerCase())) return false
    return true
  })

  function copyLogs() {
    const text = filteredLogs.map(l => `[${l.time}] [${l.type.toUpperCase()}] ${l.msg}`).join('\n')
    navigator.clipboard.writeText(text).catch(() => {})
  }

  const LOG_ICON: Record<string, React.ReactNode> = {
    ok:   <span className="text-green-400  select-none">✓</span>,
    err:  <span className="text-red-400    select-none">✗</span>,
    warn: <span className="text-yellow-400 select-none">⚠</span>,
    info: <span className="text-[var(--fg-faint)] select-none">·</span>,
  }

  return (
    <div className="flex flex-col border-t border-[var(--border)] bg-[var(--surface-1)] flex-shrink-0 relative"
      style={{ height: bottomHeight }}>
      <ResizeHandle />

      {/* ── Tab bar ── */}
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
            {tab.id === 'output' && logCounts.err > 0 && (
              <span className="text-2xs font-mono text-red-400">{logCounts.err}</span>
            )}
          </button>
        ))}
        <div className="flex-1" />

        {/* Output toolbar */}
        {bottomTab === 'output' && (
          <div className="flex items-center gap-0.5">
            {/* Type filter pills */}
            <div className="flex items-center gap-px mr-1">
              {(['all', 'err', 'warn', 'ok', 'info'] as const).map(f => (
                <button key={f} onClick={() => setLogFilter(f)}
                  className={clsx(
                    'px-1.5 py-0.5 text-[9px] font-mono rounded border-0 cursor-pointer transition-colors',
                    logFilter === f
                      ? f === 'err'  ? 'bg-red-500/20 text-red-400'
                      : f === 'warn' ? 'bg-yellow-500/20 text-yellow-400'
                      : f === 'ok'   ? 'bg-green-500/20 text-green-400'
                      : f === 'info' ? 'bg-[var(--active)] text-[var(--fg-muted)]'
                                     : 'bg-[var(--active)] text-[var(--fg)]'
                      : 'bg-transparent text-[var(--fg-faint)] hover:text-[var(--fg)]',
                  )}>
                  {f === 'all'
                    ? `all ${logs.length}`
                    : f === 'err'  ? `err ${logCounts.err}`
                    : f === 'warn' ? `warn ${logCounts.warn}`
                    : f === 'ok'   ? `ok ${logCounts.ok}`
                    : `info ${logCounts.info}`}
                </button>
              ))}
            </div>

            {/* Search toggle */}
            <IconBtn tooltip="Search logs" onClick={() => setShowSearch(s => !s)}>
              <Filter size={11} className={showSearch ? 'text-blue-400' : ''} />
            </IconBtn>

            {/* Auto-scroll toggle */}
            <IconBtn tooltip={autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
              onClick={() => setAutoScroll(s => !s)}>
              <ChevronDown size={11} className={autoScroll ? 'text-green-400' : 'text-[var(--fg-faint)]'} />
            </IconBtn>

            {/* Copy */}
            <IconBtn tooltip="Copy visible logs" onClick={copyLogs}>
              <Copy size={11} />
            </IconBtn>

            {/* Clear */}
            <IconBtn tooltip="Clear output" onClick={clearLogs}>
              <Trash2 size={11} />
            </IconBtn>
          </div>
        )}
      </div>

      {/* ── Output tab ── */}
      {bottomTab === 'output' && (
        <div className="flex flex-col flex-1 overflow-hidden min-h-0">

          {/* Search bar */}
          {showSearch && (
            <div className="flex items-center gap-1.5 px-3 py-1 border-b border-[var(--border)] bg-[var(--surface)] flex-shrink-0">
              <Filter size={9} className="text-[var(--fg-faint)] flex-shrink-0" />
              <input
                ref={searchRef}
                value={logSearch}
                onChange={e => setLogSearch(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && (setShowSearch(false), setLogSearch(''))}
                placeholder="Filter log messages…"
                className="flex-1 text-xs bg-transparent outline-none text-[var(--fg)] placeholder-[var(--fg-faint)]"
              />
              {logSearch && (
                <span className="text-[9px] text-[var(--fg-faint)] font-mono">
                  {filteredLogs.length} / {logs.length}
                </span>
              )}
            </div>
          )}

          {/* Log list */}
          <div className="flex-1 overflow-y-auto px-3 py-1.5 min-h-0"
            onScroll={e => {
              const el = e.currentTarget
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
              setAutoScroll(atBottom)
            }}>
            {!filteredLogs.length && (
              <span className="text-xs text-[var(--fg-faint)]">
                {logs.length === 0 ? 'No output yet.' : 'No entries match the current filter.'}
              </span>
            )}
            {filteredLogs.map(l => (
              <div key={l.id}
                className="flex gap-2 font-mono text-xs leading-[18px] hover:bg-[var(--hover)] rounded px-1 -mx-1 group cursor-default"
                title={l.msg}>
                <span className="text-[var(--fg-faint)] flex-shrink-0 select-none w-14 text-right">{l.time}</span>
                <span className="flex-shrink-0 w-3">{LOG_ICON[l.type]}</span>
                <span className={clsx('flex-1 min-w-0 break-all', {
                  'text-green-400':          l.type === 'ok',
                  'text-red-400':            l.type === 'err',
                  'text-yellow-400':         l.type === 'warn',
                  'text-[var(--fg-muted)]':  l.type === 'info',
                })}>{l.msg}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(l.msg).catch(() => {})}
                  className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center text-[var(--fg-faint)] hover:text-[var(--fg)] cursor-pointer border-0 bg-transparent flex-shrink-0 transition-opacity"
                  title="Copy line">
                  <Copy size={9} />
                </button>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </div>
      )}

      {bottomTab === 'problems' && <ProblemsTab />}

      <div className={clsx('flex-1 flex flex-col overflow-hidden', bottomTab !== 'terminal' && 'hidden')}>
        <Terminal />
      </div>
    </div>
  )
}