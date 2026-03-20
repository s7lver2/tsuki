/**
 * Tauri v1 bridge — usa @tauri-apps/api directamente.
 *
 * isTauri() es la única comprobación de entorno.
 * Fuera de Tauri, las operaciones de disco/proceso lanzan error real
 * (salvo settings que usa localStorage como fallback).
 */

// ── Detección de entorno ──────────────────────────────────────────────────────

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window
}

// Log diagnóstico en consola (visible en DevTools de la app compilada)
if (typeof window !== 'undefined') {
  const inTauri = '__TAURI__' in window
  console.log('[tsuki-ide] isTauri:', inTauri)
  if (inTauri) {
    console.log('[tsuki-ide] window.__TAURI__ keys:', Object.keys((window as any).__TAURI__ ?? {}))
  }
}

// ── Invoke / Listen usando @tauri-apps/api ────────────────────────────────────

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/tauri')
  return (tauriInvoke as (cmd: string, args?: Record<string, unknown>) => Promise<T>)(cmd, args)
}

async function listen(
  event: string,
  cb: (payload: unknown) => void,
): Promise<() => void> {
  const { listen: tauriListen } = await import('@tauri-apps/api/event')
  const unlisten = await tauriListen(event, (e) => cb(e.payload))
  return unlisten
}

// ── Process spawning ──────────────────────────────────────────────────────────

export interface ProcessHandle {
  pid: number
  done: Promise<number>
  write: (line: string) => Promise<void>
  kill: () => Promise<void>
  dispose: () => void
}

/**
 * Lanza un proceso real vía Rust spawn_process y hace streaming línea a línea.
 * Si no estamos en Tauri, lanza un error en consola y rechaza la promesa.
 */
export async function spawnProcess(
  cmd: string,
  args: string[],
  cwd: string | undefined,
  onLine: (line: string, isErr: boolean) => void,
): Promise<ProcessHandle> {
  if (!isTauri()) {
    const msg = `[tsuki-ide] spawnProcess: no estamos en Tauri. Comando: ${cmd} ${args.join(' ')}`
    console.error(msg)
    onLine(`ERROR: ${msg}`, true)
    // Devolver un handle dummy que resuelve inmediatamente con error
    return {
      pid: -1,
      done: Promise.resolve(1),
      write: async () => {},
      kill: async () => {},
      dispose: () => {},
    }
  }

  const eventId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const unsubs: Array<() => void> = []

  let resolveDone!: (code: number) => void
  const done = new Promise<number>((r) => { resolveDone = r })

  const outU  = await listen(`proc://${eventId}:stdout`, (l) => onLine(l as string, false))
  const errU  = await listen(`proc://${eventId}:stderr`, (l) => onLine(l as string, true))
  const doneU = await listen(`proc://${eventId}:done`,   (code) => resolveDone(code as number))
  unsubs.push(outU, errU, doneU)

  let pid: number
  try {
    // 'exeCmd' not 'cmd' — avoids Tauri 1.x IPC dispatch key collision
    pid = await invoke<number>('spawn_process', {
      exeCmd: cmd,
      args,
      cwd: cwd ?? null,
      eventId,
    })
  } catch (e) {
    console.error('[tsuki-ide] spawn_process falló:', e)
    onLine(`ERROR al lanzar proceso: ${e}`, true)
    unsubs.forEach((f) => f())
    resolveDone(1)
    return {
      pid: -1,
      done,
      write: async () => {},
      kill: async () => {},
      dispose: () => {},
    }
  }

  return {
    pid,
    done,
    write: async (line) => invoke<void>('write_stdin', { pid, data: line }),
    kill:  async () => invoke<void>('kill_process', { pid }),
    dispose: () => unsubs.forEach((f) => f()),
  }
}

// ── Herramientas ──────────────────────────────────────────────────────────────

export async function detectTool(name: string): Promise<string> {
  if (!isTauri()) {
    console.warn('[tsuki-ide] detectTool: no estamos en Tauri')
    return `${name} (no Tauri)`
  }
  const resolved = await invoke<string>('detect_tool', { name })
  
  // Guardia: rechazar si Rust devolvió un string de versión en lugar de ruta
  const looksLikePath = resolved.includes('\\') || resolved.includes('/') || resolved.startsWith(name)
  const looksLikeVersion = /v?\d+\.\d+/.test(resolved) && !looksLikePath
  
  if (!resolved || looksLikeVersion) {
    throw new Error(`detect_tool returned invalid path: "${resolved}"`)
  }
  
  return resolved.trim()
}

