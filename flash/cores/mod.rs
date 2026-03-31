// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: cores  —  tsuki-modules  (SDK layer, replaces .arduino15)
//
//  Design goals:
//    • Zero arduino-cli dependency at compile OR runtime
//    • Zero system tool dependency — pure-Rust tar/gz/bz2/xz extraction
//    • Parallel tool + core downloads  (rayon)
//    • Incremental: skip extraction when versioned dir already exists
//    • Mirror .arduino15 layout exactly → sdk.rs reuse with zero changes
//    • Single JSON index fetch per arch, cached 24 h
//    • Supports ALL architectures: avr, sam, esp32, esp8266, rp2040
//
//  Install root:   ~/.tsuki/modules/
//  Layout:
//    packages/<vendor>/hardware/<arch>/<ver>/   ← core headers
//    packages/<vendor>/tools/<toolchain>/<ver>/ ← compiler binaries
//    .tsuki_pkg_index_<arch>.json               ← cached package index (per arch)
//    installed/<arch>.json                      ← installed-core manifests
//
//  Archive extraction (NO system commands required):
//    .zip      → pure Rust (zip crate)
//    .tar.gz   → pure Rust (tar + flate2/rust_backend)
//    .tar.bz2  → pure Rust (tar + bzip2/static)
//    .tar.xz   → pure Rust (tar + lzma-rs)
// ─────────────────────────────────────────────────────────────────────────────

pub mod avr;

use std::fs;
use std::io::{self, Cursor, Read};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tsuki_ux::{bold, C_WARN, C_INFO, C_ERROR, C_SUCCESS, C_MUTED, C_ACCENT};
use tsuki_ux::color::Style;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::error::{FlashError, Result};
use crate::sdk::SdkPaths;

// ─────────────────────────────────────────────────────────────────────────────
//  Package index URLs — one per architecture family
// ─────────────────────────────────────────────────────────────────────────────

const ARDUINO_INDEX_URL: &str =
    "https://downloads.arduino.cc/packages/package_index.json";

const ESP32_INDEX_URL: &str =
    "https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json";

const ESP8266_INDEX_URL: &str =
    "https://arduino.esp8266.com/stable/package_esp8266com_index.json";

const RP2040_INDEX_URL: &str =
    "https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json";

const INDEX_TTL_SECS: u64 = 86_400;

