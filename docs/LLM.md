# tsuki — LLM Reference

**What it is**: A firmware development framework for Arduino. Users write Go or Python; tsuki transpiles to Arduino C++. No arduino-cli required.

**Stack**:
- `src/` — tsuki-core: Go→C++ and Python→C++ transpiler (Rust library + binary)  
- `flash/` — tsuki-flash: compile/upload without arduino-cli (Rust binary)  
- `cli/` — user CLI: orchestrates core + flash (Go, Cobra)  
- `ide/` — desktop IDE (Tauri + Next.js)  
- `pkg/` — tsukilib external package registry  

**How it all connects**: User runs `tsuki build` → CLI calls `tsuki-core` binary (transpile) → CLI calls `tsuki-flash` or `arduino-cli` (compile) → firmware flashed via avrdude/esptool.

---

## Languages supported

| Language | File ext | Pipeline |
|---|---|---|
| `go` | `.go` | `Pipeline::run()` in tsuki-core |
| `python` | `.py` | `PythonPipeline::run()` in tsuki-core |
| `cpp` | `.cpp` | Compiled directly, no transpile |
| `ino` | `.ino` | Compiled directly, no transpile |

The `language` field in `tsuki_package.json` selects the pipeline. `tsuki-core` also auto-detects from file extension via `--lang` flag.

---

## tsuki-core (`src/`) — Rust

### Go pipeline

```
Lexer::tokenize()       → Vec<Token>
Parser::parse_program() → Program (AST)
Transpiler::generate()  → String (C++)
```

**Entry**: `Pipeline::run(source, filename)` in `src/lib.rs`

### Python pipeline

```
PyLexer::tokenize()       → Vec<PyToken>   (src/python/lexer.rs)
PyParser::parse_program() → PyProgram      (src/python/parser.rs)
PyTranspiler::generate()  → String (C++)   (src/python/transpiler.rs)
```

**Entry**: `PythonPipeline::run(source, filename)` in `src/lib.rs`

Both pipelines accept the same `PipelineOptions { libs_dir, pkg_names }` and reuse the same `Runtime` (package mappings). External tsukilib packages work transparently in both languages.

### Key files

| File | Role |
|---|---|
| `src/lib.rs` | Public API: `Pipeline`, `PythonPipeline`, `PipelineOptions`, `TranspileConfig` |
| `src/main.rs` | Standalone binary. Flags: `--board`, `--lang`, `--packages`, `--libs-dir`, `--check`, `--source-map`. Auto-detects language from file extension. |
| `src/lexer/` | Go tokenizer with auto-semicolons |
| `src/parser/ast.rs` | Go AST. `Type::to_cpp()` maps Go types → C++ types |
| `src/parser/mod.rs` | Recursive descent parser for Go subset |
| `src/transpiler/mod.rs` | Go→C++ emitter. `var_types` HashMap tracks instance variable types for method dispatch |
| `src/transpiler/config.rs` | `TranspileConfig`: board, cpp_std, arduino_string, annotate_unsupported, emit_source_map |
| `src/runtime/mod.rs` | `Runtime`: HashMap of package→`PkgMap`. Built-in packages: fmt, time, math, strconv, arduino, wire, spi, serial, servo, lcd |
| `src/runtime/pkg_loader.rs` | Loads `tsukilib.toml` files from disk. `LibFunction.python` field registers snake_case aliases for Python source |
| `src/runtime/pkg_manager.rs` | Downloads packages from registry URL |
| `src/python/lexer.rs` | Python tokenizer. INDENT/DEDENT via `indent_stack: Vec<usize>`. Handles `0x`/`0b`/`0o` literals, triple-quoted strings, line continuation `\` |
| `src/python/ast.rs` | Python AST: `PyExpr`, `PyStmt`, `PyFuncDef`, `PyImport`, `PyProgram` |
| `src/python/parser.rs` | Recursive descent. Pratt expression parsing. Handles `range()`, type annotations, `->` return type |
| `src/python/transpiler.rs` | Python→C++ emitter. Two-phase borrow pattern for `Runtime` access (see below). `print()→Serial.println()`, `range(n)→for(int i=0;i<n;i++)` |

### Two-phase borrow pattern (important)

`PyTranspiler` must read from `self.rt` (immutable) then call `self.emit_expr()` (mutable). Rust disallows both simultaneously. Solution:

```rust
// Phase 1: clone data out of rt — borrow ends here
let snapshot = self.rt.packages.get(&pkg).and_then(|p| {
    p.functions.get(fn_name).map(|fm| (fm.clone(), p.header.clone()))
});
// Phase 2: &mut self is free
if let Some((fn_map, header)) = snapshot {
    let args = args.iter().map(|a| self.emit_expr(a)).collect()?;
    self.includes.insert(header);
    return Ok(fn_map.apply(&args));
}
```

Use this pattern anywhere in tsuki that reads `Runtime` then emits expressions.

### Runtime / package system

`FnMap` variants:
- `Direct(cpp)` — replaces call with literal C++
- `Template(cpp)` — `{0}` = first arg, `{1}` = second arg, `{self}` = receiver
- `Variadic(cpp)` — `{args}` = all args joined by `, `

`PkgMap` stores `functions`, `constants`, `types`, optional `header` (injected as `#include`), optional `cpp_class`.