// ── Diálogo de carpeta ────────────────────────────────────────────────────────

export async function pickFolder(): Promise<string | null> {
  if (!isTauri()) {
    console.warn('[tsuki-ide] pickFolder: no estamos en Tauri — devolviendo null')
    return null
  }
  try {
    const { open } = await import('@tauri-apps/api/dialog')
    const result = await open({ directory: true, multiple: false, recursive: true })
    if (!result || Array.isArray(result)) return null
    return result as string
  } catch (e) {
    console.error('[tsuki-ide] pickFolder falló:', e)
    return null
  }
}

export async function pickFile(): Promise<string | null> {
  if (!isTauri()) {
    console.warn('[tsuki-ide] pickFile: no estamos en Tauri — devolviendo null')
    return null
  }
  return invoke<string | null>('pick_file')
}

// ── Ficheros ──────────────────────────────────────────────────────────────────

export async function readFile(path: string): Promise<string> {
  if (!isTauri()) {
    console.error('[tsuki-ide] readFile: no estamos en Tauri, path:', path)
    throw new Error('readFile no disponible fuera de Tauri')
  }
  return invoke<string>('read_file', { path })
}

export async function writeFile(path: string, content: string): Promise<void> {
  if (!isTauri()) {
    console.error('[tsuki-ide] writeFile: no estamos en Tauri, path:', path)
    throw new Error('writeFile no disponible fuera de Tauri')
  }
  return invoke<void>('write_file', { path, content })
}

export async function createDirectory(path: string): Promise<void> {
  if (!isTauri()) {
    console.error('[tsuki-ide] createDirectory: no estamos en Tauri, path:', path)
    throw new Error('createDirectory no disponible fuera de Tauri')
  }
  return invoke<void>('create_dir', { path })
}

export async function deleteFile(path: string): Promise<void> {
  if (!isTauri()) {
    console.error('[tsuki-ide] deleteFile: no estamos en Tauri, path:', path)
    return
  }
  return invoke<void>('delete_file', { path })
}

export async function renamePath(oldPath: string, newPath: string): Promise<void> {
  if (!isTauri()) {
    console.error('[tsuki-ide] renamePath: no estamos en Tauri')
    return
  }
  return invoke<void>('rename_path', { oldPath, newPath })
}

// ── Directorio ────────────────────────────────────────────────────────────────

export interface DirEntry { name: string; is_dir: boolean }

/** Returns true if the given path exists on the filesystem. */
export async function pathExists(path: string): Promise<boolean> {
  if (!isTauri()) return false
  try {
    await invoke<void>('check_path_exists', { path })
    return true
  } catch {
    return false
  }
}

export async function readDirEntries(path: string): Promise<DirEntry[]> {
  if (!isTauri()) {
    console.error('[tsuki-ide] readDirEntries: no estamos en Tauri, path:', path)
    throw new Error('readDirEntries no disponible fuera de Tauri')
  }
  const json = await invoke<string>('read_dir_entries', { path })
  return JSON.parse(json) as DirEntry[]
}

// ── Configuración ─────────────────────────────────────────────────────────────

export async function loadSettings(): Promise<string> {
  if (!isTauri()) {
    // Fallback a localStorage — aceptable fuera de Tauri
    try { return localStorage.getItem('gdi-settings') ?? '{}' } catch { return '{}' }
  }
  return invoke<string>('load_settings')
}

export async function saveSettings(settings: unknown): Promise<void> {
  const json = JSON.stringify(settings, null, 2)
  if (!isTauri()) {
    try { localStorage.setItem('gdi-settings', json) } catch {}
    return
  }
  return invoke<void>('save_settings', { settings: json })
}

// ── Shell management ──────────────────────────────────────────────────────────

export interface ShellInfo {
  id:   string
  name: string
  path: string
  icon: string
}

/**
 * Returns the list of shells available on the current OS.
 * Windows: cmd, powershell, pwsh, git-bash
 * Linux/macOS: bash, zsh, fish, sh
 */
