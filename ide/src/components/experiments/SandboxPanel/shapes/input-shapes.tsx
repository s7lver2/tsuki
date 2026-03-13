'use client'

// ── Tactile Button ─────────────────────────────────────────────────────────────
export function ButtonBody({ w, h, active }: { w: number; h: number; active?: boolean }) {
  return (
    <>
      <rect width={w} height={h} rx={3} fill="#2a2a2a" stroke="#555" strokeWidth={0.8} />
      <rect x={1.5} y={1.5} width={w-3} height={h-3} rx={2} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={0.5} />
      {active && <rect x={w*0.18} y={h*0.18} width={w*0.64} height={h*0.64} rx={3} fill="#60a5fa" opacity={0.20} />}
      <rect x={w*0.18} y={h*0.18} width={w*0.64} height={h*0.64} rx={2}
        fill={active ? '#4a4a4a' : '#3a3a3a'} stroke={active ? '#88aaff' : '#666'} strokeWidth={0.8} />
      <rect x={w*0.25} y={active ? h*0.28 : h*0.25} width={w*0.5} height={w*0.44} rx={2}
        fill={active ? '#444' : '#555'} stroke={active ? '#6699cc' : '#888'} strokeWidth={0.6} />
      <rect x={w*0.30} y={active ? h*0.33 : h*0.30} width={w*0.40} height={w*0.36} rx={1.5}
        fill={active ? '#505050' : '#666'} />
      {([[0.18,0.25],[0.18,0.72],[0.82,0.25],[0.82,0.72]] as [number,number][]).map(([px,py],i) => (
        <circle key={i} cx={w*px} cy={h*py} r={2} fill="#c8a843" stroke="#9a7820" strokeWidth={0.5} />
      ))}
      {!active && <text x={w/2} y={h*0.92} textAnchor="middle" fontSize={5.5} fill="rgba(255,255,255,0.3)" fontFamily="monospace">TAP</text>}
      {active  && <text x={w/2} y={h*0.92} textAnchor="middle" fontSize={5.5} fill="#60a5fa" fontFamily="monospace">ON</text>}
    </>
  )
}

// ── Potentiometer ──────────────────────────────────────────────────────────────
export function PotBody({ w, h, g }: { w: number; h: number; g: string }) {
  return (
    <>
      <defs>
        <radialGradient id={`pot_${g}`} cx="40%" cy="35%" r="65%">
          <stop offset="0%"   stopColor="#5a5a5a" />
          <stop offset="100%" stopColor="#1a1a1a" />
        </radialGradient>
      </defs>
      <rect width={w} height={h} rx={3} fill="#2a2a2a" stroke="#555" strokeWidth={0.8} />
      <circle cx={w/2} cy={h/2} r={w*0.40} fill={`url(#pot_${g})`} stroke="#666" strokeWidth={1} />
      <path d={`M ${w*0.18} ${h*0.82} A ${w*0.34} ${h*0.34} 0 1 1 ${w*0.82} ${h*0.82}`}
        fill="none" stroke="#333" strokeWidth={2} />
      <line x1={w/2} y1={h*0.18} x2={w/2} y2={h*0.38}
        stroke="#aaa" strokeWidth={1.5} strokeLinecap="round" />
      <circle cx={w/2} cy={h/2} r={w*0.14} fill="#333" stroke="#555" strokeWidth={0.5} />
      {[[0.18,0.82],[0.5,0.92],[0.82,0.82]].map(([px,py],i) => (
        <circle key={i} cx={w*px} cy={h*py} r={2} fill="#c8a843" stroke="#9a7820" strokeWidth={0.5} />
      ))}
    </>
  )
}

// ── Slide Switch ───────────────────────────────────────────────────────────────
export function SlideSwitchBody({ w, h, active }: { w: number; h: number; active?: boolean }) {
  const knobX = active ? w*0.65 : w*0.25
  return (
    <>
      <rect width={w} height={h} rx={3} fill="#2a2a2a" stroke="#555" strokeWidth={0.8} />
      <rect x={w*0.12} y={h*0.28} width={w*0.76} height={h*0.44} rx={3}
        fill="#1a1a1a" stroke="#444" strokeWidth={0.6} />
      <rect x={knobX-w*0.15} y={h*0.22} width={w*0.30} height={h*0.56} rx={3}
        fill="#aaaaaa" stroke="#cccccc" strokeWidth={0.7}
        style={{ transition: 'x 0.08s' }} />
      {[0.25, 0.5, 0.75].map((px, i) => (
        <circle key={i} cx={w*px} cy={h*0.92} r={2} fill="#c8a843" stroke="#9a7820" strokeWidth={0.5} />
      ))}
      <text x={w*0.5} y={h*0.14} textAnchor="middle" fontSize={5} fill={active ? '#22c55e' : '#666'} fontFamily="monospace">
        {active ? 'ON' : 'OFF'}
      </text>
    </>
  )
}

