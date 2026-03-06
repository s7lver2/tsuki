// src/lib/themes.ts

export interface IdeTheme {
  id: string
  name: string
  base: 'dark' | 'light'
  preview: { bg: string; border: string; fg: string; accent: string }
  vars: Record<string, string>
}

export interface SyntaxTheme {
  id: string
  name: string
  swatches: string[]   // preview colors [kw, str, num, fn, com]
  vars: Record<string, string>
}

export const IDE_THEMES: IdeTheme[] = [
  {
    id: 'dark',
    name: 'Dark',
    base: 'dark',
    preview: { bg: '#111113', border: '#27272a', fg: '#e4e4e7', accent: '#6ba4e0' },
    vars: {
      '--surface':        '#0d0d0f',
      '--surface-1':      '#111113',
      '--surface-2':      '#161618',
      '--surface-3':      '#1e1e21',
      '--surface-4':      '#26262a',
      '--fg':             '#e4e4e7',
      '--fg-muted':       '#a1a1aa',
      '--fg-faint':       '#52525b',
      '--border':         '#27272a',
      '--border-subtle':  '#1f1f22',
      '--active':         '#1e1e22',
      '--hover':          '#1d1d20',
      '--ok':             '#4ade80',
      '--warn':           '#fbbf24',
      '--err':            '#f87171',
      '--info':           '#60a5fa',
      '--accent-inv':     '#0d0d0f',
    },
  },
  {
    id: 'light',
    name: 'Light',
    base: 'light',
    preview: { bg: '#f8f8f9', border: '#e4e4e7', fg: '#18181b', accent: '#2563eb' },
    vars: {
      '--surface':        '#ffffff',
      '--surface-1':      '#f8f8f9',
      '--surface-2':      '#f0f0f2',
      '--surface-3':      '#e8e8eb',
      '--surface-4':      '#dddde0',
      '--fg':             '#18181b',
      '--fg-muted':       '#52525b',
      '--fg-faint':       '#a1a1aa',
      '--border':         '#e4e4e7',
      '--border-subtle':  '#ebebed',
      '--active':         '#e4e4e7',
      '--hover':          '#f0f0f2',
      '--ok':             '#16a34a',
      '--warn':           '#d97706',
      '--err':            '#dc2626',
      '--info':           '#2563eb',
      '--accent-inv':     '#ffffff',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    base: 'dark',
    preview: { bg: '#0c0c1a', border: '#1e1e3a', fg: '#cdd6f4', accent: '#89b4fa' },
    vars: {
      '--surface':        '#070710',
      '--surface-1':      '#0c0c1a',
      '--surface-2':      '#111122',
      '--surface-3':      '#181830',
      '--surface-4':      '#1f1f3a',
      '--fg':             '#cdd6f4',
      '--fg-muted':       '#a6adc8',
      '--fg-faint':       '#585b70',
      '--border':         '#1e1e3a',
      '--border-subtle':  '#14142a',
      '--active':         '#1e1e3a',
      '--hover':          '#181830',
      '--ok':             '#a6e3a1',
      '--warn':           '#f9e2af',
      '--err':            '#f38ba8',
      '--info':           '#89b4fa',
      '--accent-inv':     '#070710',
    },
  },
  {
    id: 'warm-dark',
    name: 'Warm Dark',
    base: 'dark',
    preview: { bg: '#1a1816', border: '#2e2c24', fg: '#e8e0d0', accent: '#e5ad4c' },
    vars: {
      '--surface':        '#100f0e',
      '--surface-1':      '#1a1816',
      '--surface-2':      '#22201c',
      '--surface-3':      '#2a2822',
      '--surface-4':      '#333028',
      '--fg':             '#e8e0d0',
      '--fg-muted':       '#b8ae9e',
      '--fg-faint':       '#5c5648',
      '--border':         '#2e2c24',
      '--border-subtle':  '#22201c',
      '--active':         '#2a2822',
      '--hover':          '#242218',
      '--ok':             '#7fc590',
      '--warn':           '#e5ad4c',
      '--err':            '#e06c75',
      '--info':           '#7ab0d4',
      '--accent-inv':     '#100f0e',
    },
  },
  {
    id: 'solarized-dark',
    name: 'Solarized',
    base: 'dark',
    preview: { bg: '#073642', border: '#0a3d4a', fg: '#93a1a1', accent: '#268bd2' },
    vars: {
      '--surface':        '#002b36',
      '--surface-1':      '#073642',
      '--surface-2':      '#0a3d4a',
      '--surface-3':      '#0d4855',
      '--surface-4':      '#12505f',
      '--fg':             '#93a1a1',
      '--fg-muted':       '#657b83',
      '--fg-faint':       '#4a5f66',
      '--border':         '#0a3d4a',
      '--border-subtle':  '#073642',
      '--active':         '#073642',
      '--hover':          '#0a3d4a',
      '--ok':             '#859900',
      '--warn':           '#b58900',
      '--err':            '#dc322f',
      '--info':           '#268bd2',
      '--accent-inv':     '#002b36',
    },
  },
  {
    id: 'high-contrast',
    name: 'High Contrast',
    base: 'dark',
    preview: { bg: '#0a0a0a', border: '#555555', fg: '#ffffff', accent: '#33aaff' },
    vars: {
      '--surface':        '#000000',
      '--surface-1':      '#0a0a0a',
      '--surface-2':      '#111111',
      '--surface-3':      '#1a1a1a',
      '--surface-4':      '#222222',
      '--fg':             '#ffffff',
      '--fg-muted':       '#cccccc',
      '--fg-faint':       '#888888',
      '--border':         '#555555',
      '--border-subtle':  '#333333',
      '--active':         '#1a1a1a',
      '--hover':          '#1a1a1a',
      '--ok':             '#00ff88',
      '--warn':           '#ffff00',
      '--err':            '#ff3333',
      '--info':           '#33aaff',
      '--accent-inv':     '#000000',
    },
  },
]

export const SYNTAX_THEMES: SyntaxTheme[] = [
  {
    id: 'material',
    name: 'Material',
    swatches: ['#c792ea', '#c3e88d', '#f78c6c', '#82aaff', '#546e7a'],
    vars: {
      '--syn-kw':  '#c792ea',
      '--syn-typ': '#82aaff',
      '--syn-str': '#c3e88d',
      '--syn-num': '#f78c6c',
      '--syn-com': '#546e7a',
      '--syn-fn':  '#82aaff',
      '--syn-pkg': '#ffcb6b',
      '--syn-op':  '#89ddff',
    },
  },
  {
    id: 'monokai',
    name: 'Monokai',
    swatches: ['#f92672', '#e6db74', '#ae81ff', '#a6e22e', '#75715e'],
    vars: {
      '--syn-kw':  '#f92672',
      '--syn-typ': '#66d9e8',
      '--syn-str': '#e6db74',
      '--syn-num': '#ae81ff',
      '--syn-com': '#75715e',
      '--syn-fn':  '#a6e22e',
      '--syn-pkg': '#66d9e8',
      '--syn-op':  '#f8f8f2',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    swatches: ['#81a1c1', '#a3be8c', '#b48ead', '#88c0d0', '#616e88'],
    vars: {
      '--syn-kw':  '#81a1c1',
      '--syn-typ': '#8fbcbb',
      '--syn-str': '#a3be8c',
      '--syn-num': '#b48ead',
      '--syn-com': '#616e88',
      '--syn-fn':  '#88c0d0',
      '--syn-pkg': '#ebcb8b',
      '--syn-op':  '#eceff4',
    },
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    swatches: ['#ff7b72', '#a5d6ff', '#79c0ff', '#d2a8ff', '#8b949e'],
    vars: {
      '--syn-kw':  '#ff7b72',
      '--syn-typ': '#79c0ff',
      '--syn-str': '#a5d6ff',
      '--syn-num': '#79c0ff',
      '--syn-com': '#8b949e',
      '--syn-fn':  '#d2a8ff',
      '--syn-pkg': '#ffa657',
      '--syn-op':  '#c9d1d9',
    },
  },
  {
    id: 'solarized',
    name: 'Solarized',
    swatches: ['#859900', '#2aa198', '#d33682', '#268bd2', '#93a1a1'],
    vars: {
      '--syn-kw':  '#859900',
      '--syn-typ': '#268bd2',
      '--syn-str': '#2aa198',
      '--syn-num': '#d33682',
      '--syn-com': '#93a1a1',
      '--syn-fn':  '#268bd2',
      '--syn-pkg': '#b58900',
      '--syn-op':  '#657b83',
    },
  },
]

/** Applies a full theme to the document root — safe to call on every settings change. */
export function applyTheme(ideThemeId: string, syntaxThemeId: string): void {
  if (typeof window === 'undefined') return
  const theme  = IDE_THEMES.find(t => t.id === ideThemeId)      ?? IDE_THEMES[0]
  const syntax = SYNTAX_THEMES.find(s => s.id === syntaxThemeId) ?? SYNTAX_THEMES[0]
  const root   = document.documentElement
  // Keep dark/light class in sync for any remaining globals.css rules
  root.classList.remove('dark', 'light')
  root.classList.add(theme.base)
  // Inline style properties win over every stylesheet rule
  for (const [k, v] of Object.entries({ ...theme.vars, ...syntax.vars })) {
    root.style.setProperty(k, v)
  }
}

export function applyUiScale(scale: number): void {
  if (typeof window === 'undefined') return
  // Scales all rem-based Tailwind classes; editor px fontSize is unaffected
  document.documentElement.style.fontSize = scale === 1 ? '' : `${scale * 100}%`
}

export function applyFontRendering(mode: 'auto' | 'crisp' | 'smooth' | 'subpixel'): void {
  if (typeof window === 'undefined') return
  const el = document.documentElement
  const smoothing: Record<string, string> = {
    auto:     '',
    crisp:    'none',
    smooth:   'antialiased',
    subpixel: 'subpixel-antialiased',
  }
  const s = el.style as unknown as Record<string, string>
  s['webkitFontSmoothing'] = smoothing[mode]
  s['MozOsxFontSmoothing'] = mode === 'smooth' ? 'grayscale' : mode === 'subpixel' ? 'auto' : ''
}