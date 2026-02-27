// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash  —  Arduino compile & flash toolchain
// ─────────────────────────────────────────────────────────────────────────────

mod boards;
mod compile;
mod detect;
mod error;
mod flash;
mod lib_manager;
mod modules;
mod sdk;

use clap::{Args, Parser, Subcommand};
use colored::Colorize;
use std::path::PathBuf;
use std::time::Instant;

use boards::Board;
use compile::{compile, CompileRequest};
use flash::{flash, FlashRequest};
use error::{FlashError, Result};

// ─────────────────────────────────────────────────────────────────────────────
//  CLI
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(
    name    = "tsuki-flash",
    version = env!("CARGO_PKG_VERSION"),
    about   = "Arduino compile & flash toolchain — no arduino-cli required",
)]
struct Cli {
    #[command(subcommand)]
    command: Cmd,

    #[arg(long, global = true)]
    quiet: bool,

    #[arg(long, short = 'v', global = true)]
    verbose: bool,

    #[arg(long, global = true)]
    no_color: bool,
}

#[derive(Subcommand)]
enum Cmd {
    /// Compile a sketch to firmware (.hex / .bin)
    Compile(CompileArgs),
    /// Upload compiled firmware to a connected board
    Upload(UploadArgs),
    /// Compile then immediately upload
    Run(RunArgs),
    /// Detect connected boards / serial ports
    Detect,
    /// List all supported boards
    Boards,
    /// Print SDK discovery paths for a board
    SdkInfo {
        #[arg(default_value = "uno")]
        board: String,
    },
    /// Manage Arduino libraries  (install / search / list / info)
    Lib(LibArgs),
    /// Manage Arduino SDK cores via tsuki-modules  (no arduino-cli needed)
    Modules(ModulesArgs),
}

// ── Compile args ──────────────────────────────────────────────────────────────

#[derive(Args)]
struct CompileArgs {
    #[arg(long, short = 'b')]
    board: String,

    #[arg(long)]
    sketch: PathBuf,

    #[arg(long)]
    build_dir: PathBuf,

    #[arg(long)]
    name: Option<String>,

    #[arg(long, default_value = "c++11")]
    cpp_std: String,

    /// Extra include directories
    #[arg(long, value_delimiter = ',')]
    include: Vec<PathBuf>,

    /// Use the tsuki-modules SDK store instead of .arduino15
    #[arg(long, default_value_t = false)]
    use_modules: bool,
}

// ── Upload args ───────────────────────────────────────────────────────────────

#[derive(Args)]
struct UploadArgs {
    #[arg(long, short = 'b')]
    board: String,

    #[arg(long, short = 'p')]
    port: Option<String>,

    #[arg(long)]
    build_dir: PathBuf,

    #[arg(long)]
    name: Option<String>,

    #[arg(long, default_value = "0")]
    baud: u32,
}

// ── Run args ──────────────────────────────────────────────────────────────────

#[derive(Args)]
struct RunArgs {
    #[arg(long, short = 'b')]
    board: String,

    #[arg(long, short = 'p')]
    port: Option<String>,

    #[arg(long)]
    sketch: PathBuf,

    #[arg(long, default_value = "build/.cache")]
    build_dir: PathBuf,

    #[arg(long)]
    name: Option<String>,

    #[arg(long, default_value = "c++11")]
    cpp_std: String,

    #[arg(long, value_delimiter = ',')]
    include: Vec<PathBuf>,

    #[arg(long, default_value_t = false)]
    use_modules: bool,

    #[arg(long, default_value = "0")]
    baud: u32,
}

// ── Lib args ──────────────────────────────────────────────────────────────────

#[derive(Args)]
struct LibArgs {
    #[command(subcommand)]
    command: LibCmd,
}

#[derive(Subcommand)]
enum LibCmd {
    Install {
        name: String,
        #[arg(long)]
        version: Option<String>,
    },
    Search { query: String },
    List,
    Info { name: String },
    Update,
}

// ── Modules args ──────────────────────────────────────────────────────────────

#[derive(Args)]
struct ModulesArgs {
    #[command(subcommand)]
    command: ModulesCmd,
}

