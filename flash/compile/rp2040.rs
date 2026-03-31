// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: compile :: rp2040
//
//  Compiles Arduino RP2040 sketches (Raspberry Pi Pico, Seeed XIAO RP2040)
//  using the arm-none-eabi-gcc toolchain from the earlephilhower/arduino-pico
//  package installed either via tsuki-modules or .arduino15.
//
//  Pipeline:
//    1. Compile sketch .cpp files (parallel, incremental cache)
//    2. Link → firmware.elf  (arm-none-eabi-gcc + linker script)
//    3. arm-none-eabi-objcopy → firmware.bin + firmware.uf2
//    4. arm-none-eabi-size report
// ─────────────────────────────────────────────────────────────────────────────

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use rayon::prelude::*;
use walkdir::WalkDir;

use crate::boards::Board;
use crate::error::{FlashError, Result};
use crate::sdk::SdkPaths;
use super::cache::{CacheManifest, hash_str, obj_path};
use super::{CompileRequest, CompileResult};

pub fn run(req: &CompileRequest, board: &Board, sdk: &SdkPaths) -> Result<CompileResult> {
    std::fs::create_dir_all(&req.build_dir)?;

    // RP2040 toolchain: pqt-gcc-arm-none-eabi (earlephilhower) or system arm-none-eabi-gcc
    let cc  = resolve_tool(&sdk.toolchain_bin, "arm-none-eabi-gcc");
    let cxx = resolve_tool(&sdk.toolchain_bin, "arm-none-eabi-g++");
    let ar = resolve_tool(&sdk.toolchain_bin, "arm-none-eabi-gcc-ar");
    let objcopy = resolve_tool(&sdk.toolchain_bin, "arm-none-eabi-objcopy");
    let size    = resolve_tool(&sdk.toolchain_bin, "arm-none-eabi-size");

    // ── Early toolchain sanity check ──────────────────────────────────────
    // Validate the compiler exists BEFORE launching the parallel compile loop.
    // Without this, a missing toolchain surfaces as a cryptic "program not found"
    // error buried inside a rayon thread, with no context about why or how to fix it.
    //
    // We probe `arm-none-eabi-gcc --version` — a fast, harmless command that
    // exits 0 on every known version.  Failure means the toolchain is genuinely
    // absent and we emit an actionable SdkNotFound error immediately.
    {
        let probe = std::process::Command::new(&cxx)
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();

        if probe.is_err() || probe.map(|s| !s.success()).unwrap_or(true) {
            let install_hint = if cfg!(windows) {
                // Give Windows users a concrete path to follow.
                // Option 1: tsuki-flash modules install rp2040 (preferred)
                // Option 2: arduino-cli core install with earlephilhower URL
                format!(
                    "The ARM cross-compiler (arm-none-eabi-gcc) could not be found.\n\
                    \n\
                    To fix this, run ONE of the following:\n\
                    \n\
                      Option A — tsuki-modules (recommended, no arduino-cli needed):\n\
                        tsuki-flash modules install rp2040\n\
                    \n\
                      Option B — arduino-cli:\n\
                        arduino-cli core install rp2040:rp2040 --additional-urls \\\n\
                          https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json\n\
                    \n\
                      Option C — verify existing install:\n\
                        Expected toolchain at: {}\\packages\\rp2040\\tools\\pqt-gcc-arm-none-eabi\\<version>\\bin\\\n\
                    \n\
                    If you just installed, restart the IDE so the PATH is refreshed.",
                    std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "%LOCALAPPDATA%".into())
                )
            } else {
                format!(
                    "arm-none-eabi-gcc not found.\n\
                    \n\
                    Install it with:\n\
                      tsuki-flash modules install rp2040\n\
                    or on Debian/Ubuntu:\n\
                      sudo apt install gcc-arm-none-eabi"
                )
            };

            return Err(FlashError::SdkNotFound {
                arch:  "rp2040".into(),
                path:  cxx.display().to_string(),
                pkg:   install_hint,
            });
        }
    }

    // ── Compile flags ─────────────────────────────────────────────────────
    let arduino_ver = "10819";
    let mut common_flags: Vec<String> = vec![
        // RP2040 Cortex-M0+ core
        "-march=armv6-m".into(),
        "-mcpu=cortex-m0plus".into(),
        "-mthumb".into(),
        format!("-DF_CPU={}L", board.f_cpu()),
        format!("-DARDUINO={}", arduino_ver),
        // ── RP2040 chip identity + PLL defaults ───────────────────────────
        // These must be on the command line, not only in config_autogen.h.
        // Board variant headers (e.g. xiao_rp2040) define PICO_CLOCK_CUSTOM
        // which causes hardware/clocks.h to require all six PLL_* symbols via
        // #error.  By the time config_autogen.h is #included through the
        // pico/config.h → pico/config_autogen.h chain the check has already
        // fired.  Command-line -D flags are evaluated before any #include, so
        // they arrive in time regardless of include-graph order.
        "-DPICO_RP2040=1".into(),
        "-DPLL_SYS_VCO_FREQ_HZ=1596000000".into(),
        "-DPLL_SYS_POSTDIV1=6".into(),
        "-DPLL_SYS_POSTDIV2=2".into(),
        "-DPLL_USB_VCO_FREQ_HZ=1440000000".into(),
        "-DPLL_USB_POSTDIV1=6".into(),
        "-DPLL_USB_POSTDIV2=5".into(),
        // ── pico-sdk device/build mode ────────────────────────────────────
        // Without PICO_ON_DEVICE=1, pico-sdk routes all hardware includes
        // through src/host/ (desktop emulation) instead of src/rp2_common/.
        // Symptoms: src/host/hardware_irq.h in the include chain, sio_hw
        // resolving to pio1_hw, REG_FIELD_WIDTH undefined in #if, and the
        // clocks.h "unsupported number of fractional bits" #error.
        // PICO_BUILD=1 suppresses the sdk's cmake-only guard checks.
        // platform.txt in the earlephilhower core sets both of these; since
        // tsuki-flash bypasses arduino-cli we must set them explicitly.
        "-DPICO_ON_DEVICE=1".into(),
        "-DPICO_BUILD=1".into(),
        "-Os".into(),
        "-w".into(),
        "-ffunction-sections".into(),
        "-fdata-sections".into(),
        "-fno-exceptions".into(),
        "-MMD".into(),
        format!("-I{}", sdk.core_dir.display()),
        format!("-I{}", sdk.variant_dir.display()),
    ];
    for d in board.defines {
        common_flags.push(format!("-D{}", d));
    }
    for lib_dir in &req.lib_include_dirs {
        common_flags.push(format!("-I{}", lib_dir.display()));
    }
    for bundled in &sdk.bundled_libs_dirs {
        common_flags.push(format!("-I{}", bundled.display()));
    }
    if let Some(ld) = &sdk.libraries_dir {
        common_flags.push(format!("-I{}", ld.display()));
    }

    // ── lwIP / pico-sdk extra includes ────────────────────────────────────
    // The earlephilhower arduino-pico core includes IPAddress.h (via ArduinoCore-API)
    // which does `#include <lwip/init.h>`. The lwIP headers live inside the pico-sdk
    // that is bundled as a tool alongside the core. We scan two locations:
    //   1. <platform_root>/tools/  — for self-contained layouts (older cores)
    //   2. <packages_root>/rp2040/tools/  — for tool-download layouts (5.x cores)
    for inc in find_extra_includes(&sdk.core_dir, &sdk.variant_dir) {
        common_flags.push(format!("-I{}", inc.display()));
    }

    // ── lwipopts.h fallback stub ───────────────────────────────────────────
    // lwip/opt.h uses a *quoted* `#include "lwipopts.h"` which must be satisfied
    // by a file on one of the -I paths. In the earlephilhower core this file
    // normally lives in variants/<board>/. Some boards (e.g. XIAO RP2040 in the
    // tsuki-modules layout) do not ship it, causing every library that transitively
    // includes IPAddress.h → lwip/opt.h to fail with "lwipopts.h: No such file".
    //
    // If lwipopts.h is absent from all current -I paths we generate a minimal stub
    // in the build directory and prepend that directory to the include search so it
    // is found before the lwIP headers. The stub enables the empty "no networking"
    // configuration that is correct for boards without a network interface.
    {
        let lwipopts_found = common_flags.iter()
            .filter_map(|f| f.strip_prefix("-I"))
            .any(|d| std::path::Path::new(d).join("lwipopts.h").exists());

        if !lwipopts_found {
            let stub_path = req.build_dir.join("lwipopts.h");
            if !stub_path.exists() {
                // Minimal lwipopts.h — all optional lwIP features disabled.
                // This satisfies the #include in opt.h without enabling any
                // networking stack code. Boards that do need lwIP ship their
                // own lwipopts.h in variants/<board>/ which takes precedence
                // because the variant_dir is already earlier in the -I list.
                let stub = b"\
/* lwipopts.h - auto-generated by tsuki-flash for boards without a network variant */\n\
/* Disables all optional lwIP features so opt.h can be parsed by third-party libs. */\n\
#ifndef _TSUKI_LWIPOPTS_STUB_H\n\
#define _TSUKI_LWIPOPTS_STUB_H\n\
#define NO_SYS      1\n\
#define MEM_LIBC_MALLOC 0\n\
#define LWIP_NO_STDDEF_H 0\n\
#endif /* _TSUKI_LWIPOPTS_STUB_H */\n\
";
                let _ = std::fs::write(&stub_path, stub);
            }
            // Prepend so the stub is visible before the lwIP source tree itself
            common_flags.insert(0, format!("-I{}", req.build_dir.display()));
        }
    }

    // ── pico/version.h fallback stub ─────────────────────────────────────────
    // pico/version.h is generated by CMake (from version.h.in) during the
    // earlephilhower pico-sdk build and is NOT part of the pico-sdk source tree.
    // In pre-built tsuki-modules distributions it lives in:
    //   pqt-pico-sdk/<ver>/generated/pico_base/pico/version.h
    // find_extra_includes() probes that path, but if the tool was installed by
    // a different layout or the version dir name doesn't match, the directory
    // is silently skipped by the is_dir() guard and the header goes missing.
    //
    // We generate a minimal stub so the build always proceeds.  The stub only
    // defines the macros that pico.h and third-party libraries check for; it
    // does not affect generated firmware behaviour.
    {
        let version_found = common_flags.iter()
            .filter_map(|f| f.strip_prefix("-I"))
            .any(|d| std::path::Path::new(d).join("pico").join("version.h").exists());

        if !version_found {
            let pico_dir = req.build_dir.join("pico");
            let _ = std::fs::create_dir_all(&pico_dir);
            let stub_path = pico_dir.join("version.h");
            if !stub_path.exists() {
                // Stub version — matches the pico-sdk 2.x series bundled with
                // earlephilhower arduino-pico 5.x.  Numbers only affect
                // compile-time feature guards (#if PICO_SDK_VERSION_MAJOR >= 2).
                let stub = b"\
/* pico/version.h - auto-generated by tsuki-flash (pico-sdk version header stub) */\n\
#ifndef _PICO_VERSION_H\n\
#define _PICO_VERSION_H\n\
#define PICO_SDK_VERSION_MAJOR    2\n\
#define PICO_SDK_VERSION_MINOR    0\n\
#define PICO_SDK_VERSION_REVISION 0\n\
#define PICO_SDK_VERSION_PRE_RELEASE_ID \x22\x22\n\
#define PICO_SDK_VERSION_STRING   \x222.0.0\x22\n\
#endif /* _PICO_VERSION_H */\n\
";
                let _ = std::fs::write(&stub_path, stub);
            }
            // build_dir itself is already in common_flags (added by lwipopts stub
            // block above).  If it isn't yet (lwipopts.h was found on a real path),
            // prepend it now so the pico/ subdir is reachable.
            let build_inc = format!("-I{}", req.build_dir.display());
            if !common_flags.contains(&build_inc) {
                common_flags.insert(0, build_inc);
            }
        }
    }

    // ── pico/config_autogen.h fallback stub ──────────────────────────────────
    // config_autogen.h is generated by CMake (from pico_sdk_init()) and placed
    // in the build tree at generated/pico_base/pico/config_autogen.h.
    // tsuki-flash bypasses CMake entirely, so this file never exists on disk.
    // pico/config.h unconditionally does `#include "pico/config_autogen.h"` at
    // line 19, which causes every library that pulls in pico.h (Adafruit, DHT,
    // U8g2, …) to fail with "No such file or directory".
    //
    // We generate a minimal stub: the real file only sets board-specific overrides
    // on top of the defaults already declared in pico/config.h itself.  An empty
    // (guard-only) stub is therefore functionally correct for Arduino builds that
    // use the earlephilhower core with its own board variant headers.
    {
        let autogen_found = common_flags.iter()
            .filter_map(|f| f.strip_prefix("-I"))
            .any(|d| std::path::Path::new(d).join("pico").join("config_autogen.h").exists());

        if !autogen_found {
            let pico_dir = req.build_dir.join("pico");
            let _ = std::fs::create_dir_all(&pico_dir);
            let stub_path = pico_dir.join("config_autogen.h");
            if !stub_path.exists() {
                let stub = b"\
/* pico/config_autogen.h - auto-generated by tsuki-flash */\n\
/* Normally produced by CMake (pico_sdk_init()); tsuki-flash bypasses CMake  */\n\
/* entirely, so we emit RP2040 chip identity and PLL defaults here instead.  */\n\
/* pico/config.h unconditionally includes this file at line 19; every lib    */\n\
/* that pulls in pico.h (Adafruit, DHT, U8g2 ...) breaks without it.        */\n\
#ifndef _PICO_CONFIG_AUTOGEN_H\n\
#define _PICO_CONFIG_AUTOGEN_H\n\
\n\
/* -- Chip identity -------------------------------------------------------- */\n\
#define PICO_RP2040 1\n\
#define PICO_BOARD \"seeed_xiao_rp2040\"\n\
\n\
/* -- PLL defaults (133 MHz sys-clock, 48 MHz USB-clock) ------------------- */\n\
/* Mirrors cmake/preload/platforms/rp2040.cmake in the pico-sdk.            */\n\
/* hardware/clocks.h will not compile without these symbols defined.        */\n\
#ifndef PLL_SYS_VCO_FREQ_HZ\n\
#  define PLL_SYS_VCO_FREQ_HZ   1596000000\n\
#endif\n\
#ifndef PLL_SYS_POSTDIV1\n\
#  define PLL_SYS_POSTDIV1      6\n\
#endif\n\
#ifndef PLL_SYS_POSTDIV2\n\
#  define PLL_SYS_POSTDIV2      2\n\
#endif\n\
#ifndef PLL_USB_VCO_FREQ_HZ\n\
#  define PLL_USB_VCO_FREQ_HZ   1440000000\n\
#endif\n\
#ifndef PLL_USB_POSTDIV1\n\
#  define PLL_USB_POSTDIV1      6\n\
#endif\n\
#ifndef PLL_USB_POSTDIV2\n\
#  define PLL_USB_POSTDIV2      5\n\
#endif\n\
\n\
#endif /* _PICO_CONFIG_AUTOGEN_H */\n\
";
                let _ = std::fs::write(&stub_path, stub);
            }
            // Ensure the build_dir is on the include path so pico/config_autogen.h
            // is found.  Duplicate -I entries are harmless — GCC deduplicates them.
            let build_inc = format!("-I{}", req.build_dir.display());
            if !common_flags.contains(&build_inc) {
                common_flags.insert(0, build_inc);
            }
        }
    }

    // pqt-gcc 4.1.0 / GCC 14 fix: ensure newlib C headers are reachable via
    // #include_next.  We use -idirafter (not -isystem) so this entry lands at
    // the END of the include search list, after GCC's own built-in paths.
    //
    // Why -idirafter matters for <cmath>:
    //   <cmath> (at arm-none-eabi/include/c++/14.3.0/cmath) does:
    //     #include_next <math.h>
    //   #include_next searches only paths that come AFTER the directory where
    //   the including file lives (c++/14.3.0/).  The newlib math.h lives at
    //   arm-none-eabi/include/math.h, which GCC normally places after
    //   c++/14.3.0/ in its built-in search chain.
    //
    //   With -isystem, GCC deduplicates include dirs and keeps the FIRST
    //   occurrence.  Our -isystem arm-none-eabi/include appears on the
    //   command line BEFORE the built-in c++/14.3.0/ paths, so after
    //   deduplication arm-none-eabi/include is only present BEFORE
    //   c++/14.3.0/.  When #include_next skips past c++/14.3.0/ there is
    //   nothing left and GCC emits:
    //     cmath:47: fatal error: math.h: No such file or directory
    //
    //   With -idirafter, GCC keeps the built-in arm-none-eabi/include instance
    //   (the one that sits after c++/14.3.0/) and discards our duplicate, so
    //   #include_next resolves correctly.
    //
    // The string.h wrapper conflict (original motivation) is now handled by
    // the absolute-path force-include of newlib string.h in cxxflags, so
    // search order no longer matters for that case.
    if let Some(toolchain_root) = sdk.toolchain_bin.parent() {
        let newlib_inc = toolchain_root.join("arm-none-eabi").join("include");
        if newlib_inc.exists() {
            common_flags.push("-idirafter".into());
            common_flags.push(newlib_inc.display().to_string());
        }
    }

    // -Wno-implicit-function-declaration: GCC 12+ promotes implicit-function-declaration
    // to a hard error in C11 mode even when -w is present. Third-party libraries like
    // U8g2 call memset/memcpy without including <string.h>. Since we cannot patch
    // those libraries, we demote the diagnostic back to a (suppressed) warning so the
    // build proceeds. This mirrors what Arduino IDE does for external library sources.
    // Force-include string headers for GCC 12+ / GCC 14 compatibility.
    //
    // ArduinoCore-API's Print.h (strlen at line 53), RP2040Support.h (memcpy
    // at line 694), and several third-party libraries call C string functions
    // without including any string header. GCC 12+ treats these missing
    // declarations as hard errors even with -w / -fpermissive.
    //
    // GCC 14 (pqt-gcc 4.1.0, arm-none-eabi 14.3.0) tightened this further:
    // <cstring> now performs `using ::memchr`, `using ::memcpy`, etc. to pull
    // the C declarations into the global C++ namespace — but those `using`
    // statements fail with "has not been declared in '::'" if string.h was
    // never included first.  The fix is to force-include string.h *before*
    // cstring so that the C declarations exist in :: when cstring runs its
    // `using` directives.  Order matters: string.h first, then cstring.
    let cflags = ["-x", "c", "-std=gnu11", "-Wno-implicit-function-declaration",
                  "-include", "string.h"];

    // ── GCC 14 cstring fix: use absolute path to newlib string.h ─────────
    //
    // Problem: in C++ mode, `-include string.h` resolves to GCC's own
    // `c++/14.3.0/backward/string.h` (which just re-exports <cstring>) rather
    // than the newlib C header. When <cstring> then does `using ::memchr` etc.,
    // those symbols don't exist in :: yet, producing the cascade of errors:
    //   cstring:78:11: error: 'memchr' has not been declared in '::'
    //
    // Fix: find the absolute path to the newlib string.h
    // (`<toolchain>/arm-none-eabi/include/string.h`) and force-include it by
    // absolute path so GCC cannot resolve it to the C++ backward wrapper.
    // Then force-include <cstring> so std:: is also populated.
    // If the absolute path doesn't exist (PATH-only toolchain) we fall back to
    // the unqualified name, which is better than nothing.
    let newlib_string_h: String = sdk.toolchain_bin
        .parent()
        .map(|root| root.join("arm-none-eabi").join("include").join("string.h"))
        .filter(|p| p.exists())
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "string.h".to_string());

    // ── GCC 14 cmath fix ──────────────────────────────────────────────────
    //
    // Problem: Arduino.h (earlephilhower core) does `using std::abs` and
    // `using std::round` at namespace scope.  These symbols live in <cmath>,
    // which must be included BEFORE Arduino.h is parsed.  With GCC 14 this
    // emits:
    //   Arduino.h:54: error: 'abs' has not been declared in 'std'
    //   Arduino.h:55: error: 'round' has not been declared in 'std'
    //
    // Fix: force-include <cmath> directly.  Unlike the string.h/cstring case,
    // we do NOT pre-include math.h by absolute path first — <cmath> uses
    // `#include_next <math.h>` internally to chain to the newlib C header, and
    // that `#include_next` requires a relative position in the include-search
    // path.  Giving it an absolute path breaks the chain and produces:
    //   cmath:47: fatal error: math.h: No such file or directory
    // So here we only add `-include cmath` and let GCC resolve math.h itself.

    let cxx_std = format!("-std=gnu++{}", req.cpp_std.trim_start_matches("c++"));
    let cxxflags = [
        "-x", "c++",
        cxx_std.as_str(),
        "-fpermissive", "-fno-threadsafe-statics",
        "-Wno-error=narrowing",
        // Force-include newlib string.h by absolute path so GCC 14 finds the
        // C header (which declares memchr/memcpy/… in ::) instead of the C++
        // backward wrapper. Then include <cstring> to populate std:: as well.
        "-include", newlib_string_h.as_str(),
        "-include", "cstring",
        // Force-include <cmath> so std::abs / std::round exist before Arduino.h
        // does `using std::abs`.  No absolute math.h pre-include here — <cmath>
        // uses #include_next <math.h> which needs the normal search-path chain.
        "-include", "cmath",
    ];

    let flags_sig = hash_str(&format!("{:?}{:?}{:?}", common_flags, cflags, cxxflags));

    // ── Step 1: Compile sketch objects (parallel) ─────────────────────────
    let sketch_obj_dir = req.build_dir.join("sketch");
    std::fs::create_dir_all(&sketch_obj_dir)?;

    let sources = collect_sources(&req.sketch_dir)?;
    if sources.is_empty() {
        return Err(FlashError::CompileFailed {
            output: format!("No source files found in {}", req.sketch_dir.display()),
        });
    }

    let mut cache = CacheManifest::load(&sketch_obj_dir);
    let errors: Mutex<Vec<String>> = Mutex::new(Vec::new());

    let obj_files: Vec<PathBuf> = sources.par_iter().map(|src| {
        let obj = obj_path(&sketch_obj_dir, src);
        if cache.is_fresh(src, &obj, &flags_sig) {
            if req.verbose { eprintln!("  [cache] {}", src.display()); }
            return obj;
        }

        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
        let compiler = if ext == "c" { &cc } else { &cxx };

        let mut cmd = Command::new(compiler);
        cmd.args(&common_flags);
        if ext == "c" { cmd.args(&cflags); } else { cmd.args(&cxxflags); }
        cmd.arg("-c").arg(src).arg("-o").arg(&obj);

        if req.verbose { eprintln!("  [cc] {}", src.display()); }

        match cmd.output() {
            Ok(o) if o.status.success() => {}
            Ok(o) => {
                errors.lock().unwrap().push(format!(
                    "In {}:\n{}", src.display(),
                    String::from_utf8_lossy(&o.stderr)
                ));
            }
            Err(e) => {
                errors.lock().unwrap().push(format!(
                    "Failed to run compiler '{}': {}\n  \
                     Hint: run `tsuki-flash modules install rp2040` to install the ARM toolchain.",
                    compiler.display(), e
                ));
            }
        }
        obj
    }).collect();

    // Save cache — record all obj files that now exist on disk
    for src in &sources {
        let obj = obj_path(&sketch_obj_dir, src);
        if obj.exists() { cache.record(src, &flags_sig); }
    }
    let _ = cache.save(&sketch_obj_dir);

    let compile_errors = errors.into_inner().unwrap();
    if !compile_errors.is_empty() {
        return Err(FlashError::CompileFailed { output: compile_errors.join("\n\n") });
    }

    if obj_files.is_empty() {
        return Err(FlashError::CompileFailed {
            output: "No object files produced — all sources failed to compile.".into(),
        });
    }

    // ── Step 2: Build Arduino core → core.a ──────────────────────────────
    // The RP2040 earlephilhower core must be compiled and archived BEFORE
    // linking. Without core.a the linker can't find main(), setup(), loop(),
    // Serial, etc. — which is what causes "ld returned 1 exit status".
    let core_obj_dir = req.build_dir.join("core");
    std::fs::create_dir_all(&core_obj_dir)?;
    let core_a = req.build_dir.join("core.a");

    build_core(
        &ar, &cc, &cxx,
        &sdk.core_dir, &sdk.variant_dir,
        &core_obj_dir, &core_a,
        &common_flags, &cflags, &cxxflags,
        &flags_sig,
        req.verbose,
    )?;

    // ── Step 2b: Compile tsukilib package sources → libs.a ───────────────
    // lib_source_dirs is populated by augment_lib_includes() in mod.rs for any
    // installed package that ships .cpp/.c implementation files. Without
    // compiling and linking these, package functions are declared but never
    // defined — resulting in "undefined reference" linker errors.
    let libs_a = req.build_dir.join("libs.a");
    let has_lib_sources = !req.lib_source_dirs.is_empty();
    if has_lib_sources {
        let lib_obj_dir = req.build_dir.join("libs");
        std::fs::create_dir_all(&lib_obj_dir)?;

        let lib_errors: Mutex<Vec<String>> = Mutex::new(Vec::new());
        let lib_obj_files: Vec<PathBuf> = req.lib_source_dirs.par_iter()
            .flat_map(|src_dir| {
                collect_sources(src_dir).unwrap_or_default()
            })
            .map(|src| {
                let obj = obj_path(&lib_obj_dir, &src);
                if let Some(parent) = obj.parent() { let _ = std::fs::create_dir_all(parent); }

                let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
                let compiler = if ext == "c" { &cc } else { &cxx };

                let mut cmd = Command::new(compiler);
                cmd.args(&common_flags);
                if ext == "c" { cmd.args(&cflags); } else { cmd.args(&cxxflags); }
                cmd.arg("-c").arg(&src).arg("-o").arg(&obj);

                if req.verbose { eprintln!("  [lib] {}", src.display()); }

                match cmd.output() {
                    Ok(o) if o.status.success() => {}
                    Ok(o) => { lib_errors.lock().unwrap().push(format!(
                        "lib: {}:
{}", src.display(), String::from_utf8_lossy(&o.stderr))); }
                    Err(e) => { lib_errors.lock().unwrap().push(format!(
                        "lib: failed to run '{}': {}", compiler.display(), e)); }
                }
                obj
            })
            .collect();

        let lib_errs = lib_errors.into_inner().unwrap();
        if !lib_errs.is_empty() {
            return Err(FlashError::CompileFailed { output: lib_errs.join("
") });
        }

        let _ = std::fs::remove_file(&libs_a);
        let mut ar_cmd = Command::new(&ar);
        ar_cmd.arg("rcs").arg(&libs_a);
        for obj in &lib_obj_files {
            if obj.exists() { ar_cmd.arg(obj); }
        }
        let ar_out = ar_cmd.output()
            .map_err(|e| FlashError::CompileFailed { output: format!("ar (libs): {}", e) })?;
        if !ar_out.status.success() {
            return Err(FlashError::CompileFailed {
                output: format!("ar (libs): {}", String::from_utf8_lossy(&ar_out.stderr)),
            });
        }
    }

    // ── Step 3: Link → .elf ───────────────────────────────────────────────
    let elf_path = req.build_dir.join(format!("{}.elf", req.project_name));

    // Find linker script in sdk
    let ld_script = find_linker_script(&sdk.core_dir, &sdk.variant_dir);

    // ── Pico-SDK prebuilt static libraries ───────────────────────────────
    // The earlephilhower arduino-pico package ships the pico-sdk in a separate
    // tool download: packages/rp2040/tools/pqt-pico-sdk/<ver>/lib/*.a
    // These provide all the hardware abstraction symbols referenced by the
    // Arduino core and user sketches:
    //   gpio_init, gpio_set_function      → hardware_gpio
    //   sleep_ms, sleep_us, time_us_64    → pico_time / hardware_timer
    //   multicore_fifo_*                  → pico_multicore
    //   tud_task_ext, tud_cdc_n_*         → tinyusb_device
    //   mutex_try_enter, mutex_exit       → pico_sync
    //   exception_set_exclusive_handler   → hardware_exception
    //   irq_set_exclusive_handler         → hardware_irq
    //   check_sys_clock_khz               → hardware_clocks
    //   panic, _exit, _sbrk, __rtos_*     → pico_runtime / pico_stdlib
    //
    // Without these the linker fails with hundreds of "undefined reference"
    // errors for every pico-sdk function used by core + sketch.
    let pico_sdk_libs = find_pico_sdk_libs(&sdk.core_dir, &sdk.toolchain_bin, req.verbose);
    if req.verbose {
        eprintln!("  [ld] pico-sdk libs: {} .a file(s)", pico_sdk_libs.len());
        for lib in &pico_sdk_libs {
            eprintln!("       {}", lib.display());
        }
    }

    let mut link_cmd = Command::new(&cxx);
    link_cmd
        .arg("-march=armv6-m")
        .arg("-mcpu=cortex-m0plus")
        .arg("-mthumb")
        .arg("-Wl,--gc-sections")
        .arg("-Wl,--wrap=malloc")
        .arg("-Wl,--wrap=free");

    if let Some(ref ls) = ld_script {
        link_cmd.arg(format!("-T{}", ls.display()));
    }

    // Sketch objects first, then core + system libs inside --start-group so
    // circular references between sketch and core are resolved correctly.
    link_cmd.args(&obj_files);
    link_cmd.arg("-Wl,--start-group");
    link_cmd.arg(&core_a);
    if has_lib_sources && libs_a.exists() {
        link_cmd.arg(&libs_a);
    }
    // Pico-SDK prebuilt archives: wrap in --whole-archive so that the linker
    // pulls in all symbols, including weakly-referenced interrupt handlers and
    // atexit/sbrk stubs that newlib needs from pico_runtime.
    if !pico_sdk_libs.is_empty() {
        link_cmd.arg("-Wl,--whole-archive");
        for lib in &pico_sdk_libs {
            link_cmd.arg(lib);
        }
        link_cmd.arg("-Wl,--no-whole-archive");
    }
    link_cmd.arg("-lm");
    link_cmd.arg("-lc");
    link_cmd.arg("-lgcc");   // ARM EABI helpers (__aeabi_*) — required for arm-none-eabi
    link_cmd.arg("-lstdc++");
    link_cmd.arg("-lnosys");
    link_cmd.arg("-Wl,--end-group");
    link_cmd.arg("-o").arg(&elf_path);

    if req.verbose { eprintln!("  [ld] linking → {}", elf_path.file_name().unwrap().to_string_lossy()); }

    let link_out = link_cmd.output()
        .map_err(|e| FlashError::LinkFailed { output: format!("Failed to run linker: {}", e) })?;

    if !link_out.status.success() {
        return Err(FlashError::LinkFailed {
            output: String::from_utf8_lossy(&link_out.stderr).to_string(),
        });
    }

    // ── Step 4: .bin ──────────────────────────────────────────────────────
    let bin_path = req.build_dir.join(format!("{}.bin", req.project_name));
    let bin_out = Command::new(&objcopy)
        .args(["-O", "binary"])
        .arg(&elf_path).arg(&bin_path)
        .output()
        .map_err(|e| FlashError::Other(format!("objcopy failed: {}", e)))?;

    if !bin_out.status.success() {
        return Err(FlashError::Other(
            String::from_utf8_lossy(&bin_out.stderr).to_string()
        ));
    }

    // ── Step 5: size report ───────────────────────────────────────────────
    let size_out = Command::new(&size)
        .arg("--format=sysv")
        .arg(&elf_path)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    if req.verbose { eprint!("{}", size_out); }

    // ── Step 6: convert .bin → .uf2 ──────────────────────────────────────
    // UF2 is the drag-and-drop format used by the RP2040 USB bootloader.
    // We generate it in pure Rust — no external tool required.
    let uf2_path = req.build_dir.join(format!("{}.uf2", req.project_name));
    if let Ok(bin_bytes) = std::fs::read(&bin_path) {
        if let Ok(uf2_bytes) = bin_to_uf2(&bin_bytes, RP2040_FLASH_BASE, RP2040_FAMILY_ID) {
            let _ = std::fs::write(&uf2_path, &uf2_bytes);
        }
    }

    Ok(CompileResult {
        hex_path:  None,
        bin_path:  Some(bin_path),
        elf_path:  Some(elf_path),
        uf2_path:  if uf2_path.exists() { Some(uf2_path) } else { None },
        size_info: size_out,
    })
}


// ── build_core ────────────────────────────────────────────────────────────────
//
// Compiles the earlephilhower Arduino-pico core sources into core.a.
// Uses a sentinel file (.core_sig) to skip recompilation when nothing changed.
//
// The core sources live in sdk.core_dir (e.g. …/cores/arduino/).
// We also compile any .cpp/.c/.S found directly in sdk.variant_dir so that
// board-specific overrides (e.g. XIAO_RP2040/pins_arduino.cpp) are included.
fn build_core(
    ar:        &PathBuf,
    cc:        &PathBuf,
    cxx:       &PathBuf,
    core_dir:  &Path,
    variant_dir: &Path,
    obj_dir:   &Path,
    core_a:    &Path,
    includes:  &[String],
    cflags:    &[&str],
    cxxflags:  &[&str],
    sig:       &str,
    verbose:   bool,
) -> Result<()> {
    // Fast path: core.a exists and matches the current flags/source fingerprint.
    let sentinel = obj_dir.join(".core_sig");
    if let Ok(cached) = std::fs::read_to_string(&sentinel) {
        if cached.trim() == sig && core_a.exists()
            && std::fs::metadata(core_a).map(|m| m.len() > 0).unwrap_or(false)
        {
            return Ok(());
        }
    }

    if verbose { eprintln!("  [core] building Arduino RP2040 core…"); }

    // Collect sources from core dir (max_depth=2) + variant dir (depth=1).
    let mut sources: Vec<PathBuf> = Vec::new();
    for root in &[core_dir, variant_dir] {
        let depth = if *root == core_dir { 2 } else { 1 };
        for entry in WalkDir::new(root).max_depth(depth).into_iter().flatten() {
            let p = entry.path();
            if !p.is_file() { continue; }
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
            if matches!(ext, "cpp" | "c" | "S") {
                sources.push(p.to_owned());
            }
        }
    }

    if sources.is_empty() {
        // No core sources = SDK not installed.
        return Err(FlashError::SdkNotFound {
            arch: "rp2040".into(),
            path: core_dir.display().to_string(),
            pkg:  "Run: tsuki-flash modules install rp2040".into(),
        });
    }

    let errors: Mutex<Vec<String>> = Mutex::new(Vec::new());

    let obj_files: Vec<PathBuf> = sources.par_iter().map(|src| {
        let obj = obj_path(obj_dir, src);
        if let Some(parent) = obj.parent() { let _ = std::fs::create_dir_all(parent); }

        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
        let compiler = if ext == "c" { cc } else { cxx };

        let mut cmd = Command::new(compiler);
        cmd.args(includes);
        if ext == "c" {
            cmd.args(cflags);
        } else if ext == "S" {
            cmd.arg("-x").arg("assembler-with-cpp");
        } else {
            cmd.args(cxxflags);
        }
        cmd.arg("-c").arg(src).arg("-o").arg(&obj);

        match cmd.output() {
            Ok(o) if o.status.success() => {}
            Ok(o) => {
                errors.lock().unwrap().push(format!(
                    "core: {}:\n{}", src.display(), String::from_utf8_lossy(&o.stderr)
                ));
            }
            Err(e) => {
                errors.lock().unwrap().push(format!(
                    "core: failed to run '{}': {}", compiler.display(), e
                ));
            }
        }
        obj
    }).collect();

    let errs = errors.into_inner().unwrap();
    // WiFi/CYW43 source files only compile when the board has WiFi and the CYW43
    // driver is fully installed.  For non-WiFi boards (XIAO RP2040, plain Pico)
    // these failures are expected — we skip those objects rather than aborting.
    // We only treat errors as fatal when EVERY source file failed (= toolchain
    // or SDK is completely broken).
    let hard_errors: Vec<&str> = errs.iter()
        .filter(|e| !is_optional_core_file(e))
        .map(|s| s.as_str())
        .collect();

    let optional_failures = errs.len() - hard_errors.len();
    if optional_failures > 0 && verbose {
        eprintln!("  [core] skipped {} optional WiFi/CYW43 source files (not needed for this board)",
                  optional_failures);
    }

    if !hard_errors.is_empty() && obj_files.iter().filter(|p| p.exists()).count() == 0 {
        return Err(FlashError::CompileFailed { output: hard_errors.join("\n") });
    }

    // Archive all successfully compiled objects into core.a.
    let _ = std::fs::remove_file(core_a); // start fresh
    let mut ar_cmd = Command::new(ar);
    ar_cmd.arg("rcs").arg(core_a);
    for obj in &obj_files {
        if obj.exists() { ar_cmd.arg(obj); }
    }

    let ar_out = ar_cmd.output()
        .map_err(|e| FlashError::CompileFailed { output: format!("ar failed: {}", e) })?;
    if !ar_out.status.success() {
        return Err(FlashError::CompileFailed {
            output: format!("ar: {}", String::from_utf8_lossy(&ar_out.stderr)),
        });
    }

    // Write sentinel so we can skip next time.
    let _ = std::fs::write(&sentinel, sig);
    Ok(())
}


// ── is_optional_core_file ─────────────────────────────────────────────────────
// Returns true for source files that are only needed when the board has WiFi
// (CYW43 chip) or other optional hardware.  Compile failures for these are
// expected on non-WiFi boards and should not abort core.a creation.
fn is_optional_core_file(err_msg: &str) -> bool {
    // Match against typical file/dir names in the earlephilhower core that are
    // WiFi/CYW43-only.  The error messages start with "core: <path>" so we
    // check the first line.
    let first_line = err_msg.lines().next().unwrap_or(err_msg).to_lowercase();
    let wifi_markers = [
        "cyw43",
        "libbearssl",
        "bearssl",
        "lwip_wrap",
        "lwiprouting",
        "wifi",
        "pico_w",
        "picow",
        "async_context_threadsafe",
        "sdkoverrides",
        // Some CYW43 sources live in rp2_common in embedded pico-sdk
        "rp2_common/cyw43",
    ];
    wifi_markers.iter().any(|m| first_line.contains(m))
}

// ── UF2 generation ────────────────────────────────────────────────────────────
// https://github.com/microsoft/uf2
// Each UF2 block is 512 bytes and wraps up to 256 bytes of payload.

const RP2040_FLASH_BASE: u32 = 0x1000_0000;
const RP2040_FAMILY_ID:  u32 = 0xe48b_ff56;

const UF2_MAGIC_START0: u32 = 0x0A32_4655;
const UF2_MAGIC_START1: u32 = 0x9E5D_5157;
const UF2_MAGIC_END:    u32 = 0xAB16_F30E;
const UF2_FLAG_FAMILY:  u32 = 0x0000_2000;
const UF2_PAYLOAD_SIZE: usize = 256;
const UF2_BLOCK_SIZE:   usize = 512;

fn bin_to_uf2(bin: &[u8], base_addr: u32, family_id: u32) -> std::result::Result<Vec<u8>, ()> {
    let num_blocks = bin.chunks(UF2_PAYLOAD_SIZE).count() as u32;
    let mut out = Vec::with_capacity(num_blocks as usize * UF2_BLOCK_SIZE);

    for (block_no, chunk) in bin.chunks(UF2_PAYLOAD_SIZE).enumerate() {
        let target_addr = base_addr + (block_no as u32 * UF2_PAYLOAD_SIZE as u32);

        let mut block = [0u8; UF2_BLOCK_SIZE];
        let write_u32 = |buf: &mut [u8], offset: usize, val: u32| {
            buf[offset..offset + 4].copy_from_slice(&val.to_le_bytes());
        };

        write_u32(&mut block, 0,  UF2_MAGIC_START0);
        write_u32(&mut block, 4,  UF2_MAGIC_START1);
        write_u32(&mut block, 8,  UF2_FLAG_FAMILY);
        write_u32(&mut block, 12, target_addr);
        write_u32(&mut block, 16, UF2_PAYLOAD_SIZE as u32);
        write_u32(&mut block, 20, block_no as u32);
        write_u32(&mut block, 24, num_blocks);
        write_u32(&mut block, 28, family_id);
        block[32..32 + chunk.len()].copy_from_slice(chunk);
        write_u32(&mut block, 508, UF2_MAGIC_END);

        out.extend_from_slice(&block);
    }
    Ok(out)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn resolve_tool(toolchain_bin: &Path, name: &str) -> PathBuf {
    // When toolchain_bin is non-empty, look for the binary inside it.
    // We try both the plain name and the .exe variant (Windows) regardless of
    // OS so a Windows SDK mounted on Linux (or vice-versa) still resolves.
    if toolchain_bin != Path::new("") {
        let candidate = toolchain_bin.join(name);
        if candidate.is_file() { return candidate; }

        let with_exe = toolchain_bin.join(format!("{}.exe", name));
        if with_exe.is_file() { return with_exe; }

        // Some earlephilhower Windows packages name the binary with the full
        // target triple prefix, e.g. "arm-none-eabi-g++.exe" inside a dir
        // whose parent is named "pqt-gcc-arm-none-eabi".  The simple join above
        // should already handle this; the fallback is a best-effort scan.
    }

    // toolchain_bin is empty → rely on system PATH.
    // Return just the binary name; std::process::Command resolves it via PATH.
    PathBuf::from(name)
}

fn collect_sources(sketch_dir: &Path) -> Result<Vec<PathBuf>> {
    let mut sources = Vec::new();
    for entry in WalkDir::new(sketch_dir).max_depth(2).into_iter().filter_map(|e| e.ok()) {
        let p = entry.path();
        if p.is_file() {
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
            if matches!(ext, "cpp" | "c" | "S") {
                sources.push(p.to_owned());
            }
        }
    }
    Ok(sources)
}

// ── find_pico_sdk_libs ────────────────────────────────────────────────────────
//
// Locates the prebuilt pico-sdk static libraries (.a files) that the linker
// needs to resolve pico-sdk symbols (gpio_init, sleep_ms, tud_task_ext, …).
//
// For earlephilhower arduino-pico 5.x, the pico-sdk is shipped as a separate
// tool package named "pqt-pico-sdk":
//   <packages>/rp2040/tools/pqt-pico-sdk/<ver>/lib/*.a
//
// For ≤4.x layouts where the pico-sdk is embedded in the platform directory:
//   <platform>/lib/*.a
//   <platform>/pico-sdk/lib/*.a
//
// Returns all .a files found, sorted for deterministic link order.
fn find_pico_sdk_libs(core_dir: &Path, toolchain_bin: &Path, verbose: bool) -> Vec<PathBuf> {
    // Collect all .a files from a directory (nested fn avoids borrow issues with closure)
    fn collect_a(dir: &Path, out: &mut Vec<PathBuf>) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() && p.extension().and_then(|e| e.to_str()) == Some("a") {
                    if !out.contains(&p) { out.push(p); }
                }
            }
        }
    }

    // ── Two independent ways to reach packages/rp2040 ────────────────────
    //
    // Method A: navigate up from core_dir
    //   core_dir = …/packages/rp2040/hardware/rp2040/<ver>/cores/arduino
    //   cores/      ← parent
    //   <ver>/      ← parent  (platform_root)
    //   rp2040/     ← parent  (hw_arch)
    //   hardware/   ← parent
    //   rp2040/     ← parent  (packages_vendor)  ← 3 more levels up from platform_root
    //
    // Method B: navigate up from toolchain_bin (more reliable — we know it exists)
    //   toolchain_bin = …/packages/rp2040/tools/pqt-gcc/<ver>/bin
    //   <ver>/      ← parent
    //   pqt-gcc/    ← parent
    //   tools/      ← parent
    //   rp2040/     ← parent  (packages_vendor)

    let platform_root = core_dir.parent().and_then(|p| p.parent()).map(|p| p.to_owned());

    // Method A path
    let pv_from_core = platform_root.as_ref().and_then(|pr| {
        pr.parent().and_then(|p| p.parent()).and_then(|p| p.parent()).map(|p| p.to_owned())
    });

    // Method B path — toolchain_bin/../../.. = packages_vendor
    let pv_from_toolchain = toolchain_bin
        .parent()                // <ver>
        .and_then(|p| p.parent()) // pqt-gcc
        .and_then(|p| p.parent()) // tools
        .and_then(|p| p.parent()) // rp2040 (packages_vendor)
        .map(|p| p.to_owned());

    if verbose {
        eprintln!("  [pico-sdk-libs] core_dir:       {}", core_dir.display());
        eprintln!("  [pico-sdk-libs] toolchain_bin:  {}", toolchain_bin.display());
        if let Some(ref pv) = pv_from_core      { eprintln!("  [pico-sdk-libs] pv(core):       {}", pv.display()); }
        if let Some(ref pv) = pv_from_toolchain { eprintln!("  [pico-sdk-libs] pv(toolchain):  {}", pv.display()); }
    }

    let mut libs: Vec<PathBuf> = Vec::new();

    // Try both candidate packages_vendor paths; use whichever finds pqt-pico-sdk
    let candidates: Vec<PathBuf> = [pv_from_toolchain, pv_from_core]
        .into_iter()
        .flatten()
        .collect();

    for pv in &candidates {
        let tool_root = pv.join("tools").join("pqt-pico-sdk");
        if verbose { eprintln!("  [pico-sdk-libs] probing {}", tool_root.display()); }
        if !tool_root.is_dir() { continue; }

        if let Ok(entries) = std::fs::read_dir(&tool_root) {
            for entry in entries.flatten() {
                let ver_dir = entry.path();
                if !ver_dir.is_dir() { continue; }
                if verbose { eprintln!("  [pico-sdk-libs]   ver_dir: {}", ver_dir.display()); }

                // Flat lib/ directory
                collect_a(&ver_dir.join("lib"), &mut libs);
                // Some builds: lib/rp2040/
                collect_a(&ver_dir.join("lib").join("rp2040"), &mut libs);
                // Some builds: lib/<something>/ — scan one level of subdirs
                if let Ok(sub_entries) = std::fs::read_dir(ver_dir.join("lib")) {
                    for sub in sub_entries.flatten() {
                        let sp = sub.path();
                        if sp.is_dir() { collect_a(&sp, &mut libs); }
                    }
                }
            }
        }
        // Found at least something — stop trying other candidate paths
        if !libs.is_empty() { break; }
    }

    // <=4.x fallback: libs embedded in the platform directory itself
    if libs.is_empty() {
        if let Some(ref pr) = platform_root {
            if verbose { eprintln!("  [pico-sdk-libs] falling back to platform lib/"); }
            collect_a(&pr.join("lib"), &mut libs);
            collect_a(&pr.join("pico-sdk").join("lib"), &mut libs);
        }
    }

    if verbose {
        eprintln!("  [pico-sdk-libs] found {} .a file(s)", libs.len());
        for l in &libs { eprintln!("  [pico-sdk-libs]   {}", l.display()); }
    }

    libs.sort();
    libs
}

fn find_linker_script(core_dir: &Path, variant_dir: &Path) -> Option<PathBuf> {
    // earlephilhower pico-sdk linker scripts
    let candidates = [
        variant_dir.join("memmap_default.ld"),
        variant_dir.join("memmap.ld"),
        core_dir.join("memmap_default.ld"),
        core_dir.parent().and_then(|p| p.parent()).map(|p| p.join("lib/memmap_default.ld")).unwrap_or_default(),
    ];
    for c in &candidates {
        if c.exists() { return Some(c.clone()); }
    }
    None
}
// ── Extra include discovery (lwIP / pico-sdk) ─────────────────────────────────
//
// The earlephilhower arduino-pico core (IPAddress.h via ArduinoCore-API) needs
// <lwip/init.h>. The lwIP headers are bundled inside the pico-sdk that is
// downloaded as a separate tool alongside the core.
//
// Layout for 5.x (earlephilhower):
//   <packages>/rp2040/tools/pqt-pico-sdk/<ver>/lib/lwip/src/include/
//   <packages>/rp2040/tools/pqt-pico-sdk/<ver>/src/rp2040/
//   <packages>/rp2040/tools/pqt-pico-sdk/<ver>/src/common/pico_base/include/
//   <packages>/rp2040/tools/pqt-pico-sdk/<ver>/pico-sdk/lib/lwip/src/include/  (alt)
//
// Layout for ≤4.x (self-contained in platform):
//   <platform>/tools/libpico/include/
//   <platform>/pico-sdk/lib/lwip/src/include/
//
// Strategy: probe all known fixed paths first (fast, no directory walking).
// Fall back to a shallow scan of the tools dir only when nothing is found.
fn find_extra_includes(core_dir: &Path, variant_dir: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    // core_dir → <platform>/cores/arduino  (or cores/rp2040)
    // platform_root → <platform>  e.g. .../rp2040/hardware/rp2040/5.5.1
    let platform_root = match core_dir.parent().and_then(|p| p.parent()) {
        Some(p) => p.to_owned(),
        None    => return dirs,
    };

    // packages_vendor → <packages>/rp2040
    let packages_vendor = platform_root
        .parent()                             // strip <ver>
        .and_then(|p| p.parent())             // strip <arch>
        .and_then(|p| p.parent())             // strip hardware/
        .map(|p| p.to_owned());

    let mut add = |p: PathBuf| { if p.is_dir() && !dirs.contains(&p) { dirs.push(p); } };

    // ── ArduinoCore-API ───────────────────────────────────────────────────────
    // The earlephilhower core includes headers from ArduinoCore-API/api/ (e.g.
    // IPAddress.h, Stream.h) via #include <api/...> or direct includes.
    // This directory MUST be on the include path or IPAddress.h -> lwIP -> lwipopts
    // chains will fail with "file not found" deep in the chain.
    add(platform_root.join("ArduinoCore-API").join("api"));
    add(platform_root.join("ArduinoCore-API"));

    // ── ≤4.x paths (inside platform itself) ───────────────────────────────
    let pt = platform_root.join("tools");
    add(pt.join("libpico").join("include"));
    // generated/pico_base contains pico/version.h (pre-generated from version.h.in).
    // It lives directly under the platform root, NOT inside pico-sdk/src/.
    // Without it: pico.h:27 #include "pico/version.h" -> fatal error: file not found.
    add(platform_root.join("generated").join("pico_base"));

    // Some 4.x layouts embed the whole pico-sdk
    add(platform_root.join("pico-sdk").join("lib").join("lwip").join("src").join("include"));
    add(platform_root.join("pico-sdk").join("src").join("rp2040"));
    add(platform_root.join("pico-sdk").join("src").join("common").join("pico_base").join("include"));
    // pico-sdk 2.x renamed pico_base -> pico_base_headers
    add(platform_root.join("pico-sdk").join("src").join("common").join("pico_base_headers").join("include"));
    // lwipopts.h lives in the lwip contrib freertos port in earlephilhower 5.x
    // when the pico-sdk is embedded inside the platform root (tsuki-modules layout).
    // Without this path, opt.h:51 #include "lwipopts.h" fails with ENOENT.
    add(platform_root.join("pico-sdk").join("lib").join("lwip").join("contrib").join("ports").join("freertos").join("include"));
    // Some builds also place lwipopts.h in the bare-metal port
    add(platform_root.join("pico-sdk").join("lib").join("lwip").join("contrib").join("ports").join("unix").join("port").join("include"));

    // ── Embedded pico-sdk full source includes ────────────────────────────
    // The pico-sdk ships with its own hardware abstraction headers organised as:
    //   pico-sdk/src/
    //     common/<module>/include/       ← pico.h, types, etc.
    //     rp2_common/<module>/include/   ← pico/time.h, mutex.h, cyw43_arch.h, …
    //     boards/include/                ← board-level defines
    //     host/.../include/
    //
    // We scan 3 levels deep (src/<group>/<module>/include/) to capture all of
    // these without hard-coding every module name.  This is equivalent to what
    // the CMake build system does via target_include_directories on each SDK lib.
    {
        let pico_src = platform_root.join("pico-sdk").join("src");
        if pico_src.is_dir() {
            // Level 1: src/<group>/   e.g. common, rp2_common, boards
            // ── IMPORTANT: skip src/host/ ────────────────────────────────
            // src/host/ contains desktop-emulation stubs (hardware_irq.h,
            // hardware_pio.h, etc.) meant for host-side unit tests.  When
            // these directories land on the -I list they are resolved by the
            // compiler *before* the real device headers in src/rp2_common/,
            // because they share the same include path (e.g. <hardware/irq.h>).
            // The host stubs do NOT define the register-layout macros that the
            // device build requires, so `REG_FIELD_WIDTH` ends up undefined
            // inside `#if` directives → "missing binary operator" parse error →
            // clocks.h:482 "#error unsupported number of fractional bits".
            // Excluding src/host/ entirely fixes the error without affecting
            // any functionality because -DPICO_ON_DEVICE=1 already tells the
            // SDK to use the rp2_common device paths at the *preprocessor* level;
            // the compiler just must not find the host stubs first at the
            // *file-system* level.
            if let Ok(groups) = std::fs::read_dir(&pico_src) {
                for group in groups.flatten() {
                    let gp = group.path();
                    if !gp.is_dir() { continue; }
                    // Skip the host emulation directory — see comment above.
                    let group_name = gp.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("");
                    if group_name == "host" { continue; }
                    // Group-level include/ (e.g. src/boards/include/)
                    add(gp.join("include"));
                    // Level 2: src/<group>/<module>/include/
                    if let Ok(modules) = std::fs::read_dir(&gp) {
                        for module in modules.flatten() {
                            let mp = module.path();
                            if !mp.is_dir() { continue; }
                            add(mp.join("include"));
                        }
                    }
                }
            }
        }
    }

    // ── 5.x paths (pqt-pico-sdk tool download) ────────────────────────────
    if let Some(ref pv) = packages_vendor {
        let tool_root = pv.join("tools").join("pqt-pico-sdk");
        if tool_root.is_dir() {
            // Find the installed version directory (there should be exactly one)
            if let Ok(entries) = std::fs::read_dir(&tool_root) {
                for entry in entries.flatten() {
                    let ver_dir = entry.path();
                    if !ver_dir.is_dir() { continue; }

                    // Primary lwIP include root
                    add(ver_dir.join("lib").join("lwip").join("src").join("include"));
                    // Alternate layout: pico-sdk embedded inside the tool
                    add(ver_dir.join("pico-sdk").join("lib").join("lwip").join("src").join("include"));
                    // lwipopts.h — lwip contrib freertos port (earlephilhower 5.x)
                    add(ver_dir.join("lib").join("lwip").join("contrib").join("ports").join("freertos").join("include"));
                    add(ver_dir.join("pico-sdk").join("lib").join("lwip").join("contrib").join("ports").join("freertos").join("include"));
                    // pico_base headers (needed for pico/types.h etc.)
                    add(ver_dir.join("src").join("rp2040"));
                    add(ver_dir.join("src").join("common").join("pico_base").join("include"));
                    // pico-sdk 2.x renamed pico_base -> pico_base_headers
                    add(ver_dir.join("src").join("common").join("pico_base_headers").join("include"));
                    add(ver_dir.join("src").join("boards").join("include"));
                    // Some versions put everything under include/
                    add(ver_dir.join("include"));
                    // Generated headers (pico/config.h, lwipopts.h may live here)
                    // They are placed in the variant dir by the build system, but
                    // some setups need the platform-level generated includes too.
                    add(ver_dir.join("generated").join("pico_base"));
                }
            }
        }

        // Also check for a plain "pico-sdk" tool name (community builds)
        let plain_sdk = pv.join("tools").join("pico-sdk");
        if plain_sdk.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&plain_sdk) {
                for entry in entries.flatten() {
                    let ver_dir = entry.path();
                    if !ver_dir.is_dir() { continue; }
                    add(ver_dir.join("lib").join("lwip").join("src").join("include"));
                    add(ver_dir.join("src").join("rp2040"));
                    add(ver_dir.join("src").join("common").join("pico_base").join("include"));
                }
            }
        }
    }

    // ── lwipopts.h resolution ─────────────────────────────────────────────────
    //
    // lwipopts.h is NOT part of the lwIP source tree — it is a per-project/per-
    // variant configuration header that lwIP's own opt.h finds via a plain
    // `#include "lwipopts.h"` (quoted, not angle-bracket).
    //
    // With quoted includes the compiler searches:
    //   1. The directory of the file doing the #include  (lwip/src/include/lwip/)
    //   2. All -I directories in order
    //
    // The file ships inside the board variant directory in earlephilhower cores,
    // e.g. variants/XIAO_RP2040/lwipopts.h.  That path IS already in
    // common_flags via -I sdk.variant_dir — BUT common_flags is built and
    // appended BEFORE the extra includes returned by this function, so the
    // variant_dir ends up earlier in the search order.  The problem occurs when
    // the pico-sdk tool itself ships a *different* lwipopts.h (e.g. inside
    // generated/pico_base/) that appears before the variant dir; or when
    // build systems expect the variant dir to be discoverable as a *second-pass*
    // -I added after the lwIP include root.
    //
    // Safest fix: always append the variant_dir here too, so it appears as a
    // second -I entry after the lwIP headers.  Duplicate -I entries are harmless
    // (GCC deduplicates them internally).
    add(variant_dir.to_owned());

    // Also check for a "generated" directory inside the variant (some 5.x cores
    // place pico_base/config.h and lwipopts.h there):
    add(variant_dir.join("generated").join("pico_base"));

    dirs
}