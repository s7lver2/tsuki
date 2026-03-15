// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: simulator
//
//  Interprets the tsuki AST directly, emitting Arduino hardware events as
//  newline-delimited JSON on stdout.  Each line corresponds to one call of
//  the user's loop() function and has the shape:
//
//    {"ok":true,"events":[...],"pins":{...},"serial":[...],"ms":0.0}
//
//  Usage (from main.rs):
//    tsuki <file.go> --simulate [--steps N] [--board B]
//
//  The IDE spawns this process and reads stdout line-by-line, treating each
//  line as a StepResult (same interface that the old WASM sim used).
// ─────────────────────────────────────────────────────────────────────────────

use std::collections::HashMap;
use tsuki_core::parser::ast::{Program, Decl, Stmt, Expr, BinOp, UnOp, AssignOp, Block};
use serde::Serialize;

// ── Runtime value ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum Value {
    Int(i64),
    Float(f64),
    Bool(bool),
    Str(String),
    Nil,
}

impl Value {
    fn truthy(&self) -> bool {
        match self {
            Value::Bool(b)  => *b,
            Value::Int(n)   => *n != 0,
            Value::Float(f) => *f != 0.0,
            Value::Str(s)   => !s.is_empty(),
            Value::Nil      => false,
        }
    }
    fn to_display(&self) -> String {
        match self {
            Value::Int(n)   => n.to_string(),
            Value::Float(f) => {
                // Avoid ".0" for whole numbers (matches Arduino Serial.print behaviour)
                if f.fract() == 0.0 && f.abs() < 1e15 { format!("{:.0}", f) }
                else { format!("{}", f) }
            }
            Value::Bool(b)  => if *b { "1".into() } else { "0".into() },
            Value::Str(s)   => s.clone(),
            Value::Nil      => String::new(),
        }
    }
    fn as_int(&self) -> i64 {
        match self {
            Value::Int(n)   => *n,
            Value::Float(f) => *f as i64,
            Value::Bool(b)  => *b as i64,
            _               => 0,
        }
    }
    fn as_f64(&self) -> f64 {
        match self {
            Value::Float(f) => *f,
            Value::Int(n)   => *n as f64,
            Value::Bool(b)  => *b as i64 as f64,
            _               => 0.0,
        }
    }
}

fn vals_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Int(x),   Value::Int(y))   => x == y,
        (Value::Bool(x),  Value::Bool(y))  => x == y,
        (Value::Str(x),   Value::Str(y))   => x == y,
        (Value::Nil,      Value::Nil)      => true,
        _                                  => (a.as_f64() - b.as_f64()).abs() < f64::EPSILON,
    }
}

// ── Pin state ─────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct PinState {
    /// Current output value for pins 0-69: 0 or 1 for digital, 0-255 for PWM
    pub values:     [u16; 70],
    /// Pin mode: 0=INPUT, 1=OUTPUT, 2=INPUT_PULLUP
    pub modes:      [u8; 70],
    /// Digital input override (from external stimulus)
    pub digital_in: [bool; 70],
    /// Analog input values A0-A5 → indices 0-5, range 0-1023
    pub analog_in:  [u16; 6],
}

impl Default for PinState {
    fn default() -> Self {
        Self {
            values:     [0u16; 70],
            modes:      [0u8;  70],
            digital_in: [false; 70],
            analog_in:  [0u16; 6],
        }
    }
}

impl PinState {
    pub fn set_value(&mut self, pin: usize, val: u16) { if pin < 70 { self.values[pin] = val; } }
    pub fn get_value(&self, pin: usize) -> u16 { if pin < 70 { self.values[pin] } else { 0 } }
    pub fn set_mode(&mut self, pin: usize, mode: u8) { if pin < 70 { self.modes[pin] = mode; } }
    pub fn get_digital_in(&self, pin: usize) -> bool { if pin < 70 { self.digital_in[pin] } else { false } }
}

// ── Event ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct SimEvent {
    pub t_ms: f64,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pin:  Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub val:  Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub msg:  Option<String>,
}

// ── Step result (one loop() call) ─────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct StepResult {
    pub ok:     bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error:  Option<String>,
    pub events: Vec<SimEvent>,
    pub pins:   HashMap<String, u16>,
    pub serial: Vec<String>,
    pub ms:     f64,
}

// ── Control flow signals ──────────────────────────────────────────────────────

#[allow(dead_code)]
enum Flow {
    Continue,
    Break,
    ContinueLoop,
    Return(Value),
    Error(String),
}

// ── Simulator ─────────────────────────────────────────────────────────────────

// ── Energy info (emitted when --energy is active in tsuki-sim) ────────────────

#[derive(Debug, Default, Clone)]
pub struct EnergyInfo {
    /// Per-pin voltage (V) — pin index → voltage
    pub voltage:  HashMap<usize, f64>,
    /// Per-pin estimated current (A) — pin index → amps
    pub current:  HashMap<usize, f64>,
    /// Per-pin estimated power (mW)
    pub power_mw: HashMap<usize, f64>,
    /// Total estimated power consumption (mW)
    pub total_mw: f64,
}