#[derive(Subcommand)]
enum ModulesCmd {
    /// Download + install an Arduino SDK core (avr | esp32 | esp8266 | sam | rp2040)
    Install { arch: String },
    /// List installed cores
    List,
    /// Force-refresh the package index cache
    Update,
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
        Cmd::Compile(a)        => cmd_compile(a, cli.verbose, cli.quiet),
        Cmd::Upload(a)         => cmd_upload(a, cli.verbose, cli.quiet),
        Cmd::Run(a)            => cmd_run(a, cli.verbose, cli.quiet),
        Cmd::Detect            => cmd_detect(),
        Cmd::Boards            => { cmd_boards(); Ok(()) }
        Cmd::SdkInfo { board } => cmd_sdk_info(&board),
        Cmd::Lib(a)            => cmd_lib(a, cli.verbose),
        Cmd::Modules(a)        => cmd_modules(a, cli.verbose),
    };

    if let Err(e) = result {
        eprintln!("{} {}", "✗".red().bold(), e);
        std::process::exit(1);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Handlers
// ─────────────────────────────────────────────────────────────────────────────

fn cmd_compile(args: CompileArgs, verbose: bool, quiet: bool) -> Result<()> {
    let board = find_board(&args.board)?;
    let name  = args.name.unwrap_or_else(|| dir_name(&args.sketch));

    ensure_modules_ready(args.use_modules, board.arch())?;

    if !quiet {
        println!(
            "{} {} {} {}",
            "Compiling".cyan().bold(),
            format!("[board: {}]", board.id).dimmed(),
            format!("[{}]", board.name).dimmed(),
            sdk_label(args.use_modules, board.arch()).dimmed(),
        );
        println!("{}", "─".repeat(60).dimmed());
    }

    let t0 = Instant::now();
    let req = CompileRequest {
        sketch_dir:       args.sketch,
        build_dir:        args.build_dir,
        project_name:     name,
        cpp_std:          args.cpp_std,
        lib_include_dirs: args.include,
        use_modules:      args.use_modules,
        verbose,
    };

    match compile(&req, board) {
        Ok(res) => {
            if !quiet {
                println!("{} compiled in {:.2}s", "✓".green().bold(), t0.elapsed().as_secs_f64());
                print_firmware_info(&res);
            }
            Ok(())
        }
        Err(e) => { render_compile_error(&e); Err(e) }
    }
}

fn cmd_upload(args: UploadArgs, verbose: bool, quiet: bool) -> Result<()> {
    let board = find_board(&args.board)?;
    let name  = args.name.unwrap_or_else(|| "firmware".into());
    let port  = resolve_port(args.port, quiet)?;

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
        build_dir:     args.build_dir,
        project_name:  name,
        port:          port.clone(),
        baud_override: args.baud,
        verbose,
    };

    flash(&req, board)
        .map_err(|e| { render_flash_error(&e, &port); e })
        .map(|()| {
            if !quiet {
                println!("{} firmware uploaded to {}", "✓".green().bold(), port.bold());
            }
        })
}

