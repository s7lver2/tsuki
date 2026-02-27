// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: modules  —  tsuki-modules  (SDK layer, replaces .arduino15)
//
//  Design goals:
//    • Zero arduino-cli dependency at compile OR runtime
//    • Parallel tool + core downloads  (rayon)
//    • Incremental: skip extraction when versioned dir already exists
//    • Mirror .arduino15 layout exactly → sdk.rs reuse with zero changes
//    • Single JSON index fetch, cached 24 h
//
//  Install root:   ~/.tsuki/modules/
//  Layout:
//    packages/<vendor>/hardware/<arch>/<ver>/   ← core headers
//    packages/<vendor>/tools/<toolchain>/<ver>/ ← compiler binaries
//    .tsuki_pkg_index.json                      ← cached package index
//    installed/<arch>.json                      ← installed-core manifests
//
//  Subcommands:
//    tsuki-flash modules install avr   → downloads arduino:avr + avr-gcc
//    tsuki-flash modules list          → lists installed cores
//    tsuki-flash modules update        → refreshes cached package index
//
//  Submodules:
//    avr   → fast AVR compile pipeline that uses the tsuki-modules SDK paths
// ─────────────────────────────────────────────────────────────────────────────

pub mod avr;

use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use colored::Colorize;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::error::{FlashError, Result};

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────

const PACKAGE_INDEX_URL: &str =
    "https://downloads.arduino.cc/packages/package_index.json";

/// Re-download the index after 24 h.
const INDEX_TTL_SECS: u64 = 86_400;

// ─────────────────────────────────────────────────────────────────────────────
//  Arduino package_index.json model  (subset of what we need)
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
//  Public: install
// ─────────────────────────────────────────────────────────────────────────────

/// Download and install the Arduino core + toolchain for `arch`.
///
/// Downloads are parallel (rayon).  Re-installing an already-present versioned
/// directory is a no-op — the check is a single `Path::exists()`, so repeated
/// calls are near-instant.
pub fn install(arch: &str, verbose: bool) -> Result<()> {
    let root = modules_root()?;
    fs::create_dir_all(&root)?;

    println!("{} Installing {} core via tsuki-modules…",
        "→".cyan().bold(), arch.bold());

    let index   = load_index(verbose)?;
    let (vendor, hw_arch, pkg_name) = arch_to_package(arch)?;
    let (_pkg, platform) = find_latest_platform(&index, pkg_name, hw_arch)?;

    // ── Platform dir ─────────────────────────────────────────────────────
    let platform_dir = root
        .join("packages").join(vendor)
        .join("hardware").join(hw_arch)
        .join(&platform.version);
    let core_needed = !platform_dir.exists();

    // ── Tools needed ─────────────────────────────────────────────────────
    let host = current_host();
    // Collect (tool_dir, cloned ToolSystem, tool_name) — clone to own the data.
    let tools_needed: Vec<(PathBuf, ToolSystem, String)> = platform
        .tools_deps
        .iter()
        .filter_map(|dep| {
            let tool_dir = root
                .join("packages").join(&dep.packager)
                .join("tools").join(&dep.name)
                .join(&dep.version);
            if tool_dir.exists() {
                return None; // already installed
            }
            // clone() so we own ToolSystem and can move it into the Vec
            let system = find_tool_system(&index, &dep.packager, &dep.name, &dep.version, &host)?
                .clone();
            Some((tool_dir, system, dep.name.clone()))
        })
        .collect();

    if !core_needed && tools_needed.is_empty() {
        println!("  {} {} {} already up to date",
            "•".dimmed(), arch.bold(), platform.version.dimmed());
        return write_installed_manifest(&root, arch, &platform.version);
    }

    // ── Build flat work list then download everything in parallel ─────────
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
                Ok(()) => {
                    println!("  {}  {}", "✓".green().bold(), item.label.bold());
                    None
                }
                Err(e) => Some(format!("{}: {}", item.label, e)),
            }
        })
        .collect();

    if !errors.is_empty() {
        let detail = errors.iter()
            .map(|e| e.replace('\n', " ").replace("  ", " "))
            .collect::<Vec<_>>()
            .join(" | ");
        return Err(FlashError::Other(format!(
            "Some downloads failed — {}", detail
        )));
    }

    write_installed_manifest(&root, arch, &platform.version)?;

    println!(
        "\n  {} {} {} ready  ({})",
        "✓".green().bold(), "tsuki-modules".bold(), arch.bold(),
        root.display().to_string().dimmed()
    );
    println!(
        "  {} Compile with: {}",
        "→".cyan(),
        "tsuki build --compile --backend tsuki-flash+cores".bold()
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
    println!("{:<12}  {}", "ARCH".bold().underline(), "VERSION".bold().underline());
    println!("{}", "─".repeat(26).dimmed());
    for c in &cores {
        println!("{:<12}  {}", c.arch.cyan(), c.version.dimmed());
    }
    println!("\n  {} installed  —  {}", cores.len(), root.display().to_string().dimmed());
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public: update
// ─────────────────────────────────────────────────────────────────────────────

pub fn update(verbose: bool) -> Result<()> {
    let cache = index_cache_path()?;
    if cache.exists() {
        fs::remove_file(&cache)?;
    }
    println!("{} Refreshing package index…", "→".cyan());
    load_index(verbose)?;
    println!("{} Package index updated.", "✓".green().bold());
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
//  Internal: index loading + caching
// ─────────────────────────────────────────────────────────────────────────────

fn load_index(verbose: bool) -> Result<PackageIndex> {
    let cache = index_cache_path()?;

    if let Some(mtime) = file_mtime(&cache) {
        let age = now_secs().saturating_sub(mtime);
        if age < INDEX_TTL_SECS {
            if verbose {
                eprintln!("  [modules] using cached package index ({} s old)", age);
            }
            let data = fs::read_to_string(&cache)?;
            return serde_json::from_str(&data)
                .map_err(|e| FlashError::Other(format!("Failed to parse cached index: {}", e)));
        }
    }

    println!("{} Fetching Arduino package index…", "→".cyan());
    let resp = ureq::get(PACKAGE_INDEX_URL)
        .call()
        .map_err(|e| FlashError::Other(format!("Failed to download package index: {}", e)))?;

    let mut body = Vec::with_capacity(4 * 1024 * 1024);
    resp.into_reader()
        .read_to_end(&mut body)
        .map_err(|e| FlashError::Other(format!("Failed to read package index: {}", e)))?;

    if let Some(parent) = cache.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&cache, &body)
        .map_err(|e| FlashError::Other(format!("Failed to cache index: {}", e)))?;

    serde_json::from_slice(&body)
        .map_err(|e| FlashError::Other(format!("Failed to parse package index: {}", e)))
}

fn index_cache_path() -> Result<PathBuf> {
    Ok(modules_root()?.join(".tsuki_pkg_index.json"))
}

// ─────────────────────────────────────────────────────────────────────────────
//  Internal: download + SHA-256 verify + archive extract
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

    if let Some(cs) = checksum {
        verify_sha256(&buf, cs)?;
    }

    if url.ends_with(".tar.bz2") || url.ends_with(".tar.gz") || url.ends_with(".tar.xz") {
        extract_tar(&buf, dest, url)
    } else {
        extract_zip(&buf, dest)
    }
}

