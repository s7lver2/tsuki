'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Trash2, ZoomIn, ZoomOut, MousePointer, Zap, Gauge, Cpu, FlaskConical, Maximize2,
  Tag, Ruler, Activity,
} from 'lucide-react'
import { clsx } from 'clsx'
import {
  type TsukiCircuit,
  type PlacedComponent,
  type CircuitWire,
  type Tool,
  type WireInProgress,
  type WireProbe,
  type WireStyleId,
  type VoltmeterPin,
  type AmmeterWire,
  type CanvasLabel,
  type RulerMeasure,
  COMP_DEFS,
  WIRE_COLOR_HEX,
  WIRE_PALETTES,
  getPinAbsPos,
  makeOrthogonalPath,
  makeWirePath,
  snapGrid,
  getWireMeasurements,
} from '../SandboxDefs'
import { CompShape, SvgGlobalDefs } from '../SandboxShapes'
import PropertiesPanel from '../components/PropertiesPanel'
import MeasurementsPanel from '../components/MeasurementsPanel'
import type { SimStatus } from '../hooks/useSimRunner'
import { useStore } from '@/lib/store'

// ── Category list ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'mcu',      label: 'MCUs'      },
  { id: 'output',   label: 'Output'    },
  { id: 'input',    label: 'Input'     },
  { id: 'passive',  label: 'Passive'   },
  { id: 'sensor',   label: 'Sensors'   },
  { id: 'actuator', label: 'Actuators' },
  { id: 'display',  label: 'Displays'  },
  { id: 'power',    label: 'Power'     },
]

// ── Props ──────────────────────────────────────────────────────────────────────