fn cmd_run(args: RunArgs, verbose: bool, quiet: bool) -> Result<()> {
    let board = find_board(&args.board)?;
    let name  = args.name.unwrap_or_else(|| dir_name(&args.sketch));

    ensure_modules_ready(args.use_modules, board.arch())?;

    if !quiet {
        println!("{} {} {}", "Compiling".cyan().bold(),
            format!("[board: {}]", board.id).dimmed(),
            sdk_label(args.use_modules, board.arch()).dimmed());
        println!("{}", "─".repeat(60).dimmed());
    }

    let t0 = Instant::now();
    let compile_req = CompileRequest {
        sketch_dir:       args.sketch,
        build_dir:        args.build_dir.clone(),
        project_name:     name.clone(),
        cpp_std:          args.cpp_std,
        lib_include_dirs: args.include,
        use_modules:      args.use_modules,
        verbose,
    };

    let res = compile(&compile_req, board)
        .map_err(|e| { render_compile_error(&e); e })?;

    if !quiet {
        println!("{} compiled in {:.2}s", "✓".green().bold(), t0.elapsed().as_secs_f64());
    }

    let port = resolve_port(args.port, quiet)?;

    if !quiet {
        println!("\n{} {}", "Uploading".cyan().bold(), format!("[port: {}]", port).dimmed());
        println!("{}", "─".repeat(60).dimmed());
    }

    let flash_req = FlashRequest {
        build_dir:     args.build_dir,
        project_name:  name,
        port:          port.clone(),
        baud_override: args.baud,
        verbose,
    };

    flash(&flash_req, board)
        .map_err(|e| { render_flash_error(&e, &port); e })?;

    if !quiet {
        println!("{} firmware uploaded to {}", "✓".green().bold(), port.bold());
        if let Some(hex) = &res.hex_path {
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
        let vid_pid = p.vid_pid
            .map(|(v, pid)| format!("{:04X}:{:04X}", v, pid))
            .unwrap_or_else(|| "—".into());
        println!("{:<20} {:<15} {:<8}  {}",
            p.port,
            p.board_id.unwrap_or("unknown"),
            vid_pid,
            p.board_name.unwrap_or("—"));
    }
    Ok(())
}

fn cmd_boards() {
    println!("{:<15} {:<32} {:<15} {:>7} {:>6}  {}",
        "ID", "NAME", "CPU / ARCH", "FLASH", "RAM", "FQBN");
    println!("{}", "─".repeat(95).dimmed());
    for b in Board::catalog() {
        let (cpu, arch) = match &b.toolchain {
            boards::Toolchain::Avr { mcu, .. }   => (mcu.to_string(), "avr"),
            boards::Toolchain::Sam { mcu, .. }    => (mcu.to_string(), "sam"),
            boards::Toolchain::Rp2040             => ("cortex-m0+".into(), "rp2040"),
            boards::Toolchain::Esp32 { variant }  => (variant.to_string(), "esp32"),
            boards::Toolchain::Esp8266            => ("lx106".into(), "esp8266"),
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
        Err(e) => { eprintln!("{} {}", "✗".red().bold(), e); Err(e) }
    }
}

fn cmd_modules(args: ModulesArgs, verbose: bool) -> Result<()> {
    match args.command {
        ModulesCmd::Install { arch } => modules::install(&arch, verbose),
        ModulesCmd::List             => modules::list(),
        ModulesCmd::Update           => modules::update(verbose),
    }
}

fn cmd_lib(args: LibArgs, verbose: bool) -> Result<()> {
    match args.command {
        LibCmd::Install { name, version } => {
            lib_manager::install(&name, version.as_deref(), verbose)?;
            if let Ok(root) = lib_manager::libs_root() {
                let p = root.join(&name);
                if p.exists() {
                    println!("\n  {} {}", "path:".dimmed(), p.display().to_string().dimmed());
                    println!("  {} {}", "include hint:".dimmed(),
                        format!("--include {}", p.display()).bold());
                }
            }
            Ok(())
        }
        LibCmd::Search { query } => lib_manager::search(&query, verbose),
        LibCmd::List              => lib_manager::list(),
        LibCmd::Info { name }     => lib_manager::info(&name, verbose),
        LibCmd::Update => {
            if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
                let cache = PathBuf::from(home)
                    .join(".arduino15")
                    .join(".tsuki_lib_index.json");
                if cache.exists() { let _ = std::fs::remove_file(&cache); }
            }
            println!("{} Refreshing library index…", "→".cyan());
            lib_manager::search("", verbose)?;
            println!("{} Library index updated.", "✓".green().bold());
            Ok(())
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
    if !quiet { print!("{} auto-detecting board… ", "→".cyan()); }
    match detect::best_port() {
        Some(p) => { if !quiet { println!("{}", p.bold()); } Ok(p) }
        None    => Err(FlashError::NoBoardDetected),
    }
}

fn dir_name(path: &PathBuf) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "firmware".into())
}

fn sdk_label(use_modules: bool, arch: &str) -> String {
    if use_modules {
        format!("[sdk: {} via tsuki-modules]", arch)
    } else {
        format!("[sdk: {}]", arch)
    }
}

/// If --use-modules is set, ensure the core is installed (auto-download if absent).
/// Uses the fast-path avr module when arch == "avr"; falls back to generic install.
fn ensure_modules_ready(use_modules: bool, arch: &str) -> Result<()> {
    if !use_modules { return Ok(()); }
    match arch {
        "avr" => {
            // avr::ensure() is a no-op (microseconds) when already installed.
            modules::avr::ensure(false).map(|_| ())
        }
        _ => {
            if modules::is_installed(arch) { return Ok(()); }
            eprintln!(
                "{} Core for arch '{}' is not installed in tsuki-modules.",
                "✗".red().bold(), arch
            );
            eprintln!("  Run: {}", format!("tsuki-flash modules install {}", arch).bold());
            Err(FlashError::SdkNotFound {
                arch: arch.into(),
                path: "~/.tsuki/modules".into(),
                pkg:  format!("tsuki-flash modules install {}", arch),
            })
        }
    }
}

fn print_firmware_info(res: &compile::CompileResult) {
    if let Some(hex) = &res.hex_path { println!("  {} {}", "hex:".dimmed(), hex.display()); }
    if let Some(bin) = &res.bin_path { println!("  {} {}", "bin:".dimmed(), bin.display()); }
    if !res.size_info.is_empty()     { println!("\n{}", res.size_info.dimmed()); }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Error rendering
// ─────────────────────────────────────────────────────────────────────────────

fn render_compile_error(e: &FlashError) {
    eprintln!("\n{} {}", "CompileError".red().bold(), "compilation failed");
    eprintln!("{}", "─".repeat(60).dimmed());

    match e {
        FlashError::CompileFailed { output } | FlashError::LinkFailed { output } => {
            for line in output.lines() {
                if line.contains("error:")        { eprintln!("  {}", line.red()); }
                else if line.contains("warning:") { eprintln!("  {}", line.yellow()); }
                else if !line.trim().is_empty()   { eprintln!("  {}", line.dimmed()); }
            }
        }
        FlashError::SdkNotFound { arch, path, pkg } => {
            eprintln!("  {} SDK not found for arch '{}'", "✗".red(), arch);
            eprintln!("  Expected at: {}", path.yellow());
            eprintln!("  Install with tsuki-modules: {}",
                format!("tsuki-flash modules install {}", arch).bold());
            eprintln!("  Or via arduino-cli: {}",
                format!("arduino-cli core install {}", pkg).bold());
        }
        FlashError::ToolchainNotFound(msg) => eprintln!("  {} {}", "✗".red(), msg),
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
                if line.to_lowercase().contains("error") { eprintln!("  {}", line.red()); }
                else if !line.trim().is_empty()          { eprintln!("  {}", line.dimmed()); }
            }
            eprintln!("\n  {}", "Hints:".bold());
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