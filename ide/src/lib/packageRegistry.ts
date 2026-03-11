/**
 * packageRegistry.ts
 * ──────────────────
 * Loads the tsuki package list dynamically from the configured registry URL
 * (settings.registryUrl). Falls back to an empty list on failure — never
 * throws to the caller.
 *
 * Registry JSON shape (packages.json / registry.json):
 * {
 *   "packages": {
 *     "<name>": {
 *       "description": "...",
 *       "author": "...",
 *       "latest": "1.0.0",
 *       "versions": { "1.0.0": "<toml-url>" }
 *     }
 *   }
 * }
 */

import type { PackageEntry } from '@/lib/store'

// ── Registry JSON types ───────────────────────────────────────────────────────

interface RegistryVersion {
  [version: string]: string   // version → toml URL
}

interface RegistryPackage {
  description: string
  author:      string
  latest:      string
  versions:    RegistryVersion
}

interface RegistryJson {
  packages: Record<string, RegistryPackage>
}

// ── In-memory cache (per session) ────────────────────────────────────────────

let cachedUrl    = ''
let cachedResult: PackageEntry[] | null = null

/**
 * Fetch and parse the registry at `url`.
 * Results are cached for the session — pass `force = true` to bypass.
 *
 * The function merges registry info with any locally-known installed state
 * (passed in via `currentPackages`) so toggled installs are preserved.
 */
export async function loadRegistry(
  url:             string,
  currentPackages: PackageEntry[] = [],
  force            = false,
): Promise<PackageEntry[]> {
  if (!force && cachedUrl === url && cachedResult) return cachedResult

  try {
    const res = await fetch(url, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json: RegistryJson = await res.json()

    const installedMap = new Map<string, boolean>(
      currentPackages.map(p => [p.name, p.installed])
    )

    const entries: PackageEntry[] = Object.entries(json.packages).map(
      ([name, pkg]) => ({
        name,
        desc:      pkg.description,
        version:   `v${pkg.latest}`,
        url:       pkg.versions[pkg.latest] ?? '',
        installed: installedMap.get(name) ?? false,
      })
    )

    cachedUrl    = url
    cachedResult = entries
    return entries

  } catch (err) {
    console.warn('[tsuki-ide] packageRegistry: failed to load', url, err)
    // Return current packages unchanged so the UI isn't wiped on network error
    return currentPackages
  }
}

/**
 * Invalidate the in-memory cache (e.g. after a pkg install/remove).
 */
export function invalidateRegistryCache() {
  cachedResult = null
  cachedUrl    = ''
}