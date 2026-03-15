"use client";
import { useState, useEffect } from "react";

type OS = "unix" | "windows";

const CMDS: Record<OS, string> = {
  unix:    "curl -fsSL https://tsuki.s7lver.xyz/install.sh | sh",
  windows: "irm https://tsuki.s7lver.xyz/install.bat | iex",
};

const OS_LABELS: Record<OS, { label: string; icon: string }> = {
  unix:    { label: "macOS / Linux", icon: "⌘" },
  windows: { label: "Windows",       icon: "⊞" },
};

function detectOS(): OS {
  if (typeof navigator === "undefined") return "unix";
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator as any).userAgentData?.platform?.toLowerCase()
    ?? navigator.platform?.toLowerCase()
    ?? "";

  if (
    ua.includes("win") ||
    platform.includes("win")
  ) return "windows";

  return "unix";
}

export default function InstallSection() {
  const [os, setOs]         = useState<OS>("unix");
  const [copied, setCopied] = useState(false);
  const [detected, setDetected] = useState<OS | null>(null);

  useEffect(() => {
    const d = detectOS();
    setDetected(d);
    setOs(d);
  }, []);

  const copy = () => {
    navigator.clipboard.writeText(CMDS[os]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="install" className="section" style={{ background: "#000", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="container">

        <div className="reveal" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "start" }}>

          {/* Left */}
          <div>
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: "0.1em", color: "var(--accent)", marginBottom: 16, textTransform: "uppercase" }}>Install</div>
            <h2 className="t-h2" style={{ marginBottom: 20 }}>One command.<br />Fully installed.</h2>
            <p className="t-body" style={{ marginBottom: 32 }}>
              The installer detects your OS and CPU architecture and downloads the
              latest release from GitHub.
            </p>

            {/* OS toggle */}
            <div style={{ display: "flex", gap: 4, padding: 4, background: "#111", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, width: "fit-content", marginBottom: 16 }}>
              {(["unix", "windows"] as OS[]).map(o => (
                <button
                  key={o}
                  onClick={() => { setOs(o); setCopied(false); }}
                  style={{
                    padding: "6px 16px",
                    background: os === o ? "rgba(255,255,255,0.08)" : "transparent",
                    border: "1px solid",
                    borderColor: os === o ? "rgba(255,255,255,0.12)" : "transparent",
                    borderRadius: 5,
                    fontFamily: "var(--f-mono)",
                    fontSize: 11,
                    letterSpacing: "0.04em",
                    color: os === o ? "#fff" : "#555",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span style={{ fontSize: 10, opacity: 0.7 }}>{OS_LABELS[o].icon}</span>
                  {OS_LABELS[o].label}
                  {detected === o && (
                    <span style={{
                      fontSize: 8,
                      fontFamily: "var(--f-mono)",
                      letterSpacing: "0.08em",
                      color: "var(--accent)",
                      opacity: 0.7,
                      background: "rgba(220,20,60,0.1)",
                      border: "1px solid rgba(220,20,60,0.2)",
                      borderRadius: 3,
                      padding: "1px 5px",
                    }}>
                      detected
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Command box */}
            <button onClick={copy} className="cmd-box" style={{ width: "100%", marginBottom: 10 }}>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--accent)", opacity: 0.6, flexShrink: 0 }}>
                {os === "unix" ? "$" : "PS>"}
              </span>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 13, color: "#ccc", flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {CMDS[os]}
              </span>
              <span style={{
                padding: "3px 10px",
                background: copied ? "rgba(220,20,60,0.1)" : "rgba(255,255,255,0.04)",
                border: "1px solid",
                borderColor: copied ? "rgba(220,20,60,0.3)" : "rgba(255,255,255,0.07)",
                borderRadius: 4,
                fontFamily: "var(--f-mono)",
                fontSize: 10,
                letterSpacing: "0.06em",
                color: copied ? "var(--accent)" : "#333",
                transition: "all 0.2s ease",
                flexShrink: 0,
              }}>
                {copied ? "Copied!" : "Copy"}
              </span>
            </button>

            <p style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "#222", lineHeight: 1.6 }}>
              {os === "unix"
                ? "Requires: curl · macOS 12+ / Ubuntu 20.04+ / Debian 11+ / Arch"
                : "Requires: PowerShell 5+ · Windows 10 / 11 · Run as Administrator"}
            </p>
          </div>

          {/* Right — steps */}
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {[
              { n: "01", cmd: "tsuki init",                  body: "Scaffold a new project with tsuki_package.json, src/main.go, and a .gitignore." },
              { n: "02", cmd: "tsuki build --board uno",     body: "Transpile Go → C++ with tsuki-core, then compile with tsuki-flash or arduino-cli." },
              { n: "03", cmd: "tsuki upload",                body: "Flash the .hex to your board via avrdude or esptool — detected automatically." },
              { n: "04", cmd: "tsuki pkg install ws2812",    body: "Install community packages from tsukilib. Ed25519 verified, versioned." },
            ].map(s => (
              <div key={s.n} style={{ padding: "20px 24px", background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, display: "grid", gridTemplateColumns: "auto 1fr", gap: "0 16px", alignItems: "start" }}>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "#222", paddingTop: 2 }}>{s.n}</span>
                <div>
                  <code style={{ fontFamily: "var(--f-mono)", fontSize: 13, color: "var(--accent)", display: "block", marginBottom: 6 }}>
                    {s.cmd}
                  </code>
                  <p style={{ fontFamily: "var(--f-sans)", fontSize: 14, color: "#555", lineHeight: 1.6, margin: 0 }}>{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}