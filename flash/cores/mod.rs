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

use colored::Colorize;
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
        if verbose {
            eprintln!("  [modules] {} already installed (cached)", arch);
        }
        return Ok(paths);
    }

    // Slow path: auto-install.
    println!(
        "{} Core '{}' not found — installing via tsuki-modules…",
        "→".cyan().bold(), arch.bold()
    );
    install(arch, verbose)?;

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
        "→".cyan().bold(), arch.bold());

    let index   = load_index(arch, verbose)?;
    let (vendor, hw_arch, pkg_name) = arch_to_package(arch)?;
    let (_pkg, platform) = find_latest_platform(&index, pkg_name, hw_arch)?;

    let platform_dir = root
        .join("packages").join(vendor)
        .join("hardware").join(hw_arch)
        .join(&platform.version);
    let core_needed = !platform_dir.exists();

    let host = current_host();
    let tools_needed: Vec<(PathBuf, ToolSystem, String)> = platform
        .tools_deps
        .iter()
        .filter_map(|dep| {
            let tool_dir = root
                .join("packages").join(&dep.packager)
                .join("tools").join(&dep.name)
                .join(&dep.version);
            if tool_dir.exists() { return None; }
            let system = find_tool_system_any(&index, &dep.packager, &dep.name, &dep.version, &host)?
                .clone();
            Some((tool_dir, system, dep.name.clone()))
        })
        .collect();

    if !core_needed && tools_needed.is_empty() {
        println!("  {} {} {} already up to date",
            "•".dimmed(), arch.bold(), platform.version.dimmed());
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
            println!("  {}  Downloading {}…", "↓".cyan(), item.label.bold());
            match download_and_extract(&item.url, item.checksum.as_deref(), &item.dest, verbose) {
                Ok(()) => { println!("  {}  {}", "✓".green().bold(), item.label.bold()); None }
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
        "✓".green().bold(), "tsuki-modules".bold(), arch.bold(),
        root.display().to_string().dimmed()
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
        println!("{} No cores installed via tsuki-modules.", "!".yellow());
        println!("  Install one with: {}", "tsuki-flash modules install avr".bold());
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
        println!("{} No cores installed.", "!".yellow());
        return Ok(());
    }

    cores.sort_by(|a, b| a.arch.cmp(&b.arch));
    println!("{:<12}  {:<10}  {}", "ARCH".bold().underline(), "VERSION".bold().underline(), "INDEX URL".bold().underline());
    println!("{}", "─".repeat(60).dimmed());
    for c in &cores {
        println!("{:<12}  {:<10}  {}",
            c.arch.cyan(),
            c.version.dimmed(),
            index_url_for_arch(&c.arch).dimmed());
    }
    println!("\n  {} installed  —  {}", cores.len(), root.display().to_string().dimmed());
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
    println!("{} Refreshing package indices ({} cached files removed)…", "→".cyan(), removed);
    let installed_dir = root.join("installed");
    if installed_dir.exists() {
        for entry in fs::read_dir(&installed_dir)?.flatten() {
            if let Some(stem) = entry.path().file_stem() {
                let arch = stem.to_string_lossy().to_string();
                print!("  {} {}… ", "↓".cyan(), arch.bold());
                match load_index(&arch, verbose) {
                    Ok(_)  => println!("{}", "ok".green()),
                    Err(e) => println!("{} ({})", "failed".red(), e),
                }
            }
        }
    }
    println!("{} Package indices updated.", "✓".green().bold());
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

    println!("{} Fetching {} package index…", "→".cyan(), arch);
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
        "esp8266" => Ok(("esp8266", "esp8266", "esp8266com")),
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
    // Case-insensitive search handles e.g. "esp8266com" vs "esp8266Com".
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
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]  { return "i686-mingw32".into(); }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))] { return "i686-mingw32".into(); }
    #[allow(unreachable_code)]
    "unknown".into()
}

fn host_matches(system_host: &str, current: &str) -> bool {
    (system_host.contains("linux-gnu")  && current.contains("linux-gnu"))
    || (system_host.contains("apple")   && current.contains("apple"))
    || (system_host.contains("mingw")   && current.contains("mingw"))
    || system_host == current
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