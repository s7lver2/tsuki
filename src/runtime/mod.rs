// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: runtime  (updated)
//  Maps Go packages / builtins → Arduino C++ APIs.
//  Now also loads external libraries from tsukilib.toml packages.
// ─────────────────────────────────────────────────────────────────────────────

pub mod pkg_loader;
pub mod pkg_manager;

use std::collections::HashMap;
use std::path::Path;

// ── Mapping types ─────────────────────────────────────────────────────────────

/// A pre-parsed slot in a mapping template.
/// Parsed once at registration time, applied in O(n_slots) with zero scanning.
#[derive(Debug, Clone)]
pub(crate) enum TemplateSlot {
    Lit(Box<str>),  // literal segment between placeholders
    Arg(usize),     // {0}, {1}, {2} ...
    Self_,          // {self}
    Args,           // {args} — all args joined with ", "
}

#[derive(Debug, Clone)]
pub struct ParsedTemplate {
    slots: Vec<TemplateSlot>,
}

impl ParsedTemplate {
    fn parse(t: &str) -> Self {
        let mut slots: Vec<TemplateSlot> = Vec::new();
        let mut lit   = String::new();
        let mut chars = t.chars().peekable();
        while let Some(c) = chars.next() {
            if c != '{' { lit.push(c); continue; }
            let mut inner = String::new();
            let mut closed = false;
            for nc in chars.by_ref() {
                if nc == '}' { closed = true; break; }
                inner.push(nc);
            }
            if !closed { lit.push('{'); lit.push_str(&inner); continue; }
            if !lit.is_empty() {
                slots.push(TemplateSlot::Lit(std::mem::take(&mut lit).into_boxed_str()));
            }
            match inner.as_str() {
                "self" => slots.push(TemplateSlot::Self_),
                "args" => slots.push(TemplateSlot::Args),
                s => if let Ok(n) = s.parse::<usize>() {
                    slots.push(TemplateSlot::Arg(n));
                } else {
                    lit.push('{'); lit.push_str(s); lit.push('}');
                }
            }
        }
        if !lit.is_empty() { slots.push(TemplateSlot::Lit(lit.into_boxed_str())); }
        Self { slots }
    }

    /// Write the expanded template into `out` — zero allocations if `out` has capacity.
    #[inline]
    fn apply_into(&self, args: &[String], out: &mut String) {
        for slot in &self.slots {
            match slot {
                TemplateSlot::Lit(s)  => out.push_str(s),
                TemplateSlot::Self_   => { if let Some(r) = args.first() { out.push_str(r) } }
                TemplateSlot::Arg(i)  => { if let Some(a) = args.get(*i)  { out.push_str(a) } }
                TemplateSlot::Args    => {
                    for (i, a) in args.iter().enumerate() {
                        if i > 0 { out.push_str(", "); }
                        out.push_str(a);
                    }
                }
            }
        }
    }

    fn apply(&self, args: &[String]) -> String {
        let cap: usize = self.slots.iter().map(|s| match s {
            TemplateSlot::Lit(l) => l.len(),
            _ => 8,
        }).sum();
        let mut out = String::with_capacity(cap.max(16));
        self.apply_into(args, &mut out);
        out
    }
}

#[derive(Debug, Clone)]
pub enum FnMap {
    /// Direct C++ identifier or expression — returned as-is.
    Direct(String),
    /// Parameterised template:  {0}, {1}, {self}, {args}
    Template(ParsedTemplate),
    /// Legacy alias for Template("{args}").
    Variadic(ParsedTemplate),
}

impl FnMap {
    /// Convenience constructors (parse once at registration).
    pub fn direct(s: impl Into<String>)  -> Self { Self::Direct(s.into()) }
    pub fn template(t: &str)             -> Self { Self::Template(ParsedTemplate::parse(t)) }
    pub fn variadic(t: &str)             -> Self { Self::Variadic(ParsedTemplate::parse(t)) }

    #[inline]
    pub fn apply(&self, args: &[String]) -> String {
        match self {
            Self::Direct(s)   => s.clone(),
            Self::Template(t) => t.apply(args),
            Self::Variadic(t) => t.apply(args),
        }
    }

