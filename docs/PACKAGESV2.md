# Tsuki Packages v2.0 — Diseño de Implementación

## Visión general

Los paquetes v2.0 expanden el concepto de "librería Arduino" a cualquier cosa que pueda extender tsuki: parches del IDE, placas nuevas, librerías de transpilación, binarios del toolchain, o aplicaciones completas. El ecosistema gira alrededor de tres piezas: el formato de paquete, el gestor de paquetes del CLI, y la herramienta de desarrollo `tsuki-dk`.

**Punto clave:** `tsuki-core` y `tsuki-flash` son ellos mismos paquetes de tipo `app`. El propio CLI se actualiza a través del mismo gestor que usa para instalar librerías. Tsuki no depende de sí mismo para existir — solo necesita el CLI mínimo para bootstrapear el resto.

---

## 1. Tipos de paquete

```
app          — binario ejecutable (tsuki-core, tsuki-flash, tsuki-dk…)
library      — librería transpilable (compatible con v1.0)
board-pack   — definiciones de placa
ide-plugin   — extensión o parche del IDE Tauri
sdk-patch    — parche sobre un app existente (tsuki-core, tsuki-flash)
```

### Jerarquía de dependencias

```
tsuki  (CLI mínimo, bootstrapper)
  └── instala vía packages v2.0:
        ├── tsuki-team/tsuki-core   [app]
        ├── tsuki-team/tsuki-flash  [app]
        ├── tsuki-team/tsuki-ide    [app]
        ├── tsuki-team/tsuki-dk     [app]
        ├── tsuki-team/dht          [library]
        ├── tsuki-team/rp2040-pack  [board-pack]
        └── ...
```

---

## 2. Manifiesto `tsuki.toml`

```toml
[package]
name        = "my-sensor"
version     = "0.1.0"
type        = "library"       # app | library | board-pack | ide-plugin | sdk-patch
description = "DHT sensor library"
author      = "s7lver"
license     = "MIT"

[package.signing]
key = "s7lver"                # nombre en tsuki-keys.json del source

[dependencies]
"tsuki-team/tsuki-core" = ">=6.0"

[dev-dependencies]
"tsuki-team/tsuki-dk" = ">=1.0"

# ── Solo para type = "app" ──────────────────────────────────────────
[app]
install_as = "my-tool"

[app.binaries]
"x86_64-windows" = "https://github.com/.../my-tool-windows-amd64.exe"
"x86_64-linux"   = "https://github.com/.../my-tool-linux-amd64"
"aarch64-linux"  = "https://github.com/.../my-tool-linux-arm64"
"x86_64-macos"   = "https://github.com/.../my-tool-darwin-amd64"
"aarch64-macos"  = "https://github.com/.../my-tool-darwin-arm64"

# ── Solo para type = "library" ──────────────────────────────────────
[library]
cpp_header  = "MySensor.h"
arduino_lib = "MySensor Arduino Library"

# ── Solo para type = "board-pack" ───────────────────────────────────
[board-pack]
architecture = "rp2040"

# ── Solo para type = "ide-plugin" ───────────────────────────────────
[ide-plugin]
entry       = "plugin/index.js"
permissions = ["fs:read", "shell:execute"]
patches     = ["ide/BottomPanel.patch"]

# ── Solo para type = "sdk-patch" ────────────────────────────────────
[sdk-patch]
target       = "tsuki-team/tsuki-core"
target_range = ">=6.0,<8.0"
apply_order  = 10
```

---

## 3. Sistema de sources

Un **source** es una URL base que expone dos archivos:

```
<url>/packages.json     — índice de paquetes
<url>/tsuki-keys.json   — claves públicas de los publicadores
```

### Formatos de `packages.json` soportados

El gestor detecta automáticamente el formato por el primer carácter del valor de `packages`:

**v2 (nativo):**
```json
{"packages": [{"name": "dht", "owner": "tsuki-team", "type": "library", "versions": [...]}]}
```

**Legacy object-map** (formato actual del registry en producción):
```json
{
  "packages": {
    "dht": {
      "description": "...", "author": "godotino-team",
      "latest": "1.0.0", "versions": {"1.0.0": "<url>"}
    }
  }
}
```

**v1 array plano:**
```json
[{"name": "dht", "version": "1.0.0", "url": "..."}]
```

Los tres formatos se convierten internamente al modelo v2. Si la URL del source termina en `.json`, se trata como URL directa al archivo en vez de directorio base.

