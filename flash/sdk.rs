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
pub fn resolve(arch: &str, variant: &str) -> Result<SdkPaths> {
    // ── 1. TSUKI_SDK_ROOT override ─────────────────────────────────────────
    if let Ok(root) = std::env::var("TSUKI_SDK_ROOT") {
        let base = PathBuf::from(&root);
        if let Some(paths) = try_sdk_root(&base, arch, variant) {
            return Ok(paths);
        }
    }

    // ── 2. arduino-cli package cache ──────────────────────────────────────
    let arduino15_dirs = arduino15_candidates();
    for base in &arduino15_dirs {
        if let Some(paths) = scan_arduino15(base, arch, variant) {
            return Ok(paths);
        }
    }

    // ── 3. Arduino IDE 1.x system install ─────────────────────────────────
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
        path:  arduino15_dirs.first().map(|p| p.display().to_string())
               .unwrap_or_else(|| "~/.arduino15".into()),
        pkg: match arch {
            "avr"    => "arduino:avr",
            "sam"    => "arduino:sam",
            "esp32"  => "esp32:esp32",
            "esp8266"=> "esp8266:esp8266",
            "rp2040" => "rp2040:rp2040",
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
    if let Some(home) = dirs_home() {
        // Standard
        dirs.push(home.join(".arduino15"));
        // Snap on Ubuntu
        dirs.push(home.join("snap/arduino/current/.arduino15"));
        // XDG override
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            dirs.push(PathBuf::from(xdg).join("arduino15"));
        }
        // macOS
        #[cfg(target_os = "macos")]
        dirs.push(home.join("Library/Arduino15"));
        // Windows
        #[cfg(target_os = "windows")]
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local).join("Arduino15"));
        }
    }
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
fn scan_arduino15(base: &Path, arch: &str, variant: &str) -> Option<SdkPaths> {
    let packages = base.join("packages");
    if !packages.is_dir() { return None; }

    // Map arch → package vendor/name
    let (vendor, hw_arch) = match arch {
        "avr"    => ("arduino", "avr"),
        "sam"    => ("arduino", "sam"),
        "esp32"  => ("esp32", "esp32"),
        "esp8266"=> ("esp8266", "esp8266"),
        "rp2040" => ("rp2040", "rp2040"),
        _        => return None,
    };

    let hw_base = packages.join(vendor).join("hardware").join(hw_arch);
    if !hw_base.is_dir() { return None; }

    // Find latest installed version
    let version = latest_version_dir(&hw_base)?;
    let sdk_dir = hw_base.join(&version);

    let core_dir    = sdk_dir.join("cores").join("arduino");
    let variant_dir = sdk_dir.join("variants").join(variant);

    if !core_dir.is_dir() { return None; }
    // Some boards use a different variant name; fall back to "standard"
    let variant_dir = if variant_dir.is_dir() {
        variant_dir
    } else {
        sdk_dir.join("variants").join("standard")
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
    let (tc_vendor, tc_name) = match arch {
        "avr"        => ("arduino", "avr-gcc"),
        "sam"        => ("arduino", "arm-none-eabi-gcc"),
        "rp2040"     => ("rp2040", "pqt-gcc-arm-none-eabi"),
        "esp32"      => ("esp32", "xtensa-esp32-elf-gcc"),
        "esp8266"    => ("esp8266", "xtensa-lx106-elf-gcc"),
        _            => return None,
    };

    let tc_base = base.join("packages").join(tc_vendor).join("tools").join(tc_name);
    if !tc_base.is_dir() {
        // Fall back to system PATH — caller will handle this
        return Some(PathBuf::from(""));
    }

    let version = latest_version_dir(&tc_base)?;
    let bin = tc_base.join(&version).join("bin");
    if bin.is_dir() { Some(bin) } else { None }
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
fn try_sdk_root(base: &Path, arch: &str, variant: &str) -> Option<SdkPaths> {
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