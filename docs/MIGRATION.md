# Migración completa — ide-sandbox · ide-lsp · ide-git

Este documento explica exactamente cómo mover `SandboxPanel`, `LspEngine/LspFeatures`
y `GitSidebar` del IDE core a paquetes `ide-plugin` independientes.

---

## Antes de empezar — conceptos clave

### El patrón de migración (siempre igual)

```
1. tsuki-dk new ide-plugin <nombre>
2. cp de archivos fuente al plugin
3. Cambiar imports @/ → relativos
4. Sustituir useStore() → context.getState() / onStateChange()
5. Sustituir invoke() directo → context.invokeCommand()
6. Sustituir mutaciones del store → context.dispatch()
7. Declarar permisos en tsuki.toml
8. tsuki-dk build  → genera plugin/index.js
9. tsuki-dk sandbox --project <dir> → probar localmente (o cd <dir> && tsuki-dk sandbox)
10. Borrar el código del IDE core
```

### Contexto de dispatch disponible

```ts
context.dispatch({ type: 'git:commit',          payload: 'mensaje' })
context.dispatch({ type: 'sandbox:setCircuit',  payload: circuitData })
context.dispatch({ type: 'sandbox:clearPending' })
context.dispatch({ type: 'lsp:setProblems',     payload: diagnostics })
context.dispatch({ type: 'lsp:addLog',          payload: { type: 'info', msg: '...' } })
```

---

## Plugin 1: ide-lsp

> **Empieza por este.** Solo cambia 1 línea en el código copiado.

### Paso 1 — Crear el paquete

```bash
tsuki-dk new ide-plugin ide-lsp
cd ide-lsp
```

### Paso 2 — Copiar archivos

```bash
# Desde la raíz del repo de tsuki
cp ide/src/components/experiments/Lsp/LspEngine.ts       ide-lsp/src/LspEngine.ts
cp ide/src/components/experiments/Lsp/LspFeatures.ts     ide-lsp/src/LspFeatures.ts
cp ide/src/components/experiments/Lsp/LibraryInstallModal.tsx  ide-lsp/src/LibraryInstallModal.tsx
```

### Paso 3 — Cambios en `LspEngine.ts`

**Una sola línea cambia:**

```diff
- import type { Problem } from '@/lib/store'
+ interface Problem {
+   id: string
+   severity: 'error' | 'warning' | 'info'
+   file: string
+   line: number
+   col: number
+   message: string
+ }
```

**`LspFeatures.ts`** — sin cambios. No tiene imports de `@/`.

### Paso 4 — Escribir `src/index.tsx`

```tsx
import { runDiagnostics, getMissingLibDiags } from './LspEngine'
import { getCompletions, getInlayHints }       from './LspFeatures'

export function activate(context: any) {
  context.registerEditorExtension({
    id: 'tsuki-lsp',

    async getDiagnostics(ctx: any) {
      const { settings } = context.getState()
      if (!settings.lspEnabled || !settings.lspDiagnosticsEnabled) return []

      const raw = runDiagnostics(ctx.content, ctx.filename, ctx.ext, {
        lspGoEnabled:  settings.lspGoEnabled  ?? true,
        lspCppEnabled: settings.lspCppEnabled ?? true,
        lspInoEnabled: settings.lspInoEnabled ?? true,
      })
      return raw.map((d: any) => ({ ...d, fileId: ctx.fileId, source: 'lsp' }))
    },

    async getCompletions(ctx: any, pos: any) {
      const { settings } = context.getState()
      if (!settings.lspEnabled || !settings.lspCompletionsEnabled) return []
      const lines  = ctx.content.split('\n')
      const before = lines.slice(0, pos.line - 1).join('\n')
      const offset = before.length + (before.length > 0 ? 1 : 0) + pos.column
      return getCompletions(ctx.content, offset, ctx.ext)
    },

    async getInlayHints(ctx: any) {
      const { settings } = context.getState()
      if (!settings.lspEnabled || !settings.lspInlayHints) return []
      return getInlayHints(ctx.content, ctx.ext)
    },

    dispose() {},
  })

  context.registerSettingsPanel({
    id: 'lsp-settings', label: 'LSP',
    render() {
      const div = document.createElement('div')
      div.style.padding = '16px'
      div.innerHTML = '<p style="font-size:12px;color:var(--fg-muted)">LSP settings. Configure in Settings → Experiments → LSP.</p>'
      return div
    },
  })
}
```

