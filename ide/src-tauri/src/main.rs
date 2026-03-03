// Prevents additional console window on Windows in release mode
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tauri::Window;

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

// On Windows every Command::new().no_window() would flash a console window unless we set
// CREATE_NO_WINDOW. We add a tiny extension trait so we can call .no_window()
// on any Command in a platform-agnostic way.
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

trait NoWindow {
    fn no_window(self) -> Self;
}
impl NoWindow for Command {
    #[cfg(windows)]
    fn no_window(mut self) -> Self { self.creation_flags(CREATE_NO_WINDOW); self }
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
        #[cfg(windows)]
        {
            if let Ok(out) = Command::new("where").no_window().arg(name).output() {
                if out.status.success() {
                    let s = String::from_utf8_lossy(&out.stdout);
                    if let Some(line) = s.lines().next() {
                        let p = line.trim().to_string();
                        if !p.is_empty() { return Some(p); }
                    }
                }
            }
        }
        #[cfg(not(windows))]
        {
            if let Ok(out) = Command::new("which").no_window().arg(name).output() {
                if out.status.success() {
                    let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if !p.is_empty() { return Some(p); }
                }
            }
        }
    }
    None
}

#[tauri::command]
async fn list_shells() -> Vec<ShellInfo> {
    let mut shells: Vec<ShellInfo> = Vec::new();

    #[cfg(windows)]
    {
        // CMD — always present on Windows
        shells.push(ShellInfo {
            id:   "cmd".into(),
            name: "Command Prompt".into(),
            path: "cmd.exe".into(),
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

    #[cfg(not(windows))]
    c.env("TERM", "dumb").env("COLORTERM", "");

    if let Some(dir) = &cwd { c.current_dir(dir); }

    let mut child = c.spawn()
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
    let cmd = normalise_cmd(&cmd);

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

// ── spawn_process ─────────────────────────────────────────────────────────────
#[tauri::command]
async fn spawn_process(
    window:   Window,
    state:    tauri::State<'_, AppState>,
    cmd:      String,
    args:     Vec<String>,
    cwd:      Option<String>,
    event_id: String,
) -> Result<u32, String> {
    let cmd = normalise_cmd(&cmd);

    // ── DEBUG ────────────────────────────────────────────────────────────────
    dbg(&format!("[spawn_process] cmd   = {:?}", cmd));
    dbg(&format!("[spawn_process] args  = {:?}", args));
    dbg(&format!("[spawn_process] cwd   = {:?}", cwd));
    dbg(&format!("[spawn_process] exists= {}", std::path::Path::new(&cmd).exists()));
    #[cfg(windows)]
    dbg(&format!("[spawn_process] PATH  = {}", enriched_path()));
    // ─────────────────────────────────────────────────────────────────────────

    let mut c = Command::new(&cmd).no_window();
    c.args(&args)
     .stdin(Stdio::piped())
     .stdout(Stdio::piped())
     .stderr(Stdio::piped());
    #[cfg(windows)]
    { c.env("PATH", enriched_path()); }
    if let Some(dir) = &cwd { c.current_dir(dir); }

    let mut child = c.spawn().map_err(|e| {
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

    // If it looks like an absolute path, validate it directly
    let is_absolute = name.starts_with('/')
        || name.starts_with('\\')
        || (name.len() > 2 && name.chars().nth(1) == Some(':'));

    let resolved: String = if is_absolute {
        if !std::path::Path::new(&name).exists() {
            return Err(format!("File not found on disk: {}", name));
        }
        name.clone()
    } else {
        // On Windows use where.exe directly -- it is a system binary that
        // never opens a visible window, and we pass our enriched PATH so
        // per-user installs are found.
        #[cfg(windows)]
        {
            let out = Command::new("where").no_window()
                .arg(&name)
                .env("PATH", enriched_path())
                .output()
                .map_err(|_| format!("'{}' not found in PATH", name))?;
            if !out.status.success() {
                return Err(format!("'{}' not found in PATH", name));
            }
            let stdout = String::from_utf8_lossy(&out.stdout);
            stdout.lines()
                .map(|l| l.trim().to_string())
                .find(|l| !l.is_empty())
                .unwrap_or_default()
        }
        #[cfg(not(windows))]
        {
            let out = Command::new("which").no_window().arg(&name).output()
                .map_err(|_| format!("'{}' not found in PATH", name))?;
            if !out.status.success() {
                return Err(format!("'{}' not found in PATH", name));
            }
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        }
    };

    if resolved.is_empty() {
        return Err(format!("'{}' not found", name));
    }

    Ok(resolved)
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

// ── main ──────────────────────────────────────────────────────────────────────
fn main() {
    dbg("=== tsuki-ide started ===");
    #[cfg(windows)]
    dbg(&format!("[main] TEMP={}", std::env::var("TEMP").unwrap_or_default()));
    tauri::Builder::default()
        .manage(AppState { processes: Arc::new(Mutex::new(HashMap::new())) })
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
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            { app.get_window("main").unwrap().open_devtools(); }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}