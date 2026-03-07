'use client'
import { useState, useId } from 'react'
import { PlacedComponent, CircuitPin, CircuitComponentDef, COMP_DEFS, pinColor, getPinAbsPos } from './SandboxDefs'

// ── Pin tooltip ────────────────────────────────────────────────────────────────
function PinTooltip({ pin, ax, ay, compW }: { pin: CircuitPin; ax: number; ay: number; compW: number }) {
  const left   = ax < compW / 2
  const tx     = left ? ax + 14 : ax - 14
  const anchor = left ? 'start' : 'end'
  const bgX    = left ? tx - 4 : tx - 88
  const c      = pinColor(pin.type)
  const dirBadge = pin.direction ? ` · ${pin.direction}` : ''
  const label  = pin.label + dirBadge

  return (
    <g pointerEvents="none" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }}>
      <rect x={bgX} y={ay - 13} width={92} height={22} rx={5}
        fill="#0d0d0d" stroke={c} strokeWidth={1} opacity={0.97} />
      <text x={left ? tx : tx - 84} y={ay + 2.5}
        fontSize={9} fontFamily="var(--font-mono)" fill={c} fontWeight="700">
        {label}
      </text>
      {/* Type badge */}
      <rect x={left ? tx + label.length * 5.4 + 6 : bgX + 2} y={ay - 10}
        width={20} height={14} rx={3} fill={c} opacity={0.18} />
    </g>
  )
}

// ── Pin dot ────────────────────────────────────────────────────────────────────
export function PinDot({
  pin, comp, hovered, active, onEnter, onLeave, onClick,
}: {
  pin: CircuitPin; comp: PlacedComponent
  hovered: boolean; active: boolean
  onEnter: () => void; onLeave: () => void; onClick: () => void
}) {
  const def = COMP_DEFS[comp.type]
  if (!def) return null
  const ax = pin.rx * def.w
  const ay = pin.ry * def.h
  const c  = pinColor(pin.type)

  return (
    <g transform={`translate(${ax},${ay})`}
      onClick={e => { e.stopPropagation(); onClick() }}
      onMouseEnter={onEnter} onMouseLeave={onLeave}
      style={{ cursor: 'crosshair' }}>
      <circle r={10} fill="transparent" />
      {(hovered || active) && (
        <>
          <circle r={9}   fill={c} opacity={0.12} />
          <circle r={6.5} fill="transparent" stroke={c} strokeWidth={1.5} opacity={0.9} />
        </>
      )}
      <circle r={hovered || active ? 4 : 3}
        fill={c} stroke="#0a0a0a" strokeWidth={1.5}
        style={{ transition: 'r 0.1s' }} />
      {/* Connector stub line */}
      {(pin.rx === 0 || pin.rx === 1) && (
        <line
          x1={pin.rx === 0 ? 0 : 0} y1={0}
          x2={pin.rx === 0 ? -4 : 4} y2={0}
          stroke={c} strokeWidth={1.5} opacity={0.5}
        />
      )}
      {hovered && <PinTooltip pin={pin} ax={ax} ay={0} compW={def.w} />}
    </g>
  )
}

// ── CompShape wrapper ──────────────────────────────────────────────────────────
export function CompShape({
  comp, selected, simPinValues, wireMode, onPointerDown, onPinClick,
}: {
  comp: PlacedComponent; selected: boolean
  simPinValues: Record<string, number>; wireMode: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onPinClick: (pinId: string) => void
}) {
  const def = COMP_DEFS[comp.type]
  if (!def) return null
  const [hoveredPin, setHoveredPin] = useState<string | null>(null)

  return (
    <g transform={`translate(${comp.x},${comp.y})`}
      style={{ cursor: wireMode ? 'default' : 'move' }}
      onPointerDown={onPointerDown}>

      {/* PCB shadow */}
      <rect x={3} y={4} width={def.w} height={def.h} rx={6}
        fill="rgba(0,0,0,0.4)" />

      {/* Selection outline */}
      {selected && (
        <rect x={-4} y={-4} width={def.w + 8} height={def.h + 8} rx={8}
          fill="none" stroke="#60a5fa" strokeWidth={2}
          strokeDasharray="6 3" opacity={0.9}>
          <animateTransform attributeName="transform" type="rotate"
            from={`0 ${def.w/2} ${def.h/2}`} to={`360 ${def.w/2} ${def.h/2}`}
            dur="8s" repeatCount="indefinite" />
        </rect>
      )}

      {/* Component body */}
      <ComponentBody comp={comp} def={def} simPinValues={simPinValues} />

      {/* Label */}
      <text x={def.w / 2} y={def.h + 14}
        textAnchor="middle" fontSize={9.5} fill="var(--fg-muted)"
        fontFamily="var(--font-sans)" fontWeight="500"
        style={{ pointerEvents: 'none', userSelect: 'none' }}>
        {comp.label}
      </text>

      {/* Pins */}
      {def.pins.map(pin => (
        <PinDot key={pin.id} pin={pin} comp={comp}
          hovered={hoveredPin === pin.id}
          active={false}
          onEnter={() => setHoveredPin(pin.id)}
          onLeave={() => setHoveredPin(null)}
          onClick={() => onPinClick(pin.id)}
        />
      ))}
    </g>
  )
}

