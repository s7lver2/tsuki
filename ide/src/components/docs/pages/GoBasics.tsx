// ─────────────────────────────────────────────────────────────────────────────
//  pages/GoBasics.tsx
//  "Go Basics" — Go syntax primer for embedded development with tsuki
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { H2, H3, P, UL, LI, Divider, InlineCode, Note, Badge, CodeBlock, Table } from '../DocsPrimitives'
import { Tabs, PropTable } from '../DocsComponents'
import { LiveCompilerBlock } from '../components/LiveCompilerBlock'

// ── Supported subset table ────────────────────────────────────────────────────

const SUBSET: [string, 'ok' | 'warn' | 'muted', string][] = [
  ['var / := declarations',      'ok',   '✓ full support'],
  ['const declarations',         'ok',   '✓ full support'],
  ['func (incl. methods)',        'ok',   '✓ full support'],
  ['struct + type aliases',       'ok',   '✓ full support'],
  ['if / else',                  'ok',   '✓ full support'],
  ['for / for range',            'ok',   '✓ full support'],
  ['switch / case',              'ok',   '✓ full support'],
  ['Arrays & slices (stack)',     'ok',   '✓ full support'],
  ['import / package calls',     'ok',   '✓ full support'],
  ['Pointers (basic)',           'ok',   '✓ full support'],
  ['Interfaces (simple)',        'ok',   '✓ full support'],
  ['defer',                      'warn', '~ compiled to inline'],
  ['go (goroutines)',            'warn', '~ compiled to comment'],
  ['chan (channels)',            'muted','✗ not supported'],
  ['map (heap)',                 'muted','✗ not supported'],
  ['Garbage collector',         'muted','✗ not available'],
  ['Generics',                  'muted','✗ not supported'],
  ['Reflection',                'muted','✗ not supported'],
]

function SubsetTable() {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto auto',
        padding: '5px 10px', background: 'var(--surface-2)',
        borderBottom: '1px solid var(--border)',
        fontSize: 9, fontWeight: 600, color: 'var(--fg-faint)',
        letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)',
      }}>
        <span>feature</span>
        <span>status</span>
      </div>
      {SUBSET.map(([feat, variant, label], i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 10px',
          borderBottom: i < SUBSET.length - 1 ? '1px solid var(--border)' : 'none',
          background: i % 2 === 0 ? 'transparent' : 'var(--surface-1)',
        }}>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{feat}</span>
          <Badge variant={variant}>{label}</Badge>
        </div>
      ))}
    </div>
  )
}

// ── Type mapping table ────────────────────────────────────────────────────────

const TYPE_MAP_ROWS: string[][] = [
  ['bool',    'bool',       '1 byte'],
  ['int',     'int',        'platform (16–32 bit on AVR)'],
  ['int8',    'int8_t',     '1 byte, −128 to 127'],
  ['int16',   'int16_t',    '2 bytes'],
  ['int32',   'int32_t',    '4 bytes'],
  ['int64',   'int64_t',    '8 bytes — avoid on AVR'],
  ['uint8',   'uint8_t',    '1 byte, 0–255 (same as byte)'],
  ['uint16',  'uint16_t',   '2 bytes, 0–65535'],
  ['uint32',  'uint32_t',   '4 bytes'],
  ['float32', 'float',      '4 bytes'],
  ['float64', 'double',     '8 bytes — slow on AVR'],
  ['string',  'String',     'Arduino String class'],
  ['byte',    'uint8_t',    'alias for uint8'],
  ['rune',    'int32_t',    'alias for int32'],
]

// ── Page ──────────────────────────────────────────────────────────────────────

const VARS_CODE = `package main

import "arduino"

// Package-level variable — lives in SRAM for the lifetime of the program
var counter uint16 = 0

func setup() {
    arduino.Serial.Begin(9600)

    // Short variable declaration (:=) — type inferred
    led := 13

    // Explicit type declaration
    var brightness uint8 = 200

    arduino.PinMode(led, arduino.OUTPUT)
    arduino.AnalogWrite(led, brightness)
}

func loop() {
    counter++
    arduino.Serial.Println(counter)
    arduino.Delay(500)
}`

const FUNCS_CODE = `package main

import "arduino"

// Regular function
func blink(pin int, times int, ms int) {
    for i := 0; i < times; i++ {
        arduino.DigitalWrite(pin, arduino.HIGH)
        arduino.Delay(ms)
        arduino.DigitalWrite(pin, arduino.LOW)
        arduino.Delay(ms)
    }
}

// Function returning a value
func readVoltage(pin int) float32 {
    raw := arduino.AnalogRead(pin)
    return float32(raw) * 5.0 / 1023.0
}

func setup() {
    arduino.PinMode(13, arduino.OUTPUT)
    arduino.Serial.Begin(9600)
}

func loop() {
    blink(13, 3, 100)

    v := readVoltage(0)
    arduino.Serial.Println(v)
    arduino.Delay(1000)
}`

