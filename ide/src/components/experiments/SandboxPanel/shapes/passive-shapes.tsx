'use client'

// ── Resistor band helper ───────────────────────────────────────────────────────
function resistorBands(ohms: number): string[] {
  const colors = ['#000','#8b4513','#f00','#f80','#ff0','#0a0','#00f','#800080','#888','#fff']
  const val = Math.round(ohms)
  if (val <= 0) return ['#888','#888','#000']
  const s = val.toString()
  const d1 = parseInt(s[0])
  const d2 = parseInt(s[1] ?? '0')
  const mult = s.length - 2
  return [colors[d1], colors[d2], colors[Math.max(0, Math.min(9, mult))]]
}

// ── Resistor ───────────────────────────────────────────────────────────────────
export function ResistorBody({ w, h, props }: {
  w: number; h: number; props: Record<string, string|number>
}) {
  const ohms  = Number(props?.ohms ?? 220)
  const bands = resistorBands(ohms)
  const my    = h / 2
  return (
    <>
      <line x1={0}      y1={my}     x2={w*0.20} y2={my} stroke="#b8b8b8" strokeWidth={1.5} />
      <line x1={w*0.80} y1={my}     x2={w}      y2={my} stroke="#b8b8b8" strokeWidth={1.5} />
      <rect x={w*0.18} y={h*0.18} width={w*0.64} height={h*0.64} rx={h*0.30}
        fill="#e8d8a0" stroke="#c8b870" strokeWidth={0.8} />
      {bands.map((c, i) => (
        <rect key={i} x={w*(0.30 + i*0.13)} y={h*0.15} width={w*0.10} height={h*0.70} rx={1}
          fill={c} opacity={0.9} />
      ))}
      {/* Tolerance band (gold) */}
      <rect x={w*0.70} y={h*0.20} width={w*0.08} height={h*0.60} rx={1} fill="#d4a843" opacity={0.85} />
      <text x={w/2} y={h+10} textAnchor="middle" fontSize={7} fill="var(--fg-muted)" fontFamily="var(--font-mono)">
        {ohms >= 1000 ? `${(ohms/1000).toFixed(ohms % 1000 === 0 ? 0 : 1)}kΩ` : `${ohms}Ω`}
      </text>
    </>
  )
}

// ── Capacitor ──────────────────────────────────────────────────────────────────
export function CapBody({ w, h, color }: { w: number; h: number; color: string }) {
  return (
    <>
      <line x1={w*0.4} y1={0}      x2={w*0.4} y2={h*0.18} stroke="#b8b8b8" strokeWidth={1.5} />
      <line x1={w*0.6} y1={0}      x2={w*0.6} y2={h*0.18} stroke="#b8b8b8" strokeWidth={1.5} />
      <line x1={w*0.4} y1={h*0.82} x2={w*0.4} y2={h}      stroke="#b8b8b8" strokeWidth={1.5} />
      <line x1={w*0.6} y1={h*0.82} x2={w*0.6} y2={h}      stroke="#b8b8b8" strokeWidth={1.5} />
      <rect x={w*0.1} y={h*0.18} width={w*0.8} height={h*0.64} rx={w*0.35}
        fill={color || '#4a6fa5'} stroke="#2a4a85" strokeWidth={0.8} />
      <rect x={w*0.1} y={h*0.18} width={w*0.2} height={h*0.64} rx={0}
        fill="rgba(0,0,0,0.25)" />
      <text x={w*0.15} y={h*0.5+2} textAnchor="middle" fontSize={6} fill="rgba(255,255,255,0.7)" fontFamily="monospace">–</text>
      <ellipse cx={w/2} cy={h*0.18} rx={w*0.40} ry={h*0.06} fill="rgba(255,255,255,0.15)" />
    </>
  )
}