export async function listShells(): Promise<ShellInfo[]> {
  if (!isTauri()) {
    console.warn('[tsuki-ide] listShells: no estamos en Tauri')
    return []
  }
  return invoke<ShellInfo[]>('list_shells')
}

/**
 * Spawns an interactive shell session and streams its output line by line.
 * Returns a ProcessHandle identical to spawnProcess — the frontend can
 * write commands via handle.write() and kill via handle.kill().
 */
export async function spawnShell(
  shell:   ShellInfo,
  cwd:     string | undefined,
  onLine:  (line: string, isErr: boolean) => void,
): Promise<ProcessHandle> {
  if (!isTauri()) {
    const msg = `[tsuki-ide] spawnShell: no estamos en Tauri (shell=${shell.id})`
    console.error(msg)
    onLine(`ERROR: ${msg}`, true)
    return { pid: -1, done: Promise.resolve(1), write: async () => {}, kill: async () => {}, dispose: () => {} }
  }

  const eventId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const unsubs: Array<() => void> = []

  let resolveDone!: (code: number) => void
  const done = new Promise<number>((r) => { resolveDone = r })

  const outU  = await listen(`proc://${eventId}:stdout`, (l) => onLine(l as string, false))
  const errU  = await listen(`proc://${eventId}:stderr`, (l) => onLine(l as string, true))
  const doneU = await listen(`proc://${eventId}:done`,   (code) => resolveDone(code as number))
  unsubs.push(outU, errU, doneU)

  let pid: number
  try {
    console.log(
      `[spawn_shell:ts] shell=${JSON.stringify(shell)} cwd=${cwd ?? 'null'} eventId=${eventId}`
    )
    pid = await invoke<number>('spawn_shell', {
      shellId:   shell.id,
      shellPath: shell.path,
      cwd:       cwd ?? null,
      eventId,
    })
    console.log(`[spawn_shell:ts] ok pid=${pid} shell=${shell.id}`)
  } catch (e) {
    console.error(
      `[spawn_shell:ts] FAILED shell=${JSON.stringify(shell)} cwd=${cwd ?? 'null'} err=${e}`
    )
    onLine(`ERROR al lanzar shell: ${e}`, true)
    unsubs.forEach((f) => f())
    resolveDone(1)
    return { pid: -1, done, write: async () => {}, kill: async () => {}, dispose: () => {} }
  }

  return {
    pid,
    done,
    write:   async (line) => invoke<void>('write_stdin', { pid, data: line }),
    kill:    async ()     => invoke<void>('kill_process', { pid }),
    dispose: ()           => unsubs.forEach((f) => f()),
  }
}

// ── Git ───────────────────────────────────────────────────────────────────────

export async function runGit(args: string[], cwd: string): Promise<string> {
  if (!isTauri()) {
    console.warn('[tsuki-ide] runGit: no estamos en Tauri, args:', args)
    return ''
  }
  return invoke<string>('run_git', { args, cwd })
}

// ── Simulator helpers ─────────────────────────────────────────────────────────

/**
 * Runs a command and waits for it to finish, collecting all output.
 *
 * Uses spawnProcess instead of run_shell so the binary is resolved
 * via the same resolve_cmd + enriched PATH path that the toolbar buttons
 * already use successfully — fixing the Windows "not found" bug even when
 * the full absolute path is passed.
 */
export async function runShell(cmd: string, args: string[], cwd?: string): Promise<string> {
  if (!isTauri()) throw new Error('runShell: not in Tauri')

  const outLines: string[] = []
  const errLines: string[] = []

  const handle = await spawnProcess(cmd, args, cwd, (line, isErr) => {
    if (isErr) errLines.push(line)
    else outLines.push(line)
  })

  const code = await handle.done
  handle.dispose()

  if (code !== 0) {
    // Prefer stderr for error messages; fall back to stdout
    const msg = errLines.join('\n').trim() || outLines.join('\n').trim() || `exited with code ${code}`
    throw new Error(msg)
  }

  // Return stdout if present, otherwise stderr (some tools write to stderr only)
  return outLines.join('\n') || errLines.join('\n')
}

