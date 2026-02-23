// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: detect  —  serial port / board detection
//
//  Zero external dependencies — no libudev, no pkg-config, no system libs.
//
//  Strategy per OS:
//
//  Linux / WSL
//    Enumerate /sys/class/tty/.  For each entry that is a USB tty (ttyUSB*,
//    ttyACM*), walk the sysfs device tree upward until we find idVendor /
//    idProduct files.  The resulting /dev/<name> port is reported with a
//    VID:PID pair that we match against the board table.
//
//  macOS
//    List /dev/cu.* and /dev/tty.* that contain "usb" or "serial" in their
//    name.  For VID:PID we run `ioreg -r -c IOUSBHostDevice -l` (a standard
//    macOS tool, always present, no install required) and parse its output.
//
//  Windows / WSL-2
//    Enumerate COM ports from the Windows registry via the WMIC command
//    (`wmic path Win32_SerialPort get DeviceID,PNPDeviceID`).  WMIC is
//    available on every Windows install and parses VID/PID out of the
//    PNPDeviceID string (e.g. USB\VID_1A86&PID_7523\...).
//    In WSL-2 with usbipd-win the ports appear as /dev/ttyUSB* and the Linux
//    sysfs path works instead.
// ─────────────────────────────────────────────────────────────────────────────

