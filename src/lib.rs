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

        // 1. Lex
        let tokens = lexer::Lexer::new(source, filename).tokenize()?;

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