import { NextResponse } from "next/server";

const GITHUB_REPO = "s7lver/tsuki";

const script = `#!/usr/bin/env sh
# tsuki installer
# Usage: curl -fsSL https://tsuki.sh/install.sh | sh
# ─────────────────────────────────────────────────

set -e

GITHUB_REPO="${GITHUB_REPO}"
INSTALL_DIR="/usr/local/bin"
TSUKI_HOME="\$HOME/.tsuki"

# Colors
RED='\\033[0;31m'
GREEN='\\033[0;32m'
CYAN='\\033[0;36m'
BOLD='\\033[1m'
RESET='\\033[0m'

print_step() { printf "  \${CYAN}→\${RESET} %s\\n" "\$1"; }
print_ok()   { printf "  \${GREEN}✓\${RESET} %s\\n" "\$1"; }
print_err()  { printf "  \${RED}✗\${RESET} %s\\n" "\$1" >&2; exit 1; }

printf "\\n\${BOLD}  月 tsuki installer\${RESET}\\n"
printf "  ─────────────────────────\\n\\n"

# ── Detect OS ────────────────────────────────────────
OS="\$(uname -s 2>/dev/null || echo Unknown)"
ARCH="\$(uname -m 2>/dev/null || echo Unknown)"

case "\$OS" in
  Linux*)  OS_TYPE="linux"  ;;
  Darwin*) OS_TYPE="darwin" ;;
  MSYS*|MINGW*|CYGWIN*) OS_TYPE="windows" ;;
  *) print_err "Unsupported operating system: \$OS" ;;
esac

case "\$ARCH" in
  x86_64|amd64) ARCH_TYPE="amd64" ;;
  arm64|aarch64) ARCH_TYPE="arm64" ;;
  armv7l) ARCH_TYPE="armv7" ;;
  i386|i486|i586|i686) print_err "32-bit x86 is not supported — please use a 64-bit system." ;;
  *) print_err "Unsupported architecture: \$ARCH" ;;
esac

# On macOS, uname -m returns x86_64 even on Apple Silicon when the shell is
# running under Rosetta 2. Detect the native CPU via sysctl and switch to arm64
# so the correct native binary is installed instead of the amd64 one.
if [ "\$OS_TYPE" = "darwin" ] && [ "\$ARCH_TYPE" = "amd64" ]; then
  NATIVE_ARM64="\$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)"
  if [ "\$NATIVE_ARM64" = "1" ]; then
    ARCH_TYPE="arm64"
    print_step "Apple Silicon detected (Rosetta session — switching to arm64 binary)"
  fi
fi

print_step "Detected platform: \$OS_TYPE/\$ARCH_TYPE"

# ── Check dependencies ────────────────────────────────
if ! command -v curl >/dev/null 2>&1; then
  print_err "curl is required but not installed."
fi

# ── Fetch latest release ─────────────────────────────
print_step "Fetching latest release..."

LATEST="\$(curl -fsSL "https://api.github.com/repos/\$GITHUB_REPO/releases/latest" \\
  | grep '"tag_name"' \\
  | sed 's/.*"tag_name": *"\\(.*\\)".*/\\1/')"

if [ -z "\$LATEST" ]; then
  print_err "Could not determine latest release. Check your internet connection."
fi

print_ok "Latest version: \$LATEST"

# ── Download ─────────────────────────────────────────
EXT="tar.gz"
if [ "\$OS_TYPE" = "windows" ]; then EXT="zip"; fi

FILENAME="tsuki-\${OS_TYPE}-\${ARCH_TYPE}.\$EXT"
DOWNLOAD_URL="https://github.com/\$GITHUB_REPO/releases/download/\$LATEST/\$FILENAME"

print_step "Downloading tsuki \$LATEST..."

TMP_DIR="\$(mktemp -d)"
trap 'rm -rf "\$TMP_DIR"' EXIT INT TERM

curl -fsSL "\$DOWNLOAD_URL" -o "\$TMP_DIR/tsuki.\$EXT"

# ── Extract ───────────────────────────────────────────
print_step "Extracting..."

if [ "\$EXT" = "tar.gz" ]; then
  tar -xzf "\$TMP_DIR/tsuki.\$EXT" -C "\$TMP_DIR"
else
  unzip -q "\$TMP_DIR/tsuki.\$EXT" -d "\$TMP_DIR"
fi

chmod +x "\$TMP_DIR/tsuki"

# ── Install ───────────────────────────────────────────
print_step "Installing to \$INSTALL_DIR..."

mkdir -p "\$TSUKI_HOME/bin"

if [ -w "\$INSTALL_DIR" ]; then
  mv "\$TMP_DIR/tsuki" "\$INSTALL_DIR/tsuki"
  INSTALLED_AT="\$INSTALL_DIR/tsuki"
else
  if command -v sudo >/dev/null 2>&1; then
    sudo mv "\$TMP_DIR/tsuki" "\$INSTALL_DIR/tsuki"
    INSTALLED_AT="\$INSTALL_DIR/tsuki"
  else
    mv "\$TMP_DIR/tsuki" "\$TSUKI_HOME/bin/tsuki"
    INSTALLED_AT="\$TSUKI_HOME/bin/tsuki"
    printf "\\n  Note: Add \$TSUKI_HOME/bin to your PATH:\\n"
    printf "  export PATH=\\"\$PATH:\$TSUKI_HOME/bin\\"\\n\\n"
  fi
fi

# ── Done ──────────────────────────────────────────────
printf "\\n\${BOLD}\${GREEN}  tsuki \$LATEST installed successfully!\${RESET}\\n"
printf "  ─────────────────────────────────────\\n"
printf "  Run: \${BOLD}tsuki --help\${RESET}\\n"
printf "  Docs: https://tsuki.sh/docs\\n\\n"
`;

export async function GET() {
  return new NextResponse(script, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}