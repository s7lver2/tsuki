# tsuki — LLM Project Reference

> **Propósito de este documento**: Dar a un LLM un mapa mental completo del proyecto tsuki: qué es, cómo está estructurado, qué hace cada archivo y cómo fluye la ejecución. No repite ningún README ni documentación preexistente.

---

## ¿Qué es tsuki?

tsuki es un **framework de desarrollo de firmware para Arduino escrito en Go**. El usuario escribe código Go con una sintaxis familiar y tsuki lo transpila a C++ compatible con Arduino. El ecosistema incluye:

- Un transpilador Go→C++ (Rust, biblioteca + binario)
- Una toolchain de compilación/flash sin dependencia de arduino-cli (Rust, binario)
- Una CLI de gestión de proyectos (Go)
- Un IDE de escritorio (Tauri + Next.js)
- Un sistema de paquetes propio (`tsukilib`)

---

## Árbol de componentes de alto nivel

```
tsuki/
├── src/              ← tsuki-core: transpilador + librería Rust pública
├── flash/            ← tsuki-flash: compilación y upload sin arduino-cli
├── cli/              ← tsuki CLI en Go (herramienta de usuario)
├── ide/              ← IDE de escritorio (Tauri + Next.js)
└── pkg/              ← Datos del registro de paquetes tsukilib
```

Cada componente es un binario/ejecutable independiente que se comunica con los demás mediante invocación de procesos (no IPC).

---

## Flujo de ejecución completo

```
Usuario escribe  main.go
        │
        ▼
[tsuki CLI]  tsuki build --board uno --compile
        │
        ├─► Lee  tsuki_package.json  (manifiesto del proyecto)
        │
        ├─► Invoca  tsuki-core  (Rust binary)
        │         Go source → C++ source (transpile)
        │         Escribe archivos .cpp en build/<name>/
        │         Escribe stub  build/<name>/<name>.ino
        │
        └─► Invoca backend de compilación:
              ├── arduino-cli compile  (backend por defecto)
              └── tsuki-flash compile  (backend alternativo, sin arduino-cli)
                        │
                        ▼
                  Firmware .hex / .bin
                        │
        tsuki upload ──►│
                        ▼
                [avrdude / esptool] → Board física
```

---

## Componente 1: `src/` — tsuki-core (Rust)

**Qué es**: La biblioteca y binario central del transpilador. Convierte código Go (subconjunto) a C++ Arduino.

**Binarios que genera el Cargo.toml raíz**:
- `tsuki-core` (binario standalone, entry point `src/main.rs`)
- `tsuki_core` (librería reutilizable por la CLI y el IDE)

### Pipeline de transpilación (en orden de ejecución)

```
Pipeline::run(source, filename)
    │
    ├── 1. Lexer::tokenize()      → Vec<Token>
    ├── 2. Parser::parse_program() → Program (AST)
    └── 3. Transpiler::generate() → String (C++)
```

### Archivos de `src/`

