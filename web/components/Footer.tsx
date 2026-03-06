"use client";
export default function Footer() {
  return (
    <footer style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "32px 24px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 20, height: 20, background: "var(--accent)", borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 11, color: "#000", fontWeight: 700 }}>月</span>
          </div>
          <span style={{ fontFamily: "var(--f-sans)", fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em", color: "#333" }}>tsuki</span>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "#222" }}>· MIT License</span>
        </div>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "#222" }}>Write Arduino firmware in Go.</span>
        <div style={{ display: "flex", gap: 20 }}>
          {[{ l:"GitHub", h:"https://github.com/s7lver/tsuki" },{ l:"Docs", h:"#" },{ l:"Packages", h:"#" }].map(x=>(
            <a key={x.l} href={x.h} target={x.h.startsWith("http")?"_blank":undefined} rel="noopener noreferrer"
              style={{ fontFamily:"var(--f-mono)", fontSize:11, color:"#222", textDecoration:"none", transition:"color 0.15s ease" }}
              onMouseEnter={e=>(e.target as HTMLElement).style.color="#555"}
              onMouseLeave={e=>(e.target as HTMLElement).style.color="#222"}
            >{x.l}</a>
          ))}
        </div>
      </div>
    </footer>
  );
}
