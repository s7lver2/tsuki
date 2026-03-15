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
PUBLISHER      = "tsuki Team"
PUBLISHER_URL  = "https://github.com/s7lver/tsuki"
OTHER_RESIDUAL_DIRS = [
  f"{PROJECT_ROOT}/target",
  f"{PROJECT_ROOT}/dist",
  f"{PROJECT_ROOT}/bin",
  f"{PROJECT_ROOT}/ide/src-tauri/target",
]

PLATFORMS = {
    "linux-amd64":   {"goos": "linux",   "goarch": "amd64", "rust_target": "x86_64-unknown-linux-gnu"},
    "linux-arm64":   {"goos": "linux",   "goarch": "arm64", "rust_target": "aarch64-unknown-linux-gnu"},
    "windows-amd64": {"goos": "windows", "goarch": "amd64", "rust_target": "x86_64-pc-windows-msvc"},
    "darwin-amd64":  {"goos": "darwin",  "goarch": "amd64", "rust_target": "x86_64-apple-darwin"},
    "darwin-arm64":  {"goos": "darwin",  "goarch": "arm64", "rust_target": "aarch64-apple-darwin"},
}

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

def run(cmd, cwd=None, env=None, check=True):
    """Ejecuta un comando mostrando los argumentos."""
    display = " ".join(str(c) for c in cmd)
    print(f"  $ {display}")
    result = subprocess.run(cmd, cwd=cwd, env=env, check=check,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if result.stdout.strip():
        for line in result.stdout.strip().splitlines()[-8:]:
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

def get_version(forced=None):
    if forced:
        return forced, "manual", datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        v = subprocess.check_output(
            ["git", "describe", "--tags", "--always", "--dirty"],
            cwd=PROJECT_ROOT, stderr=subprocess.DEVNULL).decode().strip() or "0.1.0"
        c = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=PROJECT_ROOT, stderr=subprocess.DEVNULL).decode().strip()
    except Exception:
        v, c = "0.1.0", "unknown"
    d = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return v, c, d

def clean():
    step("Limpiando directorios de build")
    question = input("Do you want to remove all cache dirs? N/y")
    if question == "y" or question == "y":
      # Normal Directory Cleaning process
      for d in [BUILD_DIR, RELEASE_DIR]:
        if os.path.exists(d):
            shutil.rmtree(d)
      # Second Search Phase
      for d in OTHER_RESIDUAL_DIRS:
        if os.path.exists(d):
          shutil.rmtree(d)
      subprocess.run(["cargo", "clean"], text=True)
    else:
      for d in [BUILD_DIR, RELEASE_DIR]:
        if os.path.exists(d):
            shutil.rmtree(d)
    os.makedirs(d)
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

