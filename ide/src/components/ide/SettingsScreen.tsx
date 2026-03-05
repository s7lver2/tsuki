'use client'
import { useStore, SettingsTab, SettingsState } from '@/lib/store'
import { IDE_THEMES, SYNTAX_THEMES } from '@/lib/themes'
import { Btn, Input, Select, Toggle, Badge, Divider } from '@/components/ui/primitives'
import { ArrowLeft, Terminal, Sliders, Code2, RefreshCw, FolderOpen, Palette, Check, Cpu, FlaskConical } from 'lucide-react'
import { useState } from 'react'
import { clsx } from 'clsx'

// Note: SettingsTab type in lib/store.ts must include 'sandbox':
// export type SettingsTab = 'cli' | 'defaults' | 'editor' | 'appearance' | 'sandbox'

const NAV: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'appearance', label: 'Appearance', icon: <Palette size={13} /> },
  { id: 'cli',        label: 'CLI Tools',  icon: <Terminal size={13} /> },
  { id: 'defaults',   label: 'Defaults',   icon: <Sliders  size={13} /> },
  { id: 'editor',     label: 'Editor',     icon: <Code2    size={13} /> },
  { id: 'sandbox' as SettingsTab, label: 'Sandbox', icon: <Cpu size={13} /> },
]

function SettingsField({ name, desc, children }: { name: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-3.5 border-b border-[var(--border-subtle)] last:border-0">
      <div className="flex-1">
        <div className="text-sm font-medium">{name}</div>
        <div className="text-xs text-[var(--fg-muted)] mt-0.5">{desc}</div>
      </div>
      <div className="w-52 flex-shrink-0">{children}</div>
    </div>
  )
}

