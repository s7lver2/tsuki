// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: compile :: rp2040
//
//  Compiles Arduino RP2040 sketches (Raspberry Pi Pico, Seeed XIAO RP2040)
//  using the arm-none-eabi-gcc toolchain from the earlephilhower/arduino-pico
//  package installed either via tsuki-modules or .arduino15.
//
//  Pipeline:
//    1. Compile sketch .cpp files (parallel, incremental cache)
//    2. Link → firmware.elf  (arm-none-eabi-gcc + linker script)
//    3. arm-none-eabi-objcopy → firmware.bin + firmware.uf2
//    4. arm-none-eabi-size report
// ─────────────────────────────────────────────────────────────────────────────

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use rayon::prelude::*;
use walkdir::WalkDir;

use crate::boards::Board;
use crate::error::{FlashError, Result};
use crate::sdk::SdkPaths;
use super::cache::{CacheManifest, hash_str, obj_path};
use super::{CompileRequest, CompileResult};

pub fn run(req: &CompileRequest, board: &Board, sdk: &SdkPaths) -> Result<CompileResult> {
    std::fs::create_dir_all(&req.build_dir)?;

    // RP2040 toolchain: pqt-gcc-arm-none-eabi (earlephilhower) or system arm-none-eabi-gcc
    let cc  = resolve_tool(&sdk.toolchain_bin, "arm-none-eabi-gcc");
    let cxx = resolve_tool(&sdk.toolchain_bin, "arm-none-eabi-g++");
    let ar  = resolve_tool(&sdk.toolchain_bin, "arm-none-eabi-gcc-ar");
    let objcopy = resolve_tool(&sdk.toolchain_bin, "arm-none-eabi-objcopy");
    let size    = resolve_tool(&sdk.toolchain_bin, "arm-none-eabi-size");

    // ── Compile flags ─────────────────────────────────────────────────────
    let arduino_ver = "10819";
    let mut common_flags: Vec<String> = vec![
        // RP2040 Cortex-M0+ core
        "-march=armv6-m".into(),
        "-mcpu=cortex-m0plus".into(),
        "-mthumb".into(),
        format!("-DF_CPU={}L", board.f_cpu()),
        format!("-DARDUINO={}", arduino_ver),
        "-DARDUINO_ARCH_RP2040".into(),
        "-Os".into(),
        "-w".into(),
        "-ffunction-sections".into(),
        "-fdata-sections".into(),
        "-fno-exceptions".into(),
        "-MMD".into(),
        format!("-I{}", sdk.core_dir.display()),
        format!("-I{}", sdk.variant_dir.display()),
    ];
    for d in board.defines {
        common_flags.push(format!("-D{}", d));
    }
    for lib_dir in &req.lib_include_dirs {
        common_flags.push(format!("-I{}", lib_dir.display()));
    }
    if let Some(ld) = &sdk.libraries_dir {
        common_flags.push(format!("-I{}", ld.display()));
    }

    let cflags = ["-x", "c", "-std=gnu11"];
    let cxx_std = format!("-std=gnu++{}", req.cpp_std.trim_start_matches("c++"));
    let cxxflags = [
        "-x", "c++",
        cxx_std.as_str(),
        "-fpermissive", "-fno-threadsafe-statics",
        "-Wno-error=narrowing",
    ];

    let flags_sig = hash_str(&format!("{:?}{:?}{:?}", common_flags, cflags, cxxflags));

    // ── Step 1: Compile sketch objects (parallel) ─────────────────────────
    let sketch_obj_dir = req.build_dir.join("sketch");
    std::fs::create_dir_all(&sketch_obj_dir)?;

    let sources = collect_sources(&req.sketch_dir)?;
    if sources.is_empty() {
        return Err(FlashError::CompileFailed {
            output: format!("No source files found in {}", req.sketch_dir.display()),
        });
    }

    let mut cache = CacheManifest::load(&sketch_obj_dir);
    let errors: Mutex<Vec<String>> = Mutex::new(Vec::new());

    let obj_files: Vec<PathBuf> = sources.par_iter().map(|src| {
        let obj = obj_path(&sketch_obj_dir, src);
        if cache.is_fresh(src, &obj, &flags_sig) {
            if req.verbose { eprintln!("  [cache] {}", src.display()); }
            return obj;
        }

        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
        let compiler = if ext == "c" { &cc } else { &cxx };

        let mut cmd = Command::new(compiler);
        cmd.args(&common_flags);
        if ext == "c" { cmd.args(&cflags); } else { cmd.args(&cxxflags); }
        cmd.arg("-c").arg(src).arg("-o").arg(&obj);

        if req.verbose { eprintln!("  [cc] {}", src.display()); }

        match cmd.output() {
            Ok(o) if o.status.success() => {}
            Ok(o) => {
                errors.lock().unwrap().push(format!(
                    "In {}:\n{}", src.display(),
                    String::from_utf8_lossy(&o.stderr)
                ));
            }
            Err(e) => {
                errors.lock().unwrap().push(format!("Failed to run compiler: {}", e));
            }
        }
        obj
    }).collect();

    // Save cache — record all obj files that now exist on disk
    for src in &sources {
        let obj = obj_path(&sketch_obj_dir, src);
        if obj.exists() { cache.record(src, &flags_sig); }
    }
    let _ = cache.save(&sketch_obj_dir);

    let compile_errors = errors.into_inner().unwrap();
    if !compile_errors.is_empty() {
        return Err(FlashError::CompileFailed { output: compile_errors.join("\n\n") });
    }

    if obj_files.is_empty() {
        return Err(FlashError::CompileFailed {
            output: "No object files produced — all sources failed to compile.".into(),
        });
    }

    // ── Step 2: Link → .elf ───────────────────────────────────────────────
    let elf_path = req.build_dir.join(format!("{}.elf", req.project_name));

    // Find linker script in sdk
    let ld_script = find_linker_script(&sdk.core_dir, &sdk.variant_dir);

    let mut link_cmd = Command::new(&cxx);
    link_cmd
        .arg("-march=armv6-m")
        .arg("-mcpu=cortex-m0plus")
        .arg("-mthumb")
        .arg("-Wl,--gc-sections")
        .arg("-Wl,--wrap=malloc")
        .arg("-Wl,--wrap=free");

    if let Some(ref ls) = ld_script {
        link_cmd.arg(format!("-T{}", ls.display()));
    }

    link_cmd.args(&obj_files).arg("-o").arg(&elf_path);

    if req.verbose { eprintln!("  [ld] linking → {}", elf_path.file_name().unwrap().to_string_lossy()); }

    let link_out = link_cmd.output()
        .map_err(|e| FlashError::LinkFailed { output: format!("Failed to run linker: {}", e) })?;

    if !link_out.status.success() {
        return Err(FlashError::LinkFailed {
            output: String::from_utf8_lossy(&link_out.stderr).to_string(),
        });
    }

    // ── Step 3: .bin ──────────────────────────────────────────────────────
    let bin_path = req.build_dir.join(format!("{}.bin", req.project_name));
    let bin_out = Command::new(&objcopy)
        .args(["-O", "binary"])
        .arg(&elf_path).arg(&bin_path)
        .output()
        .map_err(|e| FlashError::Other(format!("objcopy failed: {}", e)))?;

    if !bin_out.status.success() {
        return Err(FlashError::Other(
            String::from_utf8_lossy(&bin_out.stderr).to_string()
        ));
    }

    // ── Step 4: size report ───────────────────────────────────────────────
    let size_out = Command::new(&size)
        .arg("--format=sysv")
        .arg(&elf_path)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    if req.verbose { eprint!("{}", size_out); }

    Ok(CompileResult {
        hex_path:  None,          // RP2040 uses .bin / .uf2, not .hex
        bin_path:  Some(bin_path),
        elf_path:  Some(elf_path),
        size_info: size_out,
    })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn resolve_tool(toolchain_bin: &Path, name: &str) -> PathBuf {
    let candidate = toolchain_bin.join(name);
    if candidate.exists() { candidate }
    else {
        // Try with .exe on Windows
        let win = toolchain_bin.join(format!("{}.exe", name));
        if win.exists() { win } else { PathBuf::from(name) }
    }
}

fn collect_sources(sketch_dir: &Path) -> Result<Vec<PathBuf>> {
    let mut sources = Vec::new();
    for entry in WalkDir::new(sketch_dir).max_depth(2).into_iter().filter_map(|e| e.ok()) {
        let p = entry.path();
        if p.is_file() {
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
            if matches!(ext, "cpp" | "c" | "S") {
                sources.push(p.to_owned());
            }
        }
    }
    Ok(sources)
}

fn find_linker_script(core_dir: &Path, variant_dir: &Path) -> Option<PathBuf> {
    // earlephilhower pico-sdk linker scripts
    let candidates = [
        variant_dir.join("memmap_default.ld"),
        variant_dir.join("memmap.ld"),
        core_dir.join("memmap_default.ld"),
        core_dir.parent().and_then(|p| p.parent()).map(|p| p.join("lib/memmap_default.ld")).unwrap_or_default(),
    ];
    for c in &candidates {
        if c.exists() { return Some(c.clone()); }
    }
    None
}