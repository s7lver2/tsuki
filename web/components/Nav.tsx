"use client";
import { useState, useEffect } from "react";

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <nav style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 200,
      height: 60, display: "flex", alignItems: "center",
      padding: "0 32px", transition: "all 0.3s ease",
      background: scrolled ? "rgba(0,0,0,0.8)" : "transparent",
      backdropFilter: scrolled ? "blur(16px)" : "none",
      borderBottom: `1px solid ${scrolled ? "rgba(255,255,255,0.07)" : "transparent"}`,
    }}>
      <div style={{ maxWidth: 1100, width: "100%", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>

        {/* Logo */}
        <a href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 26, height: 26, background: "var(--accent)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 14, lineHeight: 1, color: "#000", fontWeight: 700 }}>月</span>
          </div>
          <span style={{ fontFamily: "var(--f-sans)", fontSize: 16, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--white)" }}>
            tsuki
          </span>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "#444", letterSpacing: "0.04em", marginLeft: 4 }}>
            v0.1.0
          </span>
        </a>

        {/* Links */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {[
            { label: "Docs", href: "#" },
            { label: "Packages", href: "#" },
            { label: "GitHub", href: "https://github.com/s7lver/tsuki", external: true },
          ].map(l => (
            <a key={l.label} href={l.href}
              target={l.external ? "_blank" : undefined}
              rel={l.external ? "noopener noreferrer" : undefined}
              style={{
                fontFamily: "var(--f-sans)", fontSize: 14, fontWeight: 500,
                color: "#888", textDecoration: "none", padding: "6px 12px",
                borderRadius: 6, transition: "all 0.15s ease",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#fff"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#888"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              {l.label}
            </a>
          ))}
          <a href="#install" className="btn btn-accent" style={{ fontSize: 13, padding: "7px 16px", marginLeft: 8 }}>
            Install
          </a>
        </div>
      </div>
    </nav>
  );
}
