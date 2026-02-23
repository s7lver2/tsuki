// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash  —  Arduino compile & flash toolchain
//
//  Replaces arduino-cli entirely. Invokes avr-gcc / esptool / avrdude
//  directly for maximum speed, with parallel compilation and incremental
//  caching.
//
//  USAGE
//  ─────
//    tsuki-flash compile  --board uno  --sketch build/sketch  --build-dir build/.cache
//    tsuki-flash upload   --board uno  --port /dev/ttyUSB0    --build-dir build/.cache
//    tsuki-flash run      --board uno  --port /dev/ttyUSB0    --sketch build/sketch
//    tsuki-flash detect
//    tsuki-flash boards
// ─────────────────────────────────────────────────────────────────────────────

mod boards;
mod compile;
mod detect;
mod error;
mod flash;
mod lib_manager;
mod sdk;

use clap::{Parser, Subcommand, Args};
use colored::Colorize;
use std::path::PathBuf;
use std::time::Instant;

use boards::Board;
use compile::{compile, CompileRequest};
use flash::{flash, FlashRequest};
use error::{FlashError, Result};

// ─────────────────────────────────────────────────────────────────────────────
//  CLI definition (clap derive)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(
    name    = "tsuki-flash",
    version = env!("CARGO_PKG_VERSION"),
    about   = "Arduino compile & flash toolchain — no arduino-cli required",
    long_about = None,
)]
struct Cli {
    #[command(subcommand)]
    command: Cmd,

    /// Suppress spinner / progress output
    #[arg(long, global = true)]
    quiet: bool,

    /// Print all compiler commands
    #[arg(long, short = 'v', global = true)]
    verbose: bool,

    /// Disable colored output
    #[arg(long, global = true)]
    no_color: bool,
}

#[derive(Subcommand)]
enum Cmd {
    /// Compile a sketch to firmware (.hex / .bin)
    Compile(CompileArgs),
    /// Upload compiled firmware to a connected board
    Upload(UploadArgs),
    /// Compile then immediately upload  (shortcut for compile + upload)
    Run(RunArgs),
    /// Detect connected boards / serial ports
    Detect,
    /// List all supported boards
    Boards,
    /// Print SDK discovery paths for a board arch
    SdkInfo {
        /// Board ID (e.g. "uno", "esp32")
        #[arg(default_value = "uno")]
        board: String,
    },
    /// Manage Arduino libraries (install / search / list / info)
    Lib(LibArgs),
}

// ── Lib ───────────────────────────────────────────────────────────────────────

#[derive(Args)]
struct LibArgs {
    #[command(subcommand)]
    command: LibCmd,
}

#[derive(Subcommand)]
enum LibCmd {
    /// Install an Arduino library (and its dependencies)
    Install {
        /// Library name, e.g. "DHT sensor library"
        name: String,

        /// Pin a specific version, e.g. "1.4.4"
        #[arg(long)]
        version: Option<String>,
    },
    /// Search the Arduino library registry
    Search {
        /// Search query (matches name, description, category)
        query: String,
    },
    /// List all installed libraries
    List,
    /// Show details about a library
    Info {
        /// Library name
        name: String,
    },
    /// Refresh the local library index cache
    Update,
}

// ── Compile ───────────────────────────────────────────────────────────────────

#[derive(Args)]
struct CompileArgs {
    /// Target board ID  (e.g. uno, nano, esp32)
    #[arg(long, short = 'b')]
    board: String,

    /// Directory containing sketch source (.cpp / .ino files)
    #[arg(long)]
    sketch: PathBuf,

    /// Output directory for .o, .elf, .hex files
    #[arg(long)]
    build_dir: PathBuf,

    /// Project / sketch name (default: sketch dir name)
    #[arg(long)]
    name: Option<String>,

    /// C++ standard  (default: c++11)
    #[arg(long, default_value = "c++11")]
    cpp_std: String,

    /// Extra include directories  (comma-separated or repeated)
    #[arg(long, value_delimiter = ',')]
    include: Vec<PathBuf>,
}

// ── Upload ────────────────────────────────────────────────────────────────────

#[derive(Args)]
struct UploadArgs {
    /// Target board ID
    #[arg(long, short = 'b')]
    board: String,

    /// Serial port  (auto-detect if omitted)
    #[arg(long, short = 'p')]
    port: Option<String>,

    /// Directory containing compiled firmware (.hex / .bin)
    #[arg(long)]
    build_dir: PathBuf,

    /// Project name  (used to find <name>.hex etc.)
    #[arg(long)]
    name: Option<String>,

    /// Override baud rate  (0 = use board default)
    #[arg(long, default_value = "0")]
    baud: u32,
}

