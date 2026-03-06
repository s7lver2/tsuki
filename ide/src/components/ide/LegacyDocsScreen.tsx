'use client'
import { useStore } from '@/lib/store'
import { useState, useMemo, useRef, useEffect } from 'react'
import { ArrowLeft, Search, ChevronRight, BookOpen, X, Hash, ExternalLink } from 'lucide-react'
import { clsx } from 'clsx'

// ─────────────────────────────────────────────────────────────────────────────
//  Docs data model
// ─────────────────────────────────────────────────────────────────────────────

interface DocPage {
  id: string
  title: string
  section: string
  tags?: string[]
  content: React.ReactNode
  wip?: boolean
}

interface DocSection {
  id: string
  label: string
  pages: DocPage[]
}

// ─────────────────────────────────────────────────────────────────────────────
//  Content — WIP placeholder with real structure ready to fill
// ─────────────────────────────────────────────────────────────────────────────

function WipPage({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center select-none">
      <div className="w-12 h-12 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] flex items-center justify-center">
        <BookOpen size={22} className="text-[var(--fg-faint)]" />
      </div>
      <div>
        <div className="text-base font-semibold mb-1">{title}</div>
        <div className="text-sm text-[var(--fg-muted)]">wip</div>
      </div>
    </div>
  )
}

const SECTIONS: DocSection[] = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    pages: [
      { id: 'introduction',   title: 'Introduction',        section: 'getting-started', tags: ['tsuki', 'overview'],         content: <WipPage title="Introduction" />,        wip: true },
      { id: 'installation',   title: 'Installation',        section: 'getting-started', tags: ['install', 'setup'],          content: <WipPage title="Installation" />,        wip: true },
      { id: 'first-project',  title: 'Your First Project',  section: 'getting-started', tags: ['project', 'blink', 'hello'], content: <WipPage title="Your First Project" />,  wip: true },
      { id: 'ide-tour',       title: 'IDE Tour',            section: 'getting-started', tags: ['ide', 'ui', 'interface'],    content: <WipPage title="IDE Tour" />,            wip: true },
    ],
  },
  {
    id: 'language',
    label: 'Go for Arduino',
    pages: [
      { id: 'go-basics',      title: 'Go Basics',           section: 'language', tags: ['go', 'syntax', 'basics'],           content: <WipPage title="Go Basics" />,           wip: true },
      { id: 'arduino-pkg',    title: 'arduino package',     section: 'language', tags: ['arduino', 'package', 'import'],     content: <WipPage title="arduino package" />,     wip: true },
      { id: 'pins',           title: 'Pins & GPIO',         section: 'language', tags: ['pins', 'gpio', 'digital', 'analog'],content: <WipPage title="Pins & GPIO" />,         wip: true },
      { id: 'serial',         title: 'Serial Communication',section: 'language', tags: ['serial', 'uart', 'print'],          content: <WipPage title="Serial Communication" />,wip: true },
      { id: 'libraries',      title: 'Using Libraries',     section: 'language', tags: ['library', 'import', 'servo', 'i2c'],content: <WipPage title="Using Libraries" />,     wip: true },
      { id: 'types',          title: 'Types & Limits',      section: 'language', tags: ['types', 'uint8', 'int', 'limits'],  content: <WipPage title="Types & Limits" />,      wip: true },
    ],
  },
  {
    id: 'build',
    label: 'Build & Flash',
    pages: [
      { id: 'tsuki-build',    title: 'tsuki build',         section: 'build', tags: ['build', 'compile', 'cli'],            content: <WipPage title="tsuki build" />,         wip: true },
      { id: 'boards',         title: 'Supported Boards',    section: 'build', tags: ['boards', 'uno', 'nano', 'mega'],      content: <WipPage title="Supported Boards" />,    wip: true },
      { id: 'tsuki-flash',    title: 'tsuki-flash',         section: 'build', tags: ['flash', 'upload', 'avr', 'avrdude'], content: <WipPage title="tsuki-flash" />,         wip: true },
      { id: 'modules',        title: 'SDK Modules',         section: 'build', tags: ['modules', 'sdk', 'arduino', 'avr'],  content: <WipPage title="SDK Modules" />,         wip: true },
      { id: 'tsuki-package',  title: 'tsuki_package.json',  section: 'build', tags: ['config', 'json', 'package'],         content: <WipPage title="tsuki_package.json" />,  wip: true },
    ],
  },
  {
    id: 'experiments',
    label: 'Experiments',
    pages: [
      { id: 'experiments-intro', title: 'About Experiments', section: 'experiments', tags: ['experiments', 'beta'],         content: <WipPage title="About Experiments" />,   wip: true },
      { id: 'sandbox',           title: 'Sandbox Simulator', section: 'experiments', tags: ['sandbox', 'simulator', 'circuit'], content: <WipPage title="Sandbox Simulator" />, wip: true },
    ],
  },
  {
    id: 'reference',
    label: 'API Reference',
    pages: [
      { id: 'ref-arduino',    title: 'arduino.*',           section: 'reference', tags: ['api', 'reference', 'arduino'],   content: <WipPage title="arduino.*" />,           wip: true },
      { id: 'ref-fmt',        title: 'fmt.*',               section: 'reference', tags: ['api', 'fmt', 'print'],           content: <WipPage title="fmt.*" />,               wip: true },
      { id: 'ref-cli',        title: 'CLI flags',           section: 'reference', tags: ['cli', 'flags', 'commands'],      content: <WipPage title="CLI flags" />,           wip: true },
    ],
  },
]

const ALL_PAGES = SECTIONS.flatMap(s => s.pages)

// ─────────────────────────────────────────────────────────────────────────────
//  DocsScreen
// ─────────────────────────────────────────────────────────────────────────────

export default function DocsScreen() {
  const { goBack } = useStore()
  const [activeId, setActiveId]   = useState(ALL_PAGES[0].id)
  const [query, setQuery]         = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const activePage = ALL_PAGES.find(p => p.id === activeId) ?? ALL_PAGES[0]

  // ── search ──────────────────────────────────────────────────────────────────
  const results = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    return ALL_PAGES.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.tags?.some(t => t.includes(q)) ||
      p.section.includes(q)
    ).slice(0, 8)
  }, [query])

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

  // Keyboard shortcut: Cmd/Ctrl+K
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
    setQuery('')
  }

  return (
    <div className="h-screen flex flex-col bg-[var(--surface)] text-[var(--fg)]">

      {/* ── Top bar ── */}
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

        {/* Search trigger */}
        <div className="ml-auto">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-1)] text-sm text-[var(--fg-muted)] hover:text-[var(--fg)] hover:border-[var(--fg-faint)] transition-colors cursor-pointer min-w-[180px]"
          >
            <Search size={12} />
            <span className="flex-1 text-left text-xs">Search docs…</span>
            <kbd className="text-[9px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] border border-[var(--border)] rounded px-1">⌘K</kbd>
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Sidebar ── */}
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

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 px-10 pt-6 pb-0 text-xs text-[var(--fg-faint)]">
            <span>{SECTIONS.find(s => s.id === activePage.section)?.label}</span>
            <ChevronRight size={10} />
            <span className="text-[var(--fg-muted)]">{activePage.title}</span>
          </div>

          <div className="max-w-2xl px-10 py-6">
            {/* Page title */}
            <div className="flex items-center gap-3 mb-6">
              <h1 className="text-2xl font-semibold tracking-tight">{activePage.title}</h1>
              {activePage.wip && (
                <span className="text-xs font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] border border-[var(--border)] px-2 py-0.5 rounded-full">
                  wip
                </span>
              )}
            </div>

            {/* Content */}
            <div className="prose-docs">
              {activePage.content}
            </div>
          </div>
        </div>
      </div>

      {/* ── Search overlay ── */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Input */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border)]">
              <Search size={15} className="text-[var(--fg-muted)] flex-shrink-0" />
              <input
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search documentation…"
                className="flex-1 bg-transparent border-0 outline-none text-sm text-[var(--fg)] placeholder:text-[var(--fg-faint)]"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer"
                >
                  <X size={13} />
                </button>
              )}
              <kbd className="text-[9px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] border border-[var(--border)] rounded px-1.5 py-0.5">ESC</kbd>
            </div>

            {/* Results */}
            <div className="max-h-80 overflow-y-auto">
              {query.trim() === '' && (
                <div className="px-4 py-8 text-center text-sm text-[var(--fg-faint)]">
                  Type to search across all documentation
                </div>
              )}
              {query.trim() !== '' && results.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-[var(--fg-faint)]">
                  No results for <span className="text-[var(--fg)] font-medium">"{query}"</span>
                </div>
              )}
              {results.map((page, i) => {
                const section = SECTIONS.find(s => s.id === page.section)
                return (
                  <button
                    key={page.id}
                    onClick={() => navigate(page.id)}
                    className={clsx(
                      'w-full flex items-center gap-3 px-4 py-3 border-0 cursor-pointer text-left transition-colors border-b border-[var(--border-subtle)] last:border-0',
                      'bg-transparent hover:bg-[var(--hover)]',
                    )}
                  >
                    <Hash size={13} className="text-[var(--fg-faint)] flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--fg)] truncate">{page.title}</div>
                      <div className="text-xs text-[var(--fg-faint)] truncate">{section?.label}</div>
                    </div>
                    {page.tags?.slice(0, 3).map(t => (
                      <span key={t} className="text-[9px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded flex-shrink-0">
                        {t}
                      </span>
                    ))}
                    <ChevronRight size={11} className="text-[var(--fg-faint)] flex-shrink-0" />
                  </button>
                )
              })}
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2.5 border-t border-[var(--border)] flex items-center gap-3 text-[10px] text-[var(--fg-faint)]">
              <span><kbd className="font-mono bg-[var(--surface-3)] border border-[var(--border)] rounded px-1">↑↓</kbd> navigate</span>
              <span><kbd className="font-mono bg-[var(--surface-3)] border border-[var(--border)] rounded px-1">↵</kbd> open</span>
              <span><kbd className="font-mono bg-[var(--surface-3)] border border-[var(--border)] rounded px-1">ESC</kbd> close</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}