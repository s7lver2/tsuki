'use client'
import { useState } from 'react'
import { PlacedComponent, CircuitPin, CircuitComponentDef, COMP_DEFS, pinColor } from './SandboxDefs'

// ── Shape sub-modules ─────────────────────────────────────────────────────────
import { ArduinoUnoBody, ArduinoNanoBody, XiaoRp2040Body, Esp8266Body, Esp32Body } from './shapes/board-shapes'
import { LedBody, RgbLedBody, BuzzerBody, ServoBody,
         LcdBody, OledBody, SevenSegBody, NeopixelRingBody }          from './shapes/output-shapes'
import { ButtonBody, PotBody, SlideSwitchBody, RotaryEncoderBody,
         Dht11Body, LdrBody, UltrasonicBody, IrBody, ThermistorBody } from './shapes/input-shapes'
import { ResistorBody, CapBody, TransBody, MosfetBody, DiodeBody }    from './shapes/passive-shapes'
import { VccNode, GndNode, PowerRail }                                from './shapes/power-shapes'
import { RelayBody, L298nBody, BreadboardBody, BreadboardFullBody,
         DcMotorBody, Header8Body, DefaultBody }                      from './shapes/misc-shapes'

// ── Pin tooltip ────────────────────────────────────────────────────────────────
function PinTooltip({ pin, ax, ay, compW }: {
  pin: CircuitPin; ax: number; ay: number; compW: number
}) {
  const left     = ax < compW / 2
  const tx       = left ? ax + 14 : ax - 14
  const bgX      = left ? tx - 4 : tx - 88
  const c        = pinColor(pin.type)
  const dirBadge = pin.direction ? ` · ${pin.direction}` : ''
  const label    = pin.label + dirBadge
  return (
    <g pointerEvents="none" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }}>
      <rect x={bgX} y={ay - 13} width={92} height={22} rx={5}
        fill="#0d0d0d" stroke={c} strokeWidth={1} opacity={0.97} />
      <text x={left ? tx : tx - 84} y={ay + 2.5}
        fontSize={9} fontFamily="var(--font-mono)" fill={c} fontWeight="700">
        {label}
      </text>
      <rect x={left ? tx + label.length * 5.4 + 6 : bgX + 2} y={ay - 10}
        width={20} height={14} rx={3} fill={c} opacity={0.18} />
    </g>
  )
}

// ── Pin dot ────────────────────────────────────────────────────────────────────
export function PinDot({
  pin, comp, isBoardPin, hovered, active, onEnter, onLeave, onClick,
}: {
  pin: CircuitPin; comp: PlacedComponent
  isBoardPin?: boolean
  hovered: boolean; active: boolean
  onEnter: () => void; onLeave: () => void; onClick: () => void
}) {
  const def = COMP_DEFS[comp.type]
  if (!def) return null

  const INSET = 8
  let vx = pin.rx * def.w, vy = pin.ry * def.h
  if (pin.rx === 0) vx += INSET
  if (pin.rx === 1) vx -= INSET
  if (pin.ry === 0) vy += INSET
  if (pin.ry === 1) vy -= INSET

  const c          = pinColor(pin.type)
  const shortLabel = pin.label.split(/[\s~/]/)[0].slice(0, 5)

  if (isBoardPin) {
    const isLeft  = pin.rx === 0
    const isRight = pin.rx === 1
    const isTop   = pin.ry === 0
    const isBot   = pin.ry === 1
    return (
      <g transform={`translate(${vx},${vy})`}
        onClick={e => { e.stopPropagation(); onClick() }}
        onMouseEnter={onEnter} onMouseLeave={onLeave}
        style={{ cursor: 'crosshair' }}>
        <rect x={-8} y={-8} width={16} height={16} fill="transparent" />
        {(hovered || active) && (
          <rect x={-5.5} y={-5.5} width={11} height={11} rx={1.5}
            fill={c} opacity={0.18} stroke={c} strokeWidth={1.2} />
        )}
        <rect x={-4} y={-4} width={8} height={8} rx={1}
          fill="#c8a843" stroke={hovered || active ? c : '#9a7820'} strokeWidth={0.6} />
        <rect x={-2} y={-2} width={4} height={4} rx={0.5} fill="#0a0a0a" />
        <rect
          x={isLeft ? 3 : isRight ? -4 : -1.5} y={isTop ? 3 : isBot ? -4 : -3}
          width={isLeft || isRight ? 1.5 : 3} height={isTop || isBot ? 1.5 : 6}
          fill={c} opacity={0.9} />
        <text
          x={isLeft ? 10 : isRight ? -10 : 0}
          y={isTop ? 14 : isBot ? -9 : 2.5}
          textAnchor={isLeft ? 'start' : isRight ? 'end' : 'middle'}
          fontSize={5.5} fontFamily="monospace" fontWeight="700"
          fill="rgba(255,255,255,0.60)"
          style={{ pointerEvents: 'none', userSelect: 'none' }}>
          {shortLabel}
        </text>
        {hovered && <PinTooltip pin={pin} ax={vx} ay={0} compW={def.w} />}
      </g>
    )
  }

  const tickDx = pin.rx === 0 ? -4 : pin.rx === 1 ? 4 : 0
  const tickDy = pin.ry === 0 ? -4 : pin.ry === 1 ? 4 : 0
  return (
    <g transform={`translate(${vx},${vy})`}
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
      {(tickDx !== 0 || tickDy !== 0) && (
        <line x1={0} y1={0} x2={tickDx} y2={tickDy}
          stroke={c} strokeWidth={1.2} opacity={0.45} />
      )}
      {hovered && <PinTooltip pin={pin} ax={vx} ay={0} compW={def.w} />}
    </g>
  )
}

