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
RELEASE_DIR    = os.path.join(PROJECT_ROOT, "releases")
IDE_DIR        = os.path.join(PROJECT_ROOT, "ide")
FLASH_DIR      = PROJECT_ROOT   # Rust crate: tsuki-core + tsuki-flash
REGISTRY_URL   = "https://raw.githubusercontent.com/s7lver/tsuki/refs/heads/main/pkg/packages.json"
RELEASES_REPO_DIR = os.path.join(PROJECT_ROOT, "releases")  # also the RELEASE_DIR — json files live here too
KEYS_DIR       = os.path.join(PROJECT_ROOT, "tools", "keys")  # NOT committed — .gitignore this
UPDATE_MANIFEST_STABLE  = os.path.join(RELEASE_DIR, "update-stable.json")
UPDATE_MANIFEST_TESTING = os.path.join(RELEASE_DIR, "update-testing.json")
# GitHub raw URL base for update asset downloads (change to your own repo)
GITHUB_RELEASES_BASE = "https://github.com/s7lver/tsuki/releases/download"
PUBLISHER      = "tsuki Team"
PUBLISHER_URL  = "https://github.com/s7lver/tsuki"
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
BOLD  = "\033[1m"
GREEN = "\033[32m"
CYAN  = "\033[36m"
YELLOW= "\033[33m"
RED   = "\033[31m"
RESET = "\033[0m"

def info(msg):  print(f"{GREEN}✓{RESET} {msg}")
def step(msg):  print(f"\n{BOLD}{CYAN}▶ {msg}{RESET}")
def warn(msg):  print(f"{YELLOW}⚠  {msg}{RESET}")
def error(msg): print(f"{RED}✗ {msg}{RESET}")

def run(cmd, cwd=None, env=None, check=True, tail_lines=12):
    """Ejecuta un comando mostrando los argumentos.

    - En éxito: muestra las últimas `tail_lines` líneas de output.
    - En fallo: muestra TODAS las líneas (para que el error de cargo/npm sea visible)
      y relanza CalledProcessError.
    """
    display = " ".join(str(c) for c in cmd)
    print(f"  $ {display}")
    result = subprocess.run(cmd, cwd=cwd, env=env, check=False,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    output = result.stdout or ""
    lines  = output.strip().splitlines()

    if result.returncode != 0:
        # Mostrar TODO el output — el mensaje de error puede estar en cualquier línea
        print()
        print(f"{RED}{'─'*60}")
        print(f"  FALLO (exit={result.returncode}): {display}")
        print(f"{'─'*60}{RESET}")
        for line in lines:
            print(f"    {line}")
        print()
        if check:
            raise subprocess.CalledProcessError(result.returncode, cmd, output)
    else:
        if lines:
            for line in lines[-tail_lines:]:
                print(f"    {line}")

    return result

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


def get_version(forced=None):
    if forced:
        clean = _sanitize_version(forced)
        d = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        return clean, "manual", d
    try:
        raw = subprocess.check_output(
            ["git", "describe", "--tags", "--always", "--dirty"],
            cwd=PROJECT_ROOT, stderr=subprocess.DEVNULL).decode().strip() or "0.1.0"
        c = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=PROJECT_ROOT, stderr=subprocess.DEVNULL).decode().strip()
    except Exception:
        raw, c = "0.1.0", "unknown"
    d = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return _sanitize_version(raw), c, d

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
#
#  Rust cross-compilation requiere linkers externos
#  (ej. gcc-aarch64-linux-gnu en Windows/macOS).
#  Para evitar fallos, Rust SIEMPRE compila para el
#  host nativo — sin --target — y solo se incluye en
#  el instalador de la plataforma host.
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

def _has_cross():
    """Devuelve True si `cross` (cargo-cross) esta disponible en el PATH."""
    return shutil.which("cross") is not None


