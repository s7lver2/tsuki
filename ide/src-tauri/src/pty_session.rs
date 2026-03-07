// ─────────────────────────────────────────────────────────────────────────────
//  pty_session.rs  —  Real PTY sessions using portable-pty
//
//  Architecture (same as VSCode's terminal):
//
//    Frontend (xterm.js)          Tauri IPC          Rust (portable-pty)
//    ─────────────────            ─────────          ───────────────────
//    term.write(data)  ◄──── pty://<id>:data ◄────  reader thread
//    term.onData ──────────► pty_write cmd   ──────► writer (PTY stdin)
//    FitAddon resize ──────► pty_resize cmd  ──────► master.resize()
//                             pty://<id>:exit ◄────  exit watcher thread
//
//  Why PTY and not Stdio::piped():
//  ─────────────────────────────────────────────────────────────────────────
//  • PTY (pseudo-terminal) makes child processes believe they're talking to
//    a real terminal.  Programs like gcc, go, cargo detect this via isatty()
//    and disable output buffering — every line flushes immediately.
//  • With anonymous pipes (piped()) the CRT buffers 4–8 KB before flushing,
//    so you see nothing until the process exits.  PTY eliminates this.
//  • ANSI colour codes are emitted because the child sees TERM=xterm-256color.
//  • On Windows, portable-pty uses ConPTY (Windows 10 1809+), the same API
//    that VSCode and Windows Terminal use.
//
//  Tauri commands:
//    pty_create(id, cmd, args, cwd, cols, rows, env)  → Result<(), String>
//    pty_write(id, data)                              → Result<(), String>
//    pty_resize(id, cols, rows)                       → Result<(), String>
//    pty_kill(id)                                     → Result<(), String>
// ─────────────────────────────────────────────────────────────────────────────

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::Window;

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

/// Spawn a process inside a real PTY.
///
/// `env` is a list of `[key, value]` pairs to add/override on top of the
/// inherited environment.  Pass `null` (None) to use the current env as-is.
#[tauri::command]
pub async fn pty_create(
    window:  Window,
    state:   tauri::State<'_, PtyState>,
    id:      String,
    cmd:     String,
    args:    Vec<String>,
    cwd:     Option<String>,
    cols:    u16,
    rows:    u16,
    env:     Option<Vec<[String; 2]>>,  // [[key, value], …]
) -> Result<(), String> {
    let pty_system = native_pty_system();

    // ── Resolve the command to an absolute path ───────────────────────────────
    // portable-pty does not search PATH the same way the OS shell does.
    // If the caller passed a bare name (e.g. "cmd.exe", "bash"), resolve it
    // with `which` first so the spawn never fails with "command not found".
    let resolved_cmd = if std::path::Path::new(&cmd).is_absolute() {
        cmd.clone()
    } else {
        which::which(&cmd)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| cmd.clone())
    };

    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("openpty: {e}"))?;

    // ── Build command ────────────────────────────────────────────────────────
    let mut cb = CommandBuilder::new(&resolved_cmd);
    for a in &args { cb.arg(a); }
    if let Some(dir) = &cwd { cb.cwd(dir); }

    // Always set TERM so programs emit colour and flush per-line
    cb.env("TERM", "xterm-256color");

    // Apply caller-supplied overrides
    if let Some(pairs) = env {
        for [k, v] in pairs { cb.env(k, v); }
    }

    // Spawn inside the slave side of the PTY
    let mut child: Box<dyn Child + Send + Sync> = pair.slave
        .spawn_command(cb)
        .map_err(|e| format!("spawn '{}' (resolved from '{}'): {e}", resolved_cmd, cmd))?;

    drop(pair.slave);   // we only need the master from here on

    let master = pair.master;
    let writer = master.take_writer().map_err(|e| format!("take_writer: {e}"))?;
    let mut reader = master.try_clone_reader().map_err(|e| format!("clone_reader: {e}"))?;

    // ── Reader thread: PTY output → Tauri event ──────────────────────────────
    // Raw bytes are forwarded as-is — xterm.js handles ANSI, cursor, colour.
    // Chunks arrive as fast as the PTY flushes them (per-line for interactive
    // shells, per-write for compiled programs).  No buffering on our side.
    let id_r = id.clone();
    let win_r = window.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    // Send as UTF-8 lossy (xterm.js expects strings in Tauri v1)
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = win_r.emit(&format!("pty://{}:data", id_r), &data);
                }
            }
        }
    });

    // ── Exit-watcher thread ───────────────────────────────────────────────────
    let id_e = id.clone();
    let win_e = window.clone();
    std::thread::spawn(move || {
        let code = child.wait()
            .map(|s| s.exit_code() as i32)
            .unwrap_or(-1);
        let _ = win_e.emit(&format!("pty://{}:exit", id_e), code);
    });

    state.sessions.lock().unwrap().insert(id, PtyEntry { master, writer });
    Ok(())
}

// ── pty_write ─────────────────────────────────────────────────────────────────

/// Write raw bytes (keystrokes, paste, escape sequences) into the PTY stdin.
#[tauri::command]
pub async fn pty_write(
    state: tauri::State<'_, PtyState>,
    id:    String,
    data:  String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let entry = sessions.get_mut(&id).ok_or_else(|| format!("no PTY '{id}'"))?;
    entry.writer.write_all(data.as_bytes()).map_err(|e| format!("pty_write: {e}"))?;
    entry.writer.flush().map_err(|e| format!("pty_flush: {e}"))?;
    Ok(())
}

// ── pty_resize ────────────────────────────────────────────────────────────────

/// Notify the PTY of a terminal resize (triggers SIGWINCH on Unix).
#[tauri::command]
pub async fn pty_resize(
    state: tauri::State<'_, PtyState>,
    id:    String,
    cols:  u16,
    rows:  u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let entry = sessions.get(&id).ok_or_else(|| format!("no PTY '{id}'"))?;
    entry.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("pty_resize: {e}"))?;
    Ok(())
}

// ── pty_kill ──────────────────────────────────────────────────────────────────

/// Kill a PTY session by closing the master — sends SIGHUP to the child.
#[tauri::command]
pub async fn pty_kill(
    state: tauri::State<'_, PtyState>,
    id:    String,
) -> Result<(), String> {
    state.sessions.lock().unwrap().remove(&id);
    // Dropping the entry closes master fd → SIGHUP to child process group
    Ok(())
}