pub struct Simulator {
    globals:    HashMap<String, Value>,
    functions:  HashMap<String, (Vec<String>, Block)>,
    pub pins:   PinState,
    virtual_ms: f64,
    setup_done: bool,
    /// Supply voltage (5.0 for 5V boards, 3.3 for ESP32/ESP8266/Pico)
    vcc:        f64,
    /// Maps servo variable name -> attached pin (usize::MAX = declared but not yet attached)
    servo_pins: HashMap<String, usize>,
    /// Maps pin -> active tone frequency in Hz (0 = silent)
    tone_pins:  HashMap<usize, u32>,
}

impl Simulator {
    /// Build a Simulator from a parsed Program.
    pub fn new(prog: &Program) -> Result<Self, String> {
        let mut globals: HashMap<String, Value> = HashMap::new();

        // ── Arduino built-in constants ────────────────────────────────────────
        let builtins = [
            ("HIGH", Value::Int(1)), ("LOW", Value::Int(0)),
            ("OUTPUT", Value::Int(1)), ("INPUT", Value::Int(0)),
            ("INPUT_PULLUP", Value::Int(2)),
            ("true", Value::Bool(true)), ("false", Value::Bool(false)),
            ("LED_BUILTIN", Value::Int(13)),
            // A0-A5 as pin numbers (Uno: A0=14..A5=19)
            ("A0", Value::Int(14)), ("A1", Value::Int(15)),
            ("A2", Value::Int(16)), ("A3", Value::Int(17)),
            ("A4", Value::Int(18)), ("A5", Value::Int(19)),
        ];
        for (k, v) in builtins { globals.insert(k.into(), v); }

        let mut functions: HashMap<String, (Vec<String>, Block)> = HashMap::new();
        let mut servo_vars: Vec<String> = Vec::new();

        // ── Collect top-level declarations ────────────────────────────────────
        for decl in &prog.decls {
            match decl {
                Decl::Const { name, val, .. } => {
                    let v = eval_const_expr(val, &globals);
                    globals.insert(name.clone(), v);
                }
                Decl::Var { name, ty, init, .. } => {
                    let v = init.as_ref()
                        .map(|e| eval_const_expr(e, &globals))
                        .unwrap_or(Value::Int(0));
                    globals.insert(name.clone(), v);
                    // Pre-register servo variables so s.Attach/Write work before any call
                    if let Some(tsuki_core::parser::ast::Type::Named(tn)) = ty {
                        if tn.to_ascii_lowercase().contains("servo") {
                            servo_vars.push(name.clone());
                        }
                    }
                }
                Decl::Func { name, sig, body: Some(body), recv: None, .. } => {
                    let params: Vec<String> = sig.params.iter()
                        .filter_map(|p| p.name.clone())
                        .collect();
                    functions.insert(name.clone(), (params, body.clone()));
                }
                _ => {}
            }
        }

        let mut servo_pins: HashMap<String, usize> = HashMap::new();
        for v in servo_vars { servo_pins.insert(v, usize::MAX); }

        Ok(Simulator {
            globals,
            functions,
            pins: PinState::default(),
            virtual_ms: 0.0,
            setup_done: false,
            vcc: 5.0,
            servo_pins,
            tone_pins: HashMap::new(),
        })
    }

    // ── Public accessor methods for tsuki-sim ─────────────────────────────────

    /// Set board-specific VCC (5V for AVR, 3.3V for ESP32/Pico)
    pub fn set_board(&mut self, board: &str) {
        self.vcc = match board.to_lowercase().as_str() {
            b if b.contains("esp32") || b.contains("esp8266")
              || b.contains("pico")  || b.contains("zero")
              || b.contains("mkr")   || b.contains("portenta")
              || b.contains("samd")  => 3.3,
            _ => 5.0,
        };
    }

    /// Returns the supply voltage for the configured board.
    pub fn vcc_volts(&self) -> f64 { self.vcc }

    /// Current simulated time in milliseconds (advances with delay() calls).
    pub fn virtual_ms(&self) -> f64 { self.virtual_ms }

    /// Returns a reference to the current pin state (for energy analysis).
    pub fn pin_state(&self) -> &PinState { &self.pins }

    /// Inject an analog input value for a given Arduino pin index.
    pub fn set_analog_input(&mut self, pin: usize, val: u16) {
        // Analog pins on Uno: A0=pin14, A1=pin15 … A5=pin19 → index 0-5
        let idx = if pin >= 14 && pin <= 19 { pin - 14 } else { pin };
        if idx < 6 { self.pins.analog_in[idx] = val.min(1023); }
    }

    /// Inject a digital input HIGH/LOW for a given Arduino pin index.
    pub fn set_digital_input(&mut self, pin: usize, high: bool) {
        if pin < 70 { self.pins.digital_in[pin] = high; }
    }

    /// Run one simulation step: setup() if first call, then loop() once.
    pub fn step(&mut self) -> StepResult {
        let mut events = Vec::new();
        let mut serial = Vec::new();

        if !self.setup_done {
            let flow = self.call_named("setup", vec![], &mut events, &mut serial);
            self.setup_done = true;
            if let Flow::Error(e) = flow {
                return StepResult { ok: false, error: Some(e), events, pins: self.pin_map(), serial, ms: self.virtual_ms };
            }
        }

        let flow = self.call_named("loop", vec![], &mut events, &mut serial);
        if let Flow::Error(e) = flow {
            return StepResult { ok: false, error: Some(e), events, pins: self.pin_map(), serial, ms: self.virtual_ms };
        }

        StepResult { ok: true, error: None, events, pins: self.pin_map(), serial, ms: self.virtual_ms }
    }

