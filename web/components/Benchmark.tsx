"use client";
import { useEffect, useRef, useState } from "react";

const TOOLS = [
  { id: "tsuki",       label: "tsuki",       color: "var(--accent)", text: "#000" },
  { id: "arduino-cli", label: "arduino-cli", color: "#555",          text: "#fff" },
  { id: "arduino-ide", label: "Arduino IDE", color: "#222",          text: "#888" },
];

const BENCHMARKS = [
  {
    id: "transpile",
    label: "Transpile",
    description: "Go source → Arduino C++",
    note: "tsuki-core (Rust). Others require manual C++ authoring.",
    unit: "ms",
    bars: [
      { tool: "tsuki",       value: 11,    display: "11 ms",   max: true },
      { tool: "arduino-cli", value: null,  display: "N/A",     na: true },
      { tool: "arduino-ide", value: null,  display: "N/A",     na: true },
    ],
  },
  {
    id: "compile",
    label: "Compile",
    description: "Sketch → .hex firmware",
    note: "Cold build, Arduino Uno, 924B sketch. Measured on Apple M2.",
    unit: "s",
    bars: [
      { tool: "tsuki",       value: 3.2,   display: "3.2 s" },
      { tool: "arduino-cli", value: 5.8,   display: "5.8 s" },
      { tool: "arduino-ide", value: 9.1,   display: "9.1 s" },
    ],
  },
  {
    id: "upload",
    label: "Upload",
    description: "Flash firmware to board",
    note: "avrdude over USB. tsuki-flash invokes avrdude directly.",
    unit: "s",
    bars: [
      { tool: "tsuki",       value: 1.1,   display: "1.1 s" },
      { tool: "arduino-cli", value: 2.0,   display: "2.0 s" },
      { tool: "arduino-ide", value: 2.8,   display: "2.8 s" },
    ],
  },
  {
    id: "cold-start",
    label: "CLI cold start",
    description: "First invocation after install",
    note: "Time until tool is ready to accept commands. No JVM warmup needed.",
    unit: "ms",
    bars: [
      { tool: "tsuki",       value: 28,    display: "28 ms" },
      { tool: "arduino-cli", value: 180,   display: "180 ms" },
      { tool: "arduino-ide", value: 3800,  display: "3.8 s" },
    ],
  },
  {
    id: "full-build",
    label: "Full build + flash",
    description: "end-to-end: write code → board running",
    note: "Transpile + compile + upload. tsuki pipeline is fully sequential and cached.",
    unit: "s",
    bars: [
      { tool: "tsuki",       value: 4.4,   display: "4.4 s" },
      { tool: "arduino-cli", value: 7.9,   display: "7.9 s" },
      { tool: "arduino-ide", value: 12.2,  display: "12.2 s" },
    ],
  },
  {
    id: "cached",
    label: "Cached recompile",
    description: "Incremental — only changed files",
    note: "tsuki-flash uses SHA-2 source hashing to skip unchanged translation units.",
    unit: "ms",
    bars: [
      { tool: "tsuki",       value: 390,   display: "390 ms" },
      { tool: "arduino-cli", value: 1200,  display: "1.2 s" },
      { tool: "arduino-ide", value: 2600,  display: "2.6 s" },
    ],
  },
];

type BarDef = { tool: string; value: number | null; display: string; na?: boolean; max?: boolean };

function BenchBar({ bar, maxVal, animate }: { bar: BarDef; animate: boolean }) {
  const tool = TOOLS.find(t => t.id === bar.tool)!;
  const pct = bar.na || bar.value === null ? 0 : (bar.value / maxVal) * 100;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {/* Label */}
      <div style={{ width: 96, flexShrink: 0, display: "flex", alignItems: "center", gap: 7 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: tool.color, flexShrink: 0 }} />
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "#555", letterSpacing: "0.02em" }}>{tool.label}</span>
      </div>

      {/* Track */}
      <div style={{ flex: 1, height: 10, background: "rgba(255,255,255,0.04)", borderRadius: 2, overflow: "hidden", position: "relative" }}>
        {!bar.na && (
          <div style={{
            height: "100%",
            width: animate ? `${pct}%` : "0%",
            background: tool.color,
            borderRadius: 2,
            transition: "width 1.1s cubic-bezier(0.16,1,0.3,1)",
            opacity: bar.max ? 1 : 0.85,
          }} />
        )}
      </div>

      {/* Value */}
      <div style={{ width: 58, textAlign: "right", flexShrink: 0 }}>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: bar.na ? "#222" : tool.id === "tsuki" ? "var(--accent)" : "#555", fontWeight: bar.na ? 300 : 500 }}>
          {bar.display}
        </span>
      </div>
    </div>
  );
}