### Paso 5 — `tsuki.toml`

```toml
[package]
name        = "ide-lsp"
version     = "1.0.0"
type        = "ide-plugin"
description = "LSP diagnostics, completions and inlay hints"
author      = "tsuki-team"
license     = "MIT"

[package.signing]
key = "tsuki-team"

[ide-plugin]
entry       = "plugin/index.js"
permissions = ["state:read:settings", "state:mutate:problems", "state:mutate:log"]
slots       = ["editor-extension", "settings-panel"]
```

### Paso 6 — Actualizar `CodeEditor.tsx`

> El archivo `CodeEditor.tsx` actualizado está disponible como entregable. Los cambios clave se documentan aquí.

#### Imports — qué cambia y qué se queda

```diff
- import { runDiagnostics, getMissingLibDiags } from '@/components/experiments/Lsp/LspEngine'
- import { getCompletions, getInlayHints }       from '@/components/experiments/Lsp/LspFeatures'
+ import { getEditorExtensions } from '@/lib/pluginLoader'
```

**Se mantienen** como imports directos (hover, firma, detección de palabras — viven en el editor, no en el plugin):
```ts
import {
  getHoverDoc, getSignatureHelp, wordAtOffset,
  type CompletionItem, type HoverDoc, type SignatureHelp,
} from '@/components/experiments/Lsp/LspFeatures'

// getMissingLibDiags ya NO se importa — la lógica de librería faltante
// se detecta con d.missingLib en los resultados del plugin
import { type LibraryInfo } from '@/components/experiments/Lsp/LspEngine'
```

#### Tipo `Diagnostic` — unificado localmente

El archivo define su propio `interface Diagnostic` que cubre tanto los diagnósticos
del plugin como los de LspEngine (con `quickFix?` y `missingLib?` opcionales):

```ts
interface Diagnostic {
  line: number; col: number; message: string
  severity: 'error' | 'warning' | 'info' | 'hint'
  source?: string
  quickFix?:  { label: string; newText: string }
  missingLib?: LibraryInfo & { importName: string }
  // ... otros campos opcionales
}
```

#### `runLsp` — async, vía extensiones

```ts
async function runLsp(code: string, ext: string, name: string, fileId: string) {
  const extensions = getEditorExtensions()
  if (!extensions.length) return
  const ctx = { fileId, filename: name, ext, content: code,
                board: useStore.getState().board,
                language: useStore.getState().projectLanguage }
  const results = (await Promise.all(
    extensions.filter(e => e.getDiagnostics)
              .map(e => e.getDiagnostics!(ctx).catch(() => []))
  )).flat() as Diagnostic[]

  setDiags(results)
  // IMPORTANTE: setProblems solo acepta 'error'|'warning'|'info' — filtrar 'hint'
  setProblems(results.filter(d => d.severity !== 'hint').map(d => ({
    id: d.id ?? `${d.line}:${d.col}`, severity: d.severity as any,
    file: d.file ?? name, line: d.line, col: d.col, message: d.message,
  })))
}
```

#### Inlay hints — `setTimeout` **debe ser `async`**

```ts
// ✗ INCORRECTO — await dentro de callback no-async causa error de compilación
const timer = setTimeout(() => {
  const hints = (await Promise.all(...)).flat()  // Error: await en contexto no-async
}, 800)

// ✓ CORRECTO
const timer = setTimeout(async () => {
  const hints = (await Promise.all(...)).flat()
  setInlayHints(hints as InlayHint[])
}, 800)
```

#### `triggerCompletion` — dos variables de posición distintas