/** Returns an OS-correct writable temp path for the source being simulated. */
export async function getTmpGoPath(): Promise<string> {
  if (!isTauri()) return '/tmp/tsuki_sim_src.go'
  return invoke<string>('get_tmp_go_path')
}

/** Returns a temp path for the .sim.json bundle generated by tsuki-core. */
export async function getTmpSimBundlePath(): Promise<string> {
  if (!isTauri()) return '/tmp/tsuki_sim_bundle.sim.json'
  // Derive from the go path — same dir, different extension
  const goPath = await getTmpGoPath()
  return goPath.replace(/\.go$/, '.sim.json')
}

/** Returns the path to the tsuki-core binary. */
export async function getTsukiCoreBin(): Promise<string> {
  if (!isTauri()) return 'tsuki-core'
  try {
    const path = await invoke<string>('get_tsuki_core_bin').catch(() => '')
    return path || 'tsuki-core'
  } catch {
    return 'tsuki-core'
  }
}

/** Returns the configured tsuki binary path, or bare 'tsuki' to resolve from PATH. */
export async function getTsukiBin(): Promise<string> {
  if (!isTauri()) return 'tsuki'
  const path = await invoke<string>('get_tsuki_bin').catch(() => '')
  // If settings is empty or returns the bare fallback, use 'tsuki' from PATH
  return (path && path !== 'tsuki') ? path : 'tsuki'
}

/**
 * Returns the path to the tsuki-sim binary.
 * Preference order:
 *   1. settings.tsukiSimPath  (explicit setting)
 *   2. tsuki-sim next to the configured tsuki-core binary
 *   3. bare 'tsuki-sim' resolved from PATH
 */
export async function getTsukiSimBin(): Promise<string> {
  if (!isTauri()) return 'tsuki-sim'
  try {
    const path = await invoke<string>('get_tsuki_sim_bin').catch(() => '')
    return path || 'tsuki-sim'
  } catch {
    return 'tsuki-sim'
  }
}

/** Returns the configured default board (falls back to 'uno'). */
export async function getDefaultBoard(): Promise<string> {
  if (!isTauri()) return 'uno'
  return invoke<string>('get_default_board').catch(() => 'uno')
}

/** Returns the OS home directory (e.g. /home/user or C:\Users\user).
 *  Used to expand "~" in paths like "~/.tsuki/libs". */
export async function getHomeDir(): Promise<string | null> {
  if (!isTauri()) return null
  return invoke<string | null>('get_home_dir').catch(() => null)
}

// ── In-process transpilation ──────────────────────────────────────────────────
// These call the tsuki_core library DIRECTLY inside the Tauri process —
// no tsuki-core.exe subprocess is spawned, so they work on every OS regardless
// of PATH, install location, or exe permissions.

/**
 * Transpile a source string → C++ string, entirely in-process.
 * `lang` defaults to "go"; pass "python" for .py projects.
 * Replaces: spawnProcess(coreBin, [tmpPath, '--board', board], ...)
 */
export async function transpileSource(source: string, board: string, lang = 'go'): Promise<string> {
  if (!isTauri()) throw new Error('transpileSource: not in Tauri')
  return invoke<string>('transpile_source', { source, board, lang })
}

/**
 * Runs the tsuki simulator in-process (no tsuki-sim.exe subprocess).
 * Emits the same Tauri events as spawnProcess so the existing event
 * protocol in SandboxPanel works without changes.
 *
 * Returns a ProcessHandle-compatible object with .done, .kill(), .write(), .dispose().
 */
