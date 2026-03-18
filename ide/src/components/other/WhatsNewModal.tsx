'use client'
import { useState, useEffect } from 'react'
import { X, Sparkles, ChevronRight, Star, Zap, Bug, ArrowUpRight } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ChangelogEntry {
  type: 'feature' | 'improvement' | 'fix' | 'breaking'
  text: string
}

export interface WhatsNewModalProps {
  version: string
  entries: ChangelogEntry[]
  onClose: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
//  CSS
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
  @keyframes wn-bg-in {
    from { opacity:0; }
    to   { opacity:1; }
  }
  @keyframes wn-card-in {
    from { opacity:0; transform:scale(0.93) translateY(24px); }
    to   { opacity:1; transform:scale(1)    translateY(0); }
  }
  @keyframes wn-stagger {
    from { opacity:0; transform:translateY(8px); }
    to   { opacity:1; transform:translateY(0); }
  }
  @keyframes wn-badge-pop {
    0%   { transform:scale(0.7); opacity:0; }
    70%  { transform:scale(1.08); opacity:1; }
    100% { transform:scale(1); opacity:1; }
  }
  @keyframes wn-shimmer {
    from { background-position: -200% center; }
    to   { background-position:  200% center; }
  }

  .wn-bg   { animation: wn-bg-in   200ms ease both; }
  .wn-card { animation: wn-card-in 380ms cubic-bezier(.2,0,.1,1) both; }
  .wn-rows > * { animation: wn-stagger 220ms ease both; }
  .wn-rows > *:nth-child(1)  { animation-delay: 80ms; }
  .wn-rows > *:nth-child(2)  { animation-delay: 110ms; }
  .wn-rows > *:nth-child(3)  { animation-delay: 140ms; }
  .wn-rows > *:nth-child(4)  { animation-delay: 168ms; }
  .wn-rows > *:nth-child(5)  { animation-delay: 194ms; }
  .wn-rows > *:nth-child(6)  { animation-delay: 218ms; }
  .wn-rows > *:nth-child(7)  { animation-delay: 240ms; }
  .wn-rows > *:nth-child(8)  { animation-delay: 260ms; }
  .wn-rows > *:nth-child(9)  { animation-delay: 278ms; }
  .wn-rows > *:nth-child(10) { animation-delay: 295ms; }
  .wn-badge { animation: wn-badge-pop 320ms cubic-bezier(.2,0,.1,1) 60ms both; }
  .wn-dismiss {
    transition: background 110ms ease, color 110ms ease, transform 90ms ease;
  }
  .wn-dismiss:hover { transform:translateY(-1px); }
  .wn-dismiss:active { transform:scale(0.97); }
  .wn-version-shine {
    background: linear-gradient(90deg, #ededed 0%, #fff 40%, #ededed 60%, #a0a0a0 100%);
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: wn-shimmer 3s linear 400ms both;
  }
`

// ─────────────────────────────────────────────────────────────────────────────
//  Entry type config
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  feature:     { label: 'New',      color: '#4ade80', bg: 'rgba(74,222,128,0.12)',  icon: Star  },
  improvement: { label: 'Improved', color: '#60a5fa', bg: 'rgba(96,165,250,0.12)', icon: Zap   },
  fix:         { label: 'Fixed',    color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', icon: Bug   },
  breaking:    { label: 'Breaking', color: '#f87171', bg: 'rgba(248,113,113,0.12)', icon: X    },
} as const

// ─────────────────────────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────────────────────────

export default function WhatsNewModal({ version, entries, onClose }: WhatsNewModalProps) {
  const [entered, setEntered] = useState(false)
  useEffect(() => { requestAnimationFrame(() => setEntered(true)) }, [])

  // Group entries by type for ordering: features first, then improvements, fixes, breaking
  const order: ChangelogEntry['type'][] = ['feature', 'improvement', 'fix', 'breaking']
  const sorted = [...entries].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))

  const featureCount = entries.filter(e => e.type === 'feature').length

  return (
    <>
      <style>{CSS}</style>

      {/* Backdrop */}
      <div
        className="wn-bg fixed inset-0 z-[10000] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
      >
        {/* Card */}
        <div className="wn-card relative w-[560px] max-w-[95vw] max-h-[85vh] flex flex-col rounded-3xl overflow-hidden"
          style={{
            background: 'rgba(10,10,12,0.96)',
            border: '1px solid rgba(255,255,255,0.09)',
            boxShadow: '0 40px 120px rgba(0,0,0,0.75), 0 0 0 0.5px rgba(255,255,255,0.04) inset',
          }}>

          {/* Top accent line */}
          <div className="h-[2px] w-full flex-shrink-0"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(74,222,128,0.7) 30%, rgba(96,165,250,0.7) 70%, transparent)',
            }} />

          {/* Header */}
          <div className="px-7 pt-7 pb-5 flex-shrink-0 border-b border-white/[0.055]">
            <button onClick={onClose}
              className="absolute top-4 right-4 wn-dismiss w-7 h-7 rounded-full flex items-center justify-center cursor-pointer border-0"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}>
              <X size={13} />
            </button>

            <div className="flex items-start gap-4">
              <div className="wn-badge w-14 h-14 rounded-2xl flex items-center justify-center text-[26px] flex-shrink-0"
                style={{
                  background: 'linear-gradient(135deg, rgba(74,222,128,0.18) 0%, rgba(96,165,250,0.14) 100%)',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}>
                <Sparkles size={24} className="text-white/80" />
              </div>
              <div className="pt-1">
                <div className="flex items-center gap-2.5 mb-1">
                  <h2 className="text-xl font-bold tracking-tight text-white/90">What's New</h2>
                  <span className="wn-version-shine text-xl font-bold tracking-tight">v{version}</span>
                </div>
                <p className="text-xs text-white/35 leading-relaxed">
                  {featureCount > 0
                    ? `${featureCount} new feature${featureCount > 1 ? 's' : ''} and ${entries.length - featureCount} improvements in this release.`
                    : `${entries.length} improvement${entries.length > 1 ? 's' : ''} in this release.`}
                </p>
              </div>
            </div>
          </div>

          {/* Changelog list */}
          <div className="flex-1 overflow-y-auto min-h-0 px-7 py-5"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.07) transparent' }}>
            <div className="wn-rows flex flex-col gap-2">
              {sorted.map((entry, i) => {
                const cfg = TYPE_CONFIG[entry.type]
                const Icon = cfg.icon
                return (
                  <div key={i}
                    className="flex items-start gap-3 px-4 py-3 rounded-xl"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.055)' }}>
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ background: cfg.bg }}>
                      <Icon size={12} style={{ color: cfg.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[9px] font-mono font-semibold uppercase tracking-wider mr-2"
                        style={{ color: cfg.color }}>{cfg.label}</span>
                      <span className="text-sm text-white/72 leading-relaxed">{entry.text}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="px-7 py-4 flex items-center justify-between flex-shrink-0 border-t border-white/[0.055]"
            style={{ background: 'rgba(0,0,0,0.2)' }}>
            <a
              href="https://tsuki.sh/changelog"
              target="_blank"
              rel="noopener noreferrer"
              className="wn-dismiss flex items-center gap-1 text-xs text-white/28 hover:text-white/55 cursor-pointer"
              style={{ textDecoration: 'none' }}>
              Full changelog <ArrowUpRight size={11} />
            </a>
            <button onClick={onClose}
              className="wn-dismiss flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold cursor-pointer border-0 bg-white/90 text-black">
              Got it <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}