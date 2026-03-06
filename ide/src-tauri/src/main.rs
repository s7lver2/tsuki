// Prevents additional console window on Windows in release mode
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tauri::Window;

// ── Windows: WinAPI process spawning ─────────────────────────────────────────
// std::process::Command on Windows resolves the executable using the *parent*
// process token before any env overrides take effect. For binaries installed
// under %LOCALAPPDATA%\Programs\ this can fail with ACCESS_DENIED even when
// the file exists. We bypass this entirely by calling CreateProcessW directly
// via the windows-sys crate, which gives us full control over the token and
// handles.
#[cfg(windows)]
mod win_spawn {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::io;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::Threading::{
        CreateProcessW, PROCESS_INFORMATION, STARTUPINFOW,
        CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT,
    };
    use windows_sys::Win32::System::Pipes::CreatePipe;
    use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;

    fn to_wide_null(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    fn build_env_block(extra_path: &str) -> Vec<u16> {
        // Rebuild the environment with our enriched PATH
        let mut env_str = String::new();
        for (k, v) in std::env::vars() {
            if k.eq_ignore_ascii_case("PATH") {
                env_str.push_str(&format!("PATH={}\0", extra_path));
            } else {
                env_str.push_str(&format!("{}={}\0", k, v));
            }
        }
        // Make sure PATH exists even if not in parent env
        if !env_str.to_lowercase().contains("path=") {
            env_str.push_str(&format!("PATH={}\0", extra_path));
        }
        env_str.push('\0');
        env_str.encode_utf16().collect()
    }

    pub struct WinProcess {
        pub pid:        u32,
        pub handle:     isize,   // HANDLE — stored as isize to be Send
        pub stdin_pipe: isize,   // write end
        pub stdout_pipe: isize,  // read end
        pub stderr_pipe: isize,  // read end
    }

    unsafe impl Send for WinProcess {}

    fn create_pipe() -> io::Result<(isize, isize)> {
        let mut sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: std::ptr::null_mut(),
            bInheritHandle: 1,
        };
        let mut read_end:  HANDLE = 0;
        let mut write_end: HANDLE = 0;
        if unsafe { CreatePipe(&mut read_end, &mut write_end, &mut sa, 0) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok((read_end as isize, write_end as isize))
    }

    pub fn spawn(exe: &str, args: &[String], cwd: Option<&str>, enriched_path: &str) -> io::Result<WinProcess> {
        // Build command line: "exe" arg1 arg2 ...
        let cmdline = {
            let mut s = format!("\"{}\"", exe.replace('"', "\\\""));
            for a in args {
                s.push(' ');
                if a.contains(' ') {
                    s.push('"');
                    s.push_str(&a.replace('"', "\\\""));
                    s.push('"');
                } else {
                    s.push_str(a);
                }
            }
            to_wide_null(&s)
        };

        let cwd_wide: Option<Vec<u16>> = cwd.map(|c| to_wide_null(c));
        let env_block = build_env_block(enriched_path);

        let (stdout_r, stdout_w) = create_pipe()?;
        let (stderr_r, stderr_w) = create_pipe()?;
        let (stdin_r,  stdin_w)  = create_pipe()?;

        // Make our ends non-inheritable so child doesn't hold them open
        use windows_sys::Win32::Foundation::SetHandleInformation;
        use windows_sys::Win32::Foundation::HANDLE_FLAG_INHERIT;
        unsafe {
            SetHandleInformation(stdout_r as HANDLE, HANDLE_FLAG_INHERIT, 0);
            SetHandleInformation(stderr_r as HANDLE, HANDLE_FLAG_INHERIT, 0);
            SetHandleInformation(stdin_w  as HANDLE, HANDLE_FLAG_INHERIT, 0);
        }

        let mut si: STARTUPINFOW = unsafe { std::mem::zeroed() };
        si.cb          = std::mem::size_of::<STARTUPINFOW>() as u32;
        si.dwFlags     = 0x00000100; // STARTF_USESTDHANDLES
        si.hStdInput   = stdin_r  as HANDLE;
        si.hStdOutput  = stdout_w as HANDLE;
        si.hStdError   = stderr_w as HANDLE;

        let mut pi: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };

        let ok = unsafe {
            CreateProcessW(
                std::ptr::null(),                                    // lpApplicationName
                cmdline.as_ptr() as *mut u16,                        // lpCommandLine
                std::ptr::null_mut(),                                // lpProcessAttributes
                std::ptr::null_mut(),                                // lpThreadAttributes
                1,                                                   // bInheritHandles = TRUE
                CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,       // dwCreationFlags
                env_block.as_ptr() as *mut _,                        // lpEnvironment
                cwd_wide.as_ref().map_or(std::ptr::null(), |v| v.as_ptr()), // lpCurrentDirectory
                &si,
                &mut pi,
            )
        };

        // Close child-side pipe ends in parent
        unsafe {
            CloseHandle(stdout_w as HANDLE);
            CloseHandle(stderr_w as HANDLE);
            CloseHandle(stdin_r  as HANDLE);
            CloseHandle(pi.hThread);
        }

        if ok == 0 {
            unsafe {
                CloseHandle(stdout_r as HANDLE);
                CloseHandle(stderr_r as HANDLE);
                CloseHandle(stdin_w  as HANDLE);
            }
            return Err(io::Error::last_os_error());
        }

        Ok(WinProcess {
            pid:         pi.dwProcessId,
            handle:      pi.hProcess as isize,
            stdin_pipe:  stdin_w,
            stdout_pipe: stdout_r,
            stderr_pipe: stderr_r,
        })
    }

