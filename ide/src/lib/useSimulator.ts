// ════════════════════════════════════════════════════════════════════════════
//  useSimulator — React hook que maneja la simulación del sandbox.
//
//  Invoca `tsuki simulate <file> --board <board>` via spawnProcess de tauri.ts
//  y parsea cada línea de stdout como un StepResult JSON.
//
//  Throttling: el proceso puede emitir miles de pasos por segundo (no hay
//  delay real, sólo virtual). Las callbacks de UI sólo se disparan cada
//  UI_TICK_MS para no saturar React, pero los errores se propagan de inmediato.
//
//  En modo browser (sin Tauri) el hook permanece en 'unavailable'.
// ════════════════════════════════════════════════════════════════════════════

import { useRef, useState, useCallback, useEffect } from 'react'
import {
  isTauri, spawnProcess, writeFile,
  getTmpGoPath, getDefaultBoard, getTsukiBin,
  type ProcessHandle,
} from './tauri'

// ── UI throttle ───────────────────────────────────────────────────────────────
// How often we push StepResult updates to registered callbacks.
// The Rust simulator runs at CPU speed; we cap visual updates at 10 fps.
const UI_TICK_MS = 150

// ── Tipos públicos ────────────────────────────────────────────────────────────

export interface SimEvent {
  t_ms:  number
  kind:  'dw' | 'aw' | 'delay' | 'serial' | string
  pin?:  number
  val?:  number
  msg?:  string
}

export interface EnergyInfo {
  voltage:  Record<string, number>   // pin → volts
  current:  Record<string, number>   // pin → amperes
  power_mw: Record<string, number>   // pin → mW
  total_mw: number
}

export interface StepResult {
  ok:      boolean
  error?:  string
  events:  SimEvent[]
  pins:    Record<string, number>
  serial:  string[]
  ms:      number
  energy?: EnergyInfo
}

export type SimStatus =
  | 'idle' | 'loading' | 'ready' | 'running' | 'paused' | 'error' | 'unavailable'

export interface SimulatorHook {
  status:     SimStatus
  errorMsg:   string
  load(code: string): Promise<string>
  start(opts?: { steps?: number }): void
  pause(): void
  reset(): void
  setAnalogInput(pin: number, value: number): void
  setDigitalInput(pin: number, high: boolean): void
  onStep(cb: StepResultCallback): () => void
  isReady: boolean
}

