// ─────────────────────────────────────────────────────────────────────────────
//  pty_session.rs  —  Real PTY sessions using portable-pty
// ─────────────────────────────────────────────────────────────────────────────

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::Window;

use crate::{
    dbg_cat, fmt_entry, write_to_log, debug_log_path, now_ts,
    LOG_CAT_PTY,
};

// ── Session registry ──────────────────────────────────────────────────────────

struct PtyEntry {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

pub struct PtyState {
    sessions: Mutex<HashMap<String, PtyEntry>>,
}

impl PtyState {
    pub fn new() -> Self {
        PtyState { sessions: Mutex::new(HashMap::new()) }
    }
}

// ── pty_create ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn pty_create(
    window:  Window,
    state:   tauri::State<'_, PtyState>,
    id:      String,
    // NOTE: parameter is named 'shell_cmd' not 'cmd' — Tauri 1.x uses the
    // field name 'cmd' in the IPC payload for command dispatch. If we name
    // this parameter 'cmd', the shell path overwrites the dispatch key and
    // Tauri returns "command <shell_path> not found" instead of routing to
    // this handler. The frontend passes it as 'shellCmd' to match.
    shell_cmd: String,
    args:    Vec<String>,
    cwd:     Option<String>,
    cols:    u16,
    rows:    u16,
    env:     Option<Vec<[String; 2]>>,
) -> Result<(), String> {
    let cmd = shell_cmd;
    // ── Unconditional START log (write_to_log bypasses AtomicBool category gates)
    {
        let line = fmt_entry(now_ts(), "rust", "log", &format!(
            "[pty_create] START id={} cmd={:?} args={:?} cwd={:?} cols={} rows={}",
            id, cmd, args, cwd, cols, rows
        ));
        write_to_log(&line, &debug_log_path());
    }

    let pty_system = native_pty_system();

    // ── Resolve the command ──────────────────────────────────────────────────
    // Do NOT canonicalize — it produces a \\?\\ UNC prefix that ConPTY cannot handle.
    let resolved_cmd: String = {
        let p = std::path::Path::new(&cmd);
        if p.is_absolute() {
            #[cfg(windows)]
            { cmd.replace('/', "\\") }
            #[cfg(not(windows))]
            { cmd.clone() }
        } else {
            which::which(&cmd)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|_| cmd.clone())
        }
    };

    // ── Pre-spawn metadata snapshot ──────────────────────────────────────────
    // Captured BEFORE openpty so we know what the FS sees at call time.
    let pre_meta_s = match std::path::Path::new(&resolved_cmd).metadata() {
        Ok(m)  => format!("ok(len={}, readonly={})", m.len(), m.permissions().readonly()),
        Err(e) => format!("err(kind={:?}, os={:?})", e.kind(), e.raw_os_error()),
    };
    let pre_exists = std::path::Path::new(&resolved_cmd).exists();
    {
        let line = fmt_entry(now_ts(), "rust", if pre_exists { "log" } else { "warn" },
            &format!("[pty_create] pre_check path={:?} exists={} metadata={}",
                resolved_cmd, pre_exists, pre_meta_s));
        write_to_log(&line, &debug_log_path());
    }

    // ── Open PTY pair ────────────────────────────────────────────────────────
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| {
            let msg = format!("openpty failed: {e}");
            let line = fmt_entry(now_ts(), "rust", "error",
                &format!("[pty_create] OPENPTY FAILED: {}", msg));
            write_to_log(&line, &debug_log_path());
            msg
        })?;

    // ── Build command ────────────────────────────────────────────────────────
    let mut cb = CommandBuilder::new(&resolved_cmd);
    for a in &args { cb.arg(a); }

    // cwd — use the requested dir if it exists, otherwise fall back to TEMP.
    // On Windows, inheriting a non-existent parent CWD from the Tauri process
    // causes CreateProcess to return ERROR_FILE_NOT_FOUND (os_error=2) even
    // when the shell exe itself is fine. Explicitly passing a valid cwd breaks
    // the inheritance chain and prevents the error.
    let fallback_cwd = std::env::var("TEMP")
        .or_else(|_| std::env::var("TMP"))
        .unwrap_or_else(|_| "C:\\Windows\\Temp".into());
    let cwd_status = if let Some(dir) = &cwd {
        if std::path::Path::new(dir).is_dir() {
            cb.cwd(dir);
            format!("set={:?}", dir)
        } else {
            cb.cwd(&fallback_cwd);
            format!("FALLBACK_TEMP={:?} (requested={:?} not found)", fallback_cwd, dir)
        }
    } else {
        cb.cwd(&fallback_cwd);
        format!("FALLBACK_TEMP={:?}", fallback_cwd)
    };
    {
        let line = fmt_entry(now_ts(), "rust", "log",
            &format!("[pty_create] cwd_status={}", cwd_status));
        write_to_log(&line, &debug_log_path());
    }

    cb.env("TERM", "xterm-256color");

    #[cfg(windows)]
    {
        let base     = std::env::var("PATH").unwrap_or_default();
        let home     = std::env::var("USERPROFILE").unwrap_or_default();
        let lappdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let extras = [
            format!("{}\\Programs\\tsuki\\bin", lappdata),
            format!("{}\\scoop\\shims", home),
            format!("{}\\AppData\\Local\\Microsoft\\WindowsApps", home),
            format!("{}\\go\\bin", home),
            r"C:\Program Files\Git\usr\bin".to_string(),
            r"C:\Program Files\Git\bin".to_string(),
        ];
        let mut parts: Vec<&str> = base.split(';').collect();
        let mut added = 0usize;
        for e in &extras {
            if !e.is_empty() && !parts.iter().any(|p| p.eq_ignore_ascii_case(e.as_str())) {
                parts.push(e.as_str());
                added += 1;
            }
        }
        let line = fmt_entry(now_ts(), "rust", "log",
            &format!("[pty_create] PATH enriched +{} entries", added));
        write_to_log(&line, &debug_log_path());
        cb.env("PATH", parts.join(";"));
    }

    if let Some(pairs) = &env {
        let line = fmt_entry(now_ts(), "rust", "log",
            &format!("[pty_create] env_overrides count={}", pairs.len()));
        write_to_log(&line, &debug_log_path());
        for [k, v] in pairs { cb.env(k, v); }
    }

    // ── Spawn ────────────────────────────────────────────────────────────────
    {
        let line = fmt_entry(now_ts(), "rust", "log",
            &format!("[pty_create] about_to_spawn cmd={:?} cwd_status={}", resolved_cmd, cwd_status));
        write_to_log(&line, &debug_log_path());
    }
    let mut child: Box<dyn Child + Send + Sync> = pair.slave
        .spawn_command(cb)
        .map_err(|e| {
            // Downcast anyhow::Error → std::io::Error to get the OS code.
            //   os_error=2  → file not found (path wrong, WoW64, or bad cwd)
            //   os_error=5  → access denied
            //   os_error=87 → invalid parameter (malformed cwd or arg)
            let os_note = e.downcast_ref::<std::io::Error>()
                .and_then(|io| io.raw_os_error())
                .map(|c| format!(" (os_error={})", c))
                .unwrap_or_default();
            let post_exists  = std::path::Path::new(&resolved_cmd).exists();
            let post_meta_s  = match std::path::Path::new(&resolved_cmd).metadata() {
                Ok(m)   => format!("ok(len={})", m.len()),
                Err(me) => format!("err(kind={:?}, os={:?})", me.kind(), me.raw_os_error()),
            };
            let msg = format!(
                "spawn failed for \'{}\'{os_note}: {e} | pre_exists={pre_exists} post_exists={post_exists} pre_meta={pre_meta_s} post_meta={post_meta_s} cwd_status={cwd_status}",
                resolved_cmd,
            );
            let line = fmt_entry(now_ts(), "rust", "error", &format!(
                "[pty_create] SPAWN_FAILED cmd={:?}{os_note} pre_exists={pre_exists} post_exists={post_exists} cwd_status={cwd_status} err={e}",
                resolved_cmd,
            ));
            write_to_log(&line, &debug_log_path());
            msg
        })?;

    dbg_cat(&LOG_CAT_PTY, &format!("[pty_create] spawned ok id={}", id));

    drop(pair.slave);

    let master = pair.master;
    let writer = master.take_writer().map_err(|e| format!("take_writer: {e}"))?;
    let mut reader = master.try_clone_reader().map_err(|e| format!("clone_reader: {e}"))?;

    // Reader thread — forwards raw PTY bytes to the frontend as Tauri events
    let id_r  = id.clone();
    let win_r = window.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = win_r.emit(&format!("pty://{}:data", id_r), &data);
                }
            }
        }
        dbg_cat(&LOG_CAT_PTY, &format!("[pty_reader_done] id={}", id_r));
    });

    // Exit-watcher thread
    let id_e  = id.clone();
    let win_e = window.clone();
    std::thread::spawn(move || {
        let code = child.wait()
            .map(|s| s.exit_code() as i32)
            .unwrap_or(-1);
        dbg_cat(&LOG_CAT_PTY, &format!("[pty_exit] id={} exit_code={}", id_e, code));
        let _ = win_e.emit(&format!("pty://{}:exit", id_e), code);
    });

    state.sessions.lock().unwrap().insert(id, PtyEntry { master, writer });
    Ok(())
}

