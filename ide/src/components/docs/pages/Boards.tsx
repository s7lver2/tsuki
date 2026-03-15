// ─────────────────────────────────────────────────────────────────────────────
//  pages/Boards.tsx
//  Interactive pinout diagrams for Arduino Uno and Lolin Wemos D1 Mini
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
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
//  Seeed Xiao RP2040
// ─────────────────────────────────────────────────────────────────────────────

const XIAO_PINS: PinInfo[] = [
  { id:'D0',  x:68,  y:78,  label:'D0',       info:{ mode:'GPIO0 / Digital I/O',           voltage:'3.3V' }},
  { id:'D1',  x:68,  y:98,  label:'D1',       info:{ mode:'GPIO1 / Digital I/O',           voltage:'3.3V' }},
  { id:'D2',  x:68,  y:118, label:'D2',       info:{ mode:'GPIO2 / Digital I/O',           voltage:'3.3V' }},
  { id:'D3',  x:68,  y:138, label:'D3 ~',     info:{ mode:'GPIO3 / PWM',                   voltage:'3.3V', special:'PWM' }},
  { id:'D4',  x:68,  y:158, label:'D4 SDA',   info:{ mode:'GPIO4 / I2C SDA / PWM',         voltage:'3.3V', special:'I2C' }},
  { id:'D5',  x:68,  y:178, label:'D5 SCL',   info:{ mode:'GPIO5 / I2C SCL / PWM',         voltage:'3.3V', special:'I2C' }},
  { id:'D6',  x:68,  y:198, label:'D6 TX',    info:{ mode:'GPIO6 / UART TX',               voltage:'3.3V', special:'UART' }},
  { id:'D7',  x:68,  y:218, label:'D7 RX',    info:{ mode:'GPIO7 / UART RX',               voltage:'3.3V', special:'UART' }},
  { id:'D8',  x:232, y:78,  label:'D8 SCK',   info:{ mode:'GPIO8 / SPI SCK',               voltage:'3.3V', special:'SPI' }},
  { id:'D9',  x:232, y:98,  label:'D9 MISO',  info:{ mode:'GPIO9 / SPI MISO',              voltage:'3.3V', special:'SPI' }},
  { id:'D10', x:232, y:118, label:'D10 MOSI', info:{ mode:'GPIO10 / SPI MOSI',             voltage:'3.3V', special:'SPI' }},
  { id:'A0',  x:232, y:158, label:'A0',       info:{ mode:'GPIO26 / Analog in 12-bit',     voltage:'3.3V ref', special:'ADC' }},
  { id:'A1',  x:232, y:178, label:'A1',       info:{ mode:'GPIO27 / Analog in 12-bit',     voltage:'3.3V ref', special:'ADC' }},
  { id:'A2',  x:232, y:198, label:'A2',       info:{ mode:'GPIO28 / Analog in 12-bit',     voltage:'3.3V ref', special:'ADC' }},
  { id:'3V3', x:232, y:218, label:'3.3V',     info:{ mode:'Power output (600 mA via pin)', voltage:'3.3V', special:'Power' }},
  { id:'GND', x:232, y:238, label:'GND',      info:{ mode:'Ground',                        voltage:'0V',   special:'Power' }},
  { id:'5V',  x:232, y:258, label:'5V',       info:{ mode:'5V input (USB power)',          voltage:'5V',   special:'Power' }},
]

const XIAO_COLORS: Record<string, string> = {
  'PWM':   '#a0a0a0', 'ADC':   '#b8b8b8', 'I2C':   '#909090',
  'UART':  '#c0c0c0', 'SPI':   '#d0d0d0', 'Power': '#888888', 'default': '#484848',
}

const XIAO_SPECS: SpecRow[] = [
  ['MCU',         'RP2040 (dual Cortex-M0+)'],
  ['Clock',       '133 MHz'],
  ['Flash',       '2 MB (QSPI)'],
  ['SRAM',        '264 KB'],
  ['I/O voltage', '3.3 V'],
  ['Analog in',   '3 × 12-bit (A0–A2 / GPIO26–28)'],
  ['PWM',         'All digital pins'],
  ['UART',        '1 (D6 TX / D7 RX)'],
  ['I2C',         '1 (D4 SDA / D5 SCL)'],
  ['SPI',         '1 (D8 SCK / D9 MISO / D10 MOSI)'],
  ['USB',         'USB-C · USB 1.1 device + host'],
  ['Size',        '21 × 17.5 mm'],
]

