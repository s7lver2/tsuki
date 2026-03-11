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

export function getCompletions(
  code: string,
  offset: number,
  ext: string,
): CompletionItem[] {
  const { word: prefix, start } = wordAtOffset(code, offset)
  const before = code.slice(0, start)
  const memberCtx = getMemberContext(code, start)

  // ── Member access completions (e.g. fmt.P...) ─────────────────────────────
  if (memberCtx) {
    const pkg = GO_PKG_MEMBERS[memberCtx] ?? {}
    if (memberCtx === 'arduino') {
      // tsuki Go-style arduino package
      return Object.entries(ARDUINO_GO_FUNCS)
        .filter(([name]) => !prefix || name.toLowerCase().startsWith(prefix.toLowerCase()))
        .map(([name, def]) => ({
          label: name,
          kind: 'method' as CompletionKind,
          insertText: name,
          detail: def.sig.replace('func arduino.', ''),
          documentation: def.doc,
          sortOrder: 1,
        }))
    }
    if (memberCtx === 'Serial') {
      return ([
        { label: 'begin',   kind: 'method' as CompletionKind, insertText: 'begin', detail: 'void begin(long baud)', documentation: 'Initializes serial communication at baud rate.', sortOrder: 1 },
        { label: 'print',   kind: 'method' as CompletionKind, insertText: 'print', detail: 'size_t print(T val)', documentation: 'Prints data to the serial port.', sortOrder: 1 },
        { label: 'println', kind: 'method' as CompletionKind, insertText: 'println', detail: 'size_t println(T val)', documentation: 'Prints data followed by newline.', sortOrder: 1 },
        { label: 'write',   kind: 'method' as CompletionKind, insertText: 'write', detail: 'size_t write(uint8_t val)', documentation: 'Writes binary data to the serial port.', sortOrder: 2 },
        { label: 'available', kind: 'method' as CompletionKind, insertText: 'available', detail: 'int available()', documentation: 'Gets the number of bytes available for reading.', sortOrder: 2 },
        { label: 'read',    kind: 'method' as CompletionKind, insertText: 'read', detail: 'int read()', documentation: 'Reads the next incoming byte. Returns -1 if none.', sortOrder: 2 },
        { label: 'flush',   kind: 'method' as CompletionKind, insertText: 'flush', detail: 'void flush()', documentation: 'Waits for transmission of outgoing data to complete.', sortOrder: 3 },
        { label: 'end',     kind: 'method' as CompletionKind, insertText: 'end', detail: 'void end()', documentation: 'Disables serial communication.', sortOrder: 3 },
        { label: 'parseInt',  kind: 'method' as CompletionKind, insertText: 'parseInt', detail: 'long parseInt()', sortOrder: 3 },
        { label: 'parseFloat',kind: 'method' as CompletionKind, insertText: 'parseFloat', detail: 'float parseFloat()', sortOrder: 3 },
        { label: 'readString',kind: 'method' as CompletionKind, insertText: 'readString', detail: 'String readString()', documentation: 'Reads characters until timeout.', sortOrder: 3 },
      ] as CompletionItem[]).filter(c => !prefix || c.label.toLowerCase().startsWith(prefix.toLowerCase()))
    }
    if (memberCtx === 'Wire') {
      return ([
        { label: 'begin',        kind: 'method' as CompletionKind, insertText: 'begin', detail: 'void begin()', documentation: 'Initializes I2C as master.', sortOrder: 1 },
        { label: 'beginTransmission', kind: 'method' as CompletionKind, insertText: 'beginTransmission', detail: 'void beginTransmission(uint8_t address)', sortOrder: 1 },
        { label: 'write',        kind: 'method' as CompletionKind, insertText: 'write', detail: 'size_t write(uint8_t data)', sortOrder: 1 },
        { label: 'endTransmission', kind: 'method' as CompletionKind, insertText: 'endTransmission', detail: 'uint8_t endTransmission(bool stop)', sortOrder: 1 },
        { label: 'requestFrom',  kind: 'method' as CompletionKind, insertText: 'requestFrom', detail: 'uint8_t requestFrom(uint8_t addr, uint8_t count)', sortOrder: 2 },
        { label: 'read',         kind: 'method' as CompletionKind, insertText: 'read', detail: 'int read()', sortOrder: 2 },
        { label: 'available',    kind: 'method' as CompletionKind, insertText: 'available', detail: 'int available()', sortOrder: 2 },
        { label: 'setClock',     kind: 'method' as CompletionKind, insertText: 'setClock', detail: 'void setClock(uint32_t freq)', documentation: 'Sets I2C clock frequency.', sortOrder: 3 },
      ] as CompletionItem[]).filter(c => !prefix || c.label.toLowerCase().startsWith(prefix.toLowerCase()))
    }
    if (Object.keys(pkg).length > 0) {
      return Object.entries(pkg)
        .filter(([name]) => !prefix || name.toLowerCase().startsWith(prefix.toLowerCase()))
        .map(([name, def]) => ({
          label: name,
          kind: ('tags' in def && (def as FuncDef).tags?.includes('type') ? 'type' : 'function') as CompletionKind,
          insertText: name,
          detail: def.sig,
          documentation: def.doc,
          sortOrder: 1,
        }))
    }
    return []
  }

  if (!prefix || prefix.length < 1) return []

  const lower = prefix.toLowerCase()
  let items: CompletionItem[] = []

  if (ext === 'go') {
    // Builtins
    items.push(...Object.entries(GO_BUILTIN_DOCS).map(([name, def]) => ({
      label: name,
      kind: 'function' as CompletionKind,
      insertText: name,
      detail: def.sig,
      documentation: def.doc,
      sortOrder: 3,
    })))
    // Keywords + types
    items.push(...GO_KEYWORD_COMPLETIONS)
    // Package names that are imported
    ;['fmt', 'strings', 'strconv', 'math', 'time', 'sort', 'sync', 'arduino'].forEach(pkg => {
      if (code.includes(`"${pkg}"`)) {
        items.push({ label: pkg, kind: 'package' as CompletionKind, insertText: pkg, detail: `package ${pkg}`, sortOrder: 2 })
      }
    })
    // User symbols
    items.push(...collectUserSymbolsGo(code))
  } else {
    // C++ / ino
    items.push(...CPP_KEYWORD_COMPLETIONS)
    items.push(...Object.entries(ARDUINO_FUNCS).map(([name, def]) => ({
      label: name,
      kind: 'function' as CompletionKind,
      insertText: name,
      detail: def.sig,
      documentation: def.doc,
      sortOrder: 3,
    })))
    items.push(...collectUserSymbolsCpp(code))
  }

  // Filter by prefix and deduplicate
  const seen = new Set<string>()
  return items
    .filter(c => {
      if (seen.has(c.label)) return false
      if (!c.label.toLowerCase().startsWith(lower)) return false
      seen.add(c.label)
      return true
    })
    .sort((a, b) => ((a.sortOrder ?? 5) - (b.sortOrder ?? 5)) || a.label.localeCompare(b.label))
    .slice(0, 50)
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC API — HOVER DOC
// ─────────────────────────────────────────────────────────────────────────────

export function getHoverDoc(
  code: string,
  offset: number,
  ext: string,
): HoverDoc | null {
  const { word } = wordAtOffset(code, offset)
  if (!word) return null

  // Check for pkg.Member context
  const before = code.slice(0, offset - word.length)
  const memberCtxM = before.match(/(\w+)\.$/)
  if (memberCtxM) {
    const pkg  = memberCtxM[1]
    const pkgFuncs = GO_PKG_MEMBERS[pkg] ?? {}
    const def  = pkgFuncs[word]
    if (def) return { title: `${pkg}.${word}`, signature: def.sig, doc: def.doc, returns: def.returns, tags: def.tags ?? ['stdlib', pkg] }
    if (pkg === 'arduino' && ARDUINO_GO_FUNCS[word]) {
      const d = ARDUINO_GO_FUNCS[word]
      return { title: `arduino.${word}`, signature: d.sig, doc: d.doc, returns: d.returns, tags: ['arduino', 'tsuki'] }
    }
    if (pkg === 'Serial') {
      return { title: `Serial.${word}`, doc: `Arduino Serial method. ${word}() — see Arduino reference.`, tags: ['arduino', 'Serial'] }
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

  // Packages
  if (ext === 'go' && GO_PKG_MEMBERS[word]) {
    const members = Object.keys(GO_PKG_MEMBERS[word])
    return {
      title: `package ${word}`,
      doc: `Standard library package **${word}**. Available functions: ${members.slice(0, 8).join(', ')}${members.length > 8 ? '…' : ''}.`,
      tags: ['stdlib', 'package'],
    }
  }

  // User-defined symbols
  const userSymbols = ext === 'go' ? collectUserSymbolsGo(code) : collectUserSymbolsCpp(code)
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

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC API — SIGNATURE HELP
// ─────────────────────────────────────────────────────────────────────────────

export function getSignatureHelp(
  code: string,
  offset: number,
  ext: string,
): SignatureHelp | null {
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

  // Count commas at depth 0 to determine active param
  let activeParam = 0
  for (let j = i + 1; j < offset; j++) {
    if (code[j] === ',' && depth === 0) activeParam++
    if (code[j] === '(') depth++
    if (code[j] === ')') depth--
  }

  // Get the function name before '('
  const beforeParen = code.slice(0, i)
  const memberM = beforeParen.match(/(\w+)\.(\w+)\s*$/)
  const simpleM = beforeParen.match(/(\w+)\s*$/)

  let def: FuncDef | undefined

  if (memberM) {
    const [, pkg, fn] = memberM
    const pkgFuncs = GO_PKG_MEMBERS[pkg] ?? {}
    def = pkgFuncs[fn] ?? (pkg === 'arduino' ? ARDUINO_GO_FUNCS[fn] : undefined)
    if (def) {
      return {
        label: def.sig,
        params: def.params,
        activeParam: Math.min(activeParam, def.params.length - 1),
        doc: def.doc,
      }
    }
  }

  if (simpleM) {
    const fn = simpleM[1]
    if (ext === 'go') def = GO_BUILTIN_DOCS[fn]
    if (!def && (ext === 'cpp' || ext === 'ino')) def = ARDUINO_FUNCS[fn]
    // User symbols
    if (!def) {
      const userSym = (ext === 'go' ? collectUserSymbolsGo(code) : collectUserSymbolsCpp(code))
        .find(s => s.label === fn && s.kind === 'function')
      if (userSym && userSym.detail) {
        return {
          label: userSym.detail,
          params: [],
          activeParam: 0,
          doc: userSym.documentation,
        }
      }
    }
    if (def) {
      return {
        label: def.sig,
        params: def.params,
        activeParam: Math.min(activeParam, def.params.length - 1),
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
  if (ext !== 'go' && ext !== 'cpp' && ext !== 'ino') return hints

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
      // Serial.begin(N) → show "baud"
      const baudM = raw.match(/Serial\.begin\s*\(\s*(\d+)\s*\)/)
      if (baudM) {
        const parenClose = raw.indexOf(')', raw.indexOf('Serial.begin'))
        hints.push({ line: ln, col: parenClose, label: ' /*baud*/', kind: 'param' })
      }
    })
    return hints
  }

  return hints
}