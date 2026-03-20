'use client'
import { useState, useEffect, useRef } from 'react'
import { useStore } from '@/lib/store'
import { Input } from '@/components/shared/primitives'
import {
  X, FolderOpen, GitBranch, ChevronRight, Check,
  Cpu, Wrench, FileCode, Folder, Code2,
} from 'lucide-react'
import { clsx } from 'clsx'
import { pickFolder, isTauri } from '@/lib/tauri'
import TsukiLogo from '@/components/shared/TsukiLogo'

// ── Data ──────────────────────────────────────────────────────────────────────

const LANGUAGES = [
  {
    id: 'go',
    label: 'Go  \u2746',
    desc: 'Statically typed \u00b7 tsuki transpiles Go \u2192 C++ automatically.',
    badge: 'recommended' as const,
  },
  {
    id: 'python',
    label: 'Python 🐍',
    desc: 'Dynamic \u00b7 readable \u00b7 tsuki transpiles Python \u2192 C++ automatically.',
    badge: null,
  },
  {
    id: 'cpp',
    label: 'C++',
    desc: 'Native Arduino C++ with #include <Arduino.h> \u2014 full control, no transpilation.',
    badge: null,
  },
  {
    id: 'ino',
    label: 'Arduino (.ino)',
    desc: 'Classic .ino sketch \u2014 beginner-friendly, identical to the Arduino IDE.',
    badge: null,
  },
]

const BOARDS = [
  { id: 'uno',          label: 'Arduino Uno',        note: 'ATmega328P · 16 MHz · 32 KB' },
  { id: 'nano',         label: 'Arduino Nano',        note: 'ATmega328P · 16 MHz · compact' },
  { id: 'mega',         label: 'Arduino Mega 2560',   note: 'ATmega2560 · 16 MHz · 256 KB' },
  { id: 'leonardo',     label: 'Arduino Leonardo',    note: 'ATmega32u4 · 16 MHz · native USB' },
  { id: 'micro',        label: 'Arduino Micro',       note: 'ATmega32u4 · 16 MHz · native USB' },
  { id: 'pro_mini_5v',  label: 'Pro Mini 5 V',        note: 'ATmega328P · 16 MHz · breadboard' },
  { id: 'esp32',        label: 'ESP32 Dev Module',    note: 'Dual-core · 240 MHz · WiFi + BT' },
  { id: 'esp8266',      label: 'ESP8266 Generic',     note: 'Single-core · 80 MHz · WiFi' },
  { id: 'd1_mini',      label: 'Wemos D1 Mini',       note: 'ESP8266 · compact · popular' },
  { id: 'pico',          label: 'Raspberry Pi Pico',   note: 'RP2040 · 133 MHz · 2 MB' },
  { id: 'xiao_rp2040',  label: 'Seeed XIAO RP2040',   note: 'RP2040 · 133 MHz · 2 MB · tiny', badge: 'new' as const },
]

const BACKENDS = [
  { id: 'tsuki-flash',       label: 'tsuki-flash',         note: 'fast \u00b7 parallel \u00b7 recommended \u2746',        badge: 'recommended' as const },
  { id: 'tsuki-flash+cores', label: 'tsuki-flash + cores', note: 'fully standalone \u00b7 downloads SDK',        badge: 'standalone'  as const },
  { id: 'arduino-cli',       label: 'arduino-cli',         note: 'classic \u00b7 requires arduino-cli install',  badge: null },
]

type TemplateGroup = 'basic' | 'packages'
type TemplateItem = { id: string; label: string; desc: string; icon: string; group?: TemplateGroup; requires?: string[] }