def build_rust(platform_key, force_cross=False):
    """Compila los binarios Rust.

    Estrategia de compilacion:
      1. Host nativo          -> cargo build --release  (sin --target, mas rapido)
      2. Cross via `cross`    -> cross build --release --target <triple>
         Requiere Docker + `cargo install cross`.
         Se activa automaticamente si la plataforma tiene "cross": True
         y `cross` esta en el PATH, o si se pasa force_cross=True.
      3. Sin herramienta      -> avisa y devuelve None, None

    La clave "cross" en PLATFORMS indica si la plataforma *necesita*
    cross-compilacion (no es el host nativo).
    """
    plat = PLATFORMS[platform_key]
    ext  = ".exe" if plat["goos"] == "windows" else ""
    needs_cross = plat.get("cross", False) and platform_key != HOST_PLATFORM

    # -- Caso 1: compilacion nativa ----------------------------------------
    if not needs_cross and platform_key == HOST_PLATFORM:
        step(f"Compilando Rust (nativo) -> {platform_key}")
        run(["cargo", "build", "--release"], cwd=FLASH_DIR)
        src_base = os.path.join(FLASH_DIR, "target", "release")
        results = []
        for name in [CORE_BINARY, FLASH_BINARY]:
            src = os.path.join(src_base, f"{name}{ext}")
            dst = os.path.join(BUILD_DIR, f"{name}-{platform_key}{ext}")
            shutil.copy(src, dst)
            info(f"Rust binary -> {os.path.basename(dst)}")
            results.append(dst)
        return results[0], results[1]

    # -- Caso 2: cross-compilacion con `cross` o `cargo --target` -----------
    rust_target = plat["rust_target"]

    if _has_cross() or force_cross:
        tool = "cross" if _has_cross() else "cargo"
        step(f"Compilando Rust (cross/{tool}) -> {platform_key}  [{rust_target}]")
        if tool == "cross":
            info("  Usando `cross` (Docker). Asegurate de que Docker esta corriendo.")
        else:
            info(f"  Usando `cargo --target {rust_target}`.")
            info("  Asegurate de tener el toolchain: rustup target add " + rust_target)

        run([tool, "build", "--release", "--target", rust_target], cwd=FLASH_DIR)
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
            info(f"Rust binary -> {os.path.basename(dst)}")
            results.append(dst)
        core_out  = results[0] if results else None
        flash_out = results[1] if len(results) > 1 else None
        return core_out, flash_out

    # -- Caso 3: sin herramienta de cross-compilacion ----------------------
    warn(
        f"Rust omitido para {platform_key} (host={HOST_PLATFORM}).\n"
        f"  Opciones para compilar este target:\n"
        f"  A) Instala `cross` (recomendado, usa Docker):\n"
        f"       cargo install cross\n"
        f"  B) Instala el toolchain y linker manualmente:\n"
        f"       rustup target add {rust_target}\n"
        f"       # + linker del sistema (ej. aarch64-linux-gnu-gcc, mingw-w64)\n"
        f"  C) Ejecuta el build directamente en la maquina objetivo."
    )
    return None, None

# ─────────────────────────────────────────────
#  BUILD: TAURI IDE  (solo host actual)
# ─────────────────────────────────────────────
def build_tauri(platform_key, version):
    step(f"Compilando Tauri IDE → {platform_key}")
    plat        = PLATFORMS[platform_key]
    rust_target = plat["rust_target"]

    npm = shutil.which("npm")
    if not npm:
        raise FileNotFoundError("npm no encontrado en el PATH")

    # npm install — errores aquí son raros pero se muestran completos
    try:
        run([npm, "install"], cwd=IDE_DIR)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(
            f"npm install falló (exit={e.returncode}).\n"
            f"Revisa la salida de arriba para ver el error exacto."
        ) from e

    # tauri build — el error más común es un fallo de cargo (mostrado completo por run())
    try:
        run([npm, "run", "tauri", "build", "--", "--target", rust_target], cwd=IDE_DIR)
    except subprocess.CalledProcessError as e:
        # Intentar extraer el resumen de error de cargo de la salida capturada
        output_lines = (e.output or "").splitlines()
        cargo_errors = [l for l in output_lines if "error[" in l or "error:" in l]
        summary = "\n".join(cargo_errors[-10:]) if cargo_errors else "(sin resumen disponible)"
        raise RuntimeError(
            f"Tauri build falló (exit={e.returncode}).\n"
            f"─── Errores de cargo/Rust ───\n{summary}\n"
            f"────────────────────────────\n"
            f"El output completo está arriba."
        ) from e

    # Buscar el ejecutable compilado (no el instalador del bundle)
    release_dir = os.path.join(IDE_DIR, "src-tauri", "target", rust_target, "release")
    alt_release_dir = os.path.join(IDE_DIR, "src-tauri", "target", "release")

    # Nombre del ejecutable Tauri — debe coincidir con [[bin]] name en Cargo.toml
    # y con productName en tauri.conf.json
    IDE_EXE_NAME = "tsuki-ide.exe"

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
        # Fallback: cualquier .exe que no sea instalador/dll (por si cambia el nombre)
        for f in os.listdir(search_dir):
            if f.endswith(".exe") and not any(x in f.lower() for x in ["setup", "msi", ".dll"]):
                exe_src  = os.path.join(search_dir, f)
                exe_name = f
                break
        if exe_src:
            break

    if not exe_src:
        raise FileNotFoundError(f"Tauri executable no encontrado en {release_dir}")

    # Copiar solo el ejecutable a una carpeta limpia
    dst = os.path.join(BUILD_DIR, f"ide-{platform_key}")
    os.makedirs(dst, exist_ok=True)
    shutil.copy(exe_src, os.path.join(dst, exe_name))

    info(f"Tauri IDE executable → {dst}")
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
ArchitecturesAllowed=x64 arm64 x86
ArchitecturesInstallIn64BitMode=x64 arm64
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=@@release_dir@@
OutputBaseFilename=@@app_name@@-Setup-@@version@@-@@platform_key@@
SetupIconFile=@@icon_file@@
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
WizardImageFile=compiler:WizModernImage.bmp
WizardSmallImageFile=compiler:WizModernSmallImage.bmp
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
Name: "quicklaunch";    Description: "Crear icono en &Barra de tareas"; \
                        GroupDescription: "Accesos directos:"; \
                        Components: shortcuts; OnlyBelowVersion: 6.1
