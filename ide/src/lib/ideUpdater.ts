/**
 * ideUpdater.ts
 * ─────────────
 * Self-update system for tsuki-ide.
 *
 * Two strategies, tried in order:
 *
 *   v2  (primary) — uses the tsuki package manager:
 *         tsuki install tsuki-team/tsuki-ide@latest
 *       This downloads the platform-specific installer from the registry,
 *       verifies the Ed25519 signature, runs the installer, and restarts.
 *
 *   legacy (fallback) — queries the web update endpoint directly:
 *         GET https://tsuki.sh/api/update/<channel>
 *       Returns a manifest with download URLs and signature. The IDE
 *       downloads and runs the installer itself.
 *
 * The caller uses checkForUpdate() → if available, showUpdateBanner() →
 * user clicks "Install" → installUpdate().
 */

import { invoke } from '@tauri-apps/api/tauri'

// ── Types ──────────────────────────────────────────────────────────────────────

export type UpdateChannel = 'stable' | 'testing'

export type UpdateMethod = 'v2' | 'legacy'

export interface UpdateInfo {
  available:  boolean
  version:    string         // e.g. "2.3.0"
  current:    string         // current installed version
  channel:    UpdateChannel
  method:     UpdateMethod
  notes?:     string
  releaseUrl?: string
}

export interface UpdateProgress {
  stage:   'checking' | 'downloading' | 'installing' | 'done' | 'error'
  percent: number            // 0–100
  message: string
}

// ── Update check ───────────────────────────────────────────────────────────────

/**
 * Check for a newer version of tsuki-ide.
 *
 * Tries the v2 registry first; if that fails, falls back to the legacy
 * web endpoint. Returns null if already up-to-date or check failed.
 */
export async function checkForUpdate(
  channel: UpdateChannel = 'stable',
): Promise<UpdateInfo | null> {
  const current = await getCurrentVersion()

  // 1. v2 path — ask the Rust side to query the package registry
  try {
    const info = await invoke<UpdateInfo | null>('check_ide_update_v2', { channel, current })
    if (info?.available) return info
  } catch (err) {
    console.warn('[ideUpdater] v2 check failed, falling back to legacy:', err)
  }

  // 2. Legacy path — query the web endpoint
  try {
    return await checkLegacy(current, channel)
  } catch (err) {
    console.warn('[ideUpdater] legacy check failed:', err)
  }

  return null
}

/**
 * Install the update.
 *
 * Shows progress via the onProgress callback. On success, the app restarts.
 * The method field in UpdateInfo selects which strategy to use.
 */
export async function installUpdate(
  info:       UpdateInfo,
  onProgress: (p: UpdateProgress) => void,
): Promise<void> {
  if (info.method === 'v2') {
    return installV2(info, onProgress)
  }
  return installLegacy(info, onProgress)
}

// ── Current version ────────────────────────────────────────────────────────────

let _cachedVersion: string | null = null

async function getCurrentVersion(): Promise<string> {
  if (_cachedVersion) return _cachedVersion
  try {
    _cachedVersion = await invoke<string>('get_app_version')
  } catch {
    // Fallback: read from the compile-time constant injected by Tauri
    _cachedVersion = (window as any).__TAURI_METADATA__?.version ?? '0.0.0'
  }
  return _cachedVersion!
}

// ── v2 install ─────────────────────────────────────────────────────────────────

/**
 * Install via `tsuki install tsuki-team/tsuki-ide@<version>`.
 *
 * The Rust side runs the tsuki CLI as a subprocess, streams progress events
 * back to the frontend, then restarts the app.
 */
async function installV2(
  info:       UpdateInfo,
  onProgress: (p: UpdateProgress) => void,
): Promise<void> {
  onProgress({ stage: 'downloading', percent: 0, message: `Downloading tsuki-ide v${info.version}…` })

  try {
    await invoke('install_ide_update_v2', {
      version: info.version,
      channel: info.channel,
      onProgress: (p: UpdateProgress) => onProgress(p),
    })
  } catch (err) {
    onProgress({ stage: 'error', percent: 0, message: `Update failed: ${err}` })
    throw err
  }
}

// ── Legacy check & install ────────────────────────────────────────────────────

const UPDATE_ENDPOINT = 'https://tsuki.sh/api/update'

interface LegacyManifest {
  version:  string
  channel:  UpdateChannel
  pub_date: string
  notes?:   string
  platforms: Record<string, {
    url:       string
    signature: string
    size:      number
  }>
}

async function checkLegacy(
  current: string,
  channel: UpdateChannel,
): Promise<UpdateInfo | null> {
  const res = await fetch(`${UPDATE_ENDPOINT}/${channel}`, {
    cache: 'no-cache',
    headers: { 'X-Tsuki-Current': current },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const manifest: LegacyManifest = await res.json()

  if (!isNewer(manifest.version, current)) return null

  return {
    available:   true,
    version:     manifest.version,
    current,
    channel,
    method:      'legacy',
    notes:       manifest.notes,
    releaseUrl:  `https://github.com/tsuki-team/tsuki-ide/releases/tag/v${manifest.version}`,
  }
}

async function installLegacy(
  info:       UpdateInfo,
  onProgress: (p: UpdateProgress) => void,
): Promise<void> {
  onProgress({ stage: 'downloading', percent: 0, message: `Downloading tsuki-ide v${info.version}…` })

  try {
    // Fetch the manifest again to get the platform-specific URL
    const res = await fetch(`${UPDATE_ENDPOINT}/${info.channel}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const manifest: LegacyManifest = await res.json()

    // Delegate to Rust to download + verify + run installer
    await invoke('install_ide_update_legacy', {
      manifest: JSON.stringify(manifest),
      onProgress: (p: UpdateProgress) => onProgress(p),
    })
  } catch (err) {
    onProgress({ stage: 'error', percent: 0, message: `Update failed: ${err}` })
    throw err
  }
}

// ── Semver comparison ──────────────────────────────────────────────────────────

function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) =>
    v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0)
  const [cMaj, cMin, cPat] = parse(candidate)
  const [rMaj, rMin, rPat] = parse(current)
  if (cMaj !== rMaj) return cMaj > rMaj
  if (cMin !== rMin) return cMin > rMin
  return cPat > rPat
}