const TEMPLATES_GO: TemplateItem[] = [
  { id: 'blink',   label: 'Blink (LED)',    desc: 'Toggle LED_BUILTIN every 500 ms using arduino.DigitalWrite.',       icon: '💡', group: 'basic'    },
  { id: 'serial',  label: 'Serial Hello',   desc: 'Print "Hello from tsuki!" over serial every second.',               icon: '📡', group: 'basic'    },
  { id: 'empty',   label: 'Empty project',  desc: 'Blank setup() + loop() — start from scratch.',                     icon: '📄', group: 'basic'    },
  { id: 'dht',     label: 'DHT22 sensor',   desc: 'Read temperature & humidity. Requires dht package.',                icon: '🌡️', group: 'packages', requires: ['dht']     },
  { id: 'ws2812',  label: 'WS2812 LEDs',    desc: 'NeoPixel / WS2812 LED strip control. Requires ws2812 package.',    icon: '🌈', group: 'packages', requires: ['ws2812']  },
  { id: 'mpu6050', label: 'MPU-6050 IMU',   desc: 'Accelerometer + gyroscope over I2C. Requires mpu6050 package.',    icon: '🎯', group: 'packages', requires: ['mpu6050'] },
  { id: 'servo',   label: 'Servo sweep',    desc: 'Sweep a servo 0→180°. Requires Servo package.',                    icon: '⚙️', group: 'packages', requires: ['Servo']   },
]

const TEMPLATES_CPP: TemplateItem[] = [
  { id: 'blink',  label: 'Blink (LED)',   desc: 'Native C++ blink with digitalWrite() and delay().',        icon: '💡', group: 'basic' },
  { id: 'serial', label: 'Serial Hello',  desc: 'Native C++ Serial.println() hello world.',                  icon: '📡', group: 'basic' },
  { id: 'empty',  label: 'Empty project', desc: '#include <Arduino.h> with empty setup/loop.',               icon: '📄', group: 'basic' },
]

const TEMPLATES_INO: TemplateItem[] = [
  { id: 'blink',  label: 'Blink (LED)',   desc: 'Classic Arduino blink .ino sketch.',                        icon: '💡', group: 'basic' },
  { id: 'serial', label: 'Serial Hello',  desc: 'Hello world over Serial — classic Arduino style.',          icon: '📡', group: 'basic' },
  { id: 'empty',  label: 'Empty project', desc: 'Blank .ino sketch, ready to fill in.',                      icon: '📄', group: 'basic' },
]

const TEMPLATES_PYTHON: TemplateItem[] = [
  { id: 'blink',  label: 'Blink (LED)',   desc: 'Toggle LED_BUILTIN using arduino.digitalWrite — Python style.', icon: '💡', group: 'basic'    },
  { id: 'serial', label: 'Serial Hello',  desc: 'print() over Serial — maps to Serial.println() in C++.',       icon: '📡', group: 'basic'    },
  { id: 'empty',  label: 'Empty project', desc: 'Blank setup() + loop() — start from scratch.',                 icon: '📄', group: 'basic'    },
  { id: 'dht',    label: 'DHT22 sensor',  desc: 'Read temperature & humidity. Requires dht package.',            icon: '🌡️', group: 'packages', requires: ['dht']    },
  { id: 'ws2812', label: 'WS2812 LEDs',   desc: 'NeoPixel / WS2812 LED strip control. Requires ws2812.',        icon: '🌈', group: 'packages', requires: ['ws2812'] },
]
const TEMPLATES_BY_LANG: Record<string, TemplateItem[]> = {
  go: TEMPLATES_GO, python: TEMPLATES_PYTHON, cpp: TEMPLATES_CPP, ino: TEMPLATES_INO,
}

// ── Step IDs ──────────────────────────────────────────────────────────────────

type StepId = 'name' | 'language' | 'board' | 'backend' | 'template' | 'options'

const STEPS: { id: StepId; label: string; icon: React.ReactNode }[] = [
  { id: 'name',     label: 'Project',  icon: <Folder    size={12} /> },
  { id: 'language', label: 'Language', icon: <Code2     size={12} /> },
  { id: 'board',    label: 'Board',    icon: <Cpu       size={12} /> },
  { id: 'backend',  label: 'Backend',  icon: <Wrench    size={12} /> },
  { id: 'template', label: 'Template', icon: <FileCode  size={12} /> },
  { id: 'options',  label: 'Options',  icon: <GitBranch size={12} /> },
]

// ── RadioCard ─────────────────────────────────────────────────────────────────

function RadioCard({
  selected, onClick, children, className,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full text-left px-3 py-2.5 rounded-lg border transition-all cursor-pointer bg-transparent',
        selected
          ? 'border-[var(--fg-muted)] bg-[var(--active)]'
          : 'border-[var(--border)] hover:border-[var(--fg-faint)] hover:bg-[var(--hover)]',
        className,
      )}
    >
      {children}
    </button>
  )
}

