// Prevents additional console window on Windows in release mode
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod simulator;
mod win_proc;
mod pty_session;

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tauri::Window;
use win_proc::WinSpawn;

// ── Debug logger ──────────────────────────────────────────────────────────────
// windows_subsystem="windows" suppresses stderr entirely, so we log to a file
// in %TEMP% (or /tmp) that can be tailed while the app is running.
fn dbg(msg: &str) {
    #[cfg(windows)]
    let path = {
        let tmp = std::env::var("TEMP").unwrap_or_else(|_| "C:\\Temp".into());
        format!("{}\\tsuki-ide-debug.log", tmp)
    };
    #[cfg(not(windows))]
    let path = "/tmp/tsuki-ide-debug.log".to_string();

    // Include a timestamp so entries are easy to correlate
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let line = format!("[{}] {}", ts, msg);

    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{}", line);
    }
    eprintln!("{}", line);
}

// On Windows, .no_window() uses DETACHED_PROCESS instead of CREATE_NO_WINDOW.
// DETACHED_PROCESS allows Stdio::piped() to work correctly (no console flash,
// no broken pipe issues). win_proc::WinSpawn is used for the main spawn calls;
// this trait remains for simple fire-and-forget commands (git, taskkill, etc.)
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x0000_0008;

trait NoWindow {
    fn no_window(self) -> Self;
}
impl NoWindow for Command {
    #[cfg(windows)]
    fn no_window(mut self) -> Self { self.creation_flags(DETACHED_PROCESS); self }
    #[cfg(not(windows))]
    fn no_window(self) -> Self { self }
}

type ProcessMap = Arc<Mutex<HashMap<u32, std::process::ChildStdin>>>;

struct AppState {
    processes: ProcessMap,
}

// ── Shell info ────────────────────────────────────────────────────────────────
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct ShellInfo {
    id:   String,
    name: String,
    path: String,
    icon: String,
}

fn which_first(names: &[&str]) -> Option<String> {
    for name in names {
        if let Ok(path) = which::which(name) {
            return Some(path.to_string_lossy().into_owned());
        }
    }
    None
}

#[tauri::command]
async fn list_shells() -> Vec<ShellInfo> {
    let mut shells: Vec<ShellInfo> = Vec::new();

    #[cfg(windows)]
    {
        // CMD — always present on Windows, use absolute path so portable-pty finds it
        let cmd_path = std::env::var("COMSPEC")
            .unwrap_or_else(|_| r"C:\Windows\System32\cmd.exe".into());
        shells.push(ShellInfo {
            id:   "cmd".into(),
            name: "Command Prompt".into(),
            path: cmd_path,
            icon: "⬛".into(),
        });

        // PowerShell 5.x
        let ps5 = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";
        if std::path::Path::new(ps5).exists() {
            shells.push(ShellInfo {
                id:   "powershell".into(),
                name: "PowerShell".into(),
                path: ps5.into(),
                icon: "🔵".into(),
            });
        } else if let Some(p) = which_first(&["powershell"]) {
            shells.push(ShellInfo {
                id:   "powershell".into(),
                name: "PowerShell".into(),
                path: p,
                icon: "🔵".into(),
            });
        }

        // PowerShell Core
        if let Some(p) = which_first(&["pwsh"]) {
            shells.push(ShellInfo {
                id:   "pwsh".into(),
                name: "PowerShell Core".into(),
                path: p,
                icon: "💜".into(),
            });
        }

        // Git Bash — common installation paths
        let git_bash_paths = [
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files\Git\usr\bin\bash.exe",
            r"C:\Program Files (x86)\Git\bin\bash.exe",
        ];
        let mut found = false;
        for gp in &git_bash_paths {
            if std::path::Path::new(gp).exists() {
                shells.push(ShellInfo {
                    id:   "git-bash".into(),
                    name: "Git Bash".into(),
                    path: gp.to_string(),
                    icon: "🟠".into(),
                });
                found = true;
                break;
            }
        }
        if !found {
            if let Some(p) = which_first(&["bash"]) {
                shells.push(ShellInfo {
                    id:   "git-bash".into(),
                    name: "Git Bash".into(),
                    path: p,
                    icon: "🟠".into(),
                });
            }
        }
    }

    #[cfg(not(windows))]
    {
        if let Some(p) = which_first(&["bash"]) {
            shells.push(ShellInfo { id: "bash".into(), name: "Bash".into(), path: p, icon: "🟢".into() });
        }
        if let Some(p) = which_first(&["zsh"]) {
            shells.push(ShellInfo { id: "zsh".into(), name: "Zsh".into(), path: p, icon: "🟣".into() });
        }
        if let Some(p) = which_first(&["fish"]) {
            shells.push(ShellInfo { id: "fish".into(), name: "Fish".into(), path: p, icon: "🐟".into() });
        }
        if std::path::Path::new("/bin/sh").exists() {
            shells.push(ShellInfo { id: "sh".into(), name: "sh".into(), path: "/bin/sh".into(), icon: "⬜".into() });
        }
    }

    shells
}

