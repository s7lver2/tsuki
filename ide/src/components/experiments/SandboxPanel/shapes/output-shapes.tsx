'use client'

// ── LED ────────────────────────────────────────────────────────────────────────
export function LedBody({ w, h, color, brightness, g }: {
  w: number; h: number; color: string; brightness: number; g: string
}) {
  const on      = brightness > 0.02
  const opacity = on ? 0.35 + brightness * 0.65 : 0.25
  const glowR   = on ? 10 + brightness * 16 : 0
  const glowOp  = brightness * 0.18
  return (
    <>
      <defs>
        <radialGradient id={`led_${g}`} cx="50%" cy="35%" r="60%">
          <stop offset="0%"   stopColor="white"  stopOpacity={on ? 0.6 + brightness * 0.3 : 0.15} />
          <stop offset="40%"  stopColor={color}  stopOpacity={0.8} />
          <stop offset="100%" stopColor={color}  stopOpacity={0.3} />
        </radialGradient>
        {on && (
          <filter id={`glow_${g}`} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation={2 + brightness * 3} result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        )}
      </defs>
      {on && <ellipse cx={w/2} cy={h*0.4} rx={glowR} ry={glowR} fill={color} opacity={glowOp} />}
      <line x1={w*0.38} y1={0}      x2={w*0.38} y2={h*0.24} stroke="#aaa" strokeWidth={1.5} />
      <line x1={w*0.62} y1={0}      x2={w*0.62} y2={h*0.24} stroke="#aaa" strokeWidth={1.5} />
      <line x1={w*0.38} y1={h*0.72} x2={w*0.38} y2={h}      stroke="#aaa" strokeWidth={1.5} />
      <line x1={w*0.62} y1={h*0.72} x2={w*0.62} y2={h}      stroke="#aaa" strokeWidth={1.5} />
      <rect x={w*0.12} y={h*0.24} width={w*0.76} height={h*0.25} rx={2}
        fill={`url(#led_${g})`} stroke={color} strokeWidth={0.8} opacity={opacity} />
      <ellipse cx={w/2} cy={h*0.44} rx={w*0.40} ry={h*0.20}
        fill={`url(#led_${g})`} stroke={color} strokeWidth={0.8} opacity={opacity}
        filter={on ? `url(#glow_${g})` : undefined} />
      <rect x={w*0.35} y={h*0.44} width={w*0.14} height={h*0.06} fill="rgba(0,0,0,0.4)" rx={1} />
      {brightness > 0.3 && <ellipse cx={w*0.43} cy={h*0.38} rx={w*0.08} ry={h*0.04}
        fill="white" opacity={brightness * 0.7} />}
      <text x={w*0.28} y={h*0.18} fontSize={7} fill="rgba(255,255,255,0.5)" fontFamily="monospace">+</text>
      <text x={w*0.60} y={h*0.18} fontSize={7} fill="rgba(255,255,255,0.5)" fontFamily="monospace">-</text>
    </>
  )
}

// ── RGB LED ────────────────────────────────────────────────────────────────────
export function RgbLedBody({ w, h, r, gr, b, g }: {
  w: number; h: number; r: number; gr: number; b: number; g: string
}) {
  const hex = `rgb(${Math.round(r)},${Math.round(gr)},${Math.round(b)})`
  const on  = r > 0 || gr > 0 || b > 0
  return (
    <>
      <defs>
        <radialGradient id={`rgb_${g}`} cx="50%" cy="35%" r="65%">
          <stop offset="0%"   stopColor="white" stopOpacity={on ? 0.8 : 0.2} />
          <stop offset="100%" stopColor={hex}   stopOpacity={on ? 0.7 : 0.2} />
        </radialGradient>
      </defs>
      {on && <ellipse cx={w/2} cy={h*0.4} rx={20} ry={20} fill={hex} opacity={0.12} />}
      <line x1={w*0.25} y1={0} x2={w*0.25} y2={h*0.25} stroke="#aaa" strokeWidth={1.5} />
      <line x1={w*0.5}  y1={0} x2={w*0.5}  y2={h*0.25} stroke="#aaa" strokeWidth={1.5} />
      <line x1={w*0.75} y1={0} x2={w*0.75} y2={h*0.25} stroke="#aaa" strokeWidth={1.5} />
      <line x1={w*0.5}  y1={h*0.72} x2={w*0.5} y2={h}  stroke="#aaa" strokeWidth={1.5} />
      <rect x={w*0.1} y={h*0.25} width={w*0.8} height={h*0.22} rx={2}
        fill={`url(#rgb_${g})`} stroke={hex} strokeWidth={0.8} />
      <ellipse cx={w/2} cy={h*0.44} rx={w*0.40} ry={h*0.18}
        fill={`url(#rgb_${g})`} stroke={hex} strokeWidth={0.8} />
    </>
  )
}