    #[inline]
    pub fn apply_into(&self, args: &[String], out: &mut String) {
        match self {
            Self::Direct(s)   => out.push_str(s),
            Self::Template(t) => t.apply_into(args, out),
            Self::Variadic(t) => t.apply_into(args, out),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct PkgMap {
    pub header:    Option<String>,
    pub functions: HashMap<String, FnMap>,
    pub constants: HashMap<String, String>,
    pub types:     HashMap<String, String>,
    /// C++ class name for global variable declarations (emitted as pointer).
    pub cpp_class: Option<String>,
}

impl PkgMap {
    pub fn new(header: Option<&str>) -> Self {
        Self {
            header:    header.map(str::to_owned),
            functions: HashMap::with_capacity(16),
            constants: HashMap::with_capacity(8),
            types:     HashMap::with_capacity(4),
            cpp_class: None,
        }
    }
    pub fn with_class(mut self, class: &str) -> Self {
        self.cpp_class = Some(class.to_owned()); self
    }
    pub fn fun(mut self, go: &str, map: FnMap) -> Self {
        self.functions.insert(go.into(), map); self
    }
    pub fn cst(mut self, go: &str, cpp: &str) -> Self {
        self.constants.insert(go.into(), cpp.into()); self
    }
}

// ── Registry ──────────────────────────────────────────────────────────────────

pub struct Runtime {
    pub packages: HashMap<String, PkgMap>,
    pub builtins: HashMap<String, FnMap>,
}

impl Default for Runtime { fn default() -> Self { Self::new() } }

impl Runtime {
    /// Create a runtime with only the built-in packages.
    /// HashMap capacities are pre-sized to avoid rehashing during the ~220 registrations.
    pub fn new() -> Self {
        let mut r = Runtime {
            packages: HashMap::with_capacity(24),  // ~15 built-in packages
            builtins: HashMap::with_capacity(16),  // ~10 built-in functions
        };
        r.init_builtins();
        r.init_fmt();
        r.init_time();
        r.init_math();
        r.init_strconv();
        r.init_arduino();
        r.init_wire();
        r.init_spi();
        r.init_serial();
        r.init_servo();
        r.init_liquidcrystal();
        r.init_tsuki_webkit();
        r
    }

    /// Create a runtime and additionally load all external libraries found
    /// under the given directory (scans recursively for tsukilib.toml files).
    pub fn with_libs(libs_dir: &Path) -> Self {
        let mut r = Self::new();
        r.load_external_libs(libs_dir);
        r
    }

    /// Create a runtime and load only the specific library packages listed in
    /// `pkg_names`. Used during `build` when the project manifest specifies
    /// its dependencies explicitly.
    pub fn with_selected_libs(libs_dir: &Path, pkg_names: &[String]) -> Self {
        let mut r = Self::new();
        r.load_selected_libs(libs_dir, pkg_names);
        r
    }

    // ── External library loading ──────────────────────────────────────────────

    /// Load all libraries found under `libs_dir`.
    pub fn load_external_libs(&mut self, libs_dir: &Path) {
        for lib in pkg_loader::load_all(libs_dir) {
            self.register_lib(lib);
        }
    }

    /// Load only the listed packages from `libs_dir`.
    pub fn load_selected_libs(&mut self, libs_dir: &Path, pkg_names: &[String]) {
        for lib in pkg_loader::load_all(libs_dir) {
            let matches = pkg_names.iter().any(|n| {
                n == &lib.name || lib.aliases.iter().any(|a| a == n)
            });
            if matches {
                self.register_lib(lib);
            }
        }
    }

    /// Load a single library from a TOML string (used in tests and by the CLI
    /// `tsuki pkg install` flow before the file is written to disk).
    pub fn load_lib_from_str(&mut self, toml_str: &str) -> crate::error::Result<()> {
        let lib = pkg_loader::load_from_str(toml_str, Path::new("<inline>"))?;
        self.register_lib(lib);
        Ok(())
    }

    fn register_lib(&mut self, lib: pkg_loader::LoadedLib) {
        // Register under the canonical name
        self.packages.insert(lib.name.clone(), lib.pkg_map.clone());
        // Register under all aliases as well
        for alias in &lib.aliases {
            self.packages.insert(alias.clone(), lib.pkg_map.clone());
        }
    }

    // ── Registration helper ───────────────────────────────────────────────────

    fn reg(&mut self, name: &str, map: PkgMap) {
        self.packages.insert(name.to_owned(), map);
    }

    // ── Built-in packages ─────────────────────────────────────────────────────

    fn init_builtins(&mut self) {
        let b = &mut self.builtins;
        b.insert("print".into(),   FnMap::template("Serial.print({0})"));
        b.insert("println".into(), FnMap::template("Serial.println({0})"));
        b.insert("panic".into(),   FnMap::template("{ Serial.println({0}); for(;;) {} }"));
        b.insert("len".into(),     FnMap::template("(sizeof({0})/sizeof({0}[0]))"));
        b.insert("cap".into(),     FnMap::template("(sizeof({0})/sizeof({0}[0]))"));
        b.insert("new".into(),     FnMap::template("(new {0}())"));
        b.insert("delete".into(),  FnMap::template("delete {0}"));
        b.insert("make".into(),    FnMap::template("/* make({0}) */"));
        b.insert("append".into(),  FnMap::template("/* append({0}) */"));
        b.insert("copy".into(),    FnMap::template("memcpy({0},{1},sizeof({0}))"));
    }

    fn init_fmt(&mut self) {
        // NOTE: On AVR (Uno/Nano) snprintf does NOT support %f by default.
        // Add `-Wl,-u,vfprintf -lprintf_flt -lm` to board build flags to enable it,
        // or replace fmt.Printf float args with dtostrf() calls in your Go source.
        self.reg("fmt", PkgMap::new(None)
            // Go (PascalCase)
            .fun("Print",    FnMap::template("Serial.print({0})"))
            .fun("Println",  FnMap::template("Serial.println({0})"))
            .fun("Printf",   FnMap::variadic("do { char _pb[128]; snprintf(_pb, sizeof(_pb), {args}); Serial.print(_pb); } while(0)"))
            .fun("Fprintf",  FnMap::variadic("do { char _pb[128]; snprintf(_pb, sizeof(_pb), {args}); Serial.print(_pb); } while(0)"))
            .fun("Sprintf",  FnMap::variadic("([&](){ char _buf[128]; snprintf(_buf, sizeof(_buf), {args}); return String(_buf); })()"))
            .fun("Errorf",   FnMap::variadic("([&](){ char _buf[128]; snprintf(_buf, sizeof(_buf), {args}); return String(_buf); })()"))
            // Python (snake_case) aliases
            .fun("print",    FnMap::template("Serial.print({0})"))
            .fun("println",  FnMap::template("Serial.println({0})"))
            .fun("printf",   FnMap::variadic("do { char _pb[128]; snprintf(_pb, sizeof(_pb), {args}); Serial.print(_pb); } while(0)"))
            .fun("sprintf",  FnMap::variadic("([&](){ char _buf[128]; snprintf(_buf, sizeof(_buf), {args}); return String(_buf); })()"))
        );
    }

    fn init_time(&mut self) {
        self.reg("time", PkgMap::new(None)
            // ── Go (PascalCase) — nanosecond-based, Go time.Duration convention ──
            .fun("Sleep",  FnMap::template("delay(({0})/1000000UL)"))
            .fun("Now",    FnMap::Direct("millis()".into()))
            .fun("Since",  FnMap::template("(millis()-{0})"))
            // ── Python (snake_case) ───────────────────────────────────────────
            // time.sleep(n)    → delay(n)              n is milliseconds (Python-native)
            //                    time.sleep(2000 * time.Millisecond) → delay(2000 * 1)   = delay(2000)
            //                    time.sleep(2    * time.Second)      → delay(2    * 1000) = delay(2000)
            // time.sleep_ms(n) → delay(n)              explicit ms alias (same as sleep)
            // time.sleep_us(n) → delayMicroseconds(n)  explicit µs alias
            // time.sleep_ns(n) → delay((n)/1000000UL)  explicit ns alias
            .fun("sleep",    FnMap::template("delay({0})"))
            .fun("sleep_ms", FnMap::template("delay({0})"))
            .fun("sleep_us", FnMap::template("delayMicroseconds({0})"))
            .fun("sleep_ns", FnMap::template("delay(({0})/1000000UL)"))
            .fun("now",      FnMap::Direct("millis()".into()))
            .fun("since",    FnMap::template("(millis()-{0})"))
            .fun("millis",   FnMap::Direct("millis()".into()))
            .fun("micros",   FnMap::Direct("micros()".into()))
            // ── Constants ────────────────────────────────────────────────────
            // Go Sleep uses nanoseconds — keep Go constants unchanged
            .cst("Second",      "1000000000ULL")
            .cst("Millisecond", "1000000ULL")
            .cst("Microsecond", "1000ULL")
            // Python sleep uses milliseconds — these constants match that unit:
            // time.sleep(2000 * time.MS)          → delay(2000 * 1)    = delay(2000)
            // time.sleep(2    * time.S)            → delay(2    * 1000) = delay(2000)
            // time.sleep_us(500 * time.US)         → delayMicroseconds(500 * 1)
            .cst("MS",  "1")     // time.sleep(500  * time.MS) == delay(500)
            .cst("S",   "1000")  // time.sleep(2    * time.S)  == delay(2000)
            .cst("US",  "1")     // time.sleep_us(500 * time.US) == delayMicroseconds(500)
        );
    }

    fn init_math(&mut self) {
        let fns: &[(&str, &str)] = &[
            ("Abs","fabs"), ("Sqrt","sqrt"), ("Cbrt","cbrt"),
            ("Pow","pow"),  ("Pow10","pow10"),
            ("Sin","sin"),  ("Cos","cos"),   ("Tan","tan"),
            ("Asin","asin"),("Acos","acos"), ("Atan","atan"),("Atan2","atan2"),
            ("Sinh","sinh"),("Cosh","cosh"), ("Tanh","tanh"),
            ("Exp","exp"),  ("Exp2","exp2"),
            ("Log","log"),  ("Log2","log2"), ("Log10","log10"),
            ("Floor","floor"),("Ceil","ceil"),("Round","round"),("Trunc","trunc"),
            ("Mod","fmod"), ("Remainder","remainder"),
            ("Hypot","hypot"),
            ("Min","fmin"), ("Max","fmax"),
        ];
        let mut m = PkgMap::new(Some("math.h"))
            .cst("Pi",      "M_PI")
            .cst("E",       "M_E")
            .cst("Phi",     "1.6180339887498948482")
            .cst("Sqrt2",   "M_SQRT2")
            .cst("Ln2",     "M_LN2")
            .cst("Log2E",   "M_LOG2E")
            .cst("Log10E",  "M_LOG10E")
            .cst("MaxFloat64", "DBL_MAX")
            .cst("SmallestNonzeroFloat64", "DBL_TRUE_MIN")
            .fun("Inf",     FnMap::Direct("INFINITY".into()))
            .fun("NaN",     FnMap::Direct("NAN".into()))
            .fun("IsNaN",   FnMap::template("isnan({0})"))
            .fun("IsInf",   FnMap::template("isinf({0})"));
        for (go_fn, cpp_fn) in fns {
            m = m.fun(go_fn, FnMap::template(&format!("{}({{0}})", cpp_fn)));
            // Python: also register lowercase alias (e.g. "sqrt" alongside "Sqrt")
            let py_fn = go_fn.to_lowercase();
            if py_fn != *go_fn {
                m = m.fun(&py_fn, FnMap::template(&format!("{}({{0}})", cpp_fn)));
            }
        }
        // Extra two-arg python aliases
        m = m.fun("atan2",       FnMap::template("atan2({0},{1})"));
        m = m.fun("pow",         FnMap::template("pow({0},{1})"));
        m = m.fun("fmod",        FnMap::template("fmod({0},{1})"));
        m = m.fun("is_nan",      FnMap::template("isnan({0})"));
        m = m.fun("is_inf",      FnMap::template("isinf({0})"));
        self.reg("math", m);
    }

    fn init_strconv(&mut self) {
        self.reg("strconv", PkgMap::new(None)
            // Go (PascalCase)
            .fun("Itoa",        FnMap::template("String({0})"))
            .fun("Atoi",        FnMap::template("({0}).toInt()"))
            .fun("FormatInt",   FnMap::template("String({0},{1})"))
            .fun("FormatFloat", FnMap::template("String({0})"))
            .fun("ParseFloat",  FnMap::template("({0}).toFloat()"))
            .fun("ParseInt",    FnMap::template("({0}).toInt()"))
            .fun("ParseBool",   FnMap::template("({0} == \"true\")"))
            .fun("FormatBool",  FnMap::template("({0} ? \"true\" : \"false\")"))
            // Python (snake_case) aliases
            .fun("itoa",         FnMap::template("String({0})"))
            .fun("atoi",         FnMap::template("({0}).toInt()"))
            .fun("format_int",   FnMap::template("String({0},{1})"))
            .fun("format_float", FnMap::template("String({0})"))
            .fun("parse_float",  FnMap::template("({0}).toFloat()"))
            .fun("parse_int",    FnMap::template("({0}).toInt()"))
            .fun("parse_bool",   FnMap::template("({0} == \"true\")"))
            .fun("format_bool",  FnMap::template("({0} ? \"true\" : \"false\")"))
        );
    }

    fn init_arduino(&mut self) {
        self.reg("arduino", PkgMap::new(Some("Arduino.h"))
            // ── Digital / analog I/O (camelCase + PascalCase aliases) ────────
            .fun("pinMode",           FnMap::template("pinMode({0}, {1})"))
            .fun("PinMode",           FnMap::template("pinMode({0}, {1})"))
            .fun("digitalWrite",      FnMap::template("digitalWrite({0}, {1})"))
            .fun("DigitalWrite",      FnMap::template("digitalWrite({0}, {1})"))
            .fun("digitalRead",       FnMap::template("digitalRead({0})"))
            .fun("DigitalRead",       FnMap::template("digitalRead({0})"))
            .fun("analogRead",        FnMap::template("analogRead({0})"))
            .fun("AnalogRead",        FnMap::template("analogRead({0})"))
            .fun("analogWrite",       FnMap::template("analogWrite({0}, {1})"))
            .fun("AnalogWrite",       FnMap::template("analogWrite({0}, {1})"))
            .fun("analogReference",   FnMap::template("analogReference({0})"))
            .fun("AnalogReference",   FnMap::template("analogReference({0})"))
            // ── Timing ────────────────────────────────────────────────────────
            .fun("delay",             FnMap::template("delay({0})"))
            .fun("Delay",             FnMap::template("delay({0})"))
            .fun("delayMicroseconds", FnMap::template("delayMicroseconds({0})"))
            .fun("DelayMicroseconds", FnMap::template("delayMicroseconds({0})"))
            .fun("millis",            FnMap::Direct("millis()".into()))
            .fun("Millis",            FnMap::Direct("millis()".into()))
            .fun("micros",            FnMap::Direct("micros()".into()))
            .fun("Micros",            FnMap::Direct("micros()".into()))
            // ── Math helpers ──────────────────────────────────────────────────
            .fun("map",       FnMap::template("map({0}, {1}, {2}, {3}, {4})"))
            .fun("Map",       FnMap::template("map({0}, {1}, {2}, {3}, {4})"))
            .fun("constrain", FnMap::template("constrain({0}, {1}, {2})"))
            .fun("Constrain", FnMap::template("constrain({0}, {1}, {2})"))
            .fun("abs",       FnMap::template("abs({0})"))
            .fun("Abs",       FnMap::template("abs({0})"))
            .fun("min",       FnMap::template("min({0}, {1})"))
            .fun("Min",       FnMap::template("min({0}, {1})"))
            .fun("max",       FnMap::template("max({0}, {1})"))
            .fun("Max",       FnMap::template("max({0}, {1})"))
            .fun("sqrt",      FnMap::template("sqrt({0})"))
            .fun("Sqrt",      FnMap::template("sqrt({0})"))
            .fun("pow",       FnMap::template("pow({0}, {1})"))
            .fun("Pow",       FnMap::template("pow({0}, {1})"))
            .fun("random",    FnMap::template("random({0})"))
            .fun("Random",    FnMap::template("random({0})"))
            .fun("randomSeed", FnMap::template("randomSeed({0})"))
            .fun("RandomSeed", FnMap::template("randomSeed({0})"))
            // ── Tone / pulse ──────────────────────────────────────────────────
            .fun("tone",       FnMap::template("tone({0}, {1})"))
            .fun("Tone",       FnMap::template("tone({0}, {1})"))
            .fun("noTone",     FnMap::template("noTone({0})"))
            .fun("NoTone",     FnMap::template("noTone({0})"))
            .fun("pulseIn",    FnMap::template("pulseIn({0}, {1})"))
            .fun("PulseIn",    FnMap::template("pulseIn({0}, {1})"))
            .fun("pulseInLong",FnMap::template("pulseInLong({0}, {1})"))
            .fun("PulseInLong",FnMap::template("pulseInLong({0}, {1})"))
            .fun("shiftOut",   FnMap::template("shiftOut({0}, {1}, {2}, {3})"))
            .fun("ShiftOut",   FnMap::template("shiftOut({0}, {1}, {2}, {3})"))
            .fun("shiftIn",    FnMap::template("shiftIn({0}, {1}, {2})"))
            .fun("ShiftIn",    FnMap::template("shiftIn({0}, {1}, {2})"))
            // ── Interrupts ────────────────────────────────────────────────────
            .fun("attachInterrupt",   FnMap::template("attachInterrupt({0}, {1}, {2})"))
            .fun("AttachInterrupt",   FnMap::template("attachInterrupt({0}, {1}, {2})"))
            .fun("detachInterrupt",   FnMap::template("detachInterrupt({0})"))
            .fun("DetachInterrupt",   FnMap::template("detachInterrupt({0})"))
            .fun("interrupts",        FnMap::Direct("interrupts()".into()))
            .fun("Interrupts",        FnMap::Direct("interrupts()".into()))
            .fun("noInterrupts",      FnMap::Direct("noInterrupts()".into()))
            .fun("NoInterrupts",      FnMap::Direct("noInterrupts()".into()))
            // ── Serial (convenience wrappers on arduino package) ─────────────
            .fun("SerialBegin",       FnMap::template("Serial.begin({0})"))
            .fun("serialBegin",       FnMap::template("Serial.begin({0})"))
            .fun("SerialEnd",         FnMap::Direct("Serial.end()".into()))
            .fun("SerialPrint",       FnMap::template("Serial.print({0})"))
            .fun("serialPrint",       FnMap::template("Serial.print({0})"))
            .fun("SerialPrintln",     FnMap::template("Serial.println({0})"))
            .fun("serialPrintln",     FnMap::template("Serial.println({0})"))
            .fun("SerialAvailable",   FnMap::Direct("Serial.available()".into()))
            .fun("SerialRead",        FnMap::Direct("Serial.read()".into()))
            .fun("SerialReadString",  FnMap::Direct("Serial.readString()".into()))
            .fun("SerialFlush",       FnMap::Direct("Serial.flush()".into()))
            // ── Python OOP-style: arduino.Serial.xxx() ─────────────────────────
            // Python source uses `arduino.Serial.begin(9600)`.
            // emit_call splits at the FIRST dot → mod_name="arduino", fn_name="Serial.begin"
            // so we register these compound names in the arduino PkgMap.
            .fun("Serial.begin",      FnMap::template("Serial.begin({0})"))
            .fun("Serial.end",        FnMap::Direct(  "Serial.end()".into()))
            .fun("Serial.print",      FnMap::template("Serial.print({0})"))
            .fun("Serial.println",    FnMap::template("Serial.println({0})"))
            .fun("Serial.write",      FnMap::template("Serial.write({0})"))
            .fun("Serial.available",  FnMap::Direct(  "Serial.available()".into()))
            .fun("Serial.read",       FnMap::Direct(  "Serial.read()".into()))
            .fun("Serial.readString", FnMap::Direct(  "Serial.readString()".into()))
            .fun("Serial.flush",      FnMap::Direct(  "Serial.flush()".into()))
            .fun("Serial.parseInt",   FnMap::Direct(  "Serial.parseInt()".into()))
            .fun("Serial.parseFloat", FnMap::Direct(  "Serial.parseFloat()".into()))
            .fun("Serial.peek",       FnMap::Direct(  "Serial.peek()".into()))
            // ── Constants ─────────────────────────────────────────────────────
            .cst("HIGH",         "HIGH")
            .cst("LOW",          "LOW")
            .cst("INPUT",        "INPUT")
            .cst("OUTPUT",       "OUTPUT")
            .cst("INPUT_PULLUP", "INPUT_PULLUP")
            .cst("LED_BUILTIN",  "LED_BUILTIN")
            .cst("LSBFIRST",     "LSBFIRST")
            .cst("MSBFIRST",     "MSBFIRST")
            .cst("A0","A0").cst("A1","A1").cst("A2","A2")
            .cst("A3","A3").cst("A4","A4").cst("A5","A5")
            .cst("CHANGE","CHANGE").cst("RISING","RISING").cst("FALLING","FALLING")
        );
    }
    fn init_wire(&mut self) {
        let m = PkgMap::new(Some("Wire.h"))
            .fun("Begin",             FnMap::Direct("Wire.begin()".into()))
            .fun("BeginTransmission", FnMap::template("Wire.beginTransmission({0})"))
            .fun("EndTransmission",   FnMap::Direct("Wire.endTransmission()".into()))
            .fun("RequestFrom",       FnMap::template("Wire.requestFrom({0},{1})"))
            .fun("Write",             FnMap::template("Wire.write({0})"))
            .fun("Read",              FnMap::Direct("Wire.read()".into()))
            .fun("Available",         FnMap::Direct("Wire.available()".into()))
            .fun("SetClock",          FnMap::template("Wire.setClock({0})"))
            .fun("OnReceive",         FnMap::template("Wire.onReceive({0})"))
            .fun("OnRequest",         FnMap::template("Wire.onRequest({0})"));
        self.reg("wire", m.clone());
        self.reg("Wire", m);
    }

    fn init_spi(&mut self) {
        let m = PkgMap::new(Some("SPI.h"))
            .fun("Begin",           FnMap::Direct("SPI.begin()".into()))
            .fun("End",             FnMap::Direct("SPI.end()".into()))
            .fun("Transfer",        FnMap::template("SPI.transfer({0})"))
            .fun("Transfer16",      FnMap::template("SPI.transfer16({0})"))
            .fun("BeginTransaction",FnMap::template("SPI.beginTransaction({0})"))
            .fun("EndTransaction",  FnMap::Direct("SPI.endTransaction()".into()))
            .fun("SetBitOrder",     FnMap::template("SPI.setBitOrder({0})"))
            .fun("SetDataMode",     FnMap::template("SPI.setDataMode({0})"))
            .fun("SetClockDivider", FnMap::template("SPI.setClockDivider({0})"));
        self.reg("spi", m.clone());
        self.reg("SPI", m);
    }

    fn init_serial(&mut self) {
        let m = PkgMap::new(None)
            .fun("Begin",     FnMap::template("Serial.begin({0})"))
            .fun("End",       FnMap::Direct("Serial.end()".into()))
            .fun("Print",     FnMap::template("Serial.print({0})"))
            .fun("Println",   FnMap::template("Serial.println({0})"))
            .fun("Write",     FnMap::template("Serial.write({0})"))
            .fun("Read",      FnMap::Direct("Serial.read()".into()))
            .fun("Peek",      FnMap::Direct("Serial.peek()".into()))
            .fun("Available", FnMap::Direct("Serial.available()".into()))
            .fun("Flush",     FnMap::Direct("Serial.flush()".into()))
            .fun("ParseInt",  FnMap::Direct("Serial.parseInt()".into()))
            .fun("ParseFloat",FnMap::Direct("Serial.parseFloat()".into()))
            .fun("ReadString",FnMap::template("Serial.readString()"))
            .fun("Find",      FnMap::template("Serial.find({0})"));
        self.reg("serial", m.clone());
        self.reg("Serial", m);
    }

    fn init_servo(&mut self) {
        let m = PkgMap::new(Some("Servo.h"))
            .fun("Attach",   FnMap::template("{0}.attach({1})"))
            .fun("Write",    FnMap::template("{0}.write({1})"))
            .fun("WriteMicroseconds", FnMap::template("{0}.writeMicroseconds({1})"))
            .fun("Read",     FnMap::template("{0}.read()"))
            .fun("Attached", FnMap::template("{0}.attached()"))
            .fun("Detach",   FnMap::template("{0}.detach()"));
        self.reg("servo", m.clone());
        self.reg("Servo", m);
    }

    fn init_liquidcrystal(&mut self) {
        let m = PkgMap::new(Some("LiquidCrystal.h"))
            .fun("Begin",   FnMap::template("{0}.begin({1}, {2})"))
            .fun("Clear",   FnMap::template("{0}.clear()"))
            .fun("Home",    FnMap::template("{0}.home()"))
            .fun("Print",   FnMap::template("{0}.print({1})"))
            .fun("SetCursor",FnMap::template("{0}.setCursor({1}, {2})"))
            .fun("Blink",   FnMap::template("{0}.blink()"))
            .fun("NoBlink", FnMap::template("{0}.noBlink()"))
            .fun("Cursor",  FnMap::template("{0}.cursor()"))
            .fun("NoCursor",FnMap::template("{0}.noCursor()"))
            .fun("Display", FnMap::template("{0}.display()"))
            .fun("NoDisplay",FnMap::template("{0}.noDisplay()"))
            .fun("ScrollDisplayLeft", FnMap::template("{0}.scrollDisplayLeft()"))
            .fun("ScrollDisplayRight",FnMap::template("{0}.scrollDisplayRight()"));
        self.reg("lcd",          m.clone());
        self.reg("LiquidCrystal",m);
    }

    // ── Lookup API ────────────────────────────────────────────────────────────

    // ── tsuki-webkit ─────────────────────────────────────────────────────────
    // Maps `import "tsuki-webkit"` calls in Go source.
    // The actual heavy lifting (JSX→C++) happens in tsuki-webkit crate;
    // this registers the API surface that tsuki-core must know about so it
    // can transpile the Go glue code correctly.
    fn init_tsuki_webkit(&mut self) {
        // ApiInit() → TsukiWebApp()  (constructor)
        // WebInit() → TsukiWebApp() with web-only mode
        let m = PkgMap::new(Some("tsuki_webkit_gen.h"))
            .fun("ApiInit",   FnMap::Direct("TsukiWebApp()".into()))
            .fun("WebInit",   FnMap::Direct("TsukiWebApp()".into()))
            // app.setup() / app.tick() — pass-through method calls
            .fun("Setup",     FnMap::template("{0}.setup()"))
            .fun("Tick",      FnMap::template("{0}.tick()"))
            // Serial bridge
            .fun("SerialWrite",    FnMap::template("{0}.wsBroadcast({1})"))
            // Json helpers (map to ArduinoJson or String)
            .fun("JsonStringify",  FnMap::template("String({0})"))
            .fun("JsonParse",      FnMap::template("String({0})"));

        self.reg("tsuki-webkit", m.clone());
        self.reg("webkit",       m.clone());
        self.reg("TsukiWebkit",  m);
    }

    pub fn pkg(&self, name: &str) -> Option<&PkgMap> {
        self.packages.get(name)
    }

    pub fn builtin(&self, name: &str) -> Option<&FnMap> {
        self.builtins.get(name)
    }

    pub fn headers_for(&self, pkgs: &[&str]) -> Vec<String> {
        let mut hdrs: Vec<_> = pkgs.iter()
            .filter_map(|p| self.packages.get(*p))
            .filter_map(|m| m.header.as_ref())
            .map(|h| format!("#include <{}>", h))
            .collect();
        hdrs.sort();
        hdrs.dedup();
        hdrs
    }

    /// List all currently registered package names (builtin + external).
    pub fn list_packages(&self) -> Vec<&str> {
        let mut names: Vec<&str> = self.packages.keys().map(|s| s.as_str()).collect();
        names.sort();
        names
    }
}

// ── Board profiles ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Board {
    pub id:          String,
    pub name:        String,
    pub fqbn:        String,
    pub cpu:         String,
    pub flash_kb:    u32,
    pub ram_kb:      u32,
    pub clock_mhz:   u32,
    pub extra_flags: Vec<String>,
}

impl Board {
    pub fn catalog() -> Vec<Board> {
        vec![
            Board { id: "uno".into(),        name: "Arduino Uno".into(),              fqbn: "arduino:avr:uno".into(),                  cpu: "ATmega328P".into(),   flash_kb: 32,   ram_kb: 2,    clock_mhz: 16,  extra_flags: vec![] },
            Board { id: "nano".into(),        name: "Arduino Nano".into(),             fqbn: "arduino:avr:nano".into(),                 cpu: "ATmega328P".into(),   flash_kb: 32,   ram_kb: 2,    clock_mhz: 16,  extra_flags: vec![] },
            Board { id: "nano_every".into(),  name: "Arduino Nano Every".into(),       fqbn: "arduino:megaavr:nona4809".into(),         cpu: "ATmega4809".into(),   flash_kb: 48,   ram_kb: 6,    clock_mhz: 20,  extra_flags: vec![] },
            Board { id: "mega".into(),        name: "Arduino Mega 2560".into(),        fqbn: "arduino:avr:mega".into(),                 cpu: "ATmega2560".into(),   flash_kb: 256,  ram_kb: 8,    clock_mhz: 16,  extra_flags: vec![] },
            Board { id: "micro".into(),       name: "Arduino Micro".into(),            fqbn: "arduino:avr:micro".into(),                cpu: "ATmega32U4".into(),   flash_kb: 32,   ram_kb: 2,    clock_mhz: 16,  extra_flags: vec![] },
            Board { id: "leonardo".into(),    name: "Arduino Leonardo".into(),         fqbn: "arduino:avr:leonardo".into(),             cpu: "ATmega32U4".into(),   flash_kb: 32,   ram_kb: 2,    clock_mhz: 16,  extra_flags: vec![] },
            Board { id: "due".into(),         name: "Arduino Due".into(),              fqbn: "arduino:sam:arduino_due_x".into(),        cpu: "AT91SAM3X8E".into(),  flash_kb: 512,  ram_kb: 96,   clock_mhz: 84,  extra_flags: vec![] },
            Board { id: "zero".into(),        name: "Arduino Zero".into(),             fqbn: "arduino:samd:arduino_zero_native".into(), cpu: "ATSAMD21G18A".into(), flash_kb: 256,  ram_kb: 32,   clock_mhz: 48,  extra_flags: vec![] },
            Board { id: "mkr1000".into(),     name: "Arduino MKR WiFi 1000".into(),   fqbn: "arduino:samd:mkr1000".into(),             cpu: "ATSAMD21G18A".into(), flash_kb: 256,  ram_kb: 32,   clock_mhz: 48,  extra_flags: vec![] },
            Board { id: "esp32".into(),       name: "ESP32 Dev Module".into(),         fqbn: "esp32:esp32:esp32".into(),                cpu: "Xtensa LX6".into(),   flash_kb: 4096, ram_kb: 520,  clock_mhz: 240, extra_flags: vec![] },
            Board { id: "esp8266".into(),     name: "ESP8266 NodeMCU".into(),          fqbn: "esp8266:esp8266:nodemcuv2".into(),        cpu: "ESP8266".into(),      flash_kb: 4096, ram_kb: 80,   clock_mhz: 80,  extra_flags: vec![] },
            Board { id: "pico".into(),        name: "Raspberry Pi Pico (RP2040)".into(), fqbn: "rp2040:rp2040:rpipico".into(),                  cpu: "RP2040".into(),       flash_kb: 2048, ram_kb: 264,  clock_mhz: 133, extra_flags: vec![] },
            Board { id: "xiao_rp2040".into(), name: "Seeed XIAO RP2040".into(),          fqbn: "rp2040:rp2040:seeed_xiao_rp2040".into(),          cpu: "RP2040".into(),       flash_kb: 2048, ram_kb: 264,  clock_mhz: 133, extra_flags: vec![] },
            Board { id: "teensy41".into(),    name: "Teensy 4.1".into(),               fqbn: "teensy:avr:teensy41".into(),              cpu: "iMXRT1062".into(),    flash_kb: 8192, ram_kb: 1024, clock_mhz: 600, extra_flags: vec![] },
            Board { id: "portenta_h7".into(), name: "Arduino Portenta H7".into(),      fqbn: "arduino:mbed_portenta:envie_m7".into(),   cpu: "STM32H747XI".into(),  flash_kb: 2048, ram_kb: 8192, clock_mhz: 480, extra_flags: vec![] },
        ]
    }

    pub fn find(id: &str) -> Option<Board> {
        Self::catalog().into_iter().find(|b| b.id == id)
    }
}