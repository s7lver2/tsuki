/**
 * packageRegistry.ts
 * ──────────────────
 * Loads the tsuki package list from one or more registry URLs, merging them
 * into a single deduplicated list. Later sources override earlier ones for
 * the same package name, so custom/private registries always win.
 *
 * Registry JSON shape:
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

interface RegistryVersion { [version: string]: string }

interface RegistryPackage {
  description: string
  author:      string
  latest:      string
  versions:    RegistryVersion
  source?:     string   // injected by us — which registry this came from
}

interface RegistryJson {
  packages: Record<string, RegistryPackage>
}

// ── Per-URL cache ─────────────────────────────────────────────────────────────

interface CacheEntry {
  result: PackageEntry[]
  ts:     number
}

const urlCache = new Map<string, CacheEntry>()
const CACHE_TTL = 5 * 60 * 1000   // 5 minutes

// ── Single-URL loader ─────────────────────────────────────────────────────────

async function fetchRegistry(
  url:             string,
  currentPackages: PackageEntry[],
  force:           boolean,
): Promise<PackageEntry[]> {
  const now     = Date.now()
  const cached  = urlCache.get(url)
  if (!force && cached && (now - cached.ts) < CACHE_TTL) return cached.result

  const res  = await fetch(url, { cache: 'no-cache' })
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
      source:    url,
    })
  )

  urlCache.set(url, { result: entries, ts: now })
  return entries
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load packages from one primary URL plus any number of extra URLs,
 * merging them into a single list. Packages from later URLs override
 * earlier ones (so private/custom registries always win over the default).
 *
 * Errors from individual URLs are logged but don't abort the whole load.
 */
export async function loadRegistry(
  primaryUrl:      string,
  currentPackages: PackageEntry[] = [],
  force            = false,
  extraUrls:       string[]       = [],
): Promise<PackageEntry[]> {
  const allUrls = [primaryUrl, ...extraUrls].filter(u => u?.trim())
  if (allUrls.length === 0) return currentPackages

  // Fetch all sources concurrently
  const results = await Promise.allSettled(
    allUrls.map(url => fetchRegistry(url.trim(), currentPackages, force))
  )

  // Merge: later sources override earlier for same package name
  const merged = new Map<string, PackageEntry>()
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const pkg of r.value) merged.set(pkg.name, pkg)
    } else {
      console.warn('[tsuki-ide] packageRegistry: failed to load a source:', r.reason)
    }
  }

  // If all failed, return current packages unchanged
  if (merged.size === 0) return currentPackages

  // Re-apply installed state from current packages (local truth wins)
  const installedMap = new Map<string, boolean>(
    currentPackages.map(p => [p.name, p.installed])
  )
  const entries = Array.from(merged.values()).map(pkg => ({
    ...pkg,
    installed: installedMap.get(pkg.name) ?? pkg.installed,
  }))

  return entries
}

/**
 * Invalidate the cache for a specific URL, or all URLs if none given.
 */
export function invalidateRegistryCache(url?: string) {
  if (url) urlCache.delete(url)
  else urlCache.clear()
}