// ── Buzzer ─────────────────────────────────────────────────────────────────────
export function BuzzerBody({ w, h, active }: { w: number; h: number; active: boolean }) {
  const cx = w / 2, cy = h / 2
  const r  = Math.min(w, h) / 2 - 2
  return (
    <>
      {/* Outer glow when active */}
      {active && (
        <circle cx={cx} cy={cy} r={r + 4} fill="#f97316" opacity={0.12} />
      )}

      {/* Main body — black cylinder top-view */}
      <circle cx={cx} cy={cy} r={r}
        fill={active ? '#222' : '#1a1a1a'}
        stroke={active ? '#f97316' : '#555'} strokeWidth={active ? 1.5 : 1} />

      {/* Slight highlight arc top-left */}
      <path
        d={`M ${cx - r*0.6} ${cy - r*0.5} A ${r} ${r} 0 0 1 ${cx + r*0.3} ${cy - r*0.8}`}
        fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={2} strokeLinecap="round" />

      {/* Concentric rings — the piezo disc */}
      {[0.65, 0.42, 0.22].map((ratio, i) => (
        <circle key={i} cx={cx} cy={cy} r={r * ratio}
          fill="none"
          stroke={active ? `rgba(249,115,22,${0.55 - i * 0.12})` : `rgba(120,100,60,${0.45 - i * 0.1})`}
          strokeWidth={0.9} />
      ))}

      {/* Center contact dot */}
      <circle cx={cx} cy={cy} r={r * 0.10}
        fill={active ? '#f97316' : '#4a3a1a'} />

      {/* + pin marker */}
      <text x={cx - r * 0.52} y={cy - r * 0.68}
        textAnchor="middle" fontSize={Math.max(5, r * 0.30)}
        fill={active ? '#f97316' : '#666'} fontFamily="monospace" fontWeight="700">+</text>

      {/* Active sound-wave arcs */}
      {active && (
        <>
          <path d={`M ${cx + r*1.05} ${cy - r*0.3} Q ${cx + r*1.35} ${cy} ${cx + r*1.05} ${cy + r*0.3}`}
            fill="none" stroke="#f97316" strokeWidth={1.2} strokeLinecap="round" opacity={0.5} />
          <path d={`M ${cx + r*1.25} ${cy - r*0.55} Q ${cx + r*1.7} ${cy} ${cx + r*1.25} ${cy + r*0.55}`}
            fill="none" stroke="#f97316" strokeWidth={1} strokeLinecap="round" opacity={0.3} />
        </>
      )}
    </>
  )
}

