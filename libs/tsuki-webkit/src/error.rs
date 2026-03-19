// tsuki-webkit — error.rs

use std::fmt;

#[derive(Debug)]
pub enum WebkitError {
    LexError  { msg: String, line: usize, col: usize },
    ParseError { msg: String, line: usize },
    CodegenError(String),
    ConfigError(String),
    IoError(String),
}

impl fmt::Display for WebkitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WebkitError::LexError { msg, line, col }     => write!(f, "Lex error at {line}:{col}: {msg}"),
            WebkitError::ParseError { msg, line }         => write!(f, "Parse error at line {line}: {msg}"),
            WebkitError::CodegenError(msg)               => write!(f, "Codegen error: {msg}"),
            WebkitError::ConfigError(msg)                => write!(f, "Config error: {msg}"),
            WebkitError::IoError(msg)                    => write!(f, "IO error: {msg}"),
        }
    }
}
