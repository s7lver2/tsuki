// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: sdk  —  Arduino SDK path discovery
//
//  Looks for the SDK (core headers + libraries) in these locations, in order:
//
//  1. TSUKI_SDK_ROOT env var  (manual override)
//  2. arduino-cli package cache  (~/.arduino15/packages/…)
//  3. Arduino IDE 2.x local data  (~/.arduinoIDE/… or ~/snap/arduino/…)
//  4. Arduino IDE 1.x install    (/usr/share/arduino or /usr/local/share/arduino)
//
//  Returns SdkPaths with the resolved include dirs, core dir, and toolchain bin.
// ─────────────────────────────────────────────────────────────────────────────

use std::path::{Path, PathBuf};
use tsuki_ux::color::C_WARN;
use crate::error::{FlashError, Result};

/// All filesystem paths required to compile for a given architecture.
#[derive(Debug, Clone)]
pub struct SdkPaths {
    /// Directory containing Arduino.h and other core headers
    pub core_dir:    PathBuf,
    /// Variant include dir (pins_arduino.h, etc.)
    pub variant_dir: PathBuf,
    /// Directory with compiler binaries (avr-gcc, etc.)
    pub toolchain_bin: PathBuf,
    /// Installed user libraries root (for -I)
    pub libraries_dir: Option<PathBuf>,
    /// Include dirs for platform-bundled libraries (SPI, Wire, Servo, …).
    /// These live inside the SDK platform directory itself:
    ///   <sdk>/libraries/SPI/        → added
    ///   <sdk>/libraries/SPI/src/    → added (standard Arduino src/ layout)
    /// Required so that user libraries (e.g. U8g2) can #include <SPI.h>.
    pub bundled_libs_dirs: Vec<PathBuf>,
    /// SDK version string (informational)
    pub sdk_version: String,
}

