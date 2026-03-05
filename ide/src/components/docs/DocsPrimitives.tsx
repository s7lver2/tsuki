// ─────────────────────────────────────────────────────────────────────────────
//  DocsPrimitives.tsx
//  i18n context + prose primitives + full-featured CodeBlock (copy + edit + syntax check)
//  Uses only design-system CSS variables — no hardcoded colours.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useRef, useCallback, createContext, useContext } from 'react'

// ── i18n ──────────────────────────────────────────────────────────────────────

const STRINGS = {
  en: {
    'code.copy':     'Copy',
    'code.copied':   'Copied!',
    'code.edit':     'Edit',
    'code.done':     'Done',
    'code.reset':    'Reset',
    'code.check':    'Check syntax',
    'code.editing':  'editing',
    'code.syntax_ok':  'Syntax OK',
    'code.syntax_err': 'Syntax error',
    'code.readonly':   'read-only — click Edit to modify',
  },
  es: {
    'code.copy':     'Copiar',
    'code.copied':   '¡Copiado!',
    'code.edit':     'Editar',
    'code.done':     'Hecho',
    'code.reset':    'Restaurar',
    'code.check':    'Verificar sintaxis',
    'code.editing':  'editando',
    'code.syntax_ok':  'Sintaxis correcta',
    'code.syntax_err': 'Error de sintaxis',
    'code.readonly':   'solo lectura — pulsa Editar para modificar',
  },
}

export type DocsLang = 'en' | 'es'
type StringKey = keyof typeof STRINGS.en

interface I18nCtx {
  lang: DocsLang
  setLang: (l: DocsLang) => void
  t: (k: StringKey) => string
}

const I18nContext = createContext<I18nCtx>({
  lang: 'en',
  setLang: () => {},
  t: (k) => k,
})

export function DocsI18nProvider({
  lang,
  setLang,
  children,
}: {
  lang: DocsLang
  setLang: (l: DocsLang) => void
  children: React.ReactNode
}) {
  const t = useCallback(
    (k: StringKey) => STRINGS[lang][k] ?? STRINGS.en[k] ?? k,
    [lang],
  )
  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useDocsI18n() {
  return useContext(I18nContext)
}

// ── Typography ────────────────────────────────────────────────────────────────

export function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontSize: 14, fontWeight: 600, color: 'var(--fg)',
      margin: '28px 0 8px', letterSpacing: '-0.01em', lineHeight: 1.3,
      fontFamily: 'var(--font-sans)',
    }}>
      {children}
    </h2>
  )
}

export function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize: 12, fontWeight: 600, color: 'var(--fg)',
      margin: '20px 0 6px', letterSpacing: '-0.005em',
      fontFamily: 'var(--font-sans)',
    }}>
      {children}
    </h3>
  )
}

export function P({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.7,
      margin: '0 0 12px', fontFamily: 'var(--font-sans)',
    }}>
      {children}
    </p>
  )
}

export function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul style={{ margin: '0 0 12px', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {children}
    </ul>
  )
}

export function LI({ children }: { children: React.ReactNode }) {
  return (
    <li style={{ fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.65, fontFamily: 'var(--font-sans)' }}>
      {children}
    </li>
  )
}

export function Divider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '24px 0' }} />
}

// ── Inline elements ───────────────────────────────────────────────────────────

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code style={{
      fontFamily: 'var(--font-mono)', fontSize: 11.5,
      background: 'var(--surface-3)', border: '1px solid var(--border)',
      borderRadius: 3, padding: '1px 4px', color: 'var(--fg)',
    }}>
      {children}
    </code>
  )
}

export function Badge({ children, variant = 'default' }: {
  children: React.ReactNode
  variant?: 'default' | 'ok' | 'warn' | 'muted'
}) {
  const styles: Record<string, { color: string; bg: string }> = {
    default: { color: 'var(--fg-muted)',  bg: 'var(--surface-3)' },
    ok:      { color: 'var(--ok)',        bg: 'color-mix(in srgb, var(--ok) 10%, transparent)' },
    warn:    { color: 'var(--warn)',      bg: 'color-mix(in srgb, var(--warn) 10%, transparent)' },
    muted:   { color: 'var(--fg-faint)', bg: 'var(--surface-3)' },
  }
  const s = styles[variant]
  return (
    <span style={{
      display: 'inline-block', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
      color: s.color, background: s.bg, borderRadius: 3, padding: '1px 5px',
    }}>
      {children}
    </span>
  )
}