fn index_url_for_arch(arch: &str) -> &'static str {
    match arch {
        "avr" | "sam" => ARDUINO_INDEX_URL,
        "esp32"       => ESP32_INDEX_URL,
        "esp8266"     => ESP8266_INDEX_URL,
        "rp2040"      => RP2040_INDEX_URL,
        _             => ARDUINO_INDEX_URL,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Arduino package_index.json model  (subset)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct PackageIndex {
    packages: Vec<IndexPackage>,
}

#[derive(Debug, Deserialize)]
struct IndexPackage {
    name:      String,
    platforms: Vec<Platform>,
    tools:     Vec<ToolEntry>,
}

#[derive(Debug, Deserialize, Clone)]
struct Platform {
    architecture: String,
    version:      String,
    url:          String,
    checksum:     Option<String>,
    #[serde(rename = "toolsDependencies", default)]
    tools_deps: Vec<ToolDep>,
}

#[derive(Debug, Deserialize, Clone)]
struct ToolDep {
    packager: String,
    name:     String,
    version:  String,
}

#[derive(Debug, Deserialize, Clone)]
struct ToolEntry {
    name:    String,
    version: String,
    systems: Vec<ToolSystem>,
}

#[derive(Debug, Deserialize, Clone)]
struct ToolSystem {
    host:     String,
    url:      String,
    checksum: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
//  Installed-core manifest
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct InstalledCore {
    pub arch:         String,
    pub version:      String,
    pub installed_at: u64,
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public: paths
// ─────────────────────────────────────────────────────────────────────────────

/// Root of the tsuki-modules store. Override via `TSUKI_MODULES_ROOT`.
pub fn modules_root() -> Result<PathBuf> {
    if let Ok(r) = std::env::var("TSUKI_MODULES_ROOT") {
        return Ok(PathBuf::from(r));
    }
    let home = home_dir()?;
    Ok(home.join(".tsuki").join("modules"))
}

/// True if the core for `arch` is already installed.
#[allow(dead_code)]
pub fn is_installed(arch: &str) -> bool {
    modules_root()
        .map(|r| r.join("installed").join(format!("{}.json", arch)).exists())
        .unwrap_or(false)
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public: ensure_arch
//
//  The main entry point called by sdk::resolve() for every architecture.
//  Guarantees the core + toolchain are present on disk and returns SdkPaths.
//
//  Fast path  (already installed) : single directory existence check.
//  Slow path  (first run)         : downloads + pure-Rust extraction.
// ─────────────────────────────────────────────────────────────────────────────

pub fn ensure_arch(arch: &str, variant: &str, verbose: bool) -> Result<SdkPaths> {
    // AVR has its own optimised module (no network index needed).
    if arch == "avr" {
        return avr::ensure_variant(variant, verbose);
    }

    let root = modules_root()?;

    // Fast path: check if the layout is already present.
    if let Some(paths) = crate::sdk::scan_tsuki_modules(&root, arch, variant) {
        // For RP2040 the fast path is only valid when pqt-pico-sdk is ALSO
        // present. That tool package ships the prebuilt pico-sdk static
        // libraries (libpico.a, hardware_gpio.a, tinyusb_device.a, …) that
        // the linker needs to resolve every pico-sdk symbol used by the
        // Arduino core and user sketches:
        //
        //   gpio_init / gpio_set_function   → hardware_gpio
        //   sleep_ms / sleep_us / time_us_64 → pico_time / hardware_timer
        //   multicore_fifo_*               → pico_multicore
        //   tud_task_ext / tud_cdc_n_*     → tinyusb_device
        //   mutex_try_enter / mutex_exit   → pico_sync
        //   irq_set_exclusive_handler      → hardware_irq
        //   exception_set_exclusive_handler → hardware_exception
        //   check_sys_clock_khz            → hardware_clocks
        //   panic / _exit / _sbrk          → pico_runtime / pico_stdlib
        //
        // Without pqt-pico-sdk every RP2040 link fails with hundreds of
        // "undefined reference" errors for all of the above.
        //
        // Scenario that hits this bug:
        //   • User had core installed via arduino-cli / old tsuki-modules
        //     (which didn't download pqt-pico-sdk separately).
        //   • scan_tsuki_modules() finds the hardware/ layout → fast path
        //     fires → install() is never called → pqt-pico-sdk never
        //     downloaded → linker fails.
        //
        // Fix: for rp2040, also verify pqt-pico-sdk exists. If absent, fall
        // through to install() which downloads only the missing tool (the core
        // itself won't be re-downloaded because platform_dir.exists() will be
        // true inside install()).
        if arch == "rp2040" {
            let pico_sdk_tool = root
                .join("packages")
                .join("rp2040")
                .join("tools")
                .join("pqt-pico-sdk");

            if !pico_sdk_tool.is_dir() {
                // pqt-pico-sdk is absent — do NOT take the fast path.
                // install() will download only the missing tool.
                if verbose {
                    eprintln!(
                        "  [modules] rp2040 core present but pqt-pico-sdk missing at {} — downloading…",
                        pico_sdk_tool.display()
                    );
                } else {
                    println!(
                        "  pqt-pico-sdk (pico-sdk prebuilt libs) not found — downloading…"
                    );
                }
                // Fall through to the slow path below.
            } else {
                if verbose {
                    eprintln!("  [modules] rp2040 already installed (cached, pqt-pico-sdk present)");
                }
                return Ok(paths);
            }
        } else {
            if verbose {
                eprintln!("  [modules] {} already installed (cached)", arch);
            }
            return Ok(paths);
        }
    }

    // Slow path: auto-install.
    // Always print the download attempt — this is the first visible feedback
    // when the SDK is missing (especially important on first use of a new board).
    println!(
        "{} Core '{}' not found — downloading via tsuki-modules…",
        C_ACCENT.paint("→"), bold(arch)
    );
    println!("  (this happens once; subsequent builds will be fast)");

    match install(arch, verbose) {
        Ok(()) => {},
        Err(e) => {
            // Print the warning but DO NOT return — let sdk::resolve() fall
            // through to the arduino-cli package cache. If the user has the
            // core installed via arduino-cli the build will succeed even when
            // the tsuki-modules auto-download fails (offline, firewall, etc.).
            eprintln!("  {} tsuki-modules install failed for '{}': {}", C_WARN.paint("⚠"), arch, e);
            eprintln!("  Trying arduino-cli package cache as fallback…");
            return Err(e);   // sdk::resolve() catches this and continues
        }
    }

    crate::sdk::scan_tsuki_modules(&root, arch, variant)
        .ok_or_else(|| FlashError::SdkNotFound {
            arch: arch.into(),
            path: root.display().to_string(),
            pkg:  format!("tsuki-flash modules install {}", arch),
        })
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public: install
// ─────────────────────────────────────────────────────────────────────────────

pub fn install(arch: &str, verbose: bool) -> Result<()> {
    let root = modules_root()?;
    fs::create_dir_all(&root)?;

    println!("{} Installing {} core via tsuki-modules…",
        C_ACCENT.paint("→"), bold(arch));

    let index   = load_index(arch, verbose)?;
    let (vendor, hw_arch, pkg_name) = arch_to_package(arch)?;
    let (_pkg, platform) = find_latest_platform(&index, pkg_name, hw_arch)?;

    let platform_dir = root
        .join("packages").join(vendor)
        .join("hardware").join(hw_arch)
        .join(&platform.version);
    let core_needed = !platform_dir.exists();

    let host = current_host();

    // Collect tools that need to be downloaded.
    // Separate "can download" from "missing but not in index" to warn explicitly
    // instead of silently ignoring — the silent drop is what causes the
    // "pqt-pico-sdk missing → undefined reference" build failures.
    let mut tools_needed: Vec<(PathBuf, ToolSystem, String)> = Vec::new();
    let mut tools_missing_in_index: Vec<String> = Vec::new();

    for dep in &platform.tools_deps {
        let tool_dir = root
            .join("packages").join(&dep.packager)
            .join("tools").join(&dep.name)
            .join(&dep.version);

        if tool_dir.exists() {
            if verbose {
                eprintln!("  [modules] tool {} {} already present", dep.name, dep.version);
            }
            continue;
        }

        match find_tool_system_any(&index, &dep.packager, &dep.name, &dep.version, &host) {
            Some(system) => tools_needed.push((tool_dir, system.clone(), dep.name.clone())),
            None => {
                eprintln!(
                    "  {} Tool '{}' v{} (packager='{}') not found in index for host '{}' — trying fallback",
                    C_WARN.paint("⚠"), dep.name, dep.version, dep.packager, host
                );
                tools_missing_in_index.push(dep.name.clone());
            }
        }
    }

    if !core_needed && tools_needed.is_empty() {
        // Before declaring "already up to date", verify that any tools which
        // couldn't be resolved from the index are actually present on disk.
        // For RP2040: pqt-pico-sdk is mandatory for linking — if it is absent
        // AND couldn't be found in the index, surface a clear error instead of
        // silently proceeding to a link failure with hundreds of "undefined reference".
        if arch == "rp2040" && !tools_missing_in_index.is_empty() {
            let pico_sdk_dir = root
                .join("packages").join("rp2040")
                .join("tools").join("pqt-pico-sdk");

            if !pico_sdk_dir.is_dir() {
                return Err(FlashError::Other(format!(
                    "pqt-pico-sdk (RP2040 prebuilt pico-sdk libraries) is missing and could not \
be resolved from the package index for host '{host}'.\n\
\n\
These libraries are required to link RP2040 firmware (gpio_init, sleep_ms, tud_task_ext, …).\n\
\n\
Likely causes & fixes:\n\
  1. The package index uses host tag 'all' — update tsuki-flash (fix already merged).\n\
  2. Stale index cache — run: tsuki-flash modules update\n\
  3. Partial install — delete the cache and reinstall:\n\
       rmdir /S /Q %USERPROFILE%\\.tsuki\\modules\\packages\\rp2040\\tools\\pqt-pico-sdk\n\
       tsuki-flash modules install rp2040\n\
\n\
Missing tools: {missing}\n\
Expected dir:  {path}",
                    host    = host,
                    missing = tools_missing_in_index.join(", "),
                    path    = pico_sdk_dir.display(),
                )));
            }
        }

        println!("  {} {} {} already up to date",
            C_MUTED.paint("•"), bold(arch), C_MUTED.paint(&platform.version));
        return write_installed_manifest(&root, arch, &platform.version);
    }

    struct WorkItem {
        url:      String,
        checksum: Option<String>,
        dest:     PathBuf,
        label:    String,
    }

    let mut work: Vec<WorkItem> = Vec::new();
    if core_needed {
        work.push(WorkItem {
            url:      platform.url.clone(),
            checksum: platform.checksum.clone(),
            dest:     platform_dir,
            label:    format!("core {} {}", pkg_name, platform.version),
        });
    }
    for (tool_dir, system, tool_name) in tools_needed {
        work.push(WorkItem {
            url:      system.url.clone(),
            checksum: system.checksum.clone(),
            dest:     tool_dir,
            label:    format!("toolchain {}", tool_name),
        });
    }

    let errors: Vec<String> = work
        .par_iter()
        .filter_map(|item| {
            println!("  {}  Downloading {}…", C_INFO.paint("↓"), bold(&item.label));
            match download_and_extract(&item.url, item.checksum.as_deref(), &item.dest, verbose) {
                Ok(()) => { println!("  {}  {}", C_SUCCESS.paint("✓"), bold(&item.label)); None }
                Err(e) => Some(format!("{}: {}", item.label, e)),
            }
        })
        .collect();

    if !errors.is_empty() {
        let detail = errors.iter()
            .map(|e| e.replace('\n', " ").replace("  ", " "))
            .collect::<Vec<_>>()
            .join(" | ");
        return Err(FlashError::Other(format!("Some downloads failed — {}", detail)));
    }

    write_installed_manifest(&root, arch, &platform.version)?;

    println!(
        "\n  {} {} {} ready  ({})",
        C_SUCCESS.paint("✓"), bold("tsuki-modules"), bold(arch),
        C_MUTED.paint(&root.display().to_string())
    );
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public: list
// ─────────────────────────────────────────────────────────────────────────────

pub fn list() -> Result<()> {
    let root = modules_root()?;
    let installed_dir = root.join("installed");

    if !installed_dir.exists() {
        println!("{} No cores installed via tsuki-modules.", C_WARN.paint("!"));
        println!("  Install one with: {}", bold("tsuki-flash modules install avr"));
        return Ok(());
    }

    let mut cores: Vec<InstalledCore> = fs::read_dir(&installed_dir)?
        .flatten()
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("json"))
        .filter_map(|e| {
            let data = fs::read_to_string(e.path()).ok()?;
            serde_json::from_str::<InstalledCore>(&data).ok()
        })
        .collect();

    if cores.is_empty() {
        println!("{} No cores installed.", C_WARN.paint("!"));
        return Ok(());
    }

    cores.sort_by(|a, b| a.arch.cmp(&b.arch));
    println!("{:<12}  {:<10}  {}", Style::new().bold().underline().paint("ARCH"), Style::new().bold().underline().paint("VERSION"), Style::new().bold().underline().paint("INDEX URL"));
    println!("{}", C_MUTED.paint(&"─".repeat(60)));
    for c in &cores {
        println!("{:<12}  {:<10}  {}",
            C_INFO.paint(&c.arch),
            C_MUTED.paint(&c.version),
            C_MUTED.paint(index_url_for_arch(&c.arch)));
    }
    println!("\n  {} installed  —  {}", cores.len(), C_MUTED.paint(&root.display().to_string()));
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public: update
// ─────────────────────────────────────────────────────────────────────────────

pub fn update(verbose: bool) -> Result<()> {
    let root = modules_root()?;
    let prefixes = ["avr", "sam", "esp32", "esp8266", "rp2040"];
    let mut removed = 0usize;
    for arch in &prefixes {
        let cache = index_cache_path_for(&root, arch)?;
        if cache.exists() { fs::remove_file(&cache)?; removed += 1; }
    }
    println!("{} Refreshing package indices ({} cached files removed)…", C_INFO.paint("→"), removed);
    let installed_dir = root.join("installed");
    if installed_dir.exists() {
        for entry in fs::read_dir(&installed_dir)?.flatten() {
            if let Some(stem) = entry.path().file_stem() {
                let arch = stem.to_string_lossy().to_string();
                print!("  {} {}… ", C_INFO.paint("↓"), bold(&arch));
                match load_index(&arch, verbose) {
                    Ok(_)  => println!("{}", C_SUCCESS.paint("ok")),
                    Err(e) => println!("{} ({})", C_ERROR.paint("failed"), e),
                }
            }
        }
    }
    println!("{} Package indices updated.", C_SUCCESS.paint("✓"));
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
//  Internal: index loading + per-arch caching
// ─────────────────────────────────────────────────────────────────────────────

fn load_index(arch: &str, verbose: bool) -> Result<PackageIndex> {
    let root  = modules_root()?;
    let cache = index_cache_path_for(&root, arch)?;
    let url   = index_url_for_arch(arch);

    if let Some(mtime) = file_mtime(&cache) {
        let age = now_secs().saturating_sub(mtime);
        if age < INDEX_TTL_SECS {
            if verbose { eprintln!("  [modules] using cached {} index ({} s old)", arch, age); }
            let data = fs::read_to_string(&cache)?;
            return serde_json::from_str(&data)
                .map_err(|e| FlashError::Other(format!("Failed to parse cached {} index: {}", arch, e)));
        }
    }

    println!("{} Fetching {} package index…", C_INFO.paint("→"), arch);
    let resp = ureq::get(url)
        .call()
        .map_err(|e| FlashError::Other(format!("Failed to download {} index: {}", arch, e)))?;

    let mut body = Vec::with_capacity(2 * 1024 * 1024);
    resp.into_reader()
        .read_to_end(&mut body)
        .map_err(|e| FlashError::Other(format!("Failed to read {} index: {}", arch, e)))?;

    if let Some(parent) = cache.parent() { let _ = fs::create_dir_all(parent); }
    fs::write(&cache, &body)
        .map_err(|e| FlashError::Other(format!("Failed to cache {} index: {}", arch, e)))?;

    serde_json::from_slice(&body)
        .map_err(|e| FlashError::Other(format!("Failed to parse {} index: {}", arch, e)))
}

fn index_cache_path_for(root: &Path, arch: &str) -> Result<PathBuf> {
    Ok(root.join(format!(".tsuki_pkg_index_{}.json", arch)))
}

// ─────────────────────────────────────────────────────────────────────────────
//  Internal: download + SHA-256 verify + pure-Rust extraction
//  NO system commands (tar, gzip, bzip2, xz) are invoked.
// ─────────────────────────────────────────────────────────────────────────────

pub(super) fn download_and_extract(url: &str, checksum: Option<&str>, dest: &Path, verbose: bool) -> Result<()> {
    if verbose { eprintln!("  [modules] GET {}", url); }

    let resp = ureq::get(url)
        .call()
        .map_err(|e| FlashError::Other(format!("Download failed ({}): {}", url, e)))?;

    let mut buf = Vec::new();
    resp.into_reader()
        .read_to_end(&mut buf)
        .map_err(|e| FlashError::Other(format!("Failed to read download: {}", e)))?;

    if let Some(cs) = checksum { verify_sha256(&buf, cs)?; }

    let url_lower = url.to_lowercase();
    if url_lower.ends_with(".zip") {
        extract_zip(&buf, dest)
    } else if url_lower.ends_with(".tar.bz2") {
        extract_tar_bz2(&buf, dest)
    } else if url_lower.ends_with(".tar.gz") || url_lower.ends_with(".tgz") {
        extract_tar_gz(&buf, dest)
    } else if url_lower.ends_with(".tar.xz") || url_lower.ends_with(".txz") {
        extract_tar_xz(&buf, dest)
    } else {
        // Unknown extension — try zip then tar.gz
        extract_zip(&buf, dest).or_else(|_| extract_tar_gz(&buf, dest))
    }
}

fn verify_sha256(data: &[u8], checksum_field: &str) -> Result<()> {
    use sha2::{Digest, Sha256};
    let expected = checksum_field
        .strip_prefix("SHA-256:").unwrap_or(checksum_field)
        .trim().to_lowercase();
    let actual = hex::encode(Sha256::digest(data));
    if actual != expected {
        return Err(FlashError::Other(format!(
            "Checksum mismatch!\n  expected: {}\n  actual:   {}", expected, actual
        )));
    }
    Ok(())
}

// ── .zip ──────────────────────────────────────────────────────────────────────

fn extract_zip(data: &[u8], dest: &Path) -> Result<()> {
    let mut archive = zip::ZipArchive::new(Cursor::new(data))
        .map_err(|e| FlashError::Other(format!("Failed to open ZIP: {}", e)))?;

    let prefix = {
        let first = archive.by_index(0)
            .map_err(|e| FlashError::Other(e.to_string()))?;
        let name = first.name().to_owned();
        if name.ends_with('/') { Some(name) }
        else { name.find('/').map(|i| format!("{}/", &name[..i])) }
    };

    fs::create_dir_all(dest)?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| FlashError::Other(format!("ZIP read error: {}", e)))?;
        let raw = file.name().to_owned();
        let rel = match &prefix {
            Some(pfx) => raw.strip_prefix(pfx.as_str()).unwrap_or(&raw),
            None      => &raw,
        };
        if rel.is_empty() { continue; }
        let out = dest.join(rel);
        if file.is_dir() {
            fs::create_dir_all(&out)?;
        } else {
            if let Some(p) = out.parent() { fs::create_dir_all(p)?; }
            let mut f = fs::File::create(&out)?;
            io::copy(&mut file, &mut f)?;
            #[cfg(unix)] {
                use std::os::unix::fs::PermissionsExt;
                if let Some(mode) = file.unix_mode() {
                    let _ = fs::set_permissions(&out, fs::Permissions::from_mode(mode));
                }
            }
        }
    }
    Ok(())
}

// ── .tar.bz2  (pure Rust — no system bzip2 or tar needed) ────────────────────

fn extract_tar_bz2(data: &[u8], dest: &Path) -> Result<()> {
    let decoder = bzip2::read::BzDecoder::new(data);
    extract_tar_stream(decoder, dest, "bz2")
}

// ── .tar.gz  (pure Rust — no system gzip or tar needed) ──────────────────────

fn extract_tar_gz(data: &[u8], dest: &Path) -> Result<()> {
    let decoder = flate2::read::GzDecoder::new(data);
    extract_tar_stream(decoder, dest, "gz")
}

// ── .tar.xz  (pure Rust — no system xz or tar needed) ───────────────────────

fn extract_tar_xz(data: &[u8], dest: &Path) -> Result<()> {
    let mut decompressed = Vec::new();
    lzma_rs::xz_decompress(&mut Cursor::new(data), &mut decompressed)
        .map_err(|e| FlashError::Other(format!("xz decompress failed: {}", e)))?;
    extract_tar_stream(Cursor::new(decompressed), dest, "xz")
}

// ── Common tar extraction — strips top-level component (like --strip-components=1) ──

fn extract_tar_stream<R: Read>(reader: R, dest: &Path, fmt: &str) -> Result<()> {
    fs::create_dir_all(dest)?;
    let mut archive = tar::Archive::new(reader);
    let mut prefix: Option<PathBuf> = None;

    let entries = archive.entries()
        .map_err(|e| FlashError::Other(format!("tar ({}) read error: {}", fmt, e)))?;

    for entry in entries {
        let mut entry = entry
            .map_err(|e| FlashError::Other(format!("tar ({}) entry error: {}", fmt, e)))?;

        let raw_path = entry.path()
            .map_err(|e| FlashError::Other(format!("tar ({}) path error: {}", fmt, e)))?
            .into_owned();

        // Capture the top-level prefix from the very first entry.
        if prefix.is_none() {
            if let Some(first) = raw_path.components().next() {
                prefix = Some(PathBuf::from(first.as_os_str()));
            }
        }

        // Strip the top-level directory component.
        let stripped: PathBuf = match &prefix {
            Some(pfx) => raw_path.strip_prefix(pfx).unwrap_or(&raw_path).to_owned(),
            None      => raw_path.clone(),
        };
        if stripped.as_os_str().is_empty() { continue; }

        let out_path = dest.join(&stripped);

        if entry.header().entry_type().is_dir() {
            fs::create_dir_all(&out_path)?;
        } else {
            if let Some(p) = out_path.parent() { fs::create_dir_all(p)?; }
            entry.unpack(&out_path)
                .map_err(|e| FlashError::Other(format!(
                    "tar ({}) unpack error for {}: {}", fmt, stripped.display(), e
                )))?;
        }
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
//  Internal: index lookups
// ─────────────────────────────────────────────────────────────────────────────

/// arch → (vendor, hw_arch, package name in index)
pub fn arch_to_package(arch: &str) -> Result<(&'static str, &'static str, &'static str)> {
    match arch {
        "avr"     => Ok(("arduino", "avr",     "arduino")),
        "sam"     => Ok(("arduino", "sam",     "arduino")),
        "esp32"   => Ok(("esp32",   "esp32",   "esp32")),
        "esp8266" => Ok(("esp8266", "esp8266", "esp8266")),
        "rp2040"  => Ok(("rp2040",  "rp2040",  "rp2040")),
        other => Err(FlashError::Other(format!(
            "Unknown architecture '{}'. Supported: avr, sam, esp32, esp8266, rp2040", other
        ))),
    }
}

fn find_latest_platform<'a>(
    index: &'a PackageIndex,
    pkg_name: &str,
    hw_arch: &str,
) -> Result<(&'a IndexPackage, &'a Platform)> {
    // Case-insensitive search handles minor capitalisation differences.
    let pkg = index.packages.iter()
        .find(|p| p.name.to_lowercase() == pkg_name.to_lowercase())
        .ok_or_else(|| FlashError::Other(format!("Package '{}' not found in index", pkg_name)))?;

    let mut platforms: Vec<&Platform> = pkg.platforms.iter()
        .filter(|p| p.architecture == hw_arch)
        .collect();

    if platforms.is_empty() {
        return Err(FlashError::Other(format!(
            "No platform for arch '{}' in package '{}'", hw_arch, pkg_name
        )));
    }
    platforms.sort_by(|a, b| cmp_ver(&b.version, &a.version));
    Ok((pkg, platforms[0]))
}

/// Search all packages in the index for the tool. Handles third-party indices
/// where the toolchain entry is in the same package as the platform.
fn find_tool_system_any<'a>(
    index: &'a PackageIndex,
    packager: &str,
    tool_name: &str,
    version: &str,
    host: &str,
) -> Option<&'a ToolSystem> {
    // Try the declared packager first.
    if let Some(s) = find_tool_system_in_pkg_named(index, packager, tool_name, version, host) {
        return Some(s);
    }
    // Fall back: scan all packages (covers mismatched packager names).
    for pkg in &index.packages {
        if let Some(s) = find_tool_in_pkg(pkg, tool_name, version, host) {
            return Some(s);
        }
    }
    None
}

fn find_tool_system_in_pkg_named<'a>(
    index: &'a PackageIndex,
    packager: &str,
    tool_name: &str,
    version: &str,
    host: &str,
) -> Option<&'a ToolSystem> {
    let pkg = index.packages.iter().find(|p| p.name == packager)?;
    find_tool_in_pkg(pkg, tool_name, version, host)
}

fn find_tool_in_pkg<'a>(pkg: &'a IndexPackage, tool_name: &str, version: &str, host: &str) -> Option<&'a ToolSystem> {
    let tool = pkg.tools.iter().find(|t| t.name == tool_name && t.version == version)?;
    // Prefer exact match; fall back to broader host pattern match.
    tool.systems.iter().find(|s| s.host == host)
        .or_else(|| tool.systems.iter().find(|s| host_matches(&s.host, host)))
}

