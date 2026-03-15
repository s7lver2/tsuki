'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '@/lib/store'
import {
  X, ChevronRight, ChevronLeft, Check, Cpu, Terminal,
  Zap, FolderOpen, RefreshCw, SkipForward, Play,
  User, Camera, Upload, FileCode, ArrowRight, AlertCircle,
  FolderInput,
} from 'lucide-react'
import { clsx } from 'clsx'

// ── Types ─────────────────────────────────────────────────────────────────────

type StepId = 'welcome' | 'profile' | 'usage' | 'cli' | 'board' | 'import' | 'first-project'

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
    id: 'profile',
    title: 'Set up your profile',
    subtitle: 'Add a name and photo to personalise your workspace',
    icon: <User size={28} className="text-[var(--fg-muted)]" />,
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
    id: 'import',
    title: 'Import an existing project',
    subtitle: 'Convert Arduino IDE, PlatformIO or C++ sketches to tsuki',
    icon: <FolderInput size={28} className="text-[var(--fg-muted)]" />,
  },
  {
    id: 'first-project',
    title: 'Your first project',
    subtitle: 'Create a Blink sketch to make sure everything works',
    icon: <Play size={28} className="text-[var(--fg-muted)]" />,
  },
]

const COMMON_BOARDS = [
  { id: 'uno',     label: 'Arduino Uno',       note: 'ATmega328P · most common' },
  { id: 'nano',    label: 'Arduino Nano',       note: 'ATmega328P · compact' },
  { id: 'mega',    label: 'Arduino Mega',       note: 'ATmega2560 · many pins' },
  { id: 'esp32',   label: 'ESP32',              note: 'Dual-core · WiFi + BT' },
  { id: 'esp8266', label: 'ESP8266',            note: '80 MHz · WiFi' },
  { id: 'pico',    label: 'Raspberry Pi Pico',  note: 'RP2040 · 133 MHz' },
]

