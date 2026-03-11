'use client'
import { useStore } from '@/lib/store'
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  BookOpen, Search, ChevronRight, ChevronDown, Play,
  Cpu, Zap, Radio, Thermometer, Layers, Activity, Sun,
  X, FileCode, RefreshCw, Package, CircuitBoard,
} from 'lucide-react'
import { clsx } from 'clsx'

// ── Inline circuit data ───────────────────────────────────────────────────────
// Defined as plain objects to avoid any static import / webpack issues.

const BLINK_CIRCUIT = {"version":"1","name":"Blink","board":"uno","description":"Arduino Uno blinks LED on D13 via 220Ω resistor","components":[{"id":"uno","type":"arduino_uno","label":"Arduino Uno","x":40,"y":20,"rotation":0,"color":"","props":{}},{"id":"r1","type":"resistor","label":"220Ω","x":240,"y":144,"rotation":0,"color":"","props":{"ohms":220}},{"id":"led1","type":"led","label":"LED","x":330,"y":120,"rotation":0,"color":"","props":{}},{"id":"gnd1","type":"gnd_node","label":"GND","x":340,"y":210,"rotation":0,"color":"","props":{}}],"wires":[{"id":"w1","fromComp":"uno","fromPin":"D13","toComp":"r1","toPin":"pin1","color":"#3b82f6","waypoints":[]},{"id":"w2","fromComp":"r1","fromPin":"pin2","toComp":"led1","toPin":"anode","color":"#3b82f6","waypoints":[]},{"id":"w3","fromComp":"led1","fromPin":"cathode","toComp":"gnd1","toPin":"gnd","color":"#6b7280","waypoints":[]}],"notes":[]}

const BUTTON_LED_CIRCUIT = {"version":"1","name":"Button LED","board":"uno","description":"Push button on D2 (INPUT_PULLUP) toggles LED on D13","components":[{"id":"uno","type":"arduino_uno","label":"Arduino Uno","x":40,"y":20,"rotation":0,"color":"","props":{}},{"id":"btn","type":"button","label":"Button","x":280,"y":80,"rotation":0,"color":"","props":{}},{"id":"r1","type":"resistor","label":"220Ω","x":280,"y":180,"rotation":0,"color":"","props":{"ohms":220}},{"id":"led1","type":"led","label":"LED","x":370,"y":160,"rotation":0,"color":"","props":{}},{"id":"gnd1","type":"gnd_node","label":"GND","x":290,"y":270,"rotation":0,"color":"","props":{}},{"id":"gnd2","type":"gnd_node","label":"GND","x":380,"y":260,"rotation":0,"color":"","props":{}}],"wires":[{"id":"w1","fromComp":"uno","fromPin":"D2","toComp":"btn","toPin":"pin1","color":"#3b82f6","waypoints":[]},{"id":"w2","fromComp":"btn","fromPin":"pin3","toComp":"gnd1","toPin":"gnd","color":"#6b7280","waypoints":[]},{"id":"w3","fromComp":"uno","fromPin":"D13","toComp":"r1","toPin":"pin1","color":"#3b82f6","waypoints":[]},{"id":"w4","fromComp":"r1","fromPin":"pin2","toComp":"led1","toPin":"anode","color":"#3b82f6","waypoints":[]},{"id":"w5","fromComp":"led1","fromPin":"cathode","toComp":"gnd2","toPin":"gnd","color":"#6b7280","waypoints":[]}],"notes":[]}