/// Resolve SDK paths for a given board architecture + variant.
pub fn resolve(arch: &str, variant: &str, verbose: bool) -> Result<SdkPaths> {
    // ── 1. TSUKI_SDK_ROOT override ─────────────────────────────────────────
    if let Ok(root) = std::env::var("TSUKI_SDK_ROOT") {
        let base = PathBuf::from(&root);
        if let Some(paths) = try_sdk_root(&base, arch, variant) {
            return Ok(paths);
        }
    }

    // ── 2. tsuki-modules (~/.tsuki/modules/) ─────────────────────────────────
    // For ALL architectures, ensure_arch() auto-downloads the SDK on first use
    // using pure-Rust extraction (no system tar/bzip2/xz, no arduino-cli needed).
    // Fast path: already installed → returns in microseconds, zero network I/O.
    // If download fails (no network, offline env) we fall through to arduino-cli.
    match crate::cores::ensure_arch(arch, variant, verbose) {
        Ok(paths) => return Ok(paths),
        Err(e) => {
            eprintln!("  {} tsuki-modules unavailable for '{}': {}", C_WARN.paint("⚠"), arch, e);
            eprintln!("  Falling back to arduino-cli package cache…");
        }
    }

    // ── 3. arduino-cli package cache (fallback) ────────────────────────────
    let arduino15_dirs = arduino15_candidates();
    if verbose {
        eprintln!("  [sdk] arch='{}' variant='{}'", arch, variant);
        for d in &arduino15_dirs {
            eprintln!("  [sdk] checking arduino15: {}", d.display());
        }
    } else {
        // Always print candidates for rp2040 so users can diagnose SDK issues
        if arch == "rp2040" {
            for d in &arduino15_dirs {
                eprintln!("  [sdk/rp2040] checking: {}", d.display());
                let packages = d.join("packages");
                if packages.is_dir() {
                    eprintln!("    packages/ found — looking for rp2040/hardware/rp2040/...");
                    let hw = packages.join("rp2040").join("hardware").join("rp2040");
                    if hw.is_dir() {
                        if let Ok(entries) = std::fs::read_dir(&hw) {
                            for e in entries.flatten() {
                                eprintln!("    version: {}", e.file_name().to_string_lossy());
                            }
                        }
                    } else {
                        eprintln!("    rp2040/hardware/rp2040/ NOT found");
                    }
                }
            }
        }
    }
    for base in &arduino15_dirs {
        if let Some(paths) = scan_arduino15(base, arch, variant) {
            return Ok(paths);
        }
    }

    // ── 4. Arduino IDE 1.x system install ─────────────────────────────────
    let system_dirs = [
        PathBuf::from("/usr/share/arduino"),
        PathBuf::from("/usr/local/share/arduino"),
        PathBuf::from("/opt/arduino"),
    ];
    for base in &system_dirs {
        if let Some(paths) = try_arduino1_install(base, arch, variant) {
            return Ok(paths);
        }
    }

    // ── macOS Arduino 2 app bundle ─────────────────────────────────────────
    #[cfg(target_os = "macos")]
    {
        let mac_app = PathBuf::from("/Applications/Arduino IDE.app/Contents/Resources/app/node_modules/arduino-ide-extension/build");
        if let Some(paths) = scan_arduino15(&mac_app, arch, variant) {
            return Ok(paths);
        }
    }

    Err(FlashError::SdkNotFound {
        arch:  arch.to_owned(),
        path:  arduino15_dirs
                   .iter()
                   .map(|p| p.display().to_string())
                   .collect::<Vec<_>>()
                   .join(", "),
        pkg: match arch {
            "avr"    => "arduino:avr",
            "sam"    => "arduino:sam",
            "esp32"  => "esp32:esp32",
            "esp8266"=> "esp8266:esp8266",
            "rp2040" => "rp2040:rp2040  (install via: arduino-cli core install rp2040:rp2040 --additional-urls https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json)",
            _        => arch,
        }.into(),
    })
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// All candidate arduino15 base dirs on the current OS.
fn arduino15_candidates() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            dirs.push(PathBuf::from(&local).join("Arduino15"));
        }
        if let Ok(roaming) = std::env::var("APPDATA") {
            dirs.push(PathBuf::from(&roaming).join("Arduino15"));
        }
        // arduino-cli on Windows also installs to %USERPROFILE%\.arduino15
        // (the same path as Linux/macOS ~/.arduino15 — confirmed from user reports)
        if let Ok(profile) = std::env::var("USERPROFILE") {
            dirs.push(PathBuf::from(&profile).join(".arduino15"));
        }
    }

    if let Some(home) = dirs_home() {
        dirs.push(home.join(".arduino15"));
        dirs.push(home.join("snap/arduino/current/.arduino15"));
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            dirs.push(PathBuf::from(xdg).join("arduino15"));
        }
        #[cfg(target_os = "macos")]
        dirs.push(home.join("Library/Arduino15"));
    }
    // Deduplicate while preserving order
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|p| seen.insert(p.clone()));
    dirs
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(PathBuf::from)
        .or_else(|| dirs_home_windows())
}

#[allow(dead_code)]
fn dirs_home_windows() -> Option<PathBuf> {
    std::env::var("USERPROFILE").ok().map(PathBuf::from)
}

/// Scan ~/.arduino15/packages/<vendor>/hardware/<arch>/<version>/ structure.
/// Scan the tsuki-modules layout for an already-installed arch SDK.
/// This is a thin wrapper around scan_arduino15 using the modules root.
/// Called by cores::ensure_arch() for the fast path and by cores::ensure_arch()
/// after a fresh install to return SdkPaths.
pub(crate) fn scan_tsuki_modules(root: &Path, arch: &str, variant: &str) -> Option<SdkPaths> {
    scan_arduino15(root, arch, variant)
}


pub(crate) fn scan_arduino15(base: &Path, arch: &str, variant: &str) -> Option<SdkPaths> {
    let packages = base.join("packages");
    if !packages.is_dir() { return None; }

    // Map arch → (vendor, hw_arch) pairs to try — multiple vendors for rp2040
    // because the earlephilhower core uses vendor "rp2040" while some setups
    // use "arduino" as the vendor prefix. We try all known layouts.
    let candidates: &[(&str, &str)] = match arch {
        "avr"    => &[("arduino", "avr")],
        "sam"    => &[("arduino", "sam")],
        "esp32"  => &[("esp32", "esp32")],
        "esp8266"=> &[("esp8266", "esp8266")],
        // earlephilhower uses vendor "rp2040"; official Arduino uses "arduino"
        "rp2040" => &[("rp2040", "rp2040"), ("arduino", "rp2040")],
        _        => return None,
    };

    for &(vendor, hw_arch) in candidates {
        if let Some(paths) = scan_arduino15_vendor(base, arch, vendor, hw_arch, variant) {
            return Some(paths);
        }
    }
    None
}