### Verificación de firma

Cada artefacto lleva `checksum: "sha256:<hex>"` y `signature: "<ed25519-base64>"`. El gestor verifica el SHA-256 y la firma Ed25519 contra `tsuki-keys.json` antes de extraer.

**Excepción:** paquetes del sandbox local (`signature: "local-dev-*"`) saltan toda verificación — solo se sirven en `127.0.0.1`.

---

## 4. CLI: Comandos

### Instalación

```bash
tsuki install tsuki-flash                       # latest
tsuki install tsuki-team/tsuki-flash            # owner/name
tsuki install tsuki-team/tsuki-flash@v6.0.0    # versión exacta
tsuki install tsuki-team/tsuki-flash@>=5.0      # rango semver (>=, <=, ~, ^, combos)
```

### Comandos disponibles

```bash
tsuki install <pkg>            # instala
tsuki update  [pkg]            # actualiza todo o uno solo
tsuki pkg install  <pkg>
tsuki pkg remove   <pkg>
tsuki pkg list
tsuki pkg search   [query]
tsuki pkg info     <pkg>
tsuki pkg source add    <url>
tsuki pkg source remove <url>
tsuki pkg source list
tsuki pkg source update        # invalida caché y re-fetcha
```

### Rutas de instalación

| Tipo | Ruta |
|---|---|
| `app` | `~/.tsuki/bin/<n>[.exe]` |
| `library` | `~/.tsuki/libs/<owner>/<n>/<version>/` |
| `board-pack` | `~/.tsuki/boards/<owner>/<n>/<version>/` |
| `ide-plugin` | `~/.tsuki/plugins/<owner>/<n>/<version>/` |

---

## 5. `tsuki-dk` — Development Kit

Binario Go instalable con `tsuki install tsuki-team/tsuki-dk`.

### Comandos

```bash
# Crear paquete — wizard interactivo con flechas ↑↓
tsuki-dk new
tsuki-dk new library   my-sensor
tsuki-dk new app       my-tool
tsuki-dk new board-pack my-boards
tsuki-dk new ide-plugin dark-theme
tsuki-dk new sdk-patch  fix-rp2040

# Compilar y testear
tsuki-dk build              # valida tsukilib.toml + go vet en ejemplos
tsuki-dk test               # go test ./... dentro de tests/ (con go.mod propio)

# Instalar dependencias del tsuki.toml
tsuki-dk install
tsuki-dk install --no-dev   # omite [dev-dependencies]

# Sandbox
tsuki-dk sandbox            # shell interactiva aislada + servidor registry local
tsuki-dk sandbox --clean    # borrar y recrear sandbox

# Publicar
tsuki-dk publish
tsuki-dk publish --dry-run
tsuki-dk publish --bump minor

# Claves Ed25519
tsuki-dk key generate <n>
tsuki-dk key export   <n>
tsuki-dk key list

# Registry local
tsuki-dk registry init   [dir]
tsuki-dk registry add
tsuki-dk registry remove <owner/name>
tsuki-dk registry sync
tsuki-dk registry status
```

### Wizard interactivo (`tsuki-dk new`)

Si se omiten tipo y nombre, un wizard con selección por flechas pregunta:

1. **Tipo** — ↑↓ entre los 5 tipos
2. **Nombre** — texto libre
3. **Author** — default desde `git config user.name`
4. **Descripción**
5. **Campos específicos por tipo:**
   - `library` → header C++ + librería Arduino (opcional)
   - `board-pack` → arquitectura target
   - `sdk-patch` → app objetivo (tsuki-core / tsuki-flash)
6. **¿Inicializar git?**

### Estructura de un proyecto `library`

```
my-sensor/
├── tsuki.toml
├── lib/
│   ├── tsukilib.toml       # funciones/constantes/constructor → C++
│   └── my-sensor.go        # stubs Go para type-checking
├── examples/basic/main.go
├── tests/
│   ├── go.mod              # generado automáticamente
│   └── transpile_test.go
├── .tsuki-dk/
│   ├── sandbox/            # tsuki aislado
│   └── build/
└── README.md
```

### Sandbox

`tsuki-dk sandbox` lanza una shell interactiva completamente aislada:

1. Localiza los binarios de tsuki: PATH → directorio del propio tsuki-dk → `dist/` relativo al cwd
2. Para tipos no-app: levanta un **servidor HTTP local** en `127.0.0.1:<puerto-libre>`
3. El servidor sirve el paquete actual como registry efímero (`/packages.json`, `/tsuki-keys.json`, `/download.tar.gz`)
4. Inyecta el servidor como source de prioridad máxima en el sandbox
5. Lanza `cmd.exe` / `$SHELL` con el prompt modificado

```
[sandbox:my-sensor] E:\GoDotIno\my-sensor>
```

Dentro se puede usar tsuki normalmente — ve el paquete local:

```bash
[sandbox:my-sensor]> tsuki pkg search
  s7lver/my-sensor   library   0.1.0

[sandbox:my-sensor]> tsuki install my-sensor
  ✔ Installed s7lver/my-sensor@0.1.0
```

El servidor se apaga al salir de la shell.

### `tsuki-dk install`

Lee `[dependencies]` y `[dev-dependencies]` del `tsuki.toml` e instala cada uno vía pkgmgr v2.

### Flujo de publicación

```
1. build  +  test
2. Tarball (library/plugin/patch)  ó  binarios por plataforma (app)
3. SHA-256 de cada artefacto
4. Firma Ed25519 con ~/.tsuki/keys/<key>.pem
5. Upload a GitHub Releases (requiere gh CLI)
6. Actualizar packages.json del source
7. registry sync → git push
```

---

## 6. Modularidad del IDE (plugins)

### Arquitectura

El IDE Tauri soporta plugins instalados como paquetes `ide-plugin` en `~/.tsuki/plugins/`. El sistema tiene dos capas:

**Rust (`plugin_loader.rs`):**
- `list_ide_plugins` — escanea `~/.tsuki/plugins/<owner>/<n>/<version>/` y devuelve metadatos
- `read_plugin_entry` — lee el JS del plugin
- `read_plugin_styles` — lee el CSS del plugin
- Respeta `TSUKI_DATA_DIR` para el sandbox de `tsuki-dk sandbox`

**TypeScript (`pluginLoader.ts` + `usePlugins.ts`):**
- `loadAllPlugins()` — se llama una vez al arrancar el IDE
- Cada plugin recibe un objeto `context` con una API limitada
- Los plugins registran contribuciones (UI) llamando a métodos del context
- `PluginSlot.tsx` renderiza las contribuciones en los puntos de extensión del IDE

### API de plugins (`context`)

```js
// plugin/index.js
export function activate(context) {
  // Añadir pestaña al sidebar
  context.registerSidebarTab({
    id: 'my-tab',
    label: 'My Plugin',
    render() {
      const div = document.createElement('div')
      div.textContent = 'Hello from plugin!'
      return div
    }
  })

  // Botón en la toolbar
  context.registerToolbarAction({
    id: 'my-action',
    label: 'Run',
    onClick() { context.invokeCommand('my_command') }
  })

  // Panel en Settings
  context.registerSettingsPanel({
    id: 'my-settings',
    label: 'My Plugin Settings',
    render() { /* ... */ }
  })

  // Pestaña en el panel inferior
  context.registerBottomTab({ id: 'my-log', label: 'My Log', render() { /* ... */ } })

  // Eventos del IDE
  context.on('project:open', ({ path }) => console.log('opened', path))
  context.on('plugins:reloaded', () => {})

  context.showMessage('Plugin loaded!')
  context.getProjectPath()
  await context.invokeCommand('spawn_process', { cmd: '...', args: [] })
}
```

### Slots de extensión

| Slot | Componente | Dónde aparece |
|---|---|---|
| `sidebar-tab` | `usePluginSidebarTabs()` | Barra lateral izquierda |
| `bottom-tab` | `usePluginBottomTabs()` | Panel inferior (junto a Output, Terminal…) |
| `toolbar-action` | `<PluginSlot slot="toolbar-action" />` | Toolbar superior |
| `settings-panel` | `usePluginSettingsPanels()` | Pantalla de Settings |

### Integración en IdeScreen

```tsx
import PluginSlot, { usePluginSidebarTabs, usePluginBottomTabs } from '@/components/plugins/PluginSlot'
import { usePlugins } from '@/lib/usePlugins'

// En el componente raíz — inicia la carga de plugins
usePlugins()

// En la toolbar
<PluginSlot slot="toolbar-action" />

// En el sidebar — añadir las tabs devueltas por usePluginSidebarTabs()
// En el bottom panel — añadir las tabs de usePluginBottomTabs()
```

### Seguridad

