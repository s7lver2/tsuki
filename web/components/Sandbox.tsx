"use client";
import { useState, useEffect, useRef } from "react";

const D_PINS = [
  {n:2,  label:"D2",   mode:"INPUT"},  {n:3,  label:"D3~",  mode:"INPUT"},
  {n:4,  label:"D4",   mode:"INPUT"},  {n:5,  label:"D5~",  mode:"OUTPUT"},
  {n:6,  label:"D6~",  mode:"OUTPUT"}, {n:7,  label:"D7",   mode:"OUTPUT"},
  {n:8,  label:"D8",   mode:"OUTPUT"}, {n:9,  label:"D9~",  mode:"OUTPUT"},
  {n:10, label:"D10~", mode:"OUTPUT"}, {n:11, label:"D11~", mode:"OUTPUT"},
  {n:12, label:"D12",  mode:"OUTPUT"}, {n:13, label:"D13",  mode:"OUTPUT"},
];
const A_PINS = [{n:"A0"},{n:"A1"},{n:"A2"},{n:"A3"}];

const INIT_LOG = [
  "tsuki-sim v0.1.0",
  "board: Arduino Uno / ATmega328P",
  "compiling blink.go...",
  "ready",
  "---",
  "tsuki 月 ready",
];

type DigState = Record<number, 0|1>;
type AnlgState = Record<string, number>;

