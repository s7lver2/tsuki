// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: lib_manager
//
//  Installs / lists / searches Arduino libraries without arduino-cli.
//
//  Sources:
//    • Arduino Library Registry  — https://downloads.arduino.cc/libraries/library_index.json
//    • GitHub source ZIP         — resolved from the registry entry
//
//  Install path: same location arduino-cli uses, so tsuki-flash's existing
//  compile pipeline can find them automatically:
//
//    ~/.arduino15/libraries/<LibraryName>/<version>/
//
//  The registry is cached locally at:
//    ~/.arduino15/.tsuki_lib_index.json   (refreshed after CACHE_TTL_SECS)
//
//  Subcommands exposed via this module:
//    tsuki-flash lib install <name> [--version x.y.z]
//    tsuki-flash lib search  <query>
//    tsuki-flash lib list
//    tsuki-flash lib info    <name>
// ─────────────────────────────────────────────────────────────────────────────

use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use colored::Colorize;
use serde::{Deserialize, Serialize};

use crate::error::{FlashError, Result};

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────

const REGISTRY_URL: &str =
    "https://downloads.arduino.cc/libraries/library_index.json";

/// Re-download the index after this many seconds (24 h).
const CACHE_TTL_SECS: u64 = 86_400;

// ─────────────────────────────────────────────────────────────────────────────
//  Registry data model  (subset of the Arduino JSON schema)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct LibraryIndex {
    pub libraries: Vec<LibraryEntry>,
}