// ─────────────────────────────────────────────────────────────────────────────
//  Internal: manifest helpers
// ─────────────────────────────────────────────────────────────────────────────

pub(super) fn write_installed_manifest(root: &Path, arch: &str, version: &str) -> Result<()> {
    let dir = root.join("installed");
    fs::create_dir_all(&dir)?;
    let m = InstalledCore {
        arch: arch.to_owned(),
        version: version.to_owned(),
        installed_at: now_secs(),
    };
    let json = serde_json::to_string_pretty(&m)
        .map_err(|e| FlashError::Other(e.to_string()))?;
    fs::write(dir.join(format!("{}.json", arch)), json)?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
//  Host detection
// ─────────────────────────────────────────────────────────────────────────────

fn current_host() -> String {
    #[cfg(all(target_os = "linux",   target_arch = "x86_64"))]  { return "x86_64-linux-gnu".into(); }
    #[cfg(all(target_os = "linux",   target_arch = "aarch64"))] { return "aarch64-linux-gnu".into(); }
    #[cfg(all(target_os = "macos",   target_arch = "x86_64"))]  { return "x86_64-apple-darwin".into(); }
    #[cfg(all(target_os = "macos",   target_arch = "aarch64"))] { return "arm64-apple-darwin".into(); }
    // The earlephilhower arduino-pico package index uses "x86_64-w64-mingw32"
    // for 64-bit Windows (the overwhelmingly common case on modern PCs).
    // "i686-mingw32" is the 32-bit Windows host string — only relevant on very
    // old machines.  Using it for x86_64 hosts means find_tool_system_any()
    // may download the 32-bit toolchain package instead of the 64-bit one.
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]  { return "x86_64-w64-mingw32".into(); }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))] { return "aarch64-w64-mingw32".into(); }
    #[cfg(all(target_os = "windows", target_arch = "x86"))]     { return "i686-mingw32".into(); }
    #[allow(unreachable_code)]
    "unknown".into()
}