| Archivo | Rol |
|---|---|
| `src/main.rs` | Binario standalone. Parsea flags CLI (`--board`, `--packages`, `--libs-dir`, `--check`, `--source-map`). Maneja subcomando `pkg` (list, install, remove, update, installed, info). Construye un `Pipeline` y lo ejecuta. |
| `src/lib.rs` | API pública de la librería `tsuki_core`. Expone `Pipeline`, `PipelineOptions`, `TranspileConfig`, `Runtime`, `Board`, y la función `pretty_error`. Re-exporta todos los módulos. |
| `src/error.rs` | Tipos de error unificados. `tsukiError` es un enum con variantes `Lex`, `Parse`, `Type`, `Codegen`, `Io`, `Json`, `Other`. Cada una lleva un `Span` (file, line, col, offset). `pretty_error()` renderiza un diagnóstico con flecha `^` apuntando al error en la línea fuente. |
| `src/lexer/token.rs` | Define `TokenKind` (todos los tokens de Go: literales, keywords, operadores, delimitadores) y `Token` (kind + span + raw text). Incluye tabla de keywords (`keyword()` fn) y métodos de precedencia para operadores binarios. |
| `src/lexer/mod.rs` | `Lexer` struct. Consume caracteres del source y produce `Vec<Token>` via `tokenize()`. Maneja comentarios (`//` y `/* */`), strings con escapes, runas, números (enteros y floats con prefijos `0x`/`0b`/`0o`), y auto-inserción de semicolons al estilo Go. |
| `src/parser/ast.rs` | Define el AST completo para el subconjunto de Go soportado. Tipos principales: `Type` (primitivos, punteros, arrays, slices, maps, structs, interfaces, Named), `Expr` (literales, Ident, Binary, Unary, Call, Index, Slice, Select, TypeAssert, Composite, FuncLit, Raw), `Stmt` (todos los statements de Go), `Decl` (Func, Var, Const, TypeDef, StructDef). El método `Type::to_cpp()` convierte tipos Go a C++ Arduino (e.g. `int32` → `int32_t`, `String` → `String`). |
| `src/parser/mod.rs` | `Parser` struct. Consume `Vec<Token>` y produce un `Program` (AST). Implementa parsing recursivo descendente. Maneja el subconjunto Go: funciones (incluyendo métodos con receiver), structs, variables, constantes, todos los statements (if/for/switch/return/defer/go/select), y expresiones con precedencia de operadores. |
| `src/transpiler/config.rs` | `TranspileConfig` struct. Campos: `board` (id de board destino), `cpp_std` (e.g. `"c++11"`), `arduino_string` (usa `String` o `const char*`), `annotate_unsupported` (comenta goroutines/defer/channels en lugar de ignorarlos), `emit_source_map` (emite `#line` pragmas), `passthrough_unknown` (pasa paquetes desconocidos como C++ crudo). |
| `src/transpiler/mod.rs` | `Transpiler` struct. Tiene un `Runtime` (mapa de paquetes Go→C++) y un `TranspileConfig`. El método `generate(&Program)` produce el C++ final: emite `#include`s, structs, typedefs, constantes, variables globales, forward declarations de funciones, y las funciones en orden (garantizando que `setup()` y `loop()` van al final). Mantiene `var_types: HashMap<String, String>` para rastrear qué variable es de qué tipo de paquete (para dispatch de métodos de instancia). |
| `src/runtime/mod.rs` | `Runtime` struct. Es el mapa central Go package → C++ API. Contiene `packages: HashMap<String, PkgMap>` y `builtins: HashMap<String, FnMap>`. `FnMap` tiene tres variantes: `Direct` (reemplaza la llamada completa), `Template` (usa `{0}`, `{1}`, `{self}` como placeholders), `Variadic` (junta todos los args con `, `). Paquetes built-in registrados: `fmt`, `time`, `math`, `strconv`, `arduino`, `wire`/`Wire`, `spi`/`SPI`, `serial`/`Serial`, `servo`/`Servo`, `lcd`/`LiquidCrystal`. También define `Board::catalog()` con todos los boards soportados (Uno, Nano, Mega, ESP32, ESP8266, Pico, Teensy, Portenta, etc.). |
| `src/runtime/pkg_loader.rs` | Carga paquetes externos desde archivos `tsukilib.toml` en disco. `scan_libs_dir()` busca recursivamente en `~/.local/share/tsuki/libs/<name>/<version>/tsukilib.toml`. `load_from_file()` y `load_from_str()` parsean el TOML y construyen un `PkgMap`. `install_from_toml()` escribe el TOML en la ruta correcta. Define la ruta default de libs (`~/.local/share/tsuki/libs` en Linux/macOS, `%APPDATA%\tsuki\libs` en Windows). |
| `src/runtime/pkg_manager.rs` | Gestión de paquetes online. `fetch_registry(url)` descarga y parsea el JSON del registro remoto. `install(pkg@ver, libs_dir, registry)` descarga el TOML del paquete y lo instala. `remove(pkg@ver, libs_dir)` borra el directorio. `update_all(libs_dir, registry)` actualiza todos los paquetes instalados. `list_installed(libs_dir)` lista los paquetes locales. URL del registro por defecto: `https://raw.githubusercontent.com/s7lver/tsuki-pkgs/main/registry.json`. |