// ── Note / callout ────────────────────────────────────────────────────────────

type NoteKind = 'info' | 'warn' | 'tip'

export function Note({ children, kind = 'info' }: { children: React.ReactNode; kind?: NoteKind }) {
  const ICONS: Record<NoteKind, { icon: string; color: string }> = {
    info: { icon: 'ℹ', color: 'var(--info)' },
    warn: { icon: '⚠', color: 'var(--warn)' },
    tip:  { icon: '✦', color: 'var(--ok)'   },
  }
  const s = ICONS[kind]
  return (
    <div style={{
      border: '1px solid var(--border)', background: 'var(--surface-1)',
      borderRadius: 6, padding: '9px 12px', margin: '12px 0',
      display: 'flex', gap: 9, alignItems: 'flex-start',
    }}>
      <span style={{ color: s.color, fontSize: 11, marginTop: 1, flexShrink: 0, fontFamily: 'var(--font-mono)' }}>
        {s.icon}
      </span>
      <span style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.65, fontFamily: 'var(--font-sans)' }}>
        {children}
      </span>
    </div>
  )
}

// ── Step (numbered) ───────────────────────────────────────────────────────────

export function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 14, marginBottom: 20 }}>
      <div style={{
        flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
        background: 'var(--surface-3)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2,
      }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
          {n}
        </span>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', marginBottom: 7, fontFamily: 'var(--font-sans)' }}>
          {title}
        </div>
        {children}
      </div>
    </div>
  )
}

// ── Feature card ──────────────────────────────────────────────────────────────

export function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 6, padding: '11px 13px',
      background: 'var(--surface-1)', display: 'flex', gap: 10, alignItems: 'flex-start',
    }}>
      <div style={{
        width: 26, height: 26, borderRadius: 5,
        background: 'var(--surface-3)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, color: 'var(--fg-muted)',
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', marginBottom: 2, fontFamily: 'var(--font-sans)' }}>
          {title}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', lineHeight: 1.6, fontFamily: 'var(--font-sans)' }}>
          {desc}
        </div>
      </div>
    </div>
  )
}

// ── Table ─────────────────────────────────────────────────────────────────────