Name: "startmenuicon";  Description: "Crear grupo en el &menú Inicio"; \
                        GroupDescription: "Accesos directos:"; \
                        Components: shortcuts

[Dirs]
Name: "{app}\\bin"
Name: "{app}\\libs"
Name: "{app}\\pkg"
Name: "{app}\\logs"
Name: "{app}\\ide"
Name: "{localappdata}\\@@app_name@@";    Flags: uninsalwaysuninstall
Name: "{localappdata}\\@@app_name@@\\config"; Flags: uninsalwaysuninstall

[Files]
; ── CLI Binarios ───────────────────────────────────────────────────
Source: "@@go_bin@@";    DestDir: "{app}\\bin"; DestName: "@@binary@@.exe";       Components: cli; Flags: ignoreversion
Source: "@@core_bin@@";  DestDir: "{app}\\bin"; DestName: "@@core_binary@@.exe";  Components: cli; Flags: ignoreversion skipifsourcedoesntexist
Source: "@@flash_bin@@"; DestDir: "{app}\\bin"; DestName: "@@flash_binary@@.exe"; Components: cli; Flags: ignoreversion skipifsourcedoesntexist

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
  Result := DirExists(ExpandConstant('{app}\ide'));
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
        '@@app_name@@':    APP_NAME,
        '@@version@@':     version,
        '@@binary@@':      BINARY,
        '@@core_binary@@': CORE_BINARY,
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
        "@@go_bin@@":       _w(go_bin),
        "@@core_bin@@":     _w(core_bin),
        "@@flash_bin@@":    _w(flash_bin),
        "@@icon_file@@":    _w(icon_file),
        "@@ide_bundle@@":   _w(ide_bundle) if ide_bundle else "",
        "@@pkg_dir@@":      _w(pkg_dir),
        "@@cores_avr_dir@@": _w(cores_avr),
        "@@release_dir@@":  _w(RELEASE_DIR),
        "@@registry_url@@": REGISTRY_URL,
        "@@ide_exe_name@@": ide_exe_name or f"{APP_NAME}.exe",
        "@@platform_key@@": platform_key,
    }
    iss_content = INNO_SCRIPT
    for placeholder, value in iss_subs.items():
        iss_content = iss_content.replace(placeholder, value)

    if not ide_bundle:
      iss_content = iss_content.replace(
          'Source: "\\*"; DestDir: "{app}\\ide";',
          '; Source: ""; DestDir: "{app}\\ide";'
      )

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
            import time; time.sleep(1)  # esperar a que el proceso libere el archivo
            info("  proceso tsuki-ide anterior terminado")
    except Exception:
        pass  # si falla, el usuario tendrá que cerrarlo manualmente


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
            try:
                shutil.copy2(exe_src, dst)
                dst_ts = _dt.datetime.fromtimestamp(os.path.getmtime(dst)).strftime("%H:%M:%S")
                info(f"  copiado → {dst}  (timestamp: {dst_ts})")
                if copied_to is None:
                    copied_to = dst
            except Exception as e:
                warn(f"  no se pudo copiar a {dst}: {e}")

    if copied_to is None:
        # Ningún directorio de instalacion existia — crear el de Inno user-mode
        d = install_candidates[0]
        os.makedirs(d, exist_ok=True)
        dst = os.path.join(d, exe_name)
        shutil.copy2(exe_src, dst)
        info(f"  creado y copiado → {dst}")
        copied_to = dst

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
  python tools/build.py gen-keys      Genera par de claves Ed25519 para stable y testing
  python tools/build.py show-keys     Muestra las claves publicas actuales (para incrustar en el IDE)
