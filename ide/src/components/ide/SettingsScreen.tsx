'use client'
import { useStore, SettingsTab, SettingsState } from '@/lib/store'
import { Btn, Input, Select, Toggle, Badge, Divider } from '@/components/ui/primitives'
import { ArrowLeft, Terminal, Sliders, Code2, RefreshCw } from 'lucide-react'
import { useState } from 'react'

const NAV: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'cli',      label: 'CLI Tools', icon: <Terminal size={13} /> },
  { id: 'defaults', label: 'Defaults',  icon: <Sliders size={13} /> },
  { id: 'editor',   label: 'Editor',    icon: <Code2 size={13} /> },
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
  const { setScreen, openTabs, settingsTab, setSettingsTab, toggleTheme, theme } = useStore()

  function back() {
    if (openTabs.length > 0) setScreen('ide')
    else setScreen('welcome')
  }

  return (
    <div className="h-screen flex flex-col bg-[var(--surface)] text-[var(--fg)]">
      {/* Topbar */}
      <div className="h-11 flex items-center px-4 gap-3 border-b border-[var(--border)] flex-shrink-0">
        <Btn variant="ghost" size="xs" onClick={back}>
          <ArrowLeft size={13} /> Back
        </Btn>
        <Divider vertical />
        <span className="text-sm font-semibold">Settings</span>
        <div className="ml-auto">
          <Btn variant="ghost" size="xs" onClick={toggleTheme} className="font-mono text-[10px]">
            {theme === 'dark' ? '◐ dark' : '○ light'}
          </Btn>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Nav */}
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
              {n.icon}
              {n.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl px-10 py-8">
            {settingsTab === 'cli'      && <CliTab />}
            {settingsTab === 'defaults' && <DefaultsTab />}
            {settingsTab === 'editor'   && <EditorTab />}
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

function CliTab() {
  const { settings, updateSetting, addLog } = useStore()
  const [detecting, setDetecting] = useState<string | null>(null)
  const [toolStatus, setToolStatus] = useState<Record<string, 'ok' | 'warn' | null>>({
    tsuki: null, core: null, arduino: null,
  })

  async function detect(tool: string, key: keyof SettingsState) {
    setDetecting(tool)
    try {
      const { detectTool } = await import('@/lib/tauri')
      const result = await detectTool(tool === 'tsuki' ? settings.tsukiPath || 'tsuki' : settings.arduinoCliPath || tool)
      setToolStatus(s => ({ ...s, [tool]: 'ok' }))
      addLog('ok', `Detected ${tool}: ${result}`)
    } catch (e) {
      setToolStatus(s => ({ ...s, [tool]: 'warn' }))
      addLog('warn', `${tool} not found — check PATH or set path manually`)
    }
    setDetecting(null)
  }

  return (
    <div>
      <SectionHeader title="CLI Tools" desc="Configure paths to the tsuki CLI and toolchain binaries." />
      <GroupHeader title="Tool Paths" />
      <SettingsField name="tsuki CLI path" desc="Path to the main tsuki/godotino CLI binary">
        <div className="flex gap-2">
          <Input
            value={settings.tsukiPath}
            onChange={e => updateSetting('tsukiPath', e.target.value)}
            placeholder="/usr/local/bin/tsuki"
            className="flex-1"
          />
          <Btn variant="outline" size="xs" onClick={() => detect('tsuki', 'tsukiPath')} disabled={detecting === 'tsuki'}>
            {detecting === 'tsuki' ? <RefreshCw size={11} className="animate-spin" /> : 'Detect'}
          </Btn>
        </div>
      </SettingsField>
      <SettingsField name="tsuki-core path" desc="Rust transpiler — auto-detected by default">
        <Input
          value={settings.tsukiCorePath}
          onChange={e => updateSetting('tsukiCorePath', e.target.value)}
          placeholder="auto (recommended)"
        />
      </SettingsField>
      <SettingsField name="arduino-cli path" desc="Required for compile and upload">
        <div className="flex gap-2">
          <Input
            value={settings.arduinoCliPath}
            onChange={e => updateSetting('arduinoCliPath', e.target.value)}
            className="flex-1"
          />
          <Btn variant="outline" size="xs" onClick={() => detect('arduino', 'arduinoCliPath')} disabled={detecting === 'arduino'}>
            {detecting === 'arduino' ? <RefreshCw size={11} className="animate-spin" /> : 'Detect'}
          </Btn>
        </div>
      </SettingsField>
      <SettingsField name="avrdude path" desc="Used by tsuki-flash for AVR boards">
        <Input
          value={settings.avrDudePath}
          onChange={e => updateSetting('avrDudePath', e.target.value)}
          placeholder="auto"
        />
      </SettingsField>

      <GroupHeader title="Status" />
      <SettingsField name="tsuki CLI" desc="Main CLI binary">
        <Badge variant={toolStatus.tsuki ?? 'ok'}>
          {toolStatus.tsuki === 'warn' ? 'Not found in PATH' : 'Found · v0.4.2'}
        </Badge>
      </SettingsField>
      <SettingsField name="tsuki-core" desc="Rust transpiler">
        <Badge variant={toolStatus.core ?? 'ok'}>
          {toolStatus.core === 'warn' ? 'Not found' : 'Found · v0.4.2'}
        </Badge>
      </SettingsField>
      <SettingsField name="arduino-cli" desc="Required for build + upload">
        <Badge variant={toolStatus.arduino ?? 'warn'}>
          {toolStatus.arduino === 'ok' ? 'Found' : 'Not found in PATH'}
        </Badge>
      </SettingsField>
    </div>
  )
}

function DefaultsTab() {
  const { settings, updateSetting } = useStore()

  return (
    <div>
      <SectionHeader title="Defaults" desc="Values written to ~/.config/tsuki/config.json" />
      <GroupHeader title="Build" />
      <SettingsField name="default_board" desc="Board when no --board flag is given">
        <Select value={settings.defaultBoard} onChange={e => updateSetting('defaultBoard', e.target.value)}>
          {['uno','nano','mega','leonardo','micro','pro_mini_5v','esp32','esp8266','d1_mini','pico'].map(b => (
            <option key={b} value={b}>{b}</option>
          ))}
        </Select>
      </SettingsField>
      <SettingsField name="default_baud" desc="Serial baud rate">
        <Select value={settings.defaultBaud} onChange={e => updateSetting('defaultBaud', e.target.value)}>
          {['9600','19200','38400','57600','115200'].map(b => (
            <option key={b} value={b}>{b}</option>
          ))}
        </Select>
      </SettingsField>
      <SettingsField name="cpp_std" desc="C++ standard for arduino-cli">
        <Select value={settings.cppStd} onChange={e => updateSetting('cppStd', e.target.value)}>
          {['c++11','c++14','c++17'].map(v => (
            <option key={v} value={v}>{v}</option>
          ))}
        </Select>
      </SettingsField>
      <GroupHeader title="Behavior" />
      <SettingsField name="verbose" desc="Show detailed CLI output">
        <Toggle on={settings.verbose} onToggle={() => updateSetting('verbose', !settings.verbose)} />
      </SettingsField>
      <SettingsField name="auto_detect" desc="Auto-detect connected boards via USB">
        <Toggle on={settings.autoDetect} onToggle={() => updateSetting('autoDetect', !settings.autoDetect)} />
      </SettingsField>
      <SettingsField name="color" desc="Enable colored terminal output">
        <Toggle on={settings.color} onToggle={() => updateSetting('color', !settings.color)} />
      </SettingsField>
    </div>
  )
}

function PackagesTab() {
  const { settings, updateSetting } = useStore()
  const [installing, setInstalling] = useState<string | null>(null)
  const [installed, setInstalled] = useState(['dht', 'ws2812', 'u8g2'])

  const CATALOG = [
    { name: 'dht',         desc: 'DHT11/DHT22 sensor library',    v: 'v1.0.0' },
    { name: 'ws2812',      desc: 'NeoPixel / WS2812 LED strip',   v: 'v1.0.0' },
    { name: 'u8g2',        desc: 'OLED / LCD display library',    v: 'v1.0.0' },
    { name: 'Servo',       desc: 'Servo motor control',           v: 'v1.0.0' },
    { name: 'LiquidCrystal', desc: 'LCD display (parallel)',      v: 'v1.0.0' },
    { name: 'IRremote',    desc: 'Infrared remote control',       v: 'v1.0.0' },
    { name: 'RTClib',      desc: 'Real-time clock (DS1307/3231)', v: 'v1.0.0' },
    { name: 'MFRC522',     desc: 'RFID reader',                   v: 'v1.0.0' },
  ]

  async function toggleInstall(name: string) {
    setInstalling(name)
    await new Promise(r => setTimeout(r, 900))
    if (installed.includes(name)) {
      setInstalled(i => i.filter(x => x !== name))
    } else {
      setInstalled(i => [...i, name])
    }
    setInstalling(null)
  }

  return (
    <div>
      <SectionHeader title="Packages" desc="Manage the GoDotIno package registry and installed libraries." />
      <GroupHeader title="Registry" />
      <SettingsField name="libs_dir" desc="Local install path">
        <Input value={settings.libsDir} onChange={e => updateSetting('libsDir', e.target.value)} />
      </SettingsField>
      <SettingsField name="registry_url" desc="Package registry JSON endpoint">
        <Input value={settings.registryUrl} onChange={e => updateSetting('registryUrl', e.target.value)} />
      </SettingsField>
      <SettingsField name="verify_signatures" desc="Verify package signatures on install">
        <Toggle on={settings.verifySignatures} onToggle={() => updateSetting('verifySignatures', !settings.verifySignatures)} />
      </SettingsField>
      <GroupHeader title="Available Packages" />
      {CATALOG.map(p => (
        <SettingsField key={p.name} name={p.name} desc={p.desc}>
          <div className="flex items-center gap-2">
            <Badge variant={installed.includes(p.name) ? 'ok' : 'default'}>
              {installed.includes(p.name) ? `installed ${p.v}` : p.v}
            </Badge>
            <Btn
              variant={installed.includes(p.name) ? 'danger' : 'outline'}
              size="xs"
              onClick={() => toggleInstall(p.name)}
              disabled={installing === p.name}
            >
              {installing === p.name
                ? <RefreshCw size={10} className="animate-spin" />
                : installed.includes(p.name) ? 'Remove' : 'Install'
              }
            </Btn>
          </div>
        </SettingsField>
      ))}
    </div>
  )
}

function EditorTab() {
  const { settings, updateSetting } = useStore()

  return (
    <div>
      <SectionHeader title="Editor" desc="Customize the code editing experience." />
      <GroupHeader title="Appearance" />
      <SettingsField name="Font size" desc="Code editor font size in pixels">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={settings.fontSize}
            onChange={e => updateSetting('fontSize', Number(e.target.value))}
            min="10" max="24"
            className="w-20"
          />
          <span className="text-xs text-[var(--fg-faint)]">px</span>
        </div>
      </SettingsField>
      <SettingsField name="Tab size" desc="Spaces per tab stop">
        <Select value={String(settings.tabSize)} onChange={e => updateSetting('tabSize', Number(e.target.value))}>
          {['2','4','8'].map(v => <option key={v} value={v}>{v} spaces</option>)}
        </Select>
      </SettingsField>
      <SettingsField name="Minimap" desc="Show code minimap on the right edge">
        <Toggle on={settings.minimap} onToggle={() => updateSetting('minimap', !settings.minimap)} />
      </SettingsField>
      <SettingsField name="Word wrap" desc="Wrap long lines to viewport">
        <Toggle on={settings.wordWrap} onToggle={() => updateSetting('wordWrap', !settings.wordWrap)} />
      </SettingsField>
      <GroupHeader title="Formatting" />
      <SettingsField name="Format on save" desc="Run gofmt on file save">
        <Toggle on={settings.formatOnSave} onToggle={() => updateSetting('formatOnSave', !settings.formatOnSave)} />
      </SettingsField>
      <SettingsField name="Trim trailing whitespace" desc="Remove trailing spaces on save">
        <Toggle on={settings.trimWhitespace} onToggle={() => updateSetting('trimWhitespace', !settings.trimWhitespace)} />
      </SettingsField>
    </div>
  )
}