fn verify_sha256(data: &[u8], checksum_field: &str) -> Result<()> {
    use sha2::{Digest, Sha256};

    let expected = checksum_field
        .strip_prefix("SHA-256:")
        .unwrap_or(checksum_field)
        .trim()
        .to_lowercase();

    let actual = hex::encode(Sha256::digest(data));
    if actual != expected {
        return Err(FlashError::Other(format!(
            "Checksum mismatch!\n  expected: {}\n  actual:   {}", expected, actual
        )));
    }
    Ok(())
}

fn extract_zip(data: &[u8], dest: &Path) -> Result<()> {
    use std::io::Cursor;

    let mut archive = zip::ZipArchive::new(Cursor::new(data))
        .map_err(|e| FlashError::Other(format!("Failed to open ZIP: {}", e)))?;

    let prefix = {
        let first = archive.by_index(0)
            .map_err(|e| FlashError::Other(e.to_string()))?;
        let name = first.name().to_owned();
        if name.ends_with('/') {
            Some(name)
        } else {
            name.find('/').map(|i| format!("{}/", &name[..i]))
        }
    };

    fs::create_dir_all(dest)?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| FlashError::Other(format!("ZIP read error: {}", e)))?;

        let raw = file.name().to_owned();
        let rel = match &prefix {
            Some(pfx) => raw.strip_prefix(pfx.as_str()).unwrap_or(&raw),
            None => &raw,
        };
        if rel.is_empty() { continue; }

        let out = dest.join(rel);
        if file.is_dir() {
            fs::create_dir_all(&out)?;
        } else {
            if let Some(p) = out.parent() { fs::create_dir_all(p)?; }
            let mut f = fs::File::create(&out)?;
            io::copy(&mut file, &mut f)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Some(mode) = file.unix_mode() {
                    let _ = fs::set_permissions(&out, fs::Permissions::from_mode(mode));
                }
            }
        }
    }
    Ok(())
}

fn extract_tar(data: &[u8], dest: &Path, url: &str) -> Result<()> {
    fs::create_dir_all(dest)?;
    let tmp = dest.parent().unwrap_or(dest).join(".tsuki_tmp_archive");
    fs::write(&tmp, data)
        .map_err(|e| FlashError::Other(format!("Failed to write temp archive: {}", e)))?;

    let flag = if url.ends_with(".tar.bz2") { "j" }
               else if url.ends_with(".tar.xz") { "J" }
               else { "z" };

    let status = std::process::Command::new("tar")
        .args([&format!("-x{}f", flag), tmp.to_str().unwrap(),
               "--strip-components=1", "-C", dest.to_str().unwrap()])
        .status()
        .map_err(|e| FlashError::Other(format!("tar not found: {}", e)))?;

    let _ = fs::remove_file(&tmp);

    if !status.success() {
        return Err(FlashError::Other(format!("tar extraction failed for {}", dest.display())));
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

fn find_tool_system<'a>(
    index: &'a PackageIndex,
    packager: &str,
    tool_name: &str,
    version: &str,
    host: &str,
) -> Option<&'a ToolSystem> {
    let pkg  = index.packages.iter().find(|p| p.name == packager)?;
    let tool = pkg.tools.iter().find(|t| t.name == tool_name && t.version == version)?;
    tool.systems.iter().find(|s| host_matches(&s.host, host))
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