// ── spawn_shell ───────────────────────────────────────────────────────────────
#[tauri::command]
async fn spawn_shell(
    window:     Window,
    state:      tauri::State<'_, AppState>,
    shell_id:   String,
    shell_path: String,
    cwd:        Option<String>,
    event_id:   String,
) -> Result<u32, String> {
    let shell_path = normalise_cmd(&shell_path);
    // --login on bash/git-bash sources .bash_profile which can open GUIs.
    // Use only -i (interactive) to avoid that.
    let args: Vec<&str> = match shell_id.as_str() {
        "bash" | "git-bash" => vec!["-i"],
        "zsh"               => vec!["-i"],
        "fish"              => vec!["--interactive"],
        "cmd"               => vec![],
        "powershell"        => vec!["-NoLogo", "-NoExit", "-NoProfile"],
        "pwsh"              => vec!["-NoLogo", "-NoExit", "-NoProfile"],
        "sh"                => vec!["-i"],
        _                   => vec![],
    };

    let mut c = Command::new(&shell_path).no_window();
    c.args(&args)
     .stdin(Stdio::piped())
     .stdout(Stdio::piped())
     .stderr(Stdio::piped());

    #[cfg(windows)]
    { c.env("PATH", enriched_path()); }
    #[cfg(not(windows))]
    c.env("TERM", "dumb").env("COLORTERM", "");

    if let Some(dir) = &cwd { c.current_dir(dir); }

    let mut child = c.win_spawn()
        .map_err(|e| format!("Failed to spawn shell '{}': {}", shell_path, e))?;

    let pid   = child.id();
    let stdin  = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    { state.processes.lock().unwrap().insert(pid, stdin); }

    let (eid_out, eid_err, eid_done) = (event_id.clone(), event_id.clone(), event_id.clone());
    let (win_out, win_err, win_done) = (window.clone(), window.clone(), window.clone());

    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().flatten() {
            let _ = win_out.emit(&format!("proc://{}:stdout", eid_out), line);
        }
    });
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            let _ = win_err.emit(&format!("proc://{}:stderr", eid_err), line);
        }
    });

    let processes = Arc::clone(&state.processes);
    std::thread::spawn(move || {
        let code = child.wait().map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
        processes.lock().unwrap().remove(&pid);
        let _ = win_done.emit(&format!("proc://{}:done", eid_done), code);
    });

    Ok(pid)
}

// ── enriched_path (Windows only) ─────────────────────────────────────────────
// Returns the current PATH plus common per-user install directories so that
// tools like tsuki, Go, arduino-cli, etc. are always found even when Tauri is
// launched from a context with a limited PATH (e.g. the Windows Start menu).
#[cfg(windows)]
fn enriched_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let user = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let extra = [
        // tsuki default install location
        format!(r"{}\Programs\tsuki\bin", user),
        // Go default install
        r"C:\Program Files\Go\bin".to_string(),
        format!(r"{}\go\bin", home),
        // arduino-cli common locations
        format!(r"{}\Programs\arduino-cli", user),
        r"C:\Program Files\arduino-cli".to_string(),
        // Git bin (for git.exe)
        r"C:\Program Files\Git\bin".to_string(),
        r"C:\Program Files\Git\cmd".to_string(),
    ];
    let mut parts: Vec<String> = current.split(';').map(|s| s.to_string()).collect();
    for e in &extra {
        if !e.is_empty() && !parts.iter().any(|p| p.eq_ignore_ascii_case(e)) {
            parts.push(e.clone());
        }
    }
    parts.join(";")
}

