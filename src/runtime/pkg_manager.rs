// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: runtime :: pkg_manager
//
//  Package manager: reads a JSON registry from a URL (your GitHub repo) and
//  downloads / installs tsukilib packages from the URLs listed there.
//
//  Registry JSON format (hosted at REGISTRY_URL):
//
//  {
//    "packages": {
//      "ws2812": {
//        "description": "WS2812 NeoPixel driver",
//        "author":      "tsuki-team",
//        "latest":      "1.1.0",
//        "versions": {
//          "1.0.0": "https://raw.githubusercontent.com/.../ws2812/1.0.0/tsukilib.toml",
//          "1.1.0": "https://raw.githubusercontent.com/.../ws2812/1.1.0/tsukilib.toml"
//        }
//      },
//      "dht": { ... }
//    }
//  }
//
//  CLI commands wired here (via main.rs):
//    tsuki pkg list               — list all available packages in the registry
//    tsuki pkg search <query>     — search registry by name/description
//    tsuki pkg install <name>     — install latest version
//    tsuki pkg install <name>@<v> — install specific version
//    tsuki pkg remove  <name>     — remove installed package
//    tsuki pkg update             — update all installed packages to latest
//    tsuki pkg installed          — list locally installed packages
// ─────────────────────────────────────────────────────────────────────────────

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::fs;

use serde::{Deserialize, Serialize};

use crate::error::{tsukiError, Result};
use super::pkg_loader;

// Re-export for use by the binary crate
pub use super::pkg_loader::default_libs_dir;

// ── Registry URL ──────────────────────────────────────────────────────────────

/// Default registry URL. Override with the tsuki_REGISTRY env var or
/// the --registry flag so users can point at their own fork / mirror.
pub const DEFAULT_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/s7lver/tsuki-pkgs/main/registry.json";

// ── Registry schema ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Registry {
    pub packages: HashMap<String, RegistryEntry>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct RegistryEntry {
    pub description: Option<String>,
    pub author:      Option<String>,
    /// Latest stable version string (e.g. "1.1.0").
    pub latest:      String,
    /// Map of version string → TOML download URL.
    pub versions:    HashMap<String, String>,
}

// ── Fetching ──────────────────────────────────────────────────────────────────

/// Download and parse the registry JSON from `url`.
pub fn fetch_registry(url: &str) -> Result<Registry> {
    let body = http_get(url)?;
    let reg: Registry = serde_json::from_str(&body).map_err(|e| {
        tsukiError::codegen(format!("failed to parse registry JSON from {}: {}", url, e))
    })?;
    Ok(reg)
}

/// Download text from a URL using ureq (blocking / sync).
fn http_get(url: &str) -> Result<String> {
    ureq::get(url)
        .call()
        .map_err(|e| tsukiError::codegen(format!("HTTP GET {} failed: {}", url, e)))?
        .into_string()
        .map_err(|e| tsukiError::codegen(format!("failed to read response body from {}: {}", url, e)))
}

// ── Install ───────────────────────────────────────────────────────────────────

/// Install a package by name (and optional version) from the registry.
///
/// - `name`     — package name, e.g. `"ws2812"` or `"ws2812@1.0.0"`
/// - `libs_dir` — root directory for installed packages
/// - `registry` — parsed registry (call `fetch_registry` first)
///
/// Returns a human-readable status message.
pub fn install(
    name_ver:  &str,
    libs_dir:  &Path,
    registry:  &Registry,
) -> Result<String> {
    // Parse optional "@version" suffix
    let (name, version_hint) = parse_name_version(name_ver);

    let entry = registry.packages.get(name).ok_or_else(|| {
        tsukiError::codegen(format!(
            "package '{}' not found in registry — run `tsuki pkg list` to see available packages",
            name
        ))
    })?;

    let version = version_hint.unwrap_or_else(|| entry.latest.as_str());

    let toml_url = entry.versions.get(version).ok_or_else(|| {
        let available: Vec<&str> = entry.versions.keys().map(|s| s.as_str()).collect();
        tsukiError::codegen(format!(
            "version '{}' not found for package '{}'. Available: {}",
            version, name, available.join(", ")
        ))
    })?;

    eprintln!("tsuki: downloading {}@{} from {} …", name, version, toml_url);
    let toml_str = http_get(toml_url)?;

    let msg = pkg_loader::install_from_toml(libs_dir, &toml_str)?;
    Ok(msg)
}