const VALID_LICENSE_REGEX = /^TSUKI-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
function normalizeLicense(raw: string) {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

// ── Avatar helpers ─────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')
    || '?'
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function OnboardingModal({ onClose }: { onClose: () => void }) {
  const { settings, updateSetting, loadProject, loadFromDisk, createProfile, profiles } = useStore()
  const [stepIdx,     setStepIdx]     = useState(0)
  const [detecting,   setDetecting]   = useState(false)
  const [detected,    setDetected]    = useState<'ok' | 'fail' | null>(null)
  const [board,       setBoard]       = useState(settings.defaultBoard ?? 'uno')
  const [creating,    setCreating]    = useState(false)
  const [created,     setCreated]     = useState(false)
  // Profile state
  const [username,    setUsername]    = useState(settings.username ?? '')
  const [avatarUrl,   setAvatarUrl]   = useState(settings.avatarDataUrl ?? '')
  // Usage & license state
  const [usageType,   setUsageType]   = useState<'personal' | 'professional' | null>(null)
  const [licenseKey,  setLicenseKey]  = useState('')
  const [licenseErr,  setLicenseErr]  = useState('')
  const [licenseOk,   setLicenseOk]   = useState(false)
  // Import state
  const [importDone,  setImportDone]  = useState(false)

  const step    = STEPS[stepIdx]
  const isFirst = stepIdx === 0
  const isLast  = stepIdx === STEPS.length - 1

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function detectCli() {
    setDetecting(true); setDetected(null)
    try {
      const { detectTool } = await import('@/lib/tauri')
      const path = await detectTool('tsuki')
      updateSetting('tsukiPath', path)
      setDetected('ok')
    } catch { setDetected('fail') }
    setDetecting(false)
  }

  async function createFirstProject() {
    setCreating(true)
    try {
      await loadProject('blink-demo', board, 'blink', 'tsuki-flash', false, '', 'go')
      setCreated(true)
      setTimeout(() => onClose(), 1200)
    } catch { setCreating(false) }
  }

  function validateLicense(): boolean {
    if (usageType !== 'professional') return true
    const norm = normalizeLicense(licenseKey)
    if (!norm) { setLicenseErr('Please enter your license key.'); return false }
    if (!VALID_LICENSE_REGEX.test(norm)) {
      setLicenseErr('Invalid format. Expected: TSUKI-XXXX-XXXX-XXXX'); return false
    }
    setLicenseErr(''); setLicenseOk(true); return true
  }

  function next() {
    if (step.id === 'profile') {
      // Create a named profile if the user entered a name
      if (username.trim()) {
        const existing = profiles.find(p => p.name === username.trim())
        if (!existing) {
          createProfile(username.trim(), avatarUrl || '')
        }
        updateSetting('username', username.trim())
      }
      if (avatarUrl) updateSetting('avatarDataUrl', avatarUrl)
    }
    if (step.id === 'usage') {
      if (!usageType) return
      if (!validateLicense()) return
    }
    if (isLast) { onClose(); return }
    setStepIdx(i => i + 1)
  }

  function prev() {
    if (!isFirst) setStepIdx(i => i - 1)
  }

  const progressPct = ((stepIdx + 1) / STEPS.length) * 100

  // Is the Next button disabled?
  const nextDisabled =
    (step.id === 'usage' && (!usageType || (usageType === 'professional' && !licenseOk && !VALID_LICENSE_REGEX.test(normalizeLicense(licenseKey)))))

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="relative w-[540px] max-w-[95vw] rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] shadow-2xl overflow-hidden flex flex-col"
        style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.5)', maxHeight: '92vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-0 flex-shrink-0">
          <div className="flex items-center gap-2">
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
              <SkipForward size={11} /> Skip tutorial
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
        <div className="flex-1 px-6 py-7 overflow-y-auto min-h-0">
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

          {/* Step bodies */}
          {step.id === 'welcome' && <WelcomeStep />}
          {step.id === 'profile' && (
            <ProfileStep
              username={username}
              onUsername={setUsername}
              avatarUrl={avatarUrl}
              onAvatar={setAvatarUrl}
            />
          )}
          {step.id === 'usage' && (
            <UsageStep
              usageType={usageType}
              onSelectUsage={t => { setUsageType(t); setLicenseErr(''); setLicenseOk(false) }}
              licenseKey={licenseKey}
              onLicenseChange={v => { setLicenseKey(v); setLicenseErr(''); setLicenseOk(false) }}
              licenseErr={licenseErr}
              licenseOk={licenseOk}
            />
          )}
          {step.id === 'cli' && (
            <CliStep
              detecting={detecting}
              detected={detected}
              tsukiPath={settings.tsukiPath}
              onDetect={detectCli}
              onPathChange={v => updateSetting('tsukiPath', v)}
            />
          )}
          {step.id === 'board' && (
            <BoardStep board={board} onSelect={b => { setBoard(b); updateSetting('defaultBoard', b) }} />
          )}
          {step.id === 'import' && (
            <ImportStep
              onImported={() => setImportDone(true)}
              onSkip={() => setStepIdx(i => i + 1)}
            />
          )}
          {step.id === 'first-project' && (
            <FirstProjectStep board={board} creating={creating} created={created} onCreate={createFirstProject} />
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
              disabled={nextDisabled}
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

// ── Step: Welcome ─────────────────────────────────────────────────────────────

function WelcomeStep() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
        tsuki lets you write Arduino firmware in <strong className="text-[var(--fg)]">Go</strong> or <strong className="text-[var(--fg)]">Python</strong>. The IDE handles transpiling, compiling, and flashing — all in one place.
      </p>
      <div className="grid grid-cols-3 gap-3 mt-2">
        {[
          { icon: '✍️', title: 'Write Go / Python', desc: 'Familiar syntax for firmware' },
          { icon: '⚡', title: 'Build', desc: 'Transpile + compile in one step' },
          { icon: '📡', title: 'Flash', desc: 'Upload directly to your Arduino' },
        ].map(item => (
          <div key={item.title} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-center">
            <div className="text-2xl mb-2">{item.icon}</div>
            <div className="text-xs font-semibold text-[var(--fg)] mb-0.5">{item.title}</div>
            <div className="text-[10px] text-[var(--fg-faint)]">{item.desc}</div>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div className="text-xs font-mono text-[var(--fg-faint)] mb-2 uppercase tracking-widest">Quick example (Go)</div>
        <pre className="text-xs font-mono text-[var(--fg-muted)] leading-relaxed overflow-x-auto">{`import "arduino"

func setup() { arduino.PinMode(13, arduino.OUTPUT) }
func loop()  {
    arduino.DigitalWrite(13, arduino.HIGH); arduino.Delay(500)
    arduino.DigitalWrite(13, arduino.LOW);  arduino.Delay(500)
}`}</pre>
      </div>
      <p className="text-xs text-[var(--fg-faint)]">
        This tutorial walks through essential setup. Skip at any time and return via <strong>Settings</strong>.
      </p>
    </div>
  )
}

// ── Step: Profile ─────────────────────────────────────────────────────────────

function ProfileStep({
  username, onUsername, avatarUrl, onAvatar,
}: {
  username: string
  onUsername: (v: string) => void
  avatarUrl: string
  onAvatar: (v: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const result = ev.target?.result
      if (typeof result === 'string') onAvatar(result)
    }
    reader.readAsDataURL(file)
  }

  const initials = getInitials(username)

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
        Personalise your workspace with a display name and profile picture. This is completely optional and stored locally — you can change it anytime in Settings.
      </p>

      {/* Avatar + name side by side */}
      <div className="flex items-center gap-6">
        {/* Avatar */}
        <div className="flex flex-col items-center gap-2 flex-shrink-0">
          <button
            onClick={() => fileRef.current?.click()}
            className="relative w-20 h-20 rounded-full border-2 border-dashed border-[var(--border)] hover:border-[var(--fg-faint)] bg-[var(--surface)] transition-all cursor-pointer overflow-hidden group flex-shrink-0"
            title="Click to upload photo"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                {username.trim() ? (
                  <span className="text-xl font-bold text-[var(--fg-muted)]">{initials}</span>
                ) : (
                  <User size={24} className="text-[var(--fg-faint)]" />
                )}
              </div>
            )}
            {/* Hover overlay */}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Camera size={16} className="text-white" />
            </div>
          </button>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />

          <div className="flex gap-1.5">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer transition-colors"
            >
              <Upload size={9} /> Upload
            </button>
            {avatarUrl && (
              <button
                onClick={() => onAvatar('')}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-[var(--fg-faint)] hover:text-red-400 hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer transition-colors"
              >
                Remove
              </button>
            )}
          </div>
        </div>

        {/* Name fields */}
        <div className="flex-1 flex flex-col gap-3">
          <div>
            <label className="text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-widest block mb-1.5">
              Display name
            </label>
            <input
              type="text"
              value={username}
              onChange={e => onUsername(e.target.value)}
              placeholder="e.g. Nicke, s7lver, Ada…"
              maxLength={32}
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--fg)] outline-none focus:border-[var(--fg-faint)] transition-colors placeholder:text-[var(--fg-faint)]"
            />
            <p className="text-[10px] text-[var(--fg-faint)] mt-1">Shown in the IDE header and project metadata.</p>
          </div>
        </div>
      </div>

      {/* Preview card */}
      {username.trim() && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="w-9 h-9 rounded-full overflow-hidden bg-[var(--surface-3)] flex items-center justify-center flex-shrink-0 border border-[var(--border)]">
            {avatarUrl ? (
              <img src={avatarUrl} alt="preview" className="w-full h-full object-cover" />
            ) : (
              <span className="text-sm font-bold text-[var(--fg-muted)]">{initials}</span>
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--fg)]">{username.trim()}</p>
            <p className="text-[10px] text-[var(--fg-faint)]">tsuki developer</p>
          </div>
          <Check size={13} className="text-green-400 ml-auto" />
        </div>
      )}

      <p className="text-xs text-[var(--fg-faint)]">
        You can skip this step — your profile is optional. Change it anytime in <strong>Settings → Profile</strong>.
      </p>
    </div>
  )
}