// ── Step panels ───────────────────────────────────────────────────────────────

function StepName({
  name, setName, location, setLocation,
}: {
  name: string; setName: (v: string) => void
  location: string; setLocation: (v: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  async function browse() {
    if (!isTauri()) return
    const folder = await pickFolder()
    if (folder) setLocation(folder)
  }

  const sep      = location.includes('\\') ? '\\' : '/'
  const fullPath = location ? `${location}${sep}${name.trim() || 'my-tsuki-project'}` : ''

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label className="text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-widest block mb-2">
          Project name
        </label>
        <Input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="my-tsuki-project"
          className="text-base"
        />
        <p className="text-xs text-[var(--fg-faint)] mt-1.5">
          Letters, numbers, dashes and underscores only.
        </p>
      </div>
      <div>
        <label className="text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-widest block mb-2">
          Location
        </label>
        <div className="flex gap-2">
          <Input
            value={location}
            onChange={e => setLocation(e.target.value)}
            placeholder={isTauri() ? 'Click Browse to choose a folder…' : '/home/user/projects'}
            className="font-mono text-xs flex-1"
          />
          <button
            onClick={browse}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border)] text-xs text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer bg-transparent flex-shrink-0"
          >
            <FolderOpen size={12} />
            Browse
          </button>
        </div>
        {fullPath && (
          <div className="mt-2 px-2.5 py-1.5 rounded bg-[var(--surface-3)] border border-[var(--border)]">
            <p className="text-[10px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">Full path</p>
            <p className="text-xs font-mono text-[var(--fg-muted)] break-all">{fullPath}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function StepLanguage({
  language, setLanguage,
}: {
  language: string; setLanguage: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-widest block mb-1">
        Programming language
      </label>
      {LANGUAGES.map(l => (
        <RadioCard key={l.id} selected={language === l.id} onClick={() => setLanguage(l.id)}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--fg)] font-mono">{l.label}</span>
              {l.badge && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-green-500/15 text-green-400">
                  {l.badge}
                </span>
              )}
            </div>
            {language === l.id && <Check size={12} className="text-green-400 flex-shrink-0" />}
          </div>
          <p className="text-xs text-[var(--fg-faint)] mt-1">{l.desc}</p>
        </RadioCard>
      ))}
    </div>
  )
}

function StepBoard({ board, setBoard }: { board: string; setBoard: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-widest block mb-1">
        Target board
      </label>
      <div className="grid grid-cols-2 gap-2">
        {BOARDS.map(b => (
          <RadioCard key={b.id} selected={board === b.id} onClick={() => setBoard(b.id)}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-medium text-[var(--fg)] leading-tight">{b.label}</span>
                {'badge' in b && b.badge === 'new' && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-blue-500/15 text-blue-400 leading-none">new</span>
                )}
              </div>
              {board === b.id && <Check size={12} className="text-green-400 flex-shrink-0 mt-0.5" />}
            </div>
            <p className="text-[10px] text-[var(--fg-faint)] mt-0.5 font-mono">{b.note}</p>
          </RadioCard>
        ))}
      </div>
    </div>
  )
}

function StepBackend({ backend, setBackend }: { backend: string; setBackend: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-widest block mb-1">
        Compiler backend
      </label>
      {BACKENDS.map(b => (
        <RadioCard key={b.id} selected={backend === b.id} onClick={() => setBackend(b.id)}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--fg)] font-mono">{b.label}</span>
              {b.badge && (
                <span className={clsx(
                  'text-[10px] px-1.5 py-0.5 rounded font-semibold',
                  b.badge === 'recommended'
                    ? 'bg-green-500/15 text-green-400'
                    : 'bg-purple-500/15 text-purple-400',
                )}>
                  {b.badge}
                </span>
              )}
            </div>
            {backend === b.id && <Check size={12} className="text-green-400 flex-shrink-0" />}
          </div>
          <p className="text-xs text-[var(--fg-faint)] mt-1">{b.note}</p>
        </RadioCard>
      ))}
    </div>
  )
}