    fn pin_map(&self) -> HashMap<String, u16> {
        let mut m = HashMap::new();
        for i in 0..20usize { m.insert(i.to_string(), self.pins.get_value(i)); }
        m
    }

    // ── Function call ─────────────────────────────────────────────────────────

    fn call_named(&mut self, name: &str, args: Vec<Value>,
                  events: &mut Vec<SimEvent>, serial: &mut Vec<String>) -> Flow {
        let decl = self.functions.get(name).cloned();
        if let Some((params, body)) = decl {
            let mut locals: HashMap<String, Value> = HashMap::new();
            for (p, v) in params.iter().zip(args) { locals.insert(p.clone(), v); }
            match self.exec_block(&body, &mut locals, events, serial) {
                Flow::Return(_) | Flow::Continue => Flow::Continue,
                f => f,
            }
        } else {
            Flow::Continue // silently skip missing functions
        }
    }

    fn call_expr(&mut self, func: &Expr, args: Vec<Value>,
                 _locals: &mut HashMap<String, Value>,
                 events: &mut Vec<SimEvent>, serial: &mut Vec<String>) -> Value {
        match func {
            // pkg.method() — single select
            Expr::Select { expr, field, .. } => {
                match expr.as_ref() {
                    // arduino.Serial.Println() — double select
                    Expr::Select { expr: inner, field: sub, .. } => {
                        let pkg = match inner.as_ref() {
                            Expr::Ident { name, .. } => name.as_str(),
                            _ => "",
                        };
                        self.call_builtin(pkg, sub, field, args, events, serial)
                    }
                    Expr::Ident { name: pkg, .. } => {
                        self.call_builtin(pkg, "", field, args, events, serial)
                    }
                    _ => Value::Nil,
                }
            }
            Expr::Ident { name, .. } => {
                let fn_args = args;
                // Check globals for function value first? No — functions are in functions map.
                let flow = self.call_named(name, fn_args, events, serial);
                if let Flow::Return(v) = flow { v } else { Value::Nil }
            }
            _ => Value::Nil,
        }
    }

    /// Central dispatch for all built-in calls.
    /// pkg = top-level package ("arduino", "fmt", "Serial", …)
    /// sub = sub-object if any ("Serial" in arduino.Serial.Println → sub="Serial")
    /// method = the function name
    fn call_builtin(&mut self, pkg: &str, sub: &str, method: &str,
                    args: Vec<Value>,
                    events: &mut Vec<SimEvent>, serial: &mut Vec<String>) -> Value {
        // Normalise method to lowercase for case-insensitive matching
        let m = method.to_ascii_lowercase();
        let m = m.as_str();

        // arduino.Serial.X  or  Serial.X
        let is_serial = (pkg == "arduino" && sub.to_ascii_lowercase() == "serial")
            || (pkg.to_ascii_lowercase() == "serial" && sub.is_empty())
            || (pkg.to_ascii_lowercase() == "serial");

        if is_serial {
            return self.serial_builtin(m, args, events, serial);
        }

        // fmt.X  (Println → serial)
        if pkg == "fmt" {
            return self.serial_builtin(m, args, events, serial);
        }

        // arduino.X  or  bare call (empty pkg)
        if pkg == "arduino" || pkg.is_empty() {
            return self.arduino_builtin(m, args, events);
        }

        // time.X  (Delay, Sleep, Milliseconds → arduino delay)
        if pkg == "time" {
            match m {
                "sleep" | "delay" => {
                    let ms = args.get(0).map(|v| v.as_f64()).unwrap_or(0.0);
                    self.do_delay(ms, events);
                    return Value::Nil;
                }
                "milliseconds" => {
                    let ms = args.get(0).map(|v| v.as_f64()).unwrap_or(0.0);
                    return Value::Float(ms);
                }
                _ => return Value::Nil,
            }
        }

        // math.X
        if pkg == "math" {
            return self.math_builtin(m, args);
        }

        // Servo library — three calling conventions:
        //   Package-style:  Servo.Attach(s, pin)   pkg="Servo" sub=""      ao=1
        //   Method-style A: s.Attach(pin)           pkg="s"     sub=""      ao=0 (pre-registered)
        //   Method-style B: s.Attach(pin) dbl-sel   pkg="s"     sub="Servo" ao=0
        let pkg_lower = pkg.to_ascii_lowercase();
        let sub_lower = sub.to_ascii_lowercase();
        let is_pkg_servo     = pkg_lower == "servo";
        let is_sub_servo     = sub_lower == "servo";
        let is_known_servo   = self.servo_pins.contains_key(pkg);
        if is_pkg_servo || is_sub_servo || is_known_servo {
            let var_name = if is_pkg_servo && !is_sub_servo {
                if sub.is_empty() { "Servo".to_string() } else { sub.to_string() }
            } else if is_sub_servo {
                pkg.to_string()
            } else {
                pkg.to_string()
            };
            let ao: usize = if is_pkg_servo { 1 } else { 0 };
            match m {
                "attach" => {
                    let pin = args.get(ao).map(|v| v.as_int() as usize).unwrap_or(0);
                    self.servo_pins.insert(var_name, pin);
                    return Value::Nil;
                }
                "write" => {
                    let angle = args.get(ao).map(|v| v.as_f64()).unwrap_or(0.0)
                        .clamp(0.0, 180.0) as u16;
                    if let Some(&pin) = self.servo_pins.get(&var_name) {
                        if pin != usize::MAX {
                            self.pins.set_value(pin, angle);
                            events.push(SimEvent {
                                t_ms: self.virtual_ms, kind: "aw".into(),
                                pin: Some(pin as u8), val: Some(angle), msg: None,
                            });
                        }
                    }
                    return Value::Nil;
                }
                "read" => {
                    if let Some(&pin) = self.servo_pins.get(&var_name) {
                        if pin != usize::MAX { return Value::Int(self.pins.get_value(pin) as i64); }
                    }
                    return Value::Int(0);
                }
                "writemicroseconds" => {
                    let us = args.get(ao).map(|v| v.as_f64()).unwrap_or(1500.0).clamp(500.0, 2500.0);
                    let angle = ((us - 500.0) / 2000.0 * 180.0) as u16;
                    if let Some(&pin) = self.servo_pins.get(&var_name) {
                        if pin != usize::MAX {
                            self.pins.set_value(pin, angle);
                            events.push(SimEvent {
                                t_ms: self.virtual_ms, kind: "aw".into(),
                                pin: Some(pin as u8), val: Some(angle), msg: None,
                            });
                        }
                    }
                    return Value::Nil;
                }
                _ => return Value::Nil,
            }
        }

        // Unknown — try as user function
        if !pkg.is_empty() && sub.is_empty() {
            // Could be a user-defined function named `method` in package `pkg`
            let qualified = format!("{}.{}", pkg, method);
            let flow = self.call_named(&qualified, args.clone(), events, serial);
            if let Flow::Return(v) = flow { return v; }
        }
        let flow = self.call_named(method, args, events, serial);
        if let Flow::Return(v) = flow { v } else { Value::Nil }
    }

