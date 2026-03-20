// ─────────────────────────────────────────────────────────────────────────────
//  tsuki_core  —  public library API  (updated for external libs)
// ─────────────────────────────────────────────────────────────────────────────

pub mod error;
pub mod lexer;
pub mod parser;
pub mod runtime;
pub mod transpiler;
pub mod python;

pub use error::{TsukiError, Result, Span};
pub use transpiler::TranspileConfig;
pub use runtime::{Board, Runtime};
pub use runtime::pkg_loader::{LibManifest, load_from_str as load_lib_from_str};
pub use runtime::pkg_manager;

// ── Pipeline ──────────────────────────────────────────────────────────────────

/// One-shot: Go source text → Arduino C++ source text.
///
/// # Minimal usage (built-in packages only)
/// ```no_run
/// use tsuki_core::{Pipeline, TranspileConfig};
///
/// let source = "package main\nfunc main() {}";
///
/// let cpp = Pipeline::new(TranspileConfig::default())
///     .run(source, "main.go")
///     .unwrap();
/// ```
///
/// # With external libraries
/// ```no_run
/// use tsuki_core::{Pipeline, TranspileConfig, PipelineOptions};
/// use std::path::PathBuf;
///
/// let source = "package main\nfunc main() {}";
///
/// let cpp = Pipeline::new(TranspileConfig::default())
///     .with_options(PipelineOptions {
///         libs_dir:  Some(PathBuf::from("/home/user/.local/share/tsuki/libs")),
///         pkg_names: vec!["ws2812".into(), "dht".into()],
///         ..Default::default()
///     })
///     .run(source, "main.go")
///     .unwrap();
/// ```
pub struct Pipeline {
    cfg:  TranspileConfig,
    opts: PipelineOptions,
}

/// Options passed to `Pipeline` to control library loading and other behaviour.
#[derive(Default)]
pub struct PipelineOptions {
    /// Root directory where external libraries are installed.
    /// If `None`, no external libraries are loaded.
    pub libs_dir: Option<std::path::PathBuf>,

    /// Explicit list of package names to load from `libs_dir`.
    /// If empty AND `libs_dir` is set, ALL installed libraries are loaded.
    pub pkg_names: Vec<String>,

    /// Optional path to a tsuki-webkit project directory (contains app.jsx +
    /// tsuki-webkit.conf.json). When set, the pipeline runs tsuki-webkit before
    /// handing off to tsuki-flash and injects the generated webkit.cpp fragment.
    pub webkit_project_dir: Option<std::path::PathBuf>,
}

impl Pipeline {
    pub fn new(cfg: TranspileConfig) -> Self {
        Self {
            cfg,
            opts: PipelineOptions::default(),
        }
    }

    pub fn with_options(mut self, opts: PipelineOptions) -> Self {
        self.opts = opts;
        self
    }

    pub fn run(&self, source: &str, filename: &str) -> Result<String> {
        // Build the runtime — load external libs if requested
        let rt = match &self.opts.libs_dir {
            None => Runtime::new(),
            Some(dir) if self.opts.pkg_names.is_empty() => Runtime::with_libs(dir),
            Some(dir) => Runtime::with_selected_libs(dir, &self.opts.pkg_names),
        };

        // 0. Pre-process: rewrite hyphenated package identifiers in expressions.
        //
        //    Go does not allow hyphens in identifiers, so `tsuki-webkit.ApiInit()`
        //    is lexed as `tsuki - webkit.ApiInit()`.  We normalise every imported
        //    package whose name contains a hyphen — replacing occurrences of the
        //    hyphenated form in the *expression* part of the source with an
        //    underscore-normalised alias before handing off to the lexer.
        //
        //    Only packages that are actually imported are rewritten, so there is
        //    no risk of accidentally mangling subtraction expressions.
        let preprocessed = preprocess_hyphenated_packages(source);

        // 1. Lex
        let tokens = lexer::Lexer::new(&preprocessed, filename).tokenize()?;

        // 2. Parse
        let prog = parser::Parser::new(tokens).parse_program()?;

        // 3. Generate
        let mut gen = transpiler::Transpiler::with_runtime(self.cfg.clone(), rt);
        gen.generate(&prog)
    }
}

