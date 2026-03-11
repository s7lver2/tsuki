// ── Tsuki Sandbox — types & component library ─────────────────────────────────

export interface CircuitPin {
  id: string
  label: string
  type: 'digital' | 'analog' | 'power' | 'gnd' | 'generic' | 'pwm' | 'i2c' | 'spi'
  rx: number   // relative 0..1 on component width
  ry: number   // relative 0..1 on component height
  direction?: 'in' | 'out' | 'inout'
  arduino?: number  // Arduino pin number for simulation mapping
}

export interface CircuitComponentDef {
  type: string
  label: string
  w: number
  h: number
  color: string
  borderColor: string
  pins: CircuitPin[]
  category: 'mcu' | 'output' | 'input' | 'passive' | 'power' | 'sensor' | 'display' | 'actuator'
  description: string
}

export interface PlacedComponent {
  id: string
  type: string
  label: string
  x: number
  y: number
  rotation: number
  color: string
  props: Record<string, string | number>
}

export interface CircuitWire {
  id: string
  fromComp: string
  fromPin: string
  toComp: string
  toPin: string
  color: string
  waypoints: { x: number; y: number }[]
}

export interface CircuitNote {
  id: string
  x: number
  y: number
  text: string
  color: string
}

export interface TsukiCircuit {
  version: '1'
  name: string
  board: string
  description: string
  components: PlacedComponent[]
  wires: CircuitWire[]
  notes: CircuitNote[]
}

// ── Pin color map ──────────────────────────────────────────────────────────────

export function pinColor(type: CircuitPin['type']): string {
  switch (type) {
    case 'power':   return '#ef4444'
    case 'gnd':     return '#6b7280'
    case 'digital': return '#3b82f6'
    case 'analog':  return '#a855f7'
    case 'pwm':     return '#f97316'
    case 'i2c':     return '#06b6d4'
    case 'spi':     return '#84cc16'
    default:        return '#8b8b8b'
  }
}

export function pinTypeBadge(type: CircuitPin['type']): string {
  const map: Record<string, string> = {
    power: '5V', gnd: 'GND', digital: 'D', analog: 'A', pwm: 'PWM', i2c: 'I²C', spi: 'SPI', generic: '·'
  }
  return map[type] ?? '·'
}

// ── Component definitions library ─────────────────────────────────────────────

