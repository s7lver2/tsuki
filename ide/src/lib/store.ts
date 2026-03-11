'use client'
import { create } from 'zustand'
import { applyTheme, applyUiScale, applyFontRendering } from './themes'

export type Screen = 'welcome' | 'ide' | 'settings' | 'docs'
export type SidebarTab = 'files' | 'git' | 'packages' | 'examples'
export type BottomTab = 'output' | 'problems' | 'terminal'
export type SettingsTab = 'cli' | 'defaults' | 'editor' | 'appearance' | 'experiments' | 'exp-sandbox' | 'exp-git' | 'exp-lsp' | 'language' | 'developer'

export interface FileNode {
  id: string
  name: string
  type: 'file' | 'dir'
  ext?: string
  content?: string
  path?: string
  git?: 'A' | 'M' | 'D'
  open?: boolean
  children?: string[]
}

export interface TabItem {
  fileId: string
  name: string
  ext: string
  content: string
  modified: boolean
  path?: string
}

export interface GitChange {
  letter: 'A' | 'M' | 'D'
  name: string
  path: string
}

export interface GitCommitNode {
  hash: string
  shortHash: string
  message: string
  author: string
  time: string
  branch?: string
  parents: string[]
  isMerge?: boolean
}

export interface LogLine {
  id: string
  type: 'ok' | 'err' | 'warn' | 'info'
  time: string
  msg: string
}

export interface Problem {
  id: string
  severity: 'error' | 'warning' | 'info'
  file: string
  line: number
  col: number
  message: string
}

export interface PackageEntry {
  name: string
  desc: string
  version: string
  installed: boolean
  installing?: boolean
  /** Latest version URL from registry (used to fetch toml for details) */
  url?: string
}

export interface RecentProject {
  name: string
  path: string
  board: string
  backend: string
  lastOpened: number
}

export interface SettingsState {
  // ── CLI ───────────────────────────────────────────────────────────────────
  tsukiPath: string
  tsukiCorePath: string
  tsukiSimPath: string   // path to tsuki-sim binary (auto-detected by default)
  arduinoCliPath: string
  avrDudePath: string
  // ── Defaults ─────────────────────────────────────────────────────────────
  defaultBoard: string
  defaultBaud: string
  cppStd: string
  verbose: boolean
  autoDetect: boolean
  color: boolean
  libsDir: string
  registryUrl: string
  verifySignatures: boolean
  // ── Editor ───────────────────────────────────────────────────────────────
  fontSize: number
  tabSize: number
  minimap: boolean
  wordWrap: boolean
  formatOnSave: boolean
  trimWhitespace: boolean
  // ── Appearance ───────────────────────────────────────────────────────────
  ideTheme: string      // id from IDE_THEMES
  syntaxTheme: string   // id from SYNTAX_THEMES
  uiScale: number       // 0.80 – 1.25, default 1
  iconPack: string      // id from ICON_PACKS
  showCurrentFlow: boolean  // show current-flow animation on active wires
  // ── Experiments ──────────────────────────────────────────────────────────
  experimentsEnabled: boolean
  // Per-experiment toggles
  expSandboxEnabled: boolean
  expGitEnabled: boolean
  expLspEnabled: boolean
  // ── Developer ─────────────────────────────────────────────────────────────
  developerOptions: boolean
  // ── Language / i18n ──────────────────────────────────────────────────────
  language: 'en' | 'es'
  // ── Docs ─────────────────────────────────────────────────────────────────
  docsLang: 'en' | 'es'
  // ── Advanced ─────────────────────────────────────────────────────────────
  fontRendering: 'auto' | 'crisp' | 'smooth' | 'subpixel'
  tsukiFlashPath: string
  insertSpaces: boolean
  autoCloseBrackets: boolean
  showLineNumbers: boolean
  highlightActiveLine: boolean
  saveOnFocusLoss: boolean
  compileOnSave: boolean
  lspEnabled: boolean
  // ── LSP fine-grained settings ────────────────────────────────────────────
  lspPath: string               // path to tsuki-lsp binary
  lspDiagnosticsEnabled: boolean
  lspCompletionsEnabled: boolean
  lspHoverEnabled: boolean
  lspSignatureHelp: boolean
  lspInlayHints: boolean
  lspDiagnosticDelay: number   // ms before diagnostics run (300–2000)
  lspGoEnabled: boolean
  lspCppEnabled: boolean
  lspInoEnabled: boolean
  lspAutoDownloadLibs: boolean  // silently download missing libs without prompting
  lspShowLibPrompt: boolean     // show popup when a missing lib import is detected
  lspIgnoredLibs: string[]      // libs the user has clicked "don't ask again" for
  // ── Windows ──────────────────────────────────────────────────────────────
  winSpawnMethod: 'shell' | 'direct' | 'detached'
}

