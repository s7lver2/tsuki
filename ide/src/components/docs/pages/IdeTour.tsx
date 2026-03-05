// pages/IdeTour.tsx
import { useState } from 'react'
import { Zap, Files, Layers, Code2, Terminal } from 'lucide-react'
import { H2, H3, P, UL, LI, Divider, InlineCode } from '../DocsPrimitives'
import { ShortcutsTable, FileTree } from '../DocsComponents'

// ── Zone data ─────────────────────────────────────────────────────────────────

type ZoneId = 'toolbar' | 'sidebar' | 'filetree' | 'editor' | 'bottom'

interface Zone {
  id: ZoneId
  icon: React.ReactNode
  label: string
  desc: string
  x: number; y: number; w: number; h: number
}

const ZONES: Zone[] = [
  { id: 'toolbar',  icon: <Zap size={12} />,      label: 'Toolbar',         x: 0,   y: 0,   w: 400, h: 28,  desc: 'Build, Upload, board selector, port picker, theme toggle. The primary action bar.' },
  { id: 'sidebar',  icon: <Files size={12} />,     label: 'Activity Bar',    x: 0,   y: 28,  w: 48,  h: 272, desc: 'Switch between Files, Git, and Packages panels.' },
  { id: 'filetree', icon: <Layers size={12} />,    label: 'File Explorer',   x: 48,  y: 28,  w: 120, h: 272, desc: 'Browse, create, rename, and delete project files. Right-click for the context menu.' },
  { id: 'editor',   icon: <Code2 size={12} />,     label: 'Code Editor',     x: 168, y: 28,  w: 232, h: 200, desc: 'Syntax-highlighted Go editor with multi-tab support. Cmd+S to save.' },
  { id: 'bottom',   icon: <Terminal size={12} />,  label: 'Output / Terminal',x: 168, y: 228, w: 232, h: 72,  desc: 'Three tabs: Output (build logs), Problems (errors), Terminal (shell).' },
]

