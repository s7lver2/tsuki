# Tsuki Packages v2.0 — Diseño de Implementación

## Visión general

Los paquetes v2.0 expanden el concepto de "librería Arduino" a cualquier cosa que pueda extender tsuki: parches del IDE, placas nuevas, librerías de transpilación, binarios del toolchain, o aplicaciones completas. El ecosistema gira alrededor de tres piezas: el formato de paquete, el gestor de paquetes del CLI, y la herramienta de desarrollo `tsuki-dk`.

**El punto clave del diseño:** `tsuki-core` y `tsuki-flash` son ellos mismos paquetes de tipo `app` dentro de este sistema. El propio CLI de tsuki se actualiza a través del mismo gestor que usa para instalar librerías. Tsuki no depende de sí mismo para existir — solo necesita el CLI mínimo (`tsuki` binary) para bootstrapear el resto.

---

## 1. Tipos de paquete

```
app          — binario ejecutable instalable (tsuki-core, tsuki-flash, tsuki-dk, etc.)
library      — librería transpilable (el formato actual v1.0, compatible)
board-pack   — una o más definiciones de placa
ide-plugin   — parche o extensión del IDE Tauri
sdk-patch    — modificación del compilador/transpiler aplicada sobre un app existente
```

Cada tipo comparte el mismo sistema de distribución pero se instala en rutas distintas y tiene campos TOML propios.

### Jerarquía de dependencias

```
tsuki (CLI mínimo, bootstrapper)
  └── instala vía packages v2.0:
        ├── tsuki-team/tsuki-core   [app]   — transpiler Go→C++, Python→C++
        ├── tsuki-team/tsuki-flash  [app]   — compilador/flasher Arduino
        ├── tsuki-team/tsuki-ide    [app]   — IDE Tauri
        ├── tsuki-team/tsuki-dk     [app]   — development kit
        ├── tsuki-team/dht          [library]
        ├── tsuki-team/rp2040-pack  [board-pack]
        └── ...
```

El CLI mínimo solo sabe resolver sources, verificar firmas, y ejecutar binarios. Todo lo demás llega como paquetes.

---

## 2. Manifiesto `tsuki.toml`

Todos los paquetes usan el mismo archivo raíz:

```toml
[package]
name        = "tsuki-flash"
version     = "6.0.0"
type        = "app"               # app | library | board-pack | ide-plugin | sdk-patch
description = "Arduino compile & flash toolchain — no arduino-cli required"
author      = "tsuki-team"
license     = "MIT"
repository  = "https://github.com/tsuki-team/tsuki"

[package.signing]
key = "tsuki-team"                # nombre de la clave en tsuki-keys.json del source

[dependencies]
"tsuki-team/tsuki-core" = ">=6.0"

[dev-dependencies]
"tsuki-team/tsuki-dk" = ">=1.0"

# ── Solo para type = "app" ──────────────────────────────────────────
[app]
# Binarios precompilados por plataforma. El gestor descarga solo el de la plataforma actual.
[app.binaries]
"x86_64-windows"  = "https://github.com/tsuki-team/tsuki/releases/download/v6.0.0/tsuki-flash-windows-amd64.exe"
"x86_64-linux"    = "https://github.com/tsuki-team/tsuki/releases/download/v6.0.0/tsuki-flash-linux-amd64"
"aarch64-linux"   = "https://github.com/tsuki-team/tsuki/releases/download/v6.0.0/tsuki-flash-linux-arm64"
"x86_64-macos"    = "https://github.com/tsuki-team/tsuki/releases/download/v6.0.0/tsuki-flash-darwin-amd64"
"aarch64-macos"   = "https://github.com/tsuki-team/tsuki/releases/download/v6.0.0/tsuki-flash-darwin-arm64"

# Nombre con el que queda disponible en ~/.tsuki/bin/
install_as = "tsuki-flash"

# ── Solo para type = "library" ──────────────────────────────────────
[library]
cpp_header  = "DHT.h"
cpp_class   = "DHT"
arduino_lib = "DHT sensor library"

# ── Solo para type = "board-pack" ───────────────────────────────────
[board-pack]
architecture = "rp2040"
# Boards definidos en boards/*.toml dentro del paquete

# ── Solo para type = "ide-plugin" ───────────────────────────────────
[ide-plugin]
entry       = "plugin/index.js"
permissions = ["fs:read", "shell:execute"]
patches     = ["ide/BottomPanel.patch", "ide/Settings.patch"]

# ── Solo para type = "sdk-patch" ────────────────────────────────────
[sdk-patch]
target       = "tsuki-team/tsuki-core"
target_range = ">=6.0,<7.0"
apply_order  = 10
```

---

## 3. Sistema de sources y repositorios

