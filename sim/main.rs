// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-sim  —  Arduino simulation engine for the tsuki IDE sandbox
//
//  Pipeline:
//    .go  →  tsuki-core --emit-sim out.sim.json  →  tsuki-sim --bundle out.sim.json
//
//  tsuki-sim reads the .sim.json bundle produced by tsuki-core (which contains
//  the original source, board name, and transpiled C++).  It re-parses the
//  Go source using tsuki_core and runs the AST interpreter.
//
//  NDJSON protocol (one JSON object per stdout line):
//
//  Normal step:
//    {"ok":true,"events":[...],"pins":{"13":1},"serial":["hi"],
//     "ms":500,"energy":{"voltage":{"13":5.0},"current":{"13":0.023}}}
//
//  Error:
//    {"ok":false,"error":"parse error: ...","events":[],"pins":{},"serial":[],"ms":0}
//
//  Stdin input (IDE → simulator, one JSON line):
//    {"type":"analog",  "pin":0,"val":512}
//    {"type":"digital", "pin":2,"val":1}
//
//  Usage:
//    tsuki-sim --bundle <file.sim.json> [--steps 1000] [--energy] [--output-every 50]
// ─────────────────────────────────────────────────────────────────────────────

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use std::collections::HashMap;
use clap::Parser;

use tsuki_core::lexer::Lexer;
use tsuki_core::parser::Parser as TsukiParser;

mod simulator;
use simulator::{Simulator, StepResult, EnergyInfo};

// ─────────────────────────────────────────────────────────────────────────────
//  CLI definition
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(
    name    = "tsuki-sim",
    version = env!("CARGO_PKG_VERSION"),
    about   = "Arduino firmware simulator for the tsuki IDE sandbox",
    long_about = "Reads the .sim.json bundle produced by `tsuki-core --emit-sim` and \
                  runs the AST interpreter, emitting NDJSON on stdout.",
)]
struct Cli {
    /// .sim.json bundle emitted by tsuki-core --emit-sim
    #[arg(short = 'b', long = "bundle", value_name = "FILE")]
    bundle: PathBuf,

    /// Override board from the bundle (optional)
    #[arg(long = "board", value_name = "BOARD")]
    board: Option<String>,

    /// Stop after N loop() iterations (0 = run indefinitely)
    #[arg(long = "steps", default_value = "0")]
    steps: usize,

    /// Emit energy/current-flow data in each StepResult
    #[arg(long = "energy")]
    energy: bool,

    /// Emit a StepResult every N loop() calls (1 = every call, higher = less noise)
    #[arg(long = "output-every", default_value = "1")]
    output_every: usize,

    /// Maximum simulated milliseconds before stopping (0 = unlimited)
    #[arg(long = "max-ms", default_value = "0")]
    max_ms: f64,

    /// Disable reading analog/digital input from stdin
    #[arg(long = "no-stdin")]
    no_stdin: bool,
}

// ─────────────────────────────────────────────────────────────────────────────
//  Shared input state (written by stdin thread, read by sim loop)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Default, Clone)]
struct InputState {
    analog:  HashMap<usize, u16>,   // pin → 0-1023
    digital: HashMap<usize, bool>,  // pin → HIGH/LOW
}

// ─────────────────────────────────────────────────────────────────────────────
//  JSON emit helpers
// ─────────────────────────────────────────────────────────────────────────────

fn emit_error(msg: &str) {
    let json = serde_json::json!({
        "ok":     false,
        "error":  msg,
        "events": [],
        "pins":   {},
        "serial": [],
        "ms":     0
    });
    println!("{}", json);
    let _ = std::io::stdout().flush();
}

