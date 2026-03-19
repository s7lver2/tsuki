'use client'
import React from 'react'
import { useStore } from '@/lib/store'

interface State {
  error:          Error | null
  componentStack: string
}

interface Props {
  children:  React.ReactNode
  name?:     string
  fallback?: React.ReactNode
}

/**
 * ErrorBoundary — integrado con el sistema de logs de tsuki.
 *
 * Al capturar un error:
 *  1. Escribe entradas `err` y `warn` en el Output panel (useStore.addLog)
 *  2. Reenvía al debug logger de Tauri si está activo (console.error)
 *  3. Persiste en localStorage para inspección post-reload
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null, componentStack: '' }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    const stack  = info.componentStack ?? ''
    const name   = this.props.name ?? 'unknown'
    const ts     = new Date().toTimeString().slice(0, 8)

    // ── 1. Tsuki Output log ───────────────────────────────────────────────────
    try {
      const { addLog, setBottomTab } = useStore.getState()
      setBottomTab('output')
      addLog('err',  `[ErrorBoundary:${name}] ${error.message}`)
      addLog('warn', `[ErrorBoundary:${name}] ${error.name}: ${error.stack?.split('\n')[1]?.trim() ?? ''}`)
      // Emit first 3 meaningful component stack lines
      const csLines = stack.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 5)
      csLines.forEach(l => addLog('info', `  component: ${l}`))
    } catch { /* store unavailable */ }

    // ── 2. Forward to Tauri debug logger (console.error is already patched) ──
    console.error(`[ErrorBoundary:${name}]`, error, '\nComponent stack:', stack)

    // ── 3. Persist for post-reload inspection ──────────────────────────────────
    try {
      localStorage.setItem('tsuki_last_crash', JSON.stringify({
        boundary: name, message: error.message,
        stack: error.stack, componentStack: stack.slice(0, 2000), ts,
      }))
    } catch { /* storage full */ }

    this.setState({ error, componentStack: stack })
  }

  override render() {
    if (!this.state.error) return this.props.children
    if (this.props.fallback) return this.props.fallback

    const { error, componentStack } = this.state
    const name = this.props.name ?? 'component'

    return (
      <div style={{
        fontFamily: 'monospace', fontSize: 11, background: '#0f172a',
        color: '#f87171', padding: 12, height: '100%', overflow: 'auto', lineHeight: 1.6,
      }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
          ⚠ {name} crashed — check Output tab for details
        </div>
        <div style={{ color: '#fca5a5', marginBottom: 8 }}>{error.message}</div>
        {error.stack && (
          <pre style={{ color: '#64748b', fontSize: 10, whiteSpace: 'pre-wrap', marginBottom: 8 }}>
            {error.stack}
          </pre>
        )}
        {componentStack && (
          <pre style={{ color: '#475569', fontSize: 10, whiteSpace: 'pre-wrap' }}>
            {componentStack.split('\n').slice(0, 10).join('\n')}
          </pre>
        )}
        <button
          onClick={() => this.setState({ error: null, componentStack: '' })}
          style={{
            marginTop: 10, padding: '4px 10px', borderRadius: 6,
            background: '#1e293b', color: '#94a3b8', border: '1px solid #334155',
            cursor: 'pointer', fontSize: 11,
          }}
        >
          Retry
        </button>
      </div>
    )
  }
}

export function withErrorBoundary<P extends object>(
  Comp: React.ComponentType<P>,
  name?: string,
) {
  return function SafeComp(props: P) {
    return (
      <ErrorBoundary name={name ?? Comp.displayName ?? Comp.name}>
        <Comp {...props} />
      </ErrorBoundary>
    )
  }
}