const STRUCTS_CODE = `package main

import "arduino"

// Struct definition
type Sensor struct {
    pin       int
    lastValue int
}

// Method with pointer receiver — modifies the struct
func (s *Sensor) Read() int {
    s.lastValue = arduino.AnalogRead(s.pin)
    return s.lastValue
}

// Method with value receiver — read-only
func (s Sensor) IsHigh() bool {
    return s.lastValue > 512
}

var temp Sensor

func setup() {
    temp = Sensor{pin: 0, lastValue: 0}
    arduino.Serial.Begin(9600)
}

func loop() {
    val := temp.Read()
    if temp.IsHigh() {
        arduino.Serial.Println("HIGH")
    } else {
        arduino.Serial.Println(val)
    }
    arduino.Delay(500)
}`

const CONTROL_CODE = `package main

import "arduino"

func setup() {
    arduino.Serial.Begin(9600)
    arduino.PinMode(13, arduino.OUTPUT)
}

func loop() {
    val := arduino.AnalogRead(0)

    // if / else if / else
    if val > 800 {
        arduino.Serial.Println("very high")
    } else if val > 400 {
        arduino.Serial.Println("medium")
    } else {
        arduino.Serial.Println("low")
    }

    // switch
    mode := val / 256
    switch mode {
    case 0:
        arduino.DigitalWrite(13, arduino.LOW)
    case 1:
        arduino.DigitalWrite(13, arduino.HIGH)
    default:
        // blink fast
    }

    // for with range over array
    pins := [3]int{9, 10, 11}
    for i, pin := range pins {
        arduino.AnalogWrite(pin, uint8(i*80))
    }

    arduino.Delay(200)
}`

const TABS_VARS = [
  { label: 'Variables',  content: <LiveCompilerBlock initialCode={VARS_CODE}    board="uno" filename="variables.go"  /> },
  { label: 'Functions',  content: <LiveCompilerBlock initialCode={FUNCS_CODE}   board="uno" filename="functions.go"  /> },
  { label: 'Structs',    content: <LiveCompilerBlock initialCode={STRUCTS_CODE} board="uno" filename="structs.go"    /> },
  { label: 'Control',    content: <LiveCompilerBlock initialCode={CONTROL_CODE} board="uno" filename="control.go"    /> },
]

