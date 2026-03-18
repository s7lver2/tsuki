"use client";
import { useState } from "react";

type Token = [string, string];
type CodeLine = Token[] | null;

// Code matching the screenshot exactly
const GO_CODE: CodeLine[] = [
  [["go-kw","package"],["go-id"," main"]],
  null,
  [["go-kw","import"],["go-id"," "],["go-str",'"arduino"']],
  null,
  [["go-kw","const"],["go-id"," ledPin = "],["go-num","10"]],
  [["go-kw","const"],["go-id"," interval = "],["go-num","500"],["go-cm","  // ms"]],
  [["go-kw","const"],["go-id"," test = "],["go-num","20"]],
  null,
  [["go-kw","func"],["go-id"," "],["go-fn","setup"],["go-id","() {"]],
  [["go-id","    "],["go-pkg","arduino"],["go-id","."],["go-fn","PinMode"],["go-id","(ledPin, "],["go-pkg","arduino"],["go-id",".OUTPUT)"]],
  [["go-id","    "],["go-pkg","arduino"],["go-id","."],["go-pkg","Serial"],["go-id","."],["go-fn","Begin"],["go-id","("],["go-num","9600"],["go-id",")"]],
  [["go-id","    "],["go-pkg","arduino"],["go-id","."],["go-pkg","Serial"],["go-id","."],["go-fn","Println"],["go-id","("],["go-str",'"Blink ready!"'],["go-id",")"]],
  [["go-id","}"]],
  null,
  [["go-kw","func"],["go-id"," "],["go-fn","loop"],["go-id","() {"]],
  [["go-id","    "],["go-pkg","arduino"],["go-id","."],["go-fn","DigitalWrite"],["go-id","(ledPin, "],["go-pkg","arduino"],["go-id",".HIGH)"]],
  [["go-id","    "],["go-pkg","arduino"],["go-id","."],["go-fn","Delay"],["go-id","(interval)"]],
  [["go-id","    "],["go-pkg","arduino"],["go-id","."],["go-fn","DigitalWrite"],["go-id","(ledPin, "],["go-pkg","arduino"],["go-id",".LOW)"]],
  [["go-id","    "],["go-pkg","arduino"],["go-id","."],["go-fn","Delay"],["go-id","(interval)"]],
  [["go-id","}"]],
];

const SIDEBAR_FILES = [
  { name: ".gitignore",         type: "text",   depth: 0 },
  { name: "build",              type: "folder", depth: 0 },
  { name: "uwu",                type: "folder", depth: 1 },
  { name: "src",                type: "folder", depth: 0, open: true },
  { name: "main.go",            type: "go",     depth: 1, active: true },
  { name: "tsuki_package.json", type: "json",   depth: 0 },
];

const LOG_LINES = [
  { c: "#333", t: "19:15:24  Opened \"uwu\" from C:\\Users\\NICKE\\Desktop\\Projects\\GoDotIno\\test\\uwu" },
  { c: "var(--accent)", t: "19:15:26  Ready." },
];

const SANDBOX_COMPONENTS = [
  { section: "MICROCONTROLLERS", items: [
    { color: "#22c55e", label: "Arduino Uno" },
    { color: "#dc143c", label: "Arduino Nano" },
  ]},
  { section: "OUTPUT", items: [
    { color: "#ef4444", label: "LED" },
    { color: "#f97316", label: "RGB LED" },
    { color: null,      label: "Buzzer" },
  ]},
  { section: "INPUT", items: [
    { color: "#888",    label: "Button" },
    { color: "#888",    label: "Potentiometer" },
  ]},
  { section: "PASSIVE", items: [
    { color: "#f59e0b", label: "Resistor" },
    { color: "#888",    label: "Capacitor" },
    { color: null,      label: "NPN BJT" },
  ]},
  { section: "POWER", items: [
    { color: "#ef4444", label: "VCC" },
    { color: null,      label: "GND" },
    { color: null,      label: "Power Rail" },
  ]},
];

