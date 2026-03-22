// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: serial_monitor  —  interactive serial port monitor
//
//  Opens a serial port and streams bidirectionally:
//    board → stdout  (RX thread)
//    stdin → board   (TX thread / main loop)
//
//  Exit: Ctrl+C  or  type `\q` and press Enter.
//
//  Usage (CLI):
//    tsuki-flash monitor --port /dev/ttyUSB0 --baud 9600
//    tsuki-flash monitor --board uno                      # auto-detects port
// ─────────────────────────────────────────────────────────────────────────────

use std::io::{self, BufRead, Write};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use serialport::SerialPort;

use crate::error::{FlashError, Result};

/// Configuration for the serial monitor session.
#[derive(Debug)]
pub struct MonitorConfig {
    /// Serial port path (e.g. "/dev/ttyUSB0", "COM3").
    pub port:  String,
    /// Baud rate. Common values: 9600, 115200.
    pub baud:  u32,
    /// When true, print raw bytes as hex alongside ASCII.
    pub raw:   bool,
    /// When true, suppress the header/footer banner.
    pub quiet: bool,
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self { port: String::new(), baud: 9600, raw: false, quiet: false }
    }
}

/// Open the serial port and run the monitor until Ctrl+C or `\q`.
///
/// The function blocks until the session ends.  The port is flushed and
/// closed automatically when this function returns (RAII via `serialport`).
pub fn run(cfg: &MonitorConfig) -> Result<()> {
    let port = serialport::new(&cfg.port, cfg.baud)
        .timeout(Duration::from_millis(10))
        .open()
        .map_err(|e| FlashError::Other(format!(
            "Cannot open serial port '{}' at {} baud: {}\n  \
             Hint: check the port is not in use and you have permission (try: sudo chmod a+rw {})",
            cfg.port, cfg.baud, e, cfg.port
        )))?;

    if !cfg.quiet {
        println!(
            "{}  port: {}  baud: {}  (type \\q + Enter to quit, or Ctrl+C)",
            "─".repeat(60),
            cfg.port,
            cfg.baud,
        );
    }

    // Shared flag — set when either thread decides to exit.
    let stop = Arc::new(AtomicBool::new(false));

    // ── RX thread: board → stdout ─────────────────────────────────────────
    let rx_port  = port.try_clone().map_err(|e| FlashError::Other(
        format!("Failed to clone serial port handle: {}", e)
    ))?;
    let rx_stop  = Arc::clone(&stop);
    let raw_mode = cfg.raw;

    let rx_handle = std::thread::Builder::new()
        .name("serial-rx".into())
        .spawn(move || rx_loop(rx_port, rx_stop, raw_mode))
        .map_err(|e| FlashError::Other(format!("Failed to spawn RX thread: {}", e)))?;

    // ── TX loop: stdin → board (main thread) ─────────────────────────────
    {
        let mut tx_port = port;
        let stdin = io::stdin();
        let stop_tx = Arc::clone(&stop);

        for line in stdin.lock().lines() {
            if stop_tx.load(Ordering::Relaxed) {
                break;
            }
            match line {
                Ok(text) => {
                    if text.trim() == r"\q" {
                        stop_tx.store(true, Ordering::Relaxed);
                        break;
                    }
                    // Send the line with a CRLF terminator (what most Arduino
                    // sketches using Serial.readStringUntil('\n') expect).
                    let to_send = format!("{}\r\n", text);
                    if let Err(e) = tx_port.write_all(to_send.as_bytes()) {
                        eprintln!("[monitor] TX error: {}", e);
                        stop_tx.store(true, Ordering::Relaxed);
                        break;
                    }
                    let _ = tx_port.flush();
                }
                Err(e) => {
                    // EOF on stdin (pipe closed, script ended)
                    if e.kind() != io::ErrorKind::UnexpectedEof {
                        eprintln!("[monitor] stdin error: {}", e);
                    }
                    stop_tx.store(true, Ordering::Relaxed);
                    break;
                }
            }
        }
        stop.store(true, Ordering::Relaxed);
    }

    // Wait for RX thread to finish
    let _ = rx_handle.join();

    if !cfg.quiet {
        println!("\n{}", "─".repeat(60));
        println!("[monitor] session ended.");
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
//  RX thread
// ─────────────────────────────────────────────────────────────────────────────

fn rx_loop(mut port: Box<dyn SerialPort>, stop: Arc<AtomicBool>, raw: bool) {
    let stdout = io::stdout();
    let mut buf = [0u8; 256];
    let mut line_buf: Vec<u8> = Vec::with_capacity(256);

    while !stop.load(Ordering::Relaxed) {
        match port.read(&mut buf) {
            Ok(0) => {
                // No data — tight-poll with a small sleep to avoid 100% CPU.
                std::thread::sleep(Duration::from_millis(1));
            }
            Ok(n) => {
                let chunk = &buf[..n];
                if raw {
                    // Raw mode: print hex + printable ASCII side by side.
                    let hex: String = chunk.iter().map(|b| format!("{:02X} ", b)).collect();
                    let ascii: String = chunk.iter()
                        .map(|&b| if b.is_ascii_graphic() || b == b' ' { b as char } else { '.' })
                        .collect();
                    let mut out = stdout.lock();
                    let _ = writeln!(out, "{} | {}", hex.trim_end(), ascii);
                } else {
                    // Normal mode: accumulate into lines, flush on newline.
                    for &byte in chunk {
                        if byte == b'\n' {
                            // Strip trailing CR if present (common on Arduino)
                            if line_buf.last() == Some(&b'\r') {
                                line_buf.pop();
                            }
                            let text = String::from_utf8_lossy(&line_buf);
                            let mut out = stdout.lock();
                            let _ = writeln!(out, "{}", text);
                            line_buf.clear();
                        } else {
                            line_buf.push(byte);
                        }
                    }
                }
            }
            Err(ref e) if e.kind() == io::ErrorKind::TimedOut => {
                // Expected: the port's read timeout fired with no data.
            }
            Err(e) => {
                // Real error (e.g. device disconnected)
                eprintln!("\n[monitor] RX error: {}", e);
                stop.store(true, Ordering::Relaxed);
                break;
            }
        }
    }

    // Flush any partial line that didn't end with '\n'
    if !line_buf.is_empty() {
        let text = String::from_utf8_lossy(&line_buf);
        let mut out = stdout.lock();
        let _ = write!(out, "{}", text);
    }
}