// ══════════════════════════════════════════════════════════════════════════════
//  simBridge.ts — Translate tsuki-sim StepResult into visual component states
//
//  The simulator writes to Arduino pin numbers (0-19 for digital, 0-5 for
//  analog) and emits SimEvents. The circuit canvas knows which PlacedComponent
//  pin is wired to each Arduino pin via CircuitWire. This module bridges them.
// ══════════════════════════════════════════════════════════════════════════════

import type { TsukiCircuit } from '@/components/sandbox/SandboxDefs'
import { COMP_DEFS } from '@/components/sandbox/SandboxDefs'
import type { StepResult, SimEvent } from './useSimulator'

// ── Types ──────────────────────────────────────────────────────────────────────

/** Visual state of a placed component driven by the simulation */
export interface CompSimState {
  /** "compId:pinId" → 0-255 value; 0=off, 1=HIGH, 2-254=PWM, 255=max */
  pinValues:  Record<string, number>
  /** Active animation hints e.g. "blink", "vibrate" */
  anim?:      string
  /** Arbitrary extra state e.g. LCD display lines */
  extra?:     Record<string, unknown>
}

/** Per-step simulation output for the UI */
export interface BridgeResult {
  /** "compId:pinId" → raw value */
  pinValues:  Record<string, number>
  /** Human-readable log entries */
  log:        LogEntry[]
  /** Updated virtual clock in ms */
  ms:         number
}

export interface LogEntry {
  t:      number
  level:  'info' | 'ok' | 'warn' | 'err'
  msg:    string
}

// ── Arduino pin-ID to number mapping ─────────────────────────────────────────

/** Convert a CircuitPin id like "D13", "A3" → Arduino pin number */
function pinIdToArduinoPin(pinId: string): number | null {
  if (pinId.startsWith('D')) {
    const n = parseInt(pinId.slice(1))
    return isNaN(n) ? null : n
  }
  if (pinId.startsWith('A')) {
    const n = parseInt(pinId.slice(1))
    // Analog pins on Uno: A0=14, A1=15 ... A5=19
    return isNaN(n) ? null : n + 14
  }
  return null
}

/** Build a reverse lookup: arduino pin number → list of { compId, pinId } */
export function buildPinMap(
  circuit: TsukiCircuit,
): Map<number, { compId: string; pinId: string }[]> {
  const map = new Map<number, { compId: string; pinId: string }[]>()

  for (const wire of circuit.wires) {
    const {
      fromComp, fromPin,
      toComp,   toPin,
    } = wire

    const tryRegister = (compId: string, pinId: string, otherCompId: string, otherPinId: string) => {
      // If the other end is an MCU, map its pin number to this comp pin
      const otherComp = circuit.components.find(c => c.id === otherCompId)
      if (!otherComp) return

      const def = COMP_DEFS[otherComp.type]
      if (!def || def.category !== 'mcu') return

      // Find the arduino pin number from the def's pin metadata
      const defPin = def.pins.find(p => p.id === otherPinId)
      const arduinoNum = defPin?.arduino ?? pinIdToArduinoPin(otherPinId) ?? null

      if (arduinoNum !== null) {
        const existing = map.get(arduinoNum) ?? []
        existing.push({ compId, pinId })
        map.set(arduinoNum, existing)
      }
    }

    tryRegister(fromComp, fromPin, toComp, toPin)
    tryRegister(toComp, toPin, fromComp, fromPin)
  }

  return map
}

// ── Bridge function ────────────────────────────────────────────────────────────
//
// Design principle: the simulator runs at CPU speed — a 500ms blink loop may
// execute thousands of times per 100ms UI tick, producing thousands of dw/aw
// events. We must NEVER log those events directly; doing so fills the log panel
// in milliseconds and crashes React.
//
// Instead:
//  • Pin visual state  → use result.pins (the authoritative snapshot at end of batch)
//  • Log entries       → only Serial.print/println output from result.serial

export function applyStepResult(
  result: StepResult,
  prevPinValues: Record<string, number>,
  pinMap: Map<number, { compId: string; pinId: string }[]>,
  prevLog: LogEntry[],
): BridgeResult {
  // Build new pin values starting from previous state
  const pinValues: Record<string, number> = { ...prevPinValues }

  // Apply the authoritative end-of-batch pin snapshot from the simulator.
  // This is the only source we trust for visual state — individual dw/aw events
  // inside the batch are intentionally ignored to avoid log explosion.
  for (const [pinStr, val] of Object.entries(result.pins)) {
    const pinNum = parseInt(pinStr)
    if (isNaN(pinNum)) continue
    const targets = pinMap.get(pinNum)
    if (targets) {
      for (const { compId, pinId } of targets) {
        pinValues[`${compId}:${pinId}`] = val
      }
    }
  }

  // Only produce log entries for Serial output — never for dw/aw/delay
  const log: LogEntry[] = (result.serial ?? []).map(msg => ({
    t:     Math.round(result.ms),
    level: 'info' as const,
    msg:   `> ${msg}`,
  }))

  return { pinValues, log, ms: result.ms }
}

// ── Analog input helpers ───────────────────────────────────────────────────────

/** Find which Arduino analog pins (A0-A5, index 0-5) are used in the circuit */
export function getAnalogInputPins(circuit: TsukiCircuit): number[] {
  const used = new Set<number>()
  for (const wire of circuit.wires) {
    for (const [compId, pinId] of [[wire.fromComp, wire.fromPin], [wire.toComp, wire.toPin]]) {
      const comp = circuit.components.find(c => c.id === compId)
      if (!comp) continue
      const def = COMP_DEFS[comp.type]
      if (!def) continue
      const defPin = def.pins.find(p => p.id === pinId)
      if (defPin?.type === 'analog') {
        // The wired partner is the MCU pin
        const otherPinId = pinId === wire.fromPin ? wire.toPin : wire.fromPin
        if (otherPinId.startsWith('A')) {
          const n = parseInt(otherPinId.slice(1))
          if (!isNaN(n) && n < 6) used.add(n)
        }
      }
    }
  }
  return Array.from(used).sort()
}

/** Find which digital input pins are used (buttons etc.) */
export function getDigitalInputPins(circuit: TsukiCircuit): { pin: number; label: string }[] {
  const used = new Map<number, string>()
  for (const comp of circuit.components) {
    const def = COMP_DEFS[comp.type]
    if (!def || def.category !== 'input') continue
    // Find wires connecting this component to the MCU
    for (const wire of circuit.wires) {
      const isFrom = wire.fromComp === comp.id
      const isTo   = wire.toComp   === comp.id
      if (!isFrom && !isTo) continue
      const mcuPinId = isFrom ? wire.toPin : wire.fromPin
      const arduinoNum = pinIdToArduinoPin(mcuPinId)
      if (arduinoNum !== null) {
        used.set(arduinoNum, `${comp.label} D${arduinoNum}`)
      }
    }
  }
  return Array.from(used.entries())
    .map(([pin, label]) => ({ pin, label }))
    .sort((a, b) => a.pin - b.pin)
}