export default function GoBasicsPage() {
  return (
    <div>
      <P>
        tsuki supports a practical subset of Go — everything you need for embedded development,
        minus the runtime features that require a heap or an OS. If you already know Go, you'll
        feel right at home. If you're new to Go, this page covers everything you need.
      </P>

      <Note kind="info">
        tsuki compiles Go to C++, not to machine code directly. This means every feature maps
        1-to-1 to something in C++. Features that have no C++ equivalent (channels, GC) are
        unsupported.
      </Note>

      <Divider />
      <H2>Supported language subset</H2>
      <SubsetTable />

      {/* ── Variables ─────────────────────────────────────────────────── */}
      <Divider />
      <H2>Variables & constants</H2>
      <P>
        Use <InlineCode>var</InlineCode> for package-level variables (stored in SRAM) and{' '}
        <InlineCode>:=</InlineCode> for local variables inside functions. Constants are
        evaluated at compile time and stored in flash — prefer them over variables for fixed values.
      </P>

      <CodeBlock lang="go" filename="variables.go">
{`package main

import "arduino"

// Constant — stored in flash, no SRAM cost
const ledPin = 13
const maxBrightness uint8 = 255

// Package-level var — allocated in SRAM at boot
var tick uint32 = 0

func setup() {
    // := infers the type (int here)
    pin := ledPin
    arduino.PinMode(pin, arduino.OUTPUT)
}

func loop() {
    tick++         // uint32 increment
    arduino.Delay(1)
}`}
      </CodeBlock>

      <Note kind="warn">
        On AVR boards (Uno, Nano, Mega) SRAM is tiny — 2 KB on the Uno. Avoid large
        global arrays and prefer <InlineCode>const</InlineCode> over <InlineCode>var</InlineCode>
        wherever the value doesn't change.
      </Note>

      {/* ── Types ─────────────────────────────────────────────────────── */}
      <Divider />
      <H2>Type mapping</H2>
      <P>
        Go types map directly to C++ types. The table below shows the mapping and the
        memory cost. On AVR (Uno), prefer fixed-width types like{' '}
        <InlineCode>uint8</InlineCode> and <InlineCode>int16</InlineCode> — they're more
        predictable than plain <InlineCode>int</InlineCode>.
      </P>
      <Table
        cols={['Go type', 'C++ type', 'Notes']}
        rows={TYPE_MAP_ROWS}
      />

      <Note kind="tip">
        <InlineCode>uint8</InlineCode> and <InlineCode>byte</InlineCode> are identical in tsuki —
        both map to <InlineCode>uint8_t</InlineCode>. Use whichever reads better: <InlineCode>byte</InlineCode>{' '}
        for raw data buffers, <InlineCode>uint8</InlineCode> for pin values and counters.
      </Note>

      {/* ── Functions ─────────────────────────────────────────────────── */}
      <Divider />
      <H2>Functions, structs & control flow</H2>
      <P>
        Click a tab to load an example, then hit <strong style={{ color: 'var(--fg)' }}>▶ compile</strong>{' '}
        to transpile it live and inspect the generated C++.
      </P>
      <Tabs tabs={TABS_VARS} />

      {/* ── Arrays ────────────────────────────────────────────────────── */}
      <Divider />
      <H2>Arrays & slices</H2>
      <P>
        Fixed-size arrays are fully supported and map directly to C++ arrays on the stack.
        Slices backed by a fixed array also work. Heap-allocated slices (via{' '}
        <InlineCode>make</InlineCode> or <InlineCode>append</InlineCode> beyond capacity) are
        not available — there is no allocator on bare metal.
      </P>

      <CodeBlock lang="go" filename="arrays.go">
{`package main

import "arduino"

// Fixed-size array — lives on the stack, zero-cost
var pwmPins [3]int = [3]int{9, 10, 11}
var levels  [3]uint8

func setup() {
    for i, pin := range pwmPins {
        arduino.PinMode(pin, arduino.OUTPUT)
        levels[i] = uint8(i * 80) // 0, 80, 160
    }
}

func loop() {
    for i, pin := range pwmPins {
        arduino.AnalogWrite(pin, levels[i])
    }
    arduino.Delay(20)
}`}
      </CodeBlock>

      {/* ── Packages ──────────────────────────────────────────────────── */}
      <Divider />
      <H2>Packages and imports</H2>
      <P>
        Every tsuki file starts with <InlineCode>package main</InlineCode>. Imports map to
        C++ headers and runtime bindings. Built-in packages need no installation; community
        packages are installed via <InlineCode>tsuki pkg install</InlineCode>.
      </P>

      <Table
        cols={['Import', 'Maps to', 'Notes']}
        rows={[
          ['"arduino"',   '#include <Arduino.h>',   'Core GPIO, timing, Serial, I2C, SPI'],
          ['"fmt"',       'Serial.print()',          'print / println / printf'],
          ['"time"',      'delay() / millis()',      'Delay, Sleep, Now'],
          ['"math"',      '<math.h>',                'Sin, Cos, Sqrt, Pow, Abs…'],
          ['"strconv"',   'String() / .toInt()',     'Int/float ↔ string conversion'],
          ['"wire"',      'Wire.h',                  'I2C master/slave'],
          ['"spi"',       'SPI.h',                   'SPI master'],
          ['"servo"',     'Servo.h',                 'Servo motor control'],
        ]}
      />

      <Note kind="tip">
        You can alias an import with a short name: <InlineCode>import a "arduino"</InlineCode>{' '}
        lets you write <InlineCode>a.DigitalWrite(…)</InlineCode>. This is especially useful
        when mixing several packages.
      </Note>

      {/* ── Entry points ──────────────────────────────────────────────── */}
      <Divider />
      <H2>Entry points: setup() and loop()</H2>
      <P>
        Every tsuki program must define exactly two functions: <InlineCode>setup()</InlineCode>{' '}
        (called once on boot) and <InlineCode>loop()</InlineCode> (called repeatedly, forever).
        These map directly to Arduino's <InlineCode>setup()</InlineCode> and{' '}
        <InlineCode>loop()</InlineCode> in C++. There is no <InlineCode>main()</InlineCode>.
      </P>

      <CodeBlock lang="go" filename="main.go">
{`package main

import "arduino"

func setup() {
    // Runs once on power-on or reset
    arduino.PinMode(13, arduino.OUTPUT)
    arduino.Serial.Begin(9600)
    arduino.Serial.Println("booted")
}

func loop() {
    // Runs forever, as fast as the CPU allows
    // (add arduino.Delay() to throttle)
    arduino.DigitalWrite(13, arduino.HIGH)
    arduino.Delay(500)
    arduino.DigitalWrite(13, arduino.LOW)
    arduino.Delay(500)
}`}
      </CodeBlock>
    </div>
  )
}