El error original confundía la posición de texto (línea/columna, para el plugin)
con la posición de píxeles (para el dropdown). Son distintas y hay que computarlas
en momentos distintos:

```ts
function triggerCompletion(ta: HTMLTextAreaElement, offset: number) {
  if (!featuresEffective || !settings.lspCompletionsEnabled || !tab) return

  // ① Posición TEXTO — síncrona, ANTES del setTimeout
  //    Es lo que el plugin necesita para saber en qué punto del código está el cursor
  const beforeLines = ta.value.slice(0, offset).split('\n')
  const cursorPos   = { line: beforeLines.length, column: beforeLines[beforeLines.length - 1].length }

  const currentTab = tab  // captura de tab para el closure async
  compTimer.current = setTimeout(async () => {
    const items = (await Promise.all(
      extensions.filter(e => e.getCompletions)
                .map(e => e.getCompletions!(ctx, cursorPos).catch(() => []))  // ← usa cursorPos
    )).flat()

    if (!items.length) { setCompletions([]); return }
    setCompletions(items)

    // ② Posición PÍXELES — asíncrona, DESPUÉS de tener los items
    //    Es la posición en pantalla donde mostrar el dropdown
    const pixelPos = getCursorPixelPos(ta)  // ← nombre diferente, no confundir
    if (pixelPos) setCompPos({ x: pixelPos.x, y: pixelPos.y, maxH: ... })
  }, 80)
}
```

#### `applyCompletion` — `getMissingLibDiags` ya no es necesario

El filtrado de librerías faltantes ocurre en `runLsp` usando `d.missingLib` directamente,
no hace falta llamar a `getMissingLibDiags` por separado.

#### Sandbox — nuevo flag `--project`

```bash
# Antes (había que hacer cd manualmente)
cd packages/official/ide-lsp
tsuki-dk sandbox

# Ahora
tsuki-dk sandbox --project packages/official/ide-lsp
tsuki-dk sandbox --project packages/official/ide-lsp --build  # build + sandbox
```

#### `runLsp` — ahora async, vía extensiones

```ts
async function runLsp(code: string, ext: string, name: string, fileId: string) {
  if (!lspEffective) { setDiags([]); setProblems([]); return }
  const extensions = getEditorExtensions()
  if (extensions.length === 0) { setDiags([]); return }

  const ctx = {
    fileId, filename: name, ext, content: code,
    board:    useStore.getState().board,
    language: useStore.getState().projectLanguage,
  }
  const results = (await Promise.all(
    extensions
      .filter(e => e.getDiagnostics)
      .map(e => e.getDiagnostics!(ctx).catch(() => []))
  )).flat() as EditorDiagnostic[]

  setDiags(results)
  // setProblems solo acepta 'error' | 'warning' | 'info' — filtrar 'hint'
  setProblems(results.filter(d => d.severity !== 'hint').map(d => ({
    id: `${d.fileId ?? fileId}-${d.line}-${d.col}`,
    severity: d.severity as 'error' | 'warning' | 'info',
    file: name, line: d.line, col: d.col, message: d.message,
  })))
  // ... lógica de getMissingLibDiags igual que antes
}
```

#### `triggerCompletion` — dos variables `pos` separadas (bug crítico del original)

El original usaba `pos` antes de declararlo. La corrección:

```ts
// FIX: setTimeout callback es async
// FIX: cursorLineCol (para el plugin) y pixelPos (para el dropdown) son variables distintas
compTimer.current = setTimeout(async () => {
  // 1. Calcular line/col para el API del plugin — ANTES del async
  const textBefore    = ta.value.slice(0, offset)
  const linesBefore   = textBefore.split('\n')
  const cursorLineCol = {
    line:   linesBefore.length,
    column: linesBefore[linesBefore.length - 1].length,
  }

  const items = (await Promise.all(
    extensions.filter(e => e.getCompletions)
              .map(e => e.getCompletions!(ctx, cursorLineCol).catch(() => []))
  )).flat()

  // 2. Calcular pixel pos para el dropdown — DESPUÉS del async
  const pixelPos = getCursorPixelPos(ta)
  if (pixelPos) {
    setCompPos({ x: Math.min(pixelPos.x, ...), y: pixelPos.y, maxH: ... })
  }
}, 80)
```