---

## Componente 2: `flash/` — tsuki-flash (Rust)

**Qué es**: Toolchain de compilación y upload de Arduino **sin necesidad de arduino-cli**. Invoca directamente `avr-gcc`, `esptool.py`, `avrdude`, etc.

**Binario**: `tsuki-flash` (definido en `Cargo.toml` con path `flash/main.rs`)

### Subcomandos de tsuki-flash

| Subcomando | Descripción |
|---|---|
| `compile --board <id> --sketch <dir> --build-dir <dir>` | Compila un sketch a firmware (.hex/.bin) |
| `upload --board <id> --port <port> --build-dir <dir>` | Sube firmware a un board |
| `run` | Compile + upload en un solo paso |
| `detect` | Detecta boards/puertos seriales conectados |
| `boards` | Lista todos los boards soportados |
| `sdk-info <board>` | Muestra rutas del SDK para un board |
| `lib install/search/list/info/update` | Gestión de librerías Arduino |
| `modules install/list/update` | Gestión de cores Arduino via tsuki-modules |

### Archivos de `flash/`

| Archivo | Rol |
|---|---|
| `flash/main.rs` | Entry point del binario. Parsea subcomandos con Clap. Handlers: `cmd_compile`, `cmd_upload`, `cmd_run`, `cmd_detect`, `cmd_boards`, `cmd_sdk_info`, `cmd_lib`, `cmd_modules`. Incluye renderizado de errores con colores (colored crate). Detecta automáticamente el puerto si no se especifica. |
| `flash/boards.rs` | Base de datos de boards. `Toolchain` enum: `Avr` (mcu, f_cpu, programmer, baud), `Sam`, `Rp2040`, `Esp32` (variant), `Esp8266`. `Board` struct con id, name, fqbn, variant (pins_arduino.h folder), flash_kb, ram_kb, toolchain, defines. `Board::catalog()` retorna slice estático de todos los boards. |
| `flash/detect.rs` | Detección de puertos serie sin librerías externas. Linux: lee `/sys/class/tty/`, sube el árbol sysfs para encontrar `idVendor`/`idProduct`. macOS: lista `/dev/cu.*`, usa `ioreg` para VID:PID. Windows: usa `wmic` o el registro de Windows. Tabla `VID_PID_MAP` mapea (VID, PID) → (board_id, board_name). |
| `flash/compile/mod.rs` | Orquestador de compilación. `Language` enum (Go, Cpp, Ino). `CompileRequest` struct. `compile()` dispatcha a `avr::compile()` o `esp::compile()` según el toolchain del board. |
| `flash/compile/avr.rs` | Compilación para AVR (atmega328p, etc.). Invoca `avr-gcc` para cada `.cpp`, luego `avr-gcc` para link al `.elf`, luego `avr-objcopy` para `.hex`. Usa flags de board (MCU, F_CPU, etc.). |
| `flash/compile/esp.rs` | Compilación para ESP32/ESP8266. Invoca `xtensa-esp32-elf-gcc` o `xtensa-lx106-elf-gcc`. |
| `flash/compile/cache.rs` | Sistema de caché para compilaciones. Evita recompilar archivos que no han cambiado (hashing SHA-2 de fuentes). |
| `flash/flash/mod.rs` | Orquestador de upload. `FlashRequest` struct. Dispatcha a `avrdude::flash()` o `esptool::flash()`. |
| `flash/flash/avrdude.rs` | Upload via avrdude para boards AVR. Construye el comando con programmer, port, baud, y archivo .hex. |
| `flash/flash/esptool.rs` | Upload via esptool.py para ESP32/ESP8266. |
| `flash/sdk.rs` | Resolución de rutas del SDK Arduino. Busca el SDK en `.arduino15` (arduino-cli) o en `~/.tsuki/modules` (tsuki-modules). `resolve(arch, variant)` retorna `SdkPaths` con core_dir, variant_dir, toolchain_bin, libraries_dir. |
| `flash/cores/mod.rs` | Gestión de cores Arduino via tsuki-modules. `install(arch)` descarga e instala un core. `list()` lista los instalados. `is_installed(arch)` check rápido. |
| `flash/cores/avr.rs` | Lógica específica para el core AVR. `ensure()` auto-instala el core AVR si no está presente (descarga ~40 MB, primera vez). |
| `flash/lib_manager.rs` | Gestión de librerías Arduino (.arduino15/libraries). Usa el índice de librerías de arduino-cli. `install(name)`, `search(query)`, `list()`, `info(name)`. |
| `flash/error.rs` | Tipos de error específicos de flash: `UnknownBoard`, `SdkNotFound`, `ToolchainNotFound`, `CompileFailed`, `LinkFailed`, `FlashFailed`, `NoBoardDetected`, etc. |

