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

    // Probe for LTO plugin support once — result reused for compile + link flags.
    let lto_available = probe_lto_plugin(&sdk.toolchain_bin);

    let mut common_flags: Vec<String> = vec![
        format!("-mmcu={}", mcu),
        format!("-DF_CPU={}L", board.f_cpu()),
        format!("-DARDUINO={}", arduino_ver),
        format!("-D{}", board_define),
        "-DARDUINO_ARCH_AVR".into(),
        "-Os".into(),
        "-w".into(),
        "-ffunction-sections".into(),
        "-fdata-sections".into(),
        "-MMD".into(),
        format!("-I{}", sdk.core_dir.display()),
        format!("-I{}", sdk.variant_dir.display()),
    ];
    // Only add -flto when the linker plugin is available.
    // Without the plugin, -flto causes avr-gcc to emit LLVM/GCC IR bitcode in
    // the .o files, which avr-ld cannot link and exits with "ld returned 1".
    if lto_available {
        common_flags.insert(9, "-flto".into()); // after -fdata-sections
    }

    // Add extra include dirs (external libraries)
    let mut includes: Vec<String> = common_flags.clone();
    // Platform-bundled libraries (SPI, Wire, Servo, …) — must come before user
    // libraries so their headers are found when compiling user library sources
    // (e.g. U8g2's U8x8lib.cpp includes <SPI.h> from the platform bundle).
    for bundled_dir in &sdk.bundled_libs_dirs {
        includes.push(format!("-I{}", bundled_dir.display()));
    }
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
    let core_sig  = hash_str(&format!("core{}{}lto={}", mcu, sdk.sdk_version, lto_available));

    // ── Step 1: Build core.a ──────────────────────────────────────────────
    let core_dir  = req.build_dir.join("core");
    std::fs::create_dir_all(&core_dir)?;
    let core_a = req.build_dir.join("core.a");

    build_core(&cc, &cxx, &ar, &sdk.toolchain_bin, &sdk.core_dir, &core_dir, &core_a,
               &includes, &cflags, &cxxflags, &core_sig, req.verbose)?;

    // Sanity: core.a must exist and be non-empty.  An empty or missing archive
    // means the core source directory had no .cpp/.c/.S files — most likely the
    // SDK extraction went wrong.  Surface this early with a clear message.
    match std::fs::metadata(&core_a) {
        Ok(m) if m.len() == 0 => {
            return Err(FlashError::CompileFailed {
                output: format!(
                    "core.a is empty — Arduino core sources missing or failed to compile.\n                     Expected core sources in: {}\n                     Try: delete build/.cache and rebuild, or run `tsuki-flash modules install avr`",
                    sdk.core_dir.display()
                ),
            });
        }
        Err(_) => {
            return Err(FlashError::CompileFailed {
                output: format!(
                    "core.a was not created — all core source files failed to compile.\n                     Expected core sources in: {}\n                     Try: delete build/.cache and rebuild, or run `tsuki-flash modules install avr`",
                    sdk.core_dir.display()
                ),
            });
        }
        _ => {}
    }

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
        with_toolchain_path(&mut cmd, &sdk.toolchain_bin);
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

    // ── Step 3: Compile & archive user libraries (lib_source_dirs) ─────────
    //
    // `augment_lib_includes` has already collected every directory that
    // contains .cpp/.c sources from installed tsukilib packages.  We now
    // compile those sources into object files and archive them into libs.a.
    // Without this step the linker sees the headers (so the sketch compiles)
    // but never sees the implementations — producing "undefined reference to
    // DHT::begin" and similar errors.
    let libs_a = req.build_dir.join("libs.a");
    let lib_obj_dir = req.build_dir.join("lib_objs");
    std::fs::create_dir_all(&lib_obj_dir)?;

    let mut lib_obj_files: Vec<PathBuf> = Vec::new();
    for src_dir in &req.lib_source_dirs {
        // Collect .cpp and .c files at depth-1 only (skip examples/, test/, …)
        let lib_sources: Vec<PathBuf> = std::fs::read_dir(src_dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
            .filter(|e| {
                e.path().extension()
                    .and_then(|x| x.to_str())
                    .map(|x| matches!(x, "cpp" | "c"))
                    .unwrap_or(false)
            })
            .map(|e| e.path())
            .collect();

        for src in lib_sources {
            let obj = obj_path(&lib_obj_dir, &src);
            let is_c = src.extension().and_then(|e| e.to_str()) == Some("c");
            let compiler = if is_c { &cc } else { &cxx };

            let mut cmd = Command::new(compiler);
            with_toolchain_path(&mut cmd, &sdk.toolchain_bin);
            cmd.args(&includes);
            if is_c { cmd.args(&cflags); } else { cmd.args(&cxxflags); }
            cmd.arg("-c").arg(&src).arg("-o").arg(&obj);

            if req.verbose {
                eprintln!("  [lib] {}", src.display());
            }

            let out = cmd.output().expect("failed to spawn compiler for library");
            if out.status.success() {
                lib_obj_files.push(obj);
            } else {
                // Non-fatal: some library .cpp files may fail to compile in
                // isolation (missing platform headers, etc.).  Log and skip
                // rather than aborting the whole build.
                if req.verbose {
                    let msg = String::from_utf8_lossy(&out.stderr);
                    eprintln!("  [lib warn] {}: {}", src.display(), msg.trim());
                }
            }
        }
    }

    // Archive all successfully compiled library objects into libs.a
    if !lib_obj_files.is_empty() {
        let mut ar_cmd = Command::new(&ar);
        with_toolchain_path(&mut ar_cmd, &sdk.toolchain_bin);
        ar_cmd.args(["rcs", libs_a.to_str().unwrap()]);
        for obj in &lib_obj_files {
            ar_cmd.arg(obj);
        }
        let ar_out = ar_cmd.output()?;
        if !ar_out.status.success() && req.verbose {
            let msg = String::from_utf8_lossy(&ar_out.stderr);
            eprintln!("  [lib warn] ar failed: {}", msg.trim());
        }
    }

    // ── Step 5: Link elf ──────────────────────────────────────────────────
    let elf_path = req.build_dir.join(format!("{}.elf", req.project_name));

    let mut link_cmd = Command::new(&cc);
    // Inject the toolchain bin into PATH so avr-gcc can find liblto_plugin DLLs
    // on Windows (required for -fuse-linker-plugin / -flto to work correctly).
    with_toolchain_path(&mut link_cmd, &sdk.toolchain_bin);

    // -fuse-linker-plugin requires liblto_plugin-0.dll on Windows.
    // If that DLL is missing from the toolchain package, the linker crashes with
    // "ld returned 1 exit status" and no other diagnostic output.
    // We probe for the DLL and fall back to non-plugin LTO if it is absent.
    // lto_available was determined above alongside common_flags.
    link_cmd.arg("-w").arg("-Os").arg("-g");
    if lto_available {
        link_cmd.arg("-flto").arg("-fuse-linker-plugin");
    }
    link_cmd.arg("-Wl,--gc-sections").arg(format!("-mmcu={}", mcu));

    for obj in &obj_files {
        link_cmd.arg(obj);
    }
    // Wrap archives in --start-group/--end-group so the linker resolves
    // circular references between sketch objects, core.a, and libs.a.
    link_cmd.arg("-Wl,--start-group");
    link_cmd.arg(&core_a);
    // Link user library archive only if it was actually produced.
    if libs_a.exists() {
        link_cmd.arg(&libs_a);
    }
    link_cmd.arg("-lm");
    link_cmd.arg("-Wl,--end-group");
    link_cmd.args(["-L", req.build_dir.to_str().unwrap()]);
    link_cmd.arg("-o").arg(&elf_path);

    let link_out = link_cmd.output()?;
    if !link_out.status.success() {
        let mut combined = String::from_utf8_lossy(&link_out.stderr).to_string();
        let stdout_str = String::from_utf8_lossy(&link_out.stdout).to_string();
        if !stdout_str.trim().is_empty() {
            combined = format!("{}\n{}", stdout_str.trim(), combined.trim());
        }

        // If the linker says "undefined reference to `main'", the core.a is stale
        // (built with -flto bitcode that the linker can't read without the plugin,
        // or missing main.cpp).  Delete the sentinel so it is rebuilt on next run,
        // and surface a clear diagnostic instead of the raw linker message.
        // Only treat this as a stale-core.a situation when the linker truly
        // cannot find the `main` symbol — NOT when the error mentions a path
        // like "main.cpp:(.text.setup+0x1c)" which also contains "main".
        // Match the exact backtick form avr-ld uses: undefined reference to `main'
        let missing_main = combined.contains("undefined reference to `main'")
            || combined.contains("undefined reference to \"main\"");
        if missing_main {
            let sentinel = core_dir.join(".core_sig");
            let _ = std::fs::remove_file(&sentinel);
            let _ = std::fs::remove_file(&core_a);
            return Err(FlashError::LinkFailed {
                output: format!(
                    "{}\n\n                     ── Hint ────────────────────────────────────────────────\n                     core.a was stale (LTO mismatch or missing main.cpp).\n                     It has been deleted. Re-run the build to recompile it:\n                     {}",
                    combined.trim(),
                    "  tsuki build --compile --board uno".to_string(),
                ),
            });
        }

        return Err(FlashError::LinkFailed { output: combined });
    }

    // ── Step 6: Generate .hex ─────────────────────────────────────────────
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

    // ── Step 7: Size report ───────────────────────────────────────────────
    let size_info = firmware_size(&sdk.toolchain_bin, &elf_path, board);

    Ok(CompileResult {
        hex_path: Some(hex_path),
        bin_path: None,
        uf2_path: None,           // AVR produces .hex; UF2 is RP2040-only
        elf_path: Some(elf_path),
        size_info,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
//  Core library compilation
// ─────────────────────────────────────────────────────────────────────────────

fn build_core(
    cc: &str, cxx: &str, ar: &str,
    toolchain_bin: &Path,
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
        with_toolchain_path(&mut cmd, toolchain_bin);
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
    with_toolchain_path(&mut ar_cmd, toolchain_bin);
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
    // On Windows binaries have a .exe extension; try both.
    for candidate in &[name, &format!("{}.exe", name)] {
        let p = bin_dir.join(candidate);
        if p.exists() {
            return p.to_string_lossy().to_string();
        }
    }
    name.to_owned() // fallback: rely on PATH
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



// ─────────────────────────────────────────────────────────────────────────────
//  LTO plugin probe
//
//  On Windows, -fuse-linker-plugin requires liblto_plugin-0.dll to be present
//  in the toolchain bin directory.  If it is absent (some tsuki-modules builds
//  ship a stripped toolchain without the plugin), the linker silently exits
//  with code 1 and "collect2.exe: error: ld returned 1 exit status" as the
//  only output — with zero additional diagnostics.
//
//  We detect this at compile time and fall back to a plain link (no plugin)
//  which is slightly larger but always works.
// ─────────────────────────────────────────────────────────────────────────────

/// Returns true only when the LTO linker plugin is reliably available.
///
/// avr-gcc 7.x on Windows ships a stripped toolchain that either omits
/// liblto_plugin-0.dll entirely, or ships a version whose bfd-plugin
/// infrastructure silently fails during link-time code synthesis.  The
/// symptom is "undefined reference to `main'" with no further diagnostics —
/// the plugin loads but drops the Arduino core main() during LTO dead-code
/// analysis.
///
/// LTO is a size optimisation (~5-10% smaller .hex).  It is not required for
/// correct firmware.  We disable it on Windows to guarantee reliable builds.
fn probe_lto_plugin(_toolchain_bin: &Path) -> bool {
    // Always disabled on Windows — avr-gcc 7.x LTO is unreliable there.
    #[cfg(target_os = "windows")]
    return false;

    // On Linux and macOS the system toolchain handles LTO correctly.
    #[cfg(not(target_os = "windows"))]
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Windows DLL fix: prepend the toolchain bin to PATH so avr-gcc can find
//  liblto_plugin-0.dll (required for -fuse-linker-plugin / -flto link step).
//  On Linux/macOS this is a no-op because shared libraries are found via rpath.
// ─────────────────────────────────────────────────────────────────────────────

#[allow(unused_variables)]
fn with_toolchain_path(cmd: &mut Command, toolchain_bin: &Path) {
    if toolchain_bin.as_os_str().is_empty() { return; }

    let tc_bin_str = toolchain_bin.to_string_lossy().to_string();

    // On Windows, prepend the toolchain bin so the linker plugin DLLs are found.
    #[cfg(target_os = "windows")]
    {
        let current_path = std::env::var("PATH").unwrap_or_default();
        let new_path = if current_path.is_empty() {
            tc_bin_str.clone()
        } else {
            format!("{};{}", tc_bin_str, current_path)
        };
        cmd.env("PATH", new_path);
    }

    // On Unix we don't need to touch PATH — shared libs are handled via rpath.
    #[cfg(not(target_os = "windows"))]
    let _ = tc_bin_str; // suppress unused warning
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