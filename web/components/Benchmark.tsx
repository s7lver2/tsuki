"use client";
import { useEffect, useRef, useState } from "react";

/* ── data ── */
const BENCHMARKS = [
  {
    id: "transpile",  label: "Transpile",
    description: "Go source → Arduino C++",
    note: "tsuki-core (Rust). Others require manual authoring.",
    speed:   { tsuki: 97, cli: 0,  ide: 0  },   // relative speed score 0-100
    ram:     { tsuki: 8,  cli: 42, ide: 110 },   // MB
    cpu:     { tsuki: 12, cli: 0,  ide: 0  },    // % peak
    time:    { tsuki: "11 ms", cli: "—", ide: "—" },
  },
  {
    id: "compile",    label: "Compile",
    description: "Sketch → .hex firmware",
    note: "Cold build, Uno R3, 924 B sketch. Apple M2.",
    speed:   { tsuki: 89, cli: 55, ide: 26 },
    ram:     { tsuki: 28, cli: 64, ide: 148 },
    cpu:     { tsuki: 38, cli: 55, ide: 72 },
    time:    { tsuki: "3.2 s", cli: "5.8 s", ide: "9.1 s" },
  },
  {
    id: "upload",     label: "Upload",
    description: "Flash firmware to board",
    note: "avrdude over USB. tsuki-flash calls avrdude directly.",
    speed:   { tsuki: 92, cli: 62, ide: 44 },
    ram:     { tsuki: 14, cli: 38, ide: 92 },
    cpu:     { tsuki: 18, cli: 28, ide: 44 },
    time:    { tsuki: "1.1 s", cli: "2.0 s", ide: "2.8 s" },
  },
  {
    id: "cold-start", label: "Cold start",
    description: "First invocation after install",
    note: "Time until tool accepts commands. No JVM warmup needed.",
    speed:   { tsuki: 99, cli: 84, ide: 8  },
    ram:     { tsuki: 4,  cli: 22, ide: 280 },
    cpu:     { tsuki: 6,  cli: 14, ide: 62 },
    time:    { tsuki: "28 ms", cli: "180 ms", ide: "3.8 s" },
  },
  {
    id: "full-build", label: "Full pipeline",
    description: "Write code → board running",
    note: "Transpile + compile + upload. Sequential, SHA-2 cached.",
    speed:   { tsuki: 88, cli: 52, ide: 22 },
    ram:     { tsuki: 34, cli: 78, ide: 190 },
    cpu:     { tsuki: 42, cli: 60, ide: 80 },
    time:    { tsuki: "4.4 s", cli: "7.9 s", ide: "12.2 s" },
  },
  {
    id: "cached",     label: "Cached rebuild",
    description: "Incremental — only changed files",
    note: "SHA-2 source hashing skips unchanged translation units.",
    speed:   { tsuki: 94, cli: 72, ide: 48 },
    ram:     { tsuki: 16, cli: 34, ide: 88 },
    cpu:     { tsuki: 14, cli: 26, ide: 46 },
    time:    { tsuki: "390 ms", cli: "1.2 s", ide: "2.6 s" },
  },
];

const TOOLS = [
  { id: "tsuki", label: "tsuki",       color: "var(--accent)",  hex: "#00e5b0" },
  { id: "cli",   label: "arduino-cli", color: "var(--accent2)", hex: "#6ba4e0" },
  { id: "ide",   label: "Arduino IDE", color: "#52525b",        hex: "#52525b" },
];

/* ── Speedometer gauge SVG ── */
function Gauge({ value, color, label, size = 80 }: { value: number; color: string; label: string; size?: number }) {
  const r = size * 0.38;
  const cx = size / 2, cy = size / 2 + 6;
  const startAngle = -210, sweep = 240;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const arcPath = (pct: number) => {
    const angle = startAngle + sweep * (pct / 100);
    const x = cx + r * Math.cos(toRad(angle));
    const y = cy + r * Math.sin(toRad(angle));
    const la = sweep * (pct / 100) > 180 ? 1 : 0;
    const sx = cx + r * Math.cos(toRad(startAngle));
    const sy = cy + r * Math.sin(toRad(startAngle));
    return `M ${sx} ${sy} A ${r} ${r} 0 ${la} 1 ${x} ${y}`;
  };
  const needleAngle = startAngle + sweep * (value / 100);
  const nr = r * 0.75;
  const nx = cx + nr * Math.cos(toRad(needleAngle));
  const ny = cy + nr * Math.sin(toRad(needleAngle));

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <svg width={size} height={size * 0.78} viewBox={`0 0 ${size} ${size * 0.78}`}>
        {/* track */}
        <path d={arcPath(100)} fill="none" stroke="var(--s3)" strokeWidth={size * 0.07} strokeLinecap="round" />
        {/* fill */}
        <path d={arcPath(value)} fill="none" stroke={color} strokeWidth={size * 0.07} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 1s ease, d 1s cubic-bezier(0.16,1,0.3,1)" }} />
        {/* needle */}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth={size * 0.025} strokeLinecap="round"
          style={{ transition: "all 1s cubic-bezier(0.16,1,0.3,1)" }} />
        <circle cx={cx} cy={cy} r={size * 0.04} fill={color} />
        {/* value */}
        <text x={cx} y={cy - r * 0.1} textAnchor="middle" fontSize={size * 0.2} fontFamily="var(--f-mono)" fill={color} fontWeight="600">{value}</text>
      </svg>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-f)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</span>
    </div>
  );
}