interface CanvasViewProps {
  circuit: TsukiCircuit
  setCircuit: React.Dispatch<React.SetStateAction<TsukiCircuit>>
  simPinValues: Record<string, number>
  simStatus: SimStatus
  pressedComps: Set<string>
  toggledComps: Record<string, boolean>
  probes: WireProbe[]
  setProbes: React.Dispatch<React.SetStateAction<WireProbe[]>>
  onButtonPress: (compId: string) => void
  onButtonRelease: (compId: string) => void
  onSwitchToggle: (compId: string) => void
  /** Called when the user enables "Simulate Webkit" on an ESP board */
  onWebkitSimulate?: (boardId: string | null) => void
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function CanvasView({
  circuit, setCircuit,
  simPinValues, simStatus,
  pressedComps, toggledComps,
  probes, setProbes,
  onButtonPress, onButtonRelease, onSwitchToggle,
  onWebkitSimulate,
}: CanvasViewProps) {

  // ── Local state ────────────────────────────────────────────────────────────
  const { settings } = useStore()

  // ── Resolve active wire palette ───────────────────────────────────────────
  const activePalette = (() => {
    const p = settings.sandboxWirePalette ?? 'classic'
    if (p === 'custom') return settings.sandboxWireCustomColors ?? WIRE_PALETTES.classic.colors
    return WIRE_PALETTES[p]?.colors ?? WIRE_PALETTES.classic.colors
  })()

  const wireStyle = (settings.sandboxWireStyle ?? 'orthogonal') as WireStyleId

  // Determine auto-color for a pin based on its type (VCC / GND)
  function autoColorForPin(compId: string, pinId: string): string | null {
    const comp = circuit.components.find(c => c.id === compId)
    if (!comp) return null
    const def  = COMP_DEFS[comp.type]
    const pin  = def?.pins.find(p => p.id === pinId)
    if (!pin) return null
    if (settings.sandboxAutoColorVcc && (pin.type === 'power' || pinId === 'vcc' || pinId === '5v' || pinId === '3v3' || pinId === 'vdd'))
      return settings.sandboxVccColor ?? '#ef4444'
    if (settings.sandboxAutoColorGnd && (pin.type === 'gnd' || pinId === 'gnd' || pinId === 'neg'))
      return settings.sandboxGndColor ?? '#1a1a1a'
    return null
  }

  const [tool, setTool]               = useState<Tool>('select')
  const [wireColor, setWireColor]     = useState(activePalette[4] ?? '#3b82f6')
  const [zoom, setZoom]               = useState(1)
  const [pan, setPan]                 = useState({ x: 40, y: 40 })
  const [selectedId, setSelectedId]   = useState<string | null>(null)
  const [selectedComp, setSelectedComp] = useState<string | null>(null)
  const [wip, setWip]                 = useState<WireInProgress | null>(null)
  const [dragging, setDragging]       = useState<{ id: string; ox: number; oy: number } | null>(null)
  const [panning, setPanning]         = useState<{ sx: number; sy: number; px: number; py: number } | null>(null)
  const [hoveredWireId, setHoveredWireId] = useState<string | null>(null)
  const [showMeasurements, setShowMeasurements] = useState(false)

  // ── tsuki-webkit context menu ───────────────────────────────────────────────
  const [webkitCtxMenu, setWebkitCtxMenu] = useState<{
    comp: PlacedComponent; x: number; y: number
  } | null>(null)
  const [webkitActiveBoard, setWebkitActiveBoard] = useState<string | null>(null)

  const ESP_TYPES = new Set(['esp8266', 'esp32', 'esp32s2', 'esp32s3', 'esp32c3', 'nodemcu', 'wemos_d1'])
  const isEspBoard = (comp: PlacedComponent) => {
    const t = comp.type.toLowerCase().replace(/[^a-z0-9_]/g, '')
    return ESP_TYPES.has(t) || t.includes('esp')
  }

  function handleCompContextMenu(e: React.MouseEvent, comp: PlacedComponent) {
    if (!isEspBoard(comp)) return
    e.preventDefault()
    e.stopPropagation()
    setWebkitCtxMenu({ comp, x: e.clientX, y: e.clientY })
  }

  function handleWebkitToggle(compId: string, enabled: boolean) {
    const next = enabled ? compId : null
    setWebkitActiveBoard(next)
    onWebkitSimulate?.(next)
    setWebkitCtxMenu(null)
  }

  // ── New canvas tool overlay state ──────────────────────────────────────────
  const [voltmeters, setVoltmeters]   = useState<VoltmeterPin[]>([])
  const [ammeters, setAmmeters]       = useState<AmmeterWire[]>([])
  const [labels, setLabels]           = useState<CanvasLabel[]>([])
  const [rulers, setRulers]           = useState<RulerMeasure[]>([])
  // Ruler in-progress: first click sets start, second completes
  const [rulerWip, setRulerWip]       = useState<{ x1: number; y1: number } | null>(null)
  // Editing a label
  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const spaceDownRef = useRef(false)   // space = pan-override key

  const svgRef = useRef<SVGSVGElement>(null)

  const wipRef = useRef(wip)
  wipRef.current = wip

  // ── Space key: hold to pan regardless of what's under the cursor ──────────
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault()
        spaceDownRef.current = true
      }
      if (e.key === 'Escape') setWip(null)
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDownRef.current = false
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup',   onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup',   onUp)
    }
  }, [])

  // ── Fit-all: zoom + pan to show all components ────────────────────────────
  const fitAll = useCallback(() => {
    if (!svgRef.current || circuit.components.length === 0) return
    const MARGIN = 40
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const comp of circuit.components) {
      const def = COMP_DEFS[comp.type]
      if (!def) continue
      minX = Math.min(minX, comp.x - 10)
      minY = Math.min(minY, comp.y - 10)
      maxX = Math.max(maxX, comp.x + def.w + 10)
      maxY = Math.max(maxY, comp.y + def.h + 30)  // +30 for label
    }
    const svgW = svgRef.current.clientWidth  || 600
    const svgH = svgRef.current.clientHeight || 400
    const contentW = maxX - minX
    const contentH = maxY - minY
    const newZoom = Math.min(2.5, Math.max(0.15,
      Math.min((svgW - MARGIN * 2) / contentW, (svgH - MARGIN * 2) / contentH)
    ))
    const newPanX = (svgW  - contentW * newZoom) / 2 - minX * newZoom
    const newPanY = (svgH - contentH * newZoom) / 2 - minY * newZoom
    setZoom(newZoom)
    setPan({ x: newPanX, y: newPanY })
  }, [circuit.components])

  // ── Canvas helpers ─────────────────────────────────────────────────────────

  function svgPoint(e: React.PointerEvent | React.MouseEvent) {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left - pan.x) / zoom,
      y: (e.clientY - rect.top  - pan.y) / zoom,
    }
  }

  function addComponent(type: string) {
    const def = COMP_DEFS[type]
    if (!def) return
    const id = `${type}_${Date.now()}`
    const canvasW = svgRef.current?.clientWidth  ?? 600
    const canvasH = svgRef.current?.clientHeight ?? 400
    const cx = (canvasW / 2 - pan.x) / zoom - def.w / 2
    const cy = (canvasH / 2 - pan.y) / zoom - def.h / 2
    const comp: PlacedComponent = {
      id, type,
      label: def.label + (circuit.components.filter(c => c.type === type).length + 1),
      x: cx, y: cy, rotation: 0,
      color: def.color,
      props: {},
    }
    setCircuit(c => ({ ...c, components: [...c.components, comp] }))
    setSelectedComp(id)
  }

  function deleteSelected() {
    if (!selectedComp) return
    setCircuit(c => ({
      ...c,
      components: c.components.filter(co => co.id !== selectedComp),
      wires:      c.wires.filter(w => w.fromComp !== selectedComp && w.toComp !== selectedComp),
    }))
    setSelectedComp(null)
  }

  // ── Pointer handlers ───────────────────────────────────────────────────────

  function startPan(e: React.PointerEvent) {
    setPanning({ sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y })
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  /** Returns true if this click should start a pan (middle btn, alt, or space) */
  function isPanTrigger(e: React.PointerEvent) {
    return e.button === 1 || (e.button === 0 && (e.altKey || spaceDownRef.current))
  }

  function isBackgroundTarget(e: React.PointerEvent) {
    const el = e.target as SVGElement
    // Background rect has fill url(#sbgrid) — check with startsWith to handle
    // browsers that resolve to full URL (url("http://...#sbgrid"))
    const fill = el.getAttribute('fill') ?? ''
    return el.tagName === 'rect' && (fill === 'url(#sbgrid)' || fill.includes('#sbgrid'))
  }

  function onSvgPointerDown(e: React.PointerEvent) {
    // Pan: middle button, alt+left, or space+left — anywhere on canvas
    if (isPanTrigger(e)) {
      startPan(e)
      return
    }
    // Wire mode: click on background to add waypoint
    if (tool === 'wire' && wip && e.button === 0) {
      if (isBackgroundTarget(e)) {
        const pt = svgPoint(e)
        setWip(w => w ? { ...w,
          waypoints: [...w.waypoints, { x: snapGrid(pt.x), y: snapGrid(pt.y) }],
          mouseX: snapGrid(pt.x), mouseY: snapGrid(pt.y),
        } : null)
        return
      }
    }
    // Left-click on background → pan (select tool) or deselect
    if (e.button === 0 && isBackgroundTarget(e)) {
      if (tool !== 'wire') {
        startPan(e)
      }
      if (tool === 'select') { setSelectedComp(null); setWip(null) }
      return
    }
    if (tool === 'select') { setSelectedComp(null); setWip(null) }
  }

  function onSvgPointerMove(e: React.PointerEvent) {
    if (panning) {
      setPan({ x: panning.px + e.clientX - panning.sx, y: panning.py + e.clientY - panning.sy })
      return
    }
    if (dragging) {
      const { x, y } = svgPoint(e)
      setCircuit(c => ({
        ...c,
        components: c.components.map(co =>
          co.id === dragging.id ? { ...co, x: x - dragging.ox, y: y - dragging.oy } : co,
        ),
      }))
    }
    if (wip) {
      const { x, y } = svgPoint(e)
      setWip(w => w ? { ...w, mouseX: snapGrid(x), mouseY: snapGrid(y) } : null)
    }
  }

  function onSvgPointerUp() {
    setPanning(null)
    setDragging(null)
  }

  function onCompPointerDown(e: React.PointerEvent, compId: string) {
    // Space/alt/middle → pan, even over components
    if (isPanTrigger(e)) {
      startPan(e)
      return
    }
    if (tool === 'delete') {
      e.stopPropagation()
      setCircuit(c => ({
        ...c,
        components: c.components.filter(co => co.id !== compId),
        wires:      c.wires.filter(w => w.fromComp !== compId && w.toComp !== compId),
      }))
      return
    }
    if (tool === 'select') {
      e.stopPropagation()
      setSelectedComp(compId)
      const comp = circuit.components.find(c => c.id === compId)!
      const pt = svgPoint(e)
      setDragging({ id: compId, ox: pt.x - comp.x, oy: pt.y - comp.y })
    }
  }

  function onPinClick(compId: string, pinId: string) {
    if (tool !== 'wire') return
    const comp = circuit.components.find(c => c.id === compId)!
    const def  = COMP_DEFS[comp.type]
    const pin  = def.pins.find(p => p.id === pinId)!
    const pos  = getPinAbsPos(comp, pin)

    if (!wip) {
      // Determine color: auto-color from pin type > current wireColor
      const ac = autoColorForPin(compId, pinId)
      setWip({ fromComp: compId, fromPin: pinId, fromX: pos.x, fromY: pos.y, mouseX: pos.x, mouseY: pos.y, color: ac ?? wireColor, waypoints: [] })
    } else {
      if (wip.fromComp === compId && wip.fromPin === pinId) { setWip(null); return }
      // Auto-color: check both endpoints, prefer from > to
      const acFrom = autoColorForPin(wip.fromComp, wip.fromPin)
      const acTo   = autoColorForPin(compId, pinId)
      const finalColor = acFrom ?? acTo ?? wip.color
      const wire: CircuitWire = {
        id: `wire_${Date.now()}`,
        fromComp: wip.fromComp, fromPin: wip.fromPin,
        toComp: compId,         toPin: pinId,
        color: finalColor,
        waypoints: wip.waypoints,
      }
      setCircuit(c => ({ ...c, wires: [...c.wires, wire] }))
      setWip(null)
    }
  }

  function onWireClick(wireId: string) {
    if (tool === 'delete') {
      setCircuit(c => ({ ...c, wires: c.wires.filter(w => w.id !== wireId) }))
      return
    }
    if (tool === 'probe') {
      const wire     = circuit.wires.find(w => w.id === wireId)
      if (!wire) return
      const existing = probes.find(p => p.wireId === wireId)
      if (existing) {
        setProbes(ps => ps.filter(p => p.wireId !== wireId))
      } else {
        const fromComp = circuit.components.find(c => c.id === wire.fromComp)
        const toComp   = circuit.components.find(c => c.id === wire.toComp)
        const label    = `${fromComp?.label ?? wire.fromComp}.${wire.fromPin} → ${toComp?.label ?? wire.toComp}.${wire.toPin}`
        setProbes(ps => [...ps, { id: `probe_${Date.now()}`, wireId, label }])
        setShowMeasurements(true)
      }
      return
    }
    setSelectedId(wireId)
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const selComp = selectedComp ? circuit.components.find(c => c.id === selectedComp) ?? null : null
  const isSpacePan = spaceDownRef.current

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 overflow-hidden">

      {/* ── Component palette ── */}
      <div className="w-36 border-r border-[var(--border)] flex-shrink-0 overflow-y-auto bg-[var(--surface-1)]">

        {/* Tools */}
        <div className="px-2 py-1.5 border-b border-[var(--border)] flex flex-col gap-1">
          <div className="flex gap-1">
            {([
              { id: 'select', icon: <MousePointer size={11} />, title: 'Select / Move' },
              { id: 'wire',   icon: <Zap size={11} />,          title: 'Draw Wire' },
              { id: 'delete', icon: <Trash2 size={11} />,       title: 'Delete' },
              { id: 'probe',  icon: <Gauge size={11} />,        title: 'Probe wire' },
            ] as const).map(t => (
              <button
                key={t.id} title={t.title} onClick={() => setTool(t.id)}
                className={clsx(
                  'flex-1 h-6 flex items-center justify-center rounded border-0 cursor-pointer transition-colors',
                  tool === t.id
                    ? 'bg-[var(--active)] text-[var(--fg)]'
                    : 'bg-transparent text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
                )}
              >
                {t.icon}
              </button>
            ))}
          </div>

          {/* Measurements toggle */}
          {probes.length > 0 && (
            <button
              onClick={() => setShowMeasurements(m => !m)}
              className={clsx(
                'w-full flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border-0 cursor-pointer transition-colors',
                showMeasurements
                  ? 'bg-[var(--active)] text-[var(--fg)]'
                  : 'bg-transparent text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
              )}
            >
              <FlaskConical size={9} /> Measurements ({probes.length})
            </button>
          )}

          {/* Wire color picker */}
          {tool === 'wire' && (
            <div className="flex flex-wrap gap-0.5 px-0.5">
              {activePalette.map(c => (
                <button
                  key={c} onClick={() => setWireColor(c)} title={c}
                  className="w-4 h-4 rounded-full border-0 cursor-pointer flex-shrink-0 transition-transform hover:scale-110"
                  style={{
                    background: c,
                    outline: c === wireColor ? '2px solid var(--fg)' : '1px solid transparent',
                    outlineOffset: '1px',
                  }}
                />
              ))}
            </div>
          )}

          {/* Hints */}
          {tool === 'wire' && wip && (
            <div className="text-[9px] text-[var(--fg-faint)] px-0.5 leading-tight">
              Click canvas to add bend · click pin to finish · ESC cancel
            </div>
          )}
          {tool === 'probe' && (
            <div className="text-[9px] text-[var(--fg-faint)] px-0.5 leading-tight">
              Click a wire to add/remove a probe
            </div>
          )}

          {/* Zoom + fit */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setZoom(z => Math.max(0.3, z - 0.1))}
              title="Zoom out"
              className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer"
            >
              <ZoomOut size={10} />
            </button>
            <span className="flex-1 text-center text-[10px] text-[var(--fg-faint)] font-mono">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(z => Math.min(2.5, z + 0.1))}
              title="Zoom in"
              className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer"
            >
              <ZoomIn size={10} />
            </button>
            <button
              onClick={fitAll}
              title="Fit all components"
              className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer"
            >
              <Maximize2 size={10} />
            </button>
          </div>

          {/* Pan hint */}
          <div className="text-[9px] text-[var(--fg-faint)] px-0.5 leading-tight opacity-60">
            Space / Alt + drag: pan · scroll: zoom
          </div>
        </div>

        {/* Component library */}
        <div className="py-1">
          {CATEGORIES.map(cat => {
            const items = Object.values(COMP_DEFS).filter(d => d.category === cat.id && !d.hidden)
            if (!items.length) return null
            return (
              <div key={cat.id}>
                <div className="px-2 py-1 mt-1">
                  <span className="text-[9px] font-semibold uppercase tracking-widest text-[var(--fg-faint)]">
                    {cat.label}
                  </span>
                </div>
                {items.map(def => (
                  <button
                    key={def.type} onClick={() => addComponent(def.type)}
                    className="w-full flex items-center gap-2 px-2.5 py-1 text-[11px] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer border-0 bg-transparent text-left"
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: def.color }} />
                    {def.label}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── SVG Canvas ── */}
      <div className="flex-1 overflow-hidden relative bg-[var(--surface)]">
        <svg
          ref={svgRef}
          className="w-full h-full"
          style={{
            background: 'var(--surface)',
            cursor: panning
              ? 'grabbing'
              : isSpacePan
                ? 'grab'
                : tool === 'wire' ? 'crosshair'
                : tool === 'delete' ? 'not-allowed'
                : tool === 'probe' ? 'cell'
                : 'default',
          }}
          onPointerDown={onSvgPointerDown}
          onPointerMove={onSvgPointerMove}
          onPointerUp={onSvgPointerUp}
          onWheel={e => {
            e.preventDefault()
            const svgRect = svgRef.current!.getBoundingClientRect()
            const mx = e.clientX - svgRect.left
            const my = e.clientY - svgRect.top
            const factor = e.deltaY < 0 ? 1.08 : 0.93
            const newZoom = Math.max(0.15, Math.min(2.5, zoom * factor))
            // Zoom toward cursor
            setPan(p => ({
              x: mx - (mx - p.x) * (newZoom / zoom),
              y: my - (my - p.y) * (newZoom / zoom),
            }))
            setZoom(newZoom)
          }}
          tabIndex={0}
        >
          <defs>
            <pattern
              id="sbgrid"
              x={pan.x % (20 * zoom)} y={pan.y % (20 * zoom)}
              width={20 * zoom} height={20 * zoom}
              patternUnits="userSpaceOnUse"
            >
              <circle cx={0} cy={0} r={0.8} fill="var(--border)" opacity={0.5} />
            </pattern>
          </defs>
          <SvgGlobalDefs />
          <rect width="100%" height="100%" fill="url(#sbgrid)" />

          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>

            {/* ── Components ── */}
            {circuit.components.map(comp => {
              const def = COMP_DEFS[comp.type]
              if (!def) return null
              const isSwitch = comp.type === 'slide_switch'
              const augComp  = isSwitch
                ? { ...comp, props: { ...comp.props, toggled: toggledComps[comp.id] ? 1 : 0 } }
                : comp
              return (
                <CompShape
                  key={comp.id}
                  comp={augComp}
                  selected={selectedComp === comp.id}
                  simPinValues={simPinValues}
                  wireMode={tool === 'wire'}
                  pressed={pressedComps.has(comp.id)}
                  onInteractStart={() => {
                    if (comp.type === 'button')           onButtonPress(comp.id)
                    else if (comp.type === 'slide_switch') onSwitchToggle(comp.id)
                  }}
                  onInteractEnd={() => {
                    if (comp.type === 'button') onButtonRelease(comp.id)
                  }}
                  onPointerDown={e => onCompPointerDown(e, comp.id)}
                  onPinClick={pinId => onPinClick(comp.id, pinId)}
                  onContextMenu={isEspBoard(comp) ? (e: React.MouseEvent) => handleCompContextMenu(e, comp) : undefined}
                />
              )
            })}

            {/* ── Wires ── */}
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
              const d    = makeWirePath(fa.x, fa.y, ta.x, ta.y, wire.waypoints, wireStyle)
              const isSelected = selectedId === wire.id
              const isHovered  = hoveredWireId === wire.id
              const isProbed   = probes.some(p => p.wireId === wire.id)
              return (
                <g key={wire.id}>
                  <path
                    d={d} stroke="transparent" strokeWidth={12} fill="none"
                    style={{ cursor: tool === 'delete' ? 'not-allowed' : tool === 'probe' ? 'cell' : 'pointer' }}
                    onClick={() => onWireClick(wire.id)}
                    onMouseEnter={() => setHoveredWireId(wire.id)}
                    onMouseLeave={() => setHoveredWireId(null)}
                  />
                  {isProbed && (
                    <path d={d} stroke="#facc15" strokeWidth={5} fill="none" strokeLinecap="round" opacity={0.25} />
                  )}
                  <path
                    d={d}
                    stroke={wire.color || '#3b82f6'}
                    strokeWidth={isSelected || isHovered ? 2.8 : 2}
                    fill="none" strokeLinecap={wireStyle === 'orthogonal' ? 'square' : 'round'}
                    opacity={isSelected || isHovered ? 1 : 0.9}
                  />
                  {(isSelected || isHovered) && (
                    <path d={d} stroke="rgba(255,255,255,0.25)" strokeWidth={1} fill="none" strokeLinecap={wireStyle === 'orthogonal' ? 'square' : 'round'} strokeDasharray="4 4" />
                  )}
                  {isProbed && (() => {
                    const mx = (fa.x + ta.x) / 2
                    const my = (fa.y + ta.y) / 2
                    return (
                      <g>
                        <circle cx={mx} cy={my} r={5} fill="#facc15" />
                        <text x={mx} y={my + 3.5} textAnchor="middle" fontSize={6} fill="#000" fontWeight="700">⚡</text>
                      </g>
                    )
                  })()}
                  {isSelected && wire.waypoints.map((wp, i) => (
                    <circle key={i} cx={wp.x} cy={wp.y} r={3}
                      fill="var(--surface)" stroke={wire.color || '#3b82f6'} strokeWidth={1.5} />
                  ))}
                </g>
              )
            })}

            {/* ── Wire in progress ── */}
            {wip && (
              <g>
                <path
                  d={makeWirePath(wip.fromX, wip.fromY, wip.mouseX, wip.mouseY, wip.waypoints, wireStyle)}
                  stroke={wip.color} strokeWidth={2} fill="none"
                  strokeDasharray="6 3" strokeLinecap="round" opacity={0.8}
                />
                {wip.waypoints.map((wp, i) => (
                  <g key={i}>
                    <circle cx={wp.x} cy={wp.y} r={4} fill={wip.color} opacity={0.7} />
                    <circle cx={wp.x} cy={wp.y} r={2} fill="white" opacity={0.9} />
                  </g>
                ))}
                <circle cx={wip.mouseX} cy={wip.mouseY} r={3} fill="none" stroke={wip.color} strokeWidth={1.5} opacity={0.8} />
                <line x1={wip.mouseX - 6} y1={wip.mouseY} x2={wip.mouseX + 6} y2={wip.mouseY} stroke={wip.color} strokeWidth={1} opacity={0.6} />
                <line x1={wip.mouseX} y1={wip.mouseY - 6} x2={wip.mouseX} y2={wip.mouseY + 6} stroke={wip.color} strokeWidth={1} opacity={0.6} />
              </g>
            )}

          </g>
        </svg>

        {/* Empty state */}
        {circuit.components.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
            <Cpu size={28} className="text-[var(--fg-faint)]" />
            <p className="text-xs text-[var(--fg-faint)]">Add components from the palette</p>
            <p className="text-[10px] text-[var(--fg-faint)]">or import a .tsuki-circuit file</p>
          </div>
        )}

        {/* Status bar */}
        <div className="absolute bottom-0 left-0 right-0 h-5 flex items-center px-2 gap-3 bg-[var(--surface-1)] border-t border-[var(--border)] text-[10px] text-[var(--fg-faint)] font-mono">
          <span>{circuit.components.length} comp</span>
          <span>{circuit.wires.length} wires</span>
          <span className="flex-1" />
          <button
            onClick={fitAll}
            className="text-[9px] text-[var(--fg-faint)] hover:text-[var(--fg)] bg-transparent border-0 cursor-pointer px-1"
            title="Fit all"
          >
            fit ⊞
          </button>
          <span className="opacity-50">Space/alt+drag: pan · scroll: zoom</span>
        </div>
      </div>

      {/* ── Properties panel ── */}
      {selComp && (
        <PropertiesPanel
          selComp={selComp}
          setCircuit={setCircuit}
          onDelete={deleteSelected}
          onClose={() => setSelectedComp(null)}
        />
      )}

      {/* ── Measurements panel ── */}
      {showMeasurements && probes.length > 0 && (
        <MeasurementsPanel
          probes={probes}
          setProbes={setProbes}
          simStatus={simStatus}
          simPinValues={simPinValues}
          circuit={circuit}
          onClose={() => setShowMeasurements(false)}
        />
      )}

      {/* ── tsuki-webkit context menu (ESP boards) ── */}
      {webkitCtxMenu && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setWebkitCtxMenu(null)}
          />
          {/* Menu */}
          <div
            className="fixed z-50 rounded-lg overflow-hidden shadow-2xl"
            style={{
              left: webkitCtxMenu.x,
              top:  webkitCtxMenu.y,
              background:   'var(--surface-1)',
              border:       '1px solid var(--border)',
              minWidth:     220,
              boxShadow:    '0 12px 32px rgba(0,0,0,0.5)',
            }}
          >
            {/* Header */}
            <div className="px-3 py-2 border-b flex items-center gap-2"
                 style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
              <span className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}>
                {webkitCtxMenu.comp.label}
              </span>
              <span className="text-[10px] px-1.5 rounded"
                    style={{ background: '#003a20', color: '#00e5b0' }}>
                ESP
              </span>
            </div>

            {/* Simulate Webkit toggle */}
            <button
              className="w-full flex items-center justify-between px-3 py-2.5 text-left text-xs transition-colors"
              style={{
                background:   'transparent',
                border:       'none',
                color:        'var(--text)',
                cursor:       'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              onClick={() => handleWebkitToggle(
                webkitCtxMenu.comp.id,
                webkitActiveBoard !== webkitCtxMenu.comp.id,
              )}
            >
              <div className="flex items-center gap-2">
                <span style={{ color: '#00e5b0' }}>◈</span>
                <div>
                  <div className="font-medium">Simulate Webkit</div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Enable live JSX preview in the Webkit panel
                  </div>
                </div>
              </div>
              {/* Toggle indicator */}
              <div
                className="w-7 h-4 rounded-full flex items-center px-0.5 transition-colors shrink-0"
                style={{
                  background: webkitActiveBoard === webkitCtxMenu.comp.id
                    ? '#00e5b0' : 'var(--surface-3, #2a2a2a)',
                }}
              >
                <div
                  className="w-3 h-3 rounded-full transition-transform"
                  style={{
                    background: '#fff',
                    transform: webkitActiveBoard === webkitCtxMenu.comp.id
                      ? 'translateX(12px)' : 'translateX(0)',
                  }}
                />
              </div>
            </button>

            {/* Separator */}
            <div style={{ height: 1, background: 'var(--border)' }} />

            {/* Close */}
            <button
              className="w-full px-3 py-2 text-left text-xs transition-colors"
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--text-muted)', cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              onClick={() => setWebkitCtxMenu(null)}
            >
              Dismiss
            </button>
          </div>
        </>
      )}
    </div>
  )
}