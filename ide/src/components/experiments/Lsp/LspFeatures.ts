/**
 * LspFeatures.ts — Completion · Hover Docs · Signature Help · Inlay Hints
 * All logic runs in the browser. No external process.
 */

// ─── Shared types ─────────────────────────────────────────────────────────────

export type CompletionKind = 'keyword' | 'function' | 'variable' | 'type' | 'constant' | 'snippet' | 'package' | 'field' | 'method'

export interface CompletionItem {
  label:       string
  kind:        CompletionKind
  detail?:     string          // e.g. "func(n int) string"
  documentation?: string
  insertText:  string
  insertSnippet?: boolean      // true → insertText has $0/$1 placeholders
  sortOrder?:  number          // lower = higher priority
}

export interface HoverDoc {
  title:       string          // e.g. "fmt.Println"
  signature?:  string          // e.g. "func Println(a ...any) (n int, err error)"
  doc:         string          // markdown-ish description
  tags?:       string[]        // ["stdlib", "io"]
  returns?:    string
}

export interface SignatureParam {
  name:  string
  type:  string
  doc?:  string
}

export interface SignatureHelp {
  label:       string          // full signature string
  params:      SignatureParam[]
  activeParam: number
  doc?:        string
}

export interface InlayHint {
  line:  number                // 1-based
  col:   number                // char offset (0-based) AFTER the expression
  label: string
  kind:  'type' | 'param' | 'return'
}

// ─────────────────────────────────────────────────────────────────────────────
//  GO STDLIB DATABASE
// ─────────────────────────────────────────────────────────────────────────────

interface FuncDef {
  sig:     string
  doc:     string
  params:  SignatureParam[]
  returns?: string
  tags?:   string[]
}

const GO_FMT: Record<string, FuncDef> = {
  Println:  { sig: 'func Println(a ...any) (n int, err error)',   doc: 'Formats using the default formats for its operands and writes to standard output. Spaces are always added between operands and a newline is appended.', params: [{name:'a', type:'...any', doc:'Values to print'}], returns: '(n int, err error)', tags: ['io','fmt'] },
  Printf:   { sig: 'func Printf(format string, a ...any) (n int, err error)', doc: 'Formats according to a format specifier and writes to standard output.', params: [{name:'format', type:'string', doc:'Format string (e.g. "%d %s")'}, {name:'a', type:'...any', doc:'Arguments for the format verbs'}], returns: '(n int, err error)', tags: ['io','fmt'] },
  Sprintf:  { sig: 'func Sprintf(format string, a ...any) string', doc: 'Formats according to a format specifier and returns the resulting string.', params: [{name:'format', type:'string', doc:'Format string'}, {name:'a', type:'...any'}], returns: 'string', tags: ['fmt'] },
  Fprintf:  { sig: 'func Fprintf(w io.Writer, format string, a ...any) (n int, err error)', doc: 'Formats and writes to w.', params: [{name:'w', type:'io.Writer'}, {name:'format', type:'string'}, {name:'a', type:'...any'}], returns: '(n int, err error)', tags: ['io','fmt'] },
  Errorf:   { sig: 'func Errorf(format string, a ...any) error', doc: 'Creates an error with the formatted message. Use %w to wrap an existing error.', params: [{name:'format', type:'string'}, {name:'a', type:'...any'}], returns: 'error', tags: ['error','fmt'] },
  Sscanf:   { sig: 'func Sscanf(str string, format string, a ...any) (n int, err error)', doc: 'Scans the argument string, storing successive space-separated values into successive arguments as determined by the format.', params: [{name:'str', type:'string'}, {name:'format', type:'string'}, {name:'a', type:'...any'}], returns: '(n int, err error)', tags: ['io','fmt'] },
  Scan:     { sig: 'func Scan(a ...any) (n int, err error)', doc: 'Scans text read from standard input.', params: [{name:'a', type:'...any'}], returns: '(n int, err error)', tags: ['io'] },
  Print:    { sig: 'func Print(a ...any) (n int, err error)', doc: 'Formats using default formats and writes to stdout. Spaces added only between non-string operands.', params: [{name:'a', type:'...any'}], returns: '(n int, err error)', tags: ['io'] },
  Sprint:   { sig: 'func Sprint(a ...any) string', doc: 'Returns a string from the formatted arguments.', params: [{name:'a', type:'...any'}], returns: 'string', tags: ['fmt'] },
}

const GO_STRINGS: Record<string, FuncDef> = {
  Contains:    { sig: 'func Contains(s, substr string) bool', doc: 'Reports whether substr is within s.', params: [{name:'s', type:'string'}, {name:'substr', type:'string'}], returns: 'bool' },
  HasPrefix:   { sig: 'func HasPrefix(s, prefix string) bool', doc: 'Reports whether string s begins with prefix.', params: [{name:'s', type:'string'}, {name:'prefix', type:'string'}], returns: 'bool' },
  HasSuffix:   { sig: 'func HasSuffix(s, suffix string) bool', doc: 'Reports whether string s ends with suffix.', params: [{name:'s', type:'string'}, {name:'suffix', type:'string'}], returns: 'bool' },
  Join:        { sig: 'func Join(elems []string, sep string) string', doc: 'Concatenates the elements of its first argument to create a single string with sep placed between.', params: [{name:'elems', type:'[]string'}, {name:'sep', type:'string'}], returns: 'string' },
  Split:       { sig: 'func Split(s, sep string) []string', doc: 'Slices s into all substrings separated by sep.', params: [{name:'s', type:'string'}, {name:'sep', type:'string'}], returns: '[]string' },
  Replace:     { sig: 'func Replace(s, old, new string, n int) string', doc: 'Returns a copy of s with the first n non-overlapping instances of old replaced by new. If n < 0, there is no limit.', params: [{name:'s', type:'string'}, {name:'old', type:'string'}, {name:'new', type:'string'}, {name:'n', type:'int', doc:'-1 for all'}], returns: 'string' },
  ReplaceAll:  { sig: 'func ReplaceAll(s, old, new string) string', doc: 'Returns a copy of s with all non-overlapping instances of old replaced by new.', params: [{name:'s', type:'string'}, {name:'old', type:'string'}, {name:'new', type:'string'}], returns: 'string' },
  TrimSpace:   { sig: 'func TrimSpace(s string) string', doc: 'Slices s removing all leading and trailing white space.', params: [{name:'s', type:'string'}], returns: 'string' },
  Trim:        { sig: 'func Trim(s, cutset string) string', doc: 'Returns a slice of s with all leading and trailing Unicode code points contained in cutset removed.', params: [{name:'s', type:'string'}, {name:'cutset', type:'string'}], returns: 'string' },
  ToLower:     { sig: 'func ToLower(s string) string', doc: 'Returns s with all Unicode letters mapped to their lower case.', params: [{name:'s', type:'string'}], returns: 'string' },
  ToUpper:     { sig: 'func ToUpper(s string) string', doc: 'Returns s with all Unicode letters mapped to their upper case.', params: [{name:'s', type:'string'}], returns: 'string' },
  Index:       { sig: 'func Index(s, substr string) int', doc: 'Returns the index of the first instance of substr in s, or -1 if substr is not present.', params: [{name:'s', type:'string'}, {name:'substr', type:'string'}], returns: 'int' },
  Count:       { sig: 'func Count(s, substr string) int', doc: 'Counts the number of non-overlapping instances of substr in s.', params: [{name:'s', type:'string'}, {name:'substr', type:'string'}], returns: 'int' },
  Fields:      { sig: 'func Fields(s string) []string', doc: 'Splits the string s around each instance of one or more consecutive white space.', params: [{name:'s', type:'string'}], returns: '[]string' },
  Repeat:      { sig: 'func Repeat(s string, count int) string', doc: 'Returns a new string consisting of count copies of s.', params: [{name:'s', type:'string'}, {name:'count', type:'int'}], returns: 'string' },
  EqualFold:   { sig: 'func EqualFold(s, t string) bool', doc: 'Reports whether s and t are equal under simple Unicode case-folding (case-insensitive).', params: [{name:'s', type:'string'}, {name:'t', type:'string'}], returns: 'bool' },
  TrimPrefix:  { sig: 'func TrimPrefix(s, prefix string) string', doc: 'Returns s without the provided leading prefix string.', params: [{name:'s', type:'string'}, {name:'prefix', type:'string'}], returns: 'string' },
  TrimSuffix:  { sig: 'func TrimSuffix(s, suffix string) string', doc: 'Returns s without the provided trailing suffix string.', params: [{name:'s', type:'string'}, {name:'suffix', type:'string'}], returns: 'string' },
  ContainsAny: { sig: 'func ContainsAny(s, chars string) bool', doc: 'Reports whether any Unicode code points in chars are within s.', params: [{name:'s', type:'string'}, {name:'chars', type:'string'}], returns: 'bool' },
  Builder:     { sig: 'type Builder struct', doc: 'Builder is used to efficiently build a string using Write methods. It minimizes memory copying.', params: [], tags: ['type'] },
  NewReader:   { sig: 'func NewReader(s string) *Reader', doc: 'NewReader returns a new Reader reading from s.', params: [{name:'s', type:'string'}], returns: '*Reader' },
}

const GO_STRCONV: Record<string, FuncDef> = {
  Itoa:          { sig: 'func Itoa(i int) string', doc: 'Is equivalent to FormatInt(int64(i), 10).', params: [{name:'i', type:'int'}], returns: 'string' },
  Atoi:          { sig: 'func Atoi(s string) (int, error)', doc: 'Equivalent to ParseInt(s, 10, 0), converted to type int.', params: [{name:'s', type:'string'}], returns: '(int, error)' },
  FormatInt:     { sig: 'func FormatInt(i int64, base int) string', doc: 'Returns the string representation of i in the given base.', params: [{name:'i', type:'int64'}, {name:'base', type:'int', doc:'2 to 36'}], returns: 'string' },
  ParseInt:      { sig: 'func ParseInt(s string, base int, bitSize int) (int64, error)', doc: 'Interprets a string s in the given base (0, 2 to 36) and bit size (0 to 64).', params: [{name:'s', type:'string'}, {name:'base', type:'int'}, {name:'bitSize', type:'int'}], returns: '(int64, error)' },
  FormatFloat:   { sig: 'func FormatFloat(f float64, fmt byte, prec, bitSize int) string', doc: 'Converts the floating-point number f to a string.', params: [{name:'f', type:'float64'}, {name:'fmt', type:'byte', doc:"'f','e','g',..."}, {name:'prec', type:'int', doc:'-1 for shortest'}, {name:'bitSize', type:'int', doc:'32 or 64'}], returns: 'string' },
  ParseFloat:    { sig: 'func ParseFloat(s string, bitSize int) (float64, error)', doc: 'Converts the string s to a floating-point number with the precision specified by bitSize.', params: [{name:'s', type:'string'}, {name:'bitSize', type:'int'}], returns: '(float64, error)' },
  FormatBool:    { sig: 'func FormatBool(b bool) string', doc: 'Returns "true" or "false" according to the value of b.', params: [{name:'b', type:'bool'}], returns: 'string' },
  ParseBool:     { sig: 'func ParseBool(str string) (bool, error)', doc: 'Returns the boolean value represented by the string. It accepts 1, t, T, TRUE, true, True, 0, f, F, FALSE, false, False.', params: [{name:'str', type:'string'}], returns: '(bool, error)' },
  AppendInt:     { sig: 'func AppendInt(dst []byte, i int64, base int) []byte', doc: 'Appends the string form of the integer i to dst.', params: [{name:'dst', type:'[]byte'}, {name:'i', type:'int64'}, {name:'base', type:'int'}], returns: '[]byte' },
}

const GO_MATH: Record<string, FuncDef> = {
  Sqrt:    { sig: 'func Sqrt(x float64) float64', doc: 'Returns the square root of x.', params: [{name:'x', type:'float64'}], returns: 'float64' },
  Abs:     { sig: 'func Abs(x float64) float64', doc: 'Returns the absolute value of x.', params: [{name:'x', type:'float64'}], returns: 'float64' },
  Floor:   { sig: 'func Floor(x float64) float64', doc: 'Returns the greatest integer value less than or equal to x.', params: [{name:'x', type:'float64'}], returns: 'float64' },
  Ceil:    { sig: 'func Ceil(x float64) float64', doc: 'Returns the least integer value greater than or equal to x.', params: [{name:'x', type:'float64'}], returns: 'float64' },
  Round:   { sig: 'func Round(x float64) float64', doc: 'Returns the nearest integer, rounding half away from zero.', params: [{name:'x', type:'float64'}], returns: 'float64' },
  Max:     { sig: 'func Max(x, y float64) float64', doc: 'Returns the larger of x or y.', params: [{name:'x', type:'float64'}, {name:'y', type:'float64'}], returns: 'float64' },
  Min:     { sig: 'func Min(x, y float64) float64', doc: 'Returns the smaller of x or y.', params: [{name:'x', type:'float64'}, {name:'y', type:'float64'}], returns: 'float64' },
  Pow:     { sig: 'func Pow(x, y float64) float64', doc: 'Returns x**y, the base-x exponential of y.', params: [{name:'x', type:'float64'}, {name:'y', type:'float64'}], returns: 'float64' },
  Log:     { sig: 'func Log(x float64) float64', doc: 'Returns the natural logarithm of x.', params: [{name:'x', type:'float64'}], returns: 'float64' },
  Log2:    { sig: 'func Log2(x float64) float64', doc: 'Returns the binary logarithm of x.', params: [{name:'x', type:'float64'}], returns: 'float64' },
  Log10:   { sig: 'func Log10(x float64) float64', doc: 'Returns the decimal logarithm of x.', params: [{name:'x', type:'float64'}], returns: 'float64' },
  Sin:     { sig: 'func Sin(x float64) float64', doc: 'Returns the sine of the radian argument x.', params: [{name:'x', type:'float64', doc:'radians'}], returns: 'float64' },
  Cos:     { sig: 'func Cos(x float64) float64', doc: 'Returns the cosine of the radian argument x.', params: [{name:'x', type:'float64', doc:'radians'}], returns: 'float64' },
  Tan:     { sig: 'func Tan(x float64) float64', doc: 'Returns the tangent of the radian argument x.', params: [{name:'x', type:'float64', doc:'radians'}], returns: 'float64' },
  Atan2:   { sig: 'func Atan2(y, x float64) float64', doc: 'Returns the arc tangent of y/x, using the signs of the two to determine the quadrant of the return value.', params: [{name:'y', type:'float64'}, {name:'x', type:'float64'}], returns: 'float64' },
  Mod:     { sig: 'func Mod(x, y float64) float64', doc: 'Returns the floating-point remainder of x/y.', params: [{name:'x', type:'float64'}, {name:'y', type:'float64'}], returns: 'float64' },
  Inf:     { sig: 'func Inf(sign int) float64', doc: 'Returns positive infinity if sign >= 0, negative infinity if sign < 0.', params: [{name:'sign', type:'int'}], returns: 'float64' },
  IsNaN:   { sig: 'func IsNaN(f float64) bool', doc: 'Reports whether f is a "not-a-number" value.', params: [{name:'f', type:'float64'}], returns: 'bool' },
  IsInf:   { sig: 'func IsInf(f float64, sign int) bool', doc: 'Reports whether f is an infinity. If sign > 0, IsInf reports whether f is positive infinity. If sign < 0, IsInf reports whether f is negative infinity.', params: [{name:'f', type:'float64'}, {name:'sign', type:'int'}], returns: 'bool' },
}

