'use client'
import { create } from 'zustand'
import { applyTheme, applyUiScale, applyFontRendering, applyCompactMode } from './themes'

export type Screen = 'welcome' | 'ide' | 'settings' | 'docs'
export type SidebarTab = 'files' | 'git' | 'packages' | 'examples' | 'explorer'
export type BottomTab = 'output' | 'problems' | 'terminal' | 'monitor' | 'explorer'
export type SettingsTab = 'cli' | 'defaults' | 'editor' | 'appearance' | 'experiments' | 'exp-sandbox' | 'exp-git' | 'exp-lsp' | 'exp-workstations' | 'exp-webkit' | 'language' | 'developer' | 'profile' | 'updates' | 'export'

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
  /** True when the file lives inside the project's build/ directory.
   *  In build-file mode the editor is read-only and LSP is suppressed
   *  unless the user enables `allowEditBuildFiles` in settings. */
  buildFile?: boolean
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

// ── Profiles ──────────────────────────────────────────────────────────────────

/**
 * A named settings profile. Each profile stores its own copy of SettingsState
 * so users can switch between e.g. "home/AVR" and "work/ESP32" configs.
 */
export interface UserProfile {
  id: string
  name: string
  avatarDataUrl: string
  createdAt: number
  /** Partial settings overrides for this profile. Merged on top of DEFAULT_SETTINGS when active. */
  settings: Partial<SettingsState>
}

