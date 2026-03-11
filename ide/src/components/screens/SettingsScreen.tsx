'use client'
import { useStore, SettingsTab, SettingsState } from '@/lib/store'
import { IDE_THEMES, SYNTAX_THEMES } from '@/lib/themes'
import { ICON_PACKS } from '@/lib/iconPacks'
import { Btn, Input, Select, Toggle, Badge, Divider } from '@/components/shared/primitives'
import {
  ArrowLeft, Terminal, Sliders, Code2, RefreshCw, FolderOpen,
  Palette, Check, Cpu, FlaskConical, ChevronRight, Zap, FlaskRound,
  Beaker, ToggleLeft, GitBranch, Languages,
} from 'lucide-react'
import { useState } from 'react'
import { clsx } from 'clsx'
import { useT, AVAILABLE_LANGS, LANG_META, LangCode } from '@/lib/i18n'

// ─────────────────────────────────────────────────────────────────────────────
//  Nav definitions
// ─────────────────────────────────────────────────────────────────────────────

const MAIN_NAV: { id: SettingsTab; labelKey: string; icon: React.ReactNode }[] = [
  { id: 'appearance', labelKey: 'settings.tab_appearance', icon: <Palette  size={13} /> },
  { id: 'cli',        labelKey: 'settings.tab_tools',      icon: <Terminal size={13} /> },
  { id: 'defaults',   labelKey: 'settings.tab_board',      icon: <Sliders  size={13} /> },
  { id: 'editor',     labelKey: 'settings.tab_editor',     icon: <Code2    size={13} /> },
  { id: 'language',   labelKey: 'settings.tab_language',   icon: <Languages size={13} /> },
]

const DEV_NAV: { id: SettingsTab; labelKey: string; icon: React.ReactNode }[] = [
  { id: 'developer', labelKey: 'settings.tab_developer', icon: <Beaker size={13} /> },
]

const EXP_NAV: { id: SettingsTab; label: string; icon: React.ReactNode; settingKey?: 'expSandboxEnabled' | 'expGitEnabled' | 'expLspEnabled' }[] = [
  { id: 'experiments', label: 'General',   icon: <FlaskConical size={13} /> },
  { id: 'exp-sandbox', label: 'Sandbox',   icon: <Cpu          size={13} />, settingKey: 'expSandboxEnabled' },
  { id: 'exp-git',     label: 'Git',       icon: <GitBranch    size={13} />, settingKey: 'expGitEnabled'     },
  { id: 'exp-lsp',     label: 'LSP',       icon: <Zap          size={13} />, settingKey: 'expLspEnabled'     },
]

// ─────────────────────────────────────────────────────────────────────────────
//  Shared primitives
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
//  Sidebar nav item
// ─────────────────────────────────────────────────────────────────────────────

function NavItem({
  id, label, icon, active, badge, onClick,
}: {
  id: SettingsTab; label: string; icon: React.ReactNode
  active: boolean; badge?: React.ReactNode; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-2.5 px-2.5 py-1.5 rounded text-sm cursor-pointer border-0 text-left transition-colors w-full',
        active
          ? 'bg-[var(--active)] text-[var(--fg)] font-medium'
          : 'bg-transparent text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
      )}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {badge}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Root screen