#### Inlay hints — callback async en `useEffect`

```ts
// FIX: el callback del setTimeout debe ser async
const timer = setTimeout(async () => {
  const hints = (await Promise.all(
    extensions.filter(e => e.getInlayHints)
              .map(e => e.getInlayHints!(ctx).catch(() => []))
  )).flat() as InlayHint[]
  setInlayHints(hints)
}, 800)

### Paso 7 — Build y test

```bash
cd ide-lsp
npm install
npm run build          # produce plugin/index.js

# Opción A: desde dentro del directorio del plugin
tsuki-dk sandbox

# Opción B: desde cualquier lugar con --project
tsuki-dk sandbox --project ./packages/ide-lsp

# Opción C: build + sandbox en un solo comando
tsuki-dk sandbox --project ./packages/ide-lsp --build
```

### Paso 8 — Limpiar el IDE

```bash
# Eliminar del IDE core (solo cuando el plugin esté en producción)
rm ide/src/components/experiments/Lsp/LspEngine.ts
rm ide/src/components/experiments/Lsp/LspFeatures.ts
```

---

## Plugin 2: ide-git

### Paso 1 — Crear el paquete

```bash
tsuki-dk new ide-plugin ide-git
cd ide-git
```

### Paso 2 — Copiar archivos

```bash
cp ide/src/components/experiments/GitSidebar/GitSidebar.tsx ide-git/src/GitSidebar.tsx
```

### Paso 3 — Cambios en `GitSidebar.tsx`

#### 3a. Eliminar imports de `@/`

```diff
- import { useStore, GitCommitNode } from '@/lib/store'
- import { Textarea, Btn } from '@/components/shared/primitives'
```

#### 3b. Definir tipos inline

```ts
// Al inicio del archivo, antes de los componentes:
interface GitChange      { letter: 'A'|'M'|'D'; name: string; path: string }
interface GitCommitNode  { hash: string; shortHash: string; message: string; author: string; time: string; branch?: string; parents: string[]; isMerge?: boolean }
```

#### 3c. Reemplazar `useStore()` con context state

```diff
// En cada componente que usaba useStore:
- const { gitChanges, gitBranch, doCommit } = useStore()
+ const [gitChanges,    setGitChanges]    = React.useState(context.getState().gitChanges)
+ const [gitBranch,     setGitBranch]     = React.useState(context.getState().gitBranch)
+ React.useEffect(() => {
+   const u1 = context.onStateChange(s => s.gitChanges,   setGitChanges)
+   const u2 = context.onStateChange(s => s.gitBranch,    setGitBranch)
+   return () => { u1(); u2() }
+ }, [])
+
+ async function doCommit(msg: string) {
+   context.dispatch({ type: 'git:commit', payload: msg })
+ }
```

```diff
- const { commitHistory, gitBranch, gitChanges } = useStore()
+ const [commitHistory, setCommitHistory] = React.useState(context.getState().commitHistory)
+ React.useEffect(() => context.onStateChange(s => s.commitHistory, setCommitHistory), [])
```

#### 3d. Reemplazar `Btn` y `Textarea` con elementos nativos

```diff
- <Textarea value={msg} onChange={e => setMsg(e.target.value)} rows={3} />
+ <textarea
+   value={msg}
+   onChange={(e: any) => setMsg(e.target.value)}
+   rows={3}
+   style={{ width:'100%', resize:'none', fontFamily:'var(--font-mono)',
+            fontSize:11, background:'var(--surface-2)',
+            border:'1px solid var(--border)', borderRadius:4,
+            padding:'4px 6px', color:'var(--fg)', boxSizing:'border-box' }}
+ />

