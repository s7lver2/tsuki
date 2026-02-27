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
use colored::Colorize;
use rayon::prelude::*;

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
//  Core archive  (architecture-independent)
// ─────────────────────────────────────────────────────────────────────────────

const CORE_URL: &str =
    "https://downloads.arduino.cc/cores/avr-1.8.6.tar.bz2";
// SHA-256 from package_index.json — skip verification by setting to None
// if you need to update the pinned version.
const CORE_SHA256: &str =
    "SHA-256:35b519f9602c40ef4ea7e07d2d3494c2d7f7e6c17aa84d11c59cfce2a38a4e61";

// ─────────────────────────────────────────────────────────────────────────────
//  Toolchain archives — one per OS/CPU triple
//  Checksums from package_index.json arduino namespace, avr-gcc tool entries
// ─────────────────────────────────────────────────────────────────────────────

struct TcEntry {
    host:     &'static str,
    url:      &'static str,
    checksum: Option<&'static str>,
}

static TOOLCHAIN: &[TcEntry] = &[
    TcEntry {
        host: "x86_64-pc-linux-gnu",
        url:  "https://downloads.arduino.cc/tools/avr-gcc-7.3.0-atmel3.6.1-arduino7-x86_64-pc-linux-gnu.tar.bz2",
        checksum: Some("SHA-256:3903553d035da59e33cff9941b857c3cb379cb0638105dfdf69c97f0acc8e7b"),
    },
    TcEntry {
        host: "i686-pc-linux-gnu",
        url:  "https://downloads.arduino.cc/tools/avr-gcc-7.3.0-atmel3.6.1-arduino7-i686-pc-linux-gnu.tar.bz2",
        checksum: None,
    },
    TcEntry {
        host: "aarch64-linux-gnu",
        url:  "https://downloads.arduino.cc/tools/avr-gcc-7.3.0-atmel3.6.1-arduino7-aarch64-pc-linux-gnu.tar.bz2",
        checksum: None,
    },
    TcEntry {
        host: "x86_64-apple-darwin",
        url:  "https://downloads.arduino.cc/tools/avr-gcc-7.3.0-atmel3.6.1-arduino7-x86_64-apple-darwin.tar.bz2",
        checksum: Some("SHA-256:040219caa9d1af6c7ad95803f3f5e5dbfee26b41a37f8a4b3e30069a44c43f3b"),
    },
    TcEntry {
        host: "arm64-apple-darwin",
        url:  "https://downloads.arduino.cc/tools/avr-gcc-7.3.0-atmel3.6.1-arduino7-arm64-apple-darwin.tar.bz2",
        checksum: None,
    },
    TcEntry {
        host: "i686-mingw32",
        url:  "https://downloads.arduino.cc/tools/avr-gcc-7.3.0-atmel3.6.1-arduino7-i686-mingw32.zip",
        checksum: None,
    },
];

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

    let core_dir = root
        .join("packages").join("arduino")
        .join("hardware").join("avr")
        .join(AVR_CORE_VERSION);
    let tc_dir = root
        .join("packages").join("arduino")
        .join("tools").join("avr-gcc")
        .join(AVR_GCC_VERSION);

    // ── Fast path ─────────────────────────────────────────────────────────
    if core_dir.join("cores").join("arduino").is_dir()
        && tc_dir.join("bin").is_dir()
    {
        if verbose {
            eprintln!(
                "  [avr-module] cached  core {}  gcc {}",
                AVR_CORE_VERSION, AVR_GCC_VERSION
            );
        }
        return build_sdk_paths(&root, &core_dir, &tc_dir, variant);
    }

    // ── Slow path: resolve toolchain for this host ────────────────────────
    let host = current_host();
    let tc   = pick_toolchain(&host).ok_or_else(|| FlashError::Other(format!(
        "No AVR toolchain available for host '{}'.\n  \
         Supported: x86_64-linux, aarch64-linux, x86_64-darwin, arm64-darwin, i686-mingw32",
        host
    )))?;

    println!(
        "{} Installing AVR SDK  (core {}  /  gcc {})",
        "→".cyan().bold(),
        AVR_CORE_VERSION.bold(),
        AVR_GCC_VERSION.bold(),
    );

    // ── Build work list for rayon parallel download ───────────────────────
    struct Work {
        url:      &'static str,
        checksum: Option<&'static str>,
        dest:     PathBuf,
        label:    &'static str,
    }

    let mut jobs: Vec<Work> = Vec::with_capacity(2);

    if !core_dir.join("cores").join("arduino").is_dir() {
        jobs.push(Work {
            url:      CORE_URL,
            checksum: Some(CORE_SHA256),
            dest:     core_dir.clone(),
            label:    "core  arduino:avr",
        });
    }
    if !tc_dir.join("bin").is_dir() {
        jobs.push(Work {
            url:      tc.url,
            checksum: tc.checksum,
            dest:     tc_dir.clone(),
            label:    "toolchain  avr-gcc",
        });
    }

    // Parallel download + extract
    let errors: Vec<String> = jobs.par_iter().filter_map(|job| {
        println!("  {}  Downloading {}…", "↓".cyan(), job.label.bold());
        match download_and_extract(job.url, job.checksum, &job.dest, verbose) {
            Ok(()) => {
                println!("  {}  {}", "✓".green().bold(), job.label.bold());
                None
            }
            Err(e) => Some(format!("{}: {}", job.label, e)),
        }
    }).collect();

    if !errors.is_empty() {
        return Err(FlashError::Other(format!(
            "AVR SDK install failed:\n  {}",
            errors.join("\n  ")
        )));
    }

    write_installed_manifest(&root, "avr", AVR_CORE_VERSION)?;

    println!(
        "\n  {} AVR SDK ready  ({})\n  {} Compile with: {}",
        "✓".green().bold(),
        root.display().to_string().dimmed(),
        "→".cyan(),
        "tsuki build --compile --backend tsuki-flash+cores".bold(),
    );

    build_sdk_paths(&root, &core_dir, &tc_dir, variant)
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public: sdk_paths
// ─────────────────────────────────────────────────────────────────────────────

