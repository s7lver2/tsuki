'use client'

// ── Arduino Uno ────────────────────────────────────────────────────────────────
export function ArduinoUnoBody({ w, h, g }: { w: number; h: number; g: string }) {
  const leftTopY = 0.065 * h - 6
  const leftBotY = 0.940 * h + 6
  const rUpTopY  = 0.065 * h - 6
  const rUpBotY  = 0.315 * h + 6
  const rLoTopY  = 0.490 * h - 6
  const rLoBotY  = 0.740 * h + 6

  return (
    <>
      <defs>
        <linearGradient id={`pcb_${g}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#2e7d46" />
          <stop offset="55%"  stopColor="#1a5c2e" />
          <stop offset="100%" stopColor="#0e3d1e" />
        </linearGradient>
        <linearGradient id={`chip_${g}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#2a2a2a" />
          <stop offset="100%" stopColor="#0a0a0a" />
        </linearGradient>
        <linearGradient id={`usb_${g}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#d0d0d0" />
          <stop offset="100%" stopColor="#888" />
        </linearGradient>
      </defs>

      <rect width={w} height={h} rx={6} fill={`url(#pcb_${g})`} />
      <rect x={1} y={1} width={w-2} height={h-2} rx={5}
        fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={1} />

      {/* Left pin header housing (digital) */}
      <rect x={0} y={leftTopY} width={13} height={leftBotY - leftTopY} rx={2}
        fill="#141414" stroke="#2a2a2a" strokeWidth={0.8} />
      <rect x={1.5} y={leftTopY + 2} width={2} height={leftBotY - leftTopY - 4} rx={1}
        fill="#080808" opacity={0.8} />

      {/* Right upper pin header (power) */}
      <rect x={w - 13} y={rUpTopY} width={13} height={rUpBotY - rUpTopY} rx={2}
        fill="#141414" stroke="#2a2a2a" strokeWidth={0.8} />
      <rect x={w - 3.5} y={rUpTopY + 2} width={2} height={rUpBotY - rUpTopY - 4} rx={1}
        fill="#080808" opacity={0.8} />

      {/* Right lower pin header (analog) */}
      <rect x={w - 13} y={rLoTopY} width={13} height={rLoBotY - rLoTopY} rx={2}
        fill="#141414" stroke="#2a2a2a" strokeWidth={0.8} />
      <rect x={w - 3.5} y={rLoTopY + 2} width={2} height={rLoBotY - rLoTopY - 4} rx={1}
        fill="#080808" opacity={0.8} />

      {/* USB Type-B */}
      <rect x={w*0.22} y={-8} width={w*0.38} height={10} rx={1.5} fill={`url(#usb_${g})`} />
      <rect x={w*0.25} y={-6} width={w*0.32} height={6} rx={1} fill="#555" />
      <rect x={w*0.28} y={-5} width={w*0.26} height={4} rx={0.5} fill="#333" />

      {/* DC Power jack */}
      <ellipse cx={w*0.12} cy={h*0.08} rx={5} ry={6} fill="#1a1a1a" stroke="#555" strokeWidth={0.8} />
      <circle  cx={w*0.12} cy={h*0.08} r={2.5} fill="#333" />
      <circle  cx={w*0.12} cy={h*0.08} r={1}   fill="#666" />

      {/* Reset button */}
      <rect x={w*0.6} y={h*0.05} width={10} height={8} rx={1.5} fill="#2255aa" stroke="#1a3a7a" strokeWidth={0.5} />
      <rect x={w*0.62} y={h*0.065} width={6} height={5} rx={1} fill="#1a3a7a" />

      {/* Crystal oscillator */}
      <rect x={w*0.48} y={h*0.38} width={10} height={18} rx={2} fill={`url(#usb_${g})`} stroke="#888" strokeWidth={0.5} />
      <line x1={w*0.48+3} y1={h*0.38+3} x2={w*0.48+3} y2={h*0.38+15} stroke="#aaa" strokeWidth={0.5} />

      {/* ATmega328P */}
      <rect x={w*0.22} y={h*0.35} width={w*0.52} height={h*0.30} rx={3} fill={`url(#chip_${g})`} />
      {[0,1,2,3,4,5,6].map(i => (
        <rect key={`il${i}`} x={w*0.20} y={h*(0.37 + i*0.038)} width={w*0.04} height={3} rx={0.5} fill="#c8a843" />
      ))}
      {[0,1,2,3,4,5,6].map(i => (
        <rect key={`ir${i}`} x={w*0.76} y={h*(0.37 + i*0.038)} width={w*0.04} height={3} rx={0.5} fill="#c8a843" />
      ))}
      <text x={w*0.48} y={h*0.47} textAnchor="middle" fontSize={5.5} fill="#888" fontFamily="monospace" fontWeight="600">ATMEGA328P</text>
      <text x={w*0.48} y={h*0.53} textAnchor="middle" fontSize={4}   fill="#666" fontFamily="monospace">ARDUINO UNO</text>

      {/* Capacitors */}
      {[[0.65,0.22],[0.72,0.22],[0.65,0.30]].map(([cx,cy],i) => (
        <g key={i} transform={`translate(${w*cx},${h*cy})`}>
          <rect x={-2.5} y={-4} width={5} height={8} rx={2.5} fill="#4a6fa5" stroke="#2a4a85" strokeWidth={0.5} />
          <line x1={-1.5} y1={-5.5} x2={-1.5} y2={-4} stroke="#c8a843" strokeWidth={1} />
          <line x1={1.5}  y1={-5.5} x2={1.5}  y2={-4} stroke="#c8a843" strokeWidth={1} />
        </g>
      ))}

      {/* Voltage regulator */}
      <rect x={w*0.06} y={h*0.22} width={12} height={10} rx={1} fill="#1a1a1a" stroke="#333" strokeWidth={0.5} />
      <text x={w*0.12} y={h*0.282} textAnchor="middle" fontSize={4} fill="#666" fontFamily="monospace">REG</text>

      {/* LEDs */}
      <circle cx={w*0.82} cy={h*0.14} r={2.5} fill="#22c55e" opacity={0.9} />
      <circle cx={w*0.82} cy={h*0.14} r={1.5} fill="#86efac" />
      <circle cx={w*0.76} cy={h*0.19} r={2}   fill="#f97316" opacity={0.8} />
      <circle cx={w*0.82} cy={h*0.19} r={2}   fill="#f97316" opacity={0.8} />
      <circle cx={w*0.88} cy={h*0.19} r={2}   fill="#eab308" opacity={0.8} />

      {/* Silkscreen */}
      <text x={w*0.5} y={h*0.14} textAnchor="middle" fontSize={7} fill="rgba(255,255,255,0.50)"
        fontFamily="monospace" fontWeight="700" letterSpacing={0.5}>ARDUINO UNO R3</text>
      <text x={14}     y={leftTopY - 2} fontSize={4.5} fill="rgba(255,255,255,0.35)" fontFamily="monospace" fontWeight="600">DIGITAL (PWM~)</text>
      <text x={w - 14} y={rUpTopY - 2} fontSize={4.5} fill="rgba(255,255,255,0.35)" fontFamily="monospace" fontWeight="600" textAnchor="end">POWER</text>
      <text x={w - 14} y={rLoTopY - 2} fontSize={4.5} fill="rgba(255,255,255,0.35)" fontFamily="monospace" fontWeight="600" textAnchor="end">ANALOG IN</text>
      <line x1={w*0.22} y1={h*0.86} x2={w*0.78} y2={h*0.86} stroke="rgba(255,255,255,0.04)" strokeWidth={0.8} />
    </>
  )
}

// ── Arduino Nano ───────────────────────────────────────────────────────────────
export function ArduinoNanoBody({ w, h, g }: { w: number; h: number; g: string }) {
  const LANE = 16
  const lTopY = 0.04 * h - 5
  const lBotY = 0.94 * h + 5
  const rTopY = 0.04 * h - 5
  const rBotY = 0.82 * h + 5

  return (
    <>
      <defs>
        <linearGradient id={`nano_${g}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#1e5bb8" />
          <stop offset="100%" stopColor="#0d2f6e" />
        </linearGradient>
        <linearGradient id={`nano_lane_${g}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#000000" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.04" />
        </linearGradient>
        <linearGradient id={`nano_lane_r_${g}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#000000" stopOpacity="0.04" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.28" />
        </linearGradient>
      </defs>

      <rect width={w} height={h} rx={4} fill={`url(#nano_${g})`} />
      <rect x={1} y={1} width={w-2} height={h-2} rx={3} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={0.8} />

      {/* Pin lane tints */}
      <rect x={0} y={0} width={LANE} height={h} rx={4} fill={`url(#nano_lane_${g})`} />
      <line x1={LANE} y1={6} x2={LANE} y2={h-6} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} strokeDasharray="3 4" />
      <rect x={w-LANE} y={0} width={LANE} height={h} rx={4} fill={`url(#nano_lane_r_${g})`} />
      <line x1={w-LANE} y1={6} x2={w-LANE} y2={h-6} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} strokeDasharray="3 4" />

      {/* Header housings */}
      <rect x={0} y={lTopY} width={LANE-2} height={lBotY - lTopY} rx={2}
        fill="#141414" stroke="#2a2a2a" strokeWidth={0.7} />
      <rect x={1.5} y={lTopY + 2} width={2} height={lBotY - lTopY - 4} rx={1} fill="#080808" opacity={0.7} />
      <rect x={w - (LANE-2)} y={rTopY} width={LANE-2} height={rBotY - rTopY} rx={2}
        fill="#141414" stroke="#2a2a2a" strokeWidth={0.7} />
      <rect x={w - 3.5} y={rTopY + 2} width={2} height={rBotY - rTopY - 4} rx={1} fill="#080808" opacity={0.7} />

      {/* USB Mini */}
      <rect x={w*0.28} y={-6} width={w*0.44} height={7} rx={1.5} fill="#b0b0b0" />
      <rect x={w*0.33} y={-4} width={w*0.34} height={4} rx={1} fill="#555" />

      {/* ATmega chip */}
      <rect x={w*0.21} y={h*0.25} width={w*0.58} height={h*0.35} rx={2} fill="#111" />
      {[0,1,2,3].map(i => (
        <rect key={`nl${i}`} x={w*0.15} y={h*(0.28+i*0.072)} width={w*0.07} height={2.5} rx={0.5} fill="#c8a843" />
      ))}
      {[0,1,2,3].map(i => (
        <rect key={`nr${i}`} x={w*0.78} y={h*(0.28+i*0.072)} width={w*0.07} height={2.5} rx={0.5} fill="#c8a843" />
      ))}
      <text x={w*0.5} y={h*0.45} textAnchor="middle" fontSize={5} fill="#888" fontFamily="monospace" fontWeight="600">ATMEGA328</text>

      {/* LEDs */}
      <circle cx={w*0.78} cy={h*0.15} r={2.5} fill="#22c55e" opacity={0.9} />
      <circle cx={w*0.68} cy={h*0.15} r={2}   fill="#f97316" opacity={0.8} />

      {/* Silkscreen */}
      <text x={w*0.5}    y={h*0.12} textAnchor="middle" fontSize={7} fill="rgba(255,255,255,0.50)" fontFamily="monospace" fontWeight="700">NANO</text>
      <text x={LANE/2}   y={lTopY - 3} fontSize={4} fill="rgba(255,255,255,0.30)" fontFamily="monospace" fontWeight="600" textAnchor="middle">D</text>
      <text x={w-LANE/2} y={rTopY - 3} fontSize={4} fill="rgba(255,255,255,0.30)" fontFamily="monospace" fontWeight="600" textAnchor="middle">A</text>
    </>
  )
}

// ── XIAO RP2040 ────────────────────────────────────────────────────────────────
export function XiaoRp2040Body({ w, h, g }: { w: number; h: number; g: string }) {
  const LANE = 16
  const lTopY = 0.07 * h - 5
  const lBotY = 0.63 * h + 5
  const rTopY = 0.07 * h - 5
  const rBotY = 0.87 * h + 5

  return (
    <>
      <defs>
        <linearGradient id={`xiao_${g}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#16a34a" />
          <stop offset="100%" stopColor="#052e16" />
        </linearGradient>
        <linearGradient id={`xiao_lane_${g}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#000000" stopOpacity="0.30" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id={`xiao_lane_r_${g}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#000000" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.30" />
        </linearGradient>
        <radialGradient id={`xiao_np_${g}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="40%"  stopColor="#a78bfa" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.3" />
        </radialGradient>
      </defs>

      <rect width={w} height={h} rx={4} fill={`url(#xiao_${g})`} />
      <rect x={1} y={1} width={w-2} height={h-2} rx={3.5} fill="none"
            stroke="rgba(255,255,255,0.12)" strokeWidth={0.8} />

      {/* Pin lane tints */}
      <rect x={0} y={0} width={LANE} height={h} rx={4} fill={`url(#xiao_lane_${g})`} />
      <line x1={LANE} y1={6} x2={LANE} y2={h-6} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} strokeDasharray="3 4" />
      <rect x={w-LANE} y={0} width={LANE} height={h} rx={4} fill={`url(#xiao_lane_r_${g})`} />
      <line x1={w-LANE} y1={6} x2={w-LANE} y2={h-6} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} strokeDasharray="3 4" />

      {/* Castellated pad housings */}
      <rect x={0} y={lTopY} width={LANE-2} height={lBotY - lTopY} rx={2}
        fill="#141414" stroke="#2a2a2a" strokeWidth={0.7} />
      <rect x={1.5} y={lTopY + 2} width={2} height={lBotY - lTopY - 4} rx={1} fill="#080808" opacity={0.7} />
      <rect x={w - (LANE-2)} y={rTopY} width={LANE-2} height={rBotY - rTopY} rx={2}
        fill="#141414" stroke="#2a2a2a" strokeWidth={0.7} />
      <rect x={w - 3.5} y={rTopY + 2} width={2} height={rBotY - rTopY - 4} rx={1} fill="#080808" opacity={0.7} />

      {/* USB-C */}
      <rect x={w*0.30} y={-5} width={w*0.40} height={6.5} rx={1.5} fill="#999" />
      <rect x={w*0.35} y={-4} width={w*0.30} height={4}   rx={1}   fill="#444" />
      <text x={w*0.5}  y={-0.5} textAnchor="middle" fontSize={3.5} fill="#aaa" fontFamily="monospace">C</text>

      {/* RP2040 chip */}
      <rect x={w*0.21} y={h*0.22} width={w*0.58} height={h*0.32} rx={2} fill="#0f0f0f" />
      <rect x={w*0.23} y={h*0.24} width={w*0.54} height={h*0.28} rx={1.5} fill="none"
            stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
      {[0,1,2,3,4].map(i => (
        <rect key={`cl${i}`} x={w*0.16} y={h*(0.24+i*0.054)} width={w*0.06} height={2.2} rx={0.5} fill="#c8a843" />
      ))}
      {[0,1,2,3,4].map(i => (
        <rect key={`cr${i}`} x={w*0.78} y={h*(0.24+i*0.054)} width={w*0.06} height={2.2} rx={0.5} fill="#c8a843" />
      ))}
      <text x={w*0.5} y={h*0.365} textAnchor="middle" fontSize={5}   fill="#777" fontFamily="monospace" fontWeight="700">RP2040</text>
      <text x={w*0.5} y={h*0.405} textAnchor="middle" fontSize={3.5} fill="#555" fontFamily="monospace">133 MHz</text>

      {/* NeoPixel */}
      <circle cx={w*0.5}  cy={h*0.68} r={5}   fill={`url(#xiao_np_${g})`} />
      <circle cx={w*0.5}  cy={h*0.68} r={5.5} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={0.5} />
      <text   x={w*0.5}   y={h*0.755} textAnchor="middle" fontSize={3.5} fill="rgba(255,255,255,0.4)" fontFamily="monospace">NEO</text>

      {/* Status LEDs */}
      <circle cx={w*0.25} cy={h*0.82} r={2.5} fill="#22c55e" opacity={0.85} />
      <circle cx={w*0.50} cy={h*0.82} r={2.5} fill="#f97316" opacity={0.80} />
      <circle cx={w*0.75} cy={h*0.82} r={2.5} fill="#3b82f6" opacity={0.85} />
      <text   x={w*0.25}  y={h*0.878} textAnchor="middle" fontSize={3} fill="rgba(255,255,255,0.35)" fontFamily="monospace">PWR</text>
      <text   x={w*0.50}  y={h*0.878} textAnchor="middle" fontSize={3} fill="rgba(255,255,255,0.35)" fontFamily="monospace">CHG</text>
      <text   x={w*0.75}  y={h*0.878} textAnchor="middle" fontSize={3} fill="rgba(255,255,255,0.35)" fontFamily="monospace">USR</text>

      {/* Reset button */}
      <rect x={w*0.38} y={h*0.91} width={w*0.10} height={h*0.052} rx={1.5} fill="#1a1a1a" stroke="#555" strokeWidth={0.5} />
      <text x={w*0.43}  y={h*0.945} textAnchor="middle" fontSize={3} fill="#666" fontFamily="monospace">RST</text>

      {/* Silkscreen */}
      <text x={w*0.5}    y={h*0.135} textAnchor="middle" fontSize={6}   fill="rgba(255,255,255,0.65)" fontFamily="monospace" fontWeight="700">XIAO</text>
      <text x={w*0.5}    y={h*0.190} textAnchor="middle" fontSize={4}   fill="rgba(255,255,255,0.35)" fontFamily="monospace">RP2040</text>
      <text x={LANE/2}   y={lTopY - 3} fontSize={4} fill="rgba(255,255,255,0.30)" fontFamily="monospace" fontWeight="600" textAnchor="middle">GPIO</text>
      <text x={w-LANE/2} y={rTopY - 3} fontSize={4} fill="rgba(255,255,255,0.30)" fontFamily="monospace" fontWeight="600" textAnchor="middle">GPIO</text>
    </>
  )
}
// ── ESP8266 NodeMCU body ──────────────────────────────────────────────────────
export function Esp8266Body({ w, h, g }: { w: number; h: number; g: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`esp8266_${g}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#1c3a20" />
          <stop offset="55%"  stopColor="#0f2412" />
          <stop offset="100%" stopColor="#070f08" />
        </linearGradient>
      </defs>

      {/* PCB */}
      <rect width={w} height={h} rx={4} fill={`url(#esp8266_${g})`} />
      <rect x={1} y={1} width={w-2} height={h-2} rx={3}
        fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={1} />

      {/* Left pin header */}
      <rect x={0} y={h*0.04} width={11} height={h*0.92} rx={2}
        fill="#141414" stroke="#2a2a2a" strokeWidth={0.8} />

      {/* Right pin header */}
      <rect x={w-11} y={h*0.04} width={11} height={h*0.56} rx={2}
        fill="#141414" stroke="#2a2a2a" strokeWidth={0.8} />

      {/* ESP8266 module (blue box) */}
      <rect x={w*0.15} y={h*0.10} width={w*0.70} height={h*0.40} rx={3}
        fill="#1a2a7a" stroke="#243580" strokeWidth={0.8} />
      <text x={w*0.50} y={h*0.27} textAnchor="middle" fontSize={5.5}
        fill="rgba(255,255,255,0.8)" fontFamily="monospace" fontWeight="700">ESP8266</text>
      <text x={w*0.50} y={h*0.35} textAnchor="middle" fontSize={4}
        fill="rgba(255,255,255,0.5)" fontFamily="monospace">NodeMCU v3</text>
      {/* WiFi antenna lines */}
      {[0,1,2,3,4].map(i => (
        <line key={i}
          x1={w*0.70} y1={h*(0.12 + i*0.07)}
          x2={w*0.82} y2={h*(0.12 + i*0.07)}
          stroke="rgba(100,200,100,0.5)" strokeWidth={0.8} />
      ))}

      {/* USB micro-B */}
      <rect x={w*0.32} y={-6} width={w*0.36} height={8} rx={1.5} fill="#c0c0c0" />
      <rect x={w*0.35} y={-5} width={w*0.30} height={6} rx={1} fill="#888" />

      {/* Power LED */}
      <circle cx={w*0.22} cy={h*0.60} r={2.5} fill="#22c55e" opacity={0.9} />
      <text x={w*0.22} y={h*0.66} textAnchor="middle" fontSize={3}
        fill="rgba(255,255,255,0.4)" fontFamily="monospace">PWR</text>

      {/* Flash/User LED */}
      <circle cx={w*0.60} cy={h*0.60} r={2.5} fill="#3b82f6" opacity={0.85} />
      <text x={w*0.60} y={h*0.66} textAnchor="middle" fontSize={3}
        fill="rgba(255,255,255,0.4)" fontFamily="monospace">D4</text>

      {/* RST button */}
      <rect x={w*0.20} y={h*0.72} width={14} height={8} rx={2} fill="#b91c1c" stroke="#7f1d1d" strokeWidth={0.5} />
      <text x={w*0.27} y={h*0.77} textAnchor="middle" fontSize={3}
        fill="white" fontFamily="monospace">RST</text>

      {/* Flash button */}
      <rect x={w*0.58} y={h*0.72} width={14} height={8} rx={2} fill="#1d4ed8" stroke="#1e3a8a" strokeWidth={0.5} />
      <text x={w*0.65} y={h*0.77} textAnchor="middle" fontSize={3}
        fill="white" fontFamily="monospace">FLASH</text>

      {/* Tsuki-webkit WiFi badge */}
      <rect x={w*0.18} y={h*0.84} width={w*0.64} height={10} rx={3}
        fill="rgba(34,197,94,0.12)" stroke="rgba(34,197,94,0.25)" strokeWidth={0.6} />
      <text x={w*0.50} y={h*0.90} textAnchor="middle" fontSize={4}
        fill="#4ade80" fontFamily="monospace">tsuki-webkit ✓</text>
    </>
  )
}

// ── ESP32 Dev Module body ────────────────────────────────────────────────────
export function Esp32Body({ w, h, g }: { w: number; h: number; g: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`esp32_${g}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#162030" />
          <stop offset="55%"  stopColor="#0a1520" />
          <stop offset="100%" stopColor="#050a10" />
        </linearGradient>
      </defs>

      {/* PCB */}
      <rect width={w} height={h} rx={4} fill={`url(#esp32_${g})`} />
      <rect x={1} y={1} width={w-2} height={h-2} rx={3}
        fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={1} />

      {/* Left pin header */}
      <rect x={0} y={h*0.02} width={11} height={h*0.96} rx={2}
        fill="#141414" stroke="#2a2a2a" strokeWidth={0.8} />

      {/* Right pin header */}
      <rect x={w-11} y={h*0.02} width={11} height={h*0.96} rx={2}
        fill="#141414" stroke="#2a2a2a" strokeWidth={0.8} />

      {/* ESP32-WROOM module */}
      <rect x={w*0.12} y={h*0.08} width={w*0.76} height={h*0.46} rx={3}
        fill="#1a1f35" stroke="#2a3050" strokeWidth={0.8} />
      {/* Metal shielding texture */}
      {[0,1,2,3,4,5].map(i => (
        <line key={`hl${i}`}
          x1={w*0.13} y1={h*(0.10 + i*0.065)}
          x2={w*0.87} y2={h*(0.10 + i*0.065)}
          stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
      ))}
      <text x={w*0.50} y={h*0.27} textAnchor="middle" fontSize={6}
        fill="rgba(255,255,255,0.8)" fontFamily="monospace" fontWeight="700">ESP32</text>
      <text x={w*0.50} y={h*0.35} textAnchor="middle" fontSize={4}
        fill="rgba(255,255,255,0.45)" fontFamily="monospace">WROOM-32</text>
      <text x={w*0.50} y={h*0.42} textAnchor="middle" fontSize={3.5}
        fill="rgba(255,255,255,0.30)" fontFamily="monospace">240MHz · BT+WiFi</text>
      {/* Antenna */}
      {[0,1,2,3,4].map(i => (
        <line key={i}
          x1={w*0.72} y1={h*(0.10 + i*0.07)}
          x2={w*0.85} y2={h*(0.10 + i*0.07)}
          stroke="rgba(100,180,255,0.45)" strokeWidth={0.8} />
      ))}

      {/* USB micro-B */}
      <rect x={w*0.32} y={-6} width={w*0.36} height={8} rx={1.5} fill="#c0c0c0" />
      <rect x={w*0.35} y={-5} width={w*0.30} height={6} rx={1} fill="#888" />

      {/* LEDs */}
      <circle cx={w*0.22} cy={h*0.62} r={2.5} fill="#22c55e" opacity={0.9} />
      <text x={w*0.22} y={h*0.67} textAnchor="middle" fontSize={3}
        fill="rgba(255,255,255,0.4)" fontFamily="monospace">PWR</text>
      <circle cx={w*0.55} cy={h*0.62} r={2.5} fill="#3b82f6" opacity={0.8} />
      <text x={w*0.55} y={h*0.67} textAnchor="middle" fontSize={3}
        fill="rgba(255,255,255,0.4)" fontFamily="monospace">D2</text>

      {/* Buttons */}
      <rect x={w*0.18} y={h*0.74} width={14} height={8} rx={2} fill="#b91c1c" stroke="#7f1d1d" strokeWidth={0.5} />
      <text x={w*0.25} y={h*0.79} textAnchor="middle" fontSize={3}
        fill="white" fontFamily="monospace">EN</text>
      <rect x={w*0.58} y={h*0.74} width={14} height={8} rx={2} fill="#1d4ed8" stroke="#1e3a8a" strokeWidth={0.5} />
      <text x={w*0.65} y={h*0.79} textAnchor="middle" fontSize={3}
        fill="white" fontFamily="monospace">BOOT</text>

      {/* tsuki-webkit badge */}
      <rect x={w*0.15} y={h*0.87} width={w*0.70} height={10} rx={3}
        fill="rgba(59,130,246,0.12)" stroke="rgba(59,130,246,0.25)" strokeWidth={0.6} />
      <text x={w*0.50} y={h*0.93} textAnchor="middle" fontSize={4}
        fill="#60a5fa" fontFamily="monospace">tsuki-webkit ✓</text>
    </>
  )
}
