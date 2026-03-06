// pages/Introduction.tsx
import { useState } from 'react'
import { Code2, Zap, Package, Cpu } from 'lucide-react'
import { H2, P, UL, LI, Divider, InlineCode, Badge, FeatureCard, CodeBlock } from '../DocsPrimitives'

// ── Build pipeline mini-diagram ───────────────────────────────────────────────

const STEPS = [
  { id: 'go',    label: 'main.go',      sub: 'source',     icon: 'Go'  },
  { id: 'core',  label: 'tsuki-core',   sub: 'transpiler', icon: '⚙'  },
  { id: 'cpp',   label: 'sketch.cpp',   sub: 'C++ output', icon: 'C++' },
  { id: 'flash', label: 'tsuki-flash',  sub: 'compiler',   icon: '⚡'  },
  { id: 'hex',   label: 'firmware.hex', sub: 'binary',     icon: '■'   },
]

const STEP_DESC: Record<string, string> = {
  go:    'Your Go source file. Write type-safe, readable code with full Go tooling support.',
  core:  'tsuki-core transpiles Go → C++ Arduino. Handles type mapping and package bindings.',
  cpp:   'Generated C++ ready for avr-gcc. Includes a .ino stub for Arduino compatibility.',
  flash: 'tsuki-flash compiles C++ to AVR machine code without needing arduino-cli.',
  hex:   'The final firmware binary, ready to be flashed to your board via USB.',
}

function MiniPipeline() {
  const [hov, setHov] = useState<string | null>(null)
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ padding: '5px 10px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: 10, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)' }}>
        build pipeline — hover each step
      </div>
      <div style={{ padding: '16px 12px', background: 'var(--surface-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {STEPS.map((s, i) => (
            <div key={s.id} style={{ display: 'contents' }}>
              <div
                onMouseEnter={() => setHov(s.id)}
                onMouseLeave={() => setHov(null)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'default' }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 7,
                  border: `1px solid ${hov === s.id ? 'var(--fg-muted)' : 'var(--border)'}`,
                  background: hov === s.id ? 'var(--surface-3)' : 'var(--surface-2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.12s',
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: s.icon.length > 2 ? 8 : 12, color: hov === s.id ? 'var(--fg)' : 'var(--fg-faint)', transition: 'color 0.12s' }}>
                    {s.icon}
                  </span>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 8, fontWeight: 600, color: hov === s.id ? 'var(--fg)' : 'var(--fg-muted)', fontFamily: 'var(--font-mono)', transition: 'color 0.12s' }}>{s.label}</div>
                  <div style={{ fontSize: 7, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)' }}>{s.sub}</div>
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ flex: 1, height: 1, background: 'var(--border)', margin: '0 3px', marginBottom: 20 }}>
                  <div style={{ float: 'right', marginRight: -3, marginTop: -2.5, width: 0, height: 0, borderLeft: '4px solid var(--border)', borderTop: '2.5px solid transparent', borderBottom: '2.5px solid transparent' }} />
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{
          marginTop: 10, minHeight: 32, padding: '7px 10px',
          background: hov ? 'var(--surface-2)' : 'transparent',
          border: '1px solid', borderColor: hov ? 'var(--border)' : 'transparent',
          borderRadius: 5, transition: 'all 0.15s',
          fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.55, fontFamily: 'var(--font-sans)',
        }}>
          {hov ? STEP_DESC[hov] : <span style={{ fontSize: 10, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)' }}>↑ hover a step</span>}
        </div>
      </div>
    </div>
  )
}

// ── Go subset table ───────────────────────────────────────────────────────────

const GO_SUBSET: [string, true | 'stub' | false][] = [
  ['Variables (var, :=)',        true],
  ['Constants (const)',          true],
  ['Functions + methods',        true],
  ['Structs & type aliases',     true],
  ['if / else / for / switch',   true],
  ['for … range over arrays',    true],
  ['All operators',              true],
  ['import + package calls',     true],
  ['Goroutines (go)',            'stub'],
  ['defer',                      'stub'],
  ['Channels (chan)',             false],
  ['Generics',                   false],
  ['Garbage collection',         false],
]

function SubsetTable() {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
      {GO_SUBSET.map(([feat, status], i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 10px',
          borderBottom: i < GO_SUBSET.length - 1 ? '1px solid var(--border)' : 'none',
          background: i % 2 === 0 ? 'transparent' : 'var(--surface-1)',
        }}>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{feat}</span>
          <Badge variant={status === true ? 'ok' : status === 'stub' ? 'warn' : 'muted'}>
            {status === true ? '✓' : status === 'stub' ? '~ stub' : '✗'}
          </Badge>
        </div>
      ))}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function IntroductionPage() {
  return (
    <div>
      <P>
        <strong style={{ color: 'var(--fg)' }}>tsuki</strong> is a framework for writing Arduino firmware
        in Go, or other languages. Instead of C++, you write familiar Go code — with types, imports, and standard syntax —
        and tsuki transpiles it to valid Arduino C++ automatically.
      </P>

      <MiniPipeline />

      <P>
        The ecosystem is self-contained. You don't need <InlineCode>arduino-cli</InlineCode> installed:
        tsuki ships its own compiler toolchain (<InlineCode>tsuki-flash</InlineCode>) that can download
        AVR cores, compile, and flash directly.
      </P>

      <Divider />
      <H2>Why Go for Arduino?</H2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        <FeatureCard icon={<Code2 size={13} />} title="Readable syntax" desc="No header files, no pointer arithmetic. Just clean Go with import statements." />
        <FeatureCard icon={<Package size={13} />} title="Package manager" desc="Install community packages for use native cpp libraries with tsuki pkg install." />
        <FeatureCard icon={<Cpu size={13} />} title="Multi-board" desc="Uno, Nano, Mega, ESP32, ESP8266, Pico, Teensy, Portenta and more." />
        <FeatureCard icon={<Zap size={13} />} title="No arduino-cli" desc="tsuki-flash compiles and flashes natively. Auto-downloads the AVR SDK." />
      </div>

      <Divider />
      <H2>Project structure</H2>
      <CodeBlock lang="bash" filename="project layout">
{`my-project/
├── tsuki_package.json   ← board, packages, build config
└── src/
    └── main.go          ← your firmware`}
      </CodeBlock>

      <Divider />
      <H2>Supported Go subset</H2>
      <P>tsuki supports everything you need for embedded development:</P>
      <SubsetTable />

      <Divider />
      <H2>Components</H2>
      <UL>
        <LI><InlineCode>tsuki-core</InlineCode> — Rust transpiler: Go source → Arduino C++.</LI>
        <LI><InlineCode>tsuki-flash</InlineCode> — compiler and uploader, no arduino-cli dependency.</LI>
        <LI><InlineCode>tsuki</InlineCode> CLI — the Go command-line tool users interact with.</LI>
        <LI><strong style={{ color: 'var(--fg)' }}>tsuki IDE</strong> — this Tauri + Next.js desktop application.</LI>
      </UL>
    </div>
  )
}