- Los plugins se ejecutan en el renderer de Tauri (mismo proceso que el IDE)
- El trust se establece en el momento de instalación mediante verificación Ed25519
- Los plugins del sandbox (`local-dev-*`) tienen el mismo acceso pero solo están disponibles dentro de `tsuki-dk sandbox`
- La API `context` no expone acceso directo al DOM del IDE — los plugins inyectan nodos en contenedores `ref` aislados

---

## 7. Compatibilidad con v1.0

Los paquetes v1.0 (`godotinolib.toml`) siguen funcionando sin cambios. `source.go` detecta el formato automáticamente. Al instalar un paquete v1.0 desde el nuevo gestor se envuelve en un `tsuki.toml` implícito con `type = "library"`.

---

## 8. Resumen de archivos

| Archivo | Descripción |
|---|---|
| `cli/cmd/tsuki-dk/main.go` | Entry point de tsuki-dk |
| `cli/internal/pkgmgr/v2/types.go` | Structs compartidos |
| `cli/internal/pkgmgr/v2/source.go` | Sources: add/remove, fetch + caché 24h, compat v1/v2/legacy |
| `cli/internal/pkgmgr/v2/verify.go` | SHA-256 + Ed25519; skip para `local-dev-*` |
| `cli/internal/pkgmgr/v2/resolver.go` | ParseRef, semver completo, Resolve |
| `cli/internal/pkgmgr/v2/install.go` | Descarga, extracción e instalación por tipo |
| `cli/internal/pkgmgr/v2/resolver_test.go` | 40+ casos de test |
| `cli/internal/cli/pkg.go` | Comandos: install, remove, list, search, source, info |
| `cli/internal/cli/cmd_install.go` | `tsuki install` shortcut |
| `cli/internal/cli/cmd_update.go` | `tsuki update [pkg]` |
| `cli/internal/cli/root.go` | Registro de comandos |
| `cli/internal/dk/root.go` | Root cobra de tsuki-dk |
| `cli/internal/dk/manifest.go` | Parser tsuki.toml (sin deps externas) |
| `cli/internal/dk/new.go` | Wizard interactivo con ↑↓ |
| `cli/internal/dk/build_test_cmd.go` | build (go vet ejemplos) + test |
| `cli/internal/dk/install_deps.go` | `tsuki-dk install` |
| `cli/internal/dk/sandbox.go` | Shell interactiva con prompt `[sandbox:<n>]` |
| `cli/internal/dk/sandbox_server.go` | Servidor HTTP local efímero (registry de desarrollo) |
| `cli/internal/dk/publish.go` | Pack, firma, upload GitHub Releases |
| `cli/internal/dk/registry.go` | init/add/remove/sync/status |
| `cli/internal/dk/key.go` | Claves Ed25519: generate/export/list |
| `tsuki-core.toml` | tsuki-core como paquete app |
| `tsuki-flash.toml` | tsuki-flash como paquete app |
| `tools/build.py` | build_dk + tsuki-dk en instaladores Unix/Windows |
| `ide/src-tauri/src/plugin_loader.rs` | Comandos Rust: list_ide_plugins, read_plugin_entry, read_plugin_styles |
| `ide/src-tauri/src/main.rs` | Registra los 3 comandos del plugin loader |
| `ide/src/lib/pluginLoader.ts` | Carga JS de plugins, context API, registro de contribuciones |
| `ide/src/lib/usePlugins.ts` | Hook React: carga inicial + re-render al cambiar plugins |
| `ide/src/components/plugins/PluginSlot.tsx` | Componente + hooks para renderizar contribuciones por slot |

---

## 9. Modularidad del IDE — Hoja de ruta hacia plugins oficiales

Esta sección documenta la arquitectura que permite extraer Sandbox, LSP y Git como paquetes `ide-plugin` independientes, distribuibles a través del mismo gestor de paquetes v2.

### 9.1 Principio general

El IDE no importa directamente ninguna feature experimental. Cada feature se registra a sí misma a través de la API de context durante `activate()`. El IDE solo provee:

- Los **slots de extensión** (puntos donde los plugins inyectan UI)
- La **context API** (única interfaz contractual entre IDE y plugin)
- El **event bus** (comunicación desacoplada)

```
tsuki-ide (core)
  ├── slot: sidebar-tab
  ├── slot: bottom-tab
  ├── slot: toolbar-action
  ├── slot: settings-panel
  ├── slot: workstation         ← página completa (Code/Sandbox/Export bar)
  ├── slot: status-bar          ← items en el strip inferior
  └── slot: editor-extension   ← completions, diagnostics, inlay hints
```

