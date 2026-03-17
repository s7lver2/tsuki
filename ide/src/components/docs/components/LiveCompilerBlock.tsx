'use client'
// ─────────────────────────────────────────────────────────────────────────────
//  LiveCompilerBlock.tsx
//
//  Reemplaza TerminalBlock: bloque de código editable que llama a tsuki-core
//  real, transpila Go → C++ y muestra la salida en streaming.
//
//  Requiere entorno Tauri. Fuera del IDE muestra un placeholder informativo.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useRef, useCallback } from 'react'
import {
  isTauri,
  transpileSource,
  deleteFile,
  getTmpGoPath,
  type ProcessHandle,
} from '@/lib/tauri'

// ── Go syntax tokeniser (same as DocsPrimitives) ───────────────────────────────

const GO_KW = new Set([
  'package','import','func','var','const','type','struct','interface','map','chan',
  'go','defer','return','if','else','for','range','switch','case','default','break',
  'continue','select','make','new','len','cap','append','nil','true','false','iota',
])
const GO_TY = new Set([
  'string','int','int8','int16','int32','int64','uint','uint8','uint16','uint32',
  'uint64','float32','float64','bool','byte','rune','error','any',
])

function tokenizeGo(code: string): { t: string; v: string }[] {
  const out: { t: string; v: string }[] = []
  let i = 0
  while (i < code.length) {
    if (code[i] === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i)
      const v = end < 0 ? code.slice(i) : code.slice(i, end)
      out.push({ t: 'comment', v }); i += v.length; continue
    }
    if (code[i] === '"') {
      let j = i + 1
      while (j < code.length && !(code[j] === '"' && code[j - 1] !== '\\')) j++
      out.push({ t: 'string', v: code.slice(i, j + 1) }); i = j + 1; continue
    }
    if (code[i] === '`') {
      let j = i + 1; while (j < code.length && code[j] !== '`') j++
      out.push({ t: 'string', v: code.slice(i, j + 1) }); i = j + 1; continue
    }
    if (/\d/.test(code[i]) && (i === 0 || /\W/.test(code[i - 1]))) {
      let j = i; while (j < code.length && /[\d.]/.test(code[j])) j++
      out.push({ t: 'number', v: code.slice(i, j) }); i = j; continue
    }
    if (/[A-Za-z_]/.test(code[i])) {
      let j = i; while (j < code.length && /\w/.test(code[j])) j++
      const w = code.slice(i, j)
      const after = code.slice(j).trimStart()
      const t = GO_KW.has(w) ? 'kw' : GO_TY.has(w) ? 'ty' : after[0] === '(' ? 'fn' : 'id'
      out.push({ t, v: w }); i = j; continue
    }
    out.push({ t: 'punct', v: code[i] }); i++
  }
  return out
}

const TOKEN_VAR: Record<string, string> = {
  kw:      'var(--syn-kw)',
  ty:      'var(--syn-typ)',
  string:  'var(--syn-str)',
  comment: 'var(--syn-com)',
  number:  'var(--syn-num)',
  fn:      'var(--syn-fn)',
  id:      'var(--fg)',
  punct:   'var(--syn-op)',
}

function HighlightedGo({ code }: { code: string }) {
  return (
    <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.65 }}>
      {tokenizeGo(code).map((tok, i) => (
        <span key={i} style={{ color: TOKEN_VAR[tok.t] ?? 'var(--fg)' }}>{tok.v}</span>
      ))}
    </code>
  )
}

// ── Output line types ─────────────────────────────────────────────────────────

type LineKind = 'stdout' | 'stderr' | 'meta' | 'ok' | 'err'

interface OutputLine {
  kind: LineKind
  text: string
}

function lineColor(kind: LineKind): string {
  if (kind === 'stderr' || kind === 'err') return 'var(--err)'
  if (kind === 'ok')   return 'var(--ok)'
  if (kind === 'meta') return 'var(--fg-faint)'
  return 'var(--fg-muted)'
}

// ── Small button ──────────────────────────────────────────────────────────────

function Btn({
  onClick, children, primary, disabled, title,
}: {
  onClick: () => void
  children: React.ReactNode
  primary?: boolean
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        border: `1px solid ${primary ? 'var(--fg-muted)' : 'var(--border)'}`,
        background: primary ? 'var(--fg)' : 'transparent',
        color: primary ? 'var(--accent-inv)' : 'var(--fg-muted)',
        borderRadius: 4, padding: '2px 9px',
        fontSize: 10, fontFamily: 'var(--font-mono)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        display: 'flex', alignItems: 'center', gap: 4,
        transition: 'opacity 0.1s',
      }}
    >{children}</button>
  )
}

