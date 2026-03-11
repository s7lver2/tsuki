'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Cpu, Zap, Plus, Trash2, RotateCcw, Play, Square,
  FileText, Download, Upload, X, Pencil,
  ZoomIn, ZoomOut, MousePointer, Move, Layers,
  ChevronDown, ChevronRight, AlertCircle, CheckCircle2,
  Lightbulb, Activity, ToggleLeft
} from 'lucide-react'
import { clsx } from 'clsx'
import { useStore } from '@/lib/store'
import { getTmpSimBundlePath, writeFile, emitSimBundle, runSimulator, type ProcessHandle } from '@/lib/tauri'
import {
  buildPinMap, applyStepResult,
  getAnalogInputPins, getDigitalInputPins,
  type BridgeResult, type LogEntry,
} from '@/lib/simBridge'
import type { StepResult } from '@/lib/useSimulator'
import {
  type CircuitPin, type CircuitComponentDef, type PlacedComponent,
  type CircuitWire, type CircuitNote, type TsukiCircuit,
  COMP_DEFS, getPinAbsPos, pinColor,
} from './SandboxDefs'


const WIRE_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#a855f7','#ec4899','#e2e2e2','#1a1a1a']
const DEFAULT_CIRCUIT: TsukiCircuit = {
  version: '1', name: 'New Circuit', board: 'uno', description: '',
  components: [], wires: [], notes: [],
}

// ── Helpers ───────────────────────────────────────────────────────────────────


function makeBezierPath(ax: number, ay: number, bx: number, by: number) {
  const dx = Math.abs(bx - ax)
  const cp = Math.max(40, dx * 0.5)
  return `M ${ax} ${ay} C ${ax + cp} ${ay}, ${bx - cp} ${by}, ${bx} ${by}`
}

function circuitToText(c: TsukiCircuit): string {
  return JSON.stringify(c, null, 2)
}

function textToCircuit(raw: string): TsukiCircuit | null {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed.components || !parsed.wires) return null
    return { ...DEFAULT_CIRCUIT, ...parsed }
  } catch { return null }
}

// ── Simulation engine is now powered by tsuki-sim WASM ───────────────────────
// (see src/lib/useSimulator.ts + src/lib/simBridge.ts)

// ── SVG Component renderer ────────────────────────────────────────────────────

function CompShape({
  comp, def, selected, simPinValues, onPointerDown, onPinClick,
}: {
  comp: PlacedComponent
  def: CircuitComponentDef
  selected: boolean
  simPinValues: Record<string, number>
  onPointerDown: (e: React.PointerEvent) => void
  onPinClick: (pinId: string) => void
}) {
  const { type, label, color } = comp
  const [hoveredPin, setHoveredPin] = useState<string | null>(null)

  const ledOn = type === 'led'
    ? (simPinValues[`${comp.id}:anode`] ?? 0) > 0
    : false

  return (
    <g transform={`translate(${comp.x},${comp.y})`} style={{ cursor: 'move' }} onPointerDown={onPointerDown}>
      {/* Selection ring */}
      {selected && (
        <rect x={-4} y={-4} width={def.w + 8} height={def.h + 8}
          rx={6} fill="none" stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="5 3" opacity={0.8} />
      )}

      {/* Body */}
      {type === 'arduino_uno' && <ArduinoUnoBody w={def.w} h={def.h} color={color} label={label} />}
      {type === 'arduino_nano' && <ArduinoNanoBody w={def.w} h={def.h} color={color} label={label} />}
      {type === 'xiao_rp2040' && <XiaoRP2040Body w={def.w} h={def.h} color={color} label={label} />}
      {type === 'led' && <LedBody w={def.w} h={def.h} color={color} on={ledOn} label={label} />}
      {type === 'resistor' && <ResistorBody w={def.w} h={def.h} color={color} label={label} props={comp.props} />}
      {type === 'button' && <ButtonBody w={def.w} h={def.h} label={label} />}
      {type === 'potentiometer' && <PotBody w={def.w} h={def.h} label={label} />}
      {type === 'buzzer' && <BuzzerBody w={def.w} h={def.h} color={color} label={label} />}
      {type === 'power_rail' && <PowerRailBody w={def.w} h={def.h} label={label} />}

      {/* Pins + hover tooltip */}
      {def.pins.map(pin => {
        const px = pin.rx * def.w
        const py = pin.ry * def.h
        const hov = hoveredPin === pin.id
        return (
          <g key={pin.id}
            onClick={e => { e.stopPropagation(); onPinClick(pin.id) }}
            onMouseEnter={() => setHoveredPin(pin.id)}
            onMouseLeave={() => setHoveredPin(null)}
            style={{ cursor: 'crosshair' }}>
            {/* Hit area */}
            <circle cx={px} cy={py} r={9} fill="transparent" />
            {/* Outer ring on hover */}
            {hov && <circle cx={px} cy={py} r={7} fill={pinColor(pin.type)} opacity={0.25} />}
            {/* Pin dot */}
            <circle cx={px} cy={py} r={hov ? 4.5 : 3.5}
              fill={pinColor(pin.type)}
              stroke={hov ? '#fff' : 'rgba(0,0,0,0.5)'}
              strokeWidth={hov ? 1.5 : 1}
              style={{ transition: 'r 0.1s, stroke 0.1s' }}
            />
            {/* Tooltip */}
            {hov && (() => {
              // Decide which side to show tooltip
              const onRight = pin.rx <= 0.5
              const onBottom = pin.ry <= 0.5
              const tx = onRight ? px + 11 : px - 11
              const ty = py
              const textAnchor = onRight ? 'start' : 'end'
              const tipText = pin.label
              const charW = 5.5
              const tipW = tipText.length * charW + 10
              const tipH = 16
              const boxX = onRight ? tx - 2 : tx - tipW + 2
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <rect x={boxX} y={ty - tipH / 2} width={tipW} height={tipH}
                    rx={3} fill="#1a1a2e" stroke={pinColor(pin.type)} strokeWidth={0.8} opacity={0.96} />
                  <text x={tx + (onRight ? 3 : -3)} y={ty + 4}
                    textAnchor={textAnchor} fontSize={9} fill="#e2e8f0"
                    fontFamily="ui-monospace,monospace" fontWeight="500">
                    {tipText}
                  </text>
                </g>
              )
            })()}
          </g>
        )
      })}
    </g>
  )
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function CompLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={7.5} fill="var(--fg-muted)"
      fontFamily="ui-monospace,monospace" letterSpacing="0.02em">{text}</text>
  )
}

function PcbBase({ w, h, rx = 4, color = '#1a5c2a', hi = 'rgba(255,255,255,0.07)', shadow = 'rgba(0,0,0,0.5)' }: {
  w: number; h: number; rx?: number; color?: string; hi?: string; shadow?: string
}) {
  return (
    <>
      {/* Drop shadow */}
      <rect x={2} y={2} width={w} height={h} rx={rx} fill={shadow} />
      {/* PCB */}
      <rect width={w} height={h} rx={rx} fill={color} />
      {/* Subtle highlight bevel */}
      <rect x={1} y={1} width={w - 2} height={h - 2} rx={rx - 1}
        fill="none" stroke={hi} strokeWidth={1} />
    </>
  )
}

function IcChip({ x, y, w, h, label, sub }: { x: number; y: number; w: number; h: number; label: string; sub?: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={2} fill="#0d0d14" />
      <rect x={x + 1} y={y + 1} width={w - 2} height={h - 2} rx={1.5}
        fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={0.8} />
      {/* notch */}
      <path d={`M ${x + w/2 - 4} ${y} A 4 4 0 0 1 ${x + w/2 + 4} ${y}`} fill="#0d0d14" stroke="rgba(255,255,255,0.12)" strokeWidth={0.6} />
      <text x={x + w / 2} y={y + h / 2 - (sub ? 3 : 0)} textAnchor="middle"
        fontSize={Math.min(7, w / label.length * 1.4)} fill="#7c9cbf" fontFamily="ui-monospace,monospace" fontWeight="700">
        {label}
      </text>
      {sub && <text x={x + w / 2} y={y + h / 2 + 7} textAnchor="middle"
        fontSize={5.5} fill="#4a6a8a" fontFamily="ui-monospace,monospace">{sub}</text>}
    </g>
  )
}

// ── Shape sub-components ───────────────────────────────────────────────────────

function ArduinoUnoBody({ w, h, color, label }: { w: number; h: number; color: string; label: string }) {
  const pcb = color || '#1a5c2a'
  return (
    <>
      <PcbBase w={w} h={h} rx={5} color={pcb} />

      {/* USB-B port */}
      <rect x={w * 0.18} y={-8} width={w * 0.36} height={9} rx={1.5} fill="#3a3a3a" stroke="#555" strokeWidth={0.6} />
      <rect x={w * 0.22} y={-6} width={w * 0.28} height={5} rx={0.5} fill="#222" />

      {/* DC barrel jack */}
      <rect x={w * 0.7} y={-5} width={w * 0.22} height={6} rx={1} fill="#1a1a1a" stroke="#444" strokeWidth={0.5} />
      <circle cx={w * 0.81} cy={-2} r={1.8} fill="#111" />

      {/* ICSP header (2×3 dots) */}
      {[0,1,2].map(i => [0,1].map(j => (
        <circle key={`icsp-${i}-${j}`} cx={w * 0.6 + j * 5} cy={h * 0.12 + i * 5} r={1.2}
          fill="#c8a832" stroke="#8a7010" strokeWidth={0.4} />
      )))}

      {/* ATmega328P chip */}
      <IcChip x={w * 0.2} y={h * 0.33} w={w * 0.6} h={h * 0.3} label="ATmega328P" sub="16MHz" />

      {/* Crystal */}
      <rect x={w * 0.6} y={h * 0.68} width={w * 0.12} height={h * 0.1} rx={2}
        fill="#c8c830" stroke="#a8a820" strokeWidth={0.5} />

      {/* Status LEDs */}
      {[['L','#ef4444', 0], ['TX','#22c55e', 1], ['RX','#22c55e', 2], ['ON','#22c55e', 3]].map(([n, c, i]) => (
        <g key={String(n)}>
          <circle cx={w * 0.08} cy={h * (0.15 + Number(i) * 0.06)} r={2}
            fill={String(c)} stroke="rgba(0,0,0,0.3)" strokeWidth={0.4} />
        </g>
      ))}

      {/* Reset button */}
      <rect x={w * 0.72} y={h * 0.65} width={w * 0.16} height={h * 0.12} rx={2}
        fill="#e63946" stroke="#c0292e" strokeWidth={0.6} />
      <circle cx={w * 0.8} cy={h * 0.71} r={3} fill="#ff6b6b" />

      {/* Pin header rows — copper pads */}
      {Array.from({ length: 14 }, (_, i) => (
        <rect key={`dl${i}`} x={-3} y={h * 0.065 + i * h / 15 - 1.5} width={6} height={3}
          rx={0.5} fill="#c8a832" stroke="#8a7010" strokeWidth={0.3} />
      ))}
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={`ar${i}`} x={w - 3} y={h * 0.49 + i * h / 15 - 1.5} width={6} height={3}
          rx={0.5} fill="#c8a832" stroke="#8a7010" strokeWidth={0.3} />
      ))}
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={`pw${i}`} x={w - 3} y={h * 0.065 + i * h / 15 - 1.5} width={6} height={3}
          rx={0.5} fill="#c8a832" stroke="#8a7010" strokeWidth={0.3} />
      ))}

      {/* Silkscreen label */}
      <text x={w * 0.5} y={h * 0.28} textAnchor="middle" fontSize={7} fill="rgba(255,255,255,0.5)"
        fontFamily="ui-monospace,monospace" fontWeight="700" letterSpacing="0.05em">{label}</text>
    </>
  )
}

