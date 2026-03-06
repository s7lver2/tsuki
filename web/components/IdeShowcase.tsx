"use client";
import { useState } from "react";

type Token = [string, string];
type CodeLine = Token[] | null;

const GO_CODE: CodeLine[] = [
  [["go-kw","package"],["go-id"," main"]],
  null,
  [["go-kw","import"],["go-id"," ("]],
  [["go-id","    "],["go-str",'"arduino"']],
  [["go-id","    "],["go-str",'"fmt"']],
  [["go-id","    "],["go-str",'"time"']],
  [["go-id",")"]],
  null,
  [["go-cm","// onboard LED pin"]],
  [["go-kw","const"],["go-id"," LED = "],["go-num","13"]],
  null,
  [["go-kw","func"],["go-id"," "],["go-fn","setup"],["go-id","() {"]],
  [["go-id","    "],["go-pkg","arduino"],["go-id","."],["go-fn","pinMode"],["go-id","(LED, "],["go-pkg","arduino"],["go-id",".OUTPUT)"]],
  [["go-id","    "],["go-pkg","fmt"],["go-id","."],["go-fn","Println"],["go-id","("],["go-str",'"tsuki 月 ready"'],["go-id",")"]],
  [["go-id","}"]],
  null,
  [["go-kw","func"],["go-id"," "],["go-fn","loop"],["go-id","() {"]],
  [["go-id","    "],["go-pkg","arduino"],["go-id","."],["go-fn","digitalWrite"],["go-id","(LED, "],["go-pkg","arduino"],["go-id",".HIGH)"]],
  [["go-id","    "],["go-pkg","time"],["go-id","."],["go-fn","Sleep"],["go-id","("],["go-num","500"],["go-id",")"]],
  [["go-id","    "],["go-pkg","arduino"],["go-id","."],["go-fn","digitalWrite"],["go-id","(LED, "],["go-pkg","arduino"],["go-id",".LOW)"]],
  [["go-id","    "],["go-pkg","time"],["go-id","."],["go-fn","Sleep"],["go-id","("],["go-num","500"],["go-id",")"]],
  [["go-id","}"]],
];

const LOG_LINES = [
  { c:"#444", t:"$ tsuki build --board uno --compile" },
  { c:"var(--accent)", t:"  月 tsuki v0.1.0" },
  { c:"#333", t:"  ─────────────────────────────────" },
  { c:"#555", t:"  → transpiling  src/main.go" },
  { c:"var(--accent)", t:"  ✓ transpile     11ms" },
  { c:"#555", t:"  → compiling     build/main/" },
  { c:"var(--accent)", t:"  ✓ compile       3.2s" },
  { c:"#333", t:"" },
  { c:"var(--accent)", t:"  ✓ build complete" },
  { c:"#444", t:"    binary: 924B / 32256B  (2%)" },
  { c:"#444", t:"    ram:      9B / 2048B   (0%)" },
];

const SIDEBAR = [
  { name: "src",               type: "folder", depth: 0 },
  { name: "main.go",           type: "go",     depth: 1, active: true },
  { name: "sensor.go",         type: "go",     depth: 1 },
  { name: "build",             type: "folder", depth: 0 },
  { name: "tsuki_package.json",type: "json",   depth: 0 },
  { name: ".gitignore",        type: "text",   depth: 0 },
];

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