export default function Sandbox() {
  const [digital, setDigital]   = useState<DigState>(() => Object.fromEntries(D_PINS.map(p=>[p.n,0 as 0|1])));
  const [analog,  setAnalog]    = useState<AnlgState>(() => Object.fromEntries(A_PINS.map(p=>[p.n,512])));
  const [running, setRunning]   = useState(true);
  const [tick,    setTick]      = useState(0);
  const [log,     setLog]       = useState(INIT_LOG);
  const serialRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{
    if(!running) return;
    const iv = setInterval(()=>{
      setTick(t=>t+1);
      setDigital(d=>({...d,13:(d[13]===1?0:1) as 0|1}));
    },600);
    return ()=>clearInterval(iv);
  },[running]);

  useEffect(()=>{
    if(!running) return;
    const iv = setInterval(()=>{
      setAnalog(a=>({
        A0: Math.min(1023,Math.max(0,a.A0+(Math.random()-.5)*80)),
        A1: Math.min(1023,Math.max(0,a.A1+(Math.random()-.5)*40)),
        A2: Math.min(1023,Math.max(0,a.A2+(Math.random()-.5)*30)),
        A3: a.A3,
      }));
    },800);
    return ()=>clearInterval(iv);
  },[running]);

  useEffect(()=>{
    if(serialRef.current) serialRef.current.scrollTop = serialRef.current.scrollHeight;
  },[log]);

  const toggleInput = (n:number)=>{
    const p = D_PINS.find(p=>p.n===n);
    if(p?.mode!=="INPUT") return;
    const next = digital[n]===1?0:1 as 0|1;
    setDigital(d=>({...d,[n]:next}));
    setLog(l=>[...l.slice(-30), `[input] D${n} → ${next?"HIGH":"LOW"}`]);
  };

  return (
    <section className="section" style={{ background:"#000", borderTop:"1px solid rgba(255,255,255,0.06)" }}>
      <div className="container">

        {/* Header */}
        <div className="reveal" style={{ marginBottom:56, display:"grid", gridTemplateColumns:"1fr 1fr", gap:40, alignItems:"end" }}>
          <div>
            <div style={{ fontFamily:"var(--f-mono)", fontSize:11, letterSpacing:"0.1em", color:"var(--accent)", marginBottom:16, textTransform:"uppercase" }}>Sandbox Simulator</div>
            <h2 className="t-h2">No hardware?<br /><span style={{color:"#555"}}>Test in the browser.</span></h2>
          </div>
          <p className="t-body">
            tsuki-sim compiles your firmware to WebAssembly and runs it live.
            Toggle input pins, drag analog sliders, watch the LEDs respond — all without a board.
          </p>
        </div>

        {/* Sim window */}
        <div className="reveal ide-frame">

          {/* Toolbar */}
          <div style={{ height:44, background:"#080808", borderBottom:"1px solid rgba(255,255,255,0.07)", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <span style={{ fontFamily:"var(--f-mono)", fontSize:11, color:"#444", letterSpacing:"0.06em" }}>SANDBOX</span>
              <span style={{ fontFamily:"var(--f-mono)", fontSize:11, color:"var(--accent)", opacity:0.5 }}>blink.go</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                <span className={`led ${running?"led-green":"led-off"}`} />
                <span style={{ fontFamily:"var(--f-mono)", fontSize:11, color:running?"var(--accent)":"#333", letterSpacing:"0.06em" }}>{running?"RUNNING":"PAUSED"}</span>
              </div>
              <button onClick={()=>setRunning(r=>!r)} style={{ padding:"4px 14px", background:running?"rgba(255,68,68,0.08)":"rgba(0,229,176,0.08)", border:"1px solid", borderColor:running?"rgba(255,68,68,0.25)":"rgba(0,229,176,0.25)", borderRadius:5, fontFamily:"var(--f-mono)", fontSize:11, color:running?"#ff4444":"var(--accent)", cursor:"pointer", letterSpacing:"0.04em" }}>
                {running?"Pause":"Resume"}
              </button>
              <button onClick={()=>{setDigital(Object.fromEntries(D_PINS.map(p=>[p.n,0 as 0|1]))); setTick(0); setLog(INIT_LOG);}} style={{ padding:"4px 14px", background:"transparent", border:"1px solid rgba(255,255,255,0.08)", borderRadius:5, fontFamily:"var(--f-mono)", fontSize:11, color:"#444", cursor:"pointer", letterSpacing:"0.04em" }}>
                Reset
              </button>
            </div>
          </div>

          {/* Content */}
          <div style={{ display:"flex", height:460 }}>

            {/* Board */}
            <div style={{ width:260, borderRight:"1px solid rgba(255,255,255,0.06)", padding:"20px 16px", display:"flex", flexDirection:"column", gap:12, flexShrink:0, overflow:"auto", background:"#060606" }}>
              <div style={{ fontFamily:"var(--f-mono)", fontSize:9, letterSpacing:"0.12em", color:"#1a1a1a", marginBottom:2 }}>ARDUINO UNO R3</div>

              <div style={{ background:"#0d0d0d", border:"1px solid rgba(255,255,255,0.07)", borderRadius:6, padding:"14px 12px" }}>
                {/* Power LED */}
                <div style={{ position:"relative" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:6, marginBottom:10 }}>
                    <span className="led led-green" style={{width:5,height:5}} />
                    <span style={{ fontFamily:"var(--f-mono)", fontSize:8, color:"#1a3a2e" }}>PWR</span>
                  </div>
                </div>

                {/* MCU */}
                <div style={{ background:"#111", border:"1px solid rgba(255,255,255,0.07)", borderRadius:4, padding:"8px 12px", textAlign:"center", margin:"0 auto 14px" }}>
                  <div style={{ fontFamily:"var(--f-mono)", fontSize:9, color:"#2a2a2a" }}>ATmega328P</div>
                  <div style={{ fontFamily:"var(--f-mono)", fontSize:8, color:"#1a1a1a", marginTop:3 }}>16MHz · 32KB flash</div>
                </div>

                {/* L LED pin 13 */}
                <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 0", borderTop:"1px solid rgba(255,255,255,0.05)", marginBottom:8 }}>
                  <span className={`led ${digital[13]?"led-blink":"led-off"}`} style={{width:10,height:10}} />
                  <span style={{ fontFamily:"var(--f-mono)", fontSize:10, color:digital[13]?"var(--accent)":"#333" }}>
                    L  (pin 13) — {digital[13]?"HIGH":"LOW"}
                  </span>
                </div>

                {/* Digital pin grid */}
                <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                  {D_PINS.map(pin=>(
                    <div key={pin.n} title={`${pin.label} · ${pin.mode}`}
                      onClick={()=>toggleInput(pin.n)}
                      style={{ width:20, height:20, background:digital[pin.n]?"var(--accent)":"#1a1a1a", border:"1px solid", borderColor:digital[pin.n]?"var(--accent)":"#2a2a2a", borderRadius:3, display:"flex", alignItems:"center", justifyContent:"center", cursor:pin.mode==="INPUT"?"pointer":"default", transition:"all 0.12s ease", boxShadow:digital[pin.n]?"0 0 8px rgba(0,229,176,0.4)":"none" }}>
                      <span style={{ fontFamily:"var(--f-mono)", fontSize:7, color:digital[pin.n]?"#000":"#333" }}>{pin.n}</span>
                    </div>
                  ))}
                </div>
              </div>

              <p style={{ fontFamily:"var(--f-mono)", fontSize:9, color:"#1a1a1a", textAlign:"center", lineHeight:1.6 }}>
                INPUT pins are clickable<br/>OUTPUT pins reflect firmware
              </p>
            </div>

            {/* Pin inspector */}
            <div style={{ width:220, borderRight:"1px solid rgba(255,255,255,0.06)", display:"flex", flexDirection:"column", flexShrink:0, background:"#060606" }}>
              <div style={{ padding:"8px 14px", fontFamily:"var(--f-mono)", fontSize:9, letterSpacing:"0.1em", color:"#1a1a1a", borderBottom:"1px solid rgba(255,255,255,0.06)", textTransform:"uppercase" }}>Pin Inspector</div>

              {/* Digital */}
              <div style={{ padding:"10px 14px 8px", borderBottom:"1px solid rgba(255,255,255,0.05)", flex:"0 0 auto" }}>
                <div style={{ fontFamily:"var(--f-mono)", fontSize:9, color:"#2a2a2a", marginBottom:8, letterSpacing:"0.06em" }}>DIGITAL</div>
                {D_PINS.map(pin=>(
                  <div key={pin.n} style={{ display:"flex", alignItems:"center", gap:7, marginBottom:3 }}>
                    <span className={`led ${digital[pin.n]?"led-green":"led-off"}`} style={{width:5,height:5}} />
                    <span style={{ fontFamily:"var(--f-mono)", fontSize:10, color:"#333", width:28, flexShrink:0 }}>{pin.label}</span>
                    <span style={{ fontFamily:"var(--f-mono)", fontSize:9, color:"#1a1a1a", width:42, flexShrink:0 }}>{pin.mode}</span>
                    <span style={{ fontFamily:"var(--f-mono)", fontSize:10, color:digital[pin.n]?"var(--accent)":"#2a2a2a", marginLeft:"auto" }}>
                      {digital[pin.n]?"HIGH":"LOW"}
                    </span>
                  </div>
                ))}
              </div>

              {/* Analog */}
              <div style={{ padding:"10px 14px", overflowY:"auto" }}>
                <div style={{ fontFamily:"var(--f-mono)", fontSize:9, color:"#2a2a2a", marginBottom:8, letterSpacing:"0.06em" }}>ANALOG</div>
                {A_PINS.map(pin=>{
                  const val = Math.round(analog[pin.n]);
                  const pct = (val/1023)*100;
                  return (
                    <div key={pin.n} style={{ marginBottom:12 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                        <span style={{ fontFamily:"var(--f-mono)", fontSize:10, color:"#444" }}>{pin.n}</span>
                        <span style={{ fontFamily:"var(--f-mono)", fontSize:10, color:"#555" }}>{val}</span>
                      </div>
                      <div style={{ height:3, background:"#1a1a1a", borderRadius:2, overflow:"hidden" }}>
                        <div style={{ width:`${pct}%`, height:"100%", background:"var(--accent2)", borderRadius:2, transition:"width 0.4s ease" }} />
                      </div>
                      <input type="range" min={0} max={1023} value={val}
                        onChange={e=>{
                          const v=Number(e.target.value);
                          setAnalog(a=>({...a,[pin.n]:v}));
                          setLog(l=>[...l.slice(-30),`[sim] ${pin.n} = ${v}`]);
                        }}
                        style={{ width:"100%", marginTop:5, accentColor:"var(--accent2)", height:2, cursor:"pointer" }} />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Serial monitor */}
            <div style={{ flex:1, display:"flex", flexDirection:"column", background:"#050505" }}>
              <div style={{ padding:"8px 14px", fontFamily:"var(--f-mono)", fontSize:9, letterSpacing:"0.1em", color:"#1a1a1a", borderBottom:"1px solid rgba(255,255,255,0.06)", display:"flex", justifyContent:"space-between", alignItems:"center", textTransform:"uppercase" }}>
                <span>Serial Monitor</span>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:9, color:"#1a1a1a" }}>9600 baud</span>
                  <button onClick={()=>setLog([])} style={{ padding:"2px 10px", background:"transparent", border:"1px solid rgba(255,255,255,0.06)", borderRadius:4, fontFamily:"var(--f-mono)", fontSize:9, color:"#2a2a2a", cursor:"pointer" }}>CLR</button>
                </div>
              </div>
              <div ref={serialRef} style={{ flex:1, overflow:"auto", padding:"10px 0" }}>
                {log.map((line,i)=>(
                  <div key={i} style={{ padding:"1.5px 16px", fontFamily:"var(--f-mono)", fontSize:12, lineHeight:"18px",
                    color: line.startsWith("[input]")?"var(--accent2)": line.startsWith("[sim]")?"#2a2a2a": line==="---"?"#1a1a1a": i<4?"#2a2a2a":"#555" }}>
                    {line==="---"?<span style={{color:"#1a1a1a"}}>──────────────</span>:line}
                  </div>
                ))}
                <div style={{ padding:"0 16px", fontFamily:"var(--f-mono)", fontSize:12, color:"#555" }}>
                  &gt; <span style={{ animation:"blink-cur 1.1s step-end infinite", display:"inline-block", color:"var(--accent)" }}>_</span>
                </div>
              </div>
              <div style={{ padding:"6px 16px", borderTop:"1px solid rgba(255,255,255,0.05)", display:"flex", justifyContent:"space-between" }}>
                <span style={{ fontFamily:"var(--f-mono)", fontSize:9, color:"#1a1a1a" }}>tick: {tick}</span>
                <span style={{ fontFamily:"var(--f-mono)", fontSize:9, color:"#1a1a1a" }}>uptime: {(tick*0.6).toFixed(1)}s</span>
              </div>
            </div>
          </div>
        </div>

        {/* Callouts */}
        <div className="reveal" style={{ display:"flex", gap:28, marginTop:24, flexWrap:"wrap", justifyContent:"center" }}>
          {["Compiled to WebAssembly","Digital & analog pin simulation","Real-time serial output","Embedded in the IDE — no browser tab needed"].map(t=>(
            <span key={t} style={{ fontFamily:"var(--f-mono)", fontSize:11, color:"#333", display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ color:"var(--accent)", opacity:0.4 }}>·</span>{t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
