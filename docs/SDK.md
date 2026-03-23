# Expanding the tsuki Plugin SDK

This document explains how to grow the `ide-plugin` system beyond simple UI extensions — turning heavyweight IDE features (Sandbox, LSP, Git, WebKit) into independent, installable packages, and adding entirely new categories of capability (custom toolchain steps, simulator backends, board definitions with visual editors, and so on).

---

## 1. Current state

The SDK today supports five contribution types:

| Slot | API | What it does |
|---|---|---|
| `sidebar-tab` | `registerSidebarTab` | Adds a panel to the left sidebar |
| `bottom-tab` | `registerBottomTab` | Adds a tab to the output/terminal panel |
| `toolbar-action` | `registerToolbarAction` | Adds a button to the top toolbar |
| `settings-panel` | `registerSettingsPanel` | Adds a section to the Settings screen |
| `editor-extension` | `registerEditorExtension` | Adds diagnostics, completions, inlay hints |

These are enough for utility plugins. They are **not** enough for:

- A full circuit simulator that needs to own an entire screen area
- A language server that streams results over a long-lived process
- A board-pack plugin that contributes new compile targets
- A simulator backend that replaces tsuki-sim for a new architecture

The sections below describe how to add each class of capability.

---

## 2. New slots needed

### 2.1 `workstation` — full-screen panels

The IDE's main area is currently hard-coded to show Code / Sandbox / Export.
Adding a `workstation` slot lets any plugin own a full panel in that bar.

**Context API addition:**

```js
context.registerWorkstation({
  id:       'sandbox',
  label:    'Sandbox',
  icon:     '⚡',
  shortcut: '2',          // keyboard shortcut (digit or letter)
  render(): HTMLElement { /* returns a full-bleed container */ }
})
```

**Implementation in `IdeScreen.tsx`:**

```tsx
// Replace the hard-coded tab bar:
const workstations = usePluginWorkstations()   // returns registered contributions

// Render:
{workstations.map(ws => (
  <button
    key={ws.id}
    className={activeWorkstation === ws.id ? 'active' : ''}
    onClick={() => setActiveWorkstation(ws.id)}
  >
    {ws.icon}  {ws.label}
  </button>
))}

// Main content:
{workstations.map(ws => (
  <PluginSlot
    key={ws.id}
    slot="workstation"
    id={ws.id}
    hidden={activeWorkstation !== ws.id}
  />
))}
```

The existing Sandbox panel becomes `ide-sandbox` and registers itself via `registerWorkstation`. The IDE core removes its direct import entirely.

---

### 2.2 `status-bar` — bottom strip items

Plugins often need to show persistent status (git branch, connected device, LSP status):

```js
context.registerStatusBarItem({
  id:       'git-branch',
  position: 'left',       // 'left' | 'right' | 'center'
  render(): HTMLElement { /* span/button */ }
})
```

---

### 2.3 `build-step` — custom pipeline stages

This is the key slot for toolchain extensions. It lets a plugin inject a step into `tsuki build`:

```js
context.registerBuildStep({
  id:    'my-step',
  name:  'MicroPython check',
  // When to run: 'before-transpile' | 'after-transpile' | 'before-compile' | 'after-compile'
  when:  'before-compile',

  async run({ sourceFiles, board, language, buildDir }): Promise<BuildStepResult> {
    const out = await context.invokeCommand('spawn_process', {
      cmd:  'micropython',
      args: ['--check', sourceFiles[0]],
    })
    if (out.exitCode !== 0) {
      return { ok: false, errors: [{ message: out.stderr, line: 1 }] }
    }
    return { ok: true }
  }
})
```

**`BuildStepResult`:**
```ts
interface BuildStepResult {
  ok:      boolean
  errors?: { file?: string; line?: number; col?: number; message: string }[]
  outputs?: string[]   // paths to additional artifacts
}
```

The CLI calls the IDE's build steps by triggering `build:run-steps` events via IPC. This way IDE plugins can hook into the build even when the user invokes `tsuki build` from the terminal (the IDE acts as a build server when open).

---

### 2.4 `simulator-backend` — pluggable simulators

Currently the Sandbox is hard-wired to tsuki-sim. A `simulator-backend` slot decouples this:

```js
context.registerSimulatorBackend({
  id:          'wokwi',
  name:        'Wokwi',
  boards:      ['esp32', 'rp2040', 'nano'],   // supported boards
  fileTypes:   ['diagram.json'],               // extra files this sim understands

  async start({ firmware, circuit, board }): Promise<SimHandle> {
    const handle = await context.invokeCommand('spawn_process', {
      cmd:  'wokwi-server',
      args: ['--firmware', firmware, '--circuit', circuit],
    })
    return {
      stop() { /* ... */ },
      on(event, handler) { /* ... */ },
      sendInput(pinId, value) { /* ... */ },
    }
  }
})
```

The Sandbox workstation plugin calls `context.getSimulatorBackend(board)` to pick the right backend for the loaded project. If multiple backends claim the same board, a selector appears in the Sandbox toolbar.

---