/// One entry in the registry (may appear multiple times with different versions;
/// we always pick the latest unless the user pinned a version).
#[derive(Debug, Clone, Deserialize)]
pub struct LibraryEntry {
    pub name:     String,
    pub version:  String,
    pub url:      String,       // direct ZIP download URL
    pub checksum: Option<String>, // SHA-256 prefixed with "SHA-256:"
    #[serde(rename = "archiveFileName")]
    pub archive_filename: Option<String>,
    pub sentence:  Option<String>, // short description
    pub paragraph: Option<String>, // long description
    pub category:  Option<String>,
    pub website:   Option<String>,
    pub maintainer: Option<String>,
    pub architectures: Option<Vec<String>>,
    pub dependencies: Option<Vec<LibraryDep>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LibraryDep {
    pub name: String,
    pub version: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
//  Installed library manifest  (written next to the library source)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct InstalledManifest {
    pub name:     String,
    pub version:  String,
    pub url:      String,
    pub installed_at: u64, // unix timestamp
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────────────────────

/// Install a library by name (and optional pinned version).
///
/// Steps:
///   1. Load (or refresh) the registry index.
///   2. Resolve the best matching entry.
///   3. Check whether it's already installed at the right version.
///   4. Download the ZIP archive.
///   5. Extract into `<libs_root>/<LibraryName>/`.
///   6. Recursively install declared dependencies.
pub fn install(name: &str, pin_version: Option<&str>, verbose: bool) -> Result<()> {
    let libs_root = libs_root()?;
    install_inner(name, pin_version, &libs_root, verbose, 0)
}

fn install_inner(
    name: &str,
    pin_version: Option<&str>,
    libs_root: &Path,
    verbose: bool,
    depth: usize,
) -> Result<()> {
    let indent = "  ".repeat(depth);

    let index = load_index(verbose)?;
    let entry = resolve_entry(&index, name, pin_version)?;

    let install_dir = libs_root.join(&entry.name);

    // ── Already installed at the right version? ───────────────────────────
    if let Some(installed) = read_manifest(&install_dir) {
        if installed.version == entry.version {
            if !quiet_mode() {
                println!(
                    "{}{}  {} {} already installed",
                    indent,
                    "•".dimmed(),
                    entry.name.bold(),
                    entry.version.dimmed()
                );
            }
            return Ok(());
        }
        // Different version → upgrade
        if verbose {
            println!(
                "{}Upgrading {} {} → {}",
                indent,
                entry.name.bold(),
                installed.version.dimmed(),
                entry.version.cyan()
            );
        }
    }

    // ── Download ──────────────────────────────────────────────────────────
    println!(
        "{}{}  Downloading {} {}…",
        indent,
        "↓".cyan().bold(),
        entry.name.bold(),
        entry.version.dimmed()
    );

    let zip_bytes = download_zip(&entry.url, entry.checksum.as_deref(), verbose)?;

    // ── Extract ───────────────────────────────────────────────────────────
    println!(
        "{}{}  Installing {}…",
        indent,
        "→".cyan(),
        entry.name.bold()
    );

    extract_zip(&zip_bytes, &install_dir)?;

    // ── Write manifest ────────────────────────────────────────────────────
    write_manifest(&install_dir, &entry)?;

    println!(
        "{}{}  {} {}",
        indent,
        "✓".green().bold(),
        entry.name.bold(),
        entry.version.dimmed()
    );

    // ── Recurse into dependencies ─────────────────────────────────────────
    if let Some(deps) = &entry.dependencies {
        if !deps.is_empty() {
            println!("{}  {} dependencies:", indent, "↳".dimmed());
        }
        for dep in deps {
            install_inner(
                &dep.name,
                dep.version.as_deref(),
                libs_root,
                verbose,
                depth + 1,
            )?;
        }
    }

    Ok(())
}

/// Search the registry for libraries matching `query` (case-insensitive
/// substring match against name, sentence, category).
pub fn search(query: &str, verbose: bool) -> Result<()> {
    let index = load_index(verbose)?;
    let q = query.to_lowercase();

    // Collect the latest version of each matching library.
    let mut hits: Vec<&LibraryEntry> = Vec::new();
    let mut seen: std::collections::HashSet<&str> = Default::default();

    // Registry entries are newest-first by convention, so the first occurrence
    // of a name is already the latest version.
    for lib in &index.libraries {
        if seen.contains(lib.name.as_str()) {
            continue;
        }
        let matches =
            lib.name.to_lowercase().contains(&q) ||
            lib.sentence.as_deref().unwrap_or("").to_lowercase().contains(&q) ||
            lib.category.as_deref().unwrap_or("").to_lowercase().contains(&q);

        if matches {
            hits.push(lib);
            seen.insert(&lib.name);
        }
    }

    if hits.is_empty() {
        println!("{} No libraries found matching '{}'", "!".yellow(), query);
        return Ok(());
    }

    println!(
        "{:<40} {:<10}  {}",
        "NAME".bold().underline(),
        "VERSION".bold().underline(),
        "DESCRIPTION".bold().underline()
    );
    println!("{}", "─".repeat(90).dimmed());

    for lib in &hits {
        let desc = lib.sentence.as_deref().unwrap_or("—");
        let desc_short = if desc.len() > 60 { &desc[..57] } else { desc };
        println!(
            "{:<40} {:<10}  {}",
            lib.name.cyan(),
            lib.version.dimmed(),
            desc_short
        );
    }

    println!("\n  {} libraries found", hits.len());
    Ok(())
}

/// List all installed libraries (scans the libs_root directory).
pub fn list() -> Result<()> {
    let libs_root = libs_root()?;

    if !libs_root.exists() {
        println!("{} No libraries installed yet.", "!".yellow());
        println!(
            "  Install one with: {}",
            "tsuki-flash lib install <name>".bold()
        );
        return Ok(());
    }

    let mut entries: Vec<(String, String)> = Vec::new();

    for dir in fs::read_dir(&libs_root)?.flatten() {
        let path = dir.path();
        if !path.is_dir() { continue; }

        if let Some(m) = read_manifest(&path) {
            entries.push((m.name, m.version));
        } else {
            // Best-effort: use directory name, version unknown
            let name = path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            entries.push((name, "?".into()));
        }
    }

    if entries.is_empty() {
        println!("{} No libraries installed.", "!".yellow());
        return Ok(());
    }

    entries.sort_by(|a, b| a.0.cmp(&b.0));

    println!("{:<40}  {}", "LIBRARY".bold().underline(), "VERSION".bold().underline());
    println!("{}", "─".repeat(55).dimmed());

    for (name, version) in &entries {
        println!("{:<40}  {}", name.cyan(), version.dimmed());
    }

    println!("\n  {} installed", entries.len());
    println!("  path: {}", libs_root.display().to_string().dimmed());
    Ok(())
}

/// Print detailed info about a library (latest version).
pub fn info(name: &str, verbose: bool) -> Result<()> {
    let index = load_index(verbose)?;
    let entry = resolve_entry(&index, name, None)?;

    let libs_root = libs_root()?;
    let installed = read_manifest(&libs_root.join(&entry.name));

    println!();
    println!("  {}  {}", entry.name.bold().cyan(), entry.version.dimmed());
    println!();

    if let Some(s) = &entry.sentence {
        println!("  {}", s);
    }
    if let Some(p) = &entry.paragraph {
        println!("  {}", p.dimmed());
    }
    println!();

    let key_val = |k: &str, v: &str| {
        println!("  {:<16} {}", format!("{}:", k).dimmed(), v);
    };

    key_val("category",    entry.category.as_deref().unwrap_or("—"));
    key_val("maintainer",  entry.maintainer.as_deref().unwrap_or("—"));
    key_val("website",     entry.website.as_deref().unwrap_or("—"));

    if let Some(archs) = &entry.architectures {
        key_val("architectures", &archs.join(", "));
    }

    if let Some(deps) = &entry.dependencies {
        if !deps.is_empty() {
            let dep_str: Vec<String> = deps.iter()
                .map(|d| match &d.version {
                    Some(v) => format!("{}@{}", d.name, v),
                    None    => d.name.clone(),
                })
                .collect();
            key_val("dependencies", &dep_str.join(", "));
        }
    }

    println!();

    match installed {
        Some(m) => {
            println!("  {}  installed at {}", "✓".green().bold(), m.version.bold());
        }
        None => {
            println!(
                "  {}  not installed  →  {}",
                "○".dimmed(),
                format!("tsuki-flash lib install \"{}\"", entry.name).bold()
            );
        }
    }

    println!();
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
//  Index loading & caching
// ─────────────────────────────────────────────────────────────────────────────

fn load_index(verbose: bool) -> Result<LibraryIndex> {
    let cache_path = index_cache_path()?;

    // Use the cached file if it's fresh enough.
    if let Some(mtime) = file_mtime(&cache_path) {
        let age = now_secs().saturating_sub(mtime);
        if age < CACHE_TTL_SECS {
            if verbose {
                eprintln!("  [lib] using cached index ({} s old)", age);
            }
            return parse_index_file(&cache_path);
        }
    }

    // (Re-)download the index.
    println!("{} Fetching Arduino library index…", "→".cyan());

    let resp = ureq::get(REGISTRY_URL)
        .call()
        .map_err(|e| FlashError::Other(format!("Failed to download library index: {}", e)))?;

    // into_string() has a ~10 MB cap; library_index.json is ~20 MB, so we
    // must stream the body manually.
    let mut body_bytes: Vec<u8> = Vec::with_capacity(24 * 1024 * 1024);
    resp.into_reader()
        .read_to_end(&mut body_bytes)
        .map_err(|e| FlashError::Other(format!("Failed to read library index response: {}", e)))?;

    // Persist to cache.
    if let Some(parent) = cache_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&cache_path, &body_bytes)
        .map_err(|e| FlashError::Other(format!("Failed to cache library index: {}", e)))?;

    serde_json::from_slice::<LibraryIndex>(&body_bytes)
        .map_err(|e| FlashError::Other(format!("Failed to parse library index: {}", e)))
}

fn parse_index_file(path: &Path) -> Result<LibraryIndex> {
    let data = fs::read_to_string(path)?;
    serde_json::from_str::<LibraryIndex>(&data)
        .map_err(|e| FlashError::Other(format!("Failed to parse cached library index: {}", e)))
}

// ─────────────────────────────────────────────────────────────────────────────
//  Entry resolution
// ─────────────────────────────────────────────────────────────────────────────

fn resolve_entry<'a>(
    index: &'a LibraryIndex,
    name: &str,
    pin: Option<&str>,
) -> Result<&'a LibraryEntry> {
    let lower = name.to_lowercase();

