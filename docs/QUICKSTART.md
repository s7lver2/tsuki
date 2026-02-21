# GoDotIno — Quickstart

Three self-contained projects to get you up and running with GoDotIno.
Each project lives in its own folder and can be built with a single command.

---

## Prerequisites

```bash
# 1. Install arduino-cli and make sure it is on your PATH
# 2. Install the GoDotIno CLI
go install github.com/godotino/cli/cmd/godotino@latest

# 3. (Optional) point to a custom package dir or registry
godotino config set libs_dir ~/my-godotino-libs
godotino config set registry_url https://raw.githubusercontent.com/s7lver/godotino-pkgs/main/registry.json
```

---

## Project 1 — Blink  *(no packages required)*

> **Goal:** Make the built-in LED on pin 13 blink every 500 ms.
> This is the Arduino "Hello World" — perfect for verifying your toolchain.

### 1.1 Create the project

```bash
mkdir blink && cd blink
godotino init blink --board uno
```

### 1.2 `goduino.json`

```json
{
  "name": "blink",
  "version": "0.1.0",
  "board": "uno",
  "go_version": "1.21",
  "packages": [],
  "build": {
    "output_dir": "build",
    "cpp_std": "c++11",
    "optimize": "Os",
    "extra_flags": [],
    "source_map": false
  }
}
```

### 1.3 `main.go`

```go
package main

import "arduino"

const ledPin       = 13
const blinkInterval = 500 // milliseconds

func setup() {
    arduino.pinMode(ledPin, arduino.OUTPUT)
    arduino.Serial.Begin(9600)
    arduino.Serial.Println("Blink ready!")
}

func loop() {
    arduino.digitalWrite(ledPin, arduino.HIGH)
    arduino.delay(blinkInterval)
    arduino.digitalWrite(ledPin, arduino.LOW)
    arduino.delay(blinkInterval)
}
```

### 1.4 Build & flash

```bash
godotino build          # transpile + compile
godotino flash          # upload to connected board
```

---

## Project 2 — DHT Thermometer  *(uses `dht` package)*

> **Goal:** Read temperature and humidity from a DHT22 sensor every 2 s and
> print the values over Serial. Introduces the package manager.

**Wiring:** DHT22 DATA pin → Arduino pin 2, VCC → 3.3 V, GND → GND.

### 2.1 Create the project and install the package

```bash
mkdir thermometer && cd thermometer
godotino init thermometer --board uno
godotino pkg install dht          # downloads dht 1.0.0 from the registry
```

> **Where does it go?**
> The TOML manifest is saved to `~/.local/share/godotino/libs/dht/1.0.0/godotinolib.toml`
> (overridable with `godotino config set libs_dir <path>`).

### 2.2 `goduino.json`

```json
{
  "name": "thermometer",
  "version": "0.1.0",
  "board": "uno",
  "go_version": "1.21",
  "packages": [
    { "name": "dht", "version": "^1.0.0" }
  ],
  "build": {
    "output_dir": "build",
    "cpp_std": "c++11",
    "optimize": "Os",
    "extra_flags": [],
    "source_map": false
  }
}
```

### 2.3 `main.go`

```go
package main

import (
    "arduino"
    "dht"
    "fmt"
)

const sensorPin = 2
const sensorType = dht.DHT22

var sensor dht.DHT

func setup() {
    arduino.Serial.Begin(9600)
    sensor = dht.New(sensorPin, sensorType)
    sensor.Begin()
    fmt.Println("DHT22 ready!")
}

func loop() {
    temp := sensor.ReadTemperature()
    hum  := sensor.ReadHumidity()

    if sensor.IsNan(temp) || sensor.IsNan(hum) {
        fmt.Println("Read error — check wiring")
    } else {
        fmt.Printf("Temp: %.1f C  |  Humidity: %.1f %%\n", temp, hum)
    }

    arduino.delay(2000)
}
```

### 2.4 Build & flash

```bash
godotino build
godotino flash
godotino monitor   # open serial monitor at 9600 baud
```