const PWM_FADE_CIRCUIT = {"version":"1","name":"PWM Fade","board":"uno","description":"LED fades in and out via analogWrite on D9 (PWM)","components":[{"id":"uno","type":"arduino_uno","label":"Arduino Uno","x":40,"y":20,"rotation":0,"color":"","props":{}},{"id":"r1","type":"resistor","label":"220Ω","x":240,"y":140,"rotation":0,"color":"","props":{"ohms":220}},{"id":"led1","type":"led","label":"LED","x":330,"y":120,"rotation":0,"color":"","props":{}},{"id":"gnd1","type":"gnd_node","label":"GND","x":340,"y":210,"rotation":0,"color":"","props":{}}],"wires":[{"id":"w1","fromComp":"uno","fromPin":"D9","toComp":"r1","toPin":"pin1","color":"#f97316","waypoints":[]},{"id":"w2","fromComp":"r1","fromPin":"pin2","toComp":"led1","toPin":"anode","color":"#f97316","waypoints":[]},{"id":"w3","fromComp":"led1","fromPin":"cathode","toComp":"gnd1","toPin":"gnd","color":"#6b7280","waypoints":[]}],"notes":[]}

const ANALOG_READ_CIRCUIT = {"version":"1","name":"Analog Read","board":"uno","description":"Potentiometer on A0 — read 0–1023 and print to Serial","components":[{"id":"uno","type":"arduino_uno","label":"Arduino Uno","x":40,"y":20,"rotation":0,"color":"","props":{}},{"id":"pot","type":"potentiometer","label":"Pot 10kΩ","x":280,"y":80,"rotation":0,"color":"","props":{}},{"id":"vcc1","type":"vcc_node","label":"5V","x":230,"y":50,"rotation":0,"color":"","props":{}},{"id":"gnd1","type":"gnd_node","label":"GND","x":230,"y":200,"rotation":0,"color":"","props":{}}],"wires":[{"id":"w1","fromComp":"vcc1","fromPin":"5v","toComp":"pot","toPin":"vcc","color":"#ef4444","waypoints":[]},{"id":"w2","fromComp":"gnd1","fromPin":"gnd","toComp":"pot","toPin":"gnd","color":"#6b7280","waypoints":[]},{"id":"w3","fromComp":"pot","fromPin":"wiper","toComp":"uno","toPin":"A0","color":"#a855f7","waypoints":[]}],"notes":[]}

const I2C_SCAN_CIRCUIT = {"version":"1","name":"I2C Scanner","board":"uno","description":"Scan the I²C bus — SDA on A4, SCL on A5","components":[{"id":"uno","type":"arduino_uno","label":"Arduino Uno","x":40,"y":20,"rotation":0,"color":"","props":{}},{"id":"vcc1","type":"vcc_node","label":"3.3V / 5V","x":280,"y":60,"rotation":0,"color":"","props":{}},{"id":"gnd1","type":"gnd_node","label":"GND","x":280,"y":200,"rotation":0,"color":"","props":{}}],"wires":[],"notes":[{"id":"n1","x":260,"y":110,"text":"Connect your I²C device:\nSDA → A4\nSCL → A5\nVCC → 3.3V or 5V\nGND → GND","color":"#fbbf24"}]}

const SERVO_SWEEP_CIRCUIT = {"version":"1","name":"Servo Sweep","board":"uno","description":"SG90 servo sweeps 0–180° via D9 (PWM). Uses Servo library.","components":[{"id":"uno","type":"arduino_uno","label":"Arduino Uno","x":40,"y":20,"rotation":0,"color":"","props":{}},{"id":"srv","type":"servo","label":"SG90 Servo","x":270,"y":100,"rotation":0,"color":"","props":{}},{"id":"vcc1","type":"vcc_node","label":"5V","x":240,"y":50,"rotation":0,"color":"","props":{}},{"id":"gnd1","type":"gnd_node","label":"GND","x":240,"y":200,"rotation":0,"color":"","props":{}}],"wires":[{"id":"w1","fromComp":"uno","fromPin":"D9","toComp":"srv","toPin":"signal","color":"#f97316","waypoints":[]},{"id":"w2","fromComp":"vcc1","fromPin":"5v","toComp":"srv","toPin":"vcc","color":"#ef4444","waypoints":[]},{"id":"w3","fromComp":"gnd1","fromPin":"gnd","toComp":"srv","toPin":"gnd","color":"#6b7280","waypoints":[]}],"notes":[]}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExampleFile {
  path: string
  name: string
  content: string
}

