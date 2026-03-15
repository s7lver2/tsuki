"use client";
import { useState, useEffect, useRef } from "react";

const STEPS = [
  {
    icon: "⌘",
    label: "tsuki build",
    tag: "CLI · Go",
    color: "#e879f9",
    desc: "Entry point. Reads tsuki_package.json, resolves flags, coordinates the build pipeline.",
    log: "$ tsuki build --board uno --compile",
  },
  {
    icon: "◈",
    label: "tsuki-core",
    tag: "Transpiler · Rust",
    color: "var(--ok)",
    desc: "Lexes, parses, and transpiles your code into native cpp, with native libraries support",
    log: "  ✓ transpile   src/main.go → build/main/main.cpp   11ms",
  },
  {
    icon: "⚙",
    label: "tsuki-flash",
    tag: "Compiler · Rust",
    color: "var(--accent2)",
    desc: "compile and prepare the cores for upload your code",
    log: "  ✓ compile     build/main/ → firmware.hex   3.2s",
  },
  {
    icon: "▲",
    label: "tsuki-flash cores",
    tag: "Flash · native",
    color: "var(--accent)",
    desc: "Uploads firmware over USB. Board auto-detected",
    log: "  ✓ upload      /dev/cu.usbmodem · 1.1s",
  },
];

export default function Pipeline() {
  const [active, setActive]   = useState(-1);
  const [running, setRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = () => {
    if (running) return;
    setRunning(true);
    setActive(-1);
    let i = 0;
    const next = () => {
      setActive(i);
      i++;
      if (i < STEPS.length) timerRef.current = setTimeout(next, 900);
      else setTimeout(() => setRunning(false), 700);
    };
    timerRef.current = setTimeout(next, 200);
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <section id="pipeline" className="section" style={{ background: "var(--black)" }}>
      <div className="container">

        <div className="reveal" style={{ marginBottom: 68, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 24 }}>
          <div>
            <div className="t-label" style={{ color: "var(--accent)", marginBottom: 14 }}>Build pipeline</div>
            <h2 className="t-h2">From source to board.<br /><span style={{ color: "var(--fg-f)" }}>One command.</span></h2>
          </div>
          <button onClick={run} disabled={running} style={{
            padding: "9px 24px", background: running ? "var(--s2)" : "rgba(0,229,176,0.1)",
            border: `1px solid ${running ? "var(--border)" : "rgba(0,229,176,0.3)"}`,
            borderRadius: 7, fontFamily: "var(--f-mono)", fontSize: 12, letterSpacing: "0.05em",
            color: running ? "var(--fg-f)" : "var(--accent)", cursor: running ? "not-allowed" : "pointer", transition: "all 0.2s",
          }}>
            {running ? "Running…" : "▶ Simulate build"}
          </button>
        </div>

        <div className="reveal" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>

          {/* steps */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {STEPS.map((s, i) => {
              const lit = active >= i;
              return (
                <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  {/* connector */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, marginTop: 3 }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", border: `1px solid ${lit ? s.color : "var(--border)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: lit ? s.color : "var(--fg-f)", background: lit ? `${s.color}12` : "var(--s2)", transition: "all 0.35s", boxShadow: lit ? `0 0 16px ${s.color}30` : "none" }}>
                      {s.icon}
                    </div>
                    {i < STEPS.length - 1 && (
                      <div style={{ width: 1, height: 18, background: lit && active > i ? s.color : "var(--border)", opacity: lit && active > i ? 0.5 : 0.3, transition: "all 0.35s", marginTop: 4 }} />
                    )}
                  </div>
                  {/* content */}
                  <div style={{ flex: 1, paddingBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontFamily: "var(--f-sans)", fontSize: 14, fontWeight: 600, color: lit ? "var(--fg)" : "var(--fg-f)", transition: "color 0.3s" }}>{s.label}</span>
                      <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: lit ? s.color : "var(--fg-f)", opacity: 0.7, letterSpacing: "0.04em", transition: "color 0.3s" }}>{s.tag}</span>
                    </div>
                    <p style={{ fontFamily: "var(--f-sans)", fontSize: 13, color: lit ? "var(--fg-m)" : "var(--fg-f)", lineHeight: 1.6, transition: "color 0.3s" }}>{s.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* terminal log */}
          <div style={{ background: "var(--black)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", fontFamily: "var(--f-mono)", fontSize: 12 }}>
            <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 6, background: "#060608" }}>
              <span className={`led ${running ? "led-green" : active >= 0 ? "led-green" : "led-off"}`} style={{ width: 6, height: 6 }} />
              <span className="t-label">tsuki build output</span>
            </div>
            <div style={{ padding: "12px 16px", minHeight: 240 }}>
              {STEPS.slice(0, active + 1).map((s, i) => (
                <div key={i} style={{ padding: "2px 0", color: i === active ? s.color : "var(--fg-f)", lineHeight: 1.7, transition: "color 0.3s" }}>
                  {s.log}
                </div>
              ))}
              {active < 0 && (
                <span style={{ color: "var(--s4)" }}>Press "Simulate build" to run the pipeline…</span>
              )}
              {active === STEPS.length - 1 && !running && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--edge)", color: "var(--accent)" }}>
                  ✓ done — board is running your firmware
                </div>
              )}
              {running && (
                <span className="cursor-blink" style={{ color: "var(--accent)" }}>_</span>
              )}
            </div>
            <div style={{ padding: "8px 14px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", background: "#060608" }}>
              <span className="t-label">total: {active >= 0 ? `${((active + 1) * 0.9).toFixed(1)}s` : "—"}</span>
              <span className="t-label">board: Arduino Uno · ATmega328P</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}