function XiaoRP2040Pinout() {
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
          Seeed Xiao RP2040 — Pinout
        </span>
        <div style={{ display: 'flex', gap: 10, fontSize: 9, fontFamily: 'var(--font-mono)' }}>
          {[['PWM~','PWM'],['ADC','ADC'],['I2C','I2C'],['UART','UART'],['SPI','SPI'],['PWR','Power']].map(([label, key]) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--fg-faint)' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: XIAO_COLORS[key], display: 'inline-block' }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex' }}>
        <div style={{ flex: 1, padding: '8px 0' }}>
          <svg viewBox="0 0 300 310" style={{ width: '100%', maxWidth: 380, display: 'block', margin: '0 auto' }}>
            <rect x="78" y="54" width="144" height="224" rx="6" fill="var(--surface-3)" stroke="var(--border)" strokeWidth="1" />
            <rect x="122" y="38" width="56" height="20" rx="4" fill="var(--surface-4)" stroke="var(--border)" strokeWidth="1" />
            <rect x="128" y="32" width="44" height="10" rx="3" fill="var(--surface-3)" stroke="var(--border)" strokeWidth="0.8" />
            <text x="150" y="49" textAnchor="middle" fontSize="5" fill="var(--fg-faint)" fontFamily="monospace">USB-C</text>
            <rect x="104" y="130" width="92" height="80" rx="3" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="0.8" />
            <text x="150" y="166" textAnchor="middle" fontSize="7.5" fill="var(--fg-faint)" fontFamily="monospace">RP2040</text>
            <text x="150" y="178" textAnchor="middle" fontSize="6" fill="var(--fg-faint)" fontFamily="monospace">133 MHz · dual-core</text>
            <rect x="90" y="230" width="34" height="22" rx="2" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="0.5" />
            <text x="107" y="243" textAnchor="middle" fontSize="5" fill="var(--fg-faint)" fontFamily="monospace">2MB Flash</text>
            <circle cx="176" cy="242" r="6" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="0.8" />
            <text x="176" y="256" textAnchor="middle" fontSize="5" fill="var(--fg-faint)" fontFamily="monospace">NEO</text>
            <rect x="90" y="66" width="16" height="10" rx="2" fill="var(--surface-4)" stroke="var(--border)" strokeWidth="0.8" />
            <text x="98" y="86" textAnchor="middle" fontSize="5" fill="var(--fg-faint)" fontFamily="monospace">BOOT</text>
            <rect x="152" y="66" width="16" height="10" rx="2" fill="var(--surface-4)" stroke="var(--border)" strokeWidth="0.8" />
            <text x="160" y="86" textAnchor="middle" fontSize="5" fill="var(--fg-faint)" fontFamily="monospace">RST</text>

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
            <text x="150" y="296" textAnchor="middle" fontSize="8" fill="var(--fg-faint)" fontFamily="monospace">Seeed Xiao RP2040</text>
          </svg>
        </div>
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
    name: 'Seeed Xiao RP2040',
    tsukiId: 'pico',
    chip: 'RP2040',
    badge: 'RP2',
    desc: 'Tiny 21×17.5 mm board with dual-core RP2040. 3.3 V I/O, 264 KB SRAM, 2 MB flash, USB-C. Great for space-constrained builds — same pinout as the Seeed Xiao family.',
    Diagram: XiaoRP2040Pinout,
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
          <H2>Xiao RP2040 notes</H2>
          <P>
            The RP2040 is a 3.3 V device — never apply 5 V to any I/O pin directly.
            The 5V pin is an input from USB; it is not regulated for general output use.
            Analog inputs A0–A2 use GPIO26–28 with a 12-bit ADC (0–4095 range).
          </P>
          <Note kind="info">
            Use <InlineCode>--board pico</InlineCode> in tsuki when targeting the Xiao RP2040.
            The RP2040 core is shared with the Raspberry Pi Pico.
          </Note>
          <Note kind="tip">
            The on-board NeoPixel RGB LED is connected to GPIO11 (data), GPIO12 (power).
            Use the <InlineCode>NeoPixel</InlineCode> package to drive it from tsuki.
          </Note>
          <Note kind="warn">
            Hold the <strong>BOOT</strong> button while connecting USB to enter UF2 bootloader mode
            for flashing. The reset button alone will not enter bootloader mode.
          </Note>
        </>
      )}
    </div>
  )
}