// ── Transistor NPN ─────────────────────────────────────────────────────────────
export function TransBody({ w, h }: { w: number; h: number }) {
  return (
    <>
      <path d={`M ${w*0.15} ${h*0.55} A ${w*0.45} ${h*0.5} 0 0 1 ${w*0.85} ${h*0.55} L ${w*0.85} ${h} L ${w*0.15} ${h} Z`}
        fill="#111" stroke="#444" strokeWidth={0.8} />
      <line x1={w*0.15} y1={h*0.55} x2={w*0.85} y2={h*0.55} stroke="#555" strokeWidth={0.8} />
      <line x1={w*0.25} y1={h} x2={w*0.25} y2={h*1.1} stroke="#b8b8b8" strokeWidth={1.5} />
      <line x1={w*0.50} y1={h} x2={w*0.50} y2={h*1.1} stroke="#b8b8b8" strokeWidth={1.5} />
      <line x1={w*0.75} y1={h} x2={w*0.75} y2={h*1.1} stroke="#b8b8b8" strokeWidth={1.5} />
      <text x={w*0.25} y={h*0.78} textAnchor="middle" fontSize={5} fill="#888" fontFamily="monospace">B</text>
      <text x={w*0.50} y={h*0.78} textAnchor="middle" fontSize={5} fill="#888" fontFamily="monospace">C</text>
      <text x={w*0.75} y={h*0.78} textAnchor="middle" fontSize={5} fill="#888" fontFamily="monospace">E</text>
      <text x={w*0.5}  y={h*0.45} textAnchor="middle" fontSize={5.5} fill="rgba(255,255,255,0.5)" fontFamily="monospace">2N2222</text>
    </>
  )
}

// ── N-Channel MOSFET ───────────────────────────────────────────────────────────
export function MosfetBody({ w, h, active }: { w: number; h: number; active: boolean }) {
  return (
    <>
      <path d={`M ${w*0.08} ${h*0.40} A ${w*0.48} ${h*0.55} 0 0 1 ${w*0.92} ${h*0.40} L ${w*0.92} ${h*0.92} L ${w*0.08} ${h*0.92} Z`}
        fill="#1a1a1a" stroke="#444" strokeWidth={0.8} />
      <line x1={w*0.08} y1={h*0.40} x2={w*0.92} y2={h*0.40} stroke="#555" strokeWidth={0.8} />
      <line x1={w*0.22} y1={h*0.92} x2={w*0.22} y2={h}     stroke="#b8b8b8" strokeWidth={1.5} />
      <line x1={w*0.50} y1={h*0.92} x2={w*0.50} y2={h}     stroke="#b8b8b8" strokeWidth={1.5} />
      <line x1={w*0.78} y1={h*0.92} x2={w*0.78} y2={h}     stroke="#b8b8b8" strokeWidth={1.5} />
      <line x1={w*0.50} y1={0}      x2={w*0.50} y2={h*0.25} stroke="#b8b8b8" strokeWidth={1.5} />
      <line x1={w*0.08} y1={h*0.60} x2={w*0.30} y2={h*0.60} stroke={active ? '#3b82f6' : '#555'} strokeWidth={1.2} />
      <polygon points={`${w*0.30},${h*0.54} ${w*0.30},${h*0.66} ${w*0.44},${h*0.60}`}
        fill={active ? '#3b82f6' : '#555'} />
      <line x1={w*0.50} y1={h*0.28} x2={w*0.50} y2={h*0.90}
        stroke={active ? '#22c55e' : '#333'} strokeWidth={1.5} />
      <text x={w*0.22} y={h*0.78} textAnchor="middle" fontSize={5} fill="#888" fontFamily="monospace">G</text>
      <text x={w*0.50} y={h*0.78} textAnchor="middle" fontSize={5} fill="#888" fontFamily="monospace">D</text>
      <text x={w*0.78} y={h*0.78} textAnchor="middle" fontSize={5} fill="#888" fontFamily="monospace">S</text>
    </>
  )
}

// ── Diode ──────────────────────────────────────────────────────────────────────
export function DiodeBody({ w, h }: { w: number; h: number }) {
  const my = h / 2
  return (
    <>
      <line x1={0}      y1={my} x2={w*0.25} y2={my} stroke="#b8b8b8" strokeWidth={1.8} />
      <line x1={w*0.75} y1={my} x2={w}      y2={my} stroke="#b8b8b8" strokeWidth={1.8} />
      <rect x={w*0.22} y={h*0.14} width={w*0.56} height={h*0.72} rx={h*0.08}
        fill="#111" stroke="#555" strokeWidth={0.8} />
      <rect x={w*0.66} y={h*0.10} width={w*0.10} height={h*0.80} rx={1} fill="#e0e0e0" opacity={0.85} />
      <polygon points={`${w*0.30},${my-5} ${w*0.30},${my+5} ${w*0.60},${my}`} fill="#555" />
      <line x1={w*0.60} y1={my-5} x2={w*0.60} y2={my+5} stroke="#888" strokeWidth={1.2} />
      <text x={w*0.5} y={h + 10} textAnchor="middle" fontSize={7} fill="var(--fg-muted)" fontFamily="var(--font-mono)">1N4007</text>
    </>
  )
}