interface AppState {
  theme: 'dark' | 'light'   // legacy: kept for toggle-button icon
  toggleTheme: () => void
  screen: Screen
  setScreen: (s: Screen) => void
  projectName: string
  projectPath: string
  projectLanguage: 'go' | 'cpp' | 'ino'
  board: string
  backend: string
  gitInit: boolean
  setBoard: (b: string) => void
  setBackend: (b: string) => void
  setProjectPath: (p: string) => void
  loadProject: (name: string, board: string, template: string, backend?: string, gitInit?: boolean, path?: string, language?: string) => Promise<void>
  loadFromDisk: (folder: string) => Promise<void>
  openExample: (example: { name: string; board?: string; files: Array<{ path: string; name: string; content: string }> }) => void
  sidebarOpen: boolean
  sidebarTab: SidebarTab
  toggleSidebar: (tab: SidebarTab) => void
  bottomTab: BottomTab
  setBottomTab: (t: BottomTab) => void
  settingsTab: SettingsTab
  setSettingsTab: (t: SettingsTab) => void
  tree: FileNode[]
  openTabs: TabItem[]
  activeTabIdx: number
  openFile: (id: string) => void
  closeTab: (idx: number) => void
  updateTabContent: (idx: number, content: string) => void
  saveFile: (idx: number) => Promise<void>
  saveActiveFile: () => Promise<void>
  addFile: (name: string, parentPath?: string) => Promise<void>
  addFolder: (name: string) => Promise<void>
  deleteNode: (id: string) => Promise<void>
  renameNode: (id: string, newName: string) => Promise<void>
  gitChanges: GitChange[]
  gitBranch: string
  commitHistory: GitCommitNode[]
  doCommit: (msg: string) => Promise<void>
  logs: LogLine[]
  addLog: (type: LogLine['type'], msg: string) => void
  clearLogs: () => void
  problems: Problem[]
  setProblems: (problems: Problem[]) => void
  bottomHeight: number
  setBottomHeight: (h: number) => void
  terminalLines: string[]
  addTerminalLine: (line: string) => void
  clearTerminal: () => void
  pendingCommand: { cmd: string; args: string[]; cwd?: string; chainArgs?: string[]; id: number } | null
  dispatchCommand: (cmd: string, args: string[], cwd?: string, chainArgs?: string[]) => void
  clearPendingCommand: () => void
  pendingCircuit: { data: Record<string, unknown>; id: number } | null
  loadCircuitInSandbox: (data: Record<string, unknown>) => void
  clearPendingCircuit: () => void
  /** Persisted sandbox circuit — survives Settings navigation and project reloads */
  sandboxCircuit: Record<string, unknown> | null
  setSandboxCircuit: (c: Record<string, unknown>) => void
  settings: SettingsState
  updateSetting: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void
  packages: PackageEntry[]
  packagesLoaded: boolean
  setPackages: (packages: PackageEntry[]) => void
  togglePackage: (name: string) => void
  setPackageInstalling: (name: string, installing: boolean) => void
  /** Read installed packages from a parsed tsuki_package.json and update the store. */
  syncInstalledPackages: (manifestPkgs: Array<{ name: string; version?: string }>) => void
  recentProjects: RecentProject[]
  addRecentProject: (p: RecentProject) => void
  refreshTree: () => Promise<void>
  previousScreen: Screen
  goBack: () => void
}

// ── Templates ─────────────────────────────────────────────────────────────────

const TEMPLATES_GO: Record<string, string> = {
  blink: `package main\n\nimport "arduino"\n\nconst ledPin = 13\nconst interval = 500 // ms\n\nfunc setup() {\n    arduino.PinMode(ledPin, arduino.OUTPUT)\n    arduino.Serial.Begin(9600)\n    arduino.Serial.Println("Blink ready!")\n}\n\nfunc loop() {\n    arduino.DigitalWrite(ledPin, arduino.HIGH)\n    arduino.Delay(interval)\n    arduino.DigitalWrite(ledPin, arduino.LOW)\n    arduino.Delay(interval)\n}`,
  sensor: `package main\n\nimport (\n    "arduino"\n    "fmt"\n)\n\nfunc setup() {\n    arduino.Serial.Begin(9600)\n}\n\nfunc loop() {\n    val := arduino.AnalogRead(arduino.A0)\n    fmt.Println("sensor:", val)\n    arduino.Delay(500)\n}`,
  serial: `package main\n\nimport (\n    "arduino"\n    "fmt"\n)\n\nfunc setup() {\n    arduino.Serial.Begin(115200)\n    fmt.Println("Serial ready!")\n}\n\nfunc loop() {\n    if arduino.Serial.Available() > 0 {\n        b := arduino.Serial.Read()\n        fmt.Print(string(b))\n    }\n}`,
  servo: `package main\n\nimport (\n    "arduino"\n    "Servo"\n)\n\nvar s Servo.Servo\n\nfunc setup() {\n    s.Attach(9)\n}\n\nfunc loop() {\n    for pos := 0; pos <= 180; pos++ {\n        s.Write(pos)\n        arduino.Delay(15)\n    }\n    for pos := 180; pos >= 0; pos-- {\n        s.Write(pos)\n        arduino.Delay(15)\n    }\n}`,
  empty: `package main\n\nimport "arduino"\n\nfunc setup() {\n    // setup code here\n}\n\nfunc loop() {\n    // main loop\n}`,
}

