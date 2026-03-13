// ══════════════════════════════════════════════════════════════════════════════
//  simBridge.ts — Translate tsuki-sim StepResult into visual component states
//
//  The simulator writes to Arduino pin numbers (0-19 for digital, 0-5 for
//  analog) and emits SimEvents. The circuit canvas knows which PlacedComponent
//  pin is wired to each Arduino pin via CircuitWire. This module bridges them.
// ══════════════════════════════════════════════════════════════════════════════

import type { TsukiCircuit } from '@/components/experiments/SandboxPanel/SandboxDefs'
import { COMP_DEFS } from '@/components/experiments/SandboxPanel/SandboxDefs'
import type { StepResult, SimEvent } from './useSimulator'

// Re-export StepResult so consumers don't need to reach into useSimulator directly
export type { StepResult }

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
  circuit: TsukiCircuit,
): BridgeResult {
  // ── Step 1: build MCU-authoritative pin state (fresh every tick) ──────────
  // CRITICAL: do NOT start from prevPinValues for non-MCU pins.
  // If we carry over previous values, a pin that went LOW keeps its stale HIGH
  // state because the BFS only seeds from positive values — breaking blink loops.
  //
  // Only MCU pins (from result.pins) are ground truth. Everything else is
  // re-derived by propagateNetSignals below.
  const mcuPinValues: Record<string, number> = {}

  // Track which component:pin keys came directly from the MCU
  const mcuKeys = new Set<string>()

  for (const [pinStr, val] of Object.entries(result.pins)) {
    const pinNum = parseInt(pinStr)
    if (isNaN(pinNum)) continue
    const targets = pinMap.get(pinNum)
    if (targets) {
      for (const { compId, pinId } of targets) {
        const key = `${compId}:${pinId}`
        mcuPinValues[key] = val
        mcuKeys.add(key)
      }
    }
  }

  // Map energy.current (A) → "compId:pinId:mA"
  if (result.energy?.current) {
    for (const [pinStr, amps] of Object.entries(result.energy.current)) {
      const pinNum = parseInt(pinStr)
      if (isNaN(pinNum)) continue
      const targets = pinMap.get(pinNum)
      if (targets) {
        for (const { compId, pinId } of targets) {
          mcuPinValues[`${compId}:${pinId}:mA`] = amps * 1000
        }
      }
    }
  }

  // ── Step 2: propagate signals through passives (fresh derived state) ──────
  // mcuPinValues now contains ONLY what the MCU set this tick.
  // propagateNetSignals will fill in derived pins (LED anodes behind resistors, etc.)
  propagateNetSignals(mcuPinValues, circuit)

  // ── Step 3: merge — MCU pins always win over any propagated value ─────────
  // (propagation won't overwrite MCU pins anyway, but belt-and-suspenders)
  const pinValues = mcuPinValues

  // Only produce log entries for Serial output — never for dw/aw/delay
  const log: LogEntry[] = (result.serial ?? []).map(msg => ({
    t:     Math.round(result.ms),
    level: 'info' as const,
    msg:   `> ${msg}`,
  }))

  return { pinValues, log, ms: result.ms }
}

// ── Net signal propagation ─────────────────────────────────────────────────────
//
// The simulator only knows about MCU pins. Components wired through passive
// elements (resistors, diodes, capacitors) never appear in result.pins, so
// their visual state stays 0.  This function does a BFS from every pin that
// already has a signal and walks the wire graph, passing the signal through
// passive component bodies to reach downstream components.
//
// For resistors it also computes the approximate current in mA so the LED
// brightness can reflect the actual current limiting (Vcc=5V, LED Vf≈2V):
//   I = (Vcc - Vf) / R  →  mA = 3000 / ohms

const PASSIVE_TYPES = new Set([
  'resistor', 'capacitor', 'diode', 'transistor_npn', 'mosfet_n',
  'power_rail', 'vcc_node', 'gnd_node',
])

// Breadboard internal bus logic
// Left side (a-e): all holes in the same row number are connected
// Right side (f-j): same — but left and right are SEPARATED by the center gap
// e.g. a1,b1,c1,d1,e1 → one bus; f1,g1,h1,i1,j1 → separate bus; a1 ≠ f1
//
// Power rails (breadboard_830):
//   pvcc_t*/pvcc_b* → all connected (single VCC bus)
//   pgnd_t*/pgnd_b* → all connected (single GND bus)
const BB_LEFT  = new Set(['a','b','c','d','e'])
const BB_RIGHT = new Set(['f','g','h','i','j'])
export function getBreadboardBusPeers(pinId: string, allPins: readonly { id: string }[]): string[] {
  // Power rail buses (breadboard_830)
  if (pinId.startsWith('pvcc_')) {
    return allPins.filter(p => p.id !== pinId && p.id.startsWith('pvcc_')).map(p => p.id)
  }
  if (pinId.startsWith('pgnd_')) {
    return allPins.filter(p => p.id !== pinId && p.id.startsWith('pgnd_')).map(p => p.id)
  }
  // Component hole buses (a-e / f-j, same row number)
  const col = pinId[0]
  const row = pinId.slice(1)
  const bus = BB_LEFT.has(col) ? BB_LEFT : BB_RIGHT.has(col) ? BB_RIGHT : null
  if (!bus) return []
  return allPins.filter(p => p.id !== pinId && bus.has(p.id[0]) && p.id.slice(1) === row).map(p => p.id)
}