def build_rust(platform_key):
    """Compila los binarios Rust para el host nativo.

    Si platform_key no coincide con el host, devuelve None, None
    y emite un aviso en lugar de fallar. Cross-compilar Rust requiere
    toolchains adicionales (linker de la plataforma objetivo).
    """
    if platform_key != HOST_PLATFORM:
        warn(
            f"Rust omitido para {platform_key} "
            f"(host={HOST_PLATFORM}). "
            f"Cross-compilar Rust requiere instalar el linker de la "
            f"plataforma objetivo (ej. mingw-w64, aarch64-linux-gnu-gcc). "
            f"Ejecuta el build en la máquina objetivo para obtener esos binarios."
        )
        return None, None

    step(f"Compilando Rust binarios → {platform_key} (nativo)")
    plat = PLATFORMS[platform_key]
    ext  = ".exe" if plat["goos"] == "windows" else ""

    # Sin --target: cargo compila para el host desde el crate flash/
    run(["cargo", "build", "--release"], cwd=FLASH_DIR)

    results = []
    for name in [CORE_BINARY, FLASH_BINARY]:
        src_path = os.path.join(FLASH_DIR, "target", "release", f"{name}{ext}")
        dst_path = os.path.join(BUILD_DIR, f"{name}-{platform_key}{ext}")
        shutil.copy(src_path, dst_path)
        info(f"Rust binary → {os.path.basename(dst_path)}")
        results.append(dst_path)
    return results[0], results[1]

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

    run([npm, "install"], cwd=IDE_DIR)
    run([npm, "run", "tauri", "build", "--", "--target", rust_target], cwd=IDE_DIR)

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
; Requiere privilegios de administrador para instalar en Program Files
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=@@release_dir@@
OutputBaseFilename=@@app_name@@-Setup-@@version@@-windows-amd64
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
      ValueType: string; ValueName: "CoreBinary"; ValueData: "{app}\bin\@@core_binary@@.exe"; \
      Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\@@app_name@@"; \
      ValueType: string; ValueName: "FlashBinary"; ValueData: "{app}\bin\@@flash_binary@@.exe"; \
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
Filename: "{app}\\bin\\@@binary@@.exe"; \
    Parameters: "config init --libs-dir {{app}}\libs --registry @@registry_url@@"; \
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
  AdvancedPage:         TWizardPage;
  // Registro
  lblRegistry:          TLabel;
  edRegistry:           TEdit;
  // Directorio de librerías
  lblLibsDir:           TLabel;
  edLibsDir:            TEdit;
  btnLibsDir:           TButton;
  // Directorio de configuración
  lblConfDir:           TLabel;
  edConfDir:            TEdit;
  btnConfDir:           TButton;
  // Opciones extra
  chkAutoUpdate:        TCheckBox;
  chkSendTelemetry:     TCheckBox;
  chkBackupConfig:      TCheckBox;
  chkStartWithWindows:  TCheckBox;
  // Página de herramientas externas
  ToolsPage:            TWizardPage;
  chkAvrdude:           TCheckBox;
  chkEsptool:           TCheckBox;
  chkArduinoCli:        TCheckBox;
  lblToolsNote:         TLabel;
  // Página de información de licencia post-instalación
  SummaryPage:          TWizardPage;
  lblSummary:           TLabel;

// ─── Helper: Browse Folder ────────────────────────────────────────
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

// ─── Crear páginas personalizadas ─────────────────────────────────
procedure InitializeWizard;
var
  y: Integer;