External packages loaded from `tsukilib.toml`. Each `[[function]]` entry can have `go` (PascalCase) and `python` (snake_case) name — both are registered in the same `PkgMap`, pointing to the same C++ template.

---

## tsuki-flash (`flash/`) — Rust

Compiles Arduino firmware without arduino-cli. Calls avr-gcc, xtensa-gcc, avrdude, esptool directly.

**Language enum**: `Go | Python | Cpp | Ino`. Python and Go are identical in this stage — tsuki-core already transpiled both to `.cpp` before tsuki-flash is invoked.

```
tsuki-flash compile --board uno --sketch build/sketch/ --build-dir build/.cache/ --language python
tsuki-flash upload  --board uno --port /dev/ttyUSB0 --build-dir build/.cache/
```

Key files: `flash/compile/mod.rs` (dispatcher), `flash/compile/avr.rs`, `flash/compile/esp.rs`, `flash/flash/avrdude.rs`, `flash/sdk.rs` (SDK path resolution), `flash/boards.rs` (board catalog).

---

## CLI (`cli/`) — Go / Cobra

### Commands

| Command | What it does |
|---|---|
| `tsuki init` | Interactive wizard → creates `tsuki_package.json` + `src/main.{go,py,cpp,ino}` |
| `tsuki build` | Transpile (+ optionally compile). Dispatches: `runGo`, `runPython`, `runNative` |
| `tsuki check` | Validate source without output. Supports Go and Python |
| `tsuki upload` | Flash firmware to board |
| `tsuki pkg` | Install/remove/list tsukilib packages |
| `tsuki config` | Read/write `~/.config/tsuki/config.json` |

### Build dispatch (`cli/internal/cli/build.go`)

```
Run() →
  language == "python" → runPython()  ← finds *.py, passes --lang python to core
  language == "go"     → runGo()      ← finds *.go
  language == "cpp"    → runNative()
  language == "ino"    → runNative()
```

### Key files

| File | Role |
|---|---|
| `cli/internal/manifest/manifest.go` | `Manifest` struct, `LangGo/LangPython/LangCpp/LangIno` constants, `EffectiveLanguage()` |
| `cli/internal/cli/build.go` | `Run()`, `runGo()`, `runPython()`, `runNative()`, `compileSketch()` |
| `cli/internal/cli/init.go` | Wizard with arrow-key selection. Templates for all 4 languages |
| `cli/internal/check/check.go` | Language-aware check: finds `*.go` or `*.py` based on manifest |
| `cli/internal/core/core.go` | Shell-out wrapper for tsuki-core. `TranspileRequest.Language` → `--lang` flag. `CheckFile(file, board, lang, ...)` |
| `cli/internal/pkgmgr/pkgmgr.go` | Downloads and installs tsukilib packages |

