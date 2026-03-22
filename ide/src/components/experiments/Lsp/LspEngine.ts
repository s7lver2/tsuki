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

// ─── Go diagnostics ────────────────────────────────────────────────────────────

/** Minimal scope-aware variable tracker for Go */
interface GoScope {
  vars: Map<string, { line: number; used: boolean; kind: 'short' | 'var' | 'param' | 'range' }>
  parent: GoScope | null
}

function newScope(parent: GoScope | null = null): GoScope {
  return { vars: new Map(), parent }
}

function scopeLookup(scope: GoScope | null, name: string): boolean {
  if (!scope) return false
  if (scope.vars.has(name)) return true
  return scopeLookup(scope.parent, name)
}

/** Known arduino package method signatures: name → [minArgs, maxArgs] */
const ARDUINO_METHOD_ARITIES: Record<string, [number, number]> = {
  'PinMode':          [2, 2],  'DigitalWrite':   [2, 2],  'DigitalRead':   [1, 1],
  'AnalogWrite':      [2, 2],  'AnalogRead':     [1, 1],  'Delay':         [1, 1],
  'DelayMicroseconds':[1, 1],  'Millis':         [0, 0],  'Micros':        [0, 0],
  'Map':              [5, 5],  'Constrain':      [3, 3],  'Random':        [1, 2],
  'RandomSeed':       [1, 1],  'Tone':           [2, 3],  'NoTone':        [1, 1],
  'PulseIn':          [2, 3],  'ShiftIn':        [3, 3],  'ShiftOut':      [4, 4],
  'AttachInterrupt':  [3, 3],  'DetachInterrupt':[1, 1],
}

/** fmt package functions that expect a format string as first arg */
const FMT_FORMAT_FUNCS = new Set(['Printf', 'Sprintf', 'Fprintf', 'Errorf', 'Sscanf', 'Fscanf', 'Scanf'])