function makeProfileId() {
  return `profile_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export interface SettingsState {
  // ── Profile ───────────────────────────────────────────────────────────────
  username: string          // display name shown in the IDE header
  avatarDataUrl: string     // base64 data URL of the user's profile picture
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
  extraLibsDirs: string[]   // additional package search paths (merged with libsDir)
  registryUrl: string
  registryUrls: string[]   // additional registry sources (merged with registryUrl)
  verifySignatures: boolean
  // -- Updates
  updateChannel: 'stable' | 'testing'
  autoCheckUpdates: boolean
  lastUpdateCheck: number | null    // unix ms
  lastSeenVersion: string | null    // last version the user dismissed
  /** If set, forces re-show of onboarding when this version > tsuki-onboarding-version in localStorage */
  forcedOnboardingVersion: string | null
  /** If set, shows a What's New popup for this version (major updates) */
  whatsNewVersion: string | null
  /** JSON-encoded changelog entries for the What's New popup */
  whatsNewChangelog: string | null
  /** User's selected plan */
  plan: 'normal' | 'pro'
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
  // ── Sandbox wire settings ─────────────────────────────────────────────────
  sandboxWireStyle: 'orthogonal' | 'smooth' | 'flexible' | 'direct'
  sandboxWirePalette: 'classic' | 'monochrome' | 'pastel' | 'custom'
  sandboxWireCustomColors: string[]   // custom palette (up to 9 colors)
  sandboxAutoColorVcc: boolean        // auto-color wires connected to VCC
  sandboxAutoColorGnd: boolean        // auto-color wires connected to GND
  sandboxVccColor: string             // color to use for VCC wires
  sandboxGndColor: string             // color to use for GND wires
  // ── Layout ────────────────────────────────────────────────────────────────
  ideLayout: 'default' | 'focused' | 'wide-editor' | 'minimal' | 'custom'
  sidebarWidth: number          // px, 140–480
  bottomPanelHeight: number     // px, 80–600
  // ── Experiments ──────────────────────────────────────────────────────────
  experimentsEnabled: boolean
  // Per-experiment toggles
  expSandboxEnabled: boolean
  expGitEnabled: boolean
  expLspEnabled: boolean
  expWorkstationsEnabled: boolean  // Workstation page bar (DaVinci-style Code/Sandbox/Export)
  expWebkitEnabled: boolean        // tsuki-webkit JSX panel + Simulate Webkit sandbox toggle
  tsukiWebkitPath: string          // path to tsuki-webkit binary (auto-detect if empty)
  // ── Developer ─────────────────────────────────────────────────────────────
  developerOptions: boolean
  // ── Language / i18n ──────────────────────────────────────────────────────
  language: 'en' | 'es'
  // ── Docs ─────────────────────────────────────────────────────────────────
  docsLang: 'en' | 'es'
  // ── Advanced ─────────────────────────────────────────────────────────────
  fontRendering: 'auto' | 'crisp' | 'smooth' | 'subpixel'
  compactMode: boolean          // tighter spacing, smaller topbar
  topbarLabels: boolean         // show text labels on topbar action buttons
  adaptiveSidebar: boolean      // auto-collapse sidebar below minWindowWidth
  minWindowWidth: number        // px threshold for auto-sidebar collapse
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
  // ── Build files ───────────────────────────────────────────────────────────
  /** When false (default), files inside build/ open in read-only view mode with
   *  LSP disabled. Set to true in Settings → Editor to allow editing them. */
  allowEditBuildFiles: boolean
  // ── Serial monitor ────────────────────────────────────────────────────────
  monitorPort: string       // last used serial port
  monitorBaud: string       // last used baud rate
  // ── Windows ──────────────────────────────────────────────────────────────
  winSpawnMethod: 'shell' | 'direct' | 'detached'
  // ── Export workstation ────────────────────────────────────────────────────
  exportFileView:  'list' | 'cards'
  exportOutDir:    string
  exportVersion:   string
  exportInclSource: boolean
  exportInclBuild:  boolean
  exportGhToken:   string
  exportGhPublic:  boolean
  exportDockerTag: string
  // ── File explorer panel ───────────────────────────────────────────────────
  explorerLocation: 'sidebar' | 'bottom'
  // ── Debug / Logging ───────────────────────────────────────────────────────
  // Requires app restart to take effect (logging starts at process init).
  debugMode: boolean
  debugLogFormat: 'flat' | 'structured'
  debugLogCategories: {
    spawn:    boolean   // spawn_process / spawn_shell calls
    pty:      boolean   // pty_create / pty_write / pty_resize / pty_kill lifecycle
    resolve:  boolean   // normalise_cmd / resolve_cmd path resolution
    settings: boolean   // settings read/write, path detection
    shell:    boolean   // shell list detection, shell spawn
    process:  boolean   // process exit codes, write_stdin, kill_process
    frontend: boolean   // console.log/warn/error forwarded from the renderer
  }
}

interface AppState {
  theme: 'dark' | 'light'   // legacy: kept for toggle-button icon
  toggleTheme: () => void
  screen: Screen
  setScreen: (s: Screen) => void
  projectName: string
  projectPath: string
  projectLanguage: 'go' | 'cpp' | 'ino' | 'python'
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
  /**
   * Like dispatchCommand but routes output to the Output tab (addLog) instead
   * of the Terminal's raw cmdLines area. Used for build/upload toolbar actions.
   */
  dispatchBuild: (cmd: string, args: string[], cwd?: string, chainArgs?: string[]) => void
  pendingBuild: { cmd: string; args: string[]; cwd?: string; chainArgs?: string[]; id: number } | null
  clearPendingBuild: () => void
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
  // ── Profiles ───────────────────────────────────────────────────────────────
  profiles: UserProfile[]
  activeProfileId: string
  /** Create a new profile and immediately switch to it. Returns the new profile's id. */
  createProfile: (name: string, avatarDataUrl?: string, initialSettings?: Partial<SettingsState>) => string
  /** Switch the active profile, merging its settings over DEFAULT_SETTINGS. */
  switchProfile: (id: string) => void
  /** Delete a profile by id. Cannot delete the last remaining profile. */
  deleteProfile: (id: string) => void
  /** Update a setting on the currently active profile (persisted in profiles array). */
  updateProfileField: (id: string, patch: { name?: string; avatarDataUrl?: string }) => void
}

// ── Templates ─────────────────────────────────────────────────────────────────

const TEMPLATES_GO: Record<string, string> = {
  blink:   `package main\n\nimport "arduino"\n\nconst ledPin = 13\nconst interval = 500 // ms\n\nfunc setup() {\n    arduino.PinMode(ledPin, arduino.OUTPUT)\n    arduino.Serial.Begin(9600)\n    arduino.Serial.Println("Blink ready!")\n}\n\nfunc loop() {\n    arduino.DigitalWrite(ledPin, arduino.HIGH)\n    arduino.Delay(interval)\n    arduino.DigitalWrite(ledPin, arduino.LOW)\n    arduino.Delay(interval)\n}`,
  serial:  `package main\n\nimport (\n    "arduino"\n    "fmt"\n)\n\nfunc setup() {\n    arduino.Serial.Begin(115200)\n    fmt.Println("Serial ready!")\n}\n\nfunc loop() {\n    if arduino.Serial.Available() > 0 {\n        b := arduino.Serial.Read()\n        fmt.Print(string(b))\n    }\n}`,
  sensor:  `package main\n\nimport (\n    "arduino"\n    "fmt"\n)\n\nfunc setup() {\n    arduino.Serial.Begin(9600)\n}\n\nfunc loop() {\n    val := arduino.AnalogRead(arduino.A0)\n    fmt.Println("sensor:", val)\n    arduino.Delay(500)\n}`,
  servo:   `package main\n\nimport (\n    "arduino"\n    "Servo"\n)\n\nvar s Servo.Servo\n\nfunc setup() {\n    s.Attach(9)\n}\n\nfunc loop() {\n    for pos := 0; pos <= 180; pos++ {\n        s.Write(pos)\n        arduino.Delay(15)\n    }\n    for pos := 180; pos >= 0; pos-- {\n        s.Write(pos)\n        arduino.Delay(15)\n    }\n}`,
  dht:     `package main\n\nimport (\n    "arduino"\n    "dht"\n    "fmt"\n    "time"\n)\n\nconst SENSOR_PIN = 2\n\nvar sensor = dht.New(SENSOR_PIN, dht.DHT22)\n\nfunc setup() {\n    arduino.Serial.Begin(9600)\n    sensor.Begin()\n    fmt.Println("DHT22 ready!")\n}\n\nfunc loop() {\n    temp := sensor.ReadTemperature()\n    hum  := sensor.ReadHumidity()\n    fmt.Println("Temp:", temp, "Humidity:", hum)\n    time.Sleep(2000 * time.Millisecond)\n}`,
  ws2812:  `package main\n\nimport (\n    "arduino"\n    "ws2812"\n)\n\nconst LED_PIN  = 6\nconst NUM_LEDS = 8\n\nvar strip = ws2812.New(NUM_LEDS, LED_PIN)\n\nfunc setup() {\n    strip.Begin()\n    arduino.Serial.Begin(9600)\n}\n\nfunc loop() {\n    strip.SetPixelColor(0, ws2812.Color(255, 0, 0))\n    strip.Show()\n    arduino.Delay(500)\n    strip.SetPixelColor(0, ws2812.Color(0, 0, 0))\n    strip.Show()\n    arduino.Delay(500)\n}`,
  mpu6050: `package main\n\nimport (\n    "arduino"\n    "mpu6050"\n    "fmt"\n    "time"\n)\n\nvar imu = mpu6050.New()\n\nfunc setup() {\n    arduino.Serial.Begin(9600)\n    imu.Begin()\n    fmt.Println("MPU6050 ready!")\n}\n\nfunc loop() {\n    ax := imu.GetAccelX()\n    ay := imu.GetAccelY()\n    az := imu.GetAccelZ()\n    fmt.Println("Accel:", ax, ay, az)\n    time.Sleep(500 * time.Millisecond)\n}`,
  empty:   `package main\n\nimport "arduino"\n\nfunc setup() {\n    // setup code here\n}\n\nfunc loop() {\n    // main loop\n}`,
}