---

## Componente 3: `cli/` — tsuki CLI (Go)

**Qué es**: La herramienta de línea de comandos que el usuario usa directamente. Escrita en Go, usa Cobra para subcomandos. Orquesta tsuki-core y tsuki-flash invocándolos como procesos externos.

**Módulo Go**: `github.com/tsuki/cli`

### Subcomandos de la CLI

| Comando | Descripción |
|---|---|
| `tsuki init` | Crea un proyecto nuevo con `tsuki_package.json` y estructura de directorios |
| `tsuki build` | Transpila (y opcionalmente compila) el proyecto |
| `tsuki upload` | Sube el firmware compilado al board |
| `tsuki check` | Solo valida el código Go sin producir output |
| `tsuki config get/set/list` | Gestiona la configuración persistente (~/.config/tsuki/config.json) |
| `tsuki boards` | Lista boards soportados |
| `tsuki pkg install/remove/list/search/update` | Gestiona paquetes tsukilib |
| `tsuki clean` | Borra el directorio build/ |

### Archivos de `cli/`

| Archivo | Rol |
|---|---|
| `cli/cmd/tsuki/main.go` | Entry point. Llama `cli.Execute()`. |
| `cli/internal/cli/root.go` | Comando raíz Cobra. Define flags globales (`--verbose`, `--no-color`). Carga la config en `PersistentPreRunE`. Registra todos los subcomandos. Muestra el banner ASCII de tsuki. |
| `cli/internal/cli/build.go` | Lógica del comando `build`. `Run(projectDir, manifest, opts)` es la función central. Para proyectos Go: transpila cada `.go` con tsuki-core, escribe `.cpp` en `build/<name>/`, genera stub `.ino`, luego (si `--compile`) invoca el backend (arduino-cli o tsuki-flash). Para proyectos C++/ino: copia los fuentes al sketch dir directamente. `compileSketch()` dispatcha entre `compileTsukiFlash()` y `compileArduinoCLI()`. |
| `cli/internal/cli/upload.go` | Comando `upload`. Invoca tsuki-flash o arduino-cli para subir el .hex al board. |
| `cli/internal/cli/check.go` | Comando `check`. Invoca tsuki-core con `--check`. |
| `cli/internal/cli/init.go` | Comando `init`. Crea el directorio del proyecto, `tsuki_package.json`, `src/main.go` con template, y `.gitignore`. |
| `cli/internal/cli/pkg.go` | Comando `pkg`. Subcomandos: install, remove, list, search, update. Delega a `pkgmgr`. |
| `cli/internal/cli/config.go` | Comando `config`. Subcomandos: get, set, list, path. Usa reflection para leer/escribir campos de Config por nombre JSON. |
| `cli/internal/cli/boards.go` | Comando `boards`. Lista los boards con sus FQBNs. |
| `cli/internal/manifest/manifest.go` | Manifiesto del proyecto (`tsuki_package.json`). Struct `Manifest` con: name, version, board, language (`go`/`cpp`/`ino`), backend (`tsuki-flash`/`tsuki-flash+cores`/`arduino-cli`), packages (lista de `{name, version}`), build config. `Load()`, `Save()`, `Find()` (busca hacia arriba en el árbol de directorios). `PackageNames()` retorna solo los nombres. `AddPackage()`/`RemovePackage()` modifican la lista. |
| `cli/internal/config/config.go` | Configuración persistente del usuario. Struct `Config` con rutas a binarios (tsuki-core, arduino-cli, tsuki-flash), backend, board por defecto, baud, color, verbose, libs_dir, registry_urls (soporta múltiples registros), keys_dir, verify_signatures. `ResolvedRegistryURLs()` combina env var + config + legacy field + default. Serializada en `~/.config/tsuki/config.json`. |
| `cli/internal/pkgmgr/pkgmgr.go` | Gestión de paquetes desde la CLI. Descarga tsukilib.toml del registro, verifica firma Ed25519 (si `verify_signatures=true`), instala en `libs_dir/<name>/<version>/`. Soporta múltiples registros. |
| `cli/internal/core/core.go` | Wrapper para invocar `tsuki-core` como proceso. `TranspileRequest` y `TranspileResult`. `Transpiler.Transpile()` construye el comando con todos los flags y parsea stdout/stderr. |
| `cli/internal/flash/flash.go` | Wrapper para invocar `tsuki-flash` como proceso. |
| `cli/internal/build/build.go` | Helpers de build (sanitización de nombres de sketch, escritura del stub .ino, etc.). |
| `cli/internal/check/check.go` | Helpers para el comando check. |
| `cli/internal/ui/ui.go` | Utilidades de UI para la CLI: spinners animados, colores, banners de sección, `Traceback()` (muestra errores de compilación con estilo Python), `Success()`, `Fail()`, `Warn()`, `Info()`. |