// Minimal Arduino Uno SVG board
function ArduinoUnoBoard() {
  return (
    <svg viewBox="0 0 120 170" style={{ width: "100%", maxWidth: 120 }}>
      {/* PCB body */}
      <rect x="4" y="10" width="112" height="150" rx="6" fill="#1a472a" stroke="#166534" strokeWidth="1" />
      {/* USB connector */}
      <rect x="36" y="2" width="48" height="16" rx="3" fill="#334155" stroke="#475569" strokeWidth="0.8" />
      <rect x="42" y="5" width="36" height="10" rx="2" fill="#1e293b" />
      {/* Power jack */}
      <rect x="4" y="120" width="14" height="20" rx="2" fill="#292524" stroke="#44403c" strokeWidth="0.8" />
      <circle cx="11" cy="130" r="4" fill="#1c1917" stroke="#57534e" strokeWidth="0.5" />
      {/* MCU chip */}
      <rect x="34" y="62" width="52" height="52" rx="3" fill="#0f172a" stroke="#1e293b" strokeWidth="1" />
      <text x="60" y="91" textAnchor="middle" fontSize="7" fill="#334155" fontFamily="monospace">ATmega</text>
      <text x="60" y="101" textAnchor="middle" fontSize="7" fill="#334155" fontFamily="monospace">328P</text>
      {/* Pin headers — left */}
      {Array.from({length: 14}, (_, i) => (
        <rect key={`l${i}`} x="6" y={18 + i * 9} width="6" height="5" rx="1" fill="#78716c" />
      ))}
      {/* Pin headers — right */}
      {Array.from({length: 14}, (_, i) => (
        <rect key={`r${i}`} x="108" y={18 + i * 9} width="6" height="5" rx="1" fill="#78716c" />
      ))}
      {/* Power LED */}
      <circle cx="88" cy="22" r="3" fill="#22c55e" style={{ filter: "drop-shadow(0 0 3px #22c55e)" }} />
      <text x="88" y="33" textAnchor="middle" fontSize="5" fill="#166534" fontFamily="monospace">PWR</text>
      {/* L LED (pin 13 — accent/fuchsia) */}
      <circle cx="74" cy="22" r="3" fill="#dc143c" style={{ filter: "drop-shadow(0 0 3px #dc143c)" }} />
      <text x="74" y="33" textAnchor="middle" fontSize="5" fill="#7e22ce" fontFamily="monospace">L</text>
      {/* Crystal */}
      <rect x="20" y="72" width="10" height="18" rx="2" fill="#92400e" stroke="#78350f" strokeWidth="0.5" />
      {/* Voltage regulator */}
      <rect x="20" y="100" width="10" height="12" rx="1" fill="#1e3a5f" stroke="#1e40af" strokeWidth="0.5" />
      {/* ICSP header */}
      <rect x="55" y="145" width="16" height="12" rx="1" fill="#1c1917" stroke="#292524" strokeWidth="0.5" />
      {Array.from({length: 6}, (_, i) => (
        <circle key={`icsp${i}`} cx={58 + (i % 2) * 5} cy={148 + Math.floor(i / 2) * 4} r="1.2" fill="#78716c" />
      ))}
      {/* Board label */}
      <text x="60" y="157" textAnchor="middle" fontSize="5.5" fill="#166534" fontFamily="monospace" fontWeight="bold">Arduino Uno1</text>
    </svg>
  );
}

function EditorLine({ line, n, highlight }: { line: CodeLine; n: number; highlight?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 16, padding: "1.5px 16px", background: highlight ? "rgba(255,255,255,0.025)" : "transparent" }}>
      <span style={{ minWidth: 22, textAlign: "right", color: "#2a2a2a", userSelect: "none", flexShrink: 0, fontFamily: "var(--f-mono)", fontSize: 11.5 }}>{n}</span>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 12.5, lineHeight: "20px" }}>
        {line ? line.map(([cls, txt], i) => <span key={i} className={cls}>{txt}</span>) : null}
      </span>
    </div>
  );
}

const ACTION_BUTTONS = [
  { label: "Check",   icon: "✓",  active: false },
  { label: "Build",   icon: "⚙",  active: false },
  { label: "Flash",   icon: "⬡",  active: false },
  { label: "Run",     icon: "▶",  active: true  },
  { label: "Monitor", icon: "≋",  active: false },
];

