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
    let _ar = resolve_tool(&sdk.toolchain_bin, "arm-none-eabi-gcc-ar");
    let objcopy = resolve_tool(&sdk.toolchain_bin, "arm-none-eabi-objcopy");
    let size    = resolve_tool(&sdk.toolchain_bin, "arm-none-eabi-size");

    // ── Early toolchain sanity check ──────────────────────────────────────
    // Validate the compiler exists BEFORE launching the parallel compile loop.
    // Without this, a missing toolchain surfaces as a cryptic "program not found"
    // error buried inside a rayon thread, with no context about why or how to fix it.
    //
    // We probe `arm-none-eabi-gcc --version` — a fast, harmless command that
    // exits 0 on every known version.  Failure means the toolchain is genuinely
    // absent and we emit an actionable SdkNotFound error immediately.
    {
        let probe = std::process::Command::new(&cxx)
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();

        if probe.is_err() || probe.map(|s| !s.success()).unwrap_or(true) {
            let install_hint = if cfg!(windows) {
                // Give Windows users a concrete path to follow.
                // Option 1: tsuki-flash modules install rp2040 (preferred)
                // Option 2: arduino-cli core install with earlephilhower URL
                format!(
                    "The ARM cross-compiler (arm-none-eabi-gcc) could not be found.\n\
                    \n\
                    To fix this, run ONE of the following:\n\
                    \n\
                      Option A — tsuki-modules (recommended, no arduino-cli needed):\n\
                        tsuki-flash modules install rp2040\n\
                    \n\
                      Option B — arduino-cli:\n\
                        arduino-cli core install rp2040:rp2040 --additional-urls \\\n\
                          https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json\n\
                    \n\
                      Option C — verify existing install:\n\
                        Expected toolchain at: {}\\packages\\rp2040\\tools\\pqt-gcc-arm-none-eabi\\<version>\\bin\\\n\
                    \n\
                    If you just installed, restart the IDE so the PATH is refreshed.",
                    std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "%LOCALAPPDATA%".into())
                )
            } else {
                format!(
                    "arm-none-eabi-gcc not found.\n\
                    \n\
                    Install it with:\n\
                      tsuki-flash modules install rp2040\n\
                    or on Debian/Ubuntu:\n\
                      sudo apt install gcc-arm-none-eabi"
                )
            };

            return Err(FlashError::SdkNotFound {
                arch:  "rp2040".into(),
                path:  cxx.display().to_string(),
                pkg:   install_hint,
            });
        }
    }

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
    for bundled in &sdk.bundled_libs_dirs {
        common_flags.push(format!("-I{}", bundled.display()));
    }
    if let Some(ld) = &sdk.libraries_dir {
        common_flags.push(format!("-I{}", ld.display()));
    }

    // ── lwIP / pico-sdk extra includes ────────────────────────────────────
    // The earlephilhower arduino-pico core includes IPAddress.h (via ArduinoCore-API)
    // which does `#include <lwip/init.h>`. The lwIP headers live inside the pico-sdk
    // that is bundled as a tool alongside the core. We scan two locations:
    //   1. <platform_root>/tools/  — for self-contained layouts (older cores)
    //   2. <packages_root>/rp2040/tools/  — for tool-download layouts (5.x cores)
    for inc in find_extra_includes(&sdk.core_dir) {
        common_flags.push(format!("-I{}", inc.display()));
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
                errors.lock().unwrap().push(format!(
                    "Failed to run compiler '{}': {}\n  \
                     Hint: run `tsuki-flash modules install rp2040` to install the ARM toolchain.",
                    compiler.display(), e
                ));
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

    // ── Step 5: convert .bin → .uf2 ──────────────────────────────────────
    // UF2 is the drag-and-drop format used by the RP2040 USB bootloader.
    // We generate it in pure Rust — no external tool required.
    let uf2_path = req.build_dir.join(format!("{}.uf2", req.project_name));
    if let Ok(bin_bytes) = std::fs::read(&bin_path) {
        if let Ok(uf2_bytes) = bin_to_uf2(&bin_bytes, RP2040_FLASH_BASE, RP2040_FAMILY_ID) {
            let _ = std::fs::write(&uf2_path, &uf2_bytes);
        }
    }

    Ok(CompileResult {
        hex_path:  None,
        bin_path:  Some(bin_path),
        elf_path:  Some(elf_path),
        uf2_path:  if uf2_path.exists() { Some(uf2_path) } else { None },
        size_info: size_out,
    })
}