// ── PythonPipeline ─────────────────────────────────────────────────────────────

/// One-shot: Python source text → Arduino C++ source text.
///
/// # Example
/// ```no_run
/// use tsuki_core::{PythonPipeline, TranspileConfig};
///
/// let source = r#"
/// import arduino
/// import time
///
/// def setup():
///     arduino.pinMode(13, arduino.OUTPUT)
///
/// def loop():
///     arduino.digitalWrite(13, arduino.HIGH)
///     time.sleep(1.0)
///     arduino.digitalWrite(13, arduino.LOW)
///     time.sleep(1.0)
/// "#;
///
/// let cpp = PythonPipeline::new(TranspileConfig::default())
///     .run(source, "main.py")
///     .unwrap();
/// ```
pub struct PythonPipeline {
    cfg:  TranspileConfig,
    opts: PipelineOptions,
}

impl PythonPipeline {
    pub fn new(cfg: TranspileConfig) -> Self {
        Self { cfg, opts: PipelineOptions::default() }
    }

    pub fn with_options(mut self, opts: PipelineOptions) -> Self {
        self.opts = opts;
        self
    }

    pub fn run(&self, source: &str, filename: &str) -> Result<String> {
        // Build runtime (same as Go pipeline — reuses all tsukilib packages)
        let rt = match &self.opts.libs_dir {
            None      => Runtime::new(),
            Some(dir) if self.opts.pkg_names.is_empty() => Runtime::with_libs(dir),
            Some(dir) => Runtime::with_selected_libs(dir, &self.opts.pkg_names),
        };

        // 1. Lex
        let tokens = python::lexer::PyLexer::new(source, filename).tokenize()?;

        // 2. Parse
        let prog = python::parser::PyParser::new(tokens).parse_program()?;

        // 3. Generate
        let mut gen = python::transpiler::PyTranspiler::new(self.cfg.clone(), rt);
        gen.generate(&prog)
    }
}

// ── Diagnostics helper ────────────────────────────────────────────────────────

pub fn pretty_error(err: &TsukiError, source: &str) -> String {
    err.pretty(source)
}

// ── Source pre-processor ──────────────────────────────────────────────────────

