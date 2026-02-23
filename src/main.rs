// ─────────────────────────────────────────────────────────────────────────────
//  tsuki  —  standalone binary  (updated for external libs)
//
//  Usage: tsuki <input.go> [output.cpp] [FLAGS]
//
//  New flags:
//    --libs-dir <path>        root directory of installed tsukilib packages
//    --packages ws2812,dht    comma-separated package names to load
// ─────────────────────────────────────────────────────────────────────────────

use std::path::PathBuf;
use tsuki_core::{Pipeline, PipelineOptions, TranspileConfig, Board};
use tsuki_core::pkg_manager;
use tsuki_core::pkg_manager::default_libs_dir;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|a| a == "--version" || a == "-V") {
        println!("tsuki {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    if args.iter().any(|a| a == "--help" || a == "-h") || args.len() < 2 {
        print_help();
        return;
    }
    if args.iter().any(|a| a == "boards") {
        print_boards();
        return;
    }

    // ── pkg subcommand ────────────────────────────────────────────────────────
    if args.get(1).map(|s| s == "pkg").unwrap_or(false) {
        handle_pkg(&args);
        return;
    }

    // ── Positional args ───────────────────────────────────────────────────────
    let input: PathBuf = args[1].clone().into();
    let output: Option<PathBuf> = args.get(2)
        .filter(|s| !s.starts_with('-'))
        .map(|s| s.clone().into());

    // ── Named flags ───────────────────────────────────────────────────────────
    let board      = flag_value(&args, "--board").unwrap_or_else(|| "uno".into());
    let source_map = args.iter().any(|a| a == "--source-map");
    let check_only = args.iter().any(|a| a == "--check");

    // External library flags
    let libs_dir   = flag_value(&args, "--libs-dir").map(PathBuf::from);
    let pkg_names: Vec<String> = flag_value(&args, "--packages")
        .map(|s| s.split(',').map(|p| p.trim().to_owned()).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default();

    let cfg = TranspileConfig {
        board,
        emit_source_map: source_map,
        ..Default::default()
    };

    // ── Read source ───────────────────────────────────────────────────────────
    let source = match std::fs::read_to_string(&input) {
        Ok(s)  => s,
        Err(e) => {
            eprintln!("error: cannot read {}: {}", input.display(), e);
            std::process::exit(1);
        }
    };

    let filename = input.to_string_lossy().into_owned();

    // ── Build pipeline with optional external libs ────────────────────────────
    let pipeline = Pipeline::new(cfg)
        .with_options(PipelineOptions {
            libs_dir:  libs_dir,
            pkg_names: pkg_names,
        });

    // ── Run (check-only or full transpile) ────────────────────────────────────
    if check_only {
        match pipeline.run(&source, &filename) {
            Ok(_)  => {
                eprintln!("ok  {} — no errors", input.display());
                std::process::exit(0);
            }
            Err(e) => {
                eprintln!("{}", tsuki_core::pretty_error(&e, &source));
                std::process::exit(1);
            }
        }
    }

    match pipeline.run(&source, &filename) {
        Ok(cpp) => {
            match output {
                Some(path) => {
                    if let Err(e) = std::fs::write(&path, &cpp) {
                        eprintln!("error: cannot write {}: {}", path.display(), e);
                        std::process::exit(1);
                    }
                    eprintln!("ok  {}", path.display());
                }
                None => print!("{}", cpp),
            }
        }
        Err(e) => {
            eprintln!("{}", tsuki_core::pretty_error(&e, &source));
            std::process::exit(1);
        }
    }
}

// ── pkg subcommand handler ────────────────────────────────────────────────────

fn handle_pkg(args: &[String]) {
    // tsuki pkg <cmd> [args] [--libs-dir <path>] [--registry <url>]
    let subcmd = args.get(2).map(|s| s.as_str()).unwrap_or("");

    let libs_dir = flag_value(args, "--libs-dir")
        .map(PathBuf::from)
        .unwrap_or_else(default_libs_dir);

    let registry_url = flag_value(args, "--registry")
        .unwrap_or_else(|| pkg_manager::DEFAULT_REGISTRY_URL.to_owned());

    match subcmd {
        // ── list / search ─────────────────────────────────────────────────────
        "list" | "search" => {
            let query = args.get(3).map(|s| s.as_str());
            let registry = fetch_registry_or_exit(&registry_url);

            let mut entries: Vec<(&String, &pkg_manager::RegistryEntry)> =
                registry.packages.iter().collect();
            entries.sort_by_key(|(n, _)| n.as_str());

            if entries.is_empty() {
                eprintln!("tsuki: registry is empty");
                return;
            }

            println!("{:<20} {:<10} {}", "NAME", "LATEST", "DESCRIPTION");
            println!("{}", "-".repeat(70));
            for (name, entry) in &entries {
                // filter by query if provided
                if let Some(q) = query {
                    let q_lower = q.to_lowercase();
                    let in_name = name.to_lowercase().contains(&q_lower);
                    let in_desc = entry.description.as_deref()
                        .map(|d| d.to_lowercase().contains(&q_lower))
                        .unwrap_or(false);
                    if !in_name && !in_desc { continue; }
                }
                let desc = entry.description.as_deref().unwrap_or("-");
                println!("{:<20} {:<10} {}", name, entry.latest, desc);
            }
        }

        // ── install ───────────────────────────────────────────────────────────
        "install" | "add" => {
            let pkg_arg = args.get(3).unwrap_or_else(|| {
                eprintln!("tsuki pkg install: missing package name");
                eprintln!("usage: tsuki pkg install <name>[@<version>]");
                std::process::exit(1);
            });
            let registry = fetch_registry_or_exit(&registry_url);
            match pkg_manager::install(pkg_arg, &libs_dir, &registry) {
                Ok(msg) => println!("{}", msg),
                Err(e)  => { eprintln!("error: {}", e); std::process::exit(1); }
            }
        }

        // ── remove ────────────────────────────────────────────────────────────
        "remove" | "rm" | "uninstall" => {
            let pkg_arg = args.get(3).unwrap_or_else(|| {
                eprintln!("tsuki pkg remove: missing package name");
                eprintln!("usage: tsuki pkg remove <name>[@<version>]");
                std::process::exit(1);
            });
            match pkg_manager::remove(pkg_arg, &libs_dir) {
                Ok(msg) => println!("{}", msg),
                Err(e)  => { eprintln!("error: {}", e); std::process::exit(1); }
            }
        }

        // ── update ────────────────────────────────────────────────────────────
        "update" | "upgrade" => {
            let registry = fetch_registry_or_exit(&registry_url);
            match pkg_manager::update_all(&libs_dir, &registry) {
                Ok(msgs) => {
                    if msgs.is_empty() {
                        println!("tsuki: no packages installed");
                    } else {
                        for m in msgs { println!("{}", m); }
                    }
                }
                Err(e) => { eprintln!("error: {}", e); std::process::exit(1); }
            }
        }

        // ── installed ─────────────────────────────────────────────────────────
        "installed" | "ls" => {
            let pkgs = pkg_manager::list_installed(&libs_dir);
            if pkgs.is_empty() {
                println!("tsuki: no packages installed (libs-dir: {})", libs_dir.display());
            } else {
                println!("{:<20} {}", "NAME", "VERSION");
                println!("{}", "-".repeat(32));
                for (name, ver) in &pkgs {
                    println!("{:<20} {}", name, ver);
                }
            }
        }

        // ── info ──────────────────────────────────────────────────────────────
        "info" => {
            let pkg_arg = args.get(3).unwrap_or_else(|| {
                eprintln!("tsuki pkg info: missing package name");
                std::process::exit(1);
            });
            let registry = fetch_registry_or_exit(&registry_url);
            match registry.packages.get(pkg_arg.as_str()) {
                None => {
                    eprintln!("tsuki pkg info: '{}' not found in registry", pkg_arg);
                    std::process::exit(1);
                }
                Some(entry) => {
                    println!("Name:        {}", pkg_arg);
                    println!("Latest:      {}", entry.latest);
                    if let Some(d) = &entry.description { println!("Description: {}", d); }
                    if let Some(a) = &entry.author      { println!("Author:      {}", a); }
                    let mut vers: Vec<&String> = entry.versions.keys().collect();
                    vers.sort();
                    println!("Versions:    {}", vers.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "));
                }
            }
        }

        _ => {
            eprintln!("tsuki pkg: unknown command '{}'\n", subcmd);
            print_pkg_help();
            std::process::exit(1);
        }
    }
}

fn fetch_registry_or_exit(url: &str) -> pkg_manager::Registry {
    eprintln!("tsuki: fetching registry from {} …", url);
    match pkg_manager::fetch_registry(url) {
        Ok(r)  => r,
        Err(e) => {
            eprintln!("error: {}", e);
            std::process::exit(1);
        }
    }
}

fn flag_value(args: &[String], flag: &str) -> Option<String> {
    args.windows(2).find(|w| w[0] == flag).map(|w| w[1].clone())
}

fn print_help() {
    println!(
r#"tsuki {} — Go-to-Arduino C++ transpiler

USAGE:
    tsuki <input.go> [output.cpp] [FLAGS]
    tsuki pkg <command> [args]

FLAGS:
    --board <id>           Target board (default: uno)
    --source-map           Emit #line pragmas for IDE source mapping
    --check                Validate source only (no output produced)
    --libs-dir <path>      Root directory of installed tsukilib packages
    --packages <n,...>     Comma-separated package names to load from libs-dir
    --version              Print version
    --help                 Print this help

COMMANDS:
    tsuki boards        List supported boards
    tsuki pkg ...       Package manager (see `tsuki pkg --help`)

EXAMPLES:
    tsuki src/main.go build/main.cpp --board esp32
    tsuki src/main.go                               # print C++ to stdout
    tsuki src/main.go --check                       # validate only
    tsuki src/main.go build/main.cpp \
        --board uno \
        --libs-dir ~/.local/share/tsuki/libs \
        --packages ws2812,dht
"#,
    env!("CARGO_PKG_VERSION"));
}

fn print_pkg_help() {
    println!(
r#"tsuki pkg — package manager

USAGE:
    tsuki pkg <command> [args] [--libs-dir <path>] [--registry <url>]

COMMANDS:
    list                   List all packages in the registry
    search <query>         Search packages by name or description
    info   <name>          Show details for a registry package
    install <name>[@<ver>] Install a package (latest if version omitted)
    remove  <name>[@<ver>] Remove an installed package
    update                 Update all installed packages to latest
    installed              List locally installed packages

FLAGS:
    --libs-dir <path>      Override install directory
                           (default: ~/.local/share/tsuki/libs)
    --registry <url>       Override registry URL
                           (default: https://raw.githubusercontent.com/
                            s7lver/tsuki-pkgs/main/registry.json)
"#);
}


fn print_boards() {
    println!("{:<15} {:<30} {:<15} {:>7} {:>6}  {}", "ID", "NAME", "CPU", "FLASH", "RAM", "FQBN");
    println!("{}", "-".repeat(100));
    for b in Board::catalog() {
        println!("{:<15} {:<30} {:<15} {:>5}K  {:>4}K  {}",
            b.id, b.name, b.cpu, b.flash_kb, b.ram_kb, b.fqbn);
    }
}