begin
  // ── Página: Configuración Avanzada ────────────────────────────
  AdvancedPage := CreateCustomPage(
    wpSelectComponents,
    'Configuración Avanzada',
    'Ajusta las rutas y opciones de @@app_name@@'
  );

  y := 8;
  // Registro
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
  // Directorio de librerías
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
  // Directorio de config
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
  // Opciones extra
  chkAutoUpdate := TCheckBox.Create(AdvancedPage);
  chkAutoUpdate.Parent  := AdvancedPage.Surface;
  chkAutoUpdate.Top     := y;  chkAutoUpdate.Left := 0;
  chkAutoUpdate.Width   := AdvancedPage.SurfaceWidth;
  chkAutoUpdate.Caption := 'Buscar actualizaciones automáticamente al iniciar';
  chkAutoUpdate.Checked := True;

  y := y + 22;
  chkSendTelemetry := TCheckBox.Create(AdvancedPage);
  chkSendTelemetry.Parent  := AdvancedPage.Surface;
  chkSendTelemetry.Top     := y;  chkSendTelemetry.Left := 0;
  chkSendTelemetry.Width   := AdvancedPage.SurfaceWidth;
  chkSendTelemetry.Caption := 'Enviar telemetría anónima para mejorar @@app_name@@ (opcional)';
  chkSendTelemetry.Checked := False;

  y := y + 22;
  chkBackupConfig := TCheckBox.Create(AdvancedPage);
  chkBackupConfig.Parent  := AdvancedPage.Surface;
  chkBackupConfig.Top     := y;  chkBackupConfig.Left := 0;
  chkBackupConfig.Width   := AdvancedPage.SurfaceWidth;
  chkBackupConfig.Caption := 'Crear copia de seguridad de la configuración anterior (si existe)';
  chkBackupConfig.Checked := True;

  y := y + 22;
  chkStartWithWindows := TCheckBox.Create(AdvancedPage);
  chkStartWithWindows.Parent  := AdvancedPage.Surface;
  chkStartWithWindows.Top     := y;  chkStartWithWindows.Left := 0;
  chkStartWithWindows.Width   := AdvancedPage.SurfaceWidth;
  chkStartWithWindows.Caption := 'Iniciar @@app_name@@ IDE al arrancar Windows';
  chkStartWithWindows.Checked := False;

  // ── Página: Herramientas Externas ─────────────────────────────
  ToolsPage := CreateCustomPage(
    AdvancedPage.ID,
    'Herramientas Externas',
    'Configura herramientas adicionales para compilar y flashear Arduino'
  );

  y := 8;
  lblToolsNote := TLabel.Create(ToolsPage);
  lblToolsNote.Parent   := ToolsPage.Surface;
  lblToolsNote.Caption  := 'Selecciona las herramientas que deseas descargar e instalar:';
  lblToolsNote.Top      := y;  lblToolsNote.Left := 0;
  lblToolsNote.AutoSize := True;

  y := y + 22;
  chkAvrdude := TCheckBox.Create(ToolsPage);
  chkAvrdude.Parent  := ToolsPage.Surface;
  chkAvrdude.Top     := y;  chkAvrdude.Left := 0;
  chkAvrdude.Width   := ToolsPage.SurfaceWidth;
  chkAvrdude.Caption := 'avrdude — Flashear Arduino UNO/MEGA/Leonardo (recomendado)';
  chkAvrdude.Checked := True;

  y := y + 22;
  chkEsptool := TCheckBox.Create(ToolsPage);
  chkEsptool.Parent  := ToolsPage.Surface;
  chkEsptool.Top     := y;  chkEsptool.Left := 0;
  chkEsptool.Width   := ToolsPage.SurfaceWidth;
  chkEsptool.Caption := 'esptool — Flashear ESP32 / ESP8266';
  chkEsptool.Checked := False;

  y := y + 22;
  chkArduinoCli := TCheckBox.Create(ToolsPage);
  chkArduinoCli.Parent  := ToolsPage.Surface;
  chkArduinoCli.Top     := y;  chkArduinoCli.Left := 0;
  chkArduinoCli.Width   := ToolsPage.SurfaceWidth;
  chkArduinoCli.Caption := 'arduino-cli — Compilación con soporte oficial Arduino';
  chkArduinoCli.Checked := False;

  // ── Página de Resumen ─────────────────────────────────────────
  SummaryPage := CreateCustomPage(
    ToolsPage.ID,
    'Resumen de instalación',
    'Revisa tu configuración antes de instalar'
  );

  lblSummary := TLabel.Create(SummaryPage);
  lblSummary.Parent   := SummaryPage.Surface;
  lblSummary.Caption  := '';
  lblSummary.Top      := 0;  lblSummary.Left := 0;
  lblSummary.Width    := SummaryPage.SurfaceWidth;
  lblSummary.Height   := SummaryPage.SurfaceHeight;
  lblSummary.WordWrap := True;
end;

// ─── Actualizar resumen al llegar a esa página ─────────────────────
procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = SummaryPage.ID then
  begin
    lblSummary.Caption :=
      'Configuración seleccionada:' + #13#10 +
      '─────────────────────────────────────' + #13#10 +
      'Directorio de instalación : ' + ExpandConstant('{app}') + #13#10 +
      'Directorio de librerías   : ' + edLibsDir.Text + #13#10 +
      'Directorio de config      : ' + edConfDir.Text + #13#10 +
      'Registro de paquetes      : ' + edRegistry.Text + #13#10 +
      '─────────────────────────────────────' + #13#10 +
      'Auto-actualizar           : ' + BoolStr(chkAutoUpdate.Checked, 'Sí', 'No') + #13#10 +
      'Telemetría anónima        : ' + BoolStr(chkSendTelemetry.Checked, 'Sí', 'No') + #13#10 +
      'Backup configuración      : ' + BoolStr(chkBackupConfig.Checked, 'Sí', 'No') + #13#10 +
      'Iniciar con Windows       : ' + BoolStr(chkStartWithWindows.Checked, 'Sí', 'No') + #13#10 +
      '─────────────────────────────────────' + #13#10 +
      'avrdude                   : ' + BoolStr(chkAvrdude.Checked, 'Se instalará', 'No') + #13#10 +
      'esptool                   : ' + BoolStr(chkEsptool.Checked, 'Se instalará', 'No') + #13#10 +
      'arduino-cli               : ' + BoolStr(chkArduinoCli.Checked, 'Se instalará', 'No');
  end;