function StepTemplate({
  template, setTemplate, templates,
}: {
  template: string
  setTemplate: (v: string) => void
  templates: TemplateItem[]
}) {
  const basic    = templates.filter(t => !t.group || t.group === 'basic')
  const pkgTmpls = templates.filter(t => t.group === 'packages')

  const renderCard = (t: TemplateItem) => (
    <RadioCard key={t.id} selected={template === t.id} onClick={() => setTemplate(t.id)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="text-lg leading-none">{t.icon}</span>
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium text-[var(--fg)]">{t.label}</p>
              {t.requires && t.requires.length > 0 && (
                <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-amber-400/10 text-amber-400 border border-amber-400/20 leading-none flex-shrink-0">
                  pkg
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--fg-faint)] mt-0.5">{t.desc}</p>
            {t.requires && t.requires.length > 0 && (
              <p className="text-[10px] text-amber-400/70 mt-0.5 font-mono">
                requires: {t.requires.join(', ')}
              </p>
            )}
          </div>
        </div>
        {template === t.id && <Check size={12} className="text-green-400 flex-shrink-0" />}
      </div>
    </RadioCard>
  )

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-widest block mb-1">
        Starter template
      </label>
      {basic.map(renderCard)}

      {pkgTmpls.length > 0 && (
        <>
          <div className="flex items-center gap-2 mt-1 mb-0.5">
            <span className="text-[10px] font-semibold text-[var(--fg-faint)] uppercase tracking-widest">Package templates</span>
            <div className="flex-1 h-px bg-[var(--border)]" />
            <span className="text-[9px] text-[var(--fg-faint)] font-mono">auto-adds deps</span>
          </div>
          {pkgTmpls.map(renderCard)}
        </>
      )}
    </div>
  )
}