### 9.2 Context API completa

```js
// plugin/index.js
export function activate(context) {

  // ── Slots de UI ──────────────────────────────────────────────────────────

  context.registerSidebarTab({
    id: 'my-tab', label: 'My Plugin', icon: '⚡',
    render() { return document.createElement('div') }
  })

  context.registerBottomTab({
    id: 'my-log', label: 'My Log',
    render() { return document.createElement('div') }
  })

  context.registerToolbarAction({
    id: 'my-btn', label: 'Run', icon: '▶',
    onClick() { context.invokeCommand('spawn_process', { cmd: '...' }) }
  })

  context.registerSettingsPanel({
    id: 'my-settings', label: 'My Plugin Settings',
    render() { return document.createElement('div') }
  })

  // Página completa en la barra Code/Sandbox/Export
  context.registerWorkstation({
    id: 'my-workstation', label: 'Simulator', icon: '🔌', shortcut: '4',
    render() {
      const div = document.createElement('div')
      div.style.cssText = 'width:100%;height:100%;'
      const root = context.renderReact(div, React.createElement(MySimulator))
      return div
    }
  })

  context.registerStatusBarItem({
    id: 'my-status', position: 'right',
    render() {
      const span = document.createElement('span')
      span.textContent = 'plugin ready'
      return span
    }
  })

  // ── Editor extension (LSP-style) ─────────────────────────────────────────

  context.registerEditorExtension({
    id: 'my-lsp',

    onFileChange({ fileId, content, ext, board }) {
      // reacciona al cambio de archivo activo
    },

    async getDiagnostics({ content, ext }) {
      return [{ fileId: '...', line: 1, col: 1, message: 'error', severity: 'error' }]
    },

    async getCompletions({ content, ext }, { line, column }) {
      return [{ label: 'setup', kind: 'function' }]
    },

    async getInlayHints({ content, ext }) {
      return [{ line: 5, col: 12, label: 'int', kind: 'type' }]
    },

    dispose() { /* cleanup */ }
  })

  // ── IDE state (lectura reactiva) ─────────────────────────────────────────

  const { board, projectPath } = context.getState()

  const unsub = context.onStateChange(s => s.board, newBoard => {
    console.log('board changed to', newBoard)
  })

  // ── Eventos del IDE ──────────────────────────────────────────────────────

  context.on('project:open',    ({ path }) => {})
  context.on('board:change',    ({ board }) => {})
  context.on('theme:change',    ({ theme }) => {})
  context.on('plugins:reloaded', () => {})

  // ── React rendering ──────────────────────────────────────────────────────
  // React y ReactDOM están disponibles directamente — no hace falta importarlos.

  const root = context.renderReact(container, React.createElement(MyComponent, { board }))
  // root es un ReactDOM.Root — llama root.unmount() al hacer dispose()
}
```

### 9.3 Plugins oficiales planificados

| Plugin | Paquete | Slots que usa | Estado |
|--------|---------|---------------|--------|
| Sandbox (simulador de circuitos) | `tsuki-team/ide-sandbox` | `workstation` | Pendiente extracción |
| LSP (diagnósticos + completions) | `tsuki-team/ide-lsp` | `editor-extension`, `settings-panel`, `bottom-tab` | Pendiente extracción |
| Git sidebar | `tsuki-team/ide-git` | `sidebar-tab`, `settings-panel` | Pendiente extracción |
| WebKit panel | `tsuki-team/ide-webkit` | `workstation`, `settings-panel` | Pendiente extracción |

#### Manifiesto de un plugin oficial

```toml
[package]
name        = "ide-sandbox"
version     = "1.0.0"
type        = "ide-plugin"
description = "Arduino circuit simulator for tsuki-ide"
author      = "tsuki-team"
license     = "MIT"

[package.signing]
key = "tsuki-team"

[dependencies]
"tsuki-team/tsuki-ide" = ">=1.0"

[ide-plugin]
entry       = "plugin/index.js"
permissions = ["shell:execute", "fs:read"]
slots       = ["workstation"]
```

### 9.4 Proceso de extracción de una feature a plugin

El proceso es siempre el mismo — se documenta aquí usando Sandbox como ejemplo:

**Paso 1 — Crear el paquete con tsuki-dk**
```bash
tsuki-dk new ide-plugin ide-sandbox
```