---

## Componente 4: `ide/` — IDE de escritorio (Tauri + Next.js)

**Qué es**: Un IDE de escritorio para tsuki. Frontend en Next.js + React, backend nativo en Rust via Tauri. El proceso Rust llama a los binarios de tsuki-core y tsuki-flash como subprocesos.

### Estructura del IDE

```
ide/
├── src/                     ← Next.js app
│   ├── app/                 ← App Router de Next.js
│   │   ├── page.tsx         ← Página raíz (renderiza IdeScreen)
│   │   ├── layout.tsx       ← Layout global con fuentes y metadata
│   │   └── globals.css      ← Estilos globales y variables CSS
│   ├── components/
│   │   ├── ide/             ← Componentes principales del IDE
│   │   ├── sandbox/         ← Simulador visual de Arduino
│   │   └── ui/              ← Primitivos UI reutilizables
│   └── lib/
│       ├── store.ts         ← Estado global (Zustand)
│       ├── tauri.ts         ← Bridge Tauri: FS, procesos, shell, git
│       ├── highlight.ts     ← Syntax highlighting
│       └── themes.ts        ← Temas de editor y UI
└── src-tauri/               ← Backend Rust de Tauri
    └── src/main.rs          ← Comandos Tauri: spawn_process, read_file, etc.
└── tsuki-sim/               ← Simulador de Arduino (WASM)
    └── src/lib.rs           ← Lógica de simulación
```

### Archivos clave del IDE