function ArduinoNanoBody({ w, h, color, label }: { w: number; h: number; color: string; label: string }) {
  const pcb = color || '#14448a'
  return (
    <>
      <PcbBase w={w} h={h} rx={3} color={pcb} />

      {/* Mini USB */}
      <rect x={w * 0.22} y={-5} width={w * 0.56} height={6} rx={1} fill="#2a2a2a" stroke="#555" strokeWidth={0.5} />
      <rect x={w * 0.28} y={-3.5} width={w * 0.44} height={3.5} rx={0.5} fill="#111" />

      {/* ATmega chip */}
      <IcChip x={w * 0.12} y={h * 0.26} w={w * 0.76} h={h * 0.35} label="ATmega328" sub="NANO" />

      {/* Crystal */}
      <rect x={w * 0.3} y={h * 0.68} width={w * 0.18} height={h * 0.09} rx={2}
        fill="#d4d420" stroke="#a0a010" strokeWidth={0.4} />

      {/* Pin pads both sides */}
      {Array.from({ length: 15 }, (_, i) => (
        <g key={i}>
          <rect x={-3} y={h * 0.04 + i * h / 16 - 1.5} width={6} height={3} rx={0.5} fill="#c8a832" stroke="#8a7010" strokeWidth={0.3} />
          <rect x={w - 3} y={h * 0.04 + i * h / 16 - 1.5} width={6} height={3} rx={0.5} fill="#c8a832" stroke="#8a7010" strokeWidth={0.3} />
        </g>
      ))}

      <text x={w * 0.5} y={h * 0.2} textAnchor="middle" fontSize={6} fill="rgba(255,255,255,0.55)"
        fontFamily="ui-monospace,monospace" fontWeight="700">{label}</text>
    </>
  )
}

function XiaoRP2040Body({ w, h, color, label }: { w: number; h: number; color: string; label: string }) {
  const c = color || '#1c3a5e'
  return (
    <>
      {/* Board */}
      <rect width={w} height={h} rx={4} fill={c} />
      {/* USB-C connector on top */}
      <rect x={w * 0.3} y={-4} width={w * 0.4} height={6} rx={2} fill="#555" />
      <rect x={w * 0.33} y={-3} width={w * 0.34} height={3} rx={1} fill="#888" />
      {/* RP2040 chip */}
      <rect x={w * 0.18} y={h * 0.28} width={w * 0.64} height={h * 0.36} rx={2} fill="#111" stroke="#333" strokeWidth={0.5} />
      <text x={w * 0.5} y={h * 0.44} textAnchor="middle" fontSize={5.5} fill="rgba(255,255,255,0.5)"
        fontFamily="var(--font-sans)" fontWeight="600">RP2040</text>
      <text x={w * 0.5} y={h * 0.53} textAnchor="middle" fontSize={4.5} fill="rgba(255,255,255,0.35)"
        fontFamily="var(--font-sans)">133 MHz</text>
      {/* NeoPixel LED indicator */}
      <circle cx={w * 0.5} cy={h * 0.76} r={3} fill="#222" stroke="#444" strokeWidth={0.5} />
      {/* Label */}
      <text x={w * 0.5} y={h * 0.14} textAnchor="middle" fontSize={5.5} fill="rgba(255,255,255,0.7)"
        fontFamily="var(--font-sans)" fontWeight="700">XIAO</text>
      <text x={w * 0.5} y={h + 10} textAnchor="middle" fontSize={7} fill="var(--fg-muted)"
        fontFamily="var(--font-sans)">{label}</text>
    </>
  )
}

function LedBody({ w, h, color, on, label }: { w: number; h: number; color: string; on: boolean; label: string }) {
  const glow = on ? color : 'transparent'
  return (
    <>
      {on && <ellipse cx={w / 2} cy={h * 0.4} rx={18} ry={18} fill={color} opacity={0.18} />}
      {/* Lead lines */}
      <line x1={w / 2} y1={0} x2={w / 2} y2={h * 0.28} stroke="#888" strokeWidth={1.5} />
      <line x1={w / 2} y1={h * 0.6} x2={w / 2} y2={h} stroke="#888" strokeWidth={1.5} />
      {/* Body */}
      <ellipse cx={w / 2} cy={h * 0.42} rx={w * 0.45} ry={h * 0.18}
        fill={on ? color : color + '55'} stroke={color} strokeWidth={1} />
      <rect x={w * 0.15} y={h * 0.22} width={w * 0.7} height={h * 0.2} rx={1}
        fill={on ? color : color + '55'} stroke={color} strokeWidth={1} />
      {/* Flat edge (cathode) */}
      <rect x={w * 0.35} y={h * 0.38} width={w * 0.15} height={h * 0.12} rx={0} fill="rgba(0,0,0,0.3)" />
      {on && <filter id={`glow-${label}`}><feGaussianBlur stdDeviation="3" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>}
      <text x={w / 2} y={h + 10} textAnchor="middle" fontSize={7} fill="var(--fg-muted)"
        fontFamily="var(--font-sans)">{label}</text>
    </>
  )
}

function ResistorBody({ w, h, label, props }: { w: number; h: number; color: string; label: string; props: Record<string, string | number> }) {
  const val = props.ohms ? `${props.ohms}Ω` : '1kΩ'
  const bands = ['#f59e0b', '#555', '#a37a2c', '#ffd700']
  return (
    <>
      <line x1={0} y1={h / 2} x2={w * 0.2} y2={h / 2} stroke="#888" strokeWidth={1.5} />
      <line x1={w * 0.8} y1={h / 2} x2={w} y2={h / 2} stroke="#888" strokeWidth={1.5} />
      <rect x={w * 0.2} y={h * 0.15} width={w * 0.6} height={h * 0.7} rx={h * 0.35}
        fill="#c4a265" stroke="#8a6620" strokeWidth={0.8} />
      {/* Highlight top */}
      <ellipse cx={w * 0.5} cy={h * 0.28} rx={w * 0.22} ry={h * 0.1}
        fill="rgba(255,255,255,0.18)" />
      {/* Color bands */}
      {bands.map((c, i) => (
        <rect key={i} x={w * (0.26 + i * 0.13)} y={h * 0.13} width={w * 0.08} height={h * 0.74}
          fill={c} opacity={0.9} rx={1} />
      ))}
      <CompLabel x={w / 2} y={h + 11} text={val} />
    </>
  )
}

function CapacitorBody({ w, h, label }: { w: number; h: number; label: string }) {
  const cx = w / 2, mid = h * 0.5
  return (
    <>
      {/* Lead */}
      <line x1={cx} y1={0} x2={cx} y2={h * 0.15} stroke="#aaa" strokeWidth={1.5} />
      <line x1={cx} y1={h * 0.85} x2={cx} y2={h} stroke="#aaa" strokeWidth={1.5} />
      {/* Body (electrolytic cylinder) */}
      <rect x={cx - w*0.42} y={h*0.12} width={w*0.84} height={h*0.76} rx={w*0.42}
        fill="#2a4a7a" stroke="#1a3060" strokeWidth={0.8} />
      {/* Negative stripe */}
      <rect x={cx + w*0.08} y={h*0.12} width={w*0.34} height={h*0.76}
        fill="rgba(255,255,255,0.1)" rx={0} />
      {/* Minus marks */}
      {[0.3,0.5,0.7].map(t => (
        <line key={t} x1={cx+w*0.12} y1={h*t} x2={cx+w*0.38} y2={h*t} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
      ))}
      {/* Plus on positive side */}
      <text x={cx - w*0.16} y={mid + 3.5} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.6)" fontWeight="700">+</text>
      {/* Highlight */}
      <ellipse cx={cx - w*0.1} cy={h*0.25} rx={w*0.12} ry={h*0.07} fill="rgba(255,255,255,0.2)" />
      <CompLabel x={cx} y={h + 11} text={label} />
    </>
  )
}

