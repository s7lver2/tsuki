// ─────────────────────────────────────────────────────────────────────────────
//  pages/ArduinoPkg.tsx
//  "arduino package" — complete reference for the built-in arduino import
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { H2, H3, P, UL, LI, Divider, InlineCode, Note, Badge, CodeBlock, Table } from '../DocsPrimitives'
import { Tabs, PropTable } from '../DocsComponents'
import { LiveCompilerBlock } from '../components/LiveCompilerBlock'

// ── Category selector ─────────────────────────────────────────────────────────

const CATEGORIES = ['GPIO', 'Timing', 'Serial', 'Analog / PWM', 'Interrupts', 'Misc'] as const
type Category = typeof CATEGORIES[number]

// ── Function reference data ───────────────────────────────────────────────────

const FN_ROWS: Record<Category, { name: string; sig: string; desc: string }[]> = {
  'GPIO': [
    { name: 'PinMode',       sig: 'PinMode(pin int, mode int)',                   desc: 'Set pin direction. mode is OUTPUT, INPUT, or INPUT_PULLUP.' },
    { name: 'DigitalWrite',  sig: 'DigitalWrite(pin int, value int)',              desc: 'Write HIGH (1) or LOW (0) to a digital pin.' },
    { name: 'DigitalRead',   sig: 'DigitalRead(pin int) int',                      desc: 'Read the digital state of a pin. Returns HIGH or LOW.' },
  ],
  'Timing': [
    { name: 'Delay',         sig: 'Delay(ms int)',                                 desc: 'Pause execution for ms milliseconds. Blocks the CPU.' },
    { name: 'DelayMicros',   sig: 'DelayMicros(us int)',                           desc: 'Pause execution for us microseconds.' },
    { name: 'Millis',        sig: 'Millis() uint32',                               desc: 'Milliseconds since last reset. Overflows after ~49 days.' },
    { name: 'Micros',        sig: 'Micros() uint32',                               desc: 'Microseconds since last reset. Overflows after ~70 min.' },
  ],
  'Serial': [
    { name: 'Serial.Begin',  sig: 'Serial.Begin(baud int)',                        desc: 'Initialize serial at baud rate. Call once in setup().' },
    { name: 'Serial.Print',  sig: 'Serial.Print(v any)',                           desc: 'Print a value without a newline.' },
    { name: 'Serial.Println',sig: 'Serial.Println(v any)',                         desc: 'Print a value followed by \\r\\n.' },
    { name: 'Serial.Printf', sig: 'Serial.Printf(fmt string, args ...any)',        desc: 'Formatted print (subset of fmt verbs).' },
    { name: 'Serial.Available', sig: 'Serial.Available() int',                    desc: 'Number of bytes available to read.' },
    { name: 'Serial.Read',   sig: 'Serial.Read() int',                            desc: 'Read one byte from the serial buffer. Returns -1 if empty.' },
    { name: 'Serial.ReadString', sig: 'Serial.ReadString(term byte) string',      desc: 'Read until terminator byte or timeout.' },
    { name: 'Serial.Flush',  sig: 'Serial.Flush()',                                desc: 'Wait for TX buffer to empty.' },
  ],
  'Analog / PWM': [
    { name: 'AnalogRead',    sig: 'AnalogRead(pin int) int',                       desc: 'Read 10-bit ADC value (0–1023) from an analog pin.' },
    { name: 'AnalogWrite',   sig: 'AnalogWrite(pin int, value uint8)',              desc: 'Write PWM duty cycle (0–255) to a PWM-capable pin.' },
    { name: 'AnalogRef',     sig: 'AnalogRef(ref int)',                             desc: 'Set ADC reference: DEFAULT, INTERNAL, or EXTERNAL.' },
  ],
  'Interrupts': [
    { name: 'AttachInterrupt', sig: 'AttachInterrupt(interrupt int, fn func(), mode int)', desc: 'Attach ISR to an interrupt pin. mode: RISING, FALLING, CHANGE, LOW.' },
    { name: 'DetachInterrupt', sig: 'DetachInterrupt(interrupt int)',              desc: 'Remove ISR from interrupt pin.' },
    { name: 'Interrupts',    sig: 'Interrupts()',                                  desc: 'Re-enable global interrupts (sei).' },
    { name: 'NoInterrupts',  sig: 'NoInterrupts()',                                desc: 'Disable global interrupts (cli). Keep critical sections short.' },
  ],
  'Misc': [
    { name: 'Tone',          sig: 'Tone(pin int, freq uint)',                      desc: 'Generate a square wave of frequency freq Hz on pin.' },
    { name: 'NoTone',        sig: 'NoTone(pin int)',                               desc: 'Stop tone generation on pin.' },
    { name: 'ShiftOut',      sig: 'ShiftOut(data int, clock int, order int, val uint8)', desc: 'Shift out byte bit-by-bit. order: MSBFIRST or LSBFIRST.' },
    { name: 'ShiftIn',       sig: 'ShiftIn(data int, clock int, order int) uint8', desc: 'Shift in byte bit-by-bit.' },
    { name: 'PulseIn',       sig: 'PulseIn(pin int, state int) uint32',           desc: 'Measure pulse length in microseconds on a pin.' },
    { name: 'Map',           sig: 'Map(val, inMin, inMax, outMin, outMax int) int', desc: 'Re-map a number from one range to another.' },
    { name: 'Constrain',     sig: 'Constrain(val, lo, hi int) int',               desc: 'Clamp val to [lo, hi].' },
    { name: 'Abs',           sig: 'Abs(val int) int',                             desc: 'Absolute value (integer).' },
    { name: 'Min',           sig: 'Min(a, b int) int',                            desc: 'Return the smaller of a and b.' },
    { name: 'Max',           sig: 'Max(a, b int) int',                            desc: 'Return the larger of a and b.' },
    { name: 'Random',        sig: 'Random(max int) int32',                        desc: 'Return a random integer in [0, max).' },
    { name: 'RandomSeed',    sig: 'RandomSeed(seed uint32)',                      desc: 'Seed the RNG. Use AnalogRead(unconnected pin) for entropy.' },
  ],
}