end;

// ─── Guardar config personalizada tras instalar ─────────────────────
procedure WriteSetting(const Key, Value: String);
begin
  RegWriteStringValue(HKCU, 'Software\\@@app_name@@', Key, Value);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigFile: String;
  Lines:      TStringList;
begin
  if CurStep = ssPostInstall then
  begin
    // Guardar en el registro
    WriteSetting('LibsDir',       edLibsDir.Text);
    WriteSetting('ConfigDir',     edConfDir.Text);
    WriteSetting('RegistryURL',   edRegistry.Text);
    WriteSetting('AutoUpdate',    BoolStr(chkAutoUpdate.Checked,    '1', '0'));
    WriteSetting('Telemetry',     BoolStr(chkSendTelemetry.Checked, '1', '0'));
    WriteSetting('InstallAvrdude',BoolStr(chkAvrdude.Checked,       '1', '0'));
    WriteSetting('InstallEsptool',BoolStr(chkEsptool.Checked,       '1', '0'));
    WriteSetting('InstallArduCli',BoolStr(chkArduinoCli.Checked,    '1', '0'));

    // Escribir config.toml inicial
    ForceDirectories(edConfDir.Text);
    ConfigFile := edConfDir.Text + '\\config.toml';
    Lines := TStringList.Create;
    try
      Lines.Add('[paths]');
      Lines.Add('libs_dir     = "' + edLibsDir.Text + '"');
      Lines.Add('core_binary  = "' + ExpandConstant('{app}\\bin\\@@core_binary@@.exe') + '"');
      Lines.Add('flash_binary = "' + ExpandConstant('{app}\\bin\\@@flash_binary@@.exe') + '"');
      Lines.Add('');
      Lines.Add('[registry]');
      Lines.Add('url = "' + edRegistry.Text + '"');
      Lines.Add('');
      Lines.Add('[features]');
      Lines.Add('auto_update = ' + BoolStr(chkAutoUpdate.Checked, 'true', 'false'));
      Lines.Add('telemetry   = ' + BoolStr(chkSendTelemetry.Checked, 'true', 'false'));
      Lines.SaveToFile(ConfigFile);
    finally
      Lines.Free;
    end;

    // Inicio con Windows (HKCU Run)
    if chkStartWithWindows.Checked then
      RegWriteStringValue(HKCU,
        'Software\\Microsoft\\Windows\\CurrentVersion\\Run',
        '@@app_name@@IDE',
        '"' + ExpandConstant('{app}\ide\@@ide_exe_name@@') + '"');
  end;
end;

// ─── Validación antes de proceder ──────────────────────────────────
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

// ─── Detectar si hay bundle de IDE disponible ───────────────────────
function HasIdeBundle: Boolean;
begin
  Result := DirExists(ExpandConstant('{app}\\ide'));
end;

// ─── Inicializar valores por defecto ───────────────────────────────
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
def create_windows_installer(go_bin, core_bin, flash_bin, version, ide_bundle_dir, ide_exe_name, numeric_version):
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
        "@@ide_exe_name@@": ide_exe_name or f"{APP_NAME}.exe",  # <-- añadir esta línea
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
#  MAIN
# ─────────────────────────────────────────────
def parse_args():
    p = argparse.ArgumentParser(description=f"Build system de {APP_NAME}")
    p.add_argument("--platform", choices=list(PLATFORMS.keys()),
                   help="Compilar solo para esta plataforma")
    p.add_argument("--skip-go",   action="store_true", help="Omitir build Go")
    p.add_argument("--skip-rust", action="store_true", help="Omitir build Rust")
    p.add_argument("--skip-ide",  action="store_true", help="Omitir build Tauri IDE")
    p.add_argument("--no-clean",  action="store_true", help="No limpiar dist/")
    p.add_argument("--version",   help="Forzar versión (e.g. 1.2.3)")
    return p.parse_args()