/// Remove an installed package (all versions, or a specific one).
pub fn remove(name_ver: &str, libs_dir: &Path) -> Result<String> {
    let (name, version_hint) = parse_name_version(name_ver);
    let pkg_dir = libs_dir.join(name);

    if !pkg_dir.exists() {
        return Err(tsukiError::codegen(format!(
            "package '{}' is not installed (looked in {})",
            name, pkg_dir.display()
        )));
    }

    match version_hint {
        Some(ver) => {
            let ver_dir = pkg_dir.join(ver);
            if !ver_dir.exists() {
                return Err(tsukiError::codegen(format!(
                    "{}@{} is not installed", name, ver
                )));
            }
            fs::remove_dir_all(&ver_dir).map_err(|e| {
                tsukiError::codegen(format!("failed to remove {}: {}", ver_dir.display(), e))
            })?;
            // If no more versions, remove the package dir too
            if fs::read_dir(&pkg_dir).map(|mut d| d.next().is_none()).unwrap_or(false) {
                let _ = fs::remove_dir(&pkg_dir);
            }
            Ok(format!("removed {}@{}", name, ver))
        }
        None => {
            fs::remove_dir_all(&pkg_dir).map_err(|e| {
                tsukiError::codegen(format!("failed to remove {}: {}", pkg_dir.display(), e))
            })?;
            Ok(format!("removed {} (all versions)", name))
        }
    }
}

/// Update all installed packages to their latest registry version.
pub fn update_all(libs_dir: &Path, registry: &Registry) -> Result<Vec<String>> {
    let mut results = Vec::new();

    let Ok(entries) = fs::read_dir(libs_dir) else {
        return Ok(results);
    };

    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let pkg_name = entry.file_name().to_string_lossy().into_owned();
        match install(&pkg_name, libs_dir, registry) {
            Ok(msg)  => results.push(msg),
            Err(e)   => results.push(format!("warning: {}: {}", pkg_name, e)),
        }
    }

    Ok(results)
}

// ── Query ─────────────────────────────────────────────────────────────────────

/// List all packages in the registry, optionally filtered by a search query.
pub fn list_registry(registry: &Registry, query: Option<&str>) -> Vec<RegistryEntry> {
    // (We return a Vec of (&name, &entry) but the caller needs names too —
    //  the command handler can iterate registry.packages directly.)
    let _ = query; // consumed by caller
    registry.packages.values().cloned().collect()
}

