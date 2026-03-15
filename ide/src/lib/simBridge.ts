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

// power_rail is intentionally excluded — it has separate 5V/GND buses that
// must NOT cross-contaminate, so it's handled via its own bus logic below.
// vcc_node / gnd_node are single-pin stubs; their signal comes from pre-seeding.
const PASSIVE_TYPES = new Set([
  'resistor', 'capacitor', 'diode', 'transistor_npn', 'mosfet_n',
  'vcc_node', 'gnd_node',
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

// ── BFS runner (extracted so relay post-processing can reuse it) ──────────────
function bfsFrom(
  startSeeds: Array<{ key: string; val: number; mA: number }>,
  pinValues: Record<string, number>,
  seen: Set<string>,
  adj: Map<string, Array<{ compId: string; pinId: string }>>,
  compById: Map<string, { id: string; type: string; props: Record<string, string | number> }>,
): void {
  const queue = [...startSeeds]

  while (queue.length > 0) {
    const { key, val, mA } = queue.shift()!
    const colonIdx = key.indexOf(':')
    const compId   = key.slice(0, colonIdx)
    const pinId    = key.slice(colonIdx + 1)
    const comp     = compById.get(compId)
    if (!comp) continue
    const def = COMP_DEFS[comp.type]
    if (!def) continue

    // ── Passive: broadcast through all pins ──
    if (PASSIVE_TYPES.has(def.type)) {
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
        if (!pinValues[otherKey]) pinValues[otherKey] = val
        pinValues[`${otherKey}:mA`] = outMa
        queue.push({ key: otherKey, val, mA: outMa })
      }
    }

    // ── Power rail: 5V↔5V only; GND↔GND only (never cross) ──
    if (def.type === 'power_rail') {
      const isVcc = pinId.startsWith('5v')
      const isGnd = pinId.startsWith('gnd')
      for (const otherPin of def.pins) {
        if (otherPin.id === pinId) continue
        if (isVcc && !otherPin.id.startsWith('5v'))  continue
        if (isGnd && !otherPin.id.startsWith('gnd')) continue
        const otherKey = `${compId}:${otherPin.id}`
        if (seen.has(otherKey)) continue
        seen.add(otherKey)
        if (!pinValues[otherKey]) pinValues[otherKey] = val
        if (!pinValues[`${otherKey}:mA`]) pinValues[`${otherKey}:mA`] = mA
        queue.push({ key: otherKey, val, mA })
      }
    }

    // ── Relay: signal passes IN→coil; COM routes to NO (active) or NC (inactive) ──
    if (def.type === 'relay') {
      const inActive = (pinValues[`${compId}:in`] ?? 0) > 0
      // COM↔NO when active; COM↔NC when inactive
      const switchedPins = inActive
        ? new Set(['com', 'no'])
        : new Set(['com', 'nc'])
      if (switchedPins.has(pinId)) {
        for (const otherPin of def.pins) {
          if (otherPin.id === pinId || !switchedPins.has(otherPin.id)) continue
          const otherKey = `${compId}:${otherPin.id}`
          if (seen.has(otherKey)) continue
          seen.add(otherKey)
          if (!pinValues[otherKey]) pinValues[otherKey] = val
          if (!pinValues[`${otherKey}:mA`]) pinValues[`${otherKey}:mA`] = mA
          queue.push({ key: otherKey, val, mA })
        }
      }
    }

    // ── Breadboard: propagate within row-side bus ──
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

    // ── Walk wires to neighbors ──
    for (const nb of adj.get(key) ?? []) {
      const nbKey = `${nb.compId}:${nb.pinId}`
      if (seen.has(nbKey)) continue
      const nbComp = compById.get(nb.compId)
      if (!nbComp) continue
      const nbDef = COMP_DEFS[nbComp.type]
      if (!nbDef) continue
      // MCU pins are ground-truth — never overwrite them
      if (nbDef.category === 'mcu') continue

      seen.add(nbKey)
      if (!pinValues[nbKey]) pinValues[nbKey] = val
      if (!pinValues[`${nbKey}:mA`]) pinValues[`${nbKey}:mA`] = mA
      queue.push({ key: nbKey, val, mA })
    }
  }
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

  const compById = new Map(circuit.components.map(c => [c.id, c])) as Map<
    string,
    { id: string; type: string; props: Record<string, string | number> }
  >

  type Seed = { key: string; val: number; mA: number }
  const seeds: Seed[] = []
  const seen  = new Set<string>()

  // ── Pre-seed always-on power sources ──────────────────────────────────────
  // Three sources are unconditionally live:
  //   1. vcc_node components
  //   2. power_rail 5V ports
  //   3. MCU power pins (type='power') — covers Arduino 5V/3V3 and Xiao 5V pass-through
  //
  // Note: the BFS already prevents signal from propagating INTO MCU signal pins
  // (category='mcu' guard in bfsFrom), so seeding these power pins unconditionally
  // won't cause phantom signals on MCU-driven signal pins.
  for (const comp of circuit.components) {
    // Dedicated VCC node
    if (comp.type === 'vcc_node') {
      const key = `${comp.id}:5v`
      if (!pinValues[key]) pinValues[key] = 1
      if (!seen.has(key)) { seen.add(key); seeds.push({ key, val: 1, mA: 500 }) }
    }
    // Power rail — 5V ports only (GND ports are 0V, don't seed)
    if (comp.type === 'power_rail') {
      for (let i = 1; i <= 5; i++) {
        const key = `${comp.id}:5v_${i}`
        if (!pinValues[key]) pinValues[key] = 1
        if (!seen.has(key)) { seen.add(key); seeds.push({ key, val: 1, mA: 500 }) }
      }
    }
    // MCU power pins (5V, 3V3 outputs — also Xiao's 5V pass-through even if 'in')
    const def = COMP_DEFS[comp.type]
    if (def?.category === 'mcu') {
      for (const pin of def.pins) {
        if (pin.type === 'power') {
          const key = `${comp.id}:${pin.id}`
          if (!pinValues[key]) pinValues[key] = 1
          if (!seen.has(key)) { seen.add(key); seeds.push({ key, val: 1, mA: 500 }) }
        }
      }
    }
  }

  // ── Seed from MCU-driven pins that already carry a signal ──────────────────
  for (const [rawKey, v] of Object.entries(pinValues)) {
    if (rawKey.endsWith(':mA') || v <= 0) continue
    if (seen.has(rawKey)) continue
    const mA = pinValues[`${rawKey}:mA`] ?? 20
    seeds.push({ key: rawKey, val: v, mA })
    seen.add(rawKey)
  }

  // ── Main BFS pass ──────────────────────────────────────────────────────────
  bfsFrom(seeds, pinValues, seen, adj, compById)

  // ── Relay second pass ──────────────────────────────────────────────────────
  // After the main BFS we know which relay IN pins are active. Re-evaluate
  // relays whose switched output wasn't visited yet (e.g. COM had signal but
  // IN was still 0 during its BFS visit, or vice-versa).
  const relaySeeds: Seed[] = []
  for (const comp of circuit.components) {
    if (comp.type !== 'relay') continue
    const inActive = (pinValues[`${comp.id}:in`] ?? 0) > 0
    const comKey   = `${comp.id}:com`
    const comVal   = pinValues[comKey] ?? 0
    const comMa    = pinValues[`${comKey}:mA`] ?? 0
    if (comVal <= 0) continue
    const outPin = inActive ? 'no' : 'nc'
    const outKey = `${comp.id}:${outPin}`
    if (!pinValues[outKey] && !seen.has(outKey)) {
      seen.add(outKey)
      pinValues[outKey] = comVal
      pinValues[`${outKey}:mA`] = comMa
      relaySeeds.push({ key: outKey, val: comVal, mA: comMa })
    }
  }
  if (relaySeeds.length > 0) {
    bfsFrom(relaySeeds, pinValues, seen, adj, compById)
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