use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct DetectedPort {
    pub port:       String,
    pub board_id:   Option<&'static str>,
    pub board_name: Option<&'static str>,
    pub vid_pid:    Option<(u16, u16)>,
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────────────────────

/// Enumerate all serial ports, tagging each with a board guess if possible.
pub fn detect_all() -> Vec<DetectedPort> {
    let raw = enumerate_raw_ports();
    raw.into_iter().map(|(port, vid_pid)| classify(port, vid_pid)).collect()
}

/// Return the most likely port for flashing (first recognised Arduino port).
pub fn best_port() -> Option<String> {
    let all = detect_all();

    // Prefer a port where we recognised a known board
    if let Some(d) = all.iter().find(|p| p.board_id.is_some()) {
        return Some(d.port.clone());
    }

    // Fall back to first USB-serial-looking port
    all.into_iter()
        .find(|p| looks_like_serial(&p.port))
        .map(|p| p.port)
}

// ─────────────────────────────────────────────────────────────────────────────
//  VID:PID → board table
// ─────────────────────────────────────────────────────────────────────────────

/// (VID, PID) → (board_id, board_name)
///
/// Where a VID:PID is shared by multiple boards (e.g. CH340 appears on Uno,
/// Nano, Mega clones) the entry with the most common board is listed first so
/// that the first match wins.
static VID_PID_MAP: &[(u16, u16, &str, &str)] = &[
    // ── Arduino genuine (VID 0x2341) ──────────────────────────────────────
    (0x2341, 0x0043, "uno",      "Arduino Uno R3"),
    (0x2341, 0x0001, "uno",      "Arduino Uno"),
    (0x2341, 0x0010, "mega",     "Arduino Mega 2560"),
    (0x2341, 0x0042, "mega",     "Arduino Mega 2560"),
    (0x2341, 0x0036, "leonardo", "Arduino Leonardo"),
    (0x2341, 0x8036, "leonardo", "Arduino Leonardo (DFU)"),
    (0x2341, 0x0037, "micro",    "Arduino Micro"),
    (0x2341, 0x8037, "micro",    "Arduino Micro (DFU)"),
    (0x2341, 0x003D, "due",      "Arduino Due (prog)"),
    (0x2341, 0x003E, "due",      "Arduino Due (native)"),
    (0x2341, 0x0057, "uno",      "Arduino Uno R4 Minima"),
    (0x2341, 0x1002, "uno",      "Arduino Uno R4 WiFi"),
    // ── Arduino.org clone VID (0x2A03) ────────────────────────────────────
    (0x2A03, 0x0043, "uno",      "Arduino Uno (org clone)"),
    (0x2A03, 0x0010, "mega",     "Arduino Mega (org clone)"),
    // ── CH340 / CH341 (0x1A86) — most common clone chip ───────────────────
    // Note: CH340 is used on Uno, Nano, Mega, NodeMCU clones.
    // We report "nano" as the most common CH340 product.
    (0x1A86, 0x7523, "nano",     "Arduino Nano / clone (CH340)"),
    (0x1A86, 0x55D4, "esp32",    "ESP32 (CH9102)"),
    (0x1A86, 0x7522, "nano",     "Arduino Nano (CH340C)"),
    // ── FTDI (0x0403) — FT232RL ───────────────────────────────────────────
    (0x0403, 0x6001, "nano",     "Arduino Nano (FT232RL)"),
    (0x0403, 0x6015, "nano",     "Arduino Nano (FT-X)"),
    // ── Silicon Labs CP210x (0x10C4) ──────────────────────────────────────
    (0x10C4, 0xEA60, "esp32",    "ESP32 / ESP8266 (CP2102)"),
    (0x10C4, 0xEA70, "esp32",    "ESP32 (CP2105)"),
    // ── Raspberry Pi RP2040 (0x2E8A) ──────────────────────────────────────
    (0x2E8A, 0x000A, "pico",     "Raspberry Pi Pico"),
    (0x2E8A, 0x0005, "pico",     "Raspberry Pi Pico (MicroPython)"),
    (0x2E8A, 0x000F, "pico",     "Raspberry Pi Pico W"),
];

// ─────────────────────────────────────────────────────────────────────────────
//  Classification
// ─────────────────────────────────────────────────────────────────────────────

fn classify(port: String, vid_pid: Option<(u16, u16)>) -> DetectedPort {
    if let Some((vid, pid)) = vid_pid {
        for (v, p, id, name) in VID_PID_MAP {
            if *v == vid && *p == pid {
                return DetectedPort {
                    port,
                    board_id:   Some(id),
                    board_name: Some(name),
                    vid_pid:    Some((vid, pid)),
                };
            }
        }
        return DetectedPort {
            port,
            board_id:   None,
            board_name: None,
            vid_pid:    Some((vid, pid)),
        };
    }
    DetectedPort { port, board_id: None, board_name: None, vid_pid: None }
}

fn looks_like_serial(port: &str) -> bool {
    port.contains("ttyUSB") || port.contains("ttyACM")
        || port.contains("usbserial") || port.contains("usbmodem")
        || (port.starts_with("COM") && port.len() <= 6)
}

// ─────────────────────────────────────────────────────────────────────────────
//  Platform port enumeration  (zero system-lib dependencies)
// ─────────────────────────────────────────────────────────────────────────────

/// Returns a list of (port_path, Option<(vid, pid)>).
fn enumerate_raw_ports() -> Vec<(String, Option<(u16, u16)>)> {
    #[cfg(target_os = "linux")]
    return linux_enumerate();

    #[cfg(target_os = "macos")]
    return macos_enumerate();

    #[cfg(target_os = "windows")]
    return windows_enumerate();

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    return vec![];
}

// ─── Linux / WSL ─────────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
fn linux_enumerate() -> Vec<(String, Option<(u16, u16)>)> {
    let sysfs = Path::new("/sys/class/tty");
    let mut results = Vec::new();

    let entries = match std::fs::read_dir(sysfs) {
        Ok(e)  => e,
        Err(_) => return results,
    };

    for entry in entries.flatten() {
        let tty_name = entry.file_name().to_string_lossy().to_string();

        // Only care about USB serial devices
        if !tty_name.starts_with("ttyUSB")
            && !tty_name.starts_with("ttyACM")
            && !tty_name.starts_with("ttyS")   // include real COM ports too
        {
            continue;
        }

        let dev_path = format!("/dev/{}", tty_name);
        if !Path::new(&dev_path).exists() { continue; }

        // Resolve the sysfs symlink so we can walk up
        let sysfs_link = sysfs.join(&tty_name);
        let vid_pid = linux_vid_pid_from_sysfs(&sysfs_link);

        // For plain ttyS* with no USB info, skip unless the device file exists
        // and smells like something real (has a non-zero baud-rate driver)
        if tty_name.starts_with("ttyS") && vid_pid.is_none() {
            // Only include ttyS* if there's a driver attached
            if !linux_ttys_has_driver(&tty_name) { continue; }
        }

        results.push((dev_path, vid_pid));
    }

    results.sort_by(|a, b| a.0.cmp(&b.0));
    results
}

/// Read VID / PID by walking the sysfs device tree upward from the tty entry.
///
/// The sysfs tty entry is a symlink like:
///   /sys/class/tty/ttyUSB0 →
///     ../../devices/pci0000:00/…/usb1/1-2/1-2.3/1-2.3:1.0/ttyUSB0/tty/ttyUSB0
///
/// The USB device node (the one with idVendor / idProduct) is an ancestor of
/// the path — typically 3–5 levels up from the tty leaf.
#[cfg(target_os = "linux")]
fn linux_vid_pid_from_sysfs(sysfs_link: &Path) -> Option<(u16, u16)> {
    // Resolve symlink → absolute path inside /sys/devices/…
    let real = std::fs::canonicalize(sysfs_link).ok()?;

    // Walk upward looking for idVendor / idProduct
    let mut dir: &Path = real.parent()?;
    for _ in 0..10 {
        let vid_file = dir.join("idVendor");
        let pid_file = dir.join("idProduct");

        if vid_file.exists() && pid_file.exists() {
            let vid = read_hex_file(&vid_file)?;
            let pid = read_hex_file(&pid_file)?;
            return Some((vid, pid));
        }

        dir = dir.parent()?;
    }
    None
}

/// Read a file containing a 4-digit lowercase hex string (e.g. "1a86\n").
#[cfg(target_os = "linux")]
fn read_hex_file(path: &Path) -> Option<u16> {
    let s = std::fs::read_to_string(path).ok()?;
    u16::from_str_radix(s.trim(), 16).ok()
}

/// Heuristic: a ttyS* port is "real" if it has a driver symlink in sysfs.
#[cfg(target_os = "linux")]
fn linux_ttys_has_driver(tty_name: &str) -> bool {
    let driver = PathBuf::from("/sys/class/tty")
        .join(tty_name)
        .join("device/driver");
    driver.exists()
}

// ─── macOS ───────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn macos_enumerate() -> Vec<(String, Option<(u16, u16)>)> {
    let mut results = Vec::new();

    // List /dev/cu.* — these are the "call-up" (outbound) sides that tools use
    let dev = Path::new("/dev");
    let entries = match std::fs::read_dir(dev) {
        Ok(e)  => e,
        Err(_) => return results,
    };

    let mut cu_ports: Vec<String> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with("cu.") && (
                name.contains("usb") || name.contains("serial")
                    || name.contains("SLAB") || name.contains("usbserial")
                    || name.contains("usbmodem")
            ) {
                Some(format!("/dev/{}", name))
            } else {
                None
            }
        })
        .collect();

    cu_ports.sort();

    // Try to get VID:PID from ioreg (built-in macOS tool, no install required)
    let ioreg_map = macos_ioreg_vid_pid();

    for port in cu_ports {
        let vid_pid = ioreg_map.get(&port).copied();
        results.push((port, vid_pid));
    }

    results
}

