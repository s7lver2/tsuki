import React, { useState, useRef, useCallback, createContext, useContext } from "react"

// ─────────────────────────────────────────────────────────────────────────────
//  i18n
// ─────────────────────────────────────────────────────────────────────────────

const STRINGS = {
  en: {
    "code.copy": "Copy", "code.copied": "Copied!", "code.edit": "Edit",
    "code.done": "Done", "code.reset": "Reset", "code.check": "Check syntax",
    "code.editing": "Editing", "code.syntax_ok": "Syntax OK",
    "code.syntax_err": "Syntax error", "code.readonly": "Read-only — click Edit to modify",
    "diagram.hover": "Hover a pin for details",
    "diagram.pipeline_title": "Build Pipeline",
    "diagram.pin_mode": "Mode", "diagram.pin_voltage": "Voltage",
    "lang.toggle": "ES",
  },
  es: {
    "code.copy": "Copiar", "code.copied": "¡Copiado!", "code.edit": "Editar",
    "code.done": "Hecho", "code.reset": "Restaurar", "code.check": "Verificar sintaxis",
    "code.editing": "Editando", "code.syntax_ok": "Sintaxis correcta",
    "code.syntax_err": "Error de sintaxis", "code.readonly": "Solo lectura — pulsa Editar para modificar",
    "diagram.hover": "Pasa el cursor sobre un pin",
    "diagram.pipeline_title": "Pipeline de compilación",
    "diagram.pin_mode": "Modo", "diagram.pin_voltage": "Voltaje",
    "lang.toggle": "EN",
  },
}

type Lang = "en" | "es"
type StringKey = keyof typeof STRINGS.en

const I18nCtx = createContext<{ lang: Lang; t: (k: StringKey) => string; setLang: (l: Lang) => void }>({
  lang: "en",
  t: (k: StringKey) => k,
  setLang: (_: Lang) => {},
})
function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>("en")
  const t = useCallback((k: StringKey) => STRINGS[lang][k] ?? STRINGS.en[k] ?? k, [lang])
  return <I18nCtx.Provider value={{ lang, t, setLang }}>{children}</I18nCtx.Provider>
}
function useI18n() { return useContext(I18nCtx) }

// ─────────────────────────────────────────────────────────────────────────────
//  Syntax checker — basic Go validation
// ─────────────────────────────────────────────────────────────────────────────

function checkGoSyntax(code: string): { line: number; msg: string }[] {
  const errors = []
  const lines = code.split("\n")

  // Must have package declaration
  if (!code.includes("package ")) errors.push({ line: 1, msg: "missing package declaration" })

  // Balanced braces
  let depth = 0, firstOpen = -1
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "{") { if (depth === 0) firstOpen = i; depth++ }
    if (code[i] === "}") { depth-- }
    if (depth < 0) { errors.push({ line: code.slice(0, i).split("\n").length, msg: "unexpected '}'" }); break }
  }
  if (depth > 0) errors.push({ line: lines.length, msg: "unclosed '{'" })

  // Balanced parens
  let pdepth = 0
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "(") pdepth++
    if (code[i] === ")") pdepth--
    if (pdepth < 0) { errors.push({ line: code.slice(0, i).split("\n").length, msg: "unexpected ')'" }); break }
  }
  if (pdepth > 0) errors.push({ line: lines.length, msg: "unclosed '('" })

  // String literals balanced (simple check)
  const strMatches = code.match(/"/g) || []
  // Only warn if clearly odd (ignoring escaped quotes for simplicity)

  return errors
}

// ─────────────────────────────────────────────────────────────────────────────
//  Go syntax highlighter (regex-based, no deps)
// ─────────────────────────────────────────────────────────────────────────────

const GO_KEYWORDS = /\b(package|import|func|var|const|type|struct|interface|map|chan|go|defer|return|if|else|for|range|switch|case|default|break|continue|select|fallthrough|goto|make|new|len|cap|append|copy|delete|close|nil|true|false|iota)\b/g
const GO_TYPES    = /\b(string|int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|float32|float64|bool|byte|rune|error|any)\b/g
const GO_STRINGS  = /"(?:[^"\\]|\\.)*"/g
const GO_COMMENTS = /\/\/[^\n]*/g
const GO_NUMBERS  = /\b\d+(?:\.\d+)?\b/g
const GO_FUNCCALL = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g

function highlightGo(code: string): { type: string; value: string }[] {
  // We tokenize manually to avoid overlaps
  const tokens: { type: string; value: string }[] = []
  let i = 0

  function push(type: string, value: string) { tokens.push({ type, value }) }

  while (i < code.length) {
    // Line comment
    if (code[i] === "/" && code[i+1] === "/") {
      const end = code.indexOf("\n", i)
      const v = end === -1 ? code.slice(i) : code.slice(i, end)
      push("comment", v); i += v.length; continue
    }
    // String literal
    if (code[i] === '"') {
      let j = i + 1
      while (j < code.length && !(code[j] === '"' && code[j-1] !== "\\")) j++
      push("string", code.slice(i, j + 1)); i = j + 1; continue
    }
    // Raw string
    if (code[i] === "`") {
      let j = i + 1
      while (j < code.length && code[j] !== "`") j++
      push("string", code.slice(i, j + 1)); i = j + 1; continue
    }
    // Number
    if (/\d/.test(code[i]) && (i === 0 || /\W/.test(code[i-1]))) {
      let j = i
      while (j < code.length && /[\d.]/.test(code[j])) j++
      push("number", code.slice(i, j)); i = j; continue
    }
    // Identifier or keyword
    if (/[A-Za-z_]/.test(code[i])) {
      let j = i
      while (j < code.length && /\w/.test(code[j])) j++
      const word = code.slice(i, j)
      const isKw = /^(package|import|func|var|const|type|struct|interface|map|chan|go|defer|return|if|else|for|range|switch|case|default|break|continue|select|fallthrough|goto|make|new|len|cap|append|copy|delete|close|nil|true|false|iota)$/.test(word)
      const isTy = /^(string|int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|float32|float64|bool|byte|rune|error|any)$/.test(word)
      // check if followed by (
      const afterJ = code.slice(j).trimStart()
      const isCall = !isKw && !isTy && afterJ[0] === "("
      push(isKw ? "keyword" : isTy ? "type" : isCall ? "func" : "ident", word)
      i = j; continue
    }
    // Punctuation / operator
    push("punct", code[i]); i++
  }

  return tokens
}