    fn arduino_builtin(&mut self, m: &str, args: Vec<Value>, events: &mut Vec<SimEvent>) -> Value {
        match m {
            "pinmode" => {
                let pin  = args.get(0).map(|v| v.as_int() as usize).unwrap_or(0);
                let mode = args.get(1).map(|v| v.as_int() as u8).unwrap_or(0);
                self.pins.set_mode(pin, mode);
                Value::Nil
            }
            "digitalwrite" => {
                let pin = args.get(0).map(|v| v.as_int() as usize).unwrap_or(0);
                let val = args.get(1).map(|v| v.as_int() as u16).unwrap_or(0).min(1);
                self.pins.set_value(pin, val);
                events.push(SimEvent {
                    t_ms: self.virtual_ms, kind: "dw".into(),
                    pin: Some(pin as u8), val: Some(val), msg: None,
                });
                Value::Nil
            }
            "digitalread" => {
                let pin = args.get(0).map(|v| v.as_int() as usize).unwrap_or(0);
                Value::Int(if self.pins.get_digital_in(pin) { 1 } else { 0 })
            }
            "analogwrite" => {
                let pin = args.get(0).map(|v| v.as_int() as usize).unwrap_or(0);
                let val = args.get(1).map(|v| v.as_int() as u16).unwrap_or(0).min(255);
                self.pins.set_value(pin, val);
                events.push(SimEvent {
                    t_ms: self.virtual_ms, kind: "aw".into(),
                    pin: Some(pin as u8), val: Some(val), msg: None,
                });
                Value::Nil
            }
            "analogread" => {
                let pin = args.get(0).map(|v| v.as_int() as usize).unwrap_or(0);
                // A0-A5 passed as 14-19 (Uno mapping); normalise to 0-5
                let idx = if pin >= 14 { pin - 14 } else { pin };
                let v = if idx < 6 { self.pins.analog_in[idx] as i64 } else { 0 };
                Value::Int(v)
            }
            "delay" => {
                let ms = args.get(0).map(|v| v.as_f64()).unwrap_or(0.0);
                self.do_delay(ms, events);
                Value::Nil
            }
            "delaymicroseconds" => {
                let us = args.get(0).map(|v| v.as_f64()).unwrap_or(0.0);
                self.virtual_ms += us / 1000.0;
                Value::Nil
            }
            "millis" => Value::Float(self.virtual_ms),
            "micros" => Value::Float(self.virtual_ms * 1000.0),
            "map" => {
                let v  = args.get(0).map(|v| v.as_f64()).unwrap_or(0.0);
                let il = args.get(1).map(|v| v.as_f64()).unwrap_or(0.0);
                let ih = args.get(2).map(|v| v.as_f64()).unwrap_or(1.0);
                let ol = args.get(3).map(|v| v.as_f64()).unwrap_or(0.0);
                let oh = args.get(4).map(|v| v.as_f64()).unwrap_or(1.0);
                if (ih - il).abs() < f64::EPSILON { return Value::Float(ol); }
                Value::Float((v - il) / (ih - il) * (oh - ol) + ol)
            }
            "constrain" => {
                let v  = args.get(0).map(|v| v.as_f64()).unwrap_or(0.0);
                let lo = args.get(1).map(|v| v.as_f64()).unwrap_or(0.0);
                let hi = args.get(2).map(|v| v.as_f64()).unwrap_or(0.0);
                Value::Float(v.clamp(lo, hi))
            }
            "abs"  => { let v = args.get(0).map(|v| v.as_f64()).unwrap_or(0.0); Value::Float(v.abs()) }
            "min"  => { let a = args.get(0).map(|v| v.as_f64()).unwrap_or(0.0); let b = args.get(1).map(|v| v.as_f64()).unwrap_or(0.0); Value::Float(a.min(b)) }
            "max"  => { let a = args.get(0).map(|v| v.as_f64()).unwrap_or(0.0); let b = args.get(1).map(|v| v.as_f64()).unwrap_or(0.0); Value::Float(a.max(b)) }
            "sqrt" => { let v = args.get(0).map(|v| v.as_f64()).unwrap_or(0.0); Value::Float(v.sqrt()) }
            "pow"  => { let b = args.get(0).map(|v| v.as_f64()).unwrap_or(0.0); let e = args.get(1).map(|v| v.as_f64()).unwrap_or(0.0); Value::Float(b.powf(e)) }
            "random" => { let hi = args.get(0).map(|v| v.as_int()).unwrap_or(100); Value::Int(hi / 3) }
            "tone" => {
                let pin  = args.get(0).map(|v| v.as_int() as usize).unwrap_or(0);
                let freq = args.get(1).map(|v| v.as_int() as u32).unwrap_or(1000).max(1);
                let val  = freq.min(65535) as u16;
                self.tone_pins.insert(pin, freq);
                self.pins.set_value(pin, val);
                events.push(SimEvent {
                    t_ms: self.virtual_ms, kind: "aw".into(),
                    pin: Some(pin as u8), val: Some(val), msg: None,
                });
                Value::Nil
            }
            "notone" => {
                let pin = args.get(0).map(|v| v.as_int() as usize).unwrap_or(0);
                self.tone_pins.remove(&pin);
                self.pins.set_value(pin, 0);
                events.push(SimEvent {
                    t_ms: self.virtual_ms, kind: "dw".into(),
                    pin: Some(pin as u8), val: Some(0), msg: None,
                });
                Value::Nil
            }
            "attachinterrupt" | "detachinterrupt" | "interrupts" | "nointerrupts" => Value::Nil,
            "serial" => Value::Nil, // arduino.Serial accessed as object — handled by double-select
            _ => Value::Nil,
        }
    }