- <Btn onClick={handleCommit} disabled={!msg.trim()}>Commit</Btn>
+ <button
+   onClick={handleCommit} disabled={!msg.trim()}
+   style={{ padding:'4px 12px', fontSize:11,
+            cursor: msg.trim() ? 'pointer' : 'default',
+            background: msg.trim() ? 'var(--fg)' : 'var(--surface-2)',
+            color: msg.trim() ? 'var(--bg)' : 'var(--fg-faint)',
+            border:'1px solid var(--border)', borderRadius:4 }}
+ >Commit</button>
```

#### 3e. `lucide-react` — no es external, se bundlea

Solo cambia la línea de instalación (`npm install lucide-react`).
Los imports `from 'lucide-react'` se quedan igual — esbuild los bundlea.

```bash
npm install lucide-react
```

### Paso 4 — `src/index.tsx`

```tsx
import { GitSidebar } from './GitSidebar'    // componente que acabas de adaptar

export function activate(context: any) {
  context.registerSidebarTab({
    id: 'git', label: 'Git', icon: '⎇',
    render(): HTMLElement {
      const container = document.createElement('div')
      container.style.cssText = 'width:100%;height:100%;overflow:hidden'
      context.renderReact(container, React.createElement(GitSidebar, { context }))
      return container
    },
  })

  context.registerStatusBarItem({
    id: 'git-branch', position: 'left',
    render(): HTMLElement {
      const span = document.createElement('span')
      span.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:10px;font-family:var(--font-mono);color:var(--fg-faint)'
      const update = (branch: string) => { span.textContent = branch ? `⎇ ${branch}` : '' }
      update(context.getState().gitBranch)
      context.onStateChange((s: any) => s.gitBranch, update)
      return span
    },
  })
}
```

### Paso 5 — `tsuki.toml`

```toml
[package]
name        = "ide-git"
version     = "1.0.0"
type        = "ide-plugin"
description = "Git sidebar for tsuki-ide"
author      = "tsuki-team"
license     = "MIT"

[package.signing]
key = "tsuki-team"

[ide-plugin]
entry       = "plugin/index.js"
permissions = ["state:read:git", "state:mutate:git"]
slots       = ["sidebar-tab", "status-bar", "settings-panel"]
```

### Paso 6 — Limpiar el IDE

En `IdeScreen.tsx` ya no hay ningún import de `GitSidebar` (fue eliminado en el
paso de modularización anterior). Nada más que borrar.

---

## Plugin 3: ide-sandbox

> El más complejo — múltiples archivos y dos dependencias de `@/lib/tauri`.

### Paso 1 — Crear el paquete

```bash
tsuki-dk new ide-plugin ide-sandbox
cd ide-sandbox
```

### Paso 2 — Copiar archivos

```bash
SRC=ide/src/components/experiments/SandboxPanel

cp $SRC/SandboxPanel.tsx      ide-sandbox/src/SandboxPanel.tsx
cp $SRC/SandboxDefs.ts        ide-sandbox/src/SandboxDefs.ts
cp $SRC/SandboxShapes.tsx     ide-sandbox/src/SandboxShapes.tsx
cp -r $SRC/hooks/             ide-sandbox/src/hooks/
cp -r $SRC/views/             ide-sandbox/src/views/
cp -r $SRC/components/        ide-sandbox/src/components/
cp -r $SRC/shapes/            ide-sandbox/src/shapes/

# También necesita simBridge y useSimulator
cp ide/src/lib/simBridge.ts    ide-sandbox/src/simBridge.ts
cp ide/src/lib/useSimulator.ts ide-sandbox/src/useSimulator.ts
```

### Paso 3 — Cambios de imports en cada archivo

**Regla:** todo `@/` → ruta relativa dentro de `src/`.

#### `SandboxPanel.tsx`
```diff
- import { useStore } from '@/lib/store'
  // useStore reemplazado por context (ver paso 4)