function StepOptions({
  gitInit, setGitInit, board, useWebkit, setUseWebkit,
}: {
  gitInit: boolean; setGitInit: (v: boolean) => void
  board: string; useWebkit: boolean; setUseWebkit: (v: boolean) => void
}) {
  const isEsp = board === 'esp8266' || board === 'esp32' || board === 'd1_mini'

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-widest block mb-2">
          Git repository
        </label>
        <div className="flex gap-2">
          <RadioCard selected={gitInit} onClick={() => setGitInit(true)} className="flex-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitBranch size={13} className="text-[var(--fg-muted)]" />
                <span className="text-sm font-medium text-[var(--fg)]">Initialize</span>
              </div>
              {gitInit && <Check size={12} className="text-green-400" />}
            </div>
            <p className="text-xs text-[var(--fg-faint)] mt-1">
              Runs <span className="font-mono">git init</span> in the project directory.
            </p>
          </RadioCard>
          <RadioCard selected={!gitInit} onClick={() => setGitInit(false)} className="flex-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--fg)]">Skip</span>
              {!gitInit && <Check size={12} className="text-green-400" />}
            </div>
            <p className="text-xs text-[var(--fg-faint)] mt-1">No git repository.</p>
          </RadioCard>
        </div>
      </div>

      {/* tsuki-webkit question — only for ESP boards */}
      {isEsp && (
        <div>
          <label className="text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-widest block mb-2">
            Web control panel
          </label>
          <div className="flex gap-2">
            <RadioCard selected={useWebkit} onClick={() => setUseWebkit(true)} className="flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">🌐</span>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-[var(--fg)]">Use tsuki-webkit</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-emerald-500/15 text-emerald-400">
                        ESP only
                      </span>
                    </div>
                    <p className="text-xs text-[var(--fg-faint)] mt-0.5">
                      Scaffold an <span className="font-mono">app.jsx</span> web panel — served over WiFi from your board.
                    </p>
                  </div>
                </div>
                {useWebkit && <Check size={12} className="text-green-400 flex-shrink-0" />}
              </div>
            </RadioCard>
            <RadioCard selected={!useWebkit} onClick={() => setUseWebkit(false)} className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--fg)]">Skip</span>
                {!useWebkit && <Check size={12} className="text-green-400" />}
              </div>
              <p className="text-xs text-[var(--fg-faint)] mt-1">Standard project, no web panel.</p>
            </RadioCard>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Summary row ───────────────────────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[var(--border-subtle)] last:border-0">
      <span className="text-xs text-[var(--fg-faint)]">{label}</span>
      <span className="text-xs font-mono text-[var(--fg-muted)]">{value}</span>
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

export interface NewProjectModalProps {
  onClose: () => void
}

export default function NewProjectModal({ onClose }: NewProjectModalProps) {
  const { loadProject } = useStore()

  const [step,      setStep    ] = useState<StepId>('name')
  const [name,      setName    ] = useState('')
  const [location,  setLocation] = useState('')
  const [language,  setLanguage] = useState('go')
  const [board,     setBoard   ] = useState('uno')
  const [backend,   setBackend ] = useState('tsuki-flash')
  const [template,  setTemplate] = useState('blink')
  const [gitInit,   setGitInit ] = useState(true)
  const [useWebkit, setUseWebkit] = useState(false)
  const [creating,  setCreating] = useState(false)
  const [error,     setError   ] = useState('')

  const stepIdx    = STEPS.findIndex(s => s.id === step)
  const isLastStep = stepIdx === STEPS.length - 1

  function handleSetLanguage(lang: string) {
    setLanguage(lang)
    setTemplate('blink')
  }

  const currentTemplates = TEMPLATES_BY_LANG[language] ?? TEMPLATES_GO

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !creating) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, creating])

  function sanitize(s: string) {
    s = s.trim().replace(/ /g, '-')
    return s.replace(/[^a-zA-Z0-9\-_]/g, '') || 'my-tsuki-project'
  }

  function goNext() {
    if (isLastStep) handleCreate()
    else setStep(STEPS[stepIdx + 1].id)
  }

  function goPrev() {
    if (stepIdx > 0) setStep(STEPS[stepIdx - 1].id)
  }

  async function handleCreate() {
    setCreating(true)
    setError('')
    const projName = sanitize(name || 'my-tsuki-project')
    try {
      const sep      = location.includes('\\') ? '\\' : '/'
      const fullPath = location ? `${location}${sep}${projName}` : ''
      await loadProject(projName, board, template, backend, gitInit, fullPath, language)

      // If the template requires packages, open the terminal so the user sees the install progress
      const requires = currentTemplates.find(t => t.id === template)?.requires ?? []
      if (requires.length > 0) {
        const { setBottomTab } = useStore.getState()
        setBottomTab('terminal')
      }

      // Scaffold tsuki-webkit files if requested
      if (useWebkit && fullPath) {
        try {
          const { writeFile } = await import('@/lib/tauri')
          const confJson = JSON.stringify({
            Name: projName, Author: '', Version: '0.1.0',
            Description: '', app: { Entrypoint: 'app.jsx' },
          }, null, 2)
          const appJsx = `import { Api, Json, Serial } from 'tsuki-webkit'

export default function App() {
  return (
    <div className="wk-card">
      <h1>${projName}</h1>
      <p>Your web control panel.</p>
      <div className="wk-row" style="margin-top:12px">
        <button className="wk-btn"
          onClick={() => Api.get('/api/status', d => Serial.log(Json.stringify(d)))}>
          Get Status
        </button>
      </div>
      <div id="__serial_log" className="wk-serial" style="margin-top:12px"></div>
    </div>
  )
}
`
          await writeFile(`${fullPath}${sep}app.jsx`, appJsx)
          await writeFile(`${fullPath}${sep}tsuki-webkit.conf.json`, confJson)
        } catch { /* non-fatal — project already created */ }
      }

      onClose()
    } catch (e: any) {
      setError(String(e?.message ?? e))
      setCreating(false)
    }
  }

  const sep      = location.includes('\\') ? '\\' : '/'
  const fullPath = location
    ? `${location}${sep}${sanitize(name || 'my-tsuki-project')}`
    : sanitize(name || 'my-tsuki-project')

  const langLabel = LANGUAGES.find(l => l.id === language)?.label ?? language

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget && !creating) onClose() }}
    >
      <div
        className="relative flex w-[700px] max-w-[96vw] rounded-xl border border-[var(--border)] bg-[var(--surface-1)] shadow-2xl overflow-hidden"
        style={{ maxHeight: 'min(90vh, 680px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
      >
        {/* ── Left sidebar ── */}
        <div className="w-44 flex-shrink-0 bg-[var(--surface)] border-r border-[var(--border)] flex flex-col py-6 px-3 min-h-0 overflow-y-auto">
          <div className="flex items-center gap-2 px-2 mb-6">
            <TsukiLogo size="xs" />
            <span className="text-sm font-semibold">New project</span>
          </div>

          <div className="flex flex-col gap-0.5">
            {STEPS.map((s, i) => {
              const done    = i < stepIdx
              const current = i === stepIdx
              return (
                <button
                  key={s.id}
                  onClick={() => !creating && setStep(s.id)}
                  disabled={creating}
                  className={clsx(
                    'flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer border-0 bg-transparent text-left',
                    current
                      ? 'bg-[var(--active)] text-[var(--fg)]'
                      : done
                        ? 'text-[var(--fg-muted)] hover:bg-[var(--hover)]'
                        : 'text-[var(--fg-faint)] hover:bg-[var(--hover)]',
                  )}
                >
                  <span className={clsx(
                    'w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0',
                    current
                      ? 'bg-[var(--fg)] text-[var(--surface)]'
                      : done
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-[var(--surface-3)] text-[var(--fg-faint)]',
                  )}>
                    {done ? <Check size={8} /> : i + 1}
                  </span>
                  {s.label}
                </button>
              )
            })}
          </div>

          <div className="mt-auto pt-4">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
              <p className="text-[10px] text-[var(--fg-faint)] uppercase tracking-widest mb-1.5">Summary</p>
              <SummaryRow label="Name"     value={sanitize(name || 'my-tsuki-project')} />
              <SummaryRow label="Lang"     value={langLabel} />
              <SummaryRow label="Board"    value={BOARDS.find(b => b.id === board)?.id ?? board} />
              <SummaryRow label="Backend"  value={backend} />
              <SummaryRow label="Template" value={template} />
              {currentTemplates.find(t => t.id === template)?.requires?.length ? (
                <SummaryRow label="Deps" value={currentTemplates.find(t => t.id === template)!.requires!.join(', ')} />
              ) : null}
              <SummaryRow label="Git"      value={gitInit ? 'yes' : 'no'} />
            </div>
          </div>
        </div>

        {/* ── Right content ── */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] flex-shrink-0">
            <div>
              <h2 className="text-sm font-semibold text-[var(--fg)]">{STEPS[stepIdx].label}</h2>
              <p className="text-xs text-[var(--fg-faint)] mt-0.5">Step {stepIdx + 1} of {STEPS.length}</p>
            </div>
            <button
              onClick={onClose}
              disabled={creating}
              className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer border-0 bg-transparent"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {step === 'name'     && <StepName name={name} setName={setName} location={location} setLocation={setLocation} />}
            {step === 'language' && <StepLanguage language={language} setLanguage={handleSetLanguage} />}
            {step === 'board'    && <StepBoard board={board} setBoard={setBoard} />}
            {step === 'backend'  && <StepBackend backend={backend} setBackend={setBackend} />}
            {step === 'template' && <StepTemplate template={template} setTemplate={setTemplate} templates={currentTemplates} />}
            {step === 'options'  && <StepOptions gitInit={gitInit} setGitInit={setGitInit} board={board} useWebkit={useWebkit} setUseWebkit={setUseWebkit} />}
          </div>

          <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border)] flex-shrink-0 bg-[var(--surface)]">
            {error ? (
              <p className="text-xs text-red-400 flex-1 mr-4 truncate">{error}</p>
            ) : (
              <div className="flex-1 min-w-0 overflow-hidden mr-3">
                {isLastStep && (
                  <div className="text-xs text-[var(--fg-faint)] font-mono truncate">{'→'} {fullPath}</div>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={goPrev}
                disabled={stepIdx === 0 || creating}
                className="px-3.5 py-1.5 rounded border border-[var(--border)] text-sm text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer bg-transparent disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Back
              </button>
              <button
                onClick={goNext}
                disabled={creating}
                className={clsx(
                  'flex items-center gap-1.5 px-4 py-1.5 rounded text-sm font-semibold transition-all cursor-pointer border-0',
                  isLastStep
                    ? 'bg-green-600 hover:bg-green-500 text-white disabled:opacity-50'
                    : 'bg-[var(--fg)] text-[var(--surface)] hover:opacity-80 disabled:opacity-50',
                  'disabled:cursor-not-allowed',
                )}
              >
                {creating ? (
                  <><span className="animate-spin inline-block">{'⟳'}</span> {'Creating…'}</>
                ) : isLastStep ? (
                  <><Check size={13} /> Create Project</>
                ) : (
                  <>Next <ChevronRight size={13} /></>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}