const TEMPLATES_CPP: Record<string, string> = {
  blink:  `#include <Arduino.h>\n\nconst int ledPin   = LED_BUILTIN;\nconst int interval = 500;\n\nvoid setup() {\n    pinMode(ledPin, OUTPUT);\n    Serial.begin(9600);\n    Serial.println("Blink ready!");\n}\n\nvoid loop() {\n    digitalWrite(ledPin, HIGH);\n    delay(interval);\n    digitalWrite(ledPin, LOW);\n    delay(interval);\n}`,
  serial: `#include <Arduino.h>\n\nvoid setup() {\n    Serial.begin(115200);\n    Serial.println("Serial ready!");\n}\n\nvoid loop() {\n    if (Serial.available() > 0) {\n        char c = Serial.read();\n        Serial.print(c);\n    }\n}`,
  empty:  `#include <Arduino.h>\n\nvoid setup() {\n    // setup code here\n}\n\nvoid loop() {\n    // main loop\n}`,
}

const TEMPLATES_INO: Record<string, string> = {
  blink:  `const int ledPin   = LED_BUILTIN;\nconst int interval = 500;\n\nvoid setup() {\n    pinMode(ledPin, OUTPUT);\n    Serial.begin(9600);\n    Serial.println("Blink ready!");\n}\n\nvoid loop() {\n    digitalWrite(ledPin, HIGH);\n    delay(interval);\n    digitalWrite(ledPin, LOW);\n    delay(interval);\n}`,
  serial: `void setup() {\n    Serial.begin(115200);\n    Serial.println("Serial ready!");\n}\n\nvoid loop() {\n    if (Serial.available() > 0) {\n        char c = Serial.read();\n        Serial.print(c);\n    }\n}`,
  empty:  `void setup() {\n    // setup code here\n}\n\nvoid loop() {\n    // main loop\n}`,
}

