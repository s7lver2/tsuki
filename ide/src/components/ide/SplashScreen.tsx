'use client'
import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { useT } from '@/lib/i18n'

interface SplashScreenProps {
  /** When true the bar fills to 100% and triggers the fade-out */
  ready: boolean
  onDone: () => void
}

export default function SplashScreen({ ready, onDone }: SplashScreenProps) {
  const [progress, setProgress]     = useState(0)
  const [fading,   setFading]       = useState(false)
  const [visible,  setVisible]      = useState(true)

  // Simulate incremental loading progress
  useEffect(() => {
    // Phase 1: fast ramp to ~70% over ~600 ms
    const ticks: NodeJS.Timeout[] = []
    let p = 0
    const PHASE1 = [
      { to: 20, ms: 80  },
      { to: 45, ms: 140 },
      { to: 65, ms: 200 },
      { to: 72, ms: 100 },
    ]
    let elapsed = 0
    PHASE1.forEach(({ to, ms }) => {
      elapsed += ms
      ticks.push(setTimeout(() => setProgress(to), elapsed))
    })
    return () => ticks.forEach(clearTimeout)
  }, [])

  // Phase 2: when ready=true, fill to 100% then fade out
  useEffect(() => {
    if (!ready) return
    setProgress(100)
    const t1 = setTimeout(() => setFading(true), 350)
    const t2 = setTimeout(() => { setVisible(false); onDone() }, 700)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [ready, onDone])

  if (!visible) return null

  return (
    <div
      className={clsx(
        'fixed inset-0 z-[9999] flex flex-col items-center justify-center select-none',
        'bg-[var(--surface)] transition-opacity duration-350',
        fading ? 'opacity-0' : 'opacity-100',
      )}
    >
      {/* Logo mark */}
      <div className="flex flex-col items-center gap-6 mb-12">
        <div className="relative">
          {/* Outer glow ring */}
          <div
            className="absolute inset-0 rounded-2xl opacity-20 blur-xl"
            style={{ background: 'var(--fg)', transform: 'scale(1.4)' }}
          />
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center relative"
            style={{ background: 'var(--fg)' }}
          >
            <span
              className="font-mono font-bold text-2xl leading-none"
              style={{ color: 'var(--surface)' }}
            >
              G
            </span>
          </div>
        </div>

        <div className="text-center">
          <div className="text-lg font-semibold tracking-tight" style={{ color: 'var(--fg)' }}>
            Tsuki IDE
          </div>
          <div className="text-xs mt-1 font-mono" style={{ color: 'var(--fg-faint)' }}>
            Go · Arduino · Firmware
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-48 flex flex-col items-center gap-3">
        <div
          className="w-full h-[2px] rounded-full overflow-hidden"
          style={{ background: 'var(--border)' }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${progress}%`,
              background: 'var(--fg)',
              transitionDuration: progress === 100 ? '300ms' : '600ms',
              transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />
        </div>
        <LoadingLabel progress={progress} />
      </div>
    </div>
  )
}

function LoadingLabel({ progress }: { progress: number }) {
  const t = useT()
  const LABELS: [number, string][] = [
    [0,   t('splash.starting')],
    [20,  t('splash.modules')],
    [45,  t('splash.theme')],
    [65,  t('splash.workspace')],
    [90,  t('splash.almost')],
    [100, t('splash.ready')],
  ]
  const label = [...LABELS].reverse().find(([p]) => progress >= p)?.[1] ?? t('splash.starting')
  return (
    <span
      className="text-[10px] font-mono transition-all duration-200"
      style={{ color: 'var(--fg-faint)' }}
    >
      {label}
    </span>
  )
}