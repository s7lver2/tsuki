# tsuki-webkit

> JSX → HTML/CSS/JS compiler for ESP8266/ESP32 control panels.  
> Write React-style components. Flash them. Open a browser.

---

## Overview

tsuki-webkit is a **zero-dependency Rust library** that compiles JSX into a self-contained HTML page, then embeds it as a PROGMEM string in a C++ fragment. The tsuki-flash build pipeline injects that fragment automatically before compilation — no boilerplate needed.

```
app.jsx   →  [tsuki-webkit]  →  dist/index.html
                              →  dist/webkit.cpp  (injected by tsuki-flash)
                              →  main.go          (your logic)
               [tsuki-flash]  →  firmware.bin
```

---

## Quick start

```bash
# 1. Scaffold (inside an existing tsuki project)
tsuki webkit init

# 2. Write your UI in app.jsx (see below)

# 3. Build
tsuki webkit build --board esp8266

# 4. Flash as normal
tsuki build --board esp8266
tsuki upload --port /dev/ttyUSB0

# 5. Open http://<board-ip> in any browser on the same WiFi
```

---

## app.jsx — supported imports

```jsx
import { Api, Json, Serial } from 'tsuki-webkit'
```

| Import   | Description |
|----------|-------------|
| `Api`    | HTTP helpers to call endpoints your Go handler exposes |
| `Json`   | `JSON.parse` / `JSON.stringify` aliases |
| `Serial` | Write to an on-page serial console `<div id="__serial_log">` |

### Api

```js
Api.get('/api/status', data => { /* data is parsed JSON */ })
Api.post('/api/led', { state: 1 }, resp => { /* resp is parsed JSON */ })
Api.poll('/api/sensors', data => { /* called every ms */ }, 2000)
```

### Serial

```js
Serial.log('message')          // appends to #__serial_log
Serial.read(cb)                // GET /serial → cb(data)
Serial.write('cmd')            // POST /serial with body
```

---

## tsuki-webkit.conf.json

```json
{
  "Name": "My Dashboard",
  "Author": "you",
  "Version": "1.0.0",
  "Description": "ESP8266 control panel",
  "app": {
    "Entrypoint": "app.jsx"
  }
}
```

---

## main.go — wiring

```go
package main

import (
  "arduino"
  "tsuki-webkit"
)

const app = tsuki-webkit.ApiInit()

func setup() {
  app.WiFi("YourSSID", "YourPassword")

  app.Handle("GET", "/api/status", func(req tsuki-webkit.Request) tsuki-webkit.Response {
    return tsuki-webkit.JSON(map[string]interface{}{"ok": true})
  })

  app.setup()
}

func loop() {
  app.tick()
}
```

---

## Built-in CSS classes

| Class        | Description |
|--------------|-------------|
| `wk-card`    | Dark rounded card panel |
| `wk-btn`     | Blue action button |
| `wk-input`   | Dark text input |
| `wk-label`   | Muted section label |
| `wk-badge`   | Inline status pill |
| `wk-row`     | Horizontal flex row |
| `wk-col`     | Vertical flex column |
| `wk-serial`  | Monospace serial log box |

All classes are injected automatically — no external stylesheet needed.

---

## IDE integration

### Sandbox — Webkit tab

Every project has a **Webkit** tab in the Sandbox panel that shows a static render of `app.jsx`. No board required.

### Sandbox — Simulate Webkit

When an **ESP8266 or ESP32** board is selected, a **Simulate Webkit** toggle appears in the Sandbox header. Enabling it switches the preview to a fully interactive simulation:

- **Preview tab** — live render that responds to button clicks
- **Serial tab** — mock Serial.log output + send commands
- **Routes tab** — edit mock JSON responses for every API route

### LSD recommendations

When the LSP/LSD engine detects imports of `ESP8266WebServer`, `ESPAsyncWebServer`, `AsyncTCP`, or similar libraries on an ESP board, it shows an info diagnostic suggesting migration to tsuki-webkit.

---

## CLI reference

```
tsuki webkit build   [--board esp8266|esp32] [--config path] [--out dist/]
tsuki webkit check   [--config path]
tsuki webkit init
tsuki webkit info
tsuki webkit preview
```

---

## Supported boards

| Board ID   | Board              | Server include          |
|------------|--------------------|-------------------------|
| `esp8266`  | ESP8266 NodeMCU v3 | `<ESP8266WebServer.h>`  |
| `esp32`    | ESP32 Dev Module   | `<WebServer.h>`         |

---

## Rust library (`libs/tsuki-webkit/`)

The compiler is a standalone Rust crate with **zero external dependencies**:

```
src/
  lib.rs        — public API: compile(jsx, config, board) → WebkitOutput
  lexer.rs      — hand-written JSX tokenizer
  parser.rs     — recursive descent JSX parser → AST
  codegen.rs    — AST → HTML + CSS + JS
  injector.rs   — HTML → C++ PROGMEM fragment
  config.rs     — tsuki-webkit.conf.json parser
  error.rs      — error types
  main.rs       — CLI binary entry point
```

Build:
```bash
cd libs/tsuki-webkit
cargo build --release
# binary at target/release/tsuki-webkit
```
