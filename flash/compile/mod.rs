// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: compile  —  compile pipeline dispatcher
// ─────────────────────────────────────────────────────────────────────────────

pub mod avr;
pub mod cache;
pub mod esp;
pub mod rp2040;

use std::path::PathBuf;
use crate::boards::{Board, Toolchain};
use crate::error::{FlashError, Result};
use crate::sdk;

/// Source language for the project.
#[derive(Debug, Clone, PartialEq)]
pub enum Language {
    /// Go project — sources were already transpiled to .cpp by tsuki-core.
    Go,
    /// Python project — sources were already transpiled to .cpp by tsuki-core
    /// via PythonPipeline. The compile step is identical to Go: the sketch dir
    /// already contains .cpp files; tsuki-flash just compiles them.
    Python,
    /// Native C++ project — src/*.cpp compiled directly.
    Cpp,
    /// Native Arduino .ino sketch — src/*.ino compiled directly.
    Ino,
}

impl Language {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "python" | "py" => Language::Python,
            "cpp"           => Language::Cpp,
            "ino"           => Language::Ino,
            _               => Language::Go,
        }
    }
}

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
    /// Source language — determines how the sketch dir is treated.
    /// For Go and Cpp projects the pipeline is identical (the CLI already
    /// transpiled .go → .cpp or copied .cpp into the sketch dir before calling
    /// tsuki-flash). For Ino projects the .ino file acts as the entry point.
    pub language:         Language,
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
    #[allow(dead_code)]
    pub elf_path:  Option<PathBuf>,
    pub size_info: String,
}

/// Run the full compile pipeline for the given board.
///
/// Automatically appends `lib_manager::libs_root()` to the include path so
/// libraries installed via `tsuki-flash lib install <name>` are found without
/// requiring explicit `--include` flags.
pub fn compile(req: &CompileRequest, board: &Board) -> Result<CompileResult> {
    let sdk = sdk::resolve(board.arch(), board.variant, req.verbose)?;
    let augmented = augment_lib_includes(req);

    match &board.toolchain {
        Toolchain::Avr { .. }   => avr::run(&augmented, board, &sdk),
        Toolchain::Esp32 { .. } => esp::run(&augmented, board, &sdk),
        Toolchain::Esp8266      => esp::run(&augmented, board, &sdk),
        Toolchain::Sam { .. }   => Err(FlashError::Other(
            "SAM (Due) compile not yet implemented — use arduino-cli for now".into(),
        )),
        Toolchain::Rp2040       => rp2040::run(&augmented, board, &sdk),
    }
}

/// Appends lib include dirs from installed packages, walking the standard
/// Arduino library layout:
///   libs_root/<PkgName>/<version>/        ← added
///   libs_root/<PkgName>/<version>/src/    ← added (standard Arduino headers location)
///   libs_root/<PkgName>/                  ← added (flat installs)
fn augment_lib_includes(req: &CompileRequest) -> CompileRequest {
    let mut dirs = req.lib_include_dirs.clone();

    if let Ok(libs_root) = crate::lib_manager::libs_root() {
        if libs_root.is_dir() {
            // Walk each package directory
            if let Ok(pkg_entries) = std::fs::read_dir(&libs_root) {
                for pkg_entry in pkg_entries.flatten() {
                    let pkg_path = pkg_entry.path();
                    if !pkg_path.is_dir() { continue; }

                    // Check for versioned subdirs (pkg/1.4.4/)
                    let mut has_versioned = false;
                    if let Ok(ver_entries) = std::fs::read_dir(&pkg_path) {
                        for ver_entry in ver_entries.flatten() {
                            let ver_path = ver_entry.path();
                            if !ver_path.is_dir() { continue; }
                            // Skip non-version-like dirs
                            let name = ver_entry.file_name();
                            let name_str = name.to_string_lossy();
                            if name_str.starts_with(|c: char| c.is_ascii_digit()) || name_str.starts_with('v') {
                                has_versioned = true;
                                // Add versioned root
                                if !dirs.contains(&ver_path) {
                                    dirs.push(ver_path.clone());
                                }
                                // Add src/ if it exists
                                let src = ver_path.join("src");
                                if src.is_dir() && !dirs.contains(&src) {
                                    dirs.push(src);
                                }
                            }
                        }
                    }
                    // Flat install: no version subdir — add pkg root directly
                    if !has_versioned && !dirs.contains(&pkg_path) {
                        dirs.push(pkg_path.clone());
                        let src = pkg_path.join("src");
                        if src.is_dir() && !dirs.contains(&src) {
                            dirs.push(src);
                        }
                    }
                }
            }
        }
    }

    CompileRequest {
        sketch_dir:       req.sketch_dir.clone(),
        build_dir:        req.build_dir.clone(),
        project_name:     req.project_name.clone(),
        cpp_std:          req.cpp_std.clone(),
        lib_include_dirs: dirs,
        language:         req.language.clone(),
        use_modules:      req.use_modules,
        verbose:          req.verbose,
    }
}