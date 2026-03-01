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
  return tauriInvoke<T>(cmd, args)
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
    pid = await invoke<number>('spawn_process', {
      cmd,
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
  return invoke<string>('detect_tool', { name })
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

// ── Git ───────────────────────────────────────────────────────────────────────

export async function runGit(args: string[], cwd: string): Promise<string> {
  if (!isTauri()) {
    console.warn('[tsuki-ide] runGit: no estamos en Tauri, args:', args)
    return ''
  }
  return invoke<string>('run_git', { args, cwd })
}