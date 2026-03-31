'use client'
import { useState, useEffect, useRef } from 'react'
import { useStore } from '@/lib/store'
import {
  ChevronRight, ChevronLeft, Check, Zap, RefreshCw,
  User, Camera, AlertCircle, Download, X, Sparkles,
  Star, FolderOpen, GitBranch, FileCode, Package,
} from 'lucide-react'
import { clsx } from 'clsx'

// ─────────────────────────────────────────────────────────────────────────────
//  Keyframe CSS
//  Bounces removed intentionally. ob-float kept only for subtle pulse ring.
//  ob-check kept (it's just a scale-in, not a bounce).
//  ob-stagger-up kept (opacity + translateY, no overshoot).
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
  @keyframes ob-orb {
    0%   { transform:translate(-50%,-50%) scale(1)    rotate(0deg);   }
    33%  { transform:translate(-50%,-50%) scale(1.14) rotate(12deg)  translate(22px,-16px); }
    66%  { transform:translate(-50%,-50%) scale(0.92) rotate(-8deg)  translate(-14px,18px); }
    100% { transform:translate(-50%,-50%) scale(1.06) rotate(4deg)   translate(6px,-6px);  }
  }
  @keyframes ob-particle {
    0%   { transform:translateY(0)   scale(1);   opacity:.5; }
    50%  { transform:translateY(-22px) scale(1.05); opacity:.9; }
    100% { transform:translateY(0)   scale(0.95); opacity:.35; }
  }
  @keyframes ob-card-enter {
    from { opacity:0; transform:scale(0.95) translateY(16px); }
    to   { opacity:1; transform:scale(1)    translateY(0); }
  }
  @keyframes ob-step-f {
    from { opacity:0; transform:translateX(36px); }
    to   { opacity:1; transform:translateX(0);    }
  }
  @keyframes ob-step-b {
    from { opacity:0; transform:translateX(-36px); }
    to   { opacity:1; transform:translateX(0);     }
  }
  @keyframes ob-header-in {
    from { opacity:0; transform:translateY(-7px); }
    to   { opacity:1; transform:translateY(0);    }
  }
  @keyframes ob-pulse-ring {
    0%   { transform:scale(1);   opacity:.7; box-shadow:0 0 0 0 rgba(74,222,128,0.5); }
    70%  { transform:scale(1);   opacity:.2; box-shadow:0 0 0 14px rgba(74,222,128,0); }
    100% { transform:scale(1);   opacity:.7; box-shadow:0 0 0 0 rgba(74,222,128,0); }
  }
  @keyframes ob-progress-shimmer {
    from { background-position: -200% center; }
    to   { background-position:  200% center; }
  }
  @keyframes ob-stagger-up {
    from { opacity:0; transform:translateY(10px); }
    to   { opacity:1; transform:translateY(0);    }
  }
  @keyframes ob-check {
    0%   { transform:scale(0) rotate(-15deg); opacity:0; }
    65%  { transform:scale(1.12); opacity:1; }
    100% { transform:scale(1)   rotate(0deg); opacity:1; }
  }
  @keyframes ob-confetti-fall {
    0%   { transform:translateY(-20px) rotate(0deg);   opacity:1; }
    100% { transform:translateY(80px)  rotate(360deg); opacity:0; }
  }
  @keyframes ob-scan-line {
    from { transform:translateY(-100%); }
    to   { transform:translateY(400%); }
  }

  .ob-card       { animation: ob-card-enter 350ms cubic-bezier(.2,0,.1,1) both; }
  .ob-step-f     { animation: ob-step-f  200ms cubic-bezier(.4,0,.2,1) both; }
  .ob-step-b     { animation: ob-step-b  200ms cubic-bezier(.4,0,.2,1) both; }
  .ob-header     { animation: ob-header-in 200ms ease both; }
  .ob-check      { animation: ob-check 240ms cubic-bezier(.2,0,.1,1) both; }
  .ob-stagger > * { animation: ob-stagger-up 220ms ease both; }
  .ob-stagger > *:nth-child(1) { animation-delay:  20ms; }
  .ob-stagger > *:nth-child(2) { animation-delay:  55ms; }
  .ob-stagger > *:nth-child(3) { animation-delay:  90ms; }
  .ob-stagger > *:nth-child(4) { animation-delay: 125ms; }
  .ob-stagger > *:nth-child(5) { animation-delay: 155ms; }
  .ob-stagger > *:nth-child(6) { animation-delay: 185ms; }
  .ob-stagger > *:nth-child(7) { animation-delay: 210ms; }
  .ob-stagger > *:nth-child(8) { animation-delay: 235ms; }

  .ob-btn {
    transition: background 110ms ease, border-color 110ms ease, color 110ms ease,
                transform 90ms ease, box-shadow 110ms ease, opacity 110ms ease;
  }
  .ob-btn:hover   { transform:translateY(-1px); box-shadow:0 5px 14px rgba(0,0,0,0.25); }
  .ob-btn:active  { transform:translateY(0) scale(0.97); box-shadow:none; }
  .ob-btn:disabled { opacity:.4; pointer-events:none; }

  .ob-card-item {
    transition: background 140ms ease, box-shadow 140ms ease, transform 130ms ease, border-color 110ms ease;
    cursor: pointer;
  }
  .ob-card-item:hover  { transform:translateY(-1px); box-shadow:0 4px 14px rgba(0,0,0,0.2); }
  .ob-card-item:active { transform:scale(0.985); }

  .ob-theme-card {
    transition: transform 150ms ease, box-shadow 150ms ease;
    cursor: pointer;
  }
  .ob-theme-card:hover  { transform:translateY(-2px); box-shadow:0 7px 20px rgba(0,0,0,0.28); }
  .ob-theme-card:active { transform:scale(0.97); }

  .ob-kbd { transition: transform 90ms ease; }
  .ob-kbd:hover { transform:translateY(-2px); }

  .ob-progress-bar {
    background: linear-gradient(90deg,
      rgba(255,255,255,0.3) 0%,
      rgba(255,255,255,0.7) 40%,
      rgba(255,255,255,1)   50%,
      rgba(255,255,255,0.7) 60%,
      rgba(255,255,255,0.3) 100%);
    background-size: 200% 100%;
    animation: ob-progress-shimmer 2s linear infinite;
  }