Estructura generada:
```
ide-sandbox/
├── tsuki.toml
├── plugin/
│   ├── index.js      ← activate(context) entry point
│   └── styles.css    ← estilos inyectados en <head>
└── README.md
```

**Paso 2 — Mover la lógica al plugin**

El componente React existente (`SandboxPanel.tsx`) se mueve al directorio del plugin. Dentro de `index.js`:

```js
// plugin/index.js  — ide-sandbox
export function activate(context) {
  // Lazy-load el componente pesado solo cuando el workstation está activo
  let SandboxApp = null

  context.registerWorkstation({
    id:       'sandbox',
    label:    'Sandbox',
    icon:     '🔌',
    shortcut: '2',
    render() {
      const container = document.createElement('div')
      container.style.cssText = 'width:100%;height:100%;overflow:hidden'

      // El componente usa context.getState() y context.onStateChange()
      // en lugar de importar el store directamente
      import('./SandboxApp.js').then(({ SandboxApp }) => {
        context.renderReact(container, React.createElement(SandboxApp, { context }))
      })

      return container
    }
  })

  context.registerSettingsPanel({
    id:    'sandbox-settings',
    label: 'Sandbox',
    render() {
      const div = document.createElement('div')
      import('./SandboxSettings.js').then(({ SandboxSettings }) => {
        context.renderReact(div, React.createElement(SandboxSettings, { context }))
      })
      return div
    }
  })
}
```

**Paso 3 — Eliminar el import hardcodeado del IDE**

En `IdeScreen.tsx`, borrar:
```diff
- import SandboxPanel from '@/components/experiments/SandboxPanel/SandboxPanel'
```

El slot `workstation` con `id: 'sandbox'` es registrado por el plugin. El IDE no necesita conocer `SandboxPanel` en tiempo de compilación.

**Paso 4 — Probar con sandbox local**
```bash
cd ide-sandbox
tsuki-dk sandbox
# en la shell aislada:
tsuki install ide-sandbox   # instala desde el registry local efímero
# abrir el IDE — el workstation Sandbox aparece vía el plugin
```

**Paso 5 — Publicar**
```bash
tsuki-dk publish
```

Esto empaqueta `plugin/`, firma con Ed25519, sube a GitHub Releases y actualiza `packages.json` del source oficial.

### 9.5 Integración con el build oficial

El pipeline de CI de `tsuki-ide` ejecuta, para cada release:

```bash
# Para cada plugin oficial bajo packages/official/
for plugin in ide-sandbox ide-lsp ide-git ide-webkit; do
  cd packages/official/$plugin
  tsuki-dk build
  tsuki-dk test
  tsuki-dk publish --bump patch   # auto-bump si el código cambió
  cd -
done

# Sincronizar el registry oficial
tsuki-dk registry sync
git push
```

El CLI incluye el source oficial como source de prioridad máxima por defecto. Cuando el usuario ejecuta `tsuki update`, los plugins oficiales se actualizan igual que `tsuki-core` o `tsuki-flash`.

### 9.6 Cómo el IDE descubre plugins tras una instalación

Cuando el usuario ejecuta `tsuki install tsuki-team/ide-sandbox`:

1. El CLI descarga y extrae el plugin en `~/.tsuki/plugins/tsuki-team/ide-sandbox/<version>/`
2. `PackagesSidebar` detecta el éxito y llama `refreshPlugins()` (de `usePlugins.ts`)
3. `refreshPlugins` vuelve a llamar `list_ide_plugins` (Tauri) → escanea el filesystem
4. El nuevo plugin se carga con `loadPlugin()` → `activate(context)` se ejecuta
5. `notifyPluginsChanged()` provoca re-render en todos los componentes suscritos
6. El workstation/sidebar/bottom-tab nuevo aparece sin reiniciar el IDE

### 9.7 Consideraciones de seguridad

- El trust se establece en el momento de la instalación mediante verificación Ed25519. Una vez instalado, el plugin se ejecuta con el mismo nivel de confianza que el IDE.
- Los plugins del sandbox de desarrollo (`local-dev-*`) solo se sirven en `127.0.0.1` — nunca llegan al registry de producción.
- La API `context` no expone el store de Zustand directamente: `getState()` devuelve un snapshot inmutable, y `onStateChange()` solo permite leer, nunca mutar.
- Las mutaciones del estado del IDE se hacen exclusivamente via `context.invokeCommand()` → comandos Tauri registrados explícitamente.