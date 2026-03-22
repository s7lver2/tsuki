// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: flash :: avrdude  —  AVR board programmer
// ─────────────────────────────────────────────────────────────────────────────

use std::path::Path;
use std::process::Command;
use crate::boards::Board;
use crate::error::{FlashError, Result};

/// Flash a .hex file to an AVR board using avrdude.
///
/// `baud_override`: when non-zero, overrides the board's default baud rate.
pub fn flash(hex: &Path, port: &str, board: &Board, baud_override: u32, verbose: bool) -> Result<()> {
    let (programmer, default_baud) = board.avrdude_programmer()
        .ok_or_else(|| FlashError::Other("Not an AVR board".into()))?;
    let baud = if baud_override > 0 { baud_override } else { default_baud };

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
    }
    // Note: we intentionally do NOT pass -q/-q even in non-verbose mode.
    // avrdude's stderr is the only source of the actual failure reason
    // (e.g. "not in sync", "permission denied", "no device on port").
    // With -q -q that output is suppressed and the user sees only the
    // generic "upload failed" with no actionable detail.

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
#[allow(dead_code)]
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
    // Windows does not set HOME — use USERPROFILE / LOCALAPPDATA.
    #[cfg(target_os = "windows")]
    let (home, exe) = (std::env::var("USERPROFILE").unwrap_or_default(), ".exe");
    #[cfg(not(target_os = "windows"))]
    let (home, exe) = (std::env::var("HOME").unwrap_or_default(), "");

    let bin = format!("avrdude{}", exe);

    let mut candidates: Vec<String> = vec![
        // tsuki-modules bundled avrdude
        format!("{}/.tsuki/modules/packages/arduino/tools/avrdude/7.1/bin/{}", home, bin),
        format!("{}/.tsuki/modules/packages/arduino/tools/avrdude/6.3.0-arduino17/bin/{}", home, bin),
        // arduino-cli cache — Linux / macOS
        format!("{}/.arduino15/packages/arduino/tools/avrdude/7.1/bin/{}", home, bin),
        format!("{}/.arduino15/packages/arduino/tools/avrdude/6.3.0-arduino17/bin/{}", home, bin),
    ];

    // arduino-cli cache — Windows uses %LOCALAPPDATA%\Arduino15
    #[cfg(target_os = "windows")]
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        candidates.push(format!("{}\\Arduino15\\packages\\arduino\\tools\\avrdude\\7.1\\bin\\{}", local, bin));
        candidates.push(format!("{}\\Arduino15\\packages\\arduino\\tools\\avrdude\\6.3.0-arduino17\\bin\\{}", local, bin));
    }

    #[cfg(not(target_os = "windows"))]
    {
        candidates.push("/usr/bin/avrdude".into());
        candidates.push("/usr/local/bin/avrdude".into());
    }

    for c in &candidates {
        if std::path::Path::new(c).exists() {
            return c.clone();
        }
    }

    if let Ok(path) = find_in_arduino15_tools(&home, &bin) {
        return path;
    }

    bin // rely on PATH as last resort
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