// ── LiveCompilerBlock ─────────────────────────────────────────────────────────

export interface LiveCompilerBlockProps {
  /** Initial source shown in the editor */
  initialCode: string
  /** Board id passed to tsuki-core (default: uno) */
  board?: string
  /** Label shown in the block header */
  filename?: string
  /** Source language: "go" (default) or "python" */
  lang?: 'go' | 'python'
}

type CompileState = 'idle' | 'running' | 'ok' | 'error'

export function LiveCompilerBlock({
  initialCode,
  board = 'uno',
  filename = 'main.go',
  lang = 'go',
}: LiveCompilerBlockProps) {
  const original = initialCode.trim()
  const [code,    setCode]    = useState(original)
  const [editing, setEditing] = useState(false)
  const [state,   setState]   = useState<CompileState>('idle')
  const [lines,   setLines]   = useState<OutputLine[]>([])
  const [elapsed, setElapsed] = useState<number | null>(null)
  const handleRef             = useRef<ProcessHandle | null>(null)
  const textareaRef           = useRef<HTMLTextAreaElement>(null)
  const outputRef             = useRef<HTMLDivElement>(null)

  const inTauri = typeof window !== 'undefined' && isTauri()

  // Auto-scroll output
  const pushLine = useCallback((line: OutputLine) => {
    setLines(prev => [...prev, line])
    requestAnimationFrame(() => {
      if (outputRef.current) {
        outputRef.current.scrollTop = outputRef.current.scrollHeight
      }
    })
  }, [])

  async function compile() {
    if (state === 'running') {
      handleRef.current?.kill()
      return
    }

    setLines([])
    setState('running')
    setElapsed(null)
    const t0 = Date.now()

    try {
      pushLine({ kind: 'meta', text: `→ transpiling with board: ${board}` })

      // In-process transpilation — no tsuki-core.exe subprocess needed
      const cpp = await transpileSource(code, board, lang)

      const ms = Date.now() - t0
      setElapsed(ms)

      // Show the generated C++ in the output panel
      cpp.split('\n').slice(0, 80).forEach(line => pushLine({ kind: 'stdout', text: line }))
      if (cpp.split('\n').length > 80) pushLine({ kind: 'meta', text: `… (${cpp.split('\n').length} lines total)` })

      pushLine({ kind: 'ok', text: `✓ transpile OK  (${ms} ms)` })
      setState('ok')
    } catch (err: unknown) {
      const ms = Date.now() - t0
      setElapsed(ms)
      const msg = (err as Error)?.message ?? String(err)
      msg.split('\n').forEach(line => pushLine({ kind: 'stderr', text: line }))
      pushLine({ kind: 'err', text: `✗ transpile failed` })
      setState('error')
    }
  }

  function reset() {
    setCode(original)
    setLines([])
    setState('idle')
    setElapsed(null)
  }

  const displayLines = code.split('\n')

  const stateLabel: Record<CompileState, string> = {
    idle:    '',
    running: 'transpiling…',
    ok:      'ok',
    error:   'error',
  }
  const stateColor: Record<CompileState, string> = {
    idle:    'var(--fg-faint)',
    running: 'var(--fg-muted)',
    ok:      'var(--ok)',
    error:   'var(--err)',
  }

  // ── Outside Tauri: show placeholder ──────────────────────────────────────────
  if (!inTauri) {
    return (
      <div style={{
        border: '1px solid var(--border)', borderRadius: 6,
        overflow: 'hidden', marginBottom: 14,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '5px 10px', background: 'var(--surface-2)',
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ flex: 1, fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)' }}>
            {filename}
          </span>
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--fg-faint)' }}>
            live · board:{board}
          </span>
          <Btn onClick={() => {}} disabled>▶ compile</Btn>
        </div>
        {/* Code */}
        <div style={{ display: 'flex', background: 'var(--surface-1)' }}>
          <div style={{ padding: '10px 8px 10px 6px', minWidth: 30, textAlign: 'right', borderRight: '1px solid var(--border)', userSelect: 'none', flexShrink: 0 }}>
            {displayLines.map((_, i) => (
              <div key={i} style={{ fontSize: 11, lineHeight: '1.65', color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)' }}>{i + 1}</div>
            ))}
          </div>
          <pre style={{ margin: 0, padding: '10px 14px', flex: 1, overflowX: 'auto' }}>
            <HighlightedGo code={code} />
          </pre>
        </div>
        {/* Notice */}
        <div style={{
          padding: '7px 12px', background: 'var(--surface-2)',
          borderTop: '1px solid var(--border)',
          fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ opacity: 0.5 }}>⚠</span>
          live compilation requires the tsuki IDE — open this page in the app to run it
        </div>
      </div>
    )
  }

  // ── Full Tauri version ────────────────────────────────────────────────────────
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 6,
      overflow: 'hidden', marginBottom: 14,
    }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 10px', background: 'var(--surface-2)',
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ flex: 1, fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)' }}>
          {filename}
        </span>

        {/* Board badge */}
        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--fg-faint)', letterSpacing: '0.04em' }}>
          board:{board}
        </span>

        {/* State indicator */}
        {state !== 'idle' && (
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: stateColor[state], display: 'flex', alignItems: 'center', gap: 4 }}>
            {state === 'running' && (
              <span style={{ display: 'inline-block', animation: 'lcSpin 0.8s linear infinite' }}>◌</span>
            )}
            {stateLabel[state]}
          </span>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 4 }}>
          {editing ? (
            <>
              <Btn onClick={() => { setCode(original); setEditing(false); setLines([]); setState('idle') }}>↩ reset</Btn>
              <Btn onClick={() => setEditing(false)} primary>✓ done</Btn>
            </>
          ) : (
            <>
              <Btn onClick={() => { setEditing(true); setTimeout(() => textareaRef.current?.focus(), 40) }}>✎ edit</Btn>
              {state === 'running' ? (
                <Btn onClick={compile} primary>■ stop</Btn>
              ) : (
                <Btn onClick={compile} primary>▶ compile</Btn>
              )}
            </>
          )}
          {(state === 'ok' || state === 'error') && !editing && (
            <Btn onClick={reset}>↺ clear</Btn>
          )}
        </div>
      </div>

      {/* ── Source editor ── */}
      <div style={{ display: 'flex', background: 'var(--surface-1)' }}>
        {/* Line numbers */}
        <div style={{
          padding: '10px 8px 10px 6px', minWidth: 30,
          textAlign: 'right', borderRight: '1px solid var(--border)',
          userSelect: 'none', flexShrink: 0,
        }}>
          {displayLines.map((_, i) => (
            <div key={i} style={{ fontSize: 11, lineHeight: '1.65', color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)' }}>
              {i + 1}
            </div>
          ))}
        </div>

        {/* Code / textarea */}
        <div style={{ flex: 1, position: 'relative', overflowX: 'auto' }}>
          {editing ? (
            <textarea
              ref={textareaRef}
              value={code}
              onChange={e => setCode(e.target.value)}
              spellCheck={false}
              style={{
                width: '100%',
                minHeight: displayLines.length * 19.8 + 20,
                background: 'transparent',
                border: 'none', outline: 'none',
                color: 'var(--fg)',
                fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: '1.65',
                padding: '10px 14px',
                resize: 'vertical',
                caretColor: 'var(--fg)',
              }}
            />
          ) : (
            <pre style={{ margin: 0, padding: '10px 14px', overflowX: 'auto' }}>
              <HighlightedGo code={code} />
            </pre>
          )}
        </div>
      </div>

      {/* ── Output panel ── */}
      {lines.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {/* Output header */}
          <div style={{
            padding: '4px 10px', background: 'var(--surface-2)',
            borderBottom: '1px solid var(--border)',
            fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600,
            color: 'var(--fg-faint)', letterSpacing: '0.06em', textTransform: 'uppercase',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span>output</span>
            {elapsed !== null && (
              <span style={{ fontWeight: 400, opacity: 0.6 }}>{elapsed} ms</span>
            )}
          </div>

          {/* Lines */}
          <div
            ref={outputRef}
            style={{
              padding: '8px 14px',
              background: 'var(--surface-1)',
              maxHeight: 260,
              overflowY: 'auto',
              fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: '1.65',
            }}
          >
            {lines.map((l, i) => (
              <div key={i} style={{ color: lineColor(l.kind), whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {l.text}
              </div>
            ))}
            {state === 'running' && (
              <span style={{ color: 'var(--fg-faint)', animation: 'lcBlink 1s step-start infinite' }}>▋</span>
            )}
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      {lines.length === 0 && (
        <div style={{
          padding: '4px 10px', background: 'var(--surface-2)',
          borderTop: '1px solid var(--border)',
          fontSize: 10, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)',
        }}>
          edit code · click ▶ compile to transpile Go → C++
        </div>
      )}

      <style>{`
        @keyframes lcSpin  { to { transform: rotate(360deg); } }
        @keyframes lcBlink { 0%,100%{opacity:1} 50%{opacity:0} }
      `}</style>
    </div>
  )
}