function TransistorBody({ w, h, label }: { w: number; h: number; label: string }) {
  const cx = w / 2
  // TO-92 package — semicircle flat front
  return (
    <>
      {/* 3 leads */}
      <line x1={cx - w*0.3} y1={h*0.85} x2={cx - w*0.3} y2={h} stroke="#aaa" strokeWidth={1.5} />
      <line x1={cx}         y1={h*0.85} x2={cx}         y2={h} stroke="#aaa" strokeWidth={1.5} />
      <line x1={cx + w*0.3} y1={h*0.85} x2={cx + w*0.3} y2={h} stroke="#aaa" strokeWidth={1.5} />
      {/* Base lead (horizontal) */}
      <line x1={0} y1={h*0.45} x2={cx - w*0.42} y2={h*0.45} stroke="#aaa" strokeWidth={1.5} />
      {/* TO-92 body: D-shape */}
      <path d={`M ${cx-w*0.42} ${h*0.14} A ${w*0.42} ${h*0.35} 0 0 1 ${cx+w*0.42} ${h*0.14} L ${cx+w*0.42} ${h*0.85} L ${cx-w*0.42} ${h*0.85} Z`}
        fill="#1c1c1c" stroke="#444" strokeWidth={0.8} />
      {/* Flat face */}
      <rect x={cx-w*0.42} y={h*0.14} width={w*0.84} height={h*0.71} rx={0}
        fill="none" stroke="none" />
      {/* 2N2222 label */}
      <text x={cx} y={h*0.56} textAnchor="middle" fontSize={6} fill="#7c9cbf"
        fontFamily="ui-monospace,monospace">2N2222</text>
      {/* Highlight on dome */}
      <path d={`M ${cx-w*0.2} ${h*0.2} A ${w*0.42} ${h*0.35} 0 0 1 ${cx+w*0.06} ${h*0.14}`}
        fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={1.5} />
      <CompLabel x={cx} y={h + 11} text={label} />
    </>
  )
}

function ButtonBody({ w, h, label }: { w: number; h: number; label: string }) {
  return (
    <>
      {/* Drop shadow */}
      <rect x={1.5} y={1.5} width={w} height={h} rx={3} fill="rgba(0,0,0,0.4)" />
      {/* PCB base */}
      <rect width={w} height={h} rx={3} fill="#2a2a2a" stroke="#444" strokeWidth={0.8} />
      {/* Corner mounting holes */}
      {[[6,6],[w-6,6],[6,h-6],[w-6,h-6]].map(([cx,cy],i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r={2.5} fill="#111" stroke="#555" strokeWidth={0.5} />
          <circle cx={cx} cy={cy} r={1.2} fill="#c8a832" />
        </g>
      ))}
      {/* Button cap */}
      <circle cx={w/2} cy={h/2} r={w*0.32} fill="#1a1a1a" stroke="#555" strokeWidth={0.8} />
      <circle cx={w/2} cy={h/2} r={w*0.22} fill="#e63946" stroke="#c02030" strokeWidth={0.8} />
      <circle cx={w/2} cy={h/2} r={w*0.12} fill="#ff6b6b" />
      {/* Highlight */}
      <ellipse cx={w/2 - w*0.06} cy={h/2 - h*0.06} rx={w*0.06} ry={h*0.05}
        fill="rgba(255,255,255,0.3)" />
      <CompLabel x={w/2} y={h + 11} text={label} />
    </>
  )
}

function PotBody({ w, h, label }: { w: number; h: number; label: string }) {
  const cx = w/2, cy = h/2
  return (
    <>
      <rect x={1.5} y={1.5} width={w} height={h} rx={4} fill="rgba(0,0,0,0.35)" />
      <rect width={w} height={h} rx={4} fill="#2e2e2e" stroke="#4a4a4a" strokeWidth={0.8} />
      {/* 3 solder pads */}
      {[0.2,0.5,0.8].map((t, i) => (
        <circle key={i} cx={w*t} cy={h*0.88} r={2.5} fill="#c8a832" stroke="#8a7010" strokeWidth={0.4} />
      ))}
      {/* Outer ring */}
      <circle cx={cx} cy={cy - h*0.04} r={w*0.42} fill="#1a1a1a" stroke="#555" strokeWidth={1} />
      {/* Track arc */}
      <path d={`M ${cx - w*0.3} ${cy + h*0.12} A ${w*0.36} ${w*0.36} 0 1 1 ${cx + w*0.3} ${cy + h*0.12}`}
        fill="none" stroke="#444" strokeWidth={3} strokeLinecap="round" />
      <path d={`M ${cx - w*0.3} ${cy + h*0.12} A ${w*0.36} ${w*0.36} 0 1 1 ${cx + w*0.3} ${cy + h*0.12}`}
        fill="none" stroke="#c8a832" strokeWidth={1.5} strokeLinecap="round" opacity={0.5} />
      {/* Knob */}
      <circle cx={cx} cy={cy - h*0.04} r={w*0.28} fill="#3a3a3a" stroke="#666" strokeWidth={0.8} />
      {/* Pointer line */}
      <line x1={cx} y1={cy - h*0.04} x2={cx} y2={cy - h*0.28} stroke="#e2e2e2" strokeWidth={2} strokeLinecap="round" />
      {/* Highlight */}
      <ellipse cx={cx - w*0.08} cy={cy - h*0.14} rx={w*0.07} ry={h*0.05} fill="rgba(255,255,255,0.2)" />
      <CompLabel x={cx} y={h + 11} text={label} />
    </>
  )
}

function BuzzerBody({ w, h, label }: { w: number; h: number; label: string }) {
  const cx = w/2, cy = h/2
  return (
    <>
      <circle cx={cx+1.5} cy={cy+1.5} r={w/2} fill="rgba(0,0,0,0.35)" />
      <circle cx={cx} cy={cy} r={w/2} fill="#0f0f0f" stroke="#333" strokeWidth={0.8} />
      {/* Ridges */}
      {[0.38, 0.28, 0.18].map((r, i) => (
        <circle key={i} cx={cx} cy={cy} r={w*r} fill="none" stroke="#2a2a2a" strokeWidth={1} />
      ))}
      {/* Center hole */}
      <circle cx={cx} cy={cy} r={w*0.08} fill="#1a1a1a" stroke="#333" strokeWidth={0.5} />
      {/* + marker */}
      <line x1={cx-w*0.14} y1={cy-h*0.28} x2={cx+w*0.14} y2={cy-h*0.28} stroke="#ef4444" strokeWidth={1} />
      <line x1={cx} y1={cy-h*0.35} x2={cx} y2={cy-h*0.21} stroke="#ef4444" strokeWidth={1} />
      {/* Highlight */}
      <ellipse cx={cx-w*0.12} cy={cy-h*0.18} rx={w*0.1} ry={h*0.07} fill="rgba(255,255,255,0.08)" />
      <CompLabel x={cx} y={h + 11} text={label} />
    </>
  )
}

function ServoBody({ w, h, label }: { w: number; h: number; label: string }) {
  return (
    <>
      {/* Shadow */}
      <rect x={2} y={2} width={w} height={h} rx={4} fill="rgba(0,0,0,0.35)" />
      {/* Main body */}
      <rect width={w} height={h} rx={4} fill="#2e2e2e" stroke="#4a4a4a" strokeWidth={0.8} />
      {/* Mounting ears */}
      <rect x={-6} y={h*0.15} width={8} height={h*0.7} rx={2} fill="#252525" stroke="#3a3a3a" strokeWidth={0.6} />
      <rect x={w-2} y={h*0.15} width={8} height={h*0.7} rx={2} fill="#252525" stroke="#3a3a3a" strokeWidth={0.6} />
      {/* Ear holes */}
      <circle cx={-2} cy={h*0.5} r={2.5} fill="#111" stroke="#555" strokeWidth={0.4} />
      <circle cx={w+2} cy={h*0.5} r={2.5} fill="#111" stroke="#555" strokeWidth={0.4} />
      {/* Output shaft boss */}
      <circle cx={w*0.35} cy={h*0.4} r={w*0.2} fill="#1a1a1a" stroke="#555" strokeWidth={0.8} />
      <circle cx={w*0.35} cy={h*0.4} r={w*0.12} fill="#333" stroke="#444" strokeWidth={0.6} />
      {/* Spline marks */}
      {Array.from({length:8},(_,i)=>{
        const a = (i/8)*Math.PI*2
        const r1=w*0.12, r2=w*0.16
        return <line key={i}
          x1={w*0.35+Math.cos(a)*r1} y1={h*0.4+Math.sin(a)*r1}
          x2={w*0.35+Math.cos(a)*r2} y2={h*0.4+Math.sin(a)*r2}
          stroke="#555" strokeWidth={0.8} />
      })}
      {/* IC */}
      <IcChip x={w*0.55} y={h*0.22} w={w*0.36} h={h*0.36} label="SG90" />
      {/* Wire leads */}
      <rect x={w*0.06} y={h-2} width={w*0.18} height={6} rx={1} fill="#6b7280" />
      <rect x={w*0.27} y={h-2} width={w*0.18} height={6} rx={1} fill="#ef4444" />
      <rect x={w*0.48} y={h-2} width={w*0.18} height={6} rx={1} fill="#f97316" />
      <CompLabel x={w/2} y={h + 14} text={label} />
    </>
  )
}

function Dht11Body({ w, h, label }: { w: number; h: number; label: string }) {
  return (
    <>
      <rect x={1.5} y={1.5} width={w} height={h} rx={3} fill="rgba(0,0,0,0.35)" />
      {/* Blue body */}
      <rect width={w} height={h} rx={3} fill="#1a5fb4" stroke="#0d3d80" strokeWidth={0.8} />
      <rect x={1} y={1} width={w-2} height={h-2} rx={2.5}
        fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={0.8} />
      {/* Vent grille (top half) */}
      <rect x={w*0.08} y={h*0.05} width={w*0.84} height={h*0.48} rx={2}
        fill="#0d2d6a" stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
      {/* Vent slits */}
      {Array.from({length:6},(_,i)=>(
        <line key={i} x1={w*0.12} y1={h*(0.1+i*0.07)} x2={w*0.88} y2={h*(0.1+i*0.07)}
          stroke="rgba(255,255,255,0.12)" strokeWidth={0.7} />
      ))}
      {/* Label */}
      <text x={w/2} y={h*0.72} textAnchor="middle" fontSize={7.5} fill="rgba(255,255,255,0.8)"
        fontFamily="ui-monospace,monospace" fontWeight="700">DHT11</text>
      {/* Solder pads */}
      {[0.17,0.4,0.63,0.87].map((t,i)=>(
        <rect key={i} x={w*t-2.5} y={h-2} width={5} height={5} rx={0.5}
          fill="#c8a832" stroke="#8a7010" strokeWidth={0.3} />
      ))}
      <CompLabel x={w/2} y={h + 14} text={label} />
    </>
  )
}

