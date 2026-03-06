/**
 * i18n — Tsuki IDE internationalisation system
 *
 * Usage:
 *   const t = useT()
 *   t('welcome.newProject')          // → "New Project" | "Nuevo Proyecto"
 *   t('common.cancel')               // → "Cancel" | "Cancelar"
 *
 * Language packs live in /locales/*.json and are imported statically so
 * Next.js can tree-shake unused keys in production builds.
 */

import { useMemo } from 'react'
import { useStore } from '@/lib/store'
import en from '@/locales/en.json'
import es from '@/locales/es.json'

// ── Types ─────────────────────────────────────────────────────────────────────

export type LangCode = 'en' | 'es'

export interface LangMeta {
  code:       LangCode
  name:       string
  nativeName: string
  flag:       string
  version:    string
  author:     string
}

type LocaleTree = Record<string, Record<string, string>>
type FlatMap    = Record<string, string>

// ── Packs registry ────────────────────────────────────────────────────────────

const PACKS: Record<LangCode, LocaleTree> = { en, es } as Record<LangCode, LocaleTree>

export const LANG_META: Record<LangCode, LangMeta> = {
  en: en._meta as unknown as LangMeta,
  es: es._meta as unknown as LangMeta,
}

export const AVAILABLE_LANGS: LangCode[] = ['en', 'es']

// ── Flattening helper ─────────────────────────────────────────────────────────

/**
 * Flatten a two-level locale tree into dot-notation keys.
 * e.g. { welcome: { newProject: "New Project" } }
 *   → { "welcome.newProject": "New Project" }
 */
function flatten(tree: LocaleTree): FlatMap {
  const out: FlatMap = {}
  for (const [ns, entries] of Object.entries(tree)) {
    if (ns === '_meta') continue
    for (const [key, val] of Object.entries(entries)) {
      if (typeof val === 'string') out[`${ns}.${key}`] = val
    }
  }
  return out
}

const FLAT: Record<LangCode, FlatMap> = {
  en: flatten(en as unknown as LocaleTree),
  es: flatten(es as unknown as LocaleTree),
}

// ── Translation function factory ──────────────────────────────────────────────

type TFunc = (key: string, fallback?: string) => string

function makeT(lang: LangCode): TFunc {
  const primary  = FLAT[lang]
  const fallback = FLAT['en']
  return (key: string, fb?: string): string =>
    primary[key] ?? fallback[key] ?? fb ?? key
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useT(): TFunc {
  const lang = useStore(s => (s.settings.language ?? 'en') as LangCode)
  return useMemo(() => makeT(lang), [lang])
}

/** Standalone translation outside React (e.g. in store actions) */
export function getT(lang: LangCode = 'en'): TFunc {
  return makeT(lang)
}