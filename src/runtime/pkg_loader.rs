// ─────────────────────────────────────────────────────────────────────────────
//  godotino :: runtime :: pkg_loader
//
//  Loads external library packages from `godotinolib.toml` files on disk.
//  These files live inside each downloaded library directory and describe
//  the Go→C++ mapping for that library.
//
//  Directory layout (installed at ~/.local/share/godotino/libs/<name>/<ver>/):
//
//      ws2812/
//      └── 1.0.0/
//          ├── godotinolib.toml   ← mapping descriptor (this format)
//          └── src/
//              └── ws2812.h       ← vendored C++ header (optional)
//
//  godotinolib.toml format:
//
//      [package]
//      name        = "ws2812"
//      version     = "1.0.0"
//      description = "WS2812 NeoPixel driver"
//      author      = "godotino-team"
//      cpp_header  = "Adafruit_NeoPixel.h"   # injected as #include
//      arduino_lib = "Adafruit NeoPixel"      # installed via arduino-cli
//
//      [[function]]
//      go  = "New"
//      cpp = "Adafruit_NeoPixel({0}, {1}, NEO_GRB + NEO_KHZ800)"
//
//      [[function]]
//      go  = "Begin"
//      cpp = "{0}.begin()"
//
//      [[constant]]
//      go  = "NEO_GRB"
//      cpp = "NEO_GRB"
//
//      [[constant]]
//      go  = "NEO_KHZ800"
//      cpp = "NEO_KHZ800"
// ─────────────────────────────────────────────────────────────────────────────

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::fs;

use serde::{Deserialize, Serialize};

use crate::error::{GodotinoError, Result};
use crate::runtime::{FnMap, PkgMap};

// ── TOML schema ───────────────────────────────────────────────────────────────