/// Run `ioreg -r -c IOUSBHostDevice -l` and build a map of
/// usb_serial_string → (vid, pid).
///
/// This is a best-effort parse; if ioreg is unavailable or its output changes
/// format we just return an empty map — port detection still works, we just
/// won't know the VID:PID.
#[cfg(target_os = "macos")]
fn macos_ioreg_vid_pid() -> std::collections::HashMap<String, (u16, u16)> {
    use std::collections::HashMap;
    let mut map = HashMap::new();

    let out = match std::process::Command::new("ioreg")
        .args(["-r", "-c", "IOUSBHostDevice", "-l"])
        .output()
    {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => return map,
    };

    // Very simple line-by-line parser; ioreg output is stable on macOS
    let mut current_vid: Option<u16> = None;
    let mut current_pid: Option<u16> = None;
    let mut current_ports: Vec<String> = Vec::new();

    for line in out.lines() {
        let line = line.trim();

        if line.contains("\"idVendor\"") {
            current_vid = parse_ioreg_int(line);
        } else if line.contains("\"idProduct\"") {
            current_pid = parse_ioreg_int(line);
        } else if line.contains("\"IODialinDevice\"") || line.contains("\"IOCalloutDevice\"") {
            if let Some(path) = parse_ioreg_str(line) {
                current_ports.push(path);
            }
        } else if line == "}" {
            // End of device block — commit if we have vid+pid+ports
            if let (Some(v), Some(p)) = (current_vid, current_pid) {
                for port in &current_ports {
                    map.insert(port.clone(), (v, p));
                }
            }
            current_vid  = None;
            current_pid  = None;
            current_ports.clear();
        }
    }

    map
}

