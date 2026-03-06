// ─────────────────────────────────────────────────────────────────────────────
//  pages/PinsGpio.tsx
//  "Pins & GPIO" — digital I/O, analog, PWM, pull-ups, interrupts
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { H2, H3, P, UL, LI, Divider, InlineCode, Note, Badge, CodeBlock, Table } from '../DocsPrimitives'
import { Tabs } from '../DocsComponents'
import { LiveCompilerBlock } from '../components/LiveCompilerBlock'

// ── Interactive pin mode visualizer ──────────────────────────────────────────

type PinMode = 'OUTPUT' | 'INPUT' | 'INPUT_PULLUP'

interface PinScenario {
  mode: PinMode
  state: 'HIGH' | 'LOW'
  desc: string
}

const SCENARIOS: PinScenario[] = [
  { mode: 'OUTPUT',       state: 'HIGH',  desc: 'Pin drives 5 V out — current flows from pin to GND through the load.' },
  { mode: 'OUTPUT',       state: 'LOW',   desc: 'Pin drives 0 V out — current flows from 5 V through the load into the pin.' },
  { mode: 'INPUT',        state: 'HIGH',  desc: 'Pin floating or connected to 5 V — reads HIGH. Floating pins are noisy; use a pull resistor.' },
  { mode: 'INPUT',        state: 'LOW',   desc: 'Pin connected to GND — reads LOW. Without a pull resistor the reading is unreliable when disconnected.' },
  { mode: 'INPUT_PULLUP', state: 'HIGH',  desc: 'Pin floating or not pressed — internal 20–50 kΩ pull-up holds it HIGH. This is the default unpressed state for buttons.' },
  { mode: 'INPUT_PULLUP', state: 'LOW',   desc: 'Button connects pin to GND — reads LOW. Logic is inverted: LOW = pressed.' },
]