### 2.5 `board-pack` integration in the IDE

Board-pack packages (`type = "board-pack"` in `tsuki.toml`) already work at the CLI level. For the IDE to expose them in the board selector, the IDE needs to read the installed board-packs and register their boards.

This does **not** require a new plugin API. The existing `list_ide_plugins` command is extended to also scan `~/.tsuki/boards/<owner>/<name>/<version>/` and return `BoardPackInfo` objects, which the IDE's `boards.ts` merges with the built-in list.

However, a board-pack that wants to add a **visual board diagram** to the Sandbox (showing pin layout, silkscreen, etc.) can do so by shipping a companion `ide-plugin` package:

```toml
# in board-pack's tsuki.toml
[dependencies]
"my-org/my-boards-ide" = ">=1.0"   # optional companion plugin
```

The companion plugin registers a `workstation` or `sidebar-tab` contribution that renders the board diagram when the selected board matches.

---

## 3. Sandbox as a plugin — step-by-step

The docs/MIGRATION.md document covers the mechanical steps. This section explains the **design decisions** that make it maintainable long-term.

### 3.1 What Sandbox needs from the IDE

| Need | Before (direct import) | After (context API) |
|---|---|---|
| Current board | `useStore().board` | `context.getState().board` |
| Open tabs / active file | `useStore().openTabs` | `context.getState().openTabs` |
| Pending circuit from Examples | `useStore().pendingCircuit` | `context.on('sandbox:loadCircuit', …)` |
| Running the simulator | `runSimulator()` from `tauri.ts` | `context.invokeCommand('run_simulator_plugin', …)` |
| Settings | `useStore().settings` | `context.getState().settings` |

The `context.getState()` call returns a **snapshot** (plain object), not a reactive proxy. To react to changes, use `context.onStateChange(selector, callback)`:

```js
// Watch a single field
const unsub = context.onStateChange(s => s.board, newBoard => {
  rebuildCircuit(newBoard)
})
// Unsubscribe on dispose
```

### 3.2 Persisting circuit data

The circuit is currently in the Zustand store (`sandboxCircuit`). After extraction, the plugin owns this data. The recommended approach:

- Store in `localStorage` keyed by `projectPath` (already done in `useCircuit.ts`)
- Sync to the IDE store via `context.dispatch({ type: 'sandbox:setCircuit', payload })` so other plugins (e.g. an export plugin) can read it

### 3.3 Simulator IPC

`runSimulator()` in `tauri.ts` uses Tauri's internal event streaming, which the plugin cannot call directly (it runs in the renderer, not as a Tauri extension). Two clean options:

**Option A** (recommended): Add a dedicated Tauri command `run_simulator_plugin` that the plugin calls via `context.invokeCommand`. This command encapsulates the event streaming internally and forwards results to the plugin via a named event channel.

**Option B**: Expose `emit_sim_bundle` + `spawn_process` separately and let the plugin reconstruct the streaming. More flexible but more boilerplate.

---

## 4. LSP as a plugin

The LSP plugin (`ide-lsp`) is the simplest extraction because `LspEngine.ts` and `LspFeatures.ts` have no imports from `@/lib/store`. The only change is removing the `Problem` type import (replaced by an inline interface).

After extraction, the IDE's `CodeEditor.tsx` calls `getEditorExtensions()` (from `pluginLoader.ts`) instead of importing `runDiagnostics` directly. The LSP plugin registers its `getDiagnostics`, `getCompletions`, and `getInlayHints` handlers via `registerEditorExtension`.

### Long-running language servers

For a full language server (e.g. `clangd` for C++ suggestions), the plugin needs a persistent process. The pattern:

```js
let lspProcess = null

export async function activate(context) {
  // Start the LSP server
  lspProcess = await context.invokeCommand('spawn_process', {
    cmd: 'clangd',
    args: ['--background-index'],
    keepAlive: true,
  })

  context.registerEditorExtension({
    id: 'clangd',
    async getDiagnostics({ content, filename }) {
      // Send to the long-running process via IPC
      return await sendLspRequest(lspProcess, 'textDocument/diagnostic', { content, filename })
    },
    dispose() {
      context.invokeCommand('kill_process', { pid: lspProcess.pid })
    }
  })

  context.on('project:open', ({ path }) => {
    context.invokeCommand('write_stdin', {
      pid:  lspProcess.pid,
      data: JSON.stringify({ method: 'initialized', params: { rootPath: path } }),
    })
  })
}
```

This requires the `shell:execute` and `shell:keepalive` permissions in `tsuki.toml`.

---

## 5. Permissions model

Every `ide-plugin` declares its required permissions in `tsuki.toml`. The IDE shows a permission dialog when installing:

```toml
[ide-plugin]
permissions = [
  "state:read:board",          # read board from IDE state
  "state:read:tabs",           # read open tabs
  "state:read:settings",       # read user settings
  "state:mutate:sandbox",      # write sandbox circuit / pending circuit
  "state:mutate:problems",     # write diagnostics/problems panel
  "state:mutate:log",          # write to the output log
  "shell:execute",             # spawn arbitrary processes
  "shell:keepalive",           # keep a process alive across file changes
  "fs:read",                   # read files from disk
  "fs:write",                  # write files to disk
  "network:fetch",             # make HTTP requests
]
```