// ─────────────────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { setScreen, settingsTab, setSettingsTab, toggleTheme, theme, goBack, settings } = useStore()
  const expEnabled = settings.experimentsEnabled
  const t = useT()

  return (
    <div className="h-screen flex flex-col bg-[var(--surface)] text-[var(--fg)]">
      {/* ── Top bar ── */}
      <div className="h-11 flex items-center px-4 gap-3 border-b border-[var(--border)] flex-shrink-0">
        <Btn variant="ghost" size="xs" onClick={goBack}><ArrowLeft size={13} /> {t('common.back')}</Btn>
        <Divider vertical />
        <span className="text-sm font-semibold">{t('settings.title')}</span>
        <div className="ml-auto">
          <Btn variant="ghost" size="xs" onClick={toggleTheme} className="font-mono text-[10px]">
            {theme === 'dark' ? '◐ dark' : '○ light'}
          </Btn>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ── */}
        <div className="w-48 border-r border-[var(--border)] bg-[var(--surface-1)] flex flex-col flex-shrink-0 overflow-y-auto">

          {/* Main settings group */}
          <div className="p-2 flex flex-col gap-0.5">
            {MAIN_NAV.map(n => (
              <NavItem
                key={n.id} id={n.id} label={t(n.labelKey)} icon={n.icon}
                active={settingsTab === n.id}
                onClick={() => setSettingsTab(n.id)}
              />
            ))}
          </div>

          {/* Divider + Experiments group */}
          <div className="mx-2 border-t border-[var(--border)] mt-1" />

          <div className="p-2 pb-3 flex flex-col gap-0.5">
            {/* Section label */}
            <div className="flex items-center gap-1.5 px-2 py-1.5 mb-0.5">
              <FlaskConical size={11} className="text-[var(--fg-faint)]" />
              <span className="text-[10px] font-semibold text-[var(--fg-faint)] uppercase tracking-widest">
                {t('settings.tab_experiments')}
              </span>
              {expEnabled && (
                <span className="ml-auto text-[8px] font-mono text-green-400 bg-green-400/10 px-1 rounded">ON</span>
              )}
            </div>

            {/* General experiments tab — always visible */}
            <NavItem
              id="experiments" label={t('common.settings')} icon={<FlaskConical size={13} />}
              active={settingsTab === 'experiments'}
              onClick={() => setSettingsTab('experiments')}
              badge={
                !expEnabled
                  ? <span className="w-1.5 h-1.5 rounded-full bg-[var(--fg-faint)] opacity-50" />
                  : undefined
              }
            />

            {/* Per-experiment tabs — only when that specific experiment is enabled */}
            {expEnabled && EXP_NAV.filter(n => n.id !== 'experiments').map(n => {
              if (n.settingKey && !settings[n.settingKey]) return null
              return (
                <NavItem
                  key={n.id} id={n.id as SettingsTab} label={n.label} icon={n.icon}
                  active={settingsTab === n.id}
                  onClick={() => setSettingsTab(n.id as SettingsTab)}
                  badge={<span className="text-[9px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1 rounded">β</span>}
                />
              )
            })}
          </div>

          {/* Developer options section — only visible when developerOptions is ON */}
          {settings.developerOptions && (
            <>
              <div className="mx-2 border-t border-[var(--border)] mt-1" />
              <div className="p-2 pb-3 flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5 px-2 py-1.5 mb-0.5">
                  <Beaker size={11} className="text-[var(--fg-faint)]" />
                  <span className="text-[10px] font-semibold text-[var(--fg-faint)] uppercase tracking-widest">
                    Developer
                  </span>
                </div>
                {DEV_NAV.map(n => (
                  <NavItem
                    key={n.id} id={n.id} label={t(n.labelKey)} icon={n.icon}
                    active={settingsTab === n.id}
                    onClick={() => setSettingsTab(n.id)}
                    badge={<span className="text-[9px] font-mono text-amber-400 bg-amber-400/10 px-1 rounded">dev</span>}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl px-10 py-8">
            {settingsTab === 'appearance'   && <AppearanceTab />}
            {settingsTab === 'cli'          && <CliTab />}
            {settingsTab === 'defaults'     && <DefaultsTab />}
            {settingsTab === 'editor'       && <EditorTab />}
            {settingsTab === 'language'     && <LanguageTab />}
            {settingsTab === 'experiments'  && <ExperimentsTab />}
            {settingsTab === 'exp-sandbox'  && expEnabled && settings.expSandboxEnabled && <SandboxTab />}
            {settingsTab === 'exp-git'      && expEnabled && settings.expGitEnabled && <GitExpTab />}
            {settingsTab === 'exp-lsp'      && expEnabled && settings.expLspEnabled && <LspExpTab />}
            {settingsTab === 'developer'    && settings.developerOptions && <DeveloperTab />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Experiments — General tab
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
//  Experiment registry — single source of truth
// ─────────────────────────────────────────────────────────────────────────────

interface ExpDef {
  id: string
  tab: SettingsTab
  name: string
  tag: string
  icon: React.ReactNode
  desc: string
  settingKey: 'expSandboxEnabled' | 'expGitEnabled' | 'expLspEnabled'  // union grows as experiments are added
  resources: string                 // what it costs when enabled
}

const EXPERIMENTS: ExpDef[] = [
  {
    id: 'sandbox',
    tab: 'exp-sandbox',
    name: 'Sandbox',
    tag: 'β',
    icon: <Cpu size={16} />,
    desc: 'Virtual Arduino circuit simulator. Place components, wire them up, and visualise your firmware pin states without physical hardware.',
    settingKey: 'expSandboxEnabled',
    resources: 'Adds ~800 KB to the renderer bundle. Rendering thread only — no background processes.',
  },
  {
    id: 'git',
    tab: 'exp-git',
    name: 'Git Integration',
    tag: 'β',
    icon: <GitBranch size={16} />,
    desc: 'Source control panel with staged/unstaged changes, commit history graph, and basic push/pull operations. Requires git in PATH.',
    settingKey: 'expGitEnabled',
    resources: 'Runs git commands as subprocesses. No background polling — commands execute on demand only.',
  },
  {
    id: 'lsp',
    tab: 'exp-lsp',
    name: 'Language Server (LSP)',
    tag: 'α',
    icon: <Zap size={16} />,
    desc: 'Enable tsuki-lsp for completions, diagnostics, and hover docs. Supports Go, C++, and .ino files.',
    settingKey: 'expLspEnabled',
    resources: 'Launches a background tsuki-lsp process. Adds ~5–15 MB RAM. Requires tsuki-lsp in PATH.',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
//  ExperimentsTab — General
// ─────────────────────────────────────────────────────────────────────────────

function ExperimentsTab() {
  const { settings, updateSetting, setSettingsTab } = useStore()
  const enabled = settings.experimentsEnabled

  if (!enabled) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-6 select-none">
        <div className="relative">
          <div className="w-20 h-20 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] flex items-center justify-center">
            <FlaskConical size={36} className="text-[var(--fg-faint)]" />
          </div>
          <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[var(--surface-3)] border border-[var(--border)] flex items-center justify-center">
            <span className="text-[9px] font-mono text-[var(--fg-faint)]">β</span>
          </div>
        </div>

        <div className="max-w-xs">
          <h2 className="text-base font-semibold mb-2">Experiments</h2>
          <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
            Features under active development. Expect rough edges, incomplete behaviour, and breaking changes between updates.
          </p>
        </div>

        {/* Preview cards */}
        <div className="flex flex-col gap-2 max-w-xs w-full">
          {EXPERIMENTS.map(exp => (
            <div key={exp.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
              <span className="text-[var(--fg-faint)]">{exp.icon}</span>
              <div className="flex-1 text-left">
                <div className="text-xs font-medium">{exp.name}</div>
                <div className="text-[10px] text-[var(--fg-faint)]">{exp.desc.slice(0, 52)}…</div>
              </div>
              <ChevronRight size={11} className="text-[var(--fg-faint)]" />
            </div>
          ))}
        </div>

        <Btn variant="outline" size="sm" onClick={() => updateSetting('experimentsEnabled', true)} className="mt-2 gap-2">
          <FlaskConical size={13} /> Enable Experiments
        </Btn>
        <p className="text-[10px] text-[var(--fg-faint)] max-w-xs leading-relaxed">
          Each experiment can be toggled individually once enabled. Disabled experiments load no extra code.
        </p>
      </div>
    )
  }

  // ── Enabled state ──────────────────────────────────────────────────────────
  const anyOn = EXPERIMENTS.some(e => settings[e.settingKey])

  return (
    <div>
      <div className="flex items-start gap-3 mb-7">
        <div className="w-10 h-10 rounded-lg border border-[var(--border)] flex items-center justify-center flex-shrink-0">
          <FlaskConical size={18} className="text-[var(--fg-muted)]" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-semibold tracking-tight">Experiments</h2>
            <span className="text-xs font-mono text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded">enabled</span>
          </div>
          <p className="text-sm text-[var(--fg-muted)]">
            Toggle individual experiments below. Disabled experiments are completely inert — they load no code and consume no resources.
          </p>
        </div>
      </div>

      <GroupHeader title="Master switch" />
      <SettingsField name="Experiments enabled" desc="Turn off to disable all experimental tabs and features globally.">
        <Toggle on={settings.experimentsEnabled} onToggle={() => {
          // disabling the master also disables all individual experiments
          if (settings.experimentsEnabled) {
            EXPERIMENTS.forEach(e => updateSetting(e.settingKey, false))
          }
          updateSetting('experimentsEnabled', !settings.experimentsEnabled)
        }} />
      </SettingsField>

      <GroupHeader title="Individual experiments" />
      <div className="mt-3 flex flex-col gap-2.5">
        {EXPERIMENTS.map(exp => (
          <ExperimentCard
            key={exp.id}
            exp={exp}
            active={settings[exp.settingKey]}
            onToggle={() => updateSetting(exp.settingKey, !settings[exp.settingKey])}
            onOpen={() => setSettingsTab(exp.tab)}
          />
        ))}
      </div>

      {anyOn && (
        <div className="mt-6 flex items-start gap-2 px-3 py-3 rounded-lg bg-[var(--surface-1)] border border-[var(--border)]">
          <span className="text-[10px] text-[var(--fg-faint)] leading-relaxed">
            Active experiments add extra weight to the renderer. Disable unused ones to keep the IDE lean.
          </span>
        </div>
      )}

      <GroupHeader title="Developer" />
      <SettingsField
        name="Developer Options"
        desc="Unlock a hidden Developer tab in the sidebar with tools for debugging and resetting the IDE state."
      >
        <Toggle
          on={settings.developerOptions}
          onToggle={() => updateSetting('developerOptions', !settings.developerOptions)}
        />
      </SettingsField>
    </div>
  )
}

function ExperimentCard({
  exp, active, onToggle, onOpen,
}: {
  exp: ExpDef; active: boolean; onToggle: () => void; onOpen: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={clsx(
      'rounded-lg border transition-colors',
      active ? 'border-[var(--fg-faint)] bg-[var(--surface-1)]' : 'border-[var(--border)] bg-[var(--surface-1)]',
    )}>
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={clsx('flex-shrink-0 transition-colors', active ? 'text-[var(--fg-muted)]' : 'text-[var(--fg-faint)]')}>
          {exp.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-medium">{exp.name}</span>
            <span className="text-[9px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1 rounded">{exp.tag}</span>
            {active && <span className="text-[9px] font-mono text-green-400 bg-green-400/10 px-1 rounded">on</span>}
          </div>
          <p className="text-xs text-[var(--fg-muted)] leading-relaxed line-clamp-2">{exp.desc}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {active && (
            <Btn variant="ghost" size="xs" onClick={onOpen}>
              Settings <ChevronRight size={11} />
            </Btn>
          )}
          <Toggle on={active} onToggle={onToggle} />
        </div>
      </div>

      {/* Expandable detail */}
      <button
        onClick={() => setExpanded(x => !x)}
        className="w-full flex items-center gap-1 px-4 pb-2 text-[10px] text-[var(--fg-faint)] hover:text-[var(--fg-muted)] border-0 bg-transparent cursor-pointer transition-colors"
      >
        <ChevronRight size={9} className={clsx('transition-transform', expanded && 'rotate-90')} />
        Resource usage & details
      </button>

      {expanded && (
        <div className="px-4 pb-3 text-xs text-[var(--fg-muted)] border-t border-[var(--border-subtle)] pt-2.5 leading-relaxed">
          <p className="mb-1"><span className="font-medium text-[var(--fg)]">Resources:</span> {exp.resources}</p>
          <p><span className="font-medium text-[var(--fg)]">Status:</span> {active ? 'Active — loaded into the renderer.' : 'Inactive — no code loaded, no impact on performance.'}</p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sandbox experiment tab
// ─────────────────────────────────────────────────────────────────────────────

function SandboxTab() {
  const { settings, updateSetting } = useStore()

  const CIRCUIT_FORMAT = `{
  "version": "1",
  "name": "My Circuit",
  "board": "uno",
  "components": [
    {
      "id": "mcu",
      "type": "arduino_uno",
      "label": "Arduino Uno",
      "x": 80, "y": 60, "rotation": 0, "color": "#1a6b2e"
    },
    {
      "id": "led1",
      "type": "led",
      "label": "LED1",
      "x": 260, "y": 80, "rotation": 0, "color": "#ef4444"
    }
  ],
  "wires": [
    {
      "id": "w1",
      "fromComp": "mcu", "fromPin": "D13",
      "toComp": "led1", "toPin": "anode",
      "color": "#f97316"
    }
  ]
}`

  return (
    <div>
      <div className="flex items-start gap-3 mb-7">
        <div className="w-10 h-10 rounded-lg border border-[var(--border)] flex items-center justify-center flex-shrink-0">
          <Cpu size={18} className="text-[var(--fg-muted)]" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-semibold tracking-tight">Sandbox</h2>
            <span className="text-xs font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded">experimental</span>
          </div>
          <p className="text-sm text-[var(--fg-muted)]">
            Virtual Arduino circuit simulator. Build circuits visually or from a text file, then run your tsuki program against the virtual hardware.
          </p>
        </div>
      </div>

      <GroupHeader title="Settings" />
      <SettingsField
        name="Current flow animation"
        desc="Animated dots on active wires during simulation. Disable for a cleaner look."
      >
        <Toggle
          on={settings.showCurrentFlow}
          onToggle={() => updateSetting('showCurrentFlow', !settings.showCurrentFlow)}
        />
      </SettingsField>

      <SettingsField
        name="Energy flow visualisation"
        desc="When enabled, tsuki-sim computes per-pin voltage and current. Requires showCurrentFlow to be active for wire animation."
      >
        <Toggle
          on={settings.showCurrentFlow}
          onToggle={() => updateSetting('showCurrentFlow', !settings.showCurrentFlow)}
        />
      </SettingsField>

      <SettingsField
        name="tsuki-sim path"
        desc="Path to the tsuki-sim binary. Leave blank to auto-detect next to tsuki-core or from PATH."
      >
        <div className="flex items-center gap-1.5 flex-1">
          <input
            value={(settings as any).tsukiSimPath ?? ''}
            onChange={e => updateSetting('tsukiSimPath' as any, e.target.value)}
            placeholder="auto (tsuki-sim)"
            className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-xs text-[var(--fg)] outline-none font-mono"
          />
        </div>
      </SettingsField>

      <GroupHeader title="How to use" />
      <div className="mt-4 mb-6 flex flex-col gap-3">
        {[
          { step: '1', title: 'Open the Sandbox panel', desc: 'Click "Sandbox β" in the toolbar or the collapsed tab on the right edge. The panel is resizable.' },
          { step: '2', title: 'Build your circuit', desc: 'Use the Canvas view to place components and draw wires. Alt+drag or middle-mouse to pan, scroll to zoom.' },
          { step: '3', title: 'Import from text', desc: 'Switch to the Text view to paste a .tsuki-circuit JSON definition directly and click Apply.' },
          { step: '4', title: 'Simulate', desc: 'Open your .go file and press Run in the Sim view. The simulator parses digitalWrite/analogWrite and updates components in real time.' },
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

      <GroupHeader title="Supported components" />
      <div className="mt-3 mb-6 grid grid-cols-2 gap-2">
        {[
          { type: 'arduino_uno',   label: 'Arduino Uno',   cat: 'MCU',     color: '#1a6b2e' },
          { type: 'arduino_nano',  label: 'Arduino Nano',  cat: 'MCU',     color: '#0a4d8c' },
          { type: 'led',           label: 'LED',           cat: 'Output',  color: '#ef4444' },
          { type: 'resistor',      label: 'Resistor',      cat: 'Passive', color: '#a37a2c' },
          { type: 'button',        label: 'Push Button',   cat: 'Input',   color: '#555' },
          { type: 'potentiometer', label: 'Potentiometer', cat: 'Input',   color: '#4a4a4a' },
          { type: 'buzzer',        label: 'Buzzer',        cat: 'Output',  color: '#222' },
          { type: 'power_rail',    label: 'Power Rail',    cat: 'Power',   color: '#333' },
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

      <GroupHeader title=".tsuki-circuit format" />
      <div className="mt-3 mb-6">
        <p className="text-xs text-[var(--fg-muted)] mb-3 leading-relaxed">
          Circuits are stored as human-readable JSON in <span className="font-mono text-[var(--fg)]">.tsuki-circuit</span> files.
        </p>
        <pre className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg p-4 text-xs font-mono text-[var(--fg-muted)] overflow-x-auto leading-5 whitespace-pre">
          {CIRCUIT_FORMAT}
        </pre>
      </div>

      <GroupHeader title="Keyboard shortcuts" />
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {[
          ['S', 'Select / move'], ['W', 'Wire tool'], ['D', 'Delete tool'],
          ['Del', 'Delete selected'], ['Scroll', 'Zoom'], ['Alt + drag', 'Pan'],
          ['ESC', 'Cancel wire'],
        ].map(([key, desc]) => (
          <div key={key} className="flex items-center gap-2 py-1.5 border-b border-[var(--border-subtle)]">
            <kbd className="text-[10px] font-mono bg-[var(--surface-3)] border border-[var(--border)] rounded px-1.5 py-0.5 flex-shrink-0">{key}</kbd>
            <span className="text-xs text-[var(--fg-muted)]">{desc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Appearance tab
// ─────────────────────────────────────────────────────────────────────────────

function AppearanceTab() {
  const { settings, updateSetting } = useStore()
  // Local draft for uiScale — only committed to store on pointer/mouse up
  const [scaleLocal, setScaleLocal] = useState<number>(settings.uiScale ?? 1)

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
                'relative rounded-lg border-2 p-3 cursor-pointer transition-all text-left',
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
                <span className="text-[11px] font-medium" style={{ color: theme.preview.fg }}>{theme.name}</span>
                {active && (
                  <div className="w-3.5 h-3.5 rounded-full bg-green-500 flex items-center justify-center">
                    <Check size={8} className="text-white" />
                  </div>
                )}
              </div>
              <div className="text-[9px] mt-0.5" style={{ color: theme.preview.fg, opacity: 0.4 }}>{theme.base}</div>
            </button>
          )
        })}
      </div>

      <GroupHeader title="Icon Pack" />
      <div className="grid grid-cols-1 gap-2 mt-3 mb-6">
        {ICON_PACKS.map(pack => {
          const active = (settings.iconPack ?? 'minimal') === pack.id
          return (
            <button
              key={pack.id}
              onClick={() => updateSetting('iconPack', pack.id)}
              className={clsx(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left cursor-pointer transition-all',
                active
                  ? 'border-[var(--fg-muted)] bg-[var(--active)]'
                  : 'border-[var(--border)] hover:border-[var(--fg-faint)] hover:bg-[var(--hover)]',
              )}
            >
              {/* Live preview of icons from this pack */}
              <div className="flex items-center gap-2 flex-shrink-0 w-28">
                {/* Folder closed */}
                <span className="flex items-center gap-0.5">
                  {pack.folderIcon(false)}
                </span>
                {/* Folder open */}
                <span className="flex items-center gap-0.5">
                  {pack.folderIcon(true)}
                </span>
                {/* File icons sample */}
                {['go', 'json', 'cpp', 'md'].map(ext => (
                  <span key={ext} className="flex items-center">
                    {pack.fileIcon(ext)}
                  </span>
                ))}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--fg)]">{pack.name}</div>
                <div className="text-[11px] text-[var(--fg-muted)] mt-0.5">{pack.desc}</div>
              </div>
              {active && <Check size={13} className="text-green-400 flex-shrink-0" />}
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
                  <div key={i} className="w-3 h-3 rounded-full ring-1 ring-black/10" style={{ background: color }} />
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
            value={scaleLocal}
            onChange={e => setScaleLocal(Number(e.target.value))}
            onMouseUp={e => updateSetting('uiScale', Number((e.target as HTMLInputElement).value))}
            onTouchEnd={e => updateSetting('uiScale', Number((e.currentTarget as HTMLInputElement).value))}
            className="flex-1 accent-[var(--fg)]" />
          <span className="text-xs font-mono w-10 text-right text-[var(--fg-muted)]">
            {Math.round(scaleLocal * 100)}%
          </span>
        </div>
      </SettingsField>

      <GroupHeader title="Text Rendering" />
      <SettingsField
        name="Font smoothing"
        desc="Controls how fonts are anti-aliased. If text looks blurry or too thin, try 'Crisp' or 'Subpixel'."
      >
        <Select
          value={settings.fontRendering ?? 'auto'}
          onChange={e => updateSetting('fontRendering', e.target.value as 'auto' | 'crisp' | 'smooth' | 'subpixel')}
        >
          <option value="auto">Auto (OS default)</option>
          <option value="smooth">Smooth (antialiased)</option>
          <option value="subpixel">Subpixel (sharper on LCD)</option>
          <option value="crisp">Crisp (no smoothing)</option>
        </Select>
      </SettingsField>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  CLI Tools tab
// ─────────────────────────────────────────────────────────────────────────────

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
    } catch {
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
      <SettingsField name="tsuki-flash path" desc="AVR/ESP compile toolchain — auto-detected by default">
        <div className="flex gap-2">
          <Input value={settings.tsukiFlashPath} onChange={e => updateSetting('tsukiFlashPath', e.target.value)} placeholder="auto" className="flex-1" />
          <Btn variant="outline" size="xs" onClick={() => browseExe('tsukiFlashPath')}><FolderOpen size={11} /></Btn>
        </div>
      </SettingsField>
      <SettingsField name="tsuki-core path" desc="Rust transpiler — auto-detected by default">
        <Input value={settings.tsukiCorePath} onChange={e => updateSetting('tsukiCorePath', e.target.value)} placeholder="auto (recommended)" />
      </SettingsField>
      <SettingsField name="arduino-cli path" desc="Optional — required only if backend is set to arduino-cli">
        <div className="flex gap-2">
          <Input value={settings.arduinoCliPath} onChange={e => updateSetting('arduinoCliPath', e.target.value)} className="flex-1" />
          <Btn variant="outline" size="xs" onClick={() => detect('arduino', 'arduinoCliPath')} disabled={detecting === 'arduino'}>
            {detecting === 'arduino' ? <RefreshCw size={11} className="animate-spin" /> : 'Detect'}
          </Btn>
          <Btn variant="outline" size="xs" onClick={() => browseExe('arduinoCliPath')}><FolderOpen size={11} /></Btn>
        </div>
      </SettingsField>
      <SettingsField name="avrdude path" desc="Used by tsuki-flash for AVR board uploads">
        <Input value={settings.avrDudePath} onChange={e => updateSetting('avrDudePath', e.target.value)} placeholder="auto" />
      </SettingsField>

      <GroupHeader title="Status" />
      <SettingsField name="tsuki CLI" desc="Main CLI binary">
        <Badge variant={toolStatus.tsuki ?? 'ok'}>{toolStatus.tsuki === 'warn' ? 'Not found in PATH' : 'Found'}</Badge>
      </SettingsField>
      <SettingsField name="tsuki-core" desc="Rust transpiler">
        <Badge variant={toolStatus.core ?? 'ok'}>{toolStatus.core === 'warn' ? 'Not found' : 'Found'}</Badge>
      </SettingsField>
      <SettingsField name="arduino-cli" desc="Optional — only needed for arduino-cli backend">
        <Badge variant={toolStatus.arduino ?? 'warn'}>{toolStatus.arduino === 'ok' ? 'Found' : 'Not in PATH'}</Badge>
      </SettingsField>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Defaults tab
// ─────────────────────────────────────────────────────────────────────────────

function DefaultsTab() {
  const { settings, updateSetting } = useStore()
  return (
    <div>
      <SectionHeader title="Defaults" desc="Values written to ~/.config/tsuki/config.json on save." />

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
          {['9600','19200','38400','57600','115200','230400'].map(b => <option key={b} value={b}>{b}</option>)}
        </Select>
      </SettingsField>
      <SettingsField name="cpp_std" desc="C++ standard passed to the compiler">
        <Select value={settings.cppStd} onChange={e => updateSetting('cppStd', e.target.value)}>
          {['c++11','c++14','c++17'].map(v => <option key={v} value={v}>{v}</option>)}
        </Select>
      </SettingsField>

      <GroupHeader title="Packages" />
      <SettingsField name="libs_dir" desc="Local directory where tsukilib packages are installed">
        <Input value={settings.libsDir} onChange={e => updateSetting('libsDir', e.target.value)} placeholder="~/.tsuki/libs" />
      </SettingsField>
      <SettingsField name="registry_url" desc="Package registry endpoint">
        <Input value={settings.registryUrl} onChange={e => updateSetting('registryUrl', e.target.value)} />
      </SettingsField>
      <SettingsField name="verify_signatures" desc="Verify Ed25519 signatures when installing packages">
        <Toggle on={settings.verifySignatures} onToggle={() => updateSetting('verifySignatures', !settings.verifySignatures)} />
      </SettingsField>

      <GroupHeader title="Behaviour" />
      <SettingsField name="verbose" desc="Show detailed CLI output by default">
        <Toggle on={settings.verbose} onToggle={() => updateSetting('verbose', !settings.verbose)} />
      </SettingsField>
      <SettingsField name="auto_detect" desc="Auto-detect connected boards via USB">
        <Toggle on={settings.autoDetect} onToggle={() => updateSetting('autoDetect', !settings.autoDetect)} />
      </SettingsField>
      <SettingsField name="color" desc="Enable colored terminal output">
        <Toggle on={settings.color} onToggle={() => updateSetting('color', !settings.color)} />
      </SettingsField>
      <SettingsField name="compile_on_save" desc="Automatically compile when a file is saved">
        <Toggle on={settings.compileOnSave} onToggle={() => updateSetting('compileOnSave', !settings.compileOnSave)} />
      </SettingsField>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Editor tab
// ─────────────────────────────────────────────────────────────────────────────

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
      <SettingsField name="Indent with spaces" desc="Use spaces instead of tabs for indentation">
        <Toggle on={settings.insertSpaces} onToggle={() => updateSetting('insertSpaces', !settings.insertSpaces)} />
      </SettingsField>
      <SettingsField name="Show line numbers" desc="Display line numbers in the gutter">
        <Toggle on={settings.showLineNumbers} onToggle={() => updateSetting('showLineNumbers', !settings.showLineNumbers)} />
      </SettingsField>
      <SettingsField name="Highlight active line" desc="Highlight the line the cursor is on">
        <Toggle on={settings.highlightActiveLine} onToggle={() => updateSetting('highlightActiveLine', !settings.highlightActiveLine)} />
      </SettingsField>
      <SettingsField name="Minimap" desc="Show code minimap on the right edge">
        <Toggle on={settings.minimap} onToggle={() => updateSetting('minimap', !settings.minimap)} />
      </SettingsField>
      <SettingsField name="Word wrap" desc="Wrap long lines to viewport">
        <Toggle on={settings.wordWrap} onToggle={() => updateSetting('wordWrap', !settings.wordWrap)} />
      </SettingsField>

      <GroupHeader title="Formatting" />
      <SettingsField name="Format on save" desc="Run gofmt automatically on file save">
        <Toggle on={settings.formatOnSave} onToggle={() => updateSetting('formatOnSave', !settings.formatOnSave)} />
      </SettingsField>
      <SettingsField name="Trim trailing whitespace" desc="Remove trailing spaces when saving">
        <Toggle on={settings.trimWhitespace} onToggle={() => updateSetting('trimWhitespace', !settings.trimWhitespace)} />
      </SettingsField>
      <SettingsField name="Save on focus loss" desc="Auto-save when the editor loses focus">
        <Toggle on={settings.saveOnFocusLoss} onToggle={() => updateSetting('saveOnFocusLoss', !settings.saveOnFocusLoss)} />
      </SettingsField>

      <GroupHeader title="Intelligence" />
      <SettingsField name="Auto-close brackets" desc="Automatically insert matching brackets and quotes">
        <Toggle on={settings.autoCloseBrackets} onToggle={() => updateSetting('autoCloseBrackets', !settings.autoCloseBrackets)} />
      </SettingsField>
      <SettingsField name="Language server (LSP)" desc="Enable tsuki-lsp for completions, diagnostics, and hover docs">
        <div className="flex items-center gap-2">
          <Toggle on={settings.lspEnabled} onToggle={() => updateSetting('lspEnabled', !settings.lspEnabled)} />
          <span className="text-[10px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1 rounded">soon</span>
        </div>
      </SettingsField>
    </div>
  )
}
// ─────────────────────────────────────────────────────────────────────────────
//  Git experiment tab
// ─────────────────────────────────────────────────────────────────────────────

function GitExpTab() {
  const { settings, updateSetting } = useStore()

  return (
    <div>
      <div className="flex items-start gap-3 mb-7">
        <div className="w-10 h-10 rounded-lg border border-[var(--border)] flex items-center justify-center flex-shrink-0">
          <GitBranch size={18} className="text-[var(--fg-muted)]" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-semibold tracking-tight">Git Integration</h2>
            <span className="text-xs font-mono text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded">active</span>
            <span className="text-[9px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1 rounded">β</span>
          </div>
          <p className="text-sm text-[var(--fg-muted)]">
            Enables the Source Control sidebar tab, commit history graph, and git operations directly from the IDE.
          </p>
        </div>
      </div>

      <GroupHeader title="Behaviour" />
      <SettingsField
        name="Initialize git on new projects"
        desc="Run git init automatically when creating a new project."
      >
        <Toggle
          on={settings.verifySignatures}
          onToggle={() => {}}
        />
      </SettingsField>

      <GroupHeader title="Requirements" />
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3 flex flex-col gap-3 text-sm text-[var(--fg-muted)]">
        <div className="flex items-start gap-3">
          <GitBranch size={14} className="mt-0.5 text-[var(--fg-faint)] flex-shrink-0" />
          <div>
            <div className="font-medium text-[var(--fg)] mb-0.5">git must be in PATH</div>
            <p className="text-xs text-[var(--fg-faint)]">
              The git experiment runs <code className="font-mono bg-[var(--surface-3)] px-1 rounded">git</code> commands as subprocesses.
              Make sure git is installed and available in your system PATH.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-start gap-2 px-3 py-3 rounded-lg bg-yellow-400/5 border border-yellow-400/20">
        <span className="text-yellow-400 text-xs mt-0.5">⚠</span>
        <p className="text-xs text-[var(--fg-muted)] leading-relaxed">
          This is an experimental feature. Push/pull to remote repositories is not yet supported. Only local git operations are available.
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Language tab
// ─────────────────────────────────────────────────────────────────────────────

function LanguageTab() {
  const { settings, updateSetting } = useStore()
  const t = useT()
  const current = (settings.language ?? 'en') as LangCode

  return (
    <div>
      <SectionHeader
        title={t('settings.lang_title')}
        desc={t('settings.lang_desc')}
      />

      <div className="flex flex-col gap-3">
        {AVAILABLE_LANGS.map(code => {
          const meta = LANG_META[code]
          const isActive = current === code
          return (
            <button
              key={code}
              onClick={() => updateSetting('language', code)}
              className={clsx(
                'flex items-center gap-4 px-4 py-3.5 rounded-xl border text-left transition-all cursor-pointer bg-transparent w-full',
                isActive
                  ? 'border-[var(--fg-muted)] bg-[var(--active)]'
                  : 'border-[var(--border)] hover:border-[var(--fg-faint)] hover:bg-[var(--hover)]',
              )}
            >
              <span className="text-2xl leading-none flex-shrink-0">{meta.flag}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--fg)]">{meta.nativeName}</span>
                  <span className="text-xs text-[var(--fg-faint)]">— {meta.name}</span>
                </div>
                <div className="text-xs text-[var(--fg-faint)] mt-0.5 font-mono">{code}</div>
              </div>
              {isActive ? (
                <span className="flex items-center gap-1 text-xs font-semibold text-green-400 bg-green-400/10 px-2 py-0.5 rounded flex-shrink-0">
                  <Check size={10} /> {t('settings.lang_active')}
                </span>
              ) : (
                <span className="text-xs text-[var(--fg-faint)] px-2 py-0.5 rounded border border-[var(--border)] flex-shrink-0">
                  {t('settings.lang_select')}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-6 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[var(--surface-1)] border border-[var(--border)]">
        <span className="text-base leading-none mt-0.5 flex-shrink-0">ℹ️</span>
        <p className="text-xs text-[var(--fg-muted)] leading-relaxed">
          {t('settings.lang_restart_hint')}
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  LSP experiment tab
// ─────────────────────────────────────────────────────────────────────────────

function LspExpTab() {
  const { settings, updateSetting } = useStore()
  const lspOn = settings.lspEnabled

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-start gap-3 mb-7">
        <div className="w-10 h-10 rounded-lg border border-[var(--border)] flex items-center justify-center flex-shrink-0">
          <Zap size={18} className="text-[var(--fg-muted)]" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-semibold tracking-tight">Language Server (LSP)</h2>
            <span className={clsx(
              'text-xs font-mono px-1.5 py-0.5 rounded',
              lspOn ? 'text-green-400 bg-green-400/10' : 'text-[var(--fg-faint)] bg-[var(--surface-3)]'
            )}>
              {lspOn ? 'active' : 'inactive'}
            </span>
            <span className="text-[9px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1 rounded">α</span>
          </div>
          <p className="text-sm text-[var(--fg-muted)]">
            Real-time diagnostics, squiggle underlines, hover docs and smart library detection — powered by{' '}
            <code className="font-mono text-[var(--fg)] bg-[var(--surface-3)] px-1 rounded text-xs">tsuki-lsp</code>.
            Supports Go, C++ and <code className="font-mono text-[var(--fg)] bg-[var(--surface-3)] px-1 rounded text-xs">.ino</code>.
          </p>
        </div>
      </div>

      {/* ── Master switch ── */}
      <GroupHeader title="Master switch" />
      <SettingsField name="Enable LSP" desc="Start the tsuki-lsp background process when a project is opened. Required for all features below.">
        <Toggle on={lspOn} onToggle={() => updateSetting('lspEnabled', !lspOn)} />
      </SettingsField>

      {/* ── tsuki-lsp binary path ── */}
      <GroupHeader title="Binary" />
      <SettingsField name="tsuki-lsp path" desc="Path to the tsuki-lsp binary. Leave blank to auto-detect from PATH or next to tsuki-core.">
        <div className="flex items-center gap-1.5">
          <input
            value={settings.lspPath ?? ''}
            onChange={e => updateSetting('lspPath', e.target.value)}
            placeholder="auto (tsuki-lsp)"
            disabled={!lspOn}
            className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-xs text-[var(--fg)] outline-none font-mono disabled:opacity-40"
          />
        </div>
      </SettingsField>

      {/* ── Editor features ── */}
      <GroupHeader title="Editor features" />
      <SettingsField name="Real-time diagnostics" desc="Underline errors and warnings as you type with wavy squiggle decorations.">
        <Toggle
          on={lspOn && settings.lspDiagnosticsEnabled}
          onToggle={() => updateSetting('lspDiagnosticsEnabled', !settings.lspDiagnosticsEnabled)}
        />
      </SettingsField>
      <SettingsField name="Completions" desc="Show inline code completion suggestions while typing.">
        <div className="flex items-center gap-2">
          <Toggle
            on={lspOn && settings.lspCompletionsEnabled}
            onToggle={() => updateSetting('lspCompletionsEnabled', !settings.lspCompletionsEnabled)}
          />
          <span className="text-[10px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1 rounded">soon</span>
        </div>
      </SettingsField>
      <SettingsField name="Hover documentation" desc="Show type info and symbol docs when hovering over a token in the editor.">
        <div className="flex items-center gap-2">
          <Toggle
            on={lspOn && settings.lspHoverEnabled}
            onToggle={() => updateSetting('lspHoverEnabled', !settings.lspHoverEnabled)}
          />
          <span className="text-[10px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1 rounded">soon</span>
        </div>
      </SettingsField>
      <SettingsField name="Signature help" desc="Show function signature and parameter hints while typing a function call.">
        <div className="flex items-center gap-2">
          <Toggle
            on={lspOn && settings.lspSignatureHelp}
            onToggle={() => updateSetting('lspSignatureHelp', !settings.lspSignatureHelp)}
          />
          <span className="text-[10px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1 rounded">soon</span>
        </div>
      </SettingsField>
      <SettingsField name="Inlay hints" desc="Show inferred type annotations inline in the code (e.g. variable types, return types).">
        <div className="flex items-center gap-2">
          <Toggle
            on={lspOn && settings.lspInlayHints}
            onToggle={() => updateSetting('lspInlayHints', !settings.lspInlayHints)}
          />
          <span className="text-[10px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1 rounded">soon</span>
        </div>
      </SettingsField>

      {/* ── Diagnostic timing ── */}
      <GroupHeader title="Diagnostics" />
      <SettingsField
        name="Diagnostic delay"
        desc="How long (in ms) to wait after you stop typing before running diagnostics. Lower = faster, higher = less CPU load."
      >
        <div className="flex items-center gap-3">
          <input
            type="range" min={200} max={2000} step={100}
            value={settings.lspDiagnosticDelay ?? 600}
            onChange={e => updateSetting('lspDiagnosticDelay', Number(e.target.value))}
            disabled={!lspOn}
            className="flex-1 accent-[var(--fg)] disabled:opacity-40"
          />
          <span className="text-xs font-mono w-14 text-right text-[var(--fg-muted)]">
            {settings.lspDiagnosticDelay ?? 600} ms
          </span>
        </div>
      </SettingsField>

      {/* ── Per-language toggles ── */}
      <GroupHeader title="Language support" />
      <div className="mt-3 flex flex-col gap-2 mb-2">
        {[
          {
            key: 'lspGoEnabled' as const,
            lang: 'Go (.go)',
            icon: '🐹',
            badge: 'full support',
            badgeColor: 'text-green-400 bg-green-400/10',
            note: 'Transpiler-aware diagnostics — detects missing arduino imports, unused packages, brace balance, setup()/loop() checks.',
          },
          {
            key: 'lspCppEnabled' as const,
            lang: 'C++ (.cpp)',
            icon: '⚙️',
            badge: 'partial',
            badgeColor: 'text-yellow-400 bg-yellow-400/10',
            note: '#include library detection, assignment-in-condition warnings, and missing void setup()/loop() in .cpp sketches.',
          },
          {
            key: 'lspInoEnabled' as const,
            lang: 'Arduino (.ino)',
            icon: '🔌',
            badge: 'partial',
            badgeColor: 'text-yellow-400 bg-yellow-400/10',
            note: 'Treated as C++ with Arduino.h auto-injected. Same library detection and structural checks as C++.',
          },
        ].map(({ key, lang, icon, badge, badgeColor, note }) => (
          <div key={key} className={clsx(
            'rounded-lg border transition-colors',
            settings[key] && lspOn ? 'border-[var(--fg-faint)] bg-[var(--surface-1)]' : 'border-[var(--border)] bg-[var(--surface-1)]',
          )}>
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="text-xl leading-none flex-shrink-0">{icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-sm font-medium text-[var(--fg)]">{lang}</span>
                  <span className={clsx('text-[9px] font-mono px-1.5 py-0.5 rounded', badgeColor)}>{badge}</span>
                </div>
                <p className="text-xs text-[var(--fg-muted)] leading-relaxed">{note}</p>
              </div>
              <Toggle
                on={lspOn && settings[key]}
                onToggle={() => updateSetting(key, !settings[key])}
              />
            </div>
          </div>
        ))}
      </div>

      {/* ── Library management ── */}
      <GroupHeader title="Library management" />
      <SettingsField
        name="Show library install prompt"
        desc="When an import is detected that isn't installed, show a popup offering to download it."
      >
        <Toggle
          on={settings.lspShowLibPrompt}
          onToggle={() => updateSetting('lspShowLibPrompt', !settings.lspShowLibPrompt)}
        />
      </SettingsField>
      <SettingsField
        name="Auto-download missing libraries"
        desc="Silently run 'tsuki pkg add <lib>' in the background when a missing import is detected — no prompt shown."
      >
        <Toggle
          on={settings.lspAutoDownloadLibs}
          onToggle={() => updateSetting('lspAutoDownloadLibs', !settings.lspAutoDownloadLibs)}
        />
      </SettingsField>

      {/* Ignored libs list */}
      {(settings.lspIgnoredLibs?.length ?? 0) > 0 && (
        <>
          <SettingsField
            name="Ignored libraries"
            desc={`${settings.lspIgnoredLibs.length} librar${settings.lspIgnoredLibs.length === 1 ? 'y' : 'ies'} suppressed from the install prompt.`}
          >
            <Btn
              variant="danger"
              size="xs"
              onClick={() => updateSetting('lspIgnoredLibs', [])}
            >
              Clear all
            </Btn>
          </SettingsField>
          <div className="mt-1 mb-4 flex flex-wrap gap-1.5 px-1">
            {settings.lspIgnoredLibs.map(lib => (
              <div key={lib} className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-[var(--border)] text-[10px] font-mono text-[var(--fg-faint)] bg-[var(--surface-1)]">
                {lib}
                <button
                  onClick={() => updateSetting('lspIgnoredLibs', settings.lspIgnoredLibs.filter(l => l !== lib))}
                  className="ml-0.5 hover:text-[var(--fg)] cursor-pointer border-0 bg-transparent leading-none"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Supported library registry ── */}
      <GroupHeader title="Known library registry" />
      <p className="text-xs text-[var(--fg-muted)] mb-3 leading-relaxed">
        Libraries tsuki-lsp can detect and offer to install automatically.
      </p>
      <div className="grid grid-cols-2 gap-1.5 mb-6">
        {[
          ['Servo', 'Servo motor control'],
          ['Wire', 'I²C / TWI protocol'],
          ['SPI', 'Serial Peripheral Interface'],
          ['Adafruit_NeoPixel', 'WS2812 LED strips'],
          ['DHT', 'Temperature & humidity'],
          ['IRremote', 'Infrared send/receive'],
          ['ArduinoJson', 'JSON parsing'],
          ['FastLED', 'High-perf LED driver'],
          ['U8g2', 'OLED / LCD displays'],
          ['PubSubClient', 'MQTT client'],
          ['OneWire', 'Dallas 1-Wire protocol'],
          ['Adafruit_SSD1306', 'SSD1306 OLED'],
        ].map(([name, desc]) => (
          <div key={name} className="flex items-center gap-2 px-2.5 py-2 rounded border border-[var(--border)] bg-[var(--surface-1)]">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-mono font-medium text-[var(--fg)] truncate">{name}</div>
              <div className="text-[10px] text-[var(--fg-faint)] truncate">{desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Requirements ── */}
      <GroupHeader title="Requirements" />
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3 mb-4">
        <div className="flex items-start gap-3">
          <Zap size={14} className="mt-0.5 text-[var(--fg-faint)] flex-shrink-0" />
          <div>
            <div className="font-medium text-[var(--fg)] text-sm mb-0.5">tsuki-lsp must be in PATH</div>
            <p className="text-xs text-[var(--fg-faint)] leading-relaxed">
              Built alongside <code className="font-mono bg-[var(--surface-3)] px-1 rounded">tsuki-core</code>.
              Run <code className="font-mono bg-[var(--surface-3)] px-1 rounded">make lsp</code> or install via the tsuki installer.
              Front-end diagnostics (squiggles, library detection) work without the binary.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2 px-3 py-3 rounded-lg bg-yellow-400/5 border border-yellow-400/20">
        <span className="text-yellow-400 text-xs mt-0.5 flex-shrink-0">⚠</span>
        <p className="text-xs text-[var(--fg-muted)] leading-relaxed">
          Alpha feature. Full completions, hover docs, and signature help require <code className="font-mono bg-[var(--surface-3)] px-1 rounded">tsuki-lsp</code> to be installed. Front-end diagnostics and library detection run without it.
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Developer tab
// ─────────────────────────────────────────────────────────────────────────────

function DeveloperTab() {
  const { goBack, settings, updateSetting } = useStore()
  const [resetting, setResetting] = useState(false)
  const [resetDone, setResetDone] = useState(false)

  function handleResetOnboarding() {
    setResetting(true)
    try {
      localStorage.removeItem('tsuki-onboarding-done')
      setResetDone(true)
    } catch { /* private browsing */ }
    setResetting(false)
  }

  function handleRestartWithOnboarding() {
    try {
      localStorage.removeItem('tsuki-onboarding-done')
    } catch { /* private browsing */ }
    window.location.reload()
  }

  return (
    <div>
      <div className="flex items-start gap-3 mb-7">
        <div className="w-10 h-10 rounded-lg border border-amber-400/30 bg-amber-400/5 flex items-center justify-center flex-shrink-0">
          <Beaker size={18} className="text-amber-400" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-semibold tracking-tight">Developer Options</h2>
            <span className="text-[9px] font-mono text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">dev</span>
          </div>
          <p className="text-sm text-[var(--fg-muted)]">
            Internal tools for debugging and resetting IDE state. Not intended for regular use.
          </p>
        </div>
      </div>

      <GroupHeader title="Windows process spawn method" />
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 flex flex-col gap-4">
        <p className="text-xs text-[var(--fg-muted)] leading-relaxed">
          Controls how IDE toolbar buttons (Check, Build, Flash…) launch executables on Windows.
          Switch here to diagnose issues without breaking the rest of the IDE.
        </p>
        <div className="flex flex-col gap-2">
          {([
            { value: 'shell',    label: '🐚 Shell (default)',   desc: 'Routes through the active cmd/bash session. Most compatible — recommended.' },
            { value: 'direct',   label: '⚡ Direct spawn',      desc: 'Calls spawn_process directly with DETACHED_PROCESS flag. Use if shell routing is unreliable.' },
            { value: 'detached', label: '🪟 Detached (legacy)', desc: 'Old behavior — spawns with no special flags. May open a console window briefly.' },
          ] as const).map(opt => (
            <label
              key={opt.value}
              className={clsx(
                'flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors',
                settings.winSpawnMethod === opt.value
                  ? 'border-amber-400/40 bg-amber-400/5 text-[var(--fg)]'
                  : 'border-[var(--border)] hover:bg-[var(--hover)] text-[var(--fg-muted)]',
              )}
            >
              <input
                type="radio"
                name="winSpawnMethod"
                value={opt.value}
                checked={settings.winSpawnMethod === opt.value}
                onChange={() => updateSetting('winSpawnMethod', opt.value)}
                className="mt-0.5 accent-amber-400 flex-shrink-0"
              />
              <div>
                <div className="text-xs font-medium mb-0.5">{opt.label}</div>
                <div className="text-[10px] text-[var(--fg-faint)] leading-relaxed">{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
        <div className="flex items-start gap-2 px-2 py-2 rounded bg-blue-400/5 border border-blue-400/20 text-[10px] text-[var(--fg-faint)] leading-relaxed">
          <span className="text-blue-400 mt-0.5">ℹ</span>
          <span>Change takes effect on the next toolbar action. No restart required. This setting only affects Windows — on Linux/macOS the shell method is always used.</span>
        </div>
      </div>

      <GroupHeader title="Onboarding" />
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 flex flex-col gap-4">
        <div>
          <div className="text-sm font-medium mb-0.5">First-run dialog</div>
          <p className="text-xs text-[var(--fg-muted)] leading-relaxed">
            The welcome wizard shown on first launch. Resets the <code className="font-mono bg-[var(--surface-3)] px-1 rounded">tsuki-onboarding-done</code> flag in localStorage.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Btn
            variant="outline"
            size="sm"
            onClick={handleResetOnboarding}
            disabled={resetting || resetDone}
            className="gap-2"
          >
            <RefreshCw size={12} className={resetting ? 'animate-spin' : ''} />
            {resetDone ? 'Reset done — restart to see it' : 'Reset onboarding flag'}
          </Btn>
          <Btn
            variant="outline"
            size="sm"
            onClick={handleRestartWithOnboarding}
            className="gap-2"
          >
            <RefreshCw size={12} />
            Restart app with onboarding
          </Btn>
        </div>
        {resetDone && (
          <div className="flex items-center gap-2 text-xs text-green-400">
            <Check size={12} /> Flag cleared. The wizard will appear on the next app launch or after reload.
          </div>
        )}
      </div>

      <GroupHeader title="State" />
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 flex flex-col gap-3">
        <div className="text-sm font-medium">localStorage keys</div>
        <div className="flex flex-col gap-1.5 font-mono text-xs text-[var(--fg-muted)]">
          {['tsuki-onboarding-done', 'tsuki-recent', 'tsuki-settings'].map(key => {
            let val = '(not set)'
            try { val = localStorage.getItem(key) !== null ? '✓ set' : '(not set)' } catch {}
            return (
              <div key={key} className="flex items-center gap-3 py-1 border-b border-[var(--border-subtle)] last:border-0">
                <span className="flex-1 text-[var(--fg)]">{key}</span>
                <span className={val === '✓ set' ? 'text-green-400' : 'text-[var(--fg-faint)]'}>{val}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-6 flex items-start gap-2 px-3 py-3 rounded-lg bg-amber-400/5 border border-amber-400/20">
        <span className="text-amber-400 text-xs mt-0.5">⚠</span>
        <p className="text-xs text-[var(--fg-muted)] leading-relaxed">
          Developer options are intended for contributors and debugging. Disable them in the Experiments → General tab when done.
        </p>
      </div>
    </div>
  )
}