// ── Component body dispatcher ──────────────────────────────────────────────────
function ComponentBody({ comp, def, simPinValues }: {
  comp: PlacedComponent; def: CircuitComponentDef; simPinValues: Record<string, number>
}) {
  const { type, color, id } = comp
  const { w, h } = def
  const g = id.replace(/\W/g, '_')

  switch (type) {
    // Boards
    case 'arduino_uno':    return <ArduinoUnoBody  w={w} h={h} g={g} />
    case 'arduino_nano':   return <ArduinoNanoBody w={w} h={h} g={g} />
    case 'xiao_rp2040':    return <XiaoRp2040Body  w={w} h={h} g={g} />
    case 'esp8266':        return <Esp8266Body      w={w} h={h} g={g} />
    case 'esp32':          return <Esp32Body        w={w} h={h} g={g} />

    // Output
    case 'led': {
      const rawVal     = simPinValues[`${id}:anode`] ?? 0
      const mA         = simPinValues[`${id}:anode:mA`] ?? (rawVal > 0 ? 10 : 0)
      const brightness = Math.min(1, Math.max(0, mA / 20))
      return <LedBody w={w} h={h} color={color} brightness={brightness} g={g} />
    }
    case 'led_rgb': {
      const rv = simPinValues[`${id}:red`]   ?? 0
      const gv = simPinValues[`${id}:green`] ?? 0
      const bv = simPinValues[`${id}:blue`]  ?? 0
      const r  = Math.round(Math.min(255, (simPinValues[`${id}:red:mA`]   ?? (rv / 255 * 20)) * 255 / 20))
      const gr = Math.round(Math.min(255, (simPinValues[`${id}:green:mA`] ?? (gv / 255 * 20)) * 255 / 20))
      const b  = Math.round(Math.min(255, (simPinValues[`${id}:blue:mA`]  ?? (bv / 255 * 20)) * 255 / 20))
      return <RgbLedBody w={w} h={h} r={r} gr={gr} b={b} g={g} />
    }
    case 'buzzer':        return <BuzzerBody      w={w} h={h} active={(simPinValues[`${id}:pos`]    ?? 0) > 0} />
    case 'servo': {
      // tsuki-sim emits servo angle 0-180 via Servo.write(); ServoBody expects 0-1
      // analogWrite(0-255) fallback: if value > 180 treat as 0-255
      const rawVal = simPinValues[`${id}:signal`] ?? 0
      const val    = rawVal > 180 ? rawVal / 255 : rawVal > 1 ? rawVal / 180 : rawVal
      return <ServoBody w={w} h={h} val={val} g={g} />
    }
    case 'lcd_16x2': {
      const lines = [
        simPinValues[`${id}:lcd_line0`] ? String(simPinValues[`${id}:lcd_line0`]) : '',
        simPinValues[`${id}:lcd_line1`] ? String(simPinValues[`${id}:lcd_line1`]) : '',
      ]
      return <LcdBody w={w} h={h} lines={lines} g={g} />
    }
    case 'oled_128x64':   return <OledBody         w={w} h={h} g={g} />
    case 'seven_seg':     return <SevenSegBody     w={w} h={h} simVals={simPinValues} id={id} />
    case 'neopixel_ring': return <NeopixelRingBody w={w} h={h} val={simPinValues[`${id}:din`] ?? 0} g={g} />

    // Input / sensors
    case 'button':         return <ButtonBody        w={w} h={h} active={!!(comp.props?.pressed)} />
    case 'potentiometer':  return <PotBody           w={w} h={h} g={g} />
    case 'slide_switch':   return <SlideSwitchBody   w={w} h={h} active={!!(comp.props?.toggled)} />
    case 'rotary_encoder': return <RotaryEncoderBody w={w} h={h} />
    case 'dht11':          return <Dht11Body         w={w} h={h} g={g} />
    case 'ldr':            return <LdrBody           w={w} h={h} g={g} />
    case 'ultrasonic':     return <UltrasonicBody    w={w} h={h} g={g} />
    case 'ir_sensor':      return <IrBody            w={w} h={h} />
    case 'thermistor':     return <ThermistorBody    w={w} h={h} />

    // Passives
    case 'resistor':       return <ResistorBody w={w} h={h} props={comp.props} />
    case 'capacitor':      return <CapBody      w={w} h={h} color={color} />
    case 'transistor_npn': return <TransBody   w={w} h={h} />
    case 'mosfet_n':       return <MosfetBody  w={w} h={h} active={(simPinValues[`${id}:gate`] ?? 0) > 0} />
    case 'diode':          return <DiodeBody   w={w} h={h} />

    // Power
    case 'vcc_node':   return <VccNode   w={w} h={h} />
    case 'gnd_node':   return <GndNode   w={w} h={h} />
    case 'power_rail': return <PowerRail w={w} h={h} />

    // Misc
    case 'relay':      return <RelayBody     w={w} h={h} active={(simPinValues[`${id}:in`]  ?? 0) > 0} g={g} />
    case 'l298n':      return <L298nBody     w={w} h={h} g={g} />
    case 'breadboard':     return <BreadboardBody     w={w} h={h} simPinValues={simPinValues} id={id} />
    case 'breadboard_830': return <BreadboardFullBody w={w} h={h} simPinValues={simPinValues} id={id} />
    case 'dc_motor':   return <DcMotorBody   w={w} h={h} active={(simPinValues[`${id}:pos`] ?? 0) > 0} />
    case 'header_8':   return <Header8Body   w={w} h={h} simPinValues={simPinValues} id={id} />

    default:           return <DefaultBody w={w} h={h} color={color} label={def.label} />
  }
}