// ── Rotary Encoder ─────────────────────────────────────────────────────────────
export function RotaryEncoderBody({ w, h }: { w: number; h: number }) {
  return (
    <>
      <rect width={w} height={h} rx={3} fill="#2a2a2a" stroke="#555" strokeWidth={0.8} />
      <circle cx={w*0.58} cy={h*0.45} r={w*0.32} fill="#333" stroke="#555" strokeWidth={0.7} />
      <circle cx={w*0.58} cy={h*0.45} r={w*0.14} fill="#888" stroke="#aaa" strokeWidth={0.5} />
      <circle cx={w*0.58} cy={h*0.45} r={w*0.06} fill="#444" />
      <line x1={w*0.58} y1={h*0.45-w*0.06} x2={w*0.58} y2={h*0.16}
        stroke="#ccc" strokeWidth={1.5} strokeLinecap="round" />
      {[0.12,0.25,0.38].map((py, i) => (
        <rect key={i} x={-3} y={h*py-2} width={5} height={4} rx={0.5} fill="#c8a843" />
      ))}
      {(['CLK','DT','SW'] as const).map((l, i) => (
        <text key={l} x={w*0.28} y={h*(0.14+i*0.13)+2} fontSize={4.5} fill="#888" fontFamily="monospace">{l}</text>
      ))}
      <text x={w*0.58} y={h*0.88} textAnchor="middle" fontSize={5} fill="#666" fontFamily="monospace">KY-040</text>
    </>
  )
}

