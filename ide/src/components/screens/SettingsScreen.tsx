'use client'
import React from 'react'
import { useStore, SettingsTab, SettingsState } from '@/lib/store'
import ProfilesPanel from '@/components/other/ProfilesPanel'
import { IDE_THEMES, SYNTAX_THEMES } from '@/lib/themes'
import { ICON_PACKS } from '@/lib/iconPacks'
import { Btn, Input, Select, Toggle, Badge, Divider } from '@/components/shared/primitives'
import WebkitPanel from '@/components/experiments/WebKitPanel/WebKitPanel'
import {
  ArrowLeft, Terminal, Sliders, Code2, RefreshCw, FolderOpen,
  Palette, Check, Cpu, FlaskConical, ChevronRight, Zap, FlaskRound,
  Beaker, ToggleLeft, GitBranch, Languages, Bug, FileText,
  Trash2, ExternalLink, AlertTriangle, RotateCcw, User, Layers,
  Download, Plus, X, Radio, Package, Globe,
} from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import { useT, AVAILABLE_LANGS, LANG_META, LangCode } from '@/lib/i18n'

// ─────────────────────────────────────────────────────────────────────────────
//  Nav definitions
// ─────────────────────────────────────────────────────────────────────────────

const MAIN_NAV: { id: SettingsTab; labelKey: string; icon: React.ReactNode }[] = [
  { id: 'appearance', labelKey: 'settings.tab_appearance', icon: <Palette  size={13} /> },
  { id: 'profile', labelKey: 'settings.tab_profile', icon: <User size={13} /> },
  { id: 'cli',        labelKey: 'settings.tab_tools',      icon: <Terminal size={13} /> },
  { id: 'defaults',   labelKey: 'settings.tab_board',      icon: <Sliders  size={13} /> },
  { id: 'editor',     labelKey: 'settings.tab_editor',     icon: <Code2    size={13} /> },
  { id: 'language',   labelKey: 'settings.tab_language',   icon: <Languages size={13} /> },
  { id: 'updates',    labelKey: 'settings.tab_updates',    icon: <Download  size={13} /> },
]

const DEV_NAV: { id: SettingsTab; labelKey: string; icon: React.ReactNode }[] = [
  { id: 'developer', labelKey: 'settings.tab_developer', icon: <Beaker size={13} /> },
]