function PinVisualizer() {
  const [active, setActive] = useState(0)
  const s = SCENARIOS[active]

  const modeColor: Record<PinMode, string> = {
    OUTPUT:       'var(--fg-muted)',
    INPUT:        'var(--fg-muted)',
    INPUT_PULLUP: 'var(--fg-muted)',
  }
  const stateColor = s.state === 'HIGH' ? 'var(--ok)' : 'var(--fg-faint)'

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
      <div style={{ padding: '5px 10px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--fg-faint)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        pin mode visualizer — select a scenario
      </div>

      {/* Scenario buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface-1)' }}>
        {SCENARIOS.map((sc, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            style={{
              border: `1px solid ${i === active ? 'var(--fg-muted)' : 'var(--border)'}`,
              background: i === active ? 'var(--surface-3)' : 'transparent',
              color: i === active ? 'var(--fg)' : 'var(--fg-faint)',
              borderRadius: 4, padding: '3px 9px',
              fontSize: 10, fontFamily: 'var(--font-mono)',
              cursor: 'pointer', transition: 'all 0.1s',
            }}
          >
            {sc.mode} / {sc.state}
          </button>
        ))}
      </div>

      {/* Diagram */}
      <div style={{ padding: '16px 20px', background: 'var(--surface-1)', display: 'flex', alignItems: 'center', gap: 20 }}>
        <svg viewBox="0 0 200 80" style={{ width: 200, flexShrink: 0 }}>
          {/* Arduino chip box */}
          <rect x="5" y="20" width="60" height="40" rx="4" fill="var(--surface-3)" stroke="var(--border)" strokeWidth="1" />
          <text x="35" y="37" textAnchor="middle" fontSize="6" fill="var(--fg-faint)" fontFamily="monospace">Arduino</text>
          <text x="35" y="47" textAnchor="middle" fontSize="5" fill="var(--fg-faint)" fontFamily="monospace">pin D{'{n}'}</text>

          {/* Pin wire out */}
          <line x1="65" y1="40" x2="95" y2="40" stroke={stateColor} strokeWidth="1.5" />

          {/* Pull-up resistor for INPUT_PULLUP */}
          {s.mode === 'INPUT_PULLUP' && (
            <g>
              <line x1="95" y1="10" x2="95" y2="28" stroke="var(--fg-faint)" strokeWidth="1" />
              <rect x="88" y="28" width="14" height="8" rx="2" fill="none" stroke="var(--fg-faint)" strokeWidth="1" />
              <line x1="95" y1="36" x2="95" y2="40" stroke="var(--fg-faint)" strokeWidth="1" />
              <text x="112" y="33" fontSize="5.5" fill="var(--fg-faint)" fontFamily="monospace">~40kΩ</text>
              <text x="112" y="14" fontSize="5.5" fill="var(--fg-faint)" fontFamily="monospace">Vcc</text>
              <line x1="90" y1="10" x2="100" y2="10" stroke="var(--fg-faint)" strokeWidth="1" />
            </g>
          )}

          {/* Load / button */}
          {s.mode === 'OUTPUT' ? (
            <g>
              {/* LED symbol */}
              <circle cx="115" cy="40" r="8" fill="none" stroke={stateColor} strokeWidth="1" />
              <line x1="115" y1="32" x2="115" y2="48" stroke={stateColor} strokeWidth="1" />
              <text x="115" y="62" textAnchor="middle" fontSize="5.5" fill="var(--fg-faint)" fontFamily="monospace">LED</text>
              <line x1="123" y1="40" x2="155" y2="40" stroke={s.state === 'HIGH' ? stateColor : 'var(--border)'} strokeWidth="1.5" />
              <text x="165" y="43" fontSize="5.5" fill="var(--fg-faint)" fontFamily="monospace">GND</text>
              <line x1="155" y1="36" x2="175" y2="36" stroke="var(--fg-faint)" strokeWidth="1" />
              <line x1="155" y1="44" x2="175" y2="44" stroke="var(--fg-faint)" strokeWidth="1" />
              <line x1="165" y1="36" x2="165" y2="44" stroke="var(--fg-faint)" strokeWidth="1" />
            </g>
          ) : (
            <g>
              {/* Button symbol */}
              <circle cx="115" cy="40" r="7" fill="none" stroke={s.state === 'LOW' ? 'var(--fg-muted)' : 'var(--border)'} strokeWidth="1" />
              <text x="115" y="62" textAnchor="middle" fontSize="5.5" fill="var(--fg-faint)" fontFamily="monospace">BTN</text>
              {s.state === 'LOW' ? (
                <line x1="108" y1="40" x2="122" y2="40" stroke="var(--fg-muted)" strokeWidth="1.5" />
              ) : (
                <line x1="108" y1="37" x2="122" y2="43" stroke="var(--fg-faint)" strokeWidth="1" strokeDasharray="2,1" />
              )}
              <line x1="122" y1="40" x2="155" y2="40" stroke={s.state === 'LOW' ? 'var(--fg-muted)' : 'var(--border)'} strokeWidth="1.5" />
              <text x="165" y="43" fontSize="5.5" fill="var(--fg-faint)" fontFamily="monospace">GND</text>
              <line x1="155" y1="36" x2="175" y2="36" stroke="var(--fg-faint)" strokeWidth="1" />
              <line x1="155" y1="44" x2="175" y2="44" stroke="var(--fg-faint)" strokeWidth="1" />
              <line x1="165" y1="36" x2="165" y2="44" stroke="var(--fg-faint)" strokeWidth="1" />
            </g>
          )}

          {/* State label on pin */}
          <text x="80" y="35" textAnchor="middle" fontSize="6" fill={stateColor} fontFamily="monospace" fontWeight="bold">{s.state}</text>
        </svg>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <span style={{
              fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
              background: 'var(--surface-3)', border: '1px solid var(--border)',
              borderRadius: 3, padding: '1px 6px', color: 'var(--fg)',
            }}>{s.mode}</span>
            <span style={{
              fontSize: 10, fontFamily: 'var(--font-mono)',
              color: stateColor,
            }}>→ reads {s.state}</span>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.65, fontFamily: 'var(--font-sans)' }}>
            {s.desc}
          </p>
        </div>
      </div>

      {/* Code snippet */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px', background: 'var(--surface-2)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>
        <span style={{ color: 'var(--syn-kw)' }}>arduino</span>
        <span style={{ color: 'var(--syn-op)' }}>.</span>
        <span style={{ color: 'var(--syn-fn)' }}>PinMode</span>
        <span style={{ color: 'var(--syn-op)' }}>(pin, </span>
        <span style={{ color: 'var(--syn-kw)' }}>arduino</span>
        <span style={{ color: 'var(--syn-op)' }}>.</span>
        <span style={{ color: 'var(--fg)' }}>{s.mode}</span>
        <span style={{ color: 'var(--syn-op)' }}>)</span>
      </div>
    </div>
  )
}

