// ─────────────────────────────────────────────────────────────────────────────
//  pages/Boards.tsx
//  Interactive pinout diagrams for Arduino Uno and Lolin Wemos D1 Mini
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react'
import { H2, P, Divider, InlineCode, Note, Table, Badge } from '../DocsPrimitives'

// ── Shared types ──────────────────────────────────────────────────────────────

interface PinInfo {
  id: string
  x: number
  y: number
  label: string
  info: {
    mode: string
    voltage: string
    special?: string
    gpio?: string
  }
}

type SpecRow = [string, string]

// ─────────────────────────────────────────────────────────────────────────────
//  Arduino Uno
// ─────────────────────────────────────────────────────────────────────────────

const UNO_PINS: PinInfo[] = [
  { id:'D13', x:314, y:62,  label:'D13',  info:{ mode:'Digital I/O / SPI SCK',   voltage:'5V', special:'SPI' }},
  { id:'D12', x:314, y:76,  label:'D12',  info:{ mode:'Digital I/O / SPI MISO',  voltage:'5V', special:'SPI' }},
  { id:'D11', x:314, y:90,  label:'D11',  info:{ mode:'Digital I/O / SPI MOSI / PWM', voltage:'5V', special:'PWM' }},
  { id:'D10', x:314, y:104, label:'D10',  info:{ mode:'Digital I/O / SPI SS / PWM',  voltage:'5V', special:'PWM' }},
  { id:'D9',  x:314, y:118, label:'D9',   info:{ mode:'Digital I/O / PWM',        voltage:'5V', special:'PWM' }},
  { id:'D8',  x:314, y:132, label:'D8',   info:{ mode:'Digital I/O',              voltage:'5V' }},
  { id:'D7',  x:314, y:150, label:'D7',   info:{ mode:'Digital I/O',              voltage:'5V' }},
  { id:'D6',  x:314, y:164, label:'D6',   info:{ mode:'Digital I/O / PWM',        voltage:'5V', special:'PWM' }},
  { id:'D5',  x:314, y:178, label:'D5',   info:{ mode:'Digital I/O / PWM',        voltage:'5V', special:'PWM' }},
  { id:'D4',  x:314, y:192, label:'D4',   info:{ mode:'Digital I/O',              voltage:'5V' }},
  { id:'D3',  x:314, y:206, label:'D3',   info:{ mode:'Digital I/O / PWM / INT1', voltage:'5V', special:'INT' }},
  { id:'D2',  x:314, y:220, label:'D2',   info:{ mode:'Digital I/O / INT0',       voltage:'5V', special:'INT' }},
  { id:'TX',  x:314, y:234, label:'TX→1', info:{ mode:'Serial TX (D1)',           voltage:'5V', special:'UART' }},
  { id:'RX',  x:314, y:248, label:'RX←0', info:{ mode:'Serial RX (D0)',           voltage:'5V', special:'UART' }},
  { id:'A0',  x:44,  y:198, label:'A0',   info:{ mode:'Analog in 10-bit / Digital I/O', voltage:'5V ref', special:'ADC' }},
  { id:'A1',  x:44,  y:212, label:'A1',   info:{ mode:'Analog in 10-bit / Digital I/O', voltage:'5V ref', special:'ADC' }},
  { id:'A2',  x:44,  y:226, label:'A2',   info:{ mode:'Analog in 10-bit / Digital I/O', voltage:'5V ref', special:'ADC' }},
  { id:'A3',  x:44,  y:240, label:'A3',   info:{ mode:'Analog in 10-bit / Digital I/O', voltage:'5V ref', special:'ADC' }},
  { id:'A4',  x:44,  y:254, label:'A4',   info:{ mode:'Analog in 10-bit / I2C SDA',     voltage:'5V ref', special:'I2C' }},
  { id:'A5',  x:44,  y:268, label:'A5',   info:{ mode:'Analog in 10-bit / I2C SCL',     voltage:'5V ref', special:'I2C' }},
  { id:'5V',  x:44,  y:100, label:'5V',   info:{ mode:'Power output',             voltage:'5V',  special:'Power' }},
  { id:'3V3', x:44,  y:114, label:'3.3V', info:{ mode:'Power output (50 mA max)', voltage:'3.3V',special:'Power' }},
  { id:'GND', x:44,  y:128, label:'GND',  info:{ mode:'Ground',                   voltage:'0V',  special:'Power' }},
]

const PIN_COLORS: Record<string, string> = {
  'PWM':   '#a0a0a0', 'ADC':   '#b8b8b8', 'I2C':   '#909090',
  'UART':  '#c0c0c0', 'SPI':   '#d0d0d0', 'INT':   '#aaaaaa',
  'Power': '#888888', 'default': '#484848',
}