`

// ─────────────────────────────────────────────────────────────────────────────
//  Background
// ─────────────────────────────────────────────────────────────────────────────

function Particles() {
  const pts = [
    { x: 8,  y: 20, s: 3, d: 0,   dur: 4.2 },
    { x: 92, y: 35, s: 2, d: 1.1, dur: 3.8 },
    { x: 25, y: 75, s: 4, d: 2.3, dur: 5.1 },
    { x: 75, y: 15, s: 2, d: 0.7, dur: 4.5 },
    { x: 60, y: 88, s: 3, d: 3.1, dur: 3.6 },
    { x: 15, y: 55, s: 2, d: 1.8, dur: 4.9 },
    { x: 85, y: 70, s: 3, d: 0.4, dur: 3.3 },
    { x: 45, y: 10, s: 2, d: 2.7, dur: 4.7 },
  ]
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {pts.map((p, i) => (
        <div key={i} className="absolute rounded-full"
          style={{
            left: `${p.x}%`, top: `${p.y}%`,
            width: p.s, height: p.s,
            background: 'rgba(255,255,255,0.28)',
            animation: `ob-particle ${p.dur}s ease-in-out infinite`,
            animationDelay: `${p.d}s`,
          }} />
      ))}
    </div>
  )
}

function AnimatedBg({ stepIdx }: { stepIdx: number }) {
  const hue  = (stepIdx * 41) % 360
  const hue2 = (hue + 65) % 360
  const hue3 = (hue + 130) % 360
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute inset-0" style={{
        transition: 'background 1100ms cubic-bezier(.4,0,.2,1)',
        background: `radial-gradient(ellipse 140% 100% at 58% 38%,
          hsla(${hue},22%,10%,0.94) 0%,
          hsla(${hue2},14%,6%,0.97) 50%,
          #030303 100%)`,
      }} />
      <div className="absolute rounded-full" style={{
        width: 620, height: 620, left: '12%', top: '22%',
        transform: 'translate(-50%,-50%)',
        background: `radial-gradient(circle, hsla(${hue},60%,65%,0.09) 0%, transparent 68%)`,
        filter: 'blur(1px)',
        animation: 'ob-orb 24s ease-in-out infinite',
      }} />
      <div className="absolute rounded-full" style={{
        width: 480, height: 480, left: '82%', top: '58%',
        transform: 'translate(-50%,-50%)',
        background: `radial-gradient(circle, hsla(${hue2},55%,60%,0.08) 0%, transparent 68%)`,
        filter: 'blur(1px)',
        animation: 'ob-orb 30s ease-in-out infinite reverse',
        animationDelay: '8s',
      }} />
      <div className="absolute rounded-full" style={{
        width: 320, height: 320, left: '55%', top: '88%',
        transform: 'translate(-50%,-50%)',
        background: `radial-gradient(circle, hsla(${hue3},50%,62%,0.07) 0%, transparent 68%)`,
        filter: 'blur(1px)',
        animation: 'ob-orb 20s ease-in-out infinite',
        animationDelay: '4s',
      }} />
      <div className="absolute inset-0 opacity-[0.018]" style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,1) 1px,transparent 1px)',
        backgroundSize: '48px 48px',
      }} />
      <div className="absolute inset-x-0 overflow-hidden" style={{ top: 0, height: 120, pointerEvents: 'none' }}>
        <div className="absolute inset-x-0 h-[2px] opacity-[0.025]" style={{
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.8) 50%, transparent)',
          animation: 'ob-scan-line 8s linear infinite',
        }} />
      </div>
      <Particles />
      <div className="absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-black/55 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/65 to-transparent" />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Data
// ─────────────────────────────────────────────────────────────────────────────

type StepId = 'welcome'|'plan'|'profile'|'theme'|'language'|'board'|'import'|'cli'|'updates'|'tips'|'done'
type ImportSource = 'none'|'arduino-ide'|'platformio'|'git'

const STEPS: { id: StepId; title: string; subtitle: string; emoji: string; skippable: boolean }[] = [
  { id: 'welcome',  title: 'Welcome to tsuki',    subtitle: 'Write Go or Python. Flash Arduino.',          emoji: '月',  skippable: false },
  { id: 'plan',     title: 'Choose your plan',    subtitle: 'Free forever or unlock Pro features',         emoji: '⭐', skippable: true  },
  { id: 'profile',  title: 'Your profile',         subtitle: 'A name and face for your workspace',         emoji: '👤', skippable: true  },
  { id: 'theme',    title: 'Pick a look',          subtitle: 'Choose how the IDE looks and feels',         emoji: '🎨', skippable: true  },
  { id: 'language', title: 'Interface language',   subtitle: 'What language should the IDE speak?',        emoji: '🌐', skippable: true  },
  { id: 'board',    title: 'Default board',        subtitle: 'The board you reach for most often',         emoji: '🔌', skippable: true  },
  { id: 'import',   title: 'Import a project',     subtitle: 'Bring in an existing sketch or start fresh', emoji: '📂', skippable: true  },
  { id: 'cli',      title: 'CLI tools',            subtitle: 'Where is the tsuki binary installed?',       emoji: '⚡', skippable: true  },
  { id: 'updates',  title: 'Update channel',       subtitle: 'Stay on stable or get early access',         emoji: '🚀', skippable: true  },
  { id: 'tips',     title: 'Keyboard shortcuts',   subtitle: 'Commands worth knowing before you start',    emoji: '⌨️', skippable: true  },
  { id: 'done',     title: "You're all set",       subtitle: "Everything saved. Let's build something.",   emoji: '✨', skippable: false },
]

const BOARDS = [
  { id: 'uno',         label: 'Arduino Uno',  chip: 'ATmega328P', color: '#1a6b2e' },
  { id: 'nano',        label: 'Arduino Nano', chip: 'ATmega328P', color: '#0a4d8c' },
  { id: 'mega',        label: 'Arduino Mega', chip: 'ATmega2560', color: '#1a3a6b' },
  { id: 'esp32',       label: 'ESP32',        chip: 'Xtensa LX6', color: '#7a1a1a' },
  { id: 'esp8266',     label: 'ESP8266',      chip: '80 MHz',     color: '#7a5a1a' },
  // TEMP HIDDEN: { id: 'pico',        label: 'RPi Pico',     chip: 'RP2040',     color: '#5a1a7a' },
  // TEMP HIDDEN: { id: 'xiao_rp2040', label: 'XIAO RP2040', chip: 'RP2040',     color: '#1a6a6a' },
  { id: 'leonardo',    label: 'Leonardo',     chip: 'ATmega32U4', color: '#2e1a7a' },
]