// ── UF2 generation ────────────────────────────────────────────────────────────
// https://github.com/microsoft/uf2
// Each UF2 block is 512 bytes and wraps up to 256 bytes of payload.

const RP2040_FLASH_BASE: u32 = 0x1000_0000;
const RP2040_FAMILY_ID:  u32 = 0xe48b_ff56;

const UF2_MAGIC_START0: u32 = 0x0A32_4655;
const UF2_MAGIC_START1: u32 = 0x9E5D_5157;
const UF2_MAGIC_END:    u32 = 0xAB16_F30;
const UF2_FLAG_FAMILY:  u32 = 0x0000_2000;
const UF2_PAYLOAD_SIZE: usize = 256;
const UF2_BLOCK_SIZE:   usize = 512;

fn bin_to_uf2(bin: &[u8], base_addr: u32, family_id: u32) -> std::result::Result<Vec<u8>, ()> {
    let num_blocks = bin.chunks(UF2_PAYLOAD_SIZE).count() as u32;
    let mut out = Vec::with_capacity(num_blocks as usize * UF2_BLOCK_SIZE);

    for (block_no, chunk) in bin.chunks(UF2_PAYLOAD_SIZE).enumerate() {
        let target_addr = base_addr + (block_no as u32 * UF2_PAYLOAD_SIZE as u32);

        let mut block = [0u8; UF2_BLOCK_SIZE];
        let write_u32 = |buf: &mut [u8], offset: usize, val: u32| {
            buf[offset..offset + 4].copy_from_slice(&val.to_le_bytes());
        };

        write_u32(&mut block, 0,  UF2_MAGIC_START0);
        write_u32(&mut block, 4,  UF2_MAGIC_START1);
        write_u32(&mut block, 8,  UF2_FLAG_FAMILY);
        write_u32(&mut block, 12, target_addr);
        write_u32(&mut block, 16, UF2_PAYLOAD_SIZE as u32);
        write_u32(&mut block, 20, block_no as u32);
        write_u32(&mut block, 24, num_blocks);
        write_u32(&mut block, 28, family_id);
        block[32..32 + chunk.len()].copy_from_slice(chunk);
        write_u32(&mut block, 508, UF2_MAGIC_END);

        out.extend_from_slice(&block);
    }
    Ok(out)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn resolve_tool(toolchain_bin: &Path, name: &str) -> PathBuf {
    // When toolchain_bin is non-empty, look for the binary inside it.
    // We try both the plain name and the .exe variant (Windows) regardless of
    // OS so a Windows SDK mounted on Linux (or vice-versa) still resolves.
    if toolchain_bin != Path::new("") {
        let candidate = toolchain_bin.join(name);
        if candidate.is_file() { return candidate; }

        let with_exe = toolchain_bin.join(format!("{}.exe", name));
        if with_exe.is_file() { return with_exe; }

        // Some earlephilhower Windows packages name the binary with the full
        // target triple prefix, e.g. "arm-none-eabi-g++.exe" inside a dir
        // whose parent is named "pqt-gcc-arm-none-eabi".  The simple join above
        // should already handle this; the fallback is a best-effort scan.
    }

    // toolchain_bin is empty → rely on system PATH.
    // Return just the binary name; std::process::Command resolves it via PATH.
    PathBuf::from(name)
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
// ── Extra include discovery (lwIP / pico-sdk) ─────────────────────────────────
//
// The earlephilhower arduino-pico core (IPAddress.h via ArduinoCore-API) needs
// <lwip/init.h>. The lwIP headers are bundled inside the pico-sdk that is
// downloaded as a separate tool alongside the core.
//
// Layout for 5.x (earlephilhower):
//   <packages>/rp2040/tools/pqt-pico-sdk/<ver>/lib/lwip/src/include/
//   <packages>/rp2040/tools/pqt-pico-sdk/<ver>/src/rp2040/
//   <packages>/rp2040/tools/pqt-pico-sdk/<ver>/src/common/pico_base/include/
//   <packages>/rp2040/tools/pqt-pico-sdk/<ver>/pico-sdk/lib/lwip/src/include/  (alt)
//
// Layout for ≤4.x (self-contained in platform):
//   <platform>/tools/libpico/include/
//   <platform>/pico-sdk/lib/lwip/src/include/
//
// Strategy: probe all known fixed paths first (fast, no directory walking).
// Fall back to a shallow scan of the tools dir only when nothing is found.
fn find_extra_includes(core_dir: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    // core_dir → <platform>/cores/arduino
    // platform_root → <platform>  e.g. .../rp2040/hardware/rp2040/5.5.1
    let platform_root = match core_dir.parent().and_then(|p| p.parent()) {
        Some(p) => p.to_owned(),
        None    => return dirs,
    };

    // packages_vendor → <packages>/rp2040
    // path: platform_root / .. / .. / ..  strips  <ver> / rp2040(arch) / hardware
    let packages_vendor = platform_root
        .parent()                             // strip <ver>
        .and_then(|p| p.parent())             // strip <arch>
        .and_then(|p| p.parent())             // strip hardware/
        .map(|p| p.to_owned());

    let mut add = |p: PathBuf| { if p.is_dir() && !dirs.contains(&p) { dirs.push(p); } };

    // ── ≤4.x paths (inside platform itself) ───────────────────────────────
    let pt = platform_root.join("tools");
    add(pt.join("libpico").join("include"));
    // Some 4.x layouts embed the whole pico-sdk
    add(platform_root.join("pico-sdk").join("lib").join("lwip").join("src").join("include"));
    add(platform_root.join("pico-sdk").join("src").join("rp2040"));
    add(platform_root.join("pico-sdk").join("src").join("common").join("pico_base").join("include"));

    // ── 5.x paths (pqt-pico-sdk tool download) ────────────────────────────
    if let Some(ref pv) = packages_vendor {
        let tool_root = pv.join("tools").join("pqt-pico-sdk");
        if tool_root.is_dir() {
            // Find the installed version directory (there should be exactly one)
            if let Ok(entries) = std::fs::read_dir(&tool_root) {
                for entry in entries.flatten() {
                    let ver_dir = entry.path();
                    if !ver_dir.is_dir() { continue; }

                    // Primary lwIP include root
                    add(ver_dir.join("lib").join("lwip").join("src").join("include"));
                    // Alternate layout: pico-sdk embedded inside the tool
                    add(ver_dir.join("pico-sdk").join("lib").join("lwip").join("src").join("include"));
                    // pico_base headers (needed for pico/types.h etc.)
                    add(ver_dir.join("src").join("rp2040"));
                    add(ver_dir.join("src").join("common").join("pico_base").join("include"));
                    add(ver_dir.join("src").join("boards").join("include"));
                    // Some versions put everything under include/
                    add(ver_dir.join("include"));
                    // Generated headers (pico/config.h, lwipopts.h may live here)
                    // They are placed in the variant dir by the build system, but
                    // some setups need the platform-level generated includes too.
                    add(ver_dir.join("generated").join("pico_base"));
                }
            }
        }

        // Also check for a plain "pico-sdk" tool name (community builds)
        let plain_sdk = pv.join("tools").join("pico-sdk");
        if plain_sdk.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&plain_sdk) {
                for entry in entries.flatten() {
                    let ver_dir = entry.path();
                    if !ver_dir.is_dir() { continue; }
                    add(ver_dir.join("lib").join("lwip").join("src").join("include"));
                    add(ver_dir.join("src").join("rp2040"));
                    add(ver_dir.join("src").join("common").join("pico_base").join("include"));
                }
            }
        }
    }

    // ── lwipopts.h — the variant dir already has it (added in common_flags) ─
    // Some variants ship lwipopts.h directly, others inherit from the platform.
    // The variant_dir is already in common_flags as -I, so nothing extra needed.

    dirs
}