function FnRef() {
  const [cat, setCat] = useState<Category>('GPIO')
  const rows = FN_ROWS[cat]

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
      {/* Category tabs */}
      <div style={{ display: 'flex', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
        {CATEGORIES.map(c => (
          <button
            key={c}
            onClick={() => setCat(c)}
            style={{
              border: 'none', borderBottom: `2px solid ${c === cat ? 'var(--fg-muted)' : 'transparent'}`,
              background: 'transparent',
              color: c === cat ? 'var(--fg)' : 'var(--fg-faint)',
              padding: '6px 12px', fontSize: 10, fontFamily: 'var(--font-mono)',
              fontWeight: c === cat ? 600 : 400,
              cursor: 'pointer', transition: 'all 0.1s', flexShrink: 0,
            }}
          >{c}</button>
        ))}
      </div>

      {/* Rows */}
      {rows.map((row, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '200px 1fr',
          borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none',
          background: i % 2 === 0 ? 'transparent' : 'var(--surface-1)',
        }}>
          <div style={{ padding: '8px 10px', borderRight: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>{row.name}</div>
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--fg-faint)', marginTop: 2, wordBreak: 'break-all' }}>{row.sig}</div>
          </div>
          <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)', lineHeight: 1.55, display: 'flex', alignItems: 'center' }}>
            {row.desc}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Live examples ─────────────────────────────────────────────────────────────

const GPIO_CODE = `package main

import "arduino"

const buttonPin = 2
const ledPin    = 13

func setup() {
    // Set pin modes before using them
    arduino.PinMode(ledPin,    arduino.OUTPUT)
    arduino.PinMode(buttonPin, arduino.INPUT_PULLUP)

    arduino.Serial.Begin(9600)
    arduino.Serial.Println("ready")
}

func loop() {
    // INPUT_PULLUP means the pin reads LOW when pressed
    state := arduino.DigitalRead(buttonPin)

    if state == arduino.LOW {
        arduino.DigitalWrite(ledPin, arduino.HIGH)
        arduino.Serial.Println("button pressed")
    } else {
        arduino.DigitalWrite(ledPin, arduino.LOW)
    }

    arduino.Delay(50) // debounce
}`

const TIMING_CODE = `package main

import "arduino"

var lastBlink uint32 = 0
var ledState  int    = arduino.LOW

// Non-blocking blink — loop() never sleeps
func setup() {
    arduino.PinMode(13, arduino.OUTPUT)
    arduino.Serial.Begin(9600)
}

func loop() {
    now := arduino.Millis()

    // Toggle LED every 500 ms without blocking
    if now-lastBlink >= 500 {
        lastBlink = now
        if ledState == arduino.LOW {
            ledState = arduino.HIGH
        } else {
            ledState = arduino.LOW
        }
        arduino.DigitalWrite(13, ledState)
    }

    // Do other work here — nothing is blocked
    arduino.Serial.Println(now)
    arduino.Delay(100)
}`

const SERIAL_CODE = `package main

import "arduino"

func setup() {
    arduino.Serial.Begin(115200)
    arduino.Serial.Println("tsuki serial demo")
    arduino.Serial.Println("=================")
}

func loop() {
    // Read all available bytes
    for arduino.Serial.Available() > 0 {
        ch := arduino.Serial.Read()
        // Echo back what was received
        arduino.Serial.Print(ch)
    }

    // Print sensor reading every second
    val := arduino.AnalogRead(0)
    volts := float32(val) * 5.0 / 1023.0

    arduino.Serial.Print("A0 = ")
    arduino.Serial.Print(val)
    arduino.Serial.Print("  (")
    arduino.Serial.Print(volts)
    arduino.Serial.Println(" V)")

    arduino.Delay(1000)
}`

const TABS = [
  { label: 'GPIO',   content: <LiveCompilerBlock initialCode={GPIO_CODE}   board="uno" filename="gpio.go"   /> },
  { label: 'Timing', content: <LiveCompilerBlock initialCode={TIMING_CODE} board="uno" filename="timing.go" /> },
  { label: 'Serial', content: <LiveCompilerBlock initialCode={SERIAL_CODE} board="uno" filename="serial.go" /> },
]

// ── Constants ─────────────────────────────────────────────────────────────────

const CONST_ROWS: string[][] = [
  ['HIGH',          '1',  'Digital HIGH state'],
  ['LOW',           '0',  'Digital LOW state'],
  ['OUTPUT',        '1',  'pinMode — set pin as output'],
  ['INPUT',         '0',  'pinMode — set pin as floating input'],
  ['INPUT_PULLUP',  '2',  'pinMode — set pin as input with internal pull-up'],
  ['RISING',        '3',  'attachInterrupt — trigger on rising edge'],
  ['FALLING',       '2',  'attachInterrupt — trigger on falling edge'],
  ['CHANGE',        '1',  'attachInterrupt — trigger on any edge'],
  ['MSBFIRST',      '1',  'shiftOut/In — MSB first'],
  ['LSBFIRST',      '0',  'shiftOut/In — LSB first'],
  ['DEFAULT',       '1',  'analogReference — default (Vcc)'],
  ['INTERNAL',      '3',  'analogReference — 1.1 V internal (AVR)'],
  ['EXTERNAL',      '0',  'analogReference — AREF pin'],
  ['LED_BUILTIN',   '13', 'Built-in LED pin (Uno / Nano)'],
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ArduinoPkgPage() {
  return (
    <div>
      <P>
        The <InlineCode>arduino</InlineCode> package is built into tsuki — no{' '}
        <InlineCode>tsuki pkg install</InlineCode> required. It exposes the complete
        Arduino API as a Go package: GPIO, timing, serial, analog I/O, interrupts, and utilities.
      </P>

      <CodeBlock lang="go" filename="import">
{`import "arduino"

// All functions are called as arduino.FunctionName(...)
// Constants are arduino.HIGH, arduino.LOW, arduino.OUTPUT, etc.`}
      </CodeBlock>

      {/* ── Constants ──────────────────────────────────────────────────── */}
      <Divider />
      <H2>Constants</H2>
      <Table cols={['Constant', 'Value', 'Use']} rows={CONST_ROWS} />

      {/* ── API Reference ──────────────────────────────────────────────── */}
      <Divider />
      <H2>Function reference</H2>
      <P>Select a category to browse the full API.</P>
      <FnRef />

      {/* ── Examples ────────────────────────────────────────────────────── */}
      <Divider />
      <H2>Live examples</H2>
      <P>
        Each tab shows a real sketch. Click{' '}
        <strong style={{ color: 'var(--fg)' }}>▶ compile</strong> to transpile it with{' '}
        <InlineCode>tsuki-core</InlineCode> and inspect the generated C++.
      </P>
      <Tabs tabs={TABS} />

      {/* ── Serial detail ────────────────────────────────────────────────── */}
      <Divider />
      <H2>Serial in detail</H2>
      <P>
        <InlineCode>arduino.Serial</InlineCode> maps to the hardware UART on pins D0 (RX) and D1 (TX).
        Common baud rates: <InlineCode>9600</InlineCode>, <InlineCode>57600</InlineCode>,{' '}
        <InlineCode>115200</InlineCode>. Always call <InlineCode>Serial.Begin</InlineCode>{' '}
        in <InlineCode>setup()</InlineCode> before using it.
      </P>

      <Note kind="warn">
        Pins D0 and D1 are shared with the USB-to-serial chip on the Uno. If you use them
        as GPIO while the Serial Monitor is open, data corruption can occur. Disconnect the
        Serial Monitor before using D0/D1 for other purposes.
      </Note>

      <CodeBlock lang="go" filename="serial_read.go">
{`package main

import "arduino"

var buf string = ""

func setup() {
    arduino.Serial.Begin(9600)
}

func loop() {
    // Accumulate incoming bytes into a string
    for arduino.Serial.Available() > 0 {
        ch := byte(arduino.Serial.Read())
        if ch == '\n' {
            arduino.Serial.Print("received: ")
            arduino.Serial.Println(buf)
            buf = ""
        } else {
            buf += string(ch)
        }
    }
}`}
      </CodeBlock>

      {/* ── Non-blocking pattern ─────────────────────────────────────────── */}
      <Divider />
      <H2>Non-blocking patterns with Millis()</H2>
      <P>
        <InlineCode>arduino.Delay()</InlineCode> blocks the CPU for the entire duration —
        nothing else runs. For tasks that need concurrent timing (blink + read sensor +
        update display), use <InlineCode>arduino.Millis()</InlineCode> instead.
      </P>

      <LiveCompilerBlock initialCode={TIMING_CODE} board="uno" filename="millis_pattern.go" />

      <Note kind="tip">
        This "millis pattern" is the Arduino equivalent of async/concurrent code. Track a{' '}
        <InlineCode>lastRun uint32</InlineCode> per task and check{' '}
        <InlineCode>millis() - lastRun {'>'}= interval</InlineCode> at the top of loop().
      </Note>
    </div>
  )
}