const THEMES = [
  { id: 'tsuki-dark',  name: 'Tsuki Dark',  bg: '#0a0a0a', accent: '#ededed', fg: '#8c8c8c', lines: [0.55,0.3,0.65,0.2,0.45] },
  { id: 'tsuki-light', name: 'Tsuki Light', bg: '#f8f8f8', accent: '#111',    fg: '#737373', lines: [0.5,0.28,0.6,0.18,0.42] },
  { id: 'midnight',    name: 'Midnight',    bg: '#090d1a', accent: '#6496ff', fg: '#6b7fa8', lines: [0.6,0.35,0.7,0.22,0.5]  },
  { id: 'forest',      name: 'Forest',      bg: '#0a130a', accent: '#4ade80', fg: '#4a7a4a', lines: [0.55,0.32,0.65,0.2,0.48] },
  { id: 'rose',        name: 'Rose',        bg: '#1a0a0f', accent: '#fb7185', fg: '#8a4a5a', lines: [0.58,0.3,0.68,0.22,0.46] },
  { id: 'amber',       name: 'Amber',       bg: '#0f0a00', accent: '#fbbf24', fg: '#7a6a30', lines: [0.52,0.28,0.62,0.2,0.44] },
]

const LANGS = [
  { code: 'en' as const, flag: '🇬🇧', name: 'English', native: 'English' },
  { code: 'es' as const, flag: '🇪🇸', name: 'Spanish', native: 'Español' },
]

const SHORTCUTS = [
  { keys: ['Ctrl','B'],         desc: 'Build & Flash',      color: 'rgba(74,222,128,0.15)',  tc: '#4ade80' },
  { keys: ['Ctrl','Shift','B'], desc: 'Build only',         color: 'rgba(96,165,250,0.12)',  tc: '#60a5fa' },
  { keys: ['Ctrl','Shift','T'], desc: 'Check / typecheck',  color: 'rgba(251,191,36,0.12)',  tc: '#fbbf24' },
  { keys: ['Ctrl','Shift','U'], desc: 'Flash only',         color: 'rgba(167,139,250,0.12)', tc: '#a78bfa' },
  { keys: ['Ctrl','M'],         desc: 'Serial monitor',     color: 'rgba(251,146,60,0.12)',  tc: '#fb923c' },
  { keys: ['Ctrl','S'],         desc: 'Save file',          color: 'rgba(255,255,255,0.06)', tc: 'rgba(255,255,255,0.55)' },
  { keys: ['Ctrl','1/2/3'],     desc: 'Switch workstation', color: 'rgba(255,255,255,0.06)', tc: 'rgba(255,255,255,0.55)' },
]

const PLAN_NORMAL = [
  'Go & Python → Arduino transpiler',
  'All supported boards (Uno, ESP32…)',
  'Built-in package manager (tsukilib)',
  'Circuit sandbox simulator',
  'Community support',
]

const PLAN_PRO = [
  'Everything in Normal',
  'Cloud project sync',
  'Private package registry',
  'Priority support & bug fixes',
  'Early access to new features',
  'AI-assisted debugging (coming soon)',
]

const IMPORT_OPTIONS: { id: ImportSource; icon: React.ElementType; label: string; sub: string; badge?: string }[] = [
  { id: 'none',        icon: Sparkles,  label: 'Start fresh',    sub: 'Create a new empty tsuki project'        },
  { id: 'arduino-ide', icon: FileCode,  label: 'Arduino IDE',    sub: 'Import a .ino sketch or folder',         badge: 'supported' },
  { id: 'platformio',  icon: Package,   label: 'PlatformIO',     sub: 'Import a platformio.ini project',        badge: 'supported' },
  { id: 'git',         icon: GitBranch, label: 'Clone from Git', sub: 'Clone any Git repository URL'            },
]

// ─────────────────────────────────────────────────────────────────────────────
//  Shared components
// ─────────────────────────────────────────────────────────────────────────────