const TEMPLATES_CPP: Record<string, string> = {
  blink: `#include <Arduino.h>\n\nconst int ledPin = LED_BUILTIN;\nconst int interval = 500;\n\nvoid setup() {\n    pinMode(ledPin, OUTPUT);\n    Serial.begin(9600);\n    Serial.println("Blink ready!");\n}\n\nvoid loop() {\n    digitalWrite(ledPin, HIGH);\n    delay(interval);\n    digitalWrite(ledPin, LOW);\n    delay(interval);\n}`,
  serial: `#include <Arduino.h>\n\nvoid setup() {\n    Serial.begin(115200);\n    Serial.println("Serial ready!");\n}\n\nvoid loop() {\n    if (Serial.available() > 0) {\n        char c = Serial.read();\n        Serial.print(c);\n    }\n}`,
  empty: `#include <Arduino.h>\n\nvoid setup() {\n    // setup code here\n}\n\nvoid loop() {\n    // main loop\n}`,
}

const TEMPLATES_INO: Record<string, string> = {
  blink: `const int ledPin = LED_BUILTIN;\nconst int interval = 500;\n\nvoid setup() {\n    pinMode(ledPin, OUTPUT);\n    Serial.begin(9600);\n    Serial.println("Blink ready!");\n}\n\nvoid loop() {\n    digitalWrite(ledPin, HIGH);\n    delay(interval);\n    digitalWrite(ledPin, LOW);\n    delay(interval);\n}`,
  serial: `void setup() {\n    Serial.begin(115200);\n    Serial.println("Serial ready!");\n}\n\nvoid loop() {\n    if (Serial.available() > 0) {\n        char c = Serial.read();\n        Serial.print(c);\n    }\n}`,
  empty: `void setup() {\n    // setup code here\n}\n\nvoid loop() {\n    // main loop\n}`,
}

const TEMPLATES = TEMPLATES_GO

function templatesForLang(lang: string): Record<string, string> {
  switch (lang) {
    case 'cpp': return TEMPLATES_CPP
    case 'ino': return TEMPLATES_INO
    default:    return TEMPLATES_GO
  }
}

function manifest(name: string, board: string, backend = 'tsuki-flash', language = 'go') {
  const base: Record<string, unknown> = { name, version: '0.1.0', board, backend, language, packages: [] }
  if (language === 'go') base.go_version = '1.21'
  return JSON.stringify(base, null, 2)
}

function ts() {
  return new Date().toTimeString().slice(0, 8)
}

let logId = 0


const DEFAULT_SETTINGS: SettingsState = {
  tsukiPath: '',
  tsukiCorePath: '',
  tsukiSimPath: '',      // auto-detect: same dir as tsuki-core or PATH
  arduinoCliPath: 'arduino-cli',
  avrDudePath: '',
  defaultBoard: 'uno',
  defaultBaud: '9600',
  cppStd: 'c++17',
  verbose: false,
  autoDetect: true,
  color: true,
  libsDir: '~/.tsuki/libs',
  registryUrl: 'https://registry.goduino.dev/v1/index.json',
  verifySignatures: true,
  fontSize: 13,
  tabSize: 2,
  minimap: false,
  wordWrap: false,
  formatOnSave: true,
  trimWhitespace: true,
  // appearance
  ideTheme: 'dark',
  syntaxTheme: 'material',
  uiScale: 1,
  iconPack: 'minimal',
  showCurrentFlow: false,
  // experiments
  experimentsEnabled: false,
  expSandboxEnabled: false,
  expGitEnabled: false,
  expLspEnabled: false,
  developerOptions: false,
  // advanced
  tsukiFlashPath: '',
  insertSpaces: true,
  autoCloseBrackets: true,
  showLineNumbers: true,
  highlightActiveLine: true,
  saveOnFocusLoss: false,
  compileOnSave: false,
  lspEnabled: false,
  lspPath: '',
  lspDiagnosticsEnabled: true,
  lspCompletionsEnabled: true,
  lspHoverEnabled: true,
  lspSignatureHelp: true,
  lspInlayHints: false,
  lspDiagnosticDelay: 600,
  lspGoEnabled: true,
  lspCppEnabled: true,
  lspInoEnabled: true,
  lspAutoDownloadLibs: false,
  lspShowLibPrompt: true,
  lspIgnoredLibs: [],
  winSpawnMethod: 'shell',
  language: 'en',
  docsLang: 'en',
  fontRendering: 'auto',
}

// ── Path helpers ──────────────────────────────────────────────────────────────

function pathJoin(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/')
}

function dirName(p: string): string {
  return p.split('/').slice(0, -1).join('/')
}

// ── Recent projects persistence ───────────────────────────────────────────────

function loadRecentProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem('tsuki-recent')
    if (!raw) return []
    return JSON.parse(raw)
  } catch { return [] }
}

function saveRecentProjects(projects: RecentProject[]) {
  try { localStorage.setItem('tsuki-recent', JSON.stringify(projects.slice(0, 10))) } catch {}
}

// ── Sandbox circuit persistence ───────────────────────────────────────────────

function sandboxKey(projectPath?: string): string {
  return projectPath ? `tsuki-sandbox:${projectPath}` : 'tsuki-sandbox:global'
}

