"use client";
import { useRef, useEffect, useState } from "react";

/* ─── VISUAL: Transpiler token stream ─── */
function VisualTranspiler() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setT(n => (n + 1) % 5), 700);
    return () => clearInterval(iv);
  }, []);

  const goTokens  = [["go-kw","func"],["go-fn","loop"],["go-id","()"],["go-pkg","arduino"],["go-id",".HIGH"]];
  const cppTokens = [["cpp-kw","void"],["cpp-fn","loop"],["cpp-id","()"],["cpp-fn","digitalWrite"],["cpp-id","HIGH"]];

  return (
    <div style={{ display:"flex", alignItems:"center", gap:16, height:80 }}>
      {/* Go side */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", gap:5, alignItems:"flex-end" }}>
        {goTokens.map(([cls,label],i) => (
          <div key={i} style={{
            padding:"3px 10px", borderRadius:4,
            background: t===i ? "rgba(80,250,123,0.1)" : "var(--s2)",
            border:`1px solid ${t===i ? "#50fa7b55" : "var(--border-s)"}`,
            fontFamily:"var(--f-mono)", fontSize:10.5,
            color: t===i ? "#50fa7b" : "var(--fg-f)",
            transition:"all 0.3s ease",
          }}><span className={t===i ? cls : ""}>{label}</span></div>
        ))}
      </div>
      {/* arrow */}
      <div style={{ display:"flex", flexDirection:"column", gap:10, alignItems:"center" }}>
        {[0,1,2,3,4].map(i => (
          <div key={i} style={{
            width: t===i ? 24 : 16,
            height:1,
            background: t===i ? "var(--accent)" : "var(--s4)",
            transition:"all 0.3s",
          }} />
        ))}
      </div>
      {/* C++ side */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", gap:5 }}>
        {cppTokens.map(([cls,label],i) => (
          <div key={i} style={{
            padding:"3px 10px", borderRadius:4,
            background: t===i ? "rgba(130,170,255,0.1)" : "var(--s2)",
            border:`1px solid ${t===i ? "#82aaff55" : "var(--border-s)"}`,
            fontFamily:"var(--f-mono)", fontSize:10.5,
            color: t===i ? "#82aaff" : "var(--fg-f)",
            transition:"all 0.3s ease", transitionDelay: t===i ? "0.1s" : "0s",
          }}><span className={t===i ? cls : ""}>{label}</span></div>
        ))}
      </div>
    </div>
  );
}

/* ─── VISUAL: Compile pipeline bars ─── */
function VisualFlash() {
  const [step, setStep] = useState(-1);
  useEffect(() => {
    const iv = setInterval(() => setStep(s => s >= 2 ? -1 : s + 1), 900);
    return () => clearInterval(iv);
  }, []);
  const bars = [
    { label:"avr-gcc",  color:"var(--accent2)", w:72 },
    { label:"link .elf",color:"var(--accent2)", w:44 },
    { label:".hex",     color:"var(--accent)",  w:90 },
  ];
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10, height:80, justifyContent:"center" }}>
      {bars.map((b,i) => (
        <div key={i} style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontFamily:"var(--f-mono)", fontSize:9.5, color: step>=i ? b.color : "var(--fg-f)", width:60, textAlign:"right", transition:"color 0.3s" }}>{b.label}</span>
          <div style={{ flex:1, height:6, background:"var(--s2)", borderRadius:2, overflow:"hidden" }}>
            <div style={{ height:"100%", borderRadius:2, background:b.color, width: step>=i ? `${b.w}%` : "0%", transition:"width 0.9s cubic-bezier(0.16,1,0.3,1)" }} />
          </div>
          <span style={{ fontFamily:"var(--f-mono)", fontSize:10, color: step>=i ? b.color : "var(--s4)", width:12, transition:"color 0.3s" }}>{step>=i ? "✓":""}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── VISUAL: CLI typing animation ─── */
function VisualCLI() {
  const lines = [
    { prompt:"$", text:"tsuki build --board uno", color:"var(--fg-m)" },
    { prompt:" ", text:"✓ transpile   11ms",       color:"var(--accent)" },
    { prompt:" ", text:"✓ compile     3.2s",        color:"var(--accent)" },
    { prompt:"$", text:"tsuki upload",              color:"var(--fg-m)" },
    { prompt:" ", text:"✓ flashed 924B · 1.1s",    color:"var(--ok)" },
  ];
  const [vis, setVis] = useState(0);
  useEffect(() => {
    if (vis >= lines.length) { setTimeout(() => setVis(0), 1400); return; }
    const iv = setTimeout(() => setVis(v => v + 1), 580);
    return () => clearTimeout(iv);
  }, [vis]);
  return (
    <div style={{ height:80, display:"flex", flexDirection:"column", gap:2, justifyContent:"center", fontFamily:"var(--f-mono)", fontSize:10.5 }}>
      {lines.map((l,i) => (
        <div key={i} style={{ display:"flex", gap:8, opacity: i < vis ? 1 : 0, transition:"opacity 0.2s", color:l.color, lineHeight:"15px" }}>
          <span style={{ color:"var(--accent)", opacity:0.5 }}>{l.prompt}</span>
          <span>{l.text}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── VISUAL: Package install ─── */
function VisualPackages() {
  const [active, setActive] = useState(0);
  const pkgs = [
    { name:"ws2812",  cpp:"NeoPixel.h",     color:"var(--warn)"   },
    { name:"dht",     cpp:"DHT.h",          color:"var(--ok)"     },
    { name:"hcsr04",  cpp:"HCSR04",         color:"var(--info)"   },
    { name:"u8g2",    cpp:"U8g2.h",         color:"var(--accent2)"},
  ];
  useEffect(() => {
    const iv = setInterval(() => setActive(a => (a + 1) % pkgs.length), 1000);
    return () => clearInterval(iv);
  }, []);
  const p = pkgs[active];
  return (
    <div style={{ height:80, display:"flex", flexDirection:"column", gap:8, justifyContent:"center" }}>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
        {pkgs.map((pkg,i) => (
          <div key={pkg.name} style={{ padding:"4px 10px", borderRadius:4, background: i===active ? `rgba(0,0,0,0.3)` : "var(--s2)", border:`1px solid ${i===active ? p.color+"66" : "var(--border-s)"}`, fontFamily:"var(--f-mono)", fontSize:10, color: i===active ? p.color : "var(--fg-f)", transition:"all 0.35s" }}>
            {pkg.name}
          </div>
        ))}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontFamily:"var(--f-mono)", fontSize:10, color:"var(--fg-f)" }}>→</span>
        <code style={{ fontFamily:"var(--f-mono)", fontSize:10, color:p.color, transition:"color 0.3s" }}>#include &lt;{p.cpp}&gt;</code>
      </div>
    </div>
  );
}

/* ─── VISUAL: Mini IDE chrome ─── */
function VisualIDE() {
  const [tab, setTab] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTab(t => (t + 1) % 3), 1200);
    return () => clearInterval(iv);
  }, []);
  const tabs = ["main.go","sensor.go","servo.go"];
  const panels = ["Files","Git","Pkgs","Cfg"];
  return (
    <div style={{ height:80, background:"var(--s0)", border:"1px solid var(--border-s)", borderRadius:6, overflow:"hidden" }}>
      {/* titlebar */}
      <div style={{ height:22, background:"#060608", borderBottom:"1px solid var(--border-s)", display:"flex", alignItems:"center", gap:0, paddingLeft:8 }}>
        {["#ff5f57","#ffbd2e","#28c840"].map(c=><div key={c} style={{width:6,height:6,borderRadius:"50%",background:c,marginRight:4,opacity:.85}}/>)}
        {tabs.map((t,i)=>(
          <div key={t} style={{ padding:"0 10px", height:22, display:"flex", alignItems:"center", fontFamily:"var(--f-mono)", fontSize:9, color: tab===i ? "var(--fg)" : "var(--fg-f)", borderBottom:`1px solid ${tab===i ? "var(--accent)" : "transparent"}`, transition:"all 0.3s", cursor:"default" }}>{t}</div>
        ))}
      </div>
      {/* body */}
      <div style={{ display:"flex", height:"calc(100% - 22px)" }}>
        <div style={{ width:16, background:"#080808", borderRight:"1px solid var(--border-s)", display:"flex", flexDirection:"column", alignItems:"center", paddingTop:3, gap:3 }}>
          {panels.map((p,i)=><div key={p} style={{width:10,height:10,borderRadius:2,background:i===0?"rgba(255,255,255,0.07)":"transparent"}}/>)}
        </div>
        <div style={{ padding:"5px 8px", fontFamily:"var(--f-mono)", fontSize:8.5, color:"var(--fg-f)", lineHeight:"13px" }}>
          <div><span style={{color:"#ff79c6"}}>func</span> <span style={{color:"#50fa7b"}}>loop</span>{"() {"}</div>
          <div style={{paddingLeft:10}}><span style={{color:"#ffb86c"}}>arduino</span>.HIGH</div>
          <div>{"}"}</div>
        </div>
      </div>
    </div>
  );
}

/* ─── VISUAL: Arduino board simulator ─── */
function VisualSimulator() {
  const [high, setHigh] = useState(false);
  const [aVal, setAVal] = useState(512);
  useEffect(() => {
    const iv1 = setInterval(() => setHigh(h => !h), 750);
    const iv2 = setInterval(() => setAVal(v => Math.min(1023, Math.max(0, v + (Math.random() - 0.5) * 140))), 480);
    return () => { clearInterval(iv1); clearInterval(iv2); };
  }, []);
  const pins = [0,1,2,3,4,5,6,7,8,9,10,11,12,13];
  return (
    <div style={{ height:80, display:"flex", flexDirection:"column", gap:10, justifyContent:"center" }}>
      {/* pin row */}
      <div style={{ display:"flex", gap:4, alignItems:"center" }}>
        {pins.map(p=>(
          <div key={p} style={{ width:14, height:14, borderRadius:2, background: p===13 ? (high?"var(--accent)":"var(--s3)") : "var(--s2)", border:`1px solid ${p===13 ? (high?"var(--accent)":"var(--s4)") : "var(--border-s)"}`, display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.3s", boxShadow:p===13&&high?"0 0 8px var(--accent)33":undefined }}>
            <span style={{ fontFamily:"var(--f-mono)", fontSize:7, color: p===13?(high?"#000":"var(--s4)"):"var(--s4)" }}>{p}</span>
          </div>
        ))}
      </div>
      {/* A0 bar */}
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontFamily:"var(--f-mono)", fontSize:9.5, color:"var(--fg-f)", width:14 }}>A0</span>
        <div style={{ flex:1, height:4, background:"var(--s2)", borderRadius:2 }}>
          <div style={{ height:"100%", borderRadius:2, background:"var(--accent2)", width:`${(aVal/1023)*100}%`, transition:"width .35s ease" }}/>
        </div>
        <span style={{ fontFamily:"var(--f-mono)", fontSize:9.5, color:"var(--fg-f)", width:30, textAlign:"right" }}>{Math.round(aVal)}</span>
      </div>
    </div>
  );
}

const FEATURES = [
  {
    n:"01", accent:"var(--ok)",      tag:"Rust · tsuki-core",
    title:"Native Transpilation",
    visual:<VisualTranspiler/>,
    note:"Full transpilation support for 4 languages",
  },
  {
    n:"02", accent:"var(--accent2)", tag:"Rust · tsuki-flash",
    title:"Fast and secure uploads",
    visual:<VisualFlash/>,
    note:"Direct avr-gcc / xtensa invocation. SHA-2 incremental cache. 14+ boards.",
  },
  {
    n:"03", accent:"#e879f9",        tag:"Go · Tsuki CLI",
    title:"Project CLI",
    visual:<VisualCLI/>,
    note:"Create your projects with our dedicated CLI tool",
  },
  {
    n:"04", accent:"var(--warn)",    tag:"tsuki lib",
    title:"Package ecosystem",
    visual:<VisualPackages/>,
    note:"Use your favourite libraries in a easier way than ever",
  },
  {
    n:"05", accent:"var(--accent)",  tag:"Tauri + Next.js",
    title:"Tsuki IDE",
    visual:<VisualIDE/>,
    note:"Bring your experience to the next level with our dedicated IDE, full of tools for make development easier",
  },
  {
    n:"06", accent:"#f1fa8c",        tag:"Rust · tsuki-core sim",
    title:"Simulation",
    visual:<VisualSimulator/>,
    note:"Simulate your code without need to plug in your board",
  },
];

export default function Features() {
  return (
    <section id="features" className="section" style={{ background:"var(--black)", borderTop:"1px solid var(--edge)" }}>
      <div className="container">

        <div className="reveal" style={{ marginBottom:68 }}>
          <div className="t-label" style={{ color:"var(--accent)", marginBottom:14 }}>Features</div>
          <h2 className="t-h2">The full stack.<br/><span style={{ color:"var(--fg-f)" }}>Every layer.</span></h2>
        </div>

        <div className="reveal" style={{
          display:"grid",
          gridTemplateColumns:"repeat(auto-fit, minmax(300px, 1fr))",
          gap:1,
          background:"var(--border)",
          border:"1px solid var(--border)",
          borderRadius:10,
          overflow:"hidden",
        }}>
          {FEATURES.map(f => (
            <div key={f.n}
              style={{ background:"var(--black)", padding:"26px 24px 22px", position:"relative", overflow:"hidden", transition:"background 0.2s" }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--s1)")}
              onMouseLeave={e => (e.currentTarget.style.background = "var(--black)")}
            >
              {/* accent line */}
              <div style={{ position:"absolute", top:0, left:0, right:0, height:1, background:`linear-gradient(90deg, transparent, ${f.accent}50 40%, transparent)` }} />

              {/* header row */}
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:16 }}>
                <span style={{ fontFamily:"var(--f-mono)", fontSize:10, color:"var(--s4)", letterSpacing:"0.06em" }}>{f.n}</span>
                <span style={{ fontFamily:"var(--f-mono)", fontSize:9.5, color:f.accent, opacity:0.5, letterSpacing:"0.04em" }}>{f.tag}</span>
              </div>

              {/* animated visual */}
              {f.visual}

              {/* title */}
              <h3 style={{ fontFamily:"var(--f-sans)", fontSize:14, fontWeight:600, letterSpacing:"-0.02em", color:"var(--fg)", margin:"14px 0 6px" }}>{f.title}</h3>

              {/* one-liner note */}
              <p style={{ fontFamily:"var(--f-mono)", fontSize:10, color:"var(--fg-f)", lineHeight:1.65 }}>{f.note}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
