// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: flash :: avrdude  —  AVR board programmer
// ─────────────────────────────────────────────────────────────────────────────

use std::path::Path;
use std::process::Command;
use crate::boards::Board;
use crate::error::{FlashError, Result};

/// Flash a .hex file to an AVR board using avrdude.
pub fn flash(hex: &Path, port: &str, board: &Board, verbose: bool) -> Result<()> {
    let (programmer, baud) = board.avrdude_programmer()
        .ok_or_else(|| FlashError::Other("Not an AVR board".into()))?;

    let mcu = board.avr_mcu()
        .ok_or_else(|| FlashError::Other("Missing MCU for AVR board".into()))?;

    // Locate avrdude — prefer the one bundled with the Arduino SDK
    let avrdude = find_avrdude();

    let mut cmd = Command::new(&avrdude);
    cmd.args([
        "-C", &avrdude_conf(&avrdude),
        "-p", mcu,
        "-c", programmer,
        "-P", port,
        "-b", &baud.to_string(),
        "-D",
        "-U", &format!("flash:w:{}:i", hex.display()),
    ]);

    if verbose {
        cmd.arg("-v");
    } else {
        // Suppress most avrdude output except errors
        cmd.args(["-q", "-q"]);
    }

    let out = cmd.output()?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        return Err(FlashError::FlashFailed {
            port:   port.to_owned(),
            output: format!("{}\n{}", stderr, stdout).trim().to_owned(),
        });
    }

    Ok(())
}

/// Verify flash by reading back and comparing (optional sanity check).
pub fn verify(hex: &Path, port: &str, board: &Board) -> Result<()> {
    let (programmer, baud) = board.avrdude_programmer().unwrap();
    let mcu = board.avr_mcu().unwrap();
    let avrdude = find_avrdude();

    let out = Command::new(&avrdude)
        .args([
            "-C", &avrdude_conf(&avrdude),
            "-p", mcu, "-c", programmer,
            "-P", port, "-b", &baud.to_string(),
            "-U", &format!("flash:v:{}:i", hex.display()),
            "-q", "-q",
        ])
        .output()?;

    if !out.status.success() {
        return Err(FlashError::FlashFailed {
            port: port.to_owned(),
            output: String::from_utf8_lossy(&out.stderr).to_string(),
        });
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn find_avrdude() -> String {
    // 1. Arduino CLI cache location
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("{}/.arduino15/packages/arduino/tools/avrdude/6.3.0-arduino17/bin/avrdude", home),
        format!("{}/.arduino15/packages/arduino/tools/avrdude/7.1/bin/avrdude", home),
        "/usr/bin/avrdude".into(),
        "/usr/local/bin/avrdude".into(),
        "avrdude".into(), // PATH fallback
    ];

    for c in &candidates {
        if std::path::Path::new(c).exists() {
            return c.clone();
        }
    }

    // Try arduino15 glob-style search
    if let Ok(path) = find_in_arduino15_tools(&home, "avrdude") {
        return path;
    }

    "avrdude".to_owned() // rely on PATH
}

fn avrdude_conf(avrdude_bin: &str) -> String {
    // Try to find avrdude.conf next to the binary
    let bin_path = std::path::Path::new(avrdude_bin);
    if let Some(parent) = bin_path.parent() {
        let conf = parent.join("../etc/avrdude.conf");
        if conf.exists() {
            return conf.to_string_lossy().to_string();
        }
        let conf = parent.join("avrdude.conf");
        if conf.exists() {
            return conf.to_string_lossy().to_string();
        }
    }
    // System default paths
    for p in &["/etc/avrdude.conf", "/usr/share/avrdude/avrdude.conf"] {
        if std::path::Path::new(p).exists() {
            return p.to_string();
        }
    }
    // Let avrdude find it itself
    "/etc/avrdude.conf".to_owned()
}

fn find_in_arduino15_tools(home: &str, tool: &str) -> std::result::Result<String, ()> {
    let tools_dir = std::path::Path::new(home)
        .join(".arduino15/packages/arduino/tools")
        .join(tool);

    if !tools_dir.is_dir() { return Err(()); }

    let mut versions: Vec<String> = std::fs::read_dir(&tools_dir)
        .map_err(|_| ())?
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    versions.sort();

    let version = versions.last().ok_or(())?;
    let bin = tools_dir.join(version).join("bin").join(tool);
    if bin.exists() {
        Ok(bin.to_string_lossy().to_string())
    } else {
        Err(())
    }
}