function LdrBody({ w, h, label }: { w: number; h: number; label: string }) {
  const cx = w/2, cy = h/2
  return (
    <>
      <circle cx={cx+1} cy={cy+1} r={w*0.46} fill="rgba(0,0,0,0.3)" />
      {/* Body */}
      <circle cx={cx} cy={cy} r={w*0.46} fill="#c48a00" stroke="#8a6000" strokeWidth={0.8} />
      {/* Zigzag track */}
      <path d={`M ${cx-w*0.22} ${cy-h*0.18} L ${cx+w*0.22} ${cy-h*0.08} L ${cx-w*0.22} ${cy+h*0.02} L ${cx+w*0.22} ${cy+h*0.12}`}
        fill="none" stroke="#1a1a00" strokeWidth={1.8} strokeLinecap="round" />
      {/* Photosensitive window (lighter arc) */}
      <path d={`M ${cx-w*0.3} ${cy} A ${w*0.3} ${w*0.3} 0 0 1 ${cx+w*0.3} ${cy}`}
        fill="rgba(255,220,80,0.15)" />
      {/* Leads */}
      <line x1={0} y1={cy} x2={cx-w*0.44} y2={cy} stroke="#aaa" strokeWidth={1.5} />
      <line x1={w} y1={cy} x2={cx+w*0.44} y2={cy} stroke="#aaa" strokeWidth={1.5} />
      <CompLabel x={cx} y={h + 11} text={label} />
    </>
  )
}

function UltrasonicBody({ w, h, label }: { w: number; h: number; label: string }) {
  return (
    <>
      <rect x={1.5} y={1.5} width={w} height={h} rx={3} fill="rgba(0,0,0,0.35)" />
      <rect width={w} height={h} rx={3} fill="#1a4a2a" stroke="#0d3018" strokeWidth={0.8} />
      <rect x={1} y={1} width={w-2} height={h-2} rx={2.5}
        fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={0.8} />
      {/* Two transducer "eyes" */}
      {[w*0.26, w*0.68].map((cx, i) => (
        <g key={i}>
          <circle cx={cx} cy={h*0.46} r={w*0.18} fill="#0d0d0d" stroke="#333" strokeWidth={0.8} />
          <circle cx={cx} cy={h*0.46} r={w*0.13} fill="#1a1a1a" stroke="#2a2a2a" strokeWidth={0.5} />
          <circle cx={cx} cy={h*0.46} r={w*0.07} fill="#333" />
          <circle cx={cx-w*0.04} cy={h*0.38} r={w*0.03} fill="rgba(255,255,255,0.15)" />
        </g>
      ))}
      {/* Text */}
      <text x={w/2} y={h*0.88} textAnchor="middle" fontSize={6.5} fill="rgba(255,255,255,0.6)"
        fontFamily="ui-monospace,monospace">HC-SR04</text>
      {/* 4 solder pads */}
      {[0.08,0.35,0.62,0.88].map((t,i)=>(
        <rect key={i} x={w*t-2} y={h-2} width={4} height={5} rx={0.5}
          fill="#c8a832" stroke="#8a7010" strokeWidth={0.3} />
      ))}
      <CompLabel x={w/2} y={h + 14} text={label} />
    </>
  )
}

function IrSensorBody({ w, h, label }: { w: number; h: number; label: string }) {
  return (
    <>
      <rect x={1.5} y={1.5} width={w} height={h} rx={2} fill="rgba(0,0,0,0.35)" />
      <rect width={w} height={h} rx={2} fill="#111" stroke="#2a2a2a" strokeWidth={0.8} />
      <rect x={1} y={1} width={w-2} height={h-2} rx={1.5}
        fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={0.6} />
      {/* IR LED (transmitter, clear) */}
      <rect x={w*0.06} y={h*0.1} width={w*0.3} height={h*0.7} rx={w*0.15}
        fill="#2a2a2a" stroke="#444" strokeWidth={0.5} />
      <ellipse cx={w*0.21} cy={h*0.3} rx={w*0.08} ry={h*0.06} fill="rgba(255,255,255,0.15)" />
      {/* IR receiver (dark) */}
      <rect x={w*0.42} y={h*0.1} width={w*0.3} height={h*0.7} rx={w*0.15}
        fill="#0a0a0a" stroke="#333" strokeWidth={0.5} />
      <ellipse cx={w*0.57} cy={h*0.3} rx={w*0.08} ry={h*0.06} fill="rgba(255,200,100,0.12)" />
      {/* Status LED */}
      <circle cx={w*0.84} cy={h*0.35} r={w*0.08} fill="#22c55e" opacity={0.7} />
      {/* Pads */}
      {[0.1,0.4,0.7].map((t,i)=>(
        <rect key={i} x={-2} y={h*t} width={4} height={4} rx={0.5}
          fill="#c8a832" stroke="#8a7010" strokeWidth={0.3} />
      ))}
      <CompLabel x={w/2} y={h + 11} text={label} />
    </>
  )
}

function LcdBody({ w, h, label }: { w: number; h: number; label: string }) {
  return (
    <>
      <rect x={2} y={2} width={w} height={h} rx={4} fill="rgba(0,0,0,0.35)" />
      {/* PCB */}
      <rect width={w} height={h} rx={4} fill="#0a3d0a" stroke="#063006" strokeWidth={0.8} />
      {/* LCD glass panel */}
      <rect x={w*0.04} y={h*0.08} width={w*0.92} height={h*0.66} rx={2}
        fill="#4a7c59" stroke="#2a5a30" strokeWidth={0.8} />
      {/* Screen area */}
      <rect x={w*0.07} y={h*0.12} width={w*0.86} height={h*0.56} rx={1}
        fill="#3a6e47" />
      {/* Pixel grid suggestion */}
      {Array.from({length:2},(_,row)=>
        Array.from({length:16},(_,col)=>(
          <rect key={`c${row}-${col}`}
            x={w*0.09 + col*(w*0.8/16)} y={h*0.16 + row*(h*0.42/2)}
            width={w*0.8/16 - 1} height={h*0.42/2 - 1} rx={0.5}
            fill="rgba(80,200,80,0.12)" />
        ))
      )}
      {/* Backlight glow */}
      <rect x={w*0.07} y={h*0.12} width={w*0.86} height={h*0.56} rx={1}
        fill="rgba(80,200,60,0.06)" />
      {/* Pin header */}
      {Array.from({length:12},(_,i)=>(
        <rect key={i} x={w*(0.06+i*0.076)} y={h*0.82} width={5} height={8} rx={0.5}
          fill="#c8a832" stroke="#8a7010" strokeWidth={0.3} />
      ))}
      <text x={w/2} y={h*0.08} textAnchor="middle" fontSize={5.5} fill="rgba(255,255,255,0.4)"
        fontFamily="ui-monospace,monospace">LCD 16×2</text>
      <CompLabel x={w/2} y={h + 14} text={label} />
    </>
  )
}

function SevenSegBody({ w, h, label, simPinValues, compId }: {
  w: number; h: number; label: string
  simPinValues: Record<string, number>; compId: string
}) {
  const seg = (id: string) => (simPinValues[`${compId}:${id}`] ?? 0) > 0
  const ON = '#ff3020', OFF = '#2a0800'
  // Standard segment paths (normalized to 54×76)
  const sx = w/54, sy = h/76
  function H(x:number,y:number,lit:boolean) {
    return <path key={`${x}${y}`}
      d={`M${(x+3)*sx} ${y*sy} L${(x+5)*sx} ${(y-2)*sy} L${(x+w/sx-5)*sx} ${(y-2)*sy} L${(x+w/sx-3)*sx} ${y*sy} L${(x+w/sx-5)*sx} ${(y+2)*sy} L${(x+5)*sx} ${(y+2)*sy} Z`}
      fill={lit ? ON : OFF} />
  }
  function V(x:number,y:number,lit:boolean) {
    return <path key={`${x}${y}`}
      d={`M${x*sx} ${(y+3)*sy} L${(x-2)*sx} ${(y+5)*sy} L${(x-2)*sx} ${(y+h/sy*0.3-5)*sy} L${x*sx} ${(y+h/sy*0.3-3)*sy} L${(x+2)*sx} ${(y+h/sy*0.3-5)*sy} L${(x+2)*sx} ${(y+5)*sy} Z`}
      fill={lit ? ON : OFF} />
  }
  return (
    <>
      <rect x={1.5} y={1.5} width={w} height={h} rx={3} fill="rgba(0,0,0,0.4)" />
      <rect width={w} height={h} rx={3} fill="#0d0d0d" stroke="#222" strokeWidth={0.8} />
      {/* Segment A top */}
      {H(0, 4, seg('a'))}
      {/* Segments B,C right */}
      {V(w/sx-4, 4, seg('b'))}
      {V(w/sx-4, h/sy*0.48, seg('c'))}
      {/* Segment D bottom */}
      {H(0, h/sy-4, seg('d'))}
      {/* Segments E,F left */}
      {V(4, h/sy*0.48, seg('e'))}
      {V(4, 4, seg('f'))}
      {/* Segment G middle */}
      {H(0, h/sy*0.48, seg('g'))}
      {/* Decimal point */}
      <circle cx={w*0.9} cy={h*0.92} r={w*0.07}
        fill={seg('dp') ? ON : OFF} />
      {/* Cathode pads */}
      <rect x={w*0.25-2} y={h-2} width={5} height={6} rx={0.5} fill="#c8a832" stroke="#8a7010" strokeWidth={0.3} />
      <rect x={w*0.75-2} y={h-2} width={5} height={6} rx={0.5} fill="#c8a832" stroke="#8a7010" strokeWidth={0.3} />
      <CompLabel x={w/2} y={h + 14} text={label} />
    </>
  )
}

function VccNodeBody({ w, h, label }: { w: number; h: number; label: string }) {
  const cx = w/2
  return (
    <>
      {/* Triangle power symbol */}
      <polygon points={`${cx},2 ${w-2},${h-2} 2,${h-2}`}
        fill="#7f1d1d" stroke="#ef4444" strokeWidth={1} />
      <polygon points={`${cx},5 ${w-6},${h-5} 6,${h-5}`}
        fill="#991b1b" />
      <text x={cx} y={h*0.72} textAnchor="middle" fontSize={7} fill="#fca5a5"
        fontFamily="ui-monospace,monospace" fontWeight="700">5V</text>
    </>
  )
}