const GO_TIME: Record<string, FuncDef> = {
  Now:    { sig: 'func Now() Time', doc: 'Returns the current local time.', params: [], returns: 'Time' },
  Sleep:  { sig: 'func Sleep(d Duration)', doc: 'Pauses the current goroutine for at least the duration d. A negative or zero duration causes Sleep to return immediately.', params: [{name:'d', type:'Duration', doc:'e.g. 500 * time.Millisecond'}] },
  Since:  { sig: 'func Since(t Time) Duration', doc: 'Returns the time elapsed since t. It is shorthand for time.Now().Sub(t).', params: [{name:'t', type:'Time'}], returns: 'Duration' },
  Until:  { sig: 'func Until(t Time) Duration', doc: 'Returns the duration until t. It is shorthand for t.Sub(time.Now()).', params: [{name:'t', type:'Time'}], returns: 'Duration' },
  After:  { sig: 'func After(d Duration) <-chan Time', doc: 'Waits for the duration to elapse and then sends the current time on the returned channel.', params: [{name:'d', type:'Duration'}], returns: '<-chan Time' },
  Parse:  { sig: 'func Parse(layout, value string) (Time, error)', doc: 'Parses a formatted string and returns the time value it represents.', params: [{name:'layout', type:'string', doc:'e.g. "2006-01-02"'}, {name:'value', type:'string'}], returns: '(Time, error)' },
  NewTimer:  { sig: 'func NewTimer(d Duration) *Timer', doc: 'Creates a new Timer that will send the current time on its channel after at least duration d.', params: [{name:'d', type:'Duration'}], returns: '*Timer' },
  NewTicker: { sig: 'func NewTicker(d Duration) *Ticker', doc: 'Returns a new Ticker containing a channel that will send the time on the channel after each tick.', params: [{name:'d', type:'Duration'}], returns: '*Ticker' },
}

const GO_SORT: Record<string, FuncDef> = {
  Slice:    { sig: 'func Slice(x any, less func(i, j int) bool)', doc: 'Sorts the slice x given the provided less function.', params: [{name:'x', type:'any', doc:'the slice to sort'}, {name:'less', type:'func(i, j int) bool', doc:'returns true if element i < element j'}] },
  Ints:     { sig: 'func Ints(x []int)', doc: 'Sorts a slice of ints in increasing order.', params: [{name:'x', type:'[]int'}] },
  Strings:  { sig: 'func Strings(x []string)', doc: 'Sorts a slice of strings in increasing order.', params: [{name:'x', type:'[]string'}] },
  Float64s: { sig: 'func Float64s(x []float64)', doc: 'Sorts a slice of float64s in increasing order.', params: [{name:'x', type:'[]float64'}] },
  Search:   { sig: 'func Search(n int, f func(int) bool) int', doc: 'Binary search: finds the smallest index i in [0, n) at which f(i) is true.', params: [{name:'n', type:'int'}, {name:'f', type:'func(int) bool'}], returns: 'int' },
  IntsAreSorted:    { sig: 'func IntsAreSorted(x []int) bool', doc: 'Reports whether the slice x is sorted in increasing order.', params: [{name:'x', type:'[]int'}], returns: 'bool' },
  StringsAreSorted: { sig: 'func StringsAreSorted(x []string) bool', doc: 'Reports whether the slice x is sorted in increasing order.', params: [{name:'x', type:'[]string'}], returns: 'bool' },
}

const GO_SYNC: Record<string, FuncDef> = {
  Mutex:    { sig: 'type Mutex struct', doc: 'A Mutex is a mutual exclusion lock. It must not be copied after first use.', params: [], tags: ['type'] },
  WaitGroup:{ sig: 'type WaitGroup struct', doc: 'A WaitGroup waits for a collection of goroutines to finish.', params: [], tags: ['type'] },
  Once:     { sig: 'type Once struct', doc: 'A Once is an object that will perform exactly one action.', params: [], tags: ['type'] },
  Map:      { sig: 'type Map struct', doc: 'Map is like a Go map[any]any but is safe for concurrent use.', params: [], tags: ['type'] },
}

// Package index: pkgName → member → definition
const GO_PKG_MEMBERS: Record<string, Record<string, FuncDef>> = {
  fmt:     GO_FMT,
  strings: GO_STRINGS,
  strconv: GO_STRCONV,
  math:    GO_MATH,
  time:    GO_TIME,
  sort:    GO_SORT,
  sync:    GO_SYNC,
}

