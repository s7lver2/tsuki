/**
 * lspEngine.ts — Tsuki IDE front-end diagnostic engine
 * Runs entirely in the browser — no external process required.
 */
import type { Problem } from '@/lib/store'

// ─── Library registry ──────────────────────────────────────────────────────────

export interface LibraryInfo {
  displayName: string
  packageId: string
  knownBuiltin: boolean
  description: string
  version?: string
}

export const KNOWN_LIBS: Record<string, LibraryInfo> = {
  'arduino':            { displayName: 'arduino',            packageId: 'arduino',            knownBuiltin: true,  description: 'Core Arduino runtime.' },
  'fmt':                { displayName: 'fmt',                packageId: 'fmt',                knownBuiltin: true,  description: 'Standard Go fmt package.' },
  'math':               { displayName: 'math',               packageId: 'math',               knownBuiltin: true,  description: 'Standard Go math package.' },
  'strings':            { displayName: 'strings',            packageId: 'strings',            knownBuiltin: true,  description: 'Standard Go strings package.' },
  'strconv':            { displayName: 'strconv',            packageId: 'strconv',            knownBuiltin: true,  description: 'Standard Go strconv package.' },
  'time':               { displayName: 'time',               packageId: 'time',               knownBuiltin: true,  description: 'Standard Go time package.' },
  'sort':               { displayName: 'sort',               packageId: 'sort',               knownBuiltin: true,  description: 'Standard Go sort package.' },
  'sync':               { displayName: 'sync',               packageId: 'sync',               knownBuiltin: true,  description: 'Standard Go sync package.' },
  'Servo':              { displayName: 'Servo',              packageId: 'Servo',              knownBuiltin: false, description: 'Servo motor control.',                        version: '1.2.1'  },
  'Wire':               { displayName: 'Wire',               packageId: 'Wire',               knownBuiltin: false, description: 'I²C / TWI communication.',                   version: '1.0.0'  },
  'SPI':                { displayName: 'SPI',                packageId: 'SPI',                knownBuiltin: false, description: 'Serial Peripheral Interface.',                version: '1.0.0'  },
  'EEPROM':             { displayName: 'EEPROM',             packageId: 'EEPROM',             knownBuiltin: false, description: 'Read/write onboard EEPROM.',                  version: '2.0.0'  },
  'SD':                 { displayName: 'SD',                 packageId: 'SD',                 knownBuiltin: false, description: 'SD card file I/O.',                          version: '1.2.4'  },
  'Ethernet':           { displayName: 'Ethernet',           packageId: 'Ethernet',           knownBuiltin: false, description: 'Ethernet shield.',                            version: '2.0.0'  },
  'LiquidCrystal':      { displayName: 'LiquidCrystal',      packageId: 'LiquidCrystal',      knownBuiltin: false, description: 'HD44780 LCD driver.',                        version: '1.0.7'  },
  'Adafruit_NeoPixel':  { displayName: 'Adafruit NeoPixel',  packageId: 'Adafruit_NeoPixel',  knownBuiltin: false, description: 'WS2812 RGB LED strips.',                     version: '1.12.0' },
  'DHT':                { displayName: 'DHT sensor',         packageId: 'DHT',                knownBuiltin: false, description: 'DHT11/DHT22 sensors.',                       version: '1.4.6'  },
  'IRremote':           { displayName: 'IRremote',           packageId: 'IRremote',           knownBuiltin: false, description: 'Infrared protocol.',                         version: '4.4.0'  },
  'Stepper':            { displayName: 'Stepper',            packageId: 'Stepper',            knownBuiltin: false, description: 'Stepper motor control.',                     version: '1.1.3'  },
  'WiFi':               { displayName: 'WiFi',               packageId: 'WiFi',               knownBuiltin: false, description: 'Arduino WiFi shield.',                       version: '1.2.7'  },
  'WiFiNINA':           { displayName: 'WiFiNINA',           packageId: 'WiFiNINA',           knownBuiltin: false, description: 'u-blox NINA-W10 WiFi.',                      version: '1.8.14' },
  'ESP8266WiFi':        { displayName: 'ESP8266WiFi',        packageId: 'ESP8266WiFi',        knownBuiltin: false, description: 'WiFi for ESP8266.',                          version: '1.0.0'  },
  'FastLED':            { displayName: 'FastLED',            packageId: 'FastLED',            knownBuiltin: false, description: 'High-performance LED control.',              version: '3.7.0'  },
  'U8g2':               { displayName: 'U8g2',               packageId: 'U8g2',               knownBuiltin: false, description: 'OLED/LCD/e-ink driver.',                     version: '2.35.9' },
  'Adafruit_SSD1306':   { displayName: 'Adafruit SSD1306',   packageId: 'Adafruit_SSD1306',   knownBuiltin: false, description: 'SSD1306 OLED display.',                      version: '2.5.10' },
  'Adafruit_GFX':       { displayName: 'Adafruit GFX',       packageId: 'Adafruit_GFX',       knownBuiltin: false, description: 'Core graphics library.',                     version: '1.11.9' },
  'ArduinoJson':        { displayName: 'ArduinoJson',        packageId: 'ArduinoJson',        knownBuiltin: false, description: 'JSON parsing and serialization.',            version: '7.1.0'  },
  'PubSubClient':       { displayName: 'PubSubClient',       packageId: 'PubSubClient',       knownBuiltin: false, description: 'MQTT messaging client.',                     version: '2.8.0'  },
  'Bounce2':            { displayName: 'Bounce2',            packageId: 'Bounce2',            knownBuiltin: false, description: 'Button debounce.',                           version: '2.71.0' },
  'OneWire':            { displayName: 'OneWire',            packageId: 'OneWire',            knownBuiltin: false, description: '1-Wire protocol.',                           version: '2.3.7'  },
  'DallasTemperature':  { displayName: 'DallasTemperature',  packageId: 'DallasTemperature',  knownBuiltin: false, description: 'DS18B20 temperature sensors.',               version: '3.9.0'  },
  'Keypad':             { displayName: 'Keypad',             packageId: 'Keypad',             knownBuiltin: false, description: 'Matrix keypad scanning.',                    version: '3.1.1'  },
  'TaskScheduler':      { displayName: 'TaskScheduler',      packageId: 'TaskScheduler',      knownBuiltin: false, description: 'Cooperative multitasking.',                  version: '3.7.0'  },
  'TinyGPSPlus':        { displayName: 'TinyGPS++',          packageId: 'TinyGPSPlus',        knownBuiltin: false, description: 'NMEA GPS parser.',                           version: '1.0.3'  },
  'AsyncTCP':           { displayName: 'AsyncTCP',           packageId: 'AsyncTCP',           knownBuiltin: false, description: 'Async TCP for ESP32.',                       version: '1.1.4'  },
  'ESP_AsyncWebServer': { displayName: 'ESPAsyncWebServer',  packageId: 'ESP_AsyncWebServer', knownBuiltin: false, description: 'Async web server for ESP.',                  version: '1.2.3'  },
  'BluetoothSerial':    { displayName: 'BluetoothSerial',    packageId: 'BluetoothSerial',    knownBuiltin: false, description: 'Bluetooth Serial for ESP32.',                version: '2.0.0'  },
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface Diagnostic extends Problem {
  source: 'lsp' | 'lint'
  endCol?: number
  missingLib?: LibraryInfo & { importName: string }
  quickFix?: { label: string; newText: string }
}

export interface LspEngineOptions {
  lspGoEnabled:  boolean
  lspCppEnabled: boolean
  lspInoEnabled: boolean
}

// ─── Arduino / C++ built-in symbol tables ─────────────────────────────────────

/** All Arduino built-in functions — never flag these as undeclared */
const ARDUINO_BUILTINS = new Set([
  // Core I/O
  'pinMode', 'digitalWrite', 'digitalRead', 'analogWrite', 'analogRead',
  'analogReference', 'analogReadResolution', 'analogWriteResolution',
  'pulseIn', 'pulseInLong', 'shiftIn', 'shiftOut',
  // Time
  'delay', 'delayMicroseconds', 'millis', 'micros',
  // Math
  'abs', 'ceil', 'constrain', 'floor', 'map', 'max', 'min', 'pow', 'round',
  'sq', 'sqrt', 'cos', 'sin', 'tan', 'acos', 'asin', 'atan', 'atan2',
  'exp', 'fabs', 'fmod', 'log', 'log10',
  // Random
  'random', 'randomSeed',
  // Bits/bytes
  'bit', 'bitClear', 'bitRead', 'bitSet', 'bitWrite', 'highByte', 'lowByte',
  // Interrupts
  'attachInterrupt', 'detachInterrupt', 'digitalPinToInterrupt',
  'interrupts', 'noInterrupts', 'cli', 'sei',
  // Tone
  'tone', 'noTone',
  // Misc Arduino
  'yield', 'init', 'initVariant', 'setup', 'loop',
  // Serial objects (used as prefix)
  'Serial', 'Serial1', 'Serial2', 'Serial3',
  // C string/memory
  'strlen', 'strcpy', 'strncpy', 'strcat', 'strncat', 'strcmp', 'strncmp',
  'strchr', 'strrchr', 'strstr', 'strtok', 'strtol', 'strtof', 'strtod',
  'sprintf', 'snprintf', 'sscanf', 'printf', 'puts', 'putchar', 'getchar',
  'memcpy', 'memmove', 'memset', 'memcmp', 'memchr',
  'malloc', 'calloc', 'realloc', 'free',
  'atoi', 'atol', 'atof', 'itoa', 'ltoa', 'dtostrf',
  // PROGMEM
  'F', 'PSTR', 'pgm_read_byte', 'pgm_read_word', 'pgm_read_dword',
  'pgm_read_float', 'strlen_P', 'strcpy_P', 'strcmp_P',
  // avr-libc delays
  '_delay_ms', '_delay_us',
  // Wire/SPI objects
  'Wire', 'SPI',
  // EEPROM
  'EEPROM',
  // ISR macro
  'ISR',
  // Common Arduino library constructors often used inline
  'Servo', 'LiquidCrystal', 'SoftwareSerial', 'EEPROM',
])

/** Arduino #define constants — never flag as undeclared variables */
const ARDUINO_CONSTANTS = new Set([
  'HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'INPUT_PULLDOWN',
  'LED_BUILTIN', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7',
  'LSBFIRST', 'MSBFIRST', 'CHANGE', 'FALLING', 'RISING',
  'PI', 'HALF_PI', 'TWO_PI', 'DEG_TO_RAD', 'RAD_TO_DEG',
  'EULER', 'SQRT2',
  'true', 'false', 'TRUE', 'FALSE', 'NULL', 'nullptr',
  'MOSI', 'MISO', 'SCK', 'SS', 'SDA', 'SCL',
  'INT0', 'INT1', 'PCINT0',
  'BYTE', 'DEC', 'HEX', 'OCT', 'BIN',
  'PROGMEM', 'F_CPU',
])

/** C/C++ keywords that syntactically look like calls: `sizeof(x)`, `if(...)` etc */
const CPP_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'return',
  'break', 'continue', 'goto', 'default',
  'new', 'delete', 'sizeof', 'typeof', 'alignof', 'decltype',
  'static_cast', 'dynamic_cast', 'reinterpret_cast', 'const_cast',
  'throw', 'try', 'catch',
  'operator', 'template', 'typename', 'namespace', 'using',
  // type names used as casts: `(int)x` or `int(x)`
  'void', 'bool', 'int', 'long', 'short', 'char', 'float', 'double',
  'unsigned', 'signed', 'byte', 'word', 'auto',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
  'int8_t',  'int16_t',  'int32_t',  'int64_t',
  'size_t', 'ptrdiff_t', 'uintptr_t',
  'String', 'boolean',  // Arduino typedefs
  // stdlib
  'exit', 'abort', 'assert',
])

