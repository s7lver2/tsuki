'use client'
import { useRef } from 'react'
import {
  Play, Square, RotateCcw, AlertCircle, CheckCircle2,
  Activity, Gauge, Crosshair, X,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useStore } from '@/lib/store'
import { getAnalogInputPins, getDigitalInputPins } from '@/lib/simBridge'
import {
  type TsukiCircuit,
  type WireProbe,
  COMP_DEFS,
  getPinAbsPos,
  makeOrthogonalPath,
  getWireMeasurements,
} from '../SandboxDefs'
import { CompShape } from '../SandboxShapes'
import type { SimStatus } from '../hooks/useSimRunner'

interface SimViewProps {
  circuit: TsukiCircuit
  setCircuit: React.Dispatch<React.SetStateAction<TsukiCircuit>>
  probes: WireProbe[]
  // sim runner state & actions
  simStatus: SimStatus
  simRunning: boolean
  simPinValues: Record<string, number>
  simLog: { t: number; level: string; msg: string }[]
  simMs: number
  simLoadError: string
  analogInputs: Record<number, number>
  setAnalogInputs: React.Dispatch<React.SetStateAction<Record<number, number>>>
  digitalInputs: Record<number, boolean>
  setDigitalInputs: React.Dispatch<React.SetStateAction<Record<number, boolean>>>
  pressedComps: Set<string>
  toggledComps: Record<string, boolean>
  sigGenPin: number
  setSigGenPin: React.Dispatch<React.SetStateAction<number>>
  sigGenFreq: number
  setSigGenFreq: React.Dispatch<React.SetStateAction<number>>
  sigGenRunning: boolean
  waveformPins: number[]
  setWaveformPins: React.Dispatch<React.SetStateAction<number[]>>
  pinHistoryRef: React.MutableRefObject<Map<number, number[]>>
  waveformVersion: number
  serialSend: string
  setSerialSend: React.Dispatch<React.SetStateAction<string>>
  simHandleRef: React.MutableRefObject<any>
  handleRun: (code: string, board: string) => Promise<void>
  handleStop: () => void
  handleReset: () => void
  onButtonPress: (compId: string) => void
  onButtonRelease: (compId: string) => void
  onSwitchToggle: (compId: string) => void
  startSigGen: () => void
  stopSigGen: () => void
}