// ── DHT11 Temperature/Humidity ─────────────────────────────────────────────────
export function Dht11Body({ w, h, g }: { w: number; h: number; g: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`dht_${g}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#1a6bb8" />
          <stop offset="100%" stopColor="#0d3a70" />
        </linearGradient>
      </defs>
      <rect width={w} height={h} rx={4} fill={`url(#dht_${g})`} />
      <rect x={1.5} y={1.5} width={w-3} height={h-3} rx={3} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={0.5} />
      <rect x={w*0.08} y={h*0.06} width={w*0.84} height={h*0.58} rx={3}
        fill="#0a2550" stroke="#0d3a70" strokeWidth={0.5} />
      {[0.12, 0.22, 0.32, 0.42, 0.52].map((fy, i) => (
        <line key={i} x1={w*0.12} y1={h*fy} x2={w*0.88} y2={h*fy}
          stroke="rgba(255,255,255,0.12)" strokeWidth={0.8} />
      ))}
      {[0.18, 0.35, 0.52, 0.69, 0.86].map((fx, i) => (
        <line key={i} x1={w*fx} y1={h*0.06} x2={w*fx} y2={h*0.64}
          stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
      ))}
      <text x={w/2} y={h*0.80} textAnchor="middle" fontSize={7.5} fill="rgba(255,255,255,0.75)" fontFamily="monospace" fontWeight="700">DHT11</text>
      <text x={w/2} y={h*0.92} textAnchor="middle" fontSize={5}   fill="rgba(255,255,255,0.35)" fontFamily="monospace">T+RH</text>
    </>
  )
}

// ── LDR (Light Dependent Resistor) ─────────────────────────────────────────────
export function LdrBody({ w, h, g }: { w: number; h: number; g: string }) {
  return (
    <>
      <defs>
        <radialGradient id={`ldr_${g}`} cx="45%" cy="40%" r="60%">
          <stop offset="0%"   stopColor="#e8a000" />
          <stop offset="100%" stopColor="#a06000" />
        </radialGradient>
      </defs>
      <line x1={0}      y1={h/2} x2={w*0.14} y2={h/2} stroke="#b8b8b8" strokeWidth={1.8} />
      <line x1={w*0.86} y1={h/2} x2={w}      y2={h/2} stroke="#b8b8b8" strokeWidth={1.8} />
      <circle cx={w/2} cy={h/2} r={w*0.44} fill={`url(#ldr_${g})`} stroke="#7a5500" strokeWidth={1} />
      <path d={`M ${w*0.24} ${h*0.36} Q ${w*0.5} ${h*0.24} ${w*0.76} ${h*0.36}
               Q ${w*0.5} ${h*0.50} ${w*0.24} ${h*0.64}
               Q ${w*0.5} ${h*0.76} ${w*0.76} ${h*0.64}`}
        fill="none" stroke="#7a5500" strokeWidth={2} strokeLinecap="round" />
      {[-45, -15, 15, 45].map((angle, i) => {
        const rad = (angle - 80) * Math.PI / 180
        const r1 = w * 0.52, r2 = w * 0.65
        return (
          <line key={i}
            x1={w/2 + Math.cos(rad) * r1} y1={h/2 + Math.sin(rad) * r1}
            x2={w/2 + Math.cos(rad) * r2} y2={h/2 + Math.sin(rad) * r2}
            stroke="#ffd700" strokeWidth={1.2} opacity={0.6} strokeLinecap="round" />
        )
      })}
    </>
  )
}

// ── HC-SR04 Ultrasonic ─────────────────────────────────────────────────────────
export function UltrasonicBody({ w, h, g }: { w: number; h: number; g: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`us_${g}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#2a5a3a" />
          <stop offset="100%" stopColor="#1a3a28" />
        </linearGradient>
      </defs>
      <rect width={w} height={h} rx={3} fill={`url(#us_${g})`} />
      <rect x={1} y={1} width={w-2} height={h-2} rx={2} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={0.5} />
      {[0.22, 0.60].map((cx, i) => (
        <g key={i}>
          <ellipse cx={w*cx} cy={h*0.50} rx={w*0.16} ry={h*0.37}
            fill="#111" stroke="#444" strokeWidth={0.8} />
          {[0.35, 0.50, 0.65].map((ry, j) => (
            <ellipse key={j} cx={w*cx} cy={h*ry} rx={w*0.14} ry={h*0.04}
              fill="none" stroke="#333" strokeWidth={0.5} />
          ))}
          <ellipse cx={w*cx} cy={h*0.50} rx={w*0.08} ry={h*0.18} fill="#0d0d0d" />
        </g>
      ))}
      <text x={w*0.5} y={h*0.88} textAnchor="middle" fontSize={5} fill="rgba(255,255,255,0.4)" fontFamily="monospace">HC-SR04</text>
    </>
  )
}

// ── IR Sensor ──────────────────────────────────────────────────────────────────
export function IrBody({ w, h }: { w: number; h: number }) {
  return (
    <>
      <rect width={w} height={h} rx={3} fill="#111" stroke="#333" strokeWidth={0.8} />
      <ellipse cx={w*0.25} cy={h/2} rx={7} ry={8} fill="#2a2a2a" stroke="#555" strokeWidth={0.8} />
      <ellipse cx={w*0.25} cy={h/2} rx={4} ry={5} fill="#555" opacity={0.8} />
      <ellipse cx={w*0.24} cy={h*0.45} rx={2} ry={1.5} fill="rgba(255,255,255,0.2)" />
      <ellipse cx={w*0.65} cy={h/2} rx={7} ry={8} fill="#1a1a1a" stroke="#333" strokeWidth={0.8} />
      <ellipse cx={w*0.65} cy={h/2} rx={4} ry={5} fill="#0a0a0a" />
      <circle  cx={w*0.88} cy={h*0.3} r={2.5} fill="#ef4444" opacity={0.9} />
      <circle  cx={w*0.88} cy={h*0.3} r={1.2} fill="#fca5a5" />
      <text x={w*0.5} y={h*0.90} textAnchor="middle" fontSize={5} fill="rgba(255,255,255,0.3)" fontFamily="monospace">IR SENSOR</text>
    </>
  )
}

// ── Thermistor NTC ─────────────────────────────────────────────────────────────
export function ThermistorBody({ w, h }: { w: number; h: number }) {
  return (
    <>
      <circle cx={w/2} cy={h/2} r={w*0.44} fill="#4a2a2a" stroke="#8a3a3a" strokeWidth={0.8} />
      <circle cx={w/2} cy={h/2} r={w*0.32} fill="#3a1a1a" stroke="#6a2a2a" strokeWidth={0.5} />
      <text x={w/2} y={h/2+3} textAnchor="middle" fontSize={8} fill="#ff8080" fontFamily="monospace" fontWeight="700">t°</text>
      <line x1={w*0.14} y1={h/2} x2={0} y2={h/2} stroke="#aaa" strokeWidth={1.5} />
      <line x1={w*0.86} y1={h/2} x2={w} y2={h/2} stroke="#aaa" strokeWidth={1.5} />
      <text x={w/2} y={h-2} textAnchor="middle" fontSize={4.5} fill="#666" fontFamily="monospace">NTC 10kΩ</text>
    </>
  )
}