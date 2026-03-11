###### _<div align="right"><sub>// Write in Go, Upload in C++</sub></div>_

<div align="center">

v4.0

```
  ████████╗███████╗██╗   ██╗██╗  ██╗██╗    
  ╚══██╔══╝██╔════╝██║   ██║██║ ██╔╝██║    
     ██║   ███████╗██║   ██║█████╔╝ ██║    
     ██║   ╚════██║██║   ██║██╔═██╗ ██║    
     ██║   ███████║╚██████╔╝██║  ██╗██║    
     ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝
```

[![Go Version](https://img.shields.io/badge/Go-1.21+-00ADD8?style=for-the-badge&logo=go&logoColor=white)](https://go.dev/)
[![Rust](https://img.shields.io/badge/Core-Rust-orange?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Arduino](https://img.shields.io/badge/Arduino-CLI-00979D?style=for-the-badge&logo=arduino&logoColor=white)](https://arduino.github.io/arduino-cli/)
[![License](https://img.shields.io/badge/License-MIT-CCA9DD?style=for-the-badge)](./LICENSE)

<br>

<a href="#installation"><kbd> <br> Installation <br> </kbd></a>&ensp;
<a href="#commands"><kbd> <br> Commands <br> </kbd></a>&ensp;
<a href="#support"><kbd> <br> Support <br> </kbd></a>&ensp;
<a href="#boards"><kbd> <br> Boards <br> </kbd></a>&ensp;
<a href="#examples"><kbd> <br> Examples <br> </kbd></a>&ensp;
<a href="#architecture"><kbd> <br> Architecture <br> </kbd></a>

</div>

<br>

tsuki is a framework that lets you write Arduino firmware in **Go** and automatically transpiles it to **C++**, ready to flash to your favourite Arduino-compatible board.

---

<a id="installation"></a>
<img src="https://readme-typing-svg.herokuapp.com?font=Lexend+Giga&size=22&pause=1000&color=CCA9DD&vCenter=true&width=435&height=25&lines=INSTALLATION" width="400"/>

### Linux / macOS (Recommended)

```bash
git clone https://github.com/tsuki/tsuki
cd tsuki

# Build core (Rust) + CLI (Go)
make all

# Install both binaries to /usr/local/bin
sudo make install-all
```

### Without sudo

```bash
make install-user     # installs to ~/bin  — no sudo required
```

> [!IMPORTANT]
> Make sure `~/bin` is on your `PATH`:
> ```bash
> export PATH="$HOME/bin:$PATH"
> ```


### Requirements

| Dependency | Purpose | Required? |
|------------|---------|-----------|
| [Go 1.21+](https://go.dev/dl/) | Build the CLI | ✅ |
| [Rust + Cargo](https://rustup.rs/) | Build the core transpiler | ✅ |
| [arduino-cli](https://arduino.github.io/arduino-cli/) | Compile & flash firmware | For `build --compile` and `upload` |

<div align="right"><a href="#-write-in-go-upload-in-c"><kbd> <br> 🡅 <br> </kbd></a></div>

---

<a id="commands"></a>
<img src="https://readme-typing-svg.herokuapp.com?font=Lexend+Giga&size=22&pause=1000&color=CCA9DD&vCenter=true&width=435&height=25&lines=COMMANDS" width="400"/>

### `tsuki init`

Scaffold a new project in the current directory or a named subdirectory.

```bash
tsuki init
tsuki init my-robot
tsuki init my-robot --board esp32
```

Creates the following structure:

```
my-robot/
├── goduino.json     ← project manifest
├── src/
│   └── main.go      ← blink skeleton, ready to edit
└── .gitignore
```

---

### `tsuki build`

Transpile Go → C++, and optionally compile with `arduino-cli`.

```bash
tsuki build
tsuki build --board esp32
tsuki build --compile                   # also invoke arduino-cli compile
tsuki build --compile --output dist/
tsuki build --source-map                # emit #line pragmas for IDE mapping
```

---

### `tsuki upload`

Upload compiled firmware to a connected board. Auto-detects the port if omitted.

```bash
tsuki upload
tsuki upload --port /dev/ttyUSB0
tsuki upload --port COM3 --board uno
```

---

### `tsuki check`

Validate all source files without producing output. Renders rich tracebacks on error.

```bash
tsuki check
tsuki check --board esp32
```

Example output:

```
╭─── Traceback (most recent call last) ─────────────────────────────────╮
│  src/main.go:14 in main                                                │
│                                                                        │
│   12 │ func loop() {                                                   │
│   13 │     arduino.PinMode(13, arduino.OUTPUT)                        │
│ ❱ 14 │     Delay(1000)                                                │
│   15 │ }                                                               │
│                                                                        │
│  locals ───────────────────────────────────────────────────────────── │
│  │  file = src/main.go                                                │
│  │  line = 14                                                         │
╰────────────────────────────────────────────────────────────────────────╯
TranspileError: undefined function `Delay` — did you mean `arduino.Delay`?
```

---

### `tsuki config`

Get or set persistent CLI configuration with a styled display panel.

```bash
tsuki config show                                    # show all settings
tsuki config show --raw                              # raw key=value output

tsuki config set default_board esp32
tsuki config set arduino_cli /usr/local/bin/arduino-cli
tsuki config set verbose true
tsuki config set default_baud 115200

tsuki config get default_board
tsuki config get default_board --raw

tsuki config path                                    # print config file location
```

| Key | Default | Description |
|-----|---------|-------------|
| `core_binary` | *(auto)* | Path to `tsuki-core` binary |
| `arduino_cli` | `arduino-cli` | Path to `arduino-cli` |
| `default_board` | `uno` | Default target board |
| `default_baud` | `9600` | Default serial baud rate |
| `color` | `true` | Enable colored output |
| `verbose` | `false` | Verbose output |
| `auto_detect` | `true` | Auto-detect connected boards |

> Config is stored at `~/.config/tsuki/config.json`

---

### Other commands

```bash
tsuki boards list      # list all supported boards with specs
tsuki boards detect    # detect boards connected via USB
tsuki clean            # remove the build/ directory
tsuki version          # print CLI + core version info
```

**Global flags** available on all commands:

| Flag | Description |
|------|-------------|
| `-v`, `--verbose` | Verbose output |
| `--no-color` | Disable colored output |

<div align="right"><a href="#-write-in-go-upload-in-c"><kbd> <br> 🡅 <br> </kbd></a></div>

---

<a id="support"></a>
<img src="https://readme-typing-svg.herokuapp.com?font=Lexend+Giga&size=22&pause=1000&color=CCA9DD&vCenter=true&width=435&height=25&lines=SUPPORTED+GO+SUBSET" width="430"/>

| Feature | Status |
|---------|--------|
| Variables (`var`, `:=`) | ✅ |
| Constants (`const`) | ✅ |
| Functions + methods | ✅ |
| Structs + type aliases | ✅ |
| `if / else` | ✅ |
| `for` (C-style, while-style) | ✅ |
| `for … range` over arrays | ✅ |
| `switch / case` | ✅ |
| All operators | ✅ |
| String literals | ✅ |
| `import` + package calls | ✅ |
| Goroutines (`go`) | ⚠️ stub — comment emitted |
| `defer` | ⚠️ stub — comment emitted |
| Channels (`chan`) | ❌ not supported |
| Interfaces | ⚠️ type-only |
| Closures / lambdas | ⚠️ skeleton only |
| Multiple return values | ⚠️ struct-packed |
| Generics | ❌ not planned |
| `map` type | ⚠️ `void*` stub |
| Garbage collection | ❌ Arduino has no heap GC |

### Mapped packages

| Go import | Maps to |
|-----------|---------|
| `"arduino"` | `Arduino.h` builtins |
| `"fmt"` | `Serial.print / println` |
| `"time"` | `delay / millis` |
| `"math"` | `<math.h>` functions |
| `"strconv"` | `String::to…` methods |
| `"wire"` / `"Wire"` | `Wire.h` (I2C) |
| `"spi"` / `"SPI"` | `SPI.h` |
| `"serial"` / `"Serial"` | `Serial` object |
| `"Servo"` | `Servo.h` |
| `"LiquidCrystal"` | `LiquidCrystal.h` |

<div align="right"><a href="#-write-in-go-upload-in-c"><kbd> <br> 🡅 <br> </kbd></a></div>

---

<a id="boards"></a>
<img src="https://readme-typing-svg.herokuapp.com?font=Lexend+Giga&size=22&pause=1000&color=CCA9DD&vCenter=true&width=435&height=25&lines=SUPPORTED+BOARDS" width="430"/>

Run `tsuki boards list` for the full table with FQBN and memory specs.

| ID | Name | CPU | Flash | RAM |
|----|------|-----|-------|-----|
| `uno` | Arduino Uno | ATmega328P | 32K | 2K |
| `nano` | Arduino Nano | ATmega328P | 32K | 2K |
| `mega` | Arduino Mega 2560 | ATmega2560 | 256K | 8K |
| `leonardo` | Arduino Leonardo | ATmega32U4 | 32K | 2K |
| `due` | Arduino Due | AT91SAM3X8E | 512K | 96K |
| `esp32` | ESP32 Dev Module | Xtensa LX6 | 4096K | 520K |
| `esp8266` | ESP8266 NodeMCU | ESP8266EX | 4096K | 80K |
| `pico` | Raspberry Pi Pico | RP2040 | 2048K | 264K |
| `teensy40` | Teensy 4.0 | iMXRT1062 | 1984K | 1024K |

<div align="right"><a href="#-write-in-go-upload-in-c"><kbd> <br> 🡅 <br> </kbd></a></div>

---

<a id="examples"></a>
<img src="https://readme-typing-svg.herokuapp.com?font=Lexend+Giga&size=22&pause=1000&color=CCA9DD&vCenter=true&width=435&height=25&lines=EXAMPLES" width="400"/>

### Blink

```go
package main

import "arduino"

func setup() {
    arduino.PinMode(arduino.LED_BUILTIN, arduino.OUTPUT)
}

func loop() {
    arduino.DigitalWrite(arduino.LED_BUILTIN, arduino.HIGH)
    arduino.Delay(1000)
    arduino.DigitalWrite(arduino.LED_BUILTIN, arduino.LOW)
    arduino.Delay(1000)
}
```

### Sensor read + Serial print

```go
package main

import (
    "arduino"
    "fmt"
)

func setup() {
    arduino.SerialBegin(9600)
}

func loop() {
    val := arduino.AnalogRead(arduino.A0)
    fmt.Println("sensor:", val)
    arduino.Delay(500)
}
```

### Servo sweep

```go
package main

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
}
```

<div align="right"><a href="#-write-in-go-upload-in-c"><kbd> <br> 🡅 <br> </kbd></a></div>

---

<a id="architecture"></a>
<img src="https://readme-typing-svg.herokuapp.com?font=Lexend+Giga&size=22&pause=1000&color=CCA9DD&vCenter=true&width=435&height=25&lines=ARCHITECTURE" width="400"/>

```
User
 │
 ▼
tsuki (Go CLI)              ← thin coordination layer
 ├── internal/cli/             ← cobra commands (init, build, upload, check, config…)
 ├── internal/manifest/        ← goduino.json load / save
 ├── internal/config/          ← ~/.config/tsuki/config.json
 ├── internal/core/            ← shell-out to tsuki-core
 ├── internal/build/           ← transpile pipeline + arduino-cli compile
 ├── internal/flash/           ← arduino-cli upload
 ├── internal/check/           ← source validation + rich report
 └── internal/ui/              ← rich terminal output (tracebacks, config panels, spinners)
 │
 ▼
tsuki-core (Rust)           ← Go → C++ transpiler (lexer → parser → AST → codegen)
 │
 ▼
tsuki-flash                    ← compile .cpp → .hex / .bin / .uf2  +  flash to board
 │
 ▼
Board  ✓
```

The CLI never re-implements the transpiler — all source transformation is delegated to `tsuki-core`.

<div align="right"><a href="#-write-in-go-upload-in-c"><kbd> <br> 🡅 <br> </kbd></a></div>

---

<div align="center">
  <sub>Built with ☕ and a distaste for writing C++ by hand</sub>
</div>