| Archivo | Rol |
|---|---|
| `ide/src/lib/store.ts` | Store global con Zustand. Define tipos: `Screen` (welcome/ide/settings), `SidebarTab` (files/git/packages), `BottomTab` (output/problems/terminal), `FileNode`, `TabItem`, `GitChange`, `GitCommitNode`, `LogLine`, `Problem`, `PackageEntry`, `RecentProject`, `SettingsState`. Centraliza todo el estado del IDE. |
| `ide/src/lib/tauri.ts` | Bridge completo hacia Tauri. `isTauri()` detecta el entorno. Funciones: `spawnProcess()` (lanza un proceso con streaming line-by-line via eventos Tauri), `spawnShell()` (sesión de shell interactiva), `detectTool()` (busca un binario en PATH), `pickFolder()`/`pickFile()` (diálogos nativos), `readFile()`/`writeFile()`/`createDirectory()`/`deleteFile()`/`renamePath()`, `readDirEntries()`, `loadSettings()`/`saveSettings()` (con fallback a localStorage fuera de Tauri), `listShells()`, `runGit()`. Fuera de Tauri todas las funciones de disco/proceso lanzan error. |
| `ide/src/components/ide/IdeScreen.tsx` | Componente raíz del IDE. Layout con sidebar izquierdo (files/git/packages), área central (editor), panel inferior (output/terminal/problems). |
| `ide/src/components/ide/CodeEditor.tsx` | Editor de código con syntax highlighting. Muestra tabs de archivos abiertos. |
| `ide/src/components/ide/FilesSidebar.tsx` | Árbol de archivos del proyecto. Operaciones: abrir, crear, renombrar, borrar. Lee el filesystem via tauri.ts. |
| `ide/src/components/ide/GitSidebar.tsx` | Panel de Git. Muestra cambios staged/unstaged, historial de commits con grafo, operaciones básicas (stage, commit, push). |
| `ide/src/components/ide/PackagesSidebar.tsx` | Gestión de paquetes tsukilib. Lista paquetes disponibles e instalados. Permite instalar/desinstalar via tsuki pkg. |
| `ide/src/components/ide/BottomPanel.tsx` | Panel inferior con tabs: output del proceso de build, lista de problemas/errores, terminal interactivo. |
| `ide/src/components/ide/SandboxPanel.tsx` | Panel del simulador visual. Muestra el estado del simulador (pines, LEDs, etc.). |
| `ide/src/components/ide/WelcomeScreen.tsx` | Pantalla de bienvenida. Lista proyectos recientes, botones para crear/abrir proyecto. |
| `ide/src/components/ide/NewProjectModal.tsx` | Modal para crear un proyecto nuevo. Selección de nombre, board, y lenguaje. |
| `ide/src/components/ide/SettingsScreen.tsx` | Pantalla de configuración. Tabs: CLI (rutas a binarios), Defaults, Editor, Appearance, Sandbox. |
| `ide/src/components/sandbox/SandboxDefs.ts` | Definiciones de componentes del simulador (pines, formas, propiedades). |
| `ide/src/components/sandbox/SandboxPanel.tsx` | Componente visual del simulador. Renderiza el estado del board simulado. |
| `ide/src/components/sandbox/SandboxShapres.tsx` | Formas SVG del simulador (LEDs, botones, displays, etc.). |
| `ide/src/components/ui/primitives.tsx` | Componentes UI base reutilizables (botones, inputs, etc.). |
| `ide/src/lib/highlight.ts` | Syntax highlighting para Go y C++. |
| `ide/src/lib/themes.ts` | Definición de temas del editor. `applyTheme()` y `applyUiScale()` modifican variables CSS. |
| `ide/src-tauri/src/main.rs` | Backend Rust del IDE. Define comandos Tauri: `spawn_process` (lanza procesos con streaming de stdout/stderr via eventos), `write_stdin`, `kill_process`, `spawn_shell`, `list_shells`, `detect_tool`, `read_file`, `write_file`, `create_dir`, `delete_file`, `rename_path`, `read_dir_entries`, `load_settings`, `save_settings`, `pick_file`, `run_git`. |
| `ide/tsuki-sim/src/lib.rs` | Simulador de Arduino compilado a WASM. Simula el estado de pines digitales/analógicos, permite "ejecutar" el firmware transpilado en el navegador. |