const EXP_NAV: { id: SettingsTab; label: string; icon: React.ReactNode; settingKey?: 'expSandboxEnabled' | 'expGitEnabled' | 'expLspEnabled' | 'expWorkstationsEnabled' | 'expWebkitEnabled' }[] = [
  { id: 'experiments', label: 'General',   icon: <FlaskConical size={13} /> },
  { id: 'exp-sandbox', label: 'Sandbox',   icon: <Cpu          size={13} />, settingKey: 'expSandboxEnabled' },
  { id: 'exp-git',     label: 'Git',       icon: <GitBranch    size={13} />, settingKey: 'expGitEnabled'     },
  { id: 'exp-lsp',     label: 'LSP',       icon: <Zap          size={13} />, settingKey: 'expLspEnabled'     },
  { id: 'exp-workstations', label: 'Workstations', icon: <Layers size={13} />, settingKey: 'expWorkstationsEnabled' },
  { id: 'exp-webkit',  label: 'Webkit',    icon: <Globe        size={13} />, settingKey: 'expWebkitEnabled'  },
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
      <div className="flex-shrink-0" style={{ width: "var(--settings-field-ctrl)" }}>{children}</div>
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

// ── RegistrySourcesEditor ─────────────────────────────────────────────────────
// Manages an ordered list of package registry URLs — mirrors the CLI's
// `tsuki config registry` subcommands (add / remove / up / down / clear).
//
// Priority model: first entry = highest priority (wins on name collision).
// The built-in default is always shown at the bottom as a non-removable
// fallback, exactly like the CLI.
//
// Data lives in settings.registryUrls (string[]). The legacy settings.registryUrl
// field is still preserved for backward compat but not shown in this UI.

const BUILTIN_REGISTRY = 'https://raw.githubusercontent.com/s7lver2/tsuki/refs/heads/main/pkg/packages.json'

function RegistrySourcesEditor() {
  const { settings, updateSetting } = useStore()
  const [newUrl, setNewUrl] = React.useState('')
  const [clearConfirm, setClearConfirm] = React.useState(false)

  const urls: string[] = settings.registryUrls ?? []

  // ── mutations ────────────────────────────────────────────────────────────

  function add() {
    const url = newUrl.trim()
    if (!url || urls.includes(url)) return
    updateSetting('registryUrls' as any, [url, ...urls])  // prepend = highest priority
    setNewUrl('')
  }

  function remove(i: number) {
    updateSetting('registryUrls' as any, urls.filter((_, idx) => idx !== i))
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= urls.length) return
    const next = [...urls]
    ;[next[i], next[j]] = [next[j], next[i]]
    updateSetting('registryUrls' as any, next)
  }

  function clearAll() {
    updateSetting('registryUrls' as any, [])
    setClearConfirm(false)
  }

  // ── render ───────────────────────────────────────────────────────────────

  // The effective list shown: user entries + built-in fallback
  const builtinIsCustom = urls.includes(BUILTIN_REGISTRY)
  const showBuiltinFallback = !builtinIsCustom

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[10px] text-[var(--fg-faint)] leading-relaxed">
        Registries are consulted in priority order — the first one wins when two registries declare the same package name. Mirrors{' '}
        <code className="font-mono bg-[var(--surface-3)] px-1 py-0.5 rounded">tsuki config registry</code>.
      </p>

      {/* ── Add new registry ── */}
      <div className="flex items-center gap-2">
        <input
          value={newUrl}
          onChange={e => setNewUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder="https://my-registry.example.com/packages.json"
          className="flex-1 font-mono text-xs bg-[var(--surface)] border border-[var(--border)] rounded px-2.5 py-1.5 outline-none text-[var(--fg)] placeholder-[var(--fg-faint)] focus:border-[var(--fg-faint)]"
        />
        <button
          onClick={add}
          disabled={!newUrl.trim() || urls.includes(newUrl.trim())}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-[var(--surface-3)] hover:bg-[var(--hover)] text-[var(--fg)] disabled:opacity-40 border border-[var(--border)] cursor-pointer transition-colors disabled:cursor-default"
          title="Add as highest priority (prepend)"
        >
          <Plus size={11} /> Add
        </button>
      </div>

      {/* ── Priority list ── */}
      <div className="flex flex-col gap-1">
        {urls.length === 0 && (
          <p className="text-[10px] text-[var(--fg-faint)] italic py-1">
            No custom registries — built-in default is used.
          </p>
        )}

        {urls.map((url, i) => (
          <div
            key={url}
            className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] group"
          >
            {/* Priority badge */}
            <span className={clsx(
              'text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold shrink-0 tabular-nums',
              i === 0
                ? 'bg-sky-500/15 text-sky-400'
                : 'bg-[var(--surface-3)] text-[var(--fg-faint)]',
            )}>
              {i === 0 ? '↑1' : `#${i + 1}`}
            </span>

            {/* URL */}
            <span className="flex-1 font-mono text-xs text-[var(--fg)] truncate min-w-0" title={url}>{url}</span>

            {/* Actions (revealed on hover) */}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                title="Raise priority"
                className="w-6 h-6 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] disabled:opacity-25 border-0 bg-transparent cursor-pointer transition-colors disabled:cursor-default"
              >
                <ChevronRight size={10} className="-rotate-90" />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === urls.length - 1}
                title="Lower priority"
                className="w-6 h-6 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] disabled:opacity-25 border-0 bg-transparent cursor-pointer transition-colors disabled:cursor-default"
              >
                <ChevronRight size={10} className="rotate-90" />
              </button>
              <button
                onClick={() => remove(i)}
                title="Remove registry"
                className="w-6 h-6 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-red-400 hover:bg-red-400/10 border-0 bg-transparent cursor-pointer transition-colors"
              >
                <X size={10} />
              </button>
            </div>
          </div>
        ))}

        {/* Built-in fallback (always last, non-removable) */}
        {showBuiltinFallback && (
          <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-1)] opacity-60">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-mono font-semibold shrink-0">
              default
            </span>
            <span className="flex-1 font-mono text-xs text-[var(--fg-faint)] truncate min-w-0" title={BUILTIN_REGISTRY}>
              {BUILTIN_REGISTRY}
            </span>
            <span className="text-[10px] text-[var(--fg-faint)] italic shrink-0">built-in</span>
          </div>
        )}
      </div>

      {/* ── Clear all ── */}
      {urls.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          {clearConfirm ? (
            <>
              <span className="text-[10px] text-[var(--fg-muted)]">Remove all custom registries?</span>
              <button
                onClick={clearAll}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-red-400 hover:bg-red-400/10 border-0 bg-transparent cursor-pointer transition-colors"
              >
                <Trash2 size={10} /> Yes, clear
              </button>
              <button
                onClick={() => setClearConfirm(false)}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setClearConfirm(true)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-[var(--fg-faint)] hover:text-red-400 hover:bg-red-400/10 border-0 bg-transparent cursor-pointer transition-colors"
            >
              <Trash2 size={10} /> Clear all custom registries
            </button>
          )}
        </div>
      )}
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
        <div className="border-r border-[var(--border)] bg-[var(--surface-1)] flex flex-col flex-shrink-0 overflow-y-auto" style={{ width: "var(--settings-sidebar-w)" }}>

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
              // exp-webkit is always visible so users can enable it from there
              if (n.id !== 'exp-webkit' && n.settingKey && !settings[n.settingKey]) return null
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
        <div className={clsx('flex-1', settingsTab === 'exp-webkit' && expEnabled ? 'overflow-hidden flex flex-col' : 'overflow-y-auto')}>
          {/* webkit tab gets the full area — no padding wrapper */}
          {settingsTab === 'exp-webkit' && expEnabled ? (
            <WebkitExpTab />
          ) : (
            <div className="w-full" style={{ maxWidth: "min(760px, 100%)", padding: "clamp(12px,4vw,40px) var(--settings-content-px)" }}>
              {settingsTab === 'appearance'   && <AppearanceTab />}
              {settingsTab === 'cli'          && <CliTab />}
              {settingsTab === 'defaults'     && <DefaultsTab />}
              {settingsTab === 'editor'       && <EditorTab />}
              {settingsTab === 'language'     && <LanguageTab />}
              {settingsTab === 'profile'      && <ProfilesPanel />}
              {settingsTab === 'experiments'  && <ExperimentsTab />}
              {settingsTab === 'exp-sandbox'  && expEnabled && settings.expSandboxEnabled && <SandboxTab />}
              {settingsTab === 'exp-git'      && expEnabled && settings.expGitEnabled && <GitExpTab />}
              {settingsTab === 'exp-lsp'      && expEnabled && settings.expLspEnabled && <LspExpTab />}
              {settingsTab === 'exp-workstations' && expEnabled && settings.expWorkstationsEnabled && <WorkstationsTab />}
              {settingsTab === 'updates'      && <UpdatesTab />}
              {settingsTab === 'developer'    && settings.developerOptions && <DeveloperTab />}
            </div>
          )}
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
  settingKey: 'expSandboxEnabled' | 'expGitEnabled' | 'expLspEnabled' | 'expWorkstationsEnabled' | 'expWebkitEnabled'  // union grows as experiments are added
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
  {
    id: 'workstations',
    tab: 'exp-workstations',
    name: 'Workstations',
    tag: 'α',
    icon: <Layers size={16} />,
    desc: 'DaVinci Resolve-style page bar at the bottom of the IDE. Switch between Code, Sandbox, and Export workstations — each occupies the full screen area.',
    settingKey: 'expWorkstationsEnabled',
    resources: 'Zero overhead when inactive. Sandbox workstation re-uses the existing simulator — no extra bundle cost.',
  },
  {
    id: 'webkit',
    tab: 'exp-webkit',
    name: 'tsuki-webkit',
    tag: 'α',
    icon: <Globe size={16} />,
    desc: 'JSX → HTML/CSS/JS compiler for ESP8266/ESP32 web control panels. Write React-style components; tsuki-webkit serves them over WiFi from your board.',
    settingKey: 'expWebkitEnabled',
    resources: 'In-browser JSX preview only — no background processes. Requires tsuki-webkit binary for full builds.',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
//  ExperimentsTab — General
// ─────────────────────────────────────────────────────────────────────────────

function ExperimentsTab() {
  const { settings, updateSetting, setSettingsTab, addLog } = useStore()
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

        <Btn variant="outline" size="sm" onClick={() => {
          addLog('info', '[experiments] Experiments enabled for the first time — welcome to the lab!')
          addLog('info', `[experiments] ${EXPERIMENTS.length} experiments available: ${EXPERIMENTS.map(e => `${e.name} (${e.tag})`).join(', ')}`)
          updateSetting('experimentsEnabled', true)
        }} className="mt-2 gap-2">
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
          if (settings.experimentsEnabled) {
            // Disabling master — log which experiments were active before wiping them
            const active = EXPERIMENTS.filter(e => settings[e.settingKey])
            if (active.length > 0) {
              addLog('warn', `[experiments] Master switch OFF — deactivating ${active.length} experiment(s): ${active.map(e => e.name).join(', ')}`)
            } else {
              addLog('info', '[experiments] Master switch OFF — no experiments were active')
            }
            EXPERIMENTS.forEach(e => updateSetting(e.settingKey, false))
          } else {
            addLog('info', '[experiments] Master switch ON — experiments unlocked, none active yet')
            addLog('info', '[experiments] Tip: toggle individual experiments below to activate them')
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
  const { addLog } = useStore()

  const handleToggle = () => {
    // Log before calling onToggle so the message reflects the *new* intended state
    const nextState = !active
    addLog('info', `[experiments] User ${nextState ? 'enabled' : 'disabled'} "${exp.name}" from the experiments panel`)
    if (nextState) {
      addLog('info', `[experiments]   tag: ${exp.tag} · resources: ${exp.resources}`)
    }
    onToggle()
  }

  const handleOpenSettings = () => {
    addLog('info', `[experiments] Opened settings tab for "${exp.name}"`)
    onOpen()
  }

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
            <Btn variant="ghost" size="xs" onClick={handleOpenSettings}>
              Settings <ChevronRight size={11} />
            </Btn>
          )}
          <Toggle on={active} onToggle={handleToggle} />
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

      <GroupHeader title="Simulation" />
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

      <GroupHeader title="Wire style" />
      <SettingsField
        name="Routing style"
        desc="How wires are drawn between pins."
      >
        <div className="flex gap-1 flex-wrap">
          {([
            { id: 'orthogonal', label: 'Tinkercad', preview: 'M0,8 H12 V0 H24' },
            { id: 'smooth',     label: 'Smooth',    preview: 'M0,8 C8,8 16,0 24,0' },
            { id: 'flexible',   label: 'Flexible',  preview: 'M0,0 Q12,18 24,0' },
            { id: 'direct',     label: 'Direct',    preview: 'M0,8 L24,0' },
          ] as const).map(s => (
            <button
              key={s.id}
              onClick={() => updateSetting('sandboxWireStyle' as any, s.id)}
              className="flex flex-col items-center gap-1 px-2 py-1.5 rounded border cursor-pointer transition-colors"
              style={{
                borderColor: settings.sandboxWireStyle === s.id ? 'var(--active-border)' : 'var(--border)',
                background:  settings.sandboxWireStyle === s.id ? 'var(--active)'         : 'var(--surface-1)',
              }}
            >
              <svg width={24} height={18} viewBox="0 0 24 18">
                <path d={s.preview} fill="none" stroke="var(--fg-muted)" strokeWidth={1.8} strokeLinecap="round"/>
              </svg>
              <span className="text-[9px] text-[var(--fg-muted)]">{s.label}</span>
            </button>
          ))}
        </div>
      </SettingsField>

      <GroupHeader title="Wire palette" />
      <SettingsField
        name="Colour palette"
        desc="Colour set shown in the wire tool picker."
      >
        <div className="flex gap-2 flex-wrap">
          {(['classic','monochrome','pastel','custom'] as const).map(pid => {
            const PALETTE_COLORS: Record<string, string[]> = {
              classic:     ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#a855f7','#ec4899','#e2e2e2','#1a1a1a'],
              monochrome:  ['#ffffff','#d4d4d4','#a3a3a3','#737373','#525252','#404040','#2a2a2a','#1c1c1c','#0a0a0a'],
              pastel:      ['#fca5a5','#fdba74','#fde68a','#86efac','#93c5fd','#c4b5fd','#f9a8d4','#e5e7eb','#6b7280'],
              custom:      settings.sandboxWireCustomColors ?? ['#ef4444','#3b82f6','#22c55e','#f97316','#a855f7'],
            }
            const active = (settings.sandboxWirePalette ?? 'classic') === pid
            return (
              <button
                key={pid}
                onClick={() => updateSetting('sandboxWirePalette' as any, pid)}
                className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded border cursor-pointer transition-colors"
                style={{
                  borderColor: active ? 'var(--active-border)' : 'var(--border)',
                  background:  active ? 'var(--active)'        : 'var(--surface-1)',
                }}
              >
                <div className="flex gap-0.5">
                  {PALETTE_COLORS[pid].slice(0, 5).map((c, i) => (
                    <span key={i} className="w-3 h-3 rounded-full inline-block border border-[rgba(0,0,0,0.2)]" style={{ background: c }} />
                  ))}
                </div>
                <span className="text-[9px] text-[var(--fg-muted)] capitalize">{pid}</span>
              </button>
            )
          })}
        </div>
      </SettingsField>

      {(settings.sandboxWirePalette ?? 'classic') === 'custom' && (
        <SettingsField name="Custom colours" desc="Click a swatch to edit. 9 slots.">
          <div className="flex gap-1 flex-wrap">
            {(settings.sandboxWireCustomColors ?? ['#ef4444','#3b82f6','#22c55e','#f97316','#a855f7','#eab308','#ec4899','#e2e2e2','#1a1a1a']).map((c, i) => (
              <label key={i} title={`Slot ${i + 1}`} className="relative cursor-pointer">
                <span
                  className="w-6 h-6 rounded-full block border-2"
                  style={{ background: c, borderColor: 'var(--border)' }}
                />
                <input
                  type="color"
                  value={c}
                  onChange={e => {
                    const next = [...(settings.sandboxWireCustomColors ?? [])]
                    next[i] = e.target.value
                    updateSetting('sandboxWireCustomColors' as any, next)
                  }}
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                />
              </label>
            ))}
          </div>
        </SettingsField>
      )}

      <GroupHeader title="Auto-colour wires" />
      <SettingsField
        name="Auto-colour VCC wires"
        desc="Wires starting or ending at a power pin are automatically coloured."
      >
        <div className="flex items-center gap-2">
          <Toggle
            on={settings.sandboxAutoColorVcc ?? true}
            onToggle={() => updateSetting('sandboxAutoColorVcc' as any, !(settings.sandboxAutoColorVcc ?? true))}
          />
          {(settings.sandboxAutoColorVcc ?? true) && (
            <label className="relative cursor-pointer">
              <span
                className="w-6 h-6 rounded-full block border-2"
                style={{ background: settings.sandboxVccColor ?? '#ef4444', borderColor: 'var(--border)' }}
              />
              <input
                type="color"
                value={settings.sandboxVccColor ?? '#ef4444'}
                onChange={e => updateSetting('sandboxVccColor' as any, e.target.value)}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              />
            </label>
          )}
        </div>
      </SettingsField>

      <SettingsField
        name="Auto-colour GND wires"
        desc="Wires starting or ending at a GND pin are automatically coloured."
      >
        <div className="flex items-center gap-2">
          <Toggle
            on={settings.sandboxAutoColorGnd ?? true}
            onToggle={() => updateSetting('sandboxAutoColorGnd' as any, !(settings.sandboxAutoColorGnd ?? true))}
          />
          {(settings.sandboxAutoColorGnd ?? true) && (
            <label className="relative cursor-pointer">
              <span
                className="w-6 h-6 rounded-full block border-2"
                style={{ background: settings.sandboxGndColor ?? '#1a1a1a', borderColor: 'var(--border)' }}
              />
              <input
                type="color"
                value={settings.sandboxGndColor ?? '#1a1a1a'}
                onChange={e => updateSetting('sandboxGndColor' as any, e.target.value)}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              />
            </label>
          )}
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
//  Layout definitions
// ─────────────────────────────────────────────────────────────────────────────

interface LayoutPreset {
  id: 'default' | 'focused' | 'wide-editor' | 'minimal' | 'custom'
  name: string
  desc: string
  sidebarWidth: number
  bottomPanelHeight: number
  // visual sketch proportions (0-1, out of total width/height)
  sketch: {
    sidebar: number    // fraction of width
    bottom:  number    // fraction of height
  }
}

const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: 'default',
    name: 'Default',
    desc: 'Sidebar + editor + bottom panel. The classic layout.',
    sidebarWidth: 224,
    bottomPanelHeight: 200,
    sketch: { sidebar: 0.28, bottom: 0.30 },
  },
  {
    id: 'focused',
    name: 'Focused',
    desc: 'No sidebar. Editor takes full width. Bottom panel stays compact.',
    sidebarWidth: 0,
    bottomPanelHeight: 140,
    sketch: { sidebar: 0, bottom: 0.22 },
  },
  {
    id: 'wide-editor',
    name: 'Wide Editor',
    desc: 'Narrow sidebar, larger editor area. Good for wide monitors.',
    sidebarWidth: 180,
    bottomPanelHeight: 160,
    sketch: { sidebar: 0.18, bottom: 0.22 },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    desc: 'Narrow sidebar, small bottom panel. More code, less chrome.',
    sidebarWidth: 160,
    bottomPanelHeight: 100,
    sketch: { sidebar: 0.15, bottom: 0.15 },
  },
  {
    id: 'custom',
    name: 'Custom',
    desc: 'Your own manually adjusted layout.',
    sidebarWidth: 224,
    bottomPanelHeight: 200,
    sketch: { sidebar: 0.28, bottom: 0.30 },
  },
]

