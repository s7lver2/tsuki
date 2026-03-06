// ─────────────────────────────────────────────────────────────────────────────
//  pages/FirstProject.tsx
//  "Your First Project" doc page — Blink walkthrough end-to-end
// ─────────────────────────────────────────────────────────────────────────────

import { H2, P, UL, LI, Divider, InlineCode, Note, Step, CodeBlock } from '../DocsPrimitives'
import { Tabs } from '../DocsComponents'
import { LiveCompilerBlock } from '../components/LiveCompilerBlock'

const BLINK_CODE = `package main

import "arduino"

const ledPin        = 13
const blinkInterval = 500 // milliseconds

func setup() {
    arduino.PinMode(ledPin, arduino.OUTPUT)
    arduino.Serial.Begin(9600)
    arduino.Serial.Println("Blink ready!")
}

func loop() {
    arduino.DigitalWrite(ledPin, arduino.HIGH)
    arduino.Delay(blinkInterval)
    arduino.DigitalWrite(ledPin, arduino.LOW)
    arduino.Delay(blinkInterval)
}`

const PORT_TABS = [
  { label: 'macOS',   content: <CodeBlock lang="bash" filename="terminal">{'tsuki upload --port /dev/cu.usbmodem1'}</CodeBlock> },
  { label: 'Linux',   content: <CodeBlock lang="bash" filename="terminal">{'tsuki upload --port /dev/ttyUSB0'}</CodeBlock> },
  { label: 'Windows', content: <CodeBlock lang="bash" filename="terminal">{'tsuki upload --port COM3'}</CodeBlock> },
]

export default function FirstProjectPage() {
  return (
    <div>
      <P>
        This guide walks you through creating a Blink sketch — the Arduino "Hello World".
        By the end you'll have a project that compiles and flashes to your board with the
        built-in LED blinking every 500 ms.
      </P>

      <Note kind="tip">
        Make sure <InlineCode>tsuki</InlineCode> is installed and your board is connected via
        USB before starting. Run <InlineCode>tsuki boards</InlineCode> to list detected devices.
      </Note>

      <Divider />
      <H2>Create the project</H2>

      <Step n={1} title="Initialise a new project">
        <P>
          Run <InlineCode>tsuki init</InlineCode> to scaffold a new project directory.
          Pass the board ID you want to target.
        </P>
        <CodeBlock lang="bash" filename="terminal">
{`mkdir blink && cd blink
tsuki init blink --board uno`}
        </CodeBlock>
        <P>
          This creates <InlineCode>tsuki_package.json</InlineCode> and{' '}
          <InlineCode>src/main.go</InlineCode> with a starter template.
        </P>
      </Step>

      <Step n={2} title="Inspect the manifest">
        <P>
          Open <InlineCode>tsuki_package.json</InlineCode>. It declares the board, language,
          backend toolchain, and any packages your project depends on.
        </P>
        <CodeBlock lang="go" filename="tsuki_package.json">
{`{
  "name": "blink",
  "version": "0.1.0",
  "board": "uno",
  "language": "go",
  "backend": "tsuki-flash",
  "packages": [],
  "build": {
    "output_dir": "build",
    "cpp_std": "c++11",
    "optimize": "Os",
    "source_map": false
  }
}`}
        </CodeBlock>
      </Step>

      <Step n={3} title="Write the firmware">
        <P>
          Replace the contents of <InlineCode>src/main.go</InlineCode> with the blink sketch.
          Click <strong style={{ color: 'var(--fg)' }}>▶ compile</strong> to transpile it live
          with <InlineCode>tsuki-core</InlineCode> and see the generated C++:
        </P>
        <LiveCompilerBlock
          initialCode={BLINK_CODE}
          board="uno"
          filename="src/main.go"
        />
        <Note kind="info">
          <InlineCode>setup()</InlineCode> runs once on boot.{' '}
          <InlineCode>loop()</InlineCode> runs repeatedly — exactly like Arduino C++.
          The <InlineCode>arduino</InlineCode> package exposes the full Arduino API.
        </Note>
      </Step>

      <Divider />
      <H2>Build and flash</H2>

      <Step n={4} title="Compile and upload">
        <P>
          From your project directory run:
        </P>
        <CodeBlock lang="bash" filename="terminal">{`tsuki build && tsuki upload`}</CodeBlock>
        <P>
          tsuki auto-detects the connected board port. If detection fails, specify it manually:
        </P>
        <Tabs tabs={PORT_TABS} />
      </Step>

      <Note kind="tip">
        In the IDE you can run both steps at once with the{' '}
        <strong style={{ color: 'var(--fg)' }}>Build & Upload</strong> button in the toolbar (⌘U).
      </Note>

      <Divider />
      <H2>What the transpiler generates</H2>
      <P>
        Edit the code and click <strong style={{ color: 'var(--fg)' }}>▶ compile</strong> to
        call <InlineCode>tsuki-core</InlineCode> live and see the generated C++ output:
      </P>
      <LiveCompilerBlock
        initialCode={BLINK_CODE}
        board="uno"
        filename="src/main.go"
      />

      <Divider />
      <H2>Next steps</H2>
      <UL>
        <LI>Install a sensor package: <InlineCode>tsuki pkg install dht</InlineCode></LI>
        <LI>Browse supported boards: <InlineCode>tsuki boards</InlineCode></LI>
        <LI>Validate syntax without compiling: <InlineCode>tsuki check</InlineCode></LI>
        <LI>Open the <strong style={{ color: 'var(--fg)' }}>Sandbox</strong> tab in the IDE to simulate your sketch visually.</LI>
      </UL>
    </div>
  )
}