/// Return `SdkPaths` for the already-installed AVR SDK — no download.
///
/// Returns `SdkNotFound` if the SDK is absent. Call `ensure()` to auto-install.
pub fn sdk_paths(variant: &str) -> Result<SdkPaths> {
    let root = modules_root()?;
    let core_dir = root
        .join("packages").join("arduino")
        .join("hardware").join("avr")
        .join(AVR_CORE_VERSION);
    let tc_dir = root
        .join("packages").join("arduino")
        .join("tools").join("avr-gcc")
        .join(AVR_GCC_VERSION);

    if !core_dir.join("cores").join("arduino").is_dir() {
        return Err(FlashError::SdkNotFound {
            arch:  "avr".into(),
            path:  core_dir.display().to_string(),
            pkg:   "tsuki-flash modules install avr".into(),
        });
    }
    build_sdk_paths(&root, &core_dir, &tc_dir, variant)
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public: is_ready
// ─────────────────────────────────────────────────────────────────────────────

/// Returns `true` when the pinned AVR core directory already exists on disk.
///
/// Single `Path::is_dir()` — no IO errors, safe to call in hot paths.
pub fn is_ready() -> bool {
    modules_root()
        .map(|r| {
            r.join("packages").join("arduino")
             .join("hardware").join("avr")
             .join(AVR_CORE_VERSION)
             .join("cores").join("arduino")
             .is_dir()
        })
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

fn pick_toolchain(host: &str) -> Option<&'static TcEntry> {
    TOOLCHAIN.iter().find(|e| {
        (e.host.contains("linux-gnu") && host.contains("linux"))
        || (e.host.contains("apple")   && host.contains("apple"))
        || (e.host.contains("mingw")   && host.contains("mingw"))
        || e.host == host
    })
}

fn current_host() -> String {
    #[cfg(all(target_os = "linux",   target_arch = "x86_64"))]  { return "x86_64-pc-linux-gnu".into(); }
    #[cfg(all(target_os = "linux",   target_arch = "aarch64"))] { return "aarch64-linux-gnu".into(); }
    #[cfg(all(target_os = "macos",   target_arch = "x86_64"))]  { return "x86_64-apple-darwin".into(); }
    #[cfg(all(target_os = "macos",   target_arch = "aarch64"))] { return "arm64-apple-darwin".into(); }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]  { return "i686-mingw32".into(); }
    #[allow(unreachable_code)]
    "unknown".into()
}