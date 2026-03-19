'use client'
import { useState, useRef, useEffect } from 'react'
import { Trash2, Upload, Download } from 'lucide-react'
import { clsx } from 'clsx'
import { useStore } from '@/lib/store'
import { DEFAULT_CIRCUIT, circuitToText, textToCircuit, type WireProbe, COMP_DEFS } from './SandboxDefs'
import { useCircuit }    from './hooks/useCircuit'
import { useSimRunner }  from './hooks/useSimRunner'
import CanvasView        from './views/CanvasView'
import TextView          from './views/TextView'
import SimView           from './views/SimView'

type View = 'canvas' | 'text' | 'sim'

// ── Buzzer audio hook ──────────────────────────────────────────────────────────
// Uses Web Audio API to play a square-wave tone for each active buzzer component.
// The pin value from tsuki-sim is the tone() frequency (if > 1) or just HIGH/LOW.
//
// IMPORTANT: Web Audio requires a user gesture to start. The AudioContext is
// unlocked explicitly via `unlockAudio()` which must be called from a click
// handler (e.g. the Run button). Without this, ctx.state stays 'suspended' on
// most browsers and the oscillator produces no sound.
function useBuzzerAudio(
  circuit: ReturnType<typeof useCircuit>['circuit'],
  simPinValues: Record<string, number>,
  simRunning: boolean,
) {
  const ctxRef   = useRef<AudioContext | null>(null)
  const nodesRef = useRef<Map<string, { osc: OscillatorNode; gain: GainNode }>>(new Map())

  // ── Unlock must be called from a user-gesture click handler ──────────────
  const unlockAudio = () => {
    if (!ctxRef.current) {
      try { ctxRef.current = new AudioContext() } catch { return }
    }
    if (ctxRef.current.state === 'suspended') {
      ctxRef.current.resume().catch(() => {})
    }
  }

  // ── Stop all buzzer nodes ─────────────────────────────────────────────────
  function stopAll() {
    const ctx = ctxRef.current
    nodesRef.current.forEach(({ osc, gain }) => {
      try {
        if (ctx) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.015)
        setTimeout(() => { try { osc.stop() } catch { /* already stopped */ } }, 80)
      } catch { /* ignore */ }
    })
    nodesRef.current.clear()
  }

  useEffect(() => {
    if (!simRunning) { stopAll(); return }

    const buzzers = circuit.components.filter(c => c.type === 'buzzer')

    for (const buzzer of buzzers) {
      const pinVal   = simPinValues[`${buzzer.id}:pos`] ?? 0
      const isActive = pinVal > 0
      // tsuki-sim emits tone frequency as the pin value when tone() is called.
      // For plain digitalWrite HIGH it emits 1; use a default buzz frequency.
      const freq = pinVal > 1 ? Math.min(20000, Math.max(20, pinVal)) : 2000

      if (isActive) {
        // Ensure AudioContext exists and is running — create it if needed.
        // Note: if unlockAudio() was already called on Run click, this will
        // find the existing ctx in 'running' state.
        if (!ctxRef.current) {
          try { ctxRef.current = new AudioContext() } catch { continue }
        }
        const ctx = ctxRef.current
        // Resume asynchronously — if it was already running this is a no-op.
        if (ctx.state === 'suspended') {
          ctx.resume().then(() => {
            // Re-trigger the effect after the context is running so the
            // oscillator actually starts producing sound.
          }).catch(() => {})
        }

        if (nodesRef.current.has(buzzer.id)) {
          // Update frequency in-place if changed
          const { osc } = nodesRef.current.get(buzzer.id)!
          osc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.005)
        } else {
          const osc  = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.type            = 'square'
          osc.frequency.value = freq
          // Ramp in gently to avoid click artefact
          gain.gain.setValueAtTime(0, ctx.currentTime)
          gain.gain.setTargetAtTime(0.07, ctx.currentTime, 0.01)
          osc.start()
          nodesRef.current.set(buzzer.id, { osc, gain })
        }
      } else {
        if (nodesRef.current.has(buzzer.id)) {
          const { osc, gain } = nodesRef.current.get(buzzer.id)!
          const ctx = ctxRef.current
          if (ctx) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.015)
          setTimeout(() => { try { osc.stop() } catch { /* ignore */ } }, 80)
          nodesRef.current.delete(buzzer.id)
        }
      }
    }

    // Clean up nodes for buzzers that were removed from circuit
    const buzzerIds = new Set(buzzers.map(b => b.id))
    nodesRef.current.forEach((nodes, id) => {
      if (!buzzerIds.has(id)) {
        const ctx = ctxRef.current
        try {
          if (ctx) nodes.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.015)
          setTimeout(() => { try { nodes.osc.stop() } catch { /* ignore */ } }, 80)
        } catch { /* ignore */ }
        nodesRef.current.delete(id)
      }
    })
  }, [simRunning, simPinValues, circuit.components]) // eslint-disable-line

  // Cleanup on unmount
  useEffect(() => () => {
    stopAll()
    ctxRef.current?.close().catch(() => {})
  }, []) // eslint-disable-line

  return { unlockAudio }
}

