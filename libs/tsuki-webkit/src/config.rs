// tsuki-webkit — config.rs
// Parses `tsuki-webkit.conf.json` without external deps.

use crate::error::WebkitError;

#[derive(Debug, Clone, Default)]
pub struct WebkitConfig {
    pub name:        Option<String>,
    pub author:      Option<String>,
    pub version:     Option<String>,
    pub description: Option<String>,
    pub entrypoint:  String,   // defaults to "app.jsx"
}

impl WebkitConfig {
    pub fn from_json(src: &str) -> Result<Self, WebkitError> {
        let mut cfg = WebkitConfig {
            entrypoint: "app.jsx".into(),
            ..Default::default()
        };

        // Minimal hand-rolled JSON key/value extractor — no serde needed.
        fn extract_str(src: &str, key: &str) -> Option<String> {
            let needle = format!("\"{key}\"");
            let pos    = src.find(&needle)?;
            let after  = &src[pos + needle.len()..];
            let colon  = after.find(':')? + 1;
            let rest   = after[colon..].trim_start();
            if rest.starts_with('"') {
                let inner = &rest[1..];
                let end   = inner.find('"')?;
                Some(inner[..end].to_owned())
            } else {
                None
            }
        }

        cfg.name        = extract_str(src, "Name");
        cfg.author      = extract_str(src, "Author");
        cfg.version     = extract_str(src, "Version");
        cfg.description = extract_str(src, "Description");
        if let Some(ep) = extract_str(src, "Entrypoint") {
            cfg.entrypoint = ep;
        }

        Ok(cfg)
    }

    /// Read config from a file path.
    pub fn from_file(path: &str) -> Result<Self, WebkitError> {
        let src = std::fs::read_to_string(path)
            .map_err(|e| WebkitError::IoError(e.to_string()))?;
        Self::from_json(&src)
    }
}
