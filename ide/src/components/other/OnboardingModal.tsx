'use client'
import { useState, useEffect } from 'react'
import { useStore } from '@/lib/store'
import {
  X, ChevronRight, ChevronLeft, Check, Cpu, Terminal,
  Zap, FolderOpen, RefreshCw, SkipForward, Play,
} from 'lucide-react'
import { clsx } from 'clsx'

// ── Types ─────────────────────────────────────────────────────────────────────

type StepId = 'welcome' | 'usage' | 'cli' | 'board' | 'first-project'

interface Step {
  id: StepId
  title: string
  subtitle: string
  icon: React.ReactNode
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    title: 'Welcome to tsuki',
    subtitle: 'A quick guide to get you up and running',
    icon: <span className="text-3xl">🚀</span>,
  },
  {
    id: 'usage',
    title: 'How will you use tsuki?',
    subtitle: 'Personal use is free · Professional use requires a license',
    icon: <span className="text-3xl">🏷️</span>,
  },
  {
    id: 'cli',
    title: 'Set up the CLI',
    subtitle: 'Tell the IDE where your tsuki binary lives',
    icon: <Terminal size={28} className="text-[var(--fg-muted)]" />,
  },
  {
    id: 'board',
    title: 'Choose your default board',
    subtitle: 'Pick the Arduino board you use most often',
    icon: <Cpu size={28} className="text-[var(--fg-muted)]" />,
  },
  {
    id: 'first-project',
    title: 'Your first project',
    subtitle: 'Create a Blink sketch to make sure everything works',
    icon: <Play size={28} className="text-[var(--fg-muted)]" />,
  },
]

const COMMON_BOARDS = [
  { id: 'uno',     label: 'Arduino Uno',   note: 'ATmega328P · most common' },
  { id: 'nano',    label: 'Arduino Nano',  note: 'ATmega328P · compact' },
  { id: 'mega',    label: 'Arduino Mega',  note: 'ATmega2560 · many pins' },
  { id: 'esp32',   label: 'ESP32',         note: 'Dual-core · WiFi + BT' },
  { id: 'esp8266', label: 'ESP8266',       note: '80 MHz · WiFi' },
  { id: 'pico',    label: 'Raspberry Pi Pico', note: 'RP2040 · 133 MHz' },
]

// Simple license format: TSUKI-XXXX-XXXX-XXXX  (pre-issued closed-beta key)
// In production this would hit a validation endpoint.
const VALID_LICENSE_REGEX = /^TSUKI-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/