Un **source** es una URL que apunta a un repositorio que expone:

```
<source-url>/tsuki-keys.json      — claves públicas de los publicadores
<source-url>/packages.json        — índice de paquetes disponibles
```

### `tsuki-keys.json`

```json
{
  "keys": {
    "tsuki-team": "ed25519:<base64-pubkey>",
    "s7lver":     "ed25519:<base64-pubkey>"
  }
}
```

### `packages.json`

```json
{
  "packages": [
    {
      "name":    "tsuki-flash",
      "owner":   "tsuki-team",
      "type":    "app",
      "versions": [
        {
          "version": "6.0.0",
          "binaries": {
            "x86_64-windows": {
              "url":       "https://...tsuki-flash-windows-amd64.exe",
              "checksum":  "sha256:<hex>",
              "signature": "<ed25519-base64>"
            },
            "x86_64-linux": {
              "url":       "https://...tsuki-flash-linux-amd64",
              "checksum":  "sha256:<hex>",
              "signature": "<ed25519-base64>"
            }
          }
        }
      ]
    },
    {
      "name":    "tsuki-dht",
      "owner":   "tsuki-team",
      "type":    "library",
      "versions": [
        {
          "version":   "2.0.0",
          "url":       "https://...tsuki-dht-2.0.0.tar.gz",
          "checksum":  "sha256:<hex>",
          "signature": "<ed25519-base64>"
        }
      ]
    }
  ]
}
```

La firma `signature` es Ed25519 sobre el checksum SHA-256 del artefacto, firmada con la clave privada del publicador. El CLI verifica contra `tsuki-keys.json` antes de instalar.

---

## 4. CLI: Gestor de paquetes v2.0

### Sintaxis de instalación

```bash
tsuki install tsuki-flash                       # latest del source primario
tsuki install tsuki-team/tsuki-flash            # owner explícito
tsuki install tsuki-team/tsuki-flash@v6.0.0    # versión pinned
tsuki install tsuki-team/tsuki-flash@>=5.0     # rango semver
```

El CLI detecta el tipo del paquete automáticamente:
- `app` → descarga el binario de la plataforma actual a `~/.tsuki/bin/`
- `library` → extrae a `~/.tsuki/libs/<name>/`
- `board-pack` → extrae a `~/.tsuki/boards/<name>/`
- `ide-plugin` → extrae a `~/.tsuki/plugins/<name>/`, registra en el IDE
- `sdk-patch` → extrae y aplica sobre el `app` target instalado

### Comandos

```bash
tsuki install <pkg>          # instala / actualiza
tsuki remove  <pkg>          # desinstala
tsuki update                 # actualiza todos los paquetes instalados
tsuki search  <query>        # busca en todos los sources configurados
tsuki info    <pkg>          # detalles de un paquete
tsuki list                   # lista paquetes instalados
tsuki publish                # publica el paquete actual (requiere tsuki-dk)
tsuki source add <url>       # añade un source
tsuki source remove <url>    # elimina un source
tsuki source list            # lista sources configurados
```

### Auto-actualización

Dado que `tsuki-core` y `tsuki-flash` son paquetes `app`, se actualizan igual que cualquier otra cosa:

```bash
tsuki update tsuki-core      # actualiza el transpiler
tsuki update tsuki-flash     # actualiza el compilador/flasher
tsuki update                 # actualiza todo, incluyendo apps
```

### `~/.tsuki/config.toml`

```toml
[sources]
urls = [
  "https://raw.githubusercontent.com/tsuki-team/registry/main",
  "https://raw.githubusercontent.com/s7lver2/my-packages/main",
]

[cache]
ttl_secs = 86400

[installed]
# El gestor mantiene este bloque automáticamente
"tsuki-team/tsuki-core"  = "6.0.0"
"tsuki-team/tsuki-flash" = "6.0.0"
"tsuki-team/dht"         = "2.0.0"
```

---

## 5. `tsuki-dk` — Development Kit

`tsuki-dk` es un binario Go independiente (`app`) distribuido a través del mismo gestor de paquetes. Se instala con:

```bash
tsuki install tsuki-team/tsuki-dk
```

### Comandos

```bash
tsuki-dk new app       <n>     # crea proyecto de binario (como tsuki-core)
tsuki-dk new library   <n>     # crea proyecto de librería
tsuki-dk new board     <n>     # crea proyecto de placa
tsuki-dk new ide-plugin <n>    # crea proyecto de plugin IDE
tsuki-dk new sdk-patch <n>     # crea proyecto de parche SDK

tsuki-dk build                    # compila el paquete
tsuki-dk test                     # ejecuta tests
tsuki-dk sandbox                  # lanza versión sandboxeada de tsuki para probar

tsuki-dk publish                  # empaqueta, firma y publica
tsuki-dk publish --dry-run
tsuki-dk publish --bump patch|minor|major

tsuki-dk registry init <url>      # inicializa un repositorio de packages
tsuki-dk registry add             # añade el paquete actual al packages.json local
tsuki-dk registry remove <pkg>
tsuki-dk registry sync            # sube packages.json y tsuki-keys.json al repo
```

