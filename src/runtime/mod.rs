// ─────────────────────────────────────────────────────────────────────────────
//  godotino :: runtime  (updated)
//  Maps Go packages / builtins → Arduino C++ APIs.
//  Now also loads external libraries from godotinolib.toml packages.
// ─────────────────────────────────────────────────────────────────────────────

pub mod pkg_loader;
pub mod pkg_manager;

use std::collections::HashMap;
use std::path::Path;

// ── Mapping types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum FnMap {
    Direct(String),
    Template(String),
    /// All args joined by ", " replace the `{args}` placeholder.
    /// Used for variadic calls like Serial.printf where arg count varies.
    Variadic(String),
}

impl FnMap {
    pub fn apply(&self, args: &[String]) -> String {
        match self {
            Self::Direct(s)   => s.clone(),
            Self::Template(t) => {
                let mut out = t.clone();
                // {self} is a named alias for the receiver (args[0])
                if let Some(receiver) = args.first() {
                    out = out.replace("{self}", receiver);
                }
                for (i, a) in args.iter().enumerate() {
                    out = out.replace(&format!("{{{i}}}"), a);
                }
                out
            }
            Self::Variadic(t) => {
                t.replace("{args}", &args.join(", "))
            }
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
        Self { header: header.map(str::to_owned), ..Default::default() }
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
    pub fn new() -> Self {
        let mut r = Runtime { packages: HashMap::new(), builtins: HashMap::new() };
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
        r
    }

    /// Create a runtime and additionally load all external libraries found
    /// under the given directory (scans recursively for godotinolib.toml files).
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
    /// `godotino pkg install` flow before the file is written to disk).
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
        b.insert("print".into(),   FnMap::Template("Serial.print({0})".into()));
        b.insert("println".into(), FnMap::Template("Serial.println({0})".into()));
        b.insert("panic".into(),   FnMap::Template("{ Serial.println({0}); for(;;) {} }".into()));
        b.insert("len".into(),     FnMap::Template("(sizeof({0})/sizeof({0}[0]))".into()));
        b.insert("cap".into(),     FnMap::Template("(sizeof({0})/sizeof({0}[0]))".into()));
        b.insert("new".into(),     FnMap::Template("(new {0}())".into()));
        b.insert("delete".into(),  FnMap::Template("delete {0}".into()));
        b.insert("make".into(),    FnMap::Template("/* make({0}) */".into()));
        b.insert("append".into(),  FnMap::Template("/* append({0}) */".into()));
        b.insert("copy".into(),    FnMap::Template("memcpy({0},{1},sizeof({0}))".into()));
    }

    fn init_fmt(&mut self) {
        // NOTE: On AVR (Uno/Nano) snprintf does NOT support %f by default.
        // Add `-Wl,-u,vfprintf -lprintf_flt -lm` to board build flags to enable it,
        // or replace fmt.Printf float args with dtostrf() calls in your Go source.
        self.reg("fmt", PkgMap::new(None)
            .fun("Print",    FnMap::Template("Serial.print({0})".into()))
            .fun("Println",  FnMap::Template("Serial.println({0})".into()))
            .fun("Printf",   FnMap::Variadic("do { char _pb[128]; snprintf(_pb, sizeof(_pb), {args}); Serial.print(_pb); } while(0)".into()))
            .fun("Fprintf",  FnMap::Variadic("do { char _pb[128]; snprintf(_pb, sizeof(_pb), {args}); Serial.print(_pb); } while(0)".into()))
            .fun("Sprintf",  FnMap::Variadic("([&](){ char _buf[128]; snprintf(_buf, sizeof(_buf), {args}); return String(_buf); })()".into()))
            .fun("Errorf",   FnMap::Variadic("([&](){ char _buf[128]; snprintf(_buf, sizeof(_buf), {args}); return String(_buf); })()".into()))
        );
    }

    fn init_time(&mut self) {
        self.reg("time", PkgMap::new(None)
            .fun("Sleep",  FnMap::Template("delay(({0})/1000000UL)".into()))
            .fun("Now",    FnMap::Direct("millis()".into()))
            .fun("Since",  FnMap::Template("(millis()-{0})".into()))
            .cst("Second",      "1000000000ULL")
            .cst("Millisecond", "1000000ULL")
            .cst("Microsecond", "1000ULL")
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
            .fun("IsNaN",   FnMap::Template("isnan({0})".into()))
            .fun("IsInf",   FnMap::Template("isinf({0})".into()));
        for (go_fn, cpp_fn) in fns {
            m = m.fun(go_fn, FnMap::Template(format!("{}({{0}})", cpp_fn)));
        }
        self.reg("math", m);
    }

    fn init_strconv(&mut self) {
        self.reg("strconv", PkgMap::new(None)
            .fun("Itoa",        FnMap::Template("String({0})".into()))
            .fun("Atoi",        FnMap::Template("({0}).toInt()".into()))
            .fun("FormatInt",   FnMap::Template("String({0},{1})".into()))
            .fun("FormatFloat", FnMap::Template("String({0})".into()))
            .fun("ParseFloat",  FnMap::Template("({0}).toFloat()".into()))
            .fun("ParseInt",    FnMap::Template("({0}).toInt()".into()))
            .fun("ParseBool",   FnMap::Template("({0} == \"true\")".into()))
            .fun("FormatBool",  FnMap::Template("({0} ? \"true\" : \"false\")".into()))
        );
    }

    fn init_arduino(&mut self) {
        self.reg("arduino", PkgMap::new(Some("Arduino.h"))
            // ── Digital / analog I/O (camelCase + PascalCase aliases) ────────
            .fun("pinMode",           FnMap::Template("pinMode({0}, {1})".into()))
            .fun("PinMode",           FnMap::Template("pinMode({0}, {1})".into()))
            .fun("digitalWrite",      FnMap::Template("digitalWrite({0}, {1})".into()))
            .fun("DigitalWrite",      FnMap::Template("digitalWrite({0}, {1})".into()))
            .fun("digitalRead",       FnMap::Template("digitalRead({0})".into()))
            .fun("DigitalRead",       FnMap::Template("digitalRead({0})".into()))
            .fun("analogRead",        FnMap::Template("analogRead({0})".into()))
            .fun("AnalogRead",        FnMap::Template("analogRead({0})".into()))
            .fun("analogWrite",       FnMap::Template("analogWrite({0}, {1})".into()))
            .fun("AnalogWrite",       FnMap::Template("analogWrite({0}, {1})".into()))
            .fun("analogReference",   FnMap::Template("analogReference({0})".into()))
            .fun("AnalogReference",   FnMap::Template("analogReference({0})".into()))
            // ── Timing ────────────────────────────────────────────────────────
            .fun("delay",             FnMap::Template("delay({0})".into()))
            .fun("Delay",             FnMap::Template("delay({0})".into()))
            .fun("delayMicroseconds", FnMap::Template("delayMicroseconds({0})".into()))
            .fun("DelayMicroseconds", FnMap::Template("delayMicroseconds({0})".into()))
            .fun("millis",            FnMap::Direct("millis()".into()))
            .fun("Millis",            FnMap::Direct("millis()".into()))
            .fun("micros",            FnMap::Direct("micros()".into()))
            .fun("Micros",            FnMap::Direct("micros()".into()))
            // ── Math helpers ──────────────────────────────────────────────────
            .fun("map",       FnMap::Template("map({0}, {1}, {2}, {3}, {4})".into()))
            .fun("Map",       FnMap::Template("map({0}, {1}, {2}, {3}, {4})".into()))
            .fun("constrain", FnMap::Template("constrain({0}, {1}, {2})".into()))
            .fun("Constrain", FnMap::Template("constrain({0}, {1}, {2})".into()))
            .fun("abs",       FnMap::Template("abs({0})".into()))
            .fun("Abs",       FnMap::Template("abs({0})".into()))
            .fun("min",       FnMap::Template("min({0}, {1})".into()))
            .fun("Min",       FnMap::Template("min({0}, {1})".into()))
            .fun("max",       FnMap::Template("max({0}, {1})".into()))
            .fun("Max",       FnMap::Template("max({0}, {1})".into()))
            .fun("sqrt",      FnMap::Template("sqrt({0})".into()))
            .fun("Sqrt",      FnMap::Template("sqrt({0})".into()))
            .fun("pow",       FnMap::Template("pow({0}, {1})".into()))
            .fun("Pow",       FnMap::Template("pow({0}, {1})".into()))
            .fun("random",    FnMap::Template("random({0})".into()))
            .fun("Random",    FnMap::Template("random({0})".into()))
            .fun("randomSeed", FnMap::Template("randomSeed({0})".into()))
            .fun("RandomSeed", FnMap::Template("randomSeed({0})".into()))
            // ── Tone / pulse ──────────────────────────────────────────────────
            .fun("tone",       FnMap::Template("tone({0}, {1})".into()))
            .fun("Tone",       FnMap::Template("tone({0}, {1})".into()))
            .fun("noTone",     FnMap::Template("noTone({0})".into()))
            .fun("NoTone",     FnMap::Template("noTone({0})".into()))
            .fun("pulseIn",    FnMap::Template("pulseIn({0}, {1})".into()))
            .fun("PulseIn",    FnMap::Template("pulseIn({0}, {1})".into()))
            .fun("pulseInLong",FnMap::Template("pulseInLong({0}, {1})".into()))
            .fun("PulseInLong",FnMap::Template("pulseInLong({0}, {1})".into()))
            .fun("shiftOut",   FnMap::Template("shiftOut({0}, {1}, {2}, {3})".into()))
            .fun("ShiftOut",   FnMap::Template("shiftOut({0}, {1}, {2}, {3})".into()))
            .fun("shiftIn",    FnMap::Template("shiftIn({0}, {1}, {2})".into()))
            .fun("ShiftIn",    FnMap::Template("shiftIn({0}, {1}, {2})".into()))
            // ── Interrupts ────────────────────────────────────────────────────
            .fun("attachInterrupt",   FnMap::Template("attachInterrupt({0}, {1}, {2})".into()))
            .fun("AttachInterrupt",   FnMap::Template("attachInterrupt({0}, {1}, {2})".into()))
            .fun("detachInterrupt",   FnMap::Template("detachInterrupt({0})".into()))
            .fun("DetachInterrupt",   FnMap::Template("detachInterrupt({0})".into()))
            .fun("interrupts",        FnMap::Direct("interrupts()".into()))
            .fun("Interrupts",        FnMap::Direct("interrupts()".into()))
            .fun("noInterrupts",      FnMap::Direct("noInterrupts()".into()))
            .fun("NoInterrupts",      FnMap::Direct("noInterrupts()".into()))
            // ── Serial (convenience wrappers on arduino package) ─────────────
            .fun("SerialBegin",       FnMap::Template("Serial.begin({0})".into()))
            .fun("serialBegin",       FnMap::Template("Serial.begin({0})".into()))
            .fun("SerialEnd",         FnMap::Direct("Serial.end()".into()))
            .fun("SerialPrint",       FnMap::Template("Serial.print({0})".into()))
            .fun("serialPrint",       FnMap::Template("Serial.print({0})".into()))
            .fun("SerialPrintln",     FnMap::Template("Serial.println({0})".into()))
            .fun("serialPrintln",     FnMap::Template("Serial.println({0})".into()))
            .fun("SerialAvailable",   FnMap::Direct("Serial.available()".into()))
            .fun("SerialRead",        FnMap::Direct("Serial.read()".into()))
            .fun("SerialReadString",  FnMap::Direct("Serial.readString()".into()))
            .fun("SerialFlush",       FnMap::Direct("Serial.flush()".into()))
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
            .fun("BeginTransmission", FnMap::Template("Wire.beginTransmission({0})".into()))
            .fun("EndTransmission",   FnMap::Direct("Wire.endTransmission()".into()))
            .fun("RequestFrom",       FnMap::Template("Wire.requestFrom({0},{1})".into()))
            .fun("Write",             FnMap::Template("Wire.write({0})".into()))
            .fun("Read",              FnMap::Direct("Wire.read()".into()))
            .fun("Available",         FnMap::Direct("Wire.available()".into()))
            .fun("SetClock",          FnMap::Template("Wire.setClock({0})".into()))
            .fun("OnReceive",         FnMap::Template("Wire.onReceive({0})".into()))
            .fun("OnRequest",         FnMap::Template("Wire.onRequest({0})".into()));
        self.reg("wire", m.clone());
        self.reg("Wire", m);
    }

    fn init_spi(&mut self) {
        let m = PkgMap::new(Some("SPI.h"))
            .fun("Begin",           FnMap::Direct("SPI.begin()".into()))
            .fun("End",             FnMap::Direct("SPI.end()".into()))
            .fun("Transfer",        FnMap::Template("SPI.transfer({0})".into()))
            .fun("Transfer16",      FnMap::Template("SPI.transfer16({0})".into()))
            .fun("BeginTransaction",FnMap::Template("SPI.beginTransaction({0})".into()))
            .fun("EndTransaction",  FnMap::Direct("SPI.endTransaction()".into()))
            .fun("SetBitOrder",     FnMap::Template("SPI.setBitOrder({0})".into()))
            .fun("SetDataMode",     FnMap::Template("SPI.setDataMode({0})".into()))
            .fun("SetClockDivider", FnMap::Template("SPI.setClockDivider({0})".into()));
        self.reg("spi", m.clone());
        self.reg("SPI", m);
    }

    fn init_serial(&mut self) {
        let m = PkgMap::new(None)
            .fun("Begin",     FnMap::Template("Serial.begin({0})".into()))
            .fun("End",       FnMap::Direct("Serial.end()".into()))
            .fun("Print",     FnMap::Template("Serial.print({0})".into()))
            .fun("Println",   FnMap::Template("Serial.println({0})".into()))
            .fun("Write",     FnMap::Template("Serial.write({0})".into()))
            .fun("Read",      FnMap::Direct("Serial.read()".into()))
            .fun("Peek",      FnMap::Direct("Serial.peek()".into()))
            .fun("Available", FnMap::Direct("Serial.available()".into()))
            .fun("Flush",     FnMap::Direct("Serial.flush()".into()))
            .fun("ParseInt",  FnMap::Direct("Serial.parseInt()".into()))
            .fun("ParseFloat",FnMap::Direct("Serial.parseFloat()".into()))
            .fun("ReadString",FnMap::Template("Serial.readString()".into()))
            .fun("Find",      FnMap::Template("Serial.find({0})".into()));
        self.reg("serial", m.clone());
        self.reg("Serial", m);
    }

    fn init_servo(&mut self) {
        let m = PkgMap::new(Some("Servo.h"))
            .fun("Attach",   FnMap::Template("{0}.attach({1})".into()))
            .fun("Write",    FnMap::Template("{0}.write({1})".into()))
            .fun("WriteMicroseconds", FnMap::Template("{0}.writeMicroseconds({1})".into()))
            .fun("Read",     FnMap::Template("{0}.read()".into()))
            .fun("Attached", FnMap::Template("{0}.attached()".into()))
            .fun("Detach",   FnMap::Template("{0}.detach()".into()));
        self.reg("servo", m.clone());
        self.reg("Servo", m);
    }

    fn init_liquidcrystal(&mut self) {
        let m = PkgMap::new(Some("LiquidCrystal.h"))
            .fun("Begin",   FnMap::Template("{0}.begin({1}, {2})".into()))
            .fun("Clear",   FnMap::Template("{0}.clear()".into()))
            .fun("Home",    FnMap::Template("{0}.home()".into()))
            .fun("Print",   FnMap::Template("{0}.print({1})".into()))
            .fun("SetCursor",FnMap::Template("{0}.setCursor({1}, {2})".into()))
            .fun("Blink",   FnMap::Template("{0}.blink()".into()))
            .fun("NoBlink", FnMap::Template("{0}.noBlink()".into()))
            .fun("Cursor",  FnMap::Template("{0}.cursor()".into()))
            .fun("NoCursor",FnMap::Template("{0}.noCursor()".into()))
            .fun("Display", FnMap::Template("{0}.display()".into()))
            .fun("NoDisplay",FnMap::Template("{0}.noDisplay()".into()))
            .fun("ScrollDisplayLeft", FnMap::Template("{0}.scrollDisplayLeft()".into()))
            .fun("ScrollDisplayRight",FnMap::Template("{0}.scrollDisplayRight()".into()));
        self.reg("lcd",          m.clone());
        self.reg("LiquidCrystal",m);
    }

    // ── Lookup API ────────────────────────────────────────────────────────────

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
            Board { id: "pico".into(),        name: "Raspberry Pi Pico (RP2040)".into(), fqbn: "rp2040:rp2040:rpipico".into(),          cpu: "RP2040".into(),       flash_kb: 2048, ram_kb: 264,  clock_mhz: 133, extra_flags: vec![] },
            Board { id: "teensy41".into(),    name: "Teensy 4.1".into(),               fqbn: "teensy:avr:teensy41".into(),              cpu: "iMXRT1062".into(),    flash_kb: 8192, ram_kb: 1024, clock_mhz: 600, extra_flags: vec![] },
            Board { id: "portenta_h7".into(), name: "Arduino Portenta H7".into(),      fqbn: "arduino:mbed_portenta:envie_m7".into(),   cpu: "STM32H747XI".into(),  flash_kb: 2048, ram_kb: 8192, clock_mhz: 480, extra_flags: vec![] },
        ]
    }

    pub fn find(id: &str) -> Option<Board> {
        Self::catalog().into_iter().find(|b| b.id == id)
    }
}