function diagnoseGo(code: string, filename: string): Diagnostic[] {
  const diags: Diagnostic[] = []
  const lines = code.split('\n')
  let uid = 0
  const id = () => `lsp-go-${uid++}`

  const push = (
    severity: Diagnostic['severity'], source: Diagnostic['source'],
    line: number, col: number, message: string,
    extra?: Partial<Diagnostic>,
  ) => diags.push({ id: id(), severity, source, file: filename, line, col, message, ...extra })

  const clean  = stripAllComments(code)
  const clines = clean.split('\n')

  const userSymbols = collectSymbolsGo(clean)

  // ── 1. Package declaration ────────────────────────────────────────────────
  const pkgIdx = lines.findIndex(l => /^\s*package\s+\w+/.test(l))
  if (pkgIdx === -1) {
    push('error', 'lint', 1, 1, 'Missing package declaration — Go files must start with "package main"')
  } else {
    const pkg = lines[pkgIdx].match(/^\s*package\s+(\w+)/)?.[1]
    if (pkg && pkg !== 'main') {
      push('warning', 'lint', pkgIdx + 1, 1,
        `Package is "${pkg}" — Arduino tsuki projects should use "package main"`,
        { quickFix: { label: 'Change to "package main"', newText: lines[pkgIdx].replace(/package\s+\w+/, 'package main') } })
    }
  }

  // ── 2. Brace / paren balance ──────────────────────────────────────────────
  {
    let braces = 0, parens = 0, lastOpenBrace = 1, lastOpenParen = 1
    clines.forEach((s, i) => {
      for (const ch of s) {
        if (ch === '{') { braces++; lastOpenBrace = i + 1 }
        if (ch === '}') { if (--braces < 0) { push('error', 'lint', i + 1, s.indexOf('}') + 1, "Extra closing '}'"); braces = 0 } }
        if (ch === '(') { parens++; lastOpenParen = i + 1 }
        if (ch === ')') { if (--parens < 0) { push('error', 'lint', i + 1, s.indexOf(')') + 1, "Extra closing ')'"); parens = 0 } }
      }
    })
    if (braces > 0)  push('error', 'lint', lastOpenBrace, 1, `Missing closing '}' — ${braces} unclosed block${braces > 1 ? 's' : ''}`)
    if (parens > 0)  push('error', 'lint', lastOpenParen, 1, `Missing closing ')' — ${parens} unclosed paren${parens > 1 ? 's' : ''}`)
  }

  // ── 3. String literal balance ─────────────────────────────────────────────
  clines.forEach((s, i) => {
    // Count unescaped double quotes on the line (ignoring raw strings `...`)
    let inRaw = false
    let qCount = 0
    for (let j = 0; j < s.length; j++) {
      if (s[j] === '`') { inRaw = !inRaw; continue }
      if (!inRaw && s[j] === '"' && s[j - 1] !== '\\') qCount++
    }
    if (!inRaw && qCount % 2 !== 0) {
      push('error', 'lint', i + 1, s.indexOf('"') + 1, 'Unterminated string literal — odd number of double quotes')
    }
  })

  // ── 4. Import parsing ─────────────────────────────────────────────────────
  interface Imp { name: string; alias?: string; line: number }
  const imported: Imp[] = []
  lines.forEach((line, i) => {
    const single  = line.match(/^\s*import\s+"([^"]+)"/)
    if (single)  { imported.push({ name: single[1], line: i + 1 }); return }
    const aliased = line.match(/^\s*import\s+(\w+)\s+"([^"]+)"/)
    if (aliased) { imported.push({ name: aliased[2], alias: aliased[1], line: i + 1 }) }
  })
  let inImportBlock = false
  lines.forEach((line, i) => {
    if (/^\s*import\s*\(/.test(line))  { inImportBlock = true;  return }
    if (inImportBlock && /^\s*\)/.test(line)) { inImportBlock = false; return }
    if (!inImportBlock) return
    const m = line.match(/^\s*(?:(\w+)\s+)?"([^"]+)"/)
    if (m) imported.push({ name: m[2], alias: m[1], line: i + 1 })
  })

  // Duplicate imports
  const seenImports = new Map<string, number>()
  imported.forEach(({ name, line }) => {
    if (seenImports.has(name)) push('error', 'lint', line, 1, `Duplicate import "${name}"`)
    seenImports.set(name, line)
  })

  // Missing / unknown library
  imported.forEach(({ name, line }) => {
    const info = KNOWN_LIBS[name]
    if (!info) {
      push('warning', 'lsp', line, 1, `Unknown package "${name}" — not in tsuki registry`,
        { missingLib: { importName: name, displayName: name, packageId: name, knownBuiltin: false, description: `"${name}" is not a known tsuki/Arduino library.` } })
    } else if (!info.knownBuiltin) {
      push('info', 'lsp', line, 1, `"${info.displayName}" v${info.version} needs to be installed`,
        { missingLib: { importName: name, ...info } })
    }
  })

  // Unused imports
  const importLineSet = new Set(imported.map(im => im.line - 1))
  const codeNoImports = clines.map((l, i) => importLineSet.has(i) ? '' : l).join('\n')
  imported.forEach(({ name, alias, line }) => {
    if (name === 'arduino') return
    const useName = (alias && alias !== '_') ? alias : name.split('/').pop()!
    const escaped = useName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!new RegExp(`\\b${escaped}[.([]`).test(codeNoImports) && alias !== '_') {
      push('error', 'lint', line, 1, `"${name}" imported and not used`)
    }
  })

  // ── 5. setup / loop presence ─────────────────────────────────────────────
  const isSketch = imported.some(im => im.name === 'arduino') || code.includes('arduino.')
  if (isSketch) {
    if (!/func\s+setup\s*\(\s*\)\s*\{/.test(code))
      push('warning', 'lint', 1, 1, 'Missing func setup() — required by Arduino runtime')
    if (!/func\s+loop\s*\(\s*\)\s*\{/.test(code))
      push('warning', 'lint', 1, 1, 'Missing func loop() — required by Arduino runtime')
  }

  // ── 6. Function signatures ────────────────────────────────────────────────
  // Collect all declared funcs with their param counts
  interface FuncSig { params: number; variadic: boolean; line: number }
  const funcSigs = new Map<string, FuncSig>()
  clines.forEach((s, i) => {
    const m = s.match(/^\s*func\s+(?:\([\w\s*]+\)\s+)?(\w+)\s*\(([^)]*)\)/)
    if (!m) return
    const params = m[2].trim() === '' ? 0
      : m[2].split(',').filter(p => p.trim()).length
    const variadic = m[2].includes('...')
    funcSigs.set(m[1], { params, variadic, line: i + 1 })
  })

  // ── 7. All known symbols ──────────────────────────────────────────────────
  const allKnown = new Set<string>([
    ...Array.from(GO_BUILTINS), ...Array.from(GO_KEYWORDS),
    ...Array.from(userSymbols.keys()),
    ...imported.map(im => (im.alias && im.alias !== '_') ? im.alias : im.name.split('/').pop()!),
    'true', 'false', 'nil', 'iota', '_',
    'println', 'print',  // builtin Go print functions
  ])

  const serialBegin = hasSerialBegin(code)

  // ── 8. Per-line analysis ──────────────────────────────────────────────────
  // Track locally-declared short vars per function body (simple heuristic)
  const localVars = new Map<string, number>()  // name → declare line
  let inFuncDepth = 0

  clines.forEach((s, i) => {
    const raw = lines[i]
    const ln  = i + 1

    // Track function body depth for local var reset
    const opens  = (s.match(/\{/g) || []).length
    const closes = (s.match(/\}/g) || []).length
    if (opens > closes && inFuncDepth === 0) {
      // Entering a new top-level function
      if (/^\s*func\s/.test(s)) localVars.clear()
    }
    inFuncDepth += opens - closes
    if (inFuncDepth < 0) inFuncDepth = 0

    // Collect short declarations on this line
    const shortDecls = Array.from(s.matchAll(/\b(\w+)\s*(?:,\s*\w+\s*)*:=/g))
    for (const m of shortDecls) {
      if (m[1] && m[1] !== '_') localVars.set(m[1], ln)
    }
    // Collect range declarations: for k, v := range
    const rangeDecl = s.match(/for\s+(\w+)(?:\s*,\s*(\w+))?\s*:=\s*range/)
    if (rangeDecl) {
      if (rangeDecl[1] && rangeDecl[1] !== '_') localVars.set(rangeDecl[1], ln)
      if (rangeDecl[2] && rangeDecl[2] !== '_') localVars.set(rangeDecl[2], ln)
    }

    // ── Arduino method arity checks ──────────────────────────────────────
    const arduinoCall = s.match(/arduino\.(\w+)\s*\(([^)]*)\)/)
    if (arduinoCall) {
      const method = arduinoCall[1]
      const arity  = ARDUINO_METHOD_ARITIES[method]
      if (arity) {
        const args = arduinoCall[2].trim() === '' ? 0
          : arduinoCall[2].split(',').filter(a => a.trim()).length
        const [min, max] = arity
        if (args < min)
          push('error', 'lint', ln, s.indexOf('arduino.') + 1,
            `arduino.${method}() called with ${args} argument${args !== 1 ? 's' : ''} — expects ${min}`)
        else if (args > max)
          push('error', 'lint', ln, s.indexOf('arduino.') + 1,
            `arduino.${method}() called with ${args} arguments — expects at most ${max}`)
      }
    }

    // ── Casing errors on arduino API ─────────────────────────────────────
    const casingFixes: Array<[RegExp, string, string]> = [
      [/arduino\.delay\s*\(/i,         'arduino.Delay',         'Delay'],
      [/arduino\.digitalwrite\s*\(/i,  'arduino.DigitalWrite',  'DigitalWrite'],
      [/arduino\.digitalread\s*\(/i,   'arduino.DigitalRead',   'DigitalRead'],
      [/arduino\.analogwrite\s*\(/i,   'arduino.AnalogWrite',   'AnalogWrite'],
      [/arduino\.analogread\s*\(/i,    'arduino.AnalogRead',    'AnalogRead'],
      [/arduino\.pinmode\s*\(/i,       'arduino.PinMode',       'PinMode'],
      [/arduino\.serial\b(?!\.Begin)/i,'arduino.Serial',        'Serial'],
    ]
    for (const [re, correct, short] of casingFixes) {
      if (re.test(s) && !s.includes(correct)) {
        const col = s.search(re) + 1
        push('error', 'lint', ln, col,
          `Use ${correct} — Go exports require exact casing (${short} not ${s.match(re)?.[0]?.replace(/\s*\($/, '')})`)
      }
    }

    // ── fmt format-string checks ─────────────────────────────────────────
    const fmtCall = s.match(/\bfmt\.(\w+)\s*\((.*)/)
    if (fmtCall && FMT_FORMAT_FUNCS.has(fmtCall[1])) {
      // Check that first arg is a string literal
      const argsStr = fmtCall[2]
      if (argsStr && !argsStr.trimStart().startsWith('"') && !argsStr.trimStart().startsWith('`')) {
        push('warning', 'lint', ln, s.indexOf('fmt.') + 1,
          `fmt.${fmtCall[1]}() first argument should be a format string — did you mean fmt.Println()?`)
      }
    }

    // ── Undeclared function calls (improved) ────────────────────────────
    const callRe = /\b([a-zA-Z_]\w*)\s*\(/g
    let cm: RegExpExecArray | null
    while ((cm = callRe.exec(s)) !== null) {
      const name   = cm[1]
      const before = s.slice(0, cm.index)
      if (GO_KEYWORDS.has(name) || GO_BUILTINS.has(name)) continue
      if (/\.\s*$/.test(before)) continue           // method call: obj.name(
      if (/^\s*func\s*$/.test(before.trim())) continue  // func declaration
      if (allKnown.has(name) || localVars.has(name)) continue
      if (funcSigs.has(name)) continue
      push('error', 'lsp', ln, cm.index + 1,
        `"${name}" is not declared — undefined function`)
    }

    // ── Unused local variables (heuristic — only var-declared) ──────────
    const varDecl = raw.match(/^\s*var\s+(\w+)\s+/)
    if (varDecl && varDecl[1] !== '_') {
      const vname = varDecl[1]
      const rest  = clines.slice(i + 1).join('\n')
      const esc   = vname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (!new RegExp(`\\b${esc}\\b`).test(rest))
        push('warning', 'lint', ln, 1, `Variable "${vname}" declared but may never be used`)
    }

    // ── Short declaration shadowing ──────────────────────────────────────
    const shortRe = /\b(\w+)\s*:=/g
    let sm: RegExpExecArray | null
    while ((sm = shortRe.exec(s)) !== null) {
      const name = sm[1]
      if (name === '_' || GO_KEYWORDS.has(name)) continue
      const prevLine = localVars.get(name)
      if (prevLine && prevLine !== ln) {
        push('warning', 'lint', ln, sm.index + 1,
          `"${name}" already declared at line ${prevLine} — use "=" to reassign or a new name`)
      }
    }

    // ── Serial without Begin ─────────────────────────────────────────────
    if (/arduino\.Serial\.(Print|Println|Write)\s*\(/.test(s) && !serialBegin) {
      if (!diags.some(d => d.message.includes('Serial.Begin')))
        push('warning', 'lint', ln, 1, 'arduino.Serial used without arduino.Serial.Begin() in setup()')
    }

    // ── Large delay ──────────────────────────────────────────────────────
    const bigDelay = s.match(/arduino\.Delay\s*\((\d+)\)/)
    if (bigDelay && parseInt(bigDelay[1]) >= 5000)
      push('info', 'lint', ln, 1, `Large delay: ${bigDelay[1]} ms — consider a named constant`)

    // ── := inside function arguments ─────────────────────────────────────
    if (/\(\s*\w+\s*:=/.test(s))
      push('error', 'lint', ln, s.indexOf(':=') + 1,
        'Cannot use short variable declaration (:=) inside function arguments')

    // ── Redundant == true ────────────────────────────────────────────────
    if (/==\s*true\b/.test(s))
      push('info', 'lint', ln, 1, 'Redundant "== true" — use the boolean directly',
        { quickFix: { label: 'Remove "== true"', newText: raw.replace(/\s*==\s*true\b/, '') } })

    // ── Unchecked error ──────────────────────────────────────────────────
    if (/,\s*err\s*:=/.test(s)) {
      const next = clines[i + 1] ?? ''
      if (!/\berr\b/.test(next))
        push('warning', 'lint', ln, 1, 'Error value not checked — add "if err != nil { }" after this line')
    }

    // ── AnalogWrite on non-PWM pins (Uno) ────────────────────────────────
    const awGo = s.match(/arduino\.AnalogWrite\s*\(\s*(\d+)\s*,/)
    if (awGo) {
      const pin = parseInt(awGo[1])
      if (!isNaN(pin) && ![3, 5, 6, 9, 10, 11].includes(pin))
        push('warning', 'lint', ln, 1, `Pin ${pin} may not support PWM on Uno — PWM pins: 3,5,6,9,10,11`)
    }

    // ── Infinite loop without delay ──────────────────────────────────────
    if (/^\s*for\s*\{/.test(raw) || /^\s*for\s+true\s*\{/.test(raw)) {
      const block = clines.slice(i + 1, i + 40).join('\n')
      if (!/arduino\.Delay|time\.Sleep|break\b|return\b/.test(block))
        push('warning', 'lint', ln, 1, 'Infinite loop with no Delay or break — will block the Arduino scheduler')
    }

    // ── Global var declared but never written (write-only var) ───────────
    // (only top-level, heuristic)

    // ── goto is strongly discouraged ─────────────────────────────────────
    if (/^\s*goto\s+\w+/.test(raw))
      push('warning', 'lint', ln, 1, '"goto" is strongly discouraged — restructure with functions or loops')

    // ── Comparing error to nil string ────────────────────────────────────
    if (/err\s*==\s*""/.test(s) || /err\s*!=\s*""/.test(s))
      push('error', 'lint', ln, 1, 'Compare error to nil, not "" — use: if err != nil')

    // ── Division by literal zero ─────────────────────────────────────────
    if (/\/\s*0\b/.test(s) && !/\/\//.test(s.slice(0, s.search(/\/\s*0/))))
      push('error', 'lint', ln, s.search(/\/\s*0/) + 1, 'Division by zero')
  })

  return deduplicateDiags(diags)
}

function deduplicateDiags(diags: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  return diags.filter(d => {
    const key = `${d.line}:${d.col}:${d.message.slice(0, 40)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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

// ─────────────────────────────────────────────────────────────────────────────
//  Python diagnostics
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_PYTHON_PACKAGES = new Set([
  'arduino', 'time', 'fmt', 'math',
  'dht', 'ws2812', 'mpu6050', 'servo', 'irremote', 'u8g2', 'bmp280', 'stepper',
])

/** Known tsuki Python arduino API arities: method -> [minArgs, maxArgs] */
const PY_ARDUINO_ARITIES: Record<string, [number, number]> = {
  'pinMode':           [2, 2],  'digitalWrite':   [2, 2],  'digitalRead':   [1, 1],
  'analogWrite':       [2, 2],  'analogRead':     [1, 1],  'delay':         [1, 1],
  'delayMicroseconds': [1, 1],  'tone':           [2, 3],  'noTone':        [1, 1],
  'pulseIn':           [2, 3],  'shiftIn':        [3, 3],  'shiftOut':      [4, 4],
  'map':               [5, 5],  'constrain':      [3, 3],  'random':        [1, 2],
}

/** Python built-ins - never flag as undeclared */
const PY_BUILTINS = new Set([
  'print', 'input', 'len', 'range', 'list', 'dict', 'set', 'tuple', 'str', 'int', 'float',
  'bool', 'bytes', 'bytearray', 'type', 'isinstance', 'issubclass', 'hasattr', 'getattr',
  'setattr', 'delattr', 'callable', 'iter', 'next', 'enumerate', 'zip', 'map', 'filter',
  'sorted', 'reversed', 'min', 'max', 'sum', 'abs', 'round', 'pow', 'divmod',
  'hex', 'oct', 'bin', 'chr', 'ord', 'repr', 'id', 'hash', 'dir', 'vars', 'locals', 'globals',
  'open', 'super', 'object', 'Exception', 'ValueError', 'TypeError', 'KeyError', 'IndexError',
  'AttributeError', 'RuntimeError', 'StopIteration', 'OverflowError', 'ZeroDivisionError',
  'True', 'False', 'None', 'NotImplemented',
  '__name__', '__file__', '__doc__', '__import__',
  'setup', 'loop', 'arduino',
])

/** Python keywords */
const PY_KEYWORDS = new Set([
  'if', 'elif', 'else', 'for', 'while', 'def', 'class', 'return', 'import', 'from',
  'as', 'with', 'try', 'except', 'finally', 'raise', 'pass', 'break', 'continue',
  'in', 'not', 'and', 'or', 'is', 'lambda', 'yield', 'del', 'assert', 'global',
  'nonlocal', 'async', 'await',
])

function diagnosePy(code: string, filename: string): Diagnostic[] {
  const diags: Diagnostic[] = []
  const lines = code.split('\n')
  let uid = 0
  const id = () => `lsp-py-${uid++}`

  const push = (
    severity: Diagnostic['severity'], source: Diagnostic['source'],
    line: number, col: number, message: string,
    extra?: Partial<Diagnostic>,
  ) => diags.push({ id: id(), severity, source, file: filename, line, col, message, ...extra })

  // Strip string content and comments from a line for safe token analysis
  const stripLine = (s: string) => {
    let out = s.replace(/#.*$/, '')
    // Replace string contents with empty quotes (naive but good enough for lint)
    out = out.replace(/"(?:[^"\\]|\\.)*"/g, '""')
    out = out.replace(/'(?:[^'\\]|\\.)*'/g, "''")
    return out
  }

  // ── 1. Collect all top-level defined names ────────────────────────────────
  const definedNames = new Set<string>([...Array.from(PY_BUILTINS), ...Array.from(PY_KEYWORDS)])
  const importedModules = new Set<string>()
  lines.forEach(raw => {
    const defM  = raw.match(/^(?:async\s+)?def\s+(\w+)/)
    if (defM)   { definedNames.add(defM[1]) }
    const clsM  = raw.match(/^class\s+(\w+)/)
    if (clsM)   { definedNames.add(clsM[1]) }
    const impM  = raw.match(/^import\s+(\w+)/)
    if (impM)   { definedNames.add(impM[1]); importedModules.add(impM[1]) }
    const fromM = raw.match(/^from\s+(\w+)\s+import\s+(.+)/)
    if (fromM) {
      importedModules.add(fromM[1])
      fromM[2].split(',').forEach(n => {
        const alias = n.trim().split(/\s+as\s+/).pop()?.trim()
        if (alias) definedNames.add(alias)
      })
    }
    const asnM  = raw.match(/^(\w+)\s*(?::\s*[\w\[\], |]+)?\s*=(?!=)/)
    if (asnM && !PY_KEYWORDS.has(asnM[1])) definedNames.add(asnM[1])
    const forM  = raw.match(/for\s+(\w+)(?:\s*,\s*(\w+))?\s+in\b/)
    if (forM)   { definedNames.add(forM[1]); if (forM[2]) definedNames.add(forM[2]) }
    const withM = raw.match(/with\s+.+\s+as\s+(\w+)/)
    if (withM)  definedNames.add(withM[1])
  })

  // ── 2. Paren / bracket / brace balance ───────────────────────────────────
  let parens = 0, brackets = 0, braces = 0
  lines.forEach((raw, i) => {
    const s = stripLine(raw)
    for (const ch of s) {
      if      (ch === '(') parens++
      else if (ch === ')') { if (--parens < 0) { push('error','lint',i+1,1,"Extra closing ')'"); parens = 0 } }
      else if (ch === '[') brackets++
      else if (ch === ']') { if (--brackets < 0) { push('error','lint',i+1,1,"Extra closing ']'"); brackets = 0 } }
      else if (ch === '{') braces++
      else if (ch === '}') { if (--braces < 0) { push('error','lint',i+1,1,"Extra closing '}'"); braces = 0 } }
    }
  })
  if (parens   > 0) push('error','lint',lines.length,1,`Unclosed '(' — ${parens} missing ')'`)
  if (brackets > 0) push('error','lint',lines.length,1,`Unclosed '[' — ${brackets} missing ']'`)
  if (braces   > 0) push('error','lint',lines.length,1,`Unclosed '{' — ${braces} missing '}'`)

  // ── 3. Indentation analysis ───────────────────────────────────────────────
  let usesSpaces = false, usesTabs = false
  const indentStack: number[] = [0]
  lines.forEach((raw, i) => {
    const s = raw.trimStart()
    if (!s || s.startsWith('#')) return
    const indent = raw.length - s.length
    if (raw[0] === '\t') usesTabs = true
    else if (raw[0] === ' ') usesSpaces = true
    if (/^\t+ /.test(raw) || /^ +\t/.test(raw))
      push('error','lint',i+1,1,'Mixed tabs and spaces — use only spaces (PEP 8)')
    const top = indentStack[indentStack.length - 1]
    if (indent < top) {
      if (!indentStack.includes(indent))
        push('error','lint',i+1,1,`Indentation error — dedent of ${indent} spaces does not match any outer level (was ${top})`)
      while (indentStack[indentStack.length - 1] > indent) indentStack.pop()
    } else if (indent > top) {
      indentStack.push(indent)
    }
  })
  if (usesSpaces && usesTabs)
    push('error','lint',1,1,'File mixes tabs and spaces — standardise on spaces (PEP 8)')

  // ── 4. Import analysis ────────────────────────────────────────────────────
  const importedMap = new Map<string, number>()
  lines.forEach((raw, i) => {
    const single = raw.match(/^import\s+(\w+)/)
    if (single) {
      if (importedMap.has(single[1])) push('warning','lint',i+1,1,`Duplicate import '${single[1]}'`)
      else importedMap.set(single[1], i+1)
      return
    }
    const aliased = raw.match(/^from\s+(\w+)\s+import\s+(\w+)/)
    if (aliased) importedMap.set(aliased[2], i+1)
  })

  // Unused imports (known tsuki packages only)
  importedMap.forEach((lineNum, name) => {
    if (!KNOWN_PYTHON_PACKAGES.has(name)) return
    const usageRe = new RegExp('\\b' + name + '\\b')
    const usedAfter = lines.slice(lineNum).some(l => usageRe.test(l))
    if (!usedAfter)
      push('warning','lint',lineNum,1,`Import '${name}' is never used`,
        { quickFix: { label: `Remove import ${name}`, newText: '' } })
  })

  // ── 5. setup() / loop() presence ─────────────────────────────────────────
  const hasSetup = lines.some(l => /^def\s+setup\s*\(\s*\)\s*:/.test(l))
  const hasLoop  = lines.some(l => /^def\s+loop\s*\(\s*\)\s*:/.test(l))
  if (!hasSetup) push('warning','lint',1,1,'Missing def setup(): — Arduino tsuki sketches require a setup() function')
  if (!hasLoop)  push('warning','lint',1,1,'Missing def loop(): — Arduino tsuki sketches require a loop() function')

  // ── 6. Per-line checks ────────────────────────────────────────────────────
  lines.forEach((raw, i) => {
    const ln     = i + 1
    const s      = raw.trimStart()
    const indent = raw.length - s.length
    const cs     = stripLine(raw).trimStart()

    // Missing colon after control-flow keywords
    const ctrlM = cs.match(/^(if|elif|else|for|while|def|class|try|except|finally|with)\b/)
    if (ctrlM && !cs.trimEnd().endsWith(':') && !cs.trimEnd().match(/[,(\[{\\]$/)) {
      push('error','lint',ln,raw.trimEnd().length+1,`Missing ':' at end of '${ctrlM[1]}' statement`)
    }

    // print without parentheses
    if (/^print\s+[^(]/.test(cs)) {
      push('error','lint',ln,indent+1,'Use print() with parentheses — print without () is Python 2 syntax', {
        quickFix: {
          label: 'Add parentheses',
          newText: raw.replace(/^(\s*)print\s+(.*)$/, (_m: string, sp: string, arg: string) => `${sp}print(${arg.trim()})`),
        },
      })
    }

    // C-style boolean literals
    if (/\btrue\b/.test(cs))
      push('error','lint',ln,indent+1,'Use True (capital T) in Python, not true', {
        quickFix: { label: 'Fix: True', newText: raw.replace(/\btrue\b/g, 'True') },
      })
    if (/\bfalse\b/.test(cs))
      push('error','lint',ln,indent+1,'Use False (capital F) in Python, not false', {
        quickFix: { label: 'Fix: False', newText: raw.replace(/\bfalse\b/g, 'False') },
      })
    if (/\bnull\b/.test(cs))
      push('error','lint',ln,indent+1,'Use None instead of null in Python', {
        quickFix: { label: 'Fix: None', newText: raw.replace(/\bnull\b/g, 'None') },
      })
    if (/\bNULL\b/.test(cs))
      push('warning','lint',ln,indent+1,'Use None instead of NULL in Python')

    // C-style logical operators
    if (/&&/.test(cs))
      push('error','lint',ln,cs.indexOf('&&')+indent+1,'Use "and" instead of "&&" in Python')
    if (/\|\|/.test(cs))
      push('error','lint',ln,cs.indexOf('||')+indent+1,'Use "or" instead of "||" in Python')

    // Trailing semicolons
    if (cs.trimEnd().endsWith(';') && !cs.startsWith('#'))
      push('info','lint',ln,raw.trimEnd().length,'Trailing semicolons are not needed in Python')

    // C-style assignment in condition
    if (/if\s*\(.*[^=!<>]=(?!=).*\)/.test(cs))
      push('warning','lint',ln,indent+1,'Possible assignment inside condition — use == for comparison')

    // arduino.X() arity check
    const ardCall = cs.match(/\barduino\.(\w+)\s*\(([^)]*)\)/)
    if (ardCall) {
      const method = ardCall[1]
      const arity  = PY_ARDUINO_ARITIES[method]
      if (arity) {
        const argc = ardCall[2].trim() === '' ? 0 : ardCall[2].split(',').filter((a: string) => a.trim()).length
        const [min, max] = arity
        if (argc < min)
          push('error','lint',ln,indent+1,`arduino.${method}() called with ${argc} args — expects ${min}`)
        else if (argc > max)
          push('error','lint',ln,indent+1,`arduino.${method}() called with ${argc} args — expects at most ${max}`)
      }
    }

    // `is` to compare values
    if (/\bis\s+(?:True|False|[0-9"'])/.test(cs))
      push('warning','lint',ln,indent+1,'Use "==" to compare values — "is" checks object identity, not equality')

    // == None/True/False
    if (/==\s*None\b/.test(cs)) push('info','lint',ln,indent+1,'Use "is None" instead of "== None"')
    if (/==\s*True\b/.test(cs)) push('info','lint',ln,indent+1,'Use "if x:" instead of "if x == True:"')
    if (/==\s*False\b/.test(cs)) push('info','lint',ln,indent+1,'Use "if not x:" instead of "if x == False:"')

    // Mutable default argument
    if (/def\s+\w+\s*\(.*=\s*[\[{]/.test(cs))
      push('warning','lint',ln,indent+1,'Mutable default argument — use None and assign inside the function body')

    // return outside function
    if (/^\s*return\b/.test(raw) && indent === 0)
      push('error','lint',ln,1,'"return" outside function')

    // Division by literal zero
    const divZero = cs.match(/\/\s*0\b/)
    if (divZero && !cs.slice(0, divZero.index).includes('//'))
      push('error','lint',ln,(divZero.index ?? 0)+indent+1,'Division by zero')

    // sensor.begin() call order
    if (cs.includes('.read_temperature()') || cs.includes('.read_humidity()')) {
      const varM = cs.match(/^(\w+)\.(read_temperature|read_humidity)/)
      if (varM) {
        const sensor = varM[1]
        const hasBegin = lines.slice(0, i).some(l => l.includes(`${sensor}.begin()`))
        if (!hasBegin)
          push('warning','lint',ln,indent+1,`${sensor}.begin() not found before first read — call begin() in setup()`)
      }
    }

    // Type annotation value mismatch
    const annotM = cs.match(/^(\w+)\s*:\s*(int|float|bool|str)\s*=\s*(.+)/)
    if (annotM) {
      const [, , annType, val] = annotM
      const v = val.trimStart()
      const conflict =
        (annType === 'int'   && (v.startsWith('"') || v.startsWith("'") || v === 'True' || v === 'False')) ||
        (annType === 'float' && (v.startsWith('"') || v.startsWith("'"))) ||
        (annType === 'str'   && /^[0-9-]/.test(v) && !v.startsWith('"') && !v.startsWith("'"))
      if (conflict)
        push('warning','lint',ln,indent+1,`Type annotation says ${annType} but value appears to be a different type`)
    }
  })

  return deduplicateDiags(diags)
}



export function runDiagnostics(
  code: string, filename: string, ext: string, opts: LspEngineOptions,
): Diagnostic[] {
  if (!code.trim()) return []
  try {
    if (ext === 'go'  && opts.lspGoEnabled)  return diagnoseGo(code, filename)
    if (ext === 'cpp' && opts.lspCppEnabled) return diagnoseCpp(code, filename, false)
    if (ext === 'ino' && opts.lspInoEnabled) return diagnoseCpp(code, filename, true)
    if (ext === 'py')                        return diagnosePy(code, filename)
  } catch { /* never crash the editor */ }
  return []
}

export function getMissingLibDiags(diags: Diagnostic[]): Diagnostic[] {
  return diags.filter(d => !!d.missingLib)
}

export function lookupLib(name: string): LibraryInfo | undefined {
  return KNOWN_LIBS[name]
}

// ── tsuki-webkit recommendation ───────────────────────────────────────────────

/**
 * Libraries that duplicate functionality already covered by tsuki-webkit.
 * When the user imports any of these on an ESP board, we suggest migrating.
 */
const WEBKIT_EQUIVALENT_LIBS = new Set([
  'ESP8266WebServer', 'WebServer', 'ESP_AsyncWebServer', 'ESPAsyncWebServer',
  'AsyncTCP', 'WiFiServer', 'ESP8266WiFi', 'WiFi', 'WiFiNINA',
])

export interface WebkitRecommendation {
  importName: string
  line:       number
  message:    string
}

/**
 * Scan code for imports of Arduino web-server libraries on an ESP board.
 * Returns a recommendation to switch to tsuki-webkit if any are found.
 */
export function getWebkitRecommendations(
  code:    string,
  ext:     string,
  boardId: string,
): WebkitRecommendation[] {
  const isEsp = boardId === 'esp8266' || boardId === 'esp32'
  if (!isEsp) return []

  const results: WebkitRecommendation[] = []
  const lines = code.split('\n')

  lines.forEach((raw, i) => {
    // Go imports:  import "ESP8266WiFi"  or  "ESP_AsyncWebServer"
    if (ext === 'go') {
      const m = raw.match(/import\s+["']([^"']+)["']/)
      if (m && WEBKIT_EQUIVALENT_LIBS.has(m[1])) {
        results.push({
          importName: m[1],
          line: i + 1,
          message: `Consider replacing "${m[1]}" with tsuki-webkit — it compiles JSX directly to an ESP-hosted control panel, no manual WebServer boilerplate needed.`,
        })
      }
    }
    // C++ / .ino:  #include <ESP8266WebServer.h>
    if (ext === 'cpp' || ext === 'ino') {
      const m = raw.match(/#include\s+[<"]([^>"]+\.h)[>"]/)
      if (m) {
        const libName = m[1].replace(/\.h$/, '')
        if (WEBKIT_EQUIVALENT_LIBS.has(libName)) {
          results.push({
            importName: libName,
            line: i + 1,
            message: `Consider tsuki-webkit instead of "${libName}" — write your control panel in JSX and let tsuki-webkit compile it for ${boardId === 'esp8266' ? 'ESP8266' : 'ESP32'}.`,
          })
        }
      }
    }
  })

  return results
}

// ── JSX / tsuki-webkit.conf.json diagnostics ─────────────────────────────────

export interface JsxDiagnostic {
  line:    number
  message: string
  severity: 'error' | 'warning' | 'info'
}

/** Light-weight JSX linter — runs on .jsx files in tsuki-webkit projects. */
export function diagnoseJsx(code: string): JsxDiagnostic[] {
  const diags: JsxDiagnostic[] = []
  const lines = code.split('\n')

  // Check for tsuki-webkit import
  const hasWebkitImport = lines.some(l => l.includes('tsuki-webkit'))
  if (!hasWebkitImport) {
    diags.push({ line: 1, severity: 'info', message: 'No tsuki-webkit import found — add: import { Api, Json, Serial } from \'tsuki-webkit\'' })
  }

  // Check for default export
  if (!code.includes('export default')) {
    diags.push({ line: lines.length, severity: 'error', message: 'Missing default export — tsuki-webkit needs export default function App() { … }' })
  }

  // Check for return with JSX
  const returnJsx = code.match(/return\s*\(\s*</)
  if (!returnJsx) {
    diags.push({ line: lines.length, severity: 'warning', message: 'No JSX found in return() — the page will be empty' })
  }

  // Check for unclosed JSX tags (very naive balance)
  let opens = 0
  for (const l of lines) {
    opens += (l.match(/<[A-Za-z]/g) || []).length
    opens -= (l.match(/<\/[A-Za-z]|\/>/g) || []).length
  }
  if (opens > 2) {
    diags.push({ line: lines.length, severity: 'warning', message: `Possible unclosed JSX tags (${opens} opens without matching close)` })
  }

  return diags
}