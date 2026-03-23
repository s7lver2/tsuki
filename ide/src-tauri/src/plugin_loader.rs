// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-ide :: plugin_loader  —  enumerate IDE plugins from ~/.tsuki/plugins/
//
//  Plugin directory layout:
//    ~/.tsuki/plugins/<owner>/<n>/<version>/
//      plugin/index.js        ← entry point (loaded in renderer)
//      plugin/styles.css      ← optional styles (injected into <head>)
//      tsuki.toml             ← package manifest (permissions, slots, etc.)
//
//  The Rust side only scans the filesystem and returns metadata.
//  All JS execution happens in the renderer (pluginLoader.ts).
// ─────────────────────────────────────────────────────────────────────────────

use std::path::PathBuf;
use serde::Serialize;

// ── Plugin manifest (returned to frontend) ────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdePlugin {
    /// Unique ID: "<owner>/<n>@<version>"
    pub id: String,
    pub owner: String,
    pub name: String,
    pub version: String,
    pub description: String,
    /// Absolute path to the plugin directory
    pub dir: String,
    /// Absolute path to plugin/index.js  (empty if not found)
    pub entry: String,
    /// Absolute path to plugin/styles.css (empty if not found)
    pub styles: String,
    /// Slot declarations from [ide-plugin] slots = [...]
    pub slots: Vec<String>,
    /// Permission declarations from [ide-plugin] permissions = [...]
    /// These are what the plugin *asks for* — not what the user has *granted*.
    pub declared_permissions: Vec<String>,
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

/// Returns all IDE plugins installed under ~/.tsuki/plugins/.
/// Called once at IDE startup and again after `tsuki install` finishes.
#[tauri::command]
pub fn list_ide_plugins() -> Vec<IdePlugin> {
    let plugins_dir = match tsuki_plugins_dir() {
        Some(d) => d,
        None    => return vec![],
    };

    if !plugins_dir.exists() {
        return vec![];
    }

    let mut result = Vec::new();

    for owner_entry in std::fs::read_dir(&plugins_dir).into_iter().flatten().flatten() {
        let owner_path = owner_entry.path();
        if !owner_path.is_dir() { continue; }
        let owner = owner_entry.file_name().to_string_lossy().to_string();

        for name_entry in std::fs::read_dir(&owner_path).into_iter().flatten().flatten() {
            let name_path = name_entry.path();
            if !name_path.is_dir() { continue; }
            let name = name_entry.file_name().to_string_lossy().to_string();

            for ver_entry in std::fs::read_dir(&name_path).into_iter().flatten().flatten() {
                let ver_path = ver_entry.path();
                if !ver_path.is_dir() { continue; }
                let version = ver_entry.file_name().to_string_lossy().to_string();

                result.push(scan_plugin_dir(&owner, &name, &version, &ver_path));
            }
        }
    }

    result
}

/// Returns the raw JS source of a plugin's entry point.
#[tauri::command]
pub fn read_plugin_entry(entry_path: String) -> Result<String, String> {
    std::fs::read_to_string(&entry_path)
        .map_err(|e| format!("cannot read plugin entry {}: {}", entry_path, e))
}

/// Returns the raw CSS of a plugin's stylesheet.
#[tauri::command]
pub fn read_plugin_styles(styles_path: String) -> Result<String, String> {
    std::fs::read_to_string(&styles_path)
        .map_err(|e| format!("cannot read plugin styles {}: {}", styles_path, e))
}

// ── Internals ─────────────────────────────────────────────────────────────────

fn scan_plugin_dir(owner: &str, name: &str, version: &str, dir: &PathBuf) -> IdePlugin {
    let entry  = dir.join("plugin").join("index.js");
    let styles = dir.join("plugin").join("styles.css");
    let manifest_path = dir.join("tsuki.toml");

    let description          = read_toml_field(&manifest_path, "description").unwrap_or_default();
    let slots                = read_toml_array(&manifest_path, "slots");
    let declared_permissions = read_toml_array(&manifest_path, "permissions");

    IdePlugin {
        id:          format!("{}/{}@{}", owner, name, version),
        owner:       owner.to_string(),
        name:        name.to_string(),
        version:     version.to_string(),
        description,
        dir:         dir.to_string_lossy().to_string(),
        entry:       if entry.exists()  { entry.to_string_lossy().to_string()  } else { String::new() },
        styles:      if styles.exists() { styles.to_string_lossy().to_string() } else { String::new() },
        slots,
        declared_permissions,
    }
}

/// Reads the first line matching `key = "value"` in a TOML file.
fn read_toml_field(path: &PathBuf, key: &str) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix(key) {
            let rest = rest.trim();
            if let Some(rest) = rest.strip_prefix('=') {
                let val = rest.trim().trim_matches('"');
                return Some(val.to_string());
            }
        }
    }
    None
}

/// Reads an inline array `key = ["a", "b"]` from the [ide-plugin] section.
fn read_toml_array(path: &PathBuf, key: &str) -> Vec<String> {
    let content = match std::fs::read_to_string(path) {
        Ok(c)  => c,
        Err(_) => return vec![],
    };

    let mut in_plugin_section = false;

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed == "[ide-plugin]" {
            in_plugin_section = true;
            continue;
        }
        if trimmed.starts_with('[') {
            in_plugin_section = false;
        }

        if !in_plugin_section { continue; }

        if let Some(rest) = trimmed.strip_prefix(key) {
            let rest = rest.trim();
            if let Some(rest) = rest.strip_prefix('=') {
                if let Some(arr_start) = rest.find('[') {
                    if let Some(arr_end) = rest.find(']') {
                        let inner = &rest[arr_start + 1..arr_end];
                        return inner
                            .split(',')
                            .map(|s| s.trim().trim_matches('"').to_string())
                            .filter(|s| !s.is_empty())
                            .collect();
                    }
                }
            }
        }
    }

    vec![]
}

fn tsuki_plugins_dir() -> Option<PathBuf> {
    if let Ok(data_dir) = std::env::var("TSUKI_DATA_DIR") {
        return Some(PathBuf::from(data_dir).join("plugins"));
    }
    tauri::api::path::home_dir().map(|h| h.join(".tsuki").join("plugins"))
}