function GndNodeBody({ w, h, label }: { w: number; h: number; label: string }) {
  const cx = w/2, top = h*0.12
  // Classic ground symbol: horizontal lines decreasing width
  return (
    <>
      <line x1={cx} y1={top} x2={cx} y2={h*0.38} stroke="#6b7280" strokeWidth={1.5} />
      <line x1={cx-w*0.42} y1={h*0.38} x2={cx+w*0.42} y2={h*0.38} stroke="#9ca3af" strokeWidth={1.8} />
      <line x1={cx-w*0.28} y1={h*0.56} x2={cx+w*0.28} y2={h*0.56} stroke="#9ca3af" strokeWidth={1.5} />
      <line x1={cx-w*0.14} y1={h*0.74} x2={cx+w*0.14} y2={h*0.74} stroke="#9ca3af" strokeWidth={1.2} />
    </>
  )
}

function PowerRailBody({ w, h, label }: { w: number; h: number; label: string }) {
  return (
    <>
      <rect x={1} y={1} width={w} height={h} rx={2} fill="rgba(0,0,0,0.3)" />
      <rect width={w} height={h} rx={2} fill="#111" stroke="#2a2a2a" strokeWidth={0.8} />
      {/* Red VCC rail line */}
      <line x1={w/2} y1={h*0.06} x2={w/2} y2={h*0.44} stroke="#ef4444" strokeWidth={2.5} strokeLinecap="round" />
      {/* GND rail line */}
      <line x1={w/2} y1={h*0.56} x2={w/2} y2={h*0.94} stroke="#6b7280" strokeWidth={2.5} strokeLinecap="round" />
      {/* Labels */}
      <text x={w/2+6} y={h*0.24} fontSize={6} fill="#ef4444" fontFamily="ui-monospace,monospace" fontWeight="700">+</text>
      <text x={w/2+6} y={h*0.76} fontSize={6} fill="#6b7280" fontFamily="ui-monospace,monospace" fontWeight="700">─</text>
    </>
  )
}

// ── Main SandboxPanel component ────────────────────────────────────────────────

type Tool = 'select' | 'wire' | 'delete'

interface WireInProgress {
  fromComp: string
  fromPin: string
  fromX: number
  fromY: number
  mouseX: number
  mouseY: number
  color: string
}

