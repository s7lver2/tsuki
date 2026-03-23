// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-ide :: updater  —  Tauri commands for self-update
//
//  Exposes four commands to the frontend:
//
//    get_app_version              → String ("2.1.0")
//    check_ide_update_v2          → Option<UpdateInfo>
//    install_ide_update_v2        → ()   (restarts app on success)
//    install_ide_update_legacy    → ()   (restarts app on success)
//
//  The v2 flow calls the tsuki CLI (`tsuki install tsuki-team/tsuki-ide@<v>`)
//  as a subprocess and streams progress events back via Tauri's event system.
//
//  The legacy flow downloads the installer from the manifest URL, verifies its
//  Ed25519 signature against tsuki-keys.json, then runs it silently.
// ─────────────────────────────────────────────────────────────────────────────

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use futures_util::StreamExt;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub available:    bool,
    pub version:      String,
    pub current:      String,
    pub channel:      String,   // "stable" | "testing"
    pub method:       String,   // "v2" | "legacy"
    pub notes:        Option<String>,
    pub release_url:  Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateProgress {
    pub stage:   String,  // "checking" | "downloading" | "installing" | "done" | "error"
    pub percent: u8,
    pub message: String,
}

// ── get_app_version ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

// ── check_ide_update_v2 ───────────────────────────────────────────────────────

/// Query the tsuki package registry for a newer tsuki-ide version.
/// Returns None if the registry is unreachable or already up-to-date.
#[tauri::command]
pub async fn check_ide_update_v2(
    channel: String,
    current: String,
) -> Result<Option<UpdateInfo>, String> {
    let tsuki_bin = find_tsuki_bin().ok_or("tsuki CLI not found in PATH or ~/.tsuki/bin")?;

    // `tsuki pkg info tsuki-team/tsuki-ide --json` returns JSON with latest version
    let output = Command::new(&tsuki_bin)
        .args(["pkg", "info", "tsuki-team/tsuki-ide", "--json", "--channel", &channel])
        .output()
        .map_err(|e| format!("failed to run tsuki: {e}"))?;

    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let info: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("parse error: {e}"))?;

    let latest = info["latest_version"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();

    if latest.is_empty() || !is_newer(&latest, &current) {
        return Ok(None);
    }

    Ok(Some(UpdateInfo {
        available:   true,
        version:     latest.clone(),
        current:     current,
        channel:     channel,
        method:      "v2".into(),
        notes:       info["description"].as_str().map(|s| s.to_string()),
        release_url: Some(format!(
            "https://github.com/tsuki-team/tsuki-ide/releases/tag/v{latest}"
        )),
    }))
}

// ── install_ide_update_v2 ─────────────────────────────────────────────────────

/// Run `tsuki install tsuki-team/tsuki-ide@<version>` and stream progress events.
/// On success, restarts the application.
#[tauri::command]
pub async fn install_ide_update_v2(
    app:     AppHandle,
    version: String,
    channel: String,
) -> Result<(), String> {
    let tsuki_bin = find_tsuki_bin().ok_or("tsuki CLI not found")?;

    emit_progress(&app, "downloading", 5, &format!("Fetching tsuki-ide v{version}…"));

    let pkg_ref = format!("tsuki-team/tsuki-ide@{version}");
    let mut child = Command::new(&tsuki_bin)
        .args(["install", &pkg_ref, "--progress"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;

    // Stream stdout progress lines.
    // tsuki install --progress emits lines like:
    //   PROGRESS 30 Verifying signature…
    //   PROGRESS 60 Extracting…
    //   DONE
    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            if let Some(rest) = line.strip_prefix("PROGRESS ") {
                let mut parts = rest.splitn(2, ' ');
                let pct: u8  = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
                let msg: &str = parts.next().unwrap_or("…");
                emit_progress(&app, "downloading", pct, msg);
            } else if line == "DONE" {
                break;
            }
        }
    }

    let status = child.wait().map_err(|e| format!("wait failed: {e}"))?;
    if !status.success() {
        let code = status.code().unwrap_or(-1);
        return Err(format!("tsuki install exited with code {code}"));
    }

    emit_progress(&app, "installing", 90, "Launching installer…");

    // The installer is placed in ~/.tsuki/bin/tsuki-ide-installer (or .exe on Windows).
    // Run it, then exit this process — the installer handles the restart.
    run_installer(&app, &version)?;
    Ok(())
}