// ── Body dispatcher ────────────────────────────────────────────────────────────
function ComponentBody({ comp, def, simPinValues }: {
  comp: PlacedComponent; def: CircuitComponentDef; simPinValues: Record<string, number>
}) {
  const { type, color, id } = comp
  const { w, h } = def
  const g = id.replace(/\W/g, '_') // safe gradient ID

  switch (type) {
    case 'arduino_uno':    return <ArduinoUnoBody   w={w} h={h} g={g} />
    case 'arduino_nano':   return <ArduinoNanoBody  w={w} h={h} g={g} />
    case 'xiao_rp2040':    return <XiaoRp2040Body   w={w} h={h} g={g} />
    case 'led': {
      const on = (simPinValues[`${id}:anode`] ?? 0) > 0
      return <LedBody w={w} h={h} color={color} on={on} g={g} />
    }
    case 'led_rgb': {
      const r = (simPinValues[`${id}:red`]   ?? 0) * 255
      const gr= (simPinValues[`${id}:green`] ?? 0) * 255
      const b = (simPinValues[`${id}:blue`]  ?? 0) * 255
      return <RgbLedBody w={w} h={h} r={r} gr={gr} b={b} g={g} />
    }
    case 'buzzer':         return <BuzzerBody      w={w} h={h} active={(simPinValues[`${id}:pos`] ?? 0) > 0} />
    case 'servo':          return <ServoBody       w={w} h={h} val={simPinValues[`${id}:signal`] ?? 0} g={g} />
    case 'button':         return <ButtonBody      w={w} h={h} />
    case 'potentiometer':  return <PotBody         w={w} h={h} g={g} />
    case 'resistor':       return <ResistorBody    w={w} h={h} props={comp.props} />
    case 'capacitor':      return <CapBody         w={w} h={h} color={color} />
    case 'transistor_npn': return <TransBody       w={w} h={h} />
    case 'dht11':          return <Dht11Body       w={w} h={h} g={g} />
    case 'ldr':            return <LdrBody         w={w} h={h} g={g} />
    case 'ultrasonic':     return <UltrasonicBody  w={w} h={h} g={g} />
    case 'ir_sensor':      return <IrBody          w={w} h={h} />
    case 'lcd_16x2': {
      const lines = [
        simPinValues[`${id}:lcd_line0`] ? String(simPinValues[`${id}:lcd_line0`]) : '',
        simPinValues[`${id}:lcd_line1`] ? String(simPinValues[`${id}:lcd_line1`]) : '',
      ]
      return <LcdBody w={w} h={h} lines={lines} g={g} />
    }
    case 'seven_seg':   return <SevenSegBody  w={w} h={h} simVals={simPinValues} id={id} />
    case 'vcc_node':    return <VccNode       w={w} h={h} />
    case 'gnd_node':    return <GndNode       w={w} h={h} />
    case 'power_rail':  return <PowerRail     w={w} h={h} />
    default:            return <DefaultBody   w={w} h={h} color={color} label={def.label} />
  }
}

