#!/usr/bin/env python3
"""
build.py — Tsuki Full Build System
======================================
Ejecutar simplemente:  python build.py

Construye todos los binarios y empaqueta:
  - Linux / macOS  → tar.gz con install.sh + uninstall.sh (CLI interactivo)
  - Windows        → setup .exe con GUI (Inno Setup) con opciones avanzadas

Argumentos opcionales:
  --platform  linux-amd64 | linux-arm64 | darwin-amd64 | darwin-arm64 | windows-amd64
  --skip-go       Omite compilar el CLI Go
  --skip-rust     Omite compilar los binarios Rust
  --skip-ide      Omite compilar la IDE Tauri
  --no-clean      No limpiar dist/ antes de compilar
  --version X.Y.Z Fuerza una versión específica
"""

import argparse
import datetime
import json
import os
import platform
import shutil
import subprocess
import sys
import textwrap

# ─────────────────────────────────────────────
#  CONFIGURACIÓN CENTRAL
# ─────────────────────────────────────────────
PROJECT_ROOT   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_NAME       = "tsuki"
BINARY         = "tsuki"          # CLI principal
CORE_BINARY    = "tsuki-core"
FLASH_BINARY   = "tsuki-flash"
GO_MODULE      = "github.com/tsuki/cli"
BUILD_DIR      = os.path.join(PROJECT_ROOT, "dist")
# RELEASE_DIR can be overridden via env var to avoid antivirus interference.
# Example: set TSUKI_RELEASE_DIR=C:\Users\you\Desktop\tsuki-releases
RELEASE_DIR    = os.environ.get(
    "TSUKI_RELEASE_DIR",
    os.path.join(PROJECT_ROOT, "releases")
)
IDE_DIR        = os.path.join(PROJECT_ROOT, "ide")
FLASH_DIR      = PROJECT_ROOT   # Rust crate: tsuki-core + tsuki-flash
REGISTRY_URL   = "https://raw.githubusercontent.com/s7lver2/tsuki/refs/heads/main/pkg/packages.json"
RELEASES_REPO_DIR = os.path.join(PROJECT_ROOT, "releases")  # also the RELEASE_DIR — json files live here too
KEYS_DIR       = os.path.join(PROJECT_ROOT, "tools", "keys")  # NOT committed — .gitignore this
UPDATE_MANIFEST_STABLE  = os.path.join(RELEASE_DIR, "update-stable.json")
UPDATE_MANIFEST_TESTING = os.path.join(RELEASE_DIR, "update-testing.json")
# GitHub raw URL base for update asset downloads (change to your own repo)
GITHUB_RELEASES_BASE = "https://github.com/s7lver2/tsuki/releases/download"
PUBLISHER      = "tsuki Team"
PUBLISHER_URL  = "https://github.com/s7lver2/tsuki"
OTHER_RESIDUAL_DIRS = [
  f"{PROJECT_ROOT}/target",
  f"{PROJECT_ROOT}/dist",
  f"{PROJECT_ROOT}/bin",
  f"{PROJECT_ROOT}/ide/src-tauri/target",
]

PLATFORMS = {
    # -- Linux --------------------------------------------------------
    "linux-amd64":   {"goos": "linux",   "goarch": "amd64",   "rust_target": "x86_64-unknown-linux-gnu",     "cross": False},
    "linux-arm64":   {"goos": "linux",   "goarch": "arm64",   "rust_target": "aarch64-unknown-linux-gnu",    "cross": True},
    "linux-arm":     {"goos": "linux",   "goarch": "arm",     "rust_target": "armv7-unknown-linux-gnueabihf","cross": True},  # RPi/ARMv7 32-bit
    "linux-386":     {"goos": "linux",   "goarch": "386",     "rust_target": "i686-unknown-linux-gnu",       "cross": True},
    "linux-riscv64": {"goos": "linux",   "goarch": "riscv64", "rust_target": "riscv64gc-unknown-linux-gnu",  "cross": True},
    # -- Windows ------------------------------------------------------
    "windows-amd64": {"goos": "windows", "goarch": "amd64",   "rust_target": "x86_64-pc-windows-msvc",      "cross": False},
    "windows-arm64": {"goos": "windows", "goarch": "arm64",   "rust_target": "aarch64-pc-windows-msvc",     "cross": True},
    "windows-386":   {"goos": "windows", "goarch": "386",     "rust_target": "i686-pc-windows-msvc",        "cross": True},
    # -- macOS --------------------------------------------------------
    "darwin-amd64":  {"goos": "darwin",  "goarch": "amd64",   "rust_target": "x86_64-apple-darwin",         "cross": False},
    "darwin-arm64":  {"goos": "darwin",  "goarch": "arm64",   "rust_target": "aarch64-apple-darwin",        "cross": False},
    # -- FreeBSD ------------------------------------------------------
    "freebsd-amd64": {"goos": "freebsd", "goarch": "amd64",   "rust_target": "x86_64-unknown-freebsd",      "cross": True},
    "freebsd-arm64": {"goos": "freebsd", "goarch": "arm64",   "rust_target": "aarch64-unknown-freebsd",     "cross": True},
}

# Platforms built by default in `release` mode.
# Use --platforms all  or  --platforms linux-amd64,linux-arm64  to override.
RELEASE_PLATFORMS = [
    "linux-amd64", "linux-arm64", "linux-arm",
    "windows-amd64", "windows-arm64",
    "darwin-amd64",  "darwin-arm64",
]

# ─────────────────────────────────────────────
#  UTILIDADES
# ─────────────────────────────────────────────
import shutil, sys as _sys

BOLD   = "\033[1m"
DIM    = "\033[2m"
GREEN  = "\033[32m"
CYAN   = "\033[36m"
YELLOW = "\033[33m"
RED    = "\033[31m"
BLUE   = "\033[34m"
RESET  = "\033[0m"
ERASE  = "\r\033[K"

def info(msg):  print(f"  {GREEN}✓{RESET}  {msg}")
def step(msg):  print(f"\n{BOLD}{CYAN}▶{RESET}  {BOLD}{msg}{RESET}")
def warn(msg):  print(f"  {YELLOW}⚠{RESET}  {msg}")
def error(msg): print(f"  {RED}✗{RESET}  {msg}")

# ── LiveBlock: Docker-style collapsible command output ────────────────────────

def _is_tty():
    return hasattr(_sys.stdout, "fileno") and _sys.stdout.isatty()

SPINNER_FRAMES = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]

TERM_W = lambda: shutil.get_terminal_size((100, 24)).columns

import threading as _threading

LIVE_LINES = 6   # content rows visible in the rolling window at any time


class LiveBlock:
    """Docker-style collapsible command block with rolling-window output.

    Design:
      - Spinner thread is the SOLE terminal writer in TTY mode (holds the lock
        on every redraw), so content writes and spinner frames never interleave.
      - `line()` buffers content only; the spinner picks it up on the next tick.
      - Only the last LIVE_LINES content rows are shown at once — older lines
        scroll out of view silently. The full buffer is kept for failure display.
      - On success  → window erased; one ✓ line replaces it.
      - On failure  → window erased, then ✗ + all buffered lines + summary.

    `_painted` tracks the exact number of content rows currently on screen
    (always ≤ LIVE_LINES), so `finish()` erases a bounded number of rows
    regardless of how many total lines the command produced.
    """

    def __init__(self, label: str):
        max_lbl = max(TERM_W() - 10, 20)
        self.label       = label if len(label) <= max_lbl else label[:max_lbl - 1] + "…"
        self._full_label = label
        self._lines: list[str] = []
        self._tty        = _is_tty()
        self._stop       = _threading.Event()
        self._lock       = _threading.Lock()
        self._thread     = None
        self._t0         = None
        self._rc         = None
        self._painted    = 0   # content lines currently visible on screen

    # ── Internal redraw ───────────────────────────────────────────────────────

    def _redraw(self, frame: str) -> None:
        """Erase window, print last LIVE_LINES content rows + spinner.

        Must be called with self._lock held.
        Cursor starts and ends on the spinner line (no trailing newline).
        """
        # 1. Clear spinner line (cursor is on it via \r).
        _sys.stdout.write("\r\033[K")
        # 2. Move up through the content rows painted last cycle and clear each.
        for _ in range(self._painted):
            _sys.stdout.write("\033[A\033[K")
        # 3. Re-render the visible content window.
        w = TERM_W()
        visible = self._lines[-LIVE_LINES:] if self._lines else []
        for s in visible:
            display = s[:w - 8] if len(s) > w - 8 else s
            _sys.stdout.write(f"  {DIM}│{RESET}  {display}\n")
        # 4. Re-render spinner (cursor stays on this line, no \n).
        _sys.stdout.write(f"  {CYAN}{frame}{RESET}  {self.label}\033[K")
        _sys.stdout.flush()
        self._painted = len(visible)

    # ── Spinner ───────────────────────────────────────────────────────────────

    def _start_spinner(self) -> None:
        import itertools as _it
        def _spin():
            for frame in _it.cycle(SPINNER_FRAMES):
                if self._stop.is_set():
                    break
                with self._lock:
                    self._redraw(frame)
                self._stop.wait(0.08)
        self._thread = _threading.Thread(target=_spin, daemon=True)
        self._thread.start()

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self) -> None:
        import time as _t
        self._t0 = _t.monotonic()
        if self._tty:
            # Print the initial spinner line so _redraw() has a row to start from.
            _sys.stdout.write(f"  {CYAN}{SPINNER_FRAMES[0]}{RESET}  {self.label}\033[K")
            _sys.stdout.flush()
            self._start_spinner()
        else:
            print(f"  …  {self.label}")

    def line(self, s: str) -> None:
        """Buffer a content line.  TTY redraws happen in the spinner thread."""
        if not s:
            return
        self._lines.append(s)
        # Non-TTY (CI/pipe): print immediately so logs capture output.
        if not self._tty:
            w = TERM_W()
            print(f"  {DIM}│{RESET}  {s[:w - 8]}")

    def finish(self, ok: bool, summary: str = "") -> None:
        import time as _t
        elapsed     = _t.monotonic() - self._t0 if self._t0 else 0
        elapsed_str = f"{elapsed*1000:.0f}ms" if elapsed < 1 else f"{elapsed:.1f}s"

        # Stop the spinner thread before touching the terminal.
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=0.4)

        if self._tty:
            with self._lock:
                # Erase exactly the rows that are on screen: content + spinner.
                _sys.stdout.write("\r\033[K")          # clear spinner line
                for _ in range(self._painted):         # clear content rows
                    _sys.stdout.write("\033[A\033[K")
                _sys.stdout.flush()

        if ok:
            print(f"  {GREEN}✓{RESET}  {self.label}  {DIM}[{elapsed_str}]{RESET}")
        else:
            print(f"  {RED}✗{RESET}  {self.label}")
            w = TERM_W()
            for l in self._lines:
                if l:
                    print(f"  {DIM}│{RESET}  {l[:w - 8]}")
            msg = summary or (f"exit {self._rc}" if self._rc is not None else "failed")
            print(f"  {DIM}╰─ {msg}{RESET}")

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is None:
            self.finish(ok=True)
        else:
            self.finish(ok=False, summary=str(exc_val) if exc_val else "error")
        return False


def run(cmd, cwd=None, env=None, check=True, label=None):
    """Ejecuta un comando mostrando su salida en tiempo real dentro de un LiveBlock.

    Éxito  → bloque colapsado:  ✓ comando  [1.3s]
    Fallo  → bloque expandido:  ✗ comando
                                │  línea de error…
                                ╰─ exit 1

    Notas de implementación:
      - Usa readline() en vez de iterar el fichero para evitar el buffering
        que provoca que las líneas de cargo/npm lleguen en ráfagas.
      - encoding='utf-8' evita caracteres mojibake en terminales Windows CP1252.
    """
    if label:
        display = label
    else:
        parts = [str(x) for x in cmd]
        display = " ".join(parts)
        if len(display) > 64:
            display = parts[0].split("/")[-1].split("\\")[-1]
            for p in parts[1:]:
                candidate = display + " " + p
                if len(candidate) > 62:
                    display += " …"
                    break
                display = candidate

    blk = LiveBlock(display)
    blk.start()

    proc = subprocess.Popen(
        cmd, cwd=cwd, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        encoding="utf-8", errors="replace",
        bufsize=1,
    )

    output_lines: list[str] = []
    try:
        # readline() is more reliable than `for line in proc.stdout` for real-time
        # output from processes that buffer internally (cargo, npm, next build).
        while True:
            line = proc.stdout.readline()
            if not line:
                break
            line = line.rstrip("\n").rstrip("\r")
            output_lines.append(line)
            blk.line(line)
    except Exception:
        pass
    proc.wait()

    output = "\n".join(output_lines)
    blk._rc = proc.returncode

    if proc.returncode != 0:
        summary_lines = [l for l in output_lines if l.strip()]
        summary = summary_lines[-1][:100] if summary_lines else f"exit {proc.returncode}"
        blk.finish(ok=False, summary=f"exit {proc.returncode} — {summary}")
        if check:
            raise subprocess.CalledProcessError(proc.returncode, cmd, output)
    else:
        blk.finish(ok=True)

    class _Result:
        returncode = proc.returncode
        stdout = output
    return _Result()

