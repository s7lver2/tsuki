"use client";
import { useState, useEffect } from "react";

const WORDS = ["firmware", "sketches", "libraries", "projects"];

export default function Hero() {
  const [copied, setCopied] = useState(false);
  const [wordIdx, setWordIdx] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const iv = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setWordIdx(i => (i + 1) % WORDS.length);
        setFade(true);
      }, 300);
    }, 2800);
    return () => clearInterval(iv);
  }, []);

  const copy = () => {
    navigator.clipboard.writeText("curl -fsSL https://tsuki.sh/install.sh | sh");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", padding: "120px 24px 80px", overflow: "hidden" }}>

      {/* Dot grid */}
      <div className="dot-grid" style={{ position: "absolute", inset: 0, maskImage: "radial-gradient(ellipse 80% 60% at 50% 40%, black 0%, transparent 70%)", pointerEvents: "none", opacity: 0.6 }} />

      {/* Radial glow behind heading */}
      <div style={{ position: "absolute", top: "20%", left: "50%", transform: "translateX(-50%)", width: 600, height: 400, background: "radial-gradient(ellipse at center, rgba(0,229,176,0.05) 0%, transparent 70%)", pointerEvents: "none" }} />

      {/* Grain top-right decoration */}
      <div style={{ position: "absolute", top: 80, right: 40, opacity: 0.15, pointerEvents: "none" }}>
        {Array.from({ length: 6 }).map((_, r) => (
          <div key={r} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            {Array.from({ length: 6 }).map((_, c) => (
              <div key={c} style={{ width: 3, height: 3, borderRadius: "50%", background: "#fff", opacity: (r + c) % 3 === 0 ? 1 : 0.3 }} />
            ))}
          </div>
        ))}
      </div>

      {/* Badge */}
      <div className="badge animate-up" style={{ marginBottom: 40, animationDelay: "0.05s" }}>
        <span className="led led-green" />
        Beta · Built with Rust + Go + Tauri
      </div>

      {/* Main heading */}
      <h1 className="t-display animate-up" style={{ textAlign: "center", maxWidth: 820, animationDelay: "0.15s" }}>
        Arduino{" "}
        <span style={{ color: "var(--accent)", display: "inline-block", transition: "opacity 0.3s ease", opacity: fade ? 1 : 0 }}>
          {WORDS[wordIdx]}
        </span>
        {" "}in Go.
      </h1>

      {/* Sub */}
      <p className="t-body animate-up" style={{ textAlign: "center", maxWidth: 500, marginTop: 24, fontSize: 17, animationDelay: "0.25s" }}>
        Write firmware in Go. tsuki transpiles to C++, compiles without arduino-cli, and flashes your boards — all from one toolkit.
      </p>

      {/* CTAs */}
      <div className="animate-up" style={{ display: "flex", gap: 10, marginTop: 40, flexWrap: "wrap", justifyContent: "center", animationDelay: "0.35s" }}>
        <a href="#install" className="btn btn-primary">
          Get started
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        </a>
        <a href="https://github.com/s7lver/tsuki" target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
          View on GitHub
        </a>
      </div>

      {/* Install command */}
      <div className="animate-up" style={{ width: "100%", maxWidth: 560, marginTop: 48, animationDelay: "0.45s" }}>
        <button onClick={copy} className="cmd-box" style={{ width: "100%" }}>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--accent)", opacity: 0.7, flexShrink: 0 }}>$</span>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 13, color: "#ccc", flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            curl -fsSL https://tsuki.sh/install.sh | sh
          </span>
          <span style={{
            padding: "3px 10px",
            background: copied ? "rgba(0,229,176,0.12)" : "rgba(255,255,255,0.05)",
            border: "1px solid", borderColor: copied ? "rgba(0,229,176,0.3)" : "rgba(255,255,255,0.08)",
            borderRadius: 4, fontFamily: "var(--f-mono)", fontSize: 10,
            letterSpacing: "0.06em", color: copied ? "var(--accent)" : "#555",
            transition: "all 0.2s ease", flexShrink: 0,
          }}>
            {copied ? "Copied!" : "Copy"}
          </span>
        </button>
        <p style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "#333", textAlign: "center", marginTop: 10 }}>
          macOS & Linux · Windows: <code style={{ color: "#444" }}>irm tsuki.sh/install.bat | iex</code>
        </p>
      </div>

      {/* Stats row */}
      <div className="animate-up" style={{ display: "flex", gap: 48, marginTop: 72, animationDelay: "0.55s", flexWrap: "wrap", justifyContent: "center" }}>
        {[
          { val: "~11ms", label: "Transpile" },
          { val: "3.2x", label: "Faster than arduino-cli" },
          { val: "14+", label: "Target boards" },
          { val: "0", label: "Dependencies required" },
        ].map(s => (
          <div key={s.label} style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--f-sans)", fontSize: 24, fontWeight: 700, letterSpacing: "-0.04em", color: "#fff" }}>{s.val}</div>
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "#444", marginTop: 4, letterSpacing: "0.04em" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Scroll hint */}
      <div style={{ position: "absolute", bottom: 36, left: "50%", transform: "translateX(-50%)", opacity: 0.2, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <div style={{ width: 1, height: 44, background: "linear-gradient(to bottom, transparent, #fff)" }} />
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, letterSpacing: "0.14em" }}>SCROLL</span>
      </div>
    </section>
  );
}