export interface ExampleDef {
  id: string
  name: string
  description: string
  category: 'builtin' | string
  packages: string[]
  icon?: React.ReactNode
  files: ExampleFile[]
  circuit?: Record<string, unknown>
}

// ── Built-in examples ─────────────────────────────────────────────────────────

const BUILTIN_EXAMPLES: ExampleDef[] = [
  {
    id: 'blink',
    name: 'Blink',
    description: 'Blink the built-in LED every 500 ms.',
    category: 'builtin',
    packages: [],
    icon: <Zap size={11} />,
    circuit: BLINK_CIRCUIT,
    files: [{
      path: 'src/main.go', name: 'main.go',
      content: `package main

import "arduino"

const ledPin = arduino.LED_BUILTIN
const interval = 500 // ms

func setup() {
    arduino.PinMode(ledPin, arduino.OUTPUT)
    arduino.Serial.Begin(9600)
    arduino.Serial.Println("Blink ready!")
}

func loop() {
    arduino.DigitalWrite(ledPin, arduino.HIGH)
    arduino.Delay(interval)
    arduino.DigitalWrite(ledPin, arduino.LOW)
    arduino.Delay(interval)
}`,
    }],
  },
  {
    id: 'analog-read',
    name: 'Analog Read',
    description: 'Read a sensor from A0 and print to Serial.',
    category: 'builtin',
    packages: [],
    icon: <Activity size={11} />,
    circuit: ANALOG_READ_CIRCUIT,
    files: [{
      path: 'src/main.go', name: 'main.go',
      content: `package main

import (
    "arduino"
    "fmt"
)

func setup() {
    arduino.Serial.Begin(9600)
}

func loop() {
    val := arduino.AnalogRead(arduino.A0)
    fmt.Println("sensor:", val)
    arduino.Delay(500)
}`,
    }],
  },
  {
    id: 'button',
    name: 'Button Toggle',
    description: 'Toggle the LED with a button on pin 2.',
    category: 'builtin',
    packages: [],
    icon: <Cpu size={11} />,
    circuit: BUTTON_LED_CIRCUIT,
    files: [{
      path: 'src/main.go', name: 'main.go',
      content: `package main

import "arduino"

const buttonPin = 2
const ledPin    = arduino.LED_BUILTIN

var ledState = arduino.LOW

func setup() {
    arduino.PinMode(buttonPin, arduino.INPUT_PULLUP)
    arduino.PinMode(ledPin, arduino.OUTPUT)
}

func loop() {
    if arduino.DigitalRead(buttonPin) == arduino.LOW {
        if ledState == arduino.LOW {
            ledState = arduino.HIGH
        } else {
            ledState = arduino.LOW
        }
        arduino.DigitalWrite(ledPin, ledState)
        arduino.Delay(200)
    }
}`,
    }],
  },
  {
    id: 'pwm-fade',
    name: 'PWM Fade',
    description: 'Fade an LED in and out using analogWrite.',
    category: 'builtin',
    packages: [],
    icon: <Sun size={11} />,
    circuit: PWM_FADE_CIRCUIT,
    files: [{
      path: 'src/main.go', name: 'main.go',
      content: `package main

import "arduino"

const ledPin = 9

var brightness = 0
var fadeAmount  = 5

func setup() {
    arduino.PinMode(ledPin, arduino.OUTPUT)
}

func loop() {
    arduino.AnalogWrite(ledPin, brightness)
    brightness += fadeAmount
    if brightness <= 0 || brightness >= 255 {
        fadeAmount = -fadeAmount
    }
    arduino.Delay(30)
}`,
    }],
  },
  {
    id: 'serial-echo',
    name: 'Serial Echo',
    description: 'Echo bytes received over Serial back to the sender.',
    category: 'builtin',
    packages: [],
    icon: <Radio size={11} />,
    files: [{
      path: 'src/main.go', name: 'main.go',
      content: `package main

import (
    "arduino"
    "fmt"
)

func setup() {
    arduino.Serial.Begin(115200)
    fmt.Println("Serial echo ready — type something!")
}

func loop() {
    if arduino.Serial.Available() > 0 {
        b := arduino.Serial.Read()
        arduino.Serial.Write(b)
    }
}`,
    }],
  },
  {
    id: 'i2c-scan',
    name: 'I²C Scanner',
    description: 'Scan the I²C bus and print detected addresses.',
    category: 'builtin',
    packages: [],
    icon: <Search size={11} />,
    circuit: I2C_SCAN_CIRCUIT,
    files: [{
      path: 'src/main.go', name: 'main.go',
      content: `package main

import (
    "arduino"
    "fmt"
    "wire"
)

func setup() {
    wire.Begin()
    arduino.Serial.Begin(9600)
    fmt.Println("I2C scanner ready")
}

func loop() {
    found := 0
    fmt.Println("Scanning...")
    for addr := 1; addr < 127; addr++ {
        wire.BeginTransmission(addr)
        err := wire.EndTransmission()
        if err == 0 {
            fmt.Println("Found device at 0x", addr)
            found++
        }
        arduino.Delay(5)
    }
    if found == 0 {
        fmt.Println("No I2C devices found")
    }
    arduino.Delay(3000)
}`,
    }],
  },
  {
    id: 'servo-sweep',
    name: 'Servo Sweep',
    description: 'Sweep a servo from 0° to 180° and back.',
    category: 'builtin',
    packages: ['Servo'],
    icon: <Layers size={11} />,
    circuit: SERVO_SWEEP_CIRCUIT,
    files: [{
      path: 'src/main.go', name: 'main.go',
      content: `package main

import (
    "arduino"
    "Servo"
)

var s Servo.Servo

func setup() {
    s.Attach(9)
}

func loop() {
    for pos := 0; pos <= 180; pos++ {
        s.Write(pos)
        arduino.Delay(15)
    }
    for pos := 180; pos >= 0; pos-- {
        s.Write(pos)
        arduino.Delay(15)
    }
}`,
    }],
  },
]

