'use client'
import { useState } from 'react'
import { useStore } from '@/lib/store'
import { Btn, Input, Select, Divider } from '@/components/ui/primitives'
import { Plus, FolderOpen, Settings, Clock, ChevronRight, GitBranch } from 'lucide-react'

// Mirrors init.go board choices
const BOARDS = [
  { id: 'uno',        label: 'Arduino Uno',         note: 'ATmega328P · 16 MHz · 32 KB' },
  { id: 'nano',       label: 'Arduino Nano',         note: 'ATmega328P · 16 MHz · compact' },
  { id: 'mega',       label: 'Arduino Mega 2560',    note: 'ATmega2560 · 16 MHz · 256 KB' },
  { id: 'leonardo',   label: 'Arduino Leonardo',     note: 'ATmega32u4 · native USB' },
  { id: 'micro',      label: 'Arduino Micro',        note: 'ATmega32u4 · native USB' },
  { id: 'pro_mini_5v',label: 'Pro Mini 5V',          note: 'ATmega328P · breadboard' },
  { id: 'esp32',      label: 'ESP32 Dev Module',     note: 'Dual-core · 240 MHz · WiFi+BT' },
  { id: 'esp8266',    label: 'ESP8266 Generic',      note: 'Single-core · 80 MHz · WiFi' },
  { id: 'd1_mini',    label: 'Wemos D1 Mini',        note: 'ESP8266 · compact' },
  { id: 'pico',       label: 'Raspberry Pi Pico',    note: 'RP2040 · 133 MHz · 2 MB' },
]

// Mirrors init.go backend choices
const BACKENDS = [
  { id: 'tsuki-flash',       label: 'tsuki-flash ✦',           note: 'recommended · fast · parallel' },
  { id: 'tsuki-flash+cores', label: 'tsuki-flash + cores ✦',   note: 'fully standalone · downloads SDK' },
  { id: 'arduino-cli',       label: 'arduino-cli',              note: 'classic · requires arduino-cli' },
]

// Mirrors init.go template choices  
const TEMPLATES = [
  { value: 'blink',  label: 'Blink  (LED)' },
  { value: 'serial', label: 'Serial Hello' },
  { value: 'empty',  label: 'Empty project' },
]

const RECENT: never[] = []