    pub fn wait_process(handle: isize) -> u32 {
        use windows_sys::Win32::System::Threading::WaitForSingleObject;
        use windows_sys::Win32::System::Threading::GetExitCodeProcess;
        unsafe {
            WaitForSingleObject(handle as HANDLE, 0xFFFFFFFF); // INFINITE
            let mut code: u32 = 1;
            GetExitCodeProcess(handle as HANDLE, &mut code);
            CloseHandle(handle as HANDLE);
            code
        }
    }

    pub fn read_pipe_to_string(handle: isize) -> String {
        use std::os::windows::io::FromRawHandle;
        use std::io::Read;
        let mut f = unsafe { std::fs::File::from_raw_handle(handle as *mut _) };
        let mut out = String::new();
        let _ = f.read_to_string(&mut out);
        // File::drop closes the handle automatically
        out
    }

    pub fn kill(pid: u32) {
        use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
        unsafe {
            let h = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if h != 0 { TerminateProcess(h, 1); CloseHandle(h); }
        }
    }
}



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

type ProcessMap = Arc<Mutex<HashMap<u32, Box<dyn Write + Send>>>>;

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

    #[cfg(windows)]
    { c.env("PATH", enriched_path()); }
    #[cfg(not(windows))]
    c.env("TERM", "dumb").env("COLORTERM", "");

    if let Some(dir) = &cwd { c.current_dir(dir); }

    let mut child = c.spawn()
        .map_err(|e| format!("Failed to spawn shell '{}': {}", shell_path, e))?;

    let pid   = child.id();
    let stdin  = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    { state.processes.lock().unwrap().insert(pid, Box::new(stdin) as Box<dyn Write + Send>); }

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
    let raw = resolve_cmd(&normalise_cmd(&cmd));
    dbg(&format!("[run_shell] exe={:?} args={:?} cwd={:?}", raw, args, cwd));

    #[cfg(windows)]
    {
        let path = enriched_path();
        let proc = win_spawn::spawn(&raw, &args, cwd.as_deref(), &path)
            .map_err(|e| format!("Failed to run '{}': {} (os={:?})", raw, e, e.raw_os_error()))?;
        let result = tokio::task::spawn_blocking(move || {
            let out  = win_spawn::read_pipe_to_string(proc.stdout_pipe);
            let err  = win_spawn::read_pipe_to_string(proc.stderr_pipe);
            unsafe { windows_sys::Win32::Foundation::CloseHandle(proc.stdin_pipe as _); }
            let code = win_spawn::wait_process(proc.handle);
            (out, err, code)
        }).await.map_err(|e| format!("task error: {}", e))?;
        let (out, err, code) = result;
        if code == 0 { Ok(if out.trim().is_empty() { err } else { out }) }
        else         { Err(if err.trim().is_empty() { out } else { err }) }
    }
    #[cfg(not(windows))]
    {
        let mut c = Command::new(&raw);
        c.args(&args);
        if let Some(dir) = &cwd { c.current_dir(dir); }
        let output = c.output().map_err(|e| format!("Failed to run '{}': {}", raw, e))?;
        let out = String::from_utf8_lossy(&output.stdout).to_string();
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        if output.status.success() { Ok(if out.trim().is_empty() { err } else { out }) }
        else                       { Err(if err.trim().is_empty() { out } else { err }) }
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
// On Windows, Command::new("tsuki") resolves the executable using the *current*
// process PATH, BEFORE any .env("PATH", enriched) takes effect.  We must
// manually find the full path using where.exe with our enriched PATH first.
#[cfg(windows)]
fn resolve_cmd(cmd: &str) -> String {
    // Already an absolute path — nothing to do
    let is_absolute = cmd.starts_with('\\')
        || cmd.starts_with('/')
        || (cmd.len() > 2 && cmd.chars().nth(1) == Some(':'));
    if is_absolute { return cmd.to_string(); }

    // Try where.exe with the enriched PATH
    if let Ok(out) = Command::new("where")
        .no_window()
        .env("PATH", enriched_path())
        .arg(cmd)
        .output()
    {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout);
            if let Some(line) = s.lines().next() {
                let p = line.trim().to_string();
                if !p.is_empty() {
                    dbg(&format!("[resolve_cmd] {} -> {}", cmd, p));
                    return p;
                }
            }
        }
    }

    // Fallback: return as-is and let the OS try
    cmd.to_string()
}
#[cfg(not(windows))]
fn resolve_cmd(cmd: &str) -> String { cmd.to_string() }