function loadSandboxCircuit(projectPath?: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(sandboxKey(projectPath))
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

function saveSandboxCircuit(circuit: Record<string, unknown>, projectPath?: string) {
  try { localStorage.setItem(sandboxKey(projectPath), JSON.stringify(circuit)) } catch {}
}

// ── Recursive disk scanner ────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.DS_Store', 'target', 'dist', '.next'])

async function scanDir(
  dirPath: string,
  dirName2: string,
  nodes: FileNode[],
  depth = 0,
): Promise<FileNode> {
  const { readDirEntries } = await import('./tauri')
  let entries: { name: string; is_dir: boolean }[] = []
  try { entries = await readDirEntries(dirPath) } catch {}

  const children: string[] = []
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue

    const fullPath = pathJoin(dirPath, entry.name)
    const id = 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5)

    if (entry.is_dir) {
      const childDir = await scanDir(fullPath, entry.name, nodes, depth + 1)
      childDir.id = id
      children.push(id)
      nodes.push(childDir)
    } else {
      const ext = entry.name.split('.').pop() || ''
      const node: FileNode = { id, name: entry.name, type: 'file', ext, path: fullPath }
      children.push(id)
      nodes.push(node)
    }
  }

  return { id: 'tmp', name: dirName2, type: 'dir', path: dirPath, open: depth <= 1, children }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useStore = create<AppState>((set, get) => ({
  theme: 'dark',
  toggleTheme: () => {
    const { settings } = get()
    // Determine current base (dark or light) and flip to the other simple theme
    const { IDE_THEMES: themes } = require('./themes') as typeof import('./themes')
    const current = themes.find(t => t.id === settings.ideTheme) ?? themes[0]
    const nextId  = current.base === 'dark' ? 'light' : 'dark'
    get().updateSetting('ideTheme', nextId)
    set({ theme: current.base === 'dark' ? 'light' : 'dark' })
    try { localStorage.setItem('gdi-theme', current.base === 'dark' ? 'light' : 'dark') } catch {}
  },

  screen: 'welcome',
  previousScreen: 'welcome',
  setScreen: (s: Screen) => set(state => ({ previousScreen: state.screen, screen: s })),
  goBack: () => set(state => ({ screen: state.previousScreen })),

  projectName: '',
  projectPath: '',
  projectLanguage: 'go' as const,
  board: 'uno',
  backend: 'tsuki-flash',
  gitInit: true,
  setBoard: (board) => set({ board }),
  setBackend: (backend) => set({ backend }),
  setProjectPath: (projectPath) => set({ projectPath }),

  // ── loadProject ────────────────────────────────────────────────────────────

  loadProject: async (name, board, template, backend = 'tsuki-flash', gitInit = true, path = '', language = 'go') => {
    const langTemplates = templatesForLang(language)
    const mainContent = langTemplates[template] ?? langTemplates.blink ?? TEMPLATES_GO.blink
    const manifestContent = manifest(name, board, backend, language)
    const gitignoreContent = 'build/\n*.hex\n*.bin\n*.elf\n'

    const tree: FileNode[] = [
      { id: 'root', name, type: 'dir', open: true, path: path || undefined, children: ['manifest', 'src', 'build', 'gitignore'] },
      { id: 'manifest', name: 'tsuki_package.json', type: 'file', ext: 'json', content: manifestContent, path: path ? pathJoin(path, 'tsuki_package.json') : undefined, git: 'A' },
      { id: 'src', name: 'src', type: 'dir', open: true, path: path ? pathJoin(path, 'src') : undefined, children: ['main'] },
      {
        id: 'main',
        name: language === 'cpp' ? 'main.cpp' : language === 'ino' ? `${name}.ino` : 'main.go',
        type: 'file',
        ext:  language === 'cpp' ? 'cpp' : language === 'ino' ? 'ino' : 'go',
        content: mainContent,
        path: path ? pathJoin(path, 'src', language === 'cpp' ? 'main.cpp' : language === 'ino' ? `${name}.ino` : 'main.go') : undefined,
        git: 'A',
      },
      { id: 'build', name: 'build', type: 'dir', open: false, path: path ? pathJoin(path, 'build') : undefined, children: [] },
      { id: 'gitignore', name: '.gitignore', type: 'file', ext: 'txt', content: gitignoreContent, path: path ? pathJoin(path, '.gitignore') : undefined, git: 'A' },
    ]

    const mainFileName = language === 'cpp' ? 'main.cpp' : language === 'ino' ? `${name}.ino` : 'main.go'
    const gitChanges: GitChange[] = [
      { letter: 'A', name: mainFileName,         path: `src/${mainFileName}` },
      { letter: 'A', name: 'tsuki_package.json', path: 'tsuki_package.json' },
      { letter: 'A', name: '.gitignore',          path: '.gitignore' },
    ]

    set({ projectName: name, projectPath: path, projectLanguage: (language as 'go' | 'cpp' | 'ino') ?? 'go', board, backend, gitInit, tree, gitChanges, commitHistory: [], openTabs: [], activeTabIdx: -1, screen: 'ide', logs: [], terminalLines: [] })

    if (path) {
      try {
        const { writeFile, createDirectory, runGit } = await import('./tauri')
        await createDirectory(path)
        await createDirectory(pathJoin(path, 'src'))
        await createDirectory(pathJoin(path, 'build'))
        await writeFile(pathJoin(path, 'tsuki_package.json'), manifestContent)
        await writeFile(pathJoin(path, 'src', mainFileName), mainContent)
        await writeFile(pathJoin(path, '.gitignore'), gitignoreContent)
        const gitExperimentEnabled = get().settings.experimentsEnabled && get().settings.expGitEnabled
        if (gitInit && gitExperimentEnabled) {
          await runGit(['init'], path).catch(() => {})
          await runGit(['add', '-A'], path).catch(() => {})
          await runGit(['commit', '-m', 'Initial commit'], path).catch(() => {})
        }
        get().addLog('ok', `Project files written to ${path}`)
        get().addRecentProject({ name, path, board, backend, lastOpened: Date.now() })
      } catch (e) {
        get().addLog('err', `Failed to write project: ${e}`)
      }
    }

    setTimeout(() => get().openFile('main'), 50)
    get().addLog('info', `Project "${name}" loaded · Lang: ${language} · Board: ${board} · Backend: ${backend}`)
    const gitExperimentActive = get().settings.experimentsEnabled && get().settings.expGitEnabled
    get().addLog('ok', (gitInit && gitExperimentActive) ? 'Git repo initialized · Ready.' : 'Ready.')
  },

  // ── loadFromDisk ───────────────────────────────────────────────────────────

  loadFromDisk: async (folder) => {
    let projectName = folder.split(/[/\\]/).pop() ?? 'project'
    let projectBoard = 'uno'
    let projectBackend = 'tsuki-flash'
    let projectLanguage: 'go' | 'cpp' | 'ino' = 'go'

    try {
      const { readFile } = await import('./tauri')
      // Try tsuki_package.json first, fall back to goduino.json for legacy projects
      let raw: string | null = null
      try { raw = await readFile(pathJoin(folder, 'tsuki_package.json')) } catch {}
      if (!raw) { try { raw = await readFile(pathJoin(folder, 'goduino.json')) } catch {} }
      if (raw) {
        const mf = JSON.parse(raw)
        projectName    = mf.name    ?? projectName
        projectBoard   = mf.board   ?? projectBoard
        projectBackend = mf.backend ?? projectBackend
        if (mf.language === 'cpp' || mf.language === 'ino') projectLanguage = mf.language
        // Sync installed packages from manifest into store
        if (Array.isArray(mf.packages)) {
          get().syncInstalledPackages(mf.packages)
        }
      }
    } catch { /* no manifest */ }

    try {
      const nodes: FileNode[] = []
      const rootNode = await scanDir(folder, projectName, nodes, 0)
      rootNode.id = 'root'
      const allNodes = [rootNode, ...nodes]

      set({ projectName, projectPath: folder, projectLanguage, board: projectBoard, backend: projectBackend, gitInit: false, tree: allNodes, gitChanges: [], commitHistory: [], openTabs: [], activeTabIdx: -1, screen: 'ide', logs: [], terminalLines: [] })

      // Load sandbox circuit for this project (per-project persistence)
      const savedCircuit = loadSandboxCircuit(folder)
      if (savedCircuit) set({ sandboxCircuit: savedCircuit })

      // Find the main source file for any language
      const mainNode = allNodes.find(n =>
        n.type === 'file' && (
          n.name === 'main.go' ||
          n.name === 'main.cpp' ||
          n.name?.endsWith('.ino') ||
          (projectLanguage === 'go' && n.name?.endsWith('.go')) ||
          (projectLanguage === 'cpp' && n.name?.endsWith('.cpp')) ||
          (projectLanguage === 'ino' && n.name?.endsWith('.ino'))
        )
      )
      if (mainNode) setTimeout(() => get().openFile(mainNode.id), 50)

      get().addLog('info', `Opened "${projectName}" from ${folder}`)
      get().addLog('ok', 'Ready.')
      get().addRecentProject({ name: projectName, path: folder, board: projectBoard, backend: projectBackend, lastOpened: Date.now() })
    } catch (e) {
      get().addLog('err', `Failed to open folder: ${e}`)
    }
  },

  // ── openExample ────────────────────────────────────────────────────────────
  openExample: ({ name, board, files }) => {
    const exBoard = board ?? get().board ?? 'uno'
    const mainFile = files.find(f => f.name.endsWith('.go') || f.name === 'main.go' || f.name.endsWith('.ino')) ?? files[0]
    const manifestContent = manifest(name, exBoard)

    // Build tree
    const nodes: FileNode[] = []
    const srcChildren: string[] = []
    const circuitChildren: string[] = []

    files.forEach((f, i) => {
      const id = `ex_${i}_${Math.random().toString(36).slice(2, 6)}`
      const ext = f.name.split('.').pop() ?? ''
      const inCircuits = f.path.startsWith('circuits/')
      const node: FileNode = { id, name: f.name, type: 'file', ext, content: f.content, git: 'A' }
      nodes.push(node)
      if (inCircuits) circuitChildren.push(id)
      else srcChildren.push(id)
    })

    const srcId = 'ex_src'
    const circId = 'ex_circuits'
    const manifestId = 'ex_manifest'
    const rootId = 'root'

    const manifestNode: FileNode = { id: manifestId, name: 'tsuki_package.json', type: 'file', ext: 'json', content: manifestContent, git: 'A' }
    const srcDir: FileNode = { id: srcId, name: 'src', type: 'dir', open: true, children: srcChildren }
    const rootChildren = [manifestId, srcId]

    if (circuitChildren.length > 0) {
      const circDir: FileNode = { id: circId, name: 'circuits', type: 'dir', open: false, children: circuitChildren }
      nodes.push(circDir)
      rootChildren.push(circId)
    }

    const rootNode: FileNode = { id: rootId, name: name, type: 'dir', open: true, children: rootChildren }
    const tree = [rootNode, manifestNode, srcDir, ...nodes]

    set({ projectName: name, board: exBoard, tree, openTabs: [], activeTabIdx: -1, screen: 'ide', logs: [], terminalLines: [], projectPath: '' })

    const mainNode = nodes.find(n => mainFile && n.name === mainFile.name)
    if (mainNode) setTimeout(() => get().openFile(mainNode.id), 50)
    get().addLog('info', `Example "${name}" loaded · Board: ${exBoard}`)
    get().addLog('ok', 'Ready. This is an in-memory preview — use Save or set a project path to persist.')
  },

  sidebarOpen: true,
  sidebarTab: 'files',
  toggleSidebar: (tab) => {
    const { sidebarOpen, sidebarTab } = get()
    if (sidebarOpen && sidebarTab === tab) set({ sidebarOpen: false })
    else set({ sidebarOpen: true, sidebarTab: tab })
  },

  bottomTab: 'output',
  setBottomTab: (bottomTab) => set({ bottomTab }),

  settingsTab: 'cli',
  setSettingsTab: (settingsTab) => set({ settingsTab }),

  tree: [],
  openTabs: [],
  activeTabIdx: -1,

  openFile: (id) => {
    const node = get().tree.find(n => n.id === id)
    if (!node || node.type === 'dir') return

    const existing = get().openTabs.findIndex(t => t.fileId === id)
    if (existing >= 0) { set({ activeTabIdx: existing }); return }

    if (node.content !== undefined) {
      const tab: TabItem = { fileId: id, name: node.name, ext: node.ext || '', content: node.content, modified: false, path: node.path }
      const tabs = [...get().openTabs, tab]
      set({ openTabs: tabs, activeTabIdx: tabs.length - 1 })
      return
    }

    if (node.path) {
      import('./tauri').then(({ readFile }) =>
        readFile(node.path!).then(content => {
          const tree = get().tree.map(n => n.id === id ? { ...n, content } : n)
          const tab: TabItem = { fileId: id, name: node.name, ext: node.ext || '', content, modified: false, path: node.path }
          const tabs = [...get().openTabs, tab]
          set({ tree, openTabs: tabs, activeTabIdx: tabs.length - 1 })
        }).catch(() => {
          const tab: TabItem = { fileId: id, name: node.name, ext: node.ext || '', content: '', modified: false, path: node.path }
          const tabs = [...get().openTabs, tab]
          set({ openTabs: tabs, activeTabIdx: tabs.length - 1 })
        })
      )
    } else {
      const tab: TabItem = { fileId: id, name: node.name, ext: node.ext || '', content: '', modified: false }
      const tabs = [...get().openTabs, tab]
      set({ openTabs: tabs, activeTabIdx: tabs.length - 1 })
    }
  },

  closeTab: (idx) => {
    const tabs = get().openTabs.filter((_, i) => i !== idx)
    let active = get().activeTabIdx
    if (active >= tabs.length) active = tabs.length - 1
    set({ openTabs: tabs, activeTabIdx: active })
  },

  updateTabContent: (idx, content) => {
    const tabs = [...get().openTabs]
    const tree = [...get().tree]
    tabs[idx] = { ...tabs[idx], content, modified: true }
    const nodeIdx = tree.findIndex(n => n.id === tabs[idx].fileId)
    if (nodeIdx >= 0) tree[nodeIdx] = { ...tree[nodeIdx], content, git: tree[nodeIdx].git || 'M' }
    set({ openTabs: tabs, tree })
  },

  saveFile: async (idx) => {
    const tabs = get().openTabs
    if (idx < 0 || idx >= tabs.length) return
    const tab = tabs[idx]
    const newTabs = [...tabs]
    newTabs[idx] = { ...tab, modified: false }
    const tree = get().tree.map(n => n.id === tab.fileId ? { ...n, content: tab.content, git: n.git === 'A' ? 'A' as const : 'M' as const } : n)
    const gitChanges = get().gitChanges
    const alreadyTracked = gitChanges.some(c => c.name === tab.name)
    const newGitChanges = alreadyTracked ? gitChanges : [...gitChanges, { letter: 'M' as const, name: tab.name, path: tab.path ?? tab.name }]
    set({ openTabs: newTabs, tree, gitChanges: newGitChanges })
    const node = get().tree.find(n => n.id === tab.fileId)
    const filePath = tab.path ?? node?.path
    if (filePath) {
      try {
        const { writeFile } = await import('./tauri')
        await writeFile(filePath, tab.content)
        get().addLog('info', `Saved ${tab.name}`)
      } catch (e) {
        get().addLog('err', `Save failed: ${e}`)
      }
    } else {
      get().addLog('info', `${tab.name} saved (in-memory)`)
    }
  },

  saveActiveFile: async () => { await get().saveFile(get().activeTabIdx) },

  addFile: async (name, parentPath) => {
    const id = 'f_' + Date.now()
    const ext = name.split('.').pop() || 'txt'
    const projectPath = get().projectPath
    const filePath = parentPath ? pathJoin(parentPath, name) : projectPath ? pathJoin(projectPath, 'src', name) : undefined
    const node: FileNode = { id, name, type: 'file', ext, content: '', path: filePath, git: 'A' }
    const tree = [...get().tree, node]
    const src = tree.find(n => n.id === 'src')
    if (src) src.children = [...(src.children || []), id]
    else { const root = tree.find(n => n.id === 'root'); if (root) root.children = [...(root.children || []), id] }
    const gitChanges = [...get().gitChanges, { letter: 'A' as const, name, path: `src/${name}` }]
    set({ tree, gitChanges })
    get().openFile(id)
    if (filePath) { try { const { writeFile } = await import('./tauri'); await writeFile(filePath, '') } catch {} }
  },

  addFolder: async (name) => {
    const id = 'd_' + Date.now()
    const projectPath = get().projectPath
    const dirPath = projectPath ? pathJoin(projectPath, name) : undefined
    const node: FileNode = { id, name, type: 'dir', open: false, children: [], path: dirPath }
    const tree = [...get().tree, node]
    const root = tree.find(n => n.id === 'root')
    if (root) root.children = [...(root.children || []), id]
    set({ tree })
    if (dirPath) { try { const { createDirectory } = await import('./tauri'); await createDirectory(dirPath) } catch {} }
  },

  deleteNode: async (id) => {
    const { tree, openTabs } = get()
    const node = tree.find(n => n.id === id)
    if (!node) return
    const tabIdx = openTabs.findIndex(t => t.fileId === id)
    if (tabIdx >= 0) get().closeTab(tabIdx)
    const newTree = tree.filter(n => n.id !== id).map(n => ({ ...n, children: n.children?.filter(c => c !== id) }))
    const gitChanges = node.type === 'file' ? [...get().gitChanges, { letter: 'D' as const, name: node.name, path: node.path ?? node.name }] : get().gitChanges
    set({ tree: newTree, gitChanges })
    if (node.path) { try { const { deleteFile } = await import('./tauri'); await deleteFile(node.path) } catch {} }
  },

  renameNode: async (id, newName) => {
    const node = get().tree.find(n => n.id === id)
    if (!node) return
    const newPath = node.path ? pathJoin(dirName(node.path), newName) : undefined
    const tree = get().tree.map(n => n.id === id ? { ...n, name: newName, path: newPath, git: n.git || 'M' as const } : n)
    const openTabs = get().openTabs.map(t => t.fileId === id ? { ...t, name: newName, path: newPath } : t)
    set({ tree, openTabs })
    if (node.path && newPath) { try { const { renamePath } = await import('./tauri'); await renamePath(node.path, newPath) } catch {} }
  },

  gitChanges: [],
  gitBranch: 'main',
  commitHistory: [],

  doCommit: async (msg) => {
    const { projectPath } = get()
    const changedFiles = get().gitChanges.length
    const hash = Math.random().toString(16).slice(2, 9)
    const timeStr = new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
    const newCommit: GitCommitNode = { hash, shortHash: hash.slice(0, 7), message: msg, author: 'you', time: timeStr, branch: get().gitBranch, parents: get().commitHistory.length > 0 ? [get().commitHistory[0].hash] : [] }
    const tree = get().tree.map(n => ({ ...n, git: undefined }))
    set({ gitChanges: [], tree, commitHistory: [newCommit, ...get().commitHistory] })
    get().addLog('ok', `[${get().gitBranch}] ${hash.slice(0, 7)} ${msg} (${changedFiles} file${changedFiles !== 1 ? 's' : ''})`)
    if (projectPath) {
      try {
        const { runGit } = await import('./tauri')
        await runGit(['add', '-A'], projectPath)
        const out = await runGit(['commit', '-m', msg], projectPath)
        if (out.trim()) get().addLog('ok', out.trim().split('\n')[0])
      } catch (e) { get().addLog('warn', `git: ${e}`) }
    }
  },

  logs: [],
  addLog: (type, msg) => { const line: LogLine = { id: String(logId++), type, time: ts(), msg }; set({ logs: [...get().logs, line] }) },
  clearLogs: () => set({ logs: [] }),

  problems: [],
  setProblems: (problems) => set({ problems }),

  bottomHeight: 200,
  setBottomHeight: (h) => set({ bottomHeight: Math.max(80, Math.min(h, 600)) }),

  terminalLines: [],
  addTerminalLine: (line) => set((s) => ({ terminalLines: [...s.terminalLines, line] })),
  clearTerminal: () => set({ terminalLines: [] }),
  pendingCommand: null,
  dispatchCommand: (cmd, args, cwd, chainArgs) => {
    set({ pendingCommand: { cmd, args, cwd, chainArgs, id: Date.now() } })
  },
  clearPendingCommand: () => set({ pendingCommand: null }),

  pendingCircuit: null,
  loadCircuitInSandbox: (data) => set({ pendingCircuit: { data, id: Date.now() } }),
  clearPendingCircuit: () => set({ pendingCircuit: null }),

  sandboxCircuit: typeof window !== 'undefined' ? loadSandboxCircuit() : null,
  setSandboxCircuit: (circuit) => {
    set({ sandboxCircuit: circuit })
    const { projectPath } = get()
    saveSandboxCircuit(circuit, projectPath || undefined)
  },

  settings: DEFAULT_SETTINGS,

  updateSetting: (key, value) => {
    set((s) => {
      const next = { ...s.settings, [key]: value }
      import('./tauri').then(({ saveSettings }) => saveSettings(next)).catch(() => {})

      if (typeof window !== 'undefined') {
        // Apply theme immediately when appearance settings change
        if (key === 'ideTheme' || key === 'syntaxTheme') {
          const ideTheme    = key === 'ideTheme'    ? (value as string) : s.settings.ideTheme
          const syntaxTheme = key === 'syntaxTheme' ? (value as string) : s.settings.syntaxTheme
          applyTheme(ideTheme, syntaxTheme)
          // Keep the legacy theme flag in sync for icon display
          if (key === 'ideTheme') {
            const { IDE_THEMES } = require('./themes') as typeof import('./themes')
            const base = IDE_THEMES.find(t => t.id === (value as string))?.base ?? 'dark'
            useStore.setState({ theme: base })
            try { localStorage.setItem('gdi-theme', base) } catch {}
          }
        }
        if (key === 'uiScale') {
          applyUiScale(value as number)
        }
        if (key === 'fontRendering') {
          applyFontRendering(value as 'auto' | 'crisp' | 'smooth' | 'subpixel')
        }
      }

      return { settings: next }
    })
  },

  packages: [],
  packagesLoaded: false,
  setPackages: (packages) => set({ packages, packagesLoaded: true }),
  togglePackage: (name) => set((s) => ({ packages: s.packages.map(p => p.name === name ? { ...p, installed: !p.installed } : p) })),
  setPackageInstalling: (name, installing) => set((s) => ({ packages: s.packages.map(p => p.name === name ? { ...p, installing } : p) })),

  syncInstalledPackages: (manifestPkgs) => {
    const installedNames = new Set(manifestPkgs.map(p => p.name))
    set((s) => {
      // Update installed flag on existing registry entries
      const updated = s.packages.map(p => ({ ...p, installed: installedNames.has(p.name) }))
      // Add stub entries for packages in the manifest that are not yet in the registry
      const existingNames = new Set(updated.map(p => p.name))
      const stubs = manifestPkgs
        .filter(p => !existingNames.has(p.name))
        .map(p => ({ name: p.name, desc: '', version: p.version ?? '', installed: true }))
      return { packages: [...updated, ...stubs] }
    })
  },

  recentProjects: typeof window !== 'undefined' ? loadRecentProjects() : [],
  addRecentProject: (project) => {
    const current = get().recentProjects.filter(r => r.path !== project.path)
    const updated = [project, ...current].slice(0, 10)
    set({ recentProjects: updated })
    saveRecentProjects(updated)
  },

  refreshTree: async () => {
    const { projectPath, tree: oldTree } = get()
    if (!projectPath) return
    try {
      const nodes: FileNode[] = []
      const rootNode = await scanDir(projectPath, projectPath.split(/[/\\]/).pop() ?? 'project', nodes, 0)
      rootNode.id = 'root'
      const allNodes = [rootNode, ...nodes]
      const contentMap = new Map<string, string>()
      for (const n of oldTree) { if (n.path && n.content !== undefined) contentMap.set(n.path, n.content) }
      const merged = allNodes.map(n => (n.path && contentMap.has(n.path)) ? { ...n, content: contentMap.get(n.path) } : n)
      set({ tree: merged })
    } catch (e) { get().addLog('err', `refreshTree failed: ${e}`) }
  },
}))

// ── Bootstrap: load persisted settings and apply theme on startup ─────────────

if (typeof window !== 'undefined') {
  import('./tauri').then(({ loadSettings }) =>
    loadSettings().then(raw => {
      try {
        const saved = JSON.parse(raw)
        if (saved && typeof saved === 'object') {
          const merged: SettingsState = { ...DEFAULT_SETTINGS, ...saved }
          useStore.setState({ settings: merged })
          // Apply theme from disk immediately
          applyTheme(merged.ideTheme, merged.syntaxTheme)
          applyUiScale(merged.uiScale)
          applyFontRendering(merged.fontRendering)
          // Sync legacy theme flag
          const { IDE_THEMES } = require('./themes') as typeof import('./themes')
          const base = IDE_THEMES.find(t => t.id === merged.ideTheme)?.base ?? 'dark'
          useStore.setState({ theme: base })
        }
      } catch {}
    }).catch(() => {})
  )
}