def check_tool(name, *args):
    """Devuelve True si la herramienta está disponible.

    - Rutas absolutas (ej. C:\\Program Files\\...\\ISCC.exe):
      se verifica con os.path.isfile() directamente.
    - Nombres simples (ej. "npm", "go", "cargo"):
      se resuelven con shutil.which() que maneja .cmd/.bat en Windows.
    """
    if os.path.isabs(name):
        # Ruta absoluta — comprobar existencia directamente
        return os.path.isfile(name)

    # Nombre simple — resolver desde el PATH
    resolved = shutil.which(name)
    if resolved is None:
        return False
    if args:
        try:
            subprocess.run(
                [resolved, *args],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError:
            return False
    return True

def _sanitize_version(v):
    """Convierte cualquier string de version a X.Y.Z semver limpio.

    Ejemplos:
        "v5.0-12-g4ce00a0-dirty"  →  "5.0.0"
        "v1.2.3"                  →  "1.2.3"
        "1.4.0-beta.1"            →  "1.4.0"
        "abc123"  (solo hash)     →  "0.0.0-abc123"
    """
    import re
    # Strip leading 'v'
    v = v.lstrip("v")
    # Take everything up to the first '-' that follows a numeric portion
    # e.g. "5.0-12-g4ce00a0-dirty" → "5.0"
    m = re.match(r"(\d+(?:\.\d+)*)", v)
    if not m:
        # No numeric part at all (bare commit hash)
        return f"0.0.0-{v}"
    numeric = m.group(1)
    parts = numeric.split(".")
    # Pad to at least X.Y.Z
    while len(parts) < 3:
        parts.append("0")
    return ".".join(parts[:3])


def _version_to_numeric(semver):
    """Convierte X.Y.Z a X.Y.Z.0 para VersionInfoVersion de Inno Setup."""
    import re
    m = re.match(r"(\d+)\.(\d+)\.(\d+)", semver)
    if m:
        return f"{m.group(1)}.{m.group(2)}.{m.group(3)}.0"
    return "1.0.0.0"


def _read_cargo_version():
    """Lee la version del Cargo.toml raiz como fallback cuando git no tiene tags."""
    import re
    cargo = os.path.join(PROJECT_ROOT, "Cargo.toml")
    if not os.path.exists(cargo):
        return None
    try:
        with open(cargo, encoding="utf-8") as f:
            for line in f:
                m = re.match(r'version\s*=\s*"([^"]+)"', line.strip())
                if m:
                    return m.group(1)
    except OSError:
        return None
    return None


def get_version(forced=None):
    """Determina la version del build.

    Orden de prioridad:
      1. --version X.Y.Z  (flag explicito — siempre recomendado para releases)
      2. git describe --tags (si el repo tiene tags alcanzables desde HEAD)
      3. Cargo.toml [package].version  (fallback cuando no hay tags)
      4. "0.1.0"  (ultimo recurso, emite un aviso claro)
    """
    d = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if forced:
        clean = _sanitize_version(forced)
        info(f"Version forzada: {clean}")
        return clean, "manual", d

    # ── Intentar git describe ──────────────────────────────────────────────
    commit = "unknown"
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=PROJECT_ROOT, stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        pass

    try:
        raw = subprocess.check_output(
            ["git", "describe", "--tags", "--always", "--dirty"],
            cwd=PROJECT_ROOT, stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        raw = ""

    if raw:
        # git describe devuelve algo — pero puede ser solo un hash sin tags
        # Un hash puro no contiene puntos ni empieza con v+digito
        import re
        has_tag = bool(re.match(r"v?\d", raw))
        if has_tag:
            return _sanitize_version(raw), commit, d

        # Solo un hash — no hay tags en el repo
        warn(f"git describe devolvio solo un hash ({raw!r}) — el repo no tiene tags alcanzables.")

    # ── Fallback 1: Cargo.toml ────────────────────────────────────────────
    cargo_v = _read_cargo_version()
    if cargo_v:
        warn(f"Usando version de Cargo.toml: {cargo_v}")
        warn("Para fijar la version usa:  python tools/build.py release --version X.Y.Z")
        return _sanitize_version(cargo_v), commit, d

    # ── Fallback 2: placeholder ───────────────────────────────────────────
    warn("No se pudo determinar la version automaticamente.")
    warn("Usa:  python tools/build.py release --version X.Y.Z")
    return "0.1.0", commit, d

def _rmtree_force(path):
    """rmtree que maneja PermissionError en Windows.

    Windows bloquea archivos (.dll, .exe, .pdb) cargados por procesos en
    ejecucion. La estrategia:
      1. Intentar borrar normalmente.
      2. Si falla con PermissionError, marcar como writable y reintentar.
      3. Si sigue fallando, avisar pero continuar (no abortar el build).
    """
    skipped = []

    def on_error(func, path, exc_info):
        import stat
        exc = exc_info[1]
        if isinstance(exc, PermissionError):
            try:
                os.chmod(path, stat.S_IWRITE)
                func(path)
                return
            except Exception:
                pass
        skipped.append(path)

    shutil.rmtree(path, onexc=on_error)

    if skipped:
        warn(f"  {len(skipped)} archivo(s) bloqueados por Windows (proceso en uso) — se omitieron:")
        for p in skipped[:5]:
            warn(f"    {p}")
        if len(skipped) > 5:
            warn(f"    ... y {len(skipped) - 5} más")
        warn("  Cierra todos los procesos de tsuki/IDE y ejecuta clean de nuevo si necesitas borrarlos.")


def clean(deep=False):
    """Limpia artefactos de build.

    deep=False  ->  solo dist/ y releases/  (rapido)
    deep=True   ->  tambien target/, cargo clean, etc.
    """
    step("Limpiando directorios de build")

    for d in [BUILD_DIR, RELEASE_DIR]:
        if os.path.exists(d):
            _rmtree_force(d)
            info(f"Eliminado {d}")

    if deep:
        for d in OTHER_RESIDUAL_DIRS:
            if os.path.exists(d):
                _rmtree_force(d)
                info(f"Eliminado {d}")
        result = subprocess.run(
            ["cargo", "clean"], cwd=PROJECT_ROOT,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
        )
        if result.returncode == 0:
            info("cargo clean completado")
        else:
            warn("cargo clean fallo (cargo disponible?)")

    os.makedirs(BUILD_DIR, exist_ok=True)
    os.makedirs(RELEASE_DIR, exist_ok=True)
    info("Directorios limpios")

# ─────────────────────────────────────────────
#  BUILD: GO CLI
# ─────────────────────────────────────────────
def build_go(platform_key, version, commit, date):
    step(f"Compilando Go CLI → {platform_key}")
    plat = PLATFORMS[platform_key]
    ext  = ".exe" if plat["goos"] == "windows" else ""
    out  = os.path.join(BUILD_DIR, f"{BINARY}-{platform_key}{ext}")

    ldflags = (
        f"-s -w "
        f"-X {GO_MODULE}/internal/cli.Version={version} "
        f"-X {GO_MODULE}/internal/cli.Commit={commit} "
        f"-X {GO_MODULE}/internal/cli.BuildDate={date}"
    )
    env = {**os.environ, "GOOS": plat["goos"], "GOARCH": plat["goarch"], "CGO_ENABLED": "0"}
    run(["go", "build", "-trimpath", "-ldflags", ldflags, "-o", out, "./cmd/tsuki"],
        cwd=os.path.join(PROJECT_ROOT, "cli"), env=env)
    info(f"Go CLI → {os.path.basename(out)}")
    return out

# ─────────────────────────────────────────────
#  BUILD: RUST (core + flash)
# ─────────────────────────────────────────────
def _detect_host_platform():
    """Devuelve la platform_key que corresponde al host actual."""
    sys_map = {"windows": "windows", "darwin": "darwin", "linux": "linux"}
    arch_map = {"x86_64": "amd64", "amd64": "amd64",
                "arm64": "arm64", "aarch64": "arm64"}
    os_name  = sys_map.get(platform.system().lower(), "linux")
    arch     = arch_map.get(platform.machine().lower(), "amd64")
    return f"{os_name}-{arch}"

HOST_PLATFORM = _detect_host_platform()

# ─────────────────────────────────────────────────────────────────────────────
#  CROSS-COMPILATION SIN DOCKER
#
#  Estrategia de prioridad (se elige la primera disponible):
#    1. Nativo  — cargo build sin --target (solo cuando platform == host)
#    2. zigbuild — cargo zigbuild --target <triple>  ← RECOMENDADO
#       Instalar: cargo install cargo-zigbuild
#                 pip install ziglang   (o zig en el PATH)
#    3. cargo + linker del sistema — cargo build --target con linker externo
#       Se activa si el linker conocido para el target está en el PATH.
#       Se escribe .cargo/config.toml automáticamente.
#    4. Skip con instrucciones detalladas
#
#  Linkers soportados por plataforma host:
#    Windows  →  Linux/BSD targets : zigbuild (recomendado)
#                Windows ARM64/x86 : MSVC (rustup target add)
#    Linux    →  todos los targets  : zigbuild o gcc-multilib / gcc-cross
#    macOS    →  Linux targets      : zigbuild
#                Apple Silicon/x64  : rustup target add (nativo)
# ─────────────────────────────────────────────────────────────────────────────

# Linker de sistema conocido para cada rust_target.
# Se busca en el PATH; si está presente se usa cargo --target + config.toml.
_KNOWN_LINKERS = {
    "x86_64-unknown-linux-gnu":      "x86_64-linux-gnu-gcc",
    "aarch64-unknown-linux-gnu":     "aarch64-linux-gnu-gcc",
    "armv7-unknown-linux-gnueabihf": "arm-linux-gnueabihf-gcc",
    "i686-unknown-linux-gnu":        "i686-linux-gnu-gcc",
    "x86_64-unknown-linux-musl":     "x86_64-linux-musl-gcc",
    "aarch64-unknown-linux-musl":    "aarch64-linux-musl-gcc",
    "x86_64-unknown-freebsd":        "x86_64-unknown-freebsd-gcc",
    "aarch64-unknown-freebsd":       "aarch64-unknown-freebsd-gcc",
    # Windows targets no necesitan linker externo — usan MSVC/lld del host
    "aarch64-pc-windows-msvc":       None,
    "i686-pc-windows-msvc":          None,
    # macOS targets necesitan SDK nativo — no hay linker externo para Windows
    "x86_64-apple-darwin":           None,
    "aarch64-apple-darwin":          None,
}

# Instrucciones de instalación del linker según el SO host
_LINKER_INSTALL = {
    "x86_64-linux-gnu-gcc":      "sudo apt install gcc-x86-64-linux-gnu   # Debian/Ubuntu",
    "aarch64-linux-gnu-gcc":     "sudo apt install gcc-aarch64-linux-gnu  # Debian/Ubuntu",
    "arm-linux-gnueabihf-gcc":   "sudo apt install gcc-arm-linux-gnueabihf",
    "i686-linux-gnu-gcc":        "sudo apt install gcc-i686-linux-gnu",
    "x86_64-linux-musl-gcc":     "sudo apt install musl-tools",
    "aarch64-linux-musl-gcc":    "sudo apt install musl-tools  # + cross-musl-aarch64",
}


# ── MSVC toolchain detection ──────────────────────────────────────────────────
# zigbuild no puede usar link.exe (flags incompatibles), así que para targets
# *-pc-windows-msvc necesitamos la toolchain MSVC nativa del host.
# Visual Studio instala toolchains por arquitectura en rutas predecibles.

# Arquitectura MSVC por rust_target
_MSVC_ARCH = {
    "aarch64-pc-windows-msvc": "arm64",
    "i686-pc-windows-msvc":    "x86",
    "x86_64-pc-windows-msvc":  "x64",   # host nativo — siempre disponible
}

# Rutas base donde buscar vcvarsall.bat / toolchains
_VS_BASE_PATHS = [
    r"C:\Program Files\Microsoft Visual Studio2\BuildTools",
    r"C:\Program Files\Microsoft Visual Studio2\Community",
    r"C:\Program Files\Microsoft Visual Studio2\Professional",
    r"C:\Program Files\Microsoft Visual Studio2\Enterprise",
    r"C:\Program Files (x86)\Microsoft Visual Studio9\BuildTools",
    r"C:\Program Files (x86)\Microsoft Visual Studio9\Community",
    r"C:\Program Files (x86)\Microsoft Visual Studio9\Professional",
    r"C:\Program Files (x86)\Microsoft Visual Studio9\Enterprise",
]


def _find_vcvarsall() -> str | None:
    """Devuelve la ruta completa a vcvarsall.bat, o None si no se encuentra."""
    for base in _VS_BASE_PATHS:
        candidate = os.path.join(base, "VC", "Auxiliary", "Build", "vcvarsall.bat")
        if os.path.isfile(candidate):
            return candidate
    # Fallback: buscar con vswhere.exe
    vswhere = os.path.join(
        os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
        "Microsoft Visual Studio", "Installer", "vswhere.exe",
    )
    if os.path.isfile(vswhere):
        try:
            out = subprocess.check_output(
                [vswhere, "-latest", "-property", "installationPath"],
                text=True, stderr=subprocess.DEVNULL,
            ).strip()
            candidate = os.path.join(out, "VC", "Auxiliary", "Build", "vcvarsall.bat")
            if os.path.isfile(candidate):
                return candidate
        except Exception:
            pass
    return None


def _msvc_arch_installed(vcvarsall: str, msvc_arch: str) -> bool:
    """True si la toolchain para msvc_arch está realmente instalada.

    vcvarsall.bat devuelve exit 1 si el componente no está instalado.
    """
    try:
        r = subprocess.run(
            ["cmd", "/c", f'call "{vcvarsall}" {msvc_arch} >nul 2>&1 && echo ok'],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=15,
        )
        return "ok" in r.stdout
    except Exception:
        return False


def _msvc_env_for(rust_target: str) -> dict | None:
    """Devuelve un dict de env vars con el entorno MSVC para rust_target, o None.

    Para el host nativo (x86_64-pc-windows-msvc) siempre devuelve os.environ.
    Para arm64 / i686 busca vcvarsall.bat y lo invoca con la arch correcta.
    """
    if rust_target == "x86_64-pc-windows-msvc":
        return dict(os.environ)   # host nativo — ya está configurado

    msvc_arch = _MSVC_ARCH.get(rust_target)
    if not msvc_arch:
        return None

    vcvarsall = _find_vcvarsall()
    if not vcvarsall:
        return None

    if not _msvc_arch_installed(vcvarsall, msvc_arch):
        return None

    # Capturar el entorno tras invocar vcvarsall
    try:
        out = subprocess.check_output(
            ["cmd", "/c", f'call "{vcvarsall}" {msvc_arch} && set'],
            text=True, stderr=subprocess.DEVNULL, timeout=30,
        )
        env = dict(os.environ)
        for line in out.splitlines():
            if "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()
        return env
    except Exception:
        return None


def _msvc_install_hint(rust_target: str) -> None:
    """Imprime instrucciones para instalar la toolchain MSVC necesaria."""
    msvc_arch = _MSVC_ARCH.get(rust_target, "?")
    arch_label = {
        "arm64": "MSVC ARM64 build tools",
        "x86":   "MSVC x86 build tools",
        "x64":   "MSVC x64 build tools (deberían estar instalados)",
    }.get(msvc_arch, msvc_arch)

    warn(f"  Para compilar {rust_target} necesitas: {arch_label}")
    warn("  Abre Visual Studio Installer → Modify → Individual components:")
    if msvc_arch == "arm64":
        warn("    ✓ MSVC v143 ARM64 build tools  (o v142 si usas VS 2019)")
        warn("    ✓ C++ ARM64 Spectre-mitigated libs  (opcional pero recomendado)")
        warn("  Alternatively: winget install Microsoft.VisualStudio.2022.BuildTools")
        warn("    -- add: --add Microsoft.VisualStudio.Component.VC.Tools.ARM64")
    elif msvc_arch == "x86":
        warn("    ✓ MSVC v143 x86/x64 build tools")
        warn("    ✓ Windows 10/11 SDK")


def _cargo_subcommand_exists(subcmd):
    """True si `cargo <subcmd> --help` no falla (el subcomando está instalado)."""
    try:
        r = subprocess.run(
            ["cargo", subcmd, "--help"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        return r.returncode == 0
    except OSError:
        return False


def _has_zigbuild():
    """True si cargo-zigbuild está instalado y accesible."""
    # Caso 1: cargo-zigbuild en PATH (instalado como binario independiente)
    if shutil.which("cargo-zigbuild") is not None:
        return True
    # Caso 2: registrado como subcomando de cargo
    if _cargo_subcommand_exists("zigbuild"):
        return True
    # Caso 3: en ~/.cargo/bin que puede no estar en PATH del proceso Python
    cargo_bin = _cargo_bin_dir()
    if cargo_bin:
        ext = ".exe" if platform.system().lower() == "windows" else ""
        if os.path.isfile(os.path.join(cargo_bin, f"cargo-zigbuild{ext}")):
            # Añadir al PATH del proceso para que shutil.which lo encuentre después
            os.environ["PATH"] = cargo_bin + os.pathsep + os.environ.get("PATH", "")
            return True
    return False


def _has_zig():
    """True si zig está en el PATH (requerido por cargo-zigbuild)."""
    if shutil.which("zig") is not None:
        return True
    # Buscar en scripts de pip / site-packages (pip install ziglang instala aquí)
    try:
        import ziglang  # type: ignore
        zig_bin = os.path.join(os.path.dirname(ziglang.__file__), "zig")
        ext = ".exe" if platform.system().lower() == "windows" else ""
        zig_exe = zig_bin + ext
        if os.path.isfile(zig_exe):
            os.environ["PATH"] = os.path.dirname(zig_exe) + os.pathsep + os.environ.get("PATH", "")
            return True
    except ImportError:
        pass
    return False


def _cargo_bin_dir():
    """Devuelve el directorio de binarios de cargo (~/.cargo/bin), o None."""
    # CARGO_HOME env override
    cargo_home = os.environ.get("CARGO_HOME")
    if cargo_home:
        d = os.path.join(cargo_home, "bin")
        return d if os.path.isdir(d) else None
    home = os.path.expanduser("~")
    d = os.path.join(home, ".cargo", "bin")
    return d if os.path.isdir(d) else None


# Evita preguntar "¿instalar zigbuild?" más de una vez por sesión de build.
_ZIGBUILD_INSTALL_ATTEMPTED = False


def _ensure_zigbuild(auto_install=True):
    """Instala cargo-zigbuild y ziglang si no están disponibles.

    Con auto_install=True pregunta al usuario antes de instalar (solo una vez
    por sesión aunque haya varios targets que lo necesiten).
    Devuelve True si zigbuild+zig están listos para usar.
    """
    global _ZIGBUILD_INSTALL_ATTEMPTED

    needs_zigbuild = not _has_zigbuild()
    needs_zig      = not _has_zig()

    if not needs_zigbuild and not needs_zig:
        return True  # ya todo OK

    if not auto_install or _ZIGBUILD_INSTALL_ATTEMPTED:
        return False  # ya se intentó o no se quiere instalar

    _ZIGBUILD_INSTALL_ATTEMPTED = True  # marcar antes de preguntar

    # ── Anunciar qué falta ────────────────────────────────────────────────────
    warn("cross-compilation requiere cargo-zigbuild y ziglang (zig).")
    if needs_zigbuild:
        warn("  cargo-zigbuild NO encontrado")
    if needs_zig:
        warn("  zig / ziglang NO encontrado")

    print()
    print(f"  {BOLD}Instalar automáticamente ahora?{RESET}")
    if needs_zigbuild:
        print("    cargo install cargo-zigbuild")
    if needs_zig:
        print("    pip install ziglang")
    print()
    ans = input("  [S/n] ").strip().lower()
    if ans not in ("", "s", "si", "y", "yes"):
        warn("Instalación cancelada — los targets remotos se omitirán.")
        return False

    ok = True

    if needs_zigbuild:
        step("Instalando cargo-zigbuild…")
        r = subprocess.run(["cargo", "install", "cargo-zigbuild"],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        if r.returncode != 0:
            error(f"cargo install cargo-zigbuild falló:\n{r.stdout[-800:]}")
            ok = False
        else:
            info("cargo-zigbuild instalado correctamente")
            # Refrescar PATH por si el binario acaba de aparecer
            cbd = _cargo_bin_dir()
            if cbd:
                os.environ["PATH"] = cbd + os.pathsep + os.environ.get("PATH", "")

    if needs_zig:
        step("Instalando ziglang via pip…")
        pip = shutil.which("pip3") or shutil.which("pip") or "pip"
        r = subprocess.run([pip, "install", "ziglang"],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        if r.returncode != 0:
            error(f"pip install ziglang falló:\n{r.stdout[-800:]}")
            ok = False
        else:
            info("ziglang instalado correctamente")
            # Forzar re-detección
            _has_zig()

    # Verificar que ahora están disponibles
    if ok and _has_zigbuild() and _has_zig():
        info("cargo-zigbuild + zig listos ✓")
        return True
    elif ok:
        warn("Instalación completada pero no se detectan en el PATH.")
        warn("Abre una terminal nueva y ejecuta el build de nuevo.")
        return False
    return False


def _system_linker_for(rust_target):
    """Devuelve el nombre del linker del sistema si está disponible, o None."""
    linker = _KNOWN_LINKERS.get(rust_target)
    if linker and shutil.which(linker):
        return linker
    return None


def _rustup_has_target(rust_target):
    """True si el target ya está instalado en rustup."""
    try:
        out = subprocess.check_output(
            ["rustup", "target", "list", "--installed"],
            stderr=subprocess.DEVNULL, text=True,
        )
        return rust_target in out
    except Exception:
        return False


def _ensure_rustup_target(rust_target):
    """Instala el target de rustup si no está presente. Devuelve True si OK."""
    if _rustup_has_target(rust_target):
        info(f"  rustup target ya instalado: {rust_target}")
        return True
    step(f"Instalando rustup target: {rust_target}")
    result = subprocess.run(
        ["rustup", "target", "add", rust_target],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    if result.returncode != 0:
        warn(f"  rustup target add falló:\n{result.stdout}")
        return False
    info(f"  rustup target instalado: {rust_target}")
    return True


def _write_cargo_config(rust_target, linker):
    """Escribe/actualiza .cargo/config.toml en PROJECT_ROOT con el linker indicado.

    Solo añade la entrada del target si no existe ya — no sobreescribe otros targets.
    """
    import re
    config_dir  = os.path.join(PROJECT_ROOT, ".cargo")
    config_path = os.path.join(config_dir, "config.toml")
    os.makedirs(config_dir, exist_ok=True)

    existing = ""
    if os.path.exists(config_path):
        with open(config_path, encoding="utf-8") as f:
            existing = f.read()

    section_header = f'[target.{rust_target}]'
    if section_header in existing:
        info(f"  .cargo/config.toml ya tiene sección para {rust_target}")
        return

    entry = f'\n[target.{rust_target}]\nlinker = "{linker}"\n'
    with open(config_path, "a", encoding="utf-8") as f:
        f.write(entry)
    info(f"  .cargo/config.toml actualizado → linker = {linker!r} para {rust_target}")


def _collect_cross_binaries(rust_target, platform_key, ext):
    """Copia los binarios desde target/{rust_target}/release/ a BUILD_DIR."""
    src_base = os.path.join(FLASH_DIR, "target", rust_target, "release")
    results = []
    for name in [CORE_BINARY, FLASH_BINARY]:
        src = os.path.join(src_base, f"{name}{ext}")
        dst = os.path.join(BUILD_DIR, f"{name}-{platform_key}{ext}")
        if not os.path.isfile(src):
            warn(f"  Binario no encontrado tras cross-build: {src}")
            results.append(None)
            continue
        shutil.copy(src, dst)
        info(f"Rust binary → {os.path.basename(dst)}")
        results.append(dst)
    core_out  = results[0] if results else None
    flash_out = results[1] if len(results) > 1 else None
    return core_out, flash_out


def build_rust(platform_key, force_cross=False):
    """Compila los binarios Rust sin Docker.

    Estrategia (primera disponible):
      1. Nativo   — cargo build --release  (solo si platform == HOST_PLATFORM)
      2. zigbuild — cargo zigbuild --target <triple>  (no necesita Docker)
         Requiere: cargo install cargo-zigbuild  +  pip install ziglang
      3. cargo   — cargo build --target <triple>  (necesita linker del sistema
         configurado en .cargo/config.toml — se escribe automáticamente)
      4. Skip con instrucciones de instalación
    """
    plat        = PLATFORMS[platform_key]
    ext         = ".exe" if plat["goos"] == "windows" else ""
    rust_target = plat["rust_target"]
    needs_cross = platform_key != HOST_PLATFORM

    # ── 1. Compilación nativa ─────────────────────────────────────────────────
    if not needs_cross:
        step(f"Compilando Rust (nativo) → {platform_key}")
        run(["cargo", "build", "--release"], cwd=FLASH_DIR)
        src_base = os.path.join(FLASH_DIR, "target", "release")
        results = []
        for name in [CORE_BINARY, FLASH_BINARY]:
            src = os.path.join(src_base, f"{name}{ext}")
            dst = os.path.join(BUILD_DIR, f"{name}-{platform_key}{ext}")
            shutil.copy(src, dst)
            info(f"Rust binary → {os.path.basename(dst)}")
            results.append(dst)
        return results[0], results[1]

    # ── 2a. MSVC targets: cargo nativo (zigbuild no soporta link.exe) ──────────
    # zigbuild usa zig como linker, pero zig no habla el protocolo de link.exe
    # (flags /NOLOGO, /SAFESEH, etc.) → falla siempre en *-pc-windows-msvc.
    # Estos targets requieren la toolchain MSVC del propio host Windows.
    is_msvc = rust_target.endswith("-pc-windows-msvc")
    if is_msvc:
        step(f"Compilando Rust (cargo MSVC) → {platform_key}  [{rust_target}]")
        # Necesita ARM64/x86 build tools instalados en Visual Studio
        msvc_env = _msvc_env_for(rust_target)
        if msvc_env is None:
            warn(f"  Toolchain MSVC para {rust_target} no encontrado.")
            _msvc_install_hint(rust_target)
            return None, None
        if not _ensure_rustup_target(rust_target):
            warn(f"  rustup target add {rust_target} falló — saltando {platform_key}")
            return None, None
        try:
            run(["cargo", "build", "--release", "--target", rust_target],
                cwd=FLASH_DIR, env=msvc_env)
            return _collect_cross_binaries(rust_target, platform_key, ext)
        except subprocess.CalledProcessError as e:
            warn(f"  cargo build MSVC falló (exit={e.returncode})")
            return None, None

    # ── 2b. cargo-zigbuild (non-MSVC: Linux, macOS, GNU, FreeBSD) ────────────
    if not _has_zigbuild() or not _has_zig():
        _ensure_zigbuild(auto_install=True)

    if _has_zigbuild() and _has_zig():
        step(f"Compilando Rust (zigbuild) → {platform_key}  [{rust_target}]")
        if not _ensure_rustup_target(rust_target):
            warn(f"  No se pudo instalar el rustup target {rust_target} — saltando zigbuild")
        else:
            try:
                run(["cargo", "zigbuild", "--release", "--target", rust_target],
                    cwd=FLASH_DIR)
                return _collect_cross_binaries(rust_target, platform_key, ext)
            except subprocess.CalledProcessError as e:
                warn(f"  cargo zigbuild falló (exit={e.returncode}) — intentando siguiente estrategia")

    # ── 3. cargo --target con linker del sistema ──────────────────────────────
    linker = _system_linker_for(rust_target)

    if linker:
        step(f"Compilando Rust (cargo --target) → {platform_key}  [{rust_target}]")
        _write_cargo_config(rust_target, linker)
        info(f"  linker del sistema: {linker}")
        if not _ensure_rustup_target(rust_target):
            warn(f"  rustup target add falló — saltando {platform_key}")
            return None, None
        try:
            run(["cargo", "build", "--release", "--target", rust_target],
                cwd=FLASH_DIR)
            return _collect_cross_binaries(rust_target, platform_key, ext)
        except subprocess.CalledProcessError as e:
            warn(f"  cargo build --target falló (exit={e.returncode})")

    # ── 4. Sin herramienta disponible — instrucciones ────────────────────────
    known_linker  = _KNOWN_LINKERS.get(rust_target)
    linker_install = _LINKER_INSTALL.get(known_linker or "", "")

    host_os = platform.system().lower()
    if host_os == "windows":
        cross_hint = (
            "  En Windows, la forma más sencilla sin Docker es cargo-zigbuild:\n"
            "    cargo install cargo-zigbuild\n"
            "    pip install ziglang\n"
            f"    rustup target add {rust_target}\n"
            f"    cargo zigbuild --release --target {rust_target}"
        )
    elif host_os == "linux":
        linker_cmd = f"\n    {linker_install}" if linker_install else ""
        cross_hint = (
            "  Opciones en Linux:\n"
            "  A) cargo-zigbuild (sin linker externo):\n"
            "       cargo install cargo-zigbuild && pip install ziglang\n"
            f"       rustup target add {rust_target}\n"
            f"       cargo zigbuild --release --target {rust_target}\n"
            f"  B) Linker del sistema:{linker_cmd or ' (no hay linker conocido para este target)'}\n"
            f"       rustup target add {rust_target}\n"
            f"       cargo build --release --target {rust_target}"
        )
    else:  # macOS
        cross_hint = (
            "  En macOS usa cargo-zigbuild para targets Linux/Windows:\n"
            "    cargo install cargo-zigbuild\n"
            "    pip install ziglang\n"
            f"    rustup target add {rust_target}\n"
            f"    cargo zigbuild --release --target {rust_target}"
        )

    warn(
        f"Rust omitido para {platform_key} (host={HOST_PLATFORM}).\n"
        f"  No se encontró herramienta de cross-compilación para [{rust_target}].\n"
        f"{cross_hint}"
    )
    return None, None

# ─────────────────────────────────────────────────────────────────────────────
#  BUILD: TAURI IDE
#
#  Cross-compilation strategy:
#    Mismo OS, distinta arch  →  zigbuild (CARGO=cargo-zigbuild)
#    macOS universal          →  --target universal-apple-darwin  (lipo automático)
#    Windows → Linux          →  WSL automático (si está disponible)
#    Otros cross-OS           →  skip con instrucciones
#
#  WSL (Windows Subsystem for Linux):
#    Permite compilar targets Linux desde Windows sin Docker.
#    Las dependencias nativas (webkit2gtk, gtk3, etc.) se instalan en WSL
#    automáticamente la primera vez. El código fuente se monta vía /mnt/c/.
#    El binario resultante se copia de vuelta a Windows.
# ─────────────────────────────────────────────────────────────────────────────

# ── WSL helpers ───────────────────────────────────────────────────────────────

# Paquetes APT requeridos por Tauri en Linux (Ubuntu 22.04+)
_TAURI_APT_DEPS = (
    "libwebkit2gtk-4.0-dev libgtk-3-dev libsoup2.4-dev "
    "libssl-dev libayatana-appindicator3-dev librsvg2-dev "
    "libglib2.0-dev build-essential curl wget file pkg-config"
)

# Marcar si ya instalamos deps en esta sesión (evitar repetir por cada target)
_WSL_DEPS_INSTALLED: dict = {}   # distro → True/False

# ── Distro preferida: Ubuntu.  Se busca en este orden. ───────────────────────
_WSL_PREFERRED_DISTROS = ["Ubuntu", "Ubuntu-22.04", "Ubuntu-20.04", "Ubuntu-24.04", "Debian"]

# Shell bootstrap que siempre carga ~/.cargo/env antes de ejecutar
# (necesario porque rustup instala en ~/.cargo/bin que no está en PATH por defecto)
_WSL_SHELL_INIT = (
    '[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"; '
    'export PATH="$HOME/.cargo/bin:$HOME/.local/bin:/usr/local/bin:$PATH"; '
)


def _wsl_find_ubuntu() -> str | None:
    """Devuelve el nombre de la distro Ubuntu preferida, o None si no hay ninguna."""
    try:
        out = subprocess.check_output(
            ["wsl", "--list", "--quiet"],
            stderr=subprocess.DEVNULL, timeout=8, text=False,
        )
        decoded = out.decode("utf-16-le", errors="replace").strip()
        distros = [
            l.strip().rstrip("\x00").replace("(Default)", "").replace("(Predeterminado)", "").strip()
            for l in decoded.splitlines()
            if l.strip()
        ]
        distros = [d for d in distros if d]
        # Devolver el primero que coincida con la lista de preferencias
        for preferred in _WSL_PREFERRED_DISTROS:
            for d in distros:
                if d.lower().startswith(preferred.lower()):
                    return d
        # Si no hay Ubuntu/Debian, devolver la primera disponible
        return distros[0] if distros else None
    except Exception:
        return None


def _has_wsl() -> bool:
    """True si WSL con Ubuntu (u otra distro Debian-based) está disponible."""
    if platform.system().lower() != "windows":
        return False
    distro = _wsl_find_ubuntu()
    if not distro:
        return False
    # Verificar que la distro responde
    try:
        r = subprocess.run(
            ["wsl", "-d", distro, "--", "echo", "ok"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10,
        )
        return r.returncode == 0
    except Exception:
        return False


def _win_to_wsl_path(win_path: str) -> str:
    """Convierte 'C:\\foo\\bar' → '/mnt/c/foo/bar'."""
    p = win_path.replace("\\", "/").replace("\\\\", "/")
    if len(p) >= 2 and p[1] == ":":
        drive = p[0].lower()
        rest  = p[2:].lstrip("/")
        return f"/mnt/{drive}/{rest}"
    return p


def _wsl_run(cmd_str: str, cwd_win: str | None = None, env_extra: dict | None = None,
             distro: str | None = None, check: bool = True) -> subprocess.CompletedProcess:
    """Ejecuta cmd_str en Ubuntu WSL.

    - Siempre usa -d <distro> para apuntar a Ubuntu (nunca la default aleatoria)
    - Siempre inyecta _WSL_SHELL_INIT para cargar ~/.cargo/env
    - Fuerza PATH limpio de Linux (descarta el PATH de Windows montado)
    """
    # Resolver distro: argumento > Ubuntu encontrado > default
    target_distro = distro or _wsl_find_ubuntu()

    cwd_wsl = _win_to_wsl_path(cwd_win) if cwd_win else None

    env_lines = _WSL_SHELL_INIT
    # Aislar PATH de Windows (los montajes /mnt/c/ traen npm.CMD, etc.)
    env_lines += (
        'export PATH="$HOME/.cargo/bin:$HOME/.local/bin:/usr/local/sbin:/usr/local/bin'
        ':/usr/sbin:/usr/bin:/sbin:/bin"; '
    )
    if env_extra:
        for k, v in env_extra.items():
            env_lines += f'export {k}="{v}"; '

    cd_part = f'cd "{cwd_wsl}" && ' if cwd_wsl else ""
    full    = f"{env_lines}{cd_part}{cmd_str}"

    wsl_argv = ["wsl"]
    if target_distro:
        wsl_argv += ["-d", target_distro]
    wsl_argv += ["--", "bash", "-lc", full]

    label = f"[WSL/{target_distro or 'default'}] $ {cmd_str[:100]}{'…' if len(cmd_str) > 100 else ''}"
    print(f"  {label}")
    result = subprocess.run(
        wsl_argv,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace",
    )
    output = result.stdout or ""
    lines  = output.strip().splitlines()

    if result.returncode != 0:
        sep = "─" * 60
        print(f"\n{RED}{sep}")
        print(f"  WSL FALLO (exit={result.returncode}): {cmd_str[:80]}")
        print(f"{sep}{RESET}")
        for line in lines:
            print(f"    {line}")
        print()
        if check:
            raise subprocess.CalledProcessError(result.returncode, wsl_argv, output)
    else:
        for line in lines[-12:]:
            print(f"    {line}")

    return result


def _wsl_tool_exists(tool: str, distro: str | None = None) -> bool:
    """True si `tool` está en el PATH de Linux dentro de WSL (ignorando /mnt/c/)."""
    try:
        # which busca solo en el PATH limpio inyectado por _wsl_run
        r = _wsl_run(f"which {tool} 2>/dev/null", distro=distro, check=False)
        if r.returncode != 0:
            return False
        path = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
        # Rechazar si apunta a un montaje de Windows
        return bool(path) and not path.startswith("/mnt/")
    except Exception:
        return False


def _wsl_ensure_cc(distro: str | None = None) -> bool:
    """Instala gcc/build-essential en WSL (requerido por rustup link step)."""
    if _wsl_tool_exists("cc", distro) or _wsl_tool_exists("gcc", distro):
        return True
    step("  WSL: instalando gcc / build-essential…")
    try:
        _wsl_run(
            "sudo apt-get update -qq && sudo apt-get install -y build-essential",
            distro=distro,
        )
        return True
    except subprocess.CalledProcessError:
        warn("  WSL: no se pudo instalar build-essential")
        return False


def _wsl_ensure_rust(distro: str | None = None) -> bool:
    """Instala rustup + cargo en WSL si no están presentes."""
    if _wsl_tool_exists("cargo", distro):
        info("  WSL: cargo ya instalado")
        return True
    # gcc es necesario para el linker de rustup
    _wsl_ensure_cc(distro)
    step("  WSL: instalando rustup…")
    try:
        _wsl_run(
            "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs "
            "| sh -s -- -y 2>&1",
            distro=distro,
        )
        # Verificar que cargo ya es visible (el init script lo carga)
        if _wsl_tool_exists("cargo", distro):
            info("  WSL: rustup instalado correctamente")
            return True
        warn("  WSL: cargo instalado pero no encontrado en PATH — puede requerir reiniciar WSL")
        return False
    except subprocess.CalledProcessError:
        warn("  WSL: rustup install falló")
        return False


def _wsl_ensure_node(distro: str | None = None) -> bool:
    """Instala Node.js/npm en WSL vía NodeSource (ignora npm.CMD de Windows)."""
    if _wsl_tool_exists("npm", distro):
        info("  WSL: npm Linux ya instalado")
        return True
    step("  WSL: instalando Node.js LTS (NodeSource)…")
    try:
        _wsl_run(
            "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - "
            "&& sudo apt-get install -y nodejs",
            distro=distro,
        )
        if _wsl_tool_exists("npm", distro):
            info("  WSL: Node.js instalado correctamente")
            return True
        warn("  WSL: npm no encontrado tras instalar Node.js")
        return False
    except subprocess.CalledProcessError:
        warn("  WSL: Node.js install falló")
        return False


def _wsl_ensure_tauri_deps(distro: str | None = None) -> bool:
    """Instala las dependencias nativas de Tauri en Ubuntu WSL."""
    global _WSL_DEPS_INSTALLED
    key = distro or "__default__"
    if _WSL_DEPS_INSTALLED.get(key):
        return True

    step("  WSL: instalando dependencias nativas de Tauri (webkit2gtk, gtk3…)…")
    try:
        _wsl_run(
            f"DEBIAN_FRONTEND=noninteractive sudo -E apt-get update -qq "
            f"&& DEBIAN_FRONTEND=noninteractive sudo -E apt-get install -y "
            f"--no-install-recommends {_TAURI_APT_DEPS}",
            distro=distro,
        )
        _WSL_DEPS_INSTALLED[key] = True
        info("  WSL: dependencias de Tauri instaladas")
        return True
    except subprocess.CalledProcessError:
        warn("  WSL: apt-get install falló.")
        warn("  Ejecuta manualmente en Ubuntu WSL:")
        warn(f"    sudo apt-get install -y {_TAURI_APT_DEPS}")
        return False


def _wsl_ensure_zigbuild(distro: str | None = None) -> bool:
    """Instala cargo-zigbuild + zig en WSL si no están (no bloqueante)."""
    has_zb = _wsl_tool_exists("cargo-zigbuild", distro)
    has_z  = _wsl_tool_exists("zig", distro)
    if has_zb and has_z:
        return True
    try:
        if not has_zb:
            _wsl_run("cargo install cargo-zigbuild", distro=distro)
        if not has_z:
            _wsl_run("pip3 install ziglang 2>/dev/null || pip install ziglang 2>/dev/null || true",
                     distro=distro)
        return True
    except subprocess.CalledProcessError:
        return False


def _wsl_rustup_target(rust_target: str, distro: str | None = None) -> bool:
    """Añade el rustup target dentro de WSL."""
    try:
        _wsl_run(f"rustup target add {rust_target}", distro=distro, check=False)
        return True
    except Exception:
        return False


def _wsl_build_tauri(platform_key: str, version: str) -> tuple[str | None, str | None]:
    """Compila la IDE Tauri para platform_key usando WSL.

    Se usa cuando:
      - El host es Windows
      - El target es Linux (webkit2gtk solo disponible en Linux)
      - WSL está disponible

    Devuelve (ide_bundle_dir_windows, exe_name) o (None, None) si falla.
    """
    plat        = PLATFORMS[platform_key]
    rust_target = plat["rust_target"]

    distro = _wsl_default_distro()
    step(f"Compilando Tauri IDE vía WSL → {platform_key}  [{rust_target}]")
    if distro:
        info(f"  Distro WSL: {distro}")
    else:
        warn("  No se encontró distro WSL por defecto — usando WSL sin -d")

    # ── Asegurar herramientas en WSL ─────────────────────────────────────────
    if not _wsl_ensure_rust(distro):
        warn("  WSL: cargo no disponible — abortando build WSL")
        return None, None

    if not _wsl_ensure_node(distro):
        warn("  WSL: npm no disponible — abortando build WSL")
        return None, None

    if not _wsl_ensure_tauri_deps(distro):
        warn("  WSL: dependencias nativas no instaladas — abortando build WSL")
        return None, None

    # cargo-zigbuild en WSL (para targets arm64/arm dentro de Linux)
    _wsl_ensure_zigbuild(distro)

    # rustup target
    _wsl_rustup_target(rust_target, distro)

    # ── Paths ───────────────────────────────────────────────────────────────
    ide_dir_win  = IDE_DIR                         # Windows path
    ide_dir_wsl  = _win_to_wsl_path(ide_dir_win)  # /mnt/c/...
    proj_dir_wsl = _win_to_wsl_path(PROJECT_ROOT)

    # Patch Cargo.toml version (desde Windows — el archivo es compartido)
    ide_cargo = os.path.join(IDE_DIR, "src-tauri", "Cargo.toml")
    if _patch_cargo_version(ide_cargo, version):
        info(f"  ide/src-tauri/Cargo.toml → version = \"{version}\"")

    # ── npm install en WSL ───────────────────────────────────────────────────
    # node_modules de Windows no sirven para Linux; necesitamos los Linux bindings
    # Usamos --prefix para no pisar el node_modules de Windows
    wsl_nm = f"{ide_dir_wsl}/.node_modules_wsl"
    step("  WSL: npm install (Linux bindings)…")
    try:
        _wsl_run(
            f"npm install --prefix \"{wsl_nm}\"",
            cwd_win=IDE_DIR, distro=distro,
        )
    except subprocess.CalledProcessError as e:
        warn(f"  WSL: npm install falló (exit={e.returncode})")
        return None, None

    # ── tauri build en WSL ───────────────────────────────────────────────────
    # CARGO_BUILD_TARGET y NODE_PATH para usar el node_modules de WSL
    step(f"  WSL: tauri build --target {rust_target}…")
    env_extra = {
        "NODE_PATH": f"{wsl_nm}/node_modules",
        "npm_config_prefix": wsl_nm,
        "CGO_ENABLED": "0",
    }
    # Usar cargo-zigbuild si está disponible en WSL (para arm64 dentro de Linux)
    if _wsl_tool_exists("cargo-zigbuild", distro):
        env_extra["CARGO"] = "cargo-zigbuild"

    try:
        _wsl_run(
            f"npm --prefix \"{wsl_nm}\" run tauri build -- --target {rust_target}",
            cwd_win=IDE_DIR, distro=distro, env_extra=env_extra,
        )
    except subprocess.CalledProcessError as e:
        warn(f"  WSL: tauri build falló (exit={e.returncode})")
        return None, None

    # ── Localizar el binario resultante ──────────────────────────────────────
    # Tauri escribe el binario en src-tauri/target/<rust_target>/release/
    # Ese path está en /mnt/c/... en WSL, pero también accesible desde Windows
    release_dir = os.path.join(IDE_DIR, "src-tauri", "target", rust_target, "release")
    exe_name    = "tsuki-ide"   # Linux — sin extensión

    exe_src = None
    if os.path.isfile(os.path.join(release_dir, exe_name)):
        exe_src = os.path.join(release_dir, exe_name)
    else:
        # Fallback: cualquier ejecutable sin extensión
        if os.path.isdir(release_dir):
            for f in os.listdir(release_dir):
                fp = os.path.join(release_dir, f)
                if os.path.isfile(fp) and "." not in f and not f.startswith("."):
                    exe_src  = fp
                    exe_name = f
                    break

    if not exe_src:
        warn(f"  WSL: ejecutable no encontrado en {release_dir}")
        return None, None

    # Copiar a BUILD_DIR (también compartido — accesible desde Windows)
    dst = os.path.join(BUILD_DIR, f"ide-{platform_key}")
    os.makedirs(dst, exist_ok=True)
    shutil.copy(exe_src, os.path.join(dst, exe_name))
    info(f"  WSL: Tauri IDE → {dst}/{exe_name}")
    return dst, exe_name


def _tauri_same_os_arch_pairs():
    """Devuelve los platform_keys del mismo OS que el host pero distinta arch."""
    host_goos = PLATFORMS[HOST_PLATFORM]["goos"]
    viable = []
    for pk, plat in PLATFORMS.items():
        if pk == HOST_PLATFORM:
            continue
        if plat["goos"] != host_goos:
            continue
        viable.append(pk)
    return viable


def _tauri_can_cross(platform_key: str) -> bool:
    """True si build_tauri puede intentar compilar para platform_key desde el host.

    Retorna True si:
      - Es el host nativo
      - Mismo OS, distinta arch
      - Windows → Linux Y WSL disponible
    """
    if platform_key == HOST_PLATFORM:
        return True
    host_goos   = PLATFORMS[HOST_PLATFORM]["goos"]
    target_goos = PLATFORMS[platform_key]["goos"]
    if host_goos == target_goos:
        return True   # Mismo OS, distinta arch
    # Windows → Linux con WSL
    if host_goos == "windows" and target_goos == "linux" and _has_wsl():
        return True
    return False

def _patch_cargo_version(cargo_path, version):
    """Actualiza version = \"X.Y.Z\" en un Cargo.toml.

    Evita backreferences en re.subn — usa reemplazo de línea directa.
    """
    import re
    with open(cargo_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    patched = False
    for i, line in enumerate(lines):
        if re.match(r'^version\s*=\s*"[^"]+"', line):
            lines[i] = f'version = "{version}"\n'
            patched = True
            break  # solo la primera aparicion ([package], no dependencias)
    if not patched:
        warn(f"  No se encontro 'version = ...' en {cargo_path}")
        return False
    with open(cargo_path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    return True


def build_tauri(platform_key, version):
    """Compila la IDE Tauri para platform_key.

    Cross-compilation (sin Docker):
      Mismo OS, distinta arch  →  CARGO=cargo-zigbuild + tauri build --target
      macOS universal          →  --target universal-apple-darwin
      Cross OS                 →  imposible (webkit2gtk / WebView2 / WebKit son
                                  librerías nativas que deben existir en la máquina
                                  de compilación del OS destino)
    """
    plat        = PLATFORMS[platform_key]
    rust_target = plat["rust_target"]
    needs_cross = platform_key != HOST_PLATFORM
    host_goos   = PLATFORMS[HOST_PLATFORM]["goos"]
    target_goos = plat["goos"]

    # ── Cross-OS ─────────────────────────────────────────────────────────────
    if needs_cross and not _tauri_can_cross(platform_key):
        warn(f"Tauri IDE omitido para {platform_key}: cross-OS no soportado desde {HOST_PLATFORM}.")
        warn(f"  Librerías nativas requeridas en tiempo de compilación:")
        if target_goos == "linux":
            warn("    webkit2gtk, gtk3, libsoup — solo disponibles en Linux")
            if platform.system().lower() == "windows":
                warn("    (instala WSL para compilar targets Linux automáticamente)")
        elif target_goos == "windows":
            warn("    WebView2 SDK, MSVC headers — solo disponibles en Windows")
        elif target_goos == "darwin":
            warn("    WebKit.framework, macOS SDK — solo disponibles en macOS")
            warn("    No hay forma de compilar targets macOS desde Windows o Linux.")
            warn("    Opciones: GitHub Actions (runner: macos-latest), Mac nativo, o CI/CD.")
        else:
            warn(f"  Alternativas: WSL, GitHub Actions, VM con {target_goos}.")
        return None, None

    # ── Windows → Linux: delegar a WSL ───────────────────────────────────────
    if needs_cross and host_goos == "windows" and target_goos == "linux":
        return _wsl_build_tauri(platform_key, version)

    step(f"Compilando Tauri IDE → {platform_key}")

    # ── macOS universal (amd64 + arm64 en un solo binario) ───────────────────
    # Tauri soporta --target universal-apple-darwin de forma nativa usando lipo
    is_mac_universal = (
        host_goos == "darwin"
        and target_goos == "darwin"
        and needs_cross
    )
    if is_mac_universal:
        # Asegurarse de que ambos targets están instalados
        for t in ("x86_64-apple-darwin", "aarch64-apple-darwin"):
            _ensure_rustup_target(t)
        # Tauri creará el binario universal automáticamente con lipo
        rust_target_arg = "universal-apple-darwin"
        info("  macOS universal binary (x86_64 + arm64) con lipo automático")
    else:
        rust_target_arg = rust_target

    # ── Patch version ────────────────────────────────────────────────────────
    ide_cargo = os.path.join(IDE_DIR, "src-tauri", "Cargo.toml")
    if _patch_cargo_version(ide_cargo, version):
        info(f"  ide/src-tauri/Cargo.toml → version = \"{version}\"")
    else:
        warn("  No se pudo actualizar version en ide/src-tauri/Cargo.toml")

    npm = shutil.which("npm")
    if not npm:
        raise FileNotFoundError("npm no encontrado en el PATH")

    # ── npm install ──────────────────────────────────────────────────────────
    try:
        run([npm, "install"], cwd=IDE_DIR)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(
            f"npm install falló (exit={e.returncode}).\n"
            f"Revisa la salida de arriba para ver el error exacto."
        ) from e

    # ── Configurar cross-compilation para mismo OS / distinta arch ───────────
    build_env = {**os.environ}
    if needs_cross and not is_mac_universal:
        is_msvc_target = rust_target.endswith("-pc-windows-msvc")

        if is_msvc_target:
            # zigbuild no funciona con MSVC — usar cargo + toolchain MSVC ARM64/x86
            msvc_env = _msvc_env_for(rust_target)
            if msvc_env is None:
                warn(f"  Toolchain MSVC para {rust_target} no encontrado.")
                _msvc_install_hint(rust_target)
                return None, None
            build_env.update(msvc_env)
            info(f"  cross MSVC — toolchain {rust_target} detectado")
        else:
            # Non-MSVC: usar cargo-zigbuild (funciona para Linux/macOS/GNU targets)
            if not _has_zigbuild() or not _has_zig():
                _ensure_zigbuild(auto_install=True)

            if _has_zigbuild() and _has_zig():
                build_env["CARGO"] = shutil.which("cargo-zigbuild") or "cargo-zigbuild"
                info(f"  cross via cargo-zigbuild")
            else:
                linker = _system_linker_for(rust_target)
                if linker:
                    _write_cargo_config(rust_target, linker)
                    info(f"  cross via linker del sistema: {linker}")
                else:
                    warn(f"  Sin herramienta de cross para {rust_target} — build puede fallar")

        if not _ensure_rustup_target(rust_target):
            warn(f"  rustup target add {rust_target} falló — abortando build IDE")
            return None, None

    # ── tauri build ──────────────────────────────────────────────────────────
    try:
        run(
            [npm, "run", "tauri", "build", "--", "--target", rust_target_arg],
            cwd=IDE_DIR,
            env=build_env,
        )
    except subprocess.CalledProcessError as e:
        output_lines = (e.output or "").splitlines()
        cargo_errors = [l for l in output_lines if "error[" in l or "error:" in l]
        summary = "\n".join(cargo_errors[-10:]) if cargo_errors else "(sin resumen disponible)"
        raise RuntimeError(
            f"Tauri build falló (exit={e.returncode}).\n"
            f"─── Errores de cargo/Rust ───\n{summary}\n"
            f"────────────────────────────\n"
            f"El output completo está arriba."
        ) from e

    # ── Localizar el ejecutable compilado ────────────────────────────────────
    # universal-apple-darwin tiene su propia carpeta
    target_dir_name = rust_target_arg if is_mac_universal else rust_target
    release_dir     = os.path.join(IDE_DIR, "src-tauri", "target", target_dir_name, "release")
    alt_release_dir = os.path.join(IDE_DIR, "src-tauri", "target", "release")

    ext = ".exe" if plat["goos"] == "windows" else ""
    IDE_EXE_NAME = f"tsuki-ide{ext}"

    exe_src = None
    exe_name = None
    for search_dir in [release_dir, alt_release_dir]:
        if not os.path.exists(search_dir):
            continue
        candidate = os.path.join(search_dir, IDE_EXE_NAME)
        if os.path.isfile(candidate):
            exe_src  = candidate
            exe_name = IDE_EXE_NAME
            break
        # Fallback: cualquier binario que no sea instalador/dll
        for f in os.listdir(search_dir):
            is_installer = any(x in f.lower() for x in ["setup", "msi", ".dll", "nsis"])
            if ext and f.endswith(ext) and not is_installer:
                exe_src  = os.path.join(search_dir, f)
                exe_name = f
                break
            elif not ext and "." not in f and os.path.isfile(os.path.join(search_dir, f)):
                # Unix: ejecutable sin extensión
                exe_src  = os.path.join(search_dir, f)
                exe_name = f
                break
        if exe_src:
            break

    if not exe_src:
        raise FileNotFoundError(
            f"Tauri executable no encontrado en {release_dir}\n"
            f"  Buscado: {IDE_EXE_NAME}"
        )

    # ── Copiar a BUILD_DIR ───────────────────────────────────────────────────
    dst = os.path.join(BUILD_DIR, f"ide-{platform_key}")
    os.makedirs(dst, exist_ok=True)
    shutil.copy(exe_src, os.path.join(dst, exe_name))

    info(f"Tauri IDE executable → {dst}/{exe_name}")
    return dst, exe_name

# ─────────────────────────────────────────────
#  INSTALLER: LINUX / macOS  (tar.gz)
# ─────────────────────────────────────────────
INSTALL_SH = r'''
#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  @@app_name@@ Installer  v@@version@@  (@@platform_key@@)
#  Uso: ./install.sh [opciones]
#
#  Opciones:
#    -p, --prefix <dir>      Directorio base  (default: /usr/local)
#    -l, --libs-dir <dir>    Directorio de librerías Arduino
#                             (default: /usr/share/Tsuki)
#    -r, --registry <url>    URL del registro de paquetes
#    --no-path               No modificar el PATH del sistema
#    --no-symlinks           No crear symlinks en /usr/local/bin
#    --no-ide                No instalar la IDE Tauri (si está incluida)
#    --avr                   Instalar soporte AVR toolchain
#    --esp                   Instalar soporte ESP toolchain
#    --uninstall             Desinstalar @@app_name@@
#    -y, --yes               No pedir confirmación
#    -h, --help              Mostrar esta ayuda
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

APP="@@app_name@@"
VERSION="@@version@@"
BINARY="@@binary@@"
CORE_BINARY="@@core_binary@@"
FLASH_BINARY="@@flash_binary@@"
REGISTRY_URL="@@registry_url@@"

# ── Defaults ──────────────────────────────────────────────────────
PREFIX="${PREFIX:-/usr/local}"
LIBS_DIR="${GODOTINO_LIBS:-/usr/share/tsuki}"
ADD_PATH=true
SYMLINKS=true
INSTALL_IDE=true
INSTALL_AVR=false
INSTALL_ESP=false
UNINSTALL=false
YES=false

# ── Colores ───────────────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD="\\033[1m"; GREEN="\\033[32m"; CYAN="\\033[36m"
  YELLOW="\\033[33m"; RED="\\033[31m"; RESET="\\033[0m"
else
  BOLD=""; GREEN=""; CYAN=""; YELLOW=""; RED=""; RESET=""
fi
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
info() { echo -e "${CYAN}▶${RESET} $*"; }
warn() { echo -e "${YELLOW}⚠ ${RESET} $*"; }
die()  { echo -e "${RED}✗${RESET} $*" >&2; exit 1; }

# ── Parseo de argumentos ──────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--prefix)      PREFIX="$2";     shift 2 ;;
    -l|--libs-dir)    LIBS_DIR="$2";   shift 2 ;;
    -r|--registry)    REGISTRY_URL="$2"; shift 2 ;;
    --no-path)        ADD_PATH=false;  shift ;;
    --no-symlinks)    SYMLINKS=false;  shift ;;
    --no-ide)         INSTALL_IDE=false; shift ;;
    --avr)            INSTALL_AVR=true;  shift ;;
    --esp)            INSTALL_ESP=true;  shift ;;
    --uninstall)      UNINSTALL=true;    shift ;;
    -y|--yes)         YES=true;          shift ;;
    -h|--help)
      head -30 "$0" | grep "^#" | sed 's/^# //;s/^#//'
      exit 0 ;;
    *) die "Argumento desconocido: $1 (usa --help)" ;;
  esac
done

BINDIR="$PREFIX/bin"
DATADIR="$PREFIX/share/$BINARY"
CONFDIR="${XDG_CONFIG_HOME:-$HOME/.config}/$BINARY"

# ── Función de desinstalación ─────────────────────────────────────
do_uninstall() {
  info "Desinstalando $APP v$VERSION..."
  for f in "$BINDIR/$BINARY" "$BINDIR/$CORE_BINARY" "$BINDIR/$FLASH_BINARY"; do
    [ -f "$f" ] && { sudo rm -f "$f"; ok "Eliminado $f"; } || true
  done
  [ -d "$DATADIR" ] && { sudo rm -rf "$DATADIR"; ok "Eliminado $DATADIR"; } || true
  # Eliminar línea del PATH en shell profiles
  for prof in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    [ -f "$prof" ] && sed -i "/tsuki.*bin/d" "$prof" 2>/dev/null || true
  done
  ok "$APP desinstalado correctamente."
  exit 0
}

$UNINSTALL && do_uninstall

# ── Resumen y confirmación ────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════╗"
echo -e "║   Instalador de $APP  v$VERSION   "
echo -e "╚══════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  Plataforma    : ${CYAN}@@platform_key@@${RESET}"
echo -e "  Prefijo       : ${CYAN}$PREFIX${RESET}"
echo -e "  Binarios en   : ${CYAN}$BINDIR${RESET}"
echo -e "  Datos en      : ${CYAN}$DATADIR${RESET}"
echo -e "  Configuración : ${CYAN}$CONFDIR${RESET}"
echo -e "  Librerías     : ${CYAN}$LIBS_DIR${RESET}"
echo -e "  Registro pkgs : ${CYAN}$REGISTRY_URL${RESET}"
echo -e "  Agregar PATH  : ${CYAN}$ADD_PATH${RESET}"
echo -e "  Instalar IDE  : ${CYAN}$INSTALL_IDE${RESET}"
echo -e "  Soporte AVR   : ${CYAN}$INSTALL_AVR${RESET}"
echo -e "  Soporte ESP   : ${CYAN}$INSTALL_ESP${RESET}"
echo ""

if [ "$YES" = false ]; then
  read -r -p "¿Continuar con la instalación? [S/n] " CONFIRM
  case "${CONFIRM:-S}" in
    [nN]*) echo "Instalación cancelada."; exit 0 ;;
  esac
fi

# ── Verificar sudo ────────────────────────────────────────────────
need_sudo=false
[ -w "$BINDIR" ] || need_sudo=true
SUDO=""
$need_sudo && SUDO="sudo"

# ── Instalar binarios ─────────────────────────────────────────────
info "Instalando binarios en $BINDIR..."
$SUDO mkdir -p "$BINDIR"
$SUDO cp "$BINARY"        "$BINDIR/$BINARY"
$SUDO cp "$CORE_BINARY"   "$BINDIR/$CORE_BINARY"
$SUDO cp "$FLASH_BINARY"  "$BINDIR/$FLASH_BINARY"
$SUDO chmod +x "$BINDIR/$BINARY" "$BINDIR/$CORE_BINARY" "$BINDIR/$FLASH_BINARY"
ok "Binarios instalados"

# ── Datos y configuración ─────────────────────────────────────────
info "Configurando directorios de datos..."
$SUDO mkdir -p "$DATADIR"
mkdir -p "$CONFDIR"

# Copiar paquetes locales si existen
[ -d "pkg" ] && $SUDO cp -r pkg "$DATADIR/"

# Escribir config inicial
cat > "$CONFDIR/config.toml" << TOML
[paths]
libs_dir    = "$LIBS_DIR"
core_binary = "$BINDIR/$CORE_BINARY"
flash_binary= "$BINDIR/$FLASH_BINARY"
data_dir    = "$DATADIR"

[registry]
url = "$REGISTRY_URL"

[features]
avr_support = $INSTALL_AVR
esp_support = $INSTALL_ESP
TOML
ok "Configuración escrita en $CONFDIR/config.toml"

# ── Agregar al PATH ───────────────────────────────────────────────
if $ADD_PATH; then
  SHELL_RC=""
  case "${SHELL:-/bin/sh}" in
    */zsh)  SHELL_RC="$HOME/.zshrc" ;;
    */bash) SHELL_RC="$HOME/.bashrc" ;;
    *)      SHELL_RC="$HOME/.profile" ;;
  esac
  if ! grep -q "$BINDIR" "$SHELL_RC" 2>/dev/null; then
    echo "export PATH=\\"$BINDIR:\\$PATH\\"  # $APP" >> "$SHELL_RC"
    ok "PATH actualizado en $SHELL_RC"
    warn "Reinicia tu terminal o ejecuta: source $SHELL_RC"
  else
    ok "PATH ya contiene $BINDIR"
  fi
fi

# ── IDE (si hay bundle) ───────────────────────────────────────────
if $INSTALL_IDE; then
  if ls *.deb 1>/dev/null 2>&1; then
    info "Instalando IDE (.deb)..."
    $SUDO dpkg -i *.deb && ok "IDE instalada"
  elif ls *.AppImage 1>/dev/null 2>&1; then
    $SUDO cp *.AppImage "$BINDIR/tsuki-ide"
    $SUDO chmod +x "$BINDIR/tsuki-ide"
    ok "IDE (AppImage) instalada en $BINDIR"
  elif ls *.dmg 1>/dev/null 2>&1; then
    info "Montando DMG de la IDE..."
    hdiutil attach *.dmg && ok "DMG montado. Arrastra Tsuki IDE a /Applications"
  else
    warn "No se encontró bundle de la IDE. Instálala manualmente."
  fi
fi

# ── Toolchains opcionales ─────────────────────────────────────────
if $INSTALL_AVR; then
  info "Instalando soporte AVR..."
  if command -v apt-get &>/dev/null; then
    $SUDO apt-get install -y gcc-avr avr-libc avrdude && ok "AVR toolchain instalado"
  elif command -v brew &>/dev/null; then
    brew install avr-gcc avrdude && ok "AVR toolchain instalado"
  else
    warn "No se pudo detectar el gestor de paquetes para AVR. Instala manualmente: gcc-avr avr-libc avrdude"
  fi
fi

if $INSTALL_ESP; then
  info "Instalando soporte ESP (esptool)..."
  if command -v pip3 &>/dev/null; then
    pip3 install --user esptool && ok "esptool instalado"
  else
    warn "pip3 no encontrado. Instala esptool manualmente: pip install esptool"
  fi
fi

# ── Crear desinstalador ───────────────────────────────────────────
UNINSTALLER="$DATADIR/uninstall.sh"
$SUDO bash -c "cat > '$UNINSTALLER'" << 'UNINST'
#!/usr/bin/env bash
# Desinstalador de @@app_name@@
set -euo pipefail
PREFIX="${1:-/usr/local}"
BINDIR="$PREFIX/bin"
DATADIR="$PREFIX/share/@@binary@@"
echo "Desinstalando @@app_name@@..."
sudo rm -f "$BINDIR/@@binary@@" "$BINDIR/@@core_binary@@" "$BINDIR/@@flash_binary@@"
sudo rm -rf "$DATADIR"
for prof in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
  [ -f "$prof" ] && sed -i "/@@binary@@/d" "$prof" 2>/dev/null || true
done
echo "✓ @@app_name@@ desinstalado."
UNINST
$SUDO chmod +x "$UNINSTALLER"
ok "Desinstalador creado en $UNINSTALLER"

# ── Listo ─────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔════════════════════════════════════════════╗"
echo -e "║  ✓  $APP v$VERSION instalado correctamente  ║"
echo -e "╚════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  Ejecuta:      ${CYAN}$BINARY --help${RESET}"
echo -e "  Desinstalar:  ${CYAN}$UNINSTALLER${RESET}"
echo ""
'''

UNINSTALL_SH = """
#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  @@app_name@@ Uninstaller  v@@version@@
#  Uso: ./uninstall.sh [--prefix /usr/local] [-y]
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

PREFIX="${1:-/usr/local}"
YES=false
for arg in "$@"; do [ "$arg" = "-y" ] || [ "$arg" = "--yes" ] && YES=true; done

BINDIR="$PREFIX/bin"
DATADIR="$PREFIX/share/@@binary@@"
CONFDIR="${XDG_CONFIG_HOME:-$HOME/.config}/@@binary@@"

echo "Este script eliminará:"
echo "  $BINDIR/@@binary@@  $BINDIR/@@core_binary@@  $BINDIR/@@flash_binary@@"
echo "  $DATADIR"
echo "  $CONFDIR"
echo ""

if [ "$YES" = false ]; then
  read -r -p "¿Desinstalar @@app_name@@ v@@version@@? [s/N] " OK
  case "${OK:-N}" in [sS]*) ;; *) echo "Cancelado."; exit 0;; esac
fi

SUDO=""; [ -w "$BINDIR" ] || SUDO="sudo"
for f in "$BINDIR/@@binary@@" "$BINDIR/@@core_binary@@" "$BINDIR/@@flash_binary@@"; do
  [ -f "$f" ] && { $SUDO rm -f "$f"; echo "✓ Eliminado $f"; } || true
done
[ -d "$DATADIR" ] && { $SUDO rm -rf "$DATADIR"; echo "✓ Eliminado $DATADIR"; } || true
[ -d "$CONFDIR" ] && { rm -rf "$CONFDIR"; echo "✓ Eliminado $CONFDIR"; } || true

for prof in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
  [ -f "$prof" ] && sed -i "/@@binary@@/d" "$prof" 2>/dev/null && \
    echo "✓ PATH limpiado en $prof" || true
done

echo ""
echo "✓ @@app_name@@ desinstalado."
"""

# ─────────────────────────────────────────────
#  INNO SETUP SCRIPT  (Windows GUI)
# ─────────────────────────────────────────────
INNO_SCRIPT = r'''
; ──────────────────────────────────────────────────────────────────
;  @@app_name@@ Windows Installer  v@@version@@
;  Generado automáticamente por build.py
;  Compilar con:  ISCC.exe tsuki-setup.iss
; ──────────────────────────────────────────────────────────────────

#define AppName      "@@app_name@@"
#define AppVersion   "@@version@@"
#define AppPublisher "@@publisher@@"
#define AppURL       "@@publisher_url@@"
#define AppExeName   "@@binary@@.exe"
#define AppCoreExe   "@@core_binary@@.exe"
#define AppFlashExe  "@@flash_binary@@.exe"

[Setup]
AppId={{8A7F3C2D-1B4E-4F9A-8C6D-2E5B7A3F1D9C}}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
DefaultDirName={autopf}\tsuki
DefaultGroupName=@@app_name@@
AllowNoIcons=yes
; Use native 64-bit Program Files on x64/arm64 — never Program Files (x86)
ArchitecturesAllowed=x64compatible arm64 x86
ArchitecturesInstallIn64BitMode=x64compatible arm64
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=@@release_dir@@
OutputBaseFilename=@@app_name@@-Setup-@@version@@-@@platform_key@@
SetupIconFile=@@icon_file@@
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
WizardImageFile=compiler:WizClassicImage.bmp
WizardSmallImageFile=compiler:WizClassicSmallImage.bmp
ShowLanguageDialog=auto
ChangesEnvironment=yes
ChangesAssociations=yes
UninstallDisplayName=@@app_name@@ {#AppVersion}
UninstallDisplayIcon={app}\\bin\\@@app_name@@.ico

; Información adicional del instalador
VersionInfoVersion=@@numeric_version@@
VersionInfoCompany=@@publisher@@
VersionInfoDescription=@@app_name@@ Installer
VersionInfoTextVersion=@@version@@
VersionInfoCopyright=Copyright (C) 2025 @@publisher@@

[Languages]
Name: "spanish";  MessagesFile: "compiler:Languages\\Spanish.isl"
Name: "english";  MessagesFile: "compiler:Default.isl"
Name: "german";   MessagesFile: "compiler:Languages\\German.isl"
Name: "french";   MessagesFile: "compiler:Languages\\French.isl"

[Types]
Name: "full";     Description: "Instalación completa"
Name: "standard"; Description: "Instalación estándar"
Name: "custom";   Description: "Instalación personalizada"; Flags: iscustom

[Components]
Name: "cli";        Description: "Herramientas CLI (@@binary@@, core, flash)"; Types: full standard custom; Flags: fixed
Name: "ide";        Description: "IDE Gráfica (Tsuki IDE)";               Types: full
Name: "avr";        Description: "Soporte Arduino AVR (UNO, MEGA, Leonardo)"; Types: full standard
Name: "esp";        Description: "Soporte ESP32 / ESP8266";                   Types: full
Name: "shortcuts";  Description: "Accesos directos en el escritorio";         Types: full standard
Name: "ctx_menu";   Description: "Abrir carpeta con Tsuki (menú contextual)"; Types: full
Name: "file_assoc"; Description: "Asociar archivos .goino con Tsuki";      Types: full

[Tasks]
Name: "addtopath";      Description: "Agregar @@app_name@@ al PATH del sistema (recomendado)"; \
                        GroupDescription: "Configuración del sistema:"; \
                        Components: cli
Name: "desktopicon";    Description: "Crear icono en el &Escritorio"; \
                        GroupDescription: "Accesos directos:"; \
                        Components: shortcuts
Name: "startmenuicon";  Description: "Crear grupo en el &menú Inicio"; \
                        GroupDescription: "Accesos directos:"; \
                        Components: shortcuts

[Dirs]
Name: "{app}\\bin"
Name: "{app}\\libs"
Name: "{app}\\pkg"
Name: "{app}\\logs"
@@ide_dir_entry@@
Name: "{localappdata}\\@@app_name@@";    Flags: uninsalwaysuninstall
Name: "{localappdata}\\@@app_name@@\\config"; Flags: uninsalwaysuninstall

[Files]
; ── CLI Binarios ───────────────────────────────────────────────────
Source: "@@go_bin@@";      DestDir: "{app}\\bin"; DestName: "@@binary@@.exe";        Components: cli; Flags: ignoreversion
Source: "@@core_bin@@";    DestDir: "{app}\\bin"; DestName: "@@core_binary@@.exe";   Components: cli; Flags: ignoreversion skipifsourcedoesntexist
Source: "@@flash_bin@@";   DestDir: "{app}\\bin"; DestName: "@@flash_binary@@.exe";  Components: cli; Flags: ignoreversion skipifsourcedoesntexist

; ── Paquetes locales ───────────────────────────────────────────────
Source: "@@pkg_dir@@\\*"; DestDir: "{app}\\pkg"; Components: cli; Flags: ignoreversion recursesubdirs createallsubdirs

; ── Cores AVR (solo si se provee un directorio externo de cores precompilados) ─
; Source: "@@cores_avr_dir@@\\*"; DestDir: "{app}\\libs\\cores\\avr"; \
;         Components: avr; Flags: ignoreversion recursesubdirs createallsubdirs

; ── IDE bundles ────────────────────────────────────────────────────
Source: "@@ide_bundle@@\\*"; DestDir: "{app}\\ide"; \
        Components: ide; Flags: ignoreversion recursesubdirs createallsubdirs; \
        Check: HasIdeBundle

; ── Icono de la app ────────────────────────────────────────────────
Source: "@@icon_file@@"; DestDir: "{app}"; DestName: "@@app_name@@.ico"; Flags: ignoreversion

[Icons]
; Start menu
Name: "{group}\@@app_name@@ IDE"; Filename: "{app}\ide\@@ide_exe_name@@";    Components: ide; Tasks: startmenuicon
Name: "{group}\\@@app_name@@ CLI";      Filename: "{app}\\bin\\@@binary@@.exe";       Components: cli; Tasks: startmenuicon
Name: "{group}\\Desinstalar @@app_name@@"; Filename: "{uninstallexe}";              Tasks: startmenuicon
; Desktop
Name: "{userdesktop}\@@app_name@@ IDE"; Filename: "{app}\ide\@@ide_exe_name@@";  Components: ide; Tasks: desktopicon
Name: "{userdesktop}\\@@app_name@@ CLI";  Filename: "{app}\\bin\\@@binary@@.exe";    Components: cli; Tasks: desktopicon

[Registry]
; ── PATH ────────────────────────────────────────────────────────────
Root: HKCU; Subkey: "Environment"; \
      ValueType: expandsz; ValueName: "Path"; \
      ValueData: "{olddata};{app}\bin"; \
      Tasks: addtopath; Flags: preservestringtype uninsdeletekeyifempty

; ── Configuración de la aplicación ──────────────────────────────────
Root: HKCU; Subkey: "Software\@@app_name@@"; \
      ValueType: string; ValueName: "InstallDir"; ValueData: "{app}"; \
      Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\@@app_name@@"; \
      ValueType: string; ValueName: "Version"; ValueData: "@@version@@"; \
      Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\@@app_name@@"; \
      ValueType: string; ValueName: "LibsDir"; ValueData: "{app}\libs"; \
      Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\@@app_name@@"; \
      ValueType: string; ValueName: "RegistryURL"; ValueData: "@@registry_url@@"; \
      Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\@@app_name@@"; \
      ValueType: string; ValueName: "CoreBinary"; \
      ValueData: "{app}\bin\@@core_binary@@.exe"; \
      Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\@@app_name@@"; \
      ValueType: string; ValueName: "FlashBinary"; \
      ValueData: "{app}\bin\@@flash_binary@@.exe"; \
      Flags: uninsdeletekey

; ── Asociación de archivos .goino ───────────────────────────────────
Root: HKCU; Subkey: "Software\Classes\.goino"; \
      ValueType: string; ValueName: ""; ValueData: "@@app_name@@.Project"; \
      Components: file_assoc; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\@@app_name@@.Project"; \
      ValueType: string; ValueName: ""; ValueData: "@@app_name@@ Project"; \
      Components: file_assoc; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\@@app_name@@.Project\DefaultIcon"; \
      ValueType: string; ValueName: ""; ValueData: "{app}\@@app_name@@.ico"; \
      Components: file_assoc; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\@@app_name@@.Project\shell\open\command"; \
      ValueType: string; ValueName: ""; \
      ValueData: """{app}\bin\@@binary@@.exe"" open ""%1"""; \
      Components: file_assoc; Flags: uninsdeletekey

; ── Menú contextual "Abrir con Tsuki" ─────────────────────────────
Root: HKCU; Subkey: "Software\Classes\Directory\shell\@@app_name@@"; \
      ValueType: string; ValueName: ""; ValueData: "Abrir con @@app_name@@"; \
      Components: ctx_menu; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Directory\shell\@@app_name@@\command"; \
      ValueType: string; ValueName: ""; \
      ValueData: """{app}\bin\@@binary@@.exe"" open ""%V"""; \
      Components: ctx_menu; Flags: uninsdeletekey

[Run]
; Ejecutar la configuración inicial tras instalar
; Note: {app} is quoted with doubled quotes so spaces in the install path work.
Filename: "{app}\bin\@@binary@@.exe"; \
    Parameters: "config init --libs-dir ""{app}\libs"" --registry @@registry_url@@"; \
    Flags: runhidden nowait; \
    StatusMsg: "Inicializando configuración..."; \
    Components: cli
; Opcional: abrir la IDE al finalizar
Filename: "{app}\ide\@@ide_exe_name@@"; \
    Description: "Abrir @@app_name@@ IDE ahora"; \
    Flags: nowait postinstall skipifsilent; \
    Components: ide; \
    Check: HasIdeBundle

[UninstallRun]
Filename: "{app}\\bin\\@@binary@@.exe"; \
    Parameters: "config clean"; \
    Flags: runhidden; \
    RunOnceId: "CleanConfig"

[Code]
// ═══════════════════════════════════════════════════════════════════
//  Página personalizada de Configuración Avanzada
// ═══════════════════════════════════════════════════════════════════
var
  AdvancedPage: TWizardPage;
  // Registro de paquetes
  lblRegistry:  TLabel;
  edRegistry:   TEdit;
  // Directorio de librerías Arduino
  lblLibsDir:   TLabel;
  edLibsDir:    TEdit;
  btnLibsDir:   TButton;
  // Directorio de configuración de usuario
  lblConfDir:   TLabel;
  edConfDir:    TEdit;
  btnConfDir:   TButton;
  // Actualizaciones automáticas
  chkAutoUpdate: TCheckBox;

// ─── Helpers ────────────────────────────────────────────────────────
function BoolStr(Val: Boolean; TrueStr, FalseStr: String): String;
begin
  if Val then Result := TrueStr else Result := FalseStr;
end;

procedure SelectFolder(edit: TEdit);
var
  FolderPath: String;
begin
  FolderPath := edit.Text;
  if BrowseForFolder('Selecciona una carpeta:', FolderPath, True) then
    edit.Text := FolderPath;
end;

procedure btnLibsDirClick(Sender: TObject);
begin SelectFolder(edLibsDir); end;

procedure btnConfDirClick(Sender: TObject);
begin SelectFolder(edConfDir); end;

// ─── Crear página personalizada ──────────────────────────────────────
procedure InitializeWizard;
var
  y: Integer;
begin
  AdvancedPage := CreateCustomPage(
    wpSelectComponents,
    'Configuración Avanzada',
    'Ajusta las rutas y opciones de @@app_name@@'
  );

  y := 8;

  // ── URL del registro ──────────────────────────────────────────────
  lblRegistry := TLabel.Create(AdvancedPage);
  lblRegistry.Parent  := AdvancedPage.Surface;
  lblRegistry.Caption := 'URL del registro de paquetes:';
  lblRegistry.Top     := y;  lblRegistry.Left := 0;
  lblRegistry.AutoSize := True;

  edRegistry := TEdit.Create(AdvancedPage);
  edRegistry.Parent := AdvancedPage.Surface;
  edRegistry.Top    := y + 18;  edRegistry.Left := 0;
  edRegistry.Width  := AdvancedPage.SurfaceWidth;
  edRegistry.Text   := '@@registry_url@@';

  y := y + 52;

  // ── Directorio de librerías ───────────────────────────────────────
  lblLibsDir := TLabel.Create(AdvancedPage);
  lblLibsDir.Parent   := AdvancedPage.Surface;
  lblLibsDir.Caption  := 'Directorio de librerías Arduino:';
  lblLibsDir.Top      := y;  lblLibsDir.Left := 0;
  lblLibsDir.AutoSize := True;

  edLibsDir := TEdit.Create(AdvancedPage);
  edLibsDir.Parent := AdvancedPage.Surface;
  edLibsDir.Top    := y + 18;  edLibsDir.Left := 0;
  edLibsDir.Width  := AdvancedPage.SurfaceWidth - 90;
  edLibsDir.Text   := ExpandConstant('{autopf}\tsuki\libs');

  btnLibsDir := TButton.Create(AdvancedPage);
  btnLibsDir.Parent  := AdvancedPage.Surface;
  btnLibsDir.Top     := y + 15;  btnLibsDir.Left := AdvancedPage.SurfaceWidth - 85;
  btnLibsDir.Width   := 85;  btnLibsDir.Height := 23;
  btnLibsDir.Caption := 'Examinar...';
  btnLibsDir.OnClick := @btnLibsDirClick;

  y := y + 52;

  // ── Directorio de configuración ───────────────────────────────────
  lblConfDir := TLabel.Create(AdvancedPage);
  lblConfDir.Parent   := AdvancedPage.Surface;
  lblConfDir.Caption  := 'Directorio de configuración de usuario:';
  lblConfDir.Top      := y;  lblConfDir.Left := 0;
  lblConfDir.AutoSize := True;

  edConfDir := TEdit.Create(AdvancedPage);
  edConfDir.Parent := AdvancedPage.Surface;
  edConfDir.Top    := y + 18;  edConfDir.Left := 0;
  edConfDir.Width  := AdvancedPage.SurfaceWidth - 90;
  edConfDir.Text   := ExpandConstant('{localappdata}\@@app_name@@\config');

  btnConfDir := TButton.Create(AdvancedPage);
  btnConfDir.Parent  := AdvancedPage.Surface;
  btnConfDir.Top     := y + 15;  btnConfDir.Left := AdvancedPage.SurfaceWidth - 85;
  btnConfDir.Width   := 85;  btnConfDir.Height := 23;
  btnConfDir.Caption := 'Examinar...';
  btnConfDir.OnClick := @btnConfDirClick;

  y := y + 52;

  // ── Actualizaciones automáticas ───────────────────────────────────
  chkAutoUpdate := TCheckBox.Create(AdvancedPage);
  chkAutoUpdate.Parent  := AdvancedPage.Surface;
  chkAutoUpdate.Top     := y;  chkAutoUpdate.Left := 0;
  chkAutoUpdate.Width   := AdvancedPage.SurfaceWidth;
  chkAutoUpdate.Caption := 'Buscar actualizaciones automáticamente al iniciar';
  chkAutoUpdate.Checked := True;
end;

// ─── Guardar config tras instalar ────────────────────────────────────
procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigFile: String;
  Lines:      TStringList;
begin
  if CurStep = ssPostInstall then
  begin
    // Guardar rutas en el registro de Windows
    RegWriteStringValue(HKCU, 'Software\@@app_name@@', 'InstallDir',    ExpandConstant('{app}'));
    RegWriteStringValue(HKCU, 'Software\@@app_name@@', 'Version',       '@@version@@');
    RegWriteStringValue(HKCU, 'Software\@@app_name@@', 'LibsDir',       edLibsDir.Text);
    RegWriteStringValue(HKCU, 'Software\@@app_name@@', 'ConfigDir',     edConfDir.Text);
    RegWriteStringValue(HKCU, 'Software\@@app_name@@', 'RegistryURL',   edRegistry.Text);
    RegWriteStringValue(HKCU, 'Software\@@app_name@@', 'AutoUpdate',    BoolStr(chkAutoUpdate.Checked, '1', '0'));

    // Escribir config.toml inicial
    ForceDirectories(edConfDir.Text);
    ConfigFile := edConfDir.Text + '\config.toml';
    Lines := TStringList.Create;
    try
      Lines.Add('[paths]');
      Lines.Add('libs_dir     = "' + edLibsDir.Text + '"');
      Lines.Add('core_binary  = "' + ExpandConstant('{app}\bin\@@core_binary@@.exe') + '"');
      Lines.Add('flash_binary = "' + ExpandConstant('{app}\bin\@@flash_binary@@.exe') + '"');
      Lines.Add('');
      Lines.Add('[registry]');
      Lines.Add('url = "' + edRegistry.Text + '"');
      Lines.Add('');
      Lines.Add('[updates]');
      Lines.Add('auto_check = ' + BoolStr(chkAutoUpdate.Checked, 'true', 'false'));
      Lines.Add('channel = "stable"');
      Lines.SaveToFile(ConfigFile);
    finally
      Lines.Free;
    end;
  end;
end;

// ─── Validación ──────────────────────────────────────────────────────
function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = AdvancedPage.ID then
  begin
    if edRegistry.Text = '' then
    begin
      MsgBox('La URL del registro no puede estar vacía.', mbError, MB_OK);
      Result := False; Exit;
    end;
    if edLibsDir.Text = '' then
    begin
      MsgBox('El directorio de librerías no puede estar vacío.', mbError, MB_OK);
      Result := False; Exit;
    end;
  end;
end;

// ─── Detectar si hay bundle de IDE disponible ─────────────────────────
function HasIdeBundle: Boolean;
begin
  // Check the actual exe exists, not just the folder (folder is always created by [Dirs])
  Result := FileExists(ExpandConstant('{app}\\ide\\@@ide_exe_name@@'));
end;

function InitializeSetup: Boolean;
begin
  Result := True;
end;
'''


# ─────────────────────────────────────────────
#  CREAR INSTALADOR LINUX / MACOS
# ─────────────────────────────────────────────
def create_unix_installer(platform_key, go_bin, core_bin, flash_bin, version):
    step(f"Creando instalador CLI → {platform_key}")
    plat_dir = os.path.join(RELEASE_DIR, f"{APP_NAME}-{version}-{platform_key}")
    os.makedirs(plat_dir, exist_ok=True)

    # Copiar binarios con nombres limpios (Rust puede ser None en builds cruzados)
    if go_bin:
        shutil.copy(go_bin,    os.path.join(plat_dir, BINARY))
    if core_bin:
        shutil.copy(core_bin,  os.path.join(plat_dir, CORE_BINARY))
    if flash_bin:
        shutil.copy(flash_bin, os.path.join(plat_dir, FLASH_BINARY))
    # Copiar paquetes
    pkg_src = os.path.join(PROJECT_ROOT, "pkg")
    if os.path.exists(pkg_src):
        shutil.copytree(pkg_src, os.path.join(plat_dir, "pkg"), dirs_exist_ok=True)

    # install.sh
    sh_subs = {
        '@@app_name@@':     APP_NAME,
        '@@version@@':      version,
        '@@binary@@':       BINARY,
        '@@core_binary@@':  CORE_BINARY,
        '@@flash_binary@@': FLASH_BINARY,
        '@@registry_url@@': REGISTRY_URL,
        '@@platform_key@@': platform_key,
    }
    install_content = INSTALL_SH
    for k, v in sh_subs.items():
        install_content = install_content.replace(k, v)
    install_path = os.path.join(plat_dir, "install.sh")
    with open(install_path, "w", newline="\n", encoding="utf-8") as f:
        f.write(install_content)
    os.chmod(install_path, 0o755)

    # uninstall.sh
    uninstall_content = UNINSTALL_SH
    for k, v in sh_subs.items():
        uninstall_content = uninstall_content.replace(k, v)
    uninstall_path = os.path.join(plat_dir, "uninstall.sh")
    with open(uninstall_path, "w", newline="\n", encoding="utf-8") as f:
        f.write(uninstall_content)
    os.chmod(uninstall_path, 0o755)

    # README.txt
    readme_path = os.path.join(plat_dir, "README.txt")
    with open(readme_path, "w", encoding="utf-8") as f:
        f.write(textwrap.dedent(f"""\
            {APP_NAME} v{version} — Instalador para {platform_key}
            {'=' * 55}

            INSTALACIÓN RÁPIDA
              bash install.sh

            INSTALACIÓN CON OPCIONES
              bash install.sh --prefix ~/.local --no-ide --avr

            OPCIONES DISPONIBLES
              -p, --prefix <dir>    Directorio base   (default: /usr/local)
              -l, --libs-dir <dir>  Directorio de librerías Arduino
              -r, --registry <url>  URL del registro de paquetes
              --no-path             No modificar el PATH
              --no-ide              No instalar la IDE
              --avr                 Instalar soporte AVR (gcc-avr, avrdude)
              --esp                 Instalar soporte ESP (esptool)
              --uninstall           Desinstalar {APP_NAME}
              -y, --yes             Sin confirmaciones

            DESINSTALACIÓN
              bash uninstall.sh
              # o una vez instalado:
              /usr/local/share/{BINARY}/uninstall.sh
        """))

    # tar.gz
    tar_name = f"{APP_NAME}-{version}-{platform_key}.tar.gz"
    tar_path = os.path.join(RELEASE_DIR, tar_name)
    run(["tar", "-czf", tar_path, "-C", RELEASE_DIR, os.path.basename(plat_dir)])
    shutil.rmtree(plat_dir)
    info(f"Instalador creado → {tar_name}")
    return tar_path


# ─────────────────────────────────────────────
#  CREAR INSTALADOR WINDOWS (Inno Setup)
# ─────────────────────────────────────────────
def create_windows_installer(go_bin, core_bin, flash_bin, version, ide_bundle_dir, ide_exe_name, numeric_version, platform_key="windows-amd64"):
    step("Creando instalador GUI Windows (Inno Setup)")

    # Buscar ícono
    icon_candidates = [
        os.path.join(IDE_DIR, "src-tauri", "icons", "icon.ico"),
        os.path.join(PROJECT_ROOT, "assets", "icon.ico"),
    ]
    icon_file = next((p for p in icon_candidates if os.path.exists(p)), "")

    ide_bundle = ide_bundle_dir or ""
    pkg_dir    = os.path.join(PROJECT_ROOT, "pkg")
    cores_avr  = ""  # flash/cores/avr/ contains Rust source, not pre-built cores

    def _w(p):
        """Convierte separadores a backslash para rutas Windows en el .iss"""
        return p.replace("/", "\\") if p else ""

    # Usamos @@var@@ como delimitador para evitar colisiones con la
    # sintaxis de Inno Setup: {#Define}, {app}, {group}, {pf}, etc.
    # .format() confundiría esos {} con sus propios placeholders.
    iss_subs = {
        "@@app_name@@":     APP_NAME,
        "@@version@@":      version,
        "@@numeric_version@@": numeric_version,
        "@@publisher@@":    PUBLISHER,
        "@@publisher_url@@": PUBLISHER_URL,
        "@@binary@@":       BINARY,
        "@@core_binary@@":  CORE_BINARY,
        "@@flash_binary@@": FLASH_BINARY,
        "@@go_bin@@":        _w(go_bin),
        "@@core_bin@@":      _w(core_bin),
        "@@flash_bin@@":     _w(flash_bin),
        "@@icon_file@@":    _w(icon_file),
        "@@ide_bundle@@":   _w(ide_bundle) if ide_bundle else "",
        "@@pkg_dir@@":      _w(pkg_dir),
        "@@cores_avr_dir@@": _w(cores_avr),
        "@@release_dir@@":  _w(RELEASE_DIR),
        "@@registry_url@@": REGISTRY_URL,
        "@@ide_exe_name@@": ide_exe_name or f"{APP_NAME}.exe",
        "@@platform_key@@": platform_key,
        "@@ide_dir_entry@@": 'Name: "{app}\\ide"' if ide_bundle else "",
    }
    iss_content = INNO_SCRIPT

    # Comment out the IDE bundle block BEFORE placeholder substitution.
    # After substitution @@ide_bundle@@ becomes "" making the pattern unmatchable.
    if not ide_bundle:
        iss_content = iss_content.replace(
            'Source: "@@ide_bundle@@\\\\*"; DestDir: "{app}\\\\ide"; \\\n'
            '        Components: ide; Flags: ignoreversion recursesubdirs createallsubdirs; \\\n'
            '        Check: HasIdeBundle',
            '; IDE bundle not built on this platform'
        )

    for placeholder, value in iss_subs.items():
        iss_content = iss_content.replace(placeholder, value)

    iss_path = os.path.join(PROJECT_ROOT, f"{APP_NAME}-setup.iss")
    with open(iss_path, "w", encoding="utf-8") as f:
        f.write(iss_content)
    info(f"Script Inno Setup escrito → {os.path.basename(iss_path)}")

    # Buscar ISCC — primero en el PATH, luego en las rutas típicas de instalación
    iscc_path_candidates = [
        r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        r"C:\Program Files\Inno Setup 6\ISCC.exe",
        r"C:\Program Files (x86)\Inno Setup 5\ISCC.exe",
        r"C:\Program Files\Inno Setup 5\ISCC.exe",
        r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        r"C:\Users\NICKE\AppData\Local\Programs\Inno Setup 6\ISCC.exe"
    ]
    # shutil.which resuelve si el usuario lo agregó al PATH manualmente
    iscc = shutil.which("ISCC") or shutil.which("iscc")
    if not iscc:
        # Buscar en rutas absolutas típicas
        iscc = next((p for p in iscc_path_candidates if os.path.isfile(p)), None)

    if not iscc:
        warn("ISCC (Inno Setup) no encontrado en el PATH ni en rutas estándar.")
        warn("Rutas buscadas:")
        for p in iscc_path_candidates:
            warn(f"  {p}")
        warn(f"Solución: abre una terminal nueva tras instalar Inno Setup, o ejecuta manualmente:")
        warn(f'  "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe" "{iss_path}"')
        return iss_path

    info(f"ISCC encontrado → {iscc}")
    run([iscc, iss_path])
    info(f"Instalador Windows creado → {APP_NAME}-Setup-{version}-windows-amd64.exe")
    return iss_path


# ─────────────────────────────────────────────
#  VERIFICAR DEPENDENCIAS
# ─────────────────────────────────────────────
def check_dependencies(skip_go, skip_rust, skip_ide):
    step("Verificando dependencias")
    missing = []
    if not skip_go   and not check_tool("go", "version"):      missing.append("go  →  https://go.dev/dl/")
    if not skip_rust and not check_tool("cargo", "--version"):  missing.append("cargo (Rust)  →  https://rustup.rs/")
    if not skip_ide:
        if not check_tool("npm", "--version"):   missing.append("npm  →  https://nodejs.org/")
    if missing:
        error("Faltan las siguientes herramientas:")
        for m in missing: print(f"    • {m}")
        sys.exit(1)
    info("Todas las dependencias están disponibles")

    # Informar qué arquitecturas de IDE se pueden compilar desde este host
    if not skip_ide:
        viable_ide = [HOST_PLATFORM] + _tauri_same_os_arch_pairs()
        cross_ide  = [pk for pk in viable_ide if pk != HOST_PLATFORM]
        info(f"Tauri IDE compilable para: {', '.join(viable_ide)}")
        if cross_ide:
            info(f"  Cross-arch mismo OS: {', '.join(cross_ide)}")
        cross_os_skipped = [
            pk for pk in RELEASE_PLATFORMS
            if pk not in viable_ide
        ]
        if cross_os_skipped:
            # Separar los que son alcanzables por WSL de los que no
            host_os = platform.system().lower()
            wsl_reachable = [
                pk for pk in cross_os_skipped
                if host_os == "windows" and PLATFORMS[pk]["goos"] == "linux"
            ]
            truly_skipped = [pk for pk in cross_os_skipped if pk not in wsl_reachable]

            if wsl_reachable:
                wsl_ok = _has_wsl()
                if wsl_ok:
                    info(f"  Tauri Linux via WSL: {', '.join(wsl_reachable)}")
                else:
                    warn(f"  Tauri Linux (WSL no detectado): {', '.join(wsl_reachable)}")
                    warn("    Instala WSL2: wsl --install")
                    warn("    luego ejecuta el build de nuevo para compilar targets Linux")
            if truly_skipped:
                warn(f"  Tauri omitido para (cross-OS sin solución): {', '.join(truly_skipped)}")

    # Advertencia no-bloqueante: cross-compilation disponible
    if not skip_rust:
        if _has_zigbuild() and _has_zig():
            info("Cross-compilation: cargo-zigbuild + zig detectados — se usarán para targets remotos")
        elif _has_zigbuild() and not _has_zig():
            warn("cargo-zigbuild instalado pero zig no está en el PATH.")
            warn("  Instala zig para habilitar cross-compilation: pip install ziglang")
        else:
            warn("cargo-zigbuild no encontrado — solo se compilará para el host.")
            warn("  Para compilar para otros targets sin Docker:")
            warn("    cargo install cargo-zigbuild")
            warn("    pip install ziglang")



# ─────────────────────────────────────────────
#  AUTO-RUN INSTALLER (modo dev)
# ─────────────────────────────────────────────
def _find_tauri_exe(platform_key):
    """Devuelve la ruta al ejecutable Tauri compilado (debug o release).

    Orden de busqueda (primero encontrado gana):
      1. target/{rust_target}/debug/   ← cargo build / tauri build --debug --target
      2. target/debug/                 ← cargo build sin --target
      3. target/{rust_target}/release/ ← tauri build --target
      4. target/release/               ← tauri build sin --target
    """
    plat        = PLATFORMS[platform_key]
    rust_target = plat["rust_target"]
    ext         = ".exe" if plat["goos"] == "windows" else ""

    search_dirs = [
        os.path.join(IDE_DIR, "src-tauri", "target", rust_target, "debug"),
        os.path.join(IDE_DIR, "src-tauri", "target", "debug"),
        os.path.join(IDE_DIR, "src-tauri", "target", rust_target, "release"),
        os.path.join(IDE_DIR, "src-tauri", "target", "release"),
    ]
    candidates_names = ["tsuki-ide", APP_NAME]
    for d in search_dirs:
        if not os.path.isdir(d):
            continue
        for name in candidates_names:
            p = os.path.join(d, f"{name}{ext}")
            if os.path.isfile(p):
                info(f"  exe encontrado en: {p}")
                return p
        # Fallback: cualquier exe que no sea instalador/bundle
        for f in os.listdir(d):
            if f.endswith(ext) and ext and not any(x in f.lower() for x in ["setup", "msi", "bundle"]):
                p = os.path.join(d, f)
                info(f"  exe (fallback) encontrado en: {p}")
                return p
    return None


def _kill_tsuki_ide():
    """Mata cualquier proceso tsuki-ide corriendo para liberar el exe antes de copiarlo."""
    if platform.system().lower() != "windows":
        return
    try:
        result = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq tsuki-ide.exe", "/FO", "CSV", "/NH"],
            capture_output=True, text=True
        )
        if "tsuki-ide.exe" in result.stdout:
            subprocess.run(["taskkill", "/F", "/IM", "tsuki-ide.exe"],
                           capture_output=True)
            import time; time.sleep(1.5)  # esperar a que el proceso libere el archivo
            info("  proceso tsuki-ide anterior terminado")
    except Exception:
        pass  # si falla, el usuario tendrá que cerrarlo manualmente


def _copy_exe_win(src: str, dst: str) -> bool:
    """
    Copia src → dst en Windows con lógica robusta para Win10/Win11:

    Problemas conocidos en Windows 10:
      - Windows Defender puede mantener el exe bloqueado ~2 s después de
        que el proceso termina (el antivirus escanea antes de liberar).
      - shutil.copy2 falla con PermissionError/WinError 5 (ACCESS DENIED)
        si el exe destino sigue bloqueado.

    Estrategia:
      1. Intentar la copia directa hasta MAX_RETRIES veces con back-off.
      2. Si falla, intentar renombrar el exe anterior a .bak y copiar.
      3. Si aún falla, mover el exe antiguo y usar replace() atómico.

    Devuelve True si la copia tuvo éxito, False en caso contrario.
    """
    import time

    MAX_RETRIES = 5
    RETRY_DELAY = 1.0   # segundos entre reintentos

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            shutil.copy2(src, dst)
            return True
        except PermissionError as e:
            if attempt < MAX_RETRIES:
                warn(f"  copia bloqueada (intento {attempt}/{MAX_RETRIES}): {e} — reintentando en {RETRY_DELAY}s…")
                time.sleep(RETRY_DELAY)
                RETRY_DELAY = min(RETRY_DELAY * 1.5, 4.0)  # back-off exponencial
            else:
                warn(f"  copia directa fallida tras {MAX_RETRIES} intentos: {e}")

    # ── Estrategia 2: renombrar el exe antiguo a .bak y copiar ───────────────
    bak = dst + ".bak"
    try:
        if os.path.exists(bak):
            os.remove(bak)
        if os.path.exists(dst):
            os.rename(dst, bak)
        shutil.copy2(src, dst)
        # Eliminar el .bak si la copia fue bien
        try:
            os.remove(bak)
        except Exception:
            pass
        info("  copiado mediante estrategia rename-bak")
        return True
    except Exception as e2:
        warn(f"  estrategia rename-bak fallida: {e2}")

    # ── Estrategia 3: os.replace (atómico en NTFS) ────────────────────────────
    tmp = dst + ".new"
    try:
        shutil.copy2(src, tmp)
        os.replace(tmp, dst)
        info("  copiado mediante os.replace atómico")
        return True
    except Exception as e3:
        warn(f"  os.replace fallido: {e3}")
        try:
            os.remove(tmp)
        except Exception:
            pass

    # ── Diagnóstico final ─────────────────────────────────────────────────────
    warn(f"  FALLO DEFINITIVO copiando a {dst}")
    warn("  Posibles causas en Windows 10:")
    warn("    · Windows Defender sigue escaneando el exe anterior")
    warn("    · Excluye la carpeta de instalación del antivirus:")
    warn(f"      {os.path.dirname(dst)}")
    warn("    · O ejecuta el instalador como Administrador")
    return False


def install_ide_direct(platform_key):
    """
    Copia el exe compilado a todos los posibles directorios de instalacion.
    Retorna la ruta del exe copiado (para lanzarlo), o None si falla.
    """
    if platform.system().lower() != "windows":
        return None

    exe_src = _find_tauri_exe(platform_key)
    if not exe_src:
        warn("No se encontro el ejecutable de la IDE compilada.")
        warn("Directorios buscados:")
        plat = PLATFORMS[platform_key]
        for d in [
            os.path.join(IDE_DIR, "src-tauri", "target", plat["rust_target"], "debug"),
            os.path.join(IDE_DIR, "src-tauri", "target", "debug"),
            os.path.join(IDE_DIR, "src-tauri", "target", plat["rust_target"], "release"),
        ]:
            warn(f"  {d}  (existe={os.path.isdir(d)})")
        return None

    import datetime as _dt
    src_ts = _dt.datetime.fromtimestamp(os.path.getmtime(exe_src)).strftime("%H:%M:%S")
    info(f"  exe compilado: {exe_src}  (build: {src_ts})")

    # Posibles directorios de instalacion — Inno Setup usa {autopf}	suki\ide    # {autopf} = C:\Program Files en admin o %LOCALAPPDATA%\Programs en usuario
    lappdata = os.environ.get("LOCALAPPDATA", "")
    # PROGRAMW6432 is always the native 64-bit Program Files folder on
    # 64-bit Windows, even when Python itself is a 32-bit process.
    # PROGRAMFILES alone returns Program Files (x86) for 32-bit processes.
    pf = (
        os.environ.get("PROGRAMW6432")
        or os.environ.get("PROGRAMFILES")
        or r"C:\Program Files"
    )
    exe_name = os.path.basename(exe_src)

    install_candidates = [
        os.path.join(lappdata, "Programs", "tsuki", "ide"),          # Inno user-mode
        os.path.join(pf,       "tsuki", "ide"),                      # Inno admin-mode
        os.path.join(lappdata, "Programs", "tsuki-ide"),             # fallback anterior
    ]

    _kill_tsuki_ide()

    copied_to = None
    for d in install_candidates:
        if os.path.isdir(d):
            dst = os.path.join(d, exe_name)
            if _copy_exe_win(exe_src, dst):
                dst_ts = _dt.datetime.fromtimestamp(os.path.getmtime(dst)).strftime("%H:%M:%S")
                info(f"  copiado → {dst}  (timestamp: {dst_ts})")
                if copied_to is None:
                    copied_to = dst
            else:
                warn(f"  no se pudo copiar a {dst}")

    if copied_to is None:
        # Ningún directorio de instalacion existia — crear el de Inno user-mode
        d = install_candidates[0]
        os.makedirs(d, exist_ok=True)
        dst = os.path.join(d, exe_name)
        if _copy_exe_win(exe_src, dst):
            info(f"  creado y copiado → {dst}")
            copied_to = dst
        else:
            warn(f"  fallo al copiar a {dst} — abre el IDE manualmente desde {exe_src}")

    return copied_to


def run_installer():
    """
    Ejecuta el instalador generado para el host actual.
    En Windows: lanza el wizard de Inno Setup y ESPERA a que termine.
    """
    host = platform.system().lower()

    if host == "windows":
        candidates = [
            f for f in os.listdir(RELEASE_DIR)
            if f.endswith(".exe") and "setup" in f.lower()
        ]
        if not candidates:
            warn("No se encontro el instalador .exe en releases/.")
            warn("Ejecutalo manualmente desde: " + RELEASE_DIR)
            return
        installer = os.path.join(RELEASE_DIR, sorted(candidates)[-1])
        info(f"Lanzando instalador → {os.path.basename(installer)}")
        info("  (esperando a que el wizard termine...)")
        # subprocess.run espera — a diferencia del Popen anterior que no esperaba
        # y dejaba el binario viejo instalado si el usuario cerraba el wizard.
        result = subprocess.run([installer])
        if result.returncode == 0:
            info("Instalador completado correctamente.")
        else:
            warn(f"El instalador termino con codigo {result.returncode}.")

    else:
        suffix = f"{HOST_PLATFORM}.tar.gz"
        candidates = [
            f for f in os.listdir(RELEASE_DIR)
            if f.endswith(suffix)
        ]
        if not candidates:
            warn(f"No se encontro .tar.gz para {HOST_PLATFORM}.")
            return
        archive     = os.path.join(RELEASE_DIR, sorted(candidates)[-1])
        extract_dir = os.path.join(BUILD_DIR, "install_tmp")
        os.makedirs(extract_dir, exist_ok=True)
        run(["tar", "xzf", archive, "-C", extract_dir])
        install_sh = os.path.join(extract_dir, "install.sh")
        if not os.path.isfile(install_sh):
            warn("No se encontro install.sh dentro del tar.gz.")
            return
        os.chmod(install_sh, 0o755)
        info("Ejecutando install.sh...")
        subprocess.run(["/bin/bash", install_sh], cwd=extract_dir)


# ─────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────
USAGE = """
  python tools/build.py               Build de desarrollo (host) + instalar via wizard
  python tools/build.py --quick       Build dev + copia el exe directamente (sin wizard)
  python tools/build.py clean         Limpia dist/ y releases/
  python tools/build.py clean --deep  Limpia todo (incluyendo target/ y cargo)
  python tools/build.py release                       Build para todas las plataformas (version desde git)
  python tools/build.py release --version 1.2.3      Forzar version explicita (recomendado para releases)
  python tools/build.py release --version 1.2.3 --no-publish   Sólo compilar y firmar, sin crear GitHub Release
  python tools/build.py release --version 1.2.3 --flags "restartOnBoarding"         Forzar re-onboarding en esta version
  python tools/build.py release --version 1.2.3 --flags "restartOnBoarding,whatsNew" --notes "Nota"
  python tools/build.py gen-keys      Genera par de claves Ed25519 para stable y testing
  python tools/build.py show-keys     Muestra las claves publicas actuales (para incrustar en el IDE)

  Cross-compilation sin Docker (recomendado para releases):
    cargo install cargo-zigbuild
    pip install ziglang
    # El build detecta zigbuild automáticamente y lo usa para todos los targets

  Flags disponibles (--flags, separados por coma):
    restartOnBoarding   Fuerza que el wizard de onboarding aparezca de nuevo en esta version
    whatsNew            Muestra el popup What's New (usa --notes como cuerpo del changelog o JSON)
"""


def parse_command():
    raw = sys.argv[1:]

    forced_version = None
    deep_clean     = False
    quick          = False
    channel        = "stable"
    notes          = ""
    no_publish     = False
    flags_str      = ""   # comma-separated update flags: "restartOnBoarding,whatsNew"

    filtered = []
    i = 0
    while i < len(raw):
        if raw[i] == "--version" and i + 1 < len(raw):
            forced_version = raw[i + 1]
            i += 2
        elif raw[i] == "--deep":
            deep_clean = True
            i += 1
        elif raw[i] == "--quick":
            quick = True
            i += 1
        elif raw[i] == "--channel" and i + 1 < len(raw):
            ch = raw[i + 1].lower()
            if ch not in ("stable", "testing"):
                error(f"Canal desconocido: {ch!r}  (usa: stable | testing)")
                sys.exit(1)
            channel = ch
            i += 2
        elif raw[i] == "--notes" and i + 1 < len(raw):
            notes = raw[i + 1]
            i += 2
        elif raw[i] == "--flags" and i + 1 < len(raw):
            flags_str = raw[i + 1]
            i += 2
        elif raw[i] == "--no-publish":
            no_publish = True
            i += 1
        elif raw[i].startswith("--"):
            error(f"Flag desconocido: {raw[i]}")
            print(USAGE)
            sys.exit(1)
        else:
            filtered.append(raw[i])
            i += 1

    command = filtered[0].lower() if filtered else "dev"

    if len(filtered) > 1 or command not in ("dev", "clean", "release", "gen-keys", "show-keys"):
        error(f"Comando no valido: {' '.join(filtered)!r}")
        print(USAGE)
        sys.exit(1)

    return command, forced_version, deep_clean, quick, channel, notes, no_publish, flags_str


def _print_header(subtitle=""):
    w = min(TERM_W(), 60)
    line = "═" * w
    print(f"\n{BOLD}{CYAN}{line}")
    tag = f"  {APP_NAME} Build System"
    if subtitle:
        tag += f"  {DIM}{subtitle}{RESET}{BOLD}{CYAN}"
    print(tag)
    print(f"{line}{RESET}\n")


def _build_platforms(target_platforms, version, commit, date,
                     skip_ide=False, host_key=None):
    """
    Compila Go + Rust + Tauri para cada plataforma y crea los instaladores.
    Devuelve el dict de resultados.
    """
    if host_key is None:
        h = platform.system().lower()
        ha = "amd64" if platform.machine() in ("x86_64", "AMD64") else "arm64"
        host_key = f"{'windows' if h == 'windows' else 'darwin' if h == 'darwin' else 'linux'}-{ha}"

    results = {}

    for pk in target_platforms:
        w = min(TERM_W(), 60)
        print(f"\n{BOLD}{'─'*w}")
        print(f"  Platform  {CYAN}{pk}{RESET}")
        print(f"{DIM}{'─'*w}{RESET}\n")

        try:
            go_bin = build_go(pk, version, commit, date)
        except subprocess.CalledProcessError as e:
            error(f"Go build fallo para {pk}: {e}")
            continue

        core_bin, flash_bin = build_rust(pk)
        results[pk] = {"go": go_bin, "core": core_bin, "flash": flash_bin}

        # Tauri: compilar si es el host O si es el mismo OS con distinta arch
        ide_bundle = ide_exe_name = None
        if not skip_ide and _tauri_can_cross(pk):
            try:
                ide_bundle, ide_exe_name = build_tauri(pk, version)
            except Exception as e:
                warn(f"Tauri IDE build fallo para {pk}: {e}")

        r = results[pk]
        missing_rust = r["core"] is None or r["flash"] is None

        if missing_rust:
            warn(
                f"Instalador para {pk} sin binarios Rust "
                f"(requieren cross-compilacion)."
            )

        if r["go"] is None and r["core"] is None:
            warn(f"Sin binarios para {pk}, saltando instalador.")
            continue

        numeric_version = _version_to_numeric(version)

        if "windows" in pk:
            if missing_rust:
                warn(f"Instalador Windows omitido para {pk}: faltan binarios Rust.")
            else:
                create_windows_installer(
                    go_bin=r["go"],
                    core_bin=r["core"],
                    flash_bin=r["flash"],
                    version=version,
                    ide_bundle_dir=ide_bundle,
                    ide_exe_name=ide_exe_name,
                    numeric_version=numeric_version,
                    platform_key=pk,
                )
        else:
            create_unix_installer(pk,
                go_bin=r["go"],
                core_bin=r["core"],
                flash_bin=r["flash"],
                version=version,
            )

    return results


def _print_summary(version):
    w = min(TERM_W(), 60)
    print(f"\n{BOLD}{GREEN}{'═'*w}")
    print(f"  {APP_NAME} v{version}  —  build completo")
    print(f"{'═'*w}{RESET}\n")
    if os.path.isdir(RELEASE_DIR) and os.listdir(RELEASE_DIR):
        print(f"  {DIM}Instaladores en:{RESET} {BOLD}{RELEASE_DIR}{RESET}\n")
        for f in sorted(os.listdir(RELEASE_DIR)):
            fp = os.path.join(RELEASE_DIR, f)
            if not os.path.isfile(fp):
                continue
            size = os.path.getsize(fp)
            size_str = f"{size/1024/1024:.1f} MB" if size > 1024*1024 else f"{size/1024:.0f} KB"
            print(f"  {GREEN}📦{RESET}  {f:<55}  {DIM}{size_str}{RESET}")
    print()


# ── Comandos ─────────────────────────────────

def cmd_clean(deep):
    _print_header("→ clean")
    msg = "Esto eliminara dist/, releases/ y los caches de Rust/Go." if deep else "Esto eliminara dist/ y releases/."
    warn(msg)
    confirm = input("  ¿Continuar? [s/N] ").strip().lower()
    if confirm not in ("s", "si", "y", "yes"):
        print("  Cancelado.")
        sys.exit(0)
    clean(deep=deep)


def cmd_dev(forced_version, quick=False):
    _print_header("→ dev" + (" [--quick]" if quick else ""))

    h  = platform.system().lower()
    ha = "amd64" if platform.machine() in ("x86_64", "AMD64") else "arm64"
    host_key = f"{'windows' if h == 'windows' else 'darwin' if h == 'darwin' else 'linux'}-{ha}"

    info(f"Host detectado: {host_key}")

    if quick:
        # ── Modo rapido ───────────────────────────────────────────────────────
        # Tauri embebe el frontend (ide/out/) en el binario Rust en compile time.
        # Si ide/out/ ya existe (build anterior), solo recompilamos Rust con
        # cargo build — mucho mas rapido (~30s en caliente).
        # Si ide/out/ no existe, hay que hacer npm run build primero (~60s extra).
        step("Modo --quick: build de la IDE")
        cargo = shutil.which("cargo")
        npm   = shutil.which("npm")
        if not cargo:
            error("cargo no encontrado.")
            sys.exit(1)

        out_dir    = os.path.join(IDE_DIR, "out")
        tauri_src  = os.path.join(IDE_DIR, "src-tauri")
        needs_npm  = not os.path.isdir(out_dir) or not os.listdir(out_dir)

        if not npm:
            error("npm no encontrado.")
            sys.exit(1)

        # npm install si no existe node_modules
        if not os.path.isdir(os.path.join(IDE_DIR, "node_modules")):
            step("node_modules no existe → npm install")
            try:
                run([npm, "install"], cwd=IDE_DIR)
            except subprocess.CalledProcessError as e:
                error(f"npm install fallido (exit={e.returncode}).")
                sys.exit(1)
        else:
            info("node_modules existe — saltando npm install")

        # ── Gestión del cache de Next.js ──────────────────────────────────────
        # tauri build ejecuta `beforeBuildCommand: npm run build` automáticamente,
        # así que no necesitamos detectar cambios ni llamar a npm manualmente.
        # Borramos .next/ entero (no solo cache/) para que Next.js no reutilice
        # chunks ni páginas previas y haga siempre una recompilación completa.
        # Borrar .next/ Y out/ para forzar reconstruccion completa.
        # out/ contiene el export estatico que Tauri embebe en el binario.
        # Si out/ no se borra, Next.js puede omitir paginas "sin cambios"
        # y Tauri embebe el bundle viejo con el BottomPanel.tsx anterior.
        for cleanup_dir, label in [
            (os.path.join(IDE_DIR, ".next"), ".next/"),
            (os.path.join(IDE_DIR, "out"),   "out/"),
        ]:
            if os.path.isdir(cleanup_dir):
                shutil.rmtree(cleanup_dir, ignore_errors=True)
                info(f"{label} eliminado -- Next.js reconstruira desde cero")
            else:
                info(f"{label} no existe -- primera build")

        # Matar el proceso tsuki-ide PRIMERO, antes de tocar cualquier archivo.
        # En Windows, os.remove() y el linker fallan con PermissionError/LNK1104
        # si el exe sigue bloqueado por el proceso en ejecucion.
        step("Cerrando IDE anterior (libera el exe para el linker)")
        _kill_tsuki_ide()

        # ── Forzar recompilacion Rust borrando target/debug/ directamente ──────────
        # cargo clean -p puede fallar silenciosamente o limpiar el
        # directorio equivocado. Borrar target/<rust_target>/debug/ entero
        # es la unica forma garantizada de que Cargo recompile todo.
        step("Borrando target debug para forzar recompilacion completa")
        rust_target_clean = PLATFORMS[host_key]["rust_target"]
        debug_dir = os.path.join(IDE_DIR, "src-tauri", "target", rust_target_clean, "debug")
        if os.path.isdir(debug_dir):
            _rmtree_force(debug_dir)
            info(f"  {debug_dir} eliminado -- Cargo recompilara todo desde cero")
        else:
            info("  directorio debug no existe -- primera build")

                # tauri build --debug: compila Rust en debug + embebe ide/out/ (distDir).
        # Mas rapido que release (~40s en caliente) y produce un binario funcional.
        # NO usar cargo build directamente — ese usa devPath (localhost:3000).
        step("Compilando IDE con tauri build --debug")
        try:
            run([npm, "run", "tauri", "build", "--",
                 "--debug",
                 "--target", PLATFORMS[host_key]["rust_target"]],
                cwd=IDE_DIR)
        except subprocess.CalledProcessError as e:
            error(f"tauri build fallido (exit={e.returncode}). Revisa la salida de arriba.")
            sys.exit(1)

        step("Instalando exe directamente (sin wizard)...")
        exe_dst = install_ide_direct(host_key)
        if not exe_dst:
            warn("No se pudo instalar el exe.")

        _print_summary("dev-quick")

        # ── Lanzar directamente desde el directorio de build ─────────────────
        # Más fiable que lanzar desde el directorio instalado — garantiza que
        # estamos ejecutando el binario recién compilado.
        exe_built = _find_tauri_exe(host_key)
        launch_exe = exe_built or exe_dst

        if launch_exe and os.path.isfile(launch_exe):
            import datetime as _dt
            age_secs = _dt.datetime.now().timestamp() - os.path.getmtime(launch_exe)
            ts       = _dt.datetime.fromtimestamp(os.path.getmtime(launch_exe)).strftime("%H:%M:%S")
            if age_secs > 300:
                warn(f"El exe tiene {int(age_secs)}s de antigüedad ({ts}) — puede no ser el recién compilado.")
                warn("Ejecuta: python tools/build.py clean --deep  y luego --quick de nuevo.")
            else:
                info(f"  exe: {launch_exe}  (build: {ts}, hace {int(age_secs)}s) ✓")
            step(f"Lanzando IDE → {os.path.basename(launch_exe)}")
            subprocess.Popen([launch_exe])
            info("IDE lanzada.")
        else:
            warn("No se pudo lanzar el IDE. Abrelo manualmente.")
        return

    # ── Modo normal: build completo + wizard ──────────────────────────────────
    check_dependencies(skip_go=False, skip_rust=False, skip_ide=False)
    clean(deep=False)

    version, commit, date = get_version(forced_version)
    print(f"\n  Version : {BOLD}{version}{RESET}  |  Commit : {commit}  |  Fecha : {date}\n")

    _build_platforms([host_key], version, commit, date, host_key=host_key)
    _print_summary(version)

    step("Lanzando instalador...")
    run_installer()



# ─────────────────────────────────────────────────────────────────────────────
#  GITHUB RELEASE PUBLISHING
#
#  Usa la CLI oficial `gh` (github.com/cli/cli) para crear la release y subir
#  los artefactos. Si `gh` no está disponible muestra instrucciones manuales.
#
#  Convenciones de tags:
#    stable   →  v1.2.3
#    testing  →  v1.2.3-testing
#
#  Artefactos subidos:
#    - Todos los .tar.gz y .exe de releases/
#    - Los archivos .sig correspondientes (si existen)
#    - manifest.json  ← para el fallback del endpoint /api/update/[channel]
# ─────────────────────────────────────────────────────────────────────────────

def _has_gh():
    return shutil.which("gh") is not None


def publish_github_release(version, channel, notes, manifest_path):
    """Crea una GitHub Release y sube todos los artefactos.

    - stable  → tag v{version}, non-prerelease
    - testing → tag v{version}-testing, prerelease

    La web en tsuki.sh/api/update/{channel} leerá esta release automáticamente.
    No hay que hacer commit de ningún archivo al repo.
    """
    step(f"Publicando GitHub Release → {channel} v{version}")

    if not _has_gh():
        warn("La CLI `gh` no está instalada — salta la publicación automática.")
        warn("Instala gh:  https://cli.github.com/")
        warn("Luego crea la release manualmente:")
        tag = f"v{version}" if channel == "stable" else f"v{version}-testing"
        warn(f"  gh release create {tag} releases/* --notes {notes!r}")
        return

    tag      = f"v{version}" if channel == "stable" else f"v{version}-testing"
    is_pre   = channel == "testing"
    title    = f"tsuki {version}" + (" (testing)" if is_pre else "")
    body     = notes or f"tsuki {version} {'(testing channel)' if is_pre else '(stable)'}"

    # Collect all artifacts to upload
    upload_files = []
    if os.path.isdir(RELEASE_DIR):
        for fname in sorted(os.listdir(RELEASE_DIR)):
            fpath = os.path.join(RELEASE_DIR, fname)
            if not os.path.isfile(fpath):
                continue
            # Skip previous manifests — we upload a fresh manifest.json
            if fname.startswith("update-") and fname.endswith(".json"):
                continue
            upload_files.append(fpath)

    # Rename / copy the manifest to manifest.json so the web API can find it
    manifest_copy = os.path.join(RELEASE_DIR, "manifest.json")
    if manifest_path and os.path.exists(manifest_path):
        shutil.copy(manifest_path, manifest_copy)
        upload_files.append(manifest_copy)

    if not upload_files:
        warn("  No hay artefactos en releases/ para subir.")

    # Ensure the tag exists locally and is pushed before calling gh.
    # Without a pushed tag, gh silently creates the release as a draft.
    step(f"Creando/empujando tag {tag}...")
    subprocess.run(["git", "tag", "-f", tag], cwd=PROJECT_ROOT,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    push_result = subprocess.run(
        ["git", "push", "origin", tag, "--force"],
        cwd=PROJECT_ROOT, stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE, text=True,
    )
    if push_result.returncode != 0:
        warn(f"  git push tag falló: {push_result.stderr.strip()}")
        warn("  La release podría crearse como draft si el tag no existe en el remoto.")

    # Build gh command — never draft, publish immediately
    cmd = [
        "gh", "release", "create", tag,
        "--title", title,
        "--notes", body,
        "--verify-tag",
    ]
    if is_pre:
        cmd += ["--prerelease", "--latest=false"]
    else:
        cmd += ["--latest"]
    cmd += upload_files

    try:
        run(cmd, cwd=PROJECT_ROOT)
        info(f"GitHub Release creada → {tag}")
        info(f"La web detectará la actualización automáticamente en ~5 min.")
        info(f"  https://github.com/{PUBLISHER_URL.split('github.com/')[-1]}/releases/tag/{tag}")
    except subprocess.CalledProcessError as e:
        warn(f"gh release create falló (exit={e.returncode}).")
        warn("Si el tag ya existe, bórralo primero:")
        warn(f"  gh release delete {tag} --yes && git tag -d {tag}")


# ─────────────────────────────────────────────────────────────────────────────
#  KEY MANAGEMENT  (Ed25519 via cryptography library or openssl fallback)
# ─────────────────────────────────────────────────────────────────────────────

def _require_crypto():
    """Intentar importar cryptography; sugerir instalación si falta."""
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import (
            Ed25519PrivateKey, Ed25519PublicKey,
        )
        from cryptography.hazmat.primitives.serialization import (
            Encoding, PublicFormat, PrivateFormat, NoEncryption,
        )
        return True
    except ImportError:
        error("La librería 'cryptography' no está instalada.")
        error("  pip install cryptography")
        return False


def _key_paths(channel):
    """Devuelve (private_pem_path, public_b64_path) para el canal dado."""
    os.makedirs(KEYS_DIR, exist_ok=True)
    return (
        os.path.join(KEYS_DIR, f"{channel}_private.pem"),
        os.path.join(KEYS_DIR, f"{channel}_public.b64"),
    )


def cmd_gen_keys():
    """Genera nuevos pares de claves Ed25519 para stable y testing.

    Los archivos se guardan en tools/keys/ (añade esta carpeta a .gitignore).
    La clave pública (base64) debe incrustarse en el IDE antes de compilar
    (constante UPDATE_PUBKEYS en SettingsScreen.tsx).
    """
    _print_header("→ gen-keys")

    if not _require_crypto():
        sys.exit(1)

    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import (
        Encoding, PublicFormat, PrivateFormat, NoEncryption,
    )
    import base64

    for channel in ("stable", "testing"):
        priv_path, pub_path = _key_paths(channel)

        if os.path.exists(priv_path):
            warn(f"  {channel}: clave ya existe en {priv_path} — omitiendo.")
            warn("  Borra el archivo manualmente si quieres regenerarla.")
            # Still show the current public key
            if os.path.exists(pub_path):
                with open(pub_path) as f:
                    info(f"  {channel} public key (actual): {f.read().strip()}")
            continue

        priv = Ed25519PrivateKey.generate()
        pub  = priv.public_key()

        priv_pem = priv.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption())
        pub_b64  = base64.b64encode(
            pub.public_bytes(Encoding.Raw, PublicFormat.Raw)
        ).decode()

        with open(priv_path, "wb") as f:
            f.write(priv_pem)
        os.chmod(priv_path, 0o600)  # owner read-only

        with open(pub_path, "w") as f:
            f.write(pub_b64)

        info(f"  {channel} private key → {priv_path}")
        info(f"  {channel} public  key → {pub_path}")
        print(f"  {BOLD}PUBLIC KEY ({channel}):{RESET}  {pub_b64}")
        print()

    print(f"  {YELLOW}Importante:{RESET}")
    print("  1. Añade tools/keys/ a .gitignore (NUNCA subas las claves privadas).")
    print("  2. Copia las claves públicas a UPDATE_PUBKEYS en SettingsScreen.tsx.")
    print("  3. Las claves privadas quedan sólo en tu máquina de build.")


def cmd_show_keys():
    """Muestra las claves públicas actuales (para copiarlas al IDE)."""
    _print_header("→ show-keys")
    for channel in ("stable", "testing"):
        _, pub_path = _key_paths(channel)
        if os.path.exists(pub_path):
            with open(pub_path) as f:
                key = f.read().strip()
            print(f"  {BOLD}{channel}{RESET}:  {key}")
        else:
            warn(f"  {channel}: no hay clave pública en {pub_path}")
            warn("  Ejecuta: python tools/build.py gen-keys")


def _sign_file(file_path, channel):
    """Firma file_path con la clave privada de channel y devuelve la firma base64.

    Si la librería cryptography no está disponible o la clave no existe,
    devuelve una cadena vacía (el instalador no verificará la firma).
    """
    if not _require_crypto():
        return ""

    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    import base64

    priv_path, _ = _key_paths(channel)
    if not os.path.exists(priv_path):
        warn(f"  Clave privada '{channel}' no encontrada en {priv_path} — firma omitida.")
        warn("  Ejecuta: python tools/build.py gen-keys")
        return ""

    with open(priv_path, "rb") as f:
        priv = load_pem_private_key(f.read(), password=None)

    with open(file_path, "rb") as f:
        data = f.read()

    sig = priv.sign(data)
    return base64.b64encode(sig).decode()


def _file_size(path):
    """Devuelve el tamaño del archivo en bytes, o 0 si no existe."""
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


# ─────────────────────────────────────────────────────────────────────────────
#  UPDATE MANIFEST GENERATION
#  Genera update-stable.json y update-testing.json en releases/
#
#  Formato del manifiesto (compatible con el UpdateInfo de main.rs):
#  {
#    "version":   "1.2.3",
#    "channel":   "stable",
#    "pub_date":  "2025-01-01T00:00:00Z",
#    "notes":     "Release notes aquí",
#    "platforms": {
#      "linux-amd64":   { "url": "...", "signature": "...", "size": 12345 },
#      "darwin-arm64":  { ... },
#      "windows-amd64": { ... }
#    }
#  }
# ─────────────────────────────────────────────────────────────────────────────

def parse_flags(flags_str):
    """Parsea la cadena de --flags y devuelve las opciones de release.

    Formato soportado (separar múltiples flags con coma):

      restartOnBoarding
        → El IDE forzará re-show del wizard de onboarding al actualizar
          a esta versión. Se incrusta como forcedOnboardingVersion en el
          manifiesto de actualización.

      whatsNew:Texto 1;improvement:Texto 2;fix:Fix crasheo;breaking:API cambia
        → Muestra el popup What's New al arrancar tras actualizar.
          Prefijos opcionales por entrada: feature (default), improvement, fix, breaking.
          Las entradas se separan con ';'.
          Se incrusta como whatsNewVersion + whatsNewChangelog (JSON).

    Ejemplo completo:
      --flags "restartOnBoarding,whatsNew:Nuevo transpiler Go 2;fix:Fix crash serial"

    Devuelve:
      {
        "restart_onboarding": bool,
        "whats_new_entries": [{"type": ..., "text": ...}, ...]  ← vacío si no activo
      }
    """
    result = {"restart_onboarding": False, "whats_new_entries": []}
    if not flags_str:
        return result

    for part in flags_str.split(","):
        part = part.strip()
        if not part:
            continue
        lpart = part.lower()

        if lpart == "restartonboarding":
            result["restart_onboarding"] = True

        elif lpart.startswith("whatsnew"):
            raw_entries = part.split(":", 1)[1].strip() if ":" in part else ""
            entries = []
            for entry in raw_entries.split(";"):
                entry = entry.strip()
                if not entry:
                    continue
                entry_type = "feature"
                text = entry
                for t in ("feature", "improvement", "fix", "breaking"):
                    if entry.lower().startswith(f"{t}:"):
                        entry_type = t
                        text = entry[len(t) + 1:].strip()
                        break
                if text:
                    entries.append({"type": entry_type, "text": text})
            result["whats_new_entries"] = entries

        else:
            warn(f"Flag desconocido ignorado: {part!r}  (válidos: restartOnBoarding, whatsNew:...)")

    return result


def generate_update_manifests(version, date, channel="stable", notes="", flags_str=""):
    """Genera update-{channel}.json con todas las plataformas disponibles en releases/.

    Firma cada artefacto con la clave privada del canal si está disponible.
    Se llama automáticamente al final de cmd_release.

    flags_str: cadena de flags separada por comas, ej:
      "restartOnBoarding"
      "whatsNew:Nueva feature;fix:Fix crash"
      "restartOnBoarding,whatsNew:Feat 1;Feat 2"
    """
    step(f"Generando manifiesto de actualización → {channel}")

    import json as _json

    # ── Parsear flags ──────────────────────────────────────────────────────────
    flags = parse_flags(flags_str)
    restart_onboarding = flags["restart_onboarding"]
    whats_new_entries  = flags["whats_new_entries"]
    whats_new          = len(whats_new_entries) > 0

    if restart_onboarding:
        info(f"  Flag restartOnBoarding → forcedOnboardingVersion = {version}")
    if whats_new:
        info(f"  Flag whatsNew → {len(whats_new_entries)} changelog entries para v{version}")
        for e in whats_new_entries:
            info(f"    [{e['type']}] {e['text']}")

    # ── Serializar changelog ───────────────────────────────────────────────────
    # Si no hay entries de --flags pero hay --notes, intentar parsear notes como
    # JSON de ChangelogEntry[], o convertir texto plano a un único entry.
    changelog_json = None
    if whats_new:
        changelog_json = _json.dumps(whats_new_entries, ensure_ascii=False)
    elif notes:
        # --notes sin --flags whatsNew: úsalo como changelog de texto plano si queremos
        # (no se activa por defecto — evita mostrar el popup accidentalmente)
        pass

    # ── Collect built artifacts ────────────────────────────────────────────────
    platforms = {}

    if os.path.isdir(RELEASE_DIR):
        for fname in sorted(os.listdir(RELEASE_DIR)):
            fpath = os.path.join(RELEASE_DIR, fname)
            if not os.path.isfile(fpath):
                continue
            if fname.startswith("update-") and fname.endswith(".json"):
                continue

            pk = None
            for candidate in PLATFORMS:
                if candidate in fname:
                    pk = candidate
                    break
            if pk is None:
                continue

            release_tag = f"v{version}" if channel == "stable" else f"v{version}-testing"
            asset_url = f"{GITHUB_RELEASES_BASE}/{release_tag}/{fname}"
            signature = _sign_file(fpath, channel)
            platforms[pk] = {
                "url":       asset_url,
                "signature": signature,
                "size":      _file_size(fpath),
            }

    if not platforms:
        warn("  No se encontraron artefactos en releases/ para el manifiesto.")
        warn("  El manifiesto se generará vacío — actualízalo manualmente.")

    manifest = {
        "version":   version,
        "channel":   channel,
        "pub_date":  date,
        "notes":     notes or f"tsuki {version} ({channel})",
        "platforms": platforms,
    }

    # ── Incrustar flags en el manifiesto ───────────────────────────────────────
    # El IDE lee estos campos en page.tsx (handleSplashDone / checkWhatsNew).
    # forcedOnboardingVersion: si > tsuki-onboarding-version en localStorage,
    #   el wizard se vuelve a mostrar con modo 'update'.
    # whatsNewVersion + whatsNewChangelog: si whatsNewVersion > tsuki-whats-new-seen,
    #   se muestra el popup WhatsNewModal.
    if restart_onboarding:
        manifest["forced_onboarding_version"] = version
        info(f"  ✓ forcedOnboardingVersion = {version}")
    if whats_new and changelog_json:
        manifest["whats_new_version"]   = version
        manifest["whats_new_changelog"] = changelog_json
        info(f"  ✓ whatsNewVersion = {version}")

    manifest_path = UPDATE_MANIFEST_STABLE if channel == "stable" else UPDATE_MANIFEST_TESTING
    with open(manifest_path, "w", encoding="utf-8") as f:
        _json.dump(manifest, f, indent=2, ensure_ascii=False)

    info(f"Manifiesto escrito → {os.path.basename(manifest_path)}")
    for pk, asset in platforms.items():
        signed = "✓ firmado" if asset["signature"] else "⚠ sin firma"
        sz = f"{asset['size'] / 1024 / 1024:.1f} MB" if asset['size'] > 0 else "?"
        info(f"  {pk:20s}  {sz:8s}  {signed}")

    return manifest_path

def cmd_release(forced_version, channel="stable", notes="", no_publish=False, flags_str=""):
    _print_header(f"→ release [{channel}]")

    warn("Esto intentara compilar para TODAS las plataformas.")
    warn("Rust solo compilara para el host (cross-compile omitido).")
    confirm = input("  ¿Continuar? [s/N] ").strip().lower()
    if confirm not in ("s", "si", "y", "yes"):
        print("  Cancelado.")
        sys.exit(0)

    check_dependencies(skip_go=False, skip_rust=False, skip_ide=False)
    clean(deep=False)

    version, commit, date = get_version(forced_version)
    if forced_version:
        info(f"Version forzada: {BOLD}{version}{RESET}")
    else:
        warn("Version derivada de git — usa --version X.Y.Z para fijarla.")
    print(f"\n  Version : {BOLD}{version}{RESET}  |  Commit : {commit}  |  Fecha : {date}")
    print(f"  Canal   : {BOLD}{channel}{RESET}")

    # Show active flags summary
    if flags_str:
        flags = parse_flags(flags_str)
        flag_labels = []
        if flags["restart_onboarding"]:
            flag_labels.append("restartOnBoarding")
        if flags["whats_new_entries"]:
            flag_labels.append(f"whatsNew ({len(flags['whats_new_entries'])} entries)")
        if flag_labels:
            print(f"  Flags   : {BOLD}{', '.join(flag_labels)}{RESET}")
    print()

    _build_platforms(list(PLATFORMS.keys()), version, commit, date)
    _print_summary(version)

    # Generate update manifests and sign artifacts
    manifest_path = generate_update_manifests(
        version, date, channel=channel, notes=notes, flags_str=flags_str
    )

    # Publish to GitHub Releases — the web API reads it automatically, no commits needed
    if not no_publish:
        publish_github_release(version, channel, notes, manifest_path)
    else:
        warn("--no-publish: artefactos generados pero GitHub Release omitida.")

    print()
    info(f"Release {version} ({channel}) lista.")
    info(f"La web tsuki.sh/api/update/{channel} detectará la nueva version en ~5 min.")


def main():
    command, forced_version, deep_clean, quick, channel, notes, no_publish, flags_str = parse_command()

    if command == "clean":
        cmd_clean(deep=deep_clean)
    elif command == "release":
        cmd_release(forced_version, channel=channel, notes=notes, no_publish=no_publish, flags_str=flags_str)
    elif command == "gen-keys":
        cmd_gen_keys()
    elif command == "show-keys":
        cmd_show_keys()
    else:
        cmd_dev(forced_version, quick=quick)


if __name__ == "__main__":
    main()