```

```diff
- const { board } = useStore()
+ const [board, setBoard] = React.useState(context.getState().board)
+ React.useEffect(() => context.onStateChange(s => s.board, setBoard), [])
```

#### `hooks/useCircuit.ts`
```diff
- import { useStore } from '@/lib/store'

- const { sandboxCircuit, setSandboxCircuit, pendingCircuit, clearPendingCircuit } = useStore()
+ // sandboxCircuit/setSandboxCircuit → persistido en localStorage por projectPath
+ // Los hooks ya gestionan esto internamente con localStorage
+ // pendingCircuit → context.on('sandbox:loadCircuit', handler)
+ // clearPendingCircuit → context.dispatch({ type: 'sandbox:clearPending' })
```

Internamente `useCircuit.ts` usa localStorage para persistir el circuito
(`sandboxCircuit`). Puedes dejar esa lógica como está — solo necesitas pasar
`projectPath` como prop desde `SandboxPanel` en vez de leerlo del store:

```diff
- export function useCircuit() {
-   const { sandboxCircuit, setSandboxCircuit, pendingCircuit, clearPendingCircuit } = useStore()
+ export function useCircuit(projectPath: string, context: any) {
+   // localStorage key por proyecto (igual que antes)
+   const key = projectPath ? `tsuki-sandbox:${projectPath}` : 'tsuki-sandbox:global'
+   const [circuit, setCircuit] = React.useState(() => {
+     try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? DEFAULT_CIRCUIT }
+     catch { return DEFAULT_CIRCUIT }
+   })
+
+   // Escuchar pendingCircuit del store vía evento
+   React.useEffect(() => {
+     const pending = context.getState()   // context.getState() no expone pendingCircuit
+     // pendingCircuit se emite como evento del IDE cuando Examples carga un circuito
+     return context.on('sandbox:loadCircuit', (data: any) => {
+       setCircuit(data)
+       localStorage.setItem(key, JSON.stringify(data))
+       context.dispatch({ type: 'sandbox:clearPending' })
+     })
+   }, [])
+
+   function setSandboxCircuit(c: Record<string, unknown>) {
+     setCircuit(c)
+     localStorage.setItem(key, JSON.stringify(c))
+     context.dispatch({ type: 'sandbox:setCircuit', payload: c })
+   }
+
+   return { circuit, setCircuit: setSandboxCircuit }
+ }
```

#### `hooks/useSimRunner.ts`
```diff
- import { useStore } from '@/lib/store'
- import { getTmpSimBundlePath, emitSimBundle, runSimulator } from '@/lib/tauri'
- import { buildPinMap, applyStepResult, ... } from '@/lib/simBridge'
+ import { buildPinMap, applyStepResult, getAnalogInputPins, getDigitalInputPins,
+          getBreadboardBusPeers } from '../simBridge'
```

```diff
- const { board, settings, openTabs, activeTabIdx, projectLanguage } = useStore()
+ const state     = context.getState()
+ const board     = state.board
+ const settings  = state.settings
+ const openTabs  = state.openTabs
+ const activeTab = openTabs[state.activeTabIdx] ?? null
```

```diff
- const bundlePath = await getTmpSimBundlePath()
+ const bundlePath = await context.invokeCommand('get_tmp_sim_bundle_path') as string

- await emitSimBundle(source, board, bundlePath, lang)
+ await context.invokeCommand('emit_sim_bundle', { source, board, bundlePath, lang })

- const handle = await runSimulator(eventId, source, board, steps, onLine)
+ // runSimulator usa event listeners de Tauri — llámalo via invokeCommand
+ // o usa el patrón de spawn_process ya existente:
+ const handle = await context.invokeCommand('run_simulator_plugin', { eventId, source, board, steps })
```

> **Nota sobre runSimulator:** `runSimulator` en `tauri.ts` usa la API interna
> de eventos Tauri para streaming. Lo más sencillo es añadir un comando Tauri
> genérico `run_simulator_plugin` que encapsula esa lógica. Alternativa: exponer
> `emit_sim_bundle` y `spawn_process` por separado y manejar el streaming en
> el plugin.

#### `views/SimView.tsx`
```diff
- import { getAnalogInputPins, getDigitalInputPins } from '@/lib/simBridge'
+ import { getAnalogInputPins, getDigitalInputPins } from '../simBridge'

