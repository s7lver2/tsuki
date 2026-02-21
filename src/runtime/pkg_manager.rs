// ─────────────────────────────────────────────────────────────────────────────
//  godotino :: runtime :: pkg_manager
//
//  Package manager: reads a JSON registry from a URL (your GitHub repo) and
//  downloads / installs godotinolib packages from the URLs listed there.
//
//  Registry JSON format (hosted at REGISTRY_URL):
//
//  {
//    "packages": {
//      "ws2812": {
//        "description": "WS2812 NeoPixel driver",
//        "author":      "godotino-team",
//        "latest":      "1.1.0",
//        "versions": {
//          "1.0.0": "https://raw.githubusercontent.com/.../ws2812/1.0.0/godotinolib.toml",
//          "1.1.0": "https://raw.githubusercontent.com/.../ws2812/1.1.0/godotinolib.toml"
//        }
//      },
//      "dht": { ... }
//    }
//  }
//
//  CLI commands wired here (via main.rs):
//    godotino pkg list               — list all available packages in the registry
//    godotino pkg search <query>     — search registry by name/description
//    godotino pkg install <name>     — install latest version
//    godotino pkg install <name>@<v> — install specific version
//    godotino pkg remove  <name>     — remove installed package
//    godotino pkg update             — update all installed packages to latest
//    godotino pkg installed          — list locally installed packages
// ─────────────────────────────────────────────────────────────────────────────

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::fs;

use serde::{Deserialize, Serialize};

use crate::error::{GodotinoError, Result};
use super::pkg_loader;

// Re-export for use by the binary crate
pub use super::pkg_loader::default_libs_dir;

// ── Registry URL ──────────────────────────────────────────────────────────────

/// Default registry URL. Override with the GODOTINO_REGISTRY env var or
/// the --registry flag so users can point at their own fork / mirror.
pub const DEFAULT_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/s7lver/godotino-pkgs/main/registry.json";

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
        GodotinoError::codegen(format!("failed to parse registry JSON from {}: {}", url, e))
    })?;
    Ok(reg)
}

/// Download text from a URL using ureq (blocking / sync).
fn http_get(url: &str) -> Result<String> {
    ureq::get(url)
        .call()
        .map_err(|e| GodotinoError::codegen(format!("HTTP GET {} failed: {}", url, e)))?
        .into_string()
        .map_err(|e| GodotinoError::codegen(format!("failed to read response body from {}: {}", url, e)))
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
        GodotinoError::codegen(format!(
            "package '{}' not found in registry — run `godotino pkg list` to see available packages",
            name
        ))
    })?;

    let version = version_hint.unwrap_or_else(|| entry.latest.as_str());

    let toml_url = entry.versions.get(version).ok_or_else(|| {
        let available: Vec<&str> = entry.versions.keys().map(|s| s.as_str()).collect();
        GodotinoError::codegen(format!(
            "version '{}' not found for package '{}'. Available: {}",
            version, name, available.join(", ")
        ))
    })?;

    eprintln!("godotino: downloading {}@{} from {} …", name, version, toml_url);
    let toml_str = http_get(toml_url)?;

    let msg = pkg_loader::install_from_toml(libs_dir, &toml_str)?;
    Ok(msg)
}

/// Remove an installed package (all versions, or a specific one).
pub fn remove(name_ver: &str, libs_dir: &Path) -> Result<String> {
    let (name, version_hint) = parse_name_version(name_ver);
    let pkg_dir = libs_dir.join(name);

    if !pkg_dir.exists() {
        return Err(GodotinoError::codegen(format!(
            "package '{}' is not installed (looked in {})",
            name, pkg_dir.display()
        )));
    }

    match version_hint {
        Some(ver) => {
            let ver_dir = pkg_dir.join(ver);
            if !ver_dir.exists() {
                return Err(GodotinoError::codegen(format!(
                    "{}@{} is not installed", name, ver
                )));
            }
            fs::remove_dir_all(&ver_dir).map_err(|e| {
                GodotinoError::codegen(format!("failed to remove {}: {}", ver_dir.display(), e))
            })?;
            // If no more versions, remove the package dir too
            if fs::read_dir(&pkg_dir).map(|mut d| d.next().is_none()).unwrap_or(false) {
                let _ = fs::remove_dir(&pkg_dir);
            }
            Ok(format!("removed {}@{}", name, ver))
        }
        None => {
            fs::remove_dir_all(&pkg_dir).map_err(|e| {
                GodotinoError::codegen(format!("failed to remove {}: {}", pkg_dir.display(), e))
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
