// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: compile  —  compile pipeline orchestrator
// ─────────────────────────────────────────────────────────────────────────────

pub mod avr;
pub mod cache;
pub mod esp;

use std::path::PathBuf;
use crate::boards::{Board, Toolchain};
use crate::error::{FlashError, Result};
use crate::sdk;

/// Inputs to a compile run.
#[derive(Debug)]
pub struct CompileRequest {
    /// Directory containing sketch .cpp/.ino files to compile.
    pub sketch_dir:       PathBuf,
    /// Directory where .o, .elf, .hex, .bin are written.
    pub build_dir:        PathBuf,
    /// Name used for output file stems (e.g. "thermometer").
    pub project_name:     String,
    /// C++ standard string, e.g. "c++11".
    pub cpp_std:          String,
    /// Extra -I dirs (tsuki libraries, passed via --include).
    pub lib_include_dirs: Vec<PathBuf>,
    /// When true the tsuki-modules SDK store (~/.tsuki/modules) is preferred
    /// over .arduino15. sdk::resolve() handles this transparently; the flag
    /// is here for documentation and future per-request overrides.
    pub use_modules:      bool,
    /// Print every compiler command.
    pub verbose:          bool,
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
///
/// Automatically appends `lib_manager::libs_root()` to the include path so
/// libraries installed via `tsuki-flash lib install <name>` are found without
/// requiring explicit `--include` flags.
pub fn compile(req: &CompileRequest, board: &Board) -> Result<CompileResult> {
    let sdk = sdk::resolve(board.arch(), board.variant)?;
    let augmented = augment_lib_includes(req);

    match &board.toolchain {
        Toolchain::Avr { .. }   => avr::run(&augmented, board, &sdk),
        Toolchain::Esp32 { .. } => esp::run(&augmented, board, &sdk),
        Toolchain::Esp8266      => esp::run(&augmented, board, &sdk),
        Toolchain::Sam { .. }   => Err(FlashError::Other(
            "SAM (Due) compile not yet implemented — use arduino-cli for now".into(),
        )),
        Toolchain::Rp2040 => Err(FlashError::Other(
            "RP2040 compile not yet implemented — use arduino-cli for now".into(),
        )),
    }
}

/// Appends `lib_manager::libs_root()` to lib_include_dirs if it exists and
/// is not already present, so installed libraries are auto-found.
fn augment_lib_includes(req: &CompileRequest) -> CompileRequest {
    let mut dirs = req.lib_include_dirs.clone();

    if let Ok(libs_root) = crate::lib_manager::libs_root() {
        if libs_root.is_dir() && !dirs.contains(&libs_root) {
            dirs.push(libs_root);
        }
    }

    CompileRequest {
        sketch_dir:       req.sketch_dir.clone(),
        build_dir:        req.build_dir.clone(),
        project_name:     req.project_name.clone(),
        cpp_std:          req.cpp_std.clone(),
        lib_include_dirs: dirs,
        use_modules:      req.use_modules,
        verbose:          req.verbose,
    }
}