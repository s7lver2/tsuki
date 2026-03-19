// tsuki-webkit — main.rs
// CLI entry point: `tsuki-webkit build | check | preview`

use std::process;
use tsuki_webkit::{compile, WebkitConfig};

fn usage() {
    eprintln!("tsuki-webkit — JSX → HTML/CSS/JS compiler for ESP8266/ESP32");
    eprintln!();
    eprintln!("USAGE:");
    eprintln!("  tsuki-webkit build  [--board esp8266|esp32] [--config path]");
    eprintln!("  tsuki-webkit check  [--config path]");
    eprintln!("  tsuki-webkit info");
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    let sub = args.get(1).map(|s| s.as_str()).unwrap_or("help");

    match sub {
        "build" => cmd_build(&args[2..]),
        "check" => cmd_check(&args[2..]),
        "info"  => cmd_info(),
        _       => { usage(); process::exit(1); }
    }
}

fn parse_flag<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    args.windows(2)
        .find(|w| w[0] == flag)
        .map(|w| w[1].as_str())
}

fn cmd_build(args: &[String]) {
    let board  = parse_flag(args, "--board").unwrap_or("esp8266");
    let conf   = parse_flag(args, "--config").unwrap_or("tsuki-webkit.conf.json");

    let cfg = WebkitConfig::from_file(conf).unwrap_or_else(|e| {
        eprintln!("warn: could not read config ({e}), using defaults");
        WebkitConfig::default()
    });

    let entry = cfg.entrypoint.clone();
    let jsx_src = std::fs::read_to_string(&entry).unwrap_or_else(|e| {
        eprintln!("error: cannot read '{entry}': {e}");
        process::exit(1);
    });

    match compile(&jsx_src, &cfg, board) {
        Ok(out) => {
            // Write HTML page
            std::fs::write("dist/index.html", &out.html).unwrap_or_else(|_| {
                std::fs::create_dir_all("dist").ok();
                std::fs::write("dist/index.html", &out.html).ok();
            });
            // Write C++ fragment
            std::fs::write("dist/webkit.cpp", &out.cpp_fragment).ok();
            eprintln!("tsuki-webkit: build OK  →  dist/index.html  dist/webkit.cpp");
        }
        Err(e) => {
            eprintln!("tsuki-webkit: build FAILED: {e}");
            process::exit(1);
        }
    }
}

fn cmd_check(args: &[String]) {
    let conf = parse_flag(args, "--config").unwrap_or("tsuki-webkit.conf.json");
    let cfg  = WebkitConfig::from_file(conf).unwrap_or_default();
    let entry = cfg.entrypoint.clone();
    let jsx_src = std::fs::read_to_string(&entry).unwrap_or_else(|e| {
        eprintln!("error: cannot read '{entry}': {e}");
        process::exit(1);
    });
    match compile(&jsx_src, &cfg, "esp8266") {
        Ok(_)  => eprintln!("tsuki-webkit: check OK"),
        Err(e) => { eprintln!("tsuki-webkit: check FAILED: {e}"); process::exit(1); }
    }
}

fn cmd_info() {
    println!("tsuki-webkit v{}", env!("CARGO_PKG_VERSION"));
    println!("  Compiles JSX into self-contained HTML pages for ESP8266/ESP32 web panels.");
    println!("  Supported imports: Api, Json, Serial  (from 'tsuki-webkit')");
    println!("  Config file: tsuki-webkit.conf.json");
}