### Estructura de un proyecto `app` (ej: tsuki-flash)

```
tsuki-flash/
├── tsuki.toml              # manifiesto del paquete
├── src/                    # fuente Rust/Go del binario
├── tests/
└── .tsuki-dk/
    ├── sandbox/            # instalación sandboxeada de tsuki para tests
    └── build/              # artefactos de build y binarios por plataforma
```

### Estructura de un proyecto `library`

```
tsuki-dht/
├── tsuki.toml
├── lib/
│   ├── dht.go
│   └── tsukilib.toml       # compatible con v1.0
├── examples/
└── tests/
```

### Sandbox

`tsuki-dk sandbox` descarga una copia limpia de tsuki-core y tsuki-flash en `.tsuki-dk/sandbox/`, aplica los patches/plugins del paquete actual sobre ella, y lanza el IDE apuntando a ese sandbox. Los paquetes `app` se sandboxean copiando el binario resultado del build en lugar del binario del sistema.

### Publicación

El flujo de `tsuki-dk publish`:

1. Verifica `tsuki.toml` y que la versión no exista ya en el índice
2. Ejecuta `tsuki-dk build` y `tsuki-dk test`
3. Para `app`: compila binarios para todas las plataformas target, calcula checksum de cada uno
4. Para otros tipos: crea tarball, calcula checksum
5. Firma cada checksum con la clave privada en `~/.tsuki/keys/<key-name>.pem`
6. Sube artefactos a la URL de release configurada (GitHub Releases por defecto)
7. Actualiza `packages.json` del source con la nueva entrada
8. Sube `packages.json` y `tsuki-keys.json` actualizados

### Gestión de versiones

`tsuki-dk` mantiene la versión en `tsuki.toml` con bump semver automático, sincronizable con el tag de git.

---

## 6. Compatibilidad con v1.0

Los paquetes v1.0 (`godotinolib.toml`) siguen funcionando sin cambios. El runtime detecta el formato por la presencia de `godotinolib.toml` vs `tsuki.toml` y usa el loader correspondiente. Al instalar un paquete v1.0 desde el nuevo gestor, se envuelve automáticamente en un `tsuki.toml` con `type = "library"`.

---

## 7. Soporte de plugins en el IDE

Para que el IDE sea modular:

1. Al instalar un `ide-plugin`, el gestor lo extrae a `~/.tsuki/plugins/<name>/`
2. El IDE lee `~/.tsuki/plugins/` al arrancar y carga los entry points JS registrados
3. Los patches `.patch` se aplican sobre los fuentes del IDE en tiempo de build (o en tiempo de ejecución para parches JS/CSS)
4. Los permisos declarados en `[ide-plugin].permissions` se añaden automáticamente a `tauri.conf.json`

Para desarrollo, `tsuki-dk sandbox` aplica el plugin sobre la copia sandboxeada y lanza el IDE en modo dev con hot-reload.

---

## 8. Resumen de archivos nuevos/modificados

| Archivo | Descripción |
|---|---|
| `cmd/tsuki-dk/main.go` | Entry point de tsuki-dk |
| `cli/internal/pkgmgr/v2/source.go` | Fetching y caché de `packages.json` / `tsuki-keys.json` |
| `cli/internal/pkgmgr/v2/verify.go` | Verificación Ed25519 de paquetes |
| `cli/internal/pkgmgr/v2/install.go` | Descarga, extracción e instalación por tipo |
| `cli/internal/pkgmgr/v2/resolver.go` | Resolución de versiones y dependencias |
| `cli/internal/cli/pkg.go` | Comandos CLI: install, remove, search, publish, source, list |
| `tsuki-dk/new.go` | Scaffolding de proyectos nuevos (todos los tipos incluyendo app) |
| `tsuki-dk/sandbox.go` | Gestión del sandbox |
| `tsuki-dk/publish.go` | Empaquetado, compilación multi-plataforma, firma y publicación |
| `tsuki-dk/registry.go` | Gestión del repositorio de paquetes |
| `src/runtime/pkg_loader.rs` | Loader extendido para `tsuki.toml` v2 |
| `tsuki.toml` (en tsuki-core) | tsuki-core como paquete app |
| `flash/tsuki.toml` (en tsuki-flash) | tsuki-flash como paquete app |