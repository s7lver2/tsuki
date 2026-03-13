'use client'
import { useState, useEffect } from 'react'
import { FileText, AlertCircle, CheckCircle2 } from 'lucide-react'
import { type TsukiCircuit, circuitToText, textToCircuit } from '../SandboxDefs'

interface Props {
  circuit: TsukiCircuit
  setCircuit: (c: TsukiCircuit) => void
  onApplied: () => void   // called after a successful Apply (switches back to canvas)
}

export default function TextView({ circuit, setCircuit, onApplied }: Props) {
  const [draft, setDraft]     = useState(() => circuitToText(circuit))
  const [error, setError]     = useState('')

  // Re-sync draft when the view becomes active
  useEffect(() => { setDraft(circuitToText(circuit)) }, []) // eslint-disable-line

  function apply() {
    const parsed = textToCircuit(draft)
    if (!parsed) { setError('Invalid .tsuki-circuit JSON'); return }
    setError('')
    setCircuit(parsed)
    onApplied()
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--surface-1)] flex items-center gap-2 flex-shrink-0">
        <FileText size={11} className="text-[var(--fg-faint)]" />
        <span className="text-xs text-[var(--fg-muted)] flex-1">
          Edit circuit as{' '}
          <span className="font-mono text-[var(--fg)]">.tsuki-circuit</span>
          {' '}— JSON with components, wires, colors
        </span>
        {error && (
          <span className="text-[10px] text-[var(--err)] flex items-center gap-1">
            <AlertCircle size={9} /> {error}
          </span>
        )}
        <button
          onClick={apply}
          className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-[var(--fg)] text-[var(--accent-inv)] cursor-pointer border-0 hover:opacity-80"
        >
          <CheckCircle2 size={10} /> Apply
        </button>
      </div>

      {/* Editor */}
      <div className="flex-1 relative overflow-hidden">
        <textarea
          value={draft}
          onChange={e => { setDraft(e.target.value); setError('') }}
          spellCheck={false}
          className="w-full h-full resize-none outline-none border-0 bg-[var(--surface)] text-[var(--fg)] font-mono text-xs leading-5 p-4"
          style={{ fontFamily: 'var(--font-mono)' }}
        />
      </div>

      {/* Status bar */}
      <div className="px-3 py-1.5 border-t border-[var(--border)] bg-[var(--surface-1)] text-[10px] text-[var(--fg-faint)] font-mono flex-shrink-0">
        .tsuki-circuit v1 · {circuit.components.length} components · {circuit.wires.length} wires
      </div>
    </div>
  )
}