// ── Arduino Uno ────────────────────────────────────────────────────────────────
function ArduinoUnoBody({ w, h, g }: { w: number; h: number; g: string }) {
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
        <linearGradient id={`gold_${g}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#d4a843" />
          <stop offset="100%" stopColor="#9a7820" />
        </linearGradient>
      </defs>

      {/* PCB */}
      <rect width={w} height={h} rx={6} fill={`url(#pcb_${g})`} />
      {/* PCB inner edge highlight */}
      <rect x={1} y={1} width={w-2} height={h-2} rx={5}
        fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />

      {/* USB Type-B connector */}
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

      {/* ATmega328P IC */}
      <rect x={w*0.22} y={h*0.35} width={w*0.52} height={h*0.30} rx={3} fill={`url(#chip_${g})`} />
      {/* IC legs left */}
      {[0,1,2,3,4,5,6].map(i => (
        <rect key={`il${i}`} x={w*0.20} y={h*(0.37 + i*0.038)} width={w*0.04} height={3} rx={0.5} fill="#c8a843" />
      ))}
      {/* IC legs right */}
      {[0,1,2,3,4,5,6].map(i => (
        <rect key={`ir${i}`} x={w*0.76} y={h*(0.37 + i*0.038)} width={w*0.04} height={3} rx={0.5} fill="#c8a843" />
      ))}
      {/* IC text */}
      <text x={w*0.48} y={h*0.47} textAnchor="middle" fontSize={5.5} fill="#888" fontFamily="monospace" fontWeight="600">ATMEGA328P</text>
      <text x={w*0.48} y={h*0.53} textAnchor="middle" fontSize={4}   fill="#666" fontFamily="monospace">ARDUINO UNO</text>

      {/* Small capacitors */}
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

      {/* LED indicators */}
      {/* Power LED (green) */}
      <circle cx={w*0.82} cy={h*0.14} r={2.5} fill="#22c55e" opacity={0.9}>
        <filter id={`led_g_${g}`}><feGaussianBlur stdDeviation="1.5" /></filter>
      </circle>
      <circle cx={w*0.82} cy={h*0.14} r={1.5} fill="#86efac" />
      {/* TX LED (orange) */}
      <circle cx={w*0.76} cy={h*0.19} r={2} fill="#f97316" opacity={0.8} />
      <circle cx={w*0.76} cy={h*0.19} r={1} fill="#fed7aa" />
      {/* RX LED (orange) */}
      <circle cx={w*0.82} cy={h*0.19} r={2} fill="#f97316" opacity={0.8} />
      <circle cx={w*0.82} cy={h*0.19} r={1} fill="#fed7aa" />
      {/* L LED (yellow) */}
      <circle cx={w*0.88} cy={h*0.19} r={2} fill="#eab308" opacity={0.8} />
      <circle cx={w*0.88} cy={h*0.19} r={1} fill="#fef08a" />

      {/* Pin header connectors — left (digital 0-13) */}
      {Array.from({length:14},(_,i) => (
        <g key={`dpl${i}`} transform={`translate(${-3},${h*(0.065+i*0.050)})`}>
          <rect x={0} y={-2} width={5} height={4} rx={0.5} fill="#1a1a1a" stroke="#444" strokeWidth={0.4} />
          <circle cx={2.5} cy={0} r={1} fill={`url(#gold_${g})`} />
        </g>
      ))}
      {/* Pin header — right (power + analog) */}
      {Array.from({length:10},(_,i) => (
        <g key={`dpr${i}`} transform={`translate(${w-2},${h*(0.065+i*0.085)})`}>
          <rect x={0} y={-2} width={5} height={4} rx={0.5} fill="#1a1a1a" stroke="#444" strokeWidth={0.4} />
          <circle cx={2.5} cy={0} r={1} fill={`url(#gold_${g})`} />
        </g>
      ))}

      {/* Silkscreen text */}
      <text x={w*0.5} y={h*0.14} textAnchor="middle" fontSize={7} fill="rgba(255,255,255,0.55)"
        fontFamily="monospace" fontWeight="700" letterSpacing={0.5}>ARDUINO UNO R3</text>

      {/* Trace lines (decorative) */}
      <line x1={w*0.22} y1={h*0.86} x2={w*0.78} y2={h*0.86} stroke="rgba(255,255,255,0.05)" strokeWidth={0.8} />
      <line x1={w*0.15} y1={h*0.70} x2={w*0.85} y2={h*0.70} stroke="rgba(255,255,255,0.04)" strokeWidth={0.8} />
    </>
  )
}

// ── Arduino Nano ───────────────────────────────────────────────────────────────
function ArduinoNanoBody({ w, h, g }: { w: number; h: number; g: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`nano_${g}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#1e5bb8" />
          <stop offset="100%" stopColor="#0d2f6e" />
        </linearGradient>
      </defs>
      <rect width={w} height={h} rx={4} fill={`url(#nano_${g})`} />
      <rect x={1} y={1} width={w-2} height={h-2} rx={3} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={0.8} />

      {/* USB Mini connector */}
      <rect x={w*0.25} y={-6} width={w*0.5} height={7} rx={1.5} fill="#b0b0b0" />
      <rect x={w*0.3}  y={-4} width={w*0.4} height={4} rx={1} fill="#555" />

      {/* ATmega chip */}
      <rect x={w*0.15} y={h*0.25} width={w*0.7} height={h*0.35} rx={2} fill="#111" />
      {[0,1,2,3].map(i => (
        <rect key={`nl${i}`} x={w*0.1}  y={h*(0.28+i*0.072)} width={w*0.08} height={2.5} rx={0.5} fill="#c8a843" />
      ))}
      {[0,1,2,3].map(i => (
        <rect key={`nr${i}`} x={w*0.82} y={h*(0.28+i*0.072)} width={w*0.08} height={2.5} rx={0.5} fill="#c8a843" />
      ))}
      <text x={w*0.5} y={h*0.46} textAnchor="middle" fontSize={4.5} fill="#888" fontFamily="monospace" fontWeight="600">ATMEGA328</text>
      <text x={w*0.5} y={h*0.12} textAnchor="middle" fontSize={6}   fill="rgba(255,255,255,0.5)" fontFamily="monospace" fontWeight="700">NANO</text>

      {/* LEDs */}
      <circle cx={w*0.82} cy={h*0.15} r={2}   fill="#22c55e" opacity={0.9} />
      <circle cx={w*0.72} cy={h*0.15} r={1.5} fill="#f97316" opacity={0.8} />
    </>
  )
}

// ── XIAO RP2040 ────────────────────────────────────────────────────────────────
function XiaoRp2040Body({ w, h, g }: { w: number; h: number; g: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`xiao_${g}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#16a34a" />
          <stop offset="100%" stopColor="#052e16" />
        </linearGradient>
        <radialGradient id={`xiao_np_${g}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="40%"  stopColor="#a78bfa" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.3" />
        </radialGradient>
      </defs>

      {/* PCB */}
      <rect width={w} height={h} rx={3} fill={`url(#xiao_${g})`} />
      <rect x={1} y={1} width={w-2} height={h-2} rx={2.5} fill="none"
            stroke="rgba(255,255,255,0.12)" strokeWidth={0.8} />

      {/* USB-C top */}
      <rect x={w*0.28} y={-5} width={w*0.44} height={6.5} rx={1.5} fill="#999" />
      <rect x={w*0.33} y={-4} width={w*0.34} height={4}   rx={1}   fill="#444" />
      <text x={w*0.5}  y={-0.5} textAnchor="middle" fontSize={3.5} fill="#aaa" fontFamily="monospace">C</text>

      {/* RP2040 chip */}
      <rect x={w*0.18} y={h*0.22} width={w*0.64} height={h*0.32} rx={2} fill="#0f0f0f" />
      <rect x={w*0.20} y={h*0.24} width={w*0.60} height={h*0.28} rx={1.5} fill="none"
            stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
      {[0,1,2,3,4].map(i => (
        <rect key={`cl${i}`} x={w*0.13}  y={h*(0.24+i*0.054)} width={w*0.07} height={2.2} rx={0.5} fill="#c8a843" />
      ))}
      {[0,1,2,3,4].map(i => (
        <rect key={`cr${i}`} x={w*0.80}  y={h*(0.24+i*0.054)} width={w*0.07} height={2.2} rx={0.5} fill="#c8a843" />
      ))}
      <text x={w*0.5} y={h*0.365} textAnchor="middle" fontSize={4.2} fill="#777" fontFamily="monospace" fontWeight="700">RP2040</text>
      <text x={w*0.5} y={h*0.405} textAnchor="middle" fontSize={3.2} fill="#555" fontFamily="monospace">133 MHz</text>

      {/* NeoPixel RGB */}
      <circle cx={w*0.5}  cy={h*0.68} r={4}   fill={`url(#xiao_np_${g})`} />
      <circle cx={w*0.5}  cy={h*0.68} r={4.5} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={0.5} />
      <text   x={w*0.5}   y={h*0.745} textAnchor="middle" fontSize={3} fill="rgba(255,255,255,0.4)" fontFamily="monospace">NEO</text>

      {/* Status LEDs: PWR · CHG · USER */}
      <circle cx={w*0.20} cy={h*0.82} r={2}   fill="#22c55e" opacity={0.85} />
      <circle cx={w*0.50} cy={h*0.82} r={2}   fill="#f97316" opacity={0.80} />
      <circle cx={w*0.80} cy={h*0.82} r={2}   fill="#3b82f6" opacity={0.85} />
      <text   x={w*0.20}  y={h*0.875} textAnchor="middle" fontSize={2.8} fill="rgba(255,255,255,0.35)" fontFamily="monospace">PWR</text>
      <text   x={w*0.50}  y={h*0.875} textAnchor="middle" fontSize={2.8} fill="rgba(255,255,255,0.35)" fontFamily="monospace">CHG</text>
      <text   x={w*0.80}  y={h*0.875} textAnchor="middle" fontSize={2.8} fill="rgba(255,255,255,0.35)" fontFamily="monospace">USR</text>

      {/* Reset button */}
      <rect x={w*0.35} y={h*0.91} width={w*0.12} height={h*0.055} rx={1.5} fill="#1a1a1a" stroke="#555" strokeWidth={0.5} />
      <text x={w*0.41}  y={h*0.95}  textAnchor="middle" fontSize={2.5} fill="#666" fontFamily="monospace">RST</text>

      {/* Label */}
      <text x={w*0.5}  y={h*0.135} textAnchor="middle" fontSize={5}   fill="rgba(255,255,255,0.6)" fontFamily="monospace" fontWeight="700">XIAO</text>
      <text x={w*0.5}  y={h*0.195} textAnchor="middle" fontSize={3.5} fill="rgba(255,255,255,0.35)" fontFamily="monospace">RP2040</text>

      {/* Castellated edge pads */}
      {[0.08,0.20,0.32,0.44,0.56,0.68,0.80].map((ry, i) => (
        <rect key={`pl${i}`} x={0} y={h*ry - 2} width={3} height={4} rx={0.5} fill="rgba(200,168,67,0.5)" />
      ))}
      {[0.08,0.20,0.32,0.44,0.56,0.68,0.80].map((ry, i) => (
        <rect key={`pr${i}`} x={w-3} y={h*ry - 2} width={3} height={4} rx={0.5} fill="rgba(200,168,67,0.5)" />
      ))}
    </>
  )
}

// ── LED ────────────────────────────────────────────────────────────────────────
function LedBody({ w, h, color, on, g }: { w: number; h: number; color: string; on: boolean; g: string }) {
  const opacity = on ? 1 : 0.35
  const glowR   = on ? 22 : 0
  return (
    <>
      <defs>
        <radialGradient id={`led_${g}`} cx="50%" cy="35%" r="60%">
          <stop offset="0%"   stopColor="white"  stopOpacity={on ? 0.9 : 0.3} />
          <stop offset="40%"  stopColor={color}  stopOpacity={0.8} />
          <stop offset="100%" stopColor={color}  stopOpacity={0.3} />
        </radialGradient>
        {on && (
          <filter id={`glow_${g}`} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        )}
      </defs>

      {/* Glow halo when on */}
      {on && <ellipse cx={w/2} cy={h*0.4} rx={glowR} ry={glowR}
        fill={color} opacity={0.15} />}

      {/* Wire leads */}
      <line x1={w*0.38} y1={0}      x2={w*0.38} y2={h*0.24} stroke="#aaa" strokeWidth={1.5} />
      <line x1={w*0.62} y1={0}      x2={w*0.62} y2={h*0.24} stroke="#aaa" strokeWidth={1.5} />
      <line x1={w*0.38} y1={h*0.72} x2={w*0.38} y2={h}      stroke="#aaa" strokeWidth={1.5} />
      <line x1={w*0.62} y1={h*0.72} x2={w*0.62} y2={h}      stroke="#aaa" strokeWidth={1.5} />

      {/* LED body — flat base */}
      <rect x={w*0.12} y={h*0.24} width={w*0.76} height={h*0.25} rx={2}
        fill={`url(#led_${g})`} stroke={color} strokeWidth={0.8} opacity={opacity} />
      {/* LED dome */}
      <ellipse cx={w/2} cy={h*0.44} rx={w*0.40} ry={h*0.20}
        fill={`url(#led_${g})`} stroke={color} strokeWidth={0.8} opacity={opacity}
        filter={on ? `url(#glow_${g})` : undefined} />
      {/* Flat cathode notch */}
      <rect x={w*0.35} y={h*0.44} width={w*0.14} height={h*0.06}
        fill="rgba(0,0,0,0.4)" rx={1} />
      {/* Highlight glint */}
      {on && <ellipse cx={w*0.43} cy={h*0.38} rx={w*0.08} ry={h*0.04}
        fill="white" opacity={0.6} />}

      {/* Polarity markers */}
      <text x={w*0.28} y={h*0.18} fontSize={7} fill="rgba(255,255,255,0.5)" fontFamily="monospace">+</text>
      <text x={w*0.60} y={h*0.18} fontSize={7} fill="rgba(255,255,255,0.5)" fontFamily="monospace">-</text>
    </>
  )
}

// ── RGB LED ────────────────────────────────────────────────────────────────────
function RgbLedBody({ w, h, r, gr, b, g }: { w: number; h: number; r: number; gr: number; b: number; g: string }) {
  const hex = `rgb(${Math.round(r)},${Math.round(gr)},${Math.round(b)})`
  const on = r > 0 || gr > 0 || b > 0
  return (
    <>
      <defs>
        <radialGradient id={`rgb_${g}`} cx="50%" cy="35%" r="65%">
          <stop offset="0%"   stopColor="white"  stopOpacity={on ? 0.8 : 0.2} />
          <stop offset="100%" stopColor={hex}     stopOpacity={on ? 0.7 : 0.2} />
        </radialGradient>
      </defs>
      {on && <ellipse cx={w/2} cy={h*0.4} rx={20} ry={20} fill={hex} opacity={0.12} />}
      <line x1={w*0.25} y1={0} x2={w*0.25} y2={h*0.25} stroke="#aaa" strokeWidth={1.5} />
      <line x1={w*0.5}  y1={0} x2={w*0.5}  y2={h*0.25} stroke="#aaa" strokeWidth={1.5} />
      <line x1={w*0.75} y1={0} x2={w*0.75} y2={h*0.25} stroke="#aaa" strokeWidth={1.5} />
      <line x1={w*0.5}  y1={h*0.72} x2={w*0.5} y2={h}  stroke="#aaa" strokeWidth={1.5} />
      <rect x={w*0.1} y={h*0.25} width={w*0.8} height={h*0.22} rx={2} fill={`url(#rgb_${g})`} stroke={hex} strokeWidth={0.8} />
      <ellipse cx={w/2} cy={h*0.44} rx={w*0.40} ry={h*0.18} fill={`url(#rgb_${g})`} stroke={hex} strokeWidth={0.8} />
    </>
  )
}

// ── Buzzer ─────────────────────────────────────────────────────────────────────
function BuzzerBody({ w, h, active }: { w: number; h: number; active: boolean }) {
  return (
    <>
      <circle cx={w/2} cy={h/2} r={w/2-1} fill="#1a1a1a" stroke="#444" strokeWidth={1} />
      {/* Concentric rings */}
      {[0.35, 0.55, 0.72].map((r, i) => (
        <circle key={i} cx={w/2} cy={h/2} r={w*r/2}
          fill="none" stroke={active ? "#a0a0a0" : "#333"} strokeWidth={0.8} />
      ))}
      <circle cx={w/2} cy={h/2} r={w*0.12} fill={active ? "#e0e0e0" : "#444"} />
      {active && <circle cx={w/2} cy={h/2} r={w/2-1} fill="#f97316" opacity={0.05}>
        <animate attributeName="r" from={w*0.1} to={w/2-1} dur="0.2s" repeatCount="indefinite" />
        <animate attributeName="opacity" from={0.15} to={0} dur="0.2s" repeatCount="indefinite" />
      </circle>}
      <text x={w/2+1} y={h*0.22} textAnchor="middle" fontSize={5} fill="#888" fontFamily="monospace">+</text>
    </>
  )
}

// ── Servo ──────────────────────────────────────────────────────────────────────
function ServoBody({ w, h, val, g }: { w: number; h: number; val: number; g: string }) {
  const angle = val * 180 - 90
  return (
    <>
      <rect width={w} height={h} rx={4} fill="#2a2a2a" stroke="#444" strokeWidth={0.8} />
      <rect x={2} y={2} width={w-4} height={h-4} rx={3} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={0.5} />
      {/* Servo body detail */}
      <rect x={w*0.1} y={h*0.15} width={w*0.8} height={h*0.55} rx={2} fill="#333" />
      {/* Servo horn */}
      <g transform={`translate(${w/2},${h*0.42}) rotate(${angle})`}>
        <rect x={-4} y={-20} width={8} height={22} rx={4} fill="#e0e0e0" stroke="#aaa" strokeWidth={0.5} />
        <circle cx={0} cy={-18} r={2.5} fill="#888" />
      </g>
      <circle cx={w/2} cy={h*0.42} r={5} fill="#555" stroke="#777" strokeWidth={0.5} />
      <text x={w/2} y={h*0.85} textAnchor="middle" fontSize={6} fill="#888" fontFamily="monospace">SERVO</text>
    </>
  )
}

// ── Tactile Button ─────────────────────────────────────────────────────────────
function ButtonBody({ w, h }: { w: number; h: number }) {
  return (
    <>
      {/* PCB base */}
      <rect width={w} height={h} rx={3} fill="#2a2a2a" stroke="#555" strokeWidth={0.8} />
      <rect x={1.5} y={1.5} width={w-3} height={h-3} rx={2} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={0.5} />
      {/* Button body */}
      <rect x={w*0.18} y={h*0.18} width={w*0.64} height={h*0.64} rx={2}
        fill="#3a3a3a" stroke="#666" strokeWidth={0.8} />
      {/* Button cap */}
      <rect x={w*0.25} y={h*0.25} width={w*0.5} height={h*0.5} rx={2}
        fill="#555" stroke="#888" strokeWidth={0.6} />
      <rect x={w*0.30} y={h*0.30} width={w*0.40} height={w*0.40} rx={1.5}
        fill="#666" />
      {/* Legs */}
      {[[0.18,0.25],[0.18,0.72],[0.82,0.25],[0.82,0.72]].map(([px,py],i) => (
        <circle key={i} cx={w*px} cy={h*py} r={2} fill="#c8a843" stroke="#9a7820" strokeWidth={0.5} />
      ))}
    </>
  )
}

// ── Potentiometer ──────────────────────────────────────────────────────────────
function PotBody({ w, h, g }: { w: number; h: number; g: string }) {
  return (
    <>
      <defs>
        <radialGradient id={`pot_${g}`} cx="40%" cy="35%" r="65%">
          <stop offset="0%"   stopColor="#5a5a5a" />
          <stop offset="100%" stopColor="#1a1a1a" />
        </radialGradient>
      </defs>
      <rect width={w} height={h} rx={3} fill="#2a2a2a" stroke="#555" strokeWidth={0.8} />
      {/* Pot body */}
      <circle cx={w/2} cy={h/2} r={w*0.40} fill={`url(#pot_${g})`} stroke="#666" strokeWidth={1} />
      {/* Knob track arc */}
      <path d={`M ${w*0.18} ${h*0.82} A ${w*0.34} ${h*0.34} 0 1 1 ${w*0.82} ${h*0.82}`}
        fill="none" stroke="#888" strokeWidth={2} strokeLinecap="round" />
      {/* Knob indicator */}
      <line x1={w/2} y1={h/2} x2={w/2} y2={h*0.17}
        stroke="#e0e0e0" strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={w/2} cy={h/2} r={3} fill="#888" />
      {/* Shaft */}
      <circle cx={w/2} cy={h/2} r={5} fill="#444" stroke="#666" strokeWidth={0.5} />
      {/* Legs */}
      {[[0.15,0.85],[0.85,0.85],[0.5,0.92]].map(([px,py],i) => (
        <circle key={i} cx={w*px} cy={h*py} r={2} fill="#c8a843" />
      ))}
    </>
  )
}

// ── Resistor ───────────────────────────────────────────────────────────────────
const BAND_COLORS = ['#1a1a1a','#7b3f00','#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#a855f7','#888888','#f5f5f5']
function resistorBands(ohms: number): string[] {
  const n = Math.round(ohms)
  if (n <= 0) return ['#7b3f00','#1a1a1a','#1a1a1a','#ffd700']
  const s = n.toString()
  const d1 = parseInt(s[0]) || 0
  const d2 = parseInt(s[1]) || 0
  const mult = Math.max(0, s.length - 2)
  const tol = '#ffd700' // gold ±5%
  return [BAND_COLORS[d1], BAND_COLORS[d2], BAND_COLORS[mult], tol]
}
function ResistorBody({ w, h, props }: { w: number; h: number; props: Record<string, string|number> }) {
  const ohms = Number(props.ohms ?? 1000)
  const bands = resistorBands(ohms)
  const label = ohms >= 1000 ? `${(ohms/1000).toFixed(ohms%1000===0?0:1)}k` : `${ohms}`
  return (
    <>
      {/* Leads */}
      <line x1={0} y1={h/2} x2={w*0.2} y2={h/2} stroke="#b8b8b8" strokeWidth={1.8} />
      <line x1={w*0.8} y1={h/2} x2={w} y2={h/2} stroke="#b8b8b8" strokeWidth={1.8} />
      {/* Body */}
      <rect x={w*0.18} y={h*0.14} width={w*0.64} height={h*0.72} rx={h*0.36}
        fill="#d4b896" />
      {/* Gloss */}
      <rect x={w*0.20} y={h*0.16} width={w*0.60} height={h*0.68} rx={h*0.34}
        fill="none" stroke="#e8d0b4" strokeWidth={1} />
      {/* Bands */}
      {bands.map((c, i) => (
        <rect key={i} x={w*(0.26+i*0.14)} y={h*0.10} width={w*0.08} height={h*0.80}
          rx={1} fill={c} opacity={0.9} />
      ))}
      <text x={w/2} y={h + 10} textAnchor="middle" fontSize={7.5} fill="var(--fg-muted)"
        fontFamily="var(--font-mono)">{label}Ω</text>
    </>
  )
}

// ── Capacitor ──────────────────────────────────────────────────────────────────
function CapBody({ w, h, color }: { w: number; h: number; color: string }) {
  return (
    <>
      <line x1={w*0.4} y1={0} x2={w*0.4} y2={h*0.18} stroke="#b8b8b8" strokeWidth={1.5} />
      <line x1={w*0.6} y1={0} x2={w*0.6} y2={h*0.18} stroke="#b8b8b8" strokeWidth={1.5} />
      <line x1={w*0.4} y1={h*0.82} x2={w*0.4} y2={h} stroke="#b8b8b8" strokeWidth={1.5} />
      <line x1={w*0.6} y1={h*0.82} x2={w*0.6} y2={h} stroke="#b8b8b8" strokeWidth={1.5} />
      {/* Can */}
      <rect x={w*0.1} y={h*0.18} width={w*0.8} height={h*0.64} rx={w*0.35}
        fill={color || '#4a6fa5'} stroke="#2a4a85" strokeWidth={0.8} />
      {/* Polarity stripe */}
      <rect x={w*0.1} y={h*0.18} width={w*0.2} height={h*0.64} rx={0}
        fill="rgba(0,0,0,0.25)" />
      <text x={w*0.15} y={h*0.5+2} textAnchor="middle" fontSize={6} fill="rgba(255,255,255,0.7)" fontFamily="monospace">–</text>
      {/* Cap top */}
      <ellipse cx={w/2} cy={h*0.18} rx={w*0.40} ry={h*0.06}
        fill="rgba(255,255,255,0.15)" />
    </>
  )
}

// ── Transistor NPN ─────────────────────────────────────────────────────────────
function TransBody({ w, h }: { w: number; h: number }) {
  return (
    <>
      {/* TO-92 body */}
      <path d={`M ${w*0.15} ${h*0.55} A ${w*0.45} ${h*0.5} 0 0 1 ${w*0.85} ${h*0.55} L ${w*0.85} ${h} L ${w*0.15} ${h} Z`}
        fill="#111" stroke="#444" strokeWidth={0.8} />
      {/* Flat face */}
      <line x1={w*0.15} y1={h*0.55} x2={w*0.85} y2={h*0.55} stroke="#555" strokeWidth={0.8} />
      {/* Legs */}
      <line x1={w*0.25} y1={h} x2={w*0.25} y2={h*1.1} stroke="#b8b8b8" strokeWidth={1.5} />
      <line x1={w*0.50} y1={h} x2={w*0.50} y2={h*1.1} stroke="#b8b8b8" strokeWidth={1.5} />
      <line x1={w*0.75} y1={h} x2={w*0.75} y2={h*1.1} stroke="#b8b8b8" strokeWidth={1.5} />
      <text x={w*0.25} y={h*0.78} textAnchor="middle" fontSize={5} fill="#888" fontFamily="monospace">B</text>
      <text x={w*0.50} y={h*0.78} textAnchor="middle" fontSize={5} fill="#888" fontFamily="monospace">C</text>
      <text x={w*0.75} y={h*0.78} textAnchor="middle" fontSize={5} fill="#888" fontFamily="monospace">E</text>
      {/* Model */}
      <text x={w*0.5} y={h*0.45} textAnchor="middle" fontSize={5.5} fill="rgba(255,255,255,0.5)" fontFamily="monospace">2N2222</text>
    </>
  )
}

// ── DHT11 ──────────────────────────────────────────────────────────────────────
function Dht11Body({ w, h, g }: { w: number; h: number; g: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`dht_${g}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#1a6bb8" />
          <stop offset="100%" stopColor="#0d3a70" />
        </linearGradient>
      </defs>
      <rect width={w} height={h} rx={4} fill={`url(#dht_${g})`} />
      <rect x={1.5} y={1.5} width={w-3} height={h-3} rx={3} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={0.5} />
      {/* Sensor grille */}
      <rect x={w*0.08} y={h*0.06} width={w*0.84} height={h*0.58} rx={3}
        fill="#0a2550" stroke="#0d3a70" strokeWidth={0.5} />
      {[0.12, 0.22, 0.32, 0.42, 0.52].map((fy, i) => (
        <line key={i} x1={w*0.12} y1={h*fy} x2={w*0.88} y2={h*fy}
          stroke="rgba(255,255,255,0.12)" strokeWidth={0.8} />
      ))}
      {[0.18, 0.35, 0.52, 0.69, 0.86].map((fx, i) => (
        <line key={i} x1={w*fx} y1={h*0.06} x2={w*fx} y2={h*0.64}
          stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
      ))}
      <text x={w/2} y={h*0.80} textAnchor="middle" fontSize={7.5} fill="rgba(255,255,255,0.75)"
        fontFamily="monospace" fontWeight="700">DHT11</text>
      <text x={w/2} y={h*0.92} textAnchor="middle" fontSize={5} fill="rgba(255,255,255,0.35)"
        fontFamily="monospace">T+RH</text>
    </>
  )
}

// ── LDR ────────────────────────────────────────────────────────────────────────
function LdrBody({ w, h, g }: { w: number; h: number; g: string }) {
  return (
    <>
      <defs>
        <radialGradient id={`ldr_${g}`} cx="45%" cy="40%" r="60%">
          <stop offset="0%"   stopColor="#e8a000" />
          <stop offset="100%" stopColor="#a06000" />
        </radialGradient>
      </defs>
      <line x1={0} y1={h/2} x2={w*0.14} y2={h/2} stroke="#b8b8b8" strokeWidth={1.8} />
      <line x1={w*0.86} y1={h/2} x2={w} y2={h/2} stroke="#b8b8b8" strokeWidth={1.8} />
      <circle cx={w/2} cy={h/2} r={w*0.44} fill={`url(#ldr_${g})`} stroke="#7a5500" strokeWidth={1} />
      {/* Snake photoresistor pattern */}
      <path d={`M ${w*0.24} ${h*0.36} Q ${w*0.5} ${h*0.24} ${w*0.76} ${h*0.36}
               Q ${w*0.5} ${h*0.50} ${w*0.24} ${h*0.64}
               Q ${w*0.5} ${h*0.76} ${w*0.76} ${h*0.64}`}
        fill="none" stroke="#7a5500" strokeWidth={2} strokeLinecap="round" />
      {/* Light rays */}
      {[-45, -15, 15, 45].map((angle, i) => {
        const rad = (angle - 80) * Math.PI / 180
        const r1 = w * 0.52, r2 = w * 0.65
        return (
          <line key={i}
            x1={w/2 + Math.cos(rad) * r1} y1={h/2 + Math.sin(rad) * r1}
            x2={w/2 + Math.cos(rad) * r2} y2={h/2 + Math.sin(rad) * r2}
            stroke="#ffd700" strokeWidth={1.2} opacity={0.6} strokeLinecap="round" />
        )
      })}
    </>
  )
}

// ── HC-SR04 Ultrasonic ─────────────────────────────────────────────────────────
function UltrasonicBody({ w, h, g }: { w: number; h: number; g: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`us_${g}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#2a5a3a" />
          <stop offset="100%" stopColor="#1a3a28" />
        </linearGradient>
      </defs>
      <rect width={w} height={h} rx={3} fill={`url(#us_${g})`} />
      <rect x={1} y={1} width={w-2} height={h-2} rx={2} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={0.5} />
      {/* Two transducer cylinders */}
      {[0.22, 0.60].map((cx, i) => (
        <g key={i}>
          <ellipse cx={w*cx} cy={h*0.50} rx={w*0.16} ry={h*0.37}
            fill="#111" stroke="#444" strokeWidth={0.8} />
          {/* Metallic rings */}
          {[0.35, 0.50, 0.65].map((ry, j) => (
            <ellipse key={j} cx={w*cx} cy={h*ry} rx={w*0.14} ry={h*0.04}
              fill="none" stroke="#333" strokeWidth={0.5} />
          ))}
          <ellipse cx={w*cx} cy={h*0.50} rx={w*0.08} ry={h*0.18}
            fill="#0d0d0d" />
        </g>
      ))}
      <text x={w*0.5} y={h*0.88} textAnchor="middle" fontSize={5} fill="rgba(255,255,255,0.4)"
        fontFamily="monospace">HC-SR04</text>
    </>
  )
}

// ── IR Sensor ──────────────────────────────────────────────────────────────────
function IrBody({ w, h }: { w: number; h: number }) {
  return (
    <>
      <rect width={w} height={h} rx={3} fill="#111" stroke="#333" strokeWidth={0.8} />
      {/* IR emitter (clear) */}
      <ellipse cx={w*0.25} cy={h/2} rx={7} ry={8} fill="#2a2a2a" stroke="#555" strokeWidth={0.8} />
      <ellipse cx={w*0.25} cy={h/2} rx={4} ry={5} fill="#555" opacity={0.8} />
      <ellipse cx={w*0.24} cy={h*0.45} rx={2} ry={1.5} fill="rgba(255,255,255,0.2)" />
      {/* IR receiver */}
      <ellipse cx={w*0.65} cy={h/2} rx={7} ry={8} fill="#1a1a1a" stroke="#333" strokeWidth={0.8} />
      <ellipse cx={w*0.65} cy={h/2} rx={4} ry={5} fill="#0a0a0a" />
      {/* Status LED */}
      <circle cx={w*0.88} cy={h*0.3} r={2.5} fill="#ef4444" opacity={0.9} />
      <circle cx={w*0.88} cy={h*0.3} r={1.2} fill="#fca5a5" />
      {/* PCB text */}
      <text x={w*0.5} y={h*0.90} textAnchor="middle" fontSize={5} fill="rgba(255,255,255,0.3)"
        fontFamily="monospace">IR SENSOR</text>
    </>
  )
}

// ── LCD 16x2 ──────────────────────────────────────────────────────────────────
function LcdBody({ w, h, lines, g }: { w: number; h: number; lines: string[]; g: string }) {
  const active = true
  const bg = active ? '#1e5a2a' : '#0a2a10'
  return (
    <>
      <defs>
        <linearGradient id={`lcd_${g}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor={bg} />
          <stop offset="100%" stopColor={active ? '#143d1c' : '#061508'} />
        </linearGradient>
      </defs>
      <rect width={w} height={h} rx={3} fill={`url(#lcd_${g})`} />
      <rect x={1.5} y={1.5} width={w-3} height={h-3} rx={2} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
      {/* Display area */}
      <rect x={w*0.03} y={h*0.08} width={w*0.94} height={h*0.72} rx={2}
        fill={active ? '#2d6e35' : '#0f2a14'} />
      {/* Character cells */}
      {Array.from({length:16}, (_, col) =>
        Array.from({length:2}, (_, row) => (
          <rect key={`${col}-${row}`}
            x={w*(0.05 + col*0.057)} y={h*(0.11 + row*0.32)}
            width={w*0.050} height={h*0.28}
            fill="none"
            stroke={active ? 'rgba(0,200,0,0.12)' : 'rgba(255,255,255,0.03)'}
            strokeWidth={0.4} />
        ))
      ).flat()}
      {/* Display text */}
      {lines[0] && (
        <text x={w*0.06} y={h*0.32} fontSize={5.5}
          fill={active ? 'rgba(0,255,80,0.85)' : 'transparent'} fontFamily="monospace">
          {lines[0].substring(0,16).padEnd(16,' ')}
        </text>
      )}
      {lines[1] && (
        <text x={w*0.06} y={h*0.62} fontSize={5.5}
          fill={active ? 'rgba(0,255,80,0.85)' : 'transparent'} fontFamily="monospace">
          {lines[1].substring(0,16).padEnd(16,' ')}
        </text>
      )}
      {!lines[0] && !lines[1] && active && (
        <>
          <text x={w*0.06} y={h*0.32} fontSize={5.5} fill="rgba(0,255,80,0.6)" fontFamily="monospace">LCD 16x2</text>
          <text x={w*0.06} y={h*0.62} fontSize={5.5} fill="rgba(0,255,80,0.4)" fontFamily="monospace">Hello World!</text>
        </>
      )}
      <text x={w/2} y={h*0.91} textAnchor="middle" fontSize={5} fill="rgba(255,255,255,0.3)" fontFamily="monospace">HD44780</text>
    </>
  )
}

// ── 7-Segment ──────────────────────────────────────────────────────────────────
function SevenSegBody({ w, h, simVals, id }: { w: number; h: number; simVals: Record<string,number>; id: string }) {
  const seg  = (s: string) => (simVals[`${id}:${s}`] ?? 0) > 0
  const on   = 'rgba(255,90,30,1)'
  const off  = 'rgba(50,15,5,0.8)'
  const glow = (s: string) => seg(s) ? { filter: 'drop-shadow(0 0 3px rgba(255,80,20,0.8))' } : {}
  const W = w * 0.62; const ox = (w - W) / 2
  return (
    <>
      <rect width={w} height={h} rx={3} fill="#111" />
      <rect x={ox-4} y={h*0.04} width={W+8} height={h*0.75} rx={2} fill="#0a0a0a" />
      {/* a - top */}
      <rect x={ox+4} y={h*0.07} width={W-8} height={h*0.08} rx={2} fill={seg('a')?on:off} style={glow('a')} />
      {/* b - top-right */}
      <rect x={ox+W-8} y={h*0.07} width={h*0.09} height={h*0.32} rx={2} fill={seg('b')?on:off} style={glow('b')} />
      {/* c - bot-right */}
      <rect x={ox+W-8} y={h*0.44} width={h*0.09} height={h*0.32} rx={2} fill={seg('c')?on:off} style={glow('c')} />
      {/* d - bottom */}
      <rect x={ox+4} y={h*0.70} width={W-8} height={h*0.08} rx={2} fill={seg('d')?on:off} style={glow('d')} />
      {/* e - bot-left */}
      <rect x={ox+0} y={h*0.44} width={h*0.09} height={h*0.32} rx={2} fill={seg('e')?on:off} style={glow('e')} />
      {/* f - top-left */}
      <rect x={ox+0} y={h*0.07} width={h*0.09} height={h*0.32} rx={2} fill={seg('f')?on:off} style={glow('f')} />
      {/* g - middle */}
      <rect x={ox+4} y={h*0.40} width={W-8} height={h*0.08} rx={2} fill={seg('g')?on:off} style={glow('g')} />
      {/* dp */}
      <circle cx={ox+W+5} cy={h*0.74} r={h*0.04} fill={seg('dp')?on:off} />
    </>
  )
}

// ── Power nodes ────────────────────────────────────────────────────────────────
function VccNode({ w, h }: { w: number; h: number }) {
  return (
    <>
      <circle cx={w/2} cy={h/2} r={w/2-0.5} fill="#7f1d1d" stroke="#ef4444" strokeWidth={1.2} />
      <circle cx={w/2} cy={h/2} r={w/2-3}   fill="#991b1b" />
      <text x={w/2} y={h/2+3.5} textAnchor="middle" fontSize={9} fill="#fca5a5"
        fontFamily="monospace" fontWeight="800">5V</text>
    </>
  )
}

function GndNode({ w, h }: { w: number; h: number }) {
  return (
    <>
      <rect width={w} height={h} rx={3} fill="#111" stroke="#374151" strokeWidth={1} />
      <line x1={w/2} y1={h*0.16} x2={w/2} y2={h*0.42} stroke="#9ca3af" strokeWidth={1.8} />
      <line x1={w*0.12} y1={h*0.42} x2={w*0.88} y2={h*0.42} stroke="#9ca3af" strokeWidth={1.8} />
      <line x1={w*0.24} y1={h*0.56} x2={w*0.76} y2={h*0.56} stroke="#9ca3af" strokeWidth={1.4} />
      <line x1={w*0.38} y1={h*0.70} x2={w*0.62} y2={h*0.70} stroke="#9ca3af" strokeWidth={1} />
    </>
  )
}

function PowerRail({ w, h }: { w: number; h: number }) {
  return (
    <>
      <rect width={w} height={h} rx={2} fill="#111" stroke="#2a2a2a" strokeWidth={0.8} />
      {/* 5V zone */}
      <rect x={1.5} y={h*0.02} width={w-3} height={h*0.46} rx={1.5}
        fill="#7f1d1d" opacity={0.4} />
      <text x={w/2} y={h*0.18} textAnchor="middle" fontSize={5.5} fill="#fca5a5" fontFamily="monospace" fontWeight="700">5V</text>
      {[0.08,0.22,0.36].map((ry,i) => (
        <circle key={i} cx={w/2} cy={h*ry} r={2.5} fill="#ef4444" opacity={0.8} />
      ))}
      {/* GND zone */}
      <rect x={1.5} y={h*0.52} width={w-3} height={h*0.46} rx={1.5}
        fill="#222" opacity={0.7} />
      <text x={w/2} y={h*0.66} textAnchor="middle" fontSize={5.5} fill="#9ca3af" fontFamily="monospace" fontWeight="700">G</text>
      {[0.64,0.78,0.92].map((ry,i) => (
        <circle key={i} cx={w/2} cy={h*ry} r={2.5} fill="#4b5563" opacity={0.8} />
      ))}
    </>
  )
}

function DefaultBody({ w, h, color, label }: { w: number; h: number; color: string; label: string }) {
  return (
    <>
      <rect width={w} height={h} rx={4} fill={color} stroke="rgba(255,255,255,0.1)" strokeWidth={0.8} />
      <rect x={1} y={1} width={w-2} height={h-2} rx={3} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
      <text x={w/2} y={h/2+4} textAnchor="middle" fontSize={10}
        fill="rgba(255,255,255,0.8)" fontFamily="var(--font-sans)" fontWeight="600">{label}</text>
    </>
  )
}

// ── SVG global defs (call once at root SVG) ───────────────────────────────────
export function SvgGlobalDefs() {
  return (
    <defs>
      <filter id="comp-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="2" dy="3" stdDeviation="3" floodOpacity="0.4" />
      </filter>
    </defs>
  )
}