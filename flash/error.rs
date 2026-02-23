// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: error
// ─────────────────────────────────────────────────────────────────────────────

use thiserror::Error;

#[derive(Debug, Error)]
pub enum FlashError {
    #[error("Unknown board '{0}' — run `tsuki-flash boards` for the full list")]
    UnknownBoard(String),

    #[error("Toolchain not found: {0}\n  Hint: install avr-gcc or the relevant Arduino SDK")]
    ToolchainNotFound(String),

    #[error("SDK not found for arch '{arch}'\n  Expected at: {path}\n  Hint: run `arduino-cli core install {pkg}` once to fetch the SDK")]
    SdkNotFound { arch: String, path: String, pkg: String },

    #[error("Compilation failed:\n{output}")]
    CompileFailed { output: String },

    #[error("Link failed:\n{output}")]
    LinkFailed { output: String },

    #[error("Flash failed on {port}:\n{output}")]
    FlashFailed { port: String, output: String },

    #[error("No board detected on any serial port\n  Hint: connect the board, or pass --port /dev/ttyUSBx")]
    NoBoardDetected,

    #[error("Port '{0}' not found or not accessible")]
    PortNotFound(String),

    #[error("No .hex/.bin file found in {0}")]
    NoFirmware(String),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, FlashError>;