function normalizeLicense(raw: string) {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function OnboardingModal({ onClose }: { onClose: () => void }) {
  const { settings, updateSetting, loadProject } = useStore()
  const [stepIdx,     setStepIdx]     = useState(0)
  const [detecting,   setDetecting]   = useState(false)
  const [detected,    setDetected]    = useState<'ok' | 'fail' | null>(null)
  const [board,       setBoard]       = useState(settings.defaultBoard ?? 'uno')
  const [creating,    setCreating]    = useState(false)
  const [created,     setCreated]     = useState(false)
  // Usage & license state
  const [usageType,   setUsageType]   = useState<'personal' | 'professional' | null>(null)
  const [licenseKey,  setLicenseKey]  = useState('')
  const [licenseErr,  setLicenseErr]  = useState('')
  const [licenseOk,   setLicenseOk]   = useState(false)

  const step    = STEPS[stepIdx]
  const isFirst = stepIdx === 0
  const isLast  = stepIdx === STEPS.length - 1

  // ESC to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function detectCli() {
    setDetecting(true)
    setDetected(null)
    try {
      const { detectTool } = await import('@/lib/tauri')
      const path = await detectTool('tsuki')
      updateSetting('tsukiPath', path)
      setDetected('ok')
    } catch {
      setDetected('fail')
    }
    setDetecting(false)
  }

  async function createFirstProject() {
    setCreating(true)
    try {
      await loadProject('blink-demo', board, 'blink', 'tsuki-flash', false, '', 'go')
      setCreated(true)
      setTimeout(() => onClose(), 1200)
    } catch {
      setCreating(false)
    }
  }

  function validateLicense(): boolean {
    if (usageType !== 'professional') return true
    const norm = normalizeLicense(licenseKey)
    if (!norm) { setLicenseErr('Please enter your license key.'); return false }
    if (!VALID_LICENSE_REGEX.test(norm)) {
      setLicenseErr('Invalid format. Expected: TSUKI-XXXX-XXXX-XXXX')
      return false
    }
    setLicenseErr('')
    setLicenseOk(true)
    return true
  }

  function next() {
    if (step.id === 'usage') {
      if (!usageType) return          // must pick one
      if (!validateLicense()) return  // pro must have valid key
    }
    if (isLast) { onClose(); return }
    setStepIdx(i => i + 1)
  }

  function prev() {
    if (!isFirst) setStepIdx(i => i - 1)
  }

  const progressPct = ((stepIdx + 1) / STEPS.length) * 100

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="relative w-[520px] max-w-[95vw] rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] shadow-2xl overflow-hidden flex flex-col animate-fade-up"
        style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.5)', maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-0 flex-shrink-0">
          <div className="flex items-center gap-3">
            {/* Step dots */}
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setStepIdx(i)}
                className={clsx(
                  'rounded-full transition-all cursor-pointer border-0 bg-transparent p-0',
                  i === stepIdx
                    ? 'w-5 h-2 bg-[var(--fg)]'
                    : i < stepIdx
                      ? 'w-2 h-2 bg-green-400/70'
                      : 'w-2 h-2 bg-[var(--border)]',
                )}
                title={s.title}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer border-0 bg-transparent"
            >
              <SkipForward size={11} />
              Skip tutorial
            </button>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer border-0 bg-transparent"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mx-6 mt-4 h-[2px] rounded-full overflow-hidden bg-[var(--border)]">
          <div
            className="h-full rounded-full bg-[var(--fg)] transition-all duration-400"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Content */}
        <div className="flex-1 px-6 py-7 overflow-y-auto">
          {/* Step header */}
          <div className="flex items-start gap-4 mb-7">
            <div className="w-14 h-14 rounded-xl border border-[var(--border)] bg-[var(--surface)] flex items-center justify-center flex-shrink-0">
              {step.icon}
            </div>
            <div>
              <div className="text-xs font-mono text-[var(--fg-faint)] uppercase tracking-widest mb-1">
                Step {stepIdx + 1} of {STEPS.length}
              </div>
              <h2 className="text-xl font-semibold tracking-tight text-[var(--fg)] leading-tight">
                {step.title}
              </h2>
              <p className="text-sm text-[var(--fg-muted)] mt-1">{step.subtitle}</p>
            </div>
          </div>

          {/* Step-specific content */}
          {step.id === 'welcome'       && <WelcomeStep />}
          {step.id === 'usage'         && (
            <UsageStep
              usageType={usageType}
              onSelectUsage={t => { setUsageType(t); setLicenseErr(''); setLicenseOk(false) }}
              licenseKey={licenseKey}
              onLicenseChange={v => { setLicenseKey(v); setLicenseErr(''); setLicenseOk(false) }}
              licenseErr={licenseErr}
              licenseOk={licenseOk}
            />
          )}
          {step.id === 'cli'           && (
            <CliStep
              detecting={detecting}
              detected={detected}
              tsukiPath={settings.tsukiPath}
              onDetect={detectCli}
              onPathChange={v => updateSetting('tsukiPath', v)}
            />
          )}
          {step.id === 'board'         && (
            <BoardStep board={board} onSelect={b => { setBoard(b); updateSetting('defaultBoard', b) }} />
          )}
          {step.id === 'first-project' && (
            <FirstProjectStep
              board={board}
              creating={creating}
              created={created}
              onCreate={createFirstProject}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border)] flex-shrink-0 bg-[var(--surface)]">
          <button
            onClick={prev}
            disabled={isFirst}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded border border-[var(--border)] text-sm text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer bg-transparent disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={13} /> Back
          </button>

          {!isLast ? (
            <button
              onClick={next}
              disabled={step.id === 'usage' && (!usageType || (usageType === 'professional' && !licenseOk && !VALID_LICENSE_REGEX.test(normalizeLicense(licenseKey))))}
              className="flex items-center gap-1.5 px-5 py-1.5 rounded text-sm font-semibold bg-[var(--fg)] text-[var(--surface)] hover:opacity-80 transition-opacity cursor-pointer border-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next <ChevronRight size={13} />
            </button>
          ) : (
            <button
              onClick={created ? onClose : createFirstProject}
              disabled={creating}
              className={clsx(
                'flex items-center gap-1.5 px-5 py-1.5 rounded text-sm font-semibold transition-all cursor-pointer border-0 disabled:opacity-50',
                created
                  ? 'bg-green-600 text-white hover:bg-green-500'
                  : 'bg-[var(--fg)] text-[var(--surface)] hover:opacity-80',
              )}
            >
              {creating ? (
                <><span className="animate-spin inline-block">⟳</span> Creating…</>
              ) : created ? (
                <><Check size={13} /> Done!</>
              ) : (
                <><Play size={13} /> Create & Open</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Step panels ───────────────────────────────────────────────────────────────


function UsageStep({
  usageType, onSelectUsage, licenseKey, onLicenseChange, licenseErr, licenseOk,
}: {
  usageType: 'personal' | 'professional' | null
  onSelectUsage: (t: 'personal' | 'professional') => void
  licenseKey: string
  onLicenseChange: (v: string) => void
  licenseErr: string
  licenseOk: boolean
}) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
        tsuki is <strong className="text-[var(--fg)]">free for personal use</strong>. Professional use in a commercial context requires a license key.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => onSelectUsage('personal')}
          className={clsx(
            'flex flex-col items-start gap-2 px-4 py-4 rounded-xl border text-left transition-all cursor-pointer bg-transparent',
            usageType === 'personal'
              ? 'border-[var(--fg-muted)] bg-[var(--active)]'
              : 'border-[var(--border)] hover:border-[var(--fg-faint)] hover:bg-[var(--hover)]',
          )}
        >
          <div className="flex items-center justify-between w-full">
            <span className="text-2xl">👤</span>
            {usageType === 'personal' && <Check size={14} className="text-green-400" />}
          </div>
          <div>
            <div className="text-sm font-semibold text-[var(--fg)]">Personal</div>
            <div className="text-xs text-[var(--fg-faint)] mt-0.5">Hobby projects, learning, open-source</div>
          </div>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-green-400/15 text-green-400">Free</span>
        </button>

        <button
          onClick={() => onSelectUsage('professional')}
          className={clsx(
            'flex flex-col items-start gap-2 px-4 py-4 rounded-xl border text-left transition-all cursor-pointer bg-transparent',
            usageType === 'professional'
              ? 'border-[var(--fg-muted)] bg-[var(--active)]'
              : 'border-[var(--border)] hover:border-[var(--fg-faint)] hover:bg-[var(--hover)]',
          )}
        >
          <div className="flex items-center justify-between w-full">
            <span className="text-2xl">🏢</span>
            {usageType === 'professional' && licenseOk && <Check size={14} className="text-green-400" />}
          </div>
          <div>
            <div className="text-sm font-semibold text-[var(--fg)]">Professional</div>
            <div className="text-xs text-[var(--fg-faint)] mt-0.5">Commercial products, client work, teams</div>
          </div>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-purple-400/15 text-purple-400">License required</span>
        </button>
      </div>

      {usageType === 'professional' && (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-widest">License key</label>
          <div className="relative">
            <input
              type="text"
              value={licenseKey}
              onChange={e => onLicenseChange(e.target.value)}
              placeholder="TSUKI-XXXX-XXXX-XXXX"
              spellCheck={false}
              className={clsx(
                'w-full px-3 py-2 rounded-lg border font-mono text-sm text-[var(--fg)] bg-[var(--surface)] outline-none transition-colors placeholder:text-[var(--fg-faint)]',
                licenseOk
                  ? 'border-green-400/60'
                  : licenseErr
                    ? 'border-red-400/60'
                    : 'border-[var(--border)] focus:border-[var(--fg-faint)]',
              )}
            />
            {licenseOk && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Check size={14} className="text-green-400" />
              </div>
            )}
          </div>
          {licenseErr && <p className="text-xs text-red-400">{licenseErr}</p>}
          {licenseOk && (
            <p className="text-xs text-green-400 flex items-center gap-1">
              <Check size={11} /> License verified — thank you!
            </p>
          )}
          <p className="text-xs text-[var(--fg-faint)] leading-relaxed">
            {"Don't have a license? Visit "}
            <a href="https://tsuki.dev/pro" target="_blank" rel="noreferrer"
              className="underline text-[var(--fg-muted)] hover:text-[var(--fg)]">tsuki.dev/pro</a>
            {" or "}
            <button onClick={() => onSelectUsage('personal')}
              className="underline text-[var(--fg-muted)] hover:text-[var(--fg)] cursor-pointer border-0 bg-transparent p-0 text-xs">
              switch to personal use
            </button>.
          </p>
        </div>
      )}

      {usageType === 'personal' && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[var(--surface-1)] border border-[var(--border)]">
          <span className="text-base leading-none mt-0.5">✅</span>
          <p className="text-xs text-[var(--fg-muted)] leading-relaxed">
            Personal use is completely free — no registration needed. You can upgrade to a professional license anytime.
          </p>
        </div>
      )}
    </div>
  )
}