export function Table({ rows, cols }: { cols: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${cols.length}, 1fr)`,
        background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
      }}>
        {cols.map(c => (
          <div key={c} style={{
            padding: '5px 10px', fontSize: 10, fontWeight: 600,
            color: 'var(--fg-faint)', textTransform: 'uppercase',
            letterSpacing: '0.06em', fontFamily: 'var(--font-mono)',
          }}>{c}</div>
        ))}
      </div>
      {rows.map((row, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: `repeat(${cols.length}, 1fr)`,
          borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none',
          background: i % 2 === 0 ? 'transparent' : 'var(--surface-1)',
        }}>
          {row.map((cell, j) => (
            <div key={j} style={{
              padding: '6px 10px', fontSize: 12,
              color: j === 0 ? 'var(--fg)' : 'var(--fg-muted)',
              fontFamily: j === 0 ? 'var(--font-mono)' : 'var(--font-sans)',
            }}>
              {cell}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Go syntax tokeniser ───────────────────────────────────────────────────────

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

// ── Basic Go syntax checker ───────────────────────────────────────────────────

function checkGoSyntax(code: string): { line: number; msg: string }[] {
  const errs: { line: number; msg: string }[] = []
  const lines = code.split('\n')
  if (!code.includes('package ')) errs.push({ line: 1, msg: 'missing package declaration' })
  let depth = 0
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '{') depth++
    if (code[i] === '}') { depth--; if (depth < 0) { errs.push({ line: code.slice(0, i).split('\n').length, msg: "unexpected '}'" }); break } }
  }
  if (depth > 0) errs.push({ line: lines.length, msg: "unclosed '{'" })
  let pd = 0
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '(') pd++
    if (code[i] === ')') { pd--; if (pd < 0) { errs.push({ line: code.slice(0, i).split('\n').length, msg: "unexpected ')'" }); break } }
  }
  if (pd > 0) errs.push({ line: lines.length, msg: "unclosed '('" })
  return errs
}

// ── Tiny button ───────────────────────────────────────────────────────────────

function Btn({
  onClick, children, primary, title,
}: {
  onClick: () => void
  children: React.ReactNode
  primary?: boolean
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        border: `1px solid ${primary ? 'var(--fg-muted)' : 'var(--border)'}`,
        background: primary ? 'var(--fg)' : 'transparent',
        color: primary ? 'var(--accent-inv)' : 'var(--fg-muted)',
        borderRadius: 4, padding: '2px 8px',
        fontSize: 10, fontFamily: 'var(--font-mono)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
      }}
    >
      {children}
    </button>
  )
}

// ── CodeBlock — copy + edit + syntax check ────────────────────────────────────

export function CodeBlock({
  lang = 'go',
  filename,
  children,
}: {
  lang?: string
  filename?: string
  children: string
}) {
  const { t } = useDocsI18n()
  const original = children.trim()
  const [editing, setEditing]     = useState(false)
  const [draft,   setDraft]       = useState(original)
  const [copied,  setCopied]      = useState(false)
  const [result,  setResult]      = useState<{ ok: boolean; errors: { line: number; msg: string }[] } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function copy() {
    navigator.clipboard?.writeText(editing ? draft : original).catch(() => {})
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  function enterEdit() {
    setDraft(original); setResult(null); setEditing(true)
    setTimeout(() => textareaRef.current?.focus(), 40)
  }

  function exitEdit() {
    setEditing(false); setResult(null); setDraft(original)
  }

  function check() {
    const errors = checkGoSyntax(draft)
    setResult({ ok: errors.length === 0, errors })
  }

  const displayCode = editing ? draft : original
  const lines = displayCode.split('\n')

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 6,
      overflow: 'hidden', marginBottom: 14, background: 'var(--surface-1)',
    }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 10px', background: 'var(--surface-2)',
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ flex: 1, fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)' }}>
          {filename ?? lang}
        </span>
        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--fg-faint)', letterSpacing: '0.04em' }}>
          {lang}
        </span>
        {editing && (
          <span style={{ fontSize: 9, color: 'var(--warn)', fontFamily: 'var(--font-mono)' }}>
            ✎ {t('code.editing')}
          </span>
        )}
        <div style={{ display: 'flex', gap: 4 }}>
          {editing ? (
            <>
              {lang === 'go' && (
                <Btn onClick={check} title={t('code.check')}>⚡ {t('code.check')}</Btn>
              )}
              <Btn onClick={exitEdit} title={t('code.reset')}>↩ {t('code.reset')}</Btn>
              <Btn onClick={() => { setEditing(false); setResult(null) }} primary>
                ✓ {t('code.done')}
              </Btn>
            </>
          ) : (
            <>
              <Btn onClick={copy}>
                {copied ? `✓ ${t('code.copied')}` : `⎘ ${t('code.copy')}`}
              </Btn>
              <Btn onClick={enterEdit} primary>✎ {t('code.edit')}</Btn>
            </>
          )}
        </div>
      </div>

      {/* ── Syntax result ── */}
      {result && (
        <div style={{
          padding: '7px 12px',
          background: result.ok
            ? 'color-mix(in srgb, var(--ok) 8%, transparent)'
            : 'color-mix(in srgb, var(--err) 8%, transparent)',
          borderBottom: '1px solid var(--border)',
          fontSize: 11, fontFamily: 'var(--font-mono)',
          color: result.ok ? 'var(--ok)' : 'var(--err)',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          <span style={{ fontWeight: 600 }}>
            {result.ok ? `✓ ${t('code.syntax_ok')}` : `✗ ${t('code.syntax_err')}`}
          </span>
          {result.errors.map((e, i) => (
            <span key={i} style={{ opacity: 0.75 }}>  line {e.line}: {e.msg}</span>
          ))}
        </div>
      )}

      {/* ── Code body ── */}
      <div style={{ display: 'flex' }}>
        {/* Line numbers */}
        <div style={{
          padding: '10px 8px 10px 6px', minWidth: 30,
          textAlign: 'right', borderRight: '1px solid var(--border)',
          userSelect: 'none', flexShrink: 0,
        }}>
          {lines.map((_, i) => (
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
              value={draft}
              onChange={e => { setDraft(e.target.value); setResult(null) }}
              spellCheck={false}
              style={{
                width: '100%',
                minHeight: lines.length * 19.8 + 20,
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
              {lang === 'go'
                ? <HighlightedGo code={original} />
                : <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.65, color: 'var(--fg-muted)' }}>{original}</code>
              }
            </pre>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      {!editing && (
        <div style={{
          padding: '4px 10px', background: 'var(--surface-2)',
          borderTop: '1px solid var(--border)',
          fontSize: 10, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)',
        }}>
          {t('code.readonly')}
        </div>
      )}
    </div>
  )
}