fn scan_arduino15_vendor(
    base:    &Path,
    arch:    &str,
    vendor:  &str,
    hw_arch: &str,
    variant: &str,
) -> Option<SdkPaths> {
    let packages = base.join("packages");
    let hw_base = packages.join(vendor).join("hardware").join(hw_arch);
    if !hw_base.is_dir() { return None; }

    // Find latest installed version
    let version = latest_version_dir(&hw_base)?;
    let sdk_dir = hw_base.join(&version);

    // Different platforms use different subdirectory names under cores/:
    //   AVR, SAM, RP2040  → cores/arduino/
    //   ESP8266           → cores/esp8266/   (NOT cores/arduino/)
    //   ESP32             → cores/esp32/     (NOT cores/arduino/)
    // Hardcoding "arduino" caused scan to return None for ESP8266/ESP32 even
    // after a successful SDK download, making the SDK appear "not found".
    let cores_root = sdk_dir.join("cores");
    let core_dir = ["arduino", arch, hw_arch, "esp8266", "esp32"]
        .iter()
        .map(|name| cores_root.join(name))
        .find(|p| p.is_dir())
        .or_else(|| {
            std::fs::read_dir(&cores_root).ok()
                .and_then(|rd| rd.flatten().find(|e| e.path().is_dir()))
                .map(|e| e.path())
        })?;

    let variant_dir = sdk_dir.join("variants").join(variant);

    // Variant resolution with smart fallback:
    // 1. Exact match (e.g. "seeed_xiao_rp2040")
    // 2. For rp2040: scan variants/ for any dir whose name contains the board keyword
    // 3. Fall back to "standard" or "rpipico" (earlephilhower default)
    // 4. Use first available variant
    let variant_dir = if variant_dir.is_dir() {
        variant_dir
    } else {
        let variants_root = sdk_dir.join("variants");
        // Build a list of keywords from all parts of the variant id.
        // e.g. "seeed_xiao_rp2040" → ["seeed_xiao_rp2040", "seeed", "xiao", "rp2040"]
        // This lets "XIAO_RP2040" match even though its name doesn't contain "seeed".
        let variant_lower = variant.to_lowercase();
        let keywords: Vec<&str> = std::iter::once(variant_lower.as_str())
            .chain(variant_lower.split('_'))
            .collect();
        // Try partial match — first dir whose lowercase name contains ANY keyword
        let partial = variants_root.read_dir().ok()
            .and_then(|rd| {
                let mut entries: Vec<_> = rd.flatten()
                    .filter(|e| e.path().is_dir())
                    .collect();
                // Prefer longer matches (more specific) — sort by name length desc
                entries.sort_by_key(|e| std::cmp::Reverse(e.file_name().len()));
                entries.into_iter().find(|e| {
                    let n = e.file_name().to_string_lossy().to_lowercase();
                    keywords.iter().any(|kw| kw.len() > 2 && n.contains(*kw))
                })
            })
            .map(|e| e.path());
        if let Some(p) = partial.filter(|p| p.is_dir()) {
            p
        } else {
            // Try well-known fallbacks
            let fallbacks = ["standard", "rpipico", "generic"];
            fallbacks.iter()
                .map(|f| variants_root.join(f))
                .find(|p| p.is_dir())
                .unwrap_or_else(|| variants_root)  // worst case: use root of variants/
        }
    };

    // Toolchain binary dir
    let toolchain_bin = find_toolchain_bin(base, arch, vendor)?;

    let libraries_dir = {
        let d = base.join("libraries");
        if d.is_dir() { Some(d) } else { None }
    };

    // Platform-bundled libraries (SPI, Wire, Servo, EEPROM, …) live inside
    // the SDK platform directory under libraries/.  They must be on the include
    // path so that user libraries (e.g. U8g2) can #include <SPI.h>.
    let bundled_libs_dirs = collect_bundled_lib_dirs(&sdk_dir.join("libraries"));

    Some(SdkPaths {
        core_dir,
        variant_dir,
        toolchain_bin,
        libraries_dir,
        bundled_libs_dirs,
        sdk_version: version,
    })
}

