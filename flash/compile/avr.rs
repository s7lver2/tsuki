// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: compile :: avr
//
//  Compiles Arduino AVR sketches using avr-gcc/avr-g++ directly.
//
//  Pipeline:
//    1. Discover + compile Arduino core → core.a  (cached, rebuilt only if stale)
//    2. Compile sketch .cpp files in PARALLEL     (rayon, incremental cache)
//    3. Link everything → firmware.elf
//    4. avr-objcopy → firmware.hex  +  firmware.with_bootloader.hex
//    5. avr-size report
// ─────────────────────────────────────────────────────────────────────────────

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use rayon::prelude::*;
use walkdir::WalkDir;

use crate::boards::Board;
use crate::error::{FlashError, Result};
use crate::sdk::{SdkPaths};
use super::cache::{CacheManifest, obj_path, hash_str};
use super::{CompileRequest, CompileResult};

pub fn run(req: &CompileRequest, board: &Board, sdk: &SdkPaths) -> Result<CompileResult> {
    let mcu = board.avr_mcu()
        .ok_or_else(|| FlashError::Other(format!("Board '{}' is not an AVR board", board.id)))?;

    std::fs::create_dir_all(&req.build_dir)?;

    // Resolve full paths to compiler binaries
    let cc  = resolve_tool(&sdk.toolchain_bin, "avr-gcc");
    let cxx = resolve_tool(&sdk.toolchain_bin, "avr-g++");
    let ar  = resolve_tool(&sdk.toolchain_bin, "avr-ar");

    // ── Shared compiler flags ─────────────────────────────────────────────
    let arduino_ver = "10819"; // ARDUINO=10819 → 1.8.19 (what most libs expect)
    let board_define = board.defines.iter()
        .find(|d| d.starts_with("ARDUINO_"))
        .copied()
        .unwrap_or("ARDUINO_AVR_UNO");

    let common_flags: Vec<String> = vec![
        format!("-mmcu={}", mcu),
        format!("-DF_CPU={}L", board.f_cpu()),
        format!("-DARDUINO={}", arduino_ver),
        format!("-D{}", board_define),
        "-DARDUINO_ARCH_AVR".into(),
        "-Os".into(),
        "-w".into(),
        "-ffunction-sections".into(),
        "-fdata-sections".into(),
        "-flto".into(),
        "-MMD".into(),
        format!("-I{}", sdk.core_dir.display()),
        format!("-I{}", sdk.variant_dir.display()),
    ];

    // Add extra include dirs (external libraries)
    let mut includes: Vec<String> = common_flags.clone();
    for lib_dir in &req.lib_include_dirs {
        includes.push(format!("-I{}", lib_dir.display()));
    }
    if let Some(ld) = &sdk.libraries_dir {
        includes.push(format!("-I{}", ld.display()));
    }

    let cflags: Vec<&str> = vec!["-x", "c", "-std=gnu11"];
    // hoist the formatted string so it lives long enough to be borrowed
    let cxx_std_flag = format!("-std=gnu++{}", req.cpp_std.trim_start_matches("c++"));
    let cxxflags: Vec<&str> = vec![
        "-x", "c++",
        &cxx_std_flag,
        "-fpermissive", "-fno-exceptions",
        "-fno-threadsafe-statics",
        "-Wno-error=narrowing",
    ];

    // ── Flags fingerprint for incremental cache ───────────────────────────
    let flags_sig = hash_str(&format!("{:?}{:?}{:?}", includes, cflags, cxxflags));
    let core_sig  = hash_str(&format!("core{}{}", mcu, sdk.sdk_version));

    // ── Step 1: Build core.a ──────────────────────────────────────────────
    let core_dir  = req.build_dir.join("core");
    std::fs::create_dir_all(&core_dir)?;
    let core_a = req.build_dir.join("core.a");

    build_core(&cc, &cxx, &ar, &sdk.core_dir, &core_dir, &core_a,
               &includes, &cflags, &cxxflags, &core_sig, req.verbose)?;

    // ── Step 2: Compile sketch sources ───────────────────────────────────
    let sketch_dir = req.build_dir.join("sketch");
    std::fs::create_dir_all(&sketch_dir)?;

    let sources = collect_sketch_sources(&req.sketch_dir)?;

    if sources.is_empty() {
        return Err(FlashError::Other(format!(
            "No .cpp/.c/.ino sources found in {}", req.sketch_dir.display()
        )));
    }

    // Parallel compilation with error collection
    let errors: Mutex<Vec<String>> = Mutex::new(Vec::new());
    let mut manifest = CacheManifest::load(&sketch_dir);

    let obj_files: Vec<PathBuf> = sources.par_iter().map(|src| {
        let obj = obj_path(&sketch_dir, src);
        if manifest.is_fresh(src, &obj, &flags_sig) {
            if req.verbose {
                eprintln!("  [cache] {}", src.display());
            }
            return obj;
        }

        let is_c = src.extension().and_then(|e| e.to_str()) == Some("c");
        let compiler = if is_c { &cc } else { &cxx };

        let mut cmd = Command::new(compiler);
        cmd.args(&includes);

        if is_c {
            cmd.args(&cflags);
        } else {
            cmd.args(&cxxflags);
        }

        cmd.arg("-c").arg(src).arg("-o").arg(&obj);

        if req.verbose {
            eprintln!("  [compile] {}", src.display());
        }

        let out = cmd.output().expect("failed to spawn compiler");
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            errors.lock().unwrap().push(format!(
                "In {}:\n{}", src.display(), stderr
            ));
        }

        obj
    }).collect();

    // ── Save updated cache manifest ───────────────────────────────────────
    for src in &sources {
        let obj = obj_path(&sketch_dir, src);
        if obj.exists() {
            manifest.record(src, &flags_sig);
        }
    }
    let _ = manifest.save(&sketch_dir);

    let compile_errors = errors.into_inner().unwrap();
    if !compile_errors.is_empty() {
        return Err(FlashError::CompileFailed {
            output: compile_errors.join("\n\n"),
        });
    }

    // ── Step 3: Link elf ──────────────────────────────────────────────────
    let elf_path = req.build_dir.join(format!("{}.elf", req.project_name));

    let mut link_cmd = Command::new(&cc);
    link_cmd
        .arg("-w").arg("-Os").arg("-g").arg("-flto")
        .arg("-fuse-linker-plugin").arg("-Wl,--gc-sections")
        .arg(format!("-mmcu={}", mcu));

    for obj in &obj_files {
        link_cmd.arg(obj);
    }
    link_cmd.arg(&core_a);
    link_cmd.args(["-L", req.build_dir.to_str().unwrap()]);
    link_cmd.arg("-lm");
    link_cmd.arg("-o").arg(&elf_path);

    let link_out = link_cmd.output()?;
    if !link_out.status.success() {
        return Err(FlashError::LinkFailed {
            output: String::from_utf8_lossy(&link_out.stderr).to_string(),
        });
    }

    // ── Step 4: Generate .hex ─────────────────────────────────────────────
    let hex_path = req.build_dir.join(format!("{}.hex", req.project_name));
    let with_bl  = req.build_dir.join(format!("{}.with_bootloader.hex", req.project_name));

    let objcopy = resolve_tool(&sdk.toolchain_bin, "avr-objcopy");

    run_tool(&objcopy, &[
        "-O", "ihex", "-R", ".eeprom",
        elf_path.to_str().unwrap(),
        hex_path.to_str().unwrap(),
    ])?;

    // with_bootloader = same as .hex for standard upload flow
    std::fs::copy(&hex_path, &with_bl)?;

    // ── Step 5: Size report ───────────────────────────────────────────────
    let size_info = firmware_size(&sdk.toolchain_bin, &elf_path, board);

    Ok(CompileResult {
        hex_path: Some(hex_path),
        bin_path: None,
        elf_path: Some(elf_path),
        size_info,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
//  Core library compilation
// ─────────────────────────────────────────────────────────────────────────────

fn build_core(
    cc: &str, cxx: &str, ar: &str,
    core_src: &Path, core_obj_dir: &Path, core_a: &Path,
    includes: &[String],
    cflags: &[&str], cxxflags: &[&str],
    core_sig: &str,
    verbose: bool,
) -> Result<()> {
    // Check if core.a is already up-to-date via a sentinel file
    let sentinel = core_obj_dir.join(".core_sig");
    if let Ok(cached) = std::fs::read_to_string(&sentinel) {
        if cached.trim() == core_sig && core_a.exists() {
            return Ok(());
        }
    }

    if verbose {
        eprintln!("  [core] building Arduino core…");
    }

    let core_sources: Vec<PathBuf> = WalkDir::new(core_src)
        .max_depth(1)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            let ext = e.path().extension().and_then(|x| x.to_str()).unwrap_or("");
            matches!(ext, "c" | "cpp" | "S")
        })
        .map(|e| e.path().to_owned())
        .collect();

    // Compile core sources in parallel
    let errors: Mutex<Vec<String>> = Mutex::new(Vec::new());

    let obj_files: Vec<PathBuf> = core_sources.par_iter().map(|src| {
        let obj = obj_path(core_obj_dir, src);
        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");

        let is_c   = ext == "c";
        let is_asm = ext == "S";
        let compiler = if is_c || is_asm { cc } else { cxx };

        let mut cmd = Command::new(compiler);
        cmd.args(includes);

        if is_asm {
            cmd.arg("-x").arg("assembler-with-cpp");
        } else if is_c {
            cmd.args(cflags);
        } else {
            cmd.args(cxxflags);
        }

        cmd.arg("-c").arg(src).arg("-o").arg(&obj);

        let out = cmd.output().expect("compiler spawn failed");
        if !out.status.success() {
            errors.lock().unwrap().push(
                String::from_utf8_lossy(&out.stderr).to_string()
            );
        }

        obj
    }).collect();

    let errs = errors.into_inner().unwrap();
    if !errs.is_empty() {
        return Err(FlashError::CompileFailed { output: errs.join("\n") });
    }

    // Archive into core.a
    let mut ar_cmd = Command::new(ar);
    ar_cmd.args(["rcs", core_a.to_str().unwrap()]);
    for obj in &obj_files {
        if obj.exists() {
            ar_cmd.arg(obj);
        }
    }

    let ar_out = ar_cmd.output()?;
    if !ar_out.status.success() {
        return Err(FlashError::CompileFailed {
            output: String::from_utf8_lossy(&ar_out.stderr).to_string(),
        });
    }

    // Write sentinel
    let _ = std::fs::write(&sentinel, core_sig);

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn collect_sketch_sources(sketch_dir: &Path) -> Result<Vec<PathBuf>> {
    let mut sources = Vec::new();
    for entry in WalkDir::new(sketch_dir).max_depth(3).into_iter().flatten() {
        if !entry.file_type().is_file() { continue; }
        let ext = entry.path().extension()
            .and_then(|e| e.to_str()).unwrap_or("");
        if matches!(ext, "cpp" | "c" | "ino") {
            sources.push(entry.path().to_owned());
        }
    }
    Ok(sources)
}

fn resolve_tool(bin_dir: &Path, name: &str) -> String {
    if bin_dir.as_os_str().is_empty() {
        return name.to_owned(); // rely on PATH
    }
    let p = bin_dir.join(name);
    if p.exists() { p.to_string_lossy().to_string() } else { name.to_owned() }
}

fn run_tool(program: &str, args: &[&str]) -> Result<()> {
    let out = Command::new(program).args(args).output()?;
    if !out.status.success() {
        return Err(FlashError::CompileFailed {
            output: String::from_utf8_lossy(&out.stderr).to_string(),
        });
    }
    Ok(())
}

fn firmware_size(bin_dir: &Path, elf: &Path, board: &Board) -> String {
    let avr_size = resolve_tool(bin_dir, "avr-size");
    let out = Command::new(&avr_size)
        .args(["--format=avr", &format!("--mcu={}", board.avr_mcu().unwrap_or("atmega328p")), elf.to_str().unwrap()])
        .output();

    match out {
        Ok(o) if o.status.success() =>
            String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => {
            // Fallback: plain size
            let o = Command::new(&avr_size).arg(elf).output();
            match o {
                Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
                Err(_) => "(size unknown)".into(),
            }
        }
    }
}