    // Collect all entries with a matching name (case-insensitive).
    let mut candidates: Vec<&LibraryEntry> = index.libraries.iter()
        .filter(|e| e.name.to_lowercase() == lower)
        .collect();

    if candidates.is_empty() {
        // Fuzzy hint
        let suggestions: Vec<&str> = index.libraries.iter()
            .filter(|e| e.name.to_lowercase().contains(&lower))
            .take(5)
            .map(|e| e.name.as_str())
            .collect();

        let hint = if suggestions.is_empty() {
            String::new()
        } else {
            format!("\n  Did you mean: {}", suggestions.join(", "))
        };

        return Err(FlashError::Other(format!(
            "Library '{}' not found in the Arduino registry.{}",
            name, hint
        )));
    }

    // If a version was pinned, filter to that exact version.
    if let Some(v) = pin {
        candidates.retain(|e| e.version == v);
        if candidates.is_empty() {
            return Err(FlashError::Other(format!(
                "Library '{}' version '{}' not found in the registry.",
                name, v
            )));
        }
    }

    // Sort descending by semver to pick the latest.
    candidates.sort_by(|a, b| {
        let va = parse_semver(&a.version);
        let vb = parse_semver(&b.version);
        vb.cmp(&va)
    });

    Ok(candidates[0])
}

// ─────────────────────────────────────────────────────────────────────────────
//  Download + extraction
// ─────────────────────────────────────────────────────────────────────────────

fn download_zip(url: &str, checksum: Option<&str>, verbose: bool) -> Result<Vec<u8>> {
    if verbose {
        eprintln!("  [lib] GET {}", url);
    }

    let resp = ureq::get(url)
        .call()
        .map_err(|e| FlashError::Other(format!("Download failed ({}): {}", url, e)))?;

    let mut buf = Vec::new();
    resp.into_reader()
        .read_to_end(&mut buf)
        .map_err(|e| FlashError::Other(format!("Failed to read download body: {}", e)))?;

    // Verify SHA-256 checksum if provided.
    if let Some(cs) = checksum {
        verify_sha256(&buf, cs)?;
    }

    Ok(buf)
}

