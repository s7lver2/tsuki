import { useState, useEffect } from 'react'
import { useStore } from '@/lib/store'
import {
  type TsukiCircuit,
  DEFAULT_CIRCUIT,
  COMP_DEFS,
  textToCircuit,
  type PlacedComponent,
} from '../SandboxDefs'

export function useCircuit(initialBoard: string) {
  const {
    sandboxCircuit,
    setSandboxCircuit,
    pendingCircuit,
    clearPendingCircuit,
  } = useStore()

  const [circuit, setCircuit] = useState<TsukiCircuit>(() => {
    if (sandboxCircuit && (sandboxCircuit as any).components) {
      return { ...DEFAULT_CIRCUIT, ...(sandboxCircuit as any) }
    }
    return { ...DEFAULT_CIRCUIT, board: initialBoard || 'uno' }
  })

  // Persist circuit to store whenever it changes
  useEffect(() => {
    setSandboxCircuit(circuit as unknown as Record<string, unknown>)
  }, [circuit]) // eslint-disable-line

  // Consume pendingCircuit loaded via Examples panel
  useEffect(() => {
    if (!pendingCircuit) return
    const parsed = textToCircuit(JSON.stringify(pendingCircuit.data))
    if (parsed) setCircuit(parsed)
    clearPendingCircuit()
  }, [pendingCircuit?.id]) // eslint-disable-line

  /** Add a component of the given type, centering it in the SVG viewport */
  function addComponent(
    type: string,
    viewportW: number,
    viewportH: number,
    pan: { x: number; y: number },
    zoom: number,
  ) {
    const def = COMP_DEFS[type]
    if (!def) return
    const id = `${type}_${Date.now()}`
    const cx = (viewportW / 2 - pan.x) / zoom - def.w / 2
    const cy = (viewportH / 2 - pan.y) / zoom - def.h / 2
    const comp: PlacedComponent = {
      id, type,
      label: def.label + (circuit.components.filter(c => c.type === type).length + 1),
      x: cx, y: cy, rotation: 0,
      color: def.color,
      props: {},
    }
    setCircuit(c => ({ ...c, components: [...c.components, comp] }))
    return id
  }

  /** Delete a component and all wires connected to it */
  function deleteComponent(compId: string) {
    setCircuit(c => ({
      ...c,
      components: c.components.filter(co => co.id !== compId),
      wires: c.wires.filter(w => w.fromComp !== compId && w.toComp !== compId),
    }))
  }

  return { circuit, setCircuit, addComponent, deleteComponent }
}