/// List locally installed packages (name + version).
pub fn list_installed(libs_dir: &Path) -> Vec<(String, String)> {
    let mut result = Vec::new();

    let Ok(pkg_entries) = fs::read_dir(libs_dir) else { return result };

    for pkg_entry in pkg_entries.flatten() {
        if !pkg_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let pkg_name = pkg_entry.file_name().to_string_lossy().into_owned();
        let pkg_path = pkg_entry.path();

        let Ok(ver_entries) = fs::read_dir(&pkg_path) else { continue };
        let mut versions: Vec<String> = ver_entries
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        versions.sort();

        for v in versions {
            result.push((pkg_name.clone(), v));
        }
    }
    result.sort();
    result
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Parse `"name@version"` or just `"name"`.
fn parse_name_version(s: &str) -> (&str, Option<&str>) {
    match s.find('@') {
        Some(i) => (&s[..i], Some(&s[i + 1..])),
        None    => (s, None),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  v3 additions: multi-registry support via keys.json
//
//  keys.json lives at  ~/.config/tsuki/keys.json
//  DB cache lives at   ~/.cache/tsuki/db/<registry-name>.json
//
//  Each cache file is a flat packages.json:
//    [{"name":"ws2812","version":"1.0.0","toml_url":"https://..."}]
//
//  This mirrors what `tsuki updatedb` (Go CLI) writes.
// ─────────────────────────────────────────────────────────────────────────────

/// One entry in keys.json.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct RegistryKey {
    pub name: String,
    pub url:  String,
}

/// A single entry inside a packages.json cache file.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PackagesEntry {
    pub name:     String,
    pub version:  String,
    #[serde(alias = "download_url")]
    pub toml_url: Option<String>,
}

/// Load all registry keys from `~/.config/tsuki/keys.json`.
/// Returns an empty vec if the file does not exist (not an error).
pub fn load_keys() -> Vec<RegistryKey> {
    let Some(home) = dirs_home() else { return vec![] };
    let path = home.join(".config").join("tsuki").join("keys.json");
    let Ok(data) = fs::read_to_string(&path) else { return vec![] };
    serde_json::from_str(&data).unwrap_or_default()
}

/// Fetch and cache every registry listed in keys.json.
/// Writes one `<name>.json` file per registry into `~/.cache/tsuki/db/`.
/// Returns a list of (registry_name, package_count_or_error) for display.
pub fn update_db() -> Vec<(String, Result<usize>)> {
    let keys = load_keys();
    let Some(home) = dirs_home() else {
        return vec![("error".into(), Err(tsukiError::codegen("cannot determine home directory")))];
    };
    let cache_dir = home.join(".cache").join("tsuki").join("db");
    let _ = fs::create_dir_all(&cache_dir);

    keys.into_iter().map(|key| {
        let result = fetch_and_cache_registry(&key, &cache_dir);
        (key.name, result)
    }).collect()
}

fn fetch_and_cache_registry(key: &RegistryKey, cache_dir: &Path) -> Result<usize> {
    let url = if key.url.ends_with('/') {
        format!("{}packages.json", key.url)
    } else {
        format!("{}/packages.json", key.url)
    };

    let body = http_get(&url)?;

    // Validate it's parseable JSON array before caching.
    let entries: Vec<PackagesEntry> = serde_json::from_str(&body).map_err(|e| {
        tsukiError::codegen(format!("invalid packages.json from {}: {}", url, e))
    })?;
    let count = entries.len();

    let cache_file = cache_dir.join(format!("{}.json", key.name));
    fs::write(&cache_file, &body).map_err(|e| {
        tsukiError::codegen(format!("writing cache {}: {}", cache_file.display(), e))
    })?;

    Ok(count)
}

/// Resolve a package spec ("registry@name:version" or "name:version" or "name")
/// from the local DB cache.  Returns the toml_url and resolved version.
pub fn resolve_from_db(spec: &str) -> Result<(String, String)> {
    let (registry_hint, name, version_hint) = parse_v3_spec(spec);

    let Some(home) = dirs_home() else {
        return Err(tsukiError::codegen("cannot determine home directory"));
    };
    let cache_dir = home.join(".cache").join("tsuki").join("db");

    // Collect cache files to search: specific registry or all.
    let files: Vec<PathBuf> = if let Some(reg) = registry_hint {
        vec![cache_dir.join(format!("{}.json", reg))]
    } else {
        fs::read_dir(&cache_dir)
            .map(|rd| {
                rd.flatten()
                    .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
                    .map(|e| e.path())
                    .collect()
            })
            .unwrap_or_default()
    };

    for file in &files {
        let Ok(data) = fs::read_to_string(file) else { continue };
        let Ok(entries) = serde_json::from_str::<Vec<PackagesEntry>>(&data) else { continue };

        for entry in entries {
            if entry.name.to_lowercase() != name.to_lowercase() {
                continue;
            }
            if let Some(v) = version_hint {
                if entry.version != v {
                    continue;
                }
            }
            if let Some(url) = entry.toml_url {
                return Ok((url, entry.version));
            }
        }
    }

    Err(tsukiError::codegen(format!(
        "package '{}' not found in local registry cache — run `tsuki updatedb` to refresh",
        name
    )))
}

/// Install a package from a v3 spec string using the local DB cache.
pub fn install_from_spec(spec: &str, libs_dir: &Path) -> Result<String> {
    let (toml_url, version) = resolve_from_db(spec)?;
    eprintln!("tsuki: downloading {} from {} …", spec, toml_url);
    let toml_str = http_get(&toml_url)?;
    let _ = version; // version is embedded in the TOML itself
    pkg_loader::install_from_toml(libs_dir, &toml_str)
}

// ── v3 spec parser ────────────────────────────────────────────────────────────

/// Parse `"registry@name:version"` into its optional components.
///   "ws2812"                  → (None, "ws2812", None)
///   "ws2812:1.0.0"            → (None, "ws2812", Some("1.0.0"))
///   "tsuki-team@ws2812:1.0.0" → (Some("tsuki-team"), "ws2812", Some("1.0.0"))
fn parse_v3_spec(spec: &str) -> (Option<&str>, &str, Option<&str>) {
    let (registry, rest) = match spec.find('@') {
        Some(i) => (Some(&spec[..i]), &spec[i + 1..]),
        None    => (None, spec),
    };
    let (name, version) = match rest.rfind(':') {
        Some(i) => (&rest[..i], Some(&rest[i + 1..])),
        None    => (rest, None),
    };
    (registry, name, version)
}

// ── home dir helper (avoids the `dirs` crate) ─────────────────────────────────

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}