'use client'
import { Trash2, X } from 'lucide-react'
import type { PlacedComponent, TsukiCircuit } from '../SandboxDefs'

interface Props {
  selComp: PlacedComponent
  setCircuit: (fn: (c: TsukiCircuit) => TsukiCircuit) => void
  onDelete: () => void
  onClose: () => void
}

export default function PropertiesPanel({ selComp, setCircuit, onDelete, onClose }: Props) {
  function updateComp(patch: Partial<PlacedComponent>) {
    setCircuit(c => ({
      ...c,
      components: c.components.map(co =>
        co.id === selComp.id ? { ...co, ...patch } : co,
      ),
    }))
  }

  function updateProp(key: string, value: string | number) {
    setCircuit(c => ({
      ...c,
      components: c.components.map(co =>
        co.id === selComp.id ? { ...co, props: { ...co.props, [key]: value } } : co,
      ),
    }))
  }

  return (
    <div className="w-40 border-l border-[var(--border)] flex-shrink-0 bg-[var(--surface-1)] overflow-y-auto">
      {/* Header */}
      <div className="px-2 py-1.5 border-b border-[var(--border)] flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-faint)]">
          Properties
        </span>
        <button
          onClick={onClose}
          className="w-4 h-4 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer"
        >
          <X size={9} />
        </button>
      </div>

      {/* Fields */}
      <div className="p-2 flex flex-col gap-2">
        {/* Label */}
        <div>
          <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">Label</div>
          <input
            value={selComp.label}
            onChange={e => updateComp({ label: e.target.value })}
            className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-1.5 py-0.5 text-xs text-[var(--fg)] outline-none"
          />
        </div>

        {/* Color */}
        <div>
          <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">Color</div>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={selComp.color}
              onChange={e => updateComp({ color: e.target.value })}
              className="w-8 h-6 rounded border border-[var(--border)] cursor-pointer bg-transparent"
            />
            <span className="text-[10px] font-mono text-[var(--fg-faint)]">{selComp.color}</span>
          </div>
        </div>

        {/* Resistor-specific: ohms */}
        {selComp.type === 'resistor' && (
          <div>
            <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">Ohms</div>
            <input
              value={selComp.props.ohms ?? 1000}
              onChange={e => updateProp('ohms', Number(e.target.value))}
              type="number"
              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-1.5 py-0.5 text-xs text-[var(--fg)] outline-none"
            />
          </div>
        )}

        {/* Type (read-only) */}
        <div>
          <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">Type</div>
          <span className="text-[10px] font-mono text-[var(--fg-muted)]">{selComp.type}</span>
        </div>

        {/* Position (read-only) */}
        <div>
          <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">Position</div>
          <span className="text-[10px] font-mono text-[var(--fg-muted)]">
            {Math.round(selComp.x)}, {Math.round(selComp.y)}
          </span>
        </div>

        {/* Delete */}
        <button
          onClick={onDelete}
          className="mt-1 flex items-center justify-center gap-1 w-full py-1 rounded text-[10px] text-[var(--err)] hover:bg-[color-mix(in_srgb,var(--err)_8%,transparent)] border border-[color-mix(in_srgb,var(--err)_20%,transparent)] cursor-pointer bg-transparent transition-colors"
        >
          <Trash2 size={9} /> Delete
        </button>
      </div>
    </div>
  )
}
