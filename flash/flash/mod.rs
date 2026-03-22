// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: flash  —  flash pipeline dispatcher
// ─────────────────────────────────────────────────────────────────────────────

pub mod avrdude;
pub mod esptool;

use std::path::{Path, PathBuf};
use crate::boards::{Board, Toolchain};
use crate::error::{FlashError, Result};

#[derive(Debug)]
pub struct FlashRequest {
    /// Directory containing the compiled firmware (.hex / .bin / .elf).
    pub build_dir:     PathBuf,
    /// Project name (used to find <n>.hex etc.).
    pub project_name:  String,
    /// Serial port (e.g. "/dev/ttyUSB0", "COM3").
    pub port:          String,
    /// Custom baud rate override (0 = use board default).
    pub baud_override: u32,
    /// Print programmer output.
    pub verbose:       bool,
}

/// Flash compiled firmware to a connected board.
pub fn flash(req: &FlashRequest, board: &Board) -> Result<()> {
    // RP2040 is dispatched early: it only produces .uf2 (not .hex/.bin),
    // so find_firmware would fail. flash_rp2040 locates the .uf2 itself.
    if matches!(&board.toolchain, Toolchain::Rp2040) {
        return flash_rp2040(req, board);
    }

    let firmware = find_firmware(&req.build_dir, &req.project_name, board)?;

    match &board.toolchain {
        Toolchain::Avr { baud, .. } => {
            let baud_to_use = if req.baud_override > 0 { req.baud_override } else { *baud };
            avrdude::flash(&firmware, &req.port, board, baud_to_use, req.verbose)
        }
        Toolchain::Esp32 { .. } | Toolchain::Esp8266 => {
            let baud = if req.baud_override > 0 { req.baud_override } else { 921_600 };
            esptool::flash(&firmware, &req.port, board, baud, req.verbose)
        }
        Toolchain::Sam { .. } => Err(FlashError::Other(
            "SAM (Due) flash not yet implemented — use arduino-cli for now".into(),
        )),
        // Already handled above; satisfies exhaustiveness.
        Toolchain::Rp2040 => flash_rp2040(req, board),
    }
}

/// Flash an RP2040 board.
///
/// Strategy (tried in order):
///   1. picotool load — official Raspberry Pi flashing tool
///   2. Copy .uf2 to the RPI-RP2 mass-storage drive (appears when board is in
///      BOOTSEL mode — hold BOOTSEL while plugging USB)
///   3. Clear error explaining what the user needs to do
fn flash_rp2040(req: &FlashRequest, _board: &Board) -> Result<()> {
    // Find the .uf2 file
    let uf2 = {
        let candidate = req.build_dir.join(format!("{}.uf2", req.project_name));
        if candidate.exists() {
            candidate
        } else {
            return Err(FlashError::Other(
                "RP2040: no .uf2 file found in build directory.\n                   Re-run build to generate it, then copy it to the RPI-RP2 drive.".into()
            ));
        }
    };

    // 1. Try picotool
    if try_picotool(&uf2, req.verbose).is_ok() {
        return Ok(());
    }

    // 2. Try copying to the RPI-RP2 USB drive
    if let Some(drive) = find_rpi_rp2_drive() {
        let dst = drive.join(uf2.file_name().unwrap_or(std::ffi::OsStr::new("firmware.uf2")));
        std::fs::copy(&uf2, &dst)
            .map_err(|e| FlashError::Other(format!(
                "RP2040: failed to copy .uf2 to {}: {}", drive.display(), e
            )))?;
        return Ok(());
    }

    // 3. Neither worked — give a clear actionable error
    Err(FlashError::Other(format!(
        "RP2040: board not in BOOTSEL mode (no RPI-RP2 drive found) and picotool not available.\n           To flash:\n           • Hold the BOOTSEL button while plugging in USB — a drive named RPI-RP2 will appear\n           • Then run the upload again (tsuki will copy the .uf2 automatically), OR\n           • Drag-and-drop {} onto the RPI-RP2 drive manually\n           • Or install picotool: https://github.com/raspberrypi/picotool",
        uf2.display()
    )))
}

fn try_picotool(uf2: &std::path::Path, verbose: bool) -> std::result::Result<(), ()> {
    let mut cmd = std::process::Command::new("picotool");
    cmd.args(["load", "-f"]).arg(uf2).arg("--verify");
    if verbose { cmd.arg("-v"); }
    match cmd.output() {
        Ok(o) if o.status.success() => Ok(()),
        _ => Err(()),
    }
}

/// Find the RP2040 BOOTSEL mass-storage drive (named "RPI-RP2").
fn find_rpi_rp2_drive() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    {
        // On Windows, enumerate drive letters and check their volume label
        for letter in b'A'..=b'Z' {
            let root = std::path::PathBuf::from(format!("{}:\\", letter as char));
            if root.exists() {
                // GetVolumeInformation would be ideal but requires winapi.
                // Heuristic: the RPI-RP2 drive always contains INFO_UF2.TXT.
                if root.join("INFO_UF2.TXT").exists() {
                    return Some(root);
                }
            }
        }
        None
    }
    #[cfg(target_os = "linux")]
    {
        // On Linux the drive is typically mounted at /media/$USER/RPI-RP2
        // or /run/media/$USER/RPI-RP2
        let user = std::env::var("USER").unwrap_or_default();
        for base in &[
            format!("/media/{}/RPI-RP2", user),
            format!("/run/media/{}/RPI-RP2", user),
            "/mnt/RPI-RP2".to_owned(),
        ] {
            let p = std::path::Path::new(base);
            if p.exists() { return Some(p.to_owned()); }
        }
        None
    }
    #[cfg(target_os = "macos")]
    {
        let p = std::path::Path::new("/Volumes/RPI-RP2");
        if p.exists() { Some(p.to_owned()) } else { None }
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    { None }
}


/// Locate the firmware file inside build_dir.
/// Priority: .with_bootloader.hex > .hex > .bin
///
/// NOTE: RP2040 is dispatched before this function is called (see `flash()`);
/// .uf2 files are never needed here.
fn find_firmware(build_dir: &Path, name: &str, board: &Board) -> Result<PathBuf> {
    let prefer_hex = matches!(&board.toolchain, Toolchain::Avr { .. });

    // Use owned Strings to avoid temporaries with dangling &str references.
    let candidates: Vec<String> = if prefer_hex {
        vec![
            format!("{}.with_bootloader.hex", name),
            format!("{}.hex", name),
            format!("{}.bin", name),
        ]
    } else {
        vec![
            format!("{}.bin", name),
            format!("{}.hex", name),
        ]
    };

    for candidate in &candidates {
        let path = build_dir.join(candidate);
        if path.exists() { return Ok(path); }
    }

    // Also check one level down in .cache/
    let cache = build_dir.join(".cache");
    for candidate in &candidates {
        let path = cache.join(candidate);
        if path.exists() { return Ok(path); }
    }

    Err(FlashError::NoFirmware(build_dir.display().to_string()))
}