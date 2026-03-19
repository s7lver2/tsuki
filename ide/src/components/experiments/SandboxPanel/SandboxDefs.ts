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
  hidden?: boolean
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

// ── Interaction types ──────────────────────────────────────────────────────────

export type Tool = 'select' | 'wire' | 'delete' | 'probe' | 'voltmeter' | 'ammeter' | 'label' | 'ruler'

export interface WireInProgress {
  fromComp: string
  fromPin: string
  fromX: number
  fromY: number
  mouseX: number
  mouseY: number
  color: string
  waypoints: { x: number; y: number }[]
}

export interface WireProbe {
  id: string
  wireId: string
  label: string
}

/** A voltmeter pin indicator — shows live voltage at a specific comp:pin on the SVG */
export interface VoltmeterPin {
  id: string
  compId: string
  pinId: string
  label: string   // e.g. "UNO.D9"
}

/** An ammeter overlay on a wire — shows live current inline */
export interface AmmeterWire {
  id: string
  wireId: string
  label: string
}

/** A sticky canvas label (text annotation) */
export interface CanvasLabel {
  id: string
  x: number
  y: number
  text: string
  color: string
}

/** A ruler measurement between two canvas points */
export interface RulerMeasure {
  id: string
  x1: number; y1: number
  x2: number; y2: number
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

// ── Wire palettes ──────────────────────────────────────────────────────────────

/** Full palette with labels (for docs / tooltips) */
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

/** Flat hex array for the color picker */
export const WIRE_COLOR_HEX = [
  '#ef4444','#f97316','#eab308','#22c55e',
  '#3b82f6','#a855f7','#ec4899','#e2e2e2','#1a1a1a',
]

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
    type: 'arduino_nano', label: 'Arduino Nano', w: 90, h: 160,
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
    type: 'xiao_rp2040', label: 'Xiao RP2040', w: 90, h: 140,
    color: '#1c3a5e', borderColor: '#0f2236', category: 'mcu',
    description: 'Seeed Xiao RP2040 · RP2040 dual-core · 133 MHz · 14 GPIO · USB-C · tiny form factor',
    hidden: true,
    pins: [
      { id: 'D0',  label: 'D0',        type: 'digital', rx: 0, ry: 0.07,  direction: 'inout', arduino: 0  },
      { id: 'D1',  label: 'D1',        type: 'digital', rx: 0, ry: 0.15,  direction: 'inout', arduino: 1  },
      { id: 'D2',  label: 'D2',        type: 'digital', rx: 0, ry: 0.23,  direction: 'inout', arduino: 2  },
      { id: 'D3',  label: 'D3',        type: 'pwm',     rx: 0, ry: 0.31,  direction: 'inout', arduino: 3  },
      { id: 'D4',  label: 'D4 / SDA',  type: 'i2c',     rx: 0, ry: 0.39,  direction: 'inout', arduino: 4  },
      { id: 'D5',  label: 'D5 / SCL',  type: 'i2c',     rx: 0, ry: 0.47,  direction: 'inout', arduino: 5  },
      { id: 'D6',  label: 'D6 / TX',   type: 'digital', rx: 0, ry: 0.55,  direction: 'inout', arduino: 6  },
      { id: 'D7',  label: 'D7 / RX',   type: 'digital', rx: 0, ry: 0.63,  direction: 'inout', arduino: 7  },
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

  // ── ESP8266 NodeMCU ───────────────────────────────────────────────────────
  esp8266: {
    type: 'esp8266', label: 'ESP8266 NodeMCU', w: 115, h: 200,
    color: '#1a3a1a', borderColor: '#0d2010', category: 'mcu',
    description: 'ESP8266 NodeMCU v3 · WiFi · 4MB flash · 80/160MHz · tsuki-webkit compatible',
    pins: [
      { id: 'D0',  label: 'D0 / GPIO16', type: 'digital', rx: 0, ry: 0.08, direction: 'inout', arduino: 16 },
      { id: 'D1',  label: 'D1 / GPIO5',  type: 'digital', rx: 0, ry: 0.16, direction: 'inout', arduino: 5  },
      { id: 'D2',  label: 'D2 / GPIO4',  type: 'digital', rx: 0, ry: 0.24, direction: 'inout', arduino: 4  },
      { id: 'D3',  label: 'D3 / GPIO0',  type: 'digital', rx: 0, ry: 0.32, direction: 'inout', arduino: 0  },
      { id: 'D4',  label: 'D4 / GPIO2',  type: 'digital', rx: 0, ry: 0.40, direction: 'inout', arduino: 2  },
      { id: '3V3', label: '3.3V',        type: 'power',   rx: 0, ry: 0.50, direction: 'out'   },
      { id: 'GND1',label: 'GND',         type: 'gnd',     rx: 0, ry: 0.58, direction: 'inout' },
      { id: 'D5',  label: 'D5 / GPIO14', type: 'spi',     rx: 0, ry: 0.66, direction: 'inout', arduino: 14 },
      { id: 'D6',  label: 'D6 / GPIO12', type: 'spi',     rx: 0, ry: 0.74, direction: 'inout', arduino: 12 },
      { id: 'D7',  label: 'D7 / GPIO13', type: 'spi',     rx: 0, ry: 0.82, direction: 'inout', arduino: 13 },
      { id: 'D8',  label: 'D8 / GPIO15', type: 'pwm',     rx: 0, ry: 0.90, direction: 'inout', arduino: 15 },
      { id: 'RX',  label: 'RX',          type: 'digital', rx: 1, ry: 0.08, direction: 'in',    arduino: 3  },
      { id: 'TX',  label: 'TX',          type: 'digital', rx: 1, ry: 0.16, direction: 'out',   arduino: 1  },
      { id: 'A0',  label: 'A0',          type: 'analog',  rx: 1, ry: 0.24, direction: 'in',    arduino: 17 },
      { id: 'RST', label: 'RST',         type: 'generic', rx: 1, ry: 0.32 },
      { id: 'GND2',label: 'GND',         type: 'gnd',     rx: 1, ry: 0.40, direction: 'inout' },
      { id: 'VIN', label: 'VIN / 5V',    type: 'power',   rx: 1, ry: 0.50, direction: 'in'    },
    ],
  },

  // ── ESP32 Dev Module ───────────────────────────────────────────────────────
  esp32: {
    type: 'esp32', label: 'ESP32 Dev Module', w: 120, h: 220,
    color: '#1a2a3a', borderColor: '#0d1a27', category: 'mcu',
    description: 'ESP32 WROOM-32 · WiFi + BT · 4MB flash · 240MHz · tsuki-webkit compatible',
    pins: [
      { id: 'D2',  label: 'D2 / GPIO2',  type: 'digital', rx: 0, ry: 0.04, direction: 'inout', arduino: 2  },
      { id: 'D4',  label: 'D4 / GPIO4',  type: 'pwm',     rx: 0, ry: 0.10, direction: 'inout', arduino: 4  },
      { id: 'D5',  label: 'D5 / GPIO5',  type: 'spi',     rx: 0, ry: 0.16, direction: 'inout', arduino: 5  },
      { id: 'D12', label: 'D12 / GPIO12',type: 'digital', rx: 0, ry: 0.22, direction: 'inout', arduino: 12 },
      { id: 'D13', label: 'D13 / GPIO13',type: 'digital', rx: 0, ry: 0.28, direction: 'inout', arduino: 13 },
      { id: 'D14', label: 'D14 / GPIO14',type: 'pwm',     rx: 0, ry: 0.34, direction: 'inout', arduino: 14 },
      { id: 'D15', label: 'D15 / GPIO15',type: 'pwm',     rx: 0, ry: 0.40, direction: 'inout', arduino: 15 },
      { id: 'D16', label: 'RX2 / GPIO16',type: 'digital', rx: 0, ry: 0.47, direction: 'in',    arduino: 16 },
      { id: 'D17', label: 'TX2 / GPIO17',type: 'digital', rx: 0, ry: 0.53, direction: 'out',   arduino: 17 },
      { id: 'D18', label: 'D18 / SCK',   type: 'spi',     rx: 0, ry: 0.59, direction: 'inout', arduino: 18 },
      { id: 'D19', label: 'D19 / MISO',  type: 'spi',     rx: 0, ry: 0.65, direction: 'inout', arduino: 19 },
      { id: 'D21', label: 'D21 / SDA',   type: 'i2c',     rx: 0, ry: 0.71, direction: 'inout', arduino: 21 },
      { id: 'D22', label: 'D22 / SCL',   type: 'i2c',     rx: 0, ry: 0.77, direction: 'inout', arduino: 22 },
      { id: 'D23', label: 'D23 / MOSI',  type: 'spi',     rx: 0, ry: 0.83, direction: 'inout', arduino: 23 },
      { id: 'GND1',label: 'GND',         type: 'gnd',     rx: 0, ry: 0.92, direction: 'inout' },
      { id: 'D0',  label: 'D0 / GPIO0',  type: 'digital', rx: 1, ry: 0.04, direction: 'inout', arduino: 0  },
      { id: 'D1',  label: 'TX0 / GPIO1', type: 'digital', rx: 1, ry: 0.10, direction: 'out',   arduino: 1  },
      { id: 'D3',  label: 'RX0 / GPIO3', type: 'digital', rx: 1, ry: 0.16, direction: 'in',    arduino: 3  },
      { id: 'D25', label: 'D25 / DAC1',  type: 'analog',  rx: 1, ry: 0.22, direction: 'out',   arduino: 25 },
      { id: 'D26', label: 'D26 / DAC2',  type: 'analog',  rx: 1, ry: 0.28, direction: 'out',   arduino: 26 },
      { id: 'D27', label: 'D27',         type: 'pwm',     rx: 1, ry: 0.34, direction: 'inout', arduino: 27 },
      { id: 'D32', label: 'D32',         type: 'analog',  rx: 1, ry: 0.41, direction: 'inout', arduino: 32 },
      { id: 'D33', label: 'D33',         type: 'analog',  rx: 1, ry: 0.47, direction: 'inout', arduino: 33 },
      { id: 'D34', label: 'D34 (in)',    type: 'analog',  rx: 1, ry: 0.53, direction: 'in',    arduino: 34 },
      { id: 'D35', label: 'D35 (in)',    type: 'analog',  rx: 1, ry: 0.59, direction: 'in',    arduino: 35 },
      { id: 'A0',  label: 'VP / GPIO36', type: 'analog',  rx: 1, ry: 0.65, direction: 'in',    arduino: 36 },
      { id: 'A3',  label: 'VN / GPIO39', type: 'analog',  rx: 1, ry: 0.71, direction: 'in',    arduino: 39 },
      { id: '3V3', label: '3.3V',        type: 'power',   rx: 1, ry: 0.80, direction: 'out'   },
      { id: 'GND2',label: 'GND',         type: 'gnd',     rx: 1, ry: 0.87, direction: 'inout' },
      { id: 'VIN', label: 'VIN / 5V',    type: 'power',   rx: 1, ry: 0.93, direction: 'in'    },
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
      { id: 'gnd',    label: 'GND (Brown)',     type: 'gnd',   rx: 0.15, ry: 1, direction: 'in' },
      { id: 'vcc',    label: 'VCC (Red)',        type: 'power', rx: 0.5,  ry: 1, direction: 'in' },
      { id: 'signal', label: 'Signal (Orange)',  type: 'pwm',   rx: 0.85, ry: 1, direction: 'in' },
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
    hidden: true,
    pins: [
      { id: 'vcc',   label: 'VCC',    type: 'power',  rx: 0,   ry: 0.2, direction: 'in'  },
      { id: 'gnd',   label: 'GND',    type: 'gnd',    rx: 0,   ry: 0.8, direction: 'in'  },
      { id: 'wiper', label: 'Output', type: 'analog', rx: 1,   ry: 0.5, direction: 'out' },
    ],
  },
  slide_switch: {
    type: 'slide_switch', label: 'Slide Switch', w: 44, h: 28,
    color: '#2a2a2a', borderColor: '#444', category: 'input',
    description: 'SPDT slide switch · 3 terminals · ON-ON',
    hidden: true,
    pins: [
      { id: 'common', label: 'Common (C)', type: 'digital', rx: 0.5, ry: 1,   direction: 'inout' },
      { id: 'pos1',   label: 'Position 1', type: 'digital', rx: 0,   ry: 0.5, direction: 'out'   },
      { id: 'pos2',   label: 'Position 2', type: 'digital', rx: 1,   ry: 0.5, direction: 'out'   },
    ],
  },
  rotary_encoder: {
    type: 'rotary_encoder', label: 'Rot. Encoder', w: 46, h: 52,
    color: '#2a2a2a', borderColor: '#444', category: 'input',
    description: 'KY-040 rotary encoder · CLK / DT / SW · incremental',
    hidden: true,
    pins: [
      { id: 'clk', label: 'CLK',  type: 'digital', rx: 0, ry: 0.14, direction: 'out' },
      { id: 'dt',  label: 'DT',   type: 'digital', rx: 0, ry: 0.34, direction: 'out' },
      { id: 'sw',  label: 'SW',   type: 'digital', rx: 0, ry: 0.54, direction: 'out' },
      { id: 'vcc', label: 'VCC',  type: 'power',   rx: 0, ry: 0.74, direction: 'in'  },
      { id: 'gnd', label: 'GND',  type: 'gnd',     rx: 0, ry: 0.94, direction: 'in'  },
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
    hidden: true,
    pins: [
      { id: 'pos', label: 'Anode (+)',   type: 'power',  rx: 0.5, ry: 0, direction: 'in' },
      { id: 'neg', label: 'Cathode (–)', type: 'gnd',    rx: 0.5, ry: 1, direction: 'in' },
    ],
  },
  transistor_npn: {
    type: 'transistor_npn', label: 'NPN BJT', w: 36, h: 48,
    color: '#2a2a2a', borderColor: '#444', category: 'passive',
    description: 'NPN BJT (2N2222) · collector / base / emitter',
    hidden: true,
    pins: [
      { id: 'collector', label: 'Collector', type: 'digital', rx: 0.5, ry: 0,    direction: 'in'  },
      { id: 'base',      label: 'Base',      type: 'digital', rx: 0,   ry: 0.55, direction: 'in'  },
      { id: 'emitter',   label: 'Emitter',   type: 'gnd',     rx: 0.5, ry: 1,    direction: 'out' },
    ],
  },
  mosfet_n: {
    type: 'mosfet_n', label: 'MOSFET N', w: 30, h: 52,
    color: '#111', borderColor: '#333', category: 'passive',
    description: 'N-channel MOSFET (TO-92) · Gate / Drain / Source',
    pins: [
      { id: 'gate',   label: 'Gate (G)',   type: 'digital', rx: 0,   ry: 0.40, direction: 'in'   },
      { id: 'drain',  label: 'Drain (D)',  type: 'generic', rx: 0.5, ry: 0,    direction: 'inout'},
      { id: 'source', label: 'Source (S)', type: 'gnd',     rx: 0.5, ry: 1,    direction: 'out'  },
    ],
  },
  diode: {
    type: 'diode', label: 'Diode', w: 44, h: 22,
    color: '#1a1a1a', borderColor: '#333', category: 'passive',
    description: 'Rectifier diode 1N4007 · Anode → Cathode',
    hidden: true,
    pins: [
      { id: 'anode',   label: 'Anode (+)',   type: 'power',   rx: 0, ry: 0.5, direction: 'in'  },
      { id: 'cathode', label: 'Cathode (−)', type: 'generic', rx: 1, ry: 0.5, direction: 'out' },
    ],
  },
  breadboard: {
    type: 'breadboard', label: 'Breadboard', w: 270, h: 215,
    color: '#f0edd8', borderColor: '#c8c0a0', category: 'passive',
    description: 'Half-size solderless breadboard · 100 tie-points',
    pins: [
      // ── Uniform pitch grid — pitch p=0.090, gap between e and f = 1p ──────
      // Symmetry: margin = (1 − 9p) / 2 = 0.095
      // Left  (a–e): 0.095, 0.185, 0.275, 0.365, 0.455  ← all uniform
      // Right (f–j): 0.545, 0.635, 0.725, 0.815, 0.905  (gap = 0.090 = 1p)
      // Rows  1–10 : 0.100, 0.190, 0.280, 0.370, 0.460, 0.550, 0.640, 0.730, 0.820, 0.910
      { id: 'a1',  label: 'a1',  type: 'generic', rx: 0.095, ry: 0.100, direction: 'inout' },
      { id: 'b1',  label: 'b1',  type: 'generic', rx: 0.185, ry: 0.100, direction: 'inout' },
      { id: 'c1',  label: 'c1',  type: 'generic', rx: 0.275, ry: 0.100, direction: 'inout' },
      { id: 'd1',  label: 'd1',  type: 'generic', rx: 0.365, ry: 0.100, direction: 'inout' },
      { id: 'e1',  label: 'e1',  type: 'generic', rx: 0.455, ry: 0.100, direction: 'inout' },
      { id: 'f1',  label: 'f1',  type: 'generic', rx: 0.545, ry: 0.100, direction: 'inout' },
      { id: 'g1',  label: 'g1',  type: 'generic', rx: 0.635, ry: 0.100, direction: 'inout' },
      { id: 'h1',  label: 'h1',  type: 'generic', rx: 0.725, ry: 0.100, direction: 'inout' },
      { id: 'i1',  label: 'i1',  type: 'generic', rx: 0.815, ry: 0.100, direction: 'inout' },
      { id: 'j1',  label: 'j1',  type: 'generic', rx: 0.905, ry: 0.100, direction: 'inout' },
      { id: 'a2',  label: 'a2',  type: 'generic', rx: 0.095, ry: 0.190, direction: 'inout' },
      { id: 'b2',  label: 'b2',  type: 'generic', rx: 0.185, ry: 0.190, direction: 'inout' },
      { id: 'c2',  label: 'c2',  type: 'generic', rx: 0.275, ry: 0.190, direction: 'inout' },
      { id: 'd2',  label: 'd2',  type: 'generic', rx: 0.365, ry: 0.190, direction: 'inout' },
      { id: 'e2',  label: 'e2',  type: 'generic', rx: 0.455, ry: 0.190, direction: 'inout' },
      { id: 'f2',  label: 'f2',  type: 'generic', rx: 0.545, ry: 0.190, direction: 'inout' },
      { id: 'g2',  label: 'g2',  type: 'generic', rx: 0.635, ry: 0.190, direction: 'inout' },
      { id: 'h2',  label: 'h2',  type: 'generic', rx: 0.725, ry: 0.190, direction: 'inout' },
      { id: 'i2',  label: 'i2',  type: 'generic', rx: 0.815, ry: 0.190, direction: 'inout' },
      { id: 'j2',  label: 'j2',  type: 'generic', rx: 0.905, ry: 0.190, direction: 'inout' },
      { id: 'a3',  label: 'a3',  type: 'generic', rx: 0.095, ry: 0.280, direction: 'inout' },
      { id: 'b3',  label: 'b3',  type: 'generic', rx: 0.185, ry: 0.280, direction: 'inout' },
      { id: 'c3',  label: 'c3',  type: 'generic', rx: 0.275, ry: 0.280, direction: 'inout' },
      { id: 'd3',  label: 'd3',  type: 'generic', rx: 0.365, ry: 0.280, direction: 'inout' },
      { id: 'e3',  label: 'e3',  type: 'generic', rx: 0.455, ry: 0.280, direction: 'inout' },
      { id: 'f3',  label: 'f3',  type: 'generic', rx: 0.545, ry: 0.280, direction: 'inout' },
      { id: 'g3',  label: 'g3',  type: 'generic', rx: 0.635, ry: 0.280, direction: 'inout' },
      { id: 'h3',  label: 'h3',  type: 'generic', rx: 0.725, ry: 0.280, direction: 'inout' },
      { id: 'i3',  label: 'i3',  type: 'generic', rx: 0.815, ry: 0.280, direction: 'inout' },
      { id: 'j3',  label: 'j3',  type: 'generic', rx: 0.905, ry: 0.280, direction: 'inout' },
      { id: 'a4',  label: 'a4',  type: 'generic', rx: 0.095, ry: 0.370, direction: 'inout' },
      { id: 'b4',  label: 'b4',  type: 'generic', rx: 0.185, ry: 0.370, direction: 'inout' },
      { id: 'c4',  label: 'c4',  type: 'generic', rx: 0.275, ry: 0.370, direction: 'inout' },
      { id: 'd4',  label: 'd4',  type: 'generic', rx: 0.365, ry: 0.370, direction: 'inout' },
      { id: 'e4',  label: 'e4',  type: 'generic', rx: 0.455, ry: 0.370, direction: 'inout' },
      { id: 'f4',  label: 'f4',  type: 'generic', rx: 0.545, ry: 0.370, direction: 'inout' },
      { id: 'g4',  label: 'g4',  type: 'generic', rx: 0.635, ry: 0.370, direction: 'inout' },
      { id: 'h4',  label: 'h4',  type: 'generic', rx: 0.725, ry: 0.370, direction: 'inout' },
      { id: 'i4',  label: 'i4',  type: 'generic', rx: 0.815, ry: 0.370, direction: 'inout' },
      { id: 'j4',  label: 'j4',  type: 'generic', rx: 0.905, ry: 0.370, direction: 'inout' },
      { id: 'a5',  label: 'a5',  type: 'generic', rx: 0.095, ry: 0.460, direction: 'inout' },
      { id: 'b5',  label: 'b5',  type: 'generic', rx: 0.185, ry: 0.460, direction: 'inout' },
      { id: 'c5',  label: 'c5',  type: 'generic', rx: 0.275, ry: 0.460, direction: 'inout' },
      { id: 'd5',  label: 'd5',  type: 'generic', rx: 0.365, ry: 0.460, direction: 'inout' },
      { id: 'e5',  label: 'e5',  type: 'generic', rx: 0.455, ry: 0.460, direction: 'inout' },
      { id: 'f5',  label: 'f5',  type: 'generic', rx: 0.545, ry: 0.460, direction: 'inout' },
      { id: 'g5',  label: 'g5',  type: 'generic', rx: 0.635, ry: 0.460, direction: 'inout' },
      { id: 'h5',  label: 'h5',  type: 'generic', rx: 0.725, ry: 0.460, direction: 'inout' },
      { id: 'i5',  label: 'i5',  type: 'generic', rx: 0.815, ry: 0.460, direction: 'inout' },
      { id: 'j5',  label: 'j5',  type: 'generic', rx: 0.905, ry: 0.460, direction: 'inout' },
      { id: 'a6',  label: 'a6',  type: 'generic', rx: 0.095, ry: 0.550, direction: 'inout' },
      { id: 'b6',  label: 'b6',  type: 'generic', rx: 0.185, ry: 0.550, direction: 'inout' },
      { id: 'c6',  label: 'c6',  type: 'generic', rx: 0.275, ry: 0.550, direction: 'inout' },
      { id: 'd6',  label: 'd6',  type: 'generic', rx: 0.365, ry: 0.550, direction: 'inout' },
      { id: 'e6',  label: 'e6',  type: 'generic', rx: 0.455, ry: 0.550, direction: 'inout' },
      { id: 'f6',  label: 'f6',  type: 'generic', rx: 0.545, ry: 0.550, direction: 'inout' },
      { id: 'g6',  label: 'g6',  type: 'generic', rx: 0.635, ry: 0.550, direction: 'inout' },
      { id: 'h6',  label: 'h6',  type: 'generic', rx: 0.725, ry: 0.550, direction: 'inout' },
      { id: 'i6',  label: 'i6',  type: 'generic', rx: 0.815, ry: 0.550, direction: 'inout' },
      { id: 'j6',  label: 'j6',  type: 'generic', rx: 0.905, ry: 0.550, direction: 'inout' },
      { id: 'a7',  label: 'a7',  type: 'generic', rx: 0.095, ry: 0.640, direction: 'inout' },
      { id: 'b7',  label: 'b7',  type: 'generic', rx: 0.185, ry: 0.640, direction: 'inout' },
      { id: 'c7',  label: 'c7',  type: 'generic', rx: 0.275, ry: 0.640, direction: 'inout' },
      { id: 'd7',  label: 'd7',  type: 'generic', rx: 0.365, ry: 0.640, direction: 'inout' },
      { id: 'e7',  label: 'e7',  type: 'generic', rx: 0.455, ry: 0.640, direction: 'inout' },
      { id: 'f7',  label: 'f7',  type: 'generic', rx: 0.545, ry: 0.640, direction: 'inout' },
      { id: 'g7',  label: 'g7',  type: 'generic', rx: 0.635, ry: 0.640, direction: 'inout' },
      { id: 'h7',  label: 'h7',  type: 'generic', rx: 0.725, ry: 0.640, direction: 'inout' },
      { id: 'i7',  label: 'i7',  type: 'generic', rx: 0.815, ry: 0.640, direction: 'inout' },
      { id: 'j7',  label: 'j7',  type: 'generic', rx: 0.905, ry: 0.640, direction: 'inout' },
      { id: 'a8',  label: 'a8',  type: 'generic', rx: 0.095, ry: 0.730, direction: 'inout' },
      { id: 'b8',  label: 'b8',  type: 'generic', rx: 0.185, ry: 0.730, direction: 'inout' },
      { id: 'c8',  label: 'c8',  type: 'generic', rx: 0.275, ry: 0.730, direction: 'inout' },
      { id: 'd8',  label: 'd8',  type: 'generic', rx: 0.365, ry: 0.730, direction: 'inout' },
      { id: 'e8',  label: 'e8',  type: 'generic', rx: 0.455, ry: 0.730, direction: 'inout' },
      { id: 'f8',  label: 'f8',  type: 'generic', rx: 0.545, ry: 0.730, direction: 'inout' },
      { id: 'g8',  label: 'g8',  type: 'generic', rx: 0.635, ry: 0.730, direction: 'inout' },
      { id: 'h8',  label: 'h8',  type: 'generic', rx: 0.725, ry: 0.730, direction: 'inout' },
      { id: 'i8',  label: 'i8',  type: 'generic', rx: 0.815, ry: 0.730, direction: 'inout' },
      { id: 'j8',  label: 'j8',  type: 'generic', rx: 0.905, ry: 0.730, direction: 'inout' },
      { id: 'a9',  label: 'a9',  type: 'generic', rx: 0.095, ry: 0.820, direction: 'inout' },
      { id: 'b9',  label: 'b9',  type: 'generic', rx: 0.185, ry: 0.820, direction: 'inout' },
      { id: 'c9',  label: 'c9',  type: 'generic', rx: 0.275, ry: 0.820, direction: 'inout' },
      { id: 'd9',  label: 'd9',  type: 'generic', rx: 0.365, ry: 0.820, direction: 'inout' },
      { id: 'e9',  label: 'e9',  type: 'generic', rx: 0.455, ry: 0.820, direction: 'inout' },
      { id: 'f9',  label: 'f9',  type: 'generic', rx: 0.545, ry: 0.820, direction: 'inout' },
      { id: 'g9',  label: 'g9',  type: 'generic', rx: 0.635, ry: 0.820, direction: 'inout' },
      { id: 'h9',  label: 'h9',  type: 'generic', rx: 0.725, ry: 0.820, direction: 'inout' },
      { id: 'i9',  label: 'i9',  type: 'generic', rx: 0.815, ry: 0.820, direction: 'inout' },
      { id: 'j9',  label: 'j9',  type: 'generic', rx: 0.905, ry: 0.820, direction: 'inout' },
      { id: 'a10', label: 'a10', type: 'generic', rx: 0.095, ry: 0.910, direction: 'inout' },
      { id: 'b10', label: 'b10', type: 'generic', rx: 0.185, ry: 0.910, direction: 'inout' },
      { id: 'c10', label: 'c10', type: 'generic', rx: 0.275, ry: 0.910, direction: 'inout' },
      { id: 'd10', label: 'd10', type: 'generic', rx: 0.365, ry: 0.910, direction: 'inout' },
      { id: 'e10', label: 'e10', type: 'generic', rx: 0.455, ry: 0.910, direction: 'inout' },
      { id: 'f10', label: 'f10', type: 'generic', rx: 0.545, ry: 0.910, direction: 'inout' },
      { id: 'g10', label: 'g10', type: 'generic', rx: 0.635, ry: 0.910, direction: 'inout' },
      { id: 'h10', label: 'h10', type: 'generic', rx: 0.725, ry: 0.910, direction: 'inout' },
      { id: 'i10', label: 'i10', type: 'generic', rx: 0.815, ry: 0.910, direction: 'inout' },
      { id: 'j10', label: 'j10', type: 'generic', rx: 0.905, ry: 0.910, direction: 'inout' },
    ],
  },
  header_8: {
    type: 'header_8', label: '8-Pin Header', w: 18, h: 104,
    color: '#111', borderColor: '#333', category: 'passive',
    description: 'Male 2.54mm pin header · 8 pins · breadboard compatible',
    pins: [
      { id: 'p1', label: 'Pin 1', type: 'generic', rx: 0.5, ry: 0.06,  direction: 'inout' },
      { id: 'p2', label: 'Pin 2', type: 'generic', rx: 0.5, ry: 0.185, direction: 'inout' },
      { id: 'p3', label: 'Pin 3', type: 'generic', rx: 0.5, ry: 0.31,  direction: 'inout' },
      { id: 'p4', label: 'Pin 4', type: 'generic', rx: 0.5, ry: 0.435, direction: 'inout' },
      { id: 'p5', label: 'Pin 5', type: 'generic', rx: 0.5, ry: 0.56,  direction: 'inout' },
      { id: 'p6', label: 'Pin 6', type: 'generic', rx: 0.5, ry: 0.685, direction: 'inout' },
      { id: 'p7', label: 'Pin 7', type: 'generic', rx: 0.5, ry: 0.81,  direction: 'inout' },
      { id: 'p8', label: 'Pin 8', type: 'generic', rx: 0.5, ry: 0.935, direction: 'inout' },
    ],
  },

  // ── Full-size breadboard 830 with power rails ─────────────────────────────
  // Layout: 20 columns (1-20), rows a-j (a-e left of gap, f-j right)
  // + 4 power rails: pvcc_t (top VCC), pgnd_t (top GND),
  //                  pgnd_b (bot GND), pvcc_b (bot VCC)
  // All pvcc_* form one VCC bus; all pgnd_* form one GND bus.
  breadboard_830: (() => {
    const COLS = 20
    const colRx = Array.from({ length: COLS }, (_, i) => 0.04 + i * (0.92 / 19))
    const compRows: [string, number, 'inout'][] = [
      ['a', 0.18, 'inout'], ['b', 0.25, 'inout'], ['c', 0.32, 'inout'],
      ['d', 0.39, 'inout'], ['e', 0.46, 'inout'],
      ['f', 0.54, 'inout'], ['g', 0.61, 'inout'], ['h', 0.68, 'inout'],
      ['i', 0.75, 'inout'], ['j', 0.82, 'inout'],
    ]
    const pins: CircuitPin[] = []
    // Top power rails
    for (let i = 0; i < COLS; i++) {
      pins.push({ id: `pvcc_t${i + 1}`, label: '+5V', type: 'power', rx: colRx[i], ry: 0.04, direction: 'inout' })
      pins.push({ id: `pgnd_t${i + 1}`, label: 'GND', type: 'gnd',   rx: colRx[i], ry: 0.09, direction: 'inout' })
    }
    // Component holes
    for (const [letter, ry] of compRows) {
      for (let i = 0; i < COLS; i++) {
        pins.push({ id: `${letter}${i + 1}`, label: `${letter}${i + 1}`, type: 'generic', rx: colRx[i], ry, direction: 'inout' })
      }
    }
    // Bottom power rails
    for (let i = 0; i < COLS; i++) {
      pins.push({ id: `pgnd_b${i + 1}`, label: 'GND', type: 'gnd',   rx: colRx[i], ry: 0.91, direction: 'inout' })
      pins.push({ id: `pvcc_b${i + 1}`, label: '+5V', type: 'power', rx: colRx[i], ry: 0.96, direction: 'inout' })
    }
    return {
      type: 'breadboard_830', label: 'Breadboard 830pt', w: 390, h: 240,
      color: '#f0edd8', borderColor: '#c8c0a0', category: 'passive' as const,
      description: 'Full-size 830 tie-point breadboard · 20 columns · 4 power rails (VCC + GND)',
      pins,
    }
  })(),

  // ── Sensors ───────────────────────────────────────────────────────────────
  dht11: {
    type: 'dht11', label: 'DHT11', w: 44, h: 52,
    color: '#1a5fb4', borderColor: '#0d3d80', category: 'sensor',
    description: 'Digital temp & humidity sensor · ±2°C · ±5%RH',
    hidden: true,
    pins: [
      { id: 'vcc',  label: 'VCC (3.3–5V)', type: 'power',   rx: 0, ry: 0.3, direction: 'in'  },
      { id: 'data', label: 'Data',          type: 'digital', rx: 0, ry: 0.6, direction: 'out' },
      { id: 'nc',   label: 'NC',            type: 'generic', rx: 1, ry: 0.4, direction: 'in'  },
      { id: 'gnd',  label: 'GND',           type: 'gnd',     rx: 1, ry: 0.7, direction: 'in'  },
    ],
  },
  ldr: {
    type: 'ldr', label: 'LDR', w: 34, h: 34,
    color: '#c48a00', borderColor: '#8a6000', category: 'sensor',
    description: 'Light-dependent resistor · resistance ↓ as light ↑',
    hidden: true,
    pins: [
      { id: 'pin1', label: 'Pin 1', type: 'analog', rx: 0,   ry: 0.5, direction: 'inout' },
      { id: 'pin2', label: 'Pin 2', type: 'analog', rx: 1,   ry: 0.5, direction: 'inout' },
    ],
  },
  ultrasonic: {
    type: 'ultrasonic', label: 'HC-SR04', w: 72, h: 42,
    color: '#1a4a2a', borderColor: '#0d3018', category: 'sensor',
    description: 'Ultrasonic distance sensor · 2–400cm · ±3mm',
    hidden: true,
    pins: [
      { id: 'vcc',  label: 'VCC 5V', type: 'power',   rx: 0.1,  ry: 0, direction: 'in'  },
      { id: 'trig', label: 'TRIG',   type: 'digital', rx: 0.37, ry: 0, direction: 'in'  },
      { id: 'echo', label: 'ECHO',   type: 'digital', rx: 0.63, ry: 0, direction: 'out' },
      { id: 'gnd',  label: 'GND',    type: 'gnd',     rx: 0.9,  ry: 0, direction: 'in'  },
    ],
  },
  ir_sensor: {
    type: 'ir_sensor', label: 'IR Sensor', w: 50, h: 36,
    color: '#1a1a1a', borderColor: '#333', category: 'sensor',
    description: 'Infrared obstacle sensor · digital output · 2–30cm',
    hidden: true,
    pins: [
      { id: 'vcc', label: 'VCC',    type: 'power',   rx: 0, ry: 0.2, direction: 'in'  },
      { id: 'gnd', label: 'GND',    type: 'gnd',     rx: 0, ry: 0.8, direction: 'in'  },
      { id: 'out', label: 'Output', type: 'digital', rx: 1, ry: 0.5, direction: 'out' },
    ],
  },
  thermistor: {
    type: 'thermistor', label: 'Thermistor NTC', w: 36, h: 36,
    color: '#4a2a2a', borderColor: '#6a3a3a', category: 'sensor',
    description: 'NTC thermistor 10kΩ · resistance decreases with temperature',
    hidden: true,
    pins: [
      { id: 'pin1', label: 'Pin 1', type: 'analog', rx: 0, ry: 0.5, direction: 'inout' },
      { id: 'pin2', label: 'Pin 2', type: 'analog', rx: 1, ry: 0.5, direction: 'inout' },
    ],
  },

  // ── Actuators ─────────────────────────────────────────────────────────────
  relay: {
    type: 'relay', label: 'Relay 5V', w: 60, h: 44,
    color: '#1a2a1a', borderColor: '#0d1a0d', category: 'actuator',
    description: '5V single-channel relay · NO/NC · up to 10A 250V AC',
    pins: [
      { id: 'vcc', label: 'VCC 5V', type: 'power',   rx: 0, ry: 0.18, direction: 'in'   },
      { id: 'gnd', label: 'GND',    type: 'gnd',     rx: 0, ry: 0.50, direction: 'in'   },
      { id: 'in',  label: 'IN',     type: 'digital', rx: 0, ry: 0.82, direction: 'in'   },
      { id: 'com', label: 'COM',    type: 'generic', rx: 1, ry: 0.25, direction: 'inout'},
      { id: 'no',  label: 'NO',     type: 'generic', rx: 1, ry: 0.55, direction: 'out'  },
      { id: 'nc',  label: 'NC',     type: 'generic', rx: 1, ry: 0.82, direction: 'out'  },
    ],
  },
  l298n: {
    type: 'l298n', label: 'L298N Driver', w: 72, h: 66,
    color: '#1c1c1c', borderColor: '#2a2a2a', category: 'actuator',
    description: 'L298N dual H-bridge motor driver · 2A per channel · 5–35V',
    hidden: true,
    pins: [
      { id: 'ena',   label: 'ENA',    type: 'pwm',     rx: 0, ry: 0.10, direction: 'in'  },
      { id: 'in1',   label: 'IN1',    type: 'digital', rx: 0, ry: 0.26, direction: 'in'  },
      { id: 'in2',   label: 'IN2',    type: 'digital', rx: 0, ry: 0.40, direction: 'in'  },
      { id: 'in3',   label: 'IN3',    type: 'digital', rx: 0, ry: 0.54, direction: 'in'  },
      { id: 'in4',   label: 'IN4',    type: 'digital', rx: 0, ry: 0.68, direction: 'in'  },
      { id: 'enb',   label: 'ENB',    type: 'pwm',     rx: 0, ry: 0.84, direction: 'in'  },
      { id: 'vcc',   label: 'VCC',    type: 'power',   rx: 1, ry: 0.10, direction: 'in'  },
      { id: 'gnd',   label: 'GND',    type: 'gnd',     rx: 1, ry: 0.28, direction: 'in'  },
      { id: '5v',    label: '5V Out', type: 'power',   rx: 1, ry: 0.46, direction: 'out' },
      { id: 'outa1', label: 'OUT1',   type: 'generic', rx: 1, ry: 0.62, direction: 'out' },
      { id: 'outa2', label: 'OUT2',   type: 'generic', rx: 1, ry: 0.76, direction: 'out' },
    ],
  },
  dc_motor: {
    type: 'dc_motor', label: 'DC Motor', w: 54, h: 54,
    color: '#2a2a2a', borderColor: '#444', category: 'actuator',
    description: 'Generic DC motor · 3–12V · use with L298N or MOSFET',
    hidden: true,
    pins: [
      { id: 'pos', label: 'Motor (+)', type: 'power', rx: 0.28, ry: 0, direction: 'in' },
      { id: 'neg', label: 'Motor (−)', type: 'gnd',   rx: 0.72, ry: 0, direction: 'in' },
    ],
  },

  // ── Display ───────────────────────────────────────────────────────────────
  lcd_16x2: {
    type: 'lcd_16x2', label: 'LCD 16×2', w: 120, h: 60,
    color: '#0a3d0a', borderColor: '#063006', category: 'display',
    description: 'HD44780 16×2 character LCD · parallel or I²C',
    hidden: true,
    pins: [
      { id: 'vss', label: 'VSS GND',     type: 'gnd',     rx: 0.04, ry: 1, direction: 'in' },
      { id: 'vdd', label: 'VDD 5V',      type: 'power',   rx: 0.11, ry: 1, direction: 'in' },
      { id: 'vo',  label: 'V0 Contrast', type: 'analog',  rx: 0.18, ry: 1, direction: 'in' },
      { id: 'rs',  label: 'RS',          type: 'digital', rx: 0.25, ry: 1, direction: 'in' },
      { id: 'rw',  label: 'R/W',         type: 'digital', rx: 0.32, ry: 1, direction: 'in' },
      { id: 'en',  label: 'Enable',      type: 'digital', rx: 0.39, ry: 1, direction: 'in' },
      { id: 'd4',  label: 'D4',          type: 'digital', rx: 0.54, ry: 1, direction: 'in' },
      { id: 'd5',  label: 'D5',          type: 'digital', rx: 0.61, ry: 1, direction: 'in' },
      { id: 'd6',  label: 'D6',          type: 'digital', rx: 0.68, ry: 1, direction: 'in' },
      { id: 'd7',  label: 'D7',          type: 'digital', rx: 0.75, ry: 1, direction: 'in' },
      { id: 'a',   label: 'Anode (BL)',  type: 'power',   rx: 0.88, ry: 1, direction: 'in' },
      { id: 'k',   label: 'Cathode(BL)', type: 'gnd',     rx: 0.96, ry: 1, direction: 'in' },
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
  oled_128x64: {
    type: 'oled_128x64', label: 'OLED 128×64', w: 72, h: 54,
    color: '#0a0a0a', borderColor: '#222', category: 'display',
    description: 'SSD1306 0.96" OLED · 128×64 · I²C · 3.3V–5V',
    hidden: true,
    pins: [
      { id: 'gnd', label: 'GND', type: 'gnd',   rx: 0.10, ry: 1, direction: 'in'    },
      { id: 'vcc', label: 'VCC', type: 'power', rx: 0.30, ry: 1, direction: 'in'    },
      { id: 'scl', label: 'SCL', type: 'i2c',   rx: 0.58, ry: 1, direction: 'in'    },
      { id: 'sda', label: 'SDA', type: 'i2c',   rx: 0.80, ry: 1, direction: 'inout' },
    ],
  },
  neopixel_ring: {
    type: 'neopixel_ring', label: 'NeoPixel Ring', w: 60, h: 60,
    color: '#111', borderColor: '#333', category: 'output',
    description: 'WS2812B 12-pixel RGB ring · addressable · 5V',
    hidden: true,
    pins: [
      { id: 'pwr',  label: 'PWR 5V',   type: 'power',   rx: 0.12, ry: 0.88, direction: 'in'  },
      { id: 'gnd',  label: 'GND',      type: 'gnd',     rx: 0.30, ry: 0.96, direction: 'in'  },
      { id: 'din',  label: 'Data IN',  type: 'digital', rx: 0.70, ry: 0.96, direction: 'in'  },
      { id: 'dout', label: 'Data OUT', type: 'digital', rx: 0.88, ry: 0.88, direction: 'out' },
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
    type: 'power_rail', label: 'Power Rail', w: 30, h: 120,
    color: '#111', borderColor: '#2a2a2a', category: 'power',
    description: 'Dual power rail — 5V + GND bus · 5 ports each',
    pins: [
      { id: '5v_1',  label: '5V rail 1',  type: 'power', rx: 0.5, ry: 0.05, direction: 'inout' },
      { id: '5v_2',  label: '5V rail 2',  type: 'power', rx: 0.5, ry: 0.13, direction: 'inout' },
      { id: '5v_3',  label: '5V rail 3',  type: 'power', rx: 0.5, ry: 0.21, direction: 'inout' },
      { id: '5v_4',  label: '5V rail 4',  type: 'power', rx: 0.5, ry: 0.29, direction: 'inout' },
      { id: '5v_5',  label: '5V rail 5',  type: 'power', rx: 0.5, ry: 0.37, direction: 'inout' },
      { id: 'gnd_1', label: 'GND rail 1', type: 'gnd',   rx: 0.5, ry: 0.56, direction: 'inout' },
      { id: 'gnd_2', label: 'GND rail 2', type: 'gnd',   rx: 0.5, ry: 0.64, direction: 'inout' },
      { id: 'gnd_3', label: 'GND rail 3', type: 'gnd',   rx: 0.5, ry: 0.72, direction: 'inout' },
      { id: 'gnd_4', label: 'GND rail 4', type: 'gnd',   rx: 0.5, ry: 0.80, direction: 'inout' },
      { id: 'gnd_5', label: 'GND rail 5', type: 'gnd',   rx: 0.5, ry: 0.88, direction: 'inout' },
    ],
  },
}

// ── Default circuit ────────────────────────────────────────────────────────────

export const DEFAULT_CIRCUIT: TsukiCircuit = {
  version: '1',
  name: 'New Circuit',
  board: 'uno',
  description: '',
  components: [],
  wires: [],
  notes: [],
}

// ── Category metadata ──────────────────────────────────────────────────────────

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

export const ALL_CATEGORIES = [
  'mcu', 'output', 'input', 'passive', 'sensor', 'actuator', 'display', 'power',
] as const

// ── Utility helpers ────────────────────────────────────────────────────────────

/** How many px to pull edge pins inside the component border */
export const PIN_INSET = 8

export function getPinAbsPos(comp: PlacedComponent, pin: CircuitPin) {
  const def = COMP_DEFS[comp.type]
  if (!def) return { x: comp.x, y: comp.y }
  let x = comp.x + pin.rx * def.w
  let y = comp.y + pin.ry * def.h
  if (pin.rx === 0) x += PIN_INSET
  if (pin.rx === 1) x -= PIN_INSET
  if (pin.ry === 0) y += PIN_INSET
  if (pin.ry === 1) y -= PIN_INSET
  return { x, y }
}

/** Snap to grid — 10px default (used for component placement) */
export function snapToGrid(v: number, grid = 10): number {
  return Math.round(v / grid) * grid
}

/** Snap to grid — 20px default (used for wire routing) */
export function snapGrid(v: number, grid = 20): number {
  return Math.round(v / grid) * grid
}

/** Bezier path (legacy helper, kept for compatibility) */
export function makeBezierPath(ax: number, ay: number, bx: number, by: number): string {
  const dx = bx - ax
  const dy = by - ay
  const dist = Math.sqrt(dx * dx + dy * dy)
  const cp = Math.max(30, dist * 0.45)
  return `M ${ax} ${ay} C ${ax + cp} ${ay}, ${bx - cp} ${by}, ${bx} ${by}`
}

/**
 * Orthogonal (right-angle) wire path — Tinkercad style.
 * Routes: M start → [H x V y for each waypoint] → H bx V by → end
 */
export function makeOrthogonalPath(
  ax: number, ay: number,
  bx: number, by: number,
  waypoints: { x: number; y: number }[] = []
): string {
  const pts = [{ x: ax, y: ay }, ...waypoints, { x: bx, y: by }]
  let d = `M ${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1], p = pts[i]
    if (Math.abs(p.x - prev.x) < 1) {
      d += ` V ${p.y}`
    } else if (Math.abs(p.y - prev.y) < 1) {
      d += ` H ${p.x}`
    } else {
      d += ` H ${p.x} V ${p.y}`
    }
  }
  return d
}

/**
 * Smooth bezier wire path — gentle curves between waypoints.
 */
export function makeSmoothPath(
  ax: number, ay: number,
  bx: number, by: number,
  waypoints: { x: number; y: number }[] = []
): string {
  const pts = [{ x: ax, y: ay }, ...waypoints, { x: bx, y: by }]
  if (pts.length === 2) {
    const dx = Math.abs(bx - ax) * 0.55
    return `M ${ax},${ay} C ${ax + dx},${ay} ${bx - dx},${by} ${bx},${by}`
  }
  // Catmull-Rom to bezier
  let d = `M ${pts[0].x},${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`
  }
  return d
}

/**
 * Flexible wire path — sags downward like a physical cable.
 */
export function makeFlexiblePath(
  ax: number, ay: number,
  bx: number, by: number,
  waypoints: { x: number; y: number }[] = []
): string {
  if (waypoints.length > 0) return makeSmoothPath(ax, ay, bx, by, waypoints)
  const mx  = (ax + bx) / 2
  const my  = (ay + by) / 2
  const len = Math.hypot(bx - ax, by - ay)
  // Sag amount proportional to wire length, always downward
  const sag = Math.min(len * 0.25, 60)
  const cpx = mx
  const cpy = my + sag
  return `M ${ax},${ay} Q ${cpx},${cpy} ${bx},${by}`
}

/**
 * Direct (straight) wire path.
 */
export function makeDirectPath(
  ax: number, ay: number,
  bx: number, by: number,
  _waypoints: { x: number; y: number }[] = []
): string {
  return `M ${ax},${ay} L ${bx},${by}`
}

export type WireStyleId = 'orthogonal' | 'smooth' | 'flexible' | 'direct'

/** Build a wire SVG path using the requested style */
export function makeWirePath(
  ax: number, ay: number,
  bx: number, by: number,
  waypoints: { x: number; y: number }[] = [],
  style: WireStyleId = 'orthogonal',
): string {
  switch (style) {
    case 'smooth':    return makeSmoothPath(ax, ay, bx, by, waypoints)
    case 'flexible':  return makeFlexiblePath(ax, ay, bx, by, waypoints)
    case 'direct':    return makeDirectPath(ax, ay, bx, by, waypoints)
    default:          return makeOrthogonalPath(ax, ay, bx, by, waypoints)
  }
}

/** Wire palette definitions */
export type WirePaletteId = 'classic' | 'monochrome' | 'pastel' | 'custom'

export const WIRE_PALETTES: Record<WirePaletteId, { label: string; colors: string[] }> = {
  classic: {
    label: 'Classic',
    colors: ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#a855f7','#ec4899','#e2e2e2','#1a1a1a'],
  },
  monochrome: {
    label: 'Monochrome',
    colors: ['#ffffff','#d4d4d4','#a3a3a3','#737373','#525252','#404040','#2a2a2a','#1c1c1c','#0a0a0a'],
  },
  pastel: {
    label: 'Pastel',
    colors: ['#fca5a5','#fdba74','#fde68a','#86efac','#93c5fd','#c4b5fd','#f9a8d4','#e5e7eb','#6b7280'],
  },
  custom: {
    label: 'Custom',
    colors: ['#ef4444','#3b82f6','#22c55e','#f97316','#a855f7','#eab308','#ec4899','#e2e2e2','#1a1a1a'],
  },
}

/** Compute estimated V / I / P for a wire given current sim state */
export function getWireMeasurements(
  wire: CircuitWire,
  simPinValues: Record<string, number>,
  circuit: TsukiCircuit,
) {
  const toKey   = `${wire.toComp}:${wire.toPin}`
  const fromKey = `${wire.fromComp}:${wire.fromPin}`
  const raw = Math.max(simPinValues[toKey] ?? 0, simPinValues[fromKey] ?? 0)
  const mA  = Math.max(
    simPinValues[`${toKey}:mA`]   ?? 0,
    simPinValues[`${fromKey}:mA`] ?? 0,
  )
  const sourceV = raw === 0 ? 0 : raw === 1 ? 5.0 : (raw / 255) * 5.0
  let totalOhms = 0
  for (const w of circuit.wires) {
    const fc = circuit.components.find(c => c.id === w.fromComp)
    const tc = circuit.components.find(c => c.id === w.toComp)
    if (!fc || !tc) continue
    if (fc.type === 'resistor' || tc.type === 'resistor') {
      const res = fc.type === 'resistor' ? fc : tc
      totalOhms += Number(res.props?.ohms ?? 0)
    }
  }
  const dropV    = totalOhms > 0 && mA > 0 ? (mA / 1000) * totalOhms : 0
  const voltage  = Math.max(0, sourceV - dropV)
  const power_mW = voltage * mA
  return { voltage, mA, power_mW, sourceV, dropV }
}

/** Serialize a circuit to JSON text */
export function circuitToText(c: TsukiCircuit): string {
  return JSON.stringify(c, null, 2)
}

/** Parse JSON text back to a circuit (returns null on error) */
export function textToCircuit(raw: string): TsukiCircuit | null {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed.components || !parsed.wires) return null
    return { ...DEFAULT_CIRCUIT, ...parsed }
  } catch { return null }
}