export const COMP_DEFS: Record<string, CircuitComponentDef> = {

  // ── MCUs ──────────────────────────────────────────────────────────────────
  arduino_uno: {
    type: 'arduino_uno', label: 'Arduino Uno', w: 120, h: 178,
    color: '#1a5c2a', borderColor: '#0d3318', category: 'mcu',
    description: 'ATmega328P · 14 digital I/O · 6 analog · 32KB flash',
    pins: [
      { id: 'D0',  label: 'D0 / RX',  type: 'digital', rx: 0,   ry: 0.065, direction: 'inout', arduino: 0  },
      { id: 'D1',  label: 'D1 / TX',  type: 'digital', rx: 0,   ry: 0.115, direction: 'inout', arduino: 1  },
      { id: 'D2',  label: 'D2',       type: 'digital', rx: 0,   ry: 0.165, direction: 'inout', arduino: 2  },
      { id: 'D3',  label: 'D3 ~',     type: 'pwm',     rx: 0,   ry: 0.215, direction: 'inout', arduino: 3  },
      { id: 'D4',  label: 'D4',       type: 'digital', rx: 0,   ry: 0.265, direction: 'inout', arduino: 4  },
      { id: 'D5',  label: 'D5 ~',     type: 'pwm',     rx: 0,   ry: 0.315, direction: 'inout', arduino: 5  },
      { id: 'D6',  label: 'D6 ~',     type: 'pwm',     rx: 0,   ry: 0.365, direction: 'inout', arduino: 6  },
      { id: 'D7',  label: 'D7',       type: 'digital', rx: 0,   ry: 0.415, direction: 'inout', arduino: 7  },
      { id: 'D8',  label: 'D8',       type: 'digital', rx: 0,   ry: 0.465, direction: 'inout', arduino: 8  },
      { id: 'D9',  label: 'D9 ~',     type: 'pwm',     rx: 0,   ry: 0.515, direction: 'inout', arduino: 9  },
      { id: 'D10', label: 'D10 ~',    type: 'pwm',     rx: 0,   ry: 0.565, direction: 'inout', arduino: 10 },
      { id: 'D11', label: 'D11 ~ MOSI',type:'pwm',     rx: 0,   ry: 0.615, direction: 'inout', arduino: 11 },
      { id: 'D12', label: 'D12 MISO', type: 'spi',     rx: 0,   ry: 0.665, direction: 'inout', arduino: 12 },
      { id: 'D13', label: 'D13 SCK',  type: 'spi',     rx: 0,   ry: 0.715, direction: 'inout', arduino: 13 },
      { id: 'GND1',label: 'GND',      type: 'gnd',     rx: 0,   ry: 0.790, direction: 'inout' },
      { id: 'AREF',label: 'AREF',     type: 'generic', rx: 0,   ry: 0.840, direction: 'in'    },
      { id: 'SDA', label: 'SDA A4',   type: 'i2c',     rx: 0,   ry: 0.890, direction: 'inout' },
      { id: 'SCL', label: 'SCL A5',   type: 'i2c',     rx: 0,   ry: 0.940, direction: 'inout' },
      { id: 'VIN', label: 'VIN',      type: 'power',   rx: 1,   ry: 0.065, direction: 'in'    },
      { id: 'GND2',label: 'GND',      type: 'gnd',     rx: 1,   ry: 0.115, direction: 'inout' },
      { id: 'GND3',label: 'GND',      type: 'gnd',     rx: 1,   ry: 0.165, direction: 'inout' },
      { id: '5V',  label: '5V',       type: 'power',   rx: 1,   ry: 0.215, direction: 'out'   },
      { id: '3V3', label: '3.3V',     type: 'power',   rx: 1,   ry: 0.265, direction: 'out'   },
      { id: 'RST', label: 'RESET',    type: 'generic', rx: 1,   ry: 0.315, direction: 'in'    },
      { id: 'A0',  label: 'A0',       type: 'analog',  rx: 1,   ry: 0.490, direction: 'in',   arduino: 14 },
      { id: 'A1',  label: 'A1',       type: 'analog',  rx: 1,   ry: 0.540, direction: 'in',   arduino: 15 },
      { id: 'A2',  label: 'A2',       type: 'analog',  rx: 1,   ry: 0.590, direction: 'in',   arduino: 16 },
      { id: 'A3',  label: 'A3',       type: 'analog',  rx: 1,   ry: 0.640, direction: 'in',   arduino: 17 },
      { id: 'A4',  label: 'A4 SDA',   type: 'i2c',     rx: 1,   ry: 0.690, direction: 'inout',arduino: 18 },
      { id: 'A5',  label: 'A5 SCL',   type: 'i2c',     rx: 1,   ry: 0.740, direction: 'inout',arduino: 19 },
    ],
  },

  arduino_nano: {
    type: 'arduino_nano', label: 'Arduino Nano', w: 72, h: 160,
    color: '#14448a', borderColor: '#0a2855', category: 'mcu',
    description: 'ATmega328P · compact · 30-pin DIP · USB Mini-B',
    pins: [
      { id: 'D1',  label: 'D1 TX',  type: 'digital', rx: 0, ry: 0.04,  arduino: 1  },
      { id: 'D0',  label: 'D0 RX',  type: 'digital', rx: 0, ry: 0.10,  arduino: 0  },
      { id: 'RST', label: 'RESET',  type: 'generic', rx: 0, ry: 0.16  },
      { id: 'GND1',label: 'GND',    type: 'gnd',     rx: 0, ry: 0.22  },
      { id: 'D2',  label: 'D2',     type: 'digital', rx: 0, ry: 0.28,  arduino: 2  },
      { id: 'D3',  label: 'D3 ~',   type: 'pwm',     rx: 0, ry: 0.34,  arduino: 3  },
      { id: 'D4',  label: 'D4',     type: 'digital', rx: 0, ry: 0.40,  arduino: 4  },
      { id: 'D5',  label: 'D5 ~',   type: 'pwm',     rx: 0, ry: 0.46,  arduino: 5  },
      { id: 'D6',  label: 'D6 ~',   type: 'pwm',     rx: 0, ry: 0.52,  arduino: 6  },
      { id: 'D7',  label: 'D7',     type: 'digital', rx: 0, ry: 0.58,  arduino: 7  },
      { id: 'D8',  label: 'D8',     type: 'digital', rx: 0, ry: 0.64,  arduino: 8  },
      { id: 'D9',  label: 'D9 ~',   type: 'pwm',     rx: 0, ry: 0.70,  arduino: 9  },
      { id: 'D10', label: 'D10 ~',  type: 'pwm',     rx: 0, ry: 0.76,  arduino: 10 },
      { id: 'D11', label: 'D11 ~',  type: 'pwm',     rx: 0, ry: 0.82,  arduino: 11 },
      { id: 'D12', label: 'D12',    type: 'digital', rx: 0, ry: 0.88,  arduino: 12 },
      { id: 'D13', label: 'D13',    type: 'digital', rx: 0, ry: 0.94,  arduino: 13 },
      { id: '3V3', label: '3.3V',   type: 'power',   rx: 1, ry: 0.04  },
      { id: 'AREF',label: 'AREF',   type: 'generic', rx: 1, ry: 0.10  },
      { id: 'A0',  label: 'A0',     type: 'analog',  rx: 1, ry: 0.16,  arduino: 14 },
      { id: 'A1',  label: 'A1',     type: 'analog',  rx: 1, ry: 0.22,  arduino: 15 },
      { id: 'A2',  label: 'A2',     type: 'analog',  rx: 1, ry: 0.28,  arduino: 16 },
      { id: 'A3',  label: 'A3',     type: 'analog',  rx: 1, ry: 0.34,  arduino: 17 },
      { id: 'A4',  label: 'A4 SDA', type: 'i2c',     rx: 1, ry: 0.40,  arduino: 18 },
      { id: 'A5',  label: 'A5 SCL', type: 'i2c',     rx: 1, ry: 0.46,  arduino: 19 },
      { id: 'A6',  label: 'A6',     type: 'analog',  rx: 1, ry: 0.52  },
      { id: 'A7',  label: 'A7',     type: 'analog',  rx: 1, ry: 0.58  },
      { id: '5V',  label: '5V',     type: 'power',   rx: 1, ry: 0.64  },
      { id: 'RST2',label: 'RESET',  type: 'generic', rx: 1, ry: 0.70  },
      { id: 'GND2',label: 'GND',    type: 'gnd',     rx: 1, ry: 0.76  },
      { id: 'VIN', label: 'VIN',    type: 'power',   rx: 1, ry: 0.82  },
    ],
  },

  xiao_rp2040: {
    type: 'xiao_rp2040', label: 'Xiao RP2040', w: 68, h: 140,
    color: '#1c3a5e', borderColor: '#0f2236', category: 'mcu',
    description: 'Seeed Xiao RP2040 · RP2040 dual-core · 133 MHz · 14 GPIO · USB-C · tiny form factor',
    pins: [
      // Left column (top → bottom)
      { id: 'D0',  label: 'D0',        type: 'digital', rx: 0, ry: 0.07,  direction: 'inout', arduino: 0  },
      { id: 'D1',  label: 'D1',        type: 'digital', rx: 0, ry: 0.15,  direction: 'inout', arduino: 1  },
      { id: 'D2',  label: 'D2',        type: 'digital', rx: 0, ry: 0.23,  direction: 'inout', arduino: 2  },
      { id: 'D3',  label: 'D3',        type: 'pwm',     rx: 0, ry: 0.31,  direction: 'inout', arduino: 3  },
      { id: 'D4',  label: 'D4 / SDA',  type: 'i2c',     rx: 0, ry: 0.39,  direction: 'inout', arduino: 4  },
      { id: 'D5',  label: 'D5 / SCL',  type: 'i2c',     rx: 0, ry: 0.47,  direction: 'inout', arduino: 5  },
      { id: 'D6',  label: 'D6 / TX',   type: 'digital', rx: 0, ry: 0.55,  direction: 'inout', arduino: 6  },
      { id: 'D7',  label: 'D7 / RX',   type: 'digital', rx: 0, ry: 0.63,  direction: 'inout', arduino: 7  },
      // Right column (top → bottom)
      { id: 'D8',  label: 'D8 / SCK',  type: 'spi',     rx: 1, ry: 0.07,  direction: 'inout', arduino: 8  },
      { id: 'D9',  label: 'D9 / MISO', type: 'spi',     rx: 1, ry: 0.15,  direction: 'inout', arduino: 9  },
      { id: 'D10', label: 'D10 / MOSI',type: 'spi',     rx: 1, ry: 0.23,  direction: 'inout', arduino: 10 },
      { id: 'A0',  label: 'A0',        type: 'analog',  rx: 1, ry: 0.39,  direction: 'in',    arduino: 26 },
      { id: 'A1',  label: 'A1',        type: 'analog',  rx: 1, ry: 0.47,  direction: 'in',    arduino: 27 },
      { id: 'A2',  label: 'A2',        type: 'analog',  rx: 1, ry: 0.55,  direction: 'in',    arduino: 28 },
      { id: '3V3', label: '3.3V',      type: 'power',   rx: 1, ry: 0.71,  direction: 'out'   },
      { id: 'GND', label: 'GND',       type: 'gnd',     rx: 1, ry: 0.79,  direction: 'inout' },
      { id: '5V',  label: '5V',        type: 'power',   rx: 1, ry: 0.87,  direction: 'in'    },
    ],
  },

  // ── Output ────────────────────────────────────────────────────────────────
  led: {
    type: 'led', label: 'LED', w: 34, h: 56,
    color: '#ef4444', borderColor: '#b91c1c', category: 'output',
    description: 'Standard 5mm LED · 2.0V forward voltage · 20mA',
    pins: [
      { id: 'anode',   label: 'Anode (+)',   type: 'digital', rx: 0.5, ry: 0,   direction: 'in' },
      { id: 'cathode', label: 'Cathode (–)', type: 'gnd',     rx: 0.5, ry: 1,   direction: 'in' },
    ],
  },

  led_rgb: {
    type: 'led_rgb', label: 'RGB LED', w: 38, h: 60,
    color: '#ffffff', borderColor: '#888', category: 'output',
    description: 'Common cathode RGB LED · 3 color channels',
    pins: [
      { id: 'red',     label: 'Red',         type: 'pwm',  rx: 0.15, ry: 0,   direction: 'in' },
      { id: 'green',   label: 'Green',       type: 'pwm',  rx: 0.5,  ry: 0,   direction: 'in' },
      { id: 'blue',    label: 'Blue',        type: 'pwm',  rx: 0.85, ry: 0,   direction: 'in' },
      { id: 'cathode', label: 'Cathode (–)', type: 'gnd',  rx: 0.5,  ry: 1,   direction: 'in' },
    ],
  },

  buzzer: {
    type: 'buzzer', label: 'Buzzer', w: 40, h: 40,
    color: '#1c1c1c', borderColor: '#404040', category: 'output',
    description: 'Piezo buzzer · 3–5V · passive (needs tone())',
    pins: [
      { id: 'pos', label: 'VCC (+)', type: 'digital', rx: 0.3, ry: 0, direction: 'in' },
      { id: 'neg', label: 'GND (–)', type: 'gnd',     rx: 0.7, ry: 0, direction: 'in' },
    ],
  },

  servo: {
    type: 'servo', label: 'Servo', w: 70, h: 54,
    color: '#2a2a2a', borderColor: '#404040', category: 'actuator',
    description: 'SG90 micro servo · 0–180° · PWM control · 5V',
    pins: [
      { id: 'gnd',    label: 'GND (Brown)',  type: 'gnd',   rx: 0.15, ry: 1, direction: 'in' },
      { id: 'vcc',    label: 'VCC (Red)',    type: 'power', rx: 0.5,  ry: 1, direction: 'in' },
      { id: 'signal', label: 'Signal (Orange)', type: 'pwm', rx: 0.85, ry: 1, direction: 'in' },
    ],
  },

  // ── Input ─────────────────────────────────────────────────────────────────
  button: {
    type: 'button', label: 'Button', w: 38, h: 38,
    color: '#333', borderColor: '#555', category: 'input',
    description: 'Tactile push button · SPST momentary · 4-pin',
    pins: [
      { id: 'pin1', label: 'Pin 1A', type: 'digital', rx: 0,   ry: 0.28, direction: 'inout' },
      { id: 'pin2', label: 'Pin 2A', type: 'digital', rx: 1,   ry: 0.28, direction: 'inout' },
      { id: 'pin3', label: 'Pin 1B', type: 'digital', rx: 0,   ry: 0.72, direction: 'inout' },
      { id: 'pin4', label: 'Pin 2B', type: 'digital', rx: 1,   ry: 0.72, direction: 'inout' },
    ],
  },

  potentiometer: {
    type: 'potentiometer', label: 'Potentiometer', w: 48, h: 48,
    color: '#3a3a3a', borderColor: '#555', category: 'input',
    description: 'Rotary pot · 10kΩ · outputs 0–5V analog signal',
    pins: [
      { id: 'vcc',   label: 'VCC',    type: 'power',  rx: 0,   ry: 0.2, direction: 'in'  },
      { id: 'gnd',   label: 'GND',    type: 'gnd',    rx: 0,   ry: 0.8, direction: 'in'  },
      { id: 'wiper', label: 'Output', type: 'analog', rx: 1,   ry: 0.5, direction: 'out' },
    ],
  },

  // ── Passive ───────────────────────────────────────────────────────────────
  resistor: {
    type: 'resistor', label: 'Resistor', w: 56, h: 24,
    color: '#c4a265', borderColor: '#8a6620', category: 'passive',
    description: 'Through-hole resistor · default 220Ω',
    pins: [
      { id: 'pin1', label: 'Pin 1', type: 'generic', rx: 0,   ry: 0.5, direction: 'inout' },
      { id: 'pin2', label: 'Pin 2', type: 'generic', rx: 1,   ry: 0.5, direction: 'inout' },
    ],
  },

  capacitor: {
    type: 'capacitor', label: 'Capacitor', w: 28, h: 44,
    color: '#2a4a7a', borderColor: '#1a3060', category: 'passive',
    description: 'Electrolytic capacitor · polarized · default 100μF',
    pins: [
      { id: 'pos', label: 'Anode (+)',   type: 'power',  rx: 0.5, ry: 0, direction: 'in' },
      { id: 'neg', label: 'Cathode (–)', type: 'gnd',    rx: 0.5, ry: 1, direction: 'in' },
    ],
  },

  transistor_npn: {
    type: 'transistor_npn', label: 'NPN BJT', w: 36, h: 48,
    color: '#2a2a2a', borderColor: '#444', category: 'passive',
    description: 'NPN BJT (2N2222) · collector / base / emitter',
    pins: [
      { id: 'collector', label: 'Collector', type: 'digital', rx: 0.5, ry: 0,   direction: 'in'  },
      { id: 'base',      label: 'Base',      type: 'digital', rx: 0,   ry: 0.55, direction: 'in' },
      { id: 'emitter',   label: 'Emitter',   type: 'gnd',     rx: 0.5, ry: 1,   direction: 'out' },
    ],
  },

  // ── Sensors ───────────────────────────────────────────────────────────────
  dht11: {
    type: 'dht11', label: 'DHT11', w: 44, h: 52,
    color: '#1a5fb4', borderColor: '#0d3d80', category: 'sensor',
    description: 'Digital temp & humidity sensor · ±2°C · ±5%RH',
    pins: [
      { id: 'vcc',  label: 'VCC (3.3–5V)', type: 'power',  rx: 0, ry: 0.3, direction: 'in'  },
      { id: 'data', label: 'Data',         type: 'digital',rx: 0, ry: 0.6, direction: 'out' },
      { id: 'nc',   label: 'NC',           type: 'generic',rx: 1, ry: 0.4, direction: 'in'  },
      { id: 'gnd',  label: 'GND',          type: 'gnd',    rx: 1, ry: 0.7, direction: 'in'  },
    ],
  },

  ldr: {
    type: 'ldr', label: 'LDR', w: 34, h: 34,
    color: '#c48a00', borderColor: '#8a6000', category: 'sensor',
    description: 'Light-dependent resistor · resistance ↓ as light ↑',
    pins: [
      { id: 'pin1', label: 'Pin 1', type: 'analog', rx: 0,   ry: 0.5, direction: 'inout' },
      { id: 'pin2', label: 'Pin 2', type: 'analog', rx: 1,   ry: 0.5, direction: 'inout' },
    ],
  },

  ultrasonic: {
    type: 'ultrasonic', label: 'HC-SR04', w: 72, h: 42,
    color: '#1a4a2a', borderColor: '#0d3018', category: 'sensor',
    description: 'Ultrasonic distance sensor · 2–400cm · ±3mm',
    pins: [
      { id: 'vcc',  label: 'VCC 5V',   type: 'power',   rx: 0.1, ry: 0, direction: 'in'  },
      { id: 'trig', label: 'TRIG',     type: 'digital', rx: 0.37,ry: 0, direction: 'in'  },
      { id: 'echo', label: 'ECHO',     type: 'digital', rx: 0.63,ry: 0, direction: 'out' },
      { id: 'gnd',  label: 'GND',      type: 'gnd',     rx: 0.9, ry: 0, direction: 'in'  },
    ],
  },

  ir_sensor: {
    type: 'ir_sensor', label: 'IR Sensor', w: 50, h: 36,
    color: '#1a1a1a', borderColor: '#333', category: 'sensor',
    description: 'Infrared obstacle sensor · digital output · 2–30cm',
    pins: [
      { id: 'vcc', label: 'VCC',    type: 'power',  rx: 0, ry: 0.2, direction: 'in'  },
      { id: 'gnd', label: 'GND',    type: 'gnd',    rx: 0, ry: 0.8, direction: 'in'  },
      { id: 'out', label: 'Output', type: 'digital',rx: 1, ry: 0.5, direction: 'out' },
    ],
  },

  // ── Display ───────────────────────────────────────────────────────────────
  lcd_16x2: {
    type: 'lcd_16x2', label: 'LCD 16×2', w: 120, h: 60,
    color: '#0a3d0a', borderColor: '#063006', category: 'display',
    description: 'HD44780 16×2 character LCD · parallel or I²C',
    pins: [
      { id: 'vss',  label: 'VSS GND',    type: 'gnd',    rx: 0.04, ry: 1, direction: 'in' },
      { id: 'vdd',  label: 'VDD 5V',     type: 'power',  rx: 0.11, ry: 1, direction: 'in' },
      { id: 'vo',   label: 'V0 Contrast',type: 'analog', rx: 0.18, ry: 1, direction: 'in' },
      { id: 'rs',   label: 'RS',         type: 'digital',rx: 0.25, ry: 1, direction: 'in' },
      { id: 'rw',   label: 'R/W',        type: 'digital',rx: 0.32, ry: 1, direction: 'in' },
      { id: 'en',   label: 'Enable',     type: 'digital',rx: 0.39, ry: 1, direction: 'in' },
      { id: 'd4',   label: 'D4',         type: 'digital',rx: 0.54, ry: 1, direction: 'in' },
      { id: 'd5',   label: 'D5',         type: 'digital',rx: 0.61, ry: 1, direction: 'in' },
      { id: 'd6',   label: 'D6',         type: 'digital',rx: 0.68, ry: 1, direction: 'in' },
      { id: 'd7',   label: 'D7',         type: 'digital',rx: 0.75, ry: 1, direction: 'in' },
      { id: 'a',    label: 'Anode (BL)', type: 'power',  rx: 0.88, ry: 1, direction: 'in' },
      { id: 'k',    label: 'Cathode(BL)',type: 'gnd',    rx: 0.96, ry: 1, direction: 'in' },
    ],
  },

  seven_seg: {
    type: 'seven_seg', label: '7-Segment', w: 54, h: 76,
    color: '#1a1a1a', borderColor: '#333', category: 'display',
    description: 'Common cathode 7-segment display · 1-digit',
    pins: [
      { id: 'a',   label: 'Segment A', type: 'digital', rx: 0, ry: 0.10, direction: 'in' },
      { id: 'b',   label: 'Segment B', type: 'digital', rx: 0, ry: 0.22, direction: 'in' },
      { id: 'c',   label: 'Segment C', type: 'digital', rx: 0, ry: 0.34, direction: 'in' },
      { id: 'd',   label: 'Segment D', type: 'digital', rx: 0, ry: 0.46, direction: 'in' },
      { id: 'e',   label: 'Segment E', type: 'digital', rx: 0, ry: 0.58, direction: 'in' },
      { id: 'f',   label: 'Segment F', type: 'digital', rx: 0, ry: 0.70, direction: 'in' },
      { id: 'g',   label: 'Segment G', type: 'digital', rx: 0, ry: 0.82, direction: 'in' },
      { id: 'dp',  label: 'Decimal Pt',type: 'digital', rx: 1, ry: 0.20, direction: 'in' },
      { id: 'cc1', label: 'Cathode 1', type: 'gnd',     rx: 1, ry: 0.55, direction: 'in' },
      { id: 'cc2', label: 'Cathode 2', type: 'gnd',     rx: 1, ry: 0.75, direction: 'in' },
    ],
  },

  // ── Power ─────────────────────────────────────────────────────────────────
  vcc_node: {
    type: 'vcc_node', label: 'VCC', w: 28, h: 28,
    color: '#7f1d1d', borderColor: '#450a0a', category: 'power',
    description: 'Power supply node · 5V',
    pins: [
      { id: '5v', label: '5V', type: 'power', rx: 0.5, ry: 1, direction: 'out' },
    ],
  },

  gnd_node: {
    type: 'gnd_node', label: 'GND', w: 28, h: 28,
    color: '#1c1c1c', borderColor: '#333', category: 'power',
    description: 'Ground reference node',
    pins: [
      { id: 'gnd', label: 'GND', type: 'gnd', rx: 0.5, ry: 0, direction: 'in' },
    ],
  },

  power_rail: {
    type: 'power_rail', label: 'Power Rail', w: 24, h: 90,
    color: '#111', borderColor: '#2a2a2a', category: 'power',
    description: 'Dual power rail — 5V + GND bus',
    pins: [
      { id: '5v_1',  label: '5V rail 1', type: 'power', rx: 0.5, ry: 0.08, direction: 'inout' },
      { id: '5v_2',  label: '5V rail 2', type: 'power', rx: 0.5, ry: 0.22, direction: 'inout' },
      { id: '5v_3',  label: '5V rail 3', type: 'power', rx: 0.5, ry: 0.36, direction: 'inout' },
      { id: 'gnd_1', label: 'GND rail 1',type: 'gnd',   rx: 0.5, ry: 0.64, direction: 'inout' },
      { id: 'gnd_2', label: 'GND rail 2',type: 'gnd',   rx: 0.5, ry: 0.78, direction: 'inout' },
      { id: 'gnd_3', label: 'GND rail 3',type: 'gnd',   rx: 0.5, ry: 0.92, direction: 'inout' },
    ],
  },

  // ── NEW: Relay ────────────────────────────────────────────────────────────
  relay: {
    type: 'relay', label: 'Relay 5V', w: 60, h: 44,
    color: '#1a2a1a', borderColor: '#0d1a0d', category: 'actuator',
    description: '5V single-channel relay · NO/NC · up to 10A 250V AC',
    pins: [
      { id: 'vcc',  label: 'VCC 5V',  type: 'power',   rx: 0,   ry: 0.18, direction: 'in'  },
      { id: 'gnd',  label: 'GND',     type: 'gnd',     rx: 0,   ry: 0.50, direction: 'in'  },
      { id: 'in',   label: 'IN',      type: 'digital', rx: 0,   ry: 0.82, direction: 'in'  },
      { id: 'com',  label: 'COM',     type: 'generic', rx: 1,   ry: 0.25, direction: 'inout'},
      { id: 'no',   label: 'NO',      type: 'generic', rx: 1,   ry: 0.55, direction: 'out' },
      { id: 'nc',   label: 'NC',      type: 'generic', rx: 1,   ry: 0.82, direction: 'out' },
    ],
  },

  // ── NEW: OLED 128×64 ──────────────────────────────────────────────────────
  oled_128x64: {
    type: 'oled_128x64', label: 'OLED 128×64', w: 72, h: 54,
    color: '#0a0a0a', borderColor: '#222', category: 'display',
    description: 'SSD1306 0.96" OLED · 128×64 · I²C · 3.3V–5V',
    pins: [
      { id: 'gnd',  label: 'GND',  type: 'gnd',   rx: 0.10, ry: 1, direction: 'in'    },
      { id: 'vcc',  label: 'VCC',  type: 'power', rx: 0.30, ry: 1, direction: 'in'    },
      { id: 'scl',  label: 'SCL',  type: 'i2c',   rx: 0.58, ry: 1, direction: 'in'    },
      { id: 'sda',  label: 'SDA',  type: 'i2c',   rx: 0.80, ry: 1, direction: 'inout' },
    ],
  },

  // ── NEW: NeoPixel Ring ────────────────────────────────────────────────────
  neopixel_ring: {
    type: 'neopixel_ring', label: 'NeoPixel Ring', w: 60, h: 60,
    color: '#111', borderColor: '#333', category: 'output',
    description: 'WS2812B 12-pixel RGB ring · addressable · 5V',
    pins: [
      { id: 'pwr',  label: 'PWR 5V',   type: 'power',   rx: 0.12, ry: 0.88, direction: 'in'  },
      { id: 'gnd',  label: 'GND',      type: 'gnd',     rx: 0.30, ry: 0.96, direction: 'in'  },
      { id: 'din',  label: 'Data IN',  type: 'digital', rx: 0.70, ry: 0.96, direction: 'in'  },
      { id: 'dout', label: 'Data OUT', type: 'digital', rx: 0.88, ry: 0.88, direction: 'out' },
    ],
  },

  // ── NEW: N-Channel MOSFET ─────────────────────────────────────────────────
  mosfet_n: {
    type: 'mosfet_n', label: 'MOSFET N', w: 30, h: 52,
    color: '#111', borderColor: '#333', category: 'passive',
    description: 'N-channel MOSFET (TO-92) · Gate / Drain / Source',
    pins: [
      { id: 'gate',   label: 'Gate (G)',   type: 'digital', rx: 0,   ry: 0.40, direction: 'in'  },
      { id: 'drain',  label: 'Drain (D)',  type: 'generic', rx: 0.5, ry: 0,    direction: 'inout'},
      { id: 'source', label: 'Source (S)', type: 'gnd',     rx: 0.5, ry: 1,    direction: 'out' },
    ],
  },

  // ── NEW: Diode ────────────────────────────────────────────────────────────
  diode: {
    type: 'diode', label: 'Diode', w: 44, h: 22,
    color: '#1a1a1a', borderColor: '#333', category: 'passive',
    description: 'Rectifier diode 1N4007 · Anode → Cathode',
    pins: [
      { id: 'anode',   label: 'Anode (+)',   type: 'power',   rx: 0, ry: 0.5, direction: 'in'  },
      { id: 'cathode', label: 'Cathode (−)', type: 'generic', rx: 1, ry: 0.5, direction: 'out' },
    ],
  },

  // ── NEW: L298N Motor Driver ───────────────────────────────────────────────
  l298n: {
    type: 'l298n', label: 'L298N Driver', w: 72, h: 66,
    color: '#1c1c1c', borderColor: '#2a2a2a', category: 'actuator',
    description: 'L298N dual H-bridge motor driver · 2A per channel · 5–35V',
    pins: [
      { id: 'ena',  label: 'ENA',    type: 'pwm',     rx: 0,   ry: 0.10, direction: 'in'  },
      { id: 'in1',  label: 'IN1',    type: 'digital', rx: 0,   ry: 0.26, direction: 'in'  },
      { id: 'in2',  label: 'IN2',    type: 'digital', rx: 0,   ry: 0.40, direction: 'in'  },
      { id: 'in3',  label: 'IN3',    type: 'digital', rx: 0,   ry: 0.54, direction: 'in'  },
      { id: 'in4',  label: 'IN4',    type: 'digital', rx: 0,   ry: 0.68, direction: 'in'  },
      { id: 'enb',  label: 'ENB',    type: 'pwm',     rx: 0,   ry: 0.84, direction: 'in'  },
      { id: 'vcc',  label: 'VCC',    type: 'power',   rx: 1,   ry: 0.10, direction: 'in'  },
      { id: 'gnd',  label: 'GND',    type: 'gnd',     rx: 1,   ry: 0.28, direction: 'in'  },
      { id: '5v',   label: '5V Out', type: 'power',   rx: 1,   ry: 0.46, direction: 'out' },
      { id: 'outa1',label: 'OUT1',   type: 'generic', rx: 1,   ry: 0.62, direction: 'out' },
      { id: 'outa2',label: 'OUT2',   type: 'generic', rx: 1,   ry: 0.76, direction: 'out' },
    ],
  },
}