export async function runSimulator(
  eventId:  string,
  source:   string,
  board:    string,
  steps:    number | undefined,
  onLine:   (line: string, isErr: boolean) => void,
): Promise<ProcessHandle> {
  if (!isTauri()) throw new Error('runSimulator: not in Tauri')

  let resolveExit!: (code: number) => void
  const donePromise = new Promise<number>(r => { resolveExit = r })

  const { listen } = await import('@tauri-apps/api/event')
  const unsubs: Array<() => void> = []

  const sub = async (suffix: string, handler: (payload: string) => void) => {
    const typedListen = listen as (event: string, cb: (e: { payload: string }) => void) => Promise<() => void>
    const u = await typedListen(`proc://${eventId}:${suffix}`, e => handler(e.payload))
    unsubs.push(u)
  }

  await sub('stdout', line => onLine(line, false))
  await sub('stderr', line => onLine(line, true))
  await sub('done',   raw  => {
    const code = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
    resolveExit(isNaN(code) ? 0 : code)
    unsubs.forEach(u => u())
    unsubs.length = 0
  })

  await invoke('run_simulator', {
    eventId,
    source,
    board,
    steps: steps ?? null,
  })

  return {
    pid: -1,  // Add this line (dummy PID since this is an in-process simulator)
    done: donePromise,
    kill: async () => { await invoke('stop_simulator', { eventId }).catch(() => {}) },
    write: async (_data: string) => { /* stdin not used by simulator */ },
    dispose: () => { unsubs.forEach(u => u()); unsubs.length = 0 },
  }
}
/**
 * Transpile a source string and write a .sim.json bundle to bundlePath.
 * lang: "go" (default) or "python" — selects the tsuki-core pipeline.
 */
export async function emitSimBundle(source: string, board: string, bundlePath: string, lang = 'go'): Promise<void> {
  if (!isTauri()) throw new Error('emitSimBundle: not in Tauri')
  return invoke<void>('emit_sim_bundle', { source, board, bundlePath, lang })
}
// ── PTY sessions (xterm.js backend) ──────────────────────────────────────────
//
// These commands back the real-PTY terminal powered by portable-pty + xterm.js.
// Unlike spawn_process (anonymous pipes), a PTY makes child processes think
// they're talking to a real terminal, so output flushes line-by-line.
//
// Event protocol:
//   pty://<id>:data  — raw bytes (utf-8, may contain ANSI escape codes)
//   pty://<id>:exit  — i32 exit code

export async function ptyCreate(
  id:    string,
  cmd:   string,
  args:  string[],
  cwd:   string | undefined,
  cols:  number,
  rows:  number,
  env?:  Array<[string, string]>,   // [[key,value],…] — Rust expects Vec<[String;2]>
): Promise<void> {
  if (!isTauri()) throw new Error('ptyCreate: not in Tauri')
  // NOTE: pass 'shellCmd' not 'cmd' — Tauri 1.x uses the 'cmd' key in the
  // IPC payload to dispatch to the handler. Passing a key named 'cmd' would
  // overwrite the dispatch field with the shell path, causing Tauri to look
  // for a handler named e.g. "C:\Windows\system32\cmd.exe" and fail.
  return invoke<void>('pty_create', {
    id, shellCmd: cmd, args, cwd: cwd ?? null, cols, rows,
    env: env ?? null,
  })
}

export async function ptyWrite(id: string, data: string): Promise<void> {
  if (!isTauri()) return
  return invoke<void>('pty_write', { id, data })
}

export async function ptyResize(id: string, cols: number, rows: number): Promise<void> {
  if (!isTauri()) return
  return invoke<void>('pty_resize', { id, cols, rows })
}

export async function ptyKill(id: string): Promise<void> {
  if (!isTauri()) return
  return invoke<void>('pty_kill', { id })
}

export async function ptyOnData(
  id:      string,
  handler: (data: string) => void,
): Promise<() => void> {
  return listen(`pty://${id}:data`, handler as (payload: unknown) => void)
}

export async function ptyOnExit(
  id:      string,
  handler: (code: number) => void,
): Promise<() => void> {
  return listen(`pty://${id}:exit`, handler as (payload: unknown) => void)
}
// ── Debug / logging system ────────────────────────────────────────────────────
//
// When debugMode is enabled in settings AND we're inside Tauri, all
// console.log / console.warn / console.error calls are intercepted and
// forwarded to the Rust backend, which appends them to the debug log file.
//
// The patch is applied once (installDebugLogger) and is idempotent.
// Call it from app startup after settings are loaded.

let _debugPatchInstalled = false

/** Send a message to the Rust debug logger. No-op outside Tauri or if not patched. */
export async function logFrontend(level: 'log' | 'warn' | 'error', message: string): Promise<void> {
  if (!isTauri()) return
  try {
    await invoke<void>('log_frontend', { level, message })
  } catch {
    // Swallow — never let logging break the app
  }
}

/**
 * Patches console.log / console.warn / console.error so every call is also
 * forwarded to the Rust debug logger. Call this once at app startup when
 * debugMode === true. It is idempotent and safe to call multiple times.
 */