// ── run_shell ─────────────────────────────────────────────────────────────────
#[tauri::command]
async fn run_shell(cmd: String, args: Vec<String>, cwd: Option<String>) -> Result<String, String> {
    let cmd = resolve_cmd(&normalise_cmd(&cmd));

    // Spawn the executable directly with an enriched PATH so per-user
    // installs (tsuki, Go, arduino-cli, etc.) are found on Windows too.
    // CREATE_NO_WINDOW + Stdio::piped() guarantees no console window appears.
    let mut c = Command::new(&cmd).no_window();
    c.args(&args);
    #[cfg(windows)]
    { c.env("PATH", enriched_path()); }
    if let Some(dir) = &cwd { c.current_dir(dir); }
    let output = c.output().map_err(|e| format!("Failed to run '{}': {}", cmd, e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if output.status.success() {
        Ok(if stdout.trim().is_empty() { stderr } else { stdout })
    } else {
        Err(if stderr.trim().is_empty() { stdout } else { stderr })
    }
}

// ── Normalise a command path coming from the frontend ────────────────────────
// Strips surrounding double-quotes that can appear when paths are auto-detected
// with `where.exe` or pasted from Windows Explorer, and replaces forward
// slashes with backslashes on Windows so CreateProcessW resolves them cleanly.
fn normalise_cmd(raw: &str) -> String {
    let s = raw.trim().trim_matches('"').trim().to_string();
    #[cfg(windows)]
    let result = s.replace('/', "\\");
    #[cfg(not(windows))]
    let result = s;
    dbg(&format!("[normalise_cmd] {:?} -> {:?}", raw, result));
    result
}

// ── resolve_cmd ───────────────────────────────────────────────────────────────
// Resolves a command name or path to a fully qualified executable path using
// the `which` crate — cross-platform, handles .exe/.cmd/.bat on Windows,
// respects PATH including our enriched version with per-user install dirs.
fn resolve_cmd(raw: &str) -> String {
    let s = raw.trim().trim_matches('"').trim();
    dbg(&format!("[resolve_cmd] input = {:?}", s));

    // Already an absolute path — normalise slashes and return
    let is_absolute = s.starts_with('\\')
        || s.starts_with('/')
        || (s.len() > 2 && s.chars().nth(1) == Some(':'));

    if is_absolute {
        #[cfg(windows)]
        let result = s.replace('/', "\\");
        #[cfg(not(windows))]
        let result = s.to_string();
        dbg(&format!("[resolve_cmd] absolute -> {:?}", result));
        return result;
    }

    // Bare name — use which crate with enriched PATH on Windows
    #[cfg(windows)]
    {
        // which respects the PATH env var; temporarily extend it so
        // per-user install locations (tsuki, Go, arduino-cli) are found.
        let orig = std::env::var("PATH").unwrap_or_default();
        std::env::set_var("PATH", enriched_path());
        let result = which::which(s)
            .map(|p: std::path::PathBuf| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| s.to_string());
        std::env::set_var("PATH", orig);
        dbg(&format!("[resolve_cmd] which -> {:?}", result));
        result
    }
    #[cfg(not(windows))]
    {
        let result = which::which(s)
            .map(|p: std::path::PathBuf| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| s.to_string());
        dbg(&format!("[resolve_cmd] which -> {:?}", result));
        result
    }
}


#[tauri::command]
async fn spawn_process(
    window:   Window,
    state:    tauri::State<'_, AppState>,
    cmd:      String,
    args:     Vec<String>,
    cwd:      Option<String>,
    event_id: String,
) -> Result<u32, String> {
    let cmd = resolve_cmd(&normalise_cmd(&cmd));

    // ── DEBUG ────────────────────────────────────────────────────────────────
    dbg(&format!("[spawn_process] cmd   = {:?}", cmd));
    dbg(&format!("[spawn_process] args  = {:?}", args));
    dbg(&format!("[spawn_process] cwd   = {:?}", cwd));
    dbg(&format!("[spawn_process] exists= {}", std::path::Path::new(&cmd).exists()));
    #[cfg(windows)]
    dbg(&format!("[spawn_process] PATH  = {}", enriched_path()));
    // ─────────────────────────────────────────────────────────────────────────

    // Uses win_spawn() (DETACHED_PROCESS on Windows) which correctly supports
    // Stdio::piped() without console flash or broken pipe issues.
    let mut c = Command::new(&cmd);
    c.args(&args)
     .stdin(Stdio::piped())
     .stdout(Stdio::piped())
     .stderr(Stdio::piped());
    #[cfg(windows)]
    { c.env("PATH", enriched_path()); }
    if let Some(dir) = &cwd { c.current_dir(dir); }

    let mut child = c.win_spawn().map_err(|e| {
        let exists = std::path::Path::new(&cmd).exists();
        let kind   = e.kind();
        format!(
            "spawn failed for {:?}: {} (os_error={:?}, file_exists={})",
            cmd, e, kind, exists
        )
    })?;

    let pid    = child.id();
    let stdin  = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    { state.processes.lock().unwrap().insert(pid, stdin); }

    let (eid_out, eid_err, eid_done) = (event_id.clone(), event_id.clone(), event_id.clone());
    let (win_out, win_err, win_done) = (window.clone(), window.clone(), window.clone());

    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().flatten() {
            let _ = win_out.emit(&format!("proc://{}:stdout", eid_out), line);
        }
    });
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            let _ = win_err.emit(&format!("proc://{}:stderr", eid_err), line);
        }
    });

    let processes = Arc::clone(&state.processes);
    std::thread::spawn(move || {
        let code = child.wait().map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
        processes.lock().unwrap().remove(&pid);
        let _ = win_done.emit(&format!("proc://{}:done", eid_done), code);
    });

    Ok(pid)
}

// ── write_stdin ───────────────────────────────────────────────────────────────
#[tauri::command]
async fn write_stdin(state: tauri::State<'_, AppState>, pid: u32, data: String) -> Result<(), String> {
    let mut map = state.processes.lock().unwrap();
    if let Some(stdin) = map.get_mut(&pid) {
        let line = if data.ends_with('\n') { data } else { format!("{}\n", data) };
        stdin.write_all(line.as_bytes()).map_err(|e| format!("Write failed: {}", e))?;
        stdin.flush().map_err(|e| format!("Flush failed: {}", e))?;
        Ok(())
    } else {
        Err(format!("No process with PID {}", pid))
    }
}

// ── kill_process ──────────────────────────────────────────────────────────────
#[tauri::command]
async fn kill_process(pid: u32) -> Result<(), String> {
    #[cfg(unix)]
    unsafe { libc::kill(pid as i32, libc::SIGTERM); }
    #[cfg(windows)]
    { Command::new("taskkill").no_window().args(["/PID", &pid.to_string(), "/F"]).output().ok(); }
    Ok(())
}

// ── detect_tool ───────────────────────────────────────────────────────────────
#[tauri::command]
async fn detect_tool(name: String) -> Result<String, String> {
    let name = normalise_cmd(&name);

    // Absolute path — just validate it exists
    let is_absolute = name.starts_with('/')
        || name.starts_with('\\')
        || (name.len() > 2 && name.chars().nth(1) == Some(':'));

    if is_absolute {
        if !std::path::Path::new(&name).exists() {
            return Err(format!("File not found on disk: {}", name));
        }
        return Ok(name);
    }

    // Bare name — use which crate with enriched PATH on Windows
    #[cfg(windows)]
    {
        let orig = std::env::var("PATH").unwrap_or_default();
        std::env::set_var("PATH", enriched_path());
        let result = which::which(&name)
            .map(|p: std::path::PathBuf| p.to_string_lossy().into_owned())
            .map_err(|_| format!("'{}' not found in PATH", name));
        std::env::set_var("PATH", orig);
        result
    }
    #[cfg(not(windows))]
    {
        which::which(&name)
            .map(|p: std::path::PathBuf| p.to_string_lossy().into_owned())
            .map_err(|_| format!("'{}' not found in PATH", name))
    }
}

// ── pick_file: open a file-picker dialog for executables ─────────────────────
#[tauri::command]
async fn pick_file(window: Window) -> Option<String> {
    use tauri::api::dialog::blocking::FileDialogBuilder;
    let mut builder = FileDialogBuilder::new()
        .set_parent(&window)
        .set_title("Select executable");

    #[cfg(windows)]
    { builder = builder.add_filter("Executable", &["exe", "cmd", "bat"]); }
    #[cfg(not(windows))]
    { builder = builder.add_filter("All files", &["*"]); }

    builder.pick_file().map(|p| p.to_string_lossy().to_string())
}

// ── pick_folder ───────────────────────────────────────────────────────────────
#[tauri::command]
async fn pick_folder(window: Window) -> Option<String> {
    tauri::api::dialog::blocking::FileDialogBuilder::new()
        .set_parent(&window)
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

// ── fs commands ───────────────────────────────────────────────────────────────
#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Read error: {}", e))
}
#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String> {
    if let Some(p) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(p).map_err(|e| format!("mkdir: {}", e))?;
    }
    std::fs::write(&path, content).map_err(|e| format!("Write error: {}", e))
}
#[tauri::command]
async fn load_settings(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path_resolver().app_config_dir().ok_or("Cannot resolve config dir")?;
    let p = dir.join("settings.json");
    if p.exists() { std::fs::read_to_string(&p).map_err(|e| e.to_string()) }
    else { Ok("{}".into()) }
}
#[tauri::command]
async fn save_settings(app: tauri::AppHandle, settings: String) -> Result<(), String> {
    let dir = app.path_resolver().app_config_dir().ok_or("Cannot resolve config dir")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("settings.json"), settings).map_err(|e| e.to_string())
}
#[tauri::command]
async fn read_dir_entries(path: String) -> Result<String, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut list: Vec<serde_json::Value> = Vec::new();
    for entry in entries.flatten() {
        let meta = entry.metadata().ok();
        list.push(serde_json::json!({
            "name": entry.file_name().to_string_lossy(),
            "is_dir": meta.map(|m| m.is_dir()).unwrap_or(false),
        }));
    }
    Ok(serde_json::to_string(&list).unwrap())
}
#[tauri::command]
async fn delete_file(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.is_dir() { std::fs::remove_dir_all(&path).map_err(|e| format!("Delete dir: {}", e)) }
    else          { std::fs::remove_file(&path).map_err(|e| format!("Delete file: {}", e)) }
}
#[tauri::command]
async fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    std::fs::rename(&old_path, &new_path).map_err(|e| format!("Rename error: {}", e))
}
#[tauri::command]
async fn create_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("Create dir error: {}", e))
}
#[tauri::command]
async fn run_git(args: Vec<String>, cwd: String) -> Result<String, String> {
    let mut c = Command::new("git").no_window();
    c.args(&args).current_dir(&cwd);
    let output = c.output().map_err(|e| format!("git not found: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if output.status.success() { Ok(stdout) }
    else { Err(if stderr.trim().is_empty() { stdout } else { stderr }) }
}

// ── Simulator helpers ─────────────────────────────────────────────────────────

/// Returns a stable temp-file path for the Go source being simulated.
#[tauri::command]
async fn get_tmp_go_path() -> String {
    #[cfg(windows)]
    let dir = std::env::var("TEMP").unwrap_or_else(|_| "C:\\Temp".into());
    #[cfg(not(windows))]
    let dir = "/tmp".to_string();
    format!("{}/tsuki_sim_src.go", dir)
}

/// Reads tsukiPath from settings.json, falls back to "tsuki".
#[tauri::command]
async fn get_tsuki_bin(app: tauri::AppHandle) -> String {
    read_setting_or(&app, "tsukiPath", "tsuki")
}

/// Returns the configured tsuki-core binary path.
/// Looks for settings.tsukiCorePath first, then same dir as tsukiPath, then falls back to "tsuki-core".
#[tauri::command]
async fn get_tsuki_core_bin(app: tauri::AppHandle) -> String {
    // 1. Explicit setting for core binary
    let explicit = read_setting_or(&app, "tsukiCorePath", "");
    if !explicit.is_empty() && explicit != "tsuki-core" {
        return explicit;
    }
    // 2. Same directory as configured tsuki binary
    let tsuki_path = read_setting_or(&app, "tsukiPath", "");
    if !tsuki_path.is_empty() {
        let p = std::path::Path::new(&tsuki_path);
        if let Some(dir) = p.parent() {
            let ext = if cfg!(windows) { ".exe" } else { "" };
            let core_path = dir.join(format!("tsuki-core{}", ext));
            if core_path.exists() {
                return core_path.to_string_lossy().into_owned();
            }
        }
    }
    // 3. Bare name — resolved from PATH at runtime
    "tsuki-core".into()
}

/// Returns the configured tsuki-sim binary path.
/// Looks for settings.tsukiSimPath first, then checks next to tsuki-core, then falls back to "tsuki-sim".
#[tauri::command]
async fn get_tsuki_sim_bin(app: tauri::AppHandle) -> String {
    // 1. Explicit setting
    let explicit = read_setting_or(&app, "tsukiSimPath", "");
    if !explicit.is_empty() && explicit != "tsuki-sim" {
        return explicit;
    }
    // 2. Same directory as tsuki-core
    let core_path = read_setting_or(&app, "tsukiPath", "");
    if !core_path.is_empty() {
        let p = std::path::Path::new(&core_path);
        if let Some(dir) = p.parent() {
            let ext = if cfg!(windows) { ".exe" } else { "" };
            let sim_path = dir.join(format!("tsuki-sim{}", ext));
            if sim_path.exists() {
                return sim_path.to_string_lossy().into_owned();
            }
        }
    }
    // 3. Bare name — resolved from PATH at runtime
    "tsuki-sim".into()
}

/// Reads defaultBoard from settings.json, falls back to "uno".
#[tauri::command]
async fn get_default_board(app: tauri::AppHandle) -> String {
    read_setting_or(&app, "defaultBoard", "uno")
}

fn read_setting_or(app: &tauri::AppHandle, key: &str, fallback: &str) -> String {
    let dir = match app.path_resolver().app_config_dir() { Some(d) => d, None => return fallback.into() };
    if let Ok(raw) = std::fs::read_to_string(dir.join("settings.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(s) = v.get(key).and_then(|x| x.as_str()) {
                if !s.is_empty() { return s.to_string(); }
            }
        }
    }
    fallback.into()
}

// ── In-process simulator — replaces tsuki-sim subprocess ─────────────────────
//
// Runs the AST interpreter (simulator.rs) in a background thread and emits
// the exact same Tauri events as spawn_process, so SandboxPanel's TS code
// only needs to call run_simulator() instead of spawnProcess(simBin, ...).
//
// Event protocol (identical to spawn_process):
//   proc://<event_id>:stdout  — each NDJSON StepResult line
//   proc://<event_id>:stderr  — error/stderr lines
//   proc://<event_id>:done    — i32 exit code (0=ok, 1=error)
//
// stop_simulator(event_id)  — signals the thread to exit cleanly.

struct SimRegState {
    stops: Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>,
}

#[tauri::command]
async fn run_simulator(
    window:   Window,
    event_id: String,
    source:   String,
    board:    String,
    steps:    Option<usize>,
    sim_reg:  tauri::State<'_, SimRegState>,
) -> Result<(), String> {
    use tsuki_core::lexer::Lexer;
    use tsuki_core::parser::Parser as TsukiParser;
    use simulator::Simulator;

    // Parse once on the calling thread so errors surface immediately
    let tokens = Lexer::new(&source, "main.go")
        .tokenize()
        .map_err(|e| tsuki_core::pretty_error(&e, &source))?;
    let prog = TsukiParser::new(tokens)
        .parse_program()
        .map_err(|e| tsuki_core::pretty_error(&e, &source))?;

    // Register a stop flag for this event_id
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    sim_reg.stops.lock().unwrap().insert(event_id.clone(), Arc::clone(&stop));

    let (eid_out, eid_err, eid_done) = (event_id.clone(), event_id.clone(), event_id.clone());
    let (win_out, win_err, win_done) = (window.clone(), window.clone(), window.clone());
    let max_steps  = steps.unwrap_or(0);
    let stop_clone = Arc::clone(&stop);
    let stops_ref  = Arc::clone(unsafe {
        // SAFETY: tauri::State wraps an Arc; we extract it to pass to the thread.
        // Using a channel instead to avoid unsafe:
        &stop  // just clone the stop Arc we already have
    });
    // Use the stop Arc we already registered — no unsafe needed
    drop(stops_ref);

    // We need the stops map to clean up after the thread finishes.
    // Clone the Arc<Mutex<...>> out of the state.
    // tauri::State<'_, T> doesn't impl Clone directly, but we can get the inner ref.
    // Workaround: wrap stops in an outer Arc.
    // Simpler: just let the thread remove itself via a clone of the map Arc.
    // We stored it in a Mutex<HashMap> inside SimRegState. To share with thread,
    // wrap SimRegState.stops as Arc<Mutex<...>>.

    let (eid_out2, eid_err2, eid_done2) = (event_id.clone(), event_id.clone(), event_id.clone());
    let (win_out2, win_err2, win_done2) = (window.clone(), window.clone(), window.clone());
    let board2     = board.clone();
    let stop2      = Arc::clone(&stop);

    // We can't cheaply move sim_reg into the thread (it's a State<>).
    // Use a oneshot cleanup via Arc<AtomicBool>; cleanup is fine via drop.
    std::thread::spawn(move || {
        let mut sim: simulator::Simulator = match Simulator::new(&prog) {
            Ok(s)  => s,
            Err(e) => {
                let _ = win_err2.emit(&format!("proc://{}:stderr", eid_err2), e);
                let _ = win_done2.emit(&format!("proc://{}:done",  eid_done2), 1i32);
                return;
            }
        };
        sim.set_board(&board2);

        let limit     = if max_steps == 0 { usize::MAX } else { max_steps };
        let min_frame = std::time::Duration::from_millis(50);
        let mut last_emit = std::time::Instant::now()
            .checked_sub(std::time::Duration::from_millis(100))
            .unwrap_or_else(std::time::Instant::now);
        let mut last_pins: HashMap<String, u16> = HashMap::new();
        let mut prev_step_ms = 0.0_f64;

        for _ in 0..limit {
            if stop2.load(std::sync::atomic::Ordering::Relaxed) { break; }

            let result = sim.step();

            if !result.ok {
                // Emit error immediately and exit
                let pins_map: serde_json::Map<String, serde_json::Value> = result.pins.iter()
                    .map(|(k, v): (&String, &u16)| (k.clone(), serde_json::Value::Number((*v).into())))
                    .collect();
                let root = serde_json::json!({
                    "ok": false, "error": result.error,
                    "events": [], "pins": pins_map, "serial": result.serial, "ms": result.ms,
                });
                let _ = win_out2.emit(&format!("proc://{}:stdout", eid_out2), &serde_json::to_string(&root).unwrap_or_default());
                break;
            }

            // ── Per-segment emission ──────────────────────────────────────────
            // Walk events and emit one result per "delay" boundary.
            // This gives correct visual timing for blink/duty-cycle sketches:
            //   HIGH → emit {pins:{13:1}} → sleep 500ms → LOW → emit {pins:{13:0}} → sleep 500ms
            let mut seg_pins = last_pins.clone();
            let mut seg_events_json: Vec<serde_json::Value> = Vec::new();
            let mut seg_serial: Vec<String> = result.serial.clone(); // include serial from step
            let mut seg_start_ms = prev_step_ms;
            let mut had_delay = false;

            for event in &result.events {
                let ev_json = {
                    let mut o = serde_json::json!({"t_ms": event.t_ms, "kind": event.kind});
                    if let Some(p) = event.pin { o["pin"] = serde_json::json!(p); }
                    if let Some(v) = event.val { o["val"] = serde_json::json!(v); }
                    if let Some(m) = &event.msg { o["msg"] = serde_json::json!(m); }
                    o
                };
                match event.kind.as_str() {
                    "dw" | "aw" => {
                        if let (Some(pin), Some(val)) = (event.pin, event.val) {
                            seg_pins.insert(pin.to_string(), val);
                        }
                        seg_events_json.push(ev_json);
                    }
                    "delay" => {
                        let delay_ms = (event.t_ms - seg_start_ms).max(0.0);
                        had_delay = true;

                        // Emit current segment (pin state entering this delay)
                        let pins_map: serde_json::Map<String, serde_json::Value> = seg_pins.iter()
                            .map(|(k, v): (&String, &u16)| (k.clone(), serde_json::Value::Number((*v).into())))
                            .collect();
                        let serial_snap: Vec<String> = seg_serial.drain(..).collect();
                        let root = serde_json::json!({
                            "ok": true, "events": seg_events_json,
                            "pins": pins_map, "serial": serial_snap, "ms": event.t_ms,
                        });
                        let _ = win_out2.emit(&format!("proc://{}:stdout", eid_out2), &serde_json::to_string(&root).unwrap_or_default());
                        last_emit = std::time::Instant::now();
                        last_pins = seg_pins.clone();

                        // Sleep for the delay so virtual time ≈ wall time
                        if delay_ms > 5.0 {
                            std::thread::sleep(std::time::Duration::from_millis(delay_ms.min(500.0) as u64));
                        }

                        seg_events_json = vec![ev_json];
                        seg_start_ms = event.t_ms;

                        if stop2.load(std::sync::atomic::Ordering::Relaxed) { break; }
                    }
                    _ => { seg_events_json.push(ev_json); }
                }
            }

            // Emit remaining segment after last delay (or entire step if no delays)
            let pins_chg = seg_pins != last_pins;
            let has_rest = !seg_events_json.is_empty() || !seg_serial.is_empty() || pins_chg;
            if has_rest && (!had_delay || last_emit.elapsed() >= min_frame) {
                let pins_map: serde_json::Map<String, serde_json::Value> = seg_pins.iter()
                    .map(|(k, v): (&String, &u16)| (k.clone(), serde_json::Value::Number((*v).into())))
                    .collect();
                let root = serde_json::json!({
                    "ok": true, "events": seg_events_json,
                    "pins": pins_map, "serial": seg_serial, "ms": result.ms,
                });
                let _ = win_out2.emit(&format!("proc://{}:stdout", eid_out2), &serde_json::to_string(&root).unwrap_or_default());
                last_emit = std::time::Instant::now();
            }

            last_pins = seg_pins;
            prev_step_ms = result.ms;

            // For no-delay sketches, yield to avoid 100% CPU spin
            if !had_delay {
                std::thread::sleep(std::time::Duration::from_micros(200));
            }
        }


        let _ = win_done2.emit(&format!("proc://{}:done", eid_done2), 0i32);
    });

    Ok(())
}

#[tauri::command]
async fn stop_simulator(
    event_id: String,
    sim_reg:  tauri::State<'_, SimRegState>,
) -> Result<(), String> {
    if let Some(flag) = sim_reg.stops.lock().unwrap().get(&event_id) {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}

// ── In-process transpilation (no tsuki-core.exe subprocess) ──────────────────
//
// Both commands embed the tsuki_core library directly — the same code that
// tsuki-core.exe would run, but executed inside the Tauri process.  This means
// the IDE never needs to find/spawn tsuki-core.exe, which was the root cause of
// the "command … not found" errors on Windows.

/// Transpile a Go source string to C++ and return the result.
/// Used by LiveCompilerBlock in the docs to show transpiler output live.
#[tauri::command]
async fn transpile_source(source: String, board: String) -> Result<String, String> {
    use tsuki_core::{Pipeline, TranspileConfig};
    let cfg = TranspileConfig { board: board.clone(), ..Default::default() };
    Pipeline::new(cfg)
        .run(&source, "main.go")
        .map_err(|e| tsuki_core::pretty_error(&e, &source))
}

/// Transpile a Go source string and write a .sim.json bundle to disk.
/// Used by the Sandbox panel (replaces: tsuki-core <src> --emit-sim <bundle>).
#[tauri::command]
async fn emit_sim_bundle(source: String, board: String, bundle_path: String) -> Result<(), String> {
    use tsuki_core::{Pipeline, TranspileConfig};
    let cfg = TranspileConfig { board: board.clone(), ..Default::default() };
    let cpp = Pipeline::new(cfg)
        .run(&source, "main.go")
        .map_err(|e| tsuki_core::pretty_error(&e, &source))?;

    let bundle = serde_json::json!({
        "source":   source,
        "filename": "main.go",
        "board":    board,
        "cpp":      cpp,
    });
    std::fs::write(&bundle_path, bundle.to_string())
        .map_err(|e| format!("Cannot write sim bundle: {}", e))
}

// ── main ──────────────────────────────────────────────────────────────────────

/// Returns the current user's home directory as an absolute path string.
/// Used by the frontend to expand "~" in paths like "~/.tsuki/libs".
#[tauri::command]
async fn get_home_dir() -> Option<String> {
    tauri::api::path::home_dir().map(|p| p.to_string_lossy().into_owned())
}

fn main() {
    dbg("=== tsuki-ide started ===");
    #[cfg(windows)]
    dbg(&format!("[main] TEMP={}", std::env::var("TEMP").unwrap_or_default()));
    // Ensure child processes are killed when this process exits (Windows only)
    win_proc::init_job_object();
    tauri::Builder::default()
        .manage(AppState { processes: Arc::new(Mutex::new(HashMap::new())) })
        .manage(SimRegState { stops: Mutex::new(HashMap::new()) })
        .manage(pty_session::PtyState::new())
        .invoke_handler(tauri::generate_handler![
            run_shell,
            spawn_process,
            spawn_shell,
            list_shells,
            write_stdin,
            kill_process,
            detect_tool,
            pick_file,
            pick_folder,
            read_file,
            write_file,
            load_settings,
            save_settings,
            read_dir_entries,
            delete_file,
            rename_path,
            create_dir,
            run_git,
            get_tmp_go_path,
            get_tsuki_bin,
            get_tsuki_core_bin,
            get_tsuki_sim_bin,
            get_default_board,
            transpile_source,
            emit_sim_bundle,
            run_simulator,
            stop_simulator,
            get_home_dir,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            { app.get_window("main").unwrap().open_devtools(); }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}