---

## IDE (`ide/`) — Tauri + Next.js

### Key files

| File | Role |
|---|---|
| `ide/src/lib/store.ts` | Zustand global state. `projectLanguage: 'go'|'python'|'cpp'|'ino'`. Templates for all 4 languages. `loadProject()` and `loadFromDisk()` handle Python `.py` files |
| `ide/src/lib/highlight.ts` | Syntax highlighting. `highlightByExt()` dispatches to `highlightGo`, `highlightCpp`, `highlightPython` by file extension |
| `ide/src/components/other/NewProjectModal.tsx` | Project creation wizard. `LANGUAGES` array includes Python. `TEMPLATES_BY_LANG` has Python templates |
| `ide/src-tauri/src/main.rs` | Tauri commands: spawn_process, read_file, write_file, run_git, load_settings, etc. |
| `ide/src/components/sandbox/SandboxPanel.tsx` | Circuit simulator. Invokes `tsuki-sim` directly |

### Python in the IDE

- New project modal shows Python as a language option
- Editor highlights `.py` files with Python tokens (`def`, `import`, `#` comments, etc.)
- `loadProject` creates `src/main.py` with a Python blink template
- `loadFromDisk` detects `language: "python"` in `tsuki_package.json` and opens `.py` files
- Build toolbar calls `tsuki build` which auto-handles Python via `tsuki_package.json`

---

## External packages (`pkg/`)

Format: `pkg/<name>/v<version>/godotinolib.toml`

```toml
[package]
name       = "dht"
cpp_header = "DHT.h"
cpp_class  = "DHT"

[[function]]
go     = "ReadTemperature"   # Go name (PascalCase)
python = "read_temperature"  # Python name (snake_case) — OPTIONAL
cpp    = "{0}->readTemperature()"

[[constant]]
go     = "DHT22"
python = "DHT22"             # constants keep UPPER_SNAKE in Python too
cpp    = "DHT22"
```

Both names are registered in the same `PkgMap` in `pkg_loader.rs`. Go source uses `dht.ReadTemperature`, Python uses `dht.read_temperature` — both emit `->readTemperature()`.

**Available packages**: `dht`, `ws2812`, `u8g2`, `irremote`, `mpu6050`, `stepper`, `bmp280`

Each package has Go examples (`examples/basic/main.go`) and Python examples (`examples/basic_py/main.py`).

---

## tsuki_package.json format

```json
{
  "name": "my-project",
  "version": "0.1.0",
  "board": "uno",
  "language": "python",
  "backend": "tsuki-flash",
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

`language` values: `"go"` (default), `"python"`, `"cpp"`, `"ino"`

---

## Python example (what users write)

```python
import arduino
import dht
import time

SENSOR_PIN: int = 2
sensor = dht.new(SENSOR_PIN, dht.DHT22)

def setup():
    arduino.Serial.begin(9600)
    sensor.begin()

def loop():
    temp: float = sensor.read_temperature()
    hum: float  = sensor.read_humidity()
    print(temp)
    time.sleep(2000 * time.Millisecond)
```

Transpiles to the same C++ as the equivalent Go sketch.

---

## Code conventions

- **Rust**: `snake_case` functions, `PascalCase` types. All errors via `TsukiError`. Runtime packages initialized in `init_*()` methods.
- **Go**: `PascalCase` exports, packages under `internal/`. Each Cobra subcommand in its own file.
- **TypeScript**: Components `PascalCase`, hooks/stores `camelCase`. Zustand store is single source of truth.
- **Terminology**: "coordination layer" (CLI), "dispatcher" (flash compile/flash modules). Never "orchestrator".