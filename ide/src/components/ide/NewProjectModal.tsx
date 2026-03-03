'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '@/lib/store'
import { Input, Select } from '@/components/ui/primitives'
import {
  X, FolderOpen, GitBranch, ChevronRight, Check,
  Cpu, Wrench, FileCode, Folder,
} from 'lucide-react'
import { clsx } from 'clsx'
import { pickFolder, isTauri } from '@/lib/tauri'

// ── Data mirrors init.go ──────────────────────────────────────────────────────

const BOARDS = [
  { id: 'uno',         label: 'Arduino Uno',        note: 'ATmega328P · 16 MHz · 32 KB' },
  { id: 'nano',        label: 'Arduino Nano',        note: 'ATmega328P · 16 MHz · compact' },
  { id: 'mega',        label: 'Arduino Mega 2560',   note: 'ATmega2560 · 16 MHz · 256 KB' },
  { id: 'leonardo',    label: 'Arduino Leonardo',    note: 'ATmega32u4 · 16 MHz · native USB' },
  { id: 'micro',       label: 'Arduino Micro',       note: 'ATmega32u4 · 16 MHz · native USB' },
  { id: 'pro_mini_5v', label: 'Pro Mini 5 V',        note: 'ATmega328P · 16 MHz · breadboard' },
  { id: 'esp32',       label: 'ESP32 Dev Module',    note: 'Dual-core · 240 MHz · WiFi + BT' },
  { id: 'esp8266',     label: 'ESP8266 Generic',     note: 'Single-core · 80 MHz · WiFi' },
  { id: 'd1_mini',     label: 'Wemos D1 Mini',       note: 'ESP8266 · compact · popular' },
  { id: 'pico',        label: 'Raspberry Pi Pico',   note: 'RP2040 · 133 MHz · 2 MB' },
]

const BACKENDS = [
  { id: 'tsuki-flash',       label: 'tsuki-flash',             note: 'fast · parallel · recommended ✦', badge: 'recommended' },
  { id: 'tsuki-flash+cores', label: 'tsuki-flash + cores',     note: 'fully standalone · downloads SDK', badge: 'standalone' },
  { id: 'arduino-cli',       label: 'arduino-cli',             note: 'classic · requires arduino-cli install', badge: null },
]

const TEMPLATES = [
  {
    id: 'blink',
    label: 'Blink  (LED)',
    desc: 'Classic blink — toggle the built-in LED every 500 ms.',
    icon: '💡',
  },
  {
    id: 'serial',
    label: 'Serial Hello',
    desc: 'Print "Hello from tsuki!" over the serial port every second.',
    icon: '📡',
  },
  {
    id: 'empty',
    label: 'Empty project',
    desc: 'Blank setup() + loop() — start from scratch.',
    icon: '📄',
  },
]

// ── Step IDs ──────────────────────────────────────────────────────────────────

type StepId = 'name' | 'board' | 'backend' | 'template' | 'options'

const STEPS: { id: StepId; label: string; icon: React.ReactNode }[] = [
  { id: 'name',     label: 'Project',  icon: <Folder    size={12} /> },
  { id: 'board',    label: 'Board',    icon: <Cpu       size={12} /> },
  { id: 'backend',  label: 'Backend',  icon: <Wrench    size={12} /> },
  { id: 'template', label: 'Template', icon: <FileCode  size={12} /> },
  { id: 'options',  label: 'Options',  icon: <GitBranch size={12} /> },
]

// ── RadioCard ─────────────────────────────────────────────────────────────────

