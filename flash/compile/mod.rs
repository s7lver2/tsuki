// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: compile  —  compile pipeline orchestrator
// ─────────────────────────────────────────────────────────────────────────────

pub mod avr;
pub mod esp;
pub mod cache;

use std::path::PathBuf;
use crate::boards::{Board, Toolchain};
use crate::error::{FlashError, Result};
use crate::sdk;

/// Inputs to a compile run.
#[derive(Debug)]
pub struct CompileRequest {
    /// Directory containing sketch .cpp/.ino files to compile.
    pub sketch_dir:      PathBuf,
    /// Directory where object files, .elf, .hex, .bin are written.
    pub build_dir:       PathBuf,
    /// Name used for output file stems (e.g. "thermometer").
    pub project_name:    String,
    /// C++ standard string from goduino.json, e.g. "c++11".
    pub cpp_std:         String,
    /// Extra -I dirs from tsuki libraries.
    pub lib_include_dirs: Vec<PathBuf>,
    /// Print compiler commands.
    pub verbose:         bool,
}

/// Outputs of a compile run.
#[derive(Debug)]
pub struct CompileResult {
    pub hex_path:  Option<PathBuf>,
    pub bin_path:  Option<PathBuf>,
    pub elf_path:  Option<PathBuf>,
    pub size_info: String,
}

/// Run the full compile pipeline for the given board.
pub fn compile(req: &CompileRequest, board: &Board) -> Result<CompileResult> {
    let sdk = sdk::resolve(board.arch(), board.variant)?;

    match &board.toolchain {
        Toolchain::Avr { .. }   => avr::run(req, board, &sdk),
        Toolchain::Esp32 { .. } => esp::run(req, board, &sdk),
        Toolchain::Esp8266      => esp::run(req, board, &sdk),
        Toolchain::Sam { .. }   => Err(FlashError::Other(
            "SAM (Due) compile not yet implemented — use arduino-cli for now".into()
        )),
        Toolchain::Rp2040       => Err(FlashError::Other(
            "RP2040 compile not yet implemented — use arduino-cli for now".into()
        )),
    }
}