// ── PWM frequency table ───────────────────────────────────────────────────────

const PWM_ROWS: string[][] = [
  ['Arduino Uno / Nano', 'D3, D5, D6, D9, D10, D11',   '490 Hz (D5/D6: 980 Hz)'],
  ['Arduino Mega',       'D2–D13, D44–D46',              '490 Hz (D4/D13: 980 Hz)'],
  ['ESP8266 (D1 Mini)',  'D1–D8 (except D0)',            '1 kHz (software, adjustable)'],
  ['ESP32',             'Most GPIO',                     'LEDC, 0–40 MHz, configurable'],
  ['Raspberry Pi Pico', 'All GPIO',                     'Hardware PWM, up to 125 MHz'],
]

// ── Live examples ─────────────────────────────────────────────────────────────

const DIGITAL_CODE = `package main

import "arduino"

const led    = 13
const button = 2

func setup() {
    arduino.PinMode(led,    arduino.OUTPUT)
    // INPUT_PULLUP = no external resistor needed
    // LOW when button pressed, HIGH when released
    arduino.PinMode(button, arduino.INPUT_PULLUP)
    arduino.Serial.Begin(9600)
}

func loop() {
    if arduino.DigitalRead(button) == arduino.LOW {
        arduino.DigitalWrite(led, arduino.HIGH)
        arduino.Serial.Println("pressed")
    } else {
        arduino.DigitalWrite(led, arduino.LOW)
    }
    arduino.Delay(20)
}`

const ANALOG_CODE = `package main

import "arduino"

func setup() {
    arduino.PinMode(9, arduino.OUTPUT)
    arduino.Serial.Begin(9600)
}

func loop() {
    // Read potentiometer (0–1023)
    raw := arduino.AnalogRead(0)

    // Map to PWM range (0–255)
    brightness := arduino.Map(raw, 0, 1023, 0, 255)

    // Write PWM — dims the LED
    arduino.AnalogWrite(9, uint8(brightness))

    // Print voltage
    volts := float32(raw) * 5.0 / 1023.0
    arduino.Serial.Print(volts)
    arduino.Serial.Println(" V")

    arduino.Delay(50)
}`

const INTERRUPT_CODE = `package main

import "arduino"

var count uint32 = 0

// ISR — called automatically on RISING edge of D2
// Keep it short: no delays, no serial, minimal logic
func onPulse() {
    count++
}

func setup() {
    arduino.PinMode(13, arduino.OUTPUT)
    arduino.Serial.Begin(9600)

    // INT0 = interrupt 0 = pin D2 on Uno
    arduino.AttachInterrupt(0, onPulse, arduino.RISING)
}

func loop() {
    // Print pulse count every second
    arduino.NoInterrupts()
    snapshot := count
    arduino.Interrupts()

    arduino.Serial.Println(snapshot)
    arduino.DigitalWrite(13, snapshot%2 == 0)
    arduino.Delay(1000)
}`

const PULSE_CODE = `package main

import "arduino"

// Measure distance with HC-SR04 ultrasonic sensor
// Trig = D9, Echo = D10

const trigPin = 9
const echoPin = 10

func setup() {
    arduino.PinMode(trigPin, arduino.OUTPUT)
    arduino.PinMode(echoPin, arduino.INPUT)
    arduino.Serial.Begin(9600)
}

func triggerPulse() {
    arduino.DigitalWrite(trigPin, arduino.LOW)
    arduino.DelayMicros(2)
    arduino.DigitalWrite(trigPin, arduino.HIGH)
    arduino.DelayMicros(10)
    arduino.DigitalWrite(trigPin, arduino.LOW)
}

func loop() {
    triggerPulse()

    // PulseIn waits for echo pin to go HIGH, measures pulse length
    duration := arduino.PulseIn(echoPin, arduino.HIGH)

    // Distance = (duration / 2) / 29.1  (cm)
    cm := float32(duration) / 58.2

    arduino.Serial.Print(cm)
    arduino.Serial.Println(" cm")
    arduino.Delay(200)
}`

const TABS = [
  { label: 'Digital I/O',  content: <LiveCompilerBlock initialCode={DIGITAL_CODE}    board="uno" filename="digital.go"    /> },
  { label: 'Analog / PWM', content: <LiveCompilerBlock initialCode={ANALOG_CODE}     board="uno" filename="analog.go"     /> },
  { label: 'Interrupts',   content: <LiveCompilerBlock initialCode={INTERRUPT_CODE}  board="uno" filename="interrupt.go"  /> },
  { label: 'PulseIn',      content: <LiveCompilerBlock initialCode={PULSE_CODE}      board="uno" filename="pulsein.go"    /> },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PinsGpioPage() {
  return (
    <div>
      <P>
        Pins are the physical connection points between the microcontroller and the outside world.
        tsuki exposes the complete Arduino GPIO API through the <InlineCode>arduino</InlineCode>{' '}
        package: digital I/O, analog input, PWM output, pull-up resistors, and hardware interrupts.
      </P>

      {/* ── Pin modes ────────────────────────────────────────────────────── */}
      <H2>Pin modes</H2>
      <P>
        Before using a pin, set its direction with <InlineCode>arduino.PinMode()</InlineCode>.
        Select a scenario below to see what each mode means electrically.
      </P>
      <PinVisualizer />

      <Table
        cols={['Mode', 'C++ constant', 'Direction', 'When to use']}
        rows={[
          ['arduino.OUTPUT',       'OUTPUT',       'Out',  'Driving LEDs, relays, transistors, servo signals'],
          ['arduino.INPUT',        'INPUT',         'In',   'Reading sensors — add external pull-up or pull-down resistor'],
          ['arduino.INPUT_PULLUP', 'INPUT_PULLUP',  'In',   'Buttons wired to GND — no external resistor needed, logic inverted'],
        ]}
      />

      {/* ── Digital ──────────────────────────────────────────────────────── */}
      <Divider />
      <H2>Digital I/O</H2>
      <P>
        <InlineCode>DigitalWrite</InlineCode> drives a pin to 5 V (HIGH) or 0 V (LOW).
        <InlineCode>DigitalRead</InlineCode> returns <InlineCode>arduino.HIGH</InlineCode>{' '}
        or <InlineCode>arduino.LOW</InlineCode>.
        Both operate on any numbered pin — analog pins A0–A5 can be used as digital I/O too.
      </P>

      <Note kind="warn">
        Always call <InlineCode>PinMode</InlineCode> before <InlineCode>DigitalWrite</InlineCode>.
        Writing to a pin configured as INPUT will enable or disable its pull-up resistor, not drive the pin.
      </Note>

      {/* ── Analog ───────────────────────────────────────────────────────── */}
      <Divider />
      <H2>Analog input</H2>
      <P>
        <InlineCode>arduino.AnalogRead(pin)</InlineCode> returns an integer 0–1023 representing
        the voltage on the pin relative to the reference voltage. On the Uno the default reference
        is 5 V, so the full-scale reading of 1023 equals 5 V.
      </P>

      <CodeBlock lang="go" filename="analog_voltage.go">
{`val   := arduino.AnalogRead(0)            // 0–1023
volts := float32(val) * 5.0 / 1023.0      // 0.0–5.0 V

// Map to 0–100% for display
pct := arduino.Map(val, 0, 1023, 0, 100)  // integer`}
      </CodeBlock>

      <Note kind="info">
        Analog pins on the Uno (A0–A5) can also be used as digital I/O. Refer to them by their
        analog number for <InlineCode>AnalogRead</InlineCode> and by their digital number (A0 = D14,
        A1 = D15…) for <InlineCode>DigitalWrite</InlineCode>.
      </Note>

      {/* ── PWM ──────────────────────────────────────────────────────────── */}
      <Divider />
      <H2>PWM output</H2>
      <P>
        <InlineCode>arduino.AnalogWrite(pin, value)</InlineCode> generates a PWM signal with a
        duty cycle of <InlineCode>value/255</InlineCode> (0 = always off, 255 = always on). This
        is how tsuki dims LEDs, controls motor speed, or generates audio tones.
        Only certain pins support PWM — see the table below.
      </P>

      <Table
        cols={['Board', 'PWM pins', 'Frequency']}
        rows={PWM_ROWS}
      />

      <Note kind="tip">
        <InlineCode>AnalogWrite</InlineCode> does not output an actual analog voltage — it
        pulses at a fixed frequency. The apparent voltage is the average. Use a low-pass filter
        (resistor + capacitor) to convert PWM to a true DC voltage.
      </Note>

      {/* ── Interrupts ───────────────────────────────────────────────────── */}
      <Divider />
      <H2>Hardware interrupts</H2>
      <P>
        Interrupts let you react to pin changes instantly, without polling in <InlineCode>loop()</InlineCode>.
        The ISR (interrupt service routine) is a Go function that runs automatically when the
        configured edge is detected.
      </P>

      <Table
        cols={['Board', 'INT0 pin', 'INT1 pin', 'Notes']}
        rows={[
          ['Arduino Uno',   'D2', 'D3',  '2 external interrupts'],
          ['Arduino Mega',  'D2', 'D3',  'INT0–INT5 on D2, D3, D18–D21'],
          ['Arduino Nano',  'D2', 'D3',  'same as Uno'],
          ['ESP8266 D1 Mini','Any GPIO', '—', 'All pins support interrupts'],
          ['ESP32',         'Any GPIO', '—', 'All pins support interrupts'],
        ]}
      />

      <Note kind="warn">
        Keep ISRs as short as possible. Do not use <InlineCode>Delay()</InlineCode>,{' '}
        <InlineCode>Serial.Print()</InlineCode>, or call <InlineCode>Millis()</InlineCode>{' '}
        inside an ISR. Use a volatile flag or counter and handle the work in <InlineCode>loop()</InlineCode>.
      </Note>

      {/* ── Live examples ────────────────────────────────────────────────── */}
      <Divider />
      <H2>Live examples</H2>
      <Tabs tabs={TABS} />

      {/* ── Utility functions ────────────────────────────────────────────── */}
      <Divider />
      <H2>Utility functions</H2>
      <P>
        The <InlineCode>arduino</InlineCode> package also includes math helpers that operate on
        integers — useful for sensor scaling without floating point:
      </P>
      <CodeBlock lang="go" filename="utils.go">
{`raw := arduino.AnalogRead(0)    // 0–1023

// Map one range to another (integer)
pct := arduino.Map(raw, 0, 1023, 0, 100)

// Clamp a value
safe := arduino.Constrain(pct, 10, 90)

// Min / max
hi := arduino.Max(raw, 512)
lo := arduino.Min(raw, 512)

// Absolute value
diff := arduino.Abs(raw - 512)`}
      </CodeBlock>
    </div>
  )
}