/// Find the toolchain binary directory inside the arduino15 package cache.
fn find_toolchain_bin(base: &Path, arch: &str, _vendor: &str) -> Option<PathBuf> {
    // For rp2040 there are two possible toolchain package names:
    //   earlephilhower core uses "pqt-gcc-arm-none-eabi" under vendor "rp2040"
    //   Newer versions may use "arm-none-eabi-gcc" under vendor "arduino"
    //
    // The search is intentionally broad:
    //   1. Check all known package/vendor combinations.
    //   2. For each installed version, try both `bin/` and the version root itself
    //      (earlephilhower on Windows sometimes places binaries at the root).
    //   3. If nothing found in the package cache, check system PATH explicitly
    //      via a probe command — return the empty path ONLY when the tool is
    //      confirmed reachable, otherwise return None so the caller can emit a
    //      proper SdkNotFound error instead of a silent "program not found".
    let candidates: &[(&str, &str)] = match arch {
        "avr"    => &[("arduino", "avr-gcc")],
        "sam"    => &[("arduino", "arm-none-eabi-gcc")],
        "rp2040" => &[
            ("rp2040", "pqt-gcc"),               // earlephilhower 5.x (actual name on disk)
            ("rp2040", "pqt-gcc-arm-none-eabi"), // earlephilhower older alias
            ("rp2040", "pqt-arm-none-eabi-gcc"), // alternate naming
            ("rp2040", "arm-none-eabi"),          // some community builds
            ("arduino", "arm-none-eabi-gcc"),
        ],
        "esp32"  => &[("esp32",   "xtensa-esp32-elf-gcc"),
                      ("esp32",   "xtensa-esp32s2-elf-gcc"),
                      ("esp32",   "xtensa-esp32s3-elf-gcc")],
        "esp8266"=> &[("esp8266", "xtensa-lx106-elf-gcc")],
        _        => return None,
    };

    // Primary probe tool name (used for PATH check and bin/ subfolder validation)
    let probe_bin = match arch {
        "avr"          => "avr-gcc",
        "sam" | "rp2040" => "arm-none-eabi-gcc",
        "esp32"        => "xtensa-esp32-elf-gcc",
        "esp8266"      => "xtensa-lx106-elf-gcc",
        _              => return None,
    };
    let probe_exe = if cfg!(windows) { format!("{}.exe", probe_bin) } else { probe_bin.to_owned() };

    for &(tc_vendor, tc_name) in candidates {
        let tc_base = base.join("packages").join(tc_vendor).join("tools").join(tc_name);
        if !tc_base.is_dir() { continue; }

        if let Some(version) = latest_version_dir(&tc_base) {
            let ver_dir = tc_base.join(&version);

            // Layout 1: standard `bin/` subdir (Linux, macOS, most Windows builds)
            let bin_dir = ver_dir.join("bin");
            if bin_dir.join(&probe_exe).is_file() {
                return Some(bin_dir);
            }
            // Layout 2: binaries directly in the version root (some earlephilhower
            // Windows packages omit the `bin/` level entirely)
            if ver_dir.join(&probe_exe).is_file() {
                return Some(ver_dir);
            }
            // Layout 3: bin/ exists but tool has a different name — any .exe inside
            // whose stem matches the architecture prefix is good enough
            if bin_dir.is_dir() {
                let arch_prefix = match arch {
                    "rp2040" => "arm-none-eabi",
                    "avr"    => "avr-gcc",
                    _        => probe_bin,
                };
                let has_compiler = std::fs::read_dir(&bin_dir)
                    .map(|rd| rd.flatten().any(|e| {
                        let n = e.file_name().to_string_lossy().to_lowercase();
                        n.starts_with(arch_prefix) && (n.ends_with(".exe") || !n.contains('.'))
                    }))
                    .unwrap_or(false);
                if has_compiler { return Some(bin_dir); }
            }
        }
    }

    // Nothing found in the package cache.
    // Check if the tool is reachable via system PATH before returning the
    // "use PATH" sentinel (empty PathBuf).  If it is NOT on PATH we return
    // None so sdk::resolve() can ultimately emit a SdkNotFound error with
    // proper installation instructions instead of an opaque "program not found".
    let path_found = std::process::Command::new(probe_bin)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok();

    if path_found {
        Some(PathBuf::from(""))   // use system PATH — tool is confirmed reachable
    } else {
        None   // triggers SdkNotFound with a proper actionable error message
    }
}