---

## Componente 5: `pkg/` — Registro de paquetes

**Qué es**: Los datos del registro oficial de paquetes tsukilib, hosteados en el repo de GitHub.

| Archivo | Rol |
|---|---|
| `pkg/packages.json` | Registro JSON con todos los paquetes disponibles. Formato: `{packages: {<name>: {description, author, latest, versions: {<ver>: <url>}}}}`. Contiene: ws2812, dht, hcsr04, u8g2. La CLI lo descarga desde GitHub al instalar paquetes. |
| `pkg/<name>/v<ver>/godotinolib.toml` | Manifiesto de cada paquete. Secciones: `[package]` (name, version, description, author, cpp_header, arduino_lib, aliases, cpp_class), `[[function]]` (go, cpp), `[[constant]]` (go, cpp), `[[type]]` (go, cpp). Las funciones usan `{0}`, `{1}` como placeholders de argumentos y `{self}` para el receiver. |
| `pkg/keys/index.json` | Índice de claves públicas Ed25519 para verificación de firmas de paquetes. |

### Paquetes tsukilib disponibles

| Paquete | Descripción | C++ subyacente |
|---|---|---|
| `ws2812` / `neopixel` | LEDs RGB WS2812 / NeoPixel | `Adafruit_NeoPixel.h` |
| `dht` | Sensor temperatura/humedad DHT11/DHT22 | `DHT.h` |
| `hcsr04` | Sensor ultrasónico de distancia HC-SR04 | Custom |
| `u8g2` | Displays monocromáticos (OLED SSD1306, SH1106) | `U8g2.h` |

---

## Archivos raíz del proyecto

| Archivo | Rol |
|---|---|
| `Cargo.toml` | Workspace Rust. Define dos binarios (`tsuki-core` en `src/main.rs`, `tsuki-flash` en `flash/main.rs`) y una librería (`tsuki_core` en `src/lib.rs`). Dependencias clave: `thiserror`, `serde`/`serde_json`, `toml`, `clap`, `rayon`, `sha2`, `ureq`, `zip`, `colored`, `walkdir`. |
| `Makefile` | Targets de build para todos los componentes (core, flash, cli, ide). |
| `build.py` | Script Python de build/release. Probablemente compila todos los binarios y empaqueta. |
| `tsuki-setup.iss` | Script Inno Setup para el instalador Windows. |
| `cli/go.mod` | Módulo Go `github.com/tsuki/cli`. Dependencias: `cobra`, `fatih/color`, `charmbracelet/bubbles` (spinners), etc. |

---

## Formato del manifiesto de proyecto (`tsuki_package.json`)

```json
{
  "name": "mi-proyecto",
  "version": "0.1.0",
  "board": "uno",
  "language": "go",
  "backend": "tsuki-flash",
  "packages": [
    { "name": "ws2812", "version": "^1.0.0" },
    { "name": "dht",    "version": "^1.0.0" }
  ],
  "build": {
    "output_dir": "build",
    "cpp_std":    "c++11",
    "optimize":   "Os",
    "extra_flags": [],
    "source_map": false
  }
}
```

---

## Formato de paquete tsukilib (`tsukilib.toml`)

```toml
[package]
name        = "ws2812"
version     = "1.0.0"
cpp_header  = "Adafruit_NeoPixel.h"
arduino_lib = "Adafruit NeoPixel"
aliases     = ["neopixel", "NeoPixel"]

[[function]]
go  = "Begin"
cpp = "{0}.begin()"    # {0} = receiver var, {1} = first arg, ...

[[constant]]
go  = "NEO_GRB"
cpp = "NEO_GRB"
```

---

## Paquetes Go built-in (sin instalar nada)

El `Runtime` en `src/runtime/mod.rs` registra estos paquetes automáticamente:

