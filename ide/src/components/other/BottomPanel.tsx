'use client'
import { useStore, BottomTab } from '@/lib/store'
import { useEffect, useRef, useState, useCallback, KeyboardEvent as RKE } from 'react'
import { IconBtn } from '@/components/shared/primitives'
import { Trash2, GripHorizontal, AlertTriangle, Info, AlertCircle, Filter, Copy, ChevronDown, Radio, Circle, PlugZap, Unplug, Settings2 } from 'lucide-react'
import FileExplorer from '@/components/other/FileExplorer'
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
    { id: 'monitor'  as BottomTab, label: 'Monitor' },
    { id: 'explorer' as BottomTab, label: 'Explorer' },
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
      className="h-[3px] flex items-center justify-center cursor-row-resize border-t border-[var(--border)] hover:border-[var(--accent,#6ba4e0)] group transition-colors flex-shrink-0"
      style={{ transition: 'border-color 0.15s' }}
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

// ── Startup noise filter ─────────────────────────────────────────────────────
// Suppresses well-known shell banner/header lines that add no value in the
// IDE terminal. Covers cmd.exe and PowerShell banners (all languages).
const STARTUP_NOISE_RE = [
  // cmd.exe / PowerShell Windows banner
  /^Microsoft Windows \[/i,
  /^\(c\) Microsoft Corporation/i,
  /^Copyright \(C\) Microsoft Corporation/i,
  // PowerShell version line
  /^Windows PowerShell/i,
  /^PowerShell \d/i,
  // "Try the new cross-platform..."
  /^Try the new cross-platform/i,
  // The programmatic cd commands we send (cmd echoes them even with /Q in interactive mode)
  /^cd\s+\/d\s+/i,
  /^Set-Location\s+-LiteralPath/i,
  // cmd.exe prompt lines that appear during startup before first user input
  // e.g. "C:\Users\NICKE\AppData\Local\Temp>"  or  "E:\GoDotIno\test\test>"
  /^[A-Z]:\\.*>$/,
  // Blank prompt line that cmd.exe emits on start with /Q
  /^\s*$/,
]

function isStartupNoise(line: string): boolean {
  return STARTUP_NOISE_RE.some(re => re.test(line))
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
  // Current PTY column count — kept in sync with the panel width via ResizeObserver
  const colsRef        = useRef(120)
  // After startup noise window closes, stop filtering blank lines so normal
  // terminal output (e.g. blank lines between command output) is preserved.
  const startupDoneRef = useRef(false)

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
        // /Q suppresses command echoing — we don't want to see the cd commands
        // we send programmatically echoed back into the terminal output.
        case 'cmd':        return ['/Q']
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

    const rows = 40

    ;(async () => {
      try {
        // Register listeners BEFORE ptyCreate to avoid missing early output
        const unsubData = await ptyOnData(ptyId, (chunk: string) => {
          if (cancelled) return
          // Accumulate chunks and split on newlines; keep trailing partial line.
          //
          // tsuki-ux uses \r (bare carriage-return, no \n) to overwrite the
          // current line for spinner/progress animations.  We must NOT convert
          // \r → \n here; instead we treat a bare \r as "replace last line":
          //   • \r\n  → normal newline (Windows-style, already handled first)
          //   • \r    → overwrite the last pushed line (tsuki-ux progress)
          //   • \n    → normal newline
          const raw = lineBuffRef.current + chunk

          // Split on \r\n first so Windows CRLF is a single \n, then process
          // bare \r and \n separately.
          const segments = raw.replace(/\r\n/g, '\n').split(/(\r|\n)/)
          // segments alternates: text, delimiter, text, delimiter, …
          // We reconstruct line-by-line, honouring bare \r as overwrite.
          let buf = ''
          for (let i = 0; i < segments.length; i++) {
            const seg = segments[i]
            if (seg === '\n') {
              // Commit current buffer as a new line
              if (buf && !(startupDoneRef.current === false && isStartupNoise(buf))) push(buf, 'output')
              buf = ''
            } else if (seg === '\r') {
              // Overwrite: replace the last line in state with whatever comes next
              // We stash the intent in buf reset; the next text segment replaces it.
              // If there is already something in buf, discard it (tsuki-ux wrote \r
              // to go back to column 0 and overwrite the spinner line).
              buf = '\x00OVERWRITE\x00'
            } else {
              if (buf === '\x00OVERWRITE\x00') {
                // Replace the last visible output line in state
                setLines(prev => {
                  const copy = [...prev]
                  // Find the last 'output' line and replace it
                  for (let j = copy.length - 1; j >= 0; j--) {
                    if (copy[j].kind === 'output') {
                      copy[j] = makeLine(seg, 'output')
                      return copy
                    }
                  }
                  // No output line found — just append
                  return [...copy, makeLine(seg, 'output')]
                })
                buf = ''
              } else {
                buf += seg
              }
            }
          }
          // Whatever remains is a partial line — keep it buffered
          lineBuffRef.current = buf === '\x00OVERWRITE\x00' ? '' : buf
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
        await ptyCreate(ptyId, shell.path, shellArgs, undefined, colsRef.current, rows)

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
              // Mark this path as handled so the projectPath-watcher effect
              // below doesn't fire a duplicate cd for the same directory.
              lastCdPathRef.current = projectPath ?? null
              ptyWrite(ptyId, cdCmd).catch(() => {})
              // Startup noise window closes after cd is sent — subsequent
              // blank lines / prompts are real terminal output.
              setTimeout(() => { startupDoneRef.current = true }, 800)
            }).catch(() => {})
          }, 300)
        }

        setReady(true)
        readyRef.current = true
        // If there's no project path, close the startup noise window immediately
        if (!rawCwd) setTimeout(() => { startupDoneRef.current = true }, 500)
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

  // ── Dynamic terminal width ────────────────────────────────────────────────
  // tsuki-ux computes box-drawing widths from the PTY column count.  If cols
  // is fixed at 220 but the panel is only, say, 100 chars wide, the ╭─╮ boxes
  // overflow and their right borders are pushed off-screen.  We measure the
  // scrollback container and keep the PTY in sync via ResizeObserver.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const charWidth = 7.2 // approximate px width of a monospace char at 12px
    const update = () => {
      const newCols = Math.max(40, Math.floor(el.clientWidth / charWidth))
      if (newCols !== colsRef.current) {
        colsRef.current = newCols
        // Notify the PTY so it reflows — fire-and-forget, best-effort
        import('@/lib/tauri').then(({ ptyResize }) => {
          ptyResize(ptyIdRef.current, newCols, 40).catch(() => {})
        }).catch(() => {})
      }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
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
            className="whitespace-pre-wrap"
            style={{
              // overflowWrap:'anywhere' lets long identifiers/paths wrap at any
              // character boundary, but — unlike break-all — it will NOT break
              // inside tsuki-ux box-drawing sequences (╭─╮│╰) unless there is
              // genuinely no other break opportunity on the line.
              overflowWrap: 'anywhere',
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

    const { addLog, setBottomTab, setProblems } = useStore.getState()
    setBottomTab('output')
    setProblems([])

    // Compiler diagnostic regex: path:line:col: (error|warning|note): message
    const COMPILER_DIAG = /^(.+?):(\d+):(\d+):\s+(error|warning|note|fatal error):\s+(.+)$/
    const buildProblems: import('@/lib/store').Problem[] = []
    let problemId   = 0
    // Tracks whether we're inside a Traceback box (stderr artifact from tsuki-flash)
    let inTraceback   = false
    // After "✖  tsuki-flash compile --board ..." tsuki-flash re-prints the full │ block.
    // We suppress that duplicate block until a non-│ / non-separator line appears.
    let inDupeBlock   = false
    // Deduplicate compiler diagnostic lines (appear in both the inline box and the dupe block)
    const seenDiags   = new Set<string>()

    function processLine(raw: string): { skip: boolean; type: import('@/lib/store').LogLine['type'] } {
      const t = raw.trimStart()

      // ── Traceback box ─────────────────────────────────────────────────────────
      if (t.startsWith('╭') && /Traceback/.test(t)) {
        inTraceback = true
        return { skip: true, type: 'info' }
      }
      if (inTraceback) {
        if (t.startsWith('╰') && t.endsWith('╯')) inTraceback = false
        return { skip: true, type: 'info' }
      }

      // ── Duplicate │ block after "✖  tsuki-flash <cmd>" ───────────────────────
      // tsuki-flash prints:  ✖  tsuki-flash compile --board ...
      // then re-dumps the │  ... block again before printing CompileError: / [exit N]
      // Detect the trigger: ✖ line that contains "tsuki-flash" but is NOT "... failed"
      if (/^[✖✗]/.test(t) && /tsuki-flash\b/.test(t) && !/\bfailed\b/.test(t)) {
        inDupeBlock = true
        return { skip: false, type: 'err' }   // show the ✖ header itself
      }
      if (inDupeBlock) {
        // │ lines, separator dashes, blank → suppress
        if (!t || /^[│─\s]/.test(t)) return { skip: true, type: 'info' }
        // anything else (CompileError:, ✖ ...failed, ╰) ends the dupe block
        inDupeBlock = false
      }

      // ── Empty ─────────────────────────────────────────────────────────────────
      if (!t) return { skip: true, type: 'info' }

      // ── Explicit markers ──────────────────────────────────────────────────────
      if (/^[✔✓]/.test(t) || t === '[done]') return { skip: false, type: 'ok' }
      if (/CompileError:/.test(t) || /^\[exit [^0]/.test(t) || /^\[error:/.test(t))
        return { skip: false, type: 'err' }
      if (/\bcompilation failed\b/i.test(t) || /\blink failed\b/i.test(t))
        return { skip: false, type: 'err' }

      // ── Compiler diagnostic lines ─────────────────────────────────────────────
      if (COMPILER_DIAG.test(t)) {
        const m = t.match(COMPILER_DIAG)!
        const key = `${m[1]}:${m[2]}:${m[3]}:${m[4]}`
        const isDupe = seenDiags.has(key)
        seenDiags.add(key)
        return { skip: isDupe, type: m[4].startsWith('error') || m[4] === 'fatal error' ? 'err' : 'warn' }
      }

      return { skip: false, type: 'info' }
    }

    const run = (cmdStr: string, argsArr: string[]): Promise<number> => {
      addLog('info', `> ${[cmdStr, ...argsArr].join(' ')}`)
      return new Promise<number>(resolve => {
        spawnProcess(cmdStr, argsArr, cwd ?? projectPathRef.current ?? undefined, (line, _isErr) => {
          const { skip, type } = processLine(line)
          if (skip) return
          addLog(type, line)
          const m = line.trimStart().match(COMPILER_DIAG)
          if (m && (m[4].startsWith('error') || m[4] === 'fatal error' || m[4] === 'warning')) {
            const key = `${m[1]}:${m[2]}:${m[3]}:${m[4]}`
            if (!buildProblems.some(p => p.id === key)) {
              buildProblems.push({
                id: key,
                severity: m[4] === 'warning' ? 'warning' : 'error',
                file: m[1].replace(/\\/g, '/').split('/').pop() ?? m[1],
                line: Number(m[2]),
                col: Number(m[3]),
                message: m[5].trim(),
              })
              setProblems([...buildProblems])
            }
          }
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
    error:   <AlertCircle   size={12} className="text-red-400    flex-shrink-0 mt-0.5" />,
    warning: <AlertTriangle size={12} className="text-yellow-400 flex-shrink-0 mt-0.5" />,
    info:    <Info          size={12} className="text-blue-400   flex-shrink-0 mt-0.5" />,
  }
  const errCount  = problems.filter(p => p.severity === 'error').length
  const warnCount = problems.filter(p => p.severity === 'warning').length
  return (
    <div className="flex flex-col flex-1 overflow-hidden min-h-0">
      <div className="flex items-center gap-3 px-3 py-1 border-b border-[var(--border)] flex-shrink-0">
        {errCount  > 0 && <span className="flex items-center gap-1 text-[10px] text-red-400"><AlertCircle size={10} />{errCount} error{errCount !== 1 ? 's' : ''}</span>}
        {warnCount > 0 && <span className="flex items-center gap-1 text-[10px] text-yellow-400"><AlertTriangle size={10} />{warnCount} warning{warnCount !== 1 ? 's' : ''}</span>}
      </div>
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        {problems.map(p => (
          <div key={p.id} className="flex items-start gap-2 px-3 py-1.5 hover:bg-[var(--hover)] border-b border-[var(--border)]/30"
            style={{ borderLeft: `2px solid ${p.severity === 'error' ? 'rgb(248 113 113/0.5)' : 'rgb(251 191 36/0.4)'}` }}>
            {icons[p.severity]}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[var(--fg)] leading-snug">{p.message}</p>
              <p className="text-[10px] text-[var(--fg-faint)] font-mono mt-0.5">
                {p.file}<span className="text-[var(--fg-faint)]/60">:{p.line}:{p.col}</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Serial Monitor ────────────────────────────────────────────────────────────
//
// Uses `tsuki monitor --port <port> --baud <baud>` as the backend.
// The monitor command streams serial data to stdout; we pipe it via
// spawnProcess and write lines via stdin.
//
// Port discovery: runs `tsuki-flash detect` (which prints COM/tty ports)
// or falls back to a manual port entry.

const BAUD_RATES = ['300','1200','2400','4800','9600','14400','19200','28800','38400','57600','74880','115200','230400','250000','500000','1000000','2000000']

interface MonitorLine { id: number; text: string; dir: 'rx' | 'tx' | 'sys' }
let _mlid = 0

function SerialMonitor() {
  const { settings, updateSetting } = useStore()
  const tsukiPath = (settings.tsukiPath?.trim() || 'tsuki').replace(/^"|"$/g, '')

  const [port,     setPort    ] = useState(settings.monitorPort || '')
  const [baud,     setBaud    ] = useState(settings.monitorBaud || '9600')
  const [ports,    setPorts   ] = useState<string[]>([])
  const [lines,    setLines   ] = useState<MonitorLine[]>([])
  const [input,    setInput   ] = useState('')
  const [running,  setRunning ] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [showCfg,  setShowCfg ] = useState(false)
  const [nl,       setNl      ] = useState<'nl'|'cr'|'crlf'|'none'>('nl')
  const [autoScroll, setAutoScroll] = useState(true)
  const [hexMode,  setHexMode ] = useState(false)

  const scrollRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)
  const handleRef  = useRef<Awaited<ReturnType<typeof spawnProcess>> | null>(null)

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [lines, autoScroll])

  // Persist port/baud to settings
  useEffect(() => { updateSetting('monitorPort', port) }, [port])   // eslint-disable-line
  useEffect(() => { updateSetting('monitorBaud',  baud) }, [baud])  // eslint-disable-line

  function push(text: string, dir: MonitorLine['dir']) {
    setLines(prev => [...prev, { id: _mlid++, text, dir }])
  }

  // ── Port scan ─────────────────────────────────────────────────────────────
  async function scanPorts() {
    setScanning(true)
    try {
      const flashBin = (settings.tsukiFlashPath?.trim() || 'tsuki-flash').replace(/^"|"$/g, '')
      const found: string[] = []
      const handle = await spawnProcess(flashBin, ['detect'], undefined, (line) => {
        const trimmed = line.trim()
        // tsuki-flash detect prints one port per line, e.g. "COM3" or "/dev/ttyUSB0"
        if (trimmed && (trimmed.startsWith('COM') || trimmed.startsWith('/dev/'))) {
          found.push(trimmed)
        }
      })
      await handle.done
      handle.dispose()
      setPorts(found)
      if (found.length > 0 && !port) setPort(found[0])
    } catch {
      push('⚠ Could not run tsuki-flash detect — enter port manually', 'sys')
    } finally {
      setScanning(false)
    }
  }

  // ── Connect ───────────────────────────────────────────────────────────────
  async function connect() {
    if (!port.trim()) { push('⚠ No port selected', 'sys'); return }
    if (running) return

    push(`Connecting to ${port} @ ${baud} baud…`, 'sys')
    setRunning(true)

    try {
      const handle = await spawnProcess(
        tsukiPath,
        ['monitor', '--port', port.trim(), '--baud', baud],
        undefined,
        (line, isErr) => {
          if (!line.trim()) return
          if (hexMode) {
            const hex = Array.from(line).map(c => c.charCodeAt(0).toString(16).padStart(2,'0')).join(' ')
            push(hex, 'rx')
          } else {
            push(line, isErr ? 'sys' : 'rx')
          }
        },
      )
      handleRef.current = handle
      push(`Connected to ${port}`, 'sys')
      inputRef.current?.focus()

      handle.done.then(code => {
        handleRef.current = null
        setRunning(false)
        push(`Connection closed (exit ${code})`, 'sys')
      })
    } catch (e) {
      setRunning(false)
      push(`Failed to connect: ${e}`, 'sys')
    }
  }

  // ── Disconnect ────────────────────────────────────────────────────────────
  async function disconnect() {
    if (handleRef.current) {
      await handleRef.current.kill().catch(() => {})
      handleRef.current = null
    }
    setRunning(false)
    push('Disconnected.', 'sys')
  }

  // Cleanup on unmount
  useEffect(() => () => { handleRef.current?.kill().catch(() => {}) }, [])

  // ── Send ─────────────────────────────────────────────────────────────────
  async function send(text: string) {
    if (!running || !handleRef.current) return
    const suffix = nl === 'nl' ? '\n' : nl === 'cr' ? '\r' : nl === 'crlf' ? '\r\n' : ''
    const payload = text + suffix
    try {
      await handleRef.current.write(payload)
      push(text, 'tx')
    } catch (e) {
      push(`Send error: ${e}`, 'sys')
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); send(input); setInput('') }
  }

  const lineColor = (dir: MonitorLine['dir']) =>
    dir === 'tx'  ? '#98c379' :
    dir === 'sys' ? 'var(--fg-faint)' :
    'var(--fg-muted)'

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ fontFamily: '"JetBrains Mono", Consolas, monospace' }}>

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--border)] flex-shrink-0 flex-wrap"
        style={{ background: 'var(--surface-2)' }}>

        {/* Port selector */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-[10px] text-[var(--fg-faint)] select-none">Port</span>
          <select value={port} onChange={e => setPort(e.target.value)}
            disabled={running}
            className="text-[11px] bg-[var(--surface-3)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[var(--fg)] outline-none cursor-pointer disabled:opacity-50"
            style={{ maxWidth: 120 }}>
            <option value="">— select —</option>
            {ports.map(p => <option key={p} value={p}>{p}</option>)}
            {port && !ports.includes(port) && <option value={port}>{port}</option>}
          </select>
          <input
            value={port} onChange={e => setPort(e.target.value)}
            disabled={running}
            placeholder="COM3 / /dev/ttyUSB0"
            className="text-[11px] bg-[var(--surface-3)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[var(--fg)] outline-none w-32 disabled:opacity-50"
          />
          <button onClick={scanPorts} disabled={running || scanning}
            className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border)] bg-transparent text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] cursor-pointer disabled:opacity-40 transition-colors">
            {scanning ? '…' : '⟳'}
          </button>
        </div>

        {/* Baud rate */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-[10px] text-[var(--fg-faint)] select-none">Baud</span>
          <select value={baud} onChange={e => setBaud(e.target.value)}
            disabled={running}
            className="text-[11px] bg-[var(--surface-3)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[var(--fg)] outline-none cursor-pointer disabled:opacity-50">
            {BAUD_RATES.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {/* Connect / Disconnect */}
        {!running ? (
          <button onClick={connect} disabled={!port.trim()}
            className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-[var(--border)] bg-transparent text-green-400 hover:bg-green-500/10 cursor-pointer disabled:opacity-40 transition-colors">
            <PlugZap size={11} /> Connect
          </button>
        ) : (
          <button onClick={disconnect}
            className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-[var(--border)] bg-transparent text-red-400 hover:bg-red-500/10 cursor-pointer transition-colors">
            <Unplug size={11} /> Disconnect
          </button>
        )}

        {/* Running indicator */}
        {running && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse flex-shrink-0" title="Connected" />}

        <div className="flex-1" />

        {/* Config toggle */}
        <button onClick={() => setShowCfg(s => !s)}
          className={clsx('p-1 rounded border border-transparent hover:border-[var(--border)] bg-transparent cursor-pointer transition-colors',
            showCfg ? 'text-[var(--fg)] bg-[var(--active)]' : 'text-[var(--fg-faint)] hover:text-[var(--fg)]')}>
          <Settings2 size={11} />
        </button>

        {/* Auto-scroll */}
        <button onClick={() => setAutoScroll(s => !s)} title={autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
          className={clsx('p-1 rounded border border-transparent hover:border-[var(--border)] bg-transparent cursor-pointer transition-colors',
            autoScroll ? 'text-green-400' : 'text-[var(--fg-faint)] hover:text-[var(--fg)]')}>
          <ChevronDown size={11} />
        </button>

        {/* Clear */}
        <button onClick={() => setLines([])} title="Clear"
          className="p-1 rounded border border-transparent hover:border-[var(--border)] bg-transparent text-[var(--fg-faint)] hover:text-[var(--fg)] cursor-pointer transition-colors">
          <Trash2 size={11} />
        </button>
      </div>

      {/* ── Config panel ── */}
      {showCfg && (
        <div className="flex items-center gap-3 px-3 py-1.5 border-b border-[var(--border)] flex-shrink-0 flex-wrap"
          style={{ background: 'var(--surface-2)', fontSize: 11 }}>
          <div className="flex items-center gap-1">
            <span className="text-[var(--fg-faint)]">Line ending</span>
            {(['none','nl','cr','crlf'] as const).map(v => (
              <button key={v} onClick={() => setNl(v)}
                className={clsx('px-1.5 py-0.5 rounded border text-[10px] font-mono cursor-pointer transition-colors bg-transparent',
                  nl === v ? 'border-[var(--fg-faint)] text-[var(--fg)]' : 'border-[var(--border)] text-[var(--fg-faint)] hover:text-[var(--fg)]')}>
                {v === 'none' ? 'None' : v === 'nl' ? '\\n' : v === 'cr' ? '\\r' : '\\r\\n'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[var(--fg-faint)]">Display</span>
            <button onClick={() => setHexMode(false)}
              className={clsx('px-1.5 py-0.5 rounded border text-[10px] cursor-pointer transition-colors bg-transparent',
                !hexMode ? 'border-[var(--fg-faint)] text-[var(--fg)]' : 'border-[var(--border)] text-[var(--fg-faint)] hover:text-[var(--fg)]')}>ASCII</button>
            <button onClick={() => setHexMode(true)}
              className={clsx('px-1.5 py-0.5 rounded border text-[10px] cursor-pointer transition-colors bg-transparent',
                hexMode ? 'border-[var(--fg-faint)] text-[var(--fg)]' : 'border-[var(--border)] text-[var(--fg-faint)] hover:text-[var(--fg)]')}>HEX</button>
          </div>
        </div>
      )}

      {/* ── Scrollback ── */}
      <div ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 pt-2 pb-1 select-text"
        style={{ fontSize: 12, lineHeight: 1.65, scrollbarWidth: 'thin' }}
        onScroll={e => {
          const el = e.currentTarget
          setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
        }}>
        {lines.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--fg-faint)]" style={{ minHeight: 80 }}>
            <Radio size={20} className="opacity-30" />
            <span className="text-xs">Select a port and click Connect</span>
          </div>
        )}
        {lines.map(l => (
          <div key={l.id} className="whitespace-pre-wrap break-all flex gap-2"
            style={{ color: lineColor(l.dir), fontStyle: l.dir === 'sys' ? 'italic' : undefined, opacity: l.dir === 'sys' ? 0.65 : 1 }}>
            <span className="select-none flex-shrink-0 w-3 text-[10px] mt-[2px]"
              style={{ color: l.dir === 'tx' ? '#98c379' : l.dir === 'rx' ? '#61afef' : 'transparent' }}>
              {l.dir === 'tx' ? '▲' : l.dir === 'rx' ? '▼' : '·'}
            </span>
            <span className="flex-1 min-w-0">{l.text}</span>
          </div>
        ))}
      </div>

      {/* ── Input row ── */}
      <div className="flex items-center gap-2 px-3 border-t flex-shrink-0"
        style={{ borderColor: 'var(--border)', paddingTop: 5, paddingBottom: 5,
          opacity: running ? 1 : 0.4, pointerEvents: running ? 'auto' : 'none' }}>
        <span style={{ color: '#98c379', fontSize: 11, flexShrink: 0, userSelect: 'none' }}>▲</span>
        <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!running}
          spellCheck={false} autoComplete="off" autoCapitalize="off"
          className="flex-1 border-0 outline-none bg-transparent min-w-0 text-[var(--fg)]"
          style={{ fontFamily: 'inherit', fontSize: 12, caretColor: '#98c379' }}
          placeholder={running ? `Send data (${nl === 'none' ? 'no newline' : nl})…` : ''}
        />
        <button onClick={() => { send(input); setInput('') }} disabled={!running || !input.trim()}
          className="text-[10px] px-2 py-0.5 rounded border border-[var(--border)] bg-transparent text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] cursor-pointer disabled:opacity-30 transition-colors flex-shrink-0">
          Send
        </button>
      </div>
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
    ok:   <span className="text-green-400  select-none" style={{ fontSize: 10 }}>✔</span>,
    err:  <span className="text-red-400    select-none" style={{ fontSize: 10 }}>✖</span>,
    warn: <span className="text-yellow-400 select-none" style={{ fontSize: 10 }}>▲</span>,
    info: <span className="select-none" style={{ color: 'var(--fg-faint)', fontSize: 10 }}>›</span>,
  }

  const LOG_ACCENT: Record<string, string> = {
    ok:   'transparent',
    err:  'rgba(248,113,113,0.10)',
    warn: 'rgba(251,191,36,0.07)',
    info: 'transparent',
  }

  const LOG_LEFT_BAR: Record<string, string> = {
    ok:   'transparent',
    err:  'rgb(248 113 113 / 0.55)',
    warn: 'rgb(251 191 36 / 0.45)',
    info: 'transparent',
  }

  return (
    <div className="flex flex-col border-t border-[var(--border)] bg-[var(--surface-1)] flex-shrink-0 relative"
      style={{ height: bottomHeight }}>
      <ResizeHandle />

      {/* ── Tab bar ── */}
      <div className="h-8 flex items-center px-2 gap-0.5 border-b border-[var(--border)] flex-shrink-0" style={{ background: 'var(--surface-2)' }}>
        {useTabs().map(tab => (
          <button key={tab.id} onClick={() => setBottomTab(tab.id)}
            className={clsx('px-3 py-1 rounded text-xs cursor-pointer border-0 bg-transparent transition-colors flex items-center gap-1.5',
              bottomTab === tab.id
                ? 'text-[var(--fg)] bg-[var(--surface-3)] shadow-[inset_0_-1px_0_0_var(--border)]'
                : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]')}>
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
          <div className="flex-1 overflow-y-auto overflow-x-auto px-3 py-1.5 min-h-0"
            style={{ scrollbarWidth: 'thin' }}
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
            {(() => {
              // Group consecutive box-drawing lines into single card blocks
              type Group =
                | { kind: 'line'; log: typeof filteredLogs[0] }
                | { kind: 'box';  lines: typeof filteredLogs }

              const groups: Group[] = []
              let boxLines: typeof filteredLogs = []

              const isBoxLine = (msg: string) =>
                /^[\s]*[╭╰│▶…·─]/.test(msg) && !/^CompileError:/.test(msg.trim())

              const flushBox = () => {
                if (boxLines.length) {
                  groups.push({ kind: 'box', lines: boxLines })
                  boxLines = []
                }
              }

              for (const l of filteredLogs) {
                if (isBoxLine(l.msg)) {
                  boxLines.push(l)
                } else {
                  flushBox()
                  groups.push({ kind: 'line', log: l })
                }
              }
              flushBox()

              return groups.map((g, gi) => {
                if (g.kind === 'box') {
                  // Determine card accent from first err/warn line inside box
                  const hasErr  = g.lines.some(l => l.type === 'err')
                  const hasWarn = g.lines.some(l => l.type === 'warn')
                  const accentColor = hasErr
                    ? 'rgb(248 113 113 / 0.4)'
                    : hasWarn
                    ? 'rgb(251 191 36 / 0.35)'
                    : 'var(--border)'
                  const cardBg = hasErr
                    ? 'rgba(248,113,113,0.04)'
                    : hasWarn
                    ? 'rgba(251,191,36,0.03)'
                    : 'var(--surface-2)'

                  return (
                    <div key={`box-${gi}`}
                      className="my-1 rounded-md overflow-hidden font-mono text-xs leading-[17px]"
                      style={{
                        background: cardBg,
                        border: `1px solid ${accentColor}`,
                      }}>
                      {g.lines.map(l => {
                        const isSep = /^[\s]*[─]+/.test(l.msg)
                        return (
                          <div key={l.id}
                            className="group flex cursor-default hover:bg-white/[0.025] transition-colors"
                            style={{ paddingLeft: '10px', paddingRight: '6px' }}>
                            <span
                              className="flex-1 min-w-0 whitespace-pre py-px"
                              style={{
                                color: l.type === 'err'  ? '#e06c75'
                                     : l.type === 'ok'   ? '#98c379'
                                     : l.type === 'warn' ? '#e5c07b'
                                     : isSep ? 'var(--fg-faint)'
                                     : 'var(--fg-muted)',
                                opacity: isSep ? 0.35 : 1,
                              }}>
                              {l.msg}
                            </span>
                            <button
                              onClick={() => navigator.clipboard.writeText(l.msg).catch(() => {})}
                              className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center text-[var(--fg-faint)] hover:text-[var(--fg)] cursor-pointer border-0 bg-transparent flex-shrink-0 transition-opacity self-center ml-1"
                              title="Copy line">
                              <Copy size={9} />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )
                }

                // Regular single-line log entry
                const l = g.log
                const bg  = LOG_ACCENT[l.type]  ?? 'transparent'
                const bar = LOG_LEFT_BAR[l.type] ?? 'transparent'
                return (
                  <div key={l.id}
                    className="flex gap-2 font-mono text-xs leading-[17px] hover:bg-[var(--hover)] rounded group cursor-default"
                    style={{
                      borderLeft: `2px solid ${bar}`,
                      background: bg,
                      paddingLeft: bar !== 'transparent' ? '6px' : '4px',
                      paddingRight: '4px',
                      marginBottom: l.type === 'err' || l.type === 'warn' ? 1 : 0,
                      borderRadius: 4,
                    }}>
                    <span className="text-[var(--fg-faint)] flex-shrink-0 select-none w-14 text-right" style={{ fontSize: 9, paddingTop: 2 }}>{l.time}</span>
                    <span className="flex-shrink-0 w-3 flex items-center">{LOG_ICON[l.type]}</span>
                    <span className={clsx('flex-1 min-w-0 whitespace-pre', {
                      'text-green-400':  l.type === 'ok',
                      'text-red-400':    l.type === 'err',
                      'text-yellow-400': l.type === 'warn',
                    })}
                    style={{
                      color: (l.type === 'ok' || l.type === 'err' || l.type === 'warn') ? undefined : 'var(--fg-muted)',
                    }}>{l.msg}</span>
                    <button
                      onClick={() => navigator.clipboard.writeText(l.msg).catch(() => {})}
                      className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center text-[var(--fg-faint)] hover:text-[var(--fg)] cursor-pointer border-0 bg-transparent flex-shrink-0 transition-opacity"
                      title="Copy line">
                      <Copy size={9} />
                    </button>
                  </div>
                )
              })
            })()}
            <div ref={endRef} />
          </div>
        </div>
      )}

      {bottomTab === 'problems' && <ProblemsTab />}

      <div className={clsx('flex-1 flex flex-col overflow-hidden', bottomTab !== 'terminal' && 'hidden')}>
        <Terminal />
      </div>

      <div className={clsx('flex-1 flex flex-col overflow-hidden', bottomTab !== 'monitor' && 'hidden')}>
        <SerialMonitor />
      </div>

      <div className={clsx('flex-1 flex flex-col overflow-hidden', bottomTab !== 'explorer' && 'hidden')}>
        <FileExplorer compact />
      </div>
    </div>
  )
}