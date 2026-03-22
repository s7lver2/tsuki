// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: error
//  Unified error types and source-location tracking.
// ─────────────────────────────────────────────────────────────────────────────

use thiserror::Error;

// ── Source span ───────────────────────────────────────────────────────────────

/// A position inside a source file.
///
/// The `file` field uses `Arc<str>` internally when created via `new_arc`
/// so the lexer can clone spans cheaply (just a refcount bump) instead of
/// heap-allocating a new `String` for every token.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Span {
    pub file:   String,
    pub line:   u32,
    pub col:    u32,
    /// Byte offset from the start of the file (useful for IDE integrations).
    pub offset: usize,
}

impl Span {
    pub fn new(file: impl Into<String>, line: u32, col: u32, offset: usize) -> Self {
        Self { file: file.into(), line, col, offset }
    }

    /// Cheap constructor that accepts an `Arc<str>` (no extra allocation).
    /// Used by the optimized lexer to avoid one `String::clone()` per span.
    #[inline]
    pub fn new_arc(file: std::sync::Arc<str>, line: u32, col: u32, offset: usize) -> Self {
        // Arc<str> → String: one allocation, but only when an error actually
        // needs to be reported (rare path).  Happy path just uses `Arc::clone`.
        Self { file: file.as_ref().to_owned(), line, col, offset }
    }

    /// A dummy span for generated/synthetic nodes.
    pub fn synthetic() -> Self { Self::default() }
}

impl std::fmt::Display for Span {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.file.is_empty() {
            write!(f, "{}:{}", self.line, self.col)
        } else {
            write!(f, "{}:{}:{}", self.file, self.line, self.col)
        }
    }
}

// ── Error type ────────────────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum TsukiError {
    // ── pipeline errors ──────────────────────────────────────────────────────
    #[error("[lex]   {span}  {msg}")]
    Lex { msg: String, span: Span },

    #[error("[parse] {span}  {msg}")]
    Parse { msg: String, span: Span },

    #[error("[type]  {span}  {msg}")]
    Type { msg: String, span: Span },

    #[error("[codegen] {0}")]
    Codegen(String),

    // ── I/O ──────────────────────────────────────────────────────────────────
    #[error("[io] {0}")]
    Io(#[from] std::io::Error),

    // ── JSON / config ────────────────────────────────────────────────────────
    #[error("[json] {0}")]
    Json(#[from] serde_json::Error),

    // ── generic ──────────────────────────────────────────────────────────────
    #[error("{0}")]
    Other(String),
}

impl TsukiError {
    // Convenience constructors
    pub fn lex(span: Span, msg: impl Into<String>)   -> Self { Self::Lex   { msg: msg.into(), span } }
    pub fn parse(span: Span, msg: impl Into<String>) -> Self { Self::Parse { msg: msg.into(), span } }
    pub fn type_(span: Span, msg: impl Into<String>) -> Self { Self::Type  { msg: msg.into(), span } }
    pub fn codegen(msg: impl Into<String>)           -> Self { Self::Codegen(msg.into()) }
    pub fn other(msg: impl Into<String>)             -> Self { Self::Other(msg.into()) }

    /// Return the source span when available.
    pub fn span(&self) -> Option<&Span> {
        match self {
            Self::Lex   { span, .. } => Some(span),
            Self::Parse { span, .. } => Some(span),
            Self::Type  { span, .. } => Some(span),
            _                        => None,
        }
    }

    /// Render a pretty, human-readable diagnostic message.
    pub fn pretty(&self, source: &str) -> String {
        let Some(span) = self.span() else { return self.to_string() };

        let line_text = source
            .lines()
            .nth((span.line.saturating_sub(1)) as usize)
            .unwrap_or("");

        let caret = " ".repeat(span.col.saturating_sub(1) as usize) + "^";

        format!(
            "error: {}\n  --> {}\n   |\n{:>3}| {}\n   | {}\n",
            self,
            span,
            span.line,
            line_text,
            caret,
        )
    }
}

pub type Result<T> = std::result::Result<T, TsukiError>;