"""


def parse_command():
    raw = sys.argv[1:]

    forced_version = None
    deep_clean     = False
    quick          = False
    channel        = "stable"
    notes          = ""
    no_publish     = False

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

    return command, forced_version, deep_clean, quick, channel, notes, no_publish


def _print_header(subtitle=""):
    print(f"\n{BOLD}{CYAN}{'═'*55}")
    print(f"  {APP_NAME} Build System  {subtitle}")
    print(f"{'═'*55}{RESET}\n")


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
        print(f"\n{BOLD}{'─'*55}\n  Plataforma: {pk}\n{'─'*55}{RESET}")

        try:
            go_bin = build_go(pk, version, commit, date)
        except subprocess.CalledProcessError as e:
            error(f"Go build fallo para {pk}: {e}")
            continue

        core_bin, flash_bin = build_rust(pk)
        results[pk] = {"go": go_bin, "core": core_bin, "flash": flash_bin}

        # Tauri solo en host
        ide_bundle = ide_exe_name = None
        if not skip_ide and pk == host_key:
            try:
                ide_bundle, ide_exe_name = build_tauri(pk, version)
            except Exception as e:
                warn(f"Tauri IDE build fallo: {e}")

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
    print(f"\n{BOLD}{GREEN}{'═'*55}")
    print(f"  Build completo — {APP_NAME} v{version}")
    print(f"{'═'*55}{RESET}\n")
    if os.path.isdir(RELEASE_DIR) and os.listdir(RELEASE_DIR):
        print(f"  Instaladores en: {BOLD}{RELEASE_DIR}{RESET}\n")
        for f in sorted(os.listdir(RELEASE_DIR)):
            fp = os.path.join(RELEASE_DIR, f)
            size = os.path.getsize(fp)
            size_str = f"{size/1024/1024:.1f} MB" if size > 1024*1024 else f"{size/1024:.0f} KB"
            print(f"    📦  {f:55s} {size_str}")
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

    # Build gh command
    cmd = [
        "gh", "release", "create", tag,
        "--title", title,
        "--notes", body,
    ]
    if is_pre:
        cmd.append("--prerelease")
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

def generate_update_manifests(version, date, channel="stable", notes=""):
    """Genera update-{channel}.json con todas las plataformas disponibles en releases/.

    Firma cada artefacto con la clave privada del canal si está disponible.
    Se llama automáticamente al final de cmd_release.
    """
    step(f"Generando manifiesto de actualización → {channel}")

    import json as _json

    # Collect built artifacts from RELEASE_DIR
    # Expected filenames (from create_unix_installer / create_windows_installer):
    #   tsuki-{version}-{platform}.tar.gz      (Linux / macOS)
    #   tsuki-Setup-{version}-{platform}.exe   (Windows)
    platforms = {}

    if os.path.isdir(RELEASE_DIR):
        for fname in sorted(os.listdir(RELEASE_DIR)):
            fpath = os.path.join(RELEASE_DIR, fname)
            if not os.path.isfile(fpath):
                continue
            # Skip the manifest files themselves
            if fname.startswith("update-") and fname.endswith(".json"):
                continue

            # Determine platform key from filename
            pk = None
            for candidate in PLATFORMS:
                if candidate in fname:
                    pk = candidate
                    break
            if pk is None:
                continue

            asset_url = f"{GITHUB_RELEASES_BASE}/v{version}/{fname}"
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

    manifest_path = UPDATE_MANIFEST_STABLE if channel == "stable" else UPDATE_MANIFEST_TESTING
    with open(manifest_path, "w", encoding="utf-8") as f:
        _json.dump(manifest, f, indent=2, ensure_ascii=False)

    info(f"Manifiesto escrito → {os.path.basename(manifest_path)}")
    for pk, asset in platforms.items():
        signed = "✓ firmado" if asset["signature"] else "⚠ sin firma"
        sz = f"{asset['size'] / 1024 / 1024:.1f} MB" if asset['size'] > 0 else "?"
        info(f"  {pk:20s}  {sz:8s}  {signed}")

    return manifest_path

def cmd_release(forced_version, channel="stable", notes="", no_publish=False):
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
    print(f"  Canal   : {BOLD}{channel}{RESET}\n")

    _build_platforms(list(PLATFORMS.keys()), version, commit, date)
    _print_summary(version)

    # Generate update manifests and sign artifacts
    manifest_path = generate_update_manifests(version, date, channel=channel, notes=notes)

    # Publish to GitHub Releases — the web API reads it automatically, no commits needed
    if not no_publish:
        publish_github_release(version, channel, notes, manifest_path)
    else:
        warn("--no-publish: artefactos generados pero GitHub Release omitida.")

    print()
    info(f"Release {version} ({channel}) lista.")
    info(f"La web tsuki.sh/api/update/{channel} detectará la nueva version en ~5 min.")


def main():
    command, forced_version, deep_clean, quick, channel, notes, no_publish = parse_command()

    if command == "clean":
        cmd_clean(deep=deep_clean)
    elif command == "release":
        cmd_release(forced_version, channel=channel, notes=notes, no_publish=no_publish)
    elif command == "gen-keys":
        cmd_gen_keys()
    elif command == "show-keys":
        cmd_show_keys()
    else:
        cmd_dev(forced_version, quick=quick)


if __name__ == "__main__":
    main()