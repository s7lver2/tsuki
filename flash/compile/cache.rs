// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: compile :: cache
//
//  Stores a per-file SHA-256 fingerprint alongside each .o file so that
//  unchanged source files are never recompiled.
//
//  Cache manifest lives at <build_dir>/.tsuki-cache.json
// ─────────────────────────────────────────────────────────────────────────────

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use sha2::{Sha256, Digest};
use serde::{Deserialize, Serialize};

const MANIFEST_FILE: &str = ".tsuki-cache.json";

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct CacheManifest {
    /// Maps source-file absolute path → hex-encoded SHA-256 of its content.
    pub entries: HashMap<String, String>,
    /// Compiler flags hash — if flags change, everything is stale.
    pub flags_hash: String,
}

impl CacheManifest {
    /// Load from disk, or return an empty manifest on any error.
    pub fn load(build_dir: &Path) -> Self {
        let path = build_dir.join(MANIFEST_FILE);
        let data = match std::fs::read_to_string(&path) {
            Ok(d) => d,
            Err(_) => return Self::default(),
        };
        serde_json::from_str(&data).unwrap_or_default()
    }

    /// Persist to disk.
    pub fn save(&self, build_dir: &Path) -> std::io::Result<()> {
        let path = build_dir.join(MANIFEST_FILE);
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        std::fs::write(path, json)
    }

    /// True if `src_path` is up-to-date and its output object file exists.
    pub fn is_fresh(&self, src: &Path, obj: &Path, flags_hash: &str) -> bool {
        if self.flags_hash != flags_hash { return false; }
        if !obj.exists() { return false; }
        let key = src.to_string_lossy().to_string();
        match self.entries.get(&key) {
            Some(cached) => hash_file(src).as_deref() == Some(cached.as_str()),
            None => false,
        }
    }

    /// Record a successfully compiled source file.
    pub fn record(&mut self, src: &Path, flags_hash: &str) {
        let key = src.to_string_lossy().to_string();
        if let Some(hash) = hash_file(src) {
            self.entries.insert(key, hash);
        }
        self.flags_hash = flags_hash.to_owned();
    }
}

/// SHA-256 of the file content, hex-encoded.
pub fn hash_file(path: &Path) -> Option<String> {
    let data = std::fs::read(path).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    Some(hex::encode(hasher.finalize()))
}

/// SHA-256 of a string slice (used for compiler-flags fingerprint).
pub fn hash_str(s: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    hex::encode(hasher.finalize())
}

/// Map a source path to an output .o path inside build_dir.
///
/// To avoid collisions (two files named "main.cpp" in different dirs) we
/// embed the file's parent path as a prefix.
pub fn obj_path(build_dir: &Path, src: &Path) -> PathBuf {
    // Use just the filename + a short hash of the full path as a prefix
    let fname = src.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".into());

    let full  = src.to_string_lossy();
    let short = &hex::encode(Sha256::digest(full.as_bytes()))[..8];

    build_dir.join(format!("{short}_{fname}.o"))
}