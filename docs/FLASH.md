# tsuki-flash

> Arduino compile & flash toolchain — replaces `arduino-cli` entirely

`tsuki-flash` is a Rust binary that sits at the bottom of the tsuki stack. It
invokes the AVR / ESP / ARM toolchains **directly**, bypassing arduino-cli's
gRPC daemon, plugin system, and JSON layer entirely.

```
tsuki (Go CLI)
  └─ tsuki-core (Rust)     ← Go → C++ transpiler
       └─ tsuki-flash (Rust)  ← compile .cpp → .hex/.bin  +  flash to board
            └─ Board ✓
```

---

## Why not arduino-cli?

| | arduino-cli | tsuki-flash |
|---|---|---|
| Startup overhead | ~300–500 ms (Go binary + daemon) | ~5 ms |
| Compile: Arduino core | Always recompiles | Cached `core.a`, rebuilt only when SDK changes |
| Sketch files | Sequential | **Parallel** (rayon) |
| Port detection | Subprocess + JSON parse | Direct VID:PID USB lookup (serialport crate) |
| Dependencies | Requires arduino-cli installed + `arduino-cli core install …` | Only needs avr-gcc / avrdude on PATH (already present if arduino-cli was ever used) |
| SDK location | Managed internally | Reads from `~/.arduino15/packages/…` (same cache) |

---

## Installation

```bash
# From the project root
cargo build --release -p tsuki-flash
cp target/release/tsuki-flash ~/.local/bin/

# Tell tsuki to use it
tsuki config set flash_binary ~/.local/bin/tsuki-flash
```

---

## CLI

```
SUBCOMMANDS
  compile   Compile a sketch directory to firmware (.hex / .bin)
  upload    Flash compiled firmware to a connected board
  run       Compile then immediately upload  (shortcut)
  detect    List connected serial ports with board identification
  boards    List all supported boards + FQBN + specs
  sdk-info  Show resolved SDK paths for a board

GLOBAL FLAGS
  -v / --verbose    Print all compiler commands
  --quiet           Suppress progress output (for Go CLI integration)
  --no-color        Disable ANSI colours
```

### `compile`

```bash
tsuki-flash compile \
  --board uno \
  --sketch build/thermometer \
  --build-dir build/.cache \
  --name thermometer \
  --cpp-std c++11 \
  --include ~/.local/share/tsuki/libs/dht/1.0.0
```

### `upload`

```bash
tsuki-flash upload \
  --board uno \
  --build-dir build/.cache \
  --name thermometer
  # --port /dev/ttyUSB0   ← omit for auto-detect
```

### `run`  (compile + upload in one step)

```bash
tsuki-flash run \
  --board uno \
  --sketch build/thermometer \
  --build-dir build/.cache
```

### `detect`

```bash
$ tsuki-flash detect
PORT                 BOARD           VID:PID   NAME
──────────────────────────────────────────────────────────────────────
/dev/ttyUSB0         uno             1A86:7523  Arduino Uno (CH340 clone)
/dev/ttyUSB1         esp32           10C4:EA60  ESP32 (CP2102)
```

---

## Supported boards

| ID | Name | Toolchain | Programmer |
|---|---|---|---|
| `uno` | Arduino Uno | avr-gcc | avrdude/arduino |
| `nano` | Arduino Nano | avr-gcc | avrdude/arduino |
| `nano_old` | Arduino Nano (old bootloader) | avr-gcc | avrdude @57600 |
| `mega` | Arduino Mega 2560 | avr-gcc | avrdude/wiring |
| `leonardo` | Arduino Leonardo | avr-gcc | avrdude/avr109 |
| `micro` | Arduino Micro | avr-gcc | avrdude/avr109 |
| `pro_mini_5v` | Pro Mini 5V | avr-gcc | avrdude |
| `pro_mini_3v3` | Pro Mini 3.3V | avr-gcc @8MHz | avrdude |
| `due` | Arduino Due | *(planned)* | bossac |
| `pico` | Raspberry Pi Pico | *(planned)* | picotool/uf2 |
| `esp32` | ESP32 Dev Module | xtensa-esp32-elf-gcc | esptool |
| `esp32s2` | ESP32-S2 | xtensa-esp32-elf-gcc | esptool |
| `esp32c3` | ESP32-C3 | xtensa-esp32-elf-gcc | esptool |
| `esp8266` | ESP8266 Generic | xtensa-lx106-elf-gcc | esptool |
| `d1_mini` | Wemos D1 Mini | xtensa-lx106-elf-gcc | esptool |
| `nodemcu` | NodeMCU 1.0 | xtensa-lx106-elf-gcc | esptool |

---

## SDK discovery

`tsuki-flash` finds the Arduino SDK (core headers + toolchain) by scanning
these locations in order:

1. `TSUKI_SDK_ROOT` env var (manual override)
2. `~/.arduino15/packages/<vendor>/hardware/<arch>/<version>/`  
   ← the same cache that `arduino-cli core install` populates
3. `~/snap/arduino/current/.arduino15/…`  (Ubuntu Snap install)
4. `/usr/share/arduino/…`  (Arduino IDE 1.x system install)

So if you've ever run `arduino-cli core install arduino:avr`, tsuki-flash will
find the SDK automatically. You do **not** need arduino-cli present at runtime.

Run `tsuki-flash sdk-info <board>` to debug path resolution:

```
✓ SDK found  (1.8.6)
  core:     /home/user/.arduino15/packages/arduino/hardware/avr/1.8.6/cores/arduino
  variant:  /home/user/.arduino15/packages/arduino/hardware/avr/1.8.6/variants/standard
  toolchain:/home/user/.arduino15/packages/arduino/tools/avr-gcc/7.3.0-atmel3.6.1-arduino7/bin
  libraries:/home/user/.arduino15/libraries
```

---

## Incremental build cache

Compiled object files are fingerprinted with SHA-256. On subsequent builds,
only files whose content changed (or whose compiler flags changed) are
recompiled. The Arduino core is archived into `core.a` once and reused until
the SDK version changes.

Cache manifest lives at `<build-dir>/sketch/.tsuki-cache.json`.

To force a full rebuild: `rm -rf build/` or `tsuki clean`.

---

## Architecture

```
src/
  main.rs          CLI entry point (clap)
  boards.rs        Static board database (ID, MCU, FQBN, toolchain, defines)
  sdk.rs           Arduino SDK path discovery
  detect.rs        USB VID:PID → board identification (serialport crate)
  error.rs         Error types (thiserror)
  compile/
    mod.rs         Orchestrator — dispatches to toolchain impl
    avr.rs         AVR pipeline: avr-gcc → core.a + sketch.o → .elf → .hex
    esp.rs         ESP pipeline: xtensa-gcc → .elf → .bin (esptool elf2image)
    cache.rs       SHA-256 incremental build cache
  flash/
    mod.rs         Orchestrator — finds firmware, dispatches to programmer
    avrdude.rs     avrdude wrapper (AVR boards)
    esptool.rs     esptool.py wrapper (ESP32 / ESP8266)
```