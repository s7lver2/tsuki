'use client'

// ── VCC Node ───────────────────────────────────────────────────────────────────
export function VccNode({ w, h }: { w: number; h: number }) {
  return (
    <>
      <circle cx={w/2} cy={h/2} r={w/2-0.5} fill="#7f1d1d" stroke="#ef4444" strokeWidth={1.2} />
      <circle cx={w/2} cy={h/2} r={w/2-3}   fill="#991b1b" />
      <text x={w/2} y={h/2+3.5} textAnchor="middle" fontSize={9} fill="#fca5a5"
        fontFamily="monospace" fontWeight="800">5V</text>
    </>
  )
}

// ── GND Node ───────────────────────────────────────────────────────────────────
export function GndNode({ w, h }: { w: number; h: number }) {
  return (
    <>
      <rect width={w} height={h} rx={3} fill="#111" stroke="#374151" strokeWidth={1} />
      <line x1={w/2}    y1={h*0.16} x2={w/2}    y2={h*0.42} stroke="#9ca3af" strokeWidth={1.8} />
      <line x1={w*0.12} y1={h*0.42} x2={w*0.88} y2={h*0.42} stroke="#9ca3af" strokeWidth={1.8} />
      <line x1={w*0.24} y1={h*0.56} x2={w*0.76} y2={h*0.56} stroke="#9ca3af" strokeWidth={1.4} />
      <line x1={w*0.38} y1={h*0.70} x2={w*0.62} y2={h*0.70} stroke="#9ca3af" strokeWidth={1} />
    </>
  )
}

// ── Power Rail (5V + GND, 5 ports each) ────────────────────────────────────────
// Matching SandboxDefs pin positions:
//   5V  ports: ry 0.05, 0.13, 0.21, 0.29, 0.37
//   GND ports: ry 0.56, 0.64, 0.72, 0.80, 0.88
const VCC_PORTS = [0.05, 0.13, 0.21, 0.29, 0.37]
const GND_PORTS = [0.56, 0.64, 0.72, 0.80, 0.88]

export function PowerRail({ w, h }: { w: number; h: number }) {
  return (
    <>
      {/* Outer shell */}
      <rect width={w} height={h} rx={3} fill="#111" stroke="#2a2a2a" strokeWidth={0.8} />

      {/* 5V zone background */}
      <rect x={1.5} y={h*0.01} width={w-3} height={h*0.44} rx={2}
        fill="#7f1d1d" opacity={0.35} />
      {/* 5V bus trace */}
      <line x1={w/2} y1={h*0.02} x2={w/2} y2={h*0.44}
        stroke="#ef4444" strokeWidth={1} opacity={0.35} strokeDasharray="2 2" />
      {/* 5V label */}
      <text x={w/2} y={h*0.03 + 5} textAnchor="middle" fontSize={5} fill="#fca5a5"
        fontFamily="monospace" fontWeight="700">5V</text>
      {/* 5V port holes */}
      {VCC_PORTS.map((ry, i) => (
        <g key={`vcc${i}`}>
          {/* Copper pad */}
          <rect x={w*0.20} y={h*ry - 4} width={w*0.60} height={8} rx={1.5}
            fill="#3a0f0f" stroke="#ef4444" strokeWidth={0.6} />
          {/* Center hole */}
          <rect x={w/2 - 2} y={h*ry - 2} width={4} height={4} rx={0.5} fill="#0a0a0a" />
          {/* Port number */}
          <text x={w*0.88} y={h*ry + 2.5} textAnchor="middle" fontSize={4}
            fill="#ef444488" fontFamily="monospace">{i+1}</text>
        </g>
      ))}

      {/* Divider line */}
      <line x1={w*0.08} y1={h*0.47} x2={w*0.92} y2={h*0.47}
        stroke="#333" strokeWidth={0.8} />

      {/* GND zone background */}
      <rect x={1.5} y={h*0.49} width={w-3} height={h*0.47} rx={2}
        fill="#222" opacity={0.7} />
      {/* GND bus trace */}
      <line x1={w/2} y1={h*0.50} x2={w/2} y2={h*0.96}
        stroke="#6b7280" strokeWidth={1} opacity={0.35} strokeDasharray="2 2" />
      {/* GND label */}
      <text x={w/2} y={h*0.50 + 5} textAnchor="middle" fontSize={5} fill="#9ca3af"
        fontFamily="monospace" fontWeight="700">GND</text>
      {/* GND port holes */}
      {GND_PORTS.map((ry, i) => (
        <g key={`gnd${i}`}>
          {/* Copper pad */}
          <rect x={w*0.20} y={h*ry - 4} width={w*0.60} height={8} rx={1.5}
            fill="#1a1f2a" stroke="#4b5563" strokeWidth={0.6} />
          {/* Center hole */}
          <rect x={w/2 - 2} y={h*ry - 2} width={4} height={4} rx={0.5} fill="#0a0a0a" />
          {/* Port number */}
          <text x={w*0.88} y={h*ry + 2.5} textAnchor="middle" fontSize={4}
            fill="#4b556388" fontFamily="monospace">{i+1}</text>
        </g>
      ))}
    </>
  )
}