// ── Servo ──────────────────────────────────────────────────────────────────────
export function ServoBody({ w, h, val, g }: { w: number; h: number; val: number; g: string }) {
  const angle = val * 180 - 90
  return (
    <>
      <rect width={w} height={h} rx={4} fill="#2a2a2a" stroke="#444" strokeWidth={0.8} />
      <rect x={2} y={2} width={w-4} height={h-4} rx={3} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={0.5} />
      <rect x={w*0.1} y={h*0.15} width={w*0.8} height={h*0.55} rx={2} fill="#333" />
      <g transform={`translate(${w/2},${h*0.42}) rotate(${angle})`}>
        <rect x={-4} y={-20} width={8} height={22} rx={4} fill="#e0e0e0" stroke="#aaa" strokeWidth={0.5} />
        <circle cx={0} cy={-18} r={2.5} fill="#888" />
      </g>
      <circle cx={w/2} cy={h*0.42} r={5} fill="#555" stroke="#777" strokeWidth={0.5} />
      <text x={w/2} y={h*0.85} textAnchor="middle" fontSize={6} fill="#888" fontFamily="monospace">SERVO</text>
    </>
  )
}

// ── LCD 16x2 ───────────────────────────────────────────────────────────────────
export function LcdBody({ w, h, lines, g }: { w: number; h: number; lines: string[]; g: string }) {
  const bg = '#1e5a2a'
  return (
    <>
      <defs>
        <linearGradient id={`lcd_${g}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor={bg} />
          <stop offset="100%" stopColor="#143d1c" />
        </linearGradient>
      </defs>
      <rect width={w} height={h} rx={3} fill={`url(#lcd_${g})`} />
      <rect x={1.5} y={1.5} width={w-3} height={h-3} rx={2} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
      <rect x={w*0.03} y={h*0.08} width={w*0.94} height={h*0.72} rx={2} fill="#2d6e35" />
      {Array.from({length:16}, (_,col) =>
        Array.from({length:2}, (_,row) => (
          <rect key={`${col}-${row}`}
            x={w*(0.05 + col*0.057)} y={h*(0.11 + row*0.32)}
            width={w*0.050} height={h*0.28}
            fill="none" stroke="rgba(0,200,0,0.12)" strokeWidth={0.4} />
        ))
      ).flat()}
      {lines[0] && (
        <text x={w*0.06} y={h*0.32} fontSize={5.5} fill="rgba(0,255,80,0.85)" fontFamily="monospace">
          {lines[0].substring(0,16).padEnd(16,' ')}
        </text>
      )}
      {lines[1] && (
        <text x={w*0.06} y={h*0.62} fontSize={5.5} fill="rgba(0,255,80,0.85)" fontFamily="monospace">
          {lines[1].substring(0,16).padEnd(16,' ')}
        </text>
      )}
      {!lines[0] && !lines[1] && (
        <>
          <text x={w*0.06} y={h*0.32} fontSize={5.5} fill="rgba(0,255,80,0.6)" fontFamily="monospace">LCD 16x2</text>
          <text x={w*0.06} y={h*0.62} fontSize={5.5} fill="rgba(0,255,80,0.4)" fontFamily="monospace">Hello World!</text>
        </>
      )}
      <text x={w/2} y={h*0.91} textAnchor="middle" fontSize={5} fill="rgba(255,255,255,0.3)" fontFamily="monospace">HD44780</text>
    </>
  )
}

// ── OLED 128×64 ────────────────────────────────────────────────────────────────
export function OledBody({ w, h, g }: { w: number; h: number; g: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`oled_${g}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#1a1a1a" />
          <stop offset="100%" stopColor="#0a0a0a" />
        </linearGradient>
      </defs>
      <rect width={w} height={h} rx={3} fill={`url(#oled_${g})`} stroke="#2a2a2a" strokeWidth={0.8} />
      <rect x={w*0.04} y={h*0.06} width={w*0.92} height={h*0.76} rx={2} fill="#000" stroke="#333" strokeWidth={0.5} />
      {Array.from({ length: 6 }, (_, row) =>
        Array.from({ length: 10 }, (_, col) => {
          const lit = (row + col) % 3 !== 2
          return lit ? (
            <rect key={`${row}-${col}`}
              x={w*(0.07 + col*0.086)} y={h*(0.10 + row*0.10)}
              width={w*0.05} height={h*0.06} fill="rgba(100,180,255,0.55)" rx={0.5} />
          ) : null
        })
      ).flat()}
      <text x={w*0.5} y={h*0.56} textAnchor="middle" fontSize={6} fill="rgba(100,180,255,0.7)" fontFamily="monospace" fontWeight="700">OLED</text>
      <text x={w*0.5} y={h*0.65} textAnchor="middle" fontSize={4.5} fill="rgba(100,180,255,0.4)" fontFamily="monospace">128×64</text>
      <text x={w*0.5} y={h*0.90} textAnchor="middle" fontSize={4.5} fill="rgba(255,255,255,0.3)" fontFamily="monospace">SSD1306</text>
    </>
  )
}

// ── 7-Segment Display ──────────────────────────────────────────────────────────
export function SevenSegBody({ w, h, simVals, id }: {
  w: number; h: number; simVals: Record<string,number>; id: string
}) {
  const seg  = (s: string) => (simVals[`${id}:${s}`] ?? 0) > 0
  const on   = 'rgba(255,90,30,1)'
  const off  = 'rgba(50,15,5,0.8)'
  const glow = (s: string) => seg(s) ? { filter: 'drop-shadow(0 0 3px rgba(255,80,20,0.8))' } : {}
  const W = w * 0.62; const ox = (w - W) / 2
  return (
    <>
      <rect width={w} height={h} rx={3} fill="#111" />
      <rect x={ox-4} y={h*0.04} width={W+8} height={h*0.75} rx={2} fill="#0a0a0a" />
      <rect x={ox+4}   y={h*0.07} width={W-8}   height={h*0.08} rx={2} fill={seg('a')?on:off} style={glow('a')} />
      <rect x={ox+W-8} y={h*0.07} width={h*0.09} height={h*0.32} rx={2} fill={seg('b')?on:off} style={glow('b')} />
      <rect x={ox+W-8} y={h*0.44} width={h*0.09} height={h*0.32} rx={2} fill={seg('c')?on:off} style={glow('c')} />
      <rect x={ox+4}   y={h*0.70} width={W-8}   height={h*0.08} rx={2} fill={seg('d')?on:off} style={glow('d')} />
      <rect x={ox+0}   y={h*0.44} width={h*0.09} height={h*0.32} rx={2} fill={seg('e')?on:off} style={glow('e')} />
      <rect x={ox+0}   y={h*0.07} width={h*0.09} height={h*0.32} rx={2} fill={seg('f')?on:off} style={glow('f')} />
      <rect x={ox+4}   y={h*0.40} width={W-8}   height={h*0.08} rx={2} fill={seg('g')?on:off} style={glow('g')} />
      <circle cx={ox+W+5} cy={h*0.74} r={h*0.04} fill={seg('dp')?on:off} />
    </>
  )
}

// ── NeoPixel Ring ──────────────────────────────────────────────────────────────
export function NeopixelRingBody({ w, h, val, g }: {
  w: number; h: number; val: number; g: string
}) {
  const active = val > 0
  const cx = w / 2, cy = h / 2
  const r = Math.min(w, h) * 0.38
  const count = 12
  const colors = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#a855f7',
                   '#ec4899','#06b6d4','#84cc16','#f59e0b','#8b5cf6','#10b981']
  return (
    <>
      <circle cx={cx} cy={cy} r={Math.min(w,h)/2-1} fill="#111" stroke="#2a2a2a" strokeWidth={0.8} />
      <circle cx={cx} cy={cy} r={r * 0.52} fill="#0a0a0a" stroke="#333" strokeWidth={0.5} />
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2
        const px = cx + Math.cos(angle) * r
        const py = cy + Math.sin(angle) * r
        const c = active ? colors[i] : '#1a1a1a'
        return (
          <g key={i}>
            {active && <circle cx={px} cy={py} r={5} fill={c} opacity={0.25} />}
            <circle cx={px} cy={py} r={3.2} fill={c} stroke={active ? c : '#333'} strokeWidth={0.5} />
          </g>
        )
      })}
      <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={5} fill="rgba(255,255,255,0.35)" fontFamily="monospace">WS2812</text>
    </>
  )
}