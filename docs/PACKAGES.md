# Writing a godotinolib Package

A **godotinolib package** is a single `godotinolib.toml` file that maps a Go import to a C++ Arduino library. It requires no compilation — just declare your mappings in TOML and the transpiler does the rest.

---

## File format

```toml
[package]
name        = "my-lib"
version     = "1.0.0"
description = "My awesome Arduino library binding"
author      = "you"
cpp_header  = "MyLib.h"          # injected as #include <MyLib.h>
arduino_lib = "My Arduino Lib"   # exact name in the Arduino Library Manager

# Optional: additional Go import aliases that resolve to this package
aliases = ["myLib", "MyLib"]

# ── Function mappings ─────────────────────────────────────────────────────────
# {0} = first Go argument, {1} = second argument, etc.
# For instance methods the receiver is NOT in the arg list; use a bare method.

[[function]]
go  = "Begin"
cpp = "{0}.begin()"       # {0} = the receiver variable

[[function]]
go  = "SetValue"
cpp = "{0}.setValue({1})"

[[function]]
go  = "New"
cpp = "MyLib({0}, {1})"   # constructor call

# ── Constant mappings ─────────────────────────────────────────────────────────
[[constant]]
go  = "MODE_FAST"
cpp = "MYLIB_MODE_FAST"

[[constant]]
go  = "MODE_SLOW"
cpp = "MYLIB_MODE_SLOW"
```

---

## The `{0}` convention for methods

When Go code calls a method on a variable (e.g. `strip.Show()`), the transpiler
passes the receiver as `{0}` and shifts subsequent arguments to `{1}`, `{2}`, etc.

```toml
# strip.Show()  →  strip.show()
[[function]]
go  = "Show"
cpp = "{0}.show()"

# strip.SetPixelColor(i, color)  →  strip.setPixelColor(i, color)
[[function]]
go  = "SetPixelColor"
cpp = "{0}.setPixelColor({1}, {2})"
```

---

## Install your package

```bash
# From a local file
godotino pkg install ./my-lib/godotinolib.toml

# From a URL
godotino pkg install https://example.com/my-lib/godotinolib.toml
```

## Add it to your project

```bash
godotino pkg add my-lib
```

This adds an entry to `goduino.json`:

```json
{
  "packages": [
    { "name": "my-lib", "version": "^1.0.0" }
  ]
}
```

## Use it in Go

```go
import "my-lib"

var device = mylib.New(9)   // calls MyLib(9)

func setup() {
    device.Begin()           // calls device.begin()
    device.SetValue(42)      // calls device.setValue(42)
}
```

---

## Complete real-world example: BME280

```toml
[package]
name        = "bme280"
version     = "1.0.0"
description = "BME280 pressure / humidity / temperature sensor"
author      = "godotino-team"
cpp_header  = "Adafruit_BME280.h"
arduino_lib = "Adafruit BME280 Library"

aliases = ["BME280"]

[[function]]
go  = "New"
cpp = "Adafruit_BME280()"

[[function]]
go  = "Begin"
cpp = "{0}.begin({1})"

[[function]]
go  = "ReadTemperature"
cpp = "{0}.readTemperature()"

[[function]]
go  = "ReadPressure"
cpp = "{0}.readPressure()"

[[function]]
go  = "ReadHumidity"
cpp = "{0}.readHumidity()"

[[function]]
go  = "ReadAltitude"
cpp = "{0}.readAltitude({1})"

[[constant]]
go  = "ADDR_PRIMARY"
cpp = "BME280_ADDRESS"

[[constant]]
go  = "ADDR_SECONDARY"
cpp = "BME280_ADDRESS_ALTERNATE"
```

---

## Package directory layout

After installation, packages live at:

```
~/.local/share/godotino/libs/
└── bme280/
    └── 1.0.0/
        └── godotinolib.toml
```

Multiple versions can coexist; the build always uses the version declared in `goduino.json`.

---

## How it works end-to-end

```
goduino.json declares   →  "packages": [{"name":"ws2812","version":"^1.0.0"}]
                                        ↓
godotino build          →  resolves  ~/.local/share/godotino/libs/ws2812/1.0.0/godotinolib.toml
                                        ↓
godotino-core           →  loads PkgMap from TOML  (functions + constants + header)
                                        ↓
transpiler              →  ws2812.Show()  →  strip.show()
                           ws2812.NEO_GRB →  NEO_GRB
                                        ↓
output .cpp             →  #include <Adafruit_NeoPixel.h>  + translated calls
```