// ── pty_write ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn pty_write(
    state: tauri::State<'_, PtyState>,
    id:    String,
    data:  String,
) -> Result<(), String> {
    // Log only first 80 chars — avoid flooding log with every keystroke
    dbg_cat(&LOG_CAT_PTY, &format!(
        "[pty_write] id={} bytes={} preview={:?}",
        id, data.len(), data.chars().take(80).collect::<String>()
    ));
    let mut sessions = state.sessions.lock().unwrap();
    let entry = sessions.get_mut(&id).ok_or_else(|| format!("no PTY '{id}'"))?;
    entry.writer.write_all(data.as_bytes()).map_err(|e| format!("pty_write: {e}"))?;
    entry.writer.flush().map_err(|e| format!("pty_flush: {e}"))?;
    Ok(())
}

// ── pty_resize ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn pty_resize(
    state: tauri::State<'_, PtyState>,
    id:    String,
    cols:  u16,
    rows:  u16,
) -> Result<(), String> {
    dbg_cat(&LOG_CAT_PTY, &format!("[pty_resize] id={} cols={} rows={}", id, cols, rows));
    let sessions = state.sessions.lock().unwrap();
    let entry = sessions.get(&id).ok_or_else(|| format!("no PTY '{id}'"))?;
    entry.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("pty_resize: {e}"))?;
    Ok(())
}

// ── pty_kill ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn pty_kill(
    state: tauri::State<'_, PtyState>,
    id:    String,
) -> Result<(), String> {
    dbg_cat(&LOG_CAT_PTY, &format!("[pty_kill] id={}", id));
    state.sessions.lock().unwrap().remove(&id);
    Ok(())
}