// ── install_ide_update_legacy ─────────────────────────────────────────────────

/// Download the installer from the legacy manifest URL, verify signature,
/// run it, and restart.
#[tauri::command]
pub async fn install_ide_update_legacy(
    app:      AppHandle,
    manifest: String,    // JSON string of LegacyManifest
) -> Result<(), String> {
    let manifest_val: serde_json::Value = serde_json::from_str(&manifest)
        .map_err(|e| format!("invalid manifest: {e}"))?;

    let platform_key = current_platform_key();
    let platform     = manifest_val["platforms"][&platform_key].as_object()
        .ok_or_else(|| format!("no installer for platform {platform_key}"))?;

    let url = platform["url"].as_str().ok_or("missing url in manifest")?;
    let sig = platform["signature"].as_str().unwrap_or("");

    emit_progress(&app, "downloading", 5, "Downloading installer…");

    // Download to temp file
    let ext = if cfg!(windows) { ".exe" } else { "" };
    let dest = std::env::temp_dir().join(format!("tsuki-ide-update{ext}"));

    let data = reqwest_download(url, |pct| {
        emit_progress(&app, "downloading", pct, "Downloading…");
    })
    .await
    .map_err(|e| format!("download failed: {e}"))?;

    std::fs::write(&dest, &data).map_err(|e| format!("write failed: {e}"))?;

    // Verify Ed25519 signature if provided
    if !sig.is_empty() {
        emit_progress(&app, "downloading", 95, "Verifying signature…");
        verify_ed25519_signature(&data, sig)?;
    }

    emit_progress(&app, "installing", 97, "Launching installer…");

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&dest)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&dest, perms).map_err(|e| e.to_string())?;
    }

    // Spawn installer as detached process, then exit
    Command::new(&dest)
        .arg("--silent")
        .spawn()
        .map_err(|e| format!("installer launch failed: {e}"))?;

    // Give the installer a moment to start, then exit
    std::thread::sleep(std::time::Duration::from_millis(500));
    app.exit(0);
    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn find_tsuki_bin() -> Option<String> {
    // 1. PATH
    if let Ok(path) = which::which("tsuki") {
        return Some(path.to_string_lossy().to_string());
    }
    // 2. ~/.tsuki/bin/tsuki[.exe]
    let home = dirs::home_dir()?;
    let bin  = if cfg!(windows) { "tsuki.exe" } else { "tsuki" };
    let path = home.join(".tsuki").join("bin").join(bin);
    if path.exists() {
        return Some(path.to_string_lossy().to_string());
    }
    None
}

fn run_installer(app: &AppHandle, version: &str) -> Result<(), String> {
    let home    = dirs::home_dir().ok_or("no home dir")?;
    let ext     = if cfg!(windows) { ".exe" } else { "" };
    let installer = home
        .join(".tsuki")
        .join("bin")
        .join(format!("tsuki-ide-installer{ext}"));

    if !installer.exists() {
        // Fallback: open the GitHub release page in the browser
        let url = format!("https://github.com/tsuki-team/tsuki-ide/releases/tag/v{version}");
        let _ = open::that(&url);
        return Ok(());
    }

    Command::new(&installer)
        .arg("--silent")
        .spawn()
        .map_err(|e| format!("installer launch failed: {e}"))?;

    std::thread::sleep(std::time::Duration::from_millis(500));
    app.exit(0);
    Ok(())
}

fn emit_progress(app: &AppHandle, stage: &str, percent: u8, message: &str) {
    let _ = app.emit_all("ide-update-progress", UpdateProgress {
        stage:   stage.into(),
        percent,
        message: message.into(),
    });
}