    fn serial_builtin(&mut self, m: &str, args: Vec<Value>,
                      events: &mut Vec<SimEvent>, serial: &mut Vec<String>) -> Value {
        match m {
            "begin" => Value::Nil, // Serial.begin(baud) — no-op in sim
            "println" => {
                let msg = if args.is_empty() {
                    String::new()
                } else {
                    args.iter().map(|v| v.to_display()).collect::<Vec<_>>().join(" ")
                };
                serial.push(msg.clone());
                events.push(SimEvent { t_ms: self.virtual_ms, kind: "serial".into(), pin: None, val: None, msg: Some(msg) });
                Value::Nil
            }
            "print" => {
                let msg = args.iter().map(|v| v.to_display()).collect::<Vec<_>>().join("");
                serial.push(msg.clone());
                events.push(SimEvent { t_ms: self.virtual_ms, kind: "serial".into(), pin: None, val: None, msg: Some(msg) });
                Value::Nil
            }
            "printf" => {
                // Very basic: just join the args
                let msg = args.iter().map(|v| v.to_display()).collect::<Vec<_>>().join(" ");
                serial.push(msg.clone());
                events.push(SimEvent { t_ms: self.virtual_ms, kind: "serial".into(), pin: None, val: None, msg: Some(msg) });
                Value::Nil
            }
            "available" => Value::Int(0),
            "read"      => Value::Int(-1),
            "write"     => Value::Nil,
            "flush"     => Value::Nil,
            _ => Value::Nil,
        }
    }

    fn math_builtin(&self, m: &str, args: Vec<Value>) -> Value {
        let a = args.get(0).map(|v| v.as_f64()).unwrap_or(0.0);
        match m {
            "abs"   => Value::Float(a.abs()),
            "sqrt"  => Value::Float(a.sqrt()),
            "floor" => Value::Float(a.floor()),
            "ceil"  => Value::Float(a.ceil()),
            "round" => Value::Float(a.round()),
            "sin"   => Value::Float(a.sin()),
            "cos"   => Value::Float(a.cos()),
            "tan"   => Value::Float(a.tan()),
            "log"   => Value::Float(a.ln()),
            "log2"  => Value::Float(a.log2()),
            "log10" => Value::Float(a.log10()),
            "pow"   => {
                let b = args.get(1).map(|v| v.as_f64()).unwrap_or(0.0);
                Value::Float(a.powf(b))
            }
            "mod" => {
                let b = args.get(1).map(|v| v.as_f64()).unwrap_or(1.0);
                Value::Float(a % b)
            }
            "pi" => Value::Float(std::f64::consts::PI),
            _ => Value::Nil,
        }
    }