type StepResultCallback = (result: StepResult) => void

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useSimulator(): SimulatorHook {
  const [status,   setStatus]   = useState<SimStatus>(
    () => isTauri() ? 'idle' : 'unavailable'
  )
  const [errorMsg, setErrorMsg] = useState('')

  const codeRef      = useRef('')
  const handleRef    = useRef<ProcessHandle | null>(null)
  const callbacksRef = useRef<Set<StepResultCallback>>(new Set())

  // Throttle: accumulate ALL results and flush a merged batch every UI_TICK_MS.
  // Keeping only the last result would silently discard serial lines and events
  // that happen between two UI frames.
  // Instead of queuing full StepResult objects (thousands/sec), we keep one
  // rolling accumulator: latest pin state, peak pin state (was it ever HIGH?),
  // and accumulated serial lines. This keeps the main thread free.
  const accumRef = useRef<{
    latestPins: Record<string, number>
    peakPins:   Record<string, number>   // highest value seen this batch
    serial:     string[]
    ms:         number
    dirty:      boolean
  }>({ latestPins: {}, peakPins: {}, serial: [], ms: 0, dirty: false })
  const tickRef      = useRef<ReturnType<typeof setInterval> | null>(null)

  // Kill process + clear throttle timer on unmount
  useEffect(() => () => {
    if (tickRef.current)   clearInterval(tickRef.current)
    if (handleRef.current) {
      handleRef.current.kill().catch(() => {})
      handleRef.current.dispose()
    }
  }, [])

  // ── Throttle timer ────────────────────────────────────────────────────────

  const flushAccum = useCallback(() => {
    const acc = accumRef.current
    if (!acc.dirty) return
    acc.dirty = false
    // Build a synthetic StepResult using peakPins so LEDs that blinked
    // during the batch appear ON, not stuck at whatever the final state was
    const merged: StepResult = {
      ok:     true,
      events: [],
      pins:   { ...acc.latestPins, ...acc.peakPins },   // peak wins for visuals
      serial: acc.serial.splice(0),                      // drain serial
      ms:     acc.ms,
    }
    callbacksRef.current.forEach(cb => cb(merged))
    // Reset peak for next batch (latestPins carries over as baseline)
    acc.peakPins = { ...acc.latestPins }
  }, [])

  const startTick = useCallback(() => {
    if (tickRef.current) return
    tickRef.current = setInterval(flushAccum, UI_TICK_MS)
  }, [flushAccum])

  const stopTick = useCallback(() => {
    if (!tickRef.current) return
    clearInterval(tickRef.current)
    tickRef.current = null
    flushAccum()  // flush whatever was left
  }, [flushAccum])

  // ── load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async (code: string): Promise<string> => {
    if (!isTauri()) return 'Simulación solo disponible en la app de escritorio.'
    codeRef.current = code
    setStatus('ready')
    setErrorMsg('')
    return ''
  }, [])

  // ── start ─────────────────────────────────────────────────────────────────

  const start = useCallback(async (opts?: { steps?: number }) => {
    if (!isTauri() || !codeRef.current) {
      if (!isTauri()) {
        setErrorMsg('Simulación solo disponible en la app de escritorio.')
        setStatus('error')
      }
      return
    }

    // Kill previous process if any
    if (handleRef.current) {
      await handleRef.current.kill().catch(() => {})
      handleRef.current.dispose()
      handleRef.current = null
    }
    stopTick()

    setStatus('loading')
    setErrorMsg('')

    try {
      const tmpPath = await getTmpGoPath()
      await writeFile(tmpPath, codeRef.current)

      const board = await getDefaultBoard()
      const simArgs = ['simulate', '--source', tmpPath, '--board', board || 'uno']
      if (opts?.steps && opts.steps > 0) simArgs.push('--steps', String(opts.steps))

      // Launch tsuki directly — kill() then targets the tsuki process itself,
      // not a parent shell that might leave tsuki running as an orphan.
      const tsukiBin = await getTsukiBin()

      const procHandle = await spawnProcess(
        tsukiBin,
        simArgs,
        undefined,
        (line, isErr) => {
          if (isErr) {
            if (line.trim()) { setErrorMsg(line.trim()); setStatus('error'); stopTick() }
            return
          }
          try {
            const r = JSON.parse(line) as StepResult
            if (!r.ok) {
              stopTick(); setErrorMsg(r.error ?? 'Error de simulación'); setStatus('error')
              callbacksRef.current.forEach(cb => cb(r))
              return
            }
            // Merge into rolling accumulator — O(pins) per result, not O(results)
            const acc = accumRef.current
            for (const [p, v] of Object.entries(r.pins)) {
              acc.latestPins[p] = v
              if ((acc.peakPins[p] ?? 0) < v) acc.peakPins[p] = v
            }
            if (r.serial?.length) acc.serial.push(...r.serial)
            acc.ms    = r.ms
            acc.dirty = true
          } catch { /* non-JSON lines — ignore */ }
        }
      )

      handleRef.current = procHandle

      setStatus('running')
      startTick()

      procHandle.done.then(() => {
        handleRef.current = null
        stopTick()
        setStatus(s => s === 'running' ? 'idle' : s)
      })

    } catch (e) {
      stopTick()
      const msg = e instanceof Error ? e.message : String(e)
      setErrorMsg(msg)
      setStatus('error')
    }
  }, [startTick, stopTick])

  // ── pause / reset ─────────────────────────────────────────────────────────

  const pause = useCallback(async () => {
    stopTick()
    if (handleRef.current) {
      await handleRef.current.kill().catch(() => {})
      handleRef.current.dispose()
      handleRef.current = null
    }
    setStatus('paused')
  }, [stopTick])

  const reset = useCallback(async () => {
    stopTick()
    if (handleRef.current) {
      await handleRef.current.kill().catch(() => {})
      handleRef.current.dispose()
      handleRef.current = null
    }
    accumRef.current = { latestPins: {}, peakPins: {}, serial: [], ms: 0, dirty: false }
    setStatus('idle')
    setErrorMsg('')
  }, [stopTick])

  // ── inputs — sent to the process via stdin as JSON lines ──────────────────

  const sendInput = useCallback((payload: object) => {
    if (!handleRef.current) return
    handleRef.current.write(JSON.stringify(payload) + '\n').catch(() => {})
  }, [])

  const setAnalogInput  = useCallback((pin: number, val: number) => {
    sendInput({ type: 'analog',  pin, val })
  }, [sendInput])

  const setDigitalInput = useCallback((pin: number, high: boolean) => {
    sendInput({ type: 'digital', pin, val: high ? 1 : 0 })
  }, [sendInput])

  // ── onStep ────────────────────────────────────────────────────────────────

  const onStep = useCallback((cb: StepResultCallback) => {
    callbacksRef.current.add(cb)
    return () => { callbacksRef.current.delete(cb) }
  }, [])

  return {
    status, errorMsg,
    load, start, pause, reset,
    setAnalogInput, setDigitalInput, onStep,
    get isReady() { return ['idle', 'ready', 'paused'].includes(status) },
  }
}