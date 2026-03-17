import { useState, useRef, useCallback, useEffect } from 'react'
import { useStore } from '@/lib/store'
import {
  getTmpSimBundlePath,
  emitSimBundle,
  runSimulator,
} from '@/lib/tauri'
import {
  buildPinMap,
  applyStepResult,
  getAnalogInputPins,
  getDigitalInputPins,
  getBreadboardBusPeers,
  type StepResult,
  type LogEntry,
} from '@/lib/simBridge'
import { COMP_DEFS, type TsukiCircuit } from '../SandboxDefs'

export type SimStatus = 'idle' | 'loading' | 'running' | 'error'

export function useSimRunner(
  circuit: TsukiCircuit,
  setCircuit: (fn: (c: TsukiCircuit) => TsukiCircuit) => void,
) {
  const { board, settings, openTabs, activeTabIdx, projectLanguage } = useStore()

  // ── Sim state ─────────────────────────────────────────────────────────────
  const [simStatus, setSimStatus]       = useState<SimStatus>('idle')
  const simRunning                       = simStatus === 'running'
  const [simPinValues, setSimPinValues] = useState<Record<string, number>>({})
  const simPinValuesRef                  = useRef<Record<string, number>>({})
  const [simLog, setSimLog]             = useState<LogEntry[]>([])
  const [simMs, setSimMs]               = useState(0)
  const [simLoadError, setSimLoadError] = useState('')

  // ── External inputs ───────────────────────────────────────────────────────
  const [analogInputs, setAnalogInputs]   = useState<Record<number, number>>({})
  const [digitalInputs, setDigitalInputs] = useState<Record<number, boolean>>({})

  // ── Interactive component state ───────────────────────────────────────────
  const [pressedComps, setPressedComps]   = useState<Set<string>>(new Set())
  const [toggledComps, setToggledComps]   = useState<Record<string, boolean>>({})

  // ── Signal generator ──────────────────────────────────────────────────────
  const [sigGenPin, setSigGenPin]         = useState(2)
  const [sigGenFreq, setSigGenFreq]       = useState(2)
  const [sigGenRunning, setSigGenRunning] = useState(false)
  const sigGenRef                          = useRef<ReturnType<typeof setInterval> | null>(null)
  const sigGenStateRef                     = useRef(false)

  // ── Logic analyzer ────────────────────────────────────────────────────────
  const [waveformPins, setWaveformPins]   = useState<number[]>([])
  const pinHistoryRef                      = useRef<Map<number, number[]>>(new Map())
  const [waveformVersion, setWaveformVersion] = useState(0)

  // ── Serial send ───────────────────────────────────────────────────────────
  const [serialSend, setSerialSend] = useState('')

  // ── Internal refs ─────────────────────────────────────────────────────────
  const accumRef = useRef<{
    latestPins: Record<string, number>
    peakPins:   Record<string, number>
    serial:     string[]
    ms:         number
    dirty:      boolean
  }>({ latestPins: {}, peakPins: {}, serial: [], ms: 0, dirty: false })

  const tickRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const simHandleRef = useRef<any>(null)

  // Keep stable refs for values used in callbacks
  const circuitRef      = useRef(circuit)
  const waveformPinsRef = useRef(waveformPins)
  useEffect(() => { circuitRef.current = circuit }, [circuit])
  useEffect(() => { waveformPinsRef.current = waveformPins }, [waveformPins])

  // ── Flush accumulator to React state every 150ms ──────────────────────────
  const flushAccum = useCallback(() => {
    const acc = accumRef.current
    if (!acc.dirty) return
    acc.dirty = false

    const pinMap = buildPinMap(circuitRef.current)
    const merged: StepResult = {
      ok: true, events: [],
      pins:   { ...acc.latestPins, ...acc.peakPins },
      serial: acc.serial.splice(0),
      ms:     acc.ms,
    }
    const bridged = applyStepResult(
      merged, simPinValuesRef.current, pinMap, [], circuitRef.current,
    )
    const prev    = simPinValuesRef.current
    const next    = bridged.pinValues
    const changed =
      Object.keys(next).some(k => next[k] !== prev[k]) ||
      Object.keys(prev).some(k => !(k in next))

    simPinValuesRef.current = next
    if (changed) setSimPinValues(next)
    setSimMs(merged.ms)
    if (bridged.log.length > 0)
      setSimLog(p => [...p, ...bridged.log].slice(-200))
    acc.peakPins = { ...acc.latestPins }

    // Record waveform history
    const wp = waveformPinsRef.current
    if (wp.length > 0) {
      let histChanged = false
      for (const pinIdx of wp) {
        const val = next[`arduino_pin_${pinIdx}`] ?? next[`${pinIdx}`] ?? 0
        const arr = pinHistoryRef.current.get(pinIdx) ?? []
        arr.push(val > 0 ? 1 : 0)
        if (arr.length > 120) arr.splice(0, arr.length - 120)
        pinHistoryRef.current.set(pinIdx, arr)
        histChanged = true
      }
      if (histChanged) setWaveformVersion(v => v + 1)
    }
  }, []) // stable — uses only refs

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => {
    ;(window as any).__sandboxJsonHandler = null
    if (tickRef.current)   clearInterval(tickRef.current)
    if (sigGenRef.current) clearInterval(sigGenRef.current)
    simHandleRef.current?.kill?.().catch(() => {})
  }, [])

  // ── Helpers ───────────────────────────────────────────────────────────────

  function findConnectedArduinoPin(compId: string, pinId: string, visited = new Set<string>()): number | null {
    const visitKey = `${compId}:${pinId}`
    if (visited.has(visitKey)) return null
    visited.add(visitKey)

    const c = circuitRef.current
    const wires = c.wires.filter(w =>
      (w.fromComp === compId && w.fromPin === pinId) ||
      (w.toComp   === compId && w.toPin   === pinId),
    )
    for (const wire of wires) {
      const otherId  = wire.fromComp === compId ? wire.toComp  : wire.fromComp
      const otherPin = wire.fromComp === compId ? wire.toPin   : wire.fromPin
      const other    = c.components.find(co => co.id === otherId)
      if (!other) continue
      const def = COMP_DEFS[other.type]
      const pin = def?.pins.find(p => p.id === otherPin)
      if (pin?.arduino !== undefined) return pin.arduino
      const deeper = findConnectedArduinoPin(otherId, otherPin, visited)
      if (deeper !== null) return deeper
    }

    // Traverse breadboard internal bus (rows a-e / f-j connected, and power rails)
    const comp = c.components.find(co => co.id === compId)
    const compDef = comp && COMP_DEFS[comp.type]
    if (compDef && (compDef.type === 'breadboard' || compDef.type === 'breadboard_830')) {
      const peers = getBreadboardBusPeers(pinId, compDef.pins)
      for (const peerId of peers) {
        const result = findConnectedArduinoPin(compId, peerId, visited)
        if (result !== null) return result
      }
    }

    return null
  }

  function injectDigital(arduinoPin: number, val: 0 | 1) {
    simHandleRef.current?.write?.(
      JSON.stringify({ type: 'digital', pin: arduinoPin, val }) + '\n',
    )?.catch(() => {})
  }

  // ── Interactive component handlers ────────────────────────────────────────

  function onButtonPress(compId: string) {
    setPressedComps(s => new Set(s).add(compId))
    const pin1 = findConnectedArduinoPin(compId, 'pin1')
    const pin2 = findConnectedArduinoPin(compId, 'pin2')
    if (pin1 !== null) injectDigital(pin1, 1)
    if (pin2 !== null) injectDigital(pin2, 1)
  }

  function onButtonRelease(compId: string) {
    setPressedComps(s => { const n = new Set(s); n.delete(compId); return n })
    const pin1 = findConnectedArduinoPin(compId, 'pin1')
    const pin2 = findConnectedArduinoPin(compId, 'pin2')
    if (pin1 !== null) injectDigital(pin1, 0)
    if (pin2 !== null) injectDigital(pin2, 0)
  }

  function onSwitchToggle(compId: string) {
    setToggledComps(prev => {
      const next   = { ...prev, [compId]: !prev[compId] }
      const common = findConnectedArduinoPin(compId, 'common')
      const pos1   = findConnectedArduinoPin(compId, 'pos1')
      const pos2   = findConnectedArduinoPin(compId, 'pos2')
      const nowOn  = next[compId]
      if (common !== null) injectDigital(common, 1)
      if (pos1   !== null) injectDigital(pos1, nowOn ? 1 : 0)
      if (pos2   !== null) injectDigital(pos2, nowOn ? 0 : 1)
      return next
    })
  }

  // ── Signal generator ──────────────────────────────────────────────────────

  function startSigGen() {
    if (sigGenRef.current) clearInterval(sigGenRef.current)
    sigGenStateRef.current = false
    const period = Math.max(50, Math.round(1000 / (sigGenFreq * 2)))
    sigGenRef.current = setInterval(() => {
      sigGenStateRef.current = !sigGenStateRef.current
      simHandleRef.current?.write?.(
        JSON.stringify({ type: 'digital', pin: sigGenPin, val: sigGenStateRef.current ? 1 : 0 }) + '\n',
      )?.catch(() => {})
    }, period)
    setSigGenRunning(true)
  }

  function stopSigGen() {
    if (sigGenRef.current) { clearInterval(sigGenRef.current); sigGenRef.current = null }
    simHandleRef.current?.write?.(
      JSON.stringify({ type: 'digital', pin: sigGenPin, val: 0 }) + '\n',
    )?.catch(() => {})
    setSigGenRunning(false)
  }

  // ── Simulator lifecycle ───────────────────────────────────────────────────

  function handleStop() {
    ;(window as any).__sandboxJsonHandler = null
    simHandleRef.current?.kill?.().catch(() => {})
    simHandleRef.current = null
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    simPinValuesRef.current = {}
    setSimPinValues({})
    setSimStatus('idle')
  }

  function handleReset() {
    handleStop()
    accumRef.current = { latestPins: {}, peakPins: {}, serial: [], ms: 0, dirty: false }
    setSimLog([])
    setSimMs(0)
    setSimLoadError('')
  }

  async function handleRun(code: string, boardName: string) {
    if (simRunning) { handleStop(); return }
    if (!code.trim()) {
      const hint =
        projectLanguage === 'cpp'    ? 'a .cpp file' :
        projectLanguage === 'ino'    ? 'a .ino file' :
        projectLanguage === 'python' ? 'a .py file'  : 'a .go file'
      setSimLog([{ t: 0, level: 'err', msg: `⚠ No file open — open ${hint} first` }])
      return
    }

    // Guard: if a Python project is selected but the code looks like generated C++
    // (e.g. the user has a transpiler output tab active), refuse to run and explain.
    if (projectLanguage === 'python' && /^\/\/ Generated by tsuki/.test(code.trim())) {
      setSimLog([{ t: 0, level: 'err', msg: '⚠ Simulator received generated C++ instead of Python source. Open main.py and try again.' }])
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

      // Auto-bootstrap circuit if empty
      setCircuit(cur => {
        const hasMcu = cur.components.some(c => COMP_DEFS[c.type]?.category === 'mcu')
        if (hasMcu) return cur
        const usedPins = new Set<number>()
        const reC   = /digitalWrite\s*\(\s*(\w+)\s*,/g
        const reGo  = /arduino\.DigitalWrite\s*\(\s*(\w+)\s*,/g
        const rePy  = /arduino\.digitalWrite\s*\(\s*(\w+)\s*,/g
        for (const re of [reC, reGo, rePy]) {
          let m: RegExpExecArray | null
          while ((m = re.exec(code)) !== null) {
            const n = parseInt(m[1])
            if (!isNaN(n)) usedPins.add(n)
          }
        }
        if (/LED_BUILTIN/.test(code)) usedPins.add(13)
        const pinList = usedPins.size > 0 ? Array.from(usedPins) : [13]
        const mcuId   = 'auto-uno'
        const newComps: typeof cur.components = [
          { id: mcuId, type: 'arduino_uno', x: 120, y: 80, label: 'UNO', props: {}, rotation: 0, color: '' },
        ]
        const newWires: typeof cur.wires = []
        let ledY = 80
        for (const pin of pinList) {
          const ledId = `auto-led-${pin}`
          newComps.push({
            id: ledId, type: 'led', x: 320, y: ledY,
            label: `LED D${pin}`, props: {}, rotation: 0, color: '',
          })
          newWires.push({
            id: `auto-wire-${pin}`,
            fromComp: mcuId, fromPin: `D${pin}`,
            toComp: ledId,   toPin: 'anode',
            color: '', waypoints: [],
          })
          ledY += 80
        }
        return { ...cur, components: newComps, wires: newWires }
      })

      // Transpile (pass language so PythonPipeline is used for .py projects)
      try {
        await emitSimBundle(code, boardName, bundlePath, projectLanguage === 'python' ? 'python' : 'go')
      } catch (e) {
        setSimLoadError(e instanceof Error ? e.message : String(e))
        setSimStatus('error')
        return
      }

      // Set up JSON stream handler
      const simEventId = `sim-${Date.now()}`
      ;(window as any).__sandboxJsonHandler = (result: StepResult & { error?: string }) => {
        const acc = accumRef.current
        for (const [p, v] of Object.entries(result.pins)) {
          acc.latestPins[p] = v as number
          acc.peakPins[p]   = v as number
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
        simEventId, code, boardName, undefined,
        (line) => {
          if (!line.trim().startsWith('{')) return
          try {
            const result = JSON.parse(line)
            ;(window as any).__sandboxJsonHandler?.(result)
          } catch { /* ignore non-JSON */ }
        },
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

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    // State
    simStatus, simRunning,
    simPinValues, simLog, simMs, simLoadError,
    analogInputs,  setAnalogInputs,
    digitalInputs, setDigitalInputs,
    pressedComps,  setPressedComps,
    toggledComps,  setToggledComps,
    sigGenPin,     setSigGenPin,
    sigGenFreq,    setSigGenFreq,
    sigGenRunning,
    waveformPins,  setWaveformPins,
    pinHistoryRef, waveformVersion,
    serialSend,    setSerialSend,
    simHandleRef,
    // Actions
    handleRun, handleStop, handleReset,
    injectDigital,
    onButtonPress, onButtonRelease, onSwitchToggle,
    startSigGen,   stopSigGen,
  }
}