const UNO_SPECS: SpecRow[] = [
  ['MCU',       'ATmega328P'],
  ['Clock',     '16 MHz'],
  ['Flash',     '32 KB'],
  ['SRAM',      '2 KB'],
  ['EEPROM',    '1 KB'],
  ['I/O voltage','5 V'],
  ['Analog in', '6 × 10-bit'],
  ['PWM pins',  '6 (D3,D5,D6,D9,D10,D11)'],
  ['UART',      '1 (D0/D1)'],
  ['I2C',       '1 (A4/A5)'],
  ['SPI',       '1 (D10–D13)'],
]

function ArduinoUnoPinout() {
  const [hovered, setHovered] = useState<string | null>(null)
  const hovPin = UNO_PINS.find(p => p.id === hovered)

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 6,
      overflow: 'hidden', marginBottom: 14, background: 'var(--surface-1)',
    }}>
      {/* Header */}
      <div style={{
        padding: '6px 12px', background: 'var(--surface-2)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--fg-faint)', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
          Arduino Uno — Pinout
        </span>
        <div style={{ display: 'flex', gap: 10, fontSize: 9, fontFamily: 'var(--font-mono)' }}>
          {[['PWM~','PWM'],['ADC','ADC'],['I2C','I2C'],['UART','UART'],['SPI','SPI'],['PWR','Power']].map(([label, key]) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--fg-faint)' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: PIN_COLORS[key], display: 'inline-block' }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex' }}>
        {/* SVG */}
        <div style={{ flex: 1, padding: '8px 0' }}>
          <svg viewBox="0 0 360 320" style={{ width: '100%', maxWidth: 420, display: 'block', margin: '0 auto' }}>
            <rect x="54" y="44" width="252" height="264" rx="8" fill="var(--surface-3)" stroke="var(--border)" strokeWidth="1" />
            <rect x="54" y="80" width="20"  height="40"  rx="3" fill="var(--surface-4)" stroke="var(--border)" strokeWidth="1" />
            <rect x="44" y="86" width="14"  height="28"  rx="2" fill="var(--surface-3)" stroke="var(--border)" strokeWidth="1" />
            <circle cx="110" cy="270" r="7" fill="var(--surface-4)" stroke="var(--border)" strokeWidth="1" />
            <text x="110" y="287" textAnchor="middle" fontSize="6" fill="var(--fg-faint)" fontFamily="monospace">RST</text>
            <rect x="130" y="130" width="100" height="80" rx="4" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="1" />
            <text x="180" y="168" textAnchor="middle" fontSize="7" fill="var(--fg-faint)" fontFamily="monospace">ATmega328P</text>
            <text x="180" y="178" textAnchor="middle" fontSize="6" fill="var(--fg-faint)" fontFamily="monospace">16 MHz</text>
            <rect x="160" y="224" width="8" height="16" rx="2" fill="var(--surface-3)" stroke="var(--border)" strokeWidth="0.5" />
            <text x="164" y="250" textAnchor="middle" fontSize="5.5" fill="var(--fg-faint)" fontFamily="monospace">16MHz</text>

            {UNO_PINS.map(pin => {
              const isHov = pin.id === hovered
              const color = PIN_COLORS[pin.info.special ?? 'default'] ?? PIN_COLORS.default
              return (
                <g key={pin.id}>
                  <circle
                    cx={pin.x} cy={pin.y} r={isHov ? 7 : 5}
                    fill={isHov ? color : 'var(--surface-4)'}
                    stroke={color} strokeWidth={isHov ? 1.5 : 0.8}
                    style={{ cursor: 'pointer', transition: 'all 0.1s' }}
                    onMouseEnter={() => setHovered(pin.id)}
                    onMouseLeave={() => setHovered(null)}
                  />
                  {isHov && <circle cx={pin.x} cy={pin.y} r={10} fill="none" stroke={color} strokeWidth={0.8} opacity={0.4} />}
                  <text
                    x={pin.x < 180 ? pin.x - 10 : pin.x + 10}
                    y={pin.y + 3}
                    textAnchor={pin.x < 180 ? 'end' : 'start'}
                    fontSize={7} fill={isHov ? color : 'var(--fg-faint)'}
                    fontFamily="monospace"
                    style={{ pointerEvents: 'none', transition: 'fill 0.1s' }}
                  >{pin.label}</text>
                </g>
              )
            })}
            <text x="180" y="296" textAnchor="middle" fontSize="8" fill="var(--fg-faint)" fontFamily="monospace">Arduino Uno</text>
          </svg>
        </div>

        {/* Info panel */}
        <div style={{ width: 170, borderLeft: '1px solid var(--border)', padding: 12, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {hovPin ? (
            <div>
              <div style={{ display: 'inline-block', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 7px', marginBottom: 7, fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>
                {hovPin.label}
              </div>
              {hovPin.info.special && (
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)', background: 'var(--surface-3)', display: 'inline-block', padding: '1px 6px', borderRadius: 3, marginBottom: 8, marginLeft: 4 }}>
                  {hovPin.info.special}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.65, fontFamily: 'var(--font-sans)' }}>
                <div><span style={{ color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>mode: </span>{hovPin.info.mode}</div>
                <div style={{ marginTop: 3 }}><span style={{ color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>voltage: </span>{hovPin.info.voltage}</div>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--fg-faint)', fontSize: 10, fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
              hover a pin for details
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Lolin Wemos D1 Mini
// ─────────────────────────────────────────────────────────────────────────────

const WEMOS_PINS: PinInfo[] = [
  // Left column (top → bottom), x ≈ 66
  { id:'RST',  x:66, y:70,  label:'RST',  info:{ mode:'Reset (active LOW)',            voltage:'3.3V', special:'System' }},
  { id:'A0',   x:66, y:90,  label:'A0',   info:{ mode:'Analog in 10-bit (max 3.2 V)', voltage:'3.2V max', special:'ADC' }},
  { id:'D0',   x:66, y:110, label:'D0',   info:{ mode:'GPIO16 — no PWM / I2C / INT',  voltage:'3.3V', gpio:'GPIO16' }},
  { id:'D5',   x:66, y:130, label:'D5',   info:{ mode:'GPIO14 / SPI SCK / PWM',       voltage:'3.3V', special:'SPI', gpio:'GPIO14' }},
  { id:'D6',   x:66, y:150, label:'D6',   info:{ mode:'GPIO12 / SPI MISO / PWM',      voltage:'3.3V', special:'SPI', gpio:'GPIO12' }},
  { id:'D7',   x:66, y:170, label:'D7',   info:{ mode:'GPIO13 / SPI MOSI / PWM',      voltage:'3.3V', special:'SPI', gpio:'GPIO13' }},
  { id:'D8',   x:66, y:190, label:'D8',   info:{ mode:'GPIO15 / SPI SS / PWM — pulled LOW, boot fails if HIGH', voltage:'3.3V', special:'SPI', gpio:'GPIO15' }},
  { id:'GND1', x:66, y:213, label:'GND',  info:{ mode:'Ground',                       voltage:'0V',   special:'Power' }},
  { id:'5V',   x:66, y:233, label:'5V',   info:{ mode:'5V power input/output (USB)',  voltage:'5V',   special:'Power' }},
  // Right column (top → bottom), x ≈ 234
  { id:'TX',   x:234, y:70,  label:'TX',  info:{ mode:'GPIO1 / Serial TX — debug output at boot', voltage:'3.3V', special:'UART', gpio:'GPIO1' }},
  { id:'RX',   x:234, y:90,  label:'RX',  info:{ mode:'GPIO3 / Serial RX',            voltage:'3.3V', special:'UART', gpio:'GPIO3' }},
  { id:'D1',   x:234, y:110, label:'D1',  info:{ mode:'GPIO5 / I2C SCL / PWM',        voltage:'3.3V', special:'I2C',  gpio:'GPIO5' }},
  { id:'D2',   x:234, y:130, label:'D2',  info:{ mode:'GPIO4 / I2C SDA / PWM',        voltage:'3.3V', special:'I2C',  gpio:'GPIO4' }},
  { id:'D3',   x:234, y:150, label:'D3',  info:{ mode:'GPIO0 / pulled up — FLASH button, boot fails if LOW', voltage:'3.3V', gpio:'GPIO0' }},
  { id:'D4',   x:234, y:170, label:'D4',  info:{ mode:'GPIO2 / built-in LED / pulled up / TXD1', voltage:'3.3V', special:'LED', gpio:'GPIO2' }},
  { id:'GND2', x:234, y:193, label:'GND', info:{ mode:'Ground',                       voltage:'0V',   special:'Power' }},
  { id:'3V3',  x:234, y:213, label:'3V3', info:{ mode:'3.3V output (350 mA max)',     voltage:'3.3V', special:'Power' }},
]

const WEMOS_COLORS: Record<string, string> = {
  'ADC':    '#b8b8b8', 'SPI':    '#d0d0d0', 'I2C':    '#909090',
  'UART':   '#c0c0c0', 'LED':    '#e0e0e0', 'Power':  '#888888',
  'System': '#707070', 'default':'#484848',
}

const WEMOS_SPECS: SpecRow[] = [
  ['MCU',          'ESP8266EX (Tensilica L106)'],
  ['Clock',        '80 / 160 MHz'],
  ['Flash',        '4 MB'],
  ['SRAM',         '80 KB (user) / 32 KB (instruction)'],
  ['I/O voltage',  '3.3 V'],
  ['Analog in',    '1 × 10-bit (max 3.2 V)'],
  ['PWM pins',     'D1–D8 except D0'],
  ['UART',         '2 (TX/RX + TXD1 on D4)'],
  ['I2C',          'D1 (SCL) / D2 (SDA)'],
  ['SPI',          'D5 (SCK) / D6 (MISO) / D7 (MOSI) / D8 (SS)'],
  ['Wi-Fi',        '802.11 b/g/n, 2.4 GHz'],
  ['Supply',       '3.3 V pin or 5 V USB'],
]

// ─────────────────────────────────────────────────────────────────────────────
//  Seeed XIAO RP2040
// ─────────────────────────────────────────────────────────────────────────────

const XIAO_PINS: PinInfo[] = [
  // Left column (x≈62) top→bottom
  { id:'D0',  x:62,  y:60,  label:'D0/A0',  info:{ mode:'GPIO26 · ADC0 · Digital I/O',        voltage:'3.3V', special:'ADC',  gpio:'GPIO26' }},
  { id:'D1',  x:62,  y:82,  label:'D1/A1',  info:{ mode:'GPIO27 · ADC1 · Digital I/O',        voltage:'3.3V', special:'ADC',  gpio:'GPIO27' }},
  { id:'D2',  x:62,  y:104, label:'D2/A2',  info:{ mode:'GPIO28 · ADC2 · Digital I/O',        voltage:'3.3V', special:'ADC',  gpio:'GPIO28' }},
  { id:'D3',  x:62,  y:126, label:'D3/A3',  info:{ mode:'GPIO29 · ADC3 · Digital I/O',        voltage:'3.3V', special:'ADC',  gpio:'GPIO29' }},
  { id:'D4',  x:62,  y:148, label:'D4/SDA', info:{ mode:'GPIO6 · I2C1 SDA · PWM',             voltage:'3.3V', special:'I2C',  gpio:'GPIO6'  }},
  { id:'D5',  x:62,  y:170, label:'D5/SCL', info:{ mode:'GPIO7 · I2C1 SCL · PWM',             voltage:'3.3V', special:'I2C',  gpio:'GPIO7'  }},
  { id:'D6',  x:62,  y:192, label:'D6/TX',  info:{ mode:'GPIO0 · UART0 TX · PWM',             voltage:'3.3V', special:'UART', gpio:'GPIO0'  }},
  // Right column (x≈238) top→bottom
  { id:'D7',  x:238, y:60,  label:'D7/RX',  info:{ mode:'GPIO1 · UART0 RX · PWM',             voltage:'3.3V', special:'UART', gpio:'GPIO1'  }},
  { id:'D8',  x:238, y:82,  label:'D8/SCK', info:{ mode:'GPIO2 · SPI0 SCK · PWM',             voltage:'3.3V', special:'SPI',  gpio:'GPIO2'  }},
  { id:'D9',  x:238, y:104, label:'D9/MISO',info:{ mode:'GPIO4 · SPI0 MISO · PWM',            voltage:'3.3V', special:'SPI',  gpio:'GPIO4'  }},
  { id:'D10', x:238, y:126, label:'D10/MOSI',info:{ mode:'GPIO3 · SPI0 MOSI · PWM',           voltage:'3.3V', special:'SPI',  gpio:'GPIO3'  }},
  { id:'3V3', x:238, y:148, label:'3.3V',   info:{ mode:'3.3V power output (600 mA max)',      voltage:'3.3V', special:'Power'}},
  { id:'GND', x:238, y:170, label:'GND',    info:{ mode:'Ground',                              voltage:'0V',   special:'Power'}},
  { id:'5V',  x:238, y:192, label:'5V/VBUS',info:{ mode:'5V from USB · power input',           voltage:'5V',   special:'Power'}},
]

const XIAO_COLORS: Record<string, string> = {
  'ADC':   '#b8b8b8', 'I2C':   '#909090', 'SPI':   '#d0d0d0',
  'UART':  '#c0c0c0', 'Power': '#888888', 'default': '#484848',
}

const XIAO_SPECS: SpecRow[] = [
  ['MCU',         'RP2040 (dual-core Cortex-M0+)'],
  ['Clock',       'up to 133 MHz'],
  ['Flash',       '2 MB (W25Q16JVUXIQ)'],
  ['SRAM',        '264 KB on-chip'],
  ['I/O voltage', '3.3 V (NOT 5V tolerant)'],
  ['Digital I/O', '11 (D0–D10)'],
  ['Analog in',   '4 × 12-bit (D0–D3 / A0–A3)'],
  ['PWM',         'All pins via RP2040 PWM slices'],
  ['UART',        '1 (D6/TX · D7/RX)'],
  ['I2C',         '1 (D4/SDA · D5/SCL)'],
  ['SPI',         '1 (D8/SCK · D9/MISO · D10/MOSI)'],
  ['Built-in LED','D11 / GPIO25 (active LOW)'],
  ['NeoPixel',    'GPIO12 — RGB addressable LED'],
  ['USB',         'USB-C · native RP2040 USB'],
  ['Size',        '21 × 17.5 mm'],
  ['Supply',      '3.3V pin or 5V USB-C'],
]

function XiaoRp2040Pinout() {
  const [hovered, setHovered] = useState<string | null>(null)
  const hovPin = XIAO_PINS.find(p => p.id === hovered)

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 6,
      overflow: 'hidden', marginBottom: 14, background: 'var(--surface-1)',
    }}>
      <div style={{
        padding: '6px 12px', background: 'var(--surface-2)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--fg-faint)', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
          Seeed XIAO RP2040 — Pinout
        </span>
        <div style={{ display: 'flex', gap: 10, fontSize: 9, fontFamily: 'var(--font-mono)' }}>
          {[['ADC','ADC'],['I2C','I2C'],['SPI','SPI'],['UART','UART'],['PWR','Power']].map(([label, key]) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--fg-faint)' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: XIAO_COLORS[key], display: 'inline-block' }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex' }}>
        <div style={{ flex: 1, padding: '8px 0' }}>
          <svg viewBox="0 0 300 270" style={{ width: '100%', maxWidth: 380, display: 'block', margin: '0 auto' }}>
            {/* PCB — green, tiny (21×17.5mm proportionally scaled) */}
            <rect x="82" y="36" width="136" height="186" rx="5"
                  fill="var(--surface-3)" stroke="#16a34a" strokeWidth="1.5" />
            <rect x="84" y="38" width="132" height="182" rx="4"
                  fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="0.5" />

            {/* USB-C top */}
            <rect x="118" y="22" width="64" height="17" rx="3" fill="var(--surface-4)" stroke="var(--border)" strokeWidth="1" />
            <rect x="124" y="18" width="52" height="10" rx="2" fill="var(--surface-3)" stroke="var(--border)" strokeWidth="0.8" />
            <text x="150" y="33" textAnchor="middle" fontSize="6" fill="var(--fg-faint)" fontFamily="monospace">USB-C</text>

            {/* RP2040 chip */}
            <rect x="110" y="80" width="80" height="70" rx="3" fill="#111" />
            <rect x="112" y="82" width="76" height="66" rx="2" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="0.5" />
            <text x="150" y="113" textAnchor="middle" fontSize="7.5" fill="var(--fg-faint)" fontFamily="monospace" fontWeight="600">RP2040</text>
            <text x="150" y="124" textAnchor="middle" fontSize="6"   fill="var(--fg-faint)" fontFamily="monospace">133 MHz</text>
            <text x="150" y="134" textAnchor="middle" fontSize="5.5" fill="var(--fg-faint)" fontFamily="monospace">264 KB SRAM</text>

            {/* NeoPixel */}
            <circle cx="150" cy="175" r="7" fill="none" stroke="#7c3aed" strokeWidth="1" />
            <circle cx="150" cy="175" r="4" fill="#7c3aed" opacity="0.5" />
            <text x="150" y="191" textAnchor="middle" fontSize="5.5" fill="var(--fg-faint)" fontFamily="monospace">NeoPixel</text>

            {/* Status LEDs */}
            <circle cx="106" cy="210" r="3.5" fill="none" stroke="#22c55e" strokeWidth="1" />
            <text x="106" y="221" textAnchor="middle" fontSize="5" fill="var(--fg-faint)" fontFamily="monospace">PWR</text>
            <circle cx="150" cy="210" r="3.5" fill="none" stroke="#f97316" strokeWidth="1" />
            <text x="150" y="221" textAnchor="middle" fontSize="5" fill="var(--fg-faint)" fontFamily="monospace">CHG</text>
            <circle cx="194" cy="210" r="3.5" fill="none" stroke="#3b82f6" strokeWidth="1" />
            <text x="194" y="221" textAnchor="middle" fontSize="5" fill="var(--fg-faint)" fontFamily="monospace">USR</text>

            {/* Castellated pads (decorative marks) */}
            {[60,82,104,126,148,170,192].map((y, i) => (
              <rect key={`pl${i}`} x="79" y={y - 3} width="5" height="6" rx="1" fill="var(--surface-4)" stroke="var(--border)" strokeWidth="0.5" />
            ))}
            {[60,82,104,126,148,170,192].map((y, i) => (
              <rect key={`pr${i}`} x="216" y={y - 3} width="5" height="6" rx="1" fill="var(--surface-4)" stroke="var(--border)" strokeWidth="0.5" />
            ))}

            {/* Pin dots */}
            {XIAO_PINS.map(pin => {
              const isHov = pin.id === hovered
              const color = XIAO_COLORS[pin.info.special ?? 'default'] ?? XIAO_COLORS.default
              return (
                <g key={pin.id}>
                  <circle
                    cx={pin.x} cy={pin.y} r={isHov ? 7 : 5}
                    fill={isHov ? color : 'var(--surface-4)'}
                    stroke={color} strokeWidth={isHov ? 1.5 : 0.8}
                    style={{ cursor: 'pointer', transition: 'all 0.1s' }}
                    onMouseEnter={() => setHovered(pin.id)}
                    onMouseLeave={() => setHovered(null)}
                  />
                  {isHov && <circle cx={pin.x} cy={pin.y} r={10} fill="none" stroke={color} strokeWidth={0.8} opacity={0.4} />}
                  <text
                    x={pin.x < 150 ? pin.x - 10 : pin.x + 10}
                    y={pin.y + 3}
                    textAnchor={pin.x < 150 ? 'end' : 'start'}
                    fontSize={7} fill={isHov ? color : 'var(--fg-faint)'}
                    fontFamily="monospace"
                    style={{ pointerEvents: 'none', transition: 'fill 0.1s' }}
                  >{pin.label}</text>
                </g>
              )
            })}
            <text x="150" y="255" textAnchor="middle" fontSize="7.5" fill="var(--fg-faint)" fontFamily="monospace">Seeed XIAO RP2040</text>
          </svg>
        </div>

        {/* Info panel */}
        <div style={{ width: 185, borderLeft: '1px solid var(--border)', padding: 12, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {hovPin ? (
            <div>
              <div style={{ display: 'inline-block', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 7px', marginBottom: 4, fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>
                {hovPin.label}
              </div>
              {hovPin.info.gpio && (
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--fg-faint)', marginBottom: 4, marginLeft: 4, display: 'inline-block' }}>
                  {hovPin.info.gpio}
                </div>
              )}
              {hovPin.info.special && (
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)', background: 'var(--surface-3)', display: 'inline-block', padding: '1px 6px', borderRadius: 3, marginBottom: 8, marginLeft: 4 }}>
                  {hovPin.info.special}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.65, fontFamily: 'var(--font-sans)' }}>
                <div><span style={{ color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>mode: </span>{hovPin.info.mode}</div>
                <div style={{ marginTop: 3 }}><span style={{ color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>voltage: </span>{hovPin.info.voltage}</div>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--fg-faint)', fontSize: 10, fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
              hover a pin for details
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Lolin Wemos D1 Mini — pinout diagram
// ─────────────────────────────────────────────────────────────────────────────

function WemosD1Pinout() {
  const [hovered, setHovered] = useState<string | null>(null)
  const hovPin = WEMOS_PINS.find(p => p.id === hovered)

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 6,
      overflow: 'hidden', marginBottom: 14, background: 'var(--surface-1)',
    }}>
      {/* Header */}
      <div style={{
        padding: '6px 12px', background: 'var(--surface-2)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--fg-faint)', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
          Lolin Wemos D1 Mini — Pinout
        </span>
        <div style={{ display: 'flex', gap: 10, fontSize: 9, fontFamily: 'var(--font-mono)' }}>
          {[['ADC','ADC'],['I2C','I2C'],['SPI','SPI'],['UART','UART'],['LED','LED'],['PWR','Power']].map(([label, key]) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--fg-faint)' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: WEMOS_COLORS[key], display: 'inline-block' }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex' }}>
        {/* SVG */}
        <div style={{ flex: 1, padding: '8px 0' }}>
          <svg viewBox="0 0 300 290" style={{ width: '100%', maxWidth: 380, display: 'block', margin: '0 auto' }}>
            {/* Board */}
            <rect x="76" y="44" width="148" height="215" rx="6" fill="var(--surface-3)" stroke="var(--border)" strokeWidth="1" />

            {/* USB micro connector */}
            <rect x="103" y="28" width="44" height="20" rx="3" fill="var(--surface-4)" stroke="var(--border)" strokeWidth="1" />
            <rect x="110" y="22" width="30" height="10" rx="2" fill="var(--surface-3)" stroke="var(--border)" strokeWidth="0.8" />
            <text x="125" y="38" textAnchor="middle" fontSize="5" fill="var(--fg-faint)" fontFamily="monospace">USB</text>

            {/* ESP8266 chip */}
            <rect x="102" y="100" width="96" height="80" rx="3" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="0.8" />
            <text x="150" y="137" textAnchor="middle" fontSize="7" fill="var(--fg-faint)" fontFamily="monospace">ESP8266EX</text>
            <text x="150" y="148" textAnchor="middle" fontSize="6" fill="var(--fg-faint)" fontFamily="monospace">80 / 160 MHz</text>

            {/* Wi-Fi ceramic antenna area */}
            <rect x="180" y="50" width="36" height="44" rx="2" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3,2" />
            <text x="198" y="74" textAnchor="middle" fontSize="5.5" fill="var(--fg-faint)" fontFamily="monospace">WiFi</text>
            <text x="198" y="82" textAnchor="middle" fontSize="5" fill="var(--fg-faint)" fontFamily="monospace">ant.</text>

            {/* Reset button */}
            <rect x="90" y="218" width="18" height="12" rx="2" fill="var(--surface-4)" stroke="var(--border)" strokeWidth="0.8" />
            <text x="99" y="238" textAnchor="middle" fontSize="5.5" fill="var(--fg-faint)" fontFamily="monospace">RST</text>

            {/* Flash button */}
            <rect x="142" y="218" width="18" height="12" rx="2" fill="var(--surface-4)" stroke="var(--border)" strokeWidth="0.8" />
            <text x="151" y="238" textAnchor="middle" fontSize="5.5" fill="var(--fg-faint)" fontFamily="monospace">FLASH</text>

            {/* LED indicator */}
            <circle cx="176" cy="225" r="4" fill="none" stroke="var(--border)" strokeWidth="0.8" />
            <text x="176" y="239" textAnchor="middle" fontSize="5.5" fill="var(--fg-faint)" fontFamily="monospace">LED</text>

            {/* Pin dots */}
            {WEMOS_PINS.map(pin => {
              const isHov = pin.id === hovered
              const color = WEMOS_COLORS[pin.info.special ?? 'default'] ?? WEMOS_COLORS.default
              return (
                <g key={pin.id}>
                  <circle
                    cx={pin.x} cy={pin.y} r={isHov ? 7 : 5}
                    fill={isHov ? color : 'var(--surface-4)'}
                    stroke={color} strokeWidth={isHov ? 1.5 : 0.8}
                    style={{ cursor: 'pointer', transition: 'all 0.1s' }}
                    onMouseEnter={() => setHovered(pin.id)}
                    onMouseLeave={() => setHovered(null)}
                  />
                  {isHov && <circle cx={pin.x} cy={pin.y} r={10} fill="none" stroke={color} strokeWidth={0.8} opacity={0.4} />}
                  <text
                    x={pin.x < 150 ? pin.x - 10 : pin.x + 10}
                    y={pin.y + 3}
                    textAnchor={pin.x < 150 ? 'end' : 'start'}
                    fontSize={7} fill={isHov ? color : 'var(--fg-faint)'}
                    fontFamily="monospace"
                    style={{ pointerEvents: 'none', transition: 'fill 0.1s' }}
                  >{pin.label}</text>
                </g>
              )
            })}

            <text x="150" y="275" textAnchor="middle" fontSize="7.5" fill="var(--fg-faint)" fontFamily="monospace">Lolin Wemos D1 Mini</text>
          </svg>
        </div>

        {/* Info panel */}
        <div style={{ width: 180, borderLeft: '1px solid var(--border)', padding: 12, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {hovPin ? (
            <div>
              <div style={{ display: 'inline-block', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 7px', marginBottom: 4, fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>
                {hovPin.label}
              </div>
              {hovPin.info.gpio && (
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--fg-faint)', marginBottom: 4, marginLeft: 4, display: 'inline-block' }}>
                  {hovPin.info.gpio}
                </div>
              )}
              {hovPin.info.special && (
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)', background: 'var(--surface-3)', display: 'inline-block', padding: '1px 6px', borderRadius: 3, marginBottom: 8, marginLeft: 4 }}>
                  {hovPin.info.special}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.65, fontFamily: 'var(--font-sans)' }}>
                <div><span style={{ color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>mode: </span>{hovPin.info.mode}</div>
                <div style={{ marginTop: 3 }}><span style={{ color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>voltage: </span>{hovPin.info.voltage}</div>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--fg-faint)', fontSize: 10, fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
              hover a pin for details
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Board selector + page
// ─────────────────────────────────────────────────────────────────────────────

type BoardId = 'uno' | 'wemos-d1' | 'xiao-rp2040'

interface BoardMeta {
  id: BoardId
  name: string
  tsukiId: string
  chip: string
  badge: string
  Diagram: React.ComponentType
  specs: SpecRow[]
  desc: string
}

const BOARDS: BoardMeta[] = [
  {
    id: 'uno',
    name: 'Arduino Uno',
    tsukiId: 'uno',
    chip: 'ATmega328P',
    badge: 'AVR',
    desc: 'The classic. 5 V I/O, 2 KB SRAM, 32 KB flash. Best board for learning tsuki — every example targets Uno by default.',
    Diagram: ArduinoUnoPinout,
    specs: UNO_SPECS,
  },
  {
    id: 'wemos-d1',
    name: 'Lolin Wemos D1 Mini',
    tsukiId: 'esp8266',
    chip: 'ESP8266EX',
    badge: 'ESP',
    desc: 'Compact Wi-Fi board. 3.3 V I/O, 80 KB SRAM, 4 MB flash. Use it for IoT projects — HTTP, MQTT, and WebSocket work out of the box.',
    Diagram: WemosD1Pinout,
    specs: WEMOS_SPECS,
  },
  {
    id: 'xiao-rp2040',
    name: 'Seeed XIAO RP2040',
    tsukiId: 'xiao_rp2040',
    chip: 'RP2040',
    badge: 'RP2',
    desc: 'Tiny 21×17.5 mm powerhouse. Dual-core Cortex-M0+ at 133 MHz, 264 KB SRAM, 2 MB flash, USB-C and an onboard NeoPixel RGB LED. 3.3 V I/O only.',
    Diagram: XiaoRp2040Pinout,
    specs: XIAO_SPECS,
  },
]

export default function BoardsPage() {
  const [activeId, setActiveId] = useState<BoardId>('uno')
  const board = BOARDS.find(b => b.id === activeId)!

  return (
    <div>
      <P>
        tsuki targets multiple boards. Select a board below to see its pinout,
        specs, and the correct <InlineCode>--board</InlineCode> flag for the CLI.
      </P>

      {/* Board selector */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap',
      }}>
        {BOARDS.map(b => (
          <button
            key={b.id}
            onClick={() => setActiveId(b.id)}
            style={{
              border: `1px solid ${activeId === b.id ? 'var(--fg-muted)' : 'var(--border)'}`,
              background: activeId === b.id ? 'var(--surface-2)' : 'transparent',
              borderRadius: 6, padding: '8px 14px',
              cursor: 'pointer', textAlign: 'left',
              display: 'flex', flexDirection: 'column', gap: 3,
              transition: 'all 0.1s',
              minWidth: 160,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600,
                color: activeId === b.id ? 'var(--fg)' : 'var(--fg-faint)',
                background: 'var(--surface-3)', border: '1px solid var(--border)',
                borderRadius: 3, padding: '0 4px',
              }}>{b.badge}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: activeId === b.id ? 'var(--fg)' : 'var(--fg-muted)', fontFamily: 'var(--font-sans)' }}>
                {b.name}
              </span>
            </div>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-faint)' }}>
              {b.chip}
            </span>
          </button>
        ))}
      </div>

      {/* Description + board id */}
      <P>{board.desc}</P>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        border: '1px solid var(--border)', borderRadius: 5, padding: '5px 10px',
        background: 'var(--surface-2)', marginBottom: 20,
        fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)',
      }}>
        <span style={{ color: 'var(--fg-faint)' }}>--board</span>
        <span style={{ color: 'var(--fg)', fontWeight: 600 }}>{board.tsukiId}</span>
        <span style={{ color: 'var(--fg-faint)', fontSize: 9 }}>·</span>
        <span style={{ color: 'var(--fg-faint)' }}>tsuki build --board {board.tsukiId}</span>
      </div>

      {/* Pinout */}
      <H2>Pinout</H2>
      <P>Hover any pin to see its mode, voltage, and available functions.</P>
      {board.Diagram && <board.Diagram />}

      {/* Specs */}
      <H2>Specifications</H2>
      <Table cols={['Property', 'Value']} rows={board.specs} />

      {/* Notes */}
      {activeId === 'wemos-d1' && (
        <>
          <Divider />
          <H2>Wemos D1 Mini notes</H2>
          <P>
            The ESP8266 is a 3.3 V device. Never connect 5 V directly to any I/O pin.
            The analog pin <InlineCode>A0</InlineCode> accepts a maximum of 3.2 V — use a voltage divider
            if reading from a 5 V source.
          </P>
          <Note kind="warn">
            <strong>Boot pins:</strong> D3 (GPIO0) must be HIGH and D8 (GPIO15) must be LOW at boot.
            Avoid driving these low/high externally before the chip resets or the board will fail to boot.
          </Note>
          <Note kind="info">
            D4 (GPIO2) has the built-in blue LED. It is also used as a secondary UART TX (TXD1),
            so avoid using it as an output if you rely on serial debugging.
          </Note>
        </>
      )}
      {activeId === 'uno' && (
        <>
          <Divider />
          <H2>Arduino Uno notes</H2>
          <P>
            The Uno operates at 5 V. Analog pins A0–A5 can also be used as digital I/O (D14–D19).
            The <InlineCode>Serial</InlineCode> pins D0 and D1 are shared with the USB-to-serial
            chip — avoid using them for general I/O if the Serial Monitor is open.
          </P>
          <Note kind="tip">
            Pin D13 has a built-in resistor and LED — useful for blink tests without extra hardware.
            This is the tsuki default <InlineCode>ledPin</InlineCode> in all examples.
          </Note>
        </>
      )}
      {activeId === 'xiao-rp2040' && (
        <>
          <Divider />
          <H2>XIAO RP2040 notes</H2>
          <P>
            The XIAO RP2040 is a <strong>3.3 V device</strong>. Never apply 5 V to any I/O pin —
            the RP2040 is not 5 V tolerant and will be permanently damaged.
          </P>
          <Note kind="warn">
            <strong>Power input:</strong> The 5V/VBUS pin provides power <em>from</em> USB.
            If you need to power the board externally (not via USB), connect 3.3–5 V to the
            5V pin (it feeds through a regulator) or connect 3.3 V directly to the 3V3 pin.
          </Note>
          <Note kind="tip">
            The onboard <strong>NeoPixel</strong> RGB LED is connected to GPIO12. To control it
            use the <InlineCode>ws2812</InlineCode> tsuki package — a single pixel at index 0.
            The three status LEDs (PWR, CHG, USR) are active-LOW; the user LED maps to
            <InlineCode>LED_BUILTIN</InlineCode> (GPIO25).
          </Note>
          <Note kind="info">
            All GPIO pins support <strong>PWM</strong> via the RP2040's flexible PWM slices.
            Pins D0–D3 are also 12-bit ADC inputs (A0–A3). The RP2040 has no DAC.
          </Note>
          <P>
            Use <InlineCode>tsuki build --board xiao_rp2040</InlineCode> or set the board
            to <InlineCode>xiao_rp2040</InlineCode> in your <InlineCode>tsuki.toml</InlineCode>.
          </P>
        </>
      )}
    </div>
  )
}