export function installDebugLogger(): void {
  if (_debugPatchInstalled || !isTauri()) return
  _debugPatchInstalled = true

  const original = {
    log:   console.log.bind(console),
    warn:  console.warn.bind(console),
    error: console.error.bind(console),
  }

  function fmt(args: unknown[]): string {
    return args.map(a => {
      if (typeof a === 'string') return a
      try { return JSON.stringify(a) } catch { return String(a) }
    }).join(' ')
  }

  console.log = (...args: unknown[]) => {
    original.log(...args)
    logFrontend('log', fmt(args)).catch(() => {})
  }
  console.warn = (...args: unknown[]) => {
    original.warn(...args)
    logFrontend('warn', fmt(args)).catch(() => {})
  }
  console.error = (...args: unknown[]) => {
    original.error(...args)
    logFrontend('error', fmt(args)).catch(() => {})
  }

  // Also capture unhandled promise rejections and JS errors
  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (e) => {
      logFrontend('error', `[unhandledRejection] ${e.reason}`).catch(() => {})
    })
    window.addEventListener('error', (e) => {
      logFrontend('error', `[uncaughtError] ${e.message} @ ${e.filename}:${e.lineno}`).catch(() => {})
    })
  }

  logFrontend('log', '=== debug logger installed ===').catch(() => {})
}

/** Returns the OS path of the debug log file. */
export async function getDebugLogPath(): Promise<string> {
  if (!isTauri()) return '/tmp/tsuki-ide-debug.log'
  return invoke<string>('get_debug_log_path')
}

/** Opens the debug log in the OS default text editor. */
export async function openDebugLog(): Promise<void> {
  if (!isTauri()) return
  return invoke<void>('open_debug_log')
}

/** Clears / truncates the debug log file. */
export async function clearDebugLog(): Promise<void> {
  if (!isTauri()) return
  return invoke<void>('clear_debug_log')
}

/** Returns the last `lines` lines from the debug log as a single string. */
export async function tailDebugLog(lines = 200): Promise<string> {
  if (!isTauri()) return ''
  return invoke<string>('tail_debug_log', { lines })
}

/** Push live category-flag changes to Rust without requiring a restart. */
export async function setLogCategories(cats: Record<string, boolean>): Promise<void> {
  if (!isTauri()) return
  return invoke<void>('set_log_categories', { categories: cats })
}

/** Run a full system diagnostics check and return a human-readable report. */
export async function runDiagnostics(): Promise<string> {
  if (!isTauri()) return '(diagnostics only available inside Tauri)'
  return invoke<string>('run_diagnostics')
}

// ── Updates ────────────────────────────────────────────────────────────────

export interface UpdateInfo {
  version: string
  channel: 'stable' | 'testing'
  pub_date: string
  notes: string
  platforms: Record<string, { url: string; signature: string; size: number }>
  /** If set, the IDE re-shows the onboarding wizard when updating to this version */
  forced_onboarding_version?: string
  /** If set, the IDE shows the What's New popup for this version */
  whats_new_version?: string
  /** JSON array of ChangelogEntry ({type, text}) for the What's New popup */
  whats_new_changelog?: string
}

/**
 * Fetch the update manifest for `channel` from `manifestUrl` and return the
 * UpdateInfo if a newer version is available, or throw with a human-readable
 * message if the current version is up to date or the check failed.
 */
export async function checkForUpdates(
  channel: 'stable' | 'testing',
  manifestUrl: string,
): Promise<UpdateInfo> {
  if (!isTauri()) throw new Error('checkForUpdates: not in Tauri')
  return invoke<UpdateInfo>('check_for_updates', { channel, manifestUrl })
}

/**
 * Download and apply an update from `info`. On success the app restarts.
 */
export async function applyUpdate(info: UpdateInfo): Promise<void> {
  if (!isTauri()) throw new Error('applyUpdate: not in Tauri')
  return invoke<void>('apply_update', { info })
}


/** Returns the current app version from Cargo.toml (e.g. "5.1.0"). */
export async function getAppVersion(): Promise<string> {
  if (!isTauri()) return '0.0.0'
  return invoke<string>('get_app_version')
}