// ── Run (compile + upload) ────────────────────────────────────────────────────

#[derive(Args)]
struct RunArgs {
    /// Target board ID
    #[arg(long, short = 'b')]
    board: String,

    /// Serial port  (auto-detect if omitted)
    #[arg(long, short = 'p')]
    port: Option<String>,

    /// Directory containing sketch sources
    #[arg(long)]
    sketch: PathBuf,

    /// Build/output directory
    #[arg(long, default_value = "build/.cache")]
    build_dir: PathBuf,

    /// Project name
    #[arg(long)]
    name: Option<String>,

    /// C++ standard
    #[arg(long, default_value = "c++11")]
    cpp_std: String,

    /// Extra include directories
    #[arg(long, value_delimiter = ',')]
    include: Vec<PathBuf>,

    /// Override baud rate
    #[arg(long, default_value = "0")]
    baud: u32,
}

// ─────────────────────────────────────────────────────────────────────────────
//  Entry point
// ─────────────────────────────────────────────────────────────────────────────

fn main() {
    let cli = Cli::parse();

    if cli.no_color {
        colored::control::set_override(false);
    }

    let result = match cli.command {
        Cmd::Compile(args) => cmd_compile(args, cli.verbose, cli.quiet),
        Cmd::Upload(args)  => cmd_upload(args, cli.verbose, cli.quiet),
        Cmd::Run(args)     => cmd_run(args, cli.verbose, cli.quiet),
        Cmd::Detect        => cmd_detect(),
        Cmd::Boards        => { cmd_boards(); Ok(()) }
        Cmd::SdkInfo { board } => cmd_sdk_info(&board),
        Cmd::Lib(args)     => cmd_lib(args, cli.verbose),
    };

    if let Err(e) = result {
        eprintln!("{} {}", "✗".red().bold(), e);
        std::process::exit(1);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Command handlers
// ─────────────────────────────────────────────────────────────────────────────

fn cmd_compile(args: CompileArgs, verbose: bool, quiet: bool) -> Result<()> {
    let board = find_board(&args.board)?;
    let name  = args.name.unwrap_or_else(|| dir_name(&args.sketch));

    if !quiet {
        println!(
            "{} {} {} {}",
            "Compiling".cyan().bold(),
            format!("[board: {}]", board.id).dimmed(),
            format!("[{}]", board.name).dimmed(),
            format!("[sdk: {}]", board.arch()).dimmed(),
        );
        println!("{}", "─".repeat(60).dimmed());
    }

    let t0 = Instant::now();

    let req = CompileRequest {
        sketch_dir:       args.sketch,
        build_dir:        args.build_dir,
        project_name:     name.clone(),
        cpp_std:          args.cpp_std,
        lib_include_dirs: args.include,
        verbose,
    };

    match compile(&req, board) {
        Ok(result) => {
            let elapsed = t0.elapsed();
            if !quiet {
                println!("{} compiled in {:.2}s", "✓".green().bold(), elapsed.as_secs_f64());
                if let Some(hex) = &result.hex_path {
                    println!("  {} {}", "hex:".dimmed(), hex.display());
                }
                if let Some(bin) = &result.bin_path {
                    println!("  {} {}", "bin:".dimmed(), bin.display());
                }
                if !result.size_info.is_empty() {
                    println!("\n{}", result.size_info.dimmed());
                }
            }
            Ok(())
        }
        Err(e) => {
            render_compile_error(&e);
            Err(e)
        }
    }
}

fn cmd_upload(args: UploadArgs, verbose: bool, quiet: bool) -> Result<()> {
    let board = find_board(&args.board)?;
    let name  = args.name.unwrap_or_else(|| "firmware".into());

    let port = resolve_port(args.port, quiet)?;

    if !quiet {
        println!(
            "{} {} {}",
            "Uploading".cyan().bold(),
            format!("[board: {}]", board.id).dimmed(),
            format!("[port: {}]", port).dimmed(),
        );
        println!("{}", "─".repeat(60).dimmed());
    }

    let req = FlashRequest {
        build_dir:    args.build_dir,
        project_name: name,
        port:         port.clone(),
        baud_override: args.baud,
        verbose,
    };

    match flash(&req, board) {
        Ok(()) => {
            if !quiet {
                println!("{} firmware uploaded to {}", "✓".green().bold(), port.bold());
            }
            Ok(())
        }
        Err(e) => {
            render_flash_error(&e, &port);
            Err(e)
        }
    }
}

fn cmd_run(args: RunArgs, verbose: bool, quiet: bool) -> Result<()> {
    let board = find_board(&args.board)?;
    let name  = args.name.unwrap_or_else(|| dir_name(&args.sketch));

    // ── Compile ────────────────────────────────────────────────────────────
    if !quiet {
        println!("{} {} {}", "Compiling".cyan().bold(),
            format!("[board: {}]", board.id).dimmed(),
            format!("[{}]", board.name).dimmed());
        println!("{}", "─".repeat(60).dimmed());
    }

    let t0 = Instant::now();
    let compile_req = CompileRequest {
        sketch_dir:       args.sketch,
        build_dir:        args.build_dir.clone(),
        project_name:     name.clone(),
        cpp_std:          args.cpp_std,
        lib_include_dirs: args.include,
        verbose,
    };

    let result = compile(&compile_req, board).map_err(|e| { render_compile_error(&e); e })?;

    if !quiet {
        println!("{} compiled in {:.2}s", "✓".green().bold(), t0.elapsed().as_secs_f64());
    }

    // ── Upload ─────────────────────────────────────────────────────────────
    let port = resolve_port(args.port, quiet)?;

    if !quiet {
        println!("\n{} {}", "Uploading".cyan().bold(),
            format!("[port: {}]", port).dimmed());
        println!("{}", "─".repeat(60).dimmed());
    }

    let flash_req = FlashRequest {
        build_dir:    args.build_dir,
        project_name: name,
        port:         port.clone(),
        baud_override: args.baud,
        verbose,
    };

    flash(&flash_req, board).map_err(|e| { render_flash_error(&e, &port); e })?;

    if !quiet {
        println!("{} firmware uploaded to {}", "✓".green().bold(), port.bold());
        if let Some(hex) = &result.hex_path {
            println!("  {} {}", "hex:".dimmed(), hex.display());
        }
    }

    Ok(())
}

fn cmd_detect() -> Result<()> {
    let ports = detect::detect_all();

    if ports.is_empty() {
        println!("{} No serial ports found", "!".yellow());
        return Ok(());
    }

    println!("{:<20} {:<15} {:<8}  {}", "PORT", "BOARD", "VID:PID", "NAME");
    println!("{}", "─".repeat(70).dimmed());

    for p in &ports {
        let board_id  = p.board_id.unwrap_or("unknown");
        let board_name = p.board_name.unwrap_or("—");
        let vid_pid = p.vid_pid
            .map(|(v, p)| format!("{:04X}:{:04X}", v, p))
            .unwrap_or_else(|| "—".into());

        println!("{:<20} {:<15} {:<8}  {}", p.port, board_id, vid_pid, board_name);
    }

    Ok(())
}

fn cmd_boards() {
    println!("{:<15} {:<32} {:<15} {:>7} {:>6}  {}",
        "ID", "NAME", "CPU / ARCH", "FLASH", "RAM", "FQBN");
    println!("{}", "─".repeat(95).dimmed());

    for b in Board::catalog() {
        let (cpu, arch) = match &b.toolchain {
            boards::Toolchain::Avr { mcu, .. }    => (mcu.to_string(), "avr"),
            boards::Toolchain::Sam { mcu, .. }     => (mcu.to_string(), "sam"),
            boards::Toolchain::Rp2040              => ("cortex-m0+".into(), "rp2040"),
            boards::Toolchain::Esp32 { variant }   => (variant.to_string(), "esp32"),
            boards::Toolchain::Esp8266             => ("lx106".into(), "esp8266"),
        };

        println!("{:<15} {:<32} {:<7} ({:<6}) {:>5}K  {:>4}K  {}",
            b.id.bold(), b.name, cpu, arch,
            b.flash_kb, b.ram_kb, b.fqbn.dimmed());
    }
}

fn cmd_sdk_info(board_id: &str) -> Result<()> {
    let board = find_board(board_id)?;
    match sdk::resolve(board.arch(), board.variant) {
        Ok(paths) => {
            println!("{} SDK found  ({})", "✓".green().bold(), paths.sdk_version);
            println!("  core:     {}", paths.core_dir.display());
            println!("  variant:  {}", paths.variant_dir.display());
            println!("  toolchain:{}", paths.toolchain_bin.display());
            if let Some(ld) = &paths.libraries_dir {
                println!("  libraries:{}", ld.display());
            }
            Ok(())
        }
        Err(e) => {
            eprintln!("{} {}", "✗".red().bold(), e);
            Err(e)
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn find_board(id: &str) -> Result<&'static Board> {
    Board::find(id).ok_or_else(|| FlashError::UnknownBoard(id.to_owned()))
}

fn resolve_port(explicit: Option<String>, quiet: bool) -> Result<String> {
    if let Some(p) = explicit { return Ok(p); }

    if !quiet {
        print!("{} auto-detecting board… ", "→".cyan());
    }

    match detect::best_port() {
        Some(p) => {
            if !quiet { println!("{}", p.bold()); }
            Ok(p)
        }
        None => Err(FlashError::NoBoardDetected),
    }
}

fn dir_name(path: &PathBuf) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "firmware".into())
}

// ─────────────────────────────────────────────────────────────────────────────
//  Error rendering
// ─────────────────────────────────────────────────────────────────────────────

fn render_compile_error(e: &FlashError) {
    eprintln!("\n{} {}", "CompileError".red().bold(), "compilation failed");
    eprintln!("{}", "─".repeat(60).dimmed());

    match e {
        FlashError::CompileFailed { output } |
        FlashError::LinkFailed    { output } => {
            for line in output.lines() {
                if line.contains("error:") {
                    eprintln!("  {}", line.red());
                } else if line.contains("warning:") {
                    eprintln!("  {}", line.yellow());
                } else if !line.trim().is_empty() {
                    eprintln!("  {}", line.dimmed());
                }
            }
        }
        FlashError::SdkNotFound { arch, path, pkg } => {
            eprintln!("  {} SDK not found for arch '{}'", "✗".red(), arch);
            eprintln!("  Expected at: {}", path.yellow());
            eprintln!("  Install with: {}", format!("arduino-cli core install {}", pkg).bold());
            eprintln!("  Or override:  {}", "TSUKI_SDK_ROOT=/path/to/sdk tsuki-flash …".bold());
        }
        FlashError::ToolchainNotFound(msg) => {
            eprintln!("  {} {}", "✗".red(), msg);
        }
        _ => eprintln!("  {}", e),
    }

    eprintln!("{}", "─".repeat(60).dimmed());
}

fn render_flash_error(e: &FlashError, port: &str) {
    eprintln!("\n{} {}", "FlashError".red().bold(), format!("upload to {} failed", port));
    eprintln!("{}", "─".repeat(60).dimmed());

    match e {
        FlashError::FlashFailed { output, .. } => {
            for line in output.lines() {
                if line.to_lowercase().contains("error") {
                    eprintln!("  {}", line.red());
                } else if !line.trim().is_empty() {
                    eprintln!("  {}", line.dimmed());
                }
            }
            eprintln!();
            eprintln!("  {}", "Hints:".bold());
            eprintln!("  • Ensure the board is in bootloader mode");
            eprintln!("  • Try a different USB cable / port");
            eprintln!("  • Pass --port explicitly: tsuki-flash upload --port /dev/ttyUSB0 …");
        }
        FlashError::NoBoardDetected => {
            eprintln!("  {} No board detected on any serial port", "✗".red());
            eprintln!("  Connect the board and retry, or pass --port /dev/ttyUSBx");
        }
        _ => eprintln!("  {}", e),
    }

    eprintln!("{}", "─".repeat(60).dimmed());
}

// ─────────────────────────────────────────────────────────────────────────────
//  lib subcommand handler
// ─────────────────────────────────────────────────────────────────────────────

fn cmd_lib(args: LibArgs, verbose: bool) -> Result<()> {
    match args.command {
        LibCmd::Install { name, version } => {
            let pin = version.as_deref();
            lib_manager::install(&name, pin, verbose)?;

            // Print the install path for the user's convenience.
            if let Ok(root) = lib_manager::libs_root() {
                let lib_path = root.join(&name);
                if lib_path.exists() {
                    println!(
                        "\n  {} {}",
                        "path:".dimmed(),
                        lib_path.display().to_string().dimmed()
                    );
                    println!(
                        "  {} {}",
                        "include hint:".dimmed(),
                        format!("--include {}", lib_path.display()).bold()
                    );
                }
            }
        }

        LibCmd::Search { query } => {
            lib_manager::search(&query, verbose)?;
        }

        LibCmd::List => {
            lib_manager::list()?;
        }

        LibCmd::Info { name } => {
            lib_manager::info(&name, verbose)?;
        }

        LibCmd::Update => {
            // Force a cache refresh by deleting the cached index file.
            if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
                let cache = std::path::PathBuf::from(home)
                    .join(".arduino15")
                    .join(".tsuki_lib_index.json");
                if cache.exists() {
                    std::fs::remove_file(&cache)?;
                }
            }
            println!("{} Refreshing library index…", "→".cyan());
            // Calling load_index is internal; just trigger an install-less search.
            lib_manager::search("", verbose)?;
            println!("{} Library index updated.", "✓".green().bold());
        }
    }
    Ok(())
}