def main():
    args = parse_args()
    print(f"\n{BOLD}{CYAN}{'═'*55}")
    print(f"  {APP_NAME} Build System")
    print(f"{'═'*55}{RESET}\n")

    check_dependencies(args.skip_go, args.skip_rust, args.skip_ide)

    if not args.no_clean:
        clean()
    else:
        os.makedirs(BUILD_DIR, exist_ok=True)
        os.makedirs(RELEASE_DIR, exist_ok=True)

    version, commit, date = get_version(args.version)
    # versión visible (git)
    text_version = version            # ej: 2fb67f7-dirty
    numeric_version = "1.0.0.0"       # O algo automático
    print(f"\n  Versión : {BOLD}{version}{RESET}  |  Commit : {commit}  |  Fecha : {date}\n")

    target_platforms = [args.platform] if args.platform else list(PLATFORMS.keys())

    # Detectar plataforma host para Tauri (solo se puede compilar nativamente)
    host = platform.system().lower()
    host_arch = "amd64" if platform.machine() in ("x86_64", "AMD64") else "arm64"
    if host == "darwin":
        host_key = f"darwin-{host_arch}"
    elif host == "linux":
        host_key = f"linux-{host_arch}"
    else:
        host_key = f"windows-{host_arch}"

    results = {}  # platform_key → {go, core, flash}

    for pk in target_platforms:
        print(f"\n{BOLD}{'─'*55}\n  Plataforma: {pk}\n{'─'*55}{RESET}")

        try:
            go_bin      = None if args.skip_go   else build_go(pk, version, commit, date)
            core_bin, flash_bin = (None, None) if args.skip_rust else build_rust(pk)
            results[pk] = {"go": go_bin, "core": core_bin, "flash": flash_bin}
        except subprocess.CalledProcessError as e:
            error(f"Build fallido para {pk}: {e}")
            continue

        # Tauri IDE: solo para la plataforma host
        ide_bundle = None
        ide_exe_name = None  # <-- añadir
        if not args.skip_ide:
            if pk == host_key:
                try:
                    ide_bundle, ide_exe_name = build_tauri(pk, version)  # <-- desempaquetar tuple
                except Exception as e:
                    warn(f"Tauri IDE build falló: {e}")

        # Crear instalador.
        # Si Rust no compiló para esta plataforma (cross-compile omitido),
        # el instalador se crea igual pero sin los binarios Rust — se avisa al usuario.
        r = results[pk]
        missing_rust = r["core"] is None or r["flash"] is None
        if missing_rust and not args.skip_rust:
            warn(
                f"El instalador para {pk} no incluirá los binarios Rust "
                f"(tsuki-core, tsuki-flash) porque requieren cross-compilación. "
                f"Cópialos manualmente al directorio de instalación si los necesitas."
            )

        if r["go"] is None and r["core"] is None:
            warn(f"No hay ningún binario para {pk}, saltando instalador.")
            continue

        if "windows" in pk:
            # Para Windows solo creamos el instalador si tenemos los binarios Rust
            # (son necesarios para el funcionamiento de la app).
            if missing_rust:
                warn(f"Instalador Windows omitido para {pk}: faltan binarios Rust.")
            else:
                create_windows_installer(
                    go_bin=r["go"],
                    core_bin=r["core"],
                    flash_bin=r["flash"],
                    version=version,
                    ide_bundle_dir=ide_bundle,
                    ide_exe_name=ide_exe_name,   # <-- añadir
                    numeric_version=numeric_version,
                )
        else:
            if missing_rust:
                warn(f"Instalador Linux/macOS para {pk}: se creará sin tsuki-core/tsuki-flash.")
            create_unix_installer(pk,
                go_bin=r["go"],
                core_bin=r["core"],
                flash_bin=r["flash"],
                version=version,
            )

    # ── Resumen final ──────────────────────────────────────────────
    print(f"\n{BOLD}{GREEN}{'═'*55}")
    print(f"  ✓  Build completo — {APP_NAME} v{version}")
    print(f"{'═'*55}{RESET}\n")
    print(f"  Instaladores en: {BOLD}{RELEASE_DIR}{RESET}\n")
    for f in sorted(os.listdir(RELEASE_DIR)):
        size = os.path.getsize(os.path.join(RELEASE_DIR, f))
        size_str = f"{size/1024/1024:.1f} MB" if size > 1024*1024 else f"{size/1024:.0f} KB"
        print(f"    📦  {f:55s} {size_str}")
    print()


if __name__ == "__main__":
    main()