export default function SimView(props: SimViewProps) {
  const {
    circuit, setCircuit, probes,
    simStatus, simRunning, simPinValues, simLog, simMs, simLoadError,
    analogInputs, setAnalogInputs, digitalInputs, setDigitalInputs,
    pressedComps, toggledComps,
    sigGenPin, setSigGenPin, sigGenFreq, setSigGenFreq, sigGenRunning,
    waveformPins, setWaveformPins, pinHistoryRef, waveformVersion,
    serialSend, setSerialSend, simHandleRef,
    handleRun, handleStop, handleReset,
    onButtonPress, onButtonRelease, onSwitchToggle,
    startSigGen, stopSigGen,
  } = props

  const { openTabs, activeTabIdx, board, settings, projectLanguage } = useStore()
  const activeTab    = activeTabIdx >= 0 ? openTabs[activeTabIdx] : null
  const showCurrentFlow = settings.showCurrentFlow

  const analogPins  = getAnalogInputPins(circuit)
  const digitalPins = getDigitalInputPins(circuit)

  function injectRaw(type: string, pin: number, val: number) {
    simHandleRef.current?.write?.(
      JSON.stringify({ type, pin, val }) + '\n',
    )?.catch(() => {})
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* ── Controls bar ── */}
      <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--surface-1)] flex items-center gap-2 flex-shrink-0">
        <button
          onClick={simRunning
            ? handleStop
            : () => handleRun(activeTab?.content ?? '', board || 'uno')}
          disabled={simStatus === 'loading'}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold cursor-pointer border-0 transition-colors',
            simRunning
              ? 'bg-[color-mix(in_srgb,var(--err)_12%,transparent)] text-[var(--err)] hover:bg-[color-mix(in_srgb,var(--err)_20%,transparent)]'
              : 'bg-[var(--fg)] text-[var(--accent-inv)] hover:opacity-80 disabled:opacity-40',
          )}
        >
          {simStatus === 'loading'
            ? <><span className="animate-spin inline-block w-3 h-3 border border-current border-t-transparent rounded-full" />Starting…</>
            : simRunning
              ? <><Square size={10} /> Stop</>
              : <><Play size={10} /> Run</>
          }
        </button>

        <button
          onClick={handleReset}
          className="w-6 h-6 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer"
        >
          <RotateCcw size={11} />
        </button>

        <div className="flex-1" />

        {activeTab ? (
          <span className="text-[10px] text-[var(--ok)] flex items-center gap-1">
            <CheckCircle2 size={9} /> {activeTab.name}
          </span>
        ) : (
          <span className="text-[10px] text-[var(--fg-faint)] flex items-center gap-1">
            <AlertCircle size={9} />
            {projectLanguage === 'cpp' ? 'Open a .cpp file' : projectLanguage === 'ino' ? 'Open a .ino file' : 'Open a .go file'}
          </span>
        )}

        {simRunning && (
          <span className="text-[10px] text-[var(--fg-faint)] font-mono">
            {simMs.toFixed(0)}ms
          </span>
        )}
      </div>

      {/* ── Main area ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left: mini-canvas + external inputs */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Mini circuit canvas */}
          <div className="flex-1 overflow-hidden relative bg-[var(--surface)]">
            <svg className="w-full h-full">
              <defs>
                <pattern id="simgrid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                  <circle cx="0" cy="0" r="0.8" fill="var(--border)" opacity="0.4" />
                </pattern>
              </defs>
              <style>{`
                @keyframes flowDash { from { stroke-dashoffset: 0 } to { stroke-dashoffset: -20 } }
                .flow-active { animation: flowDash 0.45s linear infinite; }
              `}</style>
              <rect width="100%" height="100%" fill="url(#simgrid)" />
              <g transform="translate(20,20) scale(0.75)">
                {/* Components first, wires on top */}
                {circuit.components.map(comp => {
                  const def = COMP_DEFS[comp.type]
                  if (!def) return null
                  const augComp = comp.type === 'slide_switch'
                    ? { ...comp, props: { ...comp.props, toggled: toggledComps[comp.id] ? 1 : 0 } }
                    : comp
                  return (
                    <CompShape key={comp.id} comp={augComp} selected={false}
                      simPinValues={simPinValues} wireMode={false}
                      pressed={pressedComps.has(comp.id)}
                      onInteractStart={() => {
                        if (comp.type === 'button')       onButtonPress(comp.id)
                        else if (comp.type === 'slide_switch') onSwitchToggle(comp.id)
                      }}
                      onInteractEnd={() => { if (comp.type === 'button') onButtonRelease(comp.id) }}
                      onPointerDown={() => {}} onPinClick={() => {}}
                    />
                  )
                })}
                {/* Wires on top */}
                {circuit.wires.map(wire => {
                  const fc   = circuit.components.find(c => c.id === wire.fromComp)
                  const tc   = circuit.components.find(c => c.id === wire.toComp)
                  if (!fc || !tc) return null
                  const fdef = COMP_DEFS[fc.type]; const tdef = COMP_DEFS[tc.type]
                  if (!fdef || !tdef) return null
                  const fp   = fdef.pins.find(p => p.id === wire.fromPin)
                  const tp   = tdef.pins.find(p => p.id === wire.toPin)
                  if (!fp || !tp) return null
                  const fa   = getPinAbsPos(fc, fp); const ta = getPinAbsPos(tc, tp)
                  const key  = `${wire.toComp}:${wire.toPin}`
                  const val  = simPinValues[key] ?? 0
                  const isActive = val > 0
                  const isProbed = probes.some(p => p.wireId === wire.id)
                  const d    = makeOrthogonalPath(fa.x, fa.y, ta.x, ta.y, wire.waypoints)
                  return (
                    <g key={wire.id}>
                      {isProbed && <path d={d} stroke="#facc15" strokeWidth={5} fill="none" strokeLinecap="square" opacity={0.3} />}
                      <path d={d}
                        stroke={isActive ? wire.color : wire.color + '44'}
                        strokeWidth={isActive ? 2.5 : 1.5}
                        fill="none" strokeLinecap="square"
                      />
                      {showCurrentFlow && isActive && (
                        <path d={d}
                          stroke="rgba(255,255,255,0.7)" strokeWidth={1.5} fill="none"
                          strokeLinecap="square"
                          strokeDasharray={`4 ${Math.max(8, 14 - Math.round(val * 6))}`}
                          className="flow-active"
                        />
                      )}
                    </g>
                  )
                })}
              </g>
            </svg>
            {circuit.components.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
                <Activity size={22} className="text-[var(--fg-faint)]" />
                <p className="text-xs text-[var(--fg-faint)]">Build a circuit on the Canvas first</p>
              </div>
            )}
          </div>

          {/* External inputs */}
          {(analogPins.length > 0 || digitalPins.length > 0) && (
            <div className="border-t border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 flex-shrink-0">
              <div className="text-[9px] font-semibold uppercase tracking-widest text-[var(--fg-faint)] mb-2">
                External Inputs
              </div>
              {analogPins.map(pinIdx => (
                <div key={pinIdx} className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-mono text-[var(--fg-muted)] w-7">A{pinIdx}</span>
                  <input
                    type="range" min={0} max={1023}
                    value={analogInputs[pinIdx] ?? 512}
                    onChange={e => {
                      const v = Number(e.target.value)
                      setAnalogInputs(prev => ({ ...prev, [pinIdx]: v }))
                      injectRaw('analog', pinIdx, v)
                    }}
                    className="flex-1 h-1.5 appearance-none rounded bg-[var(--border)] accent-[var(--active)] cursor-pointer"
                  />
                  <span className="text-[10px] font-mono text-[var(--fg-faint)] w-8 text-right">
                    {analogInputs[pinIdx] ?? 512}
                  </span>
                </div>
              ))}
              {digitalPins.map(({ pin, label }: { pin: number; label: string }) => (
                <div key={pin} className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-mono text-[var(--fg-muted)] flex-1 truncate">{label}</span>
                  <button
                    onPointerDown={() => { setDigitalInputs(p => ({ ...p, [pin]: true }));  injectRaw('digital', pin, 1) }}
                    onPointerUp  ={() => { setDigitalInputs(p => ({ ...p, [pin]: false })); injectRaw('digital', pin, 0) }}
                    className={clsx(
                      'px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors cursor-pointer select-none',
                      digitalInputs[pin]
                        ? 'bg-[var(--ok)] text-white border-[var(--ok)]'
                        : 'bg-transparent text-[var(--fg-faint)] border-[var(--border)] hover:border-[var(--fg-muted)]',
                    )}
                  >
                    {digitalInputs[pin] ? 'HIGH' : 'LOW'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: probes + serial + sig gen + logic analyzer */}
        <div className="w-52 border-l border-[var(--border)] flex flex-col overflow-hidden bg-[var(--surface-1)]">

          {/* Live probe measurements */}
          {probes.length > 0 && (
            <div className="border-b border-[var(--border)] flex-shrink-0">
              <div className="px-2 py-1 flex items-center gap-1">
                <Gauge size={9} className="text-[var(--fg-faint)]" />
                <span className="text-[9px] font-semibold uppercase tracking-widest text-[var(--fg-faint)] flex-1">Probes</span>
              </div>
              <div className="px-1.5 pb-1.5 flex flex-col gap-1.5">
                {probes.map(probe => {
                  const wire = circuit.wires.find(w => w.id === probe.wireId)
                  if (!wire) return null
                  const { voltage, mA, power_mW } = getWireMeasurements(wire, simPinValues, circuit)
                  return (
                    <div key={probe.id} className="rounded border border-[var(--border)] overflow-hidden bg-[var(--surface)]">
                      <div className="flex items-center gap-1 px-1.5 py-0.5">
                        <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: wire.color || '#3b82f6' }} />
                        <span className="text-[9px] text-[var(--fg-muted)] truncate flex-1">{probe.label}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-px bg-[var(--border)]">
                        {[
                          { l: 'V', v: voltage.toFixed(2), u: 'V',  c: '#f97316' },
                          { l: 'I', v: mA.toFixed(1),      u: 'mA', c: '#3b82f6' },
                          { l: 'P', v: power_mW.toFixed(1),u: 'mW', c: '#a855f7' },
                        ].map(({ l, v, u, c }) => (
                          <div key={l} className="bg-[var(--surface-1)] flex flex-col items-center py-0.5">
                            <span className="text-[7px] font-semibold uppercase" style={{ color: c }}>{l}</span>
                            <span className="text-[10px] font-mono font-bold text-[var(--fg)] tabular-nums leading-tight">{v}</span>
                            <span className="text-[7px] text-[var(--fg-faint)]">{u}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Serial / Events log */}
          <div className="px-2 py-1.5 border-b border-[var(--border)] flex-shrink-0 flex items-center justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-widest text-[var(--fg-faint)]">Serial / Events</span>
            {/* clear button removed — use handleReset from parent if needed */}
          </div>
          <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-0.5 font-mono">
            {(simLoadError || simStatus === 'error') && (
              <div className="text-[10px] text-[var(--err)] px-1.5 py-2 rounded bg-[color-mix(in_srgb,var(--err)_8%,transparent)] border border-[color-mix(in_srgb,var(--err)_25%,transparent)] whitespace-pre-wrap leading-relaxed mb-1">
                {simLoadError}
              </div>
            )}
            {simLog.length === 0 && simStatus !== 'error' && !simLoadError && (
              <p className="text-[10px] text-[var(--fg-faint)] px-1 py-2">
                {simStatus === 'idle'    ? 'Press ▶ Run to start…'   :
                 simStatus === 'loading' ? 'Starting simulator…'     :
                 'Running — waiting for output…'}
              </p>
            )}
            {simLog.map((entry, i) => (
              <div key={i} className={clsx(
                'text-[10px] px-1 py-0.5 rounded leading-relaxed',
                entry.level === 'ok'   ? 'text-[var(--ok)]'    :
                entry.level === 'err'  ? 'text-[var(--err)]'   :
                entry.level === 'warn' ? 'text-yellow-400'      :
                'text-[var(--fg-muted)]',
              )}>
                <span className="text-[var(--fg-faint)] mr-1">{entry.t}ms</span>
                {entry.msg}
              </div>
            ))}
          </div>

          {/* Serial Send */}
          <div className="border-t border-[var(--border)] px-2 py-1.5 flex-shrink-0">
            <div className="text-[9px] font-semibold uppercase tracking-widest text-[var(--fg-faint)] mb-1">Serial Send</div>
            <div className="flex gap-1">
              <input
                value={serialSend}
                onChange={e => setSerialSend(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && simStatus === 'running') {
                    injectRaw('serial', 0, 0) // signal; actual send:
                    simHandleRef.current?.write?.(serialSend + '\n')?.catch(() => {})
                    setSerialSend('')
                  }
                }}
                placeholder="type + Enter"
                disabled={simStatus !== 'running'}
                className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[10px] font-mono text-[var(--fg)] outline-none disabled:opacity-40"
              />
              <button
                onClick={() => {
                  if (simStatus !== 'running') return
                  simHandleRef.current?.write?.(serialSend + '\n')?.catch(() => {})
                  setSerialSend('')
                }}
                disabled={simStatus !== 'running'}
                className="px-1.5 py-0.5 text-[9px] rounded bg-[var(--active)] text-[var(--fg)] border-0 cursor-pointer disabled:opacity-40"
              >
                ↵
              </button>
            </div>
          </div>

          {/* Signal Generator */}
          <div className="border-t border-[var(--border)] px-2 py-1.5 flex-shrink-0">
            <div className="text-[9px] font-semibold uppercase tracking-widest text-[var(--fg-faint)] mb-1.5 flex items-center gap-1">
              <Activity size={8} /> Signal Gen
            </div>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[9px] text-[var(--fg-faint)] w-6">Pin</span>
              <input type="number" min={0} max={19} value={sigGenPin}
                onChange={e => setSigGenPin(Number(e.target.value))}
                className="w-10 bg-[var(--surface)] border border-[var(--border)] rounded px-1 text-[10px] font-mono text-[var(--fg)] outline-none"
              />
              <span className="text-[9px] text-[var(--fg-faint)] w-6">Hz</span>
              <input type="number" min={0.1} max={500} step={0.5} value={sigGenFreq}
                onChange={e => setSigGenFreq(Number(e.target.value))}
                className="w-14 bg-[var(--surface)] border border-[var(--border)] rounded px-1 text-[10px] font-mono text-[var(--fg)] outline-none"
              />
            </div>
            <div className="flex gap-1">
              <button onClick={() => injectRaw('digital', sigGenPin, 1)} disabled={simStatus !== 'running'}
                className="flex-1 py-0.5 text-[9px] rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--ok)] cursor-pointer disabled:opacity-40">
                HIGH
              </button>
              <button onClick={() => injectRaw('digital', sigGenPin, 0)} disabled={simStatus !== 'running'}
                className="flex-1 py-0.5 text-[9px] rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--err)] cursor-pointer disabled:opacity-40">
                LOW
              </button>
              <button
                onClick={() => sigGenRunning ? stopSigGen() : startSigGen()}
                disabled={simStatus !== 'running'}
                className={clsx(
                  'flex-1 py-0.5 text-[9px] rounded border cursor-pointer disabled:opacity-40',
                  sigGenRunning
                    ? 'bg-[var(--err)] border-[var(--err)] text-white'
                    : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]',
                )}
              >
                {sigGenRunning ? '⏹ Stop' : '▶ SQW'}
              </button>
            </div>
          </div>

          {/* Logic Analyzer */}
          <div className="border-t border-[var(--border)] px-2 py-1.5 flex-shrink-0">
            <div className="text-[9px] font-semibold uppercase tracking-widest text-[var(--fg-faint)] mb-1.5 flex items-center gap-1">
              <Crosshair size={8} /> Logic Analyzer
            </div>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {[2,3,4,5,6,7,8,9,10,11,12,13].map(pin => {
                const tracked = waveformPins.includes(pin)
                return (
                  <button key={pin}
                    onClick={() => setWaveformPins(prev =>
                      tracked ? prev.filter(p => p !== pin) : [...prev, pin].slice(-6),
                    )}
                    className={clsx(
                      'w-6 h-5 text-[9px] rounded border-0 cursor-pointer font-mono',
                      tracked ? 'bg-[var(--active)] text-[var(--fg)]' : 'bg-[var(--surface-2)] text-[var(--fg-faint)] hover:text-[var(--fg)]',
                    )}
                  >
                    {pin}
                  </button>
                )
              })}
            </div>
            {waveformPins.length > 0 && (
              <div className="rounded border border-[var(--border)] bg-[var(--surface)] p-1 overflow-hidden">
                {waveformPins.map((pin, pi) => {
                  const hist    = pinHistoryRef.current.get(pin) ?? []
                  const W       = 184, rowH = 18
                  const samples = hist.slice(-60)
                  if (samples.length < 2) return (
                    <div key={pin} className="flex items-center gap-1 mb-0.5">
                      <span className="text-[8px] font-mono text-[var(--fg-faint)] w-5">D{pin}</span>
                      <span className="text-[8px] text-[var(--fg-faint)]">waiting…</span>
                    </div>
                  )
                  const pts: string[] = []
                  const stepW = (W - 24) / (samples.length - 1)
                  samples.forEach((v, i) => {
                    const x = 24 + i * stepW
                    const y = v > 0 ? 3 : rowH - 3
                    if (i === 0) pts.push(`M ${x},${y}`)
                    else {
                      const prevY = samples[i-1] > 0 ? 3 : rowH - 3
                      if (prevY !== y) pts.push(`H ${x} V ${y}`)
                      else pts.push(`H ${x}`)
                    }
                  })
                  const COLORS = ['#3b82f6','#22c55e','#f97316','#a855f7','#ec4899','#06b6d4']
                  const c   = COLORS[pi % COLORS.length]
                  const cur = samples[samples.length - 1]
                  return (
                    <svg key={pin} width={W} height={rowH} className="block mb-0.5 overflow-visible">
                      <text x={0} y={rowH*0.65} fontSize={7} fill={c} fontFamily="monospace">D{pin}</text>
                      <path d={pts.join(' ')} fill="none" stroke={c} strokeWidth={1.2} />
                      <rect x={W-8} y={cur>0?2:rowH-6} width={6} height={4} rx={1} fill={c} opacity={0.8} />
                    </svg>
                  )
                })}
              </div>
            )}
            {waveformPins.length === 0 && (
              <p className="text-[9px] text-[var(--fg-faint)]">Select pins above to monitor</p>
            )}
          </div>

          {/* Status dot */}
          <div className="px-2 py-1 border-t border-[var(--border)] flex-shrink-0">
            <div className={clsx(
              'text-[9px] flex items-center gap-1 font-sans',
              simStatus === 'running' ? 'text-[var(--ok)]'    :
              simStatus === 'error'   ? 'text-[var(--err)]'   :
              simStatus === 'loading' ? 'text-yellow-400'      :
              'text-[var(--fg-faint)]',
            )}>
              <span className={clsx(
                'w-1.5 h-1.5 rounded-full inline-block',
                simStatus === 'running' ? 'bg-[var(--ok)]'  :
                simStatus === 'error'   ? 'bg-[var(--err)]' :
                simStatus === 'loading' ? 'bg-yellow-400'    :
                'bg-[var(--fg-faint)]',
              )} />
              tsuki-sim · {simStatus}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}