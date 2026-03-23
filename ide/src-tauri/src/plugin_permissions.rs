// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-ide :: plugin_permissions
//
//  Manages which permissions each installed plugin has been granted by the user.
//
//  Storage: ~/.config/tsuki-ide/plugin-permissions.json
//  Format:
//    {
//      "owner/name@version": {
//        "filesystem":  true,
//        "network":     false,
//        "shell":       false,
//        "ide:state":   true,
//        "ide:mutate":  true,
//        "__reviewed__": true
//      }
//    }
//
//  Permission capabilities
//  ────────────────────────
//  filesystem   — read_file, write_file, read_dir_entries, delete_file,
//                 rename_path, create_dir, check_path_exists, get_home_dir,
//                 load_settings, save_settings
//  network      — net_fetch (outgoing HTTP via Tauri backend)
//  shell        — spawn_process, run_shell, run_git, transpile_source,
//                 emit_sim_bundle, run_simulator, stop_simulator,
//                 get_tsuki_bin, get_tsuki_core_bin, get_tsuki_sim_bin,
//                 get_tmp_go_path
//  ide:state    — read openTabs, gitChanges, gitBranch, commitHistory, settings
//                 (enforced in TS by pluginLoader — state is never sent to Rust)
//  ide:mutate   — dispatch lsp:setProblems, lsp:addLog, git:commit,
//                 sandbox:setCircuit, sandbox:clearPending
//                 (enforced in TS by pluginLoader)
//
//  The Rust layer enforces `filesystem`, `network`, and `shell` at the
//  Tauri command level via check_plugin_permission().
//  The TypeScript layer enforces `ide:state` and `ide:mutate` in the SDK.
// ─────────────────────────────────────────────────────────────────────────────

use std::collections::HashMap;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

// ── Types ─────────────────────────────────────────────────────────────────────

/// All valid permission strings. Anything not in this list is rejected on save.
pub const VALID_PERMISSIONS: &[&str] = &[
    "filesystem",
    "network",
    "shell",
    "ide:state",
    "ide:mutate",
];

/// The permissions stored for a single plugin (user choices).
pub type PluginGrants = HashMap<String, bool>;

/// The full permissions file: plugin_id → grants.
type PermissionsFile = HashMap<String, PluginGrants>;

/// Returned to the frontend so it can render the consent dialog.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPermissionsInfo {
    /// Plugin unique ID: "owner/name@version"
    pub plugin_id: String,
    /// Permissions declared in tsuki.toml — what the plugin asks for.
    pub declared: Vec<String>,
    /// Permissions the user has explicitly granted (subset of declared).
    pub granted: HashMap<String, bool>,
    /// True if the user has reviewed this plugin's permissions at least once.
    pub reviewed: bool,
}

// ── Storage helpers ───────────────────────────────────────────────────────────

fn permissions_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path_resolver()
        .app_config_dir()
        .map(|d| d.join("plugin-permissions.json"))
}

fn load_permissions_file(app: &tauri::AppHandle) -> PermissionsFile {
    let path = match permissions_path(app) {
        Some(p) => p,
        None    => return HashMap::new(),
    };
    let content = match std::fs::read_to_string(&path) {
        Ok(c)  => c,
        Err(_) => return HashMap::new(),
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn save_permissions_file(app: &tauri::AppHandle, data: &PermissionsFile) -> Result<(), String> {
    let path = permissions_path(app)
        .ok_or_else(|| "Cannot resolve config dir".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Returns the permission status for a plugin — declared + what the user granted.
/// If the user has never reviewed this plugin, `reviewed` is false and the
/// frontend shows the consent dialog.
#[tauri::command]
pub fn get_plugin_permissions(
    app: tauri::AppHandle,
    plugin_id: String,
    declared: Vec<String>,
) -> PluginPermissionsInfo {
    let file    = load_permissions_file(&app);
    let stored  = file.get(&plugin_id).cloned().unwrap_or_default();
    let reviewed = stored.get("__reviewed__").copied().unwrap_or(false);

    // Only surface permissions that are both declared and valid.
    // Unknown / misspelled capabilities are silently filtered out.
    let granted: HashMap<String, bool> = declared
        .iter()
        .filter(|p| VALID_PERMISSIONS.contains(&p.as_str()))
        .map(|p| {
            let val = stored.get(p).copied().unwrap_or(false);
            (p.clone(), val)
        })
        .collect();

    PluginPermissionsInfo {
        plugin_id,
        declared: declared
            .into_iter()
            .filter(|p| VALID_PERMISSIONS.contains(&p.as_str()))
            .collect(),
        granted,
        reviewed,
    }
}

/// Saves the user's permission choices for a plugin.
/// Sets `__reviewed__` = true so the consent dialog doesn't re-appear.
#[tauri::command]
pub fn set_plugin_permissions(
    app: tauri::AppHandle,
    plugin_id: String,
    grants: HashMap<String, bool>,
) -> Result<(), String> {
    let mut file = load_permissions_file(&app);

    // Filter to only known capabilities — never persist unknown strings.
    let mut validated: PluginGrants = grants
        .into_iter()
        .filter(|(k, _)| VALID_PERMISSIONS.contains(&k.as_str()))
        .collect();

    validated.insert("__reviewed__".to_string(), true);
    file.insert(plugin_id, validated);
    save_permissions_file(&app, &file)
}

/// Checks whether a specific permission is granted for a plugin.
/// Called by Tauri command handlers for filesystem / network / shell gating.
#[tauri::command]
pub fn check_plugin_permission(
    app: tauri::AppHandle,
    plugin_id: String,
    permission: String,
) -> bool {
    if !VALID_PERMISSIONS.contains(&permission.as_str()) {
        return false;
    }
    let file = load_permissions_file(&app);
    file.get(&plugin_id)
        .and_then(|g| g.get(&permission))
        .copied()
        .unwrap_or(false)
}

/// Revokes all permissions for a plugin (called on uninstall).
#[tauri::command]
pub fn revoke_plugin_permissions(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<(), String> {
    let mut file = load_permissions_file(&app);
    file.remove(&plugin_id);
    save_permissions_file(&app, &file)
}

/// Returns all stored permission records (for the Settings → Plugins panel).
#[tauri::command]
pub fn list_all_plugin_permissions(
    app: tauri::AppHandle,
) -> HashMap<String, HashMap<String, bool>> {
    load_permissions_file(&app)
}

// ── Command → permission map ──────────────────────────────────────────────────
//
// Canonical source. Also mirrored in pluginLoader.ts (COMMAND_PERMISSION).
// Used by Tauri command handlers to call check_plugin_permission() before
// executing any privileged operation on behalf of a plugin.

pub fn command_requires_permission(cmd: &str) -> Option<&'static str> {
    match cmd {
        // filesystem
        "read_file"
        | "read_dir_entries"
        | "check_path_exists"
        | "get_home_dir"
        | "load_settings"
        | "write_file"
        | "delete_file"
        | "rename_path"
        | "create_dir"
        | "save_settings"        => Some("filesystem"),

        // network
        "net_fetch"              => Some("network"),

        // shell
        "run_shell"
        | "spawn_process"
        | "spawn_shell"
        | "emit_sim_bundle"
        | "run_simulator"
        | "stop_simulator"
        | "run_diagnostics"
        | "run_git"
        | "transpile_source"
        | "get_tsuki_bin"
        | "get_tsuki_core_bin"
        | "get_tsuki_sim_bin"
        | "get_tmp_go_path"      => Some("shell"),

        // ide:state and ide:mutate are enforced in TypeScript (pluginLoader.ts)
        // because state never flows through Rust commands.
        _                        => None,
    }
}