function WelcomeStep() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
        tsuki lets you write Arduino firmware in <strong className="text-[var(--fg)]">Go</strong>. The IDE handles transpiling your code to C++, compiling it, and flashing it to your board — all in one place.
      </p>

      <div className="grid grid-cols-3 gap-3 mt-2">
        {[
          { icon: '✍️', title: 'Write Go', desc: 'Familiar Go syntax for firmware' },
          { icon: '⚡', title: 'Build', desc: 'Transpile + compile in one step' },
          { icon: '📡', title: 'Flash', desc: 'Upload directly to your Arduino' },
        ].map(item => (
          <div
            key={item.title}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-center"
          >
            <div className="text-2xl mb-2">{item.icon}</div>
            <div className="text-xs font-semibold text-[var(--fg)] mb-0.5">{item.title}</div>
            <div className="text-[10px] text-[var(--fg-faint)]">{item.desc}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div className="text-xs font-mono text-[var(--fg-faint)] mb-2 uppercase tracking-widest">Quick example</div>
        <pre className="text-xs font-mono text-[var(--fg-muted)] leading-relaxed overflow-x-auto">{`package main

import "arduino"

func setup() {
    arduino.PinMode(13, arduino.OUTPUT)
}

func loop() {
    arduino.DigitalWrite(13, arduino.HIGH)
    arduino.Delay(500)
    arduino.DigitalWrite(13, arduino.LOW)
    arduino.Delay(500)
}`}</pre>
      </div>

      <p className="text-xs text-[var(--fg-faint)]">
        This tutorial will walk you through the essential setup steps. You can skip at any time and come back to Settings later.
      </p>
    </div>
  )
}

function CliStep({
  detecting, detected, tsukiPath, onDetect, onPathChange,
}: {
  detecting: boolean
  detected: 'ok' | 'fail' | null
  tsukiPath: string
  onDetect: () => void
  onPathChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
        The IDE needs to know where the <code className="font-mono text-[var(--fg)] bg-[var(--surface-3)] px-1 rounded text-xs">tsuki</code> CLI binary is installed. Click <strong className="text-[var(--fg)]">Auto-detect</strong> and it will search your PATH automatically.
      </p>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={tsukiPath}
            onChange={e => onPathChange(e.target.value)}
            placeholder="/usr/local/bin/tsuki  or  C:\tsuki\tsuki.exe"
            className="flex-1 px-3 py-1.5 rounded border border-[var(--border)] bg-[var(--surface-1)] text-sm font-mono text-[var(--fg)] outline-none focus:border-[var(--fg-faint)] transition-colors placeholder:text-[var(--fg-faint)]"
          />
          <button
            onClick={onDetect}
            disabled={detecting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border)] text-sm text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer bg-transparent disabled:opacity-50 flex-shrink-0"
          >
            {detecting
              ? <RefreshCw size={12} className="animate-spin" />
              : <Zap size={12} />}
            Auto-detect
          </button>
        </div>

        {detected === 'ok' && (
          <div className="flex items-center gap-2 text-green-400 text-sm">
            <Check size={14} />
            <span>Found! Path saved automatically.</span>
          </div>
        )}
        {detected === 'fail' && (
          <div className="text-sm text-[var(--fg-muted)] leading-relaxed">
            <span className="text-yellow-400 font-medium">Not found in PATH.</span>{' '}
            Paste the full path to the binary above, or install tsuki first using the{' '}
            <a href="https://github.com/tsuki" target="_blank" rel="noreferrer" className="underline text-[var(--fg-muted)] hover:text-[var(--fg)]">
              installation guide
            </a>.
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3">
        <div className="text-xs font-semibold text-[var(--fg-faint)] uppercase tracking-widest mb-2">Don't have tsuki yet?</div>
        <div className="flex flex-col gap-1.5 text-xs font-mono text-[var(--fg-muted)]">
          <div><span className="text-[var(--fg-faint)]"># macOS / Linux</span></div>
          <div className="bg-[var(--surface-3)] rounded px-2 py-1">curl -fsSL https://tsuki.dev/install | sh</div>
          <div className="mt-1"><span className="text-[var(--fg-faint)]"># Windows (PowerShell)</span></div>
          <div className="bg-[var(--surface-3)] rounded px-2 py-1">winget install tsuki</div>
        </div>
      </div>

      <p className="text-xs text-[var(--fg-faint)]">
        You can always update the path later in <strong>Settings → CLI Tools</strong>.
      </p>
    </div>
  )
}

function BoardStep({ board, onSelect }: { board: string; onSelect: (b: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
        Select the Arduino board you use most often. This becomes the default for new projects — you can always change it per-project.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {COMMON_BOARDS.map(b => (
          <button
            key={b.id}
            onClick={() => onSelect(b.id)}
            className={clsx(
              'px-3 py-2.5 rounded-lg border text-left transition-all cursor-pointer bg-transparent',
              board === b.id
                ? 'border-[var(--fg-muted)] bg-[var(--active)]'
                : 'border-[var(--border)] hover:border-[var(--fg-faint)] hover:bg-[var(--hover)]',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-[var(--fg)]">{b.label}</span>
              {board === b.id && <Check size={12} className="text-green-400 flex-shrink-0" />}
            </div>
            <p className="text-[10px] text-[var(--fg-faint)] mt-0.5 font-mono">{b.note}</p>
          </button>
        ))}
      </div>
      <p className="text-xs text-[var(--fg-faint)]">
        Not sure? Go with <strong className="text-[var(--fg-muted)]">Arduino Uno</strong> — it's the most common board for beginners.
      </p>
    </div>
  )
}

function FirstProjectStep({
  board, creating, created, onCreate,
}: {
  board: string
  creating: boolean
  created: boolean
  onCreate: () => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
        Let's create a <strong className="text-[var(--fg)]">Blink</strong> project — the classic "Hello World" of Arduino. It makes the built-in LED blink every 500 ms.
      </p>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between text-xs text-[var(--fg-faint)]">
          <span className="uppercase tracking-widest font-semibold">Project details</span>
        </div>
        <div className="flex flex-col gap-2">
          {[
            { label: 'Name',     value: 'blink-demo' },
            { label: 'Board',    value: board },
            { label: 'Language', value: 'Go ✦' },
            { label: 'Template', value: 'Blink (LED)' },
            { label: 'Backend',  value: 'tsuki-flash' },
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between py-1 border-b border-[var(--border-subtle)] last:border-0">
              <span className="text-xs text-[var(--fg-faint)]">{row.label}</span>
              <span className="text-xs font-mono text-[var(--fg-muted)]">{row.value}</span>
            </div>
          ))}
        </div>
      </div>

      {created ? (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-green-400/30 bg-green-400/5 text-green-400">
          <Check size={16} />
          <span className="text-sm font-medium">Project created! Opening the IDE…</span>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3">
          <p className="text-xs text-[var(--fg-muted)] leading-relaxed">
            The project will open in the IDE where you can edit the code, build it with <strong className="text-[var(--fg)] font-mono">Build</strong>, and flash it to your board with <strong className="text-[var(--fg)] font-mono">Flash</strong>.
          </p>
        </div>
      )}

      <p className="text-xs text-[var(--fg-faint)]">
        This is an in-memory project — connect a real folder via <strong>New Project</strong> to save to disk.
      </p>
    </div>
  )
}