// ── Path helpers ──────────────────────────────────────────────────────────────

/** Cached home dir so we only call Tauri once per session */
let _homeDir: string | null | undefined = undefined

async function resolveHomeDir(): Promise<string | null> {
  if (_homeDir !== undefined) return _homeDir
  try {
    const { getHomeDir } = await import('@/lib/tauri')
    _homeDir = await getHomeDir()
  } catch {
    _homeDir = null
  }
  return _homeDir
}

/** Expand a leading "~" to the real home directory.
 *  Falls back to the raw string if home dir can't be resolved. */
async function expandPath(p: string): Promise<string> {
  if (!p.startsWith('~')) return p
  const home = await resolveHomeDir()
  if (!home) return p
  return home + p.slice(1)
}

// ── Load examples from a package on disk ─────────────────────────────────────
// Tries several path layouts that tsuki may use:
//   {libsDir}/{pkgName}/{version}/examples     ← original
//   {libsDir}/{pkgName}/examples               ← no version sub-dir
//   {libsDir}/{pkgName.lower}/{version}/examples
//   {libsDir}/{pkgName.lower}/examples
// version is tried both as-is ("v1.0.0") and without the leading "v" ("1.0.0").

async function loadPkgExamples(
  libsDir: string,
  pkgName: string,
  version: string,
): Promise<ExampleDef[]> {
  const { readDirEntries, readFile } = await import('@/lib/tauri')

  // Resolve the base dir (expand "~" to the real home directory)
  const base = await expandPath(libsDir)

  // Build a list of candidate "examples" directory paths to try
  const vNoV = version.replace(/^v/, '')         // "1.0.0" from "v1.0.0"
  const lower = pkgName.toLowerCase()
  const candidates: string[] = [
    `${base}/${pkgName}/${version}/examples`,
    `${base}/${pkgName}/${vNoV}/examples`,
    `${base}/${pkgName}/examples`,
    `${base}/${lower}/${version}/examples`,
    `${base}/${lower}/${vNoV}/examples`,
    `${base}/${lower}/examples`,
  ]

  // Find the first candidate that actually exists
  let examplesPath: string | null = null
  for (const candidate of candidates) {
    try {
      await readDirEntries(candidate)   // throws if path doesn't exist
      examplesPath = candidate
      break
    } catch { /* try next */ }
  }
  if (!examplesPath) return []

  let exDirs: { name: string; is_dir: boolean }[] = []
  try {
    exDirs = await readDirEntries(examplesPath)
  } catch {
    return []
  }

  const results: ExampleDef[] = []

  for (const entry of exDirs) {
    if (!entry.is_dir) continue
    const exDir = `${examplesPath}/${entry.name}`

    let meta = { name: entry.name.replace(/_/g, ' '), description: '' }
    try {
      const raw = await readFile(`${exDir}/tsuki_example.json`)
      meta = JSON.parse(raw)
    } catch { /* use defaults */ }

    let fileEntries: { name: string; is_dir: boolean }[] = []
    try { fileEntries = await readDirEntries(exDir) } catch { continue }

    const files: ExampleFile[] = []
    let circuit: Record<string, unknown> | undefined

    for (const fe of fileEntries) {
      if (fe.is_dir || fe.name === 'tsuki_example.json') continue
      try {
        const content = await readFile(`${exDir}/${fe.name}`)
        if (fe.name.endsWith('.tsuki-circuit')) {
          try { circuit = JSON.parse(content) } catch { /* skip malformed */ }
        } else {
          files.push({ path: `src/${fe.name}`, name: fe.name, content })
        }
      } catch { /* skip unreadable */ }
    }

    if (files.length === 0 && !circuit) continue

    results.push({
      id: `${pkgName}/${entry.name}`,
      name: meta.name,
      description: meta.description,
      category: pkgName,
      packages: [pkgName],
      files,
      circuit,
    })
  }

  return results
}