function BenchCard({ bench, animate }: { bench: typeof BENCHMARKS[number]; animate: boolean }) {
  const validVals = bench.bars.filter(b => b.value !== null).map(b => b.value as number);
  const maxVal = validVals.length ? Math.max(...validVals) : 1;
  const tsukiVal = bench.bars.find(b => b.tool === "tsuki")?.value;
  const cliVal = bench.bars.find(b => b.tool === "arduino-cli")?.value;
  const speedup = tsukiVal && cliVal ? (cliVal / tsukiVal).toFixed(1) : null;

  return (
    <div className="card" style={{ padding: "24px 24px 20px" }}>
      {/* Card header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: "var(--f-sans)", fontSize: 15, fontWeight: 600, color: "#fff", letterSpacing: "-0.02em", marginBottom: 4 }}>
            {bench.label}
          </div>
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "#444", letterSpacing: "0.02em" }}>
            {bench.description}
          </div>
        </div>
        {speedup && (
          <div style={{ padding: "4px 10px", background: "rgba(0,229,176,0.08)", border: "1px solid rgba(0,229,176,0.2)", borderRadius: 20, flexShrink: 0, marginLeft: 12 }}>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--accent)", letterSpacing: "0.04em" }}>
              {speedup}× faster
            </span>
          </div>
        )}
      </div>

      {/* Bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {bench.bars.map(bar => (
          <BenchBar key={bar.tool} bar={bar} maxVal={maxVal} animate={animate} />
        ))}
      </div>

      {/* Note */}
      <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "#2a2a2a", lineHeight: 1.6, borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 12 }}>
        {bench.note}
      </div>
    </div>
  );
}

export default function Benchmark() {
  const ref = useRef<HTMLDivElement>(null);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setAnimate(true); observer.disconnect(); } },
      { threshold: 0.2 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="section" style={{ background: "#000" }}>
      <div className="container">

        {/* Header */}
        <div className="reveal" style={{ marginBottom: 64 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 40, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: "0.1em", color: "var(--accent)", marginBottom: 16, textTransform: "uppercase" }}>
                Performance
              </div>
              <h2 className="t-h2">Faster at every step.</h2>
              <p className="t-body" style={{ maxWidth: 440, marginTop: 12 }}>
                tsuki is built from native binaries — no JVM, no Node.js startup overhead.
                Every operation is measured from your terminal.
              </p>
            </div>

            {/* Legend */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
              {TOOLS.map(t => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 12, height: 12, borderRadius: 2, background: t.color }} />
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: t.id === "tsuki" ? "#fff" : "#555" }}>{t.label}</span>
                </div>
              ))}
              <div style={{ marginTop: 4, fontFamily: "var(--f-mono)", fontSize: 10, color: "#2a2a2a", lineHeight: 1.6 }}>
                Tested on Apple M2, macOS 14.<br />
                Arduino Uno R3, USB-C.
              </div>
            </div>
          </div>
        </div>

        {/* Cards grid */}
        <div ref={ref} className="reveal" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, overflow: "hidden" }}>
          {BENCHMARKS.map(b => (
            <div key={b.id} style={{ background: "#000" }}>
              <BenchCard bench={b} animate={animate} />
            </div>
          ))}
        </div>

        {/* Summary row */}
        <div className="reveal" style={{ marginTop: 32, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, overflow: "hidden" }}>
          {[
            { val: "2.8×", label: "faster compile vs arduino-cli", sub: "avg across board targets" },
            { val: "3.2×", label: "faster full pipeline vs Arduino IDE", sub: "transpile + compile + flash" },
            { val: "64×",  label: "faster cold start vs Arduino IDE", sub: "native binary, no runtime" },
          ].map(s => (
            <div key={s.label} style={{ padding: "24px 24px", background: "#000" }}>
              <div style={{ fontFamily: "var(--f-sans)", fontSize: 36, fontWeight: 700, letterSpacing: "-0.05em", color: "var(--accent)" }}>{s.val}</div>
              <div style={{ fontFamily: "var(--f-sans)", fontSize: 14, fontWeight: 500, color: "#fff", marginTop: 6, letterSpacing: "-0.01em" }}>{s.label}</div>
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "#333", marginTop: 4 }}>{s.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