fn host_matches(system_host: &str, current: &str) -> bool {
    // Exact match first — fastest exit.
    if system_host == current { return true; }

    // "all" means architecture-independent content (e.g. pqt-pico-sdk ships
    // prebuilt ARM Cortex-M0+ .a files that are identical on every host OS).
    // The earlephilhower arduino-pico package index uses this tag for tools
    // whose binaries do not vary by host platform.
    // Without this case, find_tool_system_any() silently returns None for
    // pqt-pico-sdk → tools_needed is empty → "already up to date" fires →
    // pqt-pico-sdk never downloaded → link fails with "undefined reference".
    if system_host == "all" { return true; }

    // Family-based matching: the package index may list a more-specific triple
    // (e.g. "x86_64-w64-mingw32") while our current_host() returns the same
    // or a related triple.  We treat any two "mingw" strings as compatible
    // because all published mingw32 and mingw-w64 ARM toolchains run fine on
    // 64-bit Windows; similarly for linux-gnu families and Apple triples.
    let sh = system_host;
    let cu = current;
    (sh.contains("linux-gnu")  && cu.contains("linux-gnu"))
    || (sh.contains("linux-musl") && cu.contains("linux-musl"))
    || (sh.contains("apple")      && cu.contains("apple"))
    || (sh.contains("mingw")      && cu.contains("mingw"))
    || (sh.contains("freebsd")    && cu.contains("freebsd"))
}

// ─────────────────────────────────────────────────────────────────────────────
//  Misc helpers
// ─────────────────────────────────────────────────────────────────────────────

fn home_dir() -> Result<PathBuf> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .map_err(|_| FlashError::Other("Cannot determine home directory".into()))
}

fn file_mtime(path: &Path) -> Option<u64> {
    fs::metadata(path).ok()?.modified().ok()?
        .duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs())
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn cmp_ver(a: &str, b: &str) -> std::cmp::Ordering {
    let va: Vec<u32> = a.split('.').map(|p| p.parse().unwrap_or(0)).collect();
    let vb: Vec<u32> = b.split('.').map(|p| p.parse().unwrap_or(0)).collect();
    va.cmp(&vb)
}