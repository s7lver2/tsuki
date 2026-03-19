'use client'
import { useEffect, useRef, useState } from 'react'
import { Globe } from 'lucide-react'

// ── Animated "Coming Soon" preview for tsuki-webkit ───────────────────────────

const DEMO_LINES = [
  { t: 0,    text: "import { Api, Serial } from 'tsuki-webkit'",  color: '#7dd3fc' },
  { t: 180,  text: '',                                             color: '' },
  { t: 200,  text: 'export default function App() {',             color: '#c4b5fd' },
  { t: 380,  text: '  return (',                                  color: '#94a3b8' },
  { t: 480,  text: '    <div className="wk-card">',               color: '#86efac' },
  { t: 580,  text: '      <h1>ESP Dashboard</h1>',                color: '#e2e8f0' },
  { t: 700,  text: '      <button className="wk-btn"',            color: '#e2e8f0' },
  { t: 820,  text: "        onClick={() => Api.get('/api/led',",   color: '#fde68a' },
  { t: 940,  text: '          d => Serial.log(d))}>',             color: '#fde68a' },
  { t: 1040, text: '        Toggle LED',                          color: '#e2e8f0' },
  { t: 1100, text: '      </button>',                             color: '#e2e8f0' },
  { t: 1160, text: '    </div>',                                   color: '#86efac' },
  { t: 1220, text: '  )',                                          color: '#94a3b8' },
  { t: 1280, text: '}',                                            color: '#c4b5fd' },
]

const PIPELINE = [
  { delay: 2200, label: 'compiling JSX…',    color: '#60a5fa' },
  { delay: 2800, label: 'generating C++…',   color: '#a78bfa' },
  { delay: 3400, label: 'injecting PROGMEM', color: '#34d399' },
  { delay: 3900, label: 'ready ✓',           color: '#4ade80' },
]

interface Props {
  compact?:      boolean
  simulateMode?: boolean
  onClose?:      () => void
}

export default function WebkitPanel(_props: Props) {
  const [visibleLines, setVisibleLines] = useState(0)
  const [stepIdx,      setStepIdx]      = useState(-1)
  const [showPreview,  setShowPreview]  = useState(false)
  const [cycle,        setCycle]        = useState(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setVisibleLines(0)
    setStepIdx(-1)
    setShowPreview(false)

    DEMO_LINES.forEach((line, i) => {
      timers.current.push(setTimeout(() => setVisibleLines(i + 1), line.t))
    })
    PIPELINE.forEach((step, i) => {
      timers.current.push(setTimeout(() => setStepIdx(i), step.delay))
    })
    timers.current.push(setTimeout(() => setShowPreview(true), 4200))
    timers.current.push(setTimeout(() => setCycle(c => c + 1), 7500))

    return () => timers.current.forEach(clearTimeout)
  }, [cycle])

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--surface)] select-none">

      {/* Header */}
      <div className="h-8 flex items-center gap-2 px-3 border-b border-[var(--border)] bg-[var(--surface-1)] flex-shrink-0">
        <Globe size={11} className="text-emerald-400 flex-shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-faint)]">
          tsuki-webkit
        </span>
        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20">
          próximamente
        </span>
      </div>

      {/* Demo area */}
      <div className="flex-1 overflow-hidden flex flex-col p-3 gap-3 min-h-0">

        {/* Code editor mockup */}
        <div className="flex-1 rounded-lg bg-[#0f172a] border border-[#1e293b] overflow-hidden flex flex-col min-h-0">
          <div className="h-7 flex items-center gap-1.5 px-3 bg-[#1e293b] flex-shrink-0">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
            <span className="ml-2 text-[10px] font-mono text-[#475569]">app.jsx</span>
          </div>
          <div className="flex-1 overflow-hidden p-3 font-mono text-[11px] leading-[19px]">
            {DEMO_LINES.slice(0, visibleLines).map((line, i) => (
              <div key={i} style={{ color: line.color || '#475569' }}>
                {line.text || '\u00a0'}
                {i === visibleLines - 1 && (
                  <span className="inline-block w-[2px] h-[13px] bg-blue-400 ml-0.5 align-middle animate-pulse" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Pipeline */}
        <div className="flex-shrink-0 flex flex-col gap-1.5">
          {PIPELINE.map((step, i) => (
            <div key={i} className="flex items-center gap-2 transition-all duration-300"
              style={{ opacity: i <= stepIdx ? 1 : 0.18 }}>
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: i <= stepIdx ? step.color : '#334155' }} />
              <span className="text-[10px] font-mono"
                style={{ color: i <= stepIdx ? step.color : '#475569' }}>
                {step.label}
              </span>
              {i === stepIdx && i < PIPELINE.length - 1 && (
                <span className="text-[9px] text-[#475569] animate-pulse ml-1">●●●</span>
              )}
            </div>
          ))}
        </div>

        {/* Animated preview */}
        <div className="flex-shrink-0 rounded-lg border border-[#1e293b] bg-[#0f172a] overflow-hidden"
          style={{
            height: showPreview ? 96 : 0,
            opacity: showPreview ? 1 : 0,
            transition: 'height 0.4s ease, opacity 0.4s ease',
          }}>
          <div className="p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-emerald-400 font-mono">192.168.1.42 / ESP8266</span>
            </div>
            <p className="text-[12px] text-[#e2e8f0] font-semibold">ESP Dashboard</p>
            <div className="flex items-center gap-2">
              <div className="px-2.5 py-1 rounded text-[11px] font-medium text-white"
                style={{ background: 'linear-gradient(135deg,#3b82f6,#2563eb)' }}>
                Toggle LED
              </div>
              <span className="text-[10px] font-mono text-emerald-400 bg-[#020617] border border-[#064e3b] px-1.5 py-0.5 rounded">
                {'> led: on'}
              </span>
            </div>
          </div>
        </div>

        {/* Feature list */}
        <div className="flex-shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
          <p className="text-[9px] font-semibold text-[var(--fg-faint)] uppercase tracking-widest mb-2">
            Qué incluirá
          </p>
          {[
            ['🌐', 'JSX → HTML/CSS/JS compilado en el IDE'],
            ['⚡', 'Servidor web embebido ESP8266/ESP32'],
            ['📡', 'Simulación de rutas API sin hardware'],
            ['🔌', 'Consola Serial integrada'],
            ['📦', 'Sin dependencias — todo en <tsuki-webkit.h>'],
          ].map(([icon, text], i) => (
            <div key={i} className="flex items-start gap-1.5 mb-1">
              <span className="text-[11px] flex-shrink-0 leading-tight">{icon}</span>
              <span className="text-[10px] text-[var(--fg-muted)] leading-relaxed">{text}</span>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}