/* ── Resource bar ── */
function ResBar({ label, values, unit, animate }: { label: string; values: { label: string; val: number; color: string }[]; unit: string; animate: boolean }) {
  const max = Math.max(...values.map(v => v.val)) * 1.15;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-f)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {values.map(v => (
          <div key={v.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-f)", width: 72, flexShrink: 0 }}>{v.label}</span>
            <div style={{ flex: 1, height: 7, background: "var(--s2)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 2, background: v.color,
                width: animate ? `${(v.val / max) * 100}%` : "0%",
                transition: "width 1.1s cubic-bezier(0.16,1,0.3,1)",
              }} />
            </div>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: v.color, width: 52, textAlign: "right", flexShrink: 0 }}>
              {v.val}{unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Benchmark() {
  const ref = useRef<HTMLDivElement>(null);
  const [animate, setAnimate] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setAnimate(true); obs.disconnect(); } },
      { threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const switchTo = (i: number) => {
    setAnimate(false);
    setActive(i);
    setTimeout(() => setAnimate(true), 60);
  };

  const b = BENCHMARKS[active];

  const ramVals  = TOOLS.map(t => ({ label: t.label, val: (b.ram  as any)[t.id] as number, color: t.hex }));
  const cpuVals  = TOOLS.map(t => ({ label: t.label, val: (b.cpu  as any)[t.id] as number, color: t.hex }));
  const speedVals = TOOLS.map(t => ({ label: t.label, val: (b.speed as any)[t.id] as number, color: t.hex }));

  return (
    <section id="benchmark" className="section" style={{ background: "var(--black)" }}>
      <div className="container">

        {/* header */}
        <div className="reveal" style={{ marginBottom: 68, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 40, flexWrap: "wrap" }}>
          <div>
            <div className="t-label" style={{ color: "var(--accent)", marginBottom: 14 }}>Performance</div>
            <h2 className="t-h2">Faster at every step.</h2>
            <p className="t-body" style={{ maxWidth: 400, marginTop: 12 }}>
              Native binaries — no JVM, no Node.js startup overhead.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {TOOLS.map(t => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: t.hex }} />
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: t.id === "tsuki" ? "var(--fg)" : "var(--fg-f)" }}>{t.label}</span>
              </div>
            ))}
            <div style={{ marginTop: 4, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--s4)", lineHeight: 1.6 }}>Apple M2 · macOS 14 · Uno R3</div>
          </div>
        </div>

        {/* main panel */}
        <div ref={ref} className="reveal" style={{ background: "var(--black)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>

          {/* benchmark title bar */}
          <div style={{ padding: "22px 28px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontFamily: "var(--f-sans)", fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 4 }}>{b.label}</div>
              <div className="t-label">{b.description}</div>
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              {TOOLS.map(t => (
                <div key={t.id} style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--f-mono)", fontSize: 18, fontWeight: 700, letterSpacing: "-0.04em", color: t.hex }}>
                    {(b.time as any)[t.id]}
                  </div>
                  <div className="t-label" style={{ marginTop: 3 }}>{t.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* body: gauges + bars */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>

            {/* left: speed gauges */}
            <div style={{ padding: "28px", borderRight: "1px solid var(--border)" }}>
              <div className="t-label" style={{ marginBottom: 24 }}>Speed score (higher = faster)</div>
              <div style={{ display: "flex", gap: 12, justifyContent: "space-around" }}>
                {speedVals.map((v, i) => (
                  <Gauge key={v.label} value={animate ? v.val : 0} color={v.color} label={v.label} size={88} />
                ))}
              </div>
            </div>

            {/* right: resource bars */}
            <div style={{ padding: "28px" }}>
              <ResBar label="Peak RAM" values={ramVals} unit=" MB" animate={animate} />
              <ResBar label="Peak CPU" values={cpuVals} unit="%" animate={animate} />
            </div>
          </div>

          {/* note */}
          <div style={{ padding: "14px 28px", borderTop: "1px solid var(--border)", background: "var(--s0)" }}>
            <span className="t-label">{b.note}</span>
          </div>

          {/* tab selector */}
          <div style={{ padding: "16px 28px", borderTop: "1px solid var(--border)", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {BENCHMARKS.map((bm, i) => (
              <button
                key={bm.id}
                onClick={() => switchTo(i)}
                className={`bench-tab${active === i ? " active" : ""}`}
              >
                {bm.label}
              </button>
            ))}
          </div>
        </div>

        {/* summary stats */}
        <div className="reveal" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "var(--border)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          {[
            { val: "2.8×", label: "faster compile vs arduino-cli",      sub: "avg across board targets"    },
            { val: "3.2×", label: "faster full pipeline vs Arduino IDE", sub: "transpile + compile + flash" },
            { val: "64×",  label: "faster cold start vs Arduino IDE",    sub: "native binary, no runtime"   },
          ].map(s => (
            <div key={s.label} style={{ padding: "22px 24px", background: "var(--black)" }}>
              <div style={{ fontFamily: "var(--f-sans)", fontSize: 34, fontWeight: 700, letterSpacing: "-0.05em", color: "var(--accent)" }}>{s.val}</div>
              <div style={{ fontFamily: "var(--f-sans)", fontSize: 13, fontWeight: 500, color: "var(--fg)", marginTop: 6, letterSpacing: "-0.01em" }}>{s.label}</div>
              <div className="t-label" style={{ marginTop: 4 }}>{s.sub}</div>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
