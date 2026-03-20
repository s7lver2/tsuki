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
use colored::Colorize;
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
            eprintln!("  {} tsuki-modules unavailable for '{}': {}", "⚠".yellow(), arch, e);
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

    let core_dir    = sdk_dir.join("cores").join("arduino");
    let variant_dir = sdk_dir.join("variants").join(variant);

    if !core_dir.is_dir() { return None; }

    // Variant resolution with smart fallback:
    // 1. Exact match (e.g. "seeed_xiao_rp2040")
    // 2. For rp2040: scan variants/ for any dir whose name contains the board keyword
    // 3. Fall back to "standard" or "rpipico" (earlephilhower default)
    // 4. Use first available variant
    let variant_dir = if variant_dir.is_dir() {
        variant_dir
    } else {
        let variants_root = sdk_dir.join("variants");
        let keyword = variant.split('_').next().unwrap_or(variant); // e.g. "seeed" from "seeed_xiao_rp2040"
        // Try partial match on board keyword
        let partial = variants_root.read_dir().ok()
            .and_then(|rd| rd.flatten().find(|e| {
                let n = e.file_name().to_string_lossy().to_lowercase();
                e.path().is_dir() && (n.contains(&variant.to_lowercase()) || n.contains(keyword))
            }))
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

    Some(SdkPaths {
        core_dir,
        variant_dir,
        toolchain_bin,
        libraries_dir,
        sdk_version: version,
    })
}

/// Find the toolchain binary directory inside the arduino15 package cache.
fn find_toolchain_bin(base: &Path, arch: &str, _vendor: &str) -> Option<PathBuf> {
    // For rp2040 there are two possible toolchain package names:
    //   earlephilhower core uses "pqt-gcc-arm-none-eabi" under vendor "rp2040"
    //   Newer versions may use "arm-none-eabi-gcc" under vendor "arduino"
    // We try all candidates in order; fall back to system PATH if none found.
    let candidates: &[(&str, &str)] = match arch {
        "avr"    => &[("arduino", "avr-gcc")],
        "sam"    => &[("arduino", "arm-none-eabi-gcc")],
        "rp2040" => &[
            ("rp2040", "pqt-gcc-arm-none-eabi"),
            ("rp2040", "pqt-arm-none-eabi-gcc"),
            ("arduino", "arm-none-eabi-gcc"),
        ],
        "esp32"  => &[("esp32", "xtensa-esp32-elf-gcc")],
        "esp8266"=> &[("esp8266", "xtensa-lx106-elf-gcc")],
        _        => return None,
    };

    for &(tc_vendor, tc_name) in candidates {
        let tc_base = base.join("packages").join(tc_vendor).join("tools").join(tc_name);
        if !tc_base.is_dir() { continue; }
        if let Some(version) = latest_version_dir(&tc_base) {
            let bin = tc_base.join(&version).join("bin");
            if bin.is_dir() { return Some(bin); }
        }
    }

    // Fall back to system PATH — caller will resolve the binary by name
    Some(PathBuf::from(""))
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
        sdk_version: "custom".into(),
    })
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