fn verify_sha256(data: &[u8], checksum_field: &str) -> Result<()> {
    use sha2::{Sha256, Digest};

    let expected_hex = checksum_field
        .strip_prefix("SHA-256:")
        .unwrap_or(checksum_field)
        .trim()
        .to_lowercase();

    let mut hasher = Sha256::new();
    hasher.update(data);
    let actual = hex::encode(hasher.finalize());

    if actual != expected_hex {
        return Err(FlashError::Other(format!(
            "Checksum mismatch!\n  expected: {}\n  actual:   {}",
            expected_hex, actual
        )));
    }
    Ok(())
}

/// Extract a ZIP archive into `dest_dir`.
///
/// Arduino ZIPs always have a top-level directory named `<LibName>-<version>/`.
/// We strip that prefix so the library lands directly at `dest_dir/`.
fn extract_zip(data: &[u8], dest_dir: &Path) -> Result<()> {
    use std::io::Cursor;

    let cursor = Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| FlashError::Other(format!("Failed to open ZIP: {}", e)))?;

    // Find the common top-level prefix to strip (e.g. "DHT_sensor_library-1.4.6/").
    let prefix = find_zip_prefix(&mut archive);

    fs::create_dir_all(dest_dir)?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| FlashError::Other(format!("ZIP read error: {}", e)))?;

        let raw_name = file.name().to_owned();

        // Strip the top-level prefix.
        let rel = if let Some(ref pfx) = prefix {
            raw_name.strip_prefix(pfx.as_str()).unwrap_or(&raw_name)
        } else {
            &raw_name
        };

        if rel.is_empty() { continue; }

        let out_path = dest_dir.join(rel);

        if file.is_dir() {
            fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut outfile = fs::File::create(&out_path)?;
            io::copy(&mut file, &mut outfile)?;
        }
    }

    Ok(())
}

fn find_zip_prefix(archive: &mut zip::ZipArchive<io::Cursor<&[u8]>>) -> Option<String> {
    // The first entry should be the top-level directory.
    if archive.len() == 0 { return None; }
    let first = archive.by_index(0).ok()?;
    let name = first.name().to_owned();
    // Check that it ends with '/' (is a directory).
    if name.ends_with('/') {
        Some(name)
    } else {
        // Some ZIPs have no explicit directory entry; find the common prefix.
        drop(first);
        let first_file = archive.by_index(0).ok()?;
        let parts: Vec<&str> = first_file.name().splitn(2, '/').collect();
        if parts.len() == 2 {
            Some(format!("{}/", parts[0]))
        } else {
            None
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Manifest helpers
// ─────────────────────────────────────────────────────────────────────────────

fn write_manifest(install_dir: &Path, entry: &LibraryEntry) -> Result<()> {
    let m = InstalledManifest {
        name:         entry.name.clone(),
        version:      entry.version.clone(),
        url:          entry.url.clone(),
        installed_at: now_secs(),
    };
    let json = serde_json::to_string_pretty(&m)
        .map_err(|e| FlashError::Other(e.to_string()))?;
    fs::write(install_dir.join(".tsuki_lib.json"), json)?;
    Ok(())
}

fn read_manifest(install_dir: &Path) -> Option<InstalledManifest> {
    let path = install_dir.join(".tsuki_lib.json");
    let data = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

// ─────────────────────────────────────────────────────────────────────────────
//  Path helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Root directory where Arduino libraries are stored.
///
/// Priority:
///   1. `TSUKI_LIBS_ROOT` env var  (explicit override)
///   2. `~/.arduino15/libraries`   (arduino-cli compatible)
pub fn libs_root() -> Result<PathBuf> {
    if let Ok(r) = std::env::var("TSUKI_LIBS_ROOT") {
        return Ok(PathBuf::from(r));
    }
    let home = home_dir()?;
    Ok(home.join(".arduino15").join("libraries"))
}

fn index_cache_path() -> Result<PathBuf> {
    let home = home_dir()?;
    Ok(home.join(".arduino15").join(".tsuki_lib_index.json"))
}

fn home_dir() -> Result<PathBuf> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .map_err(|_| FlashError::Other("Cannot determine home directory".into()))
}

fn file_mtime(path: &Path) -> Option<u64> {
    fs::metadata(path).ok()?.modified().ok()?
        .duration_since(UNIX_EPOCH).ok()
        .map(|d| d.as_secs())
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn quiet_mode() -> bool {
    std::env::var("TSUKI_QUIET").is_ok()
}

// ─────────────────────────────────────────────────────────────────────────────
//  Misc helpers
// ─────────────────────────────────────────────────────────────────────────────

fn parse_semver(s: &str) -> Vec<u32> {
    s.split('.').map(|p| p.parse::<u32>().unwrap_or(0)).collect()
}