// Merged lookup used by completions/hover/sig-help — includes arduino + tsuki external pkgs
// Built lazily so TSUKI_PKG_MEMBERS (declared later) is available at call time
function getAllPkgMembers(): Record<string, Record<string, FuncDef>> {
  return {
    ...GO_PKG_MEMBERS,
    arduino:  ARDUINO_GO_FUNCS as unknown as Record<string, FuncDef>,
    // tsuki external packages
    dht:      DHT_FUNCS     as unknown as Record<string, FuncDef>,
    ws2812:   WS2812_FUNCS  as unknown as Record<string, FuncDef>,
    mpu6050:  MPU6050_FUNCS as unknown as Record<string, FuncDef>,
    Servo:    SERVO_FUNCS   as unknown as Record<string, FuncDef>,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ARDUINO FUNCTION DATABASE
// ─────────────────────────────────────────────────────────────────────────────

const ARDUINO_FUNCS: Record<string, FuncDef> = {
  // GPIO
  pinMode:       { sig: 'void pinMode(uint8_t pin, uint8_t mode)', doc: 'Configures the specified pin to behave either as an input or an output.', params: [{name:'pin', type:'uint8_t', doc:'pin number'}, {name:'mode', type:'uint8_t', doc:'INPUT, OUTPUT, or INPUT_PULLUP'}] },
  digitalWrite:  { sig: 'void digitalWrite(uint8_t pin, uint8_t val)', doc: 'Write a HIGH or a LOW value to a digital pin.', params: [{name:'pin', type:'uint8_t'}, {name:'val', type:'uint8_t', doc:'HIGH or LOW'}] },
  digitalRead:   { sig: 'int digitalRead(uint8_t pin)', doc: 'Reads the value from a specified digital pin — either HIGH or LOW.', params: [{name:'pin', type:'uint8_t'}], returns: 'int (HIGH or LOW)' },
  analogWrite:   { sig: 'void analogWrite(uint8_t pin, int val)', doc: 'Writes an analog value (PWM wave) to a pin. pin must support PWM.', params: [{name:'pin', type:'uint8_t', doc:'must support PWM (3,5,6,9,10,11 on Uno)'}, {name:'val', type:'int', doc:'0–255'}] },
  analogRead:    { sig: 'int analogRead(uint8_t pin)', doc: 'Reads the value from the specified analog pin. Returns 0–1023.', params: [{name:'pin', type:'uint8_t', doc:'A0–A5'}], returns: 'int (0–1023)' },
  // Time
  delay:         { sig: 'void delay(unsigned long ms)', doc: 'Pauses the program for the amount of time (in milliseconds) specified.', params: [{name:'ms', type:'unsigned long', doc:'milliseconds to wait'}] },
  delayMicroseconds: { sig: 'void delayMicroseconds(unsigned int us)', doc: 'Pauses the program for the amount of time in microseconds.', params: [{name:'us', type:'unsigned int', doc:'microseconds to wait. Max accurate: 16383µs'}] },
  millis:        { sig: 'unsigned long millis()', doc: 'Returns the number of milliseconds since the Arduino board began running. Overflows after ~49 days.', params: [], returns: 'unsigned long' },
  micros:        { sig: 'unsigned long micros()', doc: 'Returns the number of microseconds since the board began running. Overflows after ~70 minutes.', params: [], returns: 'unsigned long' },
  // Math
  map:           { sig: 'long map(long x, long in_min, long in_max, long out_min, long out_max)', doc: 'Re-maps a number from one range to another.', params: [{name:'x', type:'long', doc:'value to map'}, {name:'in_min', type:'long'}, {name:'in_max', type:'long'}, {name:'out_min', type:'long'}, {name:'out_max', type:'long'}], returns: 'long' },
  constrain:     { sig: 'T constrain(T x, T a, T b)', doc: 'Constrains a number to be within a range.', params: [{name:'x', type:'T', doc:'number to constrain'}, {name:'a', type:'T', doc:'lower bound'}, {name:'b', type:'T', doc:'upper bound'}], returns: 'T' },
  random:        { sig: 'long random(long max)  /  long random(long min, long max)', doc: 'Generates pseudo-random numbers.', params: [{name:'min', type:'long', doc:'(optional) lower bound, inclusive'}, {name:'max', type:'long', doc:'upper bound, exclusive'}], returns: 'long' },
  randomSeed:    { sig: 'void randomSeed(unsigned long seed)', doc: 'Initializes the pseudo-random number generator. Use analogRead on a floating pin.', params: [{name:'seed', type:'unsigned long'}] },
  abs:           { sig: 'T abs(T x)', doc: 'Calculates the absolute value of a number.', params: [{name:'x', type:'T'}], returns: 'T' },
  min:           { sig: 'T min(T a, T b)', doc: 'Returns the minimum of two numbers.', params: [{name:'a', type:'T'}, {name:'b', type:'T'}], returns: 'T' },
  max:           { sig: 'T max(T a, T b)', doc: 'Returns the maximum of two numbers.', params: [{name:'a', type:'T'}, {name:'b', type:'T'}], returns: 'T' },
  sq:            { sig: 'T sq(T x)', doc: 'Calculates the square of a number.', params: [{name:'x', type:'T'}], returns: 'T' },
  sqrt:          { sig: 'double sqrt(double x)', doc: 'Calculates the square root of a number.', params: [{name:'x', type:'double'}], returns: 'double' },
  pow:           { sig: 'double pow(double base, double exponent)', doc: 'Calculates the value of a number raised to a power.', params: [{name:'base', type:'double'}, {name:'exponent', type:'double'}], returns: 'double' },
  // I/O
  pulseIn:       { sig: 'unsigned long pulseIn(uint8_t pin, uint8_t state, unsigned long timeout)', doc: 'Reads a pulse (HIGH or LOW) on a pin.', params: [{name:'pin', type:'uint8_t'}, {name:'state', type:'uint8_t', doc:'HIGH or LOW'}, {name:'timeout', type:'unsigned long', doc:'(optional) µs timeout, default 1s'}], returns: 'unsigned long (µs)' },
  shiftOut:      { sig: 'void shiftOut(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder, uint8_t val)', doc: 'Shifts out a byte of data one bit at a time.', params: [{name:'dataPin', type:'uint8_t'}, {name:'clockPin', type:'uint8_t'}, {name:'bitOrder', type:'uint8_t', doc:'MSBFIRST or LSBFIRST'}, {name:'val', type:'uint8_t'}] },
  shiftIn:       { sig: 'uint8_t shiftIn(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder)', doc: 'Shifts in a byte of data one bit at a time.', params: [{name:'dataPin', type:'uint8_t'}, {name:'clockPin', type:'uint8_t'}, {name:'bitOrder', type:'uint8_t', doc:'MSBFIRST or LSBFIRST'}], returns: 'uint8_t' },
  // Interrupts
  attachInterrupt:     { sig: 'void attachInterrupt(uint8_t interruptNum, void(*ISR)(), int mode)', doc: 'Attaches an interrupt to a pin. Use digitalPinToInterrupt(pin) for the first arg.', params: [{name:'interruptNum', type:'uint8_t', doc:'use digitalPinToInterrupt(pin)'}, {name:'ISR', type:'void(*)()', doc:'interrupt service routine function'}, {name:'mode', type:'int', doc:'CHANGE, FALLING, RISING, LOW'}] },
  detachInterrupt:     { sig: 'void detachInterrupt(uint8_t interruptNum)', doc: 'Turns off the given interrupt.', params: [{name:'interruptNum', type:'uint8_t'}] },
  digitalPinToInterrupt: { sig: 'uint8_t digitalPinToInterrupt(uint8_t pin)', doc: 'Returns the interrupt number for the given pin.', params: [{name:'pin', type:'uint8_t'}], returns: 'uint8_t' },
  tone:          { sig: 'void tone(uint8_t pin, unsigned int frequency, unsigned long duration)', doc: 'Generates a square wave of the specified frequency on a pin.', params: [{name:'pin', type:'uint8_t'}, {name:'frequency', type:'unsigned int', doc:'Hz'}, {name:'duration', type:'unsigned long', doc:'(optional) ms, 0=forever'}] },
  noTone:        { sig: 'void noTone(uint8_t pin)', doc: 'Stops the generation of a square wave triggered by tone().', params: [{name:'pin', type:'uint8_t'}] },
}

// ─────────────────────────────────────────────────────────────────────────────
//  ARDUINO (tsuki Go-style) DATABASE
// ─────────────────────────────────────────────────────────────────────────────

const ARDUINO_GO_FUNCS: Record<string, FuncDef> = {
  PinMode:       { sig: 'func arduino.PinMode(pin Pin, mode PinMode)', doc: 'Configures the specified pin as INPUT, OUTPUT, or INPUT_PULLUP.', params: [{name:'pin', type:'Pin'}, {name:'mode', type:'PinMode', doc:'INPUT, OUTPUT, INPUT_PULLUP'}] },
  DigitalWrite:  { sig: 'func arduino.DigitalWrite(pin Pin, value bool)', doc: 'Sets a digital pin HIGH (true) or LOW (false).', params: [{name:'pin', type:'Pin'}, {name:'value', type:'bool', doc:'true = HIGH, false = LOW'}] },
  DigitalRead:   { sig: 'func arduino.DigitalRead(pin Pin) bool', doc: 'Reads a digital pin. Returns true if HIGH.', params: [{name:'pin', type:'Pin'}], returns: 'bool' },
  AnalogWrite:   { sig: 'func arduino.AnalogWrite(pin Pin, value uint8)', doc: 'PWM output on a PWM-capable pin. value: 0–255.', params: [{name:'pin', type:'Pin'}, {name:'value', type:'uint8', doc:'0–255'}] },
  AnalogRead:    { sig: 'func arduino.AnalogRead(pin Pin) uint16', doc: 'Reads analog input (A0–A5). Returns 0–1023.', params: [{name:'pin', type:'Pin'}], returns: 'uint16 (0–1023)' },
  Delay:         { sig: 'func arduino.Delay(ms uint32)', doc: 'Pauses execution for the given number of milliseconds.', params: [{name:'ms', type:'uint32', doc:'milliseconds'}] },
  DelayMicroseconds: { sig: 'func arduino.DelayMicroseconds(us uint32)', doc: 'Pauses execution for the given number of microseconds.', params: [{name:'us', type:'uint32', doc:'microseconds'}] },
  Millis:        { sig: 'func arduino.Millis() uint32', doc: 'Returns milliseconds elapsed since boot.', params: [], returns: 'uint32' },
  Micros:        { sig: 'func arduino.Micros() uint32', doc: 'Returns microseconds elapsed since boot.', params: [], returns: 'uint32' },
  Map:           { sig: 'func arduino.Map(x, inMin, inMax, outMin, outMax int32) int32', doc: 'Re-maps a value from one range to another.', params: [{name:'x', type:'int32'}, {name:'inMin', type:'int32'}, {name:'inMax', type:'int32'}, {name:'outMin', type:'int32'}, {name:'outMax', type:'int32'}], returns: 'int32' },
  Constrain:     { sig: 'func arduino.Constrain(x, min, max int32) int32', doc: 'Clamps x to [min, max].', params: [{name:'x', type:'int32'}, {name:'min', type:'int32'}, {name:'max', type:'int32'}], returns: 'int32' },
  Random:        { sig: 'func arduino.Random(min, max int32) int32', doc: 'Returns a pseudo-random integer in [min, max).', params: [{name:'min', type:'int32'}, {name:'max', type:'int32'}], returns: 'int32' },
  Tone:          { sig: 'func arduino.Tone(pin Pin, frequency uint32)', doc: 'Generates a square wave on the given pin.', params: [{name:'pin', type:'Pin'}, {name:'frequency', type:'uint32', doc:'Hz'}] },
  NoTone:        { sig: 'func arduino.NoTone(pin Pin)', doc: 'Stops any tone() on the pin.', params: [{name:'pin', type:'Pin'}] },
  // arduino.Serial sub-object (Go style)
  'Serial.Begin':    { sig: 'func arduino.Serial.Begin(baud uint32)', doc: 'Initializes serial at the given baud rate.', params: [{name:'baud', type:'uint32'}] },
  'Serial.Print':    { sig: 'func arduino.Serial.Print(v any)', doc: 'Prints value to serial.', params: [{name:'v', type:'any'}] },
  'Serial.Println':  { sig: 'func arduino.Serial.Println(v any)', doc: 'Prints value + newline to serial.', params: [{name:'v', type:'any'}] },
  'Serial.Available':{ sig: 'func arduino.Serial.Available() int', doc: 'Returns bytes available in the receive buffer.', params: [], returns: 'int' },
  'Serial.Read':     { sig: 'func arduino.Serial.Read() byte', doc: 'Returns the next byte from the serial receive buffer.', params: [], returns: 'byte' },
}

// ── Tsuki external package databases ─────────────────────────────────────────

const DHT_FUNCS: Record<string, FuncDef> = {
  New:             { sig: 'func dht.New(pin Pin, sensorType int) *DHT', doc: 'Creates a new DHT sensor instance.', params: [{name:'pin',type:'Pin'},{name:'sensorType',type:'int',doc:'dht.DHT11 or dht.DHT22'}], returns: '*DHT' },
  ReadTemperature: { sig: 'func (d *DHT) ReadTemperature() float32', doc: 'Reads temperature in Celsius. Returns NaN on error.', params: [], returns: 'float32' },
  ReadHumidity:    { sig: 'func (d *DHT) ReadHumidity() float32', doc: 'Reads relative humidity 0–100%. Returns NaN on error.', params: [], returns: 'float32' },
  Begin:           { sig: 'func (d *DHT) Begin()', doc: 'Initializes the DHT sensor.', params: [] },
}

const WS2812_FUNCS: Record<string, FuncDef> = {
  New:            { sig: 'func ws2812.New(count int, pin Pin) *Strip', doc: 'Creates a new WS2812 LED strip.', params: [{name:'count',type:'int',doc:'number of LEDs'},{name:'pin',type:'Pin'}], returns: '*Strip' },
  Begin:          { sig: 'func (s *Strip) Begin()', doc: 'Initializes the strip.', params: [] },
  Show:           { sig: 'func (s *Strip) Show()', doc: 'Writes buffered pixel data to the strip.', params: [] },
  SetPixelColor:  { sig: 'func (s *Strip) SetPixelColor(n int, color uint32)', doc: 'Sets pixel n to a packed RGB color.', params: [{name:'n',type:'int'},{name:'color',type:'uint32',doc:'packed RGB from ws2812.Color()'}] },
  Color:          { sig: 'func ws2812.Color(r, g, b uint8) uint32', doc: 'Packs red, green, blue (0–255 each) into a single uint32 color value.', params: [{name:'r',type:'uint8'},{name:'g',type:'uint8'},{name:'b',type:'uint8'}], returns: 'uint32' },
  Fill:           { sig: 'func (s *Strip) Fill(color uint32)', doc: 'Sets all pixels to color.', params: [{name:'color',type:'uint32'}] },
  NumPixels:      { sig: 'func (s *Strip) NumPixels() int', doc: 'Returns the number of LEDs in the strip.', params: [], returns: 'int' },
}

const MPU6050_FUNCS: Record<string, FuncDef> = {
  New:       { sig: 'func mpu6050.New() *MPU6050', doc: 'Creates a new MPU-6050 IMU instance (I2C address 0x68).', params: [], returns: '*MPU6050' },
  Begin:     { sig: 'func (m *MPU6050) Begin()', doc: 'Initializes the MPU-6050 over I2C.', params: [] },
  GetAccelX: { sig: 'func (m *MPU6050) GetAccelX() float32', doc: 'Returns X-axis acceleration in m/s².', params: [], returns: 'float32' },
  GetAccelY: { sig: 'func (m *MPU6050) GetAccelY() float32', doc: 'Returns Y-axis acceleration in m/s².', params: [], returns: 'float32' },
  GetAccelZ: { sig: 'func (m *MPU6050) GetAccelZ() float32', doc: 'Returns Z-axis acceleration in m/s².', params: [], returns: 'float32' },
  GetGyroX:  { sig: 'func (m *MPU6050) GetGyroX() float32', doc: 'Returns X-axis rotation rate in deg/s.', params: [], returns: 'float32' },
  GetGyroY:  { sig: 'func (m *MPU6050) GetGyroY() float32', doc: 'Returns Y-axis rotation rate in deg/s.', params: [], returns: 'float32' },
  GetGyroZ:  { sig: 'func (m *MPU6050) GetGyroZ() float32', doc: 'Returns Z-axis rotation rate in deg/s.', params: [], returns: 'float32' },
  GetTemp:   { sig: 'func (m *MPU6050) GetTemp() float32', doc: 'Returns chip temperature in Celsius.', params: [], returns: 'float32' },
}

const SERVO_FUNCS: Record<string, FuncDef> = {
  Attach:      { sig: 'func (s *Servo) Attach(pin Pin)', doc: 'Attaches the servo to the specified PWM pin.', params: [{name:'pin',type:'Pin'}] },
  Write:       { sig: 'func (s *Servo) Write(angle int)', doc: 'Sets the servo angle (0–180 degrees).', params: [{name:'angle',type:'int',doc:'0–180'}] },
  WriteMicros: { sig: 'func (s *Servo) WriteMicros(us int)', doc: 'Sets position with a pulse width in microseconds.', params: [{name:'us',type:'int',doc:'pulse width μs'}] },
  Read:        { sig: 'func (s *Servo) Read() int', doc: 'Returns the current servo angle in degrees.', params: [], returns: 'int' },
  Detach:      { sig: 'func (s *Servo) Detach()', doc: 'Detaches the servo, stopping PWM output.', params: [] },
  Attached:    { sig: 'func (s *Servo) Attached() bool', doc: 'Returns true if the servo is attached to a pin.', params: [], returns: 'bool' },
}

const TSUKI_PKG_MEMBERS: Record<string, Record<string, FuncDef>> = {
  dht:     DHT_FUNCS,
  ws2812:  WS2812_FUNCS,
  mpu6050: MPU6050_FUNCS,
  Servo:   SERVO_FUNCS,
}

// ─────────────────────────────────────────────────────────────────────────────
//  GO BUILTIN DOCS
// ─────────────────────────────────────────────────────────────────────────────

const GO_BUILTIN_DOCS: Record<string, FuncDef> = {
  make:    { sig: 'func make(t Type, size ...int) Type', doc: 'Allocates and initializes a slice, map, or channel. Unlike new, make does not return a pointer.', params: [{name:'t', type:'Type', doc:'slice, map, or chan'}, {name:'size', type:'...int', doc:'(optional) capacity for slices and channels'}], returns: 'Type' },
  len:     { sig: 'func len(v Type) int', doc: 'Returns the length of v: number of elements in a slice/array, bytes in a string, entries in a map, or messages in a channel.', params: [{name:'v', type:'Type'}], returns: 'int' },
  cap:     { sig: 'func cap(v Type) int', doc: 'Returns the capacity of v: max elements a slice can hold, or channel buffer size.', params: [{name:'v', type:'Type'}], returns: 'int' },
  append:  { sig: 'func append(slice []Type, elems ...Type) []Type', doc: 'Appends elements to the end of a slice. If the backing array is too small, append allocates a new one.', params: [{name:'slice', type:'[]Type'}, {name:'elems', type:'...Type'}], returns: '[]Type' },
  copy:    { sig: 'func copy(dst, src []Type) int', doc: 'Copies elements from source to destination. Returns the number of elements copied.', params: [{name:'dst', type:'[]Type', doc:'destination slice'}, {name:'src', type:'[]Type', doc:'source slice or string'}], returns: 'int' },
  delete:  { sig: 'func delete(m map[Type]Type, key Type)', doc: 'Removes the element with the given key from the map. No-op if key is absent.', params: [{name:'m', type:'map[K]V'}, {name:'key', type:'K'}] },
  close:   { sig: 'func close(c chan<- Type)', doc: 'Closes the channel c. No more values can be sent. Receivers will get zero values.', params: [{name:'c', type:'chan<- Type'}] },
  new:     { sig: 'func new(Type) *Type', doc: 'Allocates a zero value of the given type and returns a pointer to it.', params: [{name:'Type', type:'type'}], returns: '*Type' },
  panic:   { sig: 'func panic(v any)', doc: 'Stops the normal execution of the current goroutine. Use recover() in a deferred function to handle it.', params: [{name:'v', type:'any', doc:'error value or message'}] },
  recover: { sig: 'func recover() any', doc: 'Regains control of a panicking goroutine. Must be called directly by a deferred function.', params: [], returns: 'any' },
  print:   { sig: 'func print(args ...Type)', doc: 'Low-level print to stderr (no formatting). Prefer fmt.Print.', params: [{name:'args', type:'...Type'}] },
  println: { sig: 'func println(args ...Type)', doc: 'Low-level println to stderr (no formatting). Prefer fmt.Println.', params: [{name:'args', type:'...Type'}] },
}

// ─────────────────────────────────────────────────────────────────────────────
//  GO KEYWORD COMPLETIONS
// ─────────────────────────────────────────────────────────────────────────────

const GO_KEYWORD_COMPLETIONS: CompletionItem[] = [
  { label: 'func',      kind: 'keyword', insertText: 'func $1($2) $3 {\n\t$0\n}', insertSnippet: true, detail: 'function declaration', sortOrder: 5 },
  { label: 'if',        kind: 'keyword', insertText: 'if $1 {\n\t$0\n}', insertSnippet: true, detail: 'if statement', sortOrder: 5 },
  { label: 'for',       kind: 'keyword', insertText: 'for $1 {\n\t$0\n}', insertSnippet: true, detail: 'for loop', sortOrder: 5 },
  { label: 'range',     kind: 'keyword', insertText: 'range', detail: 'iterate over slice/map/channel', sortOrder: 6 },
  { label: 'switch',    kind: 'keyword', insertText: 'switch $1 {\ncase $2:\n\t$0\n}', insertSnippet: true, detail: 'switch statement', sortOrder: 6 },
  { label: 'select',    kind: 'keyword', insertText: 'select {\ncase $1:\n\t$0\n}', insertSnippet: true, detail: 'select on channels', sortOrder: 7 },
  { label: 'var',       kind: 'keyword', insertText: 'var $1 $2', insertSnippet: true, detail: 'variable declaration', sortOrder: 5 },
  { label: 'const',     kind: 'keyword', insertText: 'const $1 = $0', insertSnippet: true, detail: 'constant declaration', sortOrder: 5 },
  { label: 'type',      kind: 'keyword', insertText: 'type $1 struct {\n\t$0\n}', insertSnippet: true, detail: 'type declaration', sortOrder: 6 },
  { label: 'struct',    kind: 'keyword', insertText: 'struct {\n\t$0\n}', insertSnippet: true, detail: 'struct literal', sortOrder: 7 },
  { label: 'interface', kind: 'keyword', insertText: 'interface {\n\t$0\n}', insertSnippet: true, detail: 'interface literal', sortOrder: 7 },
  { label: 'map',       kind: 'keyword', insertText: 'map[$1]$2', insertSnippet: true, detail: 'map type', sortOrder: 6 },
  { label: 'chan',      kind: 'keyword', insertText: 'chan $1', insertSnippet: true, detail: 'channel type', sortOrder: 7 },
  { label: 'go',        kind: 'keyword', insertText: 'go $1', insertSnippet: true, detail: 'start goroutine', sortOrder: 6 },
  { label: 'defer',     kind: 'keyword', insertText: 'defer $1', insertSnippet: true, detail: 'defer function call', sortOrder: 6 },
  { label: 'return',    kind: 'keyword', insertText: 'return', detail: 'return from function', sortOrder: 5 },
  { label: 'import',    kind: 'keyword', insertText: 'import "$1"', insertSnippet: true, detail: 'import package', sortOrder: 5 },
  { label: 'package',   kind: 'keyword', insertText: 'package $1', insertSnippet: true, detail: 'package declaration', sortOrder: 5 },
  { label: 'break',     kind: 'keyword', insertText: 'break', sortOrder: 7 },
  { label: 'continue',  kind: 'keyword', insertText: 'continue', sortOrder: 7 },
  { label: 'fallthrough',kind: 'keyword',insertText: 'fallthrough', sortOrder: 9 },
  { label: 'goto',      kind: 'keyword', insertText: 'goto', sortOrder: 10 },
  // Types
  { label: 'string',    kind: 'type', insertText: 'string', detail: 'built-in string type', sortOrder: 4 },
  { label: 'int',       kind: 'type', insertText: 'int', detail: 'built-in integer type', sortOrder: 4 },
  { label: 'int8',      kind: 'type', insertText: 'int8', sortOrder: 8 },
  { label: 'int16',     kind: 'type', insertText: 'int16', sortOrder: 8 },
  { label: 'int32',     kind: 'type', insertText: 'int32', sortOrder: 8 },
  { label: 'int64',     kind: 'type', insertText: 'int64', sortOrder: 8 },
  { label: 'uint',      kind: 'type', insertText: 'uint', sortOrder: 8 },
  { label: 'uint8',     kind: 'type', insertText: 'uint8', sortOrder: 8 },
  { label: 'uint16',    kind: 'type', insertText: 'uint16', sortOrder: 8 },
  { label: 'uint32',    kind: 'type', insertText: 'uint32', sortOrder: 8 },
  { label: 'uint64',    kind: 'type', insertText: 'uint64', sortOrder: 8 },
  { label: 'float32',   kind: 'type', insertText: 'float32', sortOrder: 6 },
  { label: 'float64',   kind: 'type', insertText: 'float64', sortOrder: 6 },
  { label: 'bool',      kind: 'type', insertText: 'bool', sortOrder: 4 },
  { label: 'byte',      kind: 'type', insertText: 'byte', detail: 'alias for uint8', sortOrder: 6 },
  { label: 'rune',      kind: 'type', insertText: 'rune', detail: 'alias for int32 (Unicode code point)', sortOrder: 7 },
  { label: 'error',     kind: 'type', insertText: 'error', sortOrder: 4 },
  { label: 'any',       kind: 'type', insertText: 'any', detail: 'alias for interface{}', sortOrder: 6 },
  // Literals
  { label: 'true',  kind: 'constant', insertText: 'true',  sortOrder: 3 },
  { label: 'false', kind: 'constant', insertText: 'false', sortOrder: 3 },
  { label: 'nil',   kind: 'constant', insertText: 'nil',   sortOrder: 3 },
  { label: 'iota',  kind: 'constant', insertText: 'iota', detail: 'integer constant in iota blocks', sortOrder: 8 },
]

// ─────────────────────────────────────────────────────────────────────────────
//  ARDUINO C++ KEYWORD COMPLETIONS
// ─────────────────────────────────────────────────────────────────────────────

const CPP_KEYWORD_COMPLETIONS: CompletionItem[] = [
  { label: 'void',       kind: 'type',    insertText: 'void', sortOrder: 4 },
  { label: 'bool',       kind: 'type',    insertText: 'bool', sortOrder: 4 },
  { label: 'int',        kind: 'type',    insertText: 'int',  sortOrder: 4 },
  { label: 'float',      kind: 'type',    insertText: 'float', sortOrder: 4 },
  { label: 'double',     kind: 'type',    insertText: 'double', sortOrder: 4 },
  { label: 'char',       kind: 'type',    insertText: 'char', sortOrder: 5 },
  { label: 'long',       kind: 'type',    insertText: 'long', sortOrder: 5 },
  { label: 'byte',       kind: 'type',    insertText: 'byte', sortOrder: 5 },
  { label: 'String',     kind: 'type',    insertText: 'String', detail: 'Arduino String class', sortOrder: 4 },
  { label: 'uint8_t',    kind: 'type',    insertText: 'uint8_t', sortOrder: 6 },
  { label: 'uint16_t',   kind: 'type',    insertText: 'uint16_t', sortOrder: 6 },
  { label: 'uint32_t',   kind: 'type',    insertText: 'uint32_t', sortOrder: 6 },
  { label: 'int8_t',     kind: 'type',    insertText: 'int8_t', sortOrder: 6 },
  { label: 'int16_t',    kind: 'type',    insertText: 'int16_t', sortOrder: 6 },
  { label: 'int32_t',    kind: 'type',    insertText: 'int32_t', sortOrder: 6 },
  { label: 'if',         kind: 'keyword', insertText: 'if ($1) {\n\t$0\n}', insertSnippet: true, sortOrder: 5 },
  { label: 'for',        kind: 'keyword', insertText: 'for (int $1 = 0; $1 < $2; $1++) {\n\t$0\n}', insertSnippet: true, sortOrder: 5 },
  { label: 'while',      kind: 'keyword', insertText: 'while ($1) {\n\t$0\n}', insertSnippet: true, sortOrder: 5 },
  { label: 'return',     kind: 'keyword', insertText: 'return', sortOrder: 5 },
  { label: 'const',      kind: 'keyword', insertText: 'const', sortOrder: 5 },
  { label: 'static',     kind: 'keyword', insertText: 'static', sortOrder: 6 },
  { label: 'struct',     kind: 'keyword', insertText: 'struct $1 {\n\t$0\n};', insertSnippet: true, sortOrder: 7 },
  { label: 'HIGH',       kind: 'constant', insertText: 'HIGH', detail: '1 — digital HIGH', sortOrder: 3 },
  { label: 'LOW',        kind: 'constant', insertText: 'LOW', detail: '0 — digital LOW', sortOrder: 3 },
  { label: 'INPUT',      kind: 'constant', insertText: 'INPUT', detail: 'pin mode', sortOrder: 3 },
  { label: 'OUTPUT',     kind: 'constant', insertText: 'OUTPUT', detail: 'pin mode', sortOrder: 3 },
  { label: 'INPUT_PULLUP', kind: 'constant', insertText: 'INPUT_PULLUP', detail: 'pin mode with internal pull-up', sortOrder: 4 },
  { label: 'LED_BUILTIN', kind: 'constant', insertText: 'LED_BUILTIN', detail: 'pin 13 on Uno', sortOrder: 4 },
  { label: 'true',       kind: 'constant', insertText: 'true',  sortOrder: 3 },
  { label: 'false',      kind: 'constant', insertText: 'false', sortOrder: 3 },
  { label: 'NULL',       kind: 'constant', insertText: 'NULL',  sortOrder: 5 },
  { label: 'nullptr',    kind: 'constant', insertText: 'nullptr', sortOrder: 5 },
  { label: 'PI',         kind: 'constant', insertText: 'PI', detail: '3.14159...', sortOrder: 5 },
  { label: 'TWO_PI',     kind: 'constant', insertText: 'TWO_PI', sortOrder: 6 },
  { label: 'MSBFIRST',   kind: 'constant', insertText: 'MSBFIRST', sortOrder: 7 },
  { label: 'LSBFIRST',   kind: 'constant', insertText: 'LSBFIRST', sortOrder: 7 },
  { label: 'A0', kind: 'constant', insertText: 'A0', detail: 'Analog pin 0', sortOrder: 5 },
  { label: 'A1', kind: 'constant', insertText: 'A1', sortOrder: 5 },
  { label: 'A2', kind: 'constant', insertText: 'A2', sortOrder: 5 },
  { label: 'A3', kind: 'constant', insertText: 'A3', sortOrder: 5 },
  { label: 'A4', kind: 'constant', insertText: 'A4', sortOrder: 5 },
  { label: 'A5', kind: 'constant', insertText: 'A5', sortOrder: 5 },
]

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Extract the word/identifier at a given offset in the text */
export function wordAtOffset(text: string, offset: number): { word: string; start: number; end: number } {
  let start = offset
  let end   = offset
  while (start > 0 && /\w/.test(text[start - 1])) start--
  while (end < text.length && /\w/.test(text[end])) end++
  return { word: text.slice(start, end), start, end }
}

/** Get the pkg.member context before a trigger, e.g. `fmt.` → "fmt" */
function getMemberContext(text: string, offset: number): string | null {
  // look for `word.` immediately before offset
  const before = text.slice(0, offset)
  const m = before.match(/(\w+)\.$/)
  return m ? m[1] : null
}

/** Collect user-defined symbols from Go code */
function collectUserSymbolsGo(code: string): CompletionItem[] {
  const items: CompletionItem[] = []
  const seen = new Set<string>()
  const lines = code.split('\n')
  lines.forEach((raw, i) => {
    // func declarations
    const funcM = raw.match(/^func\s+(?:\([\w\s*]+\)\s+)?(\w+)\s*\(([^)]*)\)/)
    if (funcM) {
      const name = funcM[1]
      if (!seen.has(name)) {
        seen.add(name)
        items.push({ label: name, kind: 'function' as CompletionKind, insertText: name, detail: `func ${name}(${funcM[2]})`, documentation: `Defined at line ${i+1}`, sortOrder: 2 })
      }
    }
    // var / const declarations
    const varM = raw.match(/^(?:var|const)\s+(\w+)/)
    if (varM && !seen.has(varM[1])) {
      seen.add(varM[1])
      items.push({ label: varM[1], kind: (raw.trim().startsWith('const') ? 'constant' : 'variable') as CompletionKind, insertText: varM[1], documentation: `Line ${i+1}`, sortOrder: 2 })
    }
    // short decls
    const shortM = raw.match(/^\s*(\w+)\s*:=/)
    if (shortM && !seen.has(shortM[1]) && shortM[1] !== '_') {
      seen.add(shortM[1])
      items.push({ label: shortM[1], kind: 'variable' as CompletionKind, insertText: shortM[1], documentation: `Line ${i+1}`, sortOrder: 2 })
    }
  })
  return items
}

/** Collect user-defined symbols from C++/ino code */
function collectUserSymbolsCpp(code: string): CompletionItem[] {
  const items: CompletionItem[] = []
  const seen = new Set<string>()
  const lines = code.split('\n')
  lines.forEach((raw, i) => {
    const funcM = raw.match(/^(?:void|int|float|double|char|long|bool|byte|String|uint\w*|int\w*)\s*\*?\s*(\w+)\s*\(/)
    if (funcM && !seen.has(funcM[1]) && funcM[1] !== 'if' && funcM[1] !== 'for') {
      seen.add(funcM[1])
      items.push({ label: funcM[1], kind: 'function' as CompletionKind, insertText: funcM[1], detail: `function at line ${i+1}`, sortOrder: 2 })
    }
    const varM = raw.match(/^(?:int|float|double|char|long|bool|byte|String|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t)\s+(\w+)/)
    if (varM && !seen.has(varM[1])) {
      seen.add(varM[1])
      items.push({ label: varM[1], kind: 'variable' as CompletionKind, insertText: varM[1], documentation: `Line ${i+1}`, sortOrder: 2 })
    }
  })
  return items
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC API — COMPLETIONS
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
//  PYTHON KEYWORD COMPLETIONS
// ─────────────────────────────────────────────────────────────────────────────

const PYTHON_KEYWORD_COMPLETIONS: CompletionItem[] = [
  { label: 'def',      kind: 'keyword', insertText: 'def $1($2):\n    $0', insertSnippet: true, detail: 'function definition', sortOrder: 5 },
  { label: 'class',    kind: 'keyword', insertText: 'class $1:\n    $0', insertSnippet: true, detail: 'class definition', sortOrder: 5 },
  { label: 'if',       kind: 'keyword', insertText: 'if $1:\n    $0', insertSnippet: true, sortOrder: 5 },
  { label: 'elif',     kind: 'keyword', insertText: 'elif $1:\n    $0', insertSnippet: true, sortOrder: 6 },
  { label: 'else',     kind: 'keyword', insertText: 'else:\n    $0', insertSnippet: true, sortOrder: 6 },
  { label: 'for',      kind: 'keyword', insertText: 'for $1 in $2:\n    $0', insertSnippet: true, sortOrder: 5 },
  { label: 'while',    kind: 'keyword', insertText: 'while $1:\n    $0', insertSnippet: true, sortOrder: 5 },
  { label: 'return',   kind: 'keyword', insertText: 'return', sortOrder: 5 },
  { label: 'import',   kind: 'keyword', insertText: 'import $1', insertSnippet: true, sortOrder: 5 },
  { label: 'from',     kind: 'keyword', insertText: 'from $1 import $2', insertSnippet: true, sortOrder: 5 },
  { label: 'pass',     kind: 'keyword', insertText: 'pass', sortOrder: 7 },
  { label: 'break',    kind: 'keyword', insertText: 'break', sortOrder: 7 },
  { label: 'continue', kind: 'keyword', insertText: 'continue', sortOrder: 7 },
  { label: 'and',      kind: 'keyword', insertText: 'and', sortOrder: 8 },
  { label: 'or',       kind: 'keyword', insertText: 'or', sortOrder: 8 },
  { label: 'not',      kind: 'keyword', insertText: 'not', sortOrder: 8 },
  { label: 'in',       kind: 'keyword', insertText: 'in', sortOrder: 8 },
  { label: 'is',       kind: 'keyword', insertText: 'is', sortOrder: 8 },
  { label: 'lambda',   kind: 'keyword', insertText: 'lambda $1: $0', insertSnippet: true, sortOrder: 7 },
  { label: 'try',      kind: 'keyword', insertText: 'try:\n    $0\nexcept Exception as e:\n    pass', insertSnippet: true, sortOrder: 6 },
  { label: 'except',   kind: 'keyword', insertText: 'except $1:\n    $0', insertSnippet: true, sortOrder: 6 },
  { label: 'finally',  kind: 'keyword', insertText: 'finally:\n    $0', insertSnippet: true, sortOrder: 7 },
  { label: 'with',     kind: 'keyword', insertText: 'with $1 as $2:\n    $0', insertSnippet: true, sortOrder: 6 },
  { label: 'global',   kind: 'keyword', insertText: 'global $1', insertSnippet: true, sortOrder: 8 },
  { label: 'nonlocal', kind: 'keyword', insertText: 'nonlocal $1', insertSnippet: true, sortOrder: 9 },
  { label: 'yield',    kind: 'keyword', insertText: 'yield $1', insertSnippet: true, sortOrder: 7 },
  { label: 'assert',   kind: 'keyword', insertText: 'assert $1', insertSnippet: true, sortOrder: 8 },
  { label: 'del',      kind: 'keyword', insertText: 'del $1', insertSnippet: true, sortOrder: 9 },
  { label: 'raise',    kind: 'keyword', insertText: 'raise $1', insertSnippet: true, sortOrder: 7 },
  // types
  { label: 'int',   kind: 'type', insertText: 'int',   sortOrder: 4 },
  { label: 'float', kind: 'type', insertText: 'float', sortOrder: 4 },
  { label: 'str',   kind: 'type', insertText: 'str',   sortOrder: 4 },
  { label: 'bool',  kind: 'type', insertText: 'bool',  sortOrder: 4 },
  { label: 'list',  kind: 'type', insertText: 'list',  sortOrder: 5 },
  { label: 'dict',  kind: 'type', insertText: 'dict',  sortOrder: 5 },
  { label: 'tuple', kind: 'type', insertText: 'tuple', sortOrder: 6 },
  { label: 'set',   kind: 'type', insertText: 'set',   sortOrder: 6 },
  { label: 'None',  kind: 'constant', insertText: 'None',  sortOrder: 3 },
  { label: 'True',  kind: 'constant', insertText: 'True',  sortOrder: 3 },
  { label: 'False', kind: 'constant', insertText: 'False', sortOrder: 3 },
  // builtins
  { label: 'print',     kind: 'function', insertText: 'print($0)', insertSnippet: true, detail: 'print(value, ..., sep=\'\', end=\'\\n\')', documentation: 'Prints values to stdout.', sortOrder: 2 },
  { label: 'len',       kind: 'function', insertText: 'len($1)', insertSnippet: true, detail: 'len(obj) → int', sortOrder: 2 },
  { label: 'range',     kind: 'function', insertText: 'range($1)', insertSnippet: true, detail: 'range(stop) | range(start, stop[, step])', sortOrder: 2 },
  { label: 'enumerate', kind: 'function', insertText: 'enumerate($1)', insertSnippet: true, detail: 'enumerate(iterable, start=0)', sortOrder: 3 },
  { label: 'zip',       kind: 'function', insertText: 'zip($1)', insertSnippet: true, detail: 'zip(*iterables)', sortOrder: 3 },
  { label: 'map',       kind: 'function', insertText: 'map($1, $2)', insertSnippet: true, detail: 'map(func, iterable)', sortOrder: 3 },
  { label: 'filter',    kind: 'function', insertText: 'filter($1, $2)', insertSnippet: true, detail: 'filter(func, iterable)', sortOrder: 3 },
  { label: 'sorted',    kind: 'function', insertText: 'sorted($1)', insertSnippet: true, detail: 'sorted(iterable, key=None, reverse=False)', sortOrder: 3 },
  { label: 'reversed',  kind: 'function', insertText: 'reversed($1)', insertSnippet: true, detail: 'reversed(sequence)', sortOrder: 4 },
  { label: 'isinstance',kind: 'function', insertText: 'isinstance($1, $2)', insertSnippet: true, detail: 'isinstance(obj, classinfo) → bool', sortOrder: 3 },
  { label: 'type',      kind: 'function', insertText: 'type($1)', insertSnippet: true, detail: 'type(obj) → type', sortOrder: 3 },
  { label: 'str',       kind: 'function', insertText: 'str($1)', insertSnippet: true, detail: 'str(obj) → str', sortOrder: 3 },
  { label: 'int',       kind: 'function', insertText: 'int($1)', insertSnippet: true, detail: 'int(x) → int', sortOrder: 3 },
  { label: 'float',     kind: 'function', insertText: 'float($1)', insertSnippet: true, detail: 'float(x) → float', sortOrder: 3 },
  { label: 'abs',       kind: 'function', insertText: 'abs($1)', insertSnippet: true, detail: 'abs(x)', sortOrder: 3 },
  { label: 'min',       kind: 'function', insertText: 'min($1)', insertSnippet: true, detail: 'min(iterable)', sortOrder: 3 },
  { label: 'max',       kind: 'function', insertText: 'max($1)', insertSnippet: true, detail: 'max(iterable)', sortOrder: 3 },
  { label: 'sum',       kind: 'function', insertText: 'sum($1)', insertSnippet: true, detail: 'sum(iterable)', sortOrder: 3 },
  { label: 'open',      kind: 'function', insertText: 'open($1, $2)', insertSnippet: true, detail: 'open(file, mode=\'r\')', sortOrder: 4 },
]

/** Python package members (snake_case tsuki bindings) */

// ─────────────────────────────────────────────────────────────────────────────
//  PYTHON PACKAGE MEMBERS  (tsuki snake_case bindings)
// ─────────────────────────────────────────────────────────────────────────────

interface PyMember { label: string; detail: string; doc: string; kind?: CompletionKind }

const PYTHON_PKG_MEMBERS: Record<string, PyMember[]> = {

  // ── arduino ──────────────────────────────────────────────────────────────
  arduino: [
    // Functions
    { label: 'pin_mode',             detail: 'pin_mode(pin: int, mode: int)',                     doc: 'Configures pin direction. mode is arduino.INPUT, OUTPUT, or INPUT_PULLUP.' },
    { label: 'digital_write',        detail: 'digital_write(pin: int, value: bool)',               doc: 'Sets a digital pin HIGH (True) or LOW (False).' },
    { label: 'digital_read',         detail: 'digital_read(pin: int) → bool',                     doc: 'Reads the digital state of a pin. Returns True if HIGH.' },
    { label: 'analog_write',         detail: 'analog_write(pin: int, value: int)',                 doc: 'PWM output on a PWM-capable pin. value: 0–255.' },
    { label: 'analog_read',          detail: 'analog_read(pin: int) → int',                       doc: 'Reads analog input (A0–A5). Returns 0–1023.' },
    { label: 'analog_reference',     detail: 'analog_reference(mode: int)',                       doc: 'Configures the reference voltage for analog input.' },
    { label: 'delay',                detail: 'delay(ms: int)',                                    doc: 'Pauses execution for the given number of milliseconds.' },
    { label: 'delay_microseconds',   detail: 'delay_microseconds(us: int)',                       doc: 'Pauses execution for the given number of microseconds.' },
    { label: 'millis',               detail: 'millis() → int',                                   doc: 'Returns the number of milliseconds since the board started running.' },
    { label: 'micros',               detail: 'micros() → int',                                   doc: 'Returns the number of microseconds since the board started running.' },
    { label: 'pulse_in',             detail: 'pulse_in(pin: int, value: bool, timeout: int) → int', doc: 'Reads a pulse (HIGH or LOW) on a pin, returning its duration in microseconds.' },
    { label: 'shift_in',             detail: 'shift_in(data_pin: int, clock_pin: int, bit_order: int) → int', doc: 'Shifts in a byte of data one bit at a time.' },
    { label: 'shift_out',            detail: 'shift_out(data_pin: int, clock_pin: int, bit_order: int, val: int)', doc: 'Shifts out a byte of data one bit at a time.' },
    { label: 'map',                  detail: 'map(x: int, in_min: int, in_max: int, out_min: int, out_max: int) → int', doc: 'Re-maps a number from one range to another.' },
    { label: 'constrain',            detail: 'constrain(x: int, min: int, max: int) → int',       doc: 'Constrains a number to be within a range.' },
    { label: 'random',               detail: 'random(min: int, max: int) → int',                  doc: 'Returns a pseudo-random number in [min, max).' },
    { label: 'random_seed',          detail: 'random_seed(seed: int)',                            doc: 'Initializes the pseudo-random number generator.' },
    { label: 'tone',                 detail: 'tone(pin: int, frequency: int, duration?: int)',     doc: 'Generates a square wave of the specified frequency on a pin.' },
    { label: 'no_tone',              detail: 'no_tone(pin: int)',                                 doc: 'Stops the generation of a square wave triggered by tone().' },
    { label: 'interrupts',           detail: 'interrupts()',                                      doc: 'Re-enables interrupts (after they\'ve been disabled by noInterrupts()).' },
    { label: 'no_interrupts',        detail: 'no_interrupts()',                                   doc: 'Disables interrupts (preventing them from happening while running critical code).' },
    { label: 'attach_interrupt',     detail: 'attach_interrupt(pin: int, isr: callable, mode: int)', doc: 'Specifies a named interrupt service routine (ISR) to call when an interrupt occurs.' },
    { label: 'detach_interrupt',     detail: 'detach_interrupt(pin: int)',                        doc: 'Turns off the given interrupt.' },
    // Pin mode constants
    { label: 'INPUT',                detail: 'const INPUT = 0',   doc: 'Configures the specified pin to behave as an input.' },
    { label: 'OUTPUT',               detail: 'const OUTPUT = 1',  doc: 'Configures the specified pin to behave as an output.' },
    { label: 'INPUT_PULLUP',         detail: 'const INPUT_PULLUP = 2', doc: 'Configures pin as input with internal pull-up resistor enabled.' },
    // Digital level constants
    { label: 'HIGH',                 detail: 'const HIGH = 1',    doc: 'Represents a high state (3.3V or 5V depending on board).' },
    { label: 'LOW',                  detail: 'const LOW = 0',     doc: 'Represents a low state (0V).' },
    // Pin aliases
    { label: 'LED_BUILTIN',          detail: 'const LED_BUILTIN = 13',  doc: 'The pin number of the built-in LED. Varies by board.' },
    { label: 'A0',                   detail: 'const A0',          doc: 'Analog pin A0.' },
    { label: 'A1',                   detail: 'const A1',          doc: 'Analog pin A1.' },
    { label: 'A2',                   detail: 'const A2',          doc: 'Analog pin A2.' },
    { label: 'A3',                   detail: 'const A3',          doc: 'Analog pin A3.' },
    { label: 'A4',                   detail: 'const A4',          doc: 'Analog pin A4 (SDA on some boards).' },
    { label: 'A5',                   detail: 'const A5',          doc: 'Analog pin A5 (SCL on some boards).' },
    // Bit order
    { label: 'MSBFIRST',             detail: 'const MSBFIRST = 1', doc: 'Most significant bit first.' },
    { label: 'LSBFIRST',             detail: 'const LSBFIRST = 0', doc: 'Least significant bit first.' },
    // Interrupt modes
    { label: 'RISING',               detail: 'const RISING',      doc: 'Trigger interrupt on rising edge.' },
    { label: 'FALLING',              detail: 'const FALLING',     doc: 'Trigger interrupt on falling edge.' },
    { label: 'CHANGE',               detail: 'const CHANGE',      doc: 'Trigger interrupt on any level change.' },
    { label: 'LOW_LEVEL',            detail: 'const LOW_LEVEL',   doc: 'Trigger interrupt when pin is low.' },
    // Sub-objects
    { label: 'Serial',               detail: 'Serial: SerialPort',  doc: 'The main hardware Serial port object.',        kind: 'variable' },
    { label: 'Serial1',              detail: 'Serial1: SerialPort', doc: 'Second hardware Serial port (if available).',  kind: 'variable' },
    { label: 'Wire',                 detail: 'Wire: I2CPort',       doc: 'The I2C (Wire) interface object.',             kind: 'variable' },
    { label: 'SPI',                  detail: 'SPI: SPIPort',        doc: 'The SPI interface object.',                   kind: 'variable' },
    // Camel-case aliases (for compatibility with Go-style code)
    { label: 'pinMode',              detail: 'pinMode(pin, mode)',           doc: 'Alias for pin_mode.' },
    { label: 'digitalWrite',         detail: 'digitalWrite(pin, value)',     doc: 'Alias for digital_write.' },
    { label: 'digitalRead',          detail: 'digitalRead(pin) → bool',     doc: 'Alias for digital_read.' },
    { label: 'analogRead',           detail: 'analogRead(pin) → int',       doc: 'Alias for analog_read.' },
    { label: 'analogWrite',          detail: 'analogWrite(pin, value)',      doc: 'Alias for analog_write.' },
  ],

  // ── arduino.Serial ───────────────────────────────────────────────────────
  'arduino.Serial': [
    { label: 'begin',           detail: 'begin(baud: int)',                              doc: 'Sets the data rate in bits per second for serial communication.' },
    { label: 'end',             detail: 'end()',                                         doc: 'Disables serial communication.' },
    { label: 'available',       detail: 'available() → int',                            doc: 'Gets the number of bytes available for reading from the serial port.' },
    { label: 'available_for_write', detail: 'available_for_write() → int',              doc: 'Gets the number of bytes available for writing in the serial buffer.' },
    { label: 'read',            detail: 'read() → int',                                 doc: 'Reads the next byte of incoming serial data. Returns -1 if none.' },
    { label: 'peek',            detail: 'peek() → int',                                 doc: 'Returns the next byte without removing it from the buffer. Returns -1 if none.' },
    { label: 'print',           detail: 'print(val)',                                   doc: 'Prints data to the serial port as human-readable text.' },
    { label: 'println',         detail: 'println(val)',                                 doc: 'Prints data followed by a carriage return and newline.' },
    { label: 'write',           detail: 'write(val: int | bytes)',                      doc: 'Writes binary data to the serial port. Returns number of bytes written.' },
    { label: 'flush',           detail: 'flush()',                                      doc: 'Waits for the transmission of outgoing serial data to complete.' },
    { label: 'read_string',     detail: 'read_string() → str',                         doc: 'Reads characters from the serial buffer into a string until a timeout.' },
    { label: 'read_string_until', detail: 'read_string_until(terminator: str) → str',  doc: 'Reads characters until the given terminator character is found.' },
    { label: 'read_bytes',      detail: 'read_bytes(buf: list, length: int) → int',    doc: 'Reads characters from the buffer into an array.' },
    { label: 'read_bytes_until', detail: 'read_bytes_until(char, buf, length) → int',  doc: 'Reads characters until a specific terminator.' },
    { label: 'parse_int',       detail: 'parse_int() → int',                           doc: 'Looks for the next valid integer in the incoming serial stream.' },
    { label: 'parse_float',     detail: 'parse_float() → float',                       doc: 'Returns the first valid floating-point number from the serial buffer.' },
    { label: 'set_timeout',     detail: 'set_timeout(ms: int)',                         doc: 'Sets the maximum milliseconds to wait for serial data.' },
    { label: 'find',            detail: 'find(target: str) → bool',                    doc: 'Reads data until the target string is found.' },
  ],

  // ── arduino.Wire ─────────────────────────────────────────────────────────
  'arduino.Wire': [
    { label: 'begin',                detail: 'begin()',                                  doc: 'Initiate the Wire library and join the I2C bus as a master.' },
    { label: 'begin_transmission',   detail: 'begin_transmission(address: int)',         doc: 'Begin a transmission to an I2C peripheral device at the given address.' },
    { label: 'end_transmission',     detail: 'end_transmission(stop: bool = True) → int', doc: 'Ends a transmission and optionally sends a stop message.' },
    { label: 'write',                detail: 'write(val: int | list)',                   doc: 'Writes data from a master to a peripheral or queues bytes for sending.' },
    { label: 'request_from',         detail: 'request_from(address: int, quantity: int) → int', doc: 'Requests bytes from a peripheral device.' },
    { label: 'available',            detail: 'available() → int',                       doc: 'Returns the number of bytes available for retrieval with read().' },
    { label: 'read',                 detail: 'read() → int',                            doc: 'Reads a byte transmitted from a peripheral device.' },
    { label: 'set_clock',            detail: 'set_clock(freq: int)',                    doc: 'Modifies the clock frequency for I2C communication (default 100000).' },
    { label: 'on_receive',           detail: 'on_receive(handler)',                     doc: 'Registers a function to be called when a peripheral receives data.' },
    { label: 'on_request',           detail: 'on_request(handler)',                     doc: 'Registers a function to be called when the master requests data.' },
  ],

  // ── arduino.SPI ──────────────────────────────────────────────────────────
  'arduino.SPI': [
    { label: 'begin',                detail: 'begin()',                                  doc: 'Initialize the SPI bus.' },
    { label: 'end',                  detail: 'end()',                                    doc: 'Disable the SPI bus.' },
    { label: 'begin_transaction',    detail: 'begin_transaction(settings)',              doc: 'Initializes the SPI bus using the defined SPISettings.' },
    { label: 'end_transaction',      detail: 'end_transaction()',                        doc: 'Stop using the SPI bus after a transaction.' },
    { label: 'transfer',             detail: 'transfer(val: int) → int',                doc: 'Transfers one byte over the SPI bus (send and receive).' },
    { label: 'set_bit_order',        detail: 'set_bit_order(order: int)',               doc: 'Sets the order of the bits shifted out. MSBFIRST or LSBFIRST.' },
    { label: 'set_clock_divider',    detail: 'set_clock_divider(div: int)',              doc: 'Sets the SPI clock divider relative to the system clock.' },
    { label: 'set_data_mode',        detail: 'set_data_mode(mode: int)',                doc: 'Sets the SPI data mode (clock polarity/phase).' },
  ],

  // ── time ─────────────────────────────────────────────────────────────────
  time: [
    { label: 'sleep',           detail: 'sleep(ms: int)',              doc: 'Pause execution for ms milliseconds. Maps to arduino.delay().' },
    { label: 'sleep_us',        detail: 'sleep_us(us: int)',           doc: 'Pause for microseconds. Maps to arduino.delayMicroseconds().' },
    { label: 'ticks',           detail: 'ticks() → int',              doc: 'Returns current time in milliseconds since boot. Maps to millis().' },
    { label: 'ticks_us',        detail: 'ticks_us() → int',           doc: 'Returns current time in microseconds. Maps to micros().' },
    { label: 'Millisecond',     detail: 'const Millisecond = 1',      doc: 'Time unit: 1 millisecond.' },
    { label: 'Second',          detail: 'const Second = 1000',        doc: 'Time unit: 1 second = 1000 ms.' },
    { label: 'Minute',          detail: 'const Minute = 60000',       doc: 'Time unit: 1 minute = 60 000 ms.' },
    { label: 'Hour',            detail: 'const Hour = 3600000',       doc: 'Time unit: 1 hour = 3 600 000 ms.' },
  ],

  // ── fmt (Python print/format helpers) ────────────────────────────────────
  fmt: [
    { label: 'println',  detail: 'println(*args)',              doc: 'Print args separated by spaces with newline. Maps to Serial.println().' },
    { label: 'print',    detail: 'print(*args)',                doc: 'Print args without newline. Maps to Serial.print().' },
    { label: 'sprintf',  detail: 'sprintf(format: str, *args) → str', doc: 'Format a string like C sprintf.' },
  ],

  // ── math ──────────────────────────────────────────────────────────────────
  math: [
    { label: 'sqrt',     detail: 'sqrt(x: float) → float',    doc: 'Returns the square root of x.' },
    { label: 'pow',      detail: 'pow(x: float, y: float) → float', doc: 'Returns x raised to the power y.' },
    { label: 'abs',      detail: 'abs(x: float) → float',     doc: 'Returns the absolute value of x.' },
    { label: 'floor',    detail: 'floor(x: float) → float',   doc: 'Returns the largest integer ≤ x.' },
    { label: 'ceil',     detail: 'ceil(x: float) → float',    doc: 'Returns the smallest integer ≥ x.' },
    { label: 'round',    detail: 'round(x: float) → float',   doc: 'Returns the nearest integer.' },
    { label: 'max',      detail: 'max(a, b) → float',         doc: 'Returns the larger of a and b.' },
    { label: 'min',      detail: 'min(a, b) → float',         doc: 'Returns the smaller of a and b.' },
    { label: 'sin',      detail: 'sin(x: float) → float',     doc: 'Sine of x (radians).' },
    { label: 'cos',      detail: 'cos(x: float) → float',     doc: 'Cosine of x (radians).' },
    { label: 'tan',      detail: 'tan(x: float) → float',     doc: 'Tangent of x (radians).' },
    { label: 'log',      detail: 'log(x: float) → float',     doc: 'Natural logarithm of x.' },
    { label: 'log10',    detail: 'log10(x: float) → float',   doc: 'Base-10 logarithm of x.' },
    { label: 'exp',      detail: 'exp(x: float) → float',     doc: 'Returns e raised to the power x.' },
    { label: 'PI',       detail: 'const PI = 3.14159…',       doc: 'The mathematical constant π.' },
    { label: 'E',        detail: 'const E = 2.71828…',        doc: 'Euler\'s number.' },
    { label: 'INF',      detail: 'const INF',                 doc: 'Positive infinity.' },
  ],

  // ── dht ──────────────────────────────────────────────────────────────────
  dht: [
    { label: 'new',               detail: 'new(pin: int, sensor_type: int) → DHT', doc: 'Create a new DHT sensor instance. sensor_type is dht.DHT11 or dht.DHT22.' },
    { label: 'DHT11',             detail: 'const DHT11 = 11',     doc: 'DHT11 sensor type constant.' },
    { label: 'DHT22',             detail: 'const DHT22 = 22',     doc: 'DHT22 / AM2302 sensor type constant.' },
    { label: 'begin',             detail: 'begin()',               doc: 'Initialize the DHT sensor. Call in setup().' },
    { label: 'read_temperature',  detail: 'read_temperature(fahrenheit: bool = False) → float', doc: 'Read temperature. Returns Celsius by default, or Fahrenheit if True.' },
    { label: 'read_humidity',     detail: 'read_humidity() → float', doc: 'Read relative humidity as a percentage (0–100%).' },
    { label: 'compute_heat_index',detail: 'compute_heat_index(temp: float, hum: float, is_fahrenheit: bool = False) → float', doc: 'Computes the heat index given temperature and humidity.' },
    { label: 'read',              detail: 'read(force: bool = False) → bool', doc: 'Read the sensor. Returns True on success.' },
  ],

  // ── ws2812 ───────────────────────────────────────────────────────────────
  ws2812: [
    { label: 'new',              detail: 'new(count: int, pin: int, type: int = 0) → Strip', doc: 'Create a WS2812 LED strip. count = number of LEDs, pin = data pin.' },
    { label: 'begin',           detail: 'begin()',                  doc: 'Initialize the strip. Call in setup().' },
    { label: 'show',            detail: 'show()',                   doc: 'Push the pixel buffer to the strip.' },
    { label: 'clear',           detail: 'clear()',                  doc: 'Set all pixels to off (0,0,0).' },
    { label: 'set_pixel_color', detail: 'set_pixel_color(n: int, color: int)', doc: 'Set pixel n to a packed 32-bit RGB color from ws2812.color().' },
    { label: 'get_pixel_color', detail: 'get_pixel_color(n: int) → int', doc: 'Returns the packed color of pixel n.' },
    { label: 'color',           detail: 'color(r: int, g: int, b: int, w: int = 0) → int', doc: 'Pack r, g, b (and optional white) into a 32-bit color value.' },
    { label: 'color_hsv',       detail: 'color_hsv(hue: int, sat: int, val: int) → int', doc: 'Create a color from HSV values (hue 0–65535, sat/val 0–255).' },
    { label: 'fill',            detail: 'fill(color: int, first: int = 0, count: int = 0)', doc: 'Set a range of pixels to color.' },
    { label: 'num_pixels',      detail: 'num_pixels() → int',      doc: 'Returns the number of LEDs in the strip.' },
    { label: 'set_brightness',  detail: 'set_brightness(brightness: int)', doc: 'Set overall strip brightness (0=min, 255=max).' },
    { label: 'get_brightness',  detail: 'get_brightness() → int',  doc: 'Returns the current brightness level.' },
    { label: 'rainbow',         detail: 'rainbow(first_hue: int = 0, reps: int = 1)', doc: 'Fill the strip with a rainbow pattern.' },
  ],

  // ── mpu6050 ───────────────────────────────────────────────────────────────
  mpu6050: [
    { label: 'new',          detail: 'new(address: int = 0x68) → MPU6050', doc: 'Create MPU-6050 IMU instance. Default I2C address is 0x68.' },
    { label: 'begin',        detail: 'begin() → bool',                     doc: 'Initialize the MPU-6050. Returns True if found on I2C bus.' },
    { label: 'get_accel_x',  detail: 'get_accel_x() → float',             doc: 'X-axis acceleration in m/s².' },
    { label: 'get_accel_y',  detail: 'get_accel_y() → float',             doc: 'Y-axis acceleration in m/s².' },
    { label: 'get_accel_z',  detail: 'get_accel_z() → float',             doc: 'Z-axis acceleration in m/s².' },
    { label: 'get_gyro_x',   detail: 'get_gyro_x() → float',             doc: 'X-axis rotation rate in degrees/s.' },
    { label: 'get_gyro_y',   detail: 'get_gyro_y() → float',             doc: 'Y-axis rotation rate in degrees/s.' },
    { label: 'get_gyro_z',   detail: 'get_gyro_z() → float',             doc: 'Z-axis rotation rate in degrees/s.' },
    { label: 'get_temp',     detail: 'get_temp() → float',               doc: 'Chip temperature in Celsius.' },
    { label: 'set_accel_range', detail: 'set_accel_range(range: int)',    doc: 'Set accelerometer range (MPU6050_RANGE_2_G, 4_G, 8_G, 16_G).' },
    { label: 'set_gyro_range',  detail: 'set_gyro_range(range: int)',     doc: 'Set gyroscope range (MPU6050_RANGE_250_DEG, 500, 1000, 2000).' },
    { label: 'set_filter_bandwidth', detail: 'set_filter_bandwidth(bandwidth: int)', doc: 'Set the digital low-pass filter bandwidth.' },
  ],

  // ── servo ────────────────────────────────────────────────────────────────
  servo: [
    { label: 'new',          detail: 'new() → Servo',                  doc: 'Create a new Servo instance.' },
    { label: 'attach',       detail: 'attach(pin: int, min: int = 544, max: int = 2400) → int', doc: 'Attaches the servo motor to a pin.' },
    { label: 'detach',       detail: 'detach()',                        doc: 'Detaches the servo motor from its pin.' },
    { label: 'write',        detail: 'write(angle: int)',               doc: 'Sets the servo angle in degrees (0–180).' },
    { label: 'write_microseconds', detail: 'write_microseconds(us: int)', doc: 'Writes a value in microseconds as the pulse width.' },
    { label: 'read',         detail: 'read() → int',                   doc: 'Returns the current angle written to the servo (0–180°).' },
    { label: 'read_microseconds', detail: 'read_microseconds() → int', doc: 'Returns the current pulse width in microseconds.' },
    { label: 'attached',     detail: 'attached() → bool',              doc: 'Returns True if the servo is currently attached to a pin.' },
  ],

  // ── irremote ──────────────────────────────────────────────────────────────
  irremote: [
    { label: 'new_receiver', detail: 'new_receiver(pin: int) → IRReceiver', doc: 'Create an IR receiver on the specified pin.' },
    { label: 'new_sender',   detail: 'new_sender(pin: int) → IRSender',    doc: 'Create an IR transmitter on the specified pin.' },
    { label: 'begin',        detail: 'begin()',                             doc: 'Initialize the IR receiver/sender.' },
    { label: 'decode',       detail: 'decode() → IRData',                  doc: 'Decodes the received IR signal. Returns IRData or None.' },
    { label: 'resume',       detail: 'resume()',                            doc: 'Enables receiver for the next value. Must call after decode().' },
    { label: 'send_nec',     detail: 'send_nec(address: int, command: int, repeats: int = 0)', doc: 'Send a NEC IR command.' },
    { label: 'send_sony',    detail: 'send_sony(data: int, bits: int = 12)', doc: 'Send a Sony IR command.' },
  ],

  // ── u8g2 ──────────────────────────────────────────────────────────────────
  u8g2: [
    { label: 'new',           detail: 'new(rotation: int, cs: int, dc: int, reset: int = -1) → U8G2', doc: 'Create a U8G2 display driver instance.' },
    { label: 'begin',         detail: 'begin()',                             doc: 'Initialize the display.' },
    { label: 'clear_buffer',  detail: 'clear_buffer()',                     doc: 'Clear the internal memory.' },
    { label: 'send_buffer',   detail: 'send_buffer()',                      doc: 'Transfer the memory content to the display.' },
    { label: 'clear_display', detail: 'clear_display()',                    doc: 'Clear the display and the memory.' },
    { label: 'set_font',      detail: 'set_font(font)',                     doc: 'Set a font for the following string drawings.' },
    { label: 'draw_str',      detail: 'draw_str(x: int, y: int, s: str)',   doc: 'Draw a string at the given position.' },
    { label: 'draw_int',      detail: 'draw_int(x: int, y: int, n: int)',   doc: 'Draw an integer value as a string.' },
    { label: 'draw_line',     detail: 'draw_line(x1: int, y1: int, x2: int, y2: int)', doc: 'Draw a line between two points.' },
    { label: 'draw_box',      detail: 'draw_box(x: int, y: int, w: int, h: int)', doc: 'Draw a filled box.' },
    { label: 'draw_frame',    detail: 'draw_frame(x: int, y: int, w: int, h: int)', doc: 'Draw a frame (unfilled box).' },
    { label: 'draw_circle',   detail: 'draw_circle(x0: int, y0: int, rad: int)', doc: 'Draw a circle.' },
    { label: 'draw_pixel',    detail: 'draw_pixel(x: int, y: int)',         doc: 'Draw a single pixel.' },
    { label: 'get_display_width',  detail: 'get_display_width() → int',    doc: 'Returns the display width in pixels.' },
    { label: 'get_display_height', detail: 'get_display_height() → int',   doc: 'Returns the display height in pixels.' },
    { label: 'set_draw_color',     detail: 'set_draw_color(color: int)',    doc: 'Set draw color (0=clear, 1=set, 2=XOR).' },
    { label: 'R0',            detail: 'const R0',   doc: 'No rotation (landscape).' },
    { label: 'R1',            detail: 'const R1',   doc: '90° clockwise rotation.' },
    { label: 'R2',            detail: 'const R2',   doc: '180° rotation.' },
    { label: 'R3',            detail: 'const R3',   doc: '270° clockwise rotation.' },
  ],

  // ── bmp280 ────────────────────────────────────────────────────────────────
  bmp280: [
    { label: 'new',              detail: 'new() → BMP280',                     doc: 'Create a BMP280 pressure/temperature sensor instance.' },
    { label: 'begin',            detail: 'begin(address: int = 0x76) → bool',  doc: 'Initialize. Returns True if sensor found on I2C bus.' },
    { label: 'read_temperature', detail: 'read_temperature() → float',         doc: 'Read temperature in Celsius.' },
    { label: 'read_pressure',    detail: 'read_pressure() → float',            doc: 'Read atmospheric pressure in Pascals.' },
    { label: 'read_altitude',    detail: 'read_altitude(sea_level_pa: float = 101325.0) → float', doc: 'Calculates altitude in meters from current pressure.' },
    { label: 'set_sampling',     detail: 'set_sampling(mode, temp_sampling, pressure_sampling, filter, standby_duration)', doc: 'Set sensor sampling/filter settings.' },
    { label: 'take_forced_measurement', detail: 'take_forced_measurement()', doc: 'Take a forced measurement when in FORCED mode.' },
  ],

  // ── stepper ───────────────────────────────────────────────────────────────
  stepper: [
    { label: 'new',           detail: 'new(steps: int, pin1: int, pin2: int, pin3: int = -1, pin4: int = -1) → Stepper', doc: 'Create a stepper motor instance.' },
    { label: 'set_speed',     detail: 'set_speed(rpm: float)',           doc: 'Set the motor speed in rotations per minute.' },
    { label: 'step',          detail: 'step(steps: int)',                doc: 'Move the motor steps steps. Positive = CW, negative = CCW.' },
    { label: 'version',       detail: 'version() → int',                doc: 'Returns the version of the stepper library.' },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
//  Python helpers
// ─────────────────────────────────────────────────────────────────────────────

function inferPyType(expr: string): string | null {
  const e = expr.trim()
  if (!e) return null
  if (/^-?\d+$/.test(e))                    return 'int'
  if (/^-?\d+\.\d*$/.test(e))              return 'float'
  if (/^[\"']/.test(e))                     return 'str'
  if (e === 'True' || e === 'False')         return 'bool'
  if (e === 'None')                         return 'None'
  if (/^\[/.test(e))                        return 'list'
  if (/^\{/.test(e))                        return 'dict'
  if (e.startsWith('arduino.analog_read(')) return 'int'
  if (e.startsWith('arduino.digital_read('))return 'bool'
  if (e.startsWith('arduino.millis('))      return 'int'
  if (e.startsWith('arduino.micros('))      return 'int'
  if (e.includes('read_temperature('))      return 'float'
  if (e.includes('read_humidity('))         return 'float'
  if (e.startsWith('int('))                 return 'int'
  if (e.startsWith('float('))               return 'float'
  if (e.startsWith('str('))                 return 'str'
  if (e.startsWith('len('))                 return 'int'
  if (e.startsWith('range('))               return 'range'
  if (e.startsWith('list('))                return 'list'
  if (e.startsWith('dict('))                return 'dict'
  return null
}

const PY_RESERVED = new Set([
  'if','elif','else','for','while','return','import','from','class','def',
  'with','as','try','except','finally','lambda','pass','break','continue',
  'raise','del','global','nonlocal','yield','assert','and','or','not','in',
  'is','True','False','None','print','len','range','type','int','float','str',
])

/** Collect user-defined symbols from Python source */
function collectUserSymbolsPy(code: string): CompletionItem[] {
  const items: CompletionItem[] = []
  const seen  = new Set<string>()

  code.split('\n').forEach((raw, i) => {
    const stripped = raw.trimStart()
    const indent   = raw.length - stripped.length

    // def name(params) -> ret:
    const funcM = stripped.match(/^def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*(\w[\w\[\], ]*))?/)
    if (funcM && !seen.has(funcM[1])) {
      seen.add(funcM[1])
      const ret = funcM[3] ? ` -> ${funcM[3].trim()}` : ''
      items.push({ label: funcM[1], kind: 'function' as CompletionKind, insertText: funcM[1],
        detail: `def ${funcM[1]}(${funcM[2]})${ret}`,
        documentation: `Defined at line ${i+1}`, sortOrder: 2 })
    }

    // class name(base?):
    const clsM = stripped.match(/^class\s+(\w+)(?:\(([^)]*)\))?/)
    if (clsM && !seen.has(clsM[1])) {
      seen.add(clsM[1])
      items.push({ label: clsM[1], kind: 'type' as CompletionKind, insertText: clsM[1],
        detail: `class ${clsM[1]}${clsM[2] ? `(${clsM[2]})` : ''}`,
        documentation: `Line ${i+1}`, sortOrder: 2 })
    }

    // name: Type = value
    const annM = indent === 0 ? stripped.match(/^(\w+)\s*:\s*(\w+)\s*=/) : null
    if (annM && !PY_RESERVED.has(annM[1]) && !seen.has(annM[1])) {
      seen.add(annM[1])
      items.push({ label: annM[1], kind: 'variable' as CompletionKind, insertText: annM[1],
        detail: `${annM[1]}: ${annM[2]}`, documentation: `Line ${i+1}`, sortOrder: 2 })
      return
    }

    // name = value  (any indent)
    const varM = stripped.match(/^(\w+)\s*=(?!=)\s*(.+)/)
    if (varM && !PY_RESERVED.has(varM[1]) && !seen.has(varM[1]) && !varM[1].startsWith('_')) {
      seen.add(varM[1])
      const inferredType = inferPyType(varM[2])
      items.push({ label: varM[1], kind: 'variable' as CompletionKind, insertText: varM[1],
        detail: inferredType ? `${varM[1]}: ${inferredType}` : varM[1],
        documentation: `Line ${i+1}`, sortOrder: indent === 0 ? 2 : 3 })
    }

    // for x in ... or for x, y in ...
    const forM = stripped.match(/^for\s+(\w+)(?:\s*,\s*(\w+))?\s+in\s+/)
    if (forM) {
      [forM[1], forM[2]].filter(Boolean).forEach(v => {
        if (!seen.has(v) && !PY_RESERVED.has(v)) {
          seen.add(v)
          items.push({ label: v, kind: 'variable' as CompletionKind, insertText: v,
            documentation: `Loop variable, line ${i+1}`, sortOrder: 3 })
        }
      })
    }
  })
  return items
}



// ─────────────────────────────────────────────────────────────────────────────
//  Python instance variable resolution
//  e.g.  sensor = dht.new(...)  →  sensor.read_temperature() shows dht methods
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given a variable name, scan the code for its assignment and find
 * what package/type created it, then return the relevant PYTHON_PKG_MEMBERS.
 *
 * Handles patterns like:
 *   sensor = dht.new(...)       → dht instance methods
 *   strip  = ws2812.new(...)    → ws2812 instance methods
 *   imu    = mpu6050.new(...)   → mpu6050 instance methods
 *   servo  = servo.new()        → servo instance methods
 */
function resolveInstanceMembersPy(
  code: string,
  varName: string,
): Array<{ label: string; detail: string; doc: string }> {
  // Find: varName = pkg.new(...)  or  varName = pkg.SomeConstructor(...)
  const lines = code.split('\n')
  for (const line of lines) {
    const m = line.match(new RegExp(`^\\s*${varName}\\s*=\\s*(\\w+)\\.(\\w+)\\s*\\(`))
    if (m) {
      const pkg = m[1]
      const members = PYTHON_PKG_MEMBERS[pkg]
      if (members) {
        // Return instance methods (non-constructor, non-constant)
        return members.filter(x =>
          x.label !== 'new' &&
          x.label !== x.label.toUpperCase() &&   // skip ALL_CAPS constants
          /^[a-z]/.test(x.label)                 // skip PascalCase type exports
        )
      }
    }
  }
  return []
}


export function getCompletions(
  code: string,
  offset: number,
  ext: string,
): CompletionItem[] {
  const isPy = ext === 'py'
  const { word: prefix, start } = wordAtOffset(code, offset)
  const before      = code.slice(0, start)
  const memberCtx   = getMemberContext(code, start)
  const allPkgs     = getAllPkgMembers()

  // ── 1. Member-access completions:  pkg.Prefix  or  pkg.prefix  ────────────
  if (memberCtx) {
    // Python: arduino.Serial.method  — detect two-level chain
    if (isPy) {
      // Check for chained: arduino.Serial.
      const chainM = code.slice(0, start).match(/(\w+)\.(\w+)\.$/)
      if (chainM) {
        const chainKey = `${chainM[1]}.${chainM[2]}`
        const members = PYTHON_PKG_MEMBERS[chainKey]
        if (members) {
          return members
            .filter(m => !prefix || m.label.toLowerCase().startsWith(prefix.toLowerCase()))
            .map(m => ({ label: m.label, kind: 'method' as CompletionKind, insertText: m.label, detail: m.detail, documentation: m.doc, sortOrder: 1 }))
        }
      }
      // Single-level — direct package member
      const pyMembers = PYTHON_PKG_MEMBERS[memberCtx]
      if (pyMembers) {
        return pyMembers
          .filter(m => !prefix || m.label.toLowerCase().startsWith(prefix.toLowerCase()))
          .map(m => ({
            label: m.label,
            kind: (m.kind ?? 'method') as CompletionKind,
            insertText: m.label,
            detail: m.detail,
            documentation: m.doc,
            sortOrder: 1,
          }))
      }

      // Instance variable — look up what type it was assigned from
      // e.g.  sensor = dht.new(...)  →  sensor.read_X should show dht instance methods
      const instanceMembers = resolveInstanceMembersPy(code, memberCtx)
      if (instanceMembers.length > 0) {
        return instanceMembers
          .filter(m => !prefix || m.label.toLowerCase().startsWith(prefix.toLowerCase()))
          .map(m => ({ label: m.label, kind: 'method' as CompletionKind, insertText: m.label, detail: m.detail, documentation: m.doc, sortOrder: 1 }))
      }
    }

    // Go/C++: unified pkg lookup
    const pkg = allPkgs[memberCtx]
    if (pkg) {
      return Object.entries(pkg)
        .filter(([name]) => !prefix || name.toLowerCase().startsWith(prefix.toLowerCase()))
        .map(([name, def]) => ({
          label: name,
          kind: (def.tags?.includes('type') ? 'type' : 'method') as CompletionKind,
          insertText: name,
          detail: def.sig.replace(`func ${memberCtx}.`, '').replace(`func (`, '('),
          documentation: def.doc,
          sortOrder: 1,
        }))
    }

    // Serial / Wire (C++) — inline short definitions
    if (memberCtx === 'Serial' || memberCtx === 'Wire') {
      const SERIAL_MEMBERS: CompletionItem[] = [
        { label: 'begin',     kind: 'method', insertText: 'begin',     detail: 'void begin(long baud)',    documentation: 'Initialize serial at baud rate.', sortOrder: 1 },
        { label: 'print',     kind: 'method', insertText: 'print',     detail: 'size_t print(T val)',      documentation: 'Print without newline.', sortOrder: 1 },
        { label: 'println',   kind: 'method', insertText: 'println',   detail: 'size_t println(T val)',    documentation: 'Print with newline.', sortOrder: 1 },
        { label: 'available', kind: 'method', insertText: 'available', detail: 'int available()',          documentation: 'Bytes in receive buffer.', sortOrder: 2 },
        { label: 'read',      kind: 'method', insertText: 'read',      detail: 'int read()',               documentation: 'Read next byte (-1 if none).', sortOrder: 2 },
        { label: 'write',     kind: 'method', insertText: 'write',     detail: 'size_t write(uint8_t)',    documentation: 'Write raw byte.', sortOrder: 2 },
        { label: 'flush',     kind: 'method', insertText: 'flush',     detail: 'void flush()',             documentation: 'Wait for TX to complete.', sortOrder: 3 },
        { label: 'end',       kind: 'method', insertText: 'end',       detail: 'void end()',               sortOrder: 3 },
        { label: 'parseInt',  kind: 'method', insertText: 'parseInt',  detail: 'long parseInt()',          sortOrder: 3 },
        { label: 'parseFloat',kind: 'method', insertText: 'parseFloat',detail: 'float parseFloat()',       sortOrder: 3 },
        { label: 'readString',kind: 'method', insertText: 'readString',detail: 'String readString()',      sortOrder: 3 },
        { label: 'readStringUntil', kind: 'method', insertText: 'readStringUntil', detail: 'String readStringUntil(char terminator)', sortOrder: 3 },
        { label: 'readBytes', kind: 'method', insertText: 'readBytes', detail: 'size_t readBytes(char* buf, size_t len)', sortOrder: 3 },
        { label: 'setTimeout',kind: 'method', insertText: 'setTimeout',detail: 'void setTimeout(long ms)', sortOrder: 4 },
        { label: 'peek',      kind: 'method', insertText: 'peek',      detail: 'int peek()',               documentation: 'Peek at next byte without removing it.', sortOrder: 3 },
      ]
      const WIRE_MEMBERS: CompletionItem[] = [
        { label: 'begin',             kind: 'method', insertText: 'begin',             detail: 'void begin()',                      documentation: 'Init I2C as master.', sortOrder: 1 },
        { label: 'beginTransmission', kind: 'method', insertText: 'beginTransmission', detail: 'void beginTransmission(uint8_t addr)', sortOrder: 1 },
        { label: 'write',             kind: 'method', insertText: 'write',             detail: 'size_t write(uint8_t data)',          sortOrder: 1 },
        { label: 'endTransmission',   kind: 'method', insertText: 'endTransmission',   detail: 'uint8_t endTransmission(bool stop)',  sortOrder: 1 },
        { label: 'requestFrom',       kind: 'method', insertText: 'requestFrom',       detail: 'uint8_t requestFrom(addr, count)',    sortOrder: 2 },
        { label: 'read',              kind: 'method', insertText: 'read',              detail: 'int read()',                          sortOrder: 2 },
        { label: 'available',         kind: 'method', insertText: 'available',         detail: 'int available()',                     sortOrder: 2 },
        { label: 'setClock',          kind: 'method', insertText: 'setClock',          detail: 'void setClock(uint32_t freq)',         documentation: 'Set I2C clock frequency.', sortOrder: 3 },
        { label: 'onReceive',         kind: 'method', insertText: 'onReceive',         detail: 'void onReceive(void(*)(int))',         sortOrder: 4 },
        { label: 'onRequest',         kind: 'method', insertText: 'onRequest',         detail: 'void onRequest(void(*)())',            sortOrder: 4 },
      ]
      const members = memberCtx === 'Wire' ? WIRE_MEMBERS : SERIAL_MEMBERS
      return members.filter(m => !prefix || m.label.toLowerCase().startsWith(prefix.toLowerCase()))
    }

    return []
  }

  if (!prefix || prefix.length < 1) return []

  const lower = prefix.toLowerCase()
  let items: CompletionItem[] = []

  // ── 2. Python ─────────────────────────────────────────────────────────────
  if (isPy) {
    items.push(...PYTHON_KEYWORD_COMPLETIONS)
    // Imported package names
    const importedPkgs = new Set<string>()
    Array.from(code.matchAll(/^import\s+(\w+)/gm)).forEach(m => importedPkgs.add(m[1]))
    Array.from(code.matchAll(/^from\s+(\w+)\s+import/gm)).forEach(m => importedPkgs.add(m[1]))
    importedPkgs.forEach(pkg => {
      if (PYTHON_PKG_MEMBERS[pkg]) {
        items.push({ label: pkg, kind: 'package', insertText: pkg, detail: `package ${pkg}`, sortOrder: 2 })
      }
    })
    items.push(...collectUserSymbolsPy(code))
  }

  // ── 3. Go ─────────────────────────────────────────────────────────────────
  else if (ext === 'go') {
    // Builtins
    items.push(...Object.entries(GO_BUILTIN_DOCS).map(([name, def]) => ({
      label: name, kind: 'function' as CompletionKind,
      insertText: name, detail: def.sig, documentation: def.doc, sortOrder: 3,
    })))
    items.push(...GO_KEYWORD_COMPLETIONS)
    // Imported packages (standard + tsuki)
    const allKnownPkgs = [...Object.keys(GO_PKG_MEMBERS), 'arduino', 'dht', 'ws2812', 'mpu6050', 'Servo', 'time']
    allKnownPkgs.forEach(pkg => {
      if (code.includes(`"${pkg}"`) || code.includes(`\'${pkg}\'`)) {
        items.push({ label: pkg, kind: 'package', insertText: pkg, detail: `package ${pkg}`, sortOrder: 2 })
      }
    })
    items.push(...collectUserSymbolsGo(code))
  }

  // ── 4. C++ / .ino ─────────────────────────────────────────────────────────
  else {
    items.push(...CPP_KEYWORD_COMPLETIONS)
    items.push(...Object.entries(ARDUINO_FUNCS).map(([name, def]) => ({
      label: name, kind: 'function' as CompletionKind,
      insertText: name, detail: def.sig, documentation: def.doc, sortOrder: 3,
    })))
    items.push(...collectUserSymbolsCpp(code))
  }

  // ── Deduplicate + filter by prefix ────────────────────────────────────────
  const seen = new Set<string>()
  return items
    .filter(item => {
      if (seen.has(item.label)) return false
      if (!item.label.toLowerCase().startsWith(lower)) return false
      seen.add(item.label)
      return true
    })
    .sort((a, b) => ((a.sortOrder ?? 5) - (b.sortOrder ?? 5)) || a.label.localeCompare(b.label))
    .slice(0, 60)
}


export function getHoverDoc(
  code: string,
  offset: number,
  ext: string,
): HoverDoc | null {
  const isPy   = ext === 'py'
  const { word } = wordAtOffset(code, offset)
  if (!word) return null

  // Detect pkg.Member context
  const before     = code.slice(0, offset - word.length)
  const memberCtxM = before.match(/(\w+)\.(?:(\w+)\.)?$/)
  if (memberCtxM) {
    const root = memberCtxM[1]
    const sub  = memberCtxM[2]  // e.g. arduino.Serial.begin → sub='Serial'

    // Python chained: arduino.Serial.X
    if (isPy && root && sub) {
      const chainKey = `${root}.${sub}`
      const members  = PYTHON_PKG_MEMBERS[chainKey] ?? []
      const m = members.find(x => x.label === word)
      if (m) return { title: `${root}.${sub}.${word}`, signature: m.detail, doc: m.doc, tags: ['tsuki', 'python', root] }
    }

    // Python single-level pkg
    if (isPy) {
      const members = PYTHON_PKG_MEMBERS[root] ?? []
      const m = members.find(x => x.label === word)
      if (m) return { title: `${root}.${word}`, signature: m.detail, doc: m.doc, tags: ['tsuki', 'python', root] }
      // Instance variable — look up assigned type
      const instMembers = resolveInstanceMembersPy(code, root)
      const im = instMembers.find(x => x.label === word)
      if (im) return { title: `${root}.${word}`, signature: im.detail, doc: im.doc, tags: ['tsuki', 'python'] }
    }

    // Go/C++ unified lookup
    const allPkgs = getAllPkgMembers()
    const pkg     = allPkgs[root] ?? {}
    const def     = pkg[word]
    if (def) return { title: `${root}.${word}`, signature: def.sig, doc: def.doc, returns: def.returns, tags: def.tags ?? ['stdlib', root] }

    // Serial/Wire fallback docs
    if (root === 'Serial') {
      const serialDocs: Record<string, string> = {
        begin: 'void begin(long baud) — initialize serial at the given baud rate.',
        print: 'size_t print(T val) — print value without newline.',
        println: 'size_t println(T val) — print value followed by \\n.',
        available: 'int available() — bytes waiting in the receive buffer.',
        read: 'int read() — read and remove the next byte (-1 if empty).',
        write: 'size_t write(uint8_t val) — write raw byte.',
        flush: 'void flush() — wait for TX buffer to drain.',
        peek: 'int peek() — look at the next byte without removing it.',
        readString: 'String readString() — read until timeout.',
        parseInt: 'long parseInt() — parse an integer from the stream.',
      }
      const doc = serialDocs[word]
      return doc ? { title: `Serial.${word}`, doc, tags: ['arduino', 'Serial'] } : null
    }

    return null
  }

  // Go builtins
  if (ext === 'go' && GO_BUILTIN_DOCS[word]) {
    const d = GO_BUILTIN_DOCS[word]
    return { title: word, signature: d.sig, doc: d.doc, returns: d.returns, tags: ['builtin'] }
  }

  // Arduino C/C++ functions
  if ((ext === 'cpp' || ext === 'ino') && ARDUINO_FUNCS[word]) {
    const d = ARDUINO_FUNCS[word]
    return { title: word, signature: d.sig, doc: d.doc, returns: d.returns, tags: ['arduino'] }
  }

  // Package hover: show available members
  const allPkgs = getAllPkgMembers()
  if ((ext === 'go' || isPy) && allPkgs[word]) {
    const members = Object.keys(allPkgs[word])
    return {
      title: `package ${word}`,
      doc: `Package **${word}**. Members: ${members.slice(0, 10).join(', ')}${members.length > 10 ? '…' : ''}.`,
      tags: [ext === 'py' ? 'python' : 'stdlib', 'package'],
    }
  }
  if (isPy && PYTHON_PKG_MEMBERS[word]) {
    const members = PYTHON_PKG_MEMBERS[word]
    const fns  = members.filter(m => !/^[A-Z_]/.test(m.label)).slice(0, 8).map(m => m.label)
    const cons = members.filter(m => /^[A-Z_]/.test(m.label)).slice(0, 4).map(m => m.label)
    const parts = [
      fns.length  ? `Functions: ${fns.join(', ')}` : '',
      cons.length ? `Constants: ${cons.join(', ')}` : '',
    ].filter(Boolean).join(' · ')
    return {
      title: `package ${word}`,
      doc: `**tsuki ${word}** package for Python.${parts ? ' ' + parts : ''}`,
      tags: ['python', 'package', 'tsuki'],
    }
  }

  // User-defined symbols
  const userSymbols = isPy
    ? collectUserSymbolsPy(code)
    : ext === 'go' ? collectUserSymbolsGo(code) : collectUserSymbolsCpp(code)
  const userSym = userSymbols.find(s => s.label === word)
  if (userSym) {
    return {
      title: word,
      signature: userSym.detail,
      doc: userSym.documentation ?? `User-defined ${userSym.kind}`,
      tags: ['user'],
    }
  }

  return null
}


export function getSignatureHelp(
  code: string,
  offset: number,
  ext: string,
): SignatureHelp | null {
  const isPy = ext === 'py'

  // Walk backwards to find the open paren of the active call
  let depth = 0
  let i = offset - 1
  while (i >= 0) {
    const ch = code[i]
    if (ch === ')') depth++
    else if (ch === '(') {
      if (depth === 0) break
      depth--
    }
    i--
  }
  if (i < 0) return null

  // Count commas at this paren depth to determine active param
  let activeParam = 0
  let d2 = 0
  for (let j = i + 1; j < offset; j++) {
    if (code[j] === ',' && d2 === 0) activeParam++
    if (code[j] === '(') d2++
    if (code[j] === ')') d2--
  }

  const beforeParen = code.slice(0, i)

  // ── Python: pkg.method( or method(  ────────────────────────────────────
  if (isPy) {
    const chainM  = beforeParen.match(/(\w+)\.(\w+)\.(\w+)\s*$/)  // pkg.sub.fn
    const memberM = beforeParen.match(/(\w+)\.(\w+)\s*$/)           // pkg.fn
    const simpleM = beforeParen.match(/(\w+)\s*$/)

    if (chainM) {
      const key = `${chainM[1]}.${chainM[2]}`
      const member = (PYTHON_PKG_MEMBERS[key] ?? []).find(m => m.label === chainM[3])
      if (member) {
        const paramStr = member.detail.match(/\(([^)]*)\)/)?.[1] ?? ''
        const params = paramStr ? paramStr.split(',').map(p => ({ name: p.trim().split(':')[0].trim(), type: p.includes(':') ? p.split(':')[1].trim() : '' })) : []
        return { label: member.detail, params, activeParam: Math.min(activeParam, Math.max(0, params.length - 1)), doc: member.doc }
      }
    }
    if (memberM) {
      const member = (PYTHON_PKG_MEMBERS[memberM[1]] ?? []).find(m => m.label === memberM[2])
      if (member) {
        const paramStr = member.detail.match(/\(([^)]*)\)/)?.[1] ?? ''
        const params = paramStr ? paramStr.split(',').map(p => ({ name: p.trim().split(':')[0].trim(), type: p.includes(':') ? p.split(':')[1].trim() : '' })) : []
        return { label: member.detail, params, activeParam: Math.min(activeParam, Math.max(0, params.length - 1)), doc: member.doc }
      }
    }
    if (simpleM) {
      const userSym = collectUserSymbolsPy(code).find(s => s.label === simpleM[1] && s.kind === 'function')
      if (userSym?.detail) {
        return { label: userSym.detail, params: [], activeParam: 0, doc: userSym.documentation }
      }
    }
    return null
  }

  // ── Go / C++ ─────────────────────────────────────────────────────────────
  const allPkgs  = getAllPkgMembers()
  const memberM2 = beforeParen.match(/(\w+)\.(\w+)\s*$/)
  const simpleM2 = beforeParen.match(/(\w+)\s*$/)

  if (memberM2) {
    const [, pkg, fn] = memberM2
    const def = (allPkgs[pkg] ?? {})[fn]
    if (def) {
      return {
        label: def.sig,
        params: def.params,
        activeParam: Math.min(activeParam, Math.max(0, def.params.length - 1)),
        doc: def.doc,
      }
    }
  }

  if (simpleM2) {
    const fn = simpleM2[1]
    let def: FuncDef | undefined
    if (ext === 'go')                    def = GO_BUILTIN_DOCS[fn]
    if (!def && (ext === 'cpp' || ext === 'ino')) def = ARDUINO_FUNCS[fn]
    if (!def) {
      const syms = ext === 'go' ? collectUserSymbolsGo(code) : collectUserSymbolsCpp(code)
      const usr  = syms.find(s => s.label === fn && s.kind === 'function')
      if (usr?.detail) return { label: usr.detail, params: [], activeParam: 0, doc: usr.documentation }
    }
    if (def) {
      return {
        label: def.sig,
        params: def.params,
        activeParam: Math.min(activeParam, Math.max(0, def.params.length - 1)),
        doc: def.doc,
      }
    }
  }

  return null
}


// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC API — INLAY HINTS
// ─────────────────────────────────────────────────────────────────────────────

function inferGoType(expr: string): string | null {
  const e = expr.trim()
  if (!e) return null
  // Integer literals
  if (/^-?\d+$/.test(e))  return 'int'
  // Float literals
  if (/^-?\d+\.\d*$/.test(e) || /^-?\d*\.\d+$/.test(e)) return 'float64'
  // String literals
  if (/^".*"$/.test(e) || /^`[\s\S]*`$/.test(e)) return 'string'
  // Bool
  if (e === 'true' || e === 'false') return 'bool'
  // Rune
  if (/^'.'$/.test(e)) return 'rune'
  // nil
  if (e === 'nil') return 'nil'
  // make([]T, ...) → []T
  const makeSlice = e.match(/^make\(\s*(\[\]\w+)/)
  if (makeSlice) return makeSlice[1]
  // make(map[K]V) → map[K]V
  const makeMap = e.match(/^make\(\s*(map\[\w+\]\w+)/)
  if (makeMap) return makeMap[1]
  // make(chan T) → chan T
  const makeChan = e.match(/^make\(\s*(chan\s+\w+)/)
  if (makeChan) return makeChan[1].replace(/\s+/, ' ')
  // []T{...} → []T
  const sliceLit = e.match(/^(\[\]\w+)\{/)
  if (sliceLit) return sliceLit[1]
  // map[K]V{...} → map[K]V
  const mapLit = e.match(/^(map\[\w+\]\w+)\{/)
  if (mapLit) return mapLit[1]
  // &T{...} → *T
  const addrOf = e.match(/^&(\w+)\{/)
  if (addrOf) return `*${addrOf[1]}`
  // Type conversion: T(x) → T  (if T is a known type)
  const typeConv = e.match(/^(int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|float32|float64|string|byte|rune)\(/)
  if (typeConv) return typeConv[1]
  // New
  const newExpr = e.match(/^new\((\w+)\)/)
  if (newExpr) return `*${newExpr[1]}`
  // stdlib returns
  if (e.startsWith('time.Now()'))           return 'time.Time'
  if (e.startsWith('time.Since('))          return 'time.Duration'
  if (e.startsWith('strings.Contains('))    return 'bool'
  if (e.startsWith('strings.Join('))        return 'string'
  if (e.startsWith('strings.Split('))       return '[]string'
  if (e.startsWith('strings.ToLower(') || e.startsWith('strings.ToUpper(')) return 'string'
  if (e.startsWith('fmt.Sprintf('))         return 'string'
  if (e.startsWith('strconv.Itoa('))        return 'string'
  if (e.startsWith('len(') || e.startsWith('cap(')) return 'int'
  if (e.startsWith('append('))              return '[]T'
  if (e.startsWith('make(chan '))            return 'chan'
  return null
}

export function getInlayHints(code: string, ext: string): InlayHint[] {
  const hints: InlayHint[] = []
  if (ext !== 'go' && ext !== 'cpp' && ext !== 'ino' && ext !== 'py') return hints

  // ── Python inlay hints ───────────────────────────────────────────────────
  if (ext === 'py') {
    code.split('\n').forEach((raw, i) => {
      const ln = i + 1
      // time.sleep(N) — only when arg is a plain number, not when it contains time.X constant
      const sleepM = raw.match(/\.sleep\s*\(\s*(\d+)\s*\)/)
      if (sleepM) {
        // Don't hint if the arg already references a time constant — unit is self-evident
        const close = raw.indexOf(')', raw.indexOf('.sleep('))
        if (close !== -1) hints.push({ line: ln, col: close + 1, label: '  # ms', kind: 'param' })
      }
      // time.sleep(expr * time.X) — argument contains time constant, skip
      const sleepComplex = raw.match(/\.sleep\s*\([^)]*time\.\w+[^)]*\)/)
      if (sleepComplex) {
        // Remove the last hint we just pushed (it fired on a complex arg)
        if (hints.length && hints[hints.length - 1].label === '  # ms') hints.pop()
      }
      // arduino.delay(N)
      const delayM = raw.match(/arduino\.delay\s*\(\s*(\d+)/)
      if (delayM) {
        const close = raw.indexOf(')', raw.indexOf('arduino.delay('))
        if (close !== -1) hints.push({ line: ln, col: close + 1, label: '  # ms', kind: 'param' })
      }
      // analog_write(pin, N)
      const awM = raw.match(/analog_write\s*\(\s*\w+\s*,\s*(\d+)/)
      if (awM) {
        const close = raw.indexOf(')', raw.indexOf('analog_write('))
        if (close !== -1) hints.push({ line: ln, col: close + 1, label: '  # 0-255', kind: 'param' })
      }
      // Serial.begin(N): baud hint removed — it's self-evident, Serial.begin() always takes baud rate
      // Type inference: `name = literal` with no annotation on the line
      // Only fire when the whole RHS is a plain number (no expressions like 2000 * time.X)
      const varM = raw.match(/^(\s*)(\w+)\s*=\s*(\d+(?:\.\d+)?)$/)
      if (varM && !raw.includes(':')) {
        const typ = varM[3].includes('.') ? 'float' : 'int'
        const col = varM[1].length + varM[2].length
        hints.push({ line: ln, col, label: `: ${typ}`, kind: 'type' })
      }
    })
    return hints
  }

  const lines = code.split('\n')

  if (ext === 'go') {
    lines.forEach((raw, i) => {
      const ln = i + 1
      // ── Short variable declarations: x := expr ──────────────────────────
      // Single: name := expr
      const singleM = raw.match(/^\s*(\w+)\s*:=\s*(.+)$/)
      if (singleM && singleM[1] !== '_') {
        const inferred = inferGoType(singleM[2])
        if (inferred) {
          const colonIdx = raw.indexOf(':=')
          hints.push({ line: ln, col: colonIdx, label: ` ${inferred}`, kind: 'type' })
        }
      }

      // ── Function return type hints: func name(params) (if no explicit return type) ──
      const funcM = raw.match(/^(\s*func\s+(?:\(\w+\s+\*?\w+\)\s+)?\w+)\s*\(([^)]*)\)\s*\{/)
      if (funcM) {
        // Only if there's no return type declared (no text between ) and {)
        const afterParen = raw.slice(raw.lastIndexOf(')') + 1).trim()
        if (afterParen === '{') {
          // Check if function body has return statements
          const bodyLines = lines.slice(i + 1, i + 20)
          const hasReturn = bodyLines.some(l => /^\s*return\s+/.test(l))
          const firstReturn = bodyLines.find(l => /^\s*return\s+/.test(l))
          if (hasReturn && firstReturn) {
            const retExpr = firstReturn.replace(/^\s*return\s+/, '').trim()
            const retType = inferGoType(retExpr)
            if (retType) {
              const braceIdx = raw.lastIndexOf('{')
              hints.push({ line: ln, col: braceIdx, label: ` → ${retType} `, kind: 'return' })
            }
          }
        }
      }

      // ── Range variable type hints: for k, v := range ──────────────────────
      if (/^\s*for\s+\w+\s*,\s*\w+\s*:=\s*range\s+\w+/.test(raw)) {
        hints.push({ line: ln, col: raw.indexOf(':='), label: ` int, T`, kind: 'type' })
      }
    })

    return hints
  }

  if (ext === 'cpp' || ext === 'ino') {
    // Inlay hints: show units for delay() / analogWrite() calls
    lines.forEach((raw, i) => {
      const ln = i + 1
      // delay(N) → show "ms"
      const delayM = raw.match(/\bdelay\s*\(\s*(\d+)\s*\)/)
      if (delayM) {
        const parenClose = raw.indexOf(')', raw.indexOf('delay('))
        hints.push({ line: ln, col: parenClose, label: ' /*ms*/', kind: 'param' })
      }
      // analogWrite(pin, N) → show "0–255"
      const awM = raw.match(/\banalogWrite\s*\(\s*\w+\s*,\s*(\d+)\s*\)/)
      if (awM) {
        const parenClose = raw.indexOf(')', raw.indexOf('analogWrite('))
        hints.push({ line: ln, col: parenClose, label: ' /*0-255*/', kind: 'param' })
      }
      // Serial.begin(N): baud hint removed — self-evident
    })
    return hints
  }

  return hints
}