const TEMPLATES_PYTHON: Record<string, string> = {
  blink:  `import arduino\nimport time\n\nLED_PIN: int = 13\n\ndef setup():\n    arduino.pinMode(LED_PIN, arduino.OUTPUT)\n\ndef loop():\n    arduino.digitalWrite(LED_PIN, arduino.HIGH)\n    time.sleep_ms(500)\n    arduino.digitalWrite(LED_PIN, arduino.LOW)\n    time.sleep_ms(500)`,
  serial: `import arduino\nimport time\n\ndef setup():\n    arduino.Serial.begin(115200)\n    print("Serial ready!")\n\ndef loop():\n    if arduino.Serial.available() > 0:\n        b: int = arduino.Serial.read()\n        print(str(b))`,
  sensor: `import arduino\nimport time\n\ndef setup():\n    arduino.Serial.begin(9600)\n\ndef loop():\n    val: int = arduino.analogRead(arduino.A0)\n    print(val)\n    time.sleep_ms(500)`,
  dht:    `import arduino\nimport dht\nimport time\n\nSENSOR_PIN: int = 2\nsensor = dht.new(SENSOR_PIN, dht.DHT22)\n\ndef setup():\n    arduino.Serial.begin(9600)\n    sensor.begin()\n    print("DHT22 ready!")\n\ndef loop():\n    temp: float = sensor.read_temperature()\n    hum:  float = sensor.read_humidity()\n    print(temp)\n    print(hum)\n    time.sleep_ms(2000)`,
  ws2812: `import arduino\nimport ws2812\n\nLED_PIN: int  = 6\nNUM_LEDS: int = 8\nstrip = ws2812.new(NUM_LEDS, LED_PIN)\n\ndef setup():\n    strip.begin()\n    arduino.Serial.begin(9600)\n\ndef loop():\n    strip.set_pixel_color(0, ws2812.color(255, 0, 0))\n    strip.show()\n    arduino.delay(500)\n    strip.set_pixel_color(0, ws2812.color(0, 0, 0))\n    strip.show()\n    arduino.delay(500)`,
  empty:  `import arduino\n\ndef setup():\n    pass\n\ndef loop():\n    pass`,
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TEMPLATES = TEMPLATES_GO

/** Packages required by each template. Injected into tsuki_package.json at project creation. */
const TEMPLATE_PACKAGES: Record<string, Array<{ name: string; version: string }>> = {
  dht:     [{ name: 'dht',     version: '^1.0.0' }],
  ws2812:  [{ name: 'ws2812',  version: '^1.0.0' }],
  mpu6050: [{ name: 'mpu6050', version: '^1.0.0' }],
  servo:   [{ name: 'Servo',   version: '^1.0.0' }],
}

function templatesForLang(lang: string): Record<string, string> {
  switch (lang) {
    case 'python': return TEMPLATES_PYTHON
    case 'cpp':    return TEMPLATES_CPP
    case 'ino':    return TEMPLATES_INO
    default:       return TEMPLATES_GO
  }
}

function manifest(
  name:     string,
  board:    string,
  backend   = 'tsuki-flash',
  language  = 'go',
  packages: Array<{ name: string; version: string }> = [],
) {
  const base: Record<string, unknown> = { name, version: '0.1.0', board, backend, language, packages }
  if (language === 'go') base.go_version = '1.21'
  return JSON.stringify(base, null, 2)
}

function ts() {
  return new Date().toTimeString().slice(0, 8)
}

let logId = 0


const DEFAULT_SETTINGS: SettingsState = {
  username: '',
  avatarDataUrl: '',
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
  extraLibsDirs: [],
  registryUrl: 'https://registry.goduino.dev/v1/index.json',
  registryUrls: [],
  verifySignatures: true,
  updateChannel: 'stable',
  autoCheckUpdates: true,
  lastUpdateCheck: null,
  lastSeenVersion: null,
  forcedOnboardingVersion: null,
  whatsNewVersion: null,
  whatsNewChangelog: null,
  plan: 'normal',
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
  // sandbox wire settings
  sandboxWireStyle: 'orthogonal',
  sandboxWirePalette: 'classic',
  sandboxWireCustomColors: ['#ef4444','#3b82f6','#22c55e','#f97316','#a855f7','#eab308','#ec4899','#e2e2e2','#1a1a1a'],
  sandboxAutoColorVcc: true,
  sandboxAutoColorGnd: true,
  sandboxVccColor: '#ef4444',
  sandboxGndColor: '#1a1a1a',
  // layout
  ideLayout: 'default',
  sidebarWidth: 224,
  bottomPanelHeight: 200,
  // experiments
  experimentsEnabled: false,
  expSandboxEnabled: false,
  expGitEnabled: false,
  expLspEnabled: false,
  expWorkstationsEnabled: false,
  expWebkitEnabled: false,
  tsukiWebkitPath: '',
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
  allowEditBuildFiles: false,
  monitorPort: '',
  monitorBaud: '9600',
  winSpawnMethod: 'shell',
  exportFileView:   'list',
  exportOutDir:     '',
  exportVersion:    '1.0.0',
  exportInclSource: true,
  exportInclBuild:  true,
  exportGhToken:    '',
  exportGhPublic:   false,
  exportDockerTag:  '',
  explorerLocation: 'bottom',
  debugMode: false,
  debugLogFormat: 'flat',
  debugLogCategories: {
    spawn: true, pty: true, resolve: true,
    settings: true, shell: true, process: true, frontend: true,
  },
  language: 'en',
  docsLang: 'en',
  fontRendering: 'auto',
  compactMode: false,
  topbarLabels: true,
  adaptiveSidebar: true,
  minWindowWidth: 1024,
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

// ── Profile persistence helpers ───────────────────────────────────────────────

const PROFILES_KEY      = 'tsuki_profiles'
const ACTIVE_PROFILE_KEY = 'tsuki_active_profile'

function loadProfiles(): UserProfile[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as UserProfile[]
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function saveProfiles(profiles: UserProfile[]) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles)) } catch {}
}

function loadActiveProfileId(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(ACTIVE_PROFILE_KEY) ?? ''
}