function Glass({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('rounded-xl px-4 py-3', className)}
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Step: Welcome
// ─────────────────────────────────────────────────────────────────────────────

function StepWelcome() {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-white/50 leading-relaxed">
        tsuki lets you write Arduino firmware in <strong className="text-white/88">Go</strong> or <strong className="text-white/88">Python</strong> and flash it in one click — no arduino-cli needed.
      </p>

      <div className="grid grid-cols-3 gap-3">
        {[
          { e: '✍️', t: 'Write', d: 'Go or Python firmware' },
          { e: '⚡', t: 'Build', d: 'Transpile + compile'   },
          { e: '📡', t: 'Flash', d: 'Upload to your board'  },
        ].map(x => (
          <div key={x.t} className="flex flex-col items-center gap-2.5 px-3 py-4 rounded-xl text-center"
            style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <span className="text-2xl">{x.e}</span>
            <div>
              <div className="text-xs font-semibold text-white/78 mb-0.5">{x.t}</div>
              <div className="text-[10px] text-white/30">{x.d}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.45)' }}>
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5">
          <div className="flex gap-1.5">
            {['#ef4444','#f59e0b','#22c55e'].map(c => (
              <div key={c} className="w-2.5 h-2.5 rounded-full opacity-55" style={{ background: c }} />
            ))}
          </div>
          <span className="text-[10px] text-white/22 font-mono ml-1">main.go</span>
        </div>
        <pre className="px-5 py-4 text-xs font-mono leading-[1.8] overflow-x-auto select-all" style={{ color: 'rgba(255,255,255,0.42)' }}>{
`import "arduino"

func setup() {
  arduino.PinMode(13, arduino.OUTPUT)
}
func loop() {
  arduino.DigitalWrite(13, arduino.HIGH)
  arduino.Delay(500)
  arduino.DigitalWrite(13, arduino.LOW)
  arduino.Delay(500)
}`
        }</pre>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Step: Plan
// ─────────────────────────────────────────────────────────────────────────────

function StepPlan({ plan, onSelect }: { plan: 'normal'|'pro'; onSelect: (v: 'normal'|'pro') => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-white/45 leading-relaxed">
        tsuki Normal is free forever. Pro unlocks cloud sync and priority features.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {(['normal','pro'] as const).map(id => {
          const isPro = id === 'pro'
          const active = plan === id
          const accent = isPro ? '#a78bfa' : '#4ade80'
          const accentBg = isPro ? 'rgba(167,139,250,0.12)' : 'rgba(74,222,128,0.12)'
          const features = isPro ? PLAN_PRO : PLAN_NORMAL
          return (
            <button key={id}
              onClick={() => onSelect(id)}
              className="ob-card-item relative flex flex-col gap-3 px-4 py-4 rounded-2xl text-left border-0"
              style={{
                background: active ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)',
                outline: active ? `2px solid ${accent}50` : '1px solid rgba(255,255,255,0.08)',
              }}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: accentBg, color: accent }}>
                  {isPro ? 'PRO' : 'FREE'}
                </span>
                {active && <Check size={12} className="ob-check" style={{ color: accent }} />}
                {isPro && !active && (
                  <span className="text-[9px] text-white/25 font-mono">coming soon</span>
                )}
              </div>
              <div>
                <div className="text-sm font-semibold text-white/88 mb-0.5">
                  {isPro ? 'tsuki Pro' : 'tsuki Normal'}
                </div>
                <div className="text-xs text-white/32">
                  {isPro ? '~$9/mo · billed annually' : 'Free forever'}
                </div>
              </div>
              <ul className="flex flex-col gap-1.5">
                {features.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[10px] text-white/45">
                    <Check size={9} className="flex-shrink-0 mt-0.5" style={{ color: accent, opacity: 0.7 }} />
                    {f}
                  </li>
                ))}
              </ul>
              {isPro && (
                <p className="text-[10px] text-white/22 italic mt-auto pt-1">
                  Select to join the waitlist
                </p>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Step: Profile
// ─────────────────────────────────────────────────────────────────────────────

function StepProfile({ username, onUsername, avatarUrl, onAvatar }: {
  username: string; onUsername: (v: string) => void
  avatarUrl: string; onAvatar: (v: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    const r = new FileReader()
    r.onload = ev => { if (typeof ev.target?.result === 'string') onAvatar(ev.target.result) }
    r.readAsDataURL(f)
  }
  const initials = username.trim().split(/\s+/).slice(0,2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-white/45 leading-relaxed">Optional. Stored locally — never uploaded anywhere.</p>
      <div className="flex items-center gap-8">
        <button onClick={() => fileRef.current?.click()}
          className="relative w-24 h-24 rounded-2xl overflow-hidden cursor-pointer border-0 bg-transparent group flex-shrink-0"
          style={{ border: '1.5px dashed rgba(255,255,255,0.15)', transition: 'transform 180ms ease' }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.04)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}>
          {avatarUrl
            ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)' }}>
                {username.trim()
                  ? <span className="text-2xl font-bold text-white/45">{initials}</span>
                  : <User size={28} className="text-white/22" />}
              </div>}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'rgba(0,0,0,0.55)' }}>
            <Camera size={20} className="text-white drop-shadow" />
          </div>
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        <div className="flex-1 flex flex-col gap-3">
          <label className="text-[10px] font-semibold text-white/28 uppercase tracking-widest block">Display name</label>
          <input type="text" value={username} onChange={e => onUsername(e.target.value)}
            placeholder="Your name or handle…" maxLength={32} autoFocus
            className="w-full px-4 py-2.5 rounded-xl text-sm text-white/88 outline-none placeholder:text-white/18"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', transition: 'border-color 120ms, box-shadow 120ms' }}
            onFocus={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(255,255,255,0.05)' }}
            onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';  e.currentTarget.style.boxShadow = 'none' }}
          />
          {avatarUrl && (
            <button onClick={() => onAvatar('')} className="text-[10px] text-white/28 hover:text-red-400/75 cursor-pointer border-0 bg-transparent text-left transition-colors w-fit">
              Remove photo
            </button>
          )}
        </div>
      </div>
      {username.trim() && (
        <Glass>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.09)' }}>
              {avatarUrl
                ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                : <span className="text-sm font-bold text-white/55">{initials}</span>}
            </div>
            <div>
              <p className="text-sm font-semibold text-white/82">{username.trim()}</p>
              <p className="text-[10px] text-white/30">tsuki developer</p>
            </div>
            <Check size={14} className="ob-check text-green-400 ml-auto" />
          </div>
        </Glass>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Step: Theme
// ─────────────────────────────────────────────────────────────────────────────

function StepTheme({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-white/45">Theme applies immediately. Change anytime in Settings → Appearance.</p>
      <div className="grid grid-cols-3 gap-3">
        {THEMES.map(t => {
          const active = selected === t.id
          return (
            <button key={t.id} onClick={() => onSelect(t.id)}
              className={clsx('ob-theme-card relative flex flex-col rounded-2xl overflow-hidden border-0',
                active ? 'ring-2 ring-white/60' : 'ring-1 ring-white/8')}>
              <div className="w-full" style={{ aspectRatio: '16/9', background: t.bg, padding: '10px' }}>
                <div className="flex gap-1 mb-2">
                  <div className="h-[3px] rounded-full w-8" style={{ background: t.accent, opacity: 0.65 }} />
                  <div className="h-[3px] rounded-full w-5" style={{ background: t.fg,     opacity: 0.25 }} />
                </div>
                {t.lines.map((o, i) => (
                  <div key={i} className="h-[2.5px] rounded-full mb-[4px]"
                    style={{ background: i % 3 === 0 ? t.accent : t.fg, opacity: o, width: `${32 + i * 13}%` }} />
                ))}
              </div>
              <div className="px-3 py-2 flex items-center justify-between" style={{ background: 'rgba(0,0,0,0.6)' }}>
                <span className="text-[11px] font-medium text-white/75">{t.name}</span>
                {active && <Check size={11} className="ob-check text-green-400" />}
              </div>
              {active && (
                <div className="absolute inset-0 rounded-2xl pointer-events-none"
                  style={{ boxShadow: `0 0 0 2px ${t.accent}40, 0 8px 30px ${t.accent}28` }} />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Step: Language
// ─────────────────────────────────────────────────────────────────────────────

function StepLanguage({ lang, onSelect }: { lang: string; onSelect: (v: 'en'|'es') => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-white/45">More languages coming soon.</p>
      <div className="ob-stagger flex flex-col gap-2.5">
        {LANGS.map(l => {
          const active = lang === l.code
          return (
            <button key={l.code} onClick={() => onSelect(l.code)}
              className={clsx('ob-card-item flex items-center gap-5 px-5 py-4 rounded-2xl text-left border-0',
                active ? 'ring-2 ring-white/35' : 'ring-1 ring-white/7')}
              style={{ background: active ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.045)' }}>
              <span className="text-4xl leading-none">{l.flag}</span>
              <div className="flex-1">
                <div className="text-base font-semibold text-white/85">{l.native}</div>
                <div className="text-xs text-white/32 mt-0.5">{l.name}</div>
              </div>
              {active && <Check size={16} className="ob-check text-green-400 flex-shrink-0" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Step: Board
// ─────────────────────────────────────────────────────────────────────────────

function StepBoard({ board, onSelect }: { board: string; onSelect: (b: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-white/45">Override per-project anytime.</p>
      <div className="ob-stagger grid grid-cols-2 gap-2.5">
        {BOARDS.map(b => {
          const active = board === b.id
          return (
            <button key={b.id} onClick={() => onSelect(b.id)}
              className={clsx('ob-card-item flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-left border-0',
                active ? 'ring-2 ring-white/35' : 'ring-1 ring-white/7')}
              style={{ background: active ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.04)' }}>
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{
                background: b.color,
                boxShadow: active ? `0 0 8px ${b.color}90` : 'none',
                transition: 'box-shadow 200ms',
              }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white/80 truncate">{b.label}</div>
                <div className="text-[10px] font-mono text-white/28">{b.chip}</div>
              </div>
              {active && <Check size={12} className="ob-check text-green-400 flex-shrink-0" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Step: Import
// ─────────────────────────────────────────────────────────────────────────────

function StepImport({ source, onSource, importPath, onImportPath, gitUrl, onGitUrl }: {
  source: ImportSource; onSource: (v: ImportSource) => void
  importPath: string; onImportPath: (v: string) => void
  gitUrl: string; onGitUrl: (v: string) => void
}) {
  async function browse() {
    try {
      const { openFileDialog } = await import('@/lib/tauri') as any
      const p = await openFileDialog({
        directory: source === 'platformio',
        filters: source === 'arduino-ide' ? [{ name: 'Arduino Sketch', extensions: ['ino'] }] : [],
      })
      if (p) onImportPath(p as string)
    } catch { /* tauri not available in browser */ }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-white/45 leading-relaxed">
        You can always import later from <code className="text-white/58 font-mono text-xs bg-white/8 px-1 rounded">File → Import</code>.
      </p>

      <div className="ob-stagger flex flex-col gap-2">
        {IMPORT_OPTIONS.map(opt => {
          const active = source === opt.id
          const Icon = opt.icon
          return (
            <button key={opt.id} onClick={() => onSource(opt.id)}
              className={clsx('ob-card-item flex items-center gap-3.5 px-4 py-3 rounded-xl text-left border-0',
                active ? 'ring-2 ring-white/28' : 'ring-1 ring-white/7')}
              style={{ background: active ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.035)' }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: active ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)' }}>
                <Icon size={14} className={active ? 'text-white/80' : 'text-white/35'} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white/80">{opt.label}</span>
                  {opt.badge && (
                    <span className="text-[8px] font-mono px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(74,222,128,0.12)', color: '#4ade80' }}>{opt.badge}</span>
                  )}
                </div>
                <div className="text-[10px] text-white/30 truncate">{opt.sub}</div>
              </div>
              {active && <Check size={13} className="ob-check text-white/55 flex-shrink-0" />}
            </button>
          )
        })}
      </div>

      {(source === 'arduino-ide' || source === 'platformio') && (
        <div className="flex flex-col gap-2">
          <label className="text-[10px] text-white/28 uppercase tracking-widest font-semibold">
            {source === 'arduino-ide' ? '.ino file or sketch folder' : 'Project folder (platformio.ini)'}
          </label>
          <div className="flex gap-2">
            <input type="text" value={importPath} onChange={e => onImportPath(e.target.value)}
              placeholder={source === 'arduino-ide' ? '/path/to/Sketch.ino' : '/path/to/project/'}
              className="flex-1 px-3 py-2 rounded-lg font-mono text-xs text-white/75 outline-none"
              style={{ background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.09)', transition: 'border-color 110ms' }}
              onFocus={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)' }}
              onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)' }}
            />
            <button onClick={browse}
              className="ob-btn px-3 py-2 rounded-lg text-xs text-white/55 cursor-pointer border-0 flex items-center gap-1.5"
              style={{ background: 'rgba(255,255,255,0.07)' }}>
              <FolderOpen size={12} /> Browse
            </button>
          </div>
          {importPath && (
            <Glass>
              <div className="flex items-center gap-2">
                <FileCode size={13} className="text-green-400 flex-shrink-0" />
                <span className="text-xs text-white/55 font-mono truncate">{importPath}</span>
                <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded flex-shrink-0"
                  style={{ background: 'rgba(74,222,128,0.12)', color: '#4ade80' }}>
                  imports on finish
                </span>
              </div>
            </Glass>
          )}
        </div>
      )}

      {source === 'git' && (
        <div className="flex flex-col gap-2">
          <label className="text-[10px] text-white/28 uppercase tracking-widest font-semibold">Repository URL</label>
          <input type="text" value={gitUrl} onChange={e => onGitUrl(e.target.value)}
            placeholder="https://github.com/user/my-sketch.git"
            className="px-3 py-2 rounded-lg font-mono text-xs text-white/75 outline-none w-full"
            style={{ background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.09)', transition: 'border-color 110ms' }}
            onFocus={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)' }}
            onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)' }}
          />
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Step: CLI
// ─────────────────────────────────────────────────────────────────────────────

function StepCli({ path, onPath, detecting, detected, onDetect }: {
  path: string; onPath: (v: string) => void
  detecting: boolean; detected: 'ok'|'fail'|null; onDetect: () => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-white/45 leading-relaxed">
        The IDE needs the <code className="font-mono text-white/68 bg-white/8 px-1.5 py-0.5 rounded text-xs">tsuki</code> CLI binary to build and flash.
      </p>
      <button onClick={onDetect} disabled={detecting}
        className={clsx(
          'ob-btn flex items-center justify-center gap-3 px-4 py-4 rounded-2xl text-sm font-medium cursor-pointer border-0 w-full',
          detected === 'ok'
            ? 'bg-green-500/15 ring-1 ring-green-400/30 text-green-400'
            : 'bg-white/[0.055] ring-1 ring-white/10 text-white/68 hover:bg-white/10',
        )}>
        {detecting
          ? <><RefreshCw size={16} className="animate-spin" /> Searching for tsuki…</>
          : detected === 'ok'
            ? <><Check size={16} className="ob-check" /> Found — path saved</>
            : <><Zap size={16} /> Auto-detect tsuki</>}
      </button>
      {detected === 'fail' && (
        <p className="text-xs text-yellow-400/80 flex items-center gap-2">
          <AlertCircle size={12} /> Not found — paste the full path below
        </p>
      )}
      <div className="flex flex-col gap-2">
        <label className="text-[10px] text-white/28 uppercase tracking-widest font-semibold">Manual path</label>
        <input type="text" value={path} onChange={e => onPath(e.target.value)}
          placeholder="/usr/local/bin/tsuki  ·  C:\tsuki\tsuki.exe"
          className="w-full px-4 py-2.5 rounded-xl font-mono text-xs text-white/78 outline-none"
          style={{ background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.09)', transition: 'border-color 110ms' }}
          onFocus={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)' }}
          onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)' }}
        />
      </div>
      <Glass>
        <div className="text-[10px] text-white/28 uppercase tracking-widest font-semibold mb-3">Don't have tsuki yet?</div>
        {[
          { os: 'macOS / Linux', cmd: 'curl -fsSL https://tsuki.sh/install.sh | sh' },
          { os: 'Windows',       cmd: 'winget install tsuki' },
        ].map(x => (
          <div key={x.os} className="mb-2.5 last:mb-0">
            <div className="text-[10px] text-white/22 mb-1">{x.os}</div>
            <code className="block text-[11px] font-mono text-white/55 px-3 py-1.5 rounded-lg select-all"
              style={{ background: 'rgba(255,255,255,0.055)' }}>{x.cmd}</code>
          </div>
        ))}
      </Glass>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Step: Updates
// ─────────────────────────────────────────────────────────────────────────────

function StepUpdates({ channel, onChannel, checking, result, onCheck }: {
  channel: 'stable'|'testing'; onChannel: (v: 'stable'|'testing') => void
  checking: boolean; result: 'ok'|'fail'|null; onCheck: () => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-white/45">Change anytime in Settings → Updates.</p>
      <div className="ob-stagger flex flex-col gap-2.5">
        {([
          { id: 'stable'  as const, e: '🏔️', t: 'Stable',  d: 'Tested releases. Recommended for most users.',  badge: 'recommended', bc: 'rgba(74,222,128,0.15)',  tc: '#4ade80' },
          { id: 'testing' as const, e: '🧪', t: 'Testing', d: 'Early builds. You may encounter rough edges.',  badge: 'beta',         bc: 'rgba(251,191,36,0.15)', tc: '#fbbf24' },
        ]).map(opt => {
          const active = channel === opt.id
          return (
            <button key={opt.id} onClick={() => onChannel(opt.id)}
              className={clsx('ob-card-item flex items-start gap-4 px-5 py-4 rounded-2xl text-left border-0',
                active ? 'ring-2 ring-white/28' : 'ring-1 ring-white/7')}
              style={{ background: active ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.04)' }}>
              <span className="text-2xl mt-0.5 leading-none">{opt.e}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold text-white/85">{opt.t}</span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                    style={{ background: opt.bc, color: opt.tc }}>{opt.badge}</span>
                </div>
                <p className="text-xs text-white/32">{opt.d}</p>
              </div>
              {active && <Check size={14} className="ob-check text-green-400 flex-shrink-0 mt-1" />}
            </button>
          )
        })}
      </div>
      <Glass>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/68 font-medium">Test connectivity</p>
            <p className="text-xs text-white/28 mt-0.5">Verify the {channel} endpoint is reachable</p>
          </div>
          <button onClick={onCheck} disabled={checking}
            className="ob-btn flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium cursor-pointer border-0"
            style={{
              background: 'rgba(255,255,255,0.08)',
              color: result === 'ok' ? '#4ade80' : result === 'fail' ? '#f87171' : 'rgba(255,255,255,0.58)',
            }}>
            {checking ? <RefreshCw size={12} className="animate-spin" /> : <Download size={12} />}
            {checking ? 'Checking…' : result === 'ok' ? '✓ Reachable' : result === 'fail' ? '✗ Failed' : 'Check'}
          </button>
        </div>
      </Glass>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Step: Tips
// ─────────────────────────────────────────────────────────────────────────────

function StepTips() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-white/45">Memorise these and you'll be fast from day one.</p>
      <div className="ob-stagger flex flex-col gap-1.5">
        {SHORTCUTS.map((s, i) => (
          <div key={i} className="flex items-center justify-between px-4 py-3 rounded-xl"
            style={{ background: s.color, border: '1px solid rgba(255,255,255,0.055)' }}>
            <span className="text-sm" style={{ color: s.tc, fontWeight: 500 }}>{s.desc}</span>
            <div className="flex items-center gap-1">
              {s.keys.map((k, ki) => (
                <span key={ki} className="flex items-center gap-1">
                  <kbd className="ob-kbd text-[10px] font-mono px-2 py-0.5 rounded-lg"
                    style={{ background: 'rgba(255,255,255,0.1)', color: s.tc, border: '1px solid rgba(255,255,255,0.15)' }}>{k}</kbd>
                  {ki < s.keys.length - 1 && <span className="text-white/18 text-[9px]">+</span>}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Step: Done
// ─────────────────────────────────────────────────────────────────────────────

function Confetti() {
  const pieces = Array.from({ length: 18 }, (_, i) => ({
    x: `${8 + (i / 17) * 84}%`,
    color: ['#4ade80','#60a5fa','#fbbf24','#f87171','#a78bfa','#fb923c'][i % 6],
    delay: `${(i * 0.12).toFixed(2)}s`,
    dur: `${0.8 + (i % 4) * 0.2}s`,
    size: 3 + (i % 3),
  }))
  return (
    <div className="absolute inset-x-0 top-0 pointer-events-none overflow-hidden h-28">
      {pieces.map((p, i) => (
        <div key={i} className="absolute rounded-sm"
          style={{
            left: p.x, top: 0, width: p.size, height: p.size * 1.8,
            background: p.color, opacity: 0.85,
            animation: `ob-confetti-fall ${p.dur} ease-in ${p.delay} both`,
          }} />
      ))}
    </div>
  )
}

function StepDone({ progress, username, theme, board, channel, plan, importSource }: {
  progress: number; username: string; theme: string; board: string
  channel: string; plan: string; importSource: ImportSource
}) {
  const items = [
    { label: 'Name',    value: username.trim() || '(skipped)',        ok: !!username.trim() },
    { label: 'Plan',    value: plan === 'pro' ? 'Pro (waitlist)' : 'Normal (free)', ok: true },
    { label: 'Theme',   value: THEMES.find(t => t.id === theme)?.name ?? theme,    ok: true },
    { label: 'Board',   value: BOARDS.find(b => b.id === board)?.label ?? board,   ok: true },
    { label: 'Updates', value: channel,                                              ok: true },
    { label: 'Import',  value: IMPORT_OPTIONS.find(o => o.id === importSource)?.label ?? importSource, ok: true },
  ]
  return (
    <div className="relative flex flex-col gap-5">
      <Confetti />
      <div>
        <div className="flex justify-between mb-2.5">
          <span className="text-xs text-white/35">Saving configuration…</span>
          <span className="text-xs font-mono text-white/35">{Math.round(progress)}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div className="h-full rounded-full bg-gradient-to-r from-green-500 via-emerald-400 to-green-400"
            style={{ width: `${progress}%`, transition: 'width 1100ms cubic-bezier(.4,0,.2,1)',
              boxShadow: progress > 50 ? '0 0 14px rgba(74,222,128,0.5)' : 'none' }} />
        </div>
      </div>
      <div className="ob-stagger flex flex-col gap-1.5">
        {items.map(row => (
          <div key={row.label} className="flex items-center justify-between px-4 py-2.5 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <span className="text-xs text-white/35">{row.label}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-white/68">{row.value}</span>
              {row.ok && <Check size={11} className="ob-check text-green-400/80" />}
            </div>
          </div>
        ))}
      </div>
      <p className="text-sm text-white/35 text-center leading-relaxed pt-1">
        Change anything anytime in <code className="font-mono text-white/58 bg-white/8 px-1.5 py-0.5 rounded text-xs">Settings</code>.<br />
        Let's build something. 🚀
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Root component
// ─────────────────────────────────────────────────────────────────────────────

interface OnboardingModalProps {
  onClose: () => void
  /** 'update' = forced re-show triggered by an update */
  mode?: 'first-run' | 'update'
  /** Version string that triggered the update re-show */
  forcedVersion?: string
}

export default function OnboardingModal({ onClose, mode = 'first-run', forcedVersion }: OnboardingModalProps) {
  const { settings, updateSetting, createProfile, profiles } = useStore()

  const [stepIdx,   setStepIdx]   = useState(0)
  const [dir,       setDir]       = useState<'f'|'b'>('f')
  const [animating, setAnimating] = useState(false)
  const [entered,   setEntered]   = useState(false)
  const [stepKey,   setStepKey]   = useState(0)

  const [username,  setUsername]  = useState(settings.username ?? '')
  const [avatarUrl, setAvatarUrl] = useState(settings.avatarDataUrl ?? '')
  const [board,     setBoard]     = useState(settings.defaultBoard ?? 'uno')
  const [theme,     setTheme]     = useState(settings.ideTheme ?? 'tsuki-dark')
  const [lang,      setLang]      = useState<'en'|'es'>(settings.language ?? 'en')
  const [channel,   setChannel]   = useState<'stable'|'testing'>(settings.updateChannel ?? 'stable')
  const [cliPath,   setCliPath]   = useState(settings.tsukiPath ?? '')
  const [plan,      setPlan]      = useState<'normal'|'pro'>((settings as any).plan ?? 'normal')

  const [importSource, setImportSource] = useState<ImportSource>('none')
  const [importPath,   setImportPath]   = useState('')
  const [gitUrl,       setGitUrl]       = useState('')

  const [detecting, setDetecting] = useState(false)
  const [detected,  setDetected]  = useState<'ok'|'fail'|null>(null)
  const [checking,  setChecking]  = useState(false)
  const [updateRes, setUpdateRes] = useState<'ok'|'fail'|null>(null)
  const [doneP,     setDoneP]     = useState(0)

  const step = STEPS[stepIdx]

  useEffect(() => { requestAnimationFrame(() => setEntered(true)) }, [])

  useEffect(() => {
    if (step.id !== 'done') return
    setDoneP(0)
    const t = setTimeout(() => setDoneP(100), 150)
    return () => clearTimeout(t)
  }, [step.id])

  useEffect(() => {
    import('@/lib/themes').then(({ applyTheme }) => applyTheme(theme, settings.syntaxTheme))
  }, [theme])

  function go(idx: number) {
    if (animating || idx < 0 || idx >= STEPS.length) return
    setDir(idx > stepIdx ? 'f' : 'b')
    setAnimating(true)
    // Must match ob-step-f / ob-step-b animation duration (200ms)
    setTimeout(() => {
      setStepIdx(idx)
      setStepKey(k => k + 1)
      setAnimating(false)
    }, 200)
  }

  function persist() {
    const s = STEPS[stepIdx]
    if (s.id === 'profile') {
      if (username.trim()) {
        if (!profiles.find(p => p.name === username.trim())) createProfile(username.trim(), avatarUrl)
        updateSetting('username', username.trim())
      }
      if (avatarUrl) updateSetting('avatarDataUrl', avatarUrl)
    }
    if (s.id === 'plan')     updateSetting('plan' as any, plan)
    if (s.id === 'theme')    updateSetting('ideTheme', theme)
    if (s.id === 'language') updateSetting('language', lang)
    if (s.id === 'board')    updateSetting('defaultBoard', board)
    if (s.id === 'cli')      { if (cliPath) updateSetting('tsukiPath', cliPath) }
    if (s.id === 'updates')  updateSetting('updateChannel', channel)
  }

  function next() {
    persist()
    if (step.id === 'done') { onClose(); return }
    go(stepIdx + 1)
  }

  async function detectCli() {
    setDetecting(true); setDetected(null)
    try {
      const { detectTool } = await import('@/lib/tauri')
      const p = await detectTool('tsuki')
      setCliPath(p); updateSetting('tsukiPath', p); setDetected('ok')
    } catch { setDetected('fail') }
    setDetecting(false)
  }

  async function checkUpdate() {
    setChecking(true); setUpdateRes(null)
    try {
      const { checkForUpdates } = await import('@/lib/tauri')
      const url = `https://tsuki.sh/api/update/${channel}`
      await checkForUpdates(channel, url)
      setUpdateRes('ok')
    } catch { setUpdateRes('fail') }
    setChecking(false)
  }

  const pct = ((stepIdx + 1) / STEPS.length) * 100

  return (
    <>
      <style>{CSS}</style>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center"
        style={{ opacity: entered ? 1 : 0, transition: 'opacity 320ms ease' }}>
        <AnimatedBg stepIdx={stepIdx} />

        {/* Step dots */}
        <div className="absolute top-5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
          {STEPS.map((s, i) => (
            <button key={s.id} onClick={() => go(i)} className="cursor-pointer border-0 bg-transparent p-1" title={s.title}>
              <div style={{
                height: 5,
                width: i === stepIdx ? 22 : i < stepIdx ? 6 : 5,
                borderRadius: 9999,
                background: i === stepIdx ? 'rgba(255,255,255,0.85)'
                  : i < stepIdx ? 'rgba(74,222,128,0.65)'
                  : 'rgba(255,255,255,0.18)',
                transition: 'all 280ms cubic-bezier(.4,0,.2,1)',
              }} />
            </button>
          ))}
        </div>

        {/* Counter */}
        <div className="absolute top-5 left-7 z-10 font-mono text-[11px] text-white/25 tracking-widest select-none">
          {String(stepIdx + 1).padStart(2,'0')} / {String(STEPS.length).padStart(2,'0')}
        </div>

        {/* Update mode badge */}
        {mode === 'update' && forcedVersion && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10">
            <span className="text-[10px] font-mono px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(96,165,250,0.14)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.2)' }}>
              ✦ Setup updated for v{forcedVersion}
            </span>
          </div>
        )}

        {/* Skip */}
        {step.skippable && (
          <button onClick={onClose}
            className="ob-btn absolute top-4 right-5 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] text-white/32 hover:text-white/65 cursor-pointer bg-transparent"
            style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
            <X size={11} /> Skip setup
          </button>
        )}

        {/* Main card */}
        <div className="ob-card relative w-[620px] max-w-[96vw] max-h-[90vh] flex flex-col rounded-3xl overflow-hidden"
          style={{
            background: 'rgba(8,8,10,0.88)',
            backdropFilter: 'blur(32px) saturate(1.6)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 50px 140px rgba(0,0,0,0.8), 0 0 0 0.5px rgba(255,255,255,0.04) inset, 0 1px 0 rgba(255,255,255,0.07) inset',
          }}>

          {/* Progress bar */}
          <div className="h-[2px] w-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <div className="ob-progress-bar h-full rounded-full"
              style={{ width: `${pct}%`, transition: 'width 440ms cubic-bezier(.4,0,.2,1)' }} />
          </div>

          {/* Header — keyed so it fades in cleanly on step change */}
          <div key={`hdr-${stepIdx}`} className="ob-header px-8 pt-7 pb-5 flex-shrink-0 border-b border-white/[0.055]">
            <div className="flex items-start gap-4">
              <div className="relative flex-shrink-0">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-[30px] select-none"
                  style={{
                    background: 'rgba(255,255,255,0.055)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
                  }}>
                  {step.emoji}
                </div>
                {step.id === 'done' && (
                  <div className="absolute inset-0 rounded-2xl" style={{ animation: 'ob-pulse-ring 1.6s ease-out infinite' }} />
                )}
              </div>
              <div className="flex-1 min-w-0 pt-1">
                <h2 className="text-[22px] font-semibold leading-tight tracking-tight text-white/90">{step.title}</h2>
                <p className="text-sm text-white/38 mt-1.5 leading-relaxed">{step.subtitle}</p>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto min-h-0 px-8 py-6"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}>
            <div key={stepKey} className={dir === 'f' ? 'ob-step-f' : 'ob-step-b'}>
              {step.id === 'welcome'  && <StepWelcome />}
              {step.id === 'plan'     && <StepPlan plan={plan} onSelect={setPlan} />}
              {step.id === 'profile'  && <StepProfile username={username} onUsername={setUsername} avatarUrl={avatarUrl} onAvatar={setAvatarUrl} />}
              {step.id === 'theme'    && <StepTheme selected={theme} onSelect={setTheme} />}
              {step.id === 'language' && <StepLanguage lang={lang} onSelect={setLang} />}
              {step.id === 'board'    && <StepBoard board={board} onSelect={setBoard} />}
              {step.id === 'import'   && <StepImport source={importSource} onSource={setImportSource} importPath={importPath} onImportPath={setImportPath} gitUrl={gitUrl} onGitUrl={setGitUrl} />}
              {step.id === 'cli'      && <StepCli path={cliPath} onPath={setCliPath} detecting={detecting} detected={detected} onDetect={detectCli} />}
              {step.id === 'updates'  && <StepUpdates channel={channel} onChannel={setChannel} checking={checking} result={updateRes} onCheck={checkUpdate} />}
              {step.id === 'tips'     && <StepTips />}
              {step.id === 'done'     && <StepDone progress={doneP} username={username} theme={theme} board={board} channel={channel} plan={plan} importSource={importSource} />}
            </div>
          </div>

          {/* Footer */}
          <div className="px-8 py-5 flex items-center justify-between flex-shrink-0 border-t border-white/[0.055]"
            style={{ background: 'rgba(0,0,0,0.22)' }}>
            <button onClick={() => go(stepIdx - 1)} disabled={stepIdx === 0 || animating}
              className="ob-btn flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm text-white/35 hover:text-white/65 hover:bg-white/5 cursor-pointer border bg-transparent disabled:opacity-0"
              style={{ borderColor: 'rgba(255,255,255,0.09)' }}>
              <ChevronLeft size={14} /> Back
            </button>

            <button onClick={next} disabled={animating}
              className={clsx(
                'ob-btn flex items-center gap-2 px-7 py-2.5 rounded-xl text-sm font-semibold cursor-pointer border-0',
                step.id === 'done'
                  ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white'
                  : 'bg-white/90 text-black',
              )}>
              {step.id === 'done'
                ? <><Sparkles size={14} /> Open the IDE</>
                : <>Continue <ChevronRight size={14} /></>}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}