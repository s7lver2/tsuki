'use client'
import { useStore, SettingsTab, SettingsState } from '@/lib/store'
import { IDE_THEMES, SYNTAX_THEMES } from '@/lib/themes'
import { Btn, Input, Select, Toggle, Badge, Divider } from '@/components/ui/primitives'
import { ArrowLeft, Terminal, Sliders, Code2, RefreshCw, FolderOpen, Palette, Check } from 'lucide-react'
import { useState } from 'react'
import { clsx } from 'clsx'

const NAV: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'appearance', label: 'Appearance', icon: <Palette size={13} /> },
  { id: 'cli',        label: 'CLI Tools',  icon: <Terminal size={13} /> },
  { id: 'defaults',   label: 'Defaults',   icon: <Sliders  size={13} /> },
  { id: 'editor',     label: 'Editor',     icon: <Code2    size={13} /> },
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
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl px-10 py-8">
            {settingsTab === 'appearance' && <AppearanceTab />}
            {settingsTab === 'cli'        && <CliTab />}
            {settingsTab === 'defaults'   && <DefaultsTab />}
            {settingsTab === 'editor'     && <EditorTab />}
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
              {/* Mini editor preview */}
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
              <div
                className="text-[9px] mt-0.5"
                style={{ color: theme.preview.fg, opacity: 0.4 }}
              >
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
              {/* Color swatches */}
              <div className="flex gap-1 flex-shrink-0">
                {st.swatches.map((color, i) => (
                  <div
                    key={i}
                    className="w-3 h-3 rounded-full ring-1 ring-black/10"
                    style={{ background: color }}
                    title={['keyword', 'string', 'number', 'function', 'comment'][i]}
                  />
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
          <input
            type="range"
            min="0.80"
            max="1.25"
            step="0.05"
            value={settings.uiScale ?? 1}
            onChange={e => updateSetting('uiScale', Number(e.target.value))}
            className="flex-1 accent-[var(--fg)]"
          />
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