function saveActiveProfileId(id: string) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(ACTIVE_PROFILE_KEY, id) } catch {}
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
    const langTemplates   = templatesForLang(language)
    const mainContent     = langTemplates[template] ?? langTemplates.blink ?? TEMPLATES_GO.blink
    const templatePkgs    = TEMPLATE_PACKAGES[template] ?? []
    const manifestContent = manifest(name, board, backend, language, templatePkgs)
    const gitignoreContent = 'build/\n*.hex\n*.bin\n*.elf\n'

    const tree: FileNode[] = [
      { id: 'root', name, type: 'dir', open: true, path: path || undefined, children: ['manifest', 'src', 'build', 'gitignore'] },
      { id: 'manifest', name: 'tsuki_package.json', type: 'file', ext: 'json', content: manifestContent, path: path ? pathJoin(path, 'tsuki_package.json') : undefined, git: 'A' },
      { id: 'src', name: 'src', type: 'dir', open: true, path: path ? pathJoin(path, 'src') : undefined, children: ['main'] },
      {
        id: 'main',
        name: language === 'cpp' ? 'main.cpp' : language === 'ino' ? `${name}.ino` : language === 'python' ? 'main.py' : 'main.go',
        type: 'file',
        ext:  language === 'cpp' ? 'cpp' : language === 'ino' ? 'ino' : language === 'python' ? 'py' : 'go',
        content: mainContent,
        path: path ? pathJoin(path, 'src', language === 'cpp' ? 'main.cpp' : language === 'ino' ? `${name}.ino` : language === 'python' ? 'main.py' : 'main.go') : undefined,
        git: 'A',
      },
      { id: 'build', name: 'build', type: 'dir', open: false, path: path ? pathJoin(path, 'build') : undefined, children: [] },
      { id: 'gitignore', name: '.gitignore', type: 'file', ext: 'txt', content: gitignoreContent, path: path ? pathJoin(path, '.gitignore') : undefined, git: 'A' },
    ]

    const mainFileName = language === 'cpp' ? 'main.cpp' : language === 'ino' ? `${name}.ino` : language === 'python' ? 'main.py' : 'main.go'
    const gitChanges: GitChange[] = [
      { letter: 'A', name: mainFileName,         path: `src/${mainFileName}` },
      { letter: 'A', name: 'tsuki_package.json', path: 'tsuki_package.json' },
      { letter: 'A', name: '.gitignore',          path: '.gitignore' },
    ]

    if (path) {
      try {
        const { writeFile, createDirectory, runGit } = await import('./tauri')
        // Create directory structure FIRST — then update projectPath in the
        // store so the terminal's cd effect only fires once the dir exists.
        await createDirectory(path)
        await createDirectory(pathJoin(path, 'src'))
        await createDirectory(pathJoin(path, 'build'))
        await writeFile(pathJoin(path, 'tsuki_package.json'), manifestContent)
        await writeFile(pathJoin(path, 'src', mainFileName), mainContent)
        await writeFile(pathJoin(path, '.gitignore'), gitignoreContent)

        // Now that files are on disk, set projectPath (triggers terminal cd)
        set({ projectName: name, projectPath: path, projectLanguage: (language as 'go' | 'cpp' | 'ino' | 'python') ?? 'go', board, backend, gitInit, tree, gitChanges, commitHistory: [], openTabs: [], activeTabIdx: -1, screen: 'ide', logs: [], terminalLines: [] })
        const gitExperimentEnabled = get().settings.experimentsEnabled && get().settings.expGitEnabled
        if (gitInit && gitExperimentEnabled) {
          await runGit(['init'], path).catch(() => {})
          await runGit(['add', '-A'], path).catch(() => {})
          await runGit(['commit', '-m', 'Initial commit'], path).catch(() => {})
        }
        get().addLog('ok', `Project files written to ${path}`)
        get().addRecentProject({ name, path, board, backend, lastOpened: Date.now() })

        // Auto-install packages required by the template
        if (templatePkgs.length > 0) {
          const tsukiBin = (get().settings.tsukiPath?.trim() || 'tsuki').replace(/^"|"$/g, '')
          get().addLog('info', `[template] Auto-installing ${templatePkgs.length} required package(s): ${templatePkgs.map(p => p.name).join(', ')}`)
          for (const pkg of templatePkgs) {
            get().addLog('info', `[template] Running: ${tsukiBin} pkg install ${pkg.name}`)
            get().dispatchCommand(tsukiBin, ['pkg', 'install', pkg.name], path)
            // Small delay between installs so the terminal output is readable
            await new Promise(r => setTimeout(r, 300))
          }
          get().addLog('info', '[template] Package installation dispatched — check the terminal for progress.')
        }
      } catch (e) {
        get().addLog('err', `Failed to write project: ${e}`)
        // Even on error, navigate to IDE with what we have (no path set)
        set({ projectName: name, projectPath: '', projectLanguage: (language as 'go' | 'cpp' | 'ino' | 'python') ?? 'go', board, backend, gitInit, tree, gitChanges, commitHistory: [], openTabs: [], activeTabIdx: -1, screen: 'ide', logs: [], terminalLines: [] })
      }
    } else {
      // No path provided — navigate to IDE immediately (in-memory project)
      set({ projectName: name, projectPath: '', projectLanguage: (language as 'go' | 'cpp' | 'ino' | 'python') ?? 'go', board, backend, gitInit, tree, gitChanges, commitHistory: [], openTabs: [], activeTabIdx: -1, screen: 'ide', logs: [], terminalLines: [] })
    }

    setTimeout(() => {
      const mainNode = get().tree.find(n => n.id === 'main' || (n.type === 'file' && (n.name === 'main.go' || n.name === 'main.py' || n.name === 'main.cpp' || n.name === `${name}.ino`)))
      if (mainNode) get().openFile(mainNode.id)
    }, 50)
    get().addLog('info', `Project "${name}" loaded · Lang: ${language} · Board: ${board} · Backend: ${backend}`)
    const gitExperimentActive = get().settings.experimentsEnabled && get().settings.expGitEnabled
    get().addLog('ok', (gitInit && gitExperimentActive) ? 'Git repo initialized · Ready.' : 'Ready.')
  },

  // ── loadFromDisk ───────────────────────────────────────────────────────────

  loadFromDisk: async (folder) => {
    let projectName = folder.split(/[/\\]/).pop() ?? 'project'
    let projectBoard = 'uno'
    let projectBackend = 'tsuki-flash'
    let projectLanguage: 'go' | 'cpp' | 'ino' | 'python' = 'go'

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
        if (mf.language === 'cpp' || mf.language === 'ino' || mf.language === 'python') projectLanguage = mf.language
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

      // Find the main source file for any language.
      // Priority: canonical name (main.go / main.py / main.cpp / <project>.ino)
      // → any matching ext in src/ → any matching ext outside build/.
      // Files inside build/ are generated artefacts and are never auto-opened.
      const isBuildPath = (p?: string) => !!(p && /[\\/]build[\\/]/.test(p))
      const langExts: Record<string, string[]> = {
        go: ['go'], python: ['py'], cpp: ['cpp', 'cxx', 'cc'], ino: ['ino'],
      }
      const exts = new Set(langExts[projectLanguage] ?? ['go'])
      const canonicalName =
        projectLanguage === 'python' ? 'main.py'  :
        projectLanguage === 'cpp'    ? 'main.cpp' :
        projectLanguage === 'ino'    ? `${projectName}.ino` :
        'main.go'
      const candidates = allNodes.filter(n => n.type === 'file' && !isBuildPath(n.path))
      const mainNode =
        candidates.find(n => n.name === canonicalName) ??
        candidates.find(n => exts.has(n.ext ?? '') && /[\\/]src[\\/]/.test(n.path ?? '')) ??
        candidates.find(n => exts.has(n.ext ?? ''))
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
    const mainFile = files.find(f => f.name.endsWith('.go') || f.name === 'main.go' || f.name.endsWith('.ino') || f.name.endsWith('.py')) ?? files[0]
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

    // Detect build artefacts — files whose path contains /build/ or \build\
    const isBuild = !!(node.path && /[\\/]build[\\/]/.test(node.path))

    const existing = get().openTabs.findIndex(t => t.fileId === id)
    if (existing >= 0) { set({ activeTabIdx: existing }); return }

    if (node.content !== undefined) {
      const tab: TabItem = { fileId: id, name: node.name, ext: node.ext || '', content: node.content, modified: false, path: node.path, buildFile: isBuild }
      const tabs = [...get().openTabs, tab]
      set({ openTabs: tabs, activeTabIdx: tabs.length - 1 })
      return
    }

    if (node.path) {
      import('./tauri').then(({ readFile }) =>
        readFile(node.path!).then(content => {
          const tree = get().tree.map(n => n.id === id ? { ...n, content } : n)
          const tab: TabItem = { fileId: id, name: node.name, ext: node.ext || '', content, modified: false, path: node.path, buildFile: isBuild }
          const tabs = [...get().openTabs, tab]
          set({ tree, openTabs: tabs, activeTabIdx: tabs.length - 1 })
        }).catch(() => {
          const tab: TabItem = { fileId: id, name: node.name, ext: node.ext || '', content: '', modified: false, path: node.path, buildFile: isBuild }
          const tabs = [...get().openTabs, tab]
          set({ openTabs: tabs, activeTabIdx: tabs.length - 1 })
        })
      )
    } else {
      const tab: TabItem = { fileId: id, name: node.name, ext: node.ext || '', content: '', modified: false, buildFile: isBuild }
      const tabs = [...get().openTabs, tab]
      set({ openTabs: tabs, activeTabIdx: tabs.length - 1 })
    }
  },

  closeTab: (idx) => {
    const tabs = get().openTabs.filter((_, i) => i !== idx)
    let active = get().activeTabIdx
    if (active > idx)          active -= 1  // shift left when closing a tab before the active one
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
  pendingBuild: null,
  dispatchBuild: (cmd, args, cwd, chainArgs) => {
    set({ pendingBuild: { cmd, args, cwd, chainArgs, id: Date.now() }, bottomTab: 'output' })
  },
  clearPendingCommand: () => set({ pendingCommand: null }),
  clearPendingBuild:   () => set({ pendingBuild: null }),

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
        if (key === 'compactMode') {
          applyCompactMode(value as boolean)
        }
        if (key === 'fontRendering') {
          applyFontRendering(value as 'auto' | 'crisp' | 'smooth' | 'subpixel')
        }
      }

      // ── Experiment settings: structured audit log ─────────────────────────
      // Logs every experiment toggle with name, new state, and resource cost.
      const EXP_META: Record<string, { name: string; cost: string }> = {
        expSandboxEnabled:      { name: 'Sandbox (circuit simulator)', cost: '~800 KB renderer bundle' },
        expGitEnabled:          { name: 'Git Integration',             cost: 'subprocess on demand, no background polling' },
        expLspEnabled:          { name: 'Language Server (LSP)',       cost: '~5–15 MB RAM + background tsuki-lsp process' },
        expWorkstationsEnabled: { name: 'Workstations page bar',       cost: 'zero overhead when inactive' },
        expWebkitEnabled:       { name: 'tsuki-webkit',                cost: 'WebSocket server + renderer JS bundle' },
      }

      if (key === 'experimentsEnabled') {
        const nowOn = value as boolean
        if (nowOn && !s.settings.experimentsEnabled) {
          get().addLog('info', '[experiments] Master switch ENABLED — experimental features are now accessible')
          get().addLog('info', '[experiments] Toggle individual experiments in Settings → Experiments')
        } else if (!nowOn && s.settings.experimentsEnabled) {
          const active = Object.keys(EXP_META).filter(k => s.settings[k as keyof SettingsState])
          if (active.length > 0) {
            const names = active.map(k => EXP_META[k].name).join(', ')
            get().addLog('warn', `[experiments] Master switch DISABLED — the following experiments were deactivated: ${names}`)
          } else {
            get().addLog('info', '[experiments] Master switch DISABLED — no individual experiments were active')
          }
        }
      } else if (key in EXP_META) {
        const { name, cost } = EXP_META[key as string]
        if (value as boolean) {
          get().addLog('info',  `[experiments] ✓ "${name}" ENABLED`)
          get().addLog('info',  `[experiments]   resource cost: ${cost}`)
        } else {
          get().addLog('info',  `[experiments] ✗ "${name}" DISABLED — resources freed`)
        }
      }

      // ── High-value setting changes: targeted log entries ──────────────────
      // Covers sandbox config, LSP feature flags, build options, and dev mode.
      type LoggableKey = keyof SettingsState
      const SETTING_LOG: Partial<Record<LoggableKey, (v: unknown, prev: unknown) => string | null>> = {
        sandboxWireStyle:       (v) => `[sandbox] Wire style changed → "${v}"`,
        sandboxWirePalette:     (v) => `[sandbox] Wire colour palette → "${v}"`,
        sandboxAutoColorVcc:    (v) => `[sandbox] Auto-colour VCC wires → ${v ? 'on' : 'off'}`,
        sandboxAutoColorGnd:    (v) => `[sandbox] Auto-colour GND wires → ${v ? 'on' : 'off'}`,
        showCurrentFlow:        (v) => `[sandbox] Current-flow animation → ${v ? 'on' : 'off'}`,
        lspEnabled:             (v) => `[lsp] Language server → ${v ? 'starting' : 'stopping'}`,
        lspDiagnosticsEnabled:  (v) => `[lsp] Inline diagnostics → ${v ? 'on' : 'off'}`,
        lspCompletionsEnabled:  (v) => `[lsp] Auto-completions → ${v ? 'on' : 'off'}`,
        verbose:                (v) => `[build] Verbose compiler output → ${v ? 'on' : 'off'}`,
        compileOnSave:          (v) => `[build] Compile-on-save → ${v ? 'on' : 'off'}`,
        autoDetect:             (v) => `[build] Auto-detect board on port → ${v ? 'on' : 'off'}`,
        verifySignatures:       (v) => `[build] Verify firmware signatures → ${v ? 'on' : 'off'}`,
        developerOptions:       (v) => `[dev] Developer options → ${v ? 'unlocked' : 'hidden'}`,
        formatOnSave:           (v) => `[editor] Format-on-save → ${v ? 'on' : 'off'}`,
        tsukiSimPath:           (v, prev) => v !== prev ? `[sandbox] tsuki-sim path updated → "${v}"` : null,
        ideTheme:               (v, prev) => v !== prev ? `[appearance] Theme → "${v}"` : null,
        syntaxTheme:            (v, prev) => v !== prev ? `[appearance] Syntax theme → "${v}"` : null,
      }

      const logFn = SETTING_LOG[key as LoggableKey]
      if (logFn) {
        const msg = logFn(value, s.settings[key as LoggableKey])
        if (msg) get().addLog('info', msg)
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
  // ── Profiles ───────────────────────────────────────────────────────────────

  profiles: loadProfiles(),
  activeProfileId: loadActiveProfileId(),

  createProfile: (name, avatarDataUrl = '', initialSettings = {}) => {
    const id = makeProfileId()
    const profile: UserProfile = {
      id,
      name: name.trim() || 'New Profile',
      avatarDataUrl,
      createdAt: Date.now(),
      settings: { username: name.trim(), avatarDataUrl, ...initialSettings },
    }
    // Save current settings back into the currently-active profile before creating the new one
    const cur = get()
    const savedProfiles = cur.profiles.map(p =>
      p.id === cur.activeProfileId ? { ...p, settings: { ...cur.settings } } : p
    )
    const profiles = [...savedProfiles, profile]
    // New profile starts from DEFAULT_SETTINGS + explicit initialSettings only (no bleed from current)
    const merged: SettingsState = { ...DEFAULT_SETTINGS, username: name.trim(), ...initialSettings }
    set({ profiles, activeProfileId: id, settings: merged })
    saveProfiles(profiles)
    saveActiveProfileId(id)
    return id
  },

  switchProfile: (id) => {
    const profiles = get().profiles
    const profile = profiles.find(p => p.id === id)
    if (!profile) return
    const currentId = get().activeProfileId
    const updatedProfiles = profiles.map(p =>
      p.id === currentId ? { ...p, settings: { ...get().settings } } : p
    )
    const merged: SettingsState = { ...DEFAULT_SETTINGS, ...profile.settings }
    set({ activeProfileId: id, profiles: updatedProfiles, settings: merged })
    saveProfiles(updatedProfiles)
    saveActiveProfileId(id)
    // Apply visual settings immediately so the IDE reflects the switched profile
    // (applyTheme etc. are already imported at the top of this file)
    applyTheme(merged.ideTheme, merged.syntaxTheme)
    applyUiScale(merged.uiScale)
    applyFontRendering(merged.fontRendering)
    applyCompactMode(merged.compactMode ?? false)
    // Sync legacy dark/light flag
    const { IDE_THEMES: switchThemes } = require('./themes') as typeof import('./themes')
    const switchBase = switchThemes.find((t: { id: string; base: string }) => t.id === merged.ideTheme)?.base ?? 'dark'
    useStore.setState({ theme: switchBase })
  },

  deleteProfile: (id) => {
    const profiles = get().profiles
    if (profiles.length <= 1) return
    const next = profiles.filter(p => p.id !== id)
    let activeProfileId = get().activeProfileId
    if (activeProfileId === id) {
      activeProfileId = next[0].id
      const merged: SettingsState = { ...DEFAULT_SETTINGS, ...next[0].settings }
      set({ settings: merged })
      // Apply the newly-active profile's visual settings
      applyTheme(merged.ideTheme, merged.syntaxTheme)
      applyUiScale(merged.uiScale)
    }
    set({ profiles: next, activeProfileId })
    saveProfiles(next)
    saveActiveProfileId(activeProfileId)
  },

  updateProfileField: (id, patch) => {
    const profiles = get().profiles.map(p => {
      if (p.id !== id) return p
      return {
        ...p,
        name:          patch.name          !== undefined ? patch.name          : p.name,
        avatarDataUrl: patch.avatarDataUrl !== undefined ? patch.avatarDataUrl : p.avatarDataUrl,
        settings: {
          ...p.settings,
          ...(patch.name          !== undefined ? { username: patch.name }              : {}),
          ...(patch.avatarDataUrl !== undefined ? { avatarDataUrl: patch.avatarDataUrl } : {}),
        },
      }
    })
    set({ profiles })
    if (id === get().activeProfileId) {
      const ps = profiles.find(p => p.id === id)
      if (ps) set({ settings: { ...get().settings, ...ps.settings } })
    }
    saveProfiles(profiles)
  },


}))


// ── Bootstrap helpers ────────────────────────────────────────────────────────

/**
 * If the profile list is empty (first ever launch), seed it with a "Default"
 * profile that captures the current settings.  This prevents the profiles
 * panel from ever showing "No profiles yet" on a fresh install.
 */
function ensureDefaultProfile() {
  const { profiles, settings } = useStore.getState()
  if (profiles.length > 0) return
  const id = makeProfileId()
  const def: UserProfile = {
    id,
    name: 'Default',
    avatarDataUrl: '',
    createdAt: Date.now(),
    settings: { ...settings },
  }
  useStore.setState({ profiles: [def], activeProfileId: id })
  saveProfiles([def])
  saveActiveProfileId(id)
}

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
          applyCompactMode(merged.compactMode ?? false)
          // Sync legacy theme flag
          const { IDE_THEMES } = require('./themes') as typeof import('./themes')
          const base = IDE_THEMES.find(t => t.id === merged.ideTheme)?.base ?? 'dark'
          useStore.setState({ theme: base })
        }
      } catch {}
    }).catch(() => {})
  )
}

// Seed default profile if none exist (first-launch guard)
if (typeof window !== 'undefined') setTimeout(ensureDefaultProfile, 200)