export default function SettingsScreen() {
  const { setScreen, openTabs, settingsTab, setSettingsTab, toggleTheme, theme, goBack } = useStore()

  function back() {
    goBack()
  }

  return (
    <div className="h-screen flex flex-col bg-[var(--surface)] text-[var(--fg)]">
      <div className="h-11 flex items-center px-4 gap-3 border-b border-[var(--border)] flex-shrink-0">
        <Btn variant="ghost" size="xs" onClick={back}><ArrowLeft size={13} /> Back</Btn>
        <Divider vertical />
        <span className="text-sm font-semibold">Settings</span>
        <div className="ml-auto">
          <Btn variant="ghost" size="xs" onClick={toggleTheme} className="font-mono text-[10px]">
            {theme === 'dark' ? '◐ dark' : '○ light'}
          </Btn>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-48 border-r border-[var(--border)] bg-[var(--surface-1)] p-2 flex flex-col gap-0.5 flex-shrink-0">
          {NAV.map(n => (
            <button
              key={n.id}
              onClick={() => setSettingsTab(n.id)}
              className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded text-sm cursor-pointer border-0 text-left transition-colors w-full ${
                settingsTab === n.id
                  ? 'bg-[var(--active)] text-[var(--fg)] font-medium'
                  : 'bg-transparent text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
              }`}
            >
              {n.icon}{n.label}
              {n.id === 'sandbox' && (
                <span className="ml-auto text-[9px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1 rounded">β</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl px-10 py-8">
            {settingsTab === 'appearance' && <AppearanceTab />}
            {settingsTab === 'cli'        && <CliTab />}
            {settingsTab === 'defaults'   && <DefaultsTab />}
            {settingsTab === 'editor'     && <EditorTab />}
            {(settingsTab as string) === 'sandbox' && <SandboxTab />}
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-7">
      <h2 className="text-lg font-semibold tracking-tight mb-1">{title}</h2>
      <p className="text-sm text-[var(--fg-muted)]">{desc}</p>
    </div>
  )
}

function GroupHeader({ title }: { title: string }) {
  return (
    <div className="mt-6 mb-1 pb-2 border-b border-[var(--border)]">
      <span className="text-2xs font-semibold text-[var(--fg-faint)] uppercase tracking-widest">{title}</span>
    </div>
  )
}

// ── Sandbox settings tab ──────────────────────────────────────────────────────

function SandboxTab() {
  const CIRCUIT_FORMAT = `{
  "version": "1",
  "name": "My Circuit",
  "board": "uno",
  "description": "A simple blink circuit",
  "components": [
    {
      "id": "mcu",
      "type": "arduino_uno",
      "label": "Arduino Uno",
      "x": 80,
      "y": 60,
      "rotation": 0,
      "color": "#1a6b2e",
      "props": {}
    },
    {
      "id": "led1",
      "type": "led",
      "label": "LED1",
      "x": 260,
      "y": 80,
      "rotation": 0,
      "color": "#ef4444",
      "props": {}
    },
    {
      "id": "r1",
      "type": "resistor",
      "label": "R1",
      "x": 210,
      "y": 100,
      "rotation": 0,
      "color": "#a37a2c",
      "props": { "ohms": 220 }
    }
  ],
  "wires": [
    {
      "id": "w1",
      "fromComp": "mcu",
      "fromPin": "D13",
      "toComp": "r1",
      "toPin": "pin1",
      "color": "#f97316",
      "waypoints": []
    },
    {
      "id": "w2",
      "fromComp": "r1",
      "fromPin": "pin2",
      "toComp": "led1",
      "toPin": "anode",
      "color": "#f97316",
      "waypoints": []
    },
    {
      "id": "w3",
      "fromComp": "mcu",
      "fromPin": "GND",
      "toComp": "led1",
      "toPin": "cathode",
      "color": "#1a1a1a",
      "waypoints": []
    }
  ],
  "notes": []
}`

  return (
    <div>
      <div className="flex items-start gap-3 mb-7">
        <div className="w-10 h-10 rounded-lg border border-[var(--border)] flex items-center justify-center flex-shrink-0">
          <Cpu size={18} className="text-[var(--fg-muted)]" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-semibold tracking-tight">Tsuki Sandbox</h2>
            <span className="text-xs font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded">experimental</span>
          </div>
          <p className="text-sm text-[var(--fg-muted)]">
            Virtual Arduino circuit simulator. Build circuits visually or from a text file, then run your Tsuki/Go program against the virtual hardware.
          </p>
        </div>
      </div>

      <GroupHeader title="How to use" />
      <div className="mt-4 mb-6 flex flex-col gap-3">
        {[
          {
            step: '1',
            title: 'Open the Sandbox panel',
            desc: 'Click the "Sandbox β" button in the top toolbar, or the collapsed tab on the right edge of the IDE. The panel slides in from the right and is resizable.',
          },
          {
            step: '2',
            title: 'Build your circuit',
            desc: 'Use the Canvas view: click components in the left palette to place them on the canvas. Select the Wire tool, then click two pins to connect them. Each wire can have a custom color. Use Alt+drag or middle-mouse to pan, scroll to zoom.',
          },
          {
            step: '3',
            title: 'Import from text',
            desc: 'Switch to the Text view to directly edit the .tsuki-circuit JSON. Paste a circuit definition and click Apply. You can also import/export .tsuki-circuit files using the toolbar buttons.',
          },
          {
            step: '4',
            title: 'Simulate',
            desc: 'Open any .go file in the editor, then switch to the Sim view in the Sandbox and press Run. The simulator parses digitalWrite/analogWrite calls and updates component states (LED brightness, etc.) in real time.',
          },
        ].map(s => (
          <div key={s.step} className="flex gap-3">
            <div className="w-6 h-6 rounded-full border border-[var(--border)] flex items-center justify-center flex-shrink-0 text-xs font-semibold text-[var(--fg-muted)]">
              {s.step}
            </div>
            <div>
              <div className="text-sm font-medium mb-0.5">{s.title}</div>
              <div className="text-xs text-[var(--fg-muted)] leading-relaxed">{s.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <GroupHeader title=".tsuki-circuit file format" />
      <div className="mt-3 mb-6">
        <p className="text-xs text-[var(--fg-muted)] mb-3 leading-relaxed">
          All circuits are stored as <span className="font-mono text-[var(--fg)]">.tsuki-circuit</span> files — human-readable JSON with full detail including component positions, wire colors, labels, and component properties. You can hand-edit these files or generate them programmatically.
        </p>
        <p className="text-xs text-[var(--fg-muted)] mb-2">Example — LED blink circuit:</p>
        <pre className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg p-4 text-xs font-mono text-[var(--fg-muted)] overflow-x-auto leading-5 whitespace-pre">
          {CIRCUIT_FORMAT}
        </pre>
      </div>

      <GroupHeader title="Supported components" />
      <div className="mt-3 mb-6 grid grid-cols-2 gap-2">
        {[
          { type: 'arduino_uno',    label: 'Arduino Uno',    cat: 'MCU',     color: '#1a6b2e' },
          { type: 'arduino_nano',   label: 'Arduino Nano',   cat: 'MCU',     color: '#0a4d8c' },
          { type: 'led',            label: 'LED',            cat: 'Output',  color: '#ef4444' },
          { type: 'resistor',       label: 'Resistor',       cat: 'Passive', color: '#a37a2c' },
          { type: 'button',         label: 'Push Button',    cat: 'Input',   color: '#555' },
          { type: 'potentiometer',  label: 'Potentiometer',  cat: 'Input',   color: '#4a4a4a' },
          { type: 'buzzer',         label: 'Buzzer',         cat: 'Output',  color: '#222' },
          { type: 'power_rail',     label: 'Power Rail',     cat: 'Power',   color: '#333' },
        ].map(c => (
          <div key={c.type} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
            <div className="min-w-0">
              <div className="text-xs font-medium text-[var(--fg)] truncate">{c.label}</div>
              <div className="text-[10px] text-[var(--fg-faint)]">{c.cat}</div>
            </div>
          </div>
        ))}
      </div>

      <GroupHeader title="Simulation" />
      <div className="mt-3 mb-6 flex flex-col gap-0">
        <div className="py-3 border-b border-[var(--border-subtle)]">
          <div className="text-sm font-medium mb-1">How simulation works</div>
          <div className="text-xs text-[var(--fg-muted)] leading-relaxed">
            The Sim view parses your open Go source file and extracts <span className="font-mono text-[var(--fg)]">digitalWrite</span>, <span className="font-mono text-[var(--fg)]">analogWrite</span> and related calls. It then traces the wires connected to the relevant Arduino pins and updates the visual state of downstream components — LEDs glow, PWM dims brightness. The simulation ticks at ~5 Hz and re-reads the source on every tick.
          </div>
        </div>
        <div className="py-3 border-b border-[var(--border-subtle)]">
          <div className="text-sm font-medium mb-1">Supported Go calls</div>
          <div className="text-xs font-mono text-[var(--fg-muted)] flex flex-col gap-1 mt-1">
            <span className="text-[var(--fg)]">digitalWrite(pin, HIGH/LOW)</span>
            <span className="text-[var(--fg)]">analogWrite(pin, 0-255)</span>
            <span className="text-[var(--fg-muted)]">digitalRead(pin)  — reads button state</span>
            <span className="text-[var(--fg-muted)]">analogRead(pin)   — reads pot value</span>
          </div>
        </div>
        <div className="py-3">
          <div className="text-sm font-medium mb-1">Limitations (experimental)</div>
          <div className="text-xs text-[var(--fg-muted)] leading-relaxed">
            This is a static analysis simulation — it does not execute your Go code. Loops, conditionals, and state machines are not evaluated. For accurate simulation, load your compiled .hex into a dedicated emulator like SimAVR or Wokwi. This sandbox is primarily for circuit visualization and connectivity checks.
          </div>
        </div>
      </div>

      <GroupHeader title="Keyboard shortcuts" />
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {[
          ['S',          'Select / move tool'],
          ['W',          'Wire tool'],
          ['D',          'Delete tool'],
          ['Del',        'Delete selected'],
          ['Scroll',     'Zoom in / out'],
          ['Alt + drag', 'Pan canvas'],
          ['ESC',        'Cancel wire'],
        ].map(([key, desc]) => (
          <div key={key} className="flex items-center gap-2 py-1.5 border-b border-[var(--border-subtle)]">
            <kbd className="text-[10px] font-mono bg-[var(--surface-3)] border border-[var(--border)] rounded px-1.5 py-0.5 flex-shrink-0">{key}</kbd>
            <span className="text-xs text-[var(--fg-muted)]">{desc}</span>
          </div>
        ))}
      </div>

      <GroupHeader title="Visualización" />
      <div className="mt-3 flex flex-col gap-0">
        <SandboxSettingsFields />
      </div>
    </div>
  )
}

function SandboxSettingsFields() {
  const { settings, updateSetting } = useStore()
  return (
    <SettingsField
      name="Flujo de corriente"
      desc="Muestra una animación de puntos en movimiento sobre los cables activos durante la simulación. Desactivado por defecto."
    >
      <Toggle
        on={settings.showCurrentFlow}
        onToggle={() => updateSetting('showCurrentFlow', !settings.showCurrentFlow)}
      />
    </SettingsField>
  )
}

// ── Appearance tab ─────────────────────────────────────────────────────────────

function AppearanceTab() {
  const { settings, updateSetting } = useStore()

  return (
    <div>
      <SectionHeader title="Appearance" desc="Customise the IDE's colour scheme, syntax colours, and interface scale." />

      <GroupHeader title="IDE Theme" />
      <div className="grid grid-cols-3 gap-2 mt-3 mb-6">
        {IDE_THEMES.map(theme => {
          const active = settings.ideTheme === theme.id
          return (
            <button
              key={theme.id}
              onClick={() => updateSetting('ideTheme', theme.id)}
              className={clsx(
                'relative rounded-lg border-2 p-3 cursor-pointer transition-all text-left group',
                active ? 'border-[var(--fg-muted)]' : 'border-[var(--border)] hover:border-[var(--fg-faint)]',
              )}
              style={{ background: theme.preview.bg }}
            >
              <div className="flex flex-col gap-1 mb-2.5 opacity-80">
                <div className="flex gap-1">
                  <div className="h-1.5 rounded-full w-8"  style={{ background: theme.preview.accent, opacity: 0.6 }} />
                  <div className="h-1.5 rounded-full w-12" style={{ background: theme.preview.fg,     opacity: 0.3 }} />
                </div>
                <div className="flex gap-1">
                  <div className="h-1.5 rounded-full w-4"  style={{ background: theme.preview.accent, opacity: 0.4 }} />
                  <div className="h-1.5 rounded-full w-16" style={{ background: theme.preview.fg,     opacity: 0.2 }} />
                </div>
                <div className="flex gap-1">
                  <div className="h-1.5 rounded-full w-6"  style={{ background: theme.preview.accent, opacity: 0.5 }} />
                  <div className="h-1.5 rounded-full w-10" style={{ background: theme.preview.fg,     opacity: 0.25 }} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium" style={{ color: theme.preview.fg }}>
                  {theme.name}
                </span>
                {active && (
                  <div className="w-3.5 h-3.5 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                    <Check size={8} className="text-white" />
                  </div>
                )}
              </div>
              <div className="text-[9px] mt-0.5" style={{ color: theme.preview.fg, opacity: 0.4 }}>
                {theme.base}
              </div>
            </button>
          )
        })}
      </div>

      <GroupHeader title="Syntax Highlighting" />
      <div className="flex flex-col gap-2 mt-3 mb-6">
        {SYNTAX_THEMES.map(st => {
          const active = settings.syntaxTheme === st.id
          return (
            <button
              key={st.id}
              onClick={() => updateSetting('syntaxTheme', st.id)}
              className={clsx(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left cursor-pointer transition-all',
                active
                  ? 'border-[var(--fg-muted)] bg-[var(--active)]'
                  : 'border-[var(--border)] hover:border-[var(--fg-faint)] hover:bg-[var(--hover)]',
              )}
            >
              <div className="flex gap-1 flex-shrink-0">
                {st.swatches.map((color, i) => (
                  <div key={i} className="w-3 h-3 rounded-full ring-1 ring-black/10" style={{ background: color }}
                    title={['keyword', 'string', 'number', 'function', 'comment'][i]} />
                ))}
              </div>
              <span className="text-sm font-medium text-[var(--fg)] flex-1">{st.name}</span>
              {active && <Check size={13} className="text-green-400 flex-shrink-0" />}
            </button>
          )
        })}
      </div>

      <GroupHeader title="Interface Scale" />
      <SettingsField
        name="UI Scale"
        desc="Scales all interface elements proportionally. Editor font size is controlled separately in the Editor tab."
      >
        <div className="flex items-center gap-3">
          <input type="range" min="0.80" max="1.25" step="0.05"
            value={settings.uiScale ?? 1}
            onChange={e => updateSetting('uiScale', Number(e.target.value))}
            className="flex-1 accent-[var(--fg)]" />
          <span className="text-xs font-mono w-10 text-right text-[var(--fg-muted)]">
            {Math.round((settings.uiScale ?? 1) * 100)}%
          </span>
        </div>
      </SettingsField>
    </div>
  )
}

// ── CLI tab ────────────────────────────────────────────────────────────────────

function CliTab() {
  const { settings, updateSetting, addLog } = useStore()
  const [detecting, setDetecting] = useState<string | null>(null)
  const [toolStatus, setToolStatus] = useState<Record<string, 'ok' | 'warn' | null>>({ tsuki: null, core: null, arduino: null })

  async function detect(tool: string, key: keyof SettingsState) {
    setDetecting(tool)
    try {
      const { detectTool } = await import('@/lib/tauri')
      const stored = (tool === 'tsuki' ? settings.tsukiPath : settings.arduinoCliPath)?.trim() ?? ''
      const resolved = await detectTool(stored || tool)
      updateSetting(key, resolved)
      setToolStatus(s => ({ ...s, [tool]: 'ok' }))
      addLog('ok', `Detected ${tool}: ${resolved}`)
    } catch (e) {
      setToolStatus(s => ({ ...s, [tool]: 'warn' }))
      addLog('warn', `${tool} not found — set the full path manually or use Browse`)
    }
    setDetecting(null)
  }

  async function browseExe(key: keyof SettingsState) {
    const { pickFile } = await import('@/lib/tauri')
    const path = await pickFile()
    if (path) updateSetting(key, path)
  }

  return (
    <div>
      <SectionHeader title="CLI Tools" desc="Configure paths to the tsuki CLI and toolchain binaries." />
      <GroupHeader title="Tool Paths" />
      <SettingsField name="tsuki CLI path" desc="Path to the main tsuki CLI binary">
        <div className="flex gap-2">
          <Input value={settings.tsukiPath} onChange={e => updateSetting('tsukiPath', e.target.value)} placeholder="/usr/local/bin/tsuki" className="flex-1" />
          <Btn variant="outline" size="xs" onClick={() => detect('tsuki', 'tsukiPath')} disabled={detecting === 'tsuki'}>
            {detecting === 'tsuki' ? <RefreshCw size={11} className="animate-spin" /> : 'Detect'}
          </Btn>
          <Btn variant="outline" size="xs" onClick={() => browseExe('tsukiPath')} title="Browse"><FolderOpen size={11} /></Btn>
        </div>
      </SettingsField>
      <SettingsField name="tsuki-core path" desc="Rust transpiler — auto-detected by default">
        <Input value={settings.tsukiCorePath} onChange={e => updateSetting('tsukiCorePath', e.target.value)} placeholder="auto (recommended)" />
      </SettingsField>
      <SettingsField name="arduino-cli path" desc="Required for compile and upload">
        <div className="flex gap-2">
          <Input value={settings.arduinoCliPath} onChange={e => updateSetting('arduinoCliPath', e.target.value)} className="flex-1" />
          <Btn variant="outline" size="xs" onClick={() => detect('arduino', 'arduinoCliPath')} disabled={detecting === 'arduino'}>
            {detecting === 'arduino' ? <RefreshCw size={11} className="animate-spin" /> : 'Detect'}
          </Btn>
          <Btn variant="outline" size="xs" onClick={() => browseExe('arduinoCliPath')} title="Browse"><FolderOpen size={11} /></Btn>
        </div>
      </SettingsField>
      <SettingsField name="avrdude path" desc="Used by tsuki-flash for AVR boards">
        <Input value={settings.avrDudePath} onChange={e => updateSetting('avrDudePath', e.target.value)} placeholder="auto" />
      </SettingsField>
      <GroupHeader title="Status" />
      <SettingsField name="tsuki CLI" desc="Main CLI binary">
        <Badge variant={toolStatus.tsuki ?? 'ok'}>{toolStatus.tsuki === 'warn' ? 'Not found in PATH' : 'Found · v0.4.2'}</Badge>
      </SettingsField>
      <SettingsField name="tsuki-core" desc="Rust transpiler">
        <Badge variant={toolStatus.core ?? 'ok'}>{toolStatus.core === 'warn' ? 'Not found' : 'Found · v0.4.2'}</Badge>
      </SettingsField>
      <SettingsField name="arduino-cli" desc="Required for build + upload">
        <Badge variant={toolStatus.arduino ?? 'warn'}>{toolStatus.arduino === 'ok' ? 'Found' : 'Not found in PATH'}</Badge>
      </SettingsField>
    </div>
  )
}

// ── Defaults tab ───────────────────────────────────────────────────────────────

function DefaultsTab() {
  const { settings, updateSetting } = useStore()
  return (
    <div>
      <SectionHeader title="Defaults" desc="Values written to ~/.config/tsuki/config.json" />
      <GroupHeader title="Build" />
      <SettingsField name="default_board" desc="Board when no --board flag is given">
        <Select value={settings.defaultBoard} onChange={e => updateSetting('defaultBoard', e.target.value)}>
          {['uno','nano','mega','leonardo','micro','pro_mini_5v','esp32','esp8266','d1_mini','pico'].map(b => <option key={b} value={b}>{b}</option>)}
        </Select>
      </SettingsField>
      <SettingsField name="default_baud" desc="Serial baud rate">
        <Select value={settings.defaultBaud} onChange={e => updateSetting('defaultBaud', e.target.value)}>
          {['9600','19200','38400','57600','115200'].map(b => <option key={b} value={b}>{b}</option>)}
        </Select>
      </SettingsField>
      <SettingsField name="cpp_std" desc="C++ standard for arduino-cli">
        <Select value={settings.cppStd} onChange={e => updateSetting('cppStd', e.target.value)}>
          {['c++11','c++14','c++17'].map(v => <option key={v} value={v}>{v}</option>)}
        </Select>
      </SettingsField>
      <GroupHeader title="Behavior" />
      <SettingsField name="verbose" desc="Show detailed CLI output"><Toggle on={settings.verbose} onToggle={() => updateSetting('verbose', !settings.verbose)} /></SettingsField>
      <SettingsField name="auto_detect" desc="Auto-detect connected boards via USB"><Toggle on={settings.autoDetect} onToggle={() => updateSetting('autoDetect', !settings.autoDetect)} /></SettingsField>
      <SettingsField name="color" desc="Enable colored terminal output"><Toggle on={settings.color} onToggle={() => updateSetting('color', !settings.color)} /></SettingsField>
    </div>
  )
}

// ── Editor tab ─────────────────────────────────────────────────────────────────

function EditorTab() {
  const { settings, updateSetting } = useStore()
  return (
    <div>
      <SectionHeader title="Editor" desc="Customise the code editing experience." />
      <GroupHeader title="Appearance" />
      <SettingsField name="Font size" desc="Code editor font size in pixels">
        <div className="flex items-center gap-2">
          <Input type="number" value={settings.fontSize} onChange={e => updateSetting('fontSize', Number(e.target.value))} min="10" max="24" className="w-20" />
          <span className="text-xs text-[var(--fg-faint)]">px</span>
        </div>
      </SettingsField>
      <SettingsField name="Tab size" desc="Spaces per tab stop">
        <Select value={String(settings.tabSize)} onChange={e => updateSetting('tabSize', Number(e.target.value))}>
          {['2','4','8'].map(v => <option key={v} value={v}>{v} spaces</option>)}
        </Select>
      </SettingsField>
      <SettingsField name="Minimap" desc="Show code minimap on the right edge"><Toggle on={settings.minimap} onToggle={() => updateSetting('minimap', !settings.minimap)} /></SettingsField>
      <SettingsField name="Word wrap" desc="Wrap long lines to viewport"><Toggle on={settings.wordWrap} onToggle={() => updateSetting('wordWrap', !settings.wordWrap)} /></SettingsField>
      <GroupHeader title="Formatting" />
      <SettingsField name="Format on save" desc="Run gofmt on file save"><Toggle on={settings.formatOnSave} onToggle={() => updateSetting('formatOnSave', !settings.formatOnSave)} /></SettingsField>
      <SettingsField name="Trim trailing whitespace" desc="Remove trailing spaces on save"><Toggle on={settings.trimWhitespace} onToggle={() => updateSetting('trimWhitespace', !settings.trimWhitespace)} /></SettingsField>
    </div>
  )
}