// ── Step: Usage ───────────────────────────────────────────────────────────────

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
        {[
          { id: 'personal' as const, icon: '👤', title: 'Personal', desc: 'Hobby projects, learning, open-source', badge: 'Free', badgeCls: 'bg-green-400/15 text-green-400' },
          { id: 'professional' as const, icon: '🏢', title: 'Professional', desc: 'Commercial products, client work, teams', badge: 'License required', badgeCls: 'bg-purple-400/15 text-purple-400' },
        ].map(opt => (
          <button
            key={opt.id}
            onClick={() => onSelectUsage(opt.id)}
            className={clsx(
              'flex flex-col items-start gap-2 px-4 py-4 rounded-xl border text-left transition-all cursor-pointer bg-transparent',
              usageType === opt.id ? 'border-[var(--fg-muted)] bg-[var(--active)]' : 'border-[var(--border)] hover:border-[var(--fg-faint)] hover:bg-[var(--hover)]',
            )}
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-2xl">{opt.icon}</span>
              {usageType === opt.id && (opt.id === 'personal' || licenseOk) && <Check size={14} className="text-green-400" />}
            </div>
            <div>
              <div className="text-sm font-semibold text-[var(--fg)]">{opt.title}</div>
              <div className="text-xs text-[var(--fg-faint)] mt-0.5">{opt.desc}</div>
            </div>
            <span className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded', opt.badgeCls)}>{opt.badge}</span>
          </button>
        ))}
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
                licenseOk ? 'border-green-400/60' : licenseErr ? 'border-red-400/60' : 'border-[var(--border)] focus:border-[var(--fg-faint)]',
              )}
            />
            {licenseOk && <Check size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400" />}
          </div>
          {licenseErr && <p className="text-xs text-red-400">{licenseErr}</p>}
        </div>
      )}
      {usageType === 'personal' && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[var(--surface-1)] border border-[var(--border)]">
          <span className="text-base leading-none mt-0.5">✅</span>
          <p className="text-xs text-[var(--fg-muted)] leading-relaxed">
            Personal use is completely free — no registration needed.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Step: CLI ─────────────────────────────────────────────────────────────────

function CliStep({
  detecting, detected, tsukiPath, onDetect, onPathChange,
}: {
  detecting: boolean; detected: 'ok' | 'fail' | null
  tsukiPath: string; onDetect: () => void; onPathChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
        The IDE needs to know where the <code className="font-mono text-[var(--fg)] bg-[var(--surface-3)] px-1 rounded text-xs">tsuki</code> CLI binary is installed.
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
            {detecting ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />}
            Auto-detect
          </button>
        </div>
        {detected === 'ok' && (
          <p className="flex items-center gap-2 text-green-400 text-sm"><Check size={14} />Found! Path saved.</p>
        )}
        {detected === 'fail' && (
          <p className="text-sm text-yellow-400">Not found in PATH. Paste the full path above.</p>
        )}
      </div>
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3">
        <div className="text-xs font-semibold text-[var(--fg-faint)] uppercase tracking-widest mb-2">Don't have tsuki yet?</div>
        <div className="flex flex-col gap-1.5 text-xs font-mono text-[var(--fg-muted)]">
          <div><span className="text-[var(--fg-faint)]"># macOS / Linux</span></div>
          <div className="bg-[var(--surface-3)] rounded px-2 py-1">curl -fsSL https://tsuki.dev/install | sh</div>
          <div className="mt-1"><span className="text-[var(--fg-faint)]"># Windows</span></div>
          <div className="bg-[var(--surface-3)] rounded px-2 py-1">winget install tsuki</div>
        </div>
      </div>
    </div>
  )
}

// ── Step: Board ───────────────────────────────────────────────────────────────

function BoardStep({ board, onSelect }: { board: string; onSelect: (b: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
        Select the board you use most often. You can change this per-project later.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {COMMON_BOARDS.map(b => (
          <button
            key={b.id}
            onClick={() => onSelect(b.id)}
            className={clsx(
              'px-3 py-2.5 rounded-lg border text-left transition-all cursor-pointer bg-transparent',
              board === b.id ? 'border-[var(--fg-muted)] bg-[var(--active)]' : 'border-[var(--border)] hover:border-[var(--fg-faint)] hover:bg-[var(--hover)]',
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
    </div>
  )
}

// ── Step: Import ──────────────────────────────────────────────────────────────

type IdeSource = 'arduino-ide' | 'platformio' | 'raw-cpp' | 'raw-ino'

const IDE_SOURCES: { id: IdeSource; icon: string; label: string; desc: string; ext: string }[] = [
  { id: 'arduino-ide', icon: '🔵', label: 'Arduino IDE',   desc: '.ino sketch folder',          ext: '.ino' },
  { id: 'platformio',  icon: '🟠', label: 'PlatformIO',    desc: 'platformio.ini project folder', ext: 'folder' },
  { id: 'raw-cpp',     icon: '⚙️', label: 'Raw C++',       desc: 'Standalone .cpp + .h files',   ext: '.cpp' },
  { id: 'raw-ino',     icon: '📄', label: 'Other .ino',    desc: 'Any .ino sketch file',          ext: '.ino' },
]

// What language does an import source map to in tsuki_package.json?
function langForSource(src: IdeSource): string {
  return src === 'raw-cpp' ? 'cpp' : 'ino'
}

function ImportStep({
  onImported, onSkip,
}: {
  onImported: () => void
  onSkip: () => void
}) {
  const { loadFromDisk, loadProject, board } = useStore()
  const [selected,    setSelected]    = useState<IdeSource | null>(null)
  const [status,      setStatus]      = useState<'idle' | 'picking' | 'converting' | 'done' | 'error'>('idle')
  const [errorMsg,    setErrorMsg]    = useState('')
  const [importedName, setImportedName] = useState('')

  async function handleImport() {
    if (!selected) return
    setStatus('picking')
    setErrorMsg('')

    try {
      const { pickFolder, pickFile, isTauri, readFile, writeFile, createDirectory } = await import('@/lib/tauri')

      if (!isTauri()) {
        setErrorMsg('File import requires the Tauri desktop app.')
        setStatus('error')
        return
      }

      let folder: string | null = null
      let projectName = 'imported-project'

      // For ino/arduino-ide pick a folder; for raw-cpp/raw-ino pick a file
      if (selected === 'arduino-ide' || selected === 'platformio') {
        folder = await pickFolder()
      } else {
        const file = await pickFile()
        if (file) {
          // Use parent folder as project root
          folder = file.replace(/[/\\][^/\\]+$/, '') || file
        }
      }

      if (!folder) {
        setStatus('idle')
        return
      }

      // Derive project name from folder name
      const parts = folder.replace(/\\/g, '/').split('/')
      projectName = parts[parts.length - 1] || 'imported-project'
      setImportedName(projectName)

      setStatus('converting')

      // Build a tsuki_package.json in the folder if none exists
      const manifestPath = folder + '/tsuki_package.json'
      let hasManifest = false
      try { await readFile(manifestPath); hasManifest = true } catch { /* not found */ }

      if (!hasManifest) {
        const lang = langForSource(selected)
        const manifest = JSON.stringify({
          name: projectName,
          version: '0.1.0',
          board: board || 'uno',
          language: lang,
          backend: 'tsuki-flash',
          packages: [],
          build: { output_dir: 'build', cpp_std: 'c++11', optimize: 'Os', extra_flags: [], source_map: false },
        }, null, 2)
        try {
          await writeFile(manifestPath, manifest)
        } catch { /* folder might be read-only — proceed without manifest */ }
      }

      // For PlatformIO: check for src/ folder and copy main.cpp if needed
      if (selected === 'platformio') {
        try {
          const srcMain = folder + '/src/main.cpp'
          await readFile(srcMain) // throws if missing
          // src/main.cpp exists — nothing to do, tsuki will find it
        } catch { /* no src/main.cpp — user can set it up manually */ }
      }

      // Open the folder in the IDE
      await loadFromDisk(folder)
      setStatus('done')
      onImported()
    } catch (e: any) {
      setErrorMsg(String(e?.message ?? e))
      setStatus('error')
    }
  }

  if (status === 'done') {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 px-4 py-4 rounded-xl border border-green-400/30 bg-green-400/5">
          <Check size={20} className="text-green-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-green-400">Project imported!</p>
            <p className="text-xs text-[var(--fg-muted)] mt-0.5">
              <strong className="text-[var(--fg)]">{importedName}</strong> is now open in the IDE.{' '}
              A <code className="font-mono text-xs">tsuki_package.json</code> was created so you can build and flash directly.
            </p>
          </div>
        </div>
        <p className="text-xs text-[var(--fg-faint)]">Click <strong>Next</strong> to finish the setup.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
        Already have an Arduino project? tsuki can open it directly. It will create a <code className="font-mono text-xs text-[var(--fg)] bg-[var(--surface-3)] px-1 rounded">tsuki_package.json</code> alongside your existing files — nothing is moved or deleted.
      </p>

      {/* Source selector */}
      <div className="grid grid-cols-2 gap-2">
        {IDE_SOURCES.map(src => (
          <button
            key={src.id}
            onClick={() => setSelected(src.id)}
            className={clsx(
              'flex items-start gap-3 px-3 py-3 rounded-xl border text-left transition-all cursor-pointer bg-transparent',
              selected === src.id ? 'border-[var(--fg-muted)] bg-[var(--active)]' : 'border-[var(--border)] hover:border-[var(--fg-faint)] hover:bg-[var(--hover)]',
            )}
          >
            <span className="text-xl leading-none mt-0.5 flex-shrink-0">{src.icon}</span>
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="text-sm font-medium text-[var(--fg)]">{src.label}</span>
                {selected === src.id && <Check size={11} className="text-green-400 flex-shrink-0" />}
              </div>
              <p className="text-[10px] text-[var(--fg-faint)] mt-0.5">{src.desc}</p>
            </div>
          </button>
        ))}
      </div>

      {/* What will happen */}
      {selected && (
        <div className="flex flex-col gap-2 px-4 py-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] text-xs text-[var(--fg-muted)]">
          <div className="font-semibold text-[var(--fg-muted)] uppercase tracking-widest text-[10px] mb-1">What happens</div>
          {[
            { icon: <FolderOpen size={11} />, text: selected === 'arduino-ide' || selected === 'platformio' ? 'Pick the project folder' : 'Pick the source file' },
            { icon: <FileCode size={11} />,   text: 'A tsuki_package.json is created (existing files untouched)' },
            { icon: <ArrowRight size={11} />, text: `Language set to "${langForSource(selected)}" — build with tsuki build` },
          ].map((row, i) => (
            <div key={i} className="flex items-center gap-2 text-[var(--fg-faint)]">
              <span className="text-[var(--fg-faint)] flex-shrink-0">{row.icon}</span>
              {row.text}
            </div>
          ))}
        </div>
      )}

      {status === 'error' && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-red-400/30 bg-red-400/5 text-red-400">
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
          <p className="text-xs">{errorMsg}</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleImport}
          disabled={!selected || status === 'picking' || status === 'converting'}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--fg)] text-[var(--surface)] hover:opacity-80 transition-opacity cursor-pointer border-0 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {status === 'picking'    ? <><RefreshCw size={12} className="animate-spin" /> Picking folder…</> :
           status === 'converting' ? <><RefreshCw size={12} className="animate-spin" /> Converting…</>    :
           <><FolderInput size={13} /> Import project</>}
        </button>
        <button
          onClick={onSkip}
          className="px-4 py-2 rounded-lg text-sm text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer border-0 bg-transparent"
        >
          Skip for now
        </button>
      </div>

      <p className="text-xs text-[var(--fg-faint)]">
        You can also import projects anytime via <strong>File → Open Folder</strong> in the IDE.
      </p>
    </div>
  )
}

// ── Step: First project ───────────────────────────────────────────────────────

function FirstProjectStep({
  board, creating, created, onCreate,
}: {
  board: string; creating: boolean; created: boolean; onCreate: () => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
        Let's create a <strong className="text-[var(--fg)]">Blink</strong> project — the classic "Hello World" of Arduino. It makes the built-in LED blink every 500 ms.
      </p>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col gap-2">
        {[
          { label: 'Name',     value: 'blink-demo' },
          { label: 'Board',    value: board },
          { label: 'Language', value: 'Go ✦' },
          { label: 'Backend',  value: 'tsuki-flash' },
        ].map(row => (
          <div key={row.label} className="flex items-center justify-between py-1 border-b border-[var(--border-subtle)] last:border-0">
            <span className="text-xs text-[var(--fg-faint)]">{row.label}</span>
            <span className="text-xs font-mono text-[var(--fg-muted)]">{row.value}</span>
          </div>
        ))}
      </div>
      {created ? (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-green-400/30 bg-green-400/5 text-green-400">
          <Check size={16} />
          <span className="text-sm font-medium">Project created! Opening the IDE…</span>
        </div>
      ) : (
        <p className="text-xs text-[var(--fg-faint)]">
          This is an in-memory project. Use <strong>New Project</strong> to save to disk.
        </p>
      )}
    </div>
  )
}