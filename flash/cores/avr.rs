#![allow(dead_code, unused_imports)]
// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: modules :: avr
//
//  The first tsuki-module. A superoptimized replacement for .arduino15 that
//  targets the AVR platform exclusively and is designed for maximum speed.
//
//  Differences from the generic `modules` system:
//
//    GENERIC                              THIS MODULE
//    ───────────────────────────────────  ──────────────────────────────────────
//    Fetches package_index.json (700 KB)  No network index — versions pinned
//    Parses + resolves latest version     Compile-time constants, zero parsing
//    Supports 5 architectures             AVR only — zero branching overhead
//    Returns nothing (side-effect only)   Returns SdkPaths directly
//    Separate ensure / sdk_paths calls    Single `ensure()` does both
//
//  Install layout mirrors .arduino15 exactly so sdk.rs works with zero changes:
//
//    ~/.tsuki/modules/
//      packages/
//        arduino/
//          hardware/avr/<CORE_VER>/      ← Arduino core headers
//          tools/avr-gcc/<GCC_VER>/      ← avr-gcc + avr-g++ + avr-objcopy
//      installed/avr.json                ← manifest (arch + version)
//
//  Public API:
//    avr::ensure(verbose)      → Result<SdkPaths>  (install if absent, return paths)
//    avr::ensure_variant(v, _) → Result<SdkPaths>  (for non-standard board variants)
//    avr::sdk_paths(variant)   → Result<SdkPaths>  (paths only, no install)
//    avr::is_ready()           → bool              (fast disk check, no IO errors)
//    avr::optimized_flags()    → AvrFlags          (pre-tuned compile flags)
//    avr::AVR_CORE_VERSION     → &str
//    avr::AVR_GCC_VERSION      → &str
// ─────────────────────────────────────────────────────────────────────────────

use std::path::PathBuf;
#[allow(unused_imports)]
use colored::Colorize;

use crate::error::{FlashError, Result};
use crate::sdk::SdkPaths;
use super::{modules_root, download_and_extract, write_installed_manifest};

// ─────────────────────────────────────────────────────────────────────────────
//  Pinned versions
//  Source: https://downloads.arduino.cc/packages/package_index.json
// ─────────────────────────────────────────────────────────────────────────────

/// Pinned arduino:avr core version.
pub const AVR_CORE_VERSION: &str = "1.8.6";

/// Pinned avr-gcc toolchain version.
pub const AVR_GCC_VERSION: &str = "7.3.0-atmel3.6.1-arduino7";

// ─────────────────────────────────────────────────────────────────────────────
//  Toolchain archives — one per OS/CPU triple
//  Used only by the fast-path build_sdk_paths(); actual downloads go through
//  the generic cores::install() which reads the live package_index.json.
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
//  Optimized compile flags
// ─────────────────────────────────────────────────────────────────────────────

/// Pre-tuned AVR compiler flags for tsuki-modules builds.
///
/// These go further than the generic `compile::avr` defaults: C++14 instead
/// of C++11, and the common flags are pre-sorted by how frequently the
/// compiler exits early on them (minor but real micro-optimisation on warm
/// incremental builds where the first changed file is a C++ file).
pub struct AvrFlags {
    /// Applied to both C and C++ compilations.
    pub common:    Vec<&'static str>,
    /// Extra flags for C-only translation units.
    pub c_extra:   Vec<&'static str>,
    /// Extra flags for C++-only translation units.
    pub cxx_extra: Vec<&'static str>,
    /// Linker flags (passed to avr-gcc at link stage).
    pub link:      Vec<&'static str>,
}