/// Rewrite hyphenated package names used in expressions so the Go lexer
/// can handle them as valid identifiers.
///
/// Algorithm:
///  1. Collect every import path that contains a hyphen (e.g. `"tsuki-webkit"`).
///  2. For each such import, derive the *Go alias* (the last path segment, or
///     the explicit alias if present) and its *underscore form*
///     (`tsuki-webkit` → `tsuki_webkit`).
///  3. Replace `<hyphenated-name>.` with `<underscore_name>.` throughout the
///     **non-import** portion of the source.
///
/// The import declarations themselves are left unchanged so the parser can
/// still read them and register the correct package name.
pub fn preprocess_hyphenated_packages(source: &str) -> String {
    // ── Step 1: collect hyphenated imports ───────────────────────────────────
    // We scan for  `import "..."` or  `import alias "..."`  patterns.
    // A full parser isn't needed — a simple line-level scan is sufficient and
    // avoids a circular dependency on the lexer.

    struct HyphenPkg {
        /// The name as written in Go code (last path segment, may contain `-`).
        go_name:  String,
        /// The C-safe replacement (hyphens → underscores).
        cpp_name: String,
    }

    let mut pkgs: Vec<HyphenPkg> = Vec::new();

    // Regex-free path extraction: find every "..." import string
    // Walk looking for double-quoted strings inside import blocks.
    // We track whether we are inside an `import (...)` block.
    let mut in_import = false;
    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("import") { in_import = true; }
        if in_import {
            // Extract any "path/with-hyphen" string on this line
            if let Some(q1) = trimmed.find('"') {
                let rest = &trimmed[q1 + 1..];
                if let Some(q2) = rest.find('"') {
                    let path = &rest[..q2];
                    if path.contains('-') {
                        // Last segment = local Go name (may still contain `-`)
                        let go_name = path.split('/').last().unwrap_or(path).to_owned();
                        // Check for an explicit alias: `alias "path"`
                        let alias = {
                            let before = trimmed[..q1].trim();
                            if !before.is_empty() && before != "import"
                                && !before.starts_with("//")
                            {
                                // last word before the quote is the alias
                                before.split_whitespace().last().map(|s| s.to_owned())
                            } else {
                                None
                            }
                        };
                        let effective_go = alias.unwrap_or_else(|| go_name.clone());
                        let cpp_name = effective_go.replace('-', "_");
                        if effective_go != cpp_name {
                            pkgs.push(HyphenPkg { go_name: effective_go, cpp_name });
                        }
                    }
                }
            }
        }
        // End of import block heuristic: a line with a closing `)` or a
        // non-import top-level declaration ends the block.
        if in_import && (trimmed == ")" || trimmed.starts_with("func ")
            || trimmed.starts_with("var ") || trimmed.starts_with("const ")
            || trimmed.starts_with("type "))
        {
            in_import = false;
        }
    }

    if pkgs.is_empty() {
        return source.to_owned();
    }

    // ── Step 2: rewrite occurrences outside of string/comment contexts ────────
    let mut out   = String::with_capacity(source.len());
    let bytes     = source.as_bytes();
    let mut pos   = 0usize;

    while pos < bytes.len() {
        // Skip line comments
        if bytes[pos] == b'/' && bytes.get(pos + 1) == Some(&b'/') {
            while pos < bytes.len() && bytes[pos] != b'\n' {
                out.push(bytes[pos] as char);
                pos += 1;
            }
            continue;
        }
        // Skip block comments
        if bytes[pos] == b'/' && bytes.get(pos + 1) == Some(&b'*') {
            out.push('/'); out.push('*');
            pos += 2;
            while pos + 1 < bytes.len() {
                if bytes[pos] == b'*' && bytes[pos + 1] == b'/' {
                    out.push('*'); out.push('/');
                    pos += 2;
                    break;
                }
                out.push(bytes[pos] as char);
                pos += 1;
            }
            continue;
        }
        // Skip string literals (keep them verbatim)
        if bytes[pos] == b'"' || bytes[pos] == b'`' {
            let q = bytes[pos];
            out.push(q as char);
            pos += 1;
            while pos < bytes.len() {
                if bytes[pos] == b'\\' && q == b'"' {
                    out.push(bytes[pos] as char);
                    pos += 1;
                    if pos < bytes.len() { out.push(bytes[pos] as char); pos += 1; }
                    continue;
                }
                let ch = bytes[pos] as char;
                out.push(ch);
                pos += 1;
                if bytes[pos - 1] == q { break; }
            }
            continue;
        }

        // Try to match a hyphenated package name at this position
        let mut matched = false;
        for pkg in &pkgs {
            let needle = pkg.go_name.as_bytes();
            if bytes[pos..].starts_with(needle) {
                // Make sure it's not a substring of a longer identifier
                // (char before is not alphanumeric/underscore, or pos == 0)
                let before_ok = pos == 0 || {
                    let b = bytes[pos - 1];
                    !b.is_ascii_alphanumeric() && b != b'_'
                };
                // Char after the needle must be `.` for a package access
                let after_ok = bytes.get(pos + needle.len()) == Some(&b'.');
                if before_ok && after_ok {
                    out.push_str(&pkg.cpp_name);
                    pos += needle.len();
                    matched = true;
                    break;
                }
            }
        }
        if !matched {
            out.push(bytes[pos] as char);
            pos += 1;
        }
    }

    out
}