    fn do_delay(&mut self, ms: f64, events: &mut Vec<SimEvent>) {
        self.virtual_ms += ms;
        events.push(SimEvent {
            t_ms: self.virtual_ms,
            kind: "delay".into(),
            pin: None,
            val: None,
            msg: Some(format!("{}", ms)),
        });
    }

    // ── Statement execution ───────────────────────────────────────────────────

    fn exec_block(&mut self, block: &Block, locals: &mut HashMap<String, Value>,
                  events: &mut Vec<SimEvent>, serial: &mut Vec<String>) -> Flow {
        for stmt in &block.stmts {
            match self.exec_stmt(stmt, locals, events, serial) {
                Flow::Continue => {}
                f => return f,
            }
        }
        Flow::Continue
    }

    fn exec_stmt(&mut self, stmt: &Stmt, locals: &mut HashMap<String, Value>,
                 events: &mut Vec<SimEvent>, serial: &mut Vec<String>) -> Flow {
        match stmt {
            Stmt::Expr { expr, .. } => {
                self.eval(expr, locals, events, serial);
                Flow::Continue
            }

            Stmt::VarDecl { name, init, .. } => {
                let v = init.as_ref()
                    .map(|e| self.eval(e, locals, events, serial))
                    .unwrap_or(Value::Int(0));
                locals.insert(name.clone(), v);
                Flow::Continue
            }

            Stmt::ConstDecl { name, val, .. } => {
                let v = self.eval(val, locals, events, serial);
                locals.insert(name.clone(), v);
                Flow::Continue
            }

            Stmt::ShortDecl { names, vals, .. } => {
                let evaled: Vec<Value> = vals.iter()
                    .map(|e| self.eval(e, locals, events, serial))
                    .collect();
                for (n, v) in names.iter().zip(evaled) {
                    locals.insert(n.clone(), v);
                }
                Flow::Continue
            }

            Stmt::Assign { lhs, rhs, op, .. } => {
                let rvals: Vec<Value> = rhs.iter()
                    .map(|e| self.eval(e, locals, events, serial))
                    .collect();
                for (l, r) in lhs.iter().zip(rvals) {
                    if let Expr::Ident { name, .. } = l {
                        let new_val = if *op == AssignOp::Plain {
                            r
                        } else {
                            let cur = self.get_var(name, locals);
                            self.apply_assign_op(op, cur, r)
                        };
                        self.set_var(name, new_val, locals);
                    }
                    // TODO: index/select assignment — not needed for basic sim
                }
                Flow::Continue
            }

            Stmt::Inc { expr, .. } => {
                if let Expr::Ident { name, .. } = expr {
                    let v = self.get_var(name, locals);
                    let nv = match v { Value::Int(n) => Value::Int(n + 1), _ => Value::Int(1) };
                    self.set_var(name, nv, locals);
                }
                Flow::Continue
            }

            Stmt::Dec { expr, .. } => {
                if let Expr::Ident { name, .. } = expr {
                    let v = self.get_var(name, locals);
                    let nv = match v { Value::Int(n) => Value::Int(n - 1), _ => Value::Int(-1) };
                    self.set_var(name, nv, locals);
                }
                Flow::Continue
            }

            Stmt::Return { vals, .. } => {
                let v = vals.first()
                    .map(|e| self.eval(e, locals, events, serial))
                    .unwrap_or(Value::Nil);
                Flow::Return(v)
            }

            Stmt::Break    { .. } => Flow::Break,
            Stmt::Continue { .. } => Flow::ContinueLoop,

            Stmt::If { init, cond, then, else_, .. } => {
                let mut inner = locals.clone();
                if let Some(i) = init { self.exec_stmt(i, &mut inner, events, serial); }
                let cv = self.eval(cond, &mut inner, events, serial);
                if cv.truthy() {
                    self.exec_block(then, &mut inner, events, serial)
                } else if let Some(e) = else_ {
                    self.exec_stmt(e, &mut inner, events, serial)
                } else {
                    Flow::Continue
                }
            }

            Stmt::For { init, cond, post, body, .. } => {
                let mut inner = locals.clone();
                if let Some(i) = init { self.exec_stmt(i, &mut inner, events, serial); }
                let mut limit = 100_000usize;
                loop {
                    if let Some(c) = cond {
                        if !self.eval(c, &mut inner, events, serial).truthy() { break; }
                    }
                    match self.exec_block(body, &mut inner, events, serial) {
                        Flow::Break          => break,
                        Flow::Return(v)      => { *locals = inner; return Flow::Return(v); }
                        Flow::Error(e)       => { *locals = inner; return Flow::Error(e); }
                        Flow::Continue | Flow::ContinueLoop => {}
                    }
                    if let Some(p) = post { self.exec_stmt(p, &mut inner, events, serial); }
                    limit -= 1;
                    if limit == 0 { break; }
                }
                *locals = inner;
                Flow::Continue
            }

            Stmt::Range { key, val: val_name, iter, body, .. } => {
                let iter_val = self.eval(iter, locals, events, serial);
                let count = iter_val.as_int().max(0) as usize;
                let mut inner = locals.clone();
                for i in 0..count.min(10_000) {
                    if let Some(k) = key { inner.insert(k.clone(), Value::Int(i as i64)); }
                    if let Some(v) = val_name { inner.insert(v.clone(), Value::Int(i as i64)); }
                    match self.exec_block(body, &mut inner, events, serial) {
                        Flow::Break     => break,
                        Flow::Return(v) => { *locals = inner; return Flow::Return(v); }
                        Flow::Error(e)  => { *locals = inner; return Flow::Error(e); }
                        _               => {}
                    }
                }
                *locals = inner;
                Flow::Continue
            }

            Stmt::Switch { init, tag, cases, .. } => {
                let mut inner = locals.clone();
                if let Some(i) = init { self.exec_stmt(i, &mut inner, events, serial); }
                let tag_val = tag.as_ref()
                    .map(|e| self.eval(e, &mut inner, events, serial))
                    .unwrap_or(Value::Bool(true));

                // Separate non-default cases from the default case (empty exprs).
                // Try non-default first; fall back to default if nothing matched.
                let mut exec_body: Option<&Vec<Stmt>> = None;
                let mut default_body: Option<&Vec<Stmt>> = None;

                for case in cases {
                    if case.exprs.is_empty() {
                        default_body = Some(&case.body);
                    } else {
                        let hit = case.exprs.iter().any(|e| {
                            let v = self.eval(e, &mut inner, events, serial);
                            vals_eq(&tag_val, &v)
                        });
                        if hit { exec_body = Some(&case.body); break; }
                    }
                }

                let body = exec_body.or(default_body);
                if let Some(stmts) = body {
                    for s in stmts {
                        match self.exec_stmt(s, &mut inner, events, serial) {
                            Flow::Continue => {}
                            f => { *locals = inner; return f; }
                        }
                    }
                }
                *locals = inner;
                Flow::Continue
            }

            Stmt::Block(b) => {
                let mut inner = locals.clone();
                let f = self.exec_block(b, &mut inner, events, serial);
                *locals = inner;
                f
            }

            // Ignored in simulation
            Stmt::Defer { .. } | Stmt::Go { .. } | Stmt::Goto { .. } | Stmt::Label { .. } => {
                Flow::Continue
            }
        }
    }