// ── Wire palette ──────────────────────────────────────────────────────────────

export const WIRE_COLORS = [
  { color: '#ef4444', label: 'Red (Power)'    },
  { color: '#1c1c1c', label: 'Black (GND)'    },
  { color: '#f97316', label: 'Orange'         },
  { color: '#eab308', label: 'Yellow'         },
  { color: '#22c55e', label: 'Green'          },
  { color: '#3b82f6', label: 'Blue (Signal)'  },
  { color: '#a855f7', label: 'Purple (Analog)'},
  { color: '#ec4899', label: 'Pink'           },
  { color: '#e2e2e2', label: 'White'          },
]

export const DEFAULT_CIRCUIT: TsukiCircuit = {
  version: '1',
  name: 'New Circuit',
  board: 'uno',
  description: '',
  components: [],
  wires: [],
  notes: [],
}

// ── Utility helpers ───────────────────────────────────────────────────────────

export function getPinAbsPos(comp: PlacedComponent, pin: CircuitPin) {
  const def = COMP_DEFS[comp.type]
  if (!def) return { x: comp.x, y: comp.y }
  return {
    x: comp.x + pin.rx * def.w,
    y: comp.y + pin.ry * def.h,
  }
}

export function snapToGrid(v: number, grid = 10): number {
  return Math.round(v / grid) * grid
}

export function makeBezierPath(ax: number, ay: number, bx: number, by: number): string {
  const dx = bx - ax
  const dy = by - ay
  const dist = Math.sqrt(dx * dx + dy * dy)
  const cp = Math.max(30, dist * 0.45)
  // Horizontal-first routing
  return `M ${ax} ${ay} C ${ax + cp} ${ay}, ${bx - cp} ${by}, ${bx} ${by}`
}

export function circuitToText(c: TsukiCircuit): string {
  return JSON.stringify(c, null, 2)
}

export function textToCircuit(raw: string): TsukiCircuit | null {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed.components || !parsed.wires) return null
    return { ...DEFAULT_CIRCUIT, ...parsed }
  } catch { return null }
}

export const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  mcu:      { label: 'Microcontrollers', icon: '⬡' },
  output:   { label: 'Output',           icon: '◉' },
  actuator: { label: 'Actuators',        icon: '⟳' },
  input:    { label: 'Input',            icon: '◈' },
  passive:  { label: 'Passive',          icon: '〰' },
  sensor:   { label: 'Sensors',          icon: '◎' },
  display:  { label: 'Displays',         icon: '▤' },
  power:    { label: 'Power',            icon: '⚡' },
}