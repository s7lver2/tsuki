"use client";
import { useState, useEffect } from "react";

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // check immediately on mount
    setScrolled(window.scrollY > 10);
    const fn = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <nav style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 200,
      height: 58, display: "flex", alignItems: "center",
      padding: "0 32px", transition: "background 0.3s ease, border-color 0.3s ease",
      /* always has a base — avoids "naked" state at top */
      background: scrolled ? "rgba(0,0,0,0.88)" : "rgba(0,0,0,0.55)",
      backdropFilter: "blur(18px)",
      WebkitBackdropFilter: "blur(18px)",
      borderBottom: `1px solid ${scrolled ? "var(--border)" : "rgba(255,255,255,0.04)"}`,
    }}>
      <div style={{ maxWidth: 1100, width: "100%", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>

        <a href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 26, height: 26, background: "var(--accent)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 14, color: "#000", fontWeight: 700 }}>月</span>
          </div>
          <span style={{ fontFamily: "var(--f-sans)", fontSize: 16, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--fg)" }}>tsuki</span>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-f)", marginLeft: 2 }}>v0.1.0</span>
        </a>

        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {[
            { label: "Features",   href: "#features"   },
            { label: "Pipeline",   href: "#pipeline"   },
            { label: "Benchmark",  href: "#benchmark"  },
            { label: "Transpiler", href: "#demo"       },
            { label: "IDE",        href: "#ide"        },
            { label: "GitHub",     href: "https://github.com/s7lver2/tsuki", external: true },
          ].map(l => (
            <a key={l.label} href={l.href}
              target={(l as any).external ? "_blank" : undefined}
              rel={(l as any).external ? "noopener noreferrer" : undefined}
              style={{ fontFamily: "var(--f-sans)", fontSize: 13, fontWeight: 500, color: "var(--fg-m)", textDecoration: "none", padding: "6px 10px", borderRadius: 6, transition: "all 0.15s" }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = "var(--fg)"; el.style.background = "rgba(255,255,255,0.05)"; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = "var(--fg-m)"; el.style.background = "transparent"; }}
            >{l.label}</a>
          ))}
          <a href="#install" className="btn btn-accent" style={{ fontSize: 13, padding: "7px 16px", marginLeft: 6 }}>Install</a>
        </div>
      </div>
    </nav>
  );
}