export default function SandboxPanel({ onClose }: { onClose?: () => void }) {
  const { openTabs, activeTabIdx, board, settings, projectPath, pendingCircuit, clearPendingCircuit, projectLanguage } = useStore()
  const activeTab = activeTabIdx >= 0 ? openTabs[activeTabIdx] : null

  // View state
  const [view, setView] = useState<'canvas' | 'text' | 'sim'>('canvas')
  const [tool, setTool] = useState<Tool>('select')
  const [wireColor, setWireColor] = useState(WIRE_COLORS[4])
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 40, y: 40 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedComp, setSelectedComp] = useState<string | null>(null)

  // Circuit state
  const [circuit, setCircuit] = useState<TsukiCircuit>({ ...DEFAULT_CIRCUIT, board: board || 'uno' })

  // ── Consume pendingCircuit from store (loaded via Examples panel) ──────────
  useEffect(() => {
    if (!pendingCircuit) return
    const parsed = textToCircuit(JSON.stringify(pendingCircuit.data))
    if (parsed) {
      setCircuit(parsed)
      setView('canvas')
    }
    clearPendingCircuit()
  }, [pendingCircuit?.id]) // eslint-disable-line
  const [textDraft, setTextDraft] = useState('')
  const [textError, setTextError] = useState('')

  // Wire-in-progress
  const [wip, setWip] = useState<WireInProgress | null>(null)

  // ── Simulator state (via __terminalSpawn, same mechanism as Flash) ──
  type SimStatus = 'idle' | 'loading' | 'running' | 'error'
  const [simStatus, setSimStatus] = useState<SimStatus>('idle')
  const simRunning = simStatus === 'running'
  const [simPinValues, setSimPinValues] = useState<Record<string, number>>({})
  const simPinValuesRef = useRef<Record<string, number>>({})
  const [simLog, setSimLog] = useState<LogEntry[]>([])
  const [simMs, setSimMs] = useState(0)
  const [simLoadError, setSimLoadError] = useState('')
  const [analogInputs, setAnalogInputs] = useState<Record<number, number>>({})
  const [digitalInputs, setDigitalInputs] = useState<Record<number, boolean>>({})
  const showCurrentFlow = settings.showCurrentFlow

  // Accumulator for throttled UI updates (same logic as useSimulator)
  const accumRef = useRef<{
    latestPins: Record<string, number>
    peakPins:   Record<string, number>
    serial:     string[]
    ms:         number
    dirty:      boolean
  }>({ latestPins: {}, peakPins: {}, serial: [], ms: 0, dirty: false })
  const tickRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const simHandleRef = useRef<any>(null)

  // Flush accumulator to React state every 150ms
  const flushAccum = useCallback(() => {
    const acc = accumRef.current
    if (!acc.dirty) return
    acc.dirty = false
    const pinMap = buildPinMap(circuit)
    const merged: StepResult = {
      ok: true, events: [],
      pins:   { ...acc.latestPins, ...acc.peakPins },
      serial: acc.serial.splice(0),
      ms:     acc.ms,
    }
    const bridged = applyStepResult(merged, simPinValuesRef.current, pinMap, [])
    const prev = simPinValuesRef.current
    const next = bridged.pinValues
    const changed = Object.keys(next).some(k => next[k] !== prev[k]) ||
                    Object.keys(prev).some(k => !(k in next))
    simPinValuesRef.current = next
    if (changed) setSimPinValues(next)
    setSimMs(merged.ms)
    if (bridged.log.length > 0)
      setSimLog(p => [...p, ...bridged.log].slice(-200))
    acc.peakPins = { ...acc.latestPins }
  }, [circuit]) // eslint-disable-line

  // Cleanup on unmount
  useEffect(() => () => {
    ;(window as any).__sandboxJsonHandler = null
    if (tickRef.current) clearInterval(tickRef.current)
    simHandleRef.current?.kill?.().catch(() => {})
  }, [])

  // ── Sync text ↔ circuit ──
  useEffect(() => {
    if (view === 'text') setTextDraft(circuitToText(circuit))
  }, [view])

  // Dragging
  const [dragging, setDragging] = useState<{ id: string; ox: number; oy: number } | null>(null)
  const [panning, setPanning] = useState<{ sx: number; sy: number; px: number; py: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Category palette
  const [paletteOpen, setPaletteOpen] = useState(true)

  // ── Canvas helpers ──
  function svgPoint(e: React.PointerEvent | React.MouseEvent) {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left - pan.x) / zoom,
      y: (e.clientY - rect.top - pan.y) / zoom,
    }
  }

  function addComponent(type: string) {
    const def = COMP_DEFS[type]
    if (!def) return
    const id = `${type}_${Date.now()}`
    // Place in center-ish of current view
    const canvasW = svgRef.current?.clientWidth ?? 600
    const canvasH = svgRef.current?.clientHeight ?? 400
    const cx = (canvasW / 2 - pan.x) / zoom - def.w / 2
    const cy = (canvasH / 2 - pan.y) / zoom - def.h / 2
    const comp: PlacedComponent = {
      id, type,
      label: def.label + (circuit.components.filter(c => c.type === type).length + 1),
      x: cx, y: cy, rotation: 0,
      color: def.color,
      props: {},
    }
    setCircuit(c => ({ ...c, components: [...c.components, comp] }))
    setSelectedComp(id)
  }

  function deleteSelected() {
    if (!selectedComp) return
    setCircuit(c => ({
      ...c,
      components: c.components.filter(co => co.id !== selectedComp),
      wires: c.wires.filter(w => w.fromComp !== selectedComp && w.toComp !== selectedComp),
    }))
    setSelectedComp(null)
  }

  // ── Pointer handlers ──
  function onSvgPointerDown(e: React.PointerEvent) {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setPanning({ sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y })
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    // Left-click on background (not on a component) → start pan
    if (e.button === 0 && (e.target as SVGElement).tagName === 'rect' && (e.target as SVGElement).getAttribute('fill') === 'url(#sbgrid)') {
      setPanning({ sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y })
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if (tool === 'select') {
      setSelectedComp(null)
      setWip(null)
    }
  }

  function onSvgPointerMove(e: React.PointerEvent) {
    if (panning) {
      setPan({ x: panning.px + e.clientX - panning.sx, y: panning.py + e.clientY - panning.sy })
      return
    }
    if (dragging) {
      const { x, y } = svgPoint(e)
      setCircuit(c => ({
        ...c,
        components: c.components.map(co =>
          co.id === dragging.id
            ? { ...co, x: x - dragging.ox, y: y - dragging.oy }
            : co
        ),
      }))
    }
    if (wip) {
      const { x, y } = svgPoint(e)
      setWip(w => w ? { ...w, mouseX: x, mouseY: y } : null)
    }
  }

  function onSvgPointerUp(e: React.PointerEvent) {
    setPanning(null)
    setDragging(null)
  }

  function onCompPointerDown(e: React.PointerEvent, compId: string) {
    if (tool === 'delete') {
      e.stopPropagation()
      setCircuit(c => ({
        ...c,
        components: c.components.filter(co => co.id !== compId),
        wires: c.wires.filter(w => w.fromComp !== compId && w.toComp !== compId),
      }))
      return
    }
    if (tool === 'select') {
      e.stopPropagation()
      setSelectedComp(compId)
      const comp = circuit.components.find(c => c.id === compId)!
      const pt = svgPoint(e)
      setDragging({ id: compId, ox: pt.x - comp.x, oy: pt.y - comp.y })
    }
  }

  function onPinClick(compId: string, pinId: string) {
    if (tool !== 'wire') return
    const comp = circuit.components.find(c => c.id === compId)!
    const def = COMP_DEFS[comp.type]
    const pin = def.pins.find(p => p.id === pinId)!
    const pos = getPinAbsPos(comp, pin)

    if (!wip) {
      setWip({ fromComp: compId, fromPin: pinId, fromX: pos.x, fromY: pos.y, mouseX: pos.x, mouseY: pos.y, color: wireColor })
    } else {
      // Complete wire
      if (wip.fromComp === compId && wip.fromPin === pinId) { setWip(null); return }
      const wire: CircuitWire = {
        id: `wire_${Date.now()}`,
        fromComp: wip.fromComp, fromPin: wip.fromPin,
        toComp: compId, toPin: pinId,
        color: wip.color,
        waypoints: [],
      }
      setCircuit(c => ({ ...c, wires: [...c.wires, wire] }))
      setWip(null)
    }
  }

  function onWireClick(wireId: string) {
    if (tool === 'delete') {
      setCircuit(c => ({ ...c, wires: c.wires.filter(w => w.id !== wireId) }))
    } else {
      setSelectedId(wireId)
    }
  }

  function applyText() {
    const parsed = textToCircuit(textDraft)
    if (!parsed) { setTextError('Invalid .tsuki-circuit JSON'); return }
    setTextError('')
    setCircuit(parsed)
    setView('canvas')
  }

  function exportFile() {
    const json = circuitToText(circuit)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${circuit.name.replace(/\s+/g, '_')}.tsuki-circuit`
    a.click(); URL.revokeObjectURL(url)
  }

  function importFile() {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.tsuki-circuit,.json'
    input.onchange = () => {
      const file = input.files?.[0]; if (!file) return
      file.text().then(raw => {
        const parsed = textToCircuit(raw)
        if (parsed) { setCircuit(parsed); setView('canvas') }
      })
    }
    input.click()
  }

  function clearCanvas() {
    if (confirm('Clear the circuit? This cannot be undone.')) {
      setCircuit({ ...DEFAULT_CIRCUIT, name: circuit.name, board: circuit.board })
      setSimPinValues({}); setSimLog([]); simPinValuesRef.current = {}; setSimStatus('idle')
    }
  }

  const CATEGORIES = [
    { id: 'mcu',     label: 'Microcontrollers' },
    { id: 'output',  label: 'Output' },
    { id: 'input',   label: 'Input' },
    { id: 'passive', label: 'Passive' },
    { id: 'power',   label: 'Power' },
  ]

  const selComp = selectedComp ? circuit.components.find(c => c.id === selectedComp) : null

  return (
    <div className="flex flex-col h-full bg-[var(--surface)] text-[var(--fg)] overflow-hidden">

      {/* ── Header ── */}
      <div className="h-8 flex items-center gap-1 px-2 border-b border-[var(--border)] bg-[var(--surface-1)] flex-shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-faint)]">Sandbox</span>
          <span className="text-[9px] text-[var(--fg-faint)] bg-[var(--surface-3)] px-1 rounded font-mono">experimental</span>
          <input
            value={circuit.name}
            onChange={e => setCircuit(c => ({ ...c, name: e.target.value }))}
            className="text-xs bg-transparent outline-none text-[var(--fg-muted)] hover:text-[var(--fg)] border-0 min-w-0 w-28 truncate"
          />
        </div>

        {/* View tabs */}
        <div className="flex items-center gap-0 border border-[var(--border)] rounded overflow-hidden flex-shrink-0">
          {(['canvas','text','sim'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={clsx('px-2 py-0.5 text-[10px] font-medium transition-colors border-0',
                view === v ? 'bg-[var(--active)] text-[var(--fg)]' : 'bg-transparent text-[var(--fg-faint)] hover:text-[var(--fg)]'
              )}>
              {v === 'canvas' ? 'Canvas' : v === 'text' ? 'Text' : 'Sim'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">
          <button onClick={importFile} title="Import .tsuki-circuit" className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] cursor-pointer border-0 bg-transparent">
            <Upload size={10} />
          </button>
          <button onClick={exportFile} title="Export .tsuki-circuit" className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] cursor-pointer border-0 bg-transparent">
            <Download size={10} />
          </button>
          <button onClick={clearCanvas} title="Clear canvas" className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--err)] hover:bg-[var(--hover)] cursor-pointer border-0 bg-transparent">
            <Trash2 size={10} />
          </button>
        </div>
      </div>

      {/* ── Canvas View ── */}
      {view === 'canvas' && (
        <div className="flex flex-1 overflow-hidden">

          {/* Component palette */}
          <div className="w-36 border-r border-[var(--border)] flex-shrink-0 overflow-y-auto bg-[var(--surface-1)]">
            {/* Tools */}
            <div className="px-2 py-1.5 border-b border-[var(--border)] flex flex-col gap-1">
              <div className="flex gap-1">
                {([
                  { id: 'select', icon: <MousePointer size={11} />, title: 'Select / Move' },
                  { id: 'wire',   icon: <Zap size={11} />,           title: 'Draw Wire' },
                  { id: 'delete', icon: <Trash2 size={11} />,        title: 'Delete' },
                ] as const).map(t => (
                  <button key={t.id} title={t.title} onClick={() => setTool(t.id)}
                    className={clsx('flex-1 h-6 flex items-center justify-center rounded border-0 cursor-pointer transition-colors',
                      tool === t.id ? 'bg-[var(--active)] text-[var(--fg)]' : 'bg-transparent text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
                    )}>
                    {t.icon}
                  </button>
                ))}
              </div>
              {/* Wire color */}
              {tool === 'wire' && (
                <div className="flex flex-wrap gap-0.5 px-0.5">
                  {WIRE_COLORS.map(c => (
                    <button key={c} onClick={() => setWireColor(c)}
                      title={c}
                      className="w-4 h-4 rounded-full border-0 cursor-pointer flex-shrink-0 transition-transform hover:scale-110"
                      style={{ background: c, outline: c === wireColor ? '2px solid var(--fg)' : '1px solid transparent', outlineOffset: '1px' }}
                    />
                  ))}
                </div>
              )}
              {/* Zoom */}
              <div className="flex items-center gap-1">
                <button onClick={() => setZoom(z => Math.max(0.3, z - 0.1))} className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer">
                  <ZoomOut size={10} />
                </button>
                <span className="flex-1 text-center text-[10px] text-[var(--fg-faint)] font-mono">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(z => Math.min(2.5, z + 0.1))} className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer">
                  <ZoomIn size={10} />
                </button>
              </div>
            </div>

            {/* Component library */}
            <div className="py-1">
              {CATEGORIES.map(cat => {
                const items = Object.values(COMP_DEFS).filter(d => d.category === cat.id)
                if (!items.length) return null
                return (
                  <div key={cat.id}>
                    <div className="px-2 py-1 mt-1">
                      <span className="text-[9px] font-semibold uppercase tracking-widest text-[var(--fg-faint)]">{cat.label}</span>
                    </div>
                    {items.map(def => (
                      <button key={def.type} onClick={() => addComponent(def.type)}
                        className="w-full flex items-center gap-2 px-2.5 py-1 text-[11px] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer border-0 bg-transparent text-left">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: def.color }} />
                        {def.label}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>

          {/* SVG Canvas */}
          <div className="flex-1 overflow-hidden relative bg-[var(--surface)]">
            <svg
              ref={svgRef}
              className="w-full h-full"
              style={{ background: 'var(--surface)', cursor: panning ? 'grabbing' : tool === 'wire' ? 'crosshair' : tool === 'delete' ? 'not-allowed' : 'grab' }}
              onPointerDown={onSvgPointerDown}
              onPointerMove={onSvgPointerMove}
              onPointerUp={onSvgPointerUp}
              onWheel={e => {
                e.preventDefault()
                setZoom(z => Math.max(0.3, Math.min(2.5, z - e.deltaY * 0.001)))
              }}
            >
              {/* Dot grid */}
              <defs>
                <pattern id="sbgrid" x={pan.x % (20 * zoom)} y={pan.y % (20 * zoom)}
                  width={20 * zoom} height={20 * zoom} patternUnits="userSpaceOnUse">
                  <circle cx={0} cy={0} r={0.8} fill="var(--border)" opacity={0.5} />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#sbgrid)" />

              <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>

                {/* Wires */}
                {circuit.wires.map(wire => {
                  const fc = circuit.components.find(c => c.id === wire.fromComp)
                  const tc = circuit.components.find(c => c.id === wire.toComp)
                  if (!fc || !tc) return null
                  const fdef = COMP_DEFS[fc.type]; const tdef = COMP_DEFS[tc.type]
                  if (!fdef || !tdef) return null
                  const fp = fdef.pins.find(p => p.id === wire.fromPin)
                  const tp = tdef.pins.find(p => p.id === wire.toPin)
                  if (!fp || !tp) return null
                  const fa = getPinAbsPos(fc, fp); const ta = getPinAbsPos(tc, tp)
                  return (
                    <g key={wire.id}>
                      <path d={makeBezierPath(fa.x, fa.y, ta.x, ta.y)}
                        stroke="transparent" strokeWidth={10} fill="none" style={{ cursor: 'pointer' }}
                        onClick={() => onWireClick(wire.id)} />
                      <path d={makeBezierPath(fa.x, fa.y, ta.x, ta.y)}
                        stroke={wire.color} strokeWidth={selectedId === wire.id ? 2.5 : 1.8}
                        fill="none" strokeLinecap="round"
                        opacity={selectedId === wire.id ? 1 : 0.85} />
                    </g>
                  )
                })}

                {/* Wire in progress */}
                {wip && (
                  <path d={makeBezierPath(wip.fromX, wip.fromY, wip.mouseX, wip.mouseY)}
                    stroke={wip.color} strokeWidth={1.8} fill="none"
                    strokeDasharray="6 3" strokeLinecap="round" opacity={0.7} />
                )}

                {/* Components */}
                {circuit.components.map(comp => {
                  const def = COMP_DEFS[comp.type]
                  if (!def) return null
                  return (
                    <CompShape
                      key={comp.id}
                      comp={comp}
                      def={def}
                      selected={selectedComp === comp.id}
                      simPinValues={simPinValues}
                      onPointerDown={e => onCompPointerDown(e, comp.id)}
                      onPinClick={pinId => onPinClick(comp.id, pinId)}
                    />
                  )
                })}
              </g>
            </svg>

            {/* Empty state */}
            {circuit.components.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
                <Cpu size={28} className="text-[var(--fg-faint)]" />
                <p className="text-xs text-[var(--fg-faint)]">Add components from the palette</p>
                <p className="text-[10px] text-[var(--fg-faint)]">or import a .tsuki-circuit file</p>
              </div>
            )}

            {/* Status bar */}
            <div className="absolute bottom-0 left-0 right-0 h-5 flex items-center px-2 gap-3 bg-[var(--surface-1)] border-t border-[var(--border)] text-[10px] text-[var(--fg-faint)] font-mono">
              <span>{circuit.components.length} comp</span>
              <span>{circuit.wires.length} wires</span>
              <span className="flex-1" />
              <span>alt+drag: pan · scroll: zoom · ESC: cancel</span>
            </div>
          </div>

          {/* Properties panel */}
          {selComp && (
            <div className="w-40 border-l border-[var(--border)] flex-shrink-0 bg-[var(--surface-1)] overflow-y-auto">
              <div className="px-2 py-1.5 border-b border-[var(--border)] flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-faint)]">Properties</span>
                <button onClick={() => setSelectedComp(null)} className="w-4 h-4 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer">
                  <X size={9} />
                </button>
              </div>
              <div className="p-2 flex flex-col gap-2">
                <div>
                  <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">Label</div>
                  <input value={selComp.label}
                    onChange={e => setCircuit(c => ({ ...c, components: c.components.map(co => co.id === selComp.id ? { ...co, label: e.target.value } : co) }))}
                    className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-1.5 py-0.5 text-xs text-[var(--fg)] outline-none" />
                </div>
                <div>
                  <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">Color</div>
                  <div className="flex items-center gap-1.5">
                    <input type="color" value={selComp.color}
                      onChange={e => setCircuit(c => ({ ...c, components: c.components.map(co => co.id === selComp.id ? { ...co, color: e.target.value } : co) }))}
                      className="w-8 h-6 rounded border border-[var(--border)] cursor-pointer bg-transparent" />
                    <span className="text-[10px] font-mono text-[var(--fg-faint)]">{selComp.color}</span>
                  </div>
                </div>
                {selComp.type === 'resistor' && (
                  <div>
                    <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">Ohms</div>
                    <input value={selComp.props.ohms ?? 1000}
                      onChange={e => setCircuit(c => ({ ...c, components: c.components.map(co => co.id === selComp.id ? { ...co, props: { ...co.props, ohms: Number(e.target.value) } } : co) }))}
                      type="number" className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-1.5 py-0.5 text-xs text-[var(--fg)] outline-none" />
                  </div>
                )}
                <div>
                  <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">Type</div>
                  <span className="text-[10px] font-mono text-[var(--fg-muted)]">{selComp.type}</span>
                </div>
                <div>
                  <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">Position</div>
                  <span className="text-[10px] font-mono text-[var(--fg-muted)]">{Math.round(selComp.x)}, {Math.round(selComp.y)}</span>
                </div>
                <button onClick={deleteSelected}
                  className="mt-1 flex items-center justify-center gap-1 w-full py-1 rounded text-[10px] text-[var(--err)] hover:bg-[color-mix(in_srgb,var(--err)_8%,transparent)] border border-[color-mix(in_srgb,var(--err)_20%,transparent)] cursor-pointer bg-transparent transition-colors">
                  <Trash2 size={9} /> Delete
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Text View ── */}
      {view === 'text' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--surface-1)] flex items-center gap-2 flex-shrink-0">
            <FileText size={11} className="text-[var(--fg-faint)]" />
            <span className="text-xs text-[var(--fg-muted)] flex-1">Edit circuit as <span className="font-mono text-[var(--fg)]">.tsuki-circuit</span> — JSON with components, wires, colors</span>
            {textError && <span className="text-[10px] text-[var(--err)] flex items-center gap-1"><AlertCircle size={9}/>{textError}</span>}
            <button onClick={applyText}
              className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-[var(--fg)] text-[var(--accent-inv)] cursor-pointer border-0 hover:opacity-80">
              <CheckCircle2 size={10} /> Apply
            </button>
          </div>
          <div className="flex-1 relative overflow-hidden">
            <textarea
              value={textDraft}
              onChange={e => { setTextDraft(e.target.value); setTextError('') }}
              spellCheck={false}
              className="w-full h-full resize-none outline-none border-0 bg-[var(--surface)] text-[var(--fg)] font-mono text-xs leading-5 p-4"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
          <div className="px-3 py-1.5 border-t border-[var(--border)] bg-[var(--surface-1)] text-[10px] text-[var(--fg-faint)] font-mono flex-shrink-0">
            .tsuki-circuit v1 · {circuit.components.length} components · {circuit.wires.length} wires
          </div>
        </div>
      )}

      {/* ── Simulation View ── */}
      {view === 'sim' && (() => {
        const analogPins  = getAnalogInputPins(circuit)
        const digitalPins = getDigitalInputPins(circuit)

        const handleStop = () => {
          ;(window as any).__sandboxJsonHandler = null
          simHandleRef.current?.kill?.().catch(() => {})
          simHandleRef.current = null
          if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
          simPinValuesRef.current = {}
          setSimPinValues({})
          setSimStatus('idle')
        }

        const handleReset = () => {
          handleStop()
          accumRef.current = { latestPins: {}, peakPins: {}, serial: [], ms: 0, dirty: false }
          setSimLog([])
          setSimMs(0)
          setSimLoadError('')
        }

        const handleRun = async () => {
          if (simRunning) { handleStop(); return }
          const code = activeTab?.content ?? ''
          if (!code.trim()) {
            const hint = projectLanguage === 'cpp' ? 'a .cpp file' : projectLanguage === 'ino' ? 'a .ino file' : 'a .go file'
            setSimLog([{ t: 0, level: 'err', msg: `⚠ No file open — open ${hint} first` }])
            return
          }
          setSimStatus('loading')
          setSimLoadError('')
          setSimLog([])
          setSimPinValues({})
          simPinValuesRef.current = {}
          accumRef.current = { latestPins: {}, peakPins: {}, serial: [], ms: 0, dirty: false }
          setSimMs(0)
          try {
            const bundlePath = await getTmpSimBundlePath()
            const boardName  = board || 'uno'

            // ── Auto-bootstrap circuit if empty ───────────────────────────────
            setCircuit(cur => {
              const hasMcu = cur.components.some(c => COMP_DEFS[c.type]?.category === 'mcu')
              if (hasMcu) return cur
              const usedPins = new Set<number>()
              // Detect pins from both C++ (digitalWrite) and Go (arduino.DigitalWrite)
              const reC  = /digitalWrite\s*\(\s*(\w+)\s*,/g
              const reGo = /arduino\.DigitalWrite\s*\(\s*(\w+)\s*,/g
              for (const re of [reC, reGo]) {
                let m: RegExpExecArray | null
                while ((m = re.exec(code)) !== null) {
                  const n = parseInt(m[1])
                  if (!isNaN(n)) usedPins.add(n)
                }
              }
              if (/LED_BUILTIN/.test(code)) usedPins.add(13)
              const pinList = usedPins.size > 0 ? Array.from(usedPins) : [13]

              const mcuId = 'auto-uno'
              const newComps: typeof cur.components = [
                { id: mcuId, type: 'arduino_uno', x: 120, y: 80, label: 'UNO', props: {}, rotation: 0, color: '' },
              ]
              const newWires: typeof cur.wires = []
              let ledY = 80
              for (const pin of pinList) {
                const ledId = `auto-led-${pin}`
                newComps.push({ id: ledId, type: 'led', x: 320, y: ledY, label: `LED D${pin}`, props: {}, rotation: 0, color: '' })
                newWires.push({
                  id: `auto-wire-${pin}`,
                  fromComp: mcuId, fromPin: `D${pin}`,
                  toComp: ledId, toPin: 'anode',
                  color: '', waypoints: [],
                })
                ledY += 80
              }
              return { ...cur, components: newComps, wires: newWires }
            })

            // ── Step 1: transpile in-process (no tsuki-core.exe subprocess) ──
            try {
              await emitSimBundle(code, boardName, bundlePath)
            } catch (e) {
              setSimLoadError(e instanceof Error ? e.message : String(e))
              setSimStatus('error')
              return
            }

            // ── Step 2: run simulator in-process (no tsuki-sim.exe subprocess) ─
            const simEventId = `sim-${Date.now()}`
            ;(window as any).__sandboxJsonHandler = (result: StepResult & { energy?: unknown }) => {
              const acc = accumRef.current
              // Apply pin snapshot from this segment (emitted at each delay boundary by Rust)
              for (const [p, v] of Object.entries(result.pins)) {
                acc.latestPins[p] = v as number
                acc.peakPins[p]   = v as number  // peakPins = latestPins (Rust handles timing)
              }
              if (result.serial?.length) acc.serial.push(...result.serial)
              acc.ms    = result.ms
              acc.dirty = true
              if (!result.ok) {
                ;(window as any).__sandboxJsonHandler = null
                if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
                setSimLoadError(result.error ?? 'Simulation error')
                setSimStatus('error')
              }
            }

            if (tickRef.current) clearInterval(tickRef.current)
            tickRef.current = setInterval(flushAccum, 150)
            setSimStatus('running')
            setSimLog([{ t: 0, level: 'info', msg: `▶ simulator · board=${boardName}` }])

            const handle = await runSimulator(
              simEventId,
              code,
              boardName,
              undefined,
              (line) => {
                if (!line.trim().startsWith('{')) return
                try {
                  const result = JSON.parse(line)
                  ;(window as any).__sandboxJsonHandler?.(result)
                } catch { /* ignore non-JSON */ }
              }
            )
            simHandleRef.current = handle

            handle.done.then(() => {
              ;(window as any).__sandboxJsonHandler = null
              simHandleRef.current = null
              if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
              flushAccum()
              setSimStatus(s => s === 'running' ? 'idle' : s)
            })
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            setSimLoadError(msg)
            setSimStatus('error')
            ;(window as any).__sandboxJsonHandler = null
            if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
          }
        }

        return (
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Controls bar */}
            <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--surface-1)] flex items-center gap-2 flex-shrink-0">
              <button
                onClick={simRunning ? handleStop : handleRun}
                disabled={simStatus === 'loading'}
                className={clsx(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold cursor-pointer border-0 transition-colors',
                  simRunning
                    ? 'bg-[color-mix(in_srgb,var(--err)_12%,transparent)] text-[var(--err)] hover:bg-[color-mix(in_srgb,var(--err)_20%,transparent)]'
                    : 'bg-[var(--fg)] text-[var(--accent-inv)] hover:opacity-80 disabled:opacity-40',
                )}>
                {simStatus === 'loading'
                  ? <><span className="animate-spin inline-block w-3 h-3 border border-current border-t-transparent rounded-full"/>Starting…</>
                  : simRunning
                    ? <><Square size={10}/> Stop</>
                    : <><Play  size={10}/> Run</>
                }
              </button>

              <button onClick={handleReset}
                className="w-6 h-6 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer">
                <RotateCcw size={11}/>
              </button>

              <div className="flex-1"/>

              {activeTab ? (
                <span className="text-[10px] text-[var(--ok)] flex items-center gap-1">
                  <CheckCircle2 size={9}/> {activeTab.name}
                </span>
              ) : (
                <span className="text-[10px] text-[var(--fg-faint)] flex items-center gap-1">
                  <AlertCircle size={9}/>
                  {projectLanguage === 'cpp' ? 'Open a .cpp file' : projectLanguage === 'ino' ? 'Open a .ino file' : 'Open a .go file'}
                </span>
              )}

              {simRunning && (
                <span className="text-[10px] text-[var(--fg-faint)] font-mono">
                  {simMs.toFixed(0)}ms
                </span>
              )}
            </div>

            {/* Main area */}
            <div className="flex-1 flex overflow-hidden">

              {/* Left: mini-canvas + external input controls */}
              <div className="flex-1 flex flex-col overflow-hidden">

                {/* Mini circuit canvas */}
                <div className="flex-1 overflow-hidden relative bg-[var(--surface)]">
                  <svg className="w-full h-full">
                    <defs>
                      <pattern id="simgrid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                        <circle cx="0" cy="0" r="0.8" fill="var(--border)" opacity="0.4"/>
                      </pattern>
                    </defs>
                    <style>{`
                      @keyframes flowDash {
                        from { stroke-dashoffset: 0 }
                        to   { stroke-dashoffset: -20 }
                      }
                      .flow-active {
                        animation: flowDash 0.45s linear infinite;
                      }
                    `}</style>
                    <rect width="100%" height="100%" fill="url(#simgrid)"/>
                    <g transform="translate(20,20) scale(0.75)">
                      {circuit.wires.map(wire => {
                        const fc = circuit.components.find(c => c.id === wire.fromComp)
                        const tc = circuit.components.find(c => c.id === wire.toComp)
                        if (!fc || !tc) return null
                        const fdef = COMP_DEFS[fc.type]; const tdef = COMP_DEFS[tc.type]
                        if (!fdef || !tdef) return null
                        const fp = fdef.pins.find(p => p.id === wire.fromPin)
                        const tp = tdef.pins.find(p => p.id === wire.toPin)
                        if (!fp || !tp) return null
                        const fa = getPinAbsPos(fc, fp); const ta = getPinAbsPos(tc, tp)
                        const key = `${wire.toComp}:${wire.toPin}`
                        const val = simPinValues[key] ?? 0
                        const isActive = val > 0
                        const d = makeBezierPath(fa.x, fa.y, ta.x, ta.y)
                        return (
                          <g key={wire.id}>
                            {/* Base wire — bright when active, dimmed when idle */}
                            <path d={d}
                              stroke={isActive ? wire.color : wire.color + '44'}
                              strokeWidth={isActive ? 2.5 : 1.5}
                              fill="none" strokeLinecap="round"/>
                            {/* Animated current-flow dots (only when setting is on and wire is active) */}
                            {showCurrentFlow && isActive && (
                              <path d={d}
                                stroke="rgba(255,255,255,0.7)"
                                strokeWidth={1.5}
                                fill="none"
                                strokeLinecap="round"
                                strokeDasharray={`4 ${Math.max(8, 14 - Math.round(val * 6))}`}
                                className="flow-active"
                              />
                            )}
                          </g>
                        )
                      })}
                      {circuit.components.map(comp => {
                        const def = COMP_DEFS[comp.type]
                        if (!def) return null
                        return (
                          <CompShape key={comp.id} comp={comp} def={def} selected={false}
                            simPinValues={simPinValues}
                            onPointerDown={() => {}} onPinClick={() => {}}/>
                        )
                      })}
                    </g>
                  </svg>
                  {circuit.components.length === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
                      <Activity size={22} className="text-[var(--fg-faint)]"/>
                      <p className="text-xs text-[var(--fg-faint)]">Build a circuit on the Canvas first</p>
                    </div>
                  )}
                </div>

                {/* External inputs panel */}
                {(analogPins.length > 0 || digitalPins.length > 0) && (
                  <div className="border-t border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 flex-shrink-0">
                    <div className="text-[9px] font-semibold uppercase tracking-widest text-[var(--fg-faint)] mb-2">External Inputs</div>

                    {/* Analog sliders — changes sent to tsuki-sim via stdin */}
                    {analogPins.map(pinIdx => (
                      <div key={pinIdx} className="flex items-center gap-2 mb-1.5">
                        <span className="text-[10px] font-mono text-[var(--fg-muted)] w-7">A{pinIdx}</span>
                        <input type="range" min={0} max={1023}
                          value={analogInputs[pinIdx] ?? 512}
                          onChange={e => {
                            const v = Number(e.target.value)
                            setAnalogInputs(prev => ({ ...prev, [pinIdx]: v }))
                            simHandleRef.current?.write?.(
                              JSON.stringify({ type: 'analog', pin: pinIdx, val: v }) + '\n'
                            )?.catch(() => {})
                          }}
                          className="flex-1 h-1.5 appearance-none rounded bg-[var(--border)] accent-[var(--active)] cursor-pointer"/>
                        <span className="text-[10px] font-mono text-[var(--fg-faint)] w-8 text-right">
                          {analogInputs[pinIdx] ?? 512}
                        </span>
                      </div>
                    ))}

                    {/* Digital toggles — sent to tsuki-sim via stdin */}
                    {digitalPins.map(({ pin, label }) => (
                      <div key={pin} className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-mono text-[var(--fg-muted)] flex-1 truncate">{label}</span>
                        <button
                          onPointerDown={() => {
                            setDigitalInputs(prev => ({ ...prev, [pin]: true }))
                            simHandleRef.current?.write?.(
                              JSON.stringify({ type: 'digital', pin, val: 1 }) + '\n'
                            )?.catch(() => {})
                          }}
                          onPointerUp={() => {
                            setDigitalInputs(prev => ({ ...prev, [pin]: false }))
                            simHandleRef.current?.write?.(
                              JSON.stringify({ type: 'digital', pin, val: 0 }) + '\n'
                            )?.catch(() => {})
                          }}
                          className={clsx(
                            'px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors cursor-pointer select-none',
                            digitalInputs[pin]
                              ? 'bg-[var(--ok)] text-white border-[var(--ok)]'
                              : 'bg-transparent text-[var(--fg-faint)] border-[var(--border)] hover:border-[var(--fg-muted)]'
                          )}>
                          {digitalInputs[pin] ? 'HIGH' : 'LOW'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Right: serial + event log */}
              <div className="w-52 border-l border-[var(--border)] flex flex-col overflow-hidden bg-[var(--surface-1)]">
                <div className="px-2 py-1.5 border-b border-[var(--border)] flex-shrink-0 flex items-center justify-between">
                  <span className="text-[9px] font-semibold uppercase tracking-widest text-[var(--fg-faint)]">
                    Serial / Events
                  </span>
                  <button onClick={() => setSimLog([])}
                    className="text-[9px] text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer">
                    clear
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-0.5 font-mono">
                  {(simLoadError || simStatus === 'error') && (
                    <div className="text-[10px] text-[var(--err)] px-1.5 py-2 rounded bg-[color-mix(in_srgb,var(--err)_8%,transparent)] border border-[color-mix(in_srgb,var(--err)_25%,transparent)] whitespace-pre-wrap leading-relaxed mb-1">
                      {simLoadError}
                    </div>
                  )}
                  {simLog.length === 0 && simStatus !== 'error' && !simLoadError && (
                    <p className="text-[10px] text-[var(--fg-faint)] px-1 py-2">
                      {simStatus === 'idle'    ? 'Press ▶ Run to start…' :
                       simStatus === 'loading' ? 'Starting simulator…'   :
                       'Running — waiting for output…'}
                    </p>
                  )}
                  {simLog.map((entry, i) => (
                    <div key={i} className={clsx(
                      'text-[10px] px-1 py-0.5 rounded leading-relaxed',
                      entry.level === 'ok'   ? 'text-[var(--ok)]' :
                      entry.level === 'err'  ? 'text-[var(--err)]' :
                      entry.level === 'warn' ? 'text-yellow-400' :
                      'text-[var(--fg-muted)]'
                    )}>
                      <span className="text-[var(--fg-faint)] mr-1">{entry.t}ms</span>
                      {entry.msg}
                    </div>
                  ))}
                </div>
                <div className="px-2 py-1 border-t border-[var(--border)] flex-shrink-0">
                  <div className={clsx('text-[9px] flex items-center gap-1 font-sans',
                    simStatus === 'running' ? 'text-[var(--ok)]' :
                    simStatus === 'error'   ? 'text-[var(--err)]' :
                    simStatus === 'loading' ? 'text-yellow-400' :
                    'text-[var(--fg-faint)]'
                  )}>
                    <span className={clsx('w-1.5 h-1.5 rounded-full inline-block',
                      simStatus === 'running' ? 'bg-[var(--ok)]' :
                      simStatus === 'error'   ? 'bg-[var(--err)]' :
                      simStatus === 'loading' ? 'bg-yellow-400' :
                      'bg-[var(--fg-faint)]'
                    )}/>
                    tsuki-sim · {simStatus}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}