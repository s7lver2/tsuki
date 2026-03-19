const KW = new Set(['package','import','func','var','const','type','struct','interface','map','chan','go','defer','select','case','default','break','continue','return','if','else','for','range','switch','fallthrough','goto','make','new','len','cap','append','copy','delete','close','panic','recover','nil','true','false','iota'])
const TY = new Set(['int','int8','int16','int32','int64','uint','uint8','uint16','uint32','uint64','uintptr','float32','float64','complex64','complex128','byte','rune','string','bool','error','any'])
const PK = new Set(['arduino','fmt','time','math','strconv','wire','Wire','spi','SPI','Serial','Servo','LiquidCrystal','dht','ws2812','u8g2'])

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function tokenizeLine(line: string): string {
  if (/^\s*\/\//.test(line)) return `<span class="syn-com">${esc(line)}</span>`

  let out = ''
  let i = 0

  while (i < line.length) {
    // mid-line comment
    if (line[i] === '/' && line[i + 1] === '/') {
      out += `<span class="syn-com">${esc(line.slice(i))}</span>`
      break
    }

    // string / backtick
    if (line[i] === '"' || line[i] === '`') {
      const q = line[i]; let j = i + 1
      while (j < line.length && !(line[j] === q && line[j - 1] !== '\\')) j++
      out += `<span class="syn-str">${esc(line.slice(i, j + 1))}</span>`
      i = j + 1; continue
    }

    // char literal
    if (line[i] === "'") {
      let j = i + 1
      while (j < line.length && line[j] !== "'") j++
      out += `<span class="syn-str">${esc(line.slice(i, j + 1))}</span>`
      i = j + 1; continue
    }

    // number
    if (/\d/.test(line[i]) && (i === 0 || /[\s(,=+\-*/<>!&|^~%]/.test(line[i - 1]))) {
      let j = i
      while (j < line.length && /[0-9._xXa-fA-FbBoO]/.test(line[j])) j++
      out += `<span class="syn-num">${esc(line.slice(i, j))}</span>`
      i = j; continue
    }

    // word
    if (/[a-zA-Z_]/.test(line[i])) {
      let j = i
      while (j < line.length && /\w/.test(line[j])) j++
      const word = line.slice(i, j)
      if (KW.has(word))       out += `<span class="syn-kw">${esc(word)}</span>`
      else if (TY.has(word))  out += `<span class="syn-typ">${esc(word)}</span>`
      else if (PK.has(word))  out += `<span class="syn-pkg">${esc(word)}</span>`
      else if (j < line.length && line[j] === '(') out += `<span class="syn-fn">${esc(word)}</span>`
      else out += esc(word)
      i = j; continue
    }

    // two-char ops
    const ops2 = [':=','++','--','==','!=','<=','>=','&&','||','<<','>>','+=','-=','*=','/=']
    let matched = false
    for (const op of ops2) {
      if (line.slice(i, i + op.length) === op) {
        out += `<span class="syn-op">${esc(op)}</span>`
        i += op.length; matched = true; break
      }
    }
    if (!matched) { out += esc(line[i]); i++ }
  }
  return out
}

export function highlightGo(code: string): string {
  return code.split('\n').map(tokenizeLine).join('\n')
}

// ── C++ / Arduino (.ino) syntax highlighting ──────────────────────────────────

const CPP_KW = new Set([
  'auto','break','case','catch','class','const','constexpr','continue','default',
  'delete','do','else','enum','explicit','extern','false','for','friend','goto',
  'if','inline','mutable','namespace','new','nullptr','operator','private',
  'protected','public','register','return','sizeof','static','struct','switch',
  'template','this','throw','true','try','typedef','typename','union','using',
  'virtual','volatile','while','nullptr','override','final',
  // Arduino-specific
  'void','setup','loop','HIGH','LOW','INPUT','OUTPUT','INPUT_PULLUP',
  'LED_BUILTIN','A0','A1','A2','A3','A4','A5',
])

const CPP_TY = new Set([
  'int','long','short','char','float','double','bool','unsigned','signed',
  'int8_t','int16_t','int32_t','int64_t','uint8_t','uint16_t','uint32_t','uint64_t',
  'size_t','String','byte','word',
])

const CPP_PK = new Set([
  'Serial','Serial1','Serial2','Wire','SPI','EEPROM','SD',
  'Servo','LiquidCrystal','Adafruit_GFX','IRremote','DHT',
  'pinMode','digitalWrite','digitalRead','analogWrite','analogRead',
  'delay','millis','micros','delayMicroseconds','pulseIn',
  'tone','noTone','shiftOut','shiftIn','attachInterrupt','detachInterrupt',
])

function tokenizeCppLine(line: string): string {
  // Full-line comment or preprocessor directive
  if (/^\s*\/\//.test(line)) return `<span class="syn-com">${esc(line)}</span>`
  if (/^\s*#/.test(line)) return `<span class="syn-pkg">${esc(line)}</span>`

  let out = ''
  let i = 0

  while (i < line.length) {
    // mid-line comment
    if (line[i] === '/' && line[i + 1] === '/') {
      out += `<span class="syn-com">${esc(line.slice(i))}</span>`
      break
    }

    // string
    if (line[i] === '"') {
      let j = i + 1
      while (j < line.length && !(line[j] === '"' && line[j - 1] !== '\\')) j++
      out += `<span class="syn-str">${esc(line.slice(i, j + 1))}</span>`
      i = j + 1; continue
    }

    // char literal
    if (line[i] === "'") {
      let j = i + 1
      while (j < line.length && line[j] !== "'") j++
      out += `<span class="syn-str">${esc(line.slice(i, j + 1))}</span>`
      i = j + 1; continue
    }

    // number
    if (/\d/.test(line[i]) && (i === 0 || /[\s(,=+\-*/<>!&|^~%]/.test(line[i - 1]))) {
      let j = i
      while (j < line.length && /[0-9._xXa-fA-FbBoOuUlL]/.test(line[j])) j++
      out += `<span class="syn-num">${esc(line.slice(i, j))}</span>`
      i = j; continue
    }

    // word / identifier
    if (/[a-zA-Z_]/.test(line[i])) {
      let j = i
      while (j < line.length && /\w/.test(line[j])) j++
      const word = line.slice(i, j)
      if (CPP_KW.has(word))      out += `<span class="syn-kw">${esc(word)}</span>`
      else if (CPP_TY.has(word)) out += `<span class="syn-typ">${esc(word)}</span>`
      else if (CPP_PK.has(word)) out += `<span class="syn-pkg">${esc(word)}</span>`
      else if (j < line.length && line[j] === '(') out += `<span class="syn-fn">${esc(word)}</span>`
      else out += esc(word)
      i = j; continue
    }

    // two-char ops
    const ops2 = ['::', '++', '--', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '+=', '-=', '*=', '/=', '->', '::']
    let matched = false
    for (const op of ops2) {
      if (line.slice(i, i + op.length) === op) {
        out += `<span class="syn-op">${esc(op)}</span>`
        i += op.length; matched = true; break
      }
    }
    if (!matched) { out += esc(line[i]); i++ }
  }
  return out
}

export function highlightCpp(code: string): string {
  return code.split('\n').map(tokenizeCppLine).join('\n')
}

// .ino files use the same highlighting as C++
export function highlightIno(code: string): string {
  return highlightCpp(code)
}

// ── Python highlighter ────────────────────────────────────────────────────────

const PY_KW  = new Set(['def','return','if','elif','else','while','for','in','import','from','pass','break','continue','class','and','or','not','global','lambda','yield','with','as','try','except','finally','raise','del','assert','is','None','True','False'])
const PY_TY  = new Set(['int','float','str','bool','bytes','list','dict','tuple','set','type','object','auto','void','uint8','uint16','uint32','int8','int16','int32','byte','word','size_t'])
const PY_PKG = new Set(['arduino','fmt','time','math','dht','ws2812','u8g2','irremote','mpu6050','stepper','bmp280'])

function tokenizePyLine(line: string): string {
  // full-line comment
  const trimmed = line.trimStart()
  if (trimmed.startsWith('#')) return `<span class="syn-com">${esc(line)}</span>`

  let out = ''
  let i = 0

  while (i < line.length) {
    // inline comment
    if (line[i] === '#') {
      out += `<span class="syn-com">${esc(line.slice(i))}</span>`
      break
    }

    // triple-quoted strings (simplified: just colour from here to end of line)
    if ((line[i] === '"' || line[i] === "'") && line.slice(i, i + 3) === line[i].repeat(3)) {
      out += `<span class="syn-str">${esc(line.slice(i))}</span>`
      break
    }

    // single/double quoted string
    if (line[i] === '"' || line[i] === "'") {
      const q = line[i]; let j = i + 1
      while (j < line.length && !(line[j] === q && line[j - 1] !== '\\')) j++
      out += `<span class="syn-str">${esc(line.slice(i, j + 1))}</span>`
      i = j + 1; continue
    }

    // number
    if (/\d/.test(line[i]) && (i === 0 || /[\s(,=+\-*/<>!&|^~%]/.test(line[i - 1]))) {
      let j = i
      while (j < line.length && /[0-9._xXa-fA-FbBoO]/.test(line[j])) j++
      out += `<span class="syn-num">${esc(line.slice(i, j))}</span>`
      i = j; continue
    }

    // word
    if (/[a-zA-Z_]/.test(line[i])) {
      let j = i
      while (j < line.length && /\w/.test(line[j])) j++
      const word = line.slice(i, j)
      if (PY_KW.has(word))       out += `<span class="syn-kw">${esc(word)}</span>`
      else if (PY_TY.has(word))  out += `<span class="syn-typ">${esc(word)}</span>`
      else if (PY_PKG.has(word)) out += `<span class="syn-pkg">${esc(word)}</span>`
      else if (j < line.length && line[j] === '(') out += `<span class="syn-fn">${esc(word)}</span>`
      else out += esc(word)
      i = j; continue
    }

    // two-char ops
    const pyOps2 = [':=', '**', '//', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '->', '<<', '>>']
    let matched = false
    for (const op of pyOps2) {
      if (line.slice(i, i + op.length) === op) {
        out += `<span class="syn-op">${esc(op)}</span>`
        i += op.length; matched = true; break
      }
    }
    if (!matched) { out += esc(line[i]); i++ }
  }
  return out
}

export function highlightPython(code: string): string {
  return code.split('\n').map(tokenizePyLine).join('\n')
}

// ── JSX / tsuki-webkit highlighter ─────────────────────────────────────────────
const JSX_KW = new Set([
  'import', 'export', 'default', 'from', 'function', 'return',
  'const', 'let', 'var', 'if', 'else', 'for', 'while', 'switch', 'case',
  'break', 'continue', 'new', 'typeof', 'instanceof', 'null', 'undefined',
  'true', 'false', 'async', 'await', 'class', 'extends', 'super', 'this',
])
const JSX_WEBKIT_NAMES = new Set(['Api', 'Json', 'Serial'])
const JSX_HTML_TAGS = new Set([
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'button', 'input', 'select', 'option', 'form', 'label',
  'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'thead', 'tbody',
  'img', 'a', 'nav', 'main', 'header', 'footer', 'section', 'article',
  'br', 'hr', 'strong', 'em', 'code', 'pre',
])

function tokenizeJsxLine(line: string): string {
  if (/^\s*\/\//.test(line)) return `<span class="syn-com">${esc(line)}</span>`

  let out = ''
  let i = 0

  while (i < line.length) {
    // comment
    if (line[i] === '/' && line[i + 1] === '/') {
      out += `<span class="syn-com">${esc(line.slice(i))}</span>`
      break
    }
    // string
    if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
      const q = line[i]; let j = i + 1
      while (j < line.length && !(line[j] === q && line[j - 1] !== '\\')) j++
      out += `<span class="syn-str">${esc(line.slice(i, j + 1))}</span>`
      i = j + 1; continue
    }
    // JSX tag: <TagName or </TagName
    if (line[i] === '<') {
      let j = i + 1
      if (line[j] === '/') j++
      const start = j
      while (j < line.length && /[\w-]/.test(line[j])) j++
      const tagName = line.slice(start, j)
      if (tagName.length > 0) {
        const isHtml = JSX_HTML_TAGS.has(tagName.toLowerCase())
        const tagClass = isHtml ? 'syn-pkg' : 'syn-fn'
        out += `<span class="syn-op">${esc(line.slice(i, i + (line[i+1] === '/' ? 2 : 1)))}</span>`
        out += `<span class="${tagClass}">${esc(tagName)}</span>`
        i = j; continue
      }
      out += esc(line[i]); i++; continue
    }
    // number
    if (/\d/.test(line[i]) && (i === 0 || /[\s(,=+\-*/<>!&|^~%]/.test(line[i - 1]))) {
      let j = i
      while (j < line.length && /[0-9._]/.test(line[j])) j++
      out += `<span class="syn-num">${esc(line.slice(i, j))}</span>`
      i = j; continue
    }
    // word
    if (/[a-zA-Z_$]/.test(line[i])) {
      let j = i
      while (j < line.length && /[\w$]/.test(line[j])) j++
      const word = line.slice(i, j)
      if (JSX_KW.has(word))            out += `<span class="syn-kw">${esc(word)}</span>`
      else if (JSX_WEBKIT_NAMES.has(word)) out += `<span class="syn-pkg">${esc(word)}</span>`
      else if (j < line.length && line[j] === '(') out += `<span class="syn-fn">${esc(word)}</span>`
      else if (/^[A-Z]/.test(word))    out += `<span class="syn-typ">${esc(word)}</span>`
      else out += esc(word)
      i = j; continue
    }
    // braces/arrows
    if ('{}()[]'.includes(line[i])) { out += `<span class="syn-op">${esc(line[i])}</span>`; i++; continue }
    out += esc(line[i]); i++
  }
  return out
}

export function highlightJsx(code: string): string {
  return code.split('\n').map(tokenizeJsxLine).join('\n')
}

export function highlightByExt(code: string, ext: string): string {
  switch (ext) {
    case 'cpp': case 'h': case 'hpp': return highlightCpp(code)
    case 'ino': return highlightIno(code)
    case 'py':  return highlightPython(code)
    case 'jsx': return highlightJsx(code)
    default:    return highlightGo(code)
  }
}