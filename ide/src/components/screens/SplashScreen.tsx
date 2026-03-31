'use client'
import TsukiLogo from '@/components/shared/TsukiLogo'
import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { useT } from '@/lib/i18n'

interface SplashScreenProps {
  /** When true the bar fills to 100% and triggers the fade-out */
  ready: boolean
  onDone: () => void
}

export default function SplashScreen({ ready, onDone }: SplashScreenProps) {
  const [progress, setProgress] = useState(0)
  const [fading,   setFading]   = useState(false)
  const [visible,  setVisible]  = useState(true)

  // Phase 1: incremental ramp to ~72% while the app loads
  useEffect(() => {
    const ticks: NodeJS.Timeout[] = []
    const PHASE1 = [
      { to: 20, ms: 80  },
      { to: 45, ms: 220 },
      { to: 65, ms: 420 },
      { to: 72, ms: 520 },
    ]
    PHASE1.forEach(({ to, ms }) => {
      ticks.push(setTimeout(() => setProgress(to), ms))
    })
    return () => ticks.forEach(clearTimeout)
  }, [])

  // Phase 2: when ready=true, fill to 100% then fade out
  useEffect(() => {
    if (!ready) return
    setProgress(100)
    const t1 = setTimeout(() => setFading(true), 350)
    const t2 = setTimeout(() => { setVisible(false); onDone() }, 650)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [ready, onDone])

  if (!visible) return null

  return (
    <div
      className={clsx(
        'fixed inset-0 z-[9999] flex flex-col items-center justify-center select-none',
        'transition-opacity duration-300',
        fading ? 'opacity-0' : 'opacity-100',
      )}
      style={{ background: 'var(--surface)' }}
    >
      {/* Content block — fades up on mount */}
      <div className="flex flex-col items-center gap-8 animate-fade-up">

        {/* Logo + wordmark */}
        <div className="flex flex-col items-center gap-5">
          <TsukiLogo size="lg" />

          <div className="flex flex-col items-center gap-1 text-center">
            <span
              className="text-lg font-semibold tracking-tight"
              style={{ color: 'var(--fg)', letterSpacing: '-0.02em' }}
            >
              tsuki
            </span>
            <span
              className="text-[10px] font-mono uppercase"
              style={{ color: 'var(--fg-faint)', letterSpacing: '0.12em' }}
            >
              Go · Arduino · Firmware
            </span>
          </div>
        </div>

        {/* Progress + label */}
        <div className="flex flex-col items-center gap-2.5 w-40">
          {/* Track */}
          <div
            className="w-full h-[1px] rounded-full overflow-hidden"
            style={{ background: 'var(--border)' }}
          >
            {/* Fill — uses --fg-muted to stay strictly neutral */}
            <div
              className="h-full rounded-full"
              style={{
                width: `${progress}%`,
                background: 'var(--fg-muted)',
                transition: progress === 100
                  ? 'width 280ms cubic-bezier(0.4,0,0.2,1)'
                  : 'width 580ms cubic-bezier(0.4,0,0.2,1)',
              }}
            />
          </div>

          <LoadingLabel progress={progress} />
        </div>
      </div>

      {/* Version stamp — bottom left, very faint */}
      <span
        className="absolute bottom-5 left-5 text-[10px] font-mono"
        style={{ color: 'var(--fg-faint)' }}
      >
        tsuki ide
      </span>
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
      style={{ color: 'var(--fg-faint)', letterSpacing: '0.04em' }}
    >
      {label}
    </span>
  )
}