#[tauri::command]
async fn spawn_process(
    window:   Window,
    state:    tauri::State<'_, AppState>,
    cmd:      String,
    args:     Vec<String>,
    cwd:      Option<String>,
    event_id: String,
) -> Result<u32, String> {
    let raw = resolve_cmd(&normalise_cmd(&cmd));
    dbg(&format!("[spawn_process] exe={:?} args={:?} cwd={:?}", raw, args, cwd));
    dbg(&format!("[spawn_process] exists={}", std::path::Path::new(&raw).exists()));

    #[cfg(windows)]
    {
        let path = enriched_path();
        let proc = win_spawn::spawn(&raw, &args, cwd.as_deref(), &path)
            .map_err(|e| {
                let exists = std::path::Path::new(&raw).exists();
                format!("command {:?} failed: {} (os={:?}, exists={})", raw, e, e.raw_os_error(), exists)
            })?;

        let pid        = proc.pid;
        let handle     = proc.handle;
        let stdin_pipe = proc.stdin_pipe;
        let stdout_r   = proc.stdout_pipe;
        let stderr_r   = proc.stderr_pipe;

        // Store stdin write-end so write_stdin can use it
        {
            // We repurpose the existing ProcessMap to store a fake stdin writer.
            // On Windows we bypass std::process so we wrap the raw HANDLE in a
            // File so we can implement Write on it.
            use std::os::windows::io::FromRawHandle;
            let stdin_file = unsafe { std::fs::File::from_raw_handle(stdin_pipe as *mut _) };
            state.processes.lock().unwrap().insert(pid, Box::new(stdin_file) as Box<dyn Write + Send>);
        }

        let (eid_out, eid_err, eid_done) = (event_id.clone(), event_id.clone(), event_id.clone());
        let (win_out, win_err, win_done) = (window.clone(), window.clone(), window.clone());

        std::thread::spawn(move || {
            use std::os::windows::io::FromRawHandle;
            use std::io::{BufRead, BufReader};
            let f = unsafe { std::fs::File::from_raw_handle(stdout_r as *mut _) };
            for line in BufReader::new(f).lines().flatten() {
                let _ = win_out.emit(&format!("proc://{}:stdout", eid_out), line);
            }
        });

        std::thread::spawn(move || {
            use std::os::windows::io::FromRawHandle;
            use std::io::{BufRead, BufReader};
            let f = unsafe { std::fs::File::from_raw_handle(stderr_r as *mut _) };
            for line in BufReader::new(f).lines().flatten() {
                let _ = win_err.emit(&format!("proc://{}:stderr", eid_err), line);
            }
        });

        let processes = Arc::clone(&state.processes);
        std::thread::spawn(move || {
            let code = win_spawn::wait_process(handle);
            processes.lock().unwrap().remove(&pid);
            let _ = win_done.emit(&format!("proc://{}:done", eid_done), code);
        });

        Ok(pid)
    }
    #[cfg(not(windows))]
    {
        let mut c = Command::new(&raw).no_window();
        c.args(&args)
         .stdin(Stdio::piped())
         .stdout(Stdio::piped())
         .stderr(Stdio::piped());
        if let Some(dir) = &cwd { c.current_dir(dir); }

        let mut child = c.spawn().map_err(|e| {
            let exists = std::path::Path::new(&raw).exists();
            format!("command {:?} not found (exists={}): {}", raw, exists, e)
        })?;

        let pid    = child.id();
        let stdin  = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();

        { state.processes.lock().unwrap().insert(pid, Box::new(stdin) as Box<dyn Write + Send>); }

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
}

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
    { win_spawn::kill(pid); }
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

/// Resolves a tsuki tool binary using a priority chain:
///   1. Explicit setting key (if set and file exists on disk)
///   2. Sibling of the configured tsukiPath binary
///   3. Auto-detected via where/which in the enriched PATH
///   4. Bare name as last resort (let the OS resolve it)
fn resolve_tsuki_tool(app: &tauri::AppHandle, setting_key: &str, bin_name: &str) -> String {
    let ext = if cfg!(windows) { ".exe" } else { "" };

    // 1. Explicit setting
    let explicit = read_setting_or(app, setting_key, "");
    if !explicit.is_empty() && explicit != bin_name {
        let p = std::path::Path::new(&explicit);
        if p.exists() {
            dbg(&format!("[resolve_tsuki_tool] {} → explicit setting: {}", bin_name, explicit));
            return explicit;
        }
        dbg(&format!("[resolve_tsuki_tool] {} → explicit setting path not found: {}", bin_name, explicit));
    }

    // 2. Sibling of tsukiPath
    let tsuki_path = read_setting_or(app, "tsukiPath", "");
    if !tsuki_path.is_empty() {
        let p = std::path::Path::new(&tsuki_path);
        if let Some(dir) = p.parent() {
            let candidate = dir.join(format!("{}{}", bin_name, ext));
            if candidate.exists() {
                let s = candidate.to_string_lossy().into_owned();
                dbg(&format!("[resolve_tsuki_tool] {} → sibling of tsukiPath: {}", bin_name, s));
                return s;
            }
        }
    }

    // 3. Auto-detect via where/which with enriched PATH
    #[cfg(windows)]
    {
        if let Ok(out) = Command::new("where")
            .no_window()
            .env("PATH", enriched_path())
            .arg(bin_name)
            .output()
        {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                if let Some(line) = stdout.lines().next() {
                    let found = line.trim().to_string();
                    if !found.is_empty() && std::path::Path::new(&found).exists() {
                        dbg(&format!("[resolve_tsuki_tool] {} → where.exe found: {}", bin_name, found));
                        return found;
                    }
                }
            }
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(out) = Command::new("which").no_window().arg(bin_name).output() {
            if out.status.success() {
                let found = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !found.is_empty() {
                    dbg(&format!("[resolve_tsuki_tool] {} → which found: {}", bin_name, found));
                    return found;
                }
            }
        }
    }

    // 4. Bare name — let the OS resolve at spawn time
    dbg(&format!("[resolve_tsuki_tool] {} → falling back to bare name", bin_name));
    bin_name.to_string()
}

/// Returns the configured tsuki-core binary path.
#[tauri::command]
async fn get_tsuki_core_bin(app: tauri::AppHandle) -> String {
    resolve_tsuki_tool(&app, "tsukiCorePath", "tsuki-core")
}

/// Returns the configured tsuki-sim binary path.
#[tauri::command]
async fn get_tsuki_sim_bin(app: tauri::AppHandle) -> String {
    resolve_tsuki_tool(&app, "tsukiSimPath", "tsuki-sim")
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
            get_tmp_go_path,
            get_tsuki_bin,
            get_tsuki_core_bin,
            get_tsuki_sim_bin,
            get_default_board,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            { app.get_window("main").unwrap().open_devtools(); }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}