function propagateNetSignals(
  pinValues: Record<string, number>,
  circuit: TsukiCircuit,
): void {
  // ── Build adjacency list: "compId:pinId" → neighbors ──
  type Node = { compId: string; pinId: string }
  const adj = new Map<string, Node[]>()
  const addEdge = (a: string, b: Node) => {
    const list = adj.get(a)
    if (list) list.push(b)
    else adj.set(a, [b])
  }
  for (const wire of circuit.wires) {
    addEdge(`${wire.fromComp}:${wire.fromPin}`, { compId: wire.toComp,   pinId: wire.toPin   })
    addEdge(`${wire.toComp}:${wire.toPin}`,     { compId: wire.fromComp, pinId: wire.fromPin })
  }

  const compById = new Map(circuit.components.map(c => [c.id, c]))

  // ── Seed: every pin that already carries a signal ──
  // Collect (key, signal mA) pairs — use mA=20 as default when no energy data
  type Seed = { key: string; val: number; mA: number }
  const seeds: Seed[] = []
  const seen  = new Set<string>()

  for (const [rawKey, v] of Object.entries(pinValues)) {
    if (rawKey.endsWith(':mA') || v <= 0) continue
    const mA = pinValues[`${rawKey}:mA`] ?? 20
    seeds.push({ key: rawKey, val: v, mA })
    seen.add(rawKey)
  }

  // ── BFS ──
  const queue: Seed[] = [...seeds]

  while (queue.length > 0) {
    const { key, val, mA } = queue.shift()!
    const colonIdx = key.indexOf(':')
    const compId   = key.slice(0, colonIdx)
    const pinId    = key.slice(colonIdx + 1)
    const comp     = compById.get(compId)
    if (!comp) continue
    const def = COMP_DEFS[comp.type]
    if (!def) continue

    // If this component is a passive, broadcast signal to ALL its other pins
    // (i.e., the signal travels through the component body).
    if (PASSIVE_TYPES.has(def.type)) {
      // Compute outgoing mA (resistor limits current)
      let outMa = mA
      if (def.type === 'resistor') {
        const ohms = Number(comp.props?.ohms ?? 1000)
        outMa = ohms > 0 ? Math.round(3000 / ohms * 10) / 10 : mA
      }

      for (const otherPin of def.pins) {
        if (otherPin.id === pinId) continue
        const otherKey = `${compId}:${otherPin.id}`
        if (seen.has(otherKey)) continue
        seen.add(otherKey)
        // Write signal + mA through the passive
        if (!pinValues[otherKey]) pinValues[otherKey] = val
        pinValues[`${otherKey}:mA`] = outMa
        queue.push({ key: otherKey, val, mA: outMa })
      }
    }

    // Breadboard: propagate signal to all holes in the same row-side bus
    if (def.type === 'breadboard' || def.type === 'breadboard_830') {
      for (const peerId of getBreadboardBusPeers(pinId, def.pins)) {
        const peerKey = `${compId}:${peerId}`
        if (!seen.has(peerKey)) {
          seen.add(peerKey)
          if (!pinValues[peerKey]) pinValues[peerKey] = val
          if (!pinValues[`${peerKey}:mA`]) pinValues[`${peerKey}:mA`] = mA
          queue.push({ key: peerKey, val, mA })
        }
      }
    }

    // Walk wires from this pin to neighbors
    for (const nb of adj.get(key) ?? []) {
      const nbKey = `${nb.compId}:${nb.pinId}`
      if (seen.has(nbKey)) continue
      const nbComp = compById.get(nb.compId)
      if (!nbComp) continue
      const nbDef = COMP_DEFS[nbComp.type]
      if (!nbDef) continue
      // Don't overwrite MCU pins — those are ground-truth from the simulator
      if (nbDef.category === 'mcu') continue

      seen.add(nbKey)
      if (!pinValues[nbKey]) pinValues[nbKey] = val
      // Preserve an existing :mA value set by energy data
      if (!pinValues[`${nbKey}:mA`]) pinValues[`${nbKey}:mA`] = mA
      queue.push({ key: nbKey, val, mA })
    }
  }
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