"use client";
import { useState, useEffect, useRef } from "react";

const WORDS = ["Go", "Rust", "C++", "C", "Python", "Java", "Javascript"];

type OS = "unix" | "windows";

const CMDS: Record<OS, { prompt: string; cmd: string }> = {
  unix:    { prompt: "$",   cmd: "curl -fsSL https://tsuki.s7lver.xyz/install.sh | sh"  },
  windows: { prompt: "PS>", cmd: "irm https://tsuki.s7lver.xyz/install.bat | iex"        },
};

const OS_HINT: Record<OS, string> = {
  unix:    "macOS & Linux · Windows: irm tsuki.s7lver.xyz/install.bat | iex",
  windows: "Windows 10/11 · PowerShell 5+ · macOS/Linux: curl -fsSL tsuki.s7lver.xyz/install.sh | sh",
};

function detectOS(): OS {
  if (typeof navigator === "undefined") return "unix";
  const ua       = navigator.userAgent.toLowerCase();
  const platform = ((navigator as any).userAgentData?.platform ?? navigator.platform ?? "").toLowerCase();
  return (ua.includes("win") || platform.includes("win")) ? "windows" : "unix";
}

export default function Hero() {
  const [copied,   setCopied]   = useState(false);
  const [wordIdx,  setWordIdx]  = useState(0);
  const [fade,     setFade]     = useState(true);
  const [os,       setOs]       = useState<OS>("unix");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /* OS detection */
  useEffect(() => { setOs(detectOS()); }, []);

  /* word cycling */
  useEffect(() => {
    const iv = setInterval(() => {
      setFade(false);
      setTimeout(() => { setWordIdx(i => (i + 1) % WORDS.length); setFade(true); }, 280);
    }, 2800);
    return () => clearInterval(iv);
  }, []);

  /* canvas: subtle animated circuit-board grid */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf: number;
    let t = 0;

    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener("resize", resize);

    type Line = { x1:number; y1:number; x2:number; y2:number; phase:number; speed:number };
    const lines: Line[] = [];
    const GRID = 52;
    const seed = (n: number) => ((Math.sin(n) * 43758.5453) % 1 + 1) % 1;

    for (let gx = 0; gx < 22; gx++) {
      for (let gy = 0; gy < 14; gy++) {
        const x = gx * GRID, y = gy * GRID;
        if (seed(gx * 100 + gy) > 0.55)
          lines.push({ x1: x, y1: y, x2: x + GRID, y2: y, phase: seed(gx + gy * 37) * Math.PI * 2, speed: 0.4 + seed(gx * gy) * 0.8 });
        if (seed(gx * 77 + gy * 13) > 0.55)
          lines.push({ x1: x, y1: y, x2: x, y2: y + GRID, phase: seed(gy + gx * 53) * Math.PI * 2, speed: 0.3 + seed(gx + gy) * 0.7 });
      }
    }

    const draw = () => {
      t += 0.012;
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      lines.forEach(l => {
        const pulse = (Math.sin(t * l.speed + l.phase) + 1) / 2;
        const alpha = 0.04 + pulse * 0.09;
        ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2);
        ctx.strokeStyle = `rgba(220,20,60,${alpha})`; ctx.lineWidth = 1; ctx.stroke();
      });

      for (let gx = 0; gx < 22; gx++) {
        for (let gy = 0; gy < 14; gy++) {
          const x = gx * GRID, y = gy * GRID;
          const pulse = (Math.sin(t * 0.6 + gx * 0.4 + gy * 0.3) + 1) / 2;
          ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(107,164,224,${0.04 + pulse * 0.08})`; ctx.fill();
        }
      }

      const cx = w * 0.5, cy = h * 0.35;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 380);
      g.addColorStop(0,   "rgba(220,20,60,0.045)");
      g.addColorStop(0.5, "rgba(107,164,224,0.02)");
      g.addColorStop(1,   "transparent");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  const copy = () => {
    navigator.clipboard.writeText(CMDS[os].cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", padding: "120px 24px 80px", overflow: "hidden" }}>

      {/* circuit canvas */}
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", opacity: 0.7 }} />

      {/* bottom fade */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "30%", background: "linear-gradient(to bottom, transparent, var(--black))", pointerEvents: "none" }} />

      {/* content */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: 900 }}>

        <div className="badge animate-up" style={{ marginBottom: 36, animationDelay: "0.05s" }}>
          <span className="led led-green" />
          DEMO SOON · v5.1
        </div>

        <h1 className="t-display animate-up" style={{ textAlign: "center", animationDelay: "0.12s" }}>
          Building Arduino in {" "}
          <span style={{ color: "var(--accent)", display: "inline-block", transition: "opacity 0.28s", opacity: fade ? 1 : 0 }}>
            {WORDS[wordIdx]}
          </span>
          {" "}
        </h1>

        <p className="t-body animate-up" style={{ textAlign: "center", maxWidth: 500, marginTop: 24, fontSize: 16, animationDelay: "0.22s" }}>
          write code in the language you want, we take care of the rest. Transpilation toolchain with native library support
        </p>

        <div className="animate-up" style={{ display: "flex", gap: 10, marginTop: 36, flexWrap: "wrap", justifyContent: "center", animationDelay: "0.32s" }}>
          <a href="#install" className="btn btn-primary">
            Start Developing 🚀
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>
          </a>
          <a href="https://github.com/s7lver2/tsuki" target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            GitHub
          </a>
        </div>

        {/* command box */}
        <div className="animate-up" style={{ width: "100%", maxWidth: 540, marginTop: 44, animationDelay: "0.42s" }}>
          <button onClick={copy} className="cmd-box" style={{ width: "100%" }}>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--accent)", opacity: 0.7, flexShrink: 0 }}>
              {CMDS[os].prompt}
            </span>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 12.5, color: "#ccc", flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {CMDS[os].cmd}
            </span>
            <span style={{ padding: "3px 10px", background: copied ? "rgba(220,20,60,0.1)" : "rgba(255,255,255,0.04)", border: "1px solid", borderColor: copied ? "rgba(220,20,60,0.3)" : "var(--border)", borderRadius: 4, fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.06em", color: copied ? "var(--accent)" : "var(--fg-f)", transition: "all 0.2s", flexShrink: 0 }}>
              {copied ? "Copied!" : "Copy"}
            </span>
          </button>

          {/* OS hint — shows the other platform's command */}
          <p style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-f)", textAlign: "center", marginTop: 10, lineHeight: 1.6 }}>
            {os === "unix" ? (
              <>macOS &amp; Linux · Windows: <code style={{ color: "var(--s4)" }}>irm tsuki.s7lver.xyz/install.bat | iex</code></>
            ) : (
              <>Windows 10/11 · PowerShell 5+ · macOS/Linux: <code style={{ color: "var(--s4)" }}>curl -fsSL tsuki.s7lver.xyz/install.sh | sh</code></>
            )}
          </p>
        </div>

        {/* stats */}
        <div className="animate-up" style={{ display: "flex", gap: 52, marginTop: 68, animationDelay: "0.52s", flexWrap: "wrap", justifyContent: "center" }}>
          {[
            { val: "~11ms", label: "Transpile"              },
            { val: "~1s",  label: "Compilation"             },
            { val: "~20MB",   label: "Disk Space"           },
            { val: "14+",     label: "Boards"               },
          ].map(s => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "var(--f-sans)", fontSize: 22, fontWeight: 700, letterSpacing: "-0.04em", color: "var(--fg)" }}>{s.val}</div>
              <div className="t-label" style={{ marginTop: 5 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* scroll hint */}
      <div style={{ position: "absolute", bottom: 32, left: "50%", transform: "translateX(-50%)", opacity: 0.18, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <div style={{ width: 1, height: 40, background: "linear-gradient(to bottom, transparent, var(--fg))" }} />
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 8, letterSpacing: "0.14em" }}>SCROLL</span>
      </div>
    </section>
  );
}