// Mini IDE mockup SVG
function LayoutSketch({ preset, active }: { preset: LayoutPreset; active: boolean }) {
  const W = 120, H = 76
  const actBar = 8
  const sideW  = Math.round(preset.sketch.sidebar * (W - actBar))
  const botH   = Math.round(preset.sketch.bottom  * H)
  const editorX = actBar + sideW
  const editorW = W - editorX
  const editorH = H - botH
  const accent  = active ? '#60a5fa' : '#4b5563'
  const fg      = active ? '#93c5fd' : '#374151'
  const bg      = '#1a1a1a'
  const bg2     = '#222'
  const border  = active ? '#2d4a7a' : '#2a2a2a'

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="rounded overflow-hidden"
      style={{ border: `1px solid ${border}` }}>
      {/* Background */}
      <rect width={W} height={H} fill={bg} />
      {/* Topbar */}
      <rect x={0} y={0} width={W} height={6} fill={bg2} />
      <rect x={4} y={2} width={8} height={2} rx={1} fill={accent} opacity={0.5} />
      <rect x={14} y={2} width={12} height={2} rx={1} fill={fg} opacity={0.2} />
      <rect x={28} y={2} width={8} height={2} rx={1} fill={fg} opacity={0.15} />
      {/* Activity bar */}
      <rect x={0} y={6} width={actBar} height={H - 6} fill={bg2} />
      {[12, 22, 32].map(y => (
        <rect key={y} x={1.5} y={y} width={5} height={5} rx={1} fill={fg} opacity={0.2} />
      ))}
      {/* Sidebar */}
      {sideW > 0 && <>
        <rect x={actBar} y={6} width={sideW} height={editorH} fill={bg2} opacity={0.8} />
        {[10, 15, 20, 25, 30].map((y, i) => (
          <rect key={y} x={actBar + 3} y={y} width={sideW - 8 - (i % 2) * 6} height={2} rx={1} fill={fg} opacity={0.15} />
        ))}
      </>}
      {/* Editor */}
      <rect x={editorX} y={6} width={editorW} height={editorH} fill={bg} />
      {[10, 14, 18, 22, 26, 30, 34].map((y, i) => (
        <rect key={y} x={editorX + 4} y={y}
          width={Math.max(8, editorW - 8 - (i * 7) % (editorW - 20))}
          height={2} rx={1} fill={fg} opacity={0.12} />
      ))}
      {/* Bottom panel */}
      {botH > 0 && <>
        <rect x={actBar} y={editorH} width={W - actBar} height={botH} fill={bg2} opacity={0.9} />
        <rect x={actBar} y={editorH} width={W - actBar} height={1} fill={border} />
        {[3, 7, 11].map((dy, i) => (
          <rect key={dy} x={actBar + 4} y={editorH + dy}
            width={Math.max(6, (W - actBar - 16) * [0.6, 0.85, 0.4][i])}
            height={2} rx={1} fill={accent} opacity={[0.5, 0.2, 0.25][i]} />
        ))}
      </>}
      {/* Statusbar */}
      <rect x={0} y={H - 3} width={W} height={3} fill={active ? '#1e3a5f' : '#1a1a1a'} />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Appearance tab
// ─────────────────────────────────────────────────────────────────────────────

function AppearanceTab() {
  const { settings, updateSetting, setBottomHeight } = useStore()
  const [scaleLocal, setScaleLocal] = useState<number>(settings.uiScale)

  function applyLayout(preset: LayoutPreset) {
    updateSetting('ideLayout', preset.id)
    if (preset.id !== 'custom') {
      updateSetting('sidebarWidth', preset.sidebarWidth)
      updateSetting('bottomPanelHeight', preset.bottomPanelHeight)
      setBottomHeight(preset.bottomPanelHeight)
    }
  }

  const activePreset = LAYOUT_PRESETS.find(p => p.id === settings.ideLayout) ?? LAYOUT_PRESETS[0]

  return (
    <div>
      <SectionHeader title="Appearance" desc="Customise the IDE's colour scheme, syntax colours, interface scale, and window layout." />

      {/* ── Layout ── */}
      <GroupHeader title="Layout" />
      <p className="text-xs text-[var(--fg-muted)] mb-4 leading-relaxed">
        Choose a preset layout or drag the panel edges in the editor to build a custom one. Dragging any panel edge automatically switches to Custom.
      </p>

      {/* Preset grid */}
      <div className="grid grid-cols-5 gap-2 mb-5">
        {LAYOUT_PRESETS.map(preset => {
          const active = settings.ideLayout === preset.id
          return (
            <button
              key={preset.id}
              onClick={() => applyLayout(preset)}
              className={clsx(
                'flex flex-col items-center gap-1.5 p-2 rounded-lg border cursor-pointer transition-all text-left',
                active
                  ? 'border-[var(--fg-muted)] bg-[var(--active)]'
                  : 'border-[var(--border)] hover:border-[var(--fg-faint)] hover:bg-[var(--hover)]',
              )}
            >
              <LayoutSketch preset={preset} active={active} />
              <span className={clsx('text-[10px] font-medium text-center leading-tight w-full',
                active ? 'text-[var(--fg)]' : 'text-[var(--fg-muted)]')}>
                {preset.name}
              </span>
            </button>
          )
        })}
      </div>

      {/* Active layout description */}
      <div className="mb-5 flex items-start gap-3 px-3 py-2.5 rounded-lg bg-[var(--surface-1)] border border-[var(--border)]">
        <div className="flex-shrink-0 mt-0.5">
          <LayoutSketch preset={activePreset} active={true} />
        </div>
        <div>
          <div className="text-sm font-medium mb-0.5">{activePreset.name}</div>
          <p className="text-xs text-[var(--fg-muted)] leading-relaxed">{activePreset.desc}</p>
        </div>
      </div>

      {/* Pane size controls */}
      <GroupHeader title="Pane Sizes" />
      <p className="text-xs text-[var(--fg-muted)] mb-3 leading-relaxed">
        Fine-tune panel dimensions. You can also drag the dividers between panes directly in the editor — they snap to these values and save automatically.
      </p>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] divide-y divide-[var(--border-subtle)]">

        {/* Sidebar width */}
        <div className="px-4 py-3 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium mb-0.5">Sidebar width</div>
            <div className="text-xs text-[var(--fg-muted)]">Left file-tree panel. Min 140px · Max 480px</div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0" style={{ width: "var(--settings-field-ctrl)" }}>
            <input type="range" min={140} max={480} step={4}
              value={settings.sidebarWidth}
              onChange={e => {
                updateSetting('sidebarWidth', Number(e.target.value))
                updateSetting('ideLayout', 'custom')
              }}
              className="flex-1 accent-[var(--fg)]" />
            <span className="text-xs font-mono w-10 text-right text-[var(--fg-muted)]">
              {settings.sidebarWidth}px
            </span>
          </div>
        </div>

        {/* Bottom panel height */}
        <div className="px-4 py-3 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium mb-0.5">Bottom panel height</div>
            <div className="text-xs text-[var(--fg-muted)]">Output / Problems / Terminal area. Min 80px · Max 600px</div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0" style={{ width: "var(--settings-field-ctrl)" }}>
            <input type="range" min={80} max={600} step={4}
              value={settings.bottomPanelHeight}
              onChange={e => {
                const h = Number(e.target.value)
                updateSetting('bottomPanelHeight', h)
                updateSetting('ideLayout', 'custom')
                setBottomHeight(h)
              }}
              className="flex-1 accent-[var(--fg)]" />
            <span className="text-xs font-mono w-10 text-right text-[var(--fg-muted)]">
              {settings.bottomPanelHeight}px
            </span>
          </div>
        </div>

        {/* Reset to preset */}
        <div className="px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs text-[var(--fg-faint)]">
            Current: {settings.ideLayout === 'custom' ? 'Custom' : activePreset.name}
            {' · '}{settings.sidebarWidth}px sidebar · {settings.bottomPanelHeight}px bottom
          </span>
          <button
            onClick={() => applyLayout(LAYOUT_PRESETS[0])}
            className="text-xs text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer transition-colors px-2 py-0.5 rounded hover:bg-[var(--hover)]">
            Reset to Default
          </button>
        </div>
      </div>

      {/* ── IDE Theme ── */}
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
          const active = settings.iconPack === pack.id
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
              <div className="flex items-center gap-2 flex-shrink-0 w-28">
                <span className="flex items-center gap-0.5">{pack.folderIcon(false)}</span>
                <span className="flex items-center gap-0.5">{pack.folderIcon(true)}</span>
                {['go', 'json', 'cpp', 'md'].map(ext => (
                  <span key={ext} className="flex items-center">{pack.fileIcon(ext)}</span>
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

      <GroupHeader title="Adaptive layout" />
      <SettingsField
        name="Compact mode"
        desc="Reduces topbar height, padding, and base font size. Useful on small or low-resolution screens."
      >
        <Toggle
          on={settings.compactMode ?? false}
          onToggle={() => updateSetting('compactMode', !(settings.compactMode ?? false))}
        />
      </SettingsField>

      <SettingsField
        name="Topbar labels"
        desc="Show text labels next to topbar action buttons (Check, Build, Flash…). Hidden automatically below 1200px wide."
      >
        <Toggle
          on={settings.topbarLabels ?? true}
          onToggle={() => updateSetting('topbarLabels', !(settings.topbarLabels ?? true))}
        />
      </SettingsField>

      <SettingsField
        name="Auto-collapse sidebar"
        desc="Automatically collapse the file tree sidebar when the window is narrower than the threshold below."
      >
        <Toggle
          on={settings.adaptiveSidebar ?? true}
          onToggle={() => updateSetting('adaptiveSidebar', !(settings.adaptiveSidebar ?? true))}
        />
      </SettingsField>

      {(settings.adaptiveSidebar ?? true) && (
        <SettingsField
          name="Collapse threshold"
          desc="Sidebar auto-collapses when window width falls below this value."
        >
          <div className="flex items-center gap-3">
            <input
              type="range" min={800} max={1600} step={40}
              value={settings.minWindowWidth ?? 1024}
              onChange={e => updateSetting('minWindowWidth', Number(e.target.value))}
              className="flex-1 accent-[var(--fg)]"
            />
            <span className="text-xs font-mono w-16 text-right text-[var(--fg-muted)]">
              {settings.minWindowWidth ?? 1024}px
            </span>
          </div>
        </SettingsField>
      )}

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
          value={settings.fontRendering}
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
  const [newDir, setNewDir] = useState('')

  async function browseExtraDir() {
    const { pickFolder } = await import('@/lib/tauri')
    const p = await pickFolder()
    if (p) addExtraDir(p)
  }

  function addExtraDir(dir: string) {
    const d = dir.trim()
    if (!d) return
    const current: string[] = settings.extraLibsDirs ?? []
    if (current.includes(d)) return
    updateSetting('extraLibsDirs', [...current, d])
    setNewDir('')
  }

  function removeExtraDir(dir: string) {
    updateSetting('extraLibsDirs', (settings.extraLibsDirs ?? []).filter((d: string) => d !== dir))
  }

  function moveDir(from: number, to: number) {
    const arr = [...(settings.extraLibsDirs ?? [])]
    const [item] = arr.splice(from, 1)
    arr.splice(to, 0, item)
    updateSetting('extraLibsDirs', arr)
  }

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

      {/* Primary libs dir */}
      <SettingsField name="libs_dir" desc="Primary directory where tsukilib packages are installed">
        <div className="flex gap-1.5">
          <Input
            value={settings.libsDir}
            onChange={e => updateSetting('libsDir', e.target.value)}
            placeholder="~/.tsuki/libs"
            className="flex-1"
          />
          <Btn variant="outline" size="xs" onClick={async () => {
            const { pickFolder } = await import('@/lib/tauri')
            const p = await pickFolder()
            if (p) updateSetting('libsDir', p)
          }}><FolderOpen size={11} /></Btn>
        </div>
      </SettingsField>

      {/* Extra search paths */}
      <div className="py-3.5 border-b border-[var(--border-subtle)]">
        <div className="flex items-start gap-4 mb-3">
          <div className="flex-1">
            <div className="text-sm font-medium">extra_libs_dirs</div>
            <div className="text-xs text-[var(--fg-muted)] mt-0.5">
              Additional directories searched when resolving tsukilib packages.
              Checked in order after <span className="font-mono">libs_dir</span>.
            </div>
          </div>
        </div>

        {/* List of extra dirs */}
        {(settings.extraLibsDirs ?? []).length > 0 && (
          <div className="mb-2 flex flex-col gap-1">
            {(settings.extraLibsDirs ?? []).map((dir: string, i: number) => (
              <div
                key={dir}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-[var(--border)] bg-[var(--surface-1)] group"
              >
                <Package size={11} className="text-[var(--fg-faint)] flex-shrink-0" />
                <span className="flex-1 text-xs font-mono text-[var(--fg)] truncate">{dir}</span>
                {/* up/down */}
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => i > 0 && moveDir(i, i - 1)}
                    disabled={i === 0}
                    className="px-1 py-0.5 rounded text-[10px] text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] disabled:opacity-25 border-0 bg-transparent cursor-pointer"
                  >↑</button>
                  <button
                    onClick={() => i < (settings.extraLibsDirs ?? []).length - 1 && moveDir(i, i + 1)}
                    disabled={i === (settings.extraLibsDirs ?? []).length - 1}
                    className="px-1 py-0.5 rounded text-[10px] text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] disabled:opacity-25 border-0 bg-transparent cursor-pointer"
                  >↓</button>
                </div>
                <button
                  onClick={() => removeExtraDir(dir)}
                  className="p-0.5 rounded text-[var(--fg-faint)] hover:text-[var(--err)] hover:bg-[var(--err)]/10 border-0 bg-transparent cursor-pointer transition-colors flex-shrink-0"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add new dir row */}
        <div className="flex items-center gap-1.5">
          <input
            value={newDir}
            onChange={e => setNewDir(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addExtraDir(newDir)}
            placeholder="Add a path…"
            className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-xs text-[var(--fg)] outline-none font-mono placeholder:text-[var(--fg-faint)] focus:border-[var(--fg-faint)]"
          />
          <Btn variant="outline" size="xs" onClick={() => addExtraDir(newDir)}><Plus size={11} /></Btn>
          <Btn variant="outline" size="xs" onClick={browseExtraDir}><FolderOpen size={11} /></Btn>
        </div>

        {(settings.extraLibsDirs ?? []).length === 0 && (
          <p className="mt-1.5 text-[10px] text-[var(--fg-faint)]">
            No extra paths configured. Only <span className="font-mono">libs_dir</span> will be searched.
          </p>
        )}
      </div>

      <SettingsField name="verify_signatures" desc="Verify Ed25519 signatures when installing packages">
        <Toggle on={settings.verifySignatures} onToggle={() => updateSetting('verifySignatures', !settings.verifySignatures)} />
      </SettingsField>

      <GroupHeader title="Package registries" />
      <RegistrySourcesEditor />

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
      <SettingsField name="Allow editing build files" desc="Unlock files inside build/ for editing (changes will be overwritten on next build)">
        <Toggle on={settings.allowEditBuildFiles ?? false} onToggle={() => updateSetting('allowEditBuildFiles', !settings.allowEditBuildFiles)} />
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
//  Updates tab
// ─────────────────────────────────────────────────────────────────────────────

// Public keys per channel — these match the private keys used to sign releases
// in build.py (generated with `python tools/build.py gen-keys`).
// Replace with your actual base64-encoded Ed25519 public keys.
const UPDATE_PUBKEYS: Record<'stable' | 'testing', string> = {
  stable:  'wlMslB+1Nt55zH+It+m+HCZA0HEc8E3BkWvEv9K7DRA=',
  testing: '6jefc9ms6aUIYmZXJPCBVzQWON2AgvnynIlfZUgJLGU=',
}

// Manifest URLs point to the web API — no files need to be committed to any
// branch. The API queries GitHub Releases dynamically and returns the manifest.
const UPDATE_MANIFEST_URLS: Record<'stable' | 'testing', string> = {
  stable:  'https://tsuki.s7lver.xyz/api/update/stable',
  testing: 'https://tsuki.s7lver.xyz/api/update/testing',
}

interface UpdateInfo {
  version: string
  channel: 'stable' | 'testing'
  pub_date: string
  notes: string
  platforms: Record<string, { url: string; signature: string; size: number }>
}

/** Compare two semver strings. Returns: 1 if a > b, -1 if a < b, 0 if equal. */
function compareSemver(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const [aMaj, aMin, aPatch] = parse(a)
  const [bMaj, bMin, bPatch] = parse(b)
  if (aMaj !== bMaj) return aMaj > bMaj ? 1 : -1
  if (aMin !== bMin) return aMin > bMin ? 1 : -1
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1
  return 0
}

function fmtBytes(n: number): string {
  if (n === 0) return '?'
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function UpdatesTab() {
  const { settings, updateSetting } = useStore()

  const channel: 'stable' | 'testing' = settings.updateChannel ?? 'stable'

  // ── State ────────────────────────────────────────────────────────────────
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)
  const [checking, setChecking]             = useState(false)
  const [manifest, setManifest]             = useState<UpdateInfo | null>(null)
  const [checkErr, setCheckErr]             = useState<string | null>(null)

  // Download progress  { pct: 0-100, downloaded: bytes, total: bytes, stage }
  const [progress, setProgress] = useState<{
    pct: number; downloaded: number; total: number; stage: string
  } | null>(null)
  const [installErr, setInstallErr] = useState<string | null>(null)

  // Fetch the current app version once on mount
  useEffect(() => {
    import('@/lib/tauri').then(({ getAppVersion }) =>
      getAppVersion().then(v => setCurrentVersion(v)).catch(() => setCurrentVersion('0.0.0'))
    )
  }, [])

  // Listen for progress events from Rust
  useEffect(() => {
    let unlisten: (() => void) | null = null
    import('@tauri-apps/api/event').then(({ listen }) => {
      type ProgressPayload = { stage: string; pct?: number; downloaded?: number; total?: number }
      const typedListen = listen as (event: string, cb: (e: { payload: ProgressPayload }) => void) => Promise<() => void>
      typedListen(
        'update_progress',
        ({ payload }) => {
          setProgress({
            stage:      payload.stage,
            pct:        payload.pct        ?? 0,
            downloaded: payload.downloaded ?? 0,
            total:      payload.total      ?? 0,
          })
        }
      ).then(fn => { unlisten = fn })
    })
    return () => { unlisten?.() }
  }, [])

  // ── Actions ──────────────────────────────────────────────────────────────
  async function checkNow() {
    setChecking(true)
    setCheckErr(null)
    setManifest(null)
    setInstallErr(null)
    try {
      const { checkForUpdates } = await import('@/lib/tauri')
      const result = await checkForUpdates(channel, UPDATE_MANIFEST_URLS[channel])
      setManifest(result)
      updateSetting('lastUpdateCheck', Date.now())
      // Persist update-flag fields from the manifest into settings so that
      // page.tsx can read them on next launch (after the update is applied).
      // forcedOnboardingVersion → triggers re-show of the wizard
      // whatsNewVersion + whatsNewChangelog → triggers What's New popup
      if (result.forced_onboarding_version) {
        updateSetting('forcedOnboardingVersion' as any, result.forced_onboarding_version)
      }
      if (result.whats_new_version) {
        updateSetting('whatsNewVersion' as any, result.whats_new_version)
      }
      if (result.whats_new_changelog) {
        updateSetting('whatsNewChangelog' as any, result.whats_new_changelog)
      }
    } catch (e: unknown) {
      setCheckErr(e instanceof Error ? e.message : String(e))
    }
    setChecking(false)
  }

  async function installUpdate() {
    if (!manifest) return
    setInstallErr(null)
    setProgress({ stage: 'downloading', pct: 0, downloaded: 0, total: 0 })
    try {
      const { applyUpdate } = await import('@/lib/tauri')
      await applyUpdate(manifest)
      // If we get here the app is restarting — nothing more to do
    } catch (e: unknown) {
      setInstallErr(e instanceof Error ? e.message : String(e))
      setProgress(null)
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  const lastCheck = settings.lastUpdateCheck
    ? new Date(settings.lastUpdateCheck).toLocaleString()
    : 'Never'

  const installing = progress !== null && progress.stage !== 'done'

  // Version comparison result
  const cmp = manifest && currentVersion ? compareSemver(manifest.version, currentVersion) : null
  // cmp > 0 → remote is newer (update available)
  // cmp = 0 → same version
  // cmp < 0 → remote is older

  return (
    <div>
      <SectionHeader
        title="Updates"
        desc="Keep tsuki IDE up to date. Choose between the stable release channel or the testing channel for early access."
      />

      {/* ── Channel selector ── */}
      <GroupHeader title="Update channel" />
      <div className="flex flex-col gap-2 mt-3 mb-5">
        {([
          { id: 'stable'  as const, label: 'Stable',  badge: 'recommended', badgeColor: 'text-green-400 bg-green-400/10',  desc: 'Tested and signed before publishing.' },
          { id: 'testing' as const, label: 'Testing', badge: 'beta',         badgeColor: 'text-yellow-400 bg-yellow-400/10', desc: 'Early access — may contain bugs. Separate signing key.' },
        ]).map(ch => (
          <button
            key={ch.id}
            onClick={() => { updateSetting('updateChannel', ch.id); setManifest(null); setCheckErr(null) }}
            className={clsx(
              'flex items-start gap-3 px-4 py-3.5 rounded-xl border text-left cursor-pointer transition-all w-full bg-transparent',
              channel === ch.id
                ? 'border-[var(--fg-muted)] bg-[var(--active)]'
                : 'border-[var(--border)] hover:border-[var(--fg-faint)] hover:bg-[var(--hover)]',
            )}
          >
            <Radio size={15} className={clsx('mt-0.5 flex-shrink-0', channel === ch.id ? 'text-[var(--fg)]' : 'text-[var(--fg-faint)]')} />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-semibold">{ch.label}</span>
                <span className={clsx('text-[9px] font-mono px-1.5 py-0.5 rounded', ch.badgeColor)}>{ch.badge}</span>
              </div>
              <p className="text-xs text-[var(--fg-muted)]">{ch.desc}</p>
            </div>
            {channel === ch.id && <Check size={13} className="text-green-400 mt-0.5 flex-shrink-0" />}
          </button>
        ))}
      </div>

      {/* ── Auto-check ── */}
      <GroupHeader title="Behaviour" />
      <SettingsField name="Check on startup" desc="Automatically check for updates when the IDE opens.">
        <Toggle
          on={settings.autoCheckUpdates ?? true}
          onToggle={() => updateSetting('autoCheckUpdates', !(settings.autoCheckUpdates ?? true))}
        />
      </SettingsField>

      {/* ── Check now panel ── */}
      <GroupHeader title="Check now" />
      <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] overflow-hidden">

        {/* Header row */}
        <div className="px-4 py-3 flex items-center gap-3 border-b border-[var(--border)]">
          <div className="flex-1">
            <div className="text-sm font-medium">
              Channel: <span className="font-mono text-[var(--fg-muted)]">{channel}</span>
              {currentVersion && (
                <span className="ml-2 text-xs text-[var(--fg-faint)]">· current: v{currentVersion}</span>
              )}
            </div>
            <div className="text-xs text-[var(--fg-muted)] mt-0.5">Last checked: {lastCheck}</div>
          </div>
          <Btn variant="outline" size="sm" onClick={checkNow} disabled={checking || installing} className="gap-1.5 flex-shrink-0">
            <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
            {checking ? 'Checking…' : 'Check for updates'}
          </Btn>
        </div>

        {/* Result area */}
        <div className="px-4 py-3 min-h-[64px]">
          {!manifest && !checkErr && !checking && !progress && (
            <p className="text-xs text-[var(--fg-faint)] leading-relaxed">
              Press "Check for updates" to query the {channel} manifest.
            </p>
          )}

          {checking && (
            <div className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
              <RefreshCw size={12} className="animate-spin" /> Fetching {channel} manifest…
            </div>
          )}

          {checkErr && (
            <div className="flex items-start gap-2 text-xs text-[var(--err)]">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
              <span>{checkErr}</span>
            </div>
          )}

          {/* ── Download / install progress ── */}
          {progress && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--fg-muted)] capitalize font-medium">
                  {progress.stage === 'downloading' ? 'Downloading…'
                   : progress.stage === 'installing' ? 'Installing…'
                   : 'Done — restarting…'}
                </span>
                <span className="font-mono text-[var(--fg-faint)]">
                  {progress.stage === 'downloading'
                    ? `${fmtBytes(progress.downloaded)} / ${fmtBytes(progress.total)}`
                    : `${progress.pct}%`}
                </span>
              </div>
              {/* Progress bar */}
              <div className="h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${progress.pct}%`,
                    background: progress.stage === 'done'
                      ? 'var(--ok, #22c55e)'
                      : 'var(--fg-muted)',
                  }}
                />
              </div>
              {installErr && (
                <div className="flex items-start gap-1.5 text-xs text-[var(--err)]">
                  <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
                  {installErr}
                </div>
              )}
            </div>
          )}

          {/* ── Manifest result (no active download) ── */}
          {manifest && !progress && (
            <div className="flex flex-col gap-3">

              {/* Newer version available */}
              {cmp !== null && cmp > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Download size={14} className="text-green-400 flex-shrink-0" />
                    <span className="text-sm font-semibold text-green-400">
                      v{manifest.version} available
                    </span>
                    <span className="text-xs text-[var(--fg-faint)]">
                      · {new Date(manifest.pub_date).toLocaleDateString()}
                    </span>
                  </div>
                  {manifest.notes && (
                    <p className="text-xs text-[var(--fg-muted)] leading-relaxed border-l-2 border-[var(--border)] pl-3 whitespace-pre-wrap">
                      {manifest.notes}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Btn variant="outline" size="sm" onClick={installUpdate} className="gap-1.5">
                      <Download size={12} /> Download & install
                    </Btn>
                    <Btn variant="ghost" size="sm" onClick={() => {
                      updateSetting('lastSeenVersion', manifest.version)
                      setManifest(null)
                    }}>
                      Dismiss
                    </Btn>
                  </div>
                </div>
              )}

              {/* Same version */}
              {cmp !== null && cmp === 0 && (
                <div className="flex items-center gap-2 text-xs text-green-400">
                  <Check size={13} className="flex-shrink-0" />
                  <span>You&apos;re on the latest version (v{currentVersion}).</span>
                </div>
              )}

              {/* Older version in channel (shown below, greyed out) */}
              {cmp !== null && cmp < 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-xs text-green-400">
                    <Check size={13} className="flex-shrink-0" />
                    <span>Your version (v{currentVersion}) is newer than {channel}.</span>
                  </div>
                  <div className="mt-1 px-3 py-2 rounded border border-[var(--border)] bg-[var(--surface)] opacity-60">
                    <p className="text-[10px] text-[var(--fg-faint)]">
                      <span className="font-mono">{channel}</span> channel is at v{manifest.version}
                      {' · '}{new Date(manifest.pub_date).toLocaleDateString()}
                    </p>
                    {manifest.notes && (
                      <p className="text-[10px] text-[var(--fg-faint)] mt-0.5 truncate">{manifest.notes}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Unknown comparison (no local version yet) */}
              {cmp === null && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Download size={14} className="text-[var(--fg-muted)] flex-shrink-0" />
                    <span className="text-sm font-medium">v{manifest.version}</span>
                    <span className="text-xs text-[var(--fg-faint)]">
                      · {new Date(manifest.pub_date).toLocaleDateString()}
                    </span>
                  </div>
                  <Btn variant="outline" size="sm" onClick={installUpdate} className="gap-1.5 w-fit">
                    <Download size={12} /> Download & install
                  </Btn>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Signing keys ── */}
      <GroupHeader title="Signing keys" />
      <div className="mt-3 mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] divide-y divide-[var(--border-subtle)]">
        {(['stable', 'testing'] as const).map(ch => (
          <div key={ch} className="px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold capitalize">{ch}</span>
              {ch === channel && <span className="text-[9px] font-mono text-green-400 bg-green-400/10 px-1 rounded">active</span>}
            </div>
            <p className="text-[10px] font-mono text-[var(--fg-faint)] break-all leading-relaxed select-all">
              {UPDATE_PUBKEYS[ch]}
            </p>
          </div>
        ))}
      </div>

      {/* ── Version history / downgrade ── */}
      <VersionHistoryPanel
        channel={channel}
        currentVersion={currentVersion}
        installing={installing}
        onInstall={installUpdate}
        setManifest={setManifest}
        setProgress={setProgress}
        setInstallErr={setInstallErr}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  VersionHistoryPanel — browse + downgrade to older releases
// ─────────────────────────────────────────────────────────────────────────────

interface GHRelease {
  tag_name: string
  name: string
  published_at: string
  body: string
  assets: { name: string; browser_download_url: string; size: number }[]
  prerelease: boolean
}

function VersionHistoryPanel({
  channel,
  currentVersion,
  installing,
  onInstall,
  setManifest,
  setProgress,
  setInstallErr,
}: {
  channel: 'stable' | 'testing'
  currentVersion: string | null
  installing: boolean
  onInstall: () => void
  setManifest: (m: UpdateInfo | null) => void
  setProgress: (p: any) => void
  setInstallErr: (e: string | null) => void
}) {
  const [releases,  setReleases ] = useState<GHRelease[] | null>(null)
  const [loading,   setLoading  ] = useState(false)
  const [loadErr,   setLoadErr  ] = useState<string | null>(null)
  const [expanded,  setExpanded ] = useState(false)
  const [installing2, setInstalling2] = useState<string | null>(null)

  // Derive platform key from navigator
  function getPlatformKey(): string | null {
    const ua = navigator.userAgent.toLowerCase()
    if (ua.includes('win')) return 'windows-amd64'
    if (ua.includes('mac')) return 'darwin-arm64'   // sensible default; user can pick
    return 'linux-amd64'
  }

  async function fetchReleases() {
    setLoading(true)
    setLoadErr(null)
    try {
      const owner = 's7lver2'
      const repo  = 'tsuki'
      const resp  = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/releases?per_page=20`,
        { headers: { Accept: 'application/vnd.github+json' } },
      )
      if (!resp.ok) throw new Error(`GitHub API ${resp.status}`)
      const data: GHRelease[] = await resp.json()
      // Filter by channel
      const filtered = channel === 'testing'
        ? data
        : data.filter(r => !r.prerelease && !r.tag_name.includes('-testing'))
      setReleases(filtered)
      setExpanded(true)
    } catch (e: unknown) {
      setLoadErr(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }

  async function installRelease(rel: GHRelease) {
    const pk = getPlatformKey()
    // Find asset for current platform
    const asset = rel.assets.find(a =>
      pk ? a.name.toLowerCase().includes(pk.replace('-', '_')) || a.name.toLowerCase().includes(pk) : false
    ) ?? rel.assets.find(a => a.name.endsWith('.exe') || a.name.endsWith('.tar.gz'))

    if (!asset) {
      setInstallErr(`No asset found for ${pk ?? 'your platform'} in ${rel.tag_name}`)
      return
    }

    // Build a minimal UpdateInfo-compatible object
    const syntheticManifest: UpdateInfo = {
      version:   rel.tag_name.replace(/^v/, ''),
      channel,
      pub_date:  rel.published_at,
      notes:     rel.body?.slice(0, 400) ?? '',
      platforms: {
        [pk ?? 'unknown']: {
          url:       asset.browser_download_url,
          signature: '',   // no sig verification for manual downgrades
          size:      asset.size,
        },
      },
    }

    setInstalling2(rel.tag_name)
    setManifest(syntheticManifest)
    setProgress({ stage: 'downloading', pct: 0, downloaded: 0, total: 0 })
    try {
      const { applyUpdate } = await import('@/lib/tauri')
      await applyUpdate(syntheticManifest)
    } catch (e: unknown) {
      setInstallErr(e instanceof Error ? e.message : String(e))
      setProgress(null)
    }
    setInstalling2(null)
  }

  return (
    <>
      <GroupHeader title="Version history" />
      <div className="mt-3 mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 flex items-center gap-3 border-b border-[var(--border)]">
          <div className="flex-1">
            <div className="text-sm font-medium">Older releases</div>
            <div className="text-xs text-[var(--fg-muted)] mt-0.5">
              Browse and install a previous version. Useful if the latest release introduced a regression.
            </div>
          </div>
          <Btn
            variant="outline"
            size="sm"
            onClick={expanded && releases ? () => setExpanded(false) : fetchReleases}
            disabled={loading || installing}
            className="gap-1.5 flex-shrink-0"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading…' : expanded && releases ? 'Hide' : 'Show releases'}
          </Btn>
        </div>

        {loadErr && (
          <div className="px-4 py-3 flex items-start gap-2 text-xs text-[var(--err)]">
            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
            <span>{loadErr}</span>
          </div>
        )}

        {expanded && releases && (
          <div className="divide-y divide-[var(--border-subtle)] max-h-[360px] overflow-y-auto">
            {releases.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-[var(--fg-faint)]">
                No releases found for the <span className="font-mono">{channel}</span> channel.
              </div>
            )}
            {releases.map(rel => {
              const ver = rel.tag_name.replace(/^v/, '')
              const isCurrent = currentVersion ? compareSemver(ver, currentVersion) === 0 : false
              const isNewer   = currentVersion ? compareSemver(ver, currentVersion) > 0  : false
              const isInst    = installing2 === rel.tag_name

              return (
                <div key={rel.tag_name} className={clsx(
                  'px-4 py-3 flex items-start gap-3 transition-colors',
                  isCurrent ? 'bg-green-400/5' : 'hover:bg-[var(--hover)]',
                )}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-sm font-semibold font-mono">{rel.tag_name}</span>
                      {isCurrent && (
                        <span className="text-[9px] font-mono text-green-400 bg-green-400/10 px-1.5 rounded">installed</span>
                      )}
                      {rel.prerelease && (
                        <span className="text-[9px] font-mono text-yellow-400 bg-yellow-400/10 px-1.5 rounded">pre-release</span>
                      )}
                      <span className="text-[10px] text-[var(--fg-faint)]">
                        {new Date(rel.published_at).toLocaleDateString()}
                      </span>
                    </div>
                    {rel.body && (
                      <p className="text-[10px] text-[var(--fg-faint)] leading-relaxed line-clamp-2 max-w-sm">
                        {rel.body.replace(/#+\s*/g, '').slice(0, 120)}{rel.body.length > 120 ? '…' : ''}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {rel.assets.slice(0, 4).map(a => (
                        <span key={a.name} className="text-[9px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded">
                          {a.name.split('-').slice(-1)[0]}  {/* platform suffix */}
                        </span>
                      ))}
                      {rel.assets.length > 4 && (
                        <span className="text-[9px] text-[var(--fg-faint)]">+{rel.assets.length - 4} more</span>
                      )}
                    </div>
                  </div>

                  {!isCurrent && (
                    <Btn
                      variant={isNewer ? 'outline' : 'ghost'}
                      size="xs"
                      disabled={installing || isInst}
                      onClick={() => installRelease(rel)}
                      className="flex-shrink-0 gap-1"
                    >
                      {isInst
                        ? <><RefreshCw size={10} className="animate-spin" /> Installing…</>
                        : isNewer
                          ? <><Download size={10} /> Update</>
                          : <><RotateCcw size={10} /> Downgrade</>
                      }
                    </Btn>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!expanded && !loading && !loadErr && (
          <div className="px-4 py-4 text-center text-xs text-[var(--fg-faint)]">
            Click "Show releases" to fetch the version list from GitHub.
          </div>
        )}
      </div>

      {/* Downgrade warning */}
      <div className="mb-6 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-yellow-400/5 border border-yellow-400/20">
        <AlertTriangle size={12} className="text-yellow-400 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-[var(--fg-muted)] leading-relaxed">
          <strong className="text-[var(--fg)]">Downgrading</strong> replaces the IDE binary but does not roll back project files or config. Back up your work before downgrading. Signature verification is skipped for manual installs.
        </p>
      </div>
    </>
  )
}

// ── Log category metadata ─────────────────────────────────────────────────────

const DEFAULT_CATS = {
  spawn: true, pty: true, resolve: true,
  settings: true, shell: true, process: true, frontend: true,
}

const LOG_CATEGORIES: { key: string; desc: string; examples: string }[] = [
  {
    key: 'spawn',
    desc: 'spawn_process calls — toolbar buttons (Build, Flash, Check)',
    examples: '[spawn_process] cmd pid exit',
  },
  {
    key: 'pty',
    desc: 'PTY / terminal lifecycle — shell open, resize, kill, exit',
    examples: '[pty_create] [pty_exit] [pty_kill] [pty_resize]',
  },
  {
    key: 'resolve',
    desc: 'Path resolution — normalise_cmd, resolve_cmd, which lookups',
    examples: '[normalise_cmd] [resolve_cmd] [pty_resolve]',
  },
  {
    key: 'settings',
    desc: 'Settings read/write, tool-path detection at startup',
    examples: '[main] settings parsed debugMode=',
  },
  {
    key: 'shell',
    desc: 'Shell detection (list_shells) and spawn_shell calls',
    examples: '[spawn_shell] shell_id shell_path',
  },
  {
    key: 'process',
    desc: 'Process exit codes, write_stdin, kill_process',
    examples: '[process_exit] pid= exit_code=',
  },
  {
    key: 'frontend',
    desc: 'console.log/warn/error forwarded from the renderer',
    examples: '[frontend:log] [frontend:warn] [frontend:error]',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
//  Developer tab
// ─────────────────────────────────────────────────────────────────────────────

function DeveloperTab() {
  const { goBack, settings, updateSetting } = useStore()
  const [resetting, setResetting] = useState(false)
  const [resetDone, setResetDone] = useState(false)

  // ── Debug mode state ───────────────────────────────────────────────────────
  const [logPath,       setLogPath      ] = useState<string>('')
  const [logLines,      setLogLines     ] = useState<string>('')
  const [logLoading,    setLogLoading   ] = useState(false)
  const [clearing,      setClearing     ] = useState(false)
  const [clearDone,     setClearDone    ] = useState(false)
  const [showRestart,   setShowRestart  ] = useState(false)
  const [diagReport,    setDiagReport   ] = useState<string>('')
  const [diagLoading,   setDiagLoading  ] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)

  // Fetch the log file path once on mount
  useEffect(() => {
    import('@/lib/tauri').then(({ getDebugLogPath }) => {
      getDebugLogPath().then(p => setLogPath(p)).catch(() => {})
    })
  }, [])

  // Auto-scroll log viewer to bottom
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logLines])

  async function refreshLog() {
    setLogLoading(true)
    try {
      const { tailDebugLog } = await import('@/lib/tauri')
      const lines = await tailDebugLog(300)
      setLogLines(lines)
    } catch { setLogLines('(error reading log)') }
    setLogLoading(false)
  }

  async function clearLog() {
    setClearing(true)
    try {
      const { clearDebugLog } = await import('@/lib/tauri')
      await clearDebugLog()
      setLogLines('')
      setClearDone(true)
      setTimeout(() => setClearDone(false), 2500)
    } catch {}
    setClearing(false)
  }

  async function openLog() {
    try {
      const { openDebugLog } = await import('@/lib/tauri')
      await openDebugLog()
    } catch {}
  }

  async function runDiag() {
    setDiagLoading(true)
    try {
      const { runDiagnostics } = await import('@/lib/tauri')
      const report = await runDiagnostics()
      setDiagReport(report)
    } catch (e) {
      setDiagReport(`Error running diagnostics: ${e}`)
    }
    setDiagLoading(false)
  }

  function toggleDebugMode() {
    const next = !settings.debugMode
    updateSetting('debugMode', next)
    setShowRestart(true)
  }

  function toggleCategory(key: string, on: boolean) {
    const next = { ...(settings.debugLogCategories ?? DEFAULT_CATS), [key]: on }
    updateSetting('debugLogCategories', next)
    // Push to Rust live — no restart needed for category changes
    import('@/lib/tauri').then(({ setLogCategories }) => {
      setLogCategories(next).catch(() => {})
    })
  }

  function toggleAllCategories(on: boolean) {
    const next = Object.fromEntries(LOG_CATEGORIES.map(c => [c.key, on])) as typeof DEFAULT_CATS
    updateSetting('debugLogCategories', next)
    import('@/lib/tauri').then(({ setLogCategories }) => {
      setLogCategories(next).catch(() => {})
    })
  }

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

      {/* ── Debug & Logging ───────────────────────────────────────────────── */}
      <GroupHeader title="Debug & Logging" />

      {/* Restart-required banner */}
      {showRestart && (
        <div className="mb-4 flex items-center gap-3 px-3 py-2.5 rounded-lg bg-amber-400/10 border border-amber-400/30">
          <AlertTriangle size={13} className="text-amber-400 flex-shrink-0" />
          <p className="text-xs text-[var(--fg-muted)] flex-1 leading-relaxed">
            <strong className="text-[var(--fg)]">Restart required.</strong>{' '}
            The Rust process reads both settings at startup — changes take effect after a full restart.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-amber-400/40 bg-amber-400/10 text-amber-400 text-xs font-medium cursor-pointer hover:bg-amber-400/20 transition-colors"
          >
            <RotateCcw size={11} /> Restart now
          </button>
        </div>
      )}

      {/* Enable / disable */}
      <SettingsField
        name="Debug mode"
        desc="Captures Rust + frontend logs to a file from the first millisecond of startup. Requires restart."
      >
        <div className="flex items-center gap-2">
          <Toggle on={settings.debugMode} onToggle={toggleDebugMode} />
          {settings.debugMode && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
              <Bug size={10} /> active
            </span>
          )}
        </div>
      </SettingsField>

      {/* Log format selector */}
      <SettingsField
        name="Log format"
        desc="Flat is human-readable. Structured writes [key=value] tokens so you can grep -E precisely. Requires restart."
      >
        <div className="flex gap-2">
          {(['flat', 'structured'] as const).map(fmt => (
            <button
              key={fmt}
              onClick={() => { updateSetting('debugLogFormat', fmt); setShowRestart(true) }}
              className={clsx(
                'flex-1 flex flex-col gap-1 px-3 py-2 rounded border text-left cursor-pointer transition-colors',
                settings.debugLogFormat === fmt
                  ? 'border-amber-400/50 bg-amber-400/8 text-[var(--fg)]'
                  : 'border-[var(--border)] bg-[var(--surface-1)] text-[var(--fg-muted)] hover:bg-[var(--hover)]',
              )}
            >
              <span className="text-[11px] font-semibold capitalize">{fmt}</span>
              <span className="text-[9px] text-[var(--fg-faint)] leading-tight">
                {fmt === 'flat'
                  ? '[1234.567] [spawn] cmd="tsuki.exe"'
                  : '[ts=1234.567] [src=rust] [cat=spawn]'}
              </span>
            </button>
          ))}
        </div>
      </SettingsField>

      {/* Grep cheatsheet — only shown when structured is active */}
      {settings.debugLogFormat === 'structured' && (
        <div className="mt-1 mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
            <span className="text-[10px] font-mono text-[var(--fg-faint)] uppercase tracking-widest">grep cheatsheet</span>
          </div>
          <div className="px-3 py-2.5 flex flex-col gap-1.5">
            {[
              { expr: '[src=rust]',           desc: 'Rust-only entries'            },
              { expr: '[src=frontend]',        desc: 'Frontend-only entries'        },
              { expr: '[lvl=error]',           desc: 'Errors only'                  },
              { expr: '[lvl=warn]',            desc: 'Warnings only'                },
              { expr: '[cat=spawn_process]',   desc: 'Process spawn events'         },
              { expr: '[cat=pty',              desc: 'All PTY / terminal events'    },
              { expr: '[cat=pty_resolve]',     desc: 'PTY path resolution'          },
              { expr: '[cat=resolve_cmd]',     desc: 'spawn_process path resolution'},
              { expr: '[cat=normalise_cmd]',   desc: 'Path normalisation'           },
              { expr: '[cat=main]',            desc: 'Startup sequence'             },
              { expr: 'tsuki.exe',             desc: 'Any entry mentioning binary'  },
            ].map(({ expr, desc }) => (
              <div key={expr} className="flex items-center gap-3 py-0.5">
                <code className="text-[10px] font-mono text-blue-400 bg-blue-400/8 px-1.5 py-0.5 rounded select-all flex-shrink-0">
                  grep &quot;{expr}&quot;
                </code>
                <span className="text-[10px] text-[var(--fg-faint)]">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Log categories ─────────────────────────────────────────────────── */}
      <div className="mt-4 mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
          <span className="text-[10px] font-mono text-[var(--fg-faint)] uppercase tracking-widest">
            log categories
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => toggleAllCategories(true)}
              className="px-2 py-0.5 rounded text-[9px] text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer transition-colors"
            >
              all on
            </button>
            <button
              onClick={() => toggleAllCategories(false)}
              className="px-2 py-0.5 rounded text-[9px] text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer transition-colors"
            >
              all off
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-[var(--border-subtle)]">
          {LOG_CATEGORIES.map((cat, i) => {
            const cats = settings.debugLogCategories ?? DEFAULT_CATS
            const on = cats[cat.key as keyof typeof cats] ?? true
            return (
              <button
                key={cat.key}
                onClick={() => toggleCategory(cat.key, !on)}
                className={clsx(
                  'flex items-start gap-2.5 px-3 py-2.5 text-left cursor-pointer border-0 bg-transparent transition-colors',
                  i >= 2 && 'border-t border-[var(--border-subtle)]',
                  on ? 'hover:bg-[var(--hover)]' : 'opacity-50 hover:opacity-75 hover:bg-[var(--hover)]',
                )}
              >
                <div className={clsx(
                  'mt-0.5 w-3 h-3 rounded-sm border flex-shrink-0 flex items-center justify-center transition-colors',
                  on
                    ? 'bg-amber-400 border-amber-400'
                    : 'bg-transparent border-[var(--fg-faint)]',
                )}>
                  {on && <Check size={8} className="text-black" />}
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-mono font-semibold text-[var(--fg)] leading-tight">
                    {cat.key}
                  </div>
                  <div className="text-[9px] text-[var(--fg-faint)] leading-relaxed mt-0.5">
                    {cat.desc}
                  </div>
                  <div className="text-[9px] font-mono text-[var(--fg-faint)] opacity-60 mt-0.5 truncate">
                    {cat.examples}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
        <div className="px-3 py-2 border-t border-[var(--border-subtle)] bg-[var(--surface)]">
          <span className="text-[9px] text-[var(--fg-faint)]">
            Category toggles take effect immediately — no restart needed.
            The <code className="font-mono bg-[var(--surface-3)] px-0.5 rounded">pty_write</code> category
            is very noisy (every keystroke) — enable only when debugging input issues.
          </span>
        </div>
      </div>

      {/* Log file path */}
      <SettingsField
        name="Log file path"
        desc="Location on disk. Open in your editor to tail it live while reproducing the bug."
      >
        <div className="flex items-center gap-1.5 w-full">
          <span className="flex-1 truncate text-[10px] font-mono text-[var(--fg-muted)] bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 select-all">
            {logPath || '(loading…)'}
          </span>
          <button
            onClick={openLog}
            title="Open in editor"
            className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded border border-[var(--border)] bg-[var(--surface-1)] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] cursor-pointer transition-colors text-[10px]"
          >
            <ExternalLink size={10} />
          </button>
        </div>
      </SettingsField>

      {/* Log viewer */}
      <div className="mt-3 mb-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--surface-1)]">
          <FileText size={11} className="text-[var(--fg-faint)]" />
          <span className="text-[10px] font-mono text-[var(--fg-faint)] uppercase tracking-widest flex-1">
            recent log — last 300 lines
          </span>
          <button
            onClick={refreshLog}
            disabled={logLoading}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer transition-colors disabled:opacity-40"
          >
            <RefreshCw size={10} className={logLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={clearLog}
            disabled={clearing}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-[var(--fg-muted)] hover:text-red-400 hover:bg-red-400/10 border-0 bg-transparent cursor-pointer transition-colors disabled:opacity-40"
          >
            {clearDone
              ? <><Check size={10} className="text-green-400" /> Cleared</>
              : <><Trash2 size={10} /> Clear</>
            }
          </button>
        </div>
        <pre
          ref={logRef}
          className="px-3 py-2 text-[10px] font-mono leading-relaxed overflow-y-auto whitespace-pre-wrap break-all"
          style={{ maxHeight: 280, minHeight: 80 }}
        >
          {logLines
            ? logLines.split('\n').map((line, i) => {
                // Flat:       [ts] [frontend:error] ...  [ts] [spawn_process] ...
                // Structured: [lvl=error] ...  [cat=spawn_process] ...  [src=rust] ...
                const isErr   = /\[frontend:error]|\[lvl=error]/.test(line)
                const isWarn  = /\[frontend:warn]|\[lvl=warn]/.test(line)
                const isSpawn = /\[spawn_process]|\[cat=spawn|\[cat=pty|\[cat=resolve/.test(line)
                const isSystem = /\[system:|\[cat=main]|log-cleared/.test(line)
                return (
                  <span key={i} className={
                    isErr    ? 'text-red-400 block'
                    : isWarn   ? 'text-yellow-400 block'
                    : isSpawn  ? 'text-blue-400 block'
                    : isSystem ? 'text-[var(--fg-faint)] block'
                    : 'text-[var(--fg-muted)] block'
                  }>
                    {line}
                  </span>
                )
              })
            : <span className="text-[var(--fg-faint)] italic">
                {settings.debugMode
                  ? 'Press Refresh to load the log — or Restart now and come back here.'
                  : 'Enable debug mode and restart the app to start capturing logs.'}
              </span>
          }
        </pre>
      </div>

      <div className="mb-6 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[var(--surface-1)] border border-[var(--border)]">
        <span className="text-[var(--fg-faint)] text-xs mt-0.5 flex-shrink-0">ℹ</span>
        <p className="text-[10px] text-[var(--fg-faint)] leading-relaxed">
          When debug mode is <strong className="text-[var(--fg)]">ON</strong>, the Rust backend
          captures every spawn, path resolution, PTY event, and settings read from millisecond&nbsp;0.
          The frontend patches{' '}
          <code className="font-mono bg-[var(--surface-3)] px-0.5 rounded">console.log/warn/error</code>{' '}
          and catches unhandled rejections. Clear periodically — the file grows unbounded.
        </p>
      </div>

      {/* ── System Diagnostics ────────────────────────────────────────────── */}
      <GroupHeader title="System Diagnostics" />
      <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] overflow-hidden">
        {/* header bar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
          <Bug size={11} className="text-[var(--fg-faint)]" />
          <span className="text-[10px] font-mono text-[var(--fg-faint)] uppercase tracking-widest flex-1">
            environment snapshot
          </span>
          <button
            onClick={runDiag}
            disabled={diagLoading}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] cursor-pointer transition-colors text-[10px] disabled:opacity-40"
          >
            <RefreshCw size={10} className={diagLoading ? 'animate-spin' : ''} />
            {diagLoading ? 'Running…' : 'Run diagnostics'}
          </button>
        </div>

        {/* report */}
        {diagReport ? (
          <pre
            className="px-3 py-2.5 text-[10px] font-mono text-[var(--fg-muted)] leading-relaxed overflow-y-auto whitespace-pre-wrap break-all"
            style={{ maxHeight: 340 }}
          >
            {diagReport.split('\n').map((line, i) => {
              const isSection = line.startsWith('===') || line.startsWith('\n===')
              const isMissing = line.includes('MISSING') || line.includes('NOT FOUND')
              const isOk      = line.includes('EXISTS') || line.includes('✓')
              return (
                <span key={i} className={
                  isSection ? 'text-amber-400 font-semibold block mt-1'
                  : isMissing ? 'text-red-400 block'
                  : isOk     ? 'text-green-400 block'
                  : 'block'
                }>
                  {line}
                </span>
              )
            })}
          </pre>
        ) : (
          <div className="px-3 py-4 text-center text-[10px] text-[var(--fg-faint)]">
            Click "Run diagnostics" to snapshot PATH entries, executable locations,
            environment variables, and shell paths. Results are also written to the debug log.
          </div>
        )}
      </div>

      {/* ── Windows process spawn method ──────────────────────────────────── */}
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

// ─────────────────────────────────────────────────────────────────────────────
//  Workstations experiment tab
// ─────────────────────────────────────────────────────────────────────────────

function WorkstationsTab() {
  const { settings, updateSetting } = useStore()

  const PAGE_ITEMS = [
    { id: 'code',    icon: <Code2 size={14} />,       label: 'Code',       desc: 'Editor + sidebar + terminal. The classic coding view.' },
    { id: 'sandbox', icon: <Cpu  size={14} />,        label: 'Sandbox',    desc: 'Full-screen circuit simulator. Uses the existing Sandbox experiment.' },
    { id: 'export',  icon: <Download size={14} />,    label: 'Export',     desc: 'Build, flash, and package. One place for release actions.' },
  ]

  const enabledPages: string[] = (settings as any).workstationPages ?? ['code', 'sandbox', 'export']

  function togglePage(id: string) {
    // Always keep at least one page enabled
    const next = enabledPages.includes(id)
      ? enabledPages.filter(p => p !== id)
      : [...enabledPages, id]
    if (next.length === 0) return
    updateSetting('workstationPages' as any, next)
  }

  return (
    <div>
      <div className="flex items-start gap-3 mb-7">
        <div className="w-10 h-10 rounded-lg border border-[var(--border)] flex items-center justify-center flex-shrink-0">
          <Layers size={18} className="text-[var(--fg-muted)]" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-semibold tracking-tight">Workstations</h2>
            <span className="text-xs font-mono text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded">active</span>
            <span className="text-[9px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1 rounded">α</span>
          </div>
          <p className="text-sm text-[var(--fg-muted)]">
            DaVinci Resolve-style page bar at the bottom of the IDE. Switch between dedicated full-screen workspaces — each tailored to a specific task.
          </p>
        </div>
      </div>

      {/* Visual mockup of the page bar */}
      <div className="mb-7 rounded-xl border border-[var(--border)] bg-[#0d0d0d] overflow-hidden">
        {/* fake editor area */}
        <div className="h-28 flex items-center justify-center">
          <span className="text-[11px] text-[var(--fg-faint)] font-mono opacity-50">— workstation content —</span>
        </div>
        {/* page bar */}
        <div className="h-10 border-t border-[var(--border)] bg-[var(--surface-1)] flex items-center justify-center gap-1 px-4">
          {PAGE_ITEMS.map(p => {
            const on = enabledPages.includes(p.id)
            return (
              <div
                key={p.id}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-medium transition-colors',
                  on
                    ? 'bg-[var(--active)] text-[var(--fg)] border border-[var(--fg-faint)]/20'
                    : 'text-[var(--fg-faint)] opacity-30',
                )}
              >
                {p.icon}
                {p.label}
              </div>
            )
          })}
        </div>
      </div>

      <GroupHeader title="Page bar" />
      <SettingsField
        name="Position"
        desc="Where the workstation switcher bar appears."
      >
        <Select
          value={(settings as any).workstationBarPosition ?? 'bottom'}
          onChange={e => updateSetting('workstationBarPosition' as any, e.target.value)}
        >
          <option value="bottom">Bottom</option>
          <option value="top">Top (below toolbar)</option>
        </Select>
      </SettingsField>

      <SettingsField
        name="Show labels"
        desc="Show text labels next to workstation icons. Disable for a compact icon-only bar."
      >
        <Toggle
          on={(settings as any).workstationShowLabels ?? true}
          onToggle={() => updateSetting('workstationShowLabels' as any, !((settings as any).workstationShowLabels ?? true))}
        />
      </SettingsField>

      <GroupHeader title="Active workstations" />
      <p className="text-xs text-[var(--fg-muted)] mb-4 leading-relaxed">
        Choose which pages appear in the bar. At least one must remain enabled.
      </p>
      <div className="flex flex-col gap-2 mb-6">
        {PAGE_ITEMS.map(p => {
          const on = enabledPages.includes(p.id)
          return (
            <div
              key={p.id}
              className={clsx(
                'flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors',
                on ? 'border-[var(--fg-faint)] bg-[var(--surface-1)]' : 'border-[var(--border)] bg-[var(--surface-1)] opacity-50',
              )}
            >
              <div className={clsx('flex-shrink-0 transition-colors', on ? 'text-[var(--fg-muted)]' : 'text-[var(--fg-faint)]')}>
                {p.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium mb-0.5">{p.label}</div>
                <p className="text-xs text-[var(--fg-muted)] leading-relaxed">{p.desc}</p>
              </div>
              <Toggle
                on={on}
                onToggle={() => togglePage(p.id)}
              />
            </div>
          )
        })}
      </div>

      <GroupHeader title="Behaviour" />
      <SettingsField
        name="Remember last workstation"
        desc="Re-open the last active workstation when the IDE starts."
      >
        <Toggle
          on={(settings as any).workstationRememberLast ?? true}
          onToggle={() => updateSetting('workstationRememberLast' as any, !((settings as any).workstationRememberLast ?? true))}
        />
      </SettingsField>

      <SettingsField
        name="Animate transitions"
        desc="Slide animation when switching between workstations."
      >
        <Toggle
          on={(settings as any).workstationAnimations ?? true}
          onToggle={() => updateSetting('workstationAnimations' as any, !((settings as any).workstationAnimations ?? true))}
        />
      </SettingsField>

      <div className="mt-6 flex items-start gap-2 px-3 py-3 rounded-lg bg-yellow-400/5 border border-yellow-400/20">
        <span className="text-yellow-400 text-xs mt-0.5">⚠</span>
        <p className="text-xs text-[var(--fg-muted)] leading-relaxed">
          Alpha feature. The Sandbox workstation requires the Sandbox experiment to also be enabled. Export workstation is a placeholder — full functionality coming soon.
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-webkit experiment settings tab
// ─────────────────────────────────────────────────────────────────────────────


function WebkitExpTab() {
  return (
    <div className="flex flex-col items-center justify-center gap-8 px-6 py-10 min-h-full select-none text-center">

      {/* Icon */}
      <div className="relative">
        <div className="w-20 h-20 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 flex items-center justify-center">
          <Globe size={36} className="text-emerald-400" />
        </div>
        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[var(--surface-3)] border border-[var(--border)] flex items-center justify-center">
          <span className="text-[9px] font-mono text-emerald-400">α</span>
        </div>
      </div>

      <div className="max-w-sm">
        <h2 className="text-lg font-bold mb-2 tracking-tight">tsuki-webkit</h2>
        <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
          Escribe tu panel de control web para ESP8266 / ESP32 en{" "}
          <span className="text-emerald-400 font-mono">JSX</span> — tsuki-webkit
          lo compila en una página HTML servida directamente desde tu placa vía WiFi.
        </p>
      </div>

      <div className="flex flex-col gap-2 w-full max-w-sm">
        {[
          { icon: <Code2 size={13} />, label: "JSX → HTML/CSS/JS",   desc: "Compilado en el IDE, sin Node.js" },
          { icon: <Zap   size={13} />, label: "Servidor web embebido", desc: "Para ESP8266 y ESP32" },
          { icon: <Cpu   size={13} />, label: "Simulación de API",     desc: "Sin necesidad de hardware físico" },
          { icon: <Globe size={13} />, label: "Consola Serial",        desc: "Salida Serial en tiempo real" },
        ].map(f => (
          <div key={f.label} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] text-left">
            <span className="text-emerald-400 flex-shrink-0">{f.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-[var(--fg)]">{f.label}</div>
              <div className="text-[10px] text-[var(--fg-faint)]">{f.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <WebkitMiniDemo />

      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-emerald-500/30 bg-emerald-500/5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-emerald-300 font-medium">Próximamente — en desarrollo activo</span>
        </div>
        <p className="text-[10px] text-[var(--fg-faint)] max-w-xs leading-relaxed">
          tsuki-webkit llegará en una próxima actualización. Sin configuración extra — todo compila en el IDE.
        </p>
      </div>
    </div>
  )
}

// ── Minimal inline animated code demo ────────────────────────────────────────

function WebkitMiniDemo() {
  const [step, setStep] = React.useState(0)
  const [cycle, setCycle] = React.useState(0)

  const STEPS = [
    { code: "import { Api } from 'tsuki-webkit'",   color: '#7dd3fc',  label: 'import',   labelColor: '#60a5fa' },
    { code: 'export default function App() {',       color: '#c4b5fd',  label: 'define',   labelColor: '#a78bfa' },
    { code: '  <button onClick={Api.toggle}>',       color: '#86efac',  label: 'JSX',      labelColor: '#4ade80' },
    { code: '    Toggle LED',                        color: '#e2e8f0',  label: '',         labelColor: '' },
    { code: '  </button>',                           color: '#86efac',  label: 'compile ✓',labelColor: '#4ade80' },
  ]

  React.useEffect(() => {
    const t = setTimeout(() => {
      if (step < STEPS.length - 1) {
        setStep(s => s + 1)
      } else {
        setTimeout(() => { setStep(0); setCycle(c => c + 1) }, 1800)
      }
    }, step === 0 ? 400 : 600)
    return () => clearTimeout(t)
  }, [step, cycle])  // eslint-disable-line

  return (
    <div className="w-full max-w-xs rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      {/* Fake titlebar */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--border)] bg-[var(--surface-1)]">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
        <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
        <span className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
        <span className="ml-2 text-[10px] font-mono text-[var(--fg-faint)]">app.jsx</span>
      </div>
      {/* Code lines */}
      <div className="px-3 py-2 font-mono text-[11px] flex flex-col gap-1" style={{ minHeight: 110 }}>
        {STEPS.slice(0, step + 1).map((s, i) => (
          <div key={i} className="flex items-center gap-2 transition-opacity" style={{ color: s.color, opacity: i === step ? 1 : 0.45 }}>
            <span className="flex-1">{s.code}</span>
            {i === step && s.label && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{ color: s.labelColor, background: `${s.labelColor}18`, border: `1px solid ${s.labelColor}30` }}>
                {s.label}
              </span>
            )}
          </div>
        ))}
        {step === STEPS.length - 1 && (
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            192.168.x.x / ESP8266 · ready
          </div>
        )}
      </div>
    </div>
  )
}