### State permission granularity

`state:read:*` and `state:mutate:*` permissions are enforced at the `context` layer — the `getState()` method only returns the fields covered by the declared `read` permissions, and `dispatch()` only accepts action types covered by `mutate` permissions:

```
state:read:board       → getState().board
state:read:tabs        → getState().openTabs, getState().activeTabIdx
state:read:settings    → getState().settings
state:read:git         → getState().gitBranch, getState().gitChanges, getState().commitHistory
state:mutate:sandbox   → dispatch({ type: 'sandbox:*', … })
state:mutate:git       → dispatch({ type: 'git:commit', … })
state:mutate:problems  → dispatch({ type: 'lsp:setProblems', … })
```

Plugins that request permissions beyond what they declared are silently denied — `getState()` returns `undefined` for undeclared fields, and `dispatch()` is a no-op for undeclared mutation types.

---

## 6. Adding entirely new plugin categories

The system is open-ended. Here are three categories that don't exist yet:

### 6.1 Theme plugins

A theme plugin is an `ide-plugin` with no JS — only CSS:

```toml
[ide-plugin]
entry       = "plugin/theme.css"   # no index.js needed
permissions = []
```

When the entry file ends in `.css`, `plugin_loader.rs` loads it as a stylesheet instead of executing it. The IDE injects it into `<head>` and sets a `data-theme` attribute on `<body>`. Themes override CSS custom properties:

```css
:root[data-theme="monokai"] {
  --bg:        #272822;
  --fg:        #f8f8f2;
  --accent:    #a6e22e;
  /* ... */
}
```

### 6.2 Snippet / template plugins

A template plugin contributes entries to the "New Project" wizard:

```js
context.registerProjectTemplate({
  id:       'esp32-wifi',
  label:    'ESP32 Wi-Fi Starter',
  board:    'esp32',
  language: 'go',
  icon:     '📶',
  files: {
    'src/main.go':       '/* ... */',
    'tsuki_package.json': '{ "board": "esp32", … }',
  }
})
```

### 6.3 Debugger plugins

A debugger plugin connects to a hardware debug probe (J-Link, CMSIS-DAP) and contributes breakpoint/variable inspection UI:

```js
context.registerDebugger({
  id:    'jlink',
  name:  'SEGGER J-Link',
  boards: ['nrf52840', 'stm32'],
  async connect({ port, board }) { /* ... */ },
  async setBreakpoint({ file, line }) { /* ... */ },
  async getVariables() { /* ... */ },
})
```

The IDE would need a `debugger-panel` slot and a `debug:start` / `debug:stop` event for this to work end-to-end, but the plugin API shape above is the right interface.

---

## 7. Plugin development workflow

```bash
# 1. Scaffold
tsuki-dk new ide-plugin my-plugin
cd my-plugin

# 2. Edit plugin/index.js (or src/index.tsx if using TypeScript)
#    Use context.* API (see PACKAGESV2.md §9.2)

# 3. Build
npm run build         # → plugin/index.js

# 4. Test in isolation
tsuki-dk sandbox      # or:
tsuki-dk sandbox --project . --build

# Inside the sandbox:
[sandbox:my-plugin]> tsuki install my-plugin
# Open the IDE — your plugin appears in Settings → Plugins

# 5. Publish
tsuki-dk publish
# or:
tsuki-dk publish --bump minor
```

### Testing checklist

- [ ] Plugin activates without errors (`context.showMessage` visible)
- [ ] Declared permissions match what `getState()` is actually used for
- [ ] `dispose()` cleans up event listeners and spawned processes
- [ ] Plugin survives `plugins:reloaded` event (hot-reload during development)
- [ ] Plugin behaves correctly when project is closed (`project:open` fired with empty path)
- [ ] Large data (e.g. circuit JSON) is stored in `localStorage`, not in the context API

---

## 8. Summary of API surface additions

| Addition | Status | Notes |
|---|---|---|
| `registerWorkstation` | Needed for Sandbox, WebKit | Full-screen panel slot |
| `registerStatusBarItem` | Needed for Git | Strip item |
| `registerBuildStep` | New category | Hooks into `tsuki build` pipeline |
| `registerSimulatorBackend` | New category | Pluggable simulation engine |
| `registerProjectTemplate` | New category | Wizard template contribution |
| `registerDebugger` | New category | Debug probe integration |
| `onStateChange` | Needed for all reactive plugins | Reactive state subscription |
| `dispatch` | Needed for write access | Mutation API |
| CSS-only entry | New category | Theme plugins |
| Board-pack IDE companion | Extension of board-pack type | Visual board diagram in Sandbox |

The first three (`workstation`, `statusBar`, `onStateChange` + `dispatch`) are the blocking requirements for extracting the three existing experimental features (Sandbox, LSP, Git) into plugins. Everything after that is additive and can ship incrementally.