/// Root of a `godotinolib.toml` file.
#[derive(Debug, Deserialize, Serialize)]
pub struct LibManifest {
    pub package:  LibPackage,
    #[serde(default, rename = "function")]
    pub functions: Vec<LibFunction>,
    #[serde(default, rename = "constant")]
    pub constants: Vec<LibConstant>,
    #[serde(default, rename = "type")]
    pub types:    Vec<LibType>,
    /// Extra aliases — the same lib registered under multiple Go import paths.
    /// e.g. aliases = ["NeoPixel", "neopixel"]
    #[serde(default)]
    pub aliases:  Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct LibPackage {
    pub name:        String,
    pub version:     String,
    pub description: Option<String>,
    pub author:      Option<String>,
    /// The C++ `#include` header to inject (e.g. `"Adafruit_NeoPixel.h"`).
    pub cpp_header:  Option<String>,
    /// The exact arduino-cli library name to install (e.g. `"Adafruit NeoPixel"`).
    pub arduino_lib: Option<String>,
    /// Min godotino-core version required (semver, optional).
    pub requires_core: Option<String>,
    /// C++ class name for global variable declarations (emitted as pointer).
    pub cpp_class: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct LibFunction {
    /// Go function name as it appears in the import (e.g. `"Begin"`)
    pub go:  String,
    /// C++ template. `{0}` = first arg, `{1}` = second arg, `{self}` = receiver.
    pub cpp: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct LibConstant {
    pub go:  String,
    pub cpp: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct LibType {
    pub go:  String,
    pub cpp: String,
}

// ── Loader ────────────────────────────────────────────────────────────────────

/// Result of loading one library.
pub struct LoadedLib {
    pub name:        String,
    pub version:     String,
    pub arduino_lib: Option<String>,
    pub pkg_map:     PkgMap,
    /// Extra Go import aliases that resolve to the same PkgMap.
    pub aliases:     Vec<String>,
}

/// Load a library from a `godotinolib.toml` file.
pub fn load_from_file(path: &Path) -> Result<LoadedLib> {
    let raw = fs::read_to_string(path).map_err(|e| {
        GodotinoError::codegen(format!("cannot read {}: {}", path.display(), e))
    })?;
    load_from_str(&raw, path)
}

/// Parse a library from a TOML string (path is used only for error messages).
pub fn load_from_str(toml_str: &str, path: &Path) -> Result<LoadedLib> {
    let manifest: LibManifest = toml::from_str(toml_str).map_err(|e| {
        GodotinoError::codegen(format!(
            "malformed godotinolib.toml at {}: {}",
            path.display(), e
        ))
    })?;

    let mut pkg = PkgMap::new(manifest.package.cpp_header.as_deref());
    if let Some(ref class) = manifest.package.cpp_class {
        pkg = pkg.with_class(class);
    }

    for f in &manifest.functions {
        pkg = pkg.fun(&f.go, FnMap::Template(f.cpp.clone()));
    }
    for c in &manifest.constants {
        pkg = pkg.cst(&c.go, &c.cpp);
    }

    Ok(LoadedLib {
        name:        manifest.package.name.clone(),
        version:     manifest.package.version.clone(),
        arduino_lib: manifest.package.arduino_lib.clone(),
        pkg_map:     pkg,
        aliases:     manifest.aliases.clone(),
    })
}

// ── Library search path ───────────────────────────────────────────────────────

/// Returns the default library search root.
///   Linux/macOS: ~/.local/share/godotino/libs
///   Windows:     %APPDATA%\godotino\libs
pub fn default_libs_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
        PathBuf::from(base).join("godotino").join("libs")
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        PathBuf::from(home).join(".local").join("share").join("godotino").join("libs")
    }
}

/// Scan a libs directory and return the path to `godotinolib.toml` for each
/// installed library at its highest installed version.
///
/// Expected structure:
/// ```text
/// libs_dir/
///   ws2812/
///     1.0.0/
///       godotinolib.toml
///     1.1.0/
///       godotinolib.toml   ← selected (highest semver)
///   dht/
///     0.9.2/
///       godotinolib.toml
/// ```
pub fn scan_libs_dir(libs_dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let Ok(entries) = fs::read_dir(libs_dir) else { return found };

    for lib_entry in entries.flatten() {
        if !lib_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        // each subdirectory is a version
        let lib_path = lib_entry.path();
        let Ok(versions) = fs::read_dir(&lib_path) else { continue };

        let mut ver_dirs: Vec<PathBuf> = versions
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .map(|e| e.path())
            .collect();

        // Sort by directory name (semver strings sort correctly for simple cases)
        ver_dirs.sort();

        if let Some(latest) = ver_dirs.last() {
            let manifest = latest.join("godotinolib.toml");
            if manifest.exists() {
                found.push(manifest);
            }
        }
    }
    found
}

/// Load all libraries found under `libs_dir`.
pub fn load_all(libs_dir: &Path) -> Vec<LoadedLib> {
    scan_libs_dir(libs_dir)
        .into_iter()
        .filter_map(|p| {
            load_from_file(&p)
                .map_err(|e| eprintln!("godotino: warning: skipping {}: {}", p.display(), e))
                .ok()
        })
        .collect()
}

// ── Install helper (called by Go CLI via shell-out) ───────────────────────────

/// Download and install a library from a URL or registry slug.
/// The Go CLI calls `godotino-core pkg install <name> <version> <url>` which
/// routes here. We just write the TOML to the right path; the CLI handles
/// HTTP fetching so this stays sync + no async runtime needed.
pub fn install_from_toml(libs_dir: &Path, toml_str: &str) -> Result<String> {
    let manifest: LibManifest = toml::from_str(toml_str).map_err(|e| {
        GodotinoError::codegen(format!("invalid godotinolib.toml: {}", e))
    })?;

    let pkg_name = &manifest.package.name;
    let version  = &manifest.package.version;
    let dest_dir = libs_dir.join(pkg_name).join(version);

    fs::create_dir_all(&dest_dir).map_err(|e| {
        GodotinoError::codegen(format!("cannot create {}: {}", dest_dir.display(), e))
    })?;

    let dest_file = dest_dir.join("godotinolib.toml");
    fs::write(&dest_file, toml_str).map_err(|e| {
        GodotinoError::codegen(format!("cannot write {}: {}", dest_file.display(), e))
    })?;

    Ok(format!("installed {}@{} → {}", pkg_name, version, dest_dir.display()))
}