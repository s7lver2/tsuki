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
    /// Source directories for tsukilib packages — .cpp/.c files found here
    /// are compiled into libs.a and linked into the final firmware.
    /// Populated automatically by augment_lib_includes(); callers can leave
    /// this empty and let the compile pipeline fill it in.
    pub lib_source_dirs: Vec<PathBuf>,
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
///   libs_root/<PkgName>/<version>/        ← added as include + source dir
///   libs_root/<PkgName>/<version>/src/    ← added as include + source dir
///   libs_root/<PkgName>/                  ← added as include + source dir (flat installs)
///
/// Also collects `lib_source_dirs`: every directory that contains at least
/// one `.cpp` or `.c` file at depth-1.  These are compiled into `libs.a`
/// and linked into the firmware — fixing the "undefined reference" linker
/// errors that occur when a library ships a `.cpp` implementation file.
fn augment_lib_includes(req: &CompileRequest) -> CompileRequest {
    let mut include_dirs = req.lib_include_dirs.clone();
    let mut source_dirs  = req.lib_source_dirs.clone();

    if let Ok(libs_root) = crate::lib_manager::libs_root() {
        if libs_root.is_dir() {
            if let Ok(pkg_entries) = std::fs::read_dir(&libs_root) {
                for pkg_entry in pkg_entries.flatten() {
                    let pkg_path = pkg_entry.path();
                    if !pkg_path.is_dir() { continue; }

                    let mut has_versioned = false;
                    if let Ok(ver_entries) = std::fs::read_dir(&pkg_path) {
                        for ver_entry in ver_entries.flatten() {
                            let ver_path = ver_entry.path();
                            if !ver_path.is_dir() { continue; }
                            let name_str = ver_entry.file_name();
                            let name_str = name_str.to_string_lossy();
                            if name_str.starts_with(|c: char| c.is_ascii_digit()) || name_str.starts_with('v') {
                                has_versioned = true;

                                add_lib_dir(&ver_path, &mut include_dirs, &mut source_dirs);

                                let src = ver_path.join("src");
                                if src.is_dir() {
                                    add_lib_dir(&src, &mut include_dirs, &mut source_dirs);
                                }
                            }
                        }
                    }
                    if !has_versioned {
                        add_lib_dir(&pkg_path, &mut include_dirs, &mut source_dirs);
                        let src = pkg_path.join("src");
                        if src.is_dir() {
                            add_lib_dir(&src, &mut include_dirs, &mut source_dirs);
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
        lib_include_dirs: include_dirs,
        lib_source_dirs:  source_dirs,
        language:         req.language.clone(),
        use_modules:      req.use_modules,
        verbose:          req.verbose,
    }
}

/// Add `dir` to both `include_dirs` and `source_dirs` (if it has sources).
/// Avoids duplicates in both lists.
fn add_lib_dir(dir: &PathBuf, include_dirs: &mut Vec<PathBuf>, source_dirs: &mut Vec<PathBuf>) {
    if !include_dirs.contains(dir) {
        include_dirs.push(dir.clone());
    }
    // Only add as a source dir if it actually contains .cpp or .c files
    // (depth-1 only — we don't recurse into examples/ or test/ subdirs).
    if dir_has_sources(dir) && !source_dirs.contains(dir) {
        source_dirs.push(dir.clone());
    }
}

/// Returns true if `dir` contains at least one `.cpp` or `.c` file at depth 1.
fn dir_has_sources(dir: &PathBuf) -> bool {
    std::fs::read_dir(dir)
        .map(|entries| entries.flatten().any(|e| {
            e.file_type().map(|t| t.is_file()).unwrap_or(false) &&
            e.path().extension()
                .and_then(|x| x.to_str())
                .map(|x| matches!(x, "cpp" | "c"))
                .unwrap_or(false)
        }))
        .unwrap_or(false)
}