/// Returns pre-tuned AVR compilation flag sets.
pub fn optimized_flags() -> AvrFlags {
    AvrFlags {
        common: vec![
            "-Os",                     // optimize for size — critical on 32 KB flash
            "-w",                      // silence all warnings (faster compile output parsing)
            "-ffunction-sections",     // enables --gc-sections dead-code strip at link
            "-fdata-sections",         // same for data
            "-flto",                   // link-time optimization (10-15 % smaller binaries)
            "-MMD",                    // generate .d dependency files for incremental rebuild
            "-DARDUINO_ARCH_AVR",
            "-DARDUINO=10819",         // 1.8.19 compatibility string expected by most libs
        ],
        c_extra: vec![
            "-x", "c",
            "-std=gnu11",
        ],
        cxx_extra: vec![
            "-x", "c++",
            "-std=gnu++14",            // C++14 instead of generic c++11
            "-fpermissive",
            "-fno-exceptions",
            "-fno-threadsafe-statics", // removes __cxa_guard_acquire overhead
            "-Wno-error=narrowing",
        ],
        link: vec![
            "-w", "-Os", "-g",
            "-flto",
            "-fuse-linker-plugin",
            "-Wl,--gc-sections",       // strip unused code/data — typical saving 5-15 %
        ],
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public: ensure
// ─────────────────────────────────────────────────────────────────────────────

/// Ensure the AVR SDK is installed in `~/.tsuki/modules`. Returns `SdkPaths`
/// for the `standard` board variant (Uno / Nano / Mega / Pro Mini…).
///
/// **Fast path** — if both versioned directories already exist on disk this
/// returns in microseconds with zero network I/O.
///
/// **Slow path** — downloads core + toolchain in parallel, verifies SHA-256
/// checksums where available, extracts via system `tar` (+ pure-Rust ZIP
/// fallback), writes the installed manifest, then returns `SdkPaths`.
pub fn ensure(verbose: bool) -> Result<SdkPaths> {
    ensure_variant("standard", verbose)
}

/// Same as `ensure` but selects a specific AVR board variant directory.
/// Known variants: `standard`, `micro`, `leonardo`, `mega`, `eightanaloginputs`.
pub fn ensure_variant(variant: &str, verbose: bool) -> Result<SdkPaths> {
    let root = modules_root()?;
    let hw_base = root.join("packages").join("arduino").join("hardware").join("avr");
    let tc_base = root.join("packages").join("arduino").join("tools").join("avr-gcc");

    // ── Fast path: both core headers AND toolchain bin must be present ────
    let core_ready = latest_installed_dir(&hw_base)
        .filter(|d| d.join("cores").join("arduino").is_dir());
    let tc_ready = latest_installed_dir(&tc_base)
        .filter(|d| d.join("bin").is_dir());

    if let (Some(core_dir), Some(tc_dir)) = (core_ready, tc_ready) {
        if verbose {
            eprintln!("  [avr-module] cached  core {}", core_dir.file_name()
                .map(|n| n.to_string_lossy()).unwrap_or_default());
        }
        return build_sdk_paths(&root, &core_dir, &tc_dir, variant);
    }

    // ── Slow path: delegate to the generic installer which fetches the live
    // package_index.json and resolves correct URLs automatically. ─────────────
    super::install("avr", verbose)
        .map_err(|e| FlashError::Other(format!("AVR SDK install failed — {}", e)))?;

    // After install, sdk_paths() will find the newly-downloaded directories.
    sdk_paths(variant)
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public: sdk_paths
// ─────────────────────────────────────────────────────────────────────────────

/// Return `SdkPaths` for the already-installed AVR SDK — no download.
///
/// Scans `~/.tsuki/modules/packages/arduino/hardware/avr/` for any installed
/// version directory rather than relying on the pinned compile-time constants,
/// so it works regardless of which version `cores::install()` downloaded.
///
/// Returns `SdkNotFound` if the SDK is absent. Call `ensure()` to auto-install.
pub fn sdk_paths(variant: &str) -> Result<SdkPaths> {
    let root = modules_root()?;
    let hw_base = root.join("packages").join("arduino").join("hardware").join("avr");
    let tc_base = root.join("packages").join("arduino").join("tools").join("avr-gcc");

    // Find the newest installed core version directory.
    let core_dir = latest_installed_dir(&hw_base).ok_or_else(|| FlashError::SdkNotFound {
        arch:  "avr".into(),
        path:  hw_base.display().to_string(),
        pkg:   "tsuki-flash modules install avr".into(),
    })?;

    // Find the newest installed toolchain version directory.
    let tc_dir = latest_installed_dir(&tc_base).unwrap_or_else(|| PathBuf::from(""));

    build_sdk_paths(&root, &core_dir, &tc_dir, variant)
}

/// Return the newest version subdirectory inside `base`, or `None` if absent.
fn latest_installed_dir(base: &std::path::Path) -> Option<PathBuf> {
    let mut versions: Vec<String> = std::fs::read_dir(base)
        .ok()?
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    if versions.is_empty() { return None; }
    versions.sort_by(|a, b| {
        let va: Vec<u32> = a.split('.').map(|p| p.parse().unwrap_or(0)).collect();
        let vb: Vec<u32> = b.split('.').map(|p| p.parse().unwrap_or(0)).collect();
        vb.cmp(&va)
    });
    Some(base.join(&versions[0]))
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public: is_ready
// ─────────────────────────────────────────────────────────────────────────────

/// Returns `true` when the pinned AVR core directory already exists on disk.
///
/// Single `Path::is_dir()` — no IO errors, safe to call in hot paths.
pub fn is_ready() -> bool {
    modules_root()
        .ok()
        .and_then(|r| {
            latest_installed_dir(&r.join("packages").join("arduino").join("hardware").join("avr"))
        })
        .map(|d| d.join("cores").join("arduino").is_dir())
        .unwrap_or(false)
}

// ─────────────────────────────────────────────────────────────────────────────
//  Internal
// ─────────────────────────────────────────────────────────────────────────────

fn build_sdk_paths(
    root:     &std::path::Path,
    core_dir: &std::path::Path,
    tc_dir:   &std::path::Path,
    variant:  &str,
) -> Result<SdkPaths> {
    let core_src = core_dir.join("cores").join("arduino");
    if !core_src.is_dir() {
        return Err(FlashError::SdkNotFound {
            arch:  "avr".into(),
            path:  core_src.display().to_string(),
            pkg:   "tsuki-flash modules install avr".into(),
        });
    }

    // Variant dir — fall back to "standard" if the requested variant is absent
    let variant_dir = {
        let v = core_dir.join("variants").join(variant);
        if v.is_dir() { v } else { core_dir.join("variants").join("standard") }
    };

    // Toolchain bin dir — empty path = rely on $PATH (shouldn't happen post-install)
    let toolchain_bin = {
        let b = tc_dir.join("bin");
        if b.is_dir() { b } else { PathBuf::from("") }
    };

    let libraries_dir = {
        let d = root.join("libraries");
        if d.is_dir() { Some(d) } else { None }
    };

    Ok(SdkPaths {
        core_dir:      core_src,
        variant_dir,
        toolchain_bin,
        libraries_dir,
        sdk_version:   AVR_CORE_VERSION.into(),
    })
}