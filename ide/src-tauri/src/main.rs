// Prevents additional console window on Windows in release mode
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tauri::{Manager, Window};

// ── Process registry: keep stdin handles for interactive processes ────────────
type ProcessMap = Arc<Mutex<HashMap<u32, std::process::ChildStdin>>>;

struct AppState {
    processes: ProcessMap,
}

// ── run_shell: blocking, returns full output ──────────────────────────────────
#[tauri::command]
async fn run_shell(cmd: String, args: Vec<String>, cwd: Option<String>) -> Result<String, String> {
    let mut c = Command::new(&cmd);
    c.args(&args);
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

// ── spawn_process: non-blocking, emits lines as Tauri events ─────────────────
// Returns the process PID so the frontend can send stdin input.
#[tauri::command]
async fn spawn_process(
    window: Window,
    state: tauri::State<'_, AppState>,
    cmd: String,
    args: Vec<String>,
    cwd: Option<String>,
    event_id: String,  // frontend listens to "proc://<event_id>"
) -> Result<u32, String> {
    let mut c = Command::new(&cmd);
    c.args(&args)
     .stdin(Stdio::piped())
     .stdout(Stdio::piped())
     .stderr(Stdio::piped());

    if let Some(dir) = &cwd { c.current_dir(dir); }

    let mut child = c.spawn()
        .map_err(|e| format!("Failed to spawn '{}': {}", cmd, e))?;

    let pid = child.id();
    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    // Store stdin so we can write to it later
    {
        let mut map = state.processes.lock().unwrap();
        map.insert(pid, stdin);
    }

    let eid_out = event_id.clone();
    let eid_err = event_id.clone();
    let eid_done = event_id.clone();
    let win_out  = window.clone();
    let win_err  = window.clone();
    let win_done = window.clone();

    // Stream stdout
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(l) => { let _ = win_out.emit(&format!("proc://{}:stdout", eid_out), l); }
                Err(_) => break,
            }
        }
    });

    // Stream stderr
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(l) => { let _ = win_err.emit(&format!("proc://{}:stderr", eid_err), l); }
                Err(_) => break,
            }
        }
    });

    // Wait for exit and emit done
    let processes = Arc::clone(&state.processes);
    std::thread::spawn(move || {
        let code = child.wait()
            .map(|s| s.code().unwrap_or(-1))
            .unwrap_or(-1);
        // Clean up stdin handle
        { processes.lock().unwrap().remove(&pid); }
        let _ = win_done.emit(&format!("proc://{}:done", eid_done), code);
    });

    Ok(pid)
}

// ── write_stdin: send input to a running process ─────────────────────────────
#[tauri::command]
async fn write_stdin(
    state: tauri::State<'_, AppState>,
    pid: u32,
    data: String,
) -> Result<(), String> {
    let mut map = state.processes.lock().unwrap();
    if let Some(stdin) = map.get_mut(&pid) {
        let line = if data.ends_with('\n') { data } else { format!("{}\n", data) };
        stdin.write_all(line.as_bytes())
            .map_err(|e| format!("Write to process failed: {}", e))?;
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
    {
        Command::new("taskkill").args(["/PID", &pid.to_string(), "/F"]).output().ok();
    }
    Ok(())
}

// ── detect_tool ───────────────────────────────────────────────────────────────
#[tauri::command]
async fn detect_tool(name: String) -> Result<String, String> {
    let flag = match name.as_str() {
        "tsuki"       => "--version",
        "arduino-cli" => "version",
        _             => "--version",
    };
    let out = Command::new(&name).arg(flag).output()
        .map_err(|_| format!("'{}' not found in PATH", name))?;
    let s = String::from_utf8_lossy(&out.stdout).to_string();
    Ok(s.lines().next().unwrap_or("found").to_string())
}

// ── pick_folder ───────────────────────────────────────────────────────────────
#[tauri::command]
async fn pick_folder(window: Window) -> Option<String> {
    tauri::api::dialog::blocking::FileDialogBuilder::new()
        .set_parent(&window)
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

// ── read_file / write_file ────────────────────────────────────────────────────
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

// ── settings persistence ──────────────────────────────────────────────────────
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

// ── read_dir: returns JSON list of {name, is_dir} ────────────────────────────
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

// ── delete_file / delete_dir ──────────────────────────────────────────────────
#[tauri::command]
async fn delete_file(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| format!("Delete dir error: {}", e))
    } else {
        std::fs::remove_file(&path).map_err(|e| format!("Delete file error: {}", e))
    }
}

// ── rename_path ───────────────────────────────────────────────────────────────
#[tauri::command]
async fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    std::fs::rename(&old_path, &new_path).map_err(|e| format!("Rename error: {}", e))
}

// ── create_dir ────────────────────────────────────────────────────────────────
#[tauri::command]
async fn create_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("Create dir error: {}", e))
}

// ── run_git: run a git subcommand in a directory ──────────────────────────────
#[tauri::command]
async fn run_git(args: Vec<String>, cwd: String) -> Result<String, String> {
    let mut c = Command::new("git");
    c.args(&args).current_dir(&cwd);
    let output = c.output().map_err(|e| format!("git not found: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if output.status.success() {
        Ok(stdout)
    } else {
        Err(if stderr.trim().is_empty() { stdout } else { stderr })
    }
}

// ── main ──────────────────────────────────────────────────────────────────────
fn main() {
    tauri::Builder::default()
        .manage(AppState { processes: Arc::new(Mutex::new(HashMap::new())) })
        .invoke_handler(tauri::generate_handler![
            run_shell,
            spawn_process,
            write_stdin,
            kill_process,
            detect_tool,
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