    // ── Expression evaluation ─────────────────────────────────────────────────

    fn eval(&mut self, expr: &Expr, locals: &mut HashMap<String, Value>,
            events: &mut Vec<SimEvent>, serial: &mut Vec<String>) -> Value {
        match expr {
            Expr::Int(n)   => Value::Int(*n),
            Expr::Float(f) => Value::Float(*f),
            Expr::Str(s)   => Value::Str(s.clone()),
            Expr::Bool(b)  => Value::Bool(*b),
            Expr::Nil      => Value::Nil,
            Expr::Rune(c)  => Value::Int(*c as i64),

            Expr::Ident { name, .. } => self.get_var(name, locals),

            Expr::Select { expr, field, .. } => {
                // Could be arduino.HIGH, arduino.OUTPUT etc (constant access, no call)
                let pkg = match expr.as_ref() { Expr::Ident { name, .. } => name.as_str(), _ => "" };
                match (pkg, field.as_str()) {
                    ("arduino"|"", "HIGH")        => Value::Int(1),
                    ("arduino"|"", "LOW")         => Value::Int(0),
                    ("arduino"|"", "OUTPUT")      => Value::Int(1),
                    ("arduino"|"", "INPUT")       => Value::Int(0),
                    ("arduino"|"", "INPUT_PULLUP")=> Value::Int(2),
                    ("arduino"|"", "LED_BUILTIN") => Value::Int(13),
                    ("arduino"|"", "A0")          => Value::Int(14),
                    ("arduino"|"", "A1")          => Value::Int(15),
                    ("arduino"|"", "A2")          => Value::Int(16),
                    ("arduino"|"", "A3")          => Value::Int(17),
                    ("arduino"|"", "A4")          => Value::Int(18),
                    ("arduino"|"", "A5")          => Value::Int(19),
                    _ => Value::Nil, // struct field access etc.
                }
            }

            Expr::Call { func, args, .. } => {
                let arg_vals: Vec<Value> = args.iter()
                    .map(|a| self.eval(a, locals, events, serial))
                    .collect();
                self.call_expr(func, arg_vals, locals, events, serial)
            }

            Expr::Binary { op, lhs, rhs, .. } => {
                // Short-circuit &&, ||
                match op {
                    BinOp::And => {
                        let l = self.eval(lhs, locals, events, serial);
                        if !l.truthy() { return Value::Bool(false); }
                        let r = self.eval(rhs, locals, events, serial);
                        return Value::Bool(r.truthy());
                    }
                    BinOp::Or => {
                        let l = self.eval(lhs, locals, events, serial);
                        if l.truthy() { return Value::Bool(true); }
                        let r = self.eval(rhs, locals, events, serial);
                        return Value::Bool(r.truthy());
                    }
                    _ => {}
                }
                let l = self.eval(lhs, locals, events, serial);
                let r = self.eval(rhs, locals, events, serial);
                self.apply_binop(op, l, r)
            }

            Expr::Unary { op, expr, .. } => {
                let v = self.eval(expr, locals, events, serial);
                match op {
                    UnOp::Neg    => match v { Value::Int(n) => Value::Int(-n), Value::Float(f) => Value::Float(-f), _ => Value::Int(0) },
                    UnOp::Not    => Value::Bool(!v.truthy()),
                    UnOp::BitNot => Value::Int(!v.as_int()),
                    UnOp::Deref  => v, // simplified
                    UnOp::Addr   => v, // simplified
                    _            => v,
                }
            }

            // Composite literal — just return nil; not needed for basic sim
            Expr::Composite { .. } | Expr::FuncLit { .. } | Expr::TypeAssert { .. }
            | Expr::Index { .. } | Expr::Slice { .. } | Expr::Raw(_) => Value::Nil,
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn get_var(&self, name: &str, locals: &HashMap<String, Value>) -> Value {
        locals.get(name)
            .or_else(|| self.globals.get(name))
            .cloned()
            .unwrap_or(Value::Int(0))
    }

    fn set_var(&mut self, name: &str, val: Value, locals: &mut HashMap<String, Value>) {
        if locals.contains_key(name) {
            locals.insert(name.to_string(), val);
        } else {
            self.globals.insert(name.to_string(), val);
        }
    }

    fn apply_binop(&self, op: &BinOp, l: Value, r: Value) -> Value {
        match op {
            BinOp::Add => match (&l, &r) {
                (Value::Str(a), _) => Value::Str(format!("{}{}", a, r.to_display())),
                (_, Value::Str(b)) => Value::Str(format!("{}{}", l.to_display(), b)),
                _ => arith(op, l, r),
            },
            BinOp::Eq  => Value::Bool(vals_eq(&l, &r)),
            BinOp::Ne  => Value::Bool(!vals_eq(&l, &r)),
            BinOp::Lt  => Value::Bool(l.as_f64() <  r.as_f64()),
            BinOp::Le  => Value::Bool(l.as_f64() <= r.as_f64()),
            BinOp::Gt  => Value::Bool(l.as_f64() >  r.as_f64()),
            BinOp::Ge  => Value::Bool(l.as_f64() >= r.as_f64()),
            _ => arith(op, l, r),
        }
    }

    fn apply_assign_op(&self, op: &AssignOp, cur: Value, rhs: Value) -> Value {
        let binop = match op {
            AssignOp::Add    => BinOp::Add,    AssignOp::Sub    => BinOp::Sub,
            AssignOp::Mul    => BinOp::Mul,    AssignOp::Div    => BinOp::Div,
            AssignOp::Rem    => BinOp::Rem,
            AssignOp::BitAnd => BinOp::BitAnd, AssignOp::BitOr  => BinOp::BitOr,
            AssignOp::BitXor => BinOp::BitXor, AssignOp::Shl    => BinOp::Shl,
            AssignOp::Shr    => BinOp::Shr,
            _ => return rhs,
        };
        self.apply_binop(&binop, cur, rhs)
    }
}

// ── Free arithmetic helper ────────────────────────────────────────────────────

fn arith(op: &BinOp, l: Value, r: Value) -> Value {
    if matches!((&l, &r), (Value::Float(_), _) | (_, Value::Float(_))) {
        let (a, b) = (l.as_f64(), r.as_f64());
        return Value::Float(match op {
            BinOp::Add => a + b, BinOp::Sub => a - b,
            BinOp::Mul => a * b,
            BinOp::Div => if b == 0.0 { 0.0 } else { a / b },
            BinOp::Rem => if b == 0.0 { 0.0 } else { a % b },
            BinOp::Shl => ((a as i64) << (b as i64)) as f64,
            BinOp::Shr => ((a as i64) >> (b as i64)) as f64,
            _          => a,
        });
    }
    let (a, b) = (l.as_int(), r.as_int());
    Value::Int(match op {
        BinOp::Add      => a.wrapping_add(b),
        BinOp::Sub      => a.wrapping_sub(b),
        BinOp::Mul      => a.wrapping_mul(b),
        BinOp::Div      => if b == 0 { 0 } else { a / b },
        BinOp::Rem      => if b == 0 { 0 } else { a % b },
        BinOp::BitAnd   => a & b,
        BinOp::BitOr    => a | b,
        BinOp::BitXor   => a ^ b,
        BinOp::BitAndNot=> a & !b,
        BinOp::Shl      => a.wrapping_shl(b as u32),
        BinOp::Shr      => a.wrapping_shr(b as u32),
        _               => a,
    })
}

// ── Const expression evaluator (for top-level initialisation) ─────────────────

fn eval_const_expr(expr: &Expr, globals: &HashMap<String, Value>) -> Value {
    match expr {
        Expr::Int(n)   => Value::Int(*n),
        Expr::Float(f) => Value::Float(*f),
        Expr::Str(s)   => Value::Str(s.clone()),
        Expr::Bool(b)  => Value::Bool(*b),
        Expr::Rune(c)  => Value::Int(*c as i64),
        Expr::Nil      => Value::Nil,
        Expr::Ident { name, .. } => globals.get(name.as_str()).cloned().unwrap_or(Value::Int(0)),
        Expr::Unary { op: UnOp::Neg, expr, .. } => {
            match eval_const_expr(expr, globals) {
                Value::Int(n)   => Value::Int(-n),
                Value::Float(f) => Value::Float(-f),
                v               => v,
            }
        }
        Expr::Binary { op, lhs, rhs, .. } => {
            let l = eval_const_expr(lhs, globals);
            let r = eval_const_expr(rhs, globals);
            arith(op, l, r)
        }
        _ => Value::Int(0),
    }
}