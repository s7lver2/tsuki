"use client";

const FEATURES = [
  {
    n: "01", accent: "var(--accent)", tag: "Rust · tsuki-core",
    title: "Go→C++ Transpiler",
    specs: ["Full recursive-descent parser","Lexer + AST + code emitter","Variables, structs, interfaces, methods","if / for / switch / select / defer stubs","Built-in package runtime (10 packages)","#line source map support"],
    note: "Not a template engine — a real compiler frontend written in Rust.",
  },
  {
    n: "02", accent: "#0070f3", tag: "Rust · tsuki-flash",
    title: "Compile Without arduino-cli",
    specs: ["Direct avr-gcc / xtensa-gcc invocation","AVR, ESP32, ESP8266, RP2040 toolchains","Compile cache via SHA-2 source hashing","avrdude + esptool upload","Board auto-detection via USB VID:PID","14+ boards in built-in catalog"],
    note: "tsuki-flash calls the toolchain directly — no middleware, no spawn overhead.",
  },
  {
    n: "03", accent: "#e07dff", tag: "Go · Cobra CLI",
    title: "Project CLI",
    specs: ["tsuki init  —  scaffold project","tsuki build  —  transpile + compile","tsuki upload  —  flash firmware","tsuki check  —  validate code","tsuki pkg install/remove/update","tsuki config get/set/list"],
    note: "Single binary. Full project lifecycle from init to ship.",
  },
  {
    n: "04", accent: "#ffb86c", tag: "tsukilib",
    title: "Package Ecosystem",
    specs: ["ws2812 / neopixel — NeoPixel LEDs","dht — DHT11/DHT22 temp/humidity","hcsr04 — ultrasonic distance sensor","u8g2 — OLED SSD1306, SH1106","Ed25519 signature verification","Multiple registry support"],
    note: "Packages map Go function calls directly to C++ library calls via TOML manifests.",
  },
  {
    n: "05", accent: "#50fa7b", tag: "Tauri + Next.js",
    title: "Desktop IDE",
    specs: ["Monaco editor with Go syntax","Arduino-aware autocomplete","Git sidebar (stage, commit, push)","Integrated package manager","Serial monitor with baud control","Live Go↔C++ split preview"],
    note: "Native desktop app. Rust backend handles all filesystem and process operations.",
  },
  {
    n: "06", accent: "#f1fa8c", tag: "Rust · WASM",
    title: "Arduino Simulator",
    specs: ["Runs firmware as WebAssembly","Digital & analog pin simulation","Visual LED, button, display components","Real-time serial monitor","No physical board needed","Embedded directly in the IDE"],
    note: "Compiled to WASM. Flip pins, watch LEDs, test logic — before touching hardware.",
  },
];

export default function Features() {
  return (
    <section className="section" style={{ background: "#050505", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="container">

        <div className="reveal" style={{ marginBottom: 56 }}>
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: "0.1em", color: "var(--accent)", marginBottom: 16, textTransform: "uppercase" }}>Features</div>
          <h2 className="t-h2">The full stack.<br /><span style={{ color: "#555" }}>Every layer.</span></h2>
        </div>

        <div className="reveal" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, overflow: "hidden" }}>
          {FEATURES.map(f => (
            <div key={f.n} className="card" style={{ padding: "28px", borderRadius: 0, border: "none", position: "relative", overflow: "hidden", transition: "background 0.2s ease" }}
              onMouseEnter={e => e.currentTarget.style.background = "#111"}
              onMouseLeave={e => e.currentTarget.style.background = "var(--surface)"}
            >
              {/* Top accent bar */}
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${f.accent}55 40%, transparent)` }} />

              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "#2a2a2a", letterSpacing: "0.06em" }}>{f.n}</span>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: f.accent, opacity: 0.6, letterSpacing: "0.04em", textAlign: "right" }}>{f.tag}</span>
              </div>

              <h3 className="t-h3" style={{ marginBottom: 16, letterSpacing: "-0.03em", fontSize: 16 }}>{f.title}</h3>

              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 5, marginBottom: 20 }}>
                {f.specs.map((s, i) => (
                  <li key={i} style={{ display: "flex", gap: 8, fontFamily: "var(--f-mono)", fontSize: 11, color: "#555", lineHeight: 1.6 }}>
                    <span style={{ color: f.accent, flexShrink: 0, opacity: 0.6 }}>·</span>
                    {s}
                  </li>
                ))}
              </ul>

              <p style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "#2a2a2a", lineHeight: 1.7, borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 14, margin: 0 }}>
                {f.note}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