/** Go built-in functions — never flag these */
const GO_BUILTINS = new Set([
  'make', 'len', 'cap', 'append', 'copy', 'delete', 'close',
  'panic', 'recover', 'print', 'println', 'new', 'real', 'imag', 'complex',
  'error', 'string', 'int', 'int8', 'int16', 'int32', 'int64',
  'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr',
  'float32', 'float64', 'complex64', 'complex128', 'bool', 'byte', 'rune',
])

/** Go keywords that look like calls */
const GO_KEYWORDS = new Set([
  'if', 'else', 'for', 'range', 'switch', 'case', 'select', 'default',
  'return', 'break', 'continue', 'goto', 'defer', 'go',
  'func', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan',
  'import', 'package',
])

// ─── Helpers ───────────────────────────────────────────────────────────────────

function stripComments(line: string): string {
  return line
    .replace(/\/\/.*$/, '')
    .replace(/"([^"\\]|\\.)*"/g, '""')
    .replace(/'([^'\\]|\\.)*'/g, "''")
}

function stripAllComments(code: string): string {
  // Remove block comments
  code = code.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  // Remove line comments
  return code.split('\n').map(l => stripComments(l)).join('\n')
}

function hasSerialBegin(code: string): boolean {
  return code.split('\n').some(l => {
    const s = stripComments(l)
    return /\bSerial\s*\.\s*[Bb]egin\s*\(/.test(s) || /arduino\s*\.\s*Serial\s*\.\s*Begin\s*\(/.test(s)
  })
}

// ─── C++ symbol collector ──────────────────────────────────────────────────────

interface CppSymbol {
  name: string
  kind: 'function' | 'variable' | 'type' | 'constant' | 'object'
  line: number
}

function collectSymbolsCpp(code: string): Map<string, CppSymbol> {
  const symbols = new Map<string, CppSymbol>()
  const clean   = stripAllComments(code)
  const lines   = clean.split('\n')

  const add = (name: string, kind: CppSymbol['kind'], line: number) => {
    if (!symbols.has(name)) symbols.set(name, { name, kind, line })
  }

  lines.forEach((raw, i) => {
    const ln  = i + 1
    const s   = raw.trim()

    // #define NAME  or  #define NAME value
    const def = raw.match(/^\s*#define\s+(\w+)/)
    if (def) { add(def[1], 'constant', ln); return }

    // Function definitions / forward declarations:
    //   type name( ...
    //   type* name( ...
    //   type& name( ...
    // Handles: void setup(), int myFunc(int x), String getName()
    const funcDef = raw.match(/^\s*(?:(?:static|inline|virtual|explicit|unsigned|signed|const)\s+)*(?:\w[\w:<>*& ]*)?\s*\*?\s*(\w+)\s*\(/)
    if (funcDef) {
      const name = funcDef[1]
      if (!CPP_KEYWORDS.has(name) && !ARDUINO_BUILTINS.has(name) && /^[a-zA-Z_]/.test(name)) {
        add(name, 'function', ln)
      }
    }

    // Variable declarations at global/local scope:
    //   int x;  int x = 5;  float y, z;  const int LIMIT = 100;
    //   int arr[10];   String msg;
    const types = '(?:const\\s+)?(?:unsigned\\s+|signed\\s+)?(?:long\\s+long|long\\s+int|long|short|int|float|double|char|bool|byte|word|String|boolean|uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|size_t|auto)'
    const varDeclRe = new RegExp(`^\\s*${types}\\s*\\*?\\s*(\\w+)\\s*(?:[=;,\\[])`, 'g')
    let m: RegExpExecArray | null
    while ((m = varDeclRe.exec(raw)) !== null) {
      const name = m[1]
      if (name && !CPP_KEYWORDS.has(name) && !ARDUINO_BUILTINS.has(name) && !ARDUINO_CONSTANTS.has(name)) {
        add(name, 'variable', ln)
      }
    }

    // Object instantiation: ClassName obj;  ClassName obj(args);
    // Handles: Servo myServo;  LiquidCrystal lcd(12, 11, 5, 4, 3, 2);
    const objDecl = raw.match(/^\s*([A-Z]\w+)\s+(\w+)\s*(?:[=(;{])/)
    if (objDecl && !CPP_KEYWORDS.has(objDecl[1]) && !CPP_KEYWORDS.has(objDecl[2])) {
      add(objDecl[1], 'type', ln)   // the class name
      add(objDecl[2], 'object', ln) // the instance name
    }

    // struct/class/enum/typedef declarations
    const typeDecl = raw.match(/^\s*(?:struct|class|enum|typedef)\s+(\w+)/)
    if (typeDecl) add(typeDecl[1], 'type', ln)
  })

  return symbols
}

// ─── Go symbol collector ───────────────────────────────────────────────────────

function collectSymbolsGo(code: string): Map<string, number> {
  const symbols = new Map<string, number>()
  const lines   = stripAllComments(code).split('\n')

  lines.forEach((raw, i) => {
    const ln = i + 1
    // func declarations: func name(  or func (recv Type) name(
    const funcDecl = raw.match(/^\s*func\s+(?:\([\w\s*]+\)\s+)?(\w+)\s*\(/)
    if (funcDecl) { symbols.set(funcDecl[1], ln); return }

    // var declarations: var name type   or  var name = ...
    const varDecl = raw.match(/^\s*var\s+(\w+)\s+/)
    if (varDecl) { symbols.set(varDecl[1], ln); return }

    // const declarations
    const constDecl = raw.match(/^\s*const\s+(\w+)\s+/)
    if (constDecl) { symbols.set(constDecl[1], ln); return }

    // type declarations
    const typeDecl = raw.match(/^\s*type\s+(\w+)\s+/)
    if (typeDecl) { symbols.set(typeDecl[1], ln); return }

    // Short variable declarations: x := ...  or  x, y :=
    const shortDecl = raw.match(/^\s*(\w+)(?:\s*,\s*(\w+))?\s*:=/)
    if (shortDecl) {
      symbols.set(shortDecl[1], ln)
      if (shortDecl[2]) symbols.set(shortDecl[2], ln)
    }

    // Multi-assign short: x, err :=
    const multiDecl = Array.from(raw.matchAll(/\b(\w+)\s*(?:,\s*\w+\s*)*:=/g))
    for (const md of multiDecl) symbols.set(md[1], ln)
  })

  return symbols
}

// ─── Go diagnostics ────────────────────────────────────────────────────────────

function diagnoseGo(code: string, filename: string): Diagnostic[] {
  const diags: Diagnostic[] = []
  const lines = code.split('\n')
  let uid = 0
  const id = () => `lsp-go-${uid++}`

  const userSymbols = collectSymbolsGo(code)

  // ── Brace / paren balance ─────────────────────────────────────────────────
  let braces = 0, parens = 0, lastOpenLine = 1
  lines.forEach((line, i) => {
    const s = stripComments(line)
    for (const ch of s) {
      if (ch === '{') { braces++; lastOpenLine = i + 1 }
      if (ch === '}') braces--
      if (ch === '(') parens++
      if (ch === ')') parens--
    }
  })
  if (braces > 0)   diags.push({ id: id(), severity: 'error', source: 'lint', file: filename, line: lastOpenLine, col: 1, message: `Missing closing '}' — ${braces} unclosed block${braces > 1 ? 's' : ''}` })
  if (braces < 0)   diags.push({ id: id(), severity: 'error', source: 'lint', file: filename, line: lines.length, col: 1, message: `Extra closing '}' — ${-braces} too many` })
  if (parens !== 0) diags.push({ id: id(), severity: 'error', source: 'lint', file: filename, line: lines.length, col: 1, message: `Unbalanced parentheses (${parens > 0 ? 'missing )' : 'extra )'})` })

  // ── Package declaration ───────────────────────────────────────────────────
  const pkgIdx = lines.findIndex(l => /^\s*package\s+\w+/.test(l))
  if (pkgIdx === -1) {
    diags.push({ id: id(), severity: 'error', source: 'lint', file: filename, line: 1, col: 1, message: 'Missing package declaration — Go files must start with "package main"' })
  } else {
    const pkg = lines[pkgIdx].match(/^\s*package\s+(\w+)/)?.[1]
    if (pkg && pkg !== 'main') {
      diags.push({ id: id(), severity: 'warning', source: 'lint', file: filename, line: pkgIdx + 1, col: 1,
        message: `Package is "${pkg}" — Arduino tsuki projects should use "package main"`,
        quickFix: { label: 'Change to "package main"', newText: lines[pkgIdx].replace(/package\s+\w+/, 'package main') } })
    }
  }

  // ── Import parsing ────────────────────────────────────────────────────────
  interface Imp { name: string; alias?: string; line: number }
  const imported: Imp[] = []
  lines.forEach((line, i) => {
    const single = line.match(/^\s*import\s+"([^"]+)"/)
    if (single) { imported.push({ name: single[1], line: i + 1 }); return }
    const aliased = line.match(/^\s*import\s+(\w+)\s+"([^"]+)"/)
    if (aliased) { imported.push({ name: aliased[2], alias: aliased[1], line: i + 1 }) }
  })
  let inBlock = false
  lines.forEach((line, i) => {
    if (/^\s*import\s*\(/.test(line))  { inBlock = true;  return }
    if (inBlock && /^\s*\)/.test(line)) { inBlock = false; return }
    if (!inBlock) return
    const m = line.match(/^\s*(?:(\w+)\s+)?"([^"]+)"/)
    if (m) imported.push({ name: m[2], alias: m[1], line: i + 1 })
  })

  // Duplicate imports
  const seenImports = new Map<string, number>()
  imported.forEach(({ name, line }) => {
    if (seenImports.has(name)) {
      diags.push({ id: id(), severity: 'error', source: 'lint', file: filename, line, col: 1, message: `Duplicate import "${name}"` })
    }
    seenImports.set(name, line)
  })

  // Missing / unknown library
  imported.forEach(({ name, line }) => {
    const info = KNOWN_LIBS[name]
    if (!info) {
      diags.push({ id: id(), severity: 'warning', source: 'lsp', file: filename, line, col: 1,
        message: `Unknown package "${name}" — not in tsuki registry`,
        missingLib: { importName: name, displayName: name, packageId: name, knownBuiltin: false, description: `"${name}" is not a known tsuki/Arduino library.` } })
    } else if (!info.knownBuiltin) {
      diags.push({ id: id(), severity: 'info', source: 'lsp', file: filename, line, col: 1,
        message: `"${info.displayName}" v${info.version} needs to be installed`,
        missingLib: { importName: name, ...info } })
    }
  })

  // Unused imports
  const importLineSet = new Set(imported.map(i => i.line - 1))
  const codeNoImports = lines.map((l, i) => importLineSet.has(i) ? '' : l).join('\n')
  imported.forEach(({ name, alias, line }) => {
    if (name === 'arduino') return
    const useName = (alias && alias !== '_') ? alias : name
    const escaped = useName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!new RegExp(`\\b${escaped}[.([]`).test(codeNoImports) && alias !== '_') {
      diags.push({ id: id(), severity: 'error', source: 'lint', file: filename, line, col: 1,
        message: `"${name}" imported and not used` })
    }
  })

  // setup/loop check
  const isSketch = imported.some(i => i.name === 'arduino') || code.includes('arduino.')
  if (isSketch) {
    if (!/func\s+setup\s*\(\s*\)\s*\{/.test(code))
      diags.push({ id: id(), severity: 'warning', source: 'lint', file: filename, line: 1, col: 1, message: 'Missing func setup() — required by Arduino runtime' })
    if (!/func\s+loop\s*\(\s*\)\s*\{/.test(code))
      diags.push({ id: id(), severity: 'warning', source: 'lint', file: filename, line: 1, col: 1, message: 'Missing func loop() — required by Arduino runtime' })
  }

  // All declared package-level identifiers + imported names
  const allKnownGo = new Set<string>(
    Array.from(GO_BUILTINS)
      .concat(Array.from(GO_KEYWORDS))
      .concat(Array.from(userSymbols.keys()))
      .concat(imported.map(i => (i.alias && i.alias !== '_') ? i.alias : i.name.split('/').pop()!))
      .concat(['true', 'false', 'nil', 'iota', '_'])
  )

  const serialBegin = hasSerialBegin(code)

  lines.forEach((raw, i) => {
    const ln = i + 1
    const s  = stripComments(raw)

    // ── Undeclared function calls ────────────────────────────────────────
    // Match all call-like patterns: `name(`
    const callRe = /\b([a-zA-Z_]\w*)\s*\(/g
    let cm: RegExpExecArray | null
    while ((cm = callRe.exec(s)) !== null) {
      const name = cm[1]
      if (GO_KEYWORDS.has(name) || GO_BUILTINS.has(name)) continue
      // Skip method calls: something.name(
      const before = s.slice(0, cm.index)
      if (/[.\w]\s*$/.test(before) && /\.\s*$/.test(before)) continue
      // Skip package-qualified: pkg.Func( — covered by import check
      if (/\.\s*$/.test(before)) continue
      // Skip func declarations
      if (/^\s*func\s*$/.test(before.trim())) continue
      // Skip type assertions: .(name)
      if (/\.\s*$/.test(before)) continue
      if (!allKnownGo.has(name)) {
        diags.push({ id: id(), severity: 'error', source: 'lsp', file: filename, line: ln,
          col: cm.index + 1, message: `"${name}" is not declared — undefined function or variable` })
      }
    }

    // arduino.delay (lowercase)
    if (/arduino\.delay\s*\(/.test(s)) {
      const col = s.indexOf('arduino.delay') + 1
      diags.push({ id: id(), severity: 'error', source: 'lint', file: filename, line: ln, col,
        message: 'arduino.delay is not exported — use arduino.Delay (capital D)',
        quickFix: { label: 'Fix: arduino.Delay', newText: raw.replace('arduino.delay', 'arduino.Delay') } })
    }

    // Casing errors
    const casingFixes: Array<[RegExp, string]> = [
      [/arduino\.digitalwrite\s*\(/i, 'arduino.DigitalWrite'],
      [/arduino\.digitalread\s*\(/i,  'arduino.DigitalRead'],
      [/arduino\.analogwrite\s*\(/i,  'arduino.AnalogWrite'],
      [/arduino\.analogread\s*\(/i,   'arduino.AnalogRead'],
      [/arduino\.pinmode\s*\(/i,      'arduino.PinMode'],
    ]
    for (const [re, correct] of casingFixes) {
      if (re.test(s) && !s.includes(correct)) {
        diags.push({ id: id(), severity: 'error', source: 'lint', file: filename, line: ln, col: 1,
          message: `Use ${correct} (capital letters) — Go exports are case-sensitive` })
      }
    }

    // Serial without Begin
    if (/arduino\.Serial\.(Print|Println|Write)\s*\(/.test(s) && !serialBegin) {
      if (!diags.some(d => d.message.includes('Serial.Begin')))
        diags.push({ id: id(), severity: 'warning', source: 'lint', file: filename, line: ln, col: 1,
          message: 'arduino.Serial used without arduino.Serial.Begin() in setup()' })
    }

    // Large delay
    const bigDelay = s.match(/arduino\.Delay\s*\((\d+)\)/)
    if (bigDelay && parseInt(bigDelay[1]) >= 5000)
      diags.push({ id: id(), severity: 'info', source: 'lint', file: filename, line: ln, col: 1,
        message: `Large delay: ${bigDelay[1]} ms — consider a named constant` })

    // := inside function args
    if (/\(\s*\w+\s*:=/.test(s))
      diags.push({ id: id(), severity: 'error', source: 'lint', file: filename, line: ln, col: s.indexOf(':=') + 1,
        message: 'Cannot use short variable declaration (:=) inside function arguments' })

    // Redundant == true
    if (/==\s*true\b/.test(s))
      diags.push({ id: id(), severity: 'info', source: 'lint', file: filename, line: ln, col: 1,
        message: 'Redundant "== true" — use the boolean directly',
        quickFix: { label: 'Remove "== true"', newText: raw.replace(/\s*==\s*true\b/, '') } })

    // Error not checked
    if (/,\s*err\s*:=/.test(s)) {
      const next = stripComments(lines[i + 1] ?? '')
      if (!/\berr\b/.test(next))
        diags.push({ id: id(), severity: 'warning', source: 'lint', file: filename, line: ln, col: 1,
          message: 'Error value not checked — add "if err != nil { }" after this line' })
    }

    // AnalogWrite on non-PWM pin
    const awGo = s.match(/arduino\.AnalogWrite\s*\(\s*(\d+)\s*,/)
    if (awGo) {
      const pin = parseInt(awGo[1])
      const pwm = [3, 5, 6, 9, 10, 11]
      if (!isNaN(pin) && !pwm.includes(pin))
        diags.push({ id: id(), severity: 'warning', source: 'lint', file: filename, line: ln, col: 1,
          message: `Pin ${pin} may not support PWM on Uno — PWM pins: ${pwm.join(', ')}` })
    }

    // Infinite loop without delay
    if (/^\s*for\s*\{/.test(raw) || /^\s*for\s+true\s*\{/.test(raw)) {
      const block = lines.slice(i + 1, i + 40).join('\n')
      if (!/arduino\.Delay|time\.Sleep|break\b|return\b/.test(block))
        diags.push({ id: id(), severity: 'warning', source: 'lint', file: filename, line: ln, col: 1,
          message: 'Infinite loop with no Delay or break — will block the Arduino scheduler' })
    }

    // Unused var (heuristic)
    const varDecl = raw.match(/^\s*var\s+(\w+)\s+/)
    if (varDecl && varDecl[1] !== '_') {
      const rest = lines.slice(i + 1).join('\n')
      const esc2 = varDecl[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (!new RegExp(`\\b${esc2}\\b`).test(rest))
        diags.push({ id: id(), severity: 'warning', source: 'lint', file: filename, line: ln, col: 1,
          message: `Variable "${varDecl[1]}" declared but may never be used` })
    }
  })

  return diags
}

// ─── C++ / .ino diagnostics ────────────────────────────────────────────────────

const STD_HEADERS = new Set([
  'Arduino', 'avr/io', 'avr/interrupt', 'avr/pgmspace', 'avr/wdt',
  'util/delay', 'string.h', 'string', 'vector', 'algorithm', 'stdint.h',
  'stdbool.h', 'stdio.h', 'stdlib.h', 'math.h', 'inttypes.h',
  'HardwareSerial', 'Stream', 'Print', 'WString', 'pins_arduino',
  'wiring_private', 'new', 'assert.h', 'stddef.h', 'float.h', 'limits.h',
])

function diagnoseCpp(code: string, filename: string, isIno: boolean): Diagnostic[] {
  const diags: Diagnostic[] = []
  const lines = code.split('\n')
  let uid = 0
  const id = () => `lsp-cpp-${uid++}`

  const userSymbols = collectSymbolsCpp(code)

  // All symbols visible in this file
  const allKnownCpp = new Set<string>(
    Array.from(ARDUINO_BUILTINS)
      .concat(Array.from(CPP_KEYWORDS))
      .concat(Array.from(ARDUINO_CONSTANTS))
      .concat(Array.from(userSymbols.keys()))
  )

  // ── Brace balance ─────────────────────────────────────────────────────────
  let braces = 0, lastOpen = 1
  lines.forEach((line, i) => {
    const s = stripComments(line)
    for (const ch of s) {
      if (ch === '{') { braces++; lastOpen = i + 1 }
      if (ch === '}') braces--
    }
  })
  if (braces > 0) diags.push({ id: id(), severity: 'error', source: 'lint', file: filename, line: lastOpen, col: 1, message: `Missing closing '}' — ${braces} unclosed block${braces > 1 ? 's' : ''}` })
  if (braces < 0) diags.push({ id: id(), severity: 'error', source: 'lint', file: filename, line: lines.length, col: 1, message: `Extra closing '}' — ${-braces} too many` })

  // ── Semicolon balance — missing semicolons ────────────────────────────────
  // (checked per-line below)

  // ── Missing Arduino.h ─────────────────────────────────────────────────────
  const hasArduinoH = lines.some(l => /#include\s+[<"]Arduino\.h[>"]/.test(l))
  if (!isIno && !hasArduinoH && /void\s+setup|void\s+loop/.test(code)) {
    diags.push({ id: id(), severity: 'warning', source: 'lint', file: filename, line: 1, col: 1,
      message: 'Missing #include <Arduino.h> — required for .cpp Arduino sketches',
      quickFix: { label: 'Add #include <Arduino.h>', newText: '#include <Arduino.h>\n' + lines[0] } })
  }

  // ── #include analysis ─────────────────────────────────────────────────────
  lines.forEach((line, i) => {
    const m = line.match(/^\s*#include\s+[<"]([^>"]+)[>"]/)
    if (!m) return
    const header = m[1]
    const libName = header.replace(/\.h$/, '')
    if (STD_HEADERS.has(header) || STD_HEADERS.has(libName)) return
    const info = KNOWN_LIBS[libName] ?? KNOWN_LIBS[header]
    if (info && !info.knownBuiltin) {
      diags.push({ id: id(), severity: 'info', source: 'lsp', file: filename, line: i + 1, col: 1,
        message: `"${info.displayName}" v${info.version} may need to be installed`,
        missingLib: { importName: libName, ...info } })
    } else if (!info) {
      diags.push({ id: id(), severity: 'warning', source: 'lsp', file: filename, line: i + 1, col: 1,
        message: `Unknown library "${libName}" — not found in tsuki registry`,
        missingLib: { importName: libName, displayName: libName, packageId: libName, knownBuiltin: false, description: `"${header}" is not a known tsuki/Arduino library.` } })
    }
  })

  // ── setup / loop ──────────────────────────────────────────────────────────
  if (isIno || hasArduinoH) {
    if (!/void\s+setup\s*\(\s*\)\s*\{/.test(code))
      diags.push({ id: id(), severity: 'warning', source: 'lint', file: filename, line: 1, col: 1, message: 'Missing void setup() { } — required by Arduino runtime' })
    if (!/void\s+loop\s*\(\s*\)\s*\{/.test(code))
      diags.push({ id: id(), severity: 'warning', source: 'lint', file: filename, line: 1, col: 1, message: 'Missing void loop() { } — required by Arduino runtime' })
  }

  // ── Per-line rules ────────────────────────────────────────────────────────
  const serialBegin = hasSerialBegin(code)
  // Track brace depth per-line for scope analysis
  let depth = 0

  lines.forEach((raw, i) => {
    const ln  = i + 1
    const s   = stripComments(raw)
    const tri = s.trim()

    // Update depth
    for (const ch of s) {
      if (ch === '{') depth++
      if (ch === '}') depth = Math.max(0, depth - 1)
    }

    // Skip preprocessor lines
    if (/^\s*#/.test(raw)) return
    // Skip blank lines
    if (!tri) return
    // Skip pure-comment lines
    if (/^\s*\/\//.test(raw)) return
    // Skip closing brace lines
    if (/^\s*[{}]/.test(tri)) return

    // ── Undeclared function calls ──────────────────────────────────────────
    const callRe = /\b([a-zA-Z_]\w*)\s*\(/g
    let cm: RegExpExecArray | null
    while ((cm = callRe.exec(s)) !== null) {
      const name = cm[1]

      // Skip known symbols
      if (allKnownCpp.has(name)) continue

      // Skip if preceded by . or ->  (method call on an object)
      const before = s.slice(0, cm.index)
      if (/(?:\.|->)\s*$/.test(before)) continue

      // Skip if this looks like a type cast: `(type)(expr)` or `type(expr)` where type is a known type
      // (already covered by CPP_KEYWORDS containing type names)

      // Skip constructor calls that match a known user type
      // (covered by userSymbols containing class names)

      // It's genuinely undeclared
      const col = s.indexOf(name) + 1
      diags.push({ id: id(), severity: 'error', source: 'lsp', file: filename, line: ln, col,
        message: `"${name}" is not declared — undefined function` })
    }

    // ── Undeclared variable/identifier usage ──────────────────────────────
    // Only flag simple standalone identifiers used as expressions (not declarations)
    // Heuristic: identifier followed by ) , ; or used alone on rhs of =
    // Too noisy in general — skip free-standing vars, focus on calls (covered above)

    // ── Missing semicolon at end of statement ─────────────────────────────
    // Lines that look like statements but don't end with ; { } // or \
    if (depth > 0) {
      const noSemi = tri
        .replace(/\/\/.*$/, '')  // strip inline comment
        .trimEnd()
      const lastChar = noSemi[noSemi.length - 1]
      const isStatement = lastChar && !';{}\\:#,'.includes(lastChar)
        && !/^\s*(?:if|else|for|while|do|switch|case|default|#|\/\/)/.test(noSemi)
        && !/\)\s*$/.test(noSemi)   // skip lines ending with ) — might be if/for condition split
        && noSemi.length > 2
        && !/\/\*/.test(noSemi)     // skip block comment starts
        && !/\*\//.test(noSemi)     // skip block comment ends
      if (isStatement && /\w/.test(noSemi)) {
        // Only warn if the line has function call or assignment pattern
        if (/\w\s*\(/.test(noSemi) || /\w\s*=\s*\w/.test(noSemi) || /^\s*\w+\s*$/.test(noSemi)) {
          diags.push({ id: id(), severity: 'error', source: 'lint', file: filename, line: ln, col: noSemi.length + 1,
            message: `Missing semicolon at end of statement` })
        }
      }
    }

    // ── Assignment in if condition ────────────────────────────────────────
    if (/\bif\s*\(/.test(s)) {
      const cond = s.match(/if\s*\((.+)\)/)?.[1] ?? ''
      if (/[^!=<>]=[^=]/.test(cond))
        diags.push({ id: id(), severity: 'warning', source: 'lint', file: filename, line: ln, col: 1,
          message: 'Possible assignment in if condition — did you mean "==" instead of "="?' })
    }

    // ── Large delay ───────────────────────────────────────────────────────
    const bigDelay = s.match(/\bdelay\s*\((\d+)\)/)
    if (bigDelay && parseInt(bigDelay[1]) >= 5000)
      diags.push({ id: id(), severity: 'info', source: 'lint', file: filename, line: ln, col: 1,
        message: `Large delay: ${bigDelay[1]} ms — consider a named constant` })

    // ── int overflow AVR ─────────────────────────────────────────────────
    const intLit = s.match(/\bint\s+\w+\s*=\s*(\d+)\s*;/)
    if (intLit && parseInt(intLit[1]) > 32767)
      diags.push({ id: id(), severity: 'warning', source: 'lint', file: filename, line: ln, col: 1,
        message: `Value ${intLit[1]} overflows int on AVR (max 32767) — use long`,
        quickFix: { label: 'Change to long', newText: raw.replace(/\bint\b/, 'long') } })

    // ── analogWrite on non-PWM pin ────────────────────────────────────────
    const awMatch = s.match(/\banalogWrite\s*\(\s*(\d+)\s*,/)
    if (awMatch) {
      const pin = parseInt(awMatch[1])
      const pwm = [3, 5, 6, 9, 10, 11]
      if (!isNaN(pin) && !pwm.includes(pin))
        diags.push({ id: id(), severity: 'warning', source: 'lint', file: filename, line: ln, col: 1,
          message: `Pin ${pin} may not support PWM on Uno — PWM pins: ${pwm.join(', ')}` })
    }

    // ── Serial without begin ──────────────────────────────────────────────
    if (/\bSerial\s*\.\s*(print|println|write)\s*\(/i.test(s) && !serialBegin) {
      if (!diags.some(d => d.message.includes('Serial.begin')))
        diags.push({ id: id(), severity: 'warning', source: 'lint', file: filename, line: ln, col: 1,
          message: 'Serial used without Serial.begin() in setup()' })
    }

    // ── Float == comparison ───────────────────────────────────────────────
    if (/\bfloat\b/.test(s) && /==\s*[\d.]+/.test(s))
      diags.push({ id: id(), severity: 'warning', source: 'lint', file: filename, line: ln, col: 1,
        message: 'Float comparison with == is unreliable — use abs(a - b) < epsilon' })

    // ── delay() inside ISR ────────────────────────────────────────────────
    if (/\bISR\s*\(/.test(s)) {
      const block = lines.slice(i, i + 25).join('\n')
      if (/\bdelay\s*\(/.test(block))
        diags.push({ id: id(), severity: 'error', source: 'lint', file: filename, line: ln, col: 1,
          message: 'delay() inside ISR will not work — interrupts are disabled during ISR execution' })
    }

    // ── char* += ─────────────────────────────────────────────────────────
    if (/char\s*\*.*\+=\s*"/.test(s))
      diags.push({ id: id(), severity: 'error', source: 'lint', file: filename, line: ln, col: 1,
        message: 'Cannot concatenate char* with += — use String type or strcat()' })

    // ── #define without value ─────────────────────────────────────────────
    if (/^\s*#define\s+\w+\s*$/.test(raw))
      diags.push({ id: id(), severity: 'info', source: 'lint', file: filename, line: ln, col: 1,
        message: '#define with no value — is the replacement missing?' })

    // ── Comparing with magic numbers without named constant ───────────────
    if (/==\s*\d{3,}\b/.test(s) && !/\bdelay\b/.test(s))
      diags.push({ id: id(), severity: 'info', source: 'lint', file: filename, line: ln, col: 1,
        message: 'Magic number in comparison — consider a named #define constant' })

    // ── Use of deprecated/wrong pinMode modes ────────────────────────────
    const pinModeMatch = s.match(/\bpinMode\s*\(\s*\w+\s*,\s*(\w+)\s*\)/)
    if (pinModeMatch) {
      const mode = pinModeMatch[1]
      if (!['INPUT', 'OUTPUT', 'INPUT_PULLUP', 'INPUT_PULLDOWN'].includes(mode) && !/^\d+$/.test(mode) && !CPP_KEYWORDS.has(mode))
        diags.push({ id: id(), severity: 'warning', source: 'lint', file: filename, line: ln, col: 1,
          message: `Unknown pinMode argument "${mode}" — expected INPUT, OUTPUT, or INPUT_PULLUP` })
    }

    // ── Global-scope variable written without volatile ────────────────────
    // (only meaningful when used inside ISR — too complex to detect here)
  })

  return diags
}

// ─── Public API ────────────────────────────────────────────────────────────────

export function runDiagnostics(
  code: string, filename: string, ext: string, opts: LspEngineOptions,
): Diagnostic[] {
  if (!code.trim()) return []
  try {
    if (ext === 'go'  && opts.lspGoEnabled)  return diagnoseGo(code, filename)
    if (ext === 'cpp' && opts.lspCppEnabled) return diagnoseCpp(code, filename, false)
    if (ext === 'ino' && opts.lspInoEnabled) return diagnoseCpp(code, filename, true)
  } catch { /* never crash the editor */ }
  return []
}

export function getMissingLibDiags(diags: Diagnostic[]): Diagnostic[] {
  return diags.filter(d => !!d.missingLib)
}

export function lookupLib(name: string): LibraryInfo | undefined {
  return KNOWN_LIBS[name]
}