export default function WelcomeScreen() {
  const { setScreen, loadProject, loadFromDisk, toggleTheme, theme, recentProjects } = useStore()
  const [name, setName] = useState('')
  const [board, setBoard] = useState('uno')
  const [template, setTemplate] = useState('blink')
  const [backend, setBackend] = useState('tsuki-flash')
  const [gitInit, setGitInit] = useState(true)
  const [opening, setOpening] = useState(false)

  async function create() {
    const projName = name.trim() || 'my-project'
    setOpening(true)
    try {
      const { pickFolder, isTauri } = await import('@/lib/tauri')

      let projectPath = ''
      if (isTauri()) {
        // In Tauri: ask user where to save the project
        const parentFolder = await pickFolder()
        if (parentFolder) {
          const sep = parentFolder.includes('\\') ? '\\' : '/'
          projectPath = parentFolder + sep + projName
        }
        // If user cancelled the dialog, still create in-memory (projectPath stays '')
      }

      await loadProject(projName, board, template, backend, gitInit, projectPath)
    } catch (e) {
      console.error('Create project:', e)
      // Any error → fallback to in-memory
      await loadProject(name.trim() || 'my-project', board, template, backend, gitInit, '')
    }
    setOpening(false)
  }

  async function openFolder() {
    setOpening(true)
    try {
      const { pickFolder, isTauri } = await import('@/lib/tauri')
      if (!isTauri()) {
        console.error('[tsuki-ide] openFolder: no estamos en Tauri')
        setOpening(false)
        return
      }
      const folder = await pickFolder()
      if (!folder) { setOpening(false); return }
      await loadFromDisk(folder)
    } catch (e) {
      console.error('[tsuki-ide] openFolder error:', e)
    }
    setOpening(false)
  }

  const selectedBoard   = BOARDS.find(b => b.id === board)
  const selectedBackend = BACKENDS.find(b => b.id === backend)

  return (
    <div className="h-screen flex flex-col bg-[var(--surface)] text-[var(--fg)]">
      {/* Titlebar */}
      <div className="h-11 flex items-center px-5 border-b border-[var(--border)] flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded bg-[var(--fg)] flex items-center justify-center">
            <span className="text-[var(--surface)] font-mono font-bold text-[10px] leading-none">G</span>
          </div>
          <span className="font-semibold text-sm tracking-tight">GoDotIno</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Btn variant="ghost" size="xs" onClick={toggleTheme} className="font-mono text-[10px]">
            {theme === 'dark' ? '◐' : '○'}
          </Btn>
          <Btn variant="ghost" size="xs" onClick={() => setScreen('settings')}>
            <Settings size={13} />
          </Btn>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex items-center justify-center px-8 overflow-auto">
        <div className="w-full max-w-[900px] flex gap-12 items-start py-8">

          {/* Left */}
          <div className="flex-1 min-w-0 animate-fade-up">
            <h1 className="text-2xl font-semibold tracking-tight mb-1.5">GoDotIno IDE</h1>
            <p className="text-sm text-[var(--fg-muted)] mb-8">
              Write in Go · Compile to C++ · Flash to Arduino
            </p>

            {/* Actions */}
            <div className="flex flex-col gap-1.5 mb-8">
              <button
                onClick={() => document.getElementById('qc-name')?.focus()}
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-md bg-[var(--fg)] text-[var(--accent-inv)] text-sm font-semibold hover:opacity-85 transition-opacity cursor-pointer border-0"
              >
                <Plus size={14} />
                New Project
              </button>
              <button
                onClick={openFolder}
                disabled={opening}
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-md border border-[var(--border)] text-sm font-medium text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer bg-transparent disabled:opacity-50"
              >
                <FolderOpen size={14} />
                {opening ? 'Opening…' : 'Open Folder'}
              </button>
              <button
                onClick={() => setScreen('settings')}
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-md border border-[var(--border)] text-sm font-medium text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer bg-transparent"
              >
                <Settings size={14} />
                Settings &amp; CLI Config
              </button>
            </div>

            {/* Recent */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Clock size={11} className="text-[var(--fg-faint)]" />
                <span className="text-2xs font-semibold text-[var(--fg-faint)] uppercase tracking-widest">Recent</span>
              </div>
              <div className="flex flex-col">
                {recentProjects.length === 0 && (
                  <p className="text-xs text-[var(--fg-faint)] px-2">No recent projects yet.</p>
                )}
                {recentProjects.map(r => (
                  <button
                    key={r.path}
                    onClick={() => loadFromDisk(r.path)}
                    className="flex items-center gap-3 px-2.5 py-2 rounded-md hover:bg-[var(--hover)] transition-colors cursor-pointer border-0 bg-transparent text-left group"
                  >
                    <div className="w-7 h-7 rounded border border-[var(--border)] flex items-center justify-center text-[var(--fg-faint)] flex-shrink-0">
                      <span className="font-mono text-[10px] font-bold">go</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--fg)] truncate">{r.name}</div>
                      <div className="text-xs text-[var(--fg-faint)] truncate font-mono">{r.path}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs font-mono text-[var(--fg-muted)] border border-[var(--border)] rounded px-1.5 py-0.5">
                        {r.board}
                      </span>
                      <ChevronRight size={12} className="text-[var(--fg-faint)] opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right — Quick create */}
          <div className="w-[300px] flex-shrink-0 animate-fade-up" style={{ animationDelay: '50ms' }}>
            <div className="border border-[var(--border)] rounded-xl bg-[var(--surface-1)] p-5">
              <h2 className="text-sm font-semibold mb-4">Quick Create</h2>

              <div className="flex flex-col gap-3">
                {/* Step 1: Name */}
                <div>
                  <label className="text-xs text-[var(--fg-muted)] font-medium block mb-1.5">
                    <span className="text-[var(--fg-faint)] font-mono mr-1">1.</span>
                    Project name
                  </label>
                  <Input
                    id="qc-name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="my-tsuki-project"
                    onKeyDown={e => e.key === 'Enter' && create()}
                  />
                </div>

                {/* Step 2: Board */}
                <div>
                  <label className="text-xs text-[var(--fg-muted)] font-medium block mb-1.5">
                    <span className="text-[var(--fg-faint)] font-mono mr-1">2.</span>
                    Target board
                  </label>
                  <Select value={board} onChange={e => setBoard(e.target.value)}>
                    {BOARDS.map(b => (
                      <option key={b.id} value={b.id}>{b.label}</option>
                    ))}
                  </Select>
                  {selectedBoard && (
                    <div className="text-2xs text-[var(--fg-faint)] mt-1 font-mono">{selectedBoard.note}</div>
                  )}
                </div>

                {/* Step 3: Backend */}
                <div>
                  <label className="text-xs text-[var(--fg-muted)] font-medium block mb-1.5">
                    <span className="text-[var(--fg-faint)] font-mono mr-1">3.</span>
                    Compiler backend
                  </label>
                  <Select value={backend} onChange={e => setBackend(e.target.value)}>
                    {BACKENDS.map(b => (
                      <option key={b.id} value={b.id}>{b.label}</option>
                    ))}
                  </Select>
                  {selectedBackend && (
                    <div className="text-2xs text-[var(--fg-faint)] mt-1 font-mono">{selectedBackend.note}</div>
                  )}
                </div>

                {/* Step 4: Template */}
                <div>
                  <label className="text-xs text-[var(--fg-muted)] font-medium block mb-1.5">
                    <span className="text-[var(--fg-faint)] font-mono mr-1">4.</span>
                    Starter template
                  </label>
                  <Select value={template} onChange={e => setTemplate(e.target.value)}>
                    {TEMPLATES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </Select>
                </div>

                {/* Step 5: Git init */}
                <div>
                  <label className="text-xs text-[var(--fg-muted)] font-medium block mb-1.5">
                    <span className="text-[var(--fg-faint)] font-mono mr-1">5.</span>
                    Git repository
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setGitInit(true)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded border text-xs font-medium transition-colors cursor-pointer ${
                        gitInit
                          ? 'border-[var(--fg)] bg-[var(--hover)] text-[var(--fg)]'
                          : 'border-[var(--border)] text-[var(--fg-muted)] bg-transparent hover:bg-[var(--hover)]'
                      }`}
                    >
                      <GitBranch size={11} /> Yes
                    </button>
                    <button
                      onClick={() => setGitInit(false)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded border text-xs font-medium transition-colors cursor-pointer ${
                        !gitInit
                          ? 'border-[var(--fg)] bg-[var(--hover)] text-[var(--fg)]'
                          : 'border-[var(--border)] text-[var(--fg-muted)] bg-transparent hover:bg-[var(--hover)]'
                      }`}
                    >
                      No
                    </button>
                  </div>
                </div>

                <Divider />

                <button
                  onClick={create}
                  disabled={opening}
                  className="w-full py-2 bg-[var(--fg)] text-[var(--accent-inv)] rounded-md text-sm font-semibold hover:opacity-80 transition-opacity cursor-pointer border-0 disabled:opacity-50"
                >
                  {opening ? 'Creating…' : 'Create & Open'}
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Footer */}
      <div className="h-8 flex items-center px-5 border-t border-[var(--border)] flex-shrink-0">
        <span className="text-xs text-[var(--fg-faint)] font-mono">v0.1.0</span>
        <span className="ml-auto text-xs text-[var(--fg-faint)]">Tauri · Next.js · Go</span>
      </div>
    </div>
  )
}