---

## Project 3 — NeoPixel Rainbow  *(uses `ws2812` package)*

> **Goal:** Drive a strip of 8 WS2812 (NeoPixel) LEDs through a smooth
> rainbow animation. Introduces `ws2812` and how to work with color helpers.

**Wiring:** DIN → Arduino pin 6, 5 V → 5 V power supply (not 3.3 V!), GND → GND.
Add a 300–500 Ω resistor in series with DIN to protect the first LED.

### 3.1 Create the project and install the package

```bash
mkdir rainbow && cd rainbow
godotino init rainbow --board uno
godotino pkg install ws2812        # downloads ws2812 1.0.0 from the registry
```

### 3.2 `goduino.json`

```json
{
  "name": "rainbow",
  "version": "0.1.0",
  "board": "uno",
  "go_version": "1.21",
  "packages": [
    { "name": "ws2812", "version": "^1.0.0" }
  ],
  "build": {
    "output_dir": "build",
    "cpp_std": "c++11",
    "optimize": "Os",
    "extra_flags": [],
    "source_map": false
  }
}
```

### 3.3 `main.go`

```go
package main

import (
    "arduino"
    "ws2812"
)

const numPixels  = 8
const dataPin    = 6
const brightness = 80   // 0-255
const delayMs    = 20   // animation speed

var strip ws2812.WS2812
var hueOffset uint16 = 0

func setup() {
    strip = ws2812.New(numPixels, dataPin, ws2812.NEO_GRB+ws2812.NEO_KHZ800)
    strip.Begin()
    strip.SetBrightness(brightness)
    strip.Clear()
    strip.Show()
}

func loop() {
    // Spread the hue evenly across all pixels, offset shifts each frame.
    for i := 0; i < numPixels; i++ {
        hue := hueOffset + uint16(i)*(65536/numPixels)
        color := ws2812.Color(hueToRGB(hue))
        strip.SetPixelColor(i, color)
    }
    strip.Show()

    hueOffset += 256   // advance rainbow each frame
    arduino.delay(delayMs)
}

// hueToRGB converts a 16-bit hue (0-65535) to a packed 24-bit RGB value.
// This is a simplified version; use ws2812.Gamma32 for perceptual linearity.
func hueToRGB(hue uint16) (uint8, uint8, uint8) {
    h := uint32(hue) * 1530 / 65536
    switch {
    case h < 255:
        return 255, uint8(h), 0
    case h < 510:
        return uint8(510 - h), 255, 0
    case h < 765:
        return 0, 255, uint8(h - 510)
    case h < 1020:
        return 0, uint8(1020 - h), 255
    case h < 1275:
        return uint8(h - 1020), 0, 255
    default:
        return 255, 0, uint8(1530 - h)
    }
}
```

### 3.4 Build & flash

```bash
godotino build
godotino flash
```

---

## Next steps

| Command | What it does |
|---|---|
| `godotino pkg search` | Browse all packages in the registry |
| `godotino pkg install <name>` | Install a package |
| `godotino pkg list` | List installed packages |
| `godotino config list` | Show all config keys and their current values |
| `godotino config set <key> <value>` | Change a setting |
| `godotino check` | Validate syntax before building |

### Useful config keys for package management

| Key | Description | Default |
|---|---|---|
| `libs_dir` | Where packages are installed | `~/.local/share/godotino/libs` |
| `registry_url` | Package registry JSON URL | GitHub (s7lver/godotino-pkgs) |
| `keys_dir` | Where signing keys are cached | `~/.local/share/godotino/keys` |
| `keys_index_url` | Key index JSON URL | GitHub (s7lver/godotino-pkgs/keys) |
| `verify_signatures` | Verify package signatures on install | `false` |

```bash
# Example: use a private registry and enable signature verification
godotino config set registry_url https://my-org.example.com/godotino/registry.json
godotino config set keys_index_url https://my-org.example.com/godotino/keys/index.json
godotino config set verify_signatures true
```