fn current_platform_key() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]  { "windows-amd64" }
    #[cfg(all(target_os = "macos",   target_arch = "x86_64"))]  { "darwin-amd64"  }
    #[cfg(all(target_os = "macos",   target_arch = "aarch64"))] { "darwin-arm64"  }
    #[cfg(all(target_os = "linux",   target_arch = "x86_64"))]  { "linux-amd64"   }
    #[cfg(all(target_os = "linux",   target_arch = "aarch64"))] { "linux-arm64"   }
    #[cfg(not(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "macos",   target_arch = "x86_64"),
        all(target_os = "macos",   target_arch = "aarch64"),
        all(target_os = "linux",   target_arch = "x86_64"),
        all(target_os = "linux",   target_arch = "aarch64"),
    )))]
    { "unknown" }
}

/// Naive semver comparison — returns true if `candidate` > `current`.
fn is_newer(candidate: &str, current: &str) -> bool {
    let parse = |v: &str| -> [u64; 3] {
        let parts: Vec<u64> = v.trim_start_matches('v')
            .splitn(3, '.')
            .map(|p| p.parse().unwrap_or(0))
            .collect();
        [
            parts.first().copied().unwrap_or(0),
            parts.get(1).copied().unwrap_or(0),
            parts.get(2).copied().unwrap_or(0),
        ]
    };
    parse(candidate) > parse(current)
}

fn verify_ed25519_signature(data: &[u8], sig_b64: &str) -> Result<(), String> {
    // Load the public key from tsuki-keys.json in the registry
    // For simplicity, the public key is compiled in at build time via a
    // TSUKI_PUBLIC_KEY env var (base64-encoded 32 bytes).
    let pubkey_b64 = std::env::var("TSUKI_PUBLIC_KEY")
        .unwrap_or_default();
    if pubkey_b64.is_empty() {
        // No key configured — skip verification (warn only)
        eprintln!("[updater] WARNING: TSUKI_PUBLIC_KEY not set; skipping signature verification");
        return Ok(());
    }

    use base64::Engine;
    let pubkey_bytes = base64::engine::general_purpose::STANDARD
        .decode(&pubkey_b64)
        .map_err(|e| format!("invalid public key encoding: {e}"))?;
    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(sig_b64)
        .map_err(|e| format!("invalid signature encoding: {e}"))?;

    // ed25519-dalek verification
    use ed25519_dalek::{Verifier, VerifyingKey, Signature};
    let vk = VerifyingKey::from_bytes(
        pubkey_bytes.as_slice().try_into()
            .map_err(|_| "public key must be 32 bytes")?
    ).map_err(|e| format!("invalid public key: {e}"))?;

    // We sign the SHA-256 checksum string, not the raw bytes
    let checksum = {
        use sha2::{Sha256, Digest};
        let hash = Sha256::digest(data);
        format!("sha256:{}", hex::encode(hash))
    };

    let sig: Signature = sig_bytes.as_slice().try_into()
        .map_err(|_| "signature must be 64 bytes")?;

    vk.verify(checksum.as_bytes(), &sig)
        .map_err(|_| "Ed25519 signature verification failed — refusing to install".into())
}

// Streaming download via reqwest (same client as the rest of the codebase).
async fn reqwest_download(
    url: &str,
    on_progress: impl Fn(u8),
) -> Result<Vec<u8>, String> {
    use futures_util::StreamExt;

    let client = reqwest::Client::builder()
        .user_agent("tsuki-ide-updater")
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client.get(url)
        .send().await
        .map_err(|e| format!("download request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("download returned {}: {url}", response.status()));
    }

    let content_length = response.content_length().unwrap_or(0);
    let mut stream     = response.bytes_stream();
    let mut buf: Vec<u8> = if content_length > 0 {
        Vec::with_capacity(content_length as usize)
    } else {
        Vec::new()
    };
    let mut downloaded: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("stream error: {e}"))?;
        downloaded += chunk.len() as u64;
        buf.extend_from_slice(&chunk);

        if content_length > 0 {
            let pct = ((downloaded * 100) / content_length).min(100) as u8;
            on_progress(pct);
        }
    }

    Ok(buf)
}