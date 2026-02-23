// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: compile :: esp
//
//  Compiles Arduino ESP32 / ESP8266 sketches using the Espressif toolchain.
//
//  Pipeline:
//    1. Compile sketch sources  (parallel, incremental cache)
//    2. Link → firmware.elf
//    3. esptool.py → firmware.bin  +  firmware.hex (for consistency)
// ─────────────────────────────────────────────────────────────────────────────

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use rayon::prelude::*;
use walkdir::WalkDir;

use crate::boards::{Board, Toolchain};
use crate::error::{FlashError, Result};
use crate::sdk::SdkPaths;
use super::cache::{CacheManifest, hash_str, obj_path};
use super::{CompileRequest, CompileResult};

pub fn run(req: &CompileRequest, board: &Board, sdk: &SdkPaths) -> Result<CompileResult> {
    std::fs::create_dir_all(&req.build_dir)?;

    let (cc, cxx, is_esp32) = match &board.toolchain {
        Toolchain::Esp32 { .. } => (
            resolve_tool(&sdk.toolchain_bin, "xtensa-esp32-elf-gcc"),
            resolve_tool(&sdk.toolchain_bin, "xtensa-esp32-elf-g++"),
            true,
        ),
        Toolchain::Esp8266 => (
            resolve_tool(&sdk.toolchain_bin, "xtensa-lx106-elf-gcc"),
            resolve_tool(&sdk.toolchain_bin, "xtensa-lx106-elf-g++"),
            false,
        ),
        _ => return Err(FlashError::Other("Not an ESP board".into())),
    };

    let (arch_flags, link_script): (&[&str], &str) = if is_esp32 {
        (&["-mlongcalls", "-mtext-section-literals"], "esp32.ld")
    } else {
        (&["-mlongcalls", "-mtext-section-literals", "-falign-functions=4"], "eagle.app.v6.common.ld")
    };

    let common_flags: Vec<String> = {
        let mut f = vec![
            format!("-DF_CPU={}L", board.f_cpu()),
            "-DARDUINO=10819".into(),
            "-Os".into(), "-w".into(),
            "-ffunction-sections".into(), "-fdata-sections".into(),
            "-Wno-error=narrowing".into(),
            "-MMD".into(),
            format!("-I{}", sdk.core_dir.display()),
            format!("-I{}", sdk.variant_dir.display()),
        ];
        for d in board.defines {
            f.push(format!("-D{}", d));
        }
        for extra in &req.lib_include_dirs {
            f.push(format!("-I{}", extra.display()));
        }
        for flag in arch_flags {
            f.push(flag.to_string());
        }
        f
    };

    let cxxflags = [
        "-fpermissive", "-fno-exceptions", "-fno-threadsafe-statics",
        &format!("-std=gnu++{}", req.cpp_std.trim_start_matches("c++")),
    ];

    let flags_sig = hash_str(&format!("{:?}{:?}", common_flags, cxxflags));
    let sketch_obj_dir = req.build_dir.join("sketch");
    std::fs::create_dir_all(&sketch_obj_dir)?;

    let sources = collect_sources(&req.sketch_dir)?;
    if sources.is_empty() {
        return Err(FlashError::Other("No source files found".into()));
    }

    let errors: Mutex<Vec<String>> = Mutex::new(Vec::new());
    let mut manifest = CacheManifest::load(&sketch_obj_dir);

    let obj_files: Vec<PathBuf> = sources.par_iter().map(|src| {
        let obj = obj_path(&sketch_obj_dir, src);
        if manifest.is_fresh(src, &obj, &flags_sig) {
            return obj;
        }

        let is_c = src.extension().and_then(|e| e.to_str()) == Some("c");
        let compiler = if is_c { &cc } else { &cxx };

        let mut cmd = Command::new(compiler);
        cmd.args(&common_flags);
        if !is_c { cmd.args(&cxxflags); }
        cmd.arg("-c").arg(src).arg("-o").arg(&obj);

        let out = cmd.output().expect("compiler spawn failed");
        if !out.status.success() {
            errors.lock().unwrap().push(
                format!("In {}:\n{}", src.display(),
                        String::from_utf8_lossy(&out.stderr))
            );
        }
        obj
    }).collect();

    for src in &sources {
        let obj = obj_path(&sketch_obj_dir, src);
        if obj.exists() { manifest.record(src, &flags_sig); }
    }
    let _ = manifest.save(&sketch_obj_dir);

    let errs = errors.into_inner().unwrap();
    if !errs.is_empty() {
        return Err(FlashError::CompileFailed { output: errs.join("\n\n") });
    }

    // ── Link ──────────────────────────────────────────────────────────────
    let elf = req.build_dir.join(format!("{}.elf", req.project_name));
    let linker = if is_esp32 {
        resolve_tool(&sdk.toolchain_bin, "xtensa-esp32-elf-gcc")
    } else {
        resolve_tool(&sdk.toolchain_bin, "xtensa-lx106-elf-gcc")
    };

    let mut link_cmd = Command::new(&linker);
    link_cmd.args(&common_flags)
        .arg(format!("-Wl,-T{}", link_script))
        .arg("-Wl,--gc-sections")
        .arg("-Wl,-Map,/dev/null");
    for obj in &obj_files { link_cmd.arg(obj); }
    link_cmd.arg("-lm").arg("-o").arg(&elf);

    let link_out = link_cmd.output()?;
    if !link_out.status.success() {
        return Err(FlashError::LinkFailed {
            output: String::from_utf8_lossy(&link_out.stderr).to_string(),
        });
    }

    // ── Generate .bin with elf2image (esptool) ────────────────────────────
    let bin = req.build_dir.join(format!("{}.bin", req.project_name));
    let esptool = which_esptool();

    if let Some(tool) = &esptool {
        let chip = if is_esp32 { "esp32" } else { "esp8266" };
        let _ = Command::new(tool)
            .args(["--chip", chip, "elf2image", "--output"])
            .arg(&bin)
            .arg(&elf)
            .output();
    }

    Ok(CompileResult {
        hex_path: None,
        bin_path: if bin.exists() { Some(bin) } else { None },
        elf_path: Some(elf),
        size_info: String::new(),
    })
}

fn collect_sources(dir: &Path) -> Result<Vec<PathBuf>> {
    Ok(WalkDir::new(dir).max_depth(3).into_iter().flatten()
        .filter(|e| e.file_type().is_file())
        .filter(|e| matches!(
            e.path().extension().and_then(|x| x.to_str()).unwrap_or(""),
            "cpp" | "c" | "ino"
        ))
        .map(|e| e.path().to_owned())
        .collect())
}

fn resolve_tool(bin_dir: &Path, name: &str) -> String {
    if bin_dir.as_os_str().is_empty() { return name.to_owned(); }
    let p = bin_dir.join(name);
    if p.exists() { p.to_string_lossy().to_string() } else { name.to_owned() }
}

fn which_esptool() -> Option<String> {
    for candidate in &["esptool.py", "esptool"] {
        if Command::new(candidate).arg("version").output().is_ok() {
            return Some(candidate.to_string());
        }
    }
    None
}