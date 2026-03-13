'use client'
import { useState } from 'react'
import { Trash2, Upload, Download } from 'lucide-react'
import { clsx } from 'clsx'
import { useStore } from '@/lib/store'
import { DEFAULT_CIRCUIT, circuitToText, textToCircuit, type WireProbe } from './SandboxDefs'
import { useCircuit }    from './hooks/useCircuit'
import { useSimRunner }  from './hooks/useSimRunner'
import CanvasView        from './views/CanvasView'
import TextView          from './views/TextView'
import SimView           from './views/SimView'

type View = 'canvas' | 'text' | 'sim'

export default function SandboxPanel({ onClose }: { onClose?: () => void }) {
  const { board } = useStore()

  // ── Shared state (passed to both Canvas and Sim views) ─────────────────────
  const [probes, setProbes] = useState<WireProbe[]>([])
  const [view, setView]     = useState<View>('canvas')

  // ── Hooks ──────────────────────────────────────────────────────────────────
  const { circuit, setCircuit } = useCircuit(board || 'uno')

  const sim = useSimRunner(circuit, setCircuit)

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
    if (!confirm('Clear the circuit? This cannot be undone.')) return
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
          waveformPins={sim.waveformPins}
          setWaveformPins={sim.setWaveformPins}
          pinHistoryRef={sim.pinHistoryRef}
          waveformVersion={sim.waveformVersion}
          serialSend={sim.serialSend}
          setSerialSend={sim.setSerialSend}
          simHandleRef={sim.simHandleRef}
          handleRun={sim.handleRun}
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