const TOKEN_COLOR: Record<string, string> = {
  keyword: "var(--syn-kw)",
  type:    "var(--syn-typ)",
  string:  "var(--syn-str)",
  comment: "var(--syn-com)",
  number:  "var(--syn-num)",
  func:    "var(--syn-fn)",
  ident:   "var(--fg)",
  punct:   "var(--syn-op)",
}

function HighlightedCode({ code }: { code: string }) {
  const tokens = highlightGo(code)
  return (
    <code style={{ fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.65 }}>
      {tokens.map((tok, i) => (
        <span key={i} style={{ color: TOKEN_COLOR[tok.type] ?? "var(--fg)" }}>
          {tok.value}
        </span>
      ))}
    </code>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  CodeBlock component
// ─────────────────────────────────────────────────────────────────────────────

function CodeBlock({ lang = "go", title, children, filename }: { lang?: string; title?: string; children: string; filename?: string }) {
  const { t } = useI18n()
  const original = children.trim()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(original)
  const [copied, setCopied] = useState(false)
  const [syntaxResult, setSyntaxResult] = useState<{ ok: boolean; errors: { line: number; msg: string }[] } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function copy() {
    navigator.clipboard?.writeText(editing ? draft : original).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function enterEdit() {
    setDraft(original)
    setSyntaxResult(null)
    setEditing(true)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  function exitEdit() {
    setEditing(false)
    setSyntaxResult(null)
    setDraft(original)
  }

  function checkSyntax() {
    const errors = checkGoSyntax(draft)
    setSyntaxResult({ ok: errors.length === 0, errors })
  }

  const displayCode = editing ? draft : original
  const lines = displayCode.split("\n")

  return (
    <div style={{
      border: "1px solid var(--border)",
      borderRadius: 6,
      overflow: "hidden",
      marginBottom: 16,
      background: "var(--surface-1)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "5px 10px",
        background: "var(--surface-2)",
        borderBottom: "1px solid var(--border)",
      }}>
        {/* Filename / title */}
        <span style={{ flex: 1, fontSize: 11, color: "var(--fg-faint)", fontFamily: "var(--font-mono)" }}>
          {filename ?? title ?? lang}
        </span>

        {/* Lang badge */}
        <span style={{
          fontSize: 9, fontFamily: "var(--font-mono)", fontWeight: 600,
          color: "var(--fg-faint)", letterSpacing: "0.04em",
        }}>{lang}</span>

        {/* Edit mode indicator */}
        {editing && (
          <span style={{ fontSize: 9, color: "var(--warn)", fontFamily: "var(--font-mono)" }}>
            ✎ {t("code.editing")}
          </span>
        )}

        {/* Buttons */}
        <div style={{ display: "flex", gap: 4 }}>
          {editing ? (
            <>
              <ToolBtn onClick={checkSyntax} title={t("code.check")}>⚡</ToolBtn>
              <ToolBtn onClick={exitEdit} title={t("code.reset")}>↩ {t("code.reset")}</ToolBtn>
              <ToolBtn onClick={() => { setEditing(false); setSyntaxResult(null) }} primary>
                ✓ {t("code.done")}
              </ToolBtn>
            </>
          ) : (
            <>
              <ToolBtn onClick={copy}>
                {copied ? `✓ ${t("code.copied")}` : `⎘ ${t("code.copy")}`}
              </ToolBtn>
              <ToolBtn onClick={enterEdit} primary>✎ {t("code.edit")}</ToolBtn>
            </>
          )}
        </div>
      </div>

      {/* Syntax result banner */}
      {syntaxResult && (
        <div style={{
          padding: "7px 12px",
          background: syntaxResult.ok
            ? "color-mix(in srgb, var(--ok) 8%, transparent)"
            : "color-mix(in srgb, var(--err) 8%, transparent)",
          borderBottom: "1px solid var(--border)",
          fontSize: 11, fontFamily: "var(--font-mono)",
          color: syntaxResult.ok ? "var(--ok)" : "var(--err)",
          display: "flex", flexDirection: "column", gap: 2,
        }}>
          <span style={{ fontWeight: 600 }}>
            {syntaxResult.ok ? `✓ ${t("code.syntax_ok")}` : `✗ ${t("code.syntax_err")}`}
          </span>
          {syntaxResult.errors.map((e, i) => (
            <span key={i} style={{ opacity: 0.7 }}>  line {e.line}: {e.msg}</span>
          ))}
        </div>
      )}

      {/* Code area */}
      <div style={{ position: "relative", display: "flex" }}>
        {/* Line numbers */}
        <div style={{
          padding: "10px 0", minWidth: 30,
          textAlign: "right", paddingRight: 8, paddingLeft: 6,
          borderRight: "1px solid var(--border)",
          userSelect: "none", flexShrink: 0,
        }}>
          {lines.map((_, i) => (
            <div key={i} style={{ fontSize: 11, lineHeight: "1.65", color: "var(--fg-faint)", fontFamily: "var(--font-mono)" }}>
              {i + 1}
            </div>
          ))}
        </div>

        {/* Code / textarea */}
        <div style={{ flex: 1, position: "relative", overflowX: "auto" }}>
          {editing ? (
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={e => { setDraft(e.target.value); setSyntaxResult(null) }}
              spellCheck={false}
              style={{
                width: "100%", minHeight: lines.length * 19.8 + 20,
                background: "transparent",
                border: "none", outline: "none",
                color: "var(--fg)",
                fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: "1.65",
                padding: "10px 14px",
                resize: "vertical",
                caretColor: "var(--fg)",
              }}
            />
          ) : (
            <pre style={{ margin: 0, padding: "10px 14px", overflowX: "auto" }}>
              <HighlightedCode code={original} />
            </pre>
          )}
        </div>
      </div>

      {/* Footer when read-only */}
      {!editing && (
        <div style={{
          padding: "4px 10px",
          background: "var(--surface-2)",
          borderTop: "1px solid var(--border)",
          fontSize: 10, color: "var(--fg-faint)", fontFamily: "var(--font-mono)",
        }}>
          {t("code.readonly")}
        </div>
      )}
    </div>
  )
}

function ToolBtn({ onClick, children, primary, title }: { onClick: () => void; children: React.ReactNode; primary?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        border: `1px solid ${primary ? "var(--fg-muted)" : "var(--border)"}`,
        background: primary ? "var(--fg)" : "transparent",
        color: primary ? "var(--accent-inv)" : "var(--fg-muted)",
        borderRadius: 4, padding: "2px 8px",
        fontSize: 10, fontFamily: "var(--font-mono)",
        cursor: "pointer", transition: "opacity 0.1s",
        display: "flex", alignItems: "center", gap: 3,
      }}
    >{children}</button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Diagram: Build Pipeline
// ─────────────────────────────────────────────────────────────────────────────

// Pipeline steps — all use the same neutral highlight, no per-step colors
const PIPELINE_STEPS = [
  { id: "go",    label: "Go source",    sub: ".go files",   icon: "Go",
    desc: "Your Go code — type-safe, readable, with full Go tooling support." },
  { id: "core",  label: "tsuki-core",  sub: "transpiler",  icon: "⚙",
    desc: "Rust binary that transpiles Go → C++. Handles type mapping, Arduino API bindings, and import resolution." },
  { id: "cpp",   label: "C++ source",  sub: ".cpp / .ino", icon: "C++",
    desc: "Generated C++ ready for avr-gcc. Includes a .ino stub so it's compatible with Arduino tooling." },
  { id: "flash", label: "tsuki-flash", sub: "compiler",    icon: "⚡",
    desc: "Compiles C++ to AVR machine code. Downloads the AVR SDK automatically on first use — no arduino-cli needed." },
  { id: "hex",   label: "firmware.hex",sub: "Intel HEX",   icon: "■",
    desc: "The final firmware. Flash it to your board via USB. Typically 2–20 KB for a simple sketch." },
]

function BuildPipelineDiagram() {
  const { t } = useI18n()
  const [hovered, setHovered] = useState<string | null>(null)
  const [animated, setAnimated] = useState(false)

  return (
    <div style={{
      border: "1px solid var(--border)", borderRadius: 6,
      overflow: "hidden", marginBottom: 16, background: "var(--surface-1)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "7px 12px", background: "var(--surface-2)",
        borderBottom: "1px solid var(--border)",
      }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: "var(--fg-faint)", letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>
          {t("diagram.pipeline_title")}
        </span>
        <button
          onClick={() => { setAnimated(true); setTimeout(() => setAnimated(false), 3000) }}
          style={{
            border: "1px solid var(--border)", background: "transparent",
            color: "var(--fg-muted)", borderRadius: 4, padding: "2px 8px",
            fontSize: 10, fontFamily: "var(--font-mono)", cursor: "pointer",
          }}
        >▶ run</button>
      </div>

      <div style={{ padding: "20px 16px", overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 0, minWidth: 440 }}>
          {PIPELINE_STEPS.map((step, i) => (
            <React.Fragment key={step.id}>
              <PipelineStep
                step={step}
                active={hovered === step.id}
                animated={animated}
                delay={i * 0.4}
                onHover={setHovered}
              />
              {i < PIPELINE_STEPS.length - 1 && (
                <PipelineArrow animated={animated} delay={i * 0.4 + 0.3} />
              )}
            </React.Fragment>
          ))}
        </div>

        <div style={{
          marginTop: 12, minHeight: 40, padding: "9px 12px",
          background: hovered ? "var(--surface-2)" : "transparent",
          border: "1px solid",
          borderColor: hovered ? "var(--border)" : "transparent",
          borderRadius: 5, transition: "all 0.15s",
        }}>
          {hovered ? (
            <div>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--fg)", fontFamily: "var(--font-mono)" }}>
                {PIPELINE_STEPS.find(s => s.id === hovered)?.label}
              </span>
              <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--fg-muted)", lineHeight: 1.55, fontFamily: "var(--font-sans)" }}>
                {PIPELINE_STEPS.find(s => s.id === hovered)?.desc}
              </p>
            </div>
          ) : (
            <span style={{ fontSize: 11, color: "var(--fg-faint)", fontFamily: "var(--font-mono)" }}>
              ↑ hover a step for details
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function PipelineStep({ step, active, animated, delay, onHover }: { step: typeof PIPELINE_STEPS[number]; active: boolean; animated: boolean; delay: number; onHover: (id: string | null) => void }) {
  return (
    <div
      onMouseEnter={() => onHover(step.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
        cursor: "default",
        animation: animated ? `pulse-step 0.4s ease ${delay}s` : "none",
      }}
    >
      <div style={{
        width: 48, height: 48, borderRadius: 8,
        border: `1px solid ${active ? "var(--fg-muted)" : "var(--border)"}`,
        background: active ? "var(--surface-3)" : "var(--surface-2)",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.12s",
      }}>
        <span style={{
          fontFamily: "var(--font-mono)", fontWeight: 600,
          fontSize: step.icon.length > 2 ? 9 : 13,
          color: active ? "var(--fg)" : "var(--fg-faint)",
          transition: "color 0.12s",
        }}>{step.icon}</span>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 9, fontWeight: 600, color: active ? "var(--fg)" : "var(--fg-muted)", transition: "color 0.12s", fontFamily: "var(--font-mono)" }}>
          {step.label}
        </div>
        <div style={{ fontSize: 8, color: "var(--fg-faint)", fontFamily: "var(--font-mono)" }}>{step.sub}</div>
      </div>
    </div>
  )
}

function PipelineArrow({ animated, delay }: { animated: boolean; delay: number }) {
  return (
    <div style={{
      flex: 1, height: 1,
      background: "var(--border)",
      position: "relative",
      margin: "0 2px",
      marginBottom: 24,
    }}>
      <div style={{
        position: "absolute", right: -3, top: "50%", transform: "translateY(-50%)",
        width: 0, height: 0,
        borderLeft: "5px solid var(--border)",
        borderTop: "3px solid transparent",
        borderBottom: "3px solid transparent",
      }} />
      {animated && (
        <div style={{
          position: "absolute", top: "50%", transform: "translateY(-50%)",
          width: 6, height: 6, borderRadius: "50%",
          background: "var(--fg-muted)",
          animation: `flow-dot 0.5s ease ${delay}s both`,
        }} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Diagram: Arduino Uno Pinout
// ─────────────────────────────────────────────────────────────────────────────

const UNO_PINS: { id: string; x: number; y: number; label: string; info: { mode: string; voltage: string; special?: string } }[] = [
  // Digital right side (top to bottom)
  { id: "D13", x: 314, y: 62,  label: "D13", info: { mode: "Digital I/O / SPI (SCK)", voltage: "5V", special: "Built-in LED" }},
  { id: "D12", x: 314, y: 76,  label: "D12", info: { mode: "Digital I/O / SPI (MISO)", voltage: "5V" }},
  { id: "D11", x: 314, y: 90,  label: "D11", info: { mode: "Digital I/O / SPI (MOSI) / PWM~", voltage: "5V", special: "PWM" }},
  { id: "D10", x: 314, y: 104, label: "D10", info: { mode: "Digital I/O / SPI (SS) / PWM~", voltage: "5V", special: "PWM" }},
  { id: "D9",  x: 314, y: 118, label: "D9",  info: { mode: "Digital I/O / PWM~", voltage: "5V", special: "PWM" }},
  { id: "D8",  x: 314, y: 132, label: "D8",  info: { mode: "Digital I/O", voltage: "5V" }},
  { id: "D7",  x: 314, y: 150, label: "D7",  info: { mode: "Digital I/O", voltage: "5V" }},
  { id: "D6",  x: 314, y: 164, label: "D6",  info: { mode: "Digital I/O / PWM~", voltage: "5V", special: "PWM" }},
  { id: "D5",  x: 314, y: 178, label: "D5",  info: { mode: "Digital I/O / PWM~", voltage: "5V", special: "PWM" }},
  { id: "D4",  x: 314, y: 192, label: "D4",  info: { mode: "Digital I/O", voltage: "5V" }},
  { id: "D3",  x: 314, y: 206, label: "D3",  info: { mode: "Digital I/O / PWM~ / INT1", voltage: "5V", special: "PWM + INT" }},
  { id: "D2",  x: 314, y: 220, label: "D2",  info: { mode: "Digital I/O / INT0", voltage: "5V", special: "Interrupt" }},
  { id: "TX1", x: 314, y: 234, label: "TX→1", info: { mode: "Serial TX (D1)", voltage: "5V", special: "UART" }},
  { id: "RX0", x: 314, y: 248, label: "RX←0", info: { mode: "Serial RX (D0)", voltage: "5V", special: "UART" }},
  // Analog left side (bottom to top)
  { id: "A0", x: 44, y: 198, label: "A0", info: { mode: "Analog in (10-bit) / Digital I/O", voltage: "5V ref", special: "ADC" }},
  { id: "A1", x: 44, y: 212, label: "A1", info: { mode: "Analog in (10-bit) / Digital I/O", voltage: "5V ref", special: "ADC" }},
  { id: "A2", x: 44, y: 226, label: "A2", info: { mode: "Analog in (10-bit) / Digital I/O", voltage: "5V ref", special: "ADC" }},
  { id: "A3", x: 44, y: 240, label: "A3", info: { mode: "Analog in (10-bit) / Digital I/O", voltage: "5V ref", special: "ADC" }},
  { id: "A4", x: 44, y: 254, label: "A4", info: { mode: "Analog in (10-bit) / I2C SDA", voltage: "5V ref", special: "I2C" }},
  { id: "A5", x: 44, y: 268, label: "A5", info: { mode: "Analog in (10-bit) / I2C SCL", voltage: "5V ref", special: "I2C" }},
  // Power
  { id: "5V",  x: 44, y: 100, label: "5V",  info: { mode: "Power output", voltage: "5V", special: "Power" }},
  { id: "3V3", x: 44, y: 114, label: "3.3V",info: { mode: "Power output (50mA max)", voltage: "3.3V", special: "Power" }},
  { id: "GND", x: 44, y: 128, label: "GND", info: { mode: "Ground", voltage: "0V", special: "Power" }},
]

// Pin type colors — muted, to not fight the neutral UI
const PIN_COLORS: Record<string, string> = {
  "PWM":       "#a0a0a0",
  "ADC":       "#b8b8b8",
  "I2C":       "#909090",
  "UART":      "#c0c0c0",
  "PWM + INT": "#a0a0a0",
  "Interrupt": "#d0d0d0",
  "Power":     "#888888",
  "Built-in LED": "#e0e0e0",
  "default":   "#484848",
}

function AvrPinoutDiagram() {
  const { t } = useI18n()
  const [hovered, setHovered] = useState<string | null>(null)

  const hovPin = UNO_PINS.find(p => p.id === hovered)

  return (
    <div style={{
      border: "1px solid var(--border)", borderRadius: 6,
      overflow: "hidden", marginBottom: 16, background: "var(--surface-1)",
    }}>
      <div style={{ padding: "7px 12px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: "var(--fg-faint)", letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>
          Arduino Uno — Pinout
        </span>
        <div style={{ display: "flex", gap: 10, fontSize: 9, fontFamily: "var(--font-mono)" }}>
          {[["PWM~","PWM"],["ADC","ADC"],["I2C","I2C"],["UART","UART"],["PWR","Power"]].map(([label, key]) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--fg-faint)" }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: PIN_COLORS[key], display: "inline-block" }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div style={{ display: "flex" }}>
        <div style={{ flex: 1, padding: "8px 0" }}>
          <svg viewBox="0 0 360 320" style={{ width: "100%", maxWidth: 400, display: "block", margin: "0 auto" }}>
            {/* Board outline */}
            <rect x="54" y="44" width="252" height="264" rx="8" fill="var(--surface-3)" stroke="var(--border)" strokeWidth="1" />

            {/* USB connector */}
            <rect x="54" y="80" width="20" height="40" rx="3" fill="var(--surface-4)" stroke="var(--border)" strokeWidth="1" />
            <rect x="44" y="86" width="14" height="28" rx="2" fill="var(--surface-3)" stroke="var(--border)" strokeWidth="1" />

            {/* Reset button */}
            <circle cx="110" cy="270" r="7" fill="var(--surface-4)" stroke="var(--border)" strokeWidth="1" />
            <text x="110" y="287" textAnchor="middle" fontSize="6" fill="var(--fg-faint)" fontFamily="monospace">RST</text>

            {/* ATmega chip */}
            <rect x="130" y="130" width="100" height="80" rx="4" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="1" />
            <text x="180" y="168" textAnchor="middle" fontSize="7" fill="var(--fg-faint)" fontFamily="monospace">ATmega328P</text>
            <text x="180" y="178" textAnchor="middle" fontSize="6" fill="var(--fg-faint)" fontFamily="monospace">16 MHz</text>

            {/* Crystal */}
            <rect x="160" y="224" width="8" height="16" rx="2" fill="var(--surface-3)" stroke="var(--border)" strokeWidth="0.5" />
            <text x="164" y="250" textAnchor="middle" fontSize="5.5" fill="var(--fg-faint)" fontFamily="monospace">16MHz</text>

            {/* Pin dots */}
            {UNO_PINS.map(pin => {
              const isHov = pin.id === hovered
              const color = PIN_COLORS[pin.info.special ?? "default"] ?? PIN_COLORS.default
              return (
                <g key={pin.id}>
                  <circle
                    cx={pin.x} cy={pin.y} r={isHov ? 7 : 5}
                    fill={isHov ? color : "var(--surface-4)"}
                    stroke={color}
                    strokeWidth={isHov ? 1.5 : 0.8}
                    style={{ cursor: "pointer", transition: "all 0.1s" }}
                    onMouseEnter={() => setHovered(pin.id)}
                    onMouseLeave={() => setHovered(null)}
                  />
                  {isHov && (
                    <circle cx={pin.x} cy={pin.y} r={10}
                      fill="none" stroke={color} strokeWidth={0.8} opacity={0.4}
                    />
                  )}
                  <text
                    x={pin.x < 180 ? pin.x - 10 : pin.x + 10}
                    y={pin.y + 3}
                    textAnchor={pin.x < 180 ? "end" : "start"}
                    fontSize={7}
                    fill={isHov ? color : "var(--fg-faint)"}
                    fontFamily="monospace"
                    style={{ pointerEvents: "none", transition: "fill 0.1s" }}
                  >
                    {pin.label}
                  </text>
                </g>
              )
            })}

            <text x="180" y="296" textAnchor="middle" fontSize="8" fill="var(--fg-faint)" fontFamily="monospace">
              Arduino Uno
            </text>
          </svg>
        </div>

        <div style={{
          width: 170, borderLeft: "1px solid var(--border)",
          padding: 12, flexShrink: 0,
          display: "flex", flexDirection: "column", justifyContent: "center",
        }}>
          {hovPin ? (
            <div>
              <div style={{
                display: "inline-block",
                background: "var(--surface-3)",
                border: "1px solid var(--border)",
                borderRadius: 4, padding: "2px 7px", marginBottom: 8,
                fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)",
                color: "var(--fg)",
              }}>
                {hovPin.label}
              </div>
              {hovPin.info.special && (
                <div style={{
                  fontSize: 9, fontFamily: "var(--font-mono)",
                  color: "var(--fg-muted)",
                  background: "var(--surface-3)",
                  display: "inline-block", padding: "1px 6px", borderRadius: 3, marginBottom: 8,
                }}>
                  {hovPin.info.special}
                </div>
              )}
              <div style={{ fontSize: 11, color: "var(--fg-muted)", lineHeight: 1.65, fontFamily: "var(--font-sans)" }}>
                <div><span style={{ color: "var(--fg-faint)", fontFamily: "var(--font-mono)", fontSize: 10 }}>{t("diagram.pin_mode")}: </span>{hovPin.info.mode}</div>
                <div style={{ marginTop: 3 }}><span style={{ color: "var(--fg-faint)", fontFamily: "var(--font-mono)", fontSize: 10 }}>{t("diagram.pin_voltage")}: </span>{hovPin.info.voltage}</div>
              </div>
            </div>
          ) : (
            <div style={{ color: "var(--fg-faint)", fontSize: 10, fontFamily: "var(--font-mono)", textAlign: "center" }}>
              {t("diagram.hover")}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tabs — switchable content panels
// ─────────────────────────────────────────────────────────────────────────────

export function Tabs({ tabs }: { tabs: { label: string; content: React.ReactNode }[] }) {
  const [active, setActive] = useState(0)
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 6,
      overflow: 'hidden', marginBottom: 14, background: 'var(--surface-1)',
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', background: 'var(--surface-2)',
        borderBottom: '1px solid var(--border)', overflowX: 'auto',
      }}>
        {tabs.map((tab, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            style={{
              border: 'none', borderBottom: `2px solid ${i === active ? 'var(--fg-muted)' : 'transparent'}`,
              background: 'transparent',
              color: i === active ? 'var(--fg)' : 'var(--fg-faint)',
              padding: '6px 14px', fontSize: 11, fontFamily: 'var(--font-mono)',
              fontWeight: i === active ? 600 : 400,
              cursor: 'pointer', transition: 'all 0.1s', flexShrink: 0,
            }}
          >{tab.label}</button>
        ))}
      </div>
      {/* Content */}
      <div style={{ padding: '14px 16px' }}>
        {tabs[active]?.content}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Diff — side-by-side code comparison (Go ↔ C++)
// ─────────────────────────────────────────────────────────────────────────────

export function Diff({
  before, after,
  beforeLabel = 'before', afterLabel = 'after',
}: {
  before: string
  after: string
  beforeLabel?: string
  afterLabel?: string
}) {
  const beforeLines = before.trim().split('\n')
  const afterLines  = after.trim().split('\n')

  function Side({ lines, label, isAfter }: { lines: string[]; label: string; isAfter?: boolean }) {
    return (
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{
          padding: '4px 10px', background: 'var(--surface-2)',
          borderBottom: '1px solid var(--border)',
          fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600,
          color: 'var(--fg-faint)', letterSpacing: '0.06em', textTransform: 'uppercase',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: isAfter ? 'var(--ok)' : 'var(--fg-faint)',
            display: 'inline-block', flexShrink: 0,
          }} />
          {label}
        </div>
        <div style={{ display: 'flex' }}>
          <div style={{ padding: '8px 0', minWidth: 28, textAlign: 'right', paddingRight: 7, paddingLeft: 6, borderRight: '1px solid var(--border)', userSelect: 'none', flexShrink: 0 }}>
            {lines.map((_, i) => (
              <div key={i} style={{ fontSize: 10, lineHeight: '1.65', color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)' }}>
                {i + 1}
              </div>
            ))}
          </div>
          <pre style={{ margin: 0, padding: '8px 12px', overflowX: 'auto', flex: 1 }}>
            <HighlightedCode code={lines.join('\n')} />
          </pre>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 6,
      overflow: 'hidden', marginBottom: 14, background: 'var(--surface-1)',
    }}>
      <div style={{ display: 'flex' }}>
        <Side lines={beforeLines} label={beforeLabel} />
        <div style={{ width: 1, background: 'var(--border)', flexShrink: 0 }} />
        <Side lines={afterLines}  label={afterLabel}  isAfter />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  ShortcutsTable — keyboard shortcut reference
// ─────────────────────────────────────────────────────────────────────────────

export function ShortcutsTable({ groups }: {
  groups: { label: string; shortcuts: { keys: string[]; desc: string }[] }[]
}) {
  const [hovered, setHovered] = useState<string | null>(null)

  function Kbd({ k }: { k: string }) {
    return (
      <kbd style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600,
        background: 'var(--surface-3)', border: '1px solid var(--border)',
        borderBottom: '2px solid var(--border)',
        borderRadius: 3, padding: '1px 5px',
        color: 'var(--fg-muted)',
        display: 'inline-block', lineHeight: 1.6,
      }}>{k}</kbd>
    )
  }

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 6,
      overflow: 'hidden', marginBottom: 14,
    }}>
      {groups.map((group, gi) => (
        <div key={gi}>
          <div style={{
            padding: '5px 10px', background: 'var(--surface-2)',
            borderBottom: '1px solid var(--border)',
            borderTop: gi > 0 ? '1px solid var(--border)' : undefined,
            fontSize: 9, fontWeight: 600, fontFamily: 'var(--font-mono)',
            color: 'var(--fg-faint)', letterSpacing: '0.07em', textTransform: 'uppercase',
          }}>
            {group.label}
          </div>
          {group.shortcuts.map((s, i) => {
            const id = `${gi}-${i}`
            return (
              <div
                key={i}
                onMouseEnter={() => setHovered(id)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '7px 12px',
                  borderBottom: i < group.shortcuts.length - 1 ? '1px solid var(--border)' : undefined,
                  background: hovered === id ? 'var(--surface-1)' : 'transparent',
                  transition: 'background 0.1s',
                }}
              >
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                  {s.keys.map((k, ki) => (
                    <React.Fragment key={ki}>
                      {ki > 0 && <span style={{ fontSize: 9, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)' }}>+</span>}
                      <Kbd k={k} />
                    </React.Fragment>
                  ))}
                </div>
                <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)' }}>
                  {s.desc}
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  TerminalBlock — styled terminal output with optional typing animation
// ─────────────────────────────────────────────────────────────────────────────

type TerminalLine =
  | { type: 'cmd';    text: string }
  | { type: 'out';    text: string }
  | { type: 'ok';     text: string }
  | { type: 'err';    text: string }
  | { type: 'muted';  text: string }

export function TerminalBlock({ lines, title = 'terminal' }: { lines: TerminalLine[]; title?: string }) {
  const [revealed, setRevealed] = useState(false)
  const [visibleCount, setVisibleCount] = useState(0)

  function run() {
    setRevealed(true)
    setVisibleCount(0)
    let i = 0
    const tick = () => {
      if (i < lines.length) {
        i++; setVisibleCount(i)
        setTimeout(tick, lines[i - 1]?.type === 'cmd' ? 120 : 60)
      }
    }
    tick()
  }

  function reset() { setRevealed(false); setVisibleCount(0) }

  const colorFor = (type: TerminalLine['type']) => {
    if (type === 'cmd')   return 'var(--fg)'
    if (type === 'ok')    return 'var(--ok)'
    if (type === 'err')   return 'var(--err)'
    if (type === 'muted') return 'var(--fg-faint)'
    return 'var(--fg-muted)'
  }

  const displayed = revealed ? lines.slice(0, visibleCount) : []

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 6,
      overflow: 'hidden', marginBottom: 14, background: 'var(--surface-1)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 10px', background: 'var(--surface-2)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['#e06c75','#e5c07b','#98c379'].map((c, i) => (
            <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: c, opacity: 0.5 }} />
          ))}
        </div>
        <span style={{ flex: 1, fontSize: 10, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
          {title}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {revealed && visibleCount === lines.length ? (
            <ToolBtn onClick={reset}>↺ reset</ToolBtn>
          ) : (
            <ToolBtn onClick={run} primary>▶ run</ToolBtn>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '10px 14px', minHeight: 60, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: '1.7' }}>
        {!revealed && (
          <span style={{ color: 'var(--fg-faint)', fontSize: 11 }}>— click run to execute —</span>
        )}
        {displayed.map((line, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            {line.type === 'cmd' && (
              <span style={{ color: 'var(--fg-faint)', flexShrink: 0 }}>$</span>
            )}
            {line.type !== 'cmd' && (
              <span style={{ width: 10, flexShrink: 0 }} />
            )}
            <span style={{ color: colorFor(line.type) }}>{line.text}</span>
          </div>
        ))}
        {revealed && visibleCount < lines.length && (
          <span style={{ color: 'var(--fg-faint)', animation: 'blink 1s step-start infinite' }}>▋</span>
        )}
      </div>
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  FileTree — interactive project structure visualizer
// ─────────────────────────────────────────────────────────────────────────────

type FileNode = {
  name: string
  type: 'dir' | 'file'
  desc?: string
  children?: FileNode[]
  highlight?: boolean
}

export function FileTree({ nodes, title = 'project structure' }: { nodes: FileNode[]; title?: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['root']))
  const [hovered, setHovered] = useState<string | null>(null)
  const [hoverDesc, setHoverDesc] = useState<string | null>(null)

  function toggle(path: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  function renderNodes(nodes: FileNode[], depth: number, parentPath: string) {
    return nodes.map((node, i) => {
      const path = `${parentPath}/${node.name}`
      const isOpen = expanded.has(path)
      const isHov  = hovered === path

      return (
        <div key={path}>
          <div
            onMouseEnter={() => { setHovered(path); setHoverDesc(node.desc ?? null) }}
            onMouseLeave={() => { setHovered(null); setHoverDesc(null) }}
            onClick={() => node.type === 'dir' && toggle(path)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '3px 10px',
              paddingLeft: 10 + depth * 14,
              cursor: node.type === 'dir' ? 'pointer' : 'default',
              background: isHov ? 'var(--surface-2)' : 'transparent',
              transition: 'background 0.08s',
            }}
          >
            {/* Indent lines */}
            {depth > 0 && (
              <div style={{ position: 'absolute', left: 10 + (depth - 1) * 14 + 5, top: 0, bottom: 0, width: 1, background: 'var(--border)' }} />
            )}

            {/* Icon */}
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-faint)', flexShrink: 0, width: 12, textAlign: 'center' }}>
              {node.type === 'dir' ? (isOpen ? '▾' : '▸') : '·'}
            </span>

            {/* Name */}
            <span style={{
              fontSize: 12, fontFamily: 'var(--font-mono)',
              color: node.highlight ? 'var(--fg)' : node.type === 'dir' ? 'var(--fg-muted)' : 'var(--fg-faint)',
              fontWeight: node.highlight ? 600 : 400,
              flex: 1,
            }}>
              {node.name}
              {node.type === 'dir' && '/'}
            </span>

            {/* Highlight badge */}
            {node.highlight && (
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--fg-muted)', flexShrink: 0 }} />
            )}
          </div>

          {/* Children */}
          {node.type === 'dir' && isOpen && node.children && (
            <div style={{ position: 'relative' }}>
              {renderNodes(node.children, depth + 1, path)}
            </div>
          )}
        </div>
      )
    })
  }

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 6,
      overflow: 'hidden', marginBottom: 14, background: 'var(--surface-1)',
    }}>
      <div style={{
        padding: '5px 10px', background: 'var(--surface-2)',
        borderBottom: '1px solid var(--border)',
        fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600,
        color: 'var(--fg-faint)', letterSpacing: '0.06em', textTransform: 'uppercase',
      }}>
        {title}
      </div>

      <div style={{ paddingTop: 6, paddingBottom: 6 }}>
        {renderNodes(nodes, 0, 'root')}
      </div>

      {hoverDesc && (
        <div style={{
          borderTop: '1px solid var(--border)',
          padding: '6px 10px',
          fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)',
          background: 'var(--surface-2)',
        }}>
          {hoverDesc}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  PropTable — function/API reference table
// ─────────────────────────────────────────────────────────────────────────────

export function PropTable({ rows }: {
  rows: { name: string; type: string; default?: string; desc: string }[]
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 6,
      overflow: 'hidden', marginBottom: 14,
    }}>
      {/* Header */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 80px 2fr',
        background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
      }}>
        {['name', 'type', 'default', 'description'].map(h => (
          <div key={h} style={{
            padding: '5px 10px', fontSize: 9, fontWeight: 600,
            color: 'var(--fg-faint)', textTransform: 'uppercase',
            letterSpacing: '0.06em', fontFamily: 'var(--font-mono)',
          }}>{h}</div>
        ))}
      </div>

      {rows.map((row, i) => (
        <div
          key={i}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(null)}
          style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 80px 2fr',
            borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none',
            background: hovered === i ? 'var(--surface-1)' : 'transparent',
            transition: 'background 0.08s',
          }}
        >
          <div style={{ padding: '7px 10px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--fg)', fontWeight: 600 }}>
            {row.name}
          </div>
          <div style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--syn-typ)' }}>
            {row.type}
          </div>
          <div style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--fg-faint)' }}>
            {row.default ?? '—'}
          </div>
          <div style={{ padding: '7px 10px', fontSize: 12, fontFamily: 'var(--font-sans)', color: 'var(--fg-muted)', lineHeight: 1.55 }}>
            {row.desc}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Demo page
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_CODE = `package main

import "arduino"

const ledPin = 13

func setup() {
    arduino.PinMode(ledPin, arduino.OUTPUT)
    arduino.Serial.Begin(9600)
    arduino.Serial.Println("Blink ready!")
}

func loop() {
    arduino.DigitalWrite(ledPin, arduino.HIGH)
    arduino.Delay(500)
    arduino.DigitalWrite(ledPin, arduino.LOW)
    arduino.Delay(500)
}`

export default function App() {
  const [lang, setLang] = useState<Lang>("en")
  const t = useCallback((k: StringKey) => STRINGS[lang][k] ?? STRINGS.en[k] ?? k, [lang])

  return (
    <I18nCtx.Provider value={{ lang, t, setLang }}>
      <div style={{
        background: "var(--surface)", color: "var(--fg)",
        minHeight: "100vh", padding: "0",
        fontFamily: "var(--font-sans)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "8px 16px",
          background: "var(--surface-1)",
          borderBottom: "1px solid var(--border)",
          position: "sticky", top: 0, zIndex: 10,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "-0.01em" }}>Docs — Component Preview</span>
          <div style={{ marginLeft: "auto" }}>
            <button
              onClick={() => setLang(l => l === "en" ? "es" : "en")}
              style={{
                border: "1px solid var(--border)", background: "transparent",
                color: "var(--fg-muted)", borderRadius: 4, padding: "2px 10px",
                fontSize: 11, fontFamily: "var(--font-mono)", cursor: "pointer",
              }}
            >
              {lang === "en" ? "EN → ES" : "ES → EN"}
            </button>
          </div>
        </div>

        <div style={{ maxWidth: 680, margin: "0 auto", padding: "28px 20px" }}>
          <SectionTitle n="01" title={lang === "en" ? "Code Block" : "Bloque de código"} />
          <p style={{ fontSize: 12, color: "var(--fg-muted)", marginBottom: 14, lineHeight: 1.65, fontFamily: "var(--font-sans)" }}>
            {lang === "en"
              ? "Copy with one click. Click Edit to modify and validate Go syntax."
              : "Copia con un clic. Pulsa Editar para modificar y validar la sintaxis Go."}
          </p>
          <CodeBlock lang="go" filename="src/main.go">{DEMO_CODE}</CodeBlock>

          <SectionTitle n="02" title={lang === "en" ? "Build Pipeline" : "Pipeline de compilación"} />
          <p style={{ fontSize: 12, color: "var(--fg-muted)", marginBottom: 14, lineHeight: 1.65, fontFamily: "var(--font-sans)" }}>
            {lang === "en"
              ? "Hover each step to see what it does. Click run to animate."
              : "Pasa el cursor sobre cada paso para ver qué hace."}
          </p>
          <BuildPipelineDiagram />

          <SectionTitle n="03" title={lang === "en" ? "Arduino Uno Pinout" : "Pinout del Arduino Uno"} />
          <p style={{ fontSize: 12, color: "var(--fg-muted)", marginBottom: 14, lineHeight: 1.65, fontFamily: "var(--font-sans)" }}>
            {lang === "en"
              ? "Hover any pin to see its mode, voltage, and special functions."
              : "Pasa el cursor sobre cualquier pin para ver su modo, voltaje y funciones."}
          </p>
          <AvrPinoutDiagram />
        </div>

        <style>{`
          @keyframes pulse-step {
            0%   { transform: scale(1); }
            50%  { transform: scale(1.08); }
            100% { transform: scale(1); }
          }
          @keyframes flow-dot {
            0%   { left: 0; opacity: 0; }
            20%  { opacity: 1; }
            80%  { opacity: 1; }
            100% { left: calc(100% - 6px); opacity: 0; }
          }
        `}</style>
      </div>
    </I18nCtx.Provider>
  )
}

function SectionTitle({ n, title }: { n: string; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, marginTop: 32 }}>
      <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--fg-faint)" }}>{n}</span>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--fg)", letterSpacing: "-0.01em" }}>{title}</h2>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  )
}