/// Arduino IDE 1.x system install (e.g. /usr/share/arduino).
fn try_arduino1_install(base: &Path, arch: &str, variant: &str) -> Option<SdkPaths> {
    if arch != "avr" { return None; }  // IDE 1.x only supported AVR officially
    let hw = base.join("hardware").join("arduino").join("avr");
    let core_dir = hw.join("cores").join("arduino");
    if !core_dir.is_dir() { return None; }

    let variant_dir = hw.join("variants").join(variant);
    let variant_dir = if variant_dir.is_dir() { variant_dir }
                      else { hw.join("variants").join("standard") };

    // IDE 1.x bundles avr-gcc in hardware/tools/avr/bin
    let tc_bin = base.join("hardware").join("tools").join("avr").join("bin");
    let toolchain_bin = if tc_bin.is_dir() { tc_bin }
                        else { PathBuf::from("") }; // system PATH

    Some(SdkPaths {
        core_dir, variant_dir,
        toolchain_bin,
        libraries_dir: Some(base.join("libraries")),
        bundled_libs_dirs: collect_bundled_lib_dirs(&hw.join("libraries")),
        sdk_version: "1.x".into(),
    })
}

/// Try an explicit SDK root (TSUKI_SDK_ROOT).
fn try_sdk_root(base: &Path, _arch: &str, variant: &str) -> Option<SdkPaths> {
    let core_dir    = base.join("cores").join("arduino");
    let variant_dir = base.join("variants").join(variant);
    if !core_dir.is_dir() { return None; }
    let variant_dir = if variant_dir.is_dir() { variant_dir }
                      else { base.join("variants").join("standard") };
    let toolchain_bin = base.join("bin");
    let toolchain_bin = if toolchain_bin.is_dir() { toolchain_bin }
                        else { PathBuf::from("") };
    Some(SdkPaths {
        core_dir, variant_dir,
        toolchain_bin,
        libraries_dir: None,
        bundled_libs_dirs: collect_bundled_lib_dirs(&base.join("libraries")),
        sdk_version: "custom".into(),
    })
}

/// Collect include dirs for platform-bundled Arduino libraries.
///
/// Arduino platforms ship libraries like SPI, Wire, Servo, EEPROM under
/// `<sdk>/libraries/`.  Each library may use either a flat layout (headers
/// directly in the library root) or the standard `src/` subdirectory layout.
/// Both the root and `src/` are added so `#include <SPI.h>` resolves
/// regardless of how the library is structured.
///
/// Example output for an AVR SDK:
///   <sdk>/libraries/SPI/
///   <sdk>/libraries/SPI/src/      (if present)
///   <sdk>/libraries/Wire/
///   <sdk>/libraries/Wire/utility/ (if present — Wire uses this)
///   …
pub(crate) fn collect_bundled_lib_dirs(libs_root: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let Ok(entries) = std::fs::read_dir(libs_root) else { return dirs };

    for entry in entries.flatten() {
        let lib_dir = entry.path();
        if !lib_dir.is_dir() { continue; }

        // Always add the library root (headers may live here directly)
        dirs.push(lib_dir.clone());

        // Add src/ if present (standard Arduino library layout)
        let src = lib_dir.join("src");
        if src.is_dir() { dirs.push(src); }

        // Add utility/ if present (Wire and some other bundled libs use this)
        let util = lib_dir.join("utility");
        if util.is_dir() { dirs.push(util); }
    }
    dirs
}

/// Return the string name of the latest (semver-ish) directory inside `base`.
fn latest_version_dir(base: &Path) -> Option<String> {
    let mut versions: Vec<String> = std::fs::read_dir(base)
        .ok()?
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();

    if versions.is_empty() { return None; }

    // Sort by semver components
    versions.sort_by(|a, b| {
        let va = parse_ver(a);
        let vb = parse_ver(b);
        vb.cmp(&va) // descending → latest first
    });

    Some(versions.into_iter().next().unwrap())
}

fn parse_ver(s: &str) -> Vec<u32> {
    s.split('.').map(|p| p.parse::<u32>().unwrap_or(0)).collect()
}