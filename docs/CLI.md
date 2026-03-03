# Goduino CLI — Specification & Implementation Guide

> The CLI is written in **Go** and ships as a single binary `goduino`.  
> It calls the **Rust core** binary (`goduino-core`) for transpilation,
> or links `goduino_core.a` via CGo for zero-copy speed.

---

## Table of Contents
1. [Architecture overview](#architecture-overview)
2. [Project structure](#project-structure)
3. [Commands reference](#commands-reference)
4. [Project manifest (goduino.json)](#project-manifest)
5. [Dependency management](#dependency-management)
6. [Board detection](#board-detection)
7. [Build pipeline](#build-pipeline)
8. [Flash & monitor](#flash--monitor)
9. [Calling the Rust core](#calling-the-rust-core)
10. [Implementation notes](#implementation-notes)

---

## Architecture overview

```
User
  │
  ▼
goduino CLI (Go)
  ├── project/manifest management
  ├── dependency resolution
  ├── board detection (via arduino-cli or libserialport)
  ├── calls goduino-core (Rust) for transpilation
  ├── calls arduino-cli for compilation + flash
  └── serial monitor
```

The CLI is a thin orchestrator. It does **not** re-implement the transpiler —
it always delegates to `goduino-core`.

---

## Project structure

```
goduino-cli/              ← Go module root
├── cmd/
│   └── goduino/
│       └── main.go       ← cobra root command
├── internal/
│   ├── manifest/         ← load/save goduino.json
│   ├── deps/             ← dependency resolver
│   ├── board/            ← board detection, FQBN lookup
│   ├── build/            ← transpile + arduino-cli compile
│   ├── flash/            ← arduino-cli upload
│   ├── monitor/          ← serial port terminal
│   └── core/             ← shell-out or CGo to goduino-core
├── go.mod
└── go.sum
```

### Recommended Go modules / libraries

| Purpose | Library |
|---------|---------|
| CLI framework | `github.com/spf13/cobra` |
| Config / manifest | `encoding/json` (stdlib) |
| Colored output | `github.com/fatih/color` |
| Progress bars | `github.com/schollz/progressbar/v3` |
| Serial port | `go.bug.st/serial` |
| HTTP / registry | `net/http` (stdlib) |
| Semver | `golang.org/x/mod/semver` |
| Table output | `github.com/olekukonko/tablewriter` |

---

## Commands reference

### `goduino new <name>`

Scaffold a new project.

```
goduino new my-robot
goduino new my-robot --board esp32
goduino new my-robot --board pico --template ws2812
```

Creates:
```
my-robot/
├── goduino.json
└── src/
    └── main.go          ← hello-world skeleton for the chosen board
```

**Implementation notes:**
- Read `--board` (default `uno`) and write it to `goduino.json`.
- Ship a set of built-in templates (blink, ws2812, i2c-lcd, etc.).
- Optionally clone a community template from a URL.

---

### `goduino build`

Transpile Go → C++, then optionally compile with `arduino-cli`.

```
tsuki build
tsuki build --board mega
tsuki build --compile                    # also run arduino-cli compile
tsuki build --compile --output build/
```

**Flags:**
| Flag | Default | Description |
|------|---------|-------------|
| `--board <id>` | from manifest | Override target board |
| `--compile` | false | Invoke arduino-cli compile after transpilation |
| `--output <dir>` | `build/` | Output directory |
| `--source-map` | false | Emit #line pragmas |
| `--verbose` | false | Print full compiler output |

**Steps:**
1. Load `goduino.json`.
2. Find all `*.go` files in `src/`.
3. For each file, call `goduino-core <file> build/<file>.cpp --board <id>`.
4. If `--compile`: run  
   `arduino-cli compile --fqbn <fqbn> --build-path build/ .`

---

### `goduino flash`

Flash compiled firmware to a connected board.

```
goduino flash
goduino flash --port /dev/ttyUSB0
goduino flash --port COM3 --board uno
```

**Flags:**
| Flag | Default | Description |
|------|---------|-------------|
| `--port <port>` | auto-detect | Serial port |
| `--board <id>` | from manifest | Override board |

**Implementation:**
```go
// internal/flash/flash.go

func Flash(fqbn, port, buildPath string) error {
    args := []string{
        "upload",
        "--fqbn", fqbn,
        "--port", port,
        "--input-dir", buildPath,
    }
    return runArduinoCLI(args...)
}
```

Auto-detection strategy:
1. List all serial ports via `go.bug.st/serial`.
2. Filter by known Arduino USB VID/PIDs (see table below).
3. If multiple found, prompt user.

| Board | VID | PID |
|-------|-----|-----|
| Uno/Nano (CH340) | 1A86 | 7523 |
| Uno (ATmega16U2) | 2341 | 0043 |
| Leonardo / Micro | 2341 | 8036 |
| ESP32 (CP2102) | 10C4 | EA60 |
| ESP32 (CH340) | 1A86 | 7523 |
| Pico | 2E8A | 0005 |

---

### `goduino monitor`

Interactive serial monitor.

```
goduino monitor
goduino monitor --port /dev/ttyUSB0 --baud 115200
```

**Implementation hints:**
```go
// internal/monitor/monitor.go

func Monitor(port string, baud int) error {
    sp, err := serial.Open(port, &serial.Mode{BaudRate: baud})
    // ...
    // Use two goroutines:
    //   1. Read from serial → write to stdout
    //   2. Read stdin → write to serial
}
```

Support line-endings: LF, CR, CRLF (configurable).  
Support timestamp prefix (`--timestamp`).

---

### `goduino deps`

Manage project dependencies.

#### `goduino deps add <package>`

```
goduino deps add github.com/goduino/ws2812    # Go package (transpiled)
goduino deps add arduino:servo@^1.1.3         # Arduino library (C++)
goduino deps add arduino:wire                  # Core library
```

**Dependency kinds:**

| Prefix | Kind | Resolved via |
|--------|------|--------------|
| `github.com/...` | Go package | Goduino package registry / GitHub |
| `arduino:<lib>` | Arduino library | arduino-cli library index |
| `local:<path>` | Local path | File system |

**goduino.json after add:**
```json
{
  "dependencies": [
    { "name": "github.com/goduino/ws2812", "version": "0.2.1", "kind": "go" },
    { "name": "arduino:servo",              "version": "1.1.3",  "kind": "arduino" }
  ]
}
```

#### `goduino deps remove <package>`
Remove a dependency from the manifest.

#### `goduino deps list`
Print all dependencies in a table.

#### `goduino deps update [package]`
Update one or all dependencies to their latest compatible versions (semver).

#### `goduino deps tidy`
Remove unused dependencies, verify checksums.

---

### `goduino boards`

#### `goduino boards list`
```
ID              NAME                           FLASH   RAM    FQBN
──────────────────────────────────────────────────────────────────────
uno             Arduino Uno                    32K     2K     arduino:avr:uno
esp32           ESP32 Dev Module               4096K   520K   esp32:esp32:esp32
pico            Raspberry Pi Pico (RP2040)     2048K   264K   rp2040:rp2040:rpipico
...
```

#### `goduino boards detect`
```
Scanning serial ports...
Found: Arduino Uno on /dev/ttyUSB0  (arduino:avr:uno)
```

#### `goduino boards info <id>`
Detailed info for one board.

---

### `goduino clean`

Remove the `build/` directory.

---

## Project manifest

**`goduino.json`** (auto-generated by `goduino new`):

```json
{
  "name": "my-project",
  "version": "0.1.0",
  "board": "uno",
  "go_version": "1.21",
  "description": "",
  "dependencies": [],
  "build": {
    "output_dir": "build",
    "cpp_std": "c++11",
    "optimize": "Os",
    "extra_flags": [],
    "source_map": false
  }
}
```

**Go struct:**
```go
// internal/manifest/manifest.go

type Manifest struct {
    Name         string       `json:"name"`
    Version      string       `json:"version"`
    Board        string       `json:"board"`
    GoVersion    string       `json:"go_version"`
    Description  string       `json:"description,omitempty"`
    Dependencies []Dependency `json:"dependencies"`
    Build        BuildConfig  `json:"build"`
}

type Dependency struct {
    Name    string `json:"name"`
    Version string `json:"version"`
    Kind    string `json:"kind"` // "go" | "arduino" | "local"
}

type BuildConfig struct {
    OutputDir   string   `json:"output_dir"`
    CppStd      string   `json:"cpp_std"`
    Optimize    string   `json:"optimize"`
    ExtraFlags  []string `json:"extra_flags"`
    SourceMap   bool     `json:"source_map"`
}

func Load(dir string) (*Manifest, error) {
    data, err := os.ReadFile(filepath.Join(dir, "goduino.json"))
    if err != nil { return nil, err }
    var m Manifest
    return &m, json.Unmarshal(data, &m)
}

func (m *Manifest) Save(dir string) error {
    data, _ := json.MarshalIndent(m, "", "  ")
    return os.WriteFile(filepath.Join(dir, "goduino.json"), data, 0644)
}
```

---

## Dependency management

```
goduino-registry/          ← future hosted package index
├── packages.json           ← { "github.com/goduino/ws2812": { "0.2.1": { ... } } }
└── checksums.json
```

Local cache at:
- Linux:   `~/.cache/goduino/packages/`
- Windows: `%LOCALAPPDATA%\goduino\packages\`

**Resolution algorithm:**
1. For each dep in manifest, fetch metadata from registry.
2. Resolve semver ranges (`^1.0`, `~2.3`, `>=1.5 <2`) to concrete versions.
3. Detect conflicts (same package, incompatible versions).
4. Download & verify sha256 checksum.
5. Write `goduino.lock` with all resolved concrete versions.

---

## Board detection

```go
// internal/board/detect.go

import "go.bug.st/serial"

var arduinoVIDs = map[string][]string{
    "2341": {"uno", "leonardo", "mega", "due", "micro", "mkr1000"},
    "1A86": {"uno", "nano", "esp32"},  // CH340 clone
    "10C4": {"esp32"},                  // CP2102
    "2E8A": {"pico"},
}

func Detect() ([]DetectedBoard, error) {
    ports, err := serial.GetPortsList()
    // ...
    // For each port, read VID/PID from sysfs (Linux) or registry (Windows)
    // Match against arduinoVIDs table
}
```

---

## Build pipeline

```
src/main.go
    │
    │  goduino-core (Rust)
    ▼
build/main.cpp
    │
    │  arduino-cli compile --fqbn <fqbn>
    ▼
build/firmware.hex  (or .bin / .uf2 for ARM)
    │
    │  arduino-cli upload --port <port>
    ▼
Board  ✓
```

### Calling arduino-cli

```go
// internal/build/arduinocli.go

func Compile(fqbn, sketchDir, buildDir string, verbose bool) error {
    args := []string{
        "compile",
        "--fqbn", fqbn,
        "--build-path", buildDir,
        "--warnings", "all",
    }
    if verbose { args = append(args, "--verbose") }
    args = append(args, sketchDir)
    return runCmd("arduino-cli", args...)
}
```

---

## Calling the Rust core

Two options:

### Option A — Shell-out (simplest)

```go
// internal/core/shim.go

func Transpile(inputFile, outputFile, board string, sourceMap bool) error {
    args := []string{inputFile, outputFile, "--board", board}
    if sourceMap { args = append(args, "--source-map") }
    cmd := exec.Command("goduino-core", args...)
    cmd.Stdout = os.Stdout
    cmd.Stderr = os.Stderr
    return cmd.Run()
}
```

Ship both `goduino` (Go) and `goduino-core` (Rust) in the same release archive.

### Option B — CGo FFI (advanced, zero-copy)

Expose a C API from the Rust library:

```rust
// In goduino_core/src/ffi.rs

#[no_mangle]
pub extern "C" fn goduino_transpile(
    source:   *const libc::c_char,
    filename: *const libc::c_char,
    board:    *const libc::c_char,
    out_ptr:  *mut *mut libc::c_char,
    out_len:  *mut libc::size_t,
) -> libc::c_int { ... }

#[no_mangle]
pub extern "C" fn goduino_free(ptr: *mut libc::c_char) { ... }
```

Then in Go:
```go
// #cgo LDFLAGS: -L../goduino-core/target/release -lgoduino_core
// #include "goduino_core.h"
import "C"

func Transpile(source, filename, board string) (string, error) {
    cs := C.CString(source)
    cf := C.CString(filename)
    cb := C.CString(board)
    // ...
}
```

---

## Implementation notes

### Cross-platform serial port paths
| OS      | Pattern              |
|---------|----------------------|
| Linux   | `/dev/ttyUSB*`, `/dev/ttyACM*` |
| macOS   | `/dev/cu.usbserial*`, `/dev/cu.usbmodem*` |
| Windows | `COM1`, `COM2`, … `COM256` |

### Windows installer
Use `go-msi` or NSIS to bundle:
- `goduino.exe`
- `goduino-core.exe`
- `arduino-cli.exe` (optional bundled copy)

### Linux packages
- Provide `.deb` / `.rpm` via GitHub Releases.
- `arduino-cli` listed as a dependency (or bundled).

### Auto-update
Implement `goduino update` that checks GitHub Releases API,
downloads the latest binary for the current OS/arch,
verifies SHA-256, and replaces the current binary.