function IdeMockup({ active, onZone }: { active: ZoneId; onZone: (id: ZoneId) => void }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginBottom: 10 }}>
      <div style={{ padding: '5px 10px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: 10, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)' }}>
        tsuki IDE — click a zone
      </div>
      <svg viewBox="0 0 400 300" style={{ width: '100%', display: 'block', background: 'var(--surface-1)' }}>
        {ZONES.map(z => (
          <g key={z.id} onClick={() => onZone(z.id)} style={{ cursor: 'pointer' }}>
            <rect
              x={z.x} y={z.y} width={z.w} height={z.h} rx={2}
              fill={active === z.id ? 'var(--active)' : 'transparent'}
              stroke={active === z.id ? 'var(--fg-muted)' : 'var(--border)'}
              strokeWidth={active === z.id ? 1 : 0.5}
            />
            <text
              x={z.x + z.w / 2} y={z.y + z.h / 2 + 4}
              textAnchor="middle" fontSize={8}
              fill={active === z.id ? 'var(--fg)' : 'var(--fg-faint)'}
              fontFamily="monospace" fontWeight={active === z.id ? '600' : '400'}
            >
              {z.label}
            </text>
          </g>
        ))}

        {/* Tab bar detail */}
        <rect x={168} y={28} width={232} height={16} fill="var(--surface-2)" stroke="var(--border)" strokeWidth={0.3} />
        <rect x={170} y={30} width={58} height={12} rx={2} fill="var(--surface-1)" stroke="var(--border)" strokeWidth={0.5} />
        <text x={199} y={39} textAnchor="middle" fontSize={7} fill="var(--fg-faint)" fontFamily="monospace">main.go</text>

        {/* Fake code lines */}
        {[50,58,66,74,82,90,98,106,114,122,130,138,146,154,162,170,178,186].map((y, i) => (
          <rect key={i} x={178} y={y}
            width={[80,140,120,0,60,110,90,100,80,0,60,120,100,90,80,0,60,110][i]}
            height={3.5} rx={2} opacity={0.35}
            fill={[i%3===0 ? 'var(--fg)' : 'var(--fg-muted)'][0]}
          />
        ))}

        {/* Bottom tabs */}
        {['Output','Problems','Terminal'].map((tab, i) => (
          <g key={tab}>
            <rect x={170 + i * 56} y={230} width={54} height={11} rx={2}
              fill={i === 0 ? 'var(--active)' : 'transparent'}
              stroke={i === 0 ? 'var(--border)' : 'transparent'} strokeWidth={0.5}
            />
            <text x={197 + i * 56} y={238} textAnchor="middle" fontSize={6.5}
              fill={i === 0 ? 'var(--fg-muted)' : 'var(--fg-faint)'} fontFamily="monospace">{tab}</text>
          </g>
        ))}

        {/* Sidebar icons */}
        {([['F', 34], ['G', 68], ['P', 102], ['S', 136]] as [string, number][]).map(([label, y]) => (
          <g key={y}>
            <rect x={8} y={y} width={32} height={26} rx={4} fill="var(--surface-2)" stroke="var(--border)" strokeWidth={0.5} />
            <text x={24} y={y + 17} textAnchor="middle" fontSize={9} fill="var(--fg-faint)" fontFamily="monospace" fontWeight="600">{label}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

const SHORTCUT_GROUPS = [
  {
    label: 'Build & Deploy',
    shortcuts: [
      { keys: ['⌘', 'B'],    desc: 'Build project' },
      { keys: ['⌘', 'U'],    desc: 'Upload to board' },
      { keys: ['⌘', 'Shift', 'B'], desc: 'Build + Upload' },
    ],
  },
  {
    label: 'Editor',
    shortcuts: [
      { keys: ['⌘', 'S'],    desc: 'Save current file' },
      { keys: ['⌘', 'Z'],    desc: 'Undo' },
      { keys: ['⌘', '/'],    desc: 'Toggle line comment' },
    ],
  },
  {
    label: 'Navigation',
    shortcuts: [
      { keys: ['⌘', 'K'],    desc: 'Open docs search' },
      { keys: ['⌘', '`'],    desc: 'Toggle terminal panel' },
      { keys: ['⌘', 'P'],    desc: 'Quick open file' },
    ],
  },
]

const PROJECT_TREE = [
  {
    name: 'my-project', type: 'dir' as const,
    desc: 'Project root directory. Contains tsuki_package.json and source files.',
    children: [
      {
        name: 'src', type: 'dir' as const,
        desc: 'Go source files for your firmware.',
        children: [
          { name: 'main.go', type: 'file' as const, highlight: true, desc: 'Entry point — must define setup() and loop() functions.' },
        ],
      },
      {
        name: 'build', type: 'dir' as const,
        desc: 'Generated build artifacts — do not edit manually.',
        children: [
          { name: 'my-project', type: 'dir' as const, desc: 'Per-project build output.', children: [
            { name: 'my-project.cpp', type: 'file' as const, desc: 'Generated C++ from tsuki-core.' },
            { name: 'my-project.ino', type: 'file' as const, desc: 'Arduino stub for compatibility.' },
          ]},
        ],
      },
      { name: 'tsuki_package.json', type: 'file' as const, highlight: true, desc: 'Project manifest: board, backend, packages, build options.' },
    ],
  },
]

// ── Page ─────────────────────────────────────────────────────────────────────

export default function IdeTourPage() {
  const [active, setActive] = useState<ZoneId>('toolbar')
  const activeZone = ZONES.find(z => z.id === active)!

  return (
    <div>
      <P>
        The tsuki IDE is a desktop application built with{' '}
        <strong style={{ color: 'var(--fg)' }}>Tauri</strong> and{' '}
        <strong style={{ color: 'var(--fg)' }}>Next.js</strong>.
        Click any zone in the diagram below to learn what it does.
      </P>

      <IdeMockup active={active} onZone={setActive} />

      {/* Zone detail */}
      <div style={{
        border: '1px solid var(--border)', background: 'var(--surface-1)',
        borderRadius: 6, padding: '10px 12px', marginBottom: 16,
        display: 'flex', gap: 9, alignItems: 'flex-start',
        transition: 'all 0.12s',
      }}>
        <span style={{ color: 'var(--fg-muted)', marginTop: 1 }}>{activeZone.icon}</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', marginBottom: 2, fontFamily: 'var(--font-sans)' }}>
            {activeZone.label}
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.65, fontFamily: 'var(--font-sans)' }}>
            {activeZone.desc}
          </div>
        </div>
      </div>

      {/* Zone selector buttons */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 20 }}>
        {ZONES.map(z => (
          <button
            key={z.id}
            onClick={() => setActive(z.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', borderRadius: 5, cursor: 'pointer',
              border: `1px solid ${active === z.id ? 'var(--fg-muted)' : 'var(--border)'}`,
              background: active === z.id ? 'var(--surface-3)' : 'transparent',
              color: active === z.id ? 'var(--fg)' : 'var(--fg-muted)',
              fontSize: 11, fontFamily: 'var(--font-mono)', transition: 'all 0.1s',
            }}
          >
            {z.icon} {z.label}
          </button>
        ))}
      </div>

      <Divider />
      <H2>Sidebar panels</H2>

      <H3>Files</H3>
      <P>
        The file explorer shows the full directory tree of your project. Click a file to open it
        as a tab. Right-click for create, rename, and delete options.
      </P>

      <H3>Git</H3>
      <P>
        Shows staged and unstaged changes, commit graph, and basic operations: stage, commit, push.
        Calls <InlineCode>git</InlineCode> directly through the Tauri backend.
      </P>

      <H3>Packages</H3>
      <P>
        Browse and install tsukilib packages. Clicking <strong style={{ color: 'var(--fg)' }}>Install</strong>{' '}
        runs <InlineCode>tsuki pkg install</InlineCode> in the background and streams output to the
        Output tab.
      </P>

      <Divider />
      <H2>Project structure</H2>
      <P>Every tsuki project follows this layout. Hover a node to see what it does.</P>
      <FileTree nodes={PROJECT_TREE} title="project layout" />

      <Divider />
      <H2>Keyboard shortcuts</H2>
      <ShortcutsTable groups={SHORTCUT_GROUPS} />

      <Divider />
      <H2>Settings</H2>
      <P>Open Settings from the gear icon at the bottom of the activity bar.</P>
      <UL>
        <LI><strong style={{ color: 'var(--fg)' }}>CLI</strong> — paths to <InlineCode>tsuki</InlineCode>, <InlineCode>tsuki-core</InlineCode>, and <InlineCode>tsuki-flash</InlineCode>.</LI>
        <LI><strong style={{ color: 'var(--fg)' }}>Defaults</strong> — default board, backend, and baud rate for new projects.</LI>
        <LI><strong style={{ color: 'var(--fg)' }}>Editor</strong> — font size, tab width, word wrap.</LI>
        <LI><strong style={{ color: 'var(--fg)' }}>Appearance</strong> — light / dark theme, UI scale.</LI>
        <LI><strong style={{ color: 'var(--fg)' }}>Sandbox</strong> — simulator options.</LI>
      </UL>
    </div>
  )
}