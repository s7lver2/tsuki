'use client'
import { Gauge, X } from 'lucide-react'
import { clsx } from 'clsx'
import {
  type WireProbe,
  type TsukiCircuit,
  getWireMeasurements,
} from '../SandboxDefs'
import type { SimStatus } from '../hooks/useSimRunner'

interface Props {
  probes: WireProbe[]
  setProbes: React.Dispatch<React.SetStateAction<WireProbe[]>>
  simStatus: SimStatus
  simPinValues: Record<string, number>
  circuit: TsukiCircuit
  onClose: () => void
}

export default function MeasurementsPanel({
  probes, setProbes, simStatus, simPinValues, circuit, onClose,
}: Props) {
  const isLive = simStatus === 'running'

  return (
    <div className="w-44 border-l border-[var(--border)] flex-shrink-0 bg-[var(--surface-1)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-2 py-1.5 border-b border-[var(--border)] flex items-center justify-between flex-shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-faint)] flex items-center gap-1">
          <Gauge size={9} /> Measurements
        </span>
        <button
          onClick={onClose}
          className="w-4 h-4 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer"
        >
          <X size={9} />
        </button>
      </div>

      {/* Probe list */}
      <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-2">
        {probes.map(probe => {
          const wire = circuit.wires.find(w => w.id === probe.wireId)
          if (!wire) return null
          const { voltage, mA, power_mW } = getWireMeasurements(wire, simPinValues, circuit)
          return (
            <div key={probe.id} className="rounded border border-[var(--border)] overflow-hidden">
              {/* Wire label row */}
              <div className="flex items-center gap-1.5 px-1.5 py-1 bg-[var(--surface)]">
                <span
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ background: wire.color || '#3b82f6' }}
                />
                <span className="text-[9px] text-[var(--fg-muted)] truncate flex-1 leading-tight">
                  {probe.label}
                </span>
                <button
                  onClick={() => setProbes(ps => ps.filter(p => p.id !== probe.id))}
                  className="w-3 h-3 flex items-center justify-center text-[var(--fg-faint)] hover:text-[var(--err)] border-0 bg-transparent cursor-pointer flex-shrink-0"
                >
                  <X size={8} />
                </button>
              </div>

              {/* Readings */}
              <div className="px-1.5 py-1 grid grid-cols-3 gap-x-1 gap-y-0.5">
                {[
                  { label: 'V', value: isLive ? `${voltage.toFixed(2)}V`   : '—', color: '#f97316' },
                  { label: 'I', value: isLive ? `${mA.toFixed(1)}mA`       : '—', color: '#3b82f6' },
                  { label: 'P', value: isLive ? `${power_mW.toFixed(1)}mW` : '—', color: '#a855f7' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex flex-col items-center">
                    <span className="text-[8px] font-semibold uppercase tracking-widest" style={{ color }}>
                      {label}
                    </span>
                    <span className={clsx(
                      'text-[11px] font-mono font-bold tabular-nums',
                      isLive ? 'text-[var(--fg)]' : 'text-[var(--fg-faint)]',
                    )}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>

              {!isLive && (
                <div className="px-1.5 pb-1 text-[9px] text-[var(--fg-faint)] italic">
                  Run sim to see live values
                </div>
              )}
            </div>
          )
        })}

        {/* Clear all */}
        <button
          onClick={() => setProbes([])}
          className="w-full mt-1 py-0.5 text-[9px] text-[var(--fg-faint)] hover:text-[var(--err)] border border-[var(--border)] rounded bg-transparent cursor-pointer transition-colors"
        >
          Clear all probes
        </button>
      </div>
    </div>
  )
}