fn emit_result(result: &StepResult, energy: Option<&EnergyInfo>, out: &mut impl Write) {
    let pins_json: serde_json::Map<String, serde_json::Value> = result.pins
        .iter()
        .map(|(k, v)| (k.clone(), serde_json::Value::Number((*v).into())))
        .collect();

    let events_json: Vec<serde_json::Value> = result.events.iter().map(|e| {
        let mut obj = serde_json::json!({
            "t_ms": e.t_ms,
            "kind": e.kind,
        });
        if let Some(p) = e.pin  { obj["pin"] = serde_json::json!(p); }
        if let Some(v) = e.val  { obj["val"] = serde_json::json!(v); }
        if let Some(m) = &e.msg { obj["msg"] = serde_json::json!(m); }
        obj
    }).collect();

    let mut root = serde_json::json!({
        "ok":     result.ok,
        "events": events_json,
        "pins":   pins_json,
        "serial": result.serial,
        "ms":     result.ms,
    });
    if let Some(err) = &result.error {
        root["error"] = serde_json::json!(err);
    }

    // ── Optional energy data ──────────────────────────────────────────────────
    if let Some(e) = energy {
        let volt_json: serde_json::Map<String, serde_json::Value> = e.voltage
            .iter()
            .map(|(k, v)| (k.to_string(), serde_json::json!(v)))
            .collect();
        let curr_json: serde_json::Map<String, serde_json::Value> = e.current
            .iter()
            .map(|(k, v)| (k.to_string(), serde_json::json!(v)))
            .collect();
        let power_json: serde_json::Map<String, serde_json::Value> = e.power_mw
            .iter()
            .map(|(k, v)| (k.to_string(), serde_json::json!(v)))
            .collect();

        root["energy"] = serde_json::json!({
            "voltage":  volt_json,
            "current":  curr_json,
            "power_mw": power_json,
            "total_mw": e.total_mw,
        });
    }

    let line = serde_json::to_string(&root).unwrap_or_else(|_| {
        r#"{"ok":false,"error":"json serialisation failed","events":[],"pins":{},"serial":[],"ms":0}"#.into()
    });
    let _ = writeln!(out, "{}", line);
    let _ = out.flush();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Stdin listener thread
// ─────────────────────────────────────────────────────────────────────────────

fn spawn_stdin_listener(state: Arc<Mutex<InputState>>) {
    thread::spawn(move || {
        let stdin  = std::io::stdin();
        let reader = BufReader::new(stdin.lock());
        for line in reader.lines() {
            let line = match line { Ok(l) => l, Err(_) => break };
            let line = line.trim().to_string();
            if line.is_empty() { continue; }

            let v: serde_json::Value = match serde_json::from_str(&line) {
                Ok(v)  => v,
                Err(_) => continue,
            };

            let pin = match v["pin"].as_u64() { Some(p) => p as usize, None => continue };
            let kind = v["type"].as_str().unwrap_or("");

            let mut st = match state.lock() { Ok(g) => g, Err(_) => break };
            match kind {
                "analog" => {
                    let val = v["val"].as_u64().unwrap_or(0).min(1023) as u16;
                    st.analog.insert(pin, val);
                }
                "digital" => {
                    let high = match v["val"].as_u64() {
                        Some(1) => true,
                        Some(0) => false,
                        _       => v["val"].as_bool().unwrap_or(false),
                    };
                    st.digital.insert(pin, high);
                }
                _ => {}
            }
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Energy computation
//  Simplified model: treats each OUTPUT HIGH pin as driving 5V through an
//  assumed load. Without circuit topology, we estimate from the pin mode and
//  value. Actual component-level accuracy requires the circuit JSON from the
//  IDE; when that is available it can be piped via stdin in the future.
// ─────────────────────────────────────────────────────────────────────────────

fn compute_energy(sim: &Simulator) -> EnergyInfo {
    let mut info = EnergyInfo::default();

    let pins = sim.pin_state();
    let vcc  = sim.vcc_volts(); // 5.0 for Uno/Nano/Mega, 3.3 for others

    for idx in 0..70usize {
        let mode = pins.modes[idx];
        let val  = pins.values[idx];

        if mode != 1 { continue; } // only OUTPUT pins drive voltage

        // Scale PWM (0-255) or digital (0/1)
        let duty: f64 = if val <= 1 {
            val as f64
        } else {
            (val as f64) / 255.0
        };

        let voltage = duty * vcc;

        // Estimate current:
        //  • Assume standard 220Ω series resistor + LED (2V drop) → ~13 mA
        //  • Without topology, use a conservative 10 mA when HIGH
        let current_a: f64 = if voltage > 0.1 { 0.010 } else { 0.0 };
        let power_mw = voltage * current_a * 1000.0;

        info.voltage.insert(idx, voltage);
        if current_a > 0.0 {
            info.current.insert(idx, current_a);
            info.power_mw.insert(idx, power_mw);
            info.total_mw += power_mw;
        }
    }

    info
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────────────────────────

fn main() {
    let cli = Cli::parse();

    // ── Read .sim.json bundle ─────────────────────────────────────────────────
    let bundle_raw = match std::fs::read_to_string(&cli.bundle) {
        Ok(s) => s,
        Err(e) => {
            emit_error(&format!("cannot read bundle {}: {}", cli.bundle.display(), e));
            std::process::exit(1);
        }
    };
    let bundle: serde_json::Value = match serde_json::from_str(&bundle_raw) {
        Ok(v) => v,
        Err(e) => {
            emit_error(&format!("invalid sim bundle: {}", e));
            std::process::exit(1);
        }
    };

    let source = match bundle["source"].as_str() {
        Some(s) => s.to_string(),
        None => {
            emit_error("sim bundle missing 'source' field");
            std::process::exit(1);
        }
    };
    let filename = bundle["filename"].as_str().unwrap_or("main.go").to_string();
    // --board flag overrides bundle board; bundle board overrides default "uno"
    let board = cli.board
        .clone()
        .or_else(|| bundle["board"].as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "uno".to_string());

    // ── Lex ───────────────────────────────────────────────────────────────────
    let tokens = match Lexer::new(&source, &filename).tokenize() {
        Ok(t)  => t,
        Err(e) => {
            emit_error(&tsuki_core::pretty_error(&e, &source));
            std::process::exit(1);
        }
    };

    // ── Parse ─────────────────────────────────────────────────────────────────
    let prog = match TsukiParser::new(tokens).parse_program() {
        Ok(p)  => p,
        Err(e) => {
            emit_error(&tsuki_core::pretty_error(&e, &source));
            std::process::exit(1);
        }
    };

    // ── Build simulator ───────────────────────────────────────────────────────
    let mut sim = match Simulator::new(&prog) {
        Ok(s)  => s,
        Err(e) => {
            emit_error(&format!("init error: {}", e));
            std::process::exit(1);
        }
    };
    sim.set_board(&board);

    // ── Start stdin listener (unless disabled) ────────────────────────────────
    let input_state = Arc::new(Mutex::new(InputState::default()));
    if !cli.no_stdin {
        spawn_stdin_listener(Arc::clone(&input_state));
    }

    // ── Output stream ─────────────────────────────────────────────────────────
    let stdout  = std::io::stdout();
    let mut out = std::io::BufWriter::new(stdout.lock());

    // ── Main simulation loop ──────────────────────────────────────────────────
    let limit        = if cli.steps == 0 { usize::MAX } else { cli.steps };
    let output_every = cli.output_every.max(1);
    let max_ms       = if cli.max_ms <= 0.0 { f64::MAX } else { cli.max_ms };

    // Realtime pacing: keep virtual time roughly in sync with wall time.
    // We sleep the difference between elapsed wall time and virtual sim time.
    // Cap: never emit more than 20 frames/s to the IDE regardless of loop speed.
    let min_frame_wall = Duration::from_millis(50); // 20 fps cap
    let mut wall_start  = Instant::now();
    let mut sim_ms_at_wall_start = 0.0_f64;
    let mut last_emit_wall = Instant::now();
    let mut last_pins: HashMap<String, u16> = HashMap::new();

    let mut last_result: Option<StepResult> = None;

    for i in 0..limit {
        // ── Apply external inputs ─────────────────────────────────────────────
        {
            let st = input_state.lock().unwrap();
            for (&pin, &val) in &st.analog  { sim.set_analog_input(pin, val); }
            for (&pin, &high) in &st.digital { sim.set_digital_input(pin, high); }
        }

        // ── Run one loop() call ───────────────────────────────────────────────
        let ms_before = sim.virtual_ms();
        let result    = sim.step();
        let is_err    = !result.ok;
        let ms_now    = result.ms;
        let delta_ms  = ms_now - ms_before;

        // ── Realtime pacing ───────────────────────────────────────────────────
        // If the sketch advanced virtual time (via delay), sleep proportionally
        // so that the simulation runs at ≤1× realtime speed.
        if delta_ms > 0.0 {
            let virtual_elapsed = ms_now - sim_ms_at_wall_start;
            let wall_elapsed    = wall_start.elapsed().as_millis() as f64;
            let ahead_ms        = virtual_elapsed - wall_elapsed;
            if ahead_ms > 5.0 {
                thread::sleep(Duration::from_millis(ahead_ms.min(500.0) as u64));
            }
        } else {
            // No delay in loop() — yield to avoid 100% CPU spin
            thread::sleep(Duration::from_micros(100));
        }

        // ── Decide whether to emit ────────────────────────────────────────────
        // Always emit on error. Otherwise: emit if there are events (serial,
        // pin changes), the pins changed since last emit, AND we haven't emitted
        // within the last frame window (20 fps cap).
        let pins_changed = result.pins != last_pins;
        let has_events   = !result.events.is_empty() || !result.serial.is_empty();
        let frame_due    = last_emit_wall.elapsed() >= min_frame_wall;
        let should_emit  = is_err
            || ((i % output_every == 0) && (has_events || pins_changed) && frame_due);

        if should_emit {
            let energy = if cli.energy { Some(compute_energy(&sim)) } else { None };
            emit_result(&result, energy.as_ref(), &mut out);
            last_pins = result.pins.clone();
            last_emit_wall = Instant::now();
        }

        last_result = Some(result);
        if is_err || ms_now >= max_ms { break; }
    }

    // Emit final state so the IDE always gets at least one frame
    if let Some(r) = last_result {
        let energy = if cli.energy { Some(compute_energy(&sim)) } else { None };
        emit_result(&r, energy.as_ref(), &mut out);
    }
}