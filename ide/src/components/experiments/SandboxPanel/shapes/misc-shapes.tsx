'use client'

// ── Relay ──────────────────────────────────────────────────────────────────────
export function RelayBody({ w, h, active, g }: {
  w: number; h: number; active: boolean; g: string
}) {
  return (
    <>
      <rect width={w} height={h} rx={3} fill="#1a2a1a" stroke="#2a4a2a" strokeWidth={0.8} />
      <rect x={1} y={1} width={w-2} height={h-2} rx={2} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
      {/* Coil block */}
      <rect x={w*0.06} y={h*0.12} width={w*0.52} height={h*0.72} rx={2}
        fill="#111" stroke="#333" strokeWidth={0.7} />
      {[0,1,2,3,4].map(i => (
        <line key={i} x1={w*0.1} y1={h*(0.2+i*0.13)} x2={w*0.54} y2={h*(0.2+i*0.13)}
          stroke="#444" strokeWidth={0.6} />
      ))}
      <text x={w*0.30} y={h*0.56} textAnchor="middle" fontSize={5} fill="#888" fontFamily="monospace">COIL</text>
      {/* Contact indicator */}
      <rect x={w*0.65} y={h*0.2} width={w*0.26} height={h*0.6} rx={2}
        fill={active ? '#22543d' : '#1a1a1a'} stroke={active ? '#22c55e' : '#333'} strokeWidth={0.8} />
      <circle cx={w*0.78} cy={h*(active ? 0.38 : 0.62)} r={3}
        fill={active ? '#4ade80' : '#555'}
        style={{ transition: 'cy 0.08s' }} />
      {/* Status LED */}
      <circle cx={w*0.88} cy={h*0.12} r={2.5}
        fill={active ? '#ef4444' : '#3a1a1a'} opacity={active ? 1 : 0.5} />
      {active && (
        <circle cx={w*0.88} cy={h*0.12} r={2.5} fill="#ef4444" opacity={0.3}>
          <animate attributeName="opacity" from="0.3" to="0.7" dur="0.5s" repeatCount="indefinite" values="0.3;0.7;0.3" />
        </circle>
      )}
      <text x={w*0.5} y={h*0.92} textAnchor="middle" fontSize={4.5} fill="rgba(255,255,255,0.35)" fontFamily="monospace">RELAY</text>
    </>
  )
}