function RadioCard({
  selected,
  onClick,
  children,
  className,
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

  const sep       = location.includes('\\') ? '\\' : '/'
  const fullPath  = location
    ? `${location}${sep}${name.trim() || 'my-tsuki-project'}`
    : ''

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
              <span className="text-sm font-medium text-[var(--fg)] leading-tight">{b.label}</span>
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

function StepTemplate({ template, setTemplate }: { template: string; setTemplate: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-widest block mb-1">
        Starter template
      </label>
      {TEMPLATES.map(t => (
        <RadioCard key={t.id} selected={template === t.id} onClick={() => setTemplate(t.id)}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="text-lg leading-none">{t.icon}</span>
              <div>
                <p className="text-sm font-medium text-[var(--fg)]">{t.label}</p>
                <p className="text-xs text-[var(--fg-faint)] mt-0.5">{t.desc}</p>
              </div>
            </div>
            {template === t.id && <Check size={12} className="text-green-400 flex-shrink-0" />}
          </div>
        </RadioCard>
      ))}
    </div>
  )
}

function StepOptions({
  gitInit, setGitInit,
}: {
  gitInit: boolean; setGitInit: (v: boolean) => void
}) {
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
            <p className="text-xs text-[var(--fg-faint)] mt-1">Runs <span className="font-mono">git init</span> in the project directory.</p>
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

  const [step,     setStep    ] = useState<StepId>('name')
  const [name,     setName    ] = useState('')
  const [location, setLocation] = useState('')
  const [board,    setBoard   ] = useState('uno')
  const [backend,  setBackend ] = useState('tsuki-flash')
  const [template, setTemplate] = useState('blink')
  const [gitInit,  setGitInit ] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error,    setError   ] = useState('')

  const stepIdx    = STEPS.findIndex(s => s.id === step)
  const isLastStep = stepIdx === STEPS.length - 1

  // Close on Escape
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
    if (isLastStep) {
      handleCreate()
    } else {
      setStep(STEPS[stepIdx + 1].id)
    }
  }

  function goPrev() {
    if (stepIdx > 0) setStep(STEPS[stepIdx - 1].id)
  }

  async function handleCreate() {
    setCreating(true)
    setError('')
    const projName = sanitize(name || 'my-tsuki-project')

    try {
      const sep = location.includes('\\') ? '\\' : '/'
      const fullPath = location ? `${location}${sep}${projName}` : ''
      await loadProject(projName, board, template, backend, gitInit, fullPath)
      onClose()
    } catch (e: any) {
      setError(String(e?.message ?? e))
      setCreating(false)
    }
  }

  // Derived display values for summary
  const sep           = location.includes('\\') ? '\\' : '/'
  const fullPath      = location
    ? `${location}${sep}${sanitize(name || 'my-tsuki-project')}`
    : sanitize(name || 'my-tsuki-project')

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget && !creating) onClose() }}
    >
      {/* Card */}
      <div
        className="relative flex w-[700px] max-w-[96vw] max-h-[90vh] rounded-xl border border-[var(--border)] bg-[var(--surface-1)] shadow-2xl overflow-hidden"
        style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
      >

        {/* ── Left sidebar: steps ── */}
        <div className="w-44 flex-shrink-0 bg-[var(--surface)] border-r border-[var(--border)] flex flex-col py-6 px-3">
          <div className="flex items-center gap-2 px-2 mb-6">
            <div className="w-5 h-5 rounded bg-[var(--fg)] flex items-center justify-center">
              <span className="text-[var(--surface)] font-mono font-bold text-[10px] leading-none">G</span>
            </div>
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

          {/* Summary preview */}
          <div className="mt-auto pt-4">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
              <p className="text-[10px] text-[var(--fg-faint)] uppercase tracking-widest mb-1.5">Summary</p>
              <SummaryRow label="Name"     value={sanitize(name || 'my-tsuki-project')} />
              <SummaryRow label="Board"    value={BOARDS.find(b => b.id === board)?.id ?? board} />
              <SummaryRow label="Backend"  value={backend} />
              <SummaryRow label="Template" value={template} />
              <SummaryRow label="Git"      value={gitInit ? 'yes' : 'no'} />
            </div>
          </div>
        </div>

        {/* ── Right: content ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] flex-shrink-0">
            <div>
              <h2 className="text-sm font-semibold text-[var(--fg)]">
                {STEPS[stepIdx].label}
              </h2>
              <p className="text-xs text-[var(--fg-faint)] mt-0.5">
                Step {stepIdx + 1} of {STEPS.length}
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={creating}
              className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer border-0 bg-transparent"
            >
              <X size={14} />
            </button>
          </div>

          {/* Step content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {step === 'name'     && <StepName     name={name} setName={setName} location={location} setLocation={setLocation} />}
            {step === 'board'    && <StepBoard    board={board} setBoard={setBoard} />}
            {step === 'backend'  && <StepBackend  backend={backend} setBackend={setBackend} />}
            {step === 'template' && <StepTemplate template={template} setTemplate={setTemplate} />}
            {step === 'options'  && <StepOptions  gitInit={gitInit} setGitInit={setGitInit} />}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border)] flex-shrink-0 bg-[var(--surface)]">
            {error && (
              <p className="text-xs text-red-400 flex-1 mr-4 truncate">{error}</p>
            )}
            {!error && (
              <div className="flex-1">
                {isLastStep && (
                  <div className="text-xs text-[var(--fg-faint)] font-mono truncate">
                    → {fullPath}
                  </div>
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
                  <>
                    <span className="animate-spin inline-block">⟳</span>
                    Creating…
                  </>
                ) : isLastStep ? (
                  <>
                    <Check size={13} />
                    Create Project
                  </>
                ) : (
                  <>
                    Next
                    <ChevronRight size={13} />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}