// ── Import / open modal ───────────────────────────────────────────────────────

interface ImportModalProps {
  example: ExampleDef
  onClose: () => void
  onImportCode: (files: ExampleFile[]) => void
  onOpenCircuit: (circuit: Record<string, unknown>) => void
}

function ImportModal({ example, onClose, onImportCode, onOpenCircuit }: ImportModalProps) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(example.files.map(f => f.path))
  )
  const [previewPath, setPreviewPath] = useState<string>(
    example.files.find(f => f.name.endsWith('.go'))?.path ?? example.files[0]?.path ?? ''
  )

  function toggle(path: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const previewFile = example.files.find(f => f.path === previewPath)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg shadow-2xl w-[700px] max-h-[540px] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] flex-shrink-0">
          <div>
            <div className="font-semibold text-sm text-[var(--fg)]">{example.name}</div>
            <div className="text-xs text-[var(--fg-muted)] mt-0.5">{example.description}</div>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer">
            <X size={13} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* File list */}
          <div className="w-52 border-r border-[var(--border)] flex flex-col flex-shrink-0">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-faint)] border-b border-[var(--border)]">
              Source Files
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {example.files.length === 0 && (
                <div className="px-3 py-2 text-[10px] text-[var(--fg-faint)]">No code files.</div>
              )}
              {example.files.map(f => (
                <div
                  key={f.path}
                  className={clsx(
                    'flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors',
                    previewPath === f.path ? 'bg-[var(--active)]' : 'hover:bg-[var(--hover)]'
                  )}
                  onClick={() => setPreviewPath(f.path)}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(f.path)}
                    onChange={() => toggle(f.path)}
                    onClick={e => e.stopPropagation()}
                    className="accent-[var(--fg)] w-3 h-3 flex-shrink-0"
                  />
                  <FileCode size={11} className="text-[var(--fg-faint)] flex-shrink-0" />
                  <span className="text-xs text-[var(--fg-muted)] truncate">{f.name}</span>
                </div>
              ))}
              {example.circuit && (
                <div className="px-3 py-2 mt-1 border-t border-[var(--border)]">
                  <div className="flex items-center gap-1.5 text-[10px] text-[var(--fg-faint)]">
                    <CircuitBoard size={10} />
                    <span>circuit included</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Preview */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {previewFile ? (
              <>
                <div className="px-3 py-1.5 text-[10px] text-[var(--fg-faint)] border-b border-[var(--border)] font-mono flex-shrink-0">
                  {previewFile.path}
                </div>
                <pre className="flex-1 overflow-auto px-4 py-3 text-xs font-mono text-[var(--fg-muted)] leading-5 whitespace-pre-wrap">
                  {previewFile.content}
                </pre>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-[var(--fg-faint)]">
                Select a file to preview
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] flex-shrink-0 gap-2 flex-wrap">
          <span className="text-xs text-[var(--fg-faint)]">
            {selected.size} / {example.files.length} file{example.files.length !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs border border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] bg-transparent cursor-pointer transition-colors"
            >
              Cancel
            </button>
            {example.circuit && (
              <button
                onClick={() => { onOpenCircuit(example.circuit!); onClose() }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] bg-transparent cursor-pointer transition-colors"
              >
                <CircuitBoard size={10} /> Open in Sandbox
              </button>
            )}
            {example.files.length > 0 && (
              <button
                disabled={selected.size === 0}
                onClick={() => { onImportCode(example.files.filter(f => selected.has(f.path))); onClose() }}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer border-0',
                  selected.size === 0
                    ? 'bg-[var(--hover)] text-[var(--fg-faint)] cursor-not-allowed'
                    : 'bg-[var(--fg)] text-[var(--accent-inv)] hover:opacity-80'
                )}
              >
                <Play size={10} /> Open Code
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Example row ───────────────────────────────────────────────────────────────

function ExampleRow({ ex, onOpen }: { ex: ExampleDef; onOpen: (ex: ExampleDef) => void }) {
  return (
    <div
      className="group flex items-start gap-2 px-3 py-2 hover:bg-[var(--hover)] transition-colors cursor-pointer"
      onClick={() => onOpen(ex)}
    >
      <span className="text-[var(--fg-faint)] mt-0.5 flex-shrink-0">{ex.icon ?? <FileCode size={11} />}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-[var(--fg)] truncate">{ex.name}</span>
          {ex.circuit && (
            <span title="Has circuit diagram"><CircuitBoard size={9} className="text-[var(--fg-faint)] flex-shrink-0" /></span>
          )}
        </div>
        <div className="text-[10px] text-[var(--fg-muted)] leading-tight mt-0.5">{ex.description}</div>
      </div>
      <button
        className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-[var(--ok)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer transition-all flex-shrink-0 mt-0.5"
        onClick={e => { e.stopPropagation(); onOpen(ex) }}
      >
        <Play size={10} />
      </button>
    </div>
  )
}

// ── Collapsible section ───────────────────────────────────────────────────────

function Section({
  label, icon, examples, loading, onOpen, onRefresh, defaultOpen = true,
}: {
  label: string
  icon?: React.ReactNode
  examples: ExampleDef[]
  loading?: boolean
  onOpen: (ex: ExampleDef) => void
  onRefresh?: () => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer transition-colors text-left"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {icon && <span className="flex-shrink-0">{icon}</span>}
        <span>{label}</span>
        <span className="ml-auto flex items-center gap-1">
          {loading
            ? <RefreshCw size={9} className="animate-spin" />
            : <span className="text-[9px] font-normal">{examples.length}</span>
          }
          {onRefresh && !loading && (
            <span
              role="button"
              title="Refresh examples"
              onClick={e => { e.stopPropagation(); onRefresh() }}
              className="opacity-0 group-hover:opacity-100 hover:text-[var(--fg)] cursor-pointer"
            >
              <RefreshCw size={9} />
            </span>
          )}
        </span>
      </button>
      {open && !loading && examples.map(ex => (
        <ExampleRow key={ex.id} ex={ex} onOpen={onOpen} />
      ))}
      {open && !loading && examples.length === 0 && (
        <div className="px-6 py-2 text-[10px] text-[var(--fg-faint)] flex items-center gap-2">
          <span>No examples found on disk.</span>
          {onRefresh && (
            <button onClick={onRefresh} className="underline text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer text-[10px] p-0">
              Retry
            </button>
          )}
        </div>
      )}
      {open && loading && (
        <div className="px-6 py-2 text-[10px] text-[var(--fg-faint)]">Loading…</div>
      )}
    </div>
  )
}

// ── Main sidebar ──────────────────────────────────────────────────────────────

export default function ExamplesSidebar() {
  const { openExample, packages, settings, loadCircuitInSandbox } = useStore()
  const [query, setQuery]               = useState('')
  const [importTarget, setImportTarget] = useState<ExampleDef | null>(null)
  // null  = loading in progress
  // []    = loaded but empty  (still retryable via button)
  // [...] = loaded with results
  // key absent = never attempted
  const [pkgExamples, setPkgExamples]   = useState<Record<string, ExampleDef[] | null>>({})
  const prevInstalled                   = useRef<Set<string>>(new Set())

  const libsDir       = settings.libsDir || '~/.tsuki/libs'
  const installedPkgs = packages.filter(p => p.installed)

  // ── Load examples for one package ────────────────────────────────────────
  const loadForPkg = useCallback(async (name: string, version: string) => {
    setPkgExamples(prev => ({ ...prev, [name]: null }))   // null = spinner
    try {
      const examples = await loadPkgExamples(libsDir, name, version)
      setPkgExamples(prev => ({ ...prev, [name]: examples }))
    } catch {
      setPkgExamples(prev => ({ ...prev, [name]: [] }))
    }
  }, [libsDir])

  // ── Retry with backoff for freshly installed packages ─────────────────────
  // dispatchCommand is async — the package files may not land on disk for
  // several seconds after togglePackage() fires. We poll 3 times with
  // increasing delays until we find at least one example.
  const retryLoad = useCallback(async (name: string, version: string) => {
    const delays = [1500, 4000, 8000]
    for (const delay of delays) {
      await new Promise(r => setTimeout(r, delay))
      setPkgExamples(prev => ({ ...prev, [name]: null }))
      try {
        const examples = await loadPkgExamples(libsDir, name, version)
        setPkgExamples(prev => ({ ...prev, [name]: examples }))
        if (examples.length > 0) return   // found — stop retrying
      } catch {
        setPkgExamples(prev => ({ ...prev, [name]: [] }))
      }
    }
  }, [libsDir])

  // ── Trigger loads when installed list changes ─────────────────────────────
  useEffect(() => {
    const currentNames = new Set(installedPkgs.map(p => p.name))

    for (const pkg of installedPkgs) {
      const isNewlyInstalled = !prevInstalled.current.has(pkg.name)
      // Check current pkgExamples through a functional updater trick is hard —
      // instead, always reload freshly installed packages; rely on cache key presence.
      setPkgExamples(prev => {
        const neverAttempted = !(pkg.name in prev)
        if (neverAttempted || isNewlyInstalled) {
          // kick off load asynchronously; don't block the state update
          if (isNewlyInstalled) {
            // Likely still downloading — use retry backoff
            retryLoad(pkg.name, pkg.version)
          } else {
            loadForPkg(pkg.name, pkg.version)
          }
        }
        // mark as loading immediately so the spinner shows
        if (neverAttempted) return { ...prev, [pkg.name]: null }
        return prev
      })
    }

    // Prune packages that are no longer installed
    setPkgExamples(prev => {
      const next: typeof prev = {}
      for (const k of Object.keys(prev)) {
        if (currentNames.has(k)) next[k] = prev[k]
      }
      return next
    })

    prevInstalled.current = currentNames
  }, [installedPkgs.map(p => p.name + ':' + p.installed).join(','), libsDir]) // eslint-disable-line

  const q = query.trim().toLowerCase()
  function filterExamples(exs: ExampleDef[]) {
    if (!q) return exs
    return exs.filter(ex =>
      ex.name.toLowerCase().includes(q) ||
      ex.description.toLowerCase().includes(q)
    )
  }

  const filteredBuiltin = filterExamples(BUILTIN_EXAMPLES)

  function handleOpen(ex: ExampleDef)           { setImportTarget(ex) }
  function handleImportCode(files: ExampleFile[]) {
    if (!importTarget) return
    openExample({ name: importTarget.id, files })
  }
  function handleOpenCircuit(data: Record<string, unknown>) {
    loadCircuitInSandbox(data)
  }

  const totalPkgExamples = Object.values(pkgExamples).reduce(
    (n, arr) => n + (arr?.length ?? 0), 0
  )

  return (
    <div className="flex flex-col h-full text-[var(--fg)] text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] flex-shrink-0">
        <span className="font-semibold text-[10px] uppercase tracking-widest text-[var(--fg-faint)]">
          Examples
        </span>
        <BookOpen size={12} className="text-[var(--fg-faint)]" />
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 flex-shrink-0">
        <div className="flex items-center gap-1.5 bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1">
          <Search size={10} className="text-[var(--fg-faint)] flex-shrink-0" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search examples…"
            className="flex-1 bg-transparent outline-none text-xs text-[var(--fg)] placeholder:text-[var(--fg-faint)] border-0"
          />
          {query && (
            <button onClick={() => setQuery('')} className="border-0 bg-transparent text-[var(--fg-faint)] hover:text-[var(--fg)] cursor-pointer p-0">
              <X size={9} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {filteredBuiltin.length > 0 && (
          <Section label="Built-in" icon={<Cpu size={10} />} examples={filteredBuiltin} onOpen={handleOpen} />
        )}

        {installedPkgs.map(pkg => {
          const loaded    = pkgExamples[pkg.name]
          const isLoading = loaded === null || !(pkg.name in pkgExamples)
          const examples  = filterExamples(loaded ?? [])
          if (!isLoading && q && examples.length === 0) return null
          return (
            <Section
              key={pkg.name}
              label={pkg.name}
              icon={<Package size={10} />}
              examples={examples}
              loading={isLoading}
              onOpen={handleOpen}
              onRefresh={() => loadForPkg(pkg.name, pkg.version)}
            />
          )
        })}

        {installedPkgs.length === 0 && filteredBuiltin.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--fg-faint)]">
            <BookOpen size={20} /><span className="text-xs">No examples found</span>
          </div>
        )}

        {installedPkgs.length === 0 && !q && (
          <div className="px-3 py-3 mt-1 mx-2 rounded border border-dashed border-[var(--border)] text-[10px] text-[var(--fg-faint)] text-center leading-relaxed">
            Install packages from the{' '}
            <span className="text-[var(--fg-muted)] font-medium">Packages</span>
            {' '}panel to see their examples here.
          </div>
        )}
      </div>

      {/* Footer legend */}
      <div className="px-3 py-2 border-t border-[var(--border)] flex-shrink-0 flex items-center gap-3 text-[9px] text-[var(--fg-faint)]">
        <span className="flex items-center gap-1"><CircuitBoard size={9} /> has circuit</span>
        <span className="ml-auto">{BUILTIN_EXAMPLES.length} built-in · {totalPkgExamples} from pkgs</span>
      </div>

      {importTarget && (
        <ImportModal
          example={importTarget}
          onClose={() => setImportTarget(null)}
          onImportCode={handleImportCode}
          onOpenCircuit={handleOpenCircuit}
        />
      )}
    </div>
  )
}