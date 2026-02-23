// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: flash  —  flash pipeline orchestrator
// ─────────────────────────────────────────────────────────────────────────────

pub mod avrdude;
pub mod esptool;

use std::path::{Path, PathBuf};
use crate::boards::{Board, Toolchain};
use crate::error::{FlashError, Result};

#[derive(Debug)]
pub struct FlashRequest {
    /// Directory containing the compiled firmware (.hex / .bin / .elf).
    pub build_dir:    PathBuf,
    /// Project name (used to find <name>.hex etc.).
    pub project_name: String,
    /// Serial port (e.g. "/dev/ttyUSB0", "COM3").
    pub port:         String,
    /// Custom baud rate override (0 = use board default).
    pub baud_override: u32,
    /// Print programmer output.
    pub verbose:      bool,
}

/// Flash compiled firmware to a connected board.
pub fn flash(req: &FlashRequest, board: &Board) -> Result<()> {
    let firmware = find_firmware(&req.build_dir, &req.project_name, board)?;

    match &board.toolchain {
        Toolchain::Avr { baud, .. } => {
            let baud = if req.baud_override > 0 { req.baud_override } else { *baud };
            let _ = baud; // avrdude uses board-specific baud from boards.rs
            avrdude::flash(&firmware, &req.port, board, req.verbose)
        }
        Toolchain::Esp32 { .. } | Toolchain::Esp8266 => {
            let baud = if req.baud_override > 0 { req.baud_override } else { 921600 };
            esptool::flash(&firmware, &req.port, board, baud, req.verbose)
        }
        Toolchain::Sam { .. } => Err(FlashError::Other(
            "SAM (Due) flash not yet implemented — use arduino-cli for now".into()
        )),
        Toolchain::Rp2040 => Err(FlashError::Other(
            "RP2040 flash: copy the .uf2 file to the Pico USB drive manually,\n  or use picotool.".into()
        )),
    }
}

/// Find the firmware file inside build_dir.
/// Priority: .hex > .bin > .elf
fn find_firmware(build_dir: &Path, name: &str, board: &Board) -> Result<PathBuf> {
    let prefer_hex = matches!(&board.toolchain, Toolchain::Avr { .. });

    let candidates: &[&str] = if prefer_hex {
        &[
            &format!("{}.with_bootloader.hex", name),
            &format!("{}.hex", name),
            &format!("{}.bin", name),
        ]
    } else {
        &[
            &format!("{}.bin", name),
            &format!("{}.hex", name),
        ]
    };

    for candidate in candidates {
        let path = build_dir.join(candidate);
        if path.exists() { return Ok(path); }
    }

    // Also check one level down in .cache/
    let cache = build_dir.join(".cache");
    for candidate in candidates {
        let path = cache.join(candidate);
        if path.exists() { return Ok(path); }
    }

    Err(FlashError::NoFirmware(build_dir.display().to_string()))
}