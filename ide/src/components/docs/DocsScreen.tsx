'use client'
// ─────────────────────────────────────────────────────────────────────────────
//  DocsScreen.tsx
//
//  Shell component for the documentation viewer.
//  Responsible for: top bar (incl. lang toggle), sidebar navigation,
//  search overlay, content area, and i18n context for all pages.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo, useRef, useEffect } from 'react'
import { ArrowLeft, Search, ChevronRight, BookOpen, X, Hash, Languages } from 'lucide-react'
import { clsx } from 'clsx'

import { useStore } from '@/lib/store'
import { SECTIONS, ALL_PAGES, getSectionLabel, type DocPage } from './DocsData'
import { DocsI18nProvider, type DocsLang } from './DocsPrimitives'

// ── Search overlay ────────────────────────────────────────────────────────────

interface SearchOverlayProps {
  onClose: () => void
  onNavigate: (id: string) => void
}

function SearchOverlay({ onClose, onNavigate }: SearchOverlayProps) {
  const [query, setQuery]       = useState('')
  const [cursor, setCursor]     = useState(-1)
  const inputRef                = useRef<HTMLInputElement>(null)
  const listRef                 = useRef<HTMLDivElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const results = useMemo<DocPage[]>(() => {
    if (!query.trim()) return ALL_PAGES.slice(0, 6)   // show recents when empty
    const q = query.toLowerCase()
    return ALL_PAGES.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.tags.some(t => t.includes(q)) ||
      p.section.includes(q)
    ).slice(0, 8)
  }, [query])

  // Reset cursor when results change
  useEffect(() => { setCursor(-1) }, [results])

  // Scroll active item into view
  useEffect(() => {
    if (cursor < 0) return
    const el = listRef.current?.querySelectorAll('[data-result]')[cursor] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(c => Math.min(c + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => Math.max(c - 1, 0))
    } else if (e.key === 'Enter' && cursor >= 0 && results[cursor]) {
      e.preventDefault()
      onNavigate(results[cursor].id)
    }
  }

  // Highlight matched chars in title
  function highlightMatch(text: string, q: string) {
    if (!q.trim()) return <span>{text}</span>
    const idx = text.toLowerCase().indexOf(q.toLowerCase())
    if (idx < 0) return <span>{text}</span>
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: 'color-mix(in srgb, var(--fg-muted) 20%, transparent)', color: 'var(--fg)', borderRadius: 2, padding: '0 1px' }}>
          {text.slice(idx, idx + q.length)}
        </mark>
        {text.slice(idx + q.length)}
      </>
    )
  }

  const isEmptyQuery = query.trim() === ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[13vh] px-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.4)' }}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
          <Search size={14} className="text-[var(--fg-muted)] flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search documentation…"
            className="flex-1 bg-transparent border-0 outline-none text-sm text-[var(--fg)] placeholder:text-[var(--fg-faint)]"
            style={{ fontFamily: 'var(--font-sans)' }}
          />
          {query ? (
            <button
              onClick={() => { setQuery(''); inputRef.current?.focus() }}
              className="text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer p-0.5 rounded"
            >
              <X size={12} />
            </button>
          ) : (
            <kbd className="text-[9px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] border border-[var(--border)] rounded px-1.5 py-0.5">ESC</kbd>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: 340 }}>
          {isEmptyQuery && (
            <div className="px-4 pt-2.5 pb-1">
              <span className="text-[10px] font-mono text-[var(--fg-faint)] uppercase tracking-widest">All pages</span>
            </div>
          )}
          {!isEmptyQuery && results.length === 0 && (
            <div className="px-4 py-10 text-center">
              <div className="text-sm text-[var(--fg-faint)] mb-1">No results for</div>
              <div className="text-sm font-medium text-[var(--fg)]">"{query}"</div>
            </div>
          )}
          {results.map((page, i) => (
            <button
              key={page.id}
              data-result
              onClick={() => onNavigate(page.id)}
              onMouseEnter={() => setCursor(i)}
              className="w-full flex items-center gap-3 px-4 py-2.5 border-0 cursor-pointer text-left border-b border-[var(--border)] last:border-0 bg-transparent"
              style={{
                background: cursor === i ? 'var(--hover)' : 'transparent',
                transition: 'background 0.08s',
              }}
            >
              <Hash size={12} className="text-[var(--fg-faint)] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--fg)] truncate">
                  {highlightMatch(page.title, query)}
                </div>
                <div className="text-[11px] text-[var(--fg-faint)] truncate" style={{ fontFamily: 'var(--font-sans)' }}>
                  {getSectionLabel(page.section)}
                </div>
              </div>
              <div className="flex gap-1.5 items-center flex-shrink-0">
                {page.tags.slice(0, 2).map(t => (
                  <span key={t} className="text-[9px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded">
                    {t}
                  </span>
                ))}
                <ChevronRight size={10} className="text-[var(--fg-faint)]" style={{ opacity: cursor === i ? 1 : 0, transition: 'opacity 0.1s' }} />
              </div>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-[var(--border)] flex items-center gap-3 text-[10px] text-[var(--fg-faint)]">
          <span><kbd className="font-mono bg-[var(--surface-3)] border border-[var(--border)] rounded px-1.5 py-0.5">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono bg-[var(--surface-3)] border border-[var(--border)] rounded px-1.5 py-0.5">↵</kbd> open</span>
          <span><kbd className="font-mono bg-[var(--surface-3)] border border-[var(--border)] rounded px-1.5 py-0.5">ESC</kbd> close</span>
          <span className="ml-auto">{results.length} result{results.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function DocsScreen() {
  const { goBack, settings, updateSetting } = useStore()
  const [activeId, setActiveId]     = useState(ALL_PAGES[0].id)
  const [searchOpen, setSearchOpen] = useState(false)

  const lang    = (settings.docsLang ?? 'en') as DocsLang
  const setLang = (l: DocsLang) => updateSetting('docsLang', l)

  const activePage = ALL_PAGES.find(p => p.id === activeId) ?? ALL_PAGES[0]

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(o => !o)
      }
      if (e.key === 'Escape') setSearchOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function navigate(id: string) {
    setActiveId(id)
    setSearchOpen(false)
  }

  return (
    <DocsI18nProvider lang={lang} setLang={setLang}>
      <div className="h-screen flex flex-col bg-[var(--surface)] text-[var(--fg)] rounded-[10px] overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_0_0_1px_var(--chrome-border,#1e2022)]">

        {/* Top bar */}
        <div className="h-11 flex items-center px-4 gap-3 border-b border-[var(--border)] flex-shrink-0">
          <button
            onClick={goBack}
            className="flex items-center gap-1.5 text-sm text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors border-0 bg-transparent cursor-pointer px-1.5 py-1 rounded hover:bg-[var(--hover)]"
          >
            <ArrowLeft size={13} /> Back
          </button>
          <div className="w-px h-4 bg-[var(--border)]" />
          <div className="flex items-center gap-2">
            <BookOpen size={13} className="text-[var(--fg-muted)]" />
            <span className="text-sm font-semibold">Docs</span>
            <span className="text-[9px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded">wip</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* Lang toggle */}
            <button
              onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
              title={lang === 'en' ? 'Cambiar a español' : 'Switch to English'}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-[var(--border)] bg-transparent text-[var(--fg-muted)] hover:text-[var(--fg)] hover:border-[var(--fg-faint)] transition-colors cursor-pointer"
            >
              <Languages size={12} />
              <span className="text-[10px] font-mono font-semibold">
                {lang === 'en' ? 'EN' : 'ES'}
              </span>
            </button>
            {/* Search */}
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-1)] text-sm text-[var(--fg-muted)] hover:text-[var(--fg)] hover:border-[var(--fg-faint)] transition-colors cursor-pointer min-w-[180px]"
            >
              <Search size={12} />
              <span className="flex-1 text-left text-xs">
                {lang === 'en' ? 'Search docs…' : 'Buscar en la documentación…'}
              </span>
              <kbd className="text-[9px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] border border-[var(--border)] rounded px-1">⌘K</kbd>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">

          {/* Sidebar */}
          <div className="w-52 border-r border-[var(--border)] bg-[var(--surface-1)] overflow-y-auto flex-shrink-0 py-3">
            {SECTIONS.map(section => (
              <div key={section.id} className="mb-3">
                <div className="px-4 py-1 mb-0.5">
                  <span className="text-[10px] font-semibold text-[var(--fg-faint)] uppercase tracking-widest">
                    {section.label}
                  </span>
                </div>
                {section.pages.map(page => (
                  <button
                    key={page.id}
                    onClick={() => navigate(page.id)}
                    className={clsx(
                      'w-full flex items-center gap-2 px-4 py-1.5 text-sm border-0 cursor-pointer text-left transition-colors',
                      activeId === page.id
                        ? 'bg-[var(--active)] text-[var(--fg)] font-medium'
                        : 'bg-transparent text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
                    )}
                  >
                    <span className="flex-1 truncate">{page.title}</span>
                    {page.wip && (
                      <span className="text-[8px] font-mono text-[var(--fg-faint)] opacity-50">wip</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="flex items-center gap-1.5 px-10 pt-6 pb-0 text-xs text-[var(--fg-faint)]">
              <span>{getSectionLabel(activePage.section)}</span>
              <ChevronRight size={10} />
              <span className="text-[var(--fg-muted)]">{activePage.title}</span>
            </div>

            <div className="max-w-2xl px-10 py-6">
              <div className="flex items-center gap-3 mb-6">
                <h1 className="text-2xl font-semibold tracking-tight">{activePage.title}</h1>
                {activePage.wip && (
                  <span className="text-xs font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] border border-[var(--border)] px-2 py-0.5 rounded-full">
                    wip
                  </span>
                )}
              </div>
              <div className="prose-docs">
                {activePage.content}
              </div>
            </div>
          </div>
        </div>

        {searchOpen && (
          <SearchOverlay
            onClose={() => setSearchOpen(false)}
            onNavigate={navigate}
          />
        )}
      </div>
    </DocsI18nProvider>
  )
}