export default function IdeShowcase() {
  const [activeTab, setActiveTab] = useState("main.go");

  return (
    <section className="section">
      <div className="container">

        {/* Header */}
        <div className="reveal" style={{ marginBottom: 56, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, alignItems: "end" }}>
          <div>
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: "0.1em", color: "var(--accent)", marginBottom: 16, textTransform: "uppercase" }}>
              tsuki-ide
            </div>
            <h2 className="t-h2">A full IDE.<br />Built for firmware.</h2>
          </div>
          <div>
            <p className="t-body" style={{ fontSize: 15 }}>
              Desktop application built with Tauri + Next.js. Monaco editor, file tree, git panel,
              package manager, serial monitor, and an Arduino sandbox simulator — all native performance.
            </p>
          </div>
        </div>

        {/* IDE window */}
        <div className="reveal ide-frame">

          {/* Titlebar */}
          <div style={{ height: 44, background: "#080808", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", padding: "0 16px", gap: 0, position: "relative" }}>
            <div style={{ display: "flex", gap: 7, alignItems: "center", marginRight: 16 }}>
              {["#ff5f57","#ffbd2e","#28c840"].map(c => <div key={c} style={{ width: 12, height: 12, borderRadius: "50%", background: c, opacity: 0.9 }} />)}
            </div>

            {/* Tabs */}
            <div style={{ display: "flex" }}>
              {["main.go", "sensor.go"].map(tab => (
                <div key={tab} onClick={() => setActiveTab(tab)} style={{ padding: "0 20px", height: 44, display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--f-mono)", fontSize: 12, color: activeTab === tab ? "#fff" : "#444", background: activeTab === tab ? "rgba(255,255,255,0.04)" : "transparent", borderBottom: `1px solid ${activeTab === tab ? "var(--accent)" : "transparent"}`, cursor: "pointer", userSelect: "none" }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: activeTab === tab ? "var(--accent)" : "#333" }} />
                  {tab}
                </div>
              ))}
            </div>

            {/* Board selector */}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", background: "rgba(0,229,176,0.07)", border: "1px solid rgba(0,229,176,0.18)", borderRadius: 6 }}>
              <span style={{ fontSize: 10, color: "var(--accent)" }}>⬡</span>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--accent)" }}>Arduino Uno</span>
              <span style={{ fontSize: 9, color: "var(--accent)", opacity: 0.5 }}>▾</span>
            </div>
          </div>

          {/* Body */}
          <div style={{ display: "flex", height: 460 }}>

            {/* Activity bar */}
            <div style={{ width: 44, borderRight: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 8, gap: 2 }}>
              {[["⊞","Files",true],["⑂","Git",false],["◈","Pkgs",false],["⊛","Cfg",false]].map(([icon, label, active]) => (
                <div key={label as string} title={label as string} style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, fontSize: 15, color: active ? "#fff" : "#2a2a2a", background: active ? "rgba(255,255,255,0.07)" : "transparent", cursor: "pointer" }}>
                  {icon}
                </div>
              ))}
            </div>

            {/* File sidebar */}
            <div style={{ width: 190, borderRight: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
              <div style={{ padding: "8px 12px", fontFamily: "var(--f-mono)", fontSize: 9, letterSpacing: "0.1em", color: "#2a2a2a", borderBottom: "1px solid rgba(255,255,255,0.06)", textTransform: "uppercase" }}>Explorer</div>
              <div style={{ padding: "6px 10px 4px", fontFamily: "var(--f-mono)", fontSize: 10, color: "#333", letterSpacing: "0.04em" }}>▸ BLINK-PROJECT</div>
              {SIDEBAR.map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 10px", paddingLeft: 10 + f.depth * 14, background: f.active ? "rgba(0,229,176,0.06)" : "transparent", borderLeft: f.active ? "1px solid var(--accent)" : "1px solid transparent", cursor: "pointer" }}
                  onMouseEnter={e => { if (!f.active) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                  onMouseLeave={e => { if (!f.active) e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ fontSize: 9, color: "#2a2a2a" }}>{f.type === "folder" ? "▾" : "·"}</span>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: f.active ? "#fff" : f.type === "folder" ? "#555" : "#444" }}>{f.name}</span>
                </div>
              ))}
            </div>

            {/* Code editor */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 0" }}>
              {GO_CODE.map((line, i) => (
                <EditorLine key={i} line={line} n={i + 1} highlight={i >= 16 && i <= 21} />
              ))}
            </div>
          </div>

          {/* Output panel */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", background: "#050505" }}>
            <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              {["OUTPUT","TERMINAL","PROBLEMS"].map((t, i) => (
                <div key={t} style={{ padding: "7px 18px", fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.07em", color: i === 0 ? "#ccc" : "#2a2a2a", borderBottom: i === 0 ? "1px solid var(--accent)" : "1px solid transparent", marginBottom: -1, cursor: "pointer" }}>
                  {t}
                </div>
              ))}
            </div>
            <div style={{ padding: "10px 0" }}>
              {LOG_LINES.map((l, i) => (
                <div key={i} style={{ padding: "1.5px 16px", fontFamily: "var(--f-mono)", fontSize: 12, lineHeight: "18px", color: l.c }}>{l.t}</div>
              ))}
            </div>
          </div>

          {/* Status bar */}
          <div style={{ height: 26, background: "#050505", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px" }}>
            <div style={{ display: "flex", gap: 20 }}>
              {[{ c: "var(--accent)", t: "⬡ uno · ATmega328P" }, { c: "#2a2a2a", t: "⚠ 0 errors" }].map(s => (
                <span key={s.t} style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: s.c }}>{s.t}</span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 20 }}>
              {["Go","UTF-8","Ln 18"].map(s => (
                <span key={s} style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "#2a2a2a" }}>{s}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Pills */}
        <div className="reveal" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 20, justifyContent: "center" }}>
          {["Monaco editor","Syntax highlighting","File tree","Git panel","Package manager","Serial monitor","Sandbox simulator","Live C++ preview","Themes","Auto-save"].map(p => (
            <span key={p} style={{ padding: "4px 12px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, fontFamily: "var(--f-mono)", fontSize: 11, color: "#444" }}>{p}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