| Import Go | Mapea a |
|---|---|
| `fmt` | `Serial.print`, `snprintf` |
| `time` | `delay()`, `millis()`, `micros()` |
| `math` | `<math.h>`: sin, cos, sqrt, pow, etc. |
| `strconv` | `String()`, `.toInt()`, `.toFloat()` |
| `arduino` | `pinMode`, `digitalWrite`, `digitalRead`, `analogRead/Write`, interrupts, tone, etc. |
| `wire`/`Wire` | `Wire.begin()`, `Wire.write()`, etc. (I2C) |
| `spi`/`SPI` | `SPI.begin()`, `SPI.transfer()`, etc. |
| `serial`/`Serial` | `Serial.begin()`, `Serial.println()`, etc. |
| `servo`/`Servo` | `Servo.attach()`, `Servo.write()`, etc. (requiere `<Servo.h>`) |
| `lcd`/`LiquidCrystal` | `LiquidCrystal.begin()`, `.print()`, etc. |

Builtins Go mapeados sin import: `print`→`Serial.print`, `println`→`Serial.println`, `panic`→Serial+loop infinito, `len`→sizeof, `copy`→memcpy, `new`→`new T()`.

---

## Boards soportados (tanto en tsuki-core como en tsuki-flash)

| ID | Board | CPU | Flash | RAM |
|---|---|---|---|---|
| `uno` | Arduino Uno | ATmega328P | 32K | 2K |
| `nano` | Arduino Nano | ATmega328P | 32K | 2K |
| `nano_every` | Arduino Nano Every | ATmega4809 | 48K | 6K |
| `mega` | Arduino Mega 2560 | ATmega2560 | 256K | 8K |
| `micro` | Arduino Micro | ATmega32U4 | 32K | 2K |
| `leonardo` | Arduino Leonardo | ATmega32U4 | 32K | 2K |
| `due` | Arduino Due | AT91SAM3X8E | 512K | 96K |
| `zero` | Arduino Zero | ATSAMD21G18A | 256K | 32K |
| `mkr1000` | Arduino MKR WiFi 1000 | ATSAMD21G18A | 256K | 32K |
| `esp32` | ESP32 Dev Module | Xtensa LX6 | 4096K | 520K |
| `esp8266` | ESP8266 NodeMCU | ESP8266 | 4096K | 80K |
| `pico` | Raspberry Pi Pico | RP2040 | 2048K | 264K |
| `teensy41` | Teensy 4.1 | iMXRT1062 | 8192K | 1024K |
| `portenta_h7` | Arduino Portenta H7 | STM32H747XI | 2048K | 8192K |

---

## Relaciones entre componentes (resumen)

```
tsuki CLI (Go)
    │
    ├── lee/escribe ──► tsuki_package.json
    ├── invoca ────────► tsuki-core (Rust binary) ── transpila .go → .cpp
    ├── invoca ────────► tsuki-flash (Rust binary) ── compila + flashea
    └── invoca ────────► arduino-cli (externo, opcional)

tsuki IDE (Tauri)
    │
    ├── frontend Next.js ──► store.ts (Zustand)
    │                    └─► tauri.ts (bridge)
    └── backend Rust ────────► invoca tsuki CLI / tsuki-core / tsuki-flash

pkg/ (datos en GitHub)
    └── descargado por pkgmgr (CLI) y pkg_manager (tsuki-core) en runtime
```

---

## Convenciones de código

- **Rust**: `snake_case` para módulos y funciones, `PascalCase` para structs y enums. Errores siempre con `tsukiError`. Los módulos de runtime se inicializan via métodos `init_*()`.
- **Go**: `PascalCase` para exports. Paquetes internos bajo `internal/`. Cada subcomando Cobra en su propio archivo bajo `cli/internal/cli/`.
- **TypeScript**: Componentes en `PascalCase`, hooks y stores en `camelCase`. El store Zustand es la única fuente de verdad del estado del IDE.
- **tsukilib.toml**: `{0}`, `{1}` son posicionales. `{self}` es el receiver de instancia. `{args}` es join de todos los args (para variadic).