- import { useStore } from '@/lib/store'
  // reemplazar con props desde SandboxPanel
```

#### `views/CanvasView.tsx`
```diff
- import { useStore } from '@/lib/store'
  // settings se pasa como prop desde SandboxPanel
```

#### `simBridge.ts`
```diff
- import type { TsukiCircuit } from '@/components/experiments/SandboxPanel/SandboxDefs'
- import { COMP_DEFS } from '@/components/experiments/SandboxPanel/SandboxDefs'
- import type { StepResult, SimEvent } from './useSimulator'
+ import type { TsukiCircuit } from './SandboxDefs'
+ import { COMP_DEFS } from './SandboxDefs'
+ import type { StepResult, SimEvent } from './useSimulator'
```

### Paso 4 — `src/index.tsx`

```tsx
import { SandboxPanel } from './SandboxPanel'   // adaptado en paso 3

export function activate(context: any) {
  context.registerWorkstation({
    id: 'sandbox', label: 'Sandbox', icon: '⚡', shortcut: '2',
    render(): HTMLElement {
      const container = document.createElement('div')
      container.style.cssText = 'width:100%;height:100%;overflow:hidden;display:flex;flex-direction:column'
      // SandboxPanel ahora recibe context como prop
      context.renderReact(container, React.createElement(SandboxPanel, {
        fullscreen: true,
        _context: context,
      }))
      return container
    },
  })
}
```

### Paso 5 — `tsuki.toml`

```toml
[package]
name        = "ide-sandbox"
version     = "1.0.0"
type        = "ide-plugin"
description = "Arduino circuit simulator"
author      = "tsuki-team"
license     = "MIT"

[package.signing]
key = "tsuki-team"

[ide-plugin]
entry       = "plugin/index.js"
permissions = [
  "state:read:tabs",
  "state:read:settings",
  "state:mutate:sandbox",
  "state:mutate:log",
  "shell:execute"
]
slots = ["workstation"]
```

### Paso 6 — Emitir evento cuando Examples carga un circuito

En `IdeScreen.tsx`, donde antes se hacía `setSandboxOpen(true)` al recibir
`pendingCircuit`, ahora emite un evento al bus de plugins:

```diff
  useEffect(() => {
    if (!pendingCircuit) return
    clearPendingCircuit()
    if (workstationsEnabled) setWorkstation('sandbox')
+   emitPluginEvent('sandbox:loadCircuit', pendingCircuit.data)
  }, [pendingCircuit?.id])
```

### Paso 7 — Limpiar el IDE

```bash
rm -rf ide/src/components/experiments/SandboxPanel/
# SandboxPanel ya no está importado en IdeScreen.tsx
```

---

## Orden recomendado y tiempo estimado

| Orden | Plugin | Dificultad | Tiempo estimado |
|-------|--------|------------|-----------------|
| 1 | ide-lsp | ★☆☆ — 1 línea cambia | 30 min |
| 2 | ide-git | ★★☆ — 1 archivo, tipos inline | 1-2 h |
| 3 | ide-sandbox | ★★★ — 15 archivos, deps complejas | 3-5 h |

---

## Verificar que funciona

```bash
# 1. Build
cd ide-lsp && npm run build && cd ..

# 2. Sandbox local — opción clásica (desde dentro)
cd ide-lsp && tsuki-dk sandbox

# 2b. Sandbox con --project (desde cualquier directorio)
tsuki-dk sandbox --project ./ide-lsp --build
[sandbox:ide-lsp]> tsuki install ide-lsp
[sandbox:ide-lsp]> # Abrir el IDE — ¿aparece el dialogo de permisos? ✓
[sandbox:ide-lsp]> # ¿Aparecen diagnósticos en el editor? ✓

# 3. Publicar
tsuki-dk publish
```