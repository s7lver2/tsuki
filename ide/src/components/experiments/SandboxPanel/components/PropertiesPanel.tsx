'use client'
import { Trash2, X, Info } from 'lucide-react'
import type { PlacedComponent, TsukiCircuit } from '../SandboxDefs'
import { COMP_DEFS } from '../SandboxDefs'

interface Props {
  selComp: PlacedComponent
  setCircuit: (fn: (c: TsukiCircuit) => TsukiCircuit) => void
  onDelete: () => void
  onClose: () => void
}

export default function PropertiesPanel({ selComp, setCircuit, onDelete, onClose }: Props) {
  const def = COMP_DEFS[selComp.type]

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
    <div className="w-44 border-l border-[var(--border)] flex-shrink-0 bg-[var(--surface-1)] overflow-y-auto">
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

      <div className="p-2 flex flex-col gap-2.5">

        {/* Component type badge */}
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: selComp.color || def?.color || '#888' }} />
          <span className="text-[10px] font-semibold text-[var(--fg)] truncate">{def?.label ?? selComp.type}</span>
        </div>

        {/* Description */}
        {def?.description && (
          <div className="flex gap-1 items-start bg-[var(--surface-2)] rounded px-1.5 py-1">
            <Info size={8} className="text-[var(--fg-faint)] mt-0.5 flex-shrink-0" />
            <p className="text-[9px] text-[var(--fg-faint)] leading-relaxed">{def.description}</p>
          </div>
        )}

        {/* ── Common fields ── */}
        <div>
          <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">Label</div>
          <input
            value={selComp.label}
            onChange={e => updateComp({ label: e.target.value })}
            className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-1.5 py-0.5 text-xs text-[var(--fg)] outline-none"
          />
        </div>

        {/* ── Color (only for components that have meaningful color) ── */}
        {selComp.type === 'led' && (
          <div>
            <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">LED Color</div>
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={selComp.color || '#ef4444'}
                onChange={e => updateComp({ color: e.target.value })}
                className="w-8 h-6 rounded border border-[var(--border)] cursor-pointer bg-transparent"
              />
              <span className="text-[9px] font-mono text-[var(--fg-faint)]">{selComp.color}</span>
            </div>
          </div>
        )}

        {/* ── Resistor: ohms + color bands preview ── */}
        {selComp.type === 'resistor' && (
          <div>
            <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">Resistance (Ω)</div>
            <input
              value={selComp.props.ohms ?? 220}
              onChange={e => updateProp('ohms', Number(e.target.value))}
              type="number"
              min={1} step={1}
              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-1.5 py-0.5 text-xs text-[var(--fg)] outline-none"
            />
            <div className="text-[9px] text-[var(--fg-faint)] mt-1">
              {Number(selComp.props.ohms ?? 220) >= 1000
                ? `${(Number(selComp.props.ohms ?? 220) / 1000).toFixed(Number(selComp.props.ohms ?? 220) % 1000 === 0 ? 0 : 1)}kΩ`
                : `${selComp.props.ohms ?? 220}Ω`
              }
              {' · '}I≈{(3000 / Number(selComp.props.ohms ?? 220)).toFixed(1)}mA @ 5V
            </div>
          </div>
        )}

        {/* ── Servo: angle range ── */}
        {selComp.type === 'servo' && (
          <div>
            <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">Control</div>
            <div className="text-[9px] text-[var(--fg-faint)] leading-relaxed">
              Connect signal pin to a PWM-capable Arduino pin (3, 5, 6, 9, 10, 11).
              Use <span className="font-mono">servo.Write(angle)</span> with 0–180°.
            </div>
          </div>
        )}

        {/* ── Seven-Segment: wiring hint ── */}
        {selComp.type === 'seven_seg' && (
          <div>
            <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">Wiring</div>
            <div className="text-[9px] text-[var(--fg-faint)] leading-relaxed">
              Wire segments a–g + dp to digital outputs. Connect CC to GND.
              Drive HIGH to light each segment.
            </div>
          </div>
        )}

        {/* ── Button: pull-down hint ── */}
        {selComp.type === 'button' && (
          <div>
            <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">Wiring</div>
            <div className="text-[9px] text-[var(--fg-faint)] leading-relaxed">
              Wire pin1→Arduino digital pin. Wire pin3→GND (or use INPUT_PULLUP). Press injects HIGH; release injects LOW.
            </div>
          </div>
        )}

        {/* ── Relay: load hint ── */}
        {selComp.type === 'relay' && (
          <div>
            <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">Switching</div>
            <div className="text-[9px] text-[var(--fg-faint)] leading-relaxed">
              IN HIGH → COM connects to NO (load on).
              IN LOW → COM connects to NC (load off by default).
            </div>
          </div>
        )}

        {/* ── VCC / GND / Power rail: info ── */}
        {(selComp.type === 'vcc_node' || selComp.type === 'power_rail') && (
          <div>
            <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">Power</div>
            <div className="text-[9px] text-[var(--fg-faint)] leading-relaxed">
              Always-on 5V source. Wire to VCC/power pins of components. No MCU required for passive circuits.
            </div>
          </div>
        )}

        {/* ── RGB LED: wiring hint ── */}
        {selComp.type === 'led_rgb' && (
          <div>
            <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-0.5">Wiring</div>
            <div className="text-[9px] text-[var(--fg-faint)] leading-relaxed">
              Connect R/G/B pins to PWM pins. Connect cathode to GND.
              Use <span className="font-mono">analogWrite</span> (0–255) for each channel.
            </div>
          </div>
        )}

        {/* ── Pin summary ── */}
        {def && def.pins.length <= 8 && (
          <div>
            <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-widest mb-1">Pins</div>
            <div className="flex flex-col gap-0.5">
              {def.pins.map(pin => (
                <div key={pin.id} className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: pin.type === 'power' ? '#ef4444' : pin.type === 'gnd' ? '#6b7280' : pin.type === 'digital' ? '#3b82f6' : pin.type === 'analog' ? '#a855f7' : pin.type === 'pwm' ? '#f97316' : '#8b8b8b' }} />
                  <span className="text-[9px] font-mono text-[var(--fg-muted)] flex-1 truncate">{pin.label}</span>
                  <span className="text-[8px] text-[var(--fg-faint)] uppercase">{pin.direction ?? ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Position */}
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