// ── CompShape wrapper ──────────────────────────────────────────────────────────
export function CompShape({
  comp, selected, simPinValues, wireMode, onPointerDown, onPinClick,
  pressed, onInteractStart, onInteractEnd, onContextMenu,
}: {
  comp: PlacedComponent; selected: boolean
  simPinValues: Record<string, number>; wireMode: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onPinClick: (pinId: string) => void
  pressed?: boolean
  onInteractStart?: () => void
  onInteractEnd?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  const def = COMP_DEFS[comp.type]
  if (!def) return null
  const [hoveredPin, setHoveredPin] = useState<string | null>(null)
  const isInteractive = comp.type === 'button' || comp.type === 'slide_switch'

  return (
    <g transform={`translate(${comp.x},${comp.y})`}
      style={{ cursor: wireMode ? 'default' : isInteractive ? 'pointer' : 'move' }}
      onPointerDown={e => {
        if (isInteractive && onInteractStart) { e.stopPropagation(); onInteractStart() }
        else onPointerDown(e)
      }}
      onPointerUp={() => { if (isInteractive && onInteractEnd) onInteractEnd() }}
      onPointerLeave={() => { if (isInteractive && onInteractEnd && comp.type === 'button') onInteractEnd() }}
      onContextMenu={onContextMenu}>

      <rect x={3} y={4} width={def.w} height={def.h} rx={6} fill="rgba(0,0,0,0.4)" />

      {selected && (
        <rect x={-4} y={-4} width={def.w + 8} height={def.h + 8} rx={8}
          fill="none" stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="6 3" opacity={0.85} />
      )}

      {isInteractive && pressed && (
        <rect x={-2} y={-2} width={def.w + 4} height={def.h + 4} rx={7}
          fill="rgba(255,255,255,0.08)" stroke="#60a5fa" strokeWidth={1} opacity={0.7} />
      )}

      <ComponentBody
        comp={{ ...comp, props: { ...comp.props, pressed: pressed ? 1 : 0 } }}
        def={def} simPinValues={simPinValues} />

      <text x={def.w / 2} y={def.h + 14}
        textAnchor="middle" fontSize={9.5} fill="var(--fg-muted)"
        fontFamily="var(--font-sans)" fontWeight="500"
        style={{ pointerEvents: 'none', userSelect: 'none' }}>
        {comp.label}
      </text>

      {def.pins.map(pin => (
        <PinDot key={pin.id} pin={pin} comp={comp}
          isBoardPin={def.category === 'mcu'}
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

// ── SVG global defs ────────────────────────────────────────────────────────────
export function SvgGlobalDefs() {
  return (
    <defs>
      <filter id="comp-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="2" dy="3" stdDeviation="3" floodOpacity="0.4" />
      </filter>
    </defs>
  )
}