export default function SandboxPanel({ onClose, fullscreen = false }: { onClose?: () => void; fullscreen?: boolean }) {
  const { board } = useStore()

  // ── Shared state (passed to both Canvas and Sim views) ─────────────────────
  const [probes, setProbes] = useState<WireProbe[]>([])
  const [view, setView]     = useState<View>('canvas')
  const [confirmClear, setConfirmClear] = useState(false)

  const isEspBoard = board === 'esp8266' || board === 'esp32'

  // ── Hooks ──────────────────────────────────────────────────────────────────
  const { circuit, setCircuit } = useCircuit(board || 'uno')

  const sim = useSimRunner(circuit, setCircuit)

  // ── Buzzer audio ────────────────────────────────────────────────────────────
  const { unlockAudio } = useBuzzerAudio(circuit, sim.simPinValues, sim.simRunning)

  // Wrap handleRun to unlock the AudioContext during the user gesture (click).
  // Without this, browsers keep the AudioContext suspended and the buzzer
  // produces no sound even when the simulation is running.
  const handleRunWithAudio = (code: string, boardName: string) => {
    unlockAudio()
    return sim.handleRun(code, boardName)
  }

  // ── Import / Export / Clear ────────────────────────────────────────────────

  function exportFile() {
    const json = circuitToText(circuit)
    const blob = new Blob([json], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${circuit.name.replace(/\s+/g, '_')}.tsuki-circuit`
    a.click()
    URL.revokeObjectURL(url)
  }

  function importFile() {
    const input   = document.createElement('input')
    input.type    = 'file'
    input.accept  = '.tsuki-circuit,.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      file.text().then(raw => {
        const parsed = textToCircuit(raw)
        if (parsed) { setCircuit(parsed); setView('canvas') }
      })
    }
    input.click()
  }

  function clearCanvas() {
    setConfirmClear(true)
  }

  function confirmClearCanvas() {
    setConfirmClear(false)
    setCircuit({ ...DEFAULT_CIRCUIT, name: circuit.name, board: circuit.board })
    sim.handleReset()
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-[var(--surface)] text-[var(--fg)] overflow-hidden">

      {/* ── Header ── */}
      <div className="h-8 flex items-center gap-1 px-2 border-b border-[var(--border)] bg-[var(--surface-1)] flex-shrink-0">
        {/* Title + circuit name */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-faint)]">Sandbox</span>
          <span className="text-[9px] text-[var(--fg-faint)] bg-[var(--surface-3)] px-1 rounded font-mono">
            experimental
          </span>
          <input
            value={circuit.name}
            onChange={e => setCircuit(c => ({ ...c, name: e.target.value }))}
            className="text-xs bg-transparent outline-none text-[var(--fg-muted)] hover:text-[var(--fg)] border-0 min-w-0 w-28 truncate"
          />
        </div>

        {/* View tabs */}
        <div className="flex items-center gap-0 border border-[var(--border)] rounded overflow-hidden flex-shrink-0">
          {(['canvas', 'text', 'sim'] as const).map(v => (
            <button
              key={v} onClick={() => setView(v)}
              className={clsx(
                'px-2 py-0.5 text-[10px] font-medium transition-colors border-0',
                view === v
                  ? 'bg-[var(--active)] text-[var(--fg)]'
                  : 'bg-transparent text-[var(--fg-faint)] hover:text-[var(--fg)]',
              )}
            >
              {v === 'canvas' ? 'Canvas' : v === 'text' ? 'Text' : 'Sim'}
            </button>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">
          <button
            onClick={importFile} title="Import .tsuki-circuit"
            className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] cursor-pointer border-0 bg-transparent"
          >
            <Upload size={10} />
          </button>
          <button
            onClick={exportFile} title="Export .tsuki-circuit"
            className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] cursor-pointer border-0 bg-transparent"
          >
            <Download size={10} />
          </button>
          <button
            onClick={clearCanvas} title="Clear canvas"
            className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--err)] hover:bg-[var(--hover)] cursor-pointer border-0 bg-transparent"
          >
            <Trash2 size={10} />
          </button>
        </div>
      </div>

      {/* ── Inline clear confirmation ── */}
      {confirmClear && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[color-mix(in_srgb,var(--err)_10%,transparent)] border-b border-[var(--err)] flex-shrink-0">
          <span className="text-xs text-[var(--err)] flex-1">Clear the circuit? This cannot be undone.</span>
          <button
            onClick={confirmClearCanvas}
            className="px-2 py-0.5 text-[10px] rounded bg-[var(--err)] text-white cursor-pointer border-0 hover:opacity-80 font-medium"
          >
            Clear
          </button>
          <button
            onClick={() => setConfirmClear(false)}
            className="px-2 py-0.5 text-[10px] rounded bg-transparent text-[var(--fg-muted)] cursor-pointer border border-[var(--border)] hover:bg-[var(--hover)]"
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Views ── */}

      {view === 'canvas' && (
        <CanvasView
          circuit={circuit}
          setCircuit={setCircuit}
          simPinValues={sim.simPinValues}
          simStatus={sim.simStatus}
          pressedComps={sim.pressedComps}
          toggledComps={sim.toggledComps}
          probes={probes}
          setProbes={setProbes}
          onButtonPress={sim.onButtonPress}
          onButtonRelease={sim.onButtonRelease}
          onSwitchToggle={sim.onSwitchToggle}
        />
      )}

      {view === 'text' && (
        <TextView
          circuit={circuit}
          setCircuit={setCircuit}
          onApplied={() => setView('canvas')}
        />
      )}

      {view === 'sim' && (
        <SimView
          circuit={circuit}
          setCircuit={setCircuit}
          probes={probes}
          simStatus={sim.simStatus}
          simRunning={sim.simRunning}
          simPinValues={sim.simPinValues}
          simLog={sim.simLog}
          simMs={sim.simMs}
          simLoadError={sim.simLoadError}
          analogInputs={sim.analogInputs}
          setAnalogInputs={sim.setAnalogInputs}
          digitalInputs={sim.digitalInputs}
          setDigitalInputs={sim.setDigitalInputs}
          pressedComps={sim.pressedComps}
          toggledComps={sim.toggledComps}
          sigGenPin={sim.sigGenPin}
          setSigGenPin={sim.setSigGenPin}
          sigGenFreq={sim.sigGenFreq}
          setSigGenFreq={sim.setSigGenFreq}
          sigGenRunning={sim.sigGenRunning}
          serialSend={sim.serialSend}
          setSerialSend={sim.setSerialSend}
          simHandleRef={sim.simHandleRef}
          handleRun={handleRunWithAudio}
          handleStop={sim.handleStop}
          handleReset={sim.handleReset}
          onButtonPress={sim.onButtonPress}
          onButtonRelease={sim.onButtonRelease}
          onSwitchToggle={sim.onSwitchToggle}
          startSigGen={sim.startSigGen}
          stopSigGen={sim.stopSigGen}
        />
      )}

    </div>
  )
}