export default function IdeShowcase() {
  const [sandboxTab, setSandboxTab] = useState<"components" | "circuit">("circuit");

  return (
    <section id="ide" className="section">
      <div className="container">

        {/* Header */}
        <div className="reveal" style={{ marginBottom: 68, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, alignItems: "end" }}>
          <div>
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: "0.1em", color: "var(--accent)", marginBottom: 16, textTransform: "uppercase" }}>
              tsuki-ide
            </div>
            <h2 className="t-h2">A full IDE.<br />Built for developers.</h2>
          </div>
          <div>
            <p className="t-body" style={{ fontSize: 15 }}>
              All your needs in one tool — circuit simulation, git integration, librarie managment, project exports, etc
            </p>
          </div>
        </div>

        {/* IDE window */}
        <div className="reveal ide-frame">

          {/* Titlebar */}
          <div style={{
            height: 44, background: "#060606",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            display: "flex", alignItems: "center", padding: "0 14px", gap: 12,
          }}>
            {/* Traffic lights */}
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginRight: 8 }}>
              {["#ff5f57","#ffbd2e","#28c840"].map(c => (
                <div key={c} style={{ width: 11, height: 11, borderRadius: "50%", background: c, opacity: 0.9 }} />
              ))}
            </div>

            {/* App title */}
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "#555", letterSpacing: "0.04em" }}>Tsuki IDE</span>

            {/* Board chip */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4 }}>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "#666" }}>uno</span>
              <span style={{ fontSize: 8, color: "#444" }}>▾</span>
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 2, marginLeft: 4 }}>
              {ACTION_BUTTONS.map(btn => (
                <button key={btn.label} style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "4px 12px", borderRadius: 5, cursor: "pointer",
                  fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: "0.02em",
                  background: btn.active ? "rgba(224,64,251,0.12)" : "transparent",
                  border: `1px solid ${btn.active ? "rgba(224,64,251,0.3)" : "transparent"}`,
                  color: btn.active ? "var(--accent)" : "#444",
                  transition: "all 0.15s",
                }}>
                  <span style={{ fontSize: btn.label === "Run" ? 10 : 11 }}>{btn.icon}</span>
                  {btn.label}
                </button>
              ))}
            </div>

            {/* Right: Sandbox toggle */}
            <div style={{ marginLeft: "auto" }}>
              <button style={{
                padding: "4px 14px", borderRadius: 5,
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                fontFamily: "var(--f-mono)", fontSize: 11, color: "#555", cursor: "pointer",
              }}>
                Sandbox
              </button>
            </div>
          </div>

          {/* Body */}
          <div style={{ display: "flex", height: 490 }}>

            {/* Activity bar */}
            <div style={{ width: 42, borderRight: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 8, gap: 2 }}>
              {[["⊞","Files",true],["⑂","Git",false],["◈","Pkgs",false],["⊛","Cfg",false]].map(([icon, label, act]) => (
                <div key={label as string} title={label as string} style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, fontSize: 14, color: act ? "#ccc" : "#252525", background: act ? "rgba(255,255,255,0.06)" : "transparent", cursor: "pointer" }}>
                  {icon}
                </div>
              ))}
            </div>

            {/* File tree */}
            <div style={{ width: 180, borderRight: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, background: "#060606" }}>
              <div style={{ padding: "7px 12px", fontFamily: "var(--f-mono)", fontSize: 9, letterSpacing: "0.1em", color: "#2a2a2a", borderBottom: "1px solid rgba(255,255,255,0.05)", textTransform: "uppercase" }}>Explorer</div>
              <div style={{ padding: "5px 10px 3px", fontFamily: "var(--f-mono)", fontSize: 10, color: "#333", letterSpacing: "0.04em" }}>▾ UWU</div>
              {SIDEBAR_FILES.map((f, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "2.5px 10px", paddingLeft: 10 + f.depth * 12,
                  background: f.active ? "rgba(224,64,251,0.06)" : "transparent",
                  borderLeft: f.active ? "1px solid var(--accent)" : "1px solid transparent",
                  cursor: "pointer",
                }}>
                  <span style={{ fontSize: 8, color: "#252525" }}>{f.type === "folder" ? (f.open ? "▾" : "▸") : "·"}</span>
                  <span style={{
                    fontFamily: "var(--f-mono)", fontSize: 11,
                    color: f.active ? "#ddd" : f.type === "folder" ? "#444" : "#383838",
                  }}>{f.name}</span>
                </div>
              ))}
            </div>

            {/* Code editor */}
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 0", background: "#080808" }}>
              {/* Editor tab */}
              <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: 4 }}>
                <div style={{ padding: "0 18px", height: 32, display: "flex", alignItems: "center", gap: 7, fontFamily: "var(--f-mono)", fontSize: 11, color: "#ccc", background: "rgba(255,255,255,0.03)", borderBottom: "1px solid var(--accent)", marginBottom: -1 }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)" }} />
                  main.go
                </div>
              </div>
              {GO_CODE.map((line, i) => (
                <EditorLine key={i} line={line} n={i + 1} highlight={i >= 14 && i <= 19} />
              ))}
            </div>

            {/* Sandbox panel */}
            <div style={{ width: 280, borderLeft: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, display: "flex", flexDirection: "column", background: "#060606" }}>
              {/* Sandbox header tabs */}
              <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)", height: 36, alignItems: "flex-end" }}>
                {(["components","circuit"] as const).map(tab => (
                  <button key={tab} onClick={() => setSandboxTab(tab)} style={{
                    padding: "0 14px", height: 36, display: "flex", alignItems: "center",
                    fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase",
                    color: sandboxTab === tab ? "#ccc" : "#2a2a2a",
                    background: "transparent", border: "none", cursor: "pointer",
                    borderBottom: `1px solid ${sandboxTab === tab ? "var(--accent)" : "transparent"}`,
                    marginBottom: -1,
                  }}>{tab}</button>
                ))}
                <div style={{ marginLeft: "auto", padding: "0 12px", display: "flex", alignItems: "center" }}>
                  <button style={{ padding: "3px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 4, fontFamily: "var(--f-mono)", fontSize: 10, color: "#444", cursor: "pointer" }}>
                    New Circuit
                  </button>
                </div>
              </div>

              {sandboxTab === "components" ? (
                /* Component list */
                <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
                  {SANDBOX_COMPONENTS.map(group => (
                    <div key={group.section}>
                      <div style={{ padding: "8px 14px 4px", fontFamily: "var(--f-mono)", fontSize: 8.5, letterSpacing: "0.1em", color: "#252525", textTransform: "uppercase" }}>
                        {group.section}
                      </div>
                      {group.items.map(item => (
                        <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 14px", cursor: "pointer" }}
                          onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        >
                          <div style={{ width: 7, height: 7, borderRadius: "50%", background: item.color ?? "#2a2a2a", flexShrink: 0 }} />
                          <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "#444" }}>{item.label}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                /* Circuit view — Arduino Uno board */
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 16px", gap: 16, overflowY: "auto" }}>
                  {/* Component list on left + board on right, mimicking screenshot */}
                  <div style={{ display: "flex", width: "100%", gap: 12 }}>
                    {/* Mini component list */}
                    <div style={{ flex: 1 }}>
                      {SANDBOX_COMPONENTS.map(group => (
                        <div key={group.section}>
                          <div style={{ padding: "6px 0 2px", fontFamily: "var(--f-mono)", fontSize: 8, letterSpacing: "0.1em", color: "#1e1e1e", textTransform: "uppercase" }}>
                            {group.section}
                          </div>
                          {group.items.map(item => (
                            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 5, padding: "2px 0", cursor: "pointer" }}>
                              <div style={{ width: 6, height: 6, borderRadius: "50%", background: item.color ?? "#2a2a2a", flexShrink: 0 }} />
                              <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "#333" }}>{item.label}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    {/* Board SVG */}
                    <div style={{ flexShrink: 0, width: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 4 }}>
                      <ArduinoUnoBoard />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Output panel */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", background: "#050505" }}>
            <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              {["Output","Problems","Terminal"].map((t, i) => (
                <div key={t} style={{ padding: "6px 16px", fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.06em", color: i === 0 ? "#aaa" : "#252525", borderBottom: i === 0 ? "1px solid var(--accent)" : "1px solid transparent", marginBottom: -1, cursor: "pointer" }}>
                  {t}
                </div>
              ))}
            </div>
            <div style={{ padding: "8px 0", minHeight: 52 }}>
              {LOG_LINES.map((l, i) => (
                <div key={i} style={{ padding: "1.5px 16px", fontFamily: "var(--f-mono)", fontSize: 11.5, lineHeight: "18px", color: l.c }}>{l.t}</div>
              ))}
            </div>
          </div>

          {/* Status bar */}
          <div style={{ height: 24, background: "#040404", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px" }}>
            <div style={{ display: "flex", gap: 20 }}>
              {[{ c: "var(--accent)", t: "⬡ uno · ATmega328P" }, { c: "#252525", t: "⚠ 0 errors" }].map(s => (
                <span key={s.t} style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: s.c }}>{s.t}</span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 20 }}>
              {["Go","UTF-8","Ln 12, Col 1"].map(s => (
                <span key={s} style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "#252525" }}>{s}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Pills */}
        <div className="reveal" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 20, justifyContent: "center" }}>
          {["Monaco editor","Syntax highlighting","File tree","Git panel","Package manager","Serial monitor","Live C++ preview","Themes","Auto-save","Sandbox simulator"].map(p => (
            <span key={p} style={{ padding: "4px 12px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, fontFamily: "var(--f-mono)", fontSize: 11, color: "#3a3a3a" }}>{p}</span>
          ))}
        </div>
      </div>
    </section>
  );
}