#[cfg(target_os = "macos")]
fn parse_ioreg_int(line: &str) -> Option<u16> {
    // "idVendor" = 6790  OR  "idVendor" = 0x1A86
    let after_eq = line.split('=').nth(1)?.trim();
    let s = after_eq.split_whitespace().next()?.trim_matches('"');
    if s.starts_with("0x") || s.starts_with("0X") {
        u16::from_str_radix(&s[2..], 16).ok()
    } else {
        s.parse::<u16>().ok()
    }
}

#[cfg(target_os = "macos")]
fn parse_ioreg_str(line: &str) -> Option<String> {
    // "IODialinDevice" = "/dev/tty.usbserial-1420"
    let after_eq = line.split('=').nth(1)?.trim();
    let s = after_eq.trim_matches('"');
    if s.starts_with("/dev/") { Some(s.to_owned()) } else { None }
}

// ─── Windows ─────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn windows_enumerate() -> Vec<(String, Option<(u16, u16)>)> {
    // Use WMIC — available on every Windows install since XP.
    // Output format (CSV):
    //   Node,DeviceID,PNPDeviceID
    //   HOSTNAME,COM3,USB\VID_1A86&PID_7523\5&...
    let out = match std::process::Command::new("wmic")
        .args(["path", "Win32_SerialPort", "get", "DeviceID,PNPDeviceID", "/FORMAT:CSV"])
        .output()
    {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(_) => return windows_enumerate_registry_fallback(),
    };

    let mut results = Vec::new();

    for line in out.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("Node") { continue; }

        let cols: Vec<&str> = line.split(',').collect();
        if cols.len() < 3 { continue; }

        let device_id = cols[1].trim();   // e.g. COM3
        let pnp_id    = cols[2].trim();   // e.g. USB\VID_1A86&PID_7523\...

        if !device_id.starts_with("COM") { continue; }

        let vid_pid = parse_pnp_vid_pid(pnp_id);
        results.push((device_id.to_owned(), vid_pid));
    }

    if results.is_empty() {
        return windows_enumerate_registry_fallback();
    }

    results.sort_by(|a, b| a.0.cmp(&b.0));
    results
}

/// Fallback: read COM port names from the Windows registry (no WMIC needed).
/// This gives port names only, no VID/PID.
#[cfg(target_os = "windows")]
fn windows_enumerate_registry_fallback() -> Vec<(String, Option<(u16, u16)>)> {
    // Read HKLM\HARDWARE\DEVICEMAP\SERIALCOMM
    // Key values look like:  \Device\Serial0 → COM1
    let out = std::process::Command::new("reg")
        .args(["query", r"HKLM\HARDWARE\DEVICEMAP\SERIALCOMM"])
        .output();

    let mut results = Vec::new();

    if let Ok(o) = out {
        let text = String::from_utf8_lossy(&o.stdout).to_string();
        for line in text.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            // Format:  <name>    REG_SZ    COM3
            if parts.len() >= 3 && parts[1] == "REG_SZ" {
                let port = parts[2];
                if port.starts_with("COM") {
                    results.push((port.to_owned(), None));
                }
            }
        }
    }

    results.sort_by(|a, b| a.0.cmp(&b.0));
    results
}

/// Parse VID and PID from a Windows PNP device ID string.
/// e.g. "USB\VID_1A86&PID_7523\5&3a8d1e9b&0&1" → Some((0x1A86, 0x7523))
#[cfg(target_os = "windows")]
fn parse_pnp_vid_pid(pnp: &str) -> Option<(u16, u16)> {
    let upper = pnp.to_uppercase();
    let vid_pos = upper.find("VID_")?;
    let pid_pos = upper.find("PID_")?;

    let vid_str = &upper[vid_pos + 4..].splitn(2, |c: char| !c.is_ascii_hexdigit()).next()?;
    let pid_str = &upper[pid_pos + 4..].splitn(2, |c: char| !c.is_ascii_hexdigit()).next()?;

    let vid = u16::from_str_radix(vid_str, 16).ok()?;
    let pid = u16::from_str_radix(pid_str, 16).ok()?;
    Some((vid, pid))
}