// ── L298N Motor Driver ─────────────────────────────────────────────────────────
export function L298nBody({ w, h, g }: { w: number; h: number; g: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`l298_${g}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#2a2a2a" />
          <stop offset="100%" stopColor="#111" />
        </linearGradient>
      </defs>
      <rect width={w} height={h} rx={4} fill={`url(#l298_${g})`} stroke="#3a3a3a" strokeWidth={0.8} />
      <rect x={1} y={1} width={w-2} height={h-2} rx={3} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={0.5} />
      {/* Heatsink */}
      <rect x={w*0.08} y={h*0.08} width={w*0.84} height={h*0.52} rx={2} fill="#1a1a1a" stroke="#333" strokeWidth={0.7} />
      {[0.18,0.30,0.42,0.54,0.66,0.78].map((x, i) => (
        <line key={i} x1={w*x} y1={h*0.08} x2={w*x} y2={h*0.60} stroke="#222" strokeWidth={1} />
      ))}
      {/* L298N IC */}
      <rect x={w*0.22} y={h*0.14} width={w*0.56} height={h*0.38} rx={1.5} fill="#111" stroke="#444" strokeWidth={0.5} />
      <text x={w*0.5} y={h*0.32} textAnchor="middle" fontSize={6.5} fill="#777" fontFamily="monospace" fontWeight="700">L298N</text>
      <text x={w*0.5} y={h*0.43} textAnchor="middle" fontSize={4.5} fill="#555" fontFamily="monospace">MOTOR DRIVER</text>
      {/* Terminal blocks */}
      {[0.68, 0.80, 0.92].map((ry, i) => (
        <rect key={`tl${i}`} x={w*0.05} y={h*ry - 4} width={w*0.22} height={8} rx={1}
          fill="#2a4a2a" stroke="#1a6a1a" strokeWidth={0.5} />
      ))}
      {[0.68, 0.80, 0.92].map((ry, i) => (
        <rect key={`tr${i}`} x={w*0.73} y={h*ry - 4} width={w*0.22} height={8} rx={1}
          fill="#2a4a2a" stroke="#1a6a1a" strokeWidth={0.5} />
      ))}
    </>
  )
}

// ── Breadboard ─────────────────────────────────────────────────────────────────
// Small half-size breadboard — 100 tie-points, no power rails
// Hole positions MUST stay in sync with pin rx/ry values in SandboxDefs.ts
export function BreadboardBody({ w, h, simPinValues = {}, id = '' }: {
  w: number; h: number; simPinValues?: Record<string, number>; id?: string
}) {
  // ── Grid constants — must match SandboxDefs.ts breadboard pin rx/ry exactly ──
  // Uniform pitch p = 0.090, margin = (1 − 9p) / 2 = 0.095
  // Left  (a–e): 0.095, 0.185, 0.275, 0.365, 0.455
  // Gap center:  0.500  (gap width = 0.090, same as pin pitch)
  // Right (f–j): 0.545, 0.635, 0.725, 0.815, 0.905
  const colsLeft  = [0.095, 0.185, 0.275, 0.365, 0.455]
  const colsRight = [0.545, 0.635, 0.725, 0.815, 0.905]
  const allCols   = [...colsLeft, ...colsRight]
  const rows      = [0.100, 0.190, 0.280, 0.370, 0.460, 0.550, 0.640, 0.730, 0.820, 0.910]
  const LETTERS   = ['a','b','c','d','e','f','g','h','i','j']
  const HOLE_R    = 3.0   // radius in SVG units — larger = easier to target
  const GLOW_R    = 5.5

  const isActive = (pinId: string) => id ? (simPinValues[`${id}:${pinId}`] ?? 0) > 0 : false

  return (
    <>
      {/* ── Base board ── */}
      <rect width={w} height={h} rx={5} fill="#f5f0e0" stroke="#c8b870" strokeWidth={1.2} />
      <rect x={2} y={2} width={w-4} height={h-4} rx={4}
        fill="none" stroke="rgba(255,255,255,0.50)" strokeWidth={0.6} />

      {/* ── Alternating row tint bands (across full width, excluding center gap) ── */}
      {rows.map((ry, i) => (
        i % 2 === 0 ? (
          <rect key={i}
            x={w*0.005} y={h*ry - h*0.038}
            width={w*0.990} height={h*0.076}
            rx={2} fill="rgba(0,0,0,0.025)" />
        ) : null
      ))}

      {/* ── Center gap (vertical notch between cols e and f) ── */}
      {/* e=0.455, f=0.545 → gap rect from 0.463 to 0.537 (0.008 clearance each side from hole edge) */}
      <rect x={w*0.463} y={h*0.020} width={w*0.074} height={h*0.960}
        fill="#ddd5b8" stroke="#c0a870" strokeWidth={0.6} rx={3} />

      {/* ── Column labels — top ── */}
      {LETTERS.slice(0, 5).map((l, i) => (
        <text key={`lt${l}`} x={w*colsLeft[i]} y={h*0.040}
          fontSize={6} fill="#888" fontFamily="monospace" textAnchor="middle" fontWeight="600">
          {l}
        </text>
      ))}
      {LETTERS.slice(5).map((l, i) => (
        <text key={`rt${l}`} x={w*colsRight[i]} y={h*0.040}
          fontSize={6} fill="#888" fontFamily="monospace" textAnchor="middle" fontWeight="600">
          {l}
        </text>
      ))}

      {/* ── Column labels — bottom ── */}
      {LETTERS.slice(0, 5).map((l, i) => (
        <text key={`lb${l}`} x={w*colsLeft[i]} y={h*0.976}
          fontSize={6} fill="#888" fontFamily="monospace" textAnchor="middle" fontWeight="600">
          {l}
        </text>
      ))}
      {LETTERS.slice(5).map((l, i) => (
        <text key={`rb${l}`} x={w*colsRight[i]} y={h*0.976}
          fontSize={6} fill="#888" fontFamily="monospace" textAnchor="middle" fontWeight="600">
          {l}
        </text>
      ))}

      {/* ── Row numbers — left margin ── */}
      {rows.map((ry, i) => (
        <text key={`rowL${i}`} x={w*0.012} y={h*ry + 2}
          fontSize={5} fill="#bbb" fontFamily="monospace" textAnchor="start">
          {i + 1}
        </text>
      ))}

      {/* ── Row numbers — right margin ── */}
      {rows.map((ry, i) => (
        <text key={`rowR${i}`} x={w*0.988} y={h*ry + 2}
          fontSize={5} fill="#bbb" fontFamily="monospace" textAnchor="end">
          {i + 1}
        </text>
      ))}

      {/* ── Holes — rendered last so they sit on top ── */}
      {rows.map((ry, ri) =>
        allCols.map((cx, ci) => {
          const pinId  = `${LETTERS[ci]}${ri + 1}`
          const active = isActive(pinId)
          return (
            <g key={`${ri}-${ci}`}>
              {/* Glow ring when active */}
              {active && (
                <circle cx={w*cx} cy={h*ry} r={GLOW_R}
                  fill="#22c55e" opacity={0.22} />
              )}
              {/* Hole rim (metallic ring) */}
              <circle cx={w*cx} cy={h*ry} r={HOLE_R + 0.8}
                fill={active ? '#15803d' : '#6b6040'}
                opacity={0.55} />
              {/* Hole center */}
              <circle cx={w*cx} cy={h*ry} r={HOLE_R}
                fill={active ? '#22c55e' : '#1a1508'}
                stroke={active ? '#16a34a' : '#0a0800'}
                strokeWidth={0.4} />
              {/* Inner specular dot */}
              <circle cx={w*cx - HOLE_R*0.28} cy={h*ry - HOLE_R*0.28} r={HOLE_R*0.28}
                fill="rgba(255,255,255,0.12)" />
            </g>
          )
        })
      )}
    </>
  )
}

// ── Full-size Breadboard 830 ────────────────────────────────────────────────────
// 20 columns · 10 component rows (a-j) · 4 power rails (VCC+GND top & bottom)
// Layout constants MUST match those in SandboxDefs.ts breadboard_830 definition
export function BreadboardFullBody({ w, h, simPinValues = {}, id = '' }: {
  w: number; h: number; simPinValues?: Record<string, number>; id?: string
}) {
  const COLS   = 20
  const colRx  = Array.from({ length: COLS }, (_, i) => 0.04 + i * (0.92 / 19))
  const compRows: [string, number][] = [
    ['a', 0.18], ['b', 0.25], ['c', 0.32], ['d', 0.39], ['e', 0.46],
    ['f', 0.54], ['g', 0.61], ['h', 0.68], ['i', 0.75], ['j', 0.82],
  ]
  const VCC_T = 0.04, GND_T = 0.09, GND_B = 0.91, VCC_B = 0.96

  const sig  = (pinId: string) => id ? (simPinValues[`${id}:${pinId}`] ?? 0) > 0 : false
  const anyRailActive = (prefix: string) => id
    ? Array.from({ length: COLS }, (_, i) => sig(`${prefix}${i + 1}`)).some(Boolean)
    : false

  const vccTactive = anyRailActive('pvcc_t')
  const gndTactive = anyRailActive('pgnd_t')
  const gndBactive = anyRailActive('pgnd_b')
  const vccBactive = anyRailActive('pvcc_b')

  return (
    <>
      {/* ── Base board ── */}
      <rect width={w} height={h} rx={5} fill="#f0edd8" stroke="#c8c090" strokeWidth={1} />
      <rect x={2} y={2} width={w-4} height={h-4} rx={4} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={0.5} />

      {/* ── Top power rail backgrounds ── */}
      <rect x={w*0.02} y={h*0.01}  width={w*0.96} height={h*0.055} rx={2}
        fill={vccTactive ? 'rgba(239,68,68,0.18)' : '#f8d7d7'} stroke="#ef4444" strokeWidth={0.5} />
      <line x1={w*0.03} y1={h*VCC_T} x2={w*0.97} y2={h*VCC_T}
        stroke="#ef4444" strokeWidth={0.9} strokeDasharray="3 1.5" opacity={0.7} />
      <text x={w*0.014} y={h*VCC_T + 2} fontSize={6} fill="#ef4444" fontFamily="monospace" fontWeight="700">+</text>

      <rect x={w*0.02} y={h*0.065} width={w*0.96} height={h*0.05} rx={2}
        fill={gndTactive ? 'rgba(59,130,246,0.18)' : '#d7e8f8'} stroke="#3b82f6" strokeWidth={0.5} />
      <line x1={w*0.03} y1={h*GND_T} x2={w*0.97} y2={h*GND_T}
        stroke="#3b82f6" strokeWidth={0.9} strokeDasharray="3 1.5" opacity={0.7} />
      <text x={w*0.014} y={h*GND_T + 2} fontSize={6} fill="#3b82f6" fontFamily="monospace" fontWeight="700">−</text>

      {/* ── Center gap ── */}
      <rect x={w*0.01} y={h*0.485} width={w*0.98} height={h*0.03} rx={2}
        fill="#ddd5b8" stroke="#c0b080" strokeWidth={0.5} />
      <text x={w*0.5} y={h*0.508} textAnchor="middle" fontSize={3.5} fill="#aaa"
        fontFamily="monospace" letterSpacing={2}>· · · · · · · · · · · · · · · · · · · ·</text>

      {/* ── Bottom power rail backgrounds ── */}
      <rect x={w*0.02} y={h*0.885} width={w*0.96} height={h*0.05} rx={2}
        fill={gndBactive ? 'rgba(59,130,246,0.18)' : '#d7e8f8'} stroke="#3b82f6" strokeWidth={0.5} />
      <line x1={w*0.03} y1={h*GND_B} x2={w*0.97} y2={h*GND_B}
        stroke="#3b82f6" strokeWidth={0.9} strokeDasharray="3 1.5" opacity={0.7} />
      <text x={w*0.014} y={h*GND_B + 2} fontSize={6} fill="#3b82f6" fontFamily="monospace" fontWeight="700">−</text>

      <rect x={w*0.02} y={h*0.935} width={w*0.96} height={h*0.055} rx={2}
        fill={vccBactive ? 'rgba(239,68,68,0.18)' : '#f8d7d7'} stroke="#ef4444" strokeWidth={0.5} />
      <line x1={w*0.03} y1={h*VCC_B} x2={w*0.97} y2={h*VCC_B}
        stroke="#ef4444" strokeWidth={0.9} strokeDasharray="3 1.5" opacity={0.7} />
      <text x={w*0.014} y={h*VCC_B + 2} fontSize={6} fill="#ef4444" fontFamily="monospace" fontWeight="700">+</text>

      {/* ── Right-side rail labels ── */}
      <text x={w*0.986} y={h*VCC_T + 2} fontSize={6} fill="#ef4444" fontFamily="monospace" fontWeight="700" textAnchor="end">+</text>
      <text x={w*0.986} y={h*GND_T + 2} fontSize={6} fill="#3b82f6" fontFamily="monospace" fontWeight="700" textAnchor="end">−</text>
      <text x={w*0.986} y={h*GND_B + 2} fontSize={6} fill="#3b82f6" fontFamily="monospace" fontWeight="700" textAnchor="end">−</text>
      <text x={w*0.986} y={h*VCC_B + 2} fontSize={6} fill="#ef4444" fontFamily="monospace" fontWeight="700" textAnchor="end">+</text>

      {/* ── Top rail holes ── */}
      {colRx.map((cx, i) => {
        const vId = `pvcc_t${i + 1}`, gId = `pgnd_t${i + 1}`
        const va  = sig(vId),             ga  = sig(gId)
        return (
          <g key={`rt${i}`}>
            {va && <circle cx={w*cx} cy={h*VCC_T} r={4} fill="#ef4444" opacity={0.3} />}
            <circle cx={w*cx} cy={h*VCC_T} r={2}
              fill={va ? '#ef4444' : '#b00'} stroke="#900" strokeWidth={0.3} />
            {ga && <circle cx={w*cx} cy={h*GND_T} r={4} fill="#3b82f6" opacity={0.3} />}
            <circle cx={w*cx} cy={h*GND_T} r={2}
              fill={ga ? '#3b82f6' : '#111'} stroke="#333" strokeWidth={0.3} />
          </g>
        )
      })}

      {/* ── Component holes with row tinting ── */}
      {compRows.map(([letter, ry], rowIdx) => (
        <g key={letter}>
          {rowIdx % 2 === 0 && (
            <rect x={w*0.025} y={h*ry - 5} width={w*0.95} height={10}
              rx={1} fill="rgba(0,0,0,0.025)" />
          )}
          {colRx.map((cx, i) => {
            const pinId = `${letter}${i + 1}`
            const active = sig(pinId)
            return (
              <g key={i}>
                {active && <circle cx={w*cx} cy={h*ry} r={4.5} fill="#22c55e" opacity={0.25} />}
                <circle cx={w*cx} cy={h*ry} r={2}
                  fill={active ? '#22c55e' : '#111'}
                  stroke={active ? '#16a34a' : '#000'}
                  strokeWidth={0.3} />
              </g>
            )
          })}
          {/* Row label on left edge */}
          <text x={w*0.016} y={h*ry + 1.5} fontSize={3.8} fill="#bbb"
            fontFamily="monospace" textAnchor="middle">{letter}</text>
        </g>
      ))}

      {/* ── Bottom rail holes ── */}
      {colRx.map((cx, i) => {
        const gId = `pgnd_b${i + 1}`, vId = `pvcc_b${i + 1}`
        const ga  = sig(gId),              va  = sig(vId)
        return (
          <g key={`rb${i}`}>
            {ga && <circle cx={w*cx} cy={h*GND_B} r={4} fill="#3b82f6" opacity={0.3} />}
            <circle cx={w*cx} cy={h*GND_B} r={2}
              fill={ga ? '#3b82f6' : '#111'} stroke="#333" strokeWidth={0.3} />
            {va && <circle cx={w*cx} cy={h*VCC_B} r={4} fill="#ef4444" opacity={0.3} />}
            <circle cx={w*cx} cy={h*VCC_B} r={2}
              fill={va ? '#ef4444' : '#b00'} stroke="#900" strokeWidth={0.3} />
          </g>
        )
      })}

      {/* ── Column numbers (every 5) ── */}
      {colRx.map((cx, i) => (i + 1) % 5 === 0 ? (
        <text key={i} x={w*cx} y={h*0.145} textAnchor="middle"
          fontSize={4.5} fill="#999" fontFamily="monospace">{i + 1}</text>
      ) : null)}

      {/* ── Mid-column markers between rows a-e / f-j ── */}
      {colRx.map((cx, i) => (i + 1) % 5 === 0 ? (
        <text key={i} x={w*cx} y={h*0.52} textAnchor="middle"
          fontSize={3.5} fill="#bbb" fontFamily="monospace">{i + 1}</text>
      ) : null)}
    </>
  )
}

// ── DC Motor ───────────────────────────────────────────────────────────────────
export function DcMotorBody({ w, h, active }: { w: number; h: number; active?: boolean }) {
  return (
    <>
      <ellipse cx={w*0.5} cy={h*0.5} rx={w*0.44} ry={h*0.44}
        fill="#2a2a2a" stroke="#555" strokeWidth={0.9} />
      <ellipse cx={w*0.5} cy={h*0.5} rx={w*0.32} ry={h*0.32}
        fill="#222" stroke="#444" strokeWidth={0.6} />
      <rect x={w*0.46} y={-4} width={w*0.08} height={h*0.18} rx={2}
        fill="#bbb" stroke="#aaa" strokeWidth={0.5} />
      {active ? (
        <circle cx={w*0.5} cy={h*0.5} r={w*0.16} fill="none" stroke="#22c55e" strokeWidth={1.2} strokeDasharray="5 3" opacity={0.8}>
          <animateTransform attributeName="transform" type="rotate"
            from={`0 ${w*0.5} ${h*0.5}`} to={`360 ${w*0.5} ${h*0.5}`} dur="0.5s" repeatCount="indefinite" />
        </circle>
      ) : (
        <circle cx={w*0.5} cy={h*0.5} r={w*0.16} fill="none" stroke="#444" strokeWidth={1} strokeDasharray="4 4" />
      )}
      <rect x={w*0.22-3} y={h*0.02} width={6} height={8} rx={1} fill="#c8a843" stroke="#9a7820" strokeWidth={0.5} />
      <rect x={w*0.78-3} y={h*0.02} width={6} height={8} rx={1} fill="#c8a843" stroke="#9a7820" strokeWidth={0.5} />
      <text x={w*0.22} y={-2} textAnchor="middle" fontSize={5} fill="#c8a843" fontFamily="monospace">+</text>
      <text x={w*0.78} y={-2} textAnchor="middle" fontSize={5} fill="#888" fontFamily="monospace">−</text>
      <text x={w*0.5} y={h*0.9} textAnchor="middle" fontSize={5.5} fill="#666" fontFamily="monospace">DC MOTOR</text>
    </>
  )
}

// ── 8-Pin Header ───────────────────────────────────────────────────────────────
export function Header8Body({ w, h, simPinValues, id }: {
  w: number; h: number; simPinValues: Record<string, number>; id: string
}) {
  return (
    <>
      <rect width={w} height={h} rx={2} fill="#111" stroke="#333" strokeWidth={0.8} />
      {[1,2,3,4,5,6,7,8].map((p, i) => {
        const cy  = h * (0.06 + i * 0.125)
        const lit = (simPinValues[`${id}:p${p}`] ?? 0) > 0
        return (
          <g key={p}>
            <rect x={w*0.15} y={cy-4} width={w*0.70} height={8} rx={1}
              fill={lit ? '#1a3a1a' : '#1a1a1a'} stroke={lit ? '#22c55e' : '#333'} strokeWidth={0.5} />
            <circle cx={w*0.5} cy={cy} r={2.2} fill={lit ? '#22c55e' : '#c8a843'} />
            <text x={w*0.88} y={cy+2} fontSize={4.5} fill="#555" fontFamily="monospace" textAnchor="middle">{p}</text>
          </g>
        )
      })}
    </>
  )
}

// ── Default fallback ───────────────────────────────────────────────────────────
export function DefaultBody({ w, h, color, label }: {
  w: number; h: number; color: string; label: string
}) {
  return (
    <>
      <rect width={w} height={h} rx={4} fill={color} stroke="rgba(255,255,255,0.1)" strokeWidth={0.8} />
      <rect x={1} y={1} width={w-2} height={h-2} rx={3} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
      <text x={w/2} y={h/2+4} textAnchor="middle" fontSize={10}
        fill="rgba(255,255,255,0.8)" fontFamily="var(--font-sans)" fontWeight="600">{label}</text>
    </>
  )
}