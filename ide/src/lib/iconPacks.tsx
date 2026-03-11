import React from 'react'

// ── Icon pack types ───────────────────────────────────────────────────────────

export interface IconPackDef {
  id: string
  name: string
  desc: string
  preview: string[]  // emoji/char preview
  fileIcon:   (ext?: string, open?: boolean) => React.ReactNode
  folderIcon: (open?: boolean) => React.ReactNode
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const EXT_COLORS: Record<string, string> = {
  go:        '#6ba4e0',
  json:      '#e0b96b',
  md:        '#7ec89c',
  cpp:       '#e07898',
  ino:       '#70c8c0',
  h:         '#c8a870',
  txt:       '#8c8c8c',
  gitignore: '#666',
  toml:      '#d4a76a',
  yaml:      '#a0c4ff',
  yml:       '#a0c4ff',
  ts:        '#4db8ff',
  tsx:       '#61dafb',
  js:        '#f7df1e',
  jsx:       '#61dafb',
  rs:        '#f74c00',
  py:        '#3572a5',
  css:       '#563d7c',
  html:      '#e34c26',
  svg:       '#ffb13b',
  png:       '#b76ef0',
  jpg:       '#b76ef0',
}

const EXT_LABELS: Record<string, string> = {
  go: 'Go', cpp: 'C++', ino: 'Ino', h: '.h', ts: 'TS', tsx: 'TSX',
  js: 'JS', jsx: 'JSX', rs: 'RS', py: 'PY', md: 'MD',
}

// ── PACK 1: Minimal (monochrome, text badges) ─────────────────────────────────

const minimal: IconPackDef = {
  id: 'minimal',
  name: 'Minimal',
  desc: 'Clean monochrome icons with small text labels',
  preview: ['📄', '📁', '⬛'],
  fileIcon(ext) {
    const label = ext ? (EXT_LABELS[ext] ?? ext.slice(0,3).toUpperCase()) : '···'
    return (
      <span
        className="font-mono font-bold leading-none flex-shrink-0 select-none"
        style={{ fontSize: 9, width: 13, color: 'var(--fg-muted)' }}
      >{label.slice(0,2)}</span>
    )
  },
  folderIcon(open) {
    return open
      ? <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="0.5" y="3.5" width="12" height="8" rx="1.5" fill="var(--fg-faint)" opacity="0.6"/><rect x="0.5" y="1.5" width="5" height="3" rx="1" fill="var(--fg-faint)" opacity="0.6"/></svg>
      : <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="0.5" y="3.5" width="12" height="8" rx="1.5" fill="var(--fg-faint)" opacity="0.4"/><rect x="0.5" y="1.5" width="5" height="3" rx="1" fill="var(--fg-faint)" opacity="0.4"/></svg>
  },
}

// ── PACK 2: Colored (vibrant per-extension colors) ────────────────────────────

const colored: IconPackDef = {
  id: 'colored',
  name: 'Colored',
  desc: 'Vibrant colors per file type, inspired by Material Icon Theme',
  preview: ['🔵', '🟡', '🟢'],
  fileIcon(ext) {
    const color  = EXT_COLORS[ext ?? ''] ?? '#8c8c8c'
    const label  = ext ? (EXT_LABELS[ext] ?? ext.slice(0,3)) : '···'
    return (
      <span
        className="font-mono font-bold leading-none flex-shrink-0 select-none"
        style={{ fontSize: 9, width: 13, color }}
      >{label.slice(0,2)}</span>
    )
  },
  folderIcon(open) {
    const fill = open ? '#e0c060' : '#c8a840'
    return (
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
        <rect x="0.5" y="3.5" width="12" height="8" rx="1.5" fill={fill} />
        <rect x="0.5" y="1.5" width="5" height="3" rx="1" fill={open ? '#f0d070' : fill} />
        {open && <rect x="1" y="6" width="11" height="1" fill="#ffffff" opacity="0.15" rx="0.5"/>}
      </svg>
    )
  },
}

// ── PACK 3: Neon (cyberpunk glow aesthetic) ───────────────────────────────────

const NEON: Record<string, string> = {
  go:   '#00ffcc', json: '#ffcc00', md: '#00ff88',
  cpp:  '#ff4488', ino: '#00ccff', h: '#ff8844',
  ts:   '#007fff', tsx: '#00d4ff', js: '#ffe000',
  rs:   '#ff6600', py:  '#00aaff', default: '#cc88ff',
}

const neon: IconPackDef = {
  id: 'neon',
  name: 'Neon',
  desc: 'Cyberpunk glow style with vivid accent colors',
  preview: ['💎', '⚡', '🌙'],
  fileIcon(ext) {
    const color = NEON[ext ?? ''] ?? NEON.default
    const label = ext ? (EXT_LABELS[ext] ?? ext.slice(0,2).toUpperCase()) : '··'
    return (
      <span
        className="font-mono font-bold leading-none flex-shrink-0 select-none"
        style={{
          fontSize: 9, width: 13, color,
          textShadow: `0 0 6px ${color}88`,
        }}
      >{label.slice(0,2)}</span>
    )
  },
  folderIcon(open) {
    const color = open ? '#00ffcc' : '#00cc99'
    return (
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
        <rect x="0.5" y="3.5" width="12" height="8" rx="1.5"
          fill={color} fillOpacity={open ? 0.25 : 0.15}
          stroke={color} strokeWidth="0.8" strokeOpacity={open ? 0.8 : 0.5} />
        <rect x="0.5" y="1.5" width="5" height="3" rx="1"
          fill={color} fillOpacity={open ? 0.3 : 0.2}
          stroke={color} strokeWidth="0.8" strokeOpacity={open ? 0.8 : 0.5} />
      </svg>
    )
  },
}

// ── PACK 4: Rounded (soft bubbles / pill style) ───────────────────────────────

const ROUND_BG: Record<string, string> = {
  go:   '#1a3a5c', json: '#4a3a00', md: '#1a3a2a',
  cpp:  '#3a1a2a', ino: '#0a2a3a', h: '#3a2a1a',
  ts:   '#0a2050', tsx: '#0a2a3a', js: '#3a3000',
  rs:   '#3a1a00', py:  '#0a2a50', default: '#2a2a3a',
}

const rounded: IconPackDef = {
  id: 'rounded',
  name: 'Rounded',
  desc: 'Soft pill badges with colored backgrounds per language',
  preview: ['🟣', '🔷', '🔶'],
  fileIcon(ext) {
    const bg    = ROUND_BG[ext ?? ''] ?? ROUND_BG.default
    const color = EXT_COLORS[ext ?? ''] ?? '#8c8c8c'
    const label = ext ? (EXT_LABELS[ext] ?? ext.slice(0,2)) : '··'
    return (
      <span
        className="font-mono font-bold leading-none flex-shrink-0 select-none flex items-center justify-center rounded"
        style={{
          fontSize: 8, width: 14, height: 12,
          background: bg, color,
        }}
      >{label.slice(0,2)}</span>
    )
  },
  folderIcon(open) {
    const bg = open ? '#2a2820' : '#1e1c18'
    const fill = open ? '#e0c060' : '#a08040'
    return (
      <span
        className="flex-shrink-0 flex items-center justify-center rounded"
        style={{ width: 14, height: 12, background: bg }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <rect x="0" y="2.5" width="10" height="7" rx="1.5" fill={fill} />
          <rect x="0" y="0.5" width="4" height="3" rx="1" fill={fill} opacity="0.7" />
        </svg>
      </span>
    )
  },
}

// ── PACK 5: Classic (pixel/retro style) ──────────────────────────────────────

const classic: IconPackDef = {
  id: 'classic',
  name: 'Classic',
  desc: 'Retro pixel-art style reminiscent of early IDEs',
  preview: ['📃', '📂', '🗂'],
  fileIcon(ext) {
    return (
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="flex-shrink-0">
        <rect x="1" y="0.5" width="8" height="12" rx="0.5" fill="var(--surface-4)" stroke="var(--fg-faint)" strokeWidth="0.8" />
        <path d="M7.5 0.5 L7.5 3.5 L11 3.5" fill="none" stroke="var(--fg-faint)" strokeWidth="0.8" />
        <rect x="2.5" y="5" width="5" height="0.8" rx="0.4" fill="var(--fg-faint)" opacity="0.7" />
        <rect x="2.5" y="7" width="4" height="0.8" rx="0.4" fill="var(--fg-faint)" opacity="0.5" />
        <rect x="2.5" y="9" width="5.5" height="0.8" rx="0.4" fill="var(--fg-faint)" opacity="0.4" />
        {ext === 'go' && <circle cx="10" cy="10" r="2.5" fill="#6ba4e0" />}
        {ext === 'json' && <circle cx="10" cy="10" r="2.5" fill="#e0b96b" />}
        {ext === 'cpp' && <circle cx="10" cy="10" r="2.5" fill="#e07898" />}
        {ext === 'ino' && <circle cx="10" cy="10" r="2.5" fill="#70c8c0" />}
        {ext === 'md' && <circle cx="10" cy="10" r="2.5" fill="#7ec89c" />}
        {ext === 'ts' && <circle cx="10" cy="10" r="2.5" fill="#4db8ff" />}
      </svg>
    )
  },
  folderIcon(open) {
    return (
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="flex-shrink-0">
        <rect x="0.5" y="3" width="12" height="9" rx="1"
          fill={open ? 'var(--surface-4)' : 'var(--surface-3)'}
          stroke="var(--fg-faint)" strokeWidth="0.8" />
        <rect x="0.5" y="1" width="5" height="3.5" rx="1"
          fill={open ? 'var(--surface-4)' : 'var(--surface-3)'}
          stroke="var(--fg-faint)" strokeWidth="0.8" />
        {open && (
          <path d="M1.5 7 L11.5 7" stroke="var(--fg-faint)" strokeWidth="0.5" opacity="0.4" strokeDasharray="1.5 1" />
        )}
      </svg>
    )
  },
}

// ── Export ────────────────────────────────────────────────────────────────────

export const ICON_PACKS: IconPackDef[] = [minimal, colored, neon, rounded, classic]

export function getIconPack(id: string): IconPackDef {
  return ICON_PACKS.find(p => p.id === id) ?? minimal
}