// ─────────────────────────────────────────────────────────────────────────────
//  DocsData.ts
//
//  Single source of truth for the docs navigation tree.
//  To add a new page:
//    1. Create its component under pages/
//    2. Import it here
//    3. Add an entry to SECTIONS with { wip: false } and content: <YourPage />
//
//  To mark a page as work-in-progress leave wip: true and omit the import.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'

// ── Implemented pages ─────────────────────────────────────────────────────────
import IntroductionPage from './pages/Introduction'
import InstallationPage from './pages/Installation'
import FirstProjectPage from './pages/FirstProject'
import IdeTourPage      from './pages/IdeTour'
import BoardsPage       from './pages/Boards'
import GoBasicsPage     from './pages/GoBasics'
import ArduinoPkgPage   from './pages/ArduinoPkg'
import PinsGpioPage     from './pages/PinsGpio'
import WipPage          from './pages/WipPage'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DocPage {
  id: string
  title: string
  section: string
  tags: string[]
  /** Plain-text searchable body — used by the full-text search index */
  text: string
  content: ReactNode
  wip: boolean
}

export interface DocSection {
  id: string
  label: string
  pages: DocPage[]
}

// ── Data ──────────────────────────────────────────────────────────────────────

export const SECTIONS: DocSection[] = [
  // ── Getting Started ─────────────────────────────────────────────────────────
  {
    id: 'getting-started',
    label: 'Getting Started',
    pages: [
      {
        id: 'introduction',
        title: 'Introduction',
        section: 'getting-started',
        tags: ['tsuki', 'overview', 'what', 'architecture'],
        text: 'tsuki is a Go to Arduino C++ transpiler framework. Write firmware in Go and compile it for real hardware. Supports Arduino Uno Nano Mega ESP32 ESP8266 Raspberry Pi Pico. Includes tsuki-core transpiler tsuki-flash compiler tsuki CLI package manager tsukilib.',
        content: <IntroductionPage />,
        wip: false,
      },
      {
        id: 'installation',
        title: 'Installation',
        section: 'getting-started',
        tags: ['install', 'setup', 'rust', 'go', 'build', 'source'],
        text: 'How to install tsuki from source. Requires Rust toolchain cargo and Go 1.21. Clone the repository run cargo build and go build. Binary paths tsuki tsuki-core tsuki-flash. Also covers arduino-cli setup and AVR toolchain installation on Linux macOS Windows.',
        content: <InstallationPage />,
        wip: false,
      },
      {
        id: 'first-project',
        title: 'Your First Project',
        section: 'getting-started',
        tags: ['project', 'blink', 'hello', 'led', 'upload', 'flash'],
        text: 'Create a blink sketch the Arduino hello world. tsuki init blink --board uno. Write setup and loop functions. arduino.PinMode arduino.DigitalWrite arduino.Delay arduino.OUTPUT arduino.HIGH arduino.LOW. tsuki build compiles Go to C++. tsuki upload flashes firmware to board via avrdude. Live compiler lets you transpile Go to C++ in real time.',
        content: <FirstProjectPage />,
        wip: false,
      },
      {
        id: 'ide-tour',
        title: 'IDE Tour',
        section: 'getting-started',
        tags: ['ide', 'ui', 'interface', 'tour', 'sidebar', 'editor'],
        text: 'The tsuki IDE is built with Tauri and Next.js. Toolbar has Build Upload board selector port picker theme toggle. Activity bar switches between Files Git Packages panels. File explorer for browsing creating renaming deleting files. Code editor with syntax highlighting and tabs. Bottom panel has Output Problems Terminal. Settings for CLI paths defaults editor appearance sandbox. Keyboard shortcuts Cmd+S save Cmd+B build Cmd+U upload Cmd+K search Cmd+backtick terminal.',
        content: <IdeTourPage />,
        wip: false,
      },
    ],
  },

  // ── Go for Arduino ──────────────────────────────────────────────────────────
  {
    id: 'language',
    label: 'Go for Arduino',
    pages: [
      {
        id: 'go-basics',
        title: 'Go Basics',
        section: 'language',
        tags: ['go', 'syntax', 'basics', 'variables', 'functions'],
        text: 'Go syntax basics for Arduino firmware. Variables constants functions structs interfaces. Type system int uint8 float32 bool string byte rune. Control flow if else for range switch. Import declarations package main. Arrays slices. setup loop entry points.',
        content: <GoBasicsPage />,
        wip: false,
      },
      {
        id: 'arduino-pkg',
        title: 'arduino package',
        section: 'language',
        tags: ['arduino', 'package', 'import', 'pinmode', 'digitalwrite', 'serial', 'analog', 'pwm', 'interrupt', 'millis', 'delay'],
        text: 'The arduino built-in package. PinMode DigitalWrite DigitalRead AnalogRead AnalogWrite Delay Millis Micros Tone NoTone ShiftIn ShiftOut PulseIn Map Constrain Abs Min Max Random. Serial.Begin Serial.Print Serial.Println Serial.Available Serial.Read. Constants HIGH LOW INPUT OUTPUT INPUT_PULLUP RISING FALLING CHANGE. AttachInterrupt DetachInterrupt. Non-blocking millis pattern.',
        content: <ArduinoPkgPage />,
        wip: false,
      },
      {
        id: 'pins',
        title: 'Pins & GPIO',
        section: 'language',
        tags: ['pins', 'gpio', 'digital', 'analog', 'pwm', 'interrupt', 'input', 'output', 'pullup'],
        text: 'Digital and analog pins in tsuki. PinMode OUTPUT INPUT INPUT_PULLUP. DigitalWrite DigitalRead. AnalogRead 10-bit 0-1023 voltage. AnalogWrite PWM duty cycle 0-255. PWM pins frequencies. Hardware interrupts ISR AttachInterrupt RISING FALLING CHANGE. PulseIn ultrasonic HC-SR04. Map Constrain utility functions.',
        content: <PinsGpioPage />,
        wip: false,
      },
      {
        id: 'serial',
        title: 'Serial Communication',
        section: 'language',
        tags: ['serial', 'uart', 'print', 'println', 'monitor'],
        text: 'Serial communication with Arduino boards. Serial.Begin baud rate. Serial.Print Serial.Println Serial.Available Serial.Read. UART TX RX pins. Serial monitor debugging.',
        content: <WipPage title="Serial Communication" />,
        wip: true,
      },
      {
        id: 'libraries',
        title: 'Using Libraries',
        section: 'language',
        tags: ['library', 'import', 'servo', 'i2c', 'wire', 'spi'],
        text: 'Using Arduino libraries in tsuki. Import servo Wire SPI LiquidCrystal. Wire.Begin I2C SDA SCL. SPI.Begin MOSI MISO SCK. Servo.Attach Servo.Write. Installing tsukilib packages.',
        content: <WipPage title="Using Libraries" />,
        wip: true,
      },
      {
        id: 'types',
        title: 'Types & Limits',
        section: 'language',
        tags: ['types', 'uint8', 'int', 'limits', 'memory'],
        text: 'Type system for embedded Go. uint8 uint16 uint32 int8 int16 int32 float32 float64. Memory constraints SRAM flash EEPROM. Type conversion casting. Avoiding dynamic allocation on microcontrollers.',
        content: <WipPage title="Types & Limits" />,
        wip: true,
      },
    ],
  },

  // ── Build & Flash ───────────────────────────────────────────────────────────
  {
    id: 'build',
    label: 'Build & Flash',
    pages: [
      {
        id: 'tsuki-build',
        title: 'tsuki build',
        section: 'build',
        tags: ['build', 'compile', 'cli', 'flags'],
        text: 'CLI command tsuki build. Flags --board --compile --backend --source-map --check. Output directory build. Generated files .cpp .ino .hex. Backends arduino-cli and tsuki-flash.',
        content: <WipPage title="tsuki build" />,
        wip: true,
      },
      {
        id: 'boards',
        title: 'Supported Boards',
        section: 'build',
        tags: ['boards', 'uno', 'nano', 'mega', 'esp32', 'pico', 'wemos', 'd1', 'esp8266'],
        text: 'All boards supported by tsuki. Arduino Uno Nano Nano Every Mega Micro Leonardo Due Zero MKR WiFi 1000. ESP32 ESP8266 Wemos D1 Mini NodeMCU. Raspberry Pi Pico RP2040. Teensy 4.1. Arduino Portenta H7. Board IDs uno nano nano_every mega micro leonardo due zero mkr1000 esp32 esp8266 pico teensy41 portenta_h7. Interactive pinout diagrams Arduino Uno ATmega328P Wemos D1 Mini ESP8266 GPIO PWM ADC I2C SPI UART.',
        content: <BoardsPage />,
        wip: false,
      },
      {
        id: 'tsuki-flash',
        title: 'tsuki-flash',
        section: 'build',
        tags: ['flash', 'upload', 'avr', 'avrdude', 'esptool'],
        text: 'tsuki-flash compiles and uploads firmware without arduino-cli. Uses avr-gcc for AVR boards and xtensa toolchain for ESP. avrdude for uploading to AVR. esptool.py for ESP32 ESP8266. Auto-downloads AVR SDK on first use.',
        content: <WipPage title="tsuki-flash" />,
        wip: true,
      },
      {
        id: 'modules',
        title: 'SDK Modules',
        section: 'build',
        tags: ['modules', 'sdk', 'arduino', 'avr', 'cores'],
        text: 'tsuki-modules manages Arduino cores and SDKs. Install AVR core for Uno Nano Mega. ESP32 and ESP8266 cores. Automatic download on first build. Stored in ~/.tsuki/modules.',
        content: <WipPage title="SDK Modules" />,
        wip: true,
      },
      {
        id: 'tsuki-package',
        title: 'tsuki_package.json',
        section: 'build',
        tags: ['config', 'json', 'package', 'manifest'],
        text: 'Project manifest file tsuki_package.json. Fields name version board language backend packages build. Build options output_dir cpp_std optimize extra_flags source_map. Language go cpp ino. Backend tsuki-flash arduino-cli.',
        content: <WipPage title="tsuki_package.json" />,
        wip: true,
      },
    ],
  },

  // ── Packages ────────────────────────────────────────────────────────────────
  {
    id: 'packages',
    label: 'Packages',
    pages: [
      {
        id: 'pkg-overview',
        title: 'Package Manager',
        section: 'packages',
        tags: ['packages', 'tsukilib', 'install', 'registry'],
        text: 'tsukilib package manager. tsuki pkg install remove list search update. Registry at GitHub. tsukilib.toml format. Package signatures Ed25519. libs_dir ~/.local/share/tsuki/libs.',
        content: <WipPage title="Package Manager" />,
        wip: true,
      },
      {
        id: 'pkg-ws2812',
        title: 'ws2812 / NeoPixel',
        section: 'packages',
        tags: ['ws2812', 'neopixel', 'led', 'rgb', 'strip'],
        text: 'ws2812 NeoPixel RGB LED strip package. Adafruit_NeoPixel C++ library. Begin Show SetPixelColor ColorHSV. NEO_GRB color order. tsuki pkg install ws2812.',
        content: <WipPage title="ws2812 / NeoPixel" />,
        wip: true,
      },
      {
        id: 'pkg-dht',
        title: 'dht (temperature)',
        section: 'packages',
        tags: ['dht', 'dht11', 'dht22', 'temperature', 'humidity', 'sensor'],
        text: 'DHT temperature and humidity sensor package. DHT11 DHT22 sensors. ReadTemperature ReadHumidity. tsuki pkg install dht.',
        content: <WipPage title="dht (temperature)" />,
        wip: true,
      },
      {
        id: 'pkg-hcsr04',
        title: 'hcsr04 (ultrasonic)',
        section: 'packages',
        tags: ['hcsr04', 'ultrasonic', 'distance', 'sensor'],
        text: 'HC-SR04 ultrasonic distance sensor package. Trig Echo pins. MeasureCm MeasureInch. tsuki pkg install hcsr04.',
        content: <WipPage title="hcsr04 (ultrasonic)" />,
        wip: true,
      },
      {
        id: 'pkg-u8g2',
        title: 'u8g2 (displays)',
        section: 'packages',
        tags: ['u8g2', 'oled', 'display', 'ssd1306', 'sh1106'],
        text: 'u8g2 OLED display library. SSD1306 SH1106 monochrome displays. I2C and SPI interface. DrawStr SetFont ClearBuffer SendBuffer. tsuki pkg install u8g2.',
        content: <WipPage title="u8g2 (displays)" />,
        wip: true,
      },
    ],
  },

  // ── Experiments ─────────────────────────────────────────────────────────────
  {
    id: 'experiments',
    label: 'Experiments',
    pages: [
      {
        id: 'experiments-intro',
        title: 'About Experiments',
        section: 'experiments',
        tags: ['experiments', 'beta', 'unstable'],
        text: 'Experimental features in tsuki. Unstable APIs that may change. Sandbox simulator WebAssembly WASM. Live compilation in docs.',
        content: <WipPage title="About Experiments" />,
        wip: true,
      },
      {
        id: 'sandbox',
        title: 'Sandbox Simulator',
        section: 'experiments',
        tags: ['sandbox', 'simulator', 'circuit', 'wasm'],
        text: 'Visual circuit simulator for tsuki. Simulates Arduino pin states digital analog. Compiled to WebAssembly WASM. Visualize LEDs buttons displays without real hardware.',
        content: <WipPage title="Sandbox Simulator" />,
        wip: true,
      },
    ],
  },

  // ── API Reference ────────────────────────────────────────────────────────────
  {
    id: 'reference',
    label: 'API Reference',
    pages: [
      {
        id: 'ref-arduino',
        title: 'arduino.*',
        section: 'reference',
        tags: ['api', 'reference', 'arduino', 'pinmode', 'delay'],
        text: 'Full arduino package API reference. PinMode DigitalWrite DigitalRead AnalogRead AnalogWrite Delay Millis Micros Tone NoTone ShiftIn ShiftOut PulseIn. Serial Wire SPI Servo LiquidCrystal. Constants HIGH LOW INPUT OUTPUT INPUT_PULLUP.',
        content: <WipPage title="arduino.*" />,
        wip: true,
      },
      {
        id: 'ref-fmt',
        title: 'fmt.*',
        section: 'reference',
        tags: ['api', 'fmt', 'print', 'printf', 'println'],
        text: 'fmt package maps to Serial. fmt.Print fmt.Println fmt.Printf fmt.Sprintf. Formatted output to serial monitor. String formatting verbs %d %s %f %v.',
        content: <WipPage title="fmt.*" />,
        wip: true,
      },
      {
        id: 'ref-cli',
        title: 'CLI flags',
        section: 'reference',
        tags: ['cli', 'flags', 'commands', 'build', 'upload'],
        text: 'tsuki CLI all commands and flags. tsuki init build upload check clean config boards pkg. Global flags --verbose --no-color. Build flags --board --compile --backend --source-map. Upload flags --port --baud. Config get set list path.',
        content: <WipPage title="CLI flags" />,
        wip: true,
      },
    ],
  },
]

// ── Flat helpers ──────────────────────────────────────────────────────────────

/** Every page in a single flat array, in sidebar order. */
export const ALL_PAGES: DocPage[] = SECTIONS.flatMap(s => s.pages)

/** Look up the section label for a given sectionId. */
export function getSectionLabel(sectionId: string): string {
  return SECTIONS.find(s => s.id === sectionId)?.label ?? sectionId
}