// Prevents additional console window on Windows in release mode
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod simulator;
mod win_proc;
mod pty_session;

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::collections::HashMap;
use tauri::{Manager, Window};
use win_proc::WinSpawn;

// ── Log mutex — serialises all writes to the debug log ───────────────────────
// On Windows, concurrent OpenOptions::append from multiple threads causes
// silent write failures (sharing violation).  This mutex ensures only one
// thread writes at a time — zero cost when debug is off.
static LOG_MUTEX: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();
fn log_lock() -> std::sync::MutexGuard<'static, ()> {
    LOG_MUTEX.get_or_init(|| Mutex::new(())).lock().unwrap_or_else(|p| p.into_inner())
}

// ── Debug mode flag ───────────────────────────────────────────────────────────
// Set at startup by reading debugMode from settings.json BEFORE Tauri init.
// This guarantees every log call from the first millisecond is captured when
// debug mode is on — including spawn errors, path resolution, PTY failures, etc.
pub static DEBUG_ENABLED:    AtomicBool = AtomicBool::new(false);
/// When true, each entry is written as space-separated [key=value] tokens
/// instead of the default flat "[ts] message" line — makes grep filters trivial.
static DEBUG_STRUCTURED: AtomicBool = AtomicBool::new(false);

// ── Per-category log flags ────────────────────────────────────────────────────
// Each flag gates one logical group of log calls.  All default to true so that
// when debug mode is first enabled every category is captured.  Users can
// narrow scope in Settings → Developer → Debug & Logging without restarting.
//
// Keys must match debugLogCategories in store.ts:
//   spawn    → spawn_process / spawn_shell invocations
//   pty      → pty_create / pty_write / pty_resize / pty_kill lifecycle
//   resolve  → normalise_cmd / resolve_cmd path lookups
//   settings → settings read/write, tool-path detection
//   shell    → list_shells, spawn_shell
//   process  → process exit codes, write_stdin, kill_process
//   frontend → messages forwarded from console.log/warn/error
pub static LOG_CAT_SPAWN:    AtomicBool = AtomicBool::new(true);
pub static LOG_CAT_PTY:      AtomicBool = AtomicBool::new(true);
pub static LOG_CAT_RESOLVE:  AtomicBool = AtomicBool::new(true);
pub static LOG_CAT_SETTINGS: AtomicBool = AtomicBool::new(true);
pub static LOG_CAT_SHELL:    AtomicBool = AtomicBool::new(true);
pub static LOG_CAT_PROCESS:  AtomicBool = AtomicBool::new(true);
pub static LOG_CAT_FRONTEND: AtomicBool = AtomicBool::new(true);

/// Returns the OS-specific path for the debug log file.
pub fn debug_log_path() -> String {
    #[cfg(windows)]
    {
        let tmp = std::env::var("TEMP").unwrap_or_else(|_| "C:\\Temp".into());
        format!("{}\\tsuki-ide-debug.log", tmp)
    }
    #[cfg(not(windows))]
    {
        // Prefer XDG_RUNTIME_DIR or HOME/.local/share, fallback to /tmp
        if let Ok(home) = std::env::var("HOME") {
            format!("{}/.local/share/tsuki/tsuki-ide-debug.log", home)
        } else {
            "/tmp/tsuki-ide-debug.log".to_string()
        }
    }
}

// ── Log entry formatter ───────────────────────────────────────────────────────
//
// Flat mode  (default):
//   [1234.567] [spawn_process] cmd="tsuki.exe" args=["check"]
//   [1234.567] [frontend:error] spawn failed: ...
//
// Structured mode:
//   [ts=1234.567] [src=rust] [cat=spawn_process] msg="cmd=\"tsuki.exe\" args=[\"check\"]"
//   [ts=1234.567] [src=frontend] [lvl=error] msg="spawn failed: ..."
//
// Structured grep cheat-sheet:
//   grep "\[src=rust\]"          — Rust-only entries
//   grep "\[src=frontend\]"      — frontend-only entries
//   grep "\[lvl=error\]"         — errors only
//   grep "\[cat=spawn_process\]" — process-spawn events
//   grep "\[cat=pty"              — all PTY events
//   grep "\[cat=resolve_cmd\]"   — path resolution
//   grep "tsuki.exe"               — any entry mentioning the binary
pub fn now_ts() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0) as f64 / 1000.0
}

pub fn fmt_entry(ts: f64, source: &str, level: &str, raw_msg: &str) -> String {
    if DEBUG_STRUCTURED.load(Ordering::Relaxed) {
        // Extract first [tag] from raw_msg as the category, rest is the body
        let (cat, body) = if raw_msg.starts_with('[') {
            if let Some(end) = raw_msg.find(']') {
                let c = raw_msg[1..end].to_string();
                let b = raw_msg[end + 1..].trim().to_string();
                (c, b)
            } else {
                (String::new(), raw_msg.to_string())
            }
        } else {
            (String::new(), raw_msg.to_string())
        };

        let mut parts = vec![
            format!("[ts={:.3}]", ts),
            format!("[src={}]", source),
        ];
        if !level.is_empty() { parts.push(format!("[lvl={}]", level)); }
        if !cat.is_empty()   { parts.push(format!("[cat={}]", cat.replace(' ', "_"))); }
        if !body.is_empty()  { parts.push(format!("msg={:?}", body)); }
        parts.join(" ")
    } else {
        // Flat
        if level.is_empty() {
            format!("[{:.3}] {}", ts, raw_msg)
        } else {
            format!("[{:.3}] [{}:{}] {}", ts, source, level, raw_msg)
        }
    }
}

// ── Debug logger ──────────────────────────────────────────────────────────────
pub fn write_to_log(line: &str, path: &str) {
    if let Some(parent) = std::path::Path::new(path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // Hold the mutex for the entire open+write+flush cycle.
    // On Windows this prevents sharing violations when multiple threads
    // (spawn_process, pty_create, reader threads) all try to append at once.
    let _guard = log_lock();
    #[cfg(windows)]
    {
        // On Windows use FILE_SHARE_READ|FILE_SHARE_WRITE to avoid ERROR_SHARING_VIOLATION
        // when the viewer or tail command has the file open simultaneously.
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_SHARE_READ:  u32 = 0x00000001;
        const FILE_SHARE_WRITE: u32 = 0x00000002;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true).append(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .open(path)
        {
            let _ = writeln!(f, "{}", line);
            let _ = f.flush();
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{}", line);
        }
    }
    eprintln!("{}", line);
}

fn dbg(msg: &str) {
    let should_write = cfg!(debug_assertions) || DEBUG_ENABLED.load(Ordering::Relaxed);
    if !should_write { return; }
    let line = fmt_entry(now_ts(), "rust", "", msg);
    write_to_log(&line, &debug_log_path());
}

/// Category-gated logger.  Only emits when BOTH debug mode AND the given
/// category flag are on.  Zero cost when debug is off.
pub fn dbg_cat(cat: &AtomicBool, msg: &str) {
    if !DEBUG_ENABLED.load(Ordering::Relaxed) { return; }
    if !cat.load(Ordering::Relaxed)           { return; }
    let line = fmt_entry(now_ts(), "rust", "", msg);
    write_to_log(&line, &debug_log_path());
}

// CREATE_NO_WINDOW suppresses console windows for the process AND its children.
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
        if let Ok(path) = which::which(name) {
            return Some(path.to_string_lossy().into_owned());
        }
    }
    None
}

#[tauri::command]
async fn list_shells() -> Vec<ShellInfo> {
    let mut shells: Vec<ShellInfo> = Vec::new();
    dbg_cat(&LOG_CAT_SHELL, "[list_shells] start");

    #[cfg(windows)]
    {
        // ── WoW64-safe path resolver ─────────────────────────────────────────
        //
        // Problem: on a 32-bit process, Windows silently redirects
        //   C:\Windows\System32  →  C:\Windows\SysWOW64
        // for both file I/O AND CreateProcess.  Path::exists() may return true
        // (file redirector), yet CreateProcess fails (process redirector can
        // differ).  The "Sysnative" virtual directory always resolves to the
        // real 64-bit System32 and bypasses WoW64 for both I/O and spawning.
        //
        // Strategy: try raw path first, then Sysnative rewrite, then which.
        let resolve_win_shell = |raw: &str| -> String {
            // 1. Try the path as-is — preferred if it spawns correctly
            if std::path::Path::new(raw).exists() {
                // Also verify via a Sysnative rewrite so we log the right path
                let lower = raw.to_ascii_lowercase();
                if lower.contains("system32") {
                    let idx = lower.find("system32").unwrap();
                    let sn  = format!("{}Sysnative{}", &raw[..idx], &raw[idx+8..]);
                    let sn_exists = std::path::Path::new(&sn).exists();
                    dbg_cat(&LOG_CAT_SHELL, &format!(
                        "[resolve_win_shell] raw={:?} exists=true sysnative={:?} sn_exists={}",
                        raw, sn, sn_exists
                    ));
                    // Always prefer Sysnative when it exists — it bypasses WoW64
                    // for CreateProcess too, which is what portable-pty calls.
                    if sn_exists {
                        dbg_cat(&LOG_CAT_SHELL, &format!(
                            "[resolve_win_shell] using Sysnative path={:?}", sn
                        ));
                        return sn;
                    }
                }
                return raw.to_string();
            }
            // 2. Sysnative rewrite (32-bit process on 64-bit Windows)
            let lower = raw.to_ascii_lowercase();
            if lower.contains("system32") {
                let idx = lower.find("system32").unwrap();
                let sn  = format!("{}Sysnative{}", &raw[..idx], &raw[idx+8..]);
                let sn_exists = std::path::Path::new(&sn).exists();
                dbg_cat(&LOG_CAT_SHELL, &format!(
                    "[resolve_win_shell] raw={:?} NOT found, sysnative={:?} exists={}",
                    raw, sn, sn_exists
                ));
                if sn_exists { return sn; }
            }
            // 3. which — let the OS find it via PATH
            if let Ok(p) = which::which(raw) {
                let s = p.to_string_lossy().into_owned();
                dbg_cat(&LOG_CAT_SHELL, &format!(
                    "[resolve_win_shell] raw={:?} resolved via which={:?}", raw, s
                ));
                return s;
            }
            // 4. Return raw as last resort — spawn will fail with a clear error
            dbg_cat(&LOG_CAT_SHELL, &format!(
                "[resolve_win_shell] raw={:?} UNRESOLVED — returning as-is", raw
            ));
            raw.to_string()
        };

        // ── CMD ─────────────────────────────────────────────────────────────
        let comspec_raw = std::env::var("COMSPEC")
            .unwrap_or_else(|_| r"C:\Windows\System32\cmd.exe".into());
        dbg_cat(&LOG_CAT_SHELL, &format!("[list_shells] COMSPEC={:?}", comspec_raw));
        let cmd_path = resolve_win_shell(&comspec_raw);
        let cmd_meta_s = match std::path::Path::new(&cmd_path).metadata() {
            Ok(m)  => format!("ok(len={})", m.len()),
            Err(e) => format!("err(kind={:?}, os={:?})", e.kind(), e.raw_os_error()),
        };
        dbg_cat(&LOG_CAT_SHELL, &format!(
            "[list_shells] cmd resolved={:?} metadata={}", cmd_path, cmd_meta_s
        ));
        {
            let line = fmt_entry(now_ts(), "rust", "log", &format!(
                "[list_shells] cmd final_path={:?} metadata={}", cmd_path, cmd_meta_s
            ));
            write_to_log(&line, &debug_log_path());
        }
        shells.push(ShellInfo {
            id:   "cmd".into(),
            name: "Command Prompt".into(),
            path: cmd_path,
            icon: "⬛".into(),
        });

        // ── PowerShell 5.x ───────────────────────────────────────────────────
        let ps5_raw = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";
        let ps5 = resolve_win_shell(ps5_raw);
        if std::path::Path::new(&ps5).exists() {
            dbg_cat(&LOG_CAT_SHELL, &format!("[list_shells] powershell={:?}", ps5));
            shells.push(ShellInfo {
                id:   "powershell".into(),
                name: "PowerShell".into(),
                path: ps5,
                icon: "🔵".into(),
            });
        } else if let Some(p) = which_first(&["powershell"]) {
            dbg_cat(&LOG_CAT_SHELL, &format!("[list_shells] powershell(which)={:?}", p));
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

    // ── Log resumen final ────────────────────────────────────────────────────
    {
        let summary: Vec<String> = shells.iter()
            .map(|s| format!("{}={:?}(exists={})", s.id, s.path,
                std::path::Path::new(&s.path).exists()))
            .collect();
        dbg_cat(&LOG_CAT_SHELL, &format!(
            "[list_shells] done total={} shells=[{}]",
            shells.len(), summary.join(", ")
        ));
        // Always write summary to log file
        let line = fmt_entry(now_ts(), "rust", "log",
            &format!("[list_shells] result total={} [{}]", shells.len(), summary.join(", ")));
        write_to_log(&line, &debug_log_path());
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
    dbg_cat(&LOG_CAT_SHELL, &format!(
        "[spawn_shell] id={} path={:?} cwd={:?} exists={}",
        shell_id, shell_path, cwd, std::path::Path::new(&shell_path).exists()
    ));
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

    let mut child = c.win_spawn().map_err(|e| {
        let msg = format!("Failed to spawn shell '{}': {}", shell_path, e);
        // Always log shell spawn failures unconditionally
        if DEBUG_ENABLED.load(Ordering::Relaxed) {
            let l = fmt_entry(now_ts(), "rust", "error",
                &format!("[spawn_shell] FAILED id={} path={:?} err={}", shell_id, shell_path, e));
            write_to_log(&l, &debug_log_path());
        }
        msg
    })?;

    let pid   = child.id();
    dbg_cat(&LOG_CAT_SHELL, &format!("[spawn_shell] spawned pid={} id={}", pid, shell_id));
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
        dbg_cat(&LOG_CAT_PROCESS, &format!("[process_exit] pid={} exit_code={}", pid, code));
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
        // tsuki default install location — \bin is where tsuki.exe lives
        format!("{}\\Programs\\tsuki\\bin", user),
        // Go default install
        "C:\\Program Files\\Go\\bin".to_string(),
        format!("{}\\go\\bin", home),
        // arduino-cli common locations
        format!("{}\\Programs\\arduino-cli", user),
        "C:\\Program Files\\arduino-cli".to_string(),
        // Git bin (for git.exe)
        "C:\\Program Files\\Git\\bin".to_string(),
        "C:\\Program Files\\Git\\cmd".to_string(),
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
    dbg_cat(&LOG_CAT_RESOLVE, &format!("[normalise_cmd] raw={:?} result={:?}", raw, result));
    result
}

// ── resolve_cmd ───────────────────────────────────────────────────────────────
// Resolves a command name or path to a fully qualified executable path using
// the `which` crate — cross-platform, handles .exe/.cmd/.bat on Windows,
// respects PATH including our enriched version with per-user install dirs.
fn resolve_cmd(raw: &str) -> String {
    let s = raw.trim().trim_matches('"').trim();
    dbg_cat(&LOG_CAT_RESOLVE, &format!("[resolve_cmd] input={:?}", s));

    // Already an absolute path — normalise slashes and return
    let is_absolute = s.starts_with('\\')
        || s.starts_with('/')
        || (s.len() > 2 && s.chars().nth(1) == Some(':'));

    if is_absolute {
        #[cfg(windows)]
        let result = s.replace('/', "\\");
        #[cfg(not(windows))]
        let result = s.to_string();
        dbg_cat(&LOG_CAT_RESOLVE, &format!("[resolve_cmd] absolute={:?}", result));
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
        dbg_cat(&LOG_CAT_RESOLVE, &format!("[resolve_cmd] which={:?}", result));
        result
    }
    #[cfg(not(windows))]
    {
        let result = which::which(s)
            .map(|p: std::path::PathBuf| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| s.to_string());
        dbg_cat(&LOG_CAT_RESOLVE, &format!("[resolve_cmd] which={:?}", result));
        result
    }
}


#[tauri::command]
async fn spawn_process(
    window:   Window,
    state:    tauri::State<'_, AppState>,
    // Named 'exe_cmd' not 'cmd' — Tauri 1.x uses 'cmd' as the IPC dispatch key.
    // Passing a payload field named 'cmd' would overwrite the dispatch field.
    exe_cmd:  String,
    args:     Vec<String>,
    cwd:      Option<String>,
    event_id: String,
) -> Result<u32, String> {
    let cmd = resolve_cmd(&normalise_cmd(&exe_cmd));

    // ── Spawn diagnostic log ─────────────────────────────────────────────────
    let cmd_exists = std::path::Path::new(&cmd).exists();
    dbg_cat(&LOG_CAT_SPAWN, &format!(
        "[spawn_process] cmd={:?} exists={} args={:?} cwd={:?}",
        cmd, cmd_exists, args, cwd
    ));
    #[cfg(windows)]
    {
        // Log each PATH entry individually so missing dirs are obvious
        let path_str = enriched_path();
        dbg_cat(&LOG_CAT_SPAWN, &format!("[spawn_process] PATH entries:"));
        for (i, entry) in path_str.split(';').enumerate() {
            let exists = std::path::Path::new(entry).exists();
            dbg_cat(&LOG_CAT_SPAWN, &format!(
                "[spawn_process]   PATH[{:02}] exists={} {:?}", i, exists, entry
            ));
        }
    }
    // Always write a startup line regardless of category — critical for diagnosis
    if DEBUG_ENABLED.load(Ordering::Relaxed) {
        let line = fmt_entry(now_ts(), "rust", if cmd_exists { "log" } else { "warn" },
            &format!("[spawn_process] about to spawn cmd={:?} exists={}", cmd, cmd_exists));
        write_to_log(&line, &debug_log_path());
    }
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

    // Set cwd only when the directory exists; otherwise fall back to TEMP.
    // On Windows, inheriting a non-existent parent CWD causes CreateProcess
    // to return ERROR_FILE_NOT_FOUND even for absolute exe paths that exist.
    // Explicitly setting a known-valid cwd breaks that inheritance chain.
    {
        let effective_cwd = match &cwd {
            Some(dir) if std::path::Path::new(dir).is_dir() => {
                Some(dir.clone())
            }
            Some(dir) => {
                dbg_cat(&LOG_CAT_SPAWN, &format!("[spawn_process] cwd={:?} NOT FOUND — falling back to TEMP", dir));
                None
            }
            None => None,
        };
        let fallback = std::env::var("TEMP").or_else(|_| std::env::var("TMP")).ok();
        let dir_to_use = effective_cwd.or(fallback);
        if let Some(d) = &dir_to_use {
            c.current_dir(d);
        }
    }

    let mut child = c.win_spawn().map_err(|e| {
        let exists = std::path::Path::new(&cmd).exists();
        let kind   = e.kind();
        let msg = if !exists {
            format!(
                "Executable not found: {}\n  → Check Settings → CLI Tools and verify the path.",
                cmd
            )
        } else {
            format!(
                "spawn failed for {:?}: {} (os_error={:?}, file_exists={})",
                cmd, e, kind, exists
            )
        };
        // Always log spawn failures — critical regardless of category toggle
        if DEBUG_ENABLED.load(Ordering::Relaxed) {
            let line = fmt_entry(now_ts(), "rust", "error",
                &format!("[spawn_process] FAILED cmd={:?} exists={} kind={:?} err={}", cmd, exists, kind, e));
            write_to_log(&line, &debug_log_path());
        }
        msg
    })?;

    let pid    = child.id();
    dbg_cat(&LOG_CAT_SPAWN, &format!("[spawn_process] spawned pid={} cmd={:?}", pid, cmd));
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
        dbg_cat(&LOG_CAT_PROCESS, &format!("[process_exit] pid={} exit_code={}", pid, code));
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
async fn check_path_exists(path: String) -> Result<(), String> {
    if std::path::Path::new(&path).exists() {
        Ok(())
    } else {
        Err(format!("path does not exist: {}", path))
    }
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

    let max_steps = steps.unwrap_or(0);

    let eid_out2  = event_id.clone();
    let (eid_err2, eid_done2) = (event_id.clone(), event_id.clone());
    let win_out2  = window.clone();
    let (win_err2, win_done2) = (window.clone(), window.clone());
    let board2 = board.clone();
    let stop2  = Arc::clone(&stop);

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

/// Transpile a source string to C++ and return the result.
/// Accepts an optional `lang` parameter ("go" | "python"). Defaults to "go".
/// Used by LiveCompilerBlock in the docs to show transpiler output live.
#[tauri::command]
async fn transpile_source(source: String, board: String, lang: Option<String>) -> Result<String, String> {
    use tsuki_core::{Pipeline, PythonPipeline, TranspileConfig};
    let cfg = TranspileConfig { board: board.clone(), ..Default::default() };
    match lang.as_deref().unwrap_or("go") {
        "python" | "py" => PythonPipeline::new(cfg)
            .run(&source, "main.py")
            .map_err(|e| tsuki_core::pretty_error(&e, &source)),
        _ => Pipeline::new(cfg)
            .run(&source, "main.go")
            .map_err(|e| tsuki_core::pretty_error(&e, &source)),
    }
}

/// Transpile a Go source string and write a .sim.json bundle to disk.
/// Used by the Sandbox panel (replaces: tsuki-core <src> --emit-sim <bundle>).
#[tauri::command]
async fn emit_sim_bundle(source: String, board: String, bundle_path: String, lang: Option<String>) -> Result<(), String> {
    use tsuki_core::{Pipeline, PythonPipeline, TranspileConfig};
    let cfg = TranspileConfig { board: board.clone(), ..Default::default() };

    let language = lang.as_deref().unwrap_or("go");
    let (cpp, filename) = match language {
        "python" | "py" => {
            let cpp = PythonPipeline::new(cfg)
                .run(&source, "main.py")
                .map_err(|e| tsuki_core::pretty_error(&e, &source))?;
            (cpp, "main.py")
        }
        _ => {
            let cpp = Pipeline::new(cfg)
                .run(&source, "main.go")
                .map_err(|e| tsuki_core::pretty_error(&e, &source))?;
            (cpp, "main.go")
        }
    };

    let bundle = serde_json::json!({
        "source":   source,
        "filename": filename,
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

// ── System diagnostics command ───────────────────────────────────────────────

/// Returns a comprehensive system snapshot as a JSON string.
/// Covers: PATH entries, key executable existence, env vars, Windows-specific
/// paths — everything needed to diagnose "executable not found" failures.
#[tauri::command]
async fn run_diagnostics(app: tauri::AppHandle) -> String {
    let ts = now_ts();
    let mut lines: Vec<String> = Vec::new();

    macro_rules! sec  { ($t:expr) => { lines.push(format!("\n=== {} ===", $t)); }; }
    macro_rules! kv   { ($k:expr, $v:expr) => { lines.push(format!("  {:28} {}", $k, $v)); }; }
    macro_rules! flag { ($k:expr, $p:expr) => {
        let exists = std::path::Path::new($p).exists();
        let is_file = std::path::Path::new($p).is_file();
        lines.push(format!("  {:28} {} (file={} path={:?})", $k, if exists { "EXISTS" } else { "MISSING" }, is_file, $p));
    }; }

    lines.push(format!("tsuki-ide diagnostics  ts={:.3}", ts));

    // ── Settings ──────────────────────────────────────────────────────────────
    sec!("Settings");
    let cfg_dir = app.path_resolver().app_config_dir();
    kv!("config_dir", format!("{:?}", cfg_dir));
    if let Some(dir) = &cfg_dir {
        let settings_path = dir.join("settings.json");
        kv!("settings.json exists", settings_path.exists().to_string());
        if let Ok(raw) = std::fs::read_to_string(&settings_path) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                for key in &["tsukiPath", "tsukiCorePath", "tsukiFlashPath", "tsukiSimPath",
                             "arduinoCliPath", "debugMode", "debugLogFormat"] {
                    kv!(key, format!("{}", v.get(*key).unwrap_or(&serde_json::Value::Null)));
                }
            }
        }
    }

    // ── Key executables ───────────────────────────────────────────────────────
    sec!("Key executables");
    let env_path = std::env::var("PATH").unwrap_or_default();
    for name in &["tsuki.exe", "tsuki-core.exe", "tsuki-flash.exe",
                   "arduino-cli.exe", "git.exe", "go.exe"] {
        let found = which::which(name)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| "NOT FOUND".into());
        kv!(name, found);
    }

    // ── Environment variables ─────────────────────────────────────────────────
    sec!("Environment");
    for var in &["PATH", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE",
                  "COMSPEC", "SystemRoot", "ProgramFiles", "ProgramFiles(x86)"] {
        kv!(var, std::env::var(var).unwrap_or_else(|_| "(not set)".into()));
    }

    // ── Enriched PATH (Windows) ───────────────────────────────────────────────
    #[cfg(windows)]
    {
        sec!("Enriched PATH entries");
        let epath = crate::enriched_path();
        for (i, entry) in epath.split(';').enumerate() {
            if entry.is_empty() { continue; }
            let exists = std::path::Path::new(entry).exists();
            lines.push(format!("  [{:02}] {} {:?}", i, if exists {"✓"} else {"✗"}, entry));
        }
    }

    // ── Common shell paths ────────────────────────────────────────────────────
    sec!("Shell paths");
    let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| r"C:\Windows\System32\cmd.exe".into());
    flag!("COMSPEC (cmd.exe)", &comspec);
    flag!(r"C:\Windows\System32\cmd.exe", r"C:\Windows\System32\cmd.exe");
    flag!(r"C:\WINDOWS\system32\cmd.exe", r"C:\WINDOWS\system32\cmd.exe");
    if let Some(home) = std::env::var("USERPROFILE").ok() {
        let ps5 = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";
        flag!("powershell.exe", ps5);
        let git_bash = format!(r"{}\AppData\Local\Programs\Git\bin\bash.exe", home);
        flag!("git-bash (Programs)", &git_bash);
        flag!("git-bash (PF)", r"C:\Program Files\Git\bin\bash.exe");
    }

    // ── Log file ─────────────────────────────────────────────────────────────
    sec!("Log file");
    let log_path = debug_log_path();
    kv!("path", &log_path);
    kv!("exists", std::path::Path::new(&log_path).exists().to_string());
    if let Ok(meta) = std::fs::metadata(&log_path) {
        kv!("size_bytes", meta.len().to_string());
    }

    let report = lines.join("\n");

    // Also write the report to the debug log if debug is on
    if DEBUG_ENABLED.load(Ordering::Relaxed) {
        let l = fmt_entry(now_ts(), "rust", "log",
            "[run_diagnostics] report written (see diagnostics panel in Settings)");
        write_to_log(&l, &debug_log_path());
        for line in &lines {
            let l = fmt_entry(now_ts(), "rust", "log", &format!("[diag] {}", line));
            write_to_log(&l, &debug_log_path());
        }
    }

    report
}

// ── Log category control command ─────────────────────────────────────────────

/// Called by the frontend whenever the user toggles a log category in Settings.
/// Takes a JSON object { spawn, pty, resolve, settings, shell, process, frontend }.
#[tauri::command]
async fn set_log_categories(categories: serde_json::Value) {
    let set_cat = |key: &str, flag: &AtomicBool| {
        if let Some(v) = categories.get(key).and_then(|x| x.as_bool()) {
            flag.store(v, Ordering::Relaxed);
            if DEBUG_ENABLED.load(Ordering::Relaxed) {
                let line = fmt_entry(now_ts(), "rust", "", &format!("[set_log_categories] {}={}", key, v));
                write_to_log(&line, &debug_log_path());
            }
        }
    };
    set_cat("spawn",    &LOG_CAT_SPAWN);
    set_cat("pty",      &LOG_CAT_PTY);
    set_cat("resolve",  &LOG_CAT_RESOLVE);
    set_cat("settings", &LOG_CAT_SETTINGS);
    set_cat("shell",    &LOG_CAT_SHELL);
    set_cat("process",  &LOG_CAT_PROCESS);
    set_cat("frontend", &LOG_CAT_FRONTEND);
}

// ── Debug commands ────────────────────────────────────────────────────────────

/// Called by the frontend to write a log entry (level = "log" | "warn" | "error").
/// Only emits if debug mode is enabled.
#[tauri::command]
async fn log_frontend(level: String, message: String) {
    if DEBUG_ENABLED.load(Ordering::Relaxed) {
        let line = fmt_entry(now_ts(), "frontend", &level, &message);
        write_to_log(&line, &debug_log_path());
    }
}

/// Returns the absolute path to the debug log file so the frontend can show it.
#[tauri::command]
async fn get_debug_log_path() -> String {
    debug_log_path()
}

/// Opens the debug log in the OS default text editor (Notepad on Windows,
/// xdg-open / open on Linux / macOS).
#[tauri::command]
async fn open_debug_log() -> Result<(), String> {
    let path = debug_log_path();
    if !std::path::Path::new(&path).exists() {
        return Err(format!("Log file not found: {}", path));
    }
    #[cfg(windows)]
    {
        Command::new("notepad").arg(&path).spawn()
            .map_err(|e| format!("Failed to open log: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(&path).spawn()
            .map_err(|e| format!("Failed to open log: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open").arg(&path).spawn()
            .map_err(|e| format!("Failed to open log: {e}"))?;
    }
    Ok(())
}

/// Truncates the debug log file and writes a restart marker so append mode
/// keeps working immediately after (std::fs::write is avoided — on Windows
/// it can leave the file in a state where subsequent OpenOptions::append fails).
#[tauri::command]
async fn clear_debug_log() -> Result<(), String> {
    let path = debug_log_path();

    // Ensure parent directory exists before truncating
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).ok();
    }

    // Truncate via OpenOptions — same flags family as the append writer,
    // avoids any file-locking or mode-switching issues on Windows.
    std::fs::OpenOptions::new()
        .write(true).truncate(true).create(true)
        .open(&path)
        .map_err(|e| format!("Failed to clear log: {e}"))?;

    // Write a header line so the file is non-empty and clearly restarts here.
    // This also proves the append path still works right after truncation.
    write_to_log(
        &fmt_entry(now_ts(), "system", "log", "[log-cleared] --- log cleared by user ---"),
        &path,
    );
    Ok(())
}

/// Returns the last `n` lines of the debug log (for the in-settings viewer).
#[tauri::command]
async fn tail_debug_log(lines: usize) -> String {
    let path = debug_log_path();
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    let all: Vec<&str> = content.lines().collect();
    let start = all.len().saturating_sub(lines);
    all[start..].join("\n")
}

// ── Update system ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PlatformAsset {
    pub url:       String,
    pub signature: String,
    pub size:      u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UpdateInfo {
    pub version:   String,
    pub channel:   String,
    pub pub_date:  String,
    pub notes:     String,
    pub platforms: std::collections::HashMap<String, PlatformAsset>,
    /// If set, the IDE will re-show the onboarding wizard when updating
    /// to this version (stored in settings.forcedOnboardingVersion).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forced_onboarding_version: Option<String>,
    /// If set, the IDE will show the What's New popup for this version.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub whats_new_version: Option<String>,
    /// JSON-encoded array of ChangelogEntry ({type, text}) for the popup.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub whats_new_changelog: Option<String>,
}

/// Fetch the update manifest for `channel` from `manifest_url`.
/// Uses reqwest with rustls — no subprocess, no console window.
#[tauri::command]
async fn check_for_updates(_channel: String, manifest_url: String) -> Result<UpdateInfo, String> {
    let client = reqwest::Client::builder()
        .user_agent("tsuki-ide-updater")
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client.get(&manifest_url)
        .header("Accept", "application/json")
        .send().await
        .map_err(|e| format!("Manifest fetch error ({}): {e}", manifest_url))?;

    if !response.status().is_success() {
        return Err(format!("Manifest fetch returned {}: {}", response.status(), manifest_url));
    }

    let info: UpdateInfo = response.json().await
        .map_err(|e| format!("Manifest parse error: {e}"))?;

    Ok(info)
}

/// Returns the current app version from Cargo.toml so the frontend can
/// compare it against the manifest version to decide what to show.
#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Download and apply an update.
/// Emits update_progress events: { stage, pct?, total?, downloaded? }
///   stage = "downloading" | "installing" | "done"
/// After the installer exits the app is relaunched via AppHandle::restart.
#[tauri::command]
async fn apply_update(app: tauri::AppHandle, window: Window, info: UpdateInfo) -> Result<(), String> {
    let platform_key = {
        let os   = if cfg!(target_os = "windows") { "windows" }
                   else if cfg!(target_os = "macos") { "darwin" }
                   else { "linux" };
        let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "amd64" };
        format!("{}-{}", os, arch)
    };

    let asset = info.platforms.get(&platform_key)
        .ok_or_else(|| format!("No asset for platform '{platform_key}' in update manifest"))?;

    let total_bytes = asset.size;  // 0 if unknown

    window.emit("update_progress", serde_json::json!({
        "stage": "downloading", "platform": &platform_key,
        "pct": 0, "downloaded": 0, "total": total_bytes
    })).map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .user_agent("tsuki-ide-updater")
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client.get(&asset.url)
        .send().await
        .map_err(|e| format!("Download failed ({}): {e}", asset.url))?;

    if !response.status().is_success() {
        return Err(format!("Download returned {}: {}", response.status(), asset.url));
    }

    // Stream the response body so we can emit progress events
    use futures_util::StreamExt;
    let content_length = response.content_length().unwrap_or(total_bytes);
    let mut stream = response.bytes_stream();
    let mut buf: Vec<u8> = Vec::with_capacity(content_length as usize);
    let mut downloaded: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
        downloaded += chunk.len() as u64;
        buf.extend_from_slice(&chunk);

        let pct = if content_length > 0 {
            (downloaded * 100 / content_length).min(100)
        } else { 0 };

        window.emit("update_progress", serde_json::json!({
            "stage": "downloading",
            "pct": pct,
            "downloaded": downloaded,
            "total": content_length,
        })).ok();
    }

    let tmp_dir  = std::env::temp_dir();
    let filename = asset.url.split('/').last().unwrap_or("tsuki-update");
    let tmp_path = tmp_dir.join(filename);

    std::fs::write(&tmp_path, &buf)
        .map_err(|e| format!("Failed to save to {}: {e}", tmp_path.display()))?;

    window.emit("update_progress", serde_json::json!({"stage": "installing", "pct": 100}))
        .map_err(|e| e.to_string())?;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // /RESTARTAPPLICATIONS is not used here — we restart via AppHandle below
        std::process::Command::new(&tmp_path)
            .arg("/SILENT")
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| format!("Installer launch failed: {e}"))?;
    }
    #[cfg(unix)]
    {
        let extract_dir = tmp_dir.join("tsuki-update-extract");
        let _ = std::fs::create_dir_all(&extract_dir);
        std::process::Command::new("tar")
            .args(["xzf", tmp_path.to_str().unwrap_or(""), "-C", extract_dir.to_str().unwrap_or("")])
            .status()
            .map_err(|e| format!("tar failed: {e}"))?;
        let install_sh = extract_dir.read_dir()
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .find(|e| e.file_name() == "install.sh")
            .map(|e| e.path())
            .ok_or("install.sh not found in archive")?;
        std::process::Command::new("bash")
            .arg(&install_sh).arg("-y")
            .spawn()
            .map_err(|e| format!("install.sh failed: {e}"))?;
    }

    window.emit("update_progress", serde_json::json!({"stage": "done", "pct": 100}))
        .ok();

    // Wait for the installer to start, then restart this process.
    // On Windows the installer runs SILENT in the background and replaces
    // the binary; on Unix install.sh does the same. Either way we relaunch
    // so the user lands on the fresh version immediately.
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    tauri::api::process::restart(&app.env());
    unreachable!() // restart() terminates the process
}


fn main() {
    // ── Read debugMode from settings.json BEFORE Tauri starts ────────────────
    // We do this manually so the very first dbg() call is already conditional
    // on the user's saved preference. Tauri hasn't started yet, so we read the
    // file directly with serde_json.
    //
    // We build a list of every plausible location and try each one in order.
    // The bundle identifier in tauri.conf.json is "dev.tsuki.ide"; Tauri v1
    // maps app_config_dir() to:
    //   Windows : %APPDATA%\dev.tsuki.ide\
    //   Linux   : $XDG_CONFIG_HOME/dev.tsuki.ide/  (falls back to ~/.config/dev.tsuki.ide/)
    //   macOS   : ~/Library/Application Support/dev.tsuki.ide/
    //
    // We write every candidate path to stderr unconditionally here (before
    // DEBUG_ENABLED is set) so the startup trace is always visible in dev
    // builds and in the log file once debug mode is active.
    {
        // Build all candidate paths
        let mut candidates: Vec<std::path::PathBuf> = Vec::new();

        #[cfg(windows)]
        {
            // Primary: %APPDATA%\dev.tsuki.ide\settings.json
            if let Ok(appdata) = std::env::var("APPDATA") {
                candidates.push(std::path::PathBuf::from(&appdata)
                    .join("dev.tsuki.ide").join("settings.json"));
                // Fallback: some Tauri builds use the product name instead
                candidates.push(std::path::PathBuf::from(&appdata)
                    .join("tsuki-ide").join("settings.json"));
            }
        }
        #[cfg(target_os = "linux")]
        {
            // Primary: $XDG_CONFIG_HOME/dev.tsuki.ide/settings.json
            if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
                candidates.push(std::path::PathBuf::from(&xdg)
                    .join("dev.tsuki.ide").join("settings.json"));
            }
            // Fallback: ~/.config/dev.tsuki.ide/settings.json
            if let Ok(home) = std::env::var("HOME") {
                candidates.push(std::path::PathBuf::from(&home)
                    .join(".config").join("dev.tsuki.ide").join("settings.json"));
                candidates.push(std::path::PathBuf::from(&home)
                    .join(".config").join("tsuki-ide").join("settings.json"));
            }
        }
        #[cfg(target_os = "macos")]
        {
            if let Ok(home) = std::env::var("HOME") {
                candidates.push(std::path::PathBuf::from(&home)
                    .join("Library").join("Application Support")
                    .join("dev.tsuki.ide").join("settings.json"));
                candidates.push(std::path::PathBuf::from(&home)
                    .join("Library").join("Application Support")
                    .join("tsuki-ide").join("settings.json"));
            }
        }

        // Ensure log directory exists so we can write even before DEBUG_ENABLED is set
        let log_path = debug_log_path();
        if let Some(parent) = std::path::Path::new(&log_path).parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        // Log every candidate unconditionally (eprintln + file) so startup
        // is always traceable even before the flag is known.
        let early_log = |msg: &str| {
            let line = format!("[{:.3}] [main] {}", now_ts(), msg);
            eprintln!("{}", &line);
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true).append(true).open(&log_path)
            {
                let _ = writeln!(f, "{}", &line);
            }
        };

        early_log(&format!("searching for settings.json ({} candidate(s))", candidates.len()));

        let mut found = false;
        for candidate in &candidates {
            let display = candidate.display().to_string();
            match std::fs::read_to_string(candidate) {
                Ok(raw) => {
                    early_log(&format!("found settings.json at: {}", display));
                    match serde_json::from_str::<serde_json::Value>(&raw) {
                        Ok(v) => {
                            let debug_on = v.get("debugMode")
                                .and_then(|x| x.as_bool()).unwrap_or(false);
                            let fmt = v.get("debugLogFormat")
                                .and_then(|x| x.as_str()).unwrap_or("flat");

                            early_log(&format!("settings parsed: debugMode={} debugLogFormat={}", debug_on, fmt));

                            if debug_on {
                                DEBUG_ENABLED.store(true, Ordering::Relaxed);
                            }
                            if fmt == "structured" {
                                DEBUG_STRUCTURED.store(true, Ordering::Relaxed);
                            }
                            // Apply per-category flags (default all true if key absent)
                            if let Some(cats) = v.get("debugLogCategories") {
                                let load_cat = |key: &str, flag: &AtomicBool| {
                                    let on = cats.get(key).and_then(|x| x.as_bool()).unwrap_or(true);
                                    flag.store(on, Ordering::Relaxed);
                                };
                                load_cat("spawn",    &LOG_CAT_SPAWN);
                                load_cat("pty",      &LOG_CAT_PTY);
                                load_cat("resolve",  &LOG_CAT_RESOLVE);
                                load_cat("settings", &LOG_CAT_SETTINGS);
                                load_cat("shell",    &LOG_CAT_SHELL);
                                load_cat("process",  &LOG_CAT_PROCESS);
                                load_cat("frontend", &LOG_CAT_FRONTEND);
                                early_log(&format!("categories: spawn={} pty={} resolve={} settings={} shell={} process={} frontend={}",
                                    LOG_CAT_SPAWN.load(Ordering::Relaxed),
                                    LOG_CAT_PTY.load(Ordering::Relaxed),
                                    LOG_CAT_RESOLVE.load(Ordering::Relaxed),
                                    LOG_CAT_SETTINGS.load(Ordering::Relaxed),
                                    LOG_CAT_SHELL.load(Ordering::Relaxed),
                                    LOG_CAT_PROCESS.load(Ordering::Relaxed),
                                    LOG_CAT_FRONTEND.load(Ordering::Relaxed),
                                ));
                            }
                        }
                        Err(e) => early_log(&format!("settings.json parse error: {}", e)),
                    }
                    found = true;
                    break;
                }
                Err(_) => {
                    early_log(&format!("not found: {}", display));
                }
            }
        }

        if !found {
            early_log("settings.json not found in any candidate path — using defaults (debugMode=false)");
        }
    }

    // ── Fix: ensure the process CWD is always valid ─────────────────────────
    // On Windows, if the process inherits a non-existent CWD (e.g. from a
    // shortcut whose "Start in" folder was deleted), ALL CreateProcess calls
    // fail with ERROR_FILE_NOT_FOUND — even for absolute exe paths that exist.
    // This affects pty_create, spawn_process, and spawn_shell alike.
    // Fix: reset CWD to TEMP at startup so every spawn has a valid parent dir.
    #[cfg(windows)]
    {
        let safe_cwd = std::env::var("TEMP")
            .or_else(|_| std::env::var("TMP"))
            .unwrap_or_else(|_| "C:\\Windows\\Temp".into());
        if let Err(e) = std::env::set_current_dir(&safe_cwd) {
            // Non-fatal — log and continue
            let line = fmt_entry(now_ts(), "rust", "warn",
                &format!("[main] set_current_dir({:?}) failed: {}", safe_cwd, e));
            write_to_log(&line, &debug_log_path());
        } else {
            let line = fmt_entry(now_ts(), "rust", "log",
                &format!("[main] CWD reset to {:?} (spawn fix)", safe_cwd));
            write_to_log(&line, &debug_log_path());
        }
    }

    dbg("=== tsuki-ide started ===");

    // Log the exact binary path — this tells us which exe is actually running.
    // If this path is old/unexpected after a --quick build, the wrong binary is launching.
    {
        let exe_path = std::env::current_exe()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| "<unknown>".into());
        let line = fmt_entry(now_ts(), "rust", "log",
            &format!("[main] RUNNING_EXE={}", exe_path));
        write_to_log(&line, &debug_log_path());
        dbg(&format!("[main] RUNNING_EXE={}", exe_path));
    }

    dbg(&format!("[main] debug_mode={} format={}",
        DEBUG_ENABLED.load(Ordering::Relaxed),
        if DEBUG_STRUCTURED.load(Ordering::Relaxed) { "structured" } else { "flat" }
    ));
    #[cfg(windows)]
    dbg(&format!("[main] TEMP={}", std::env::var("TEMP").unwrap_or_default()));
    #[cfg(not(windows))]
    dbg(&format!("[main] HOME={}", std::env::var("HOME").unwrap_or_default()));
    dbg(&format!("[main] log_path={}", debug_log_path()));

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
            check_path_exists,
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
            log_frontend,
            set_log_categories,
            run_diagnostics,
            get_debug_log_path,
            open_debug_log,
            clear_debug_log,
            tail_debug_log,
            pty_session::pty_create,
            pty_session::pty_write,
            pty_session::pty_resize,
            pty_session::pty_kill,
            check_for_updates,
            apply_update,
            get_app_version,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            { app.get_window("main").unwrap().open_devtools(); }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}