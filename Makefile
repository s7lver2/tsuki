# ─────────────────────────────────────────────────────────────────────────────
# godotino — Makefile
# Builds the Go CLI + optional Rust core, and installs both.
#
# Usage:
#   make            — build CLI binary
#   make install    — build + install to /usr/local/bin
#   make build-core — build the Rust core binary
#   make all        — build CLI + core + install + configure
#   make release    — cross-compile for Linux, macOS, Windows
#   make clean      — remove build artifacts
#   make test       — run Go unit tests
#   make lint       — run golangci-lint
#   make uninstall  — remove installed binaries
# ─────────────────────────────────────────────────────────────────────────────

# ── OS Detection ────────────────────────────────────────────────────────────
OS := $(shell uname -s)
ifeq ($(OS),Linux)
    # Proceed with Linux settings
else
    $(error This Makefile is optimized for Linux. For Windows, use the Inno Setup installer.)
endif

# ── Variables ───────────────────────────────────────────────────────────────
BINARY      := tsuki
CORE_BINARY := tsuki-core
FLASH_BINARY:= tsuki-flash
MODULE      := github.com/tsuki/cli
VERSION     := $(shell git describe --tags --always --dirty 2>/dev/null || echo "0.1.0")
COMMIT      := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
DATE        := $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
GO          := go
GOFLAGS     := -trimpath
LDFLAGS     := -ldflags "-s -w \
  -X $(MODULE)/internal/cli.Version=$(VERSION) \
  -X $(MODULE)/internal/cli.Commit=$(COMMIT) \
  -X $(MODULE)/internal/cli.BuildDate=$(DATE)"
BUILD_DIR   := dist
C_BUILD_DIR := target/release
CLI_DIR     := cli/cmd/tsuki
CORE_DIR    := .  # path to Cargo.toml
LIBS_DIR    := /usr/share/tsuki-libs
PREFIX      := /usr/local
BINDIR      := $(PREFIX)/bin
SUDO        := $(shell which sudo || echo "")

# Cross-compile targets (Linux-focused, but includes others)
PLATFORMS   := \
  linux/amd64 \
  linux/arm64 \
  darwin/amd64 \
  darwin/arm64 \
  windows/amd64

# ── Default target ──────────────────────────────────────────────────────────
.PHONY: all
all: clean check-deps install-arduino build build-core install-all configure  ## Build CLI and Rust core + install + configure

# ── Dependencies Check ──────────────────────────────────────────────────────
.PHONY: check-deps
check-deps: ## Verify required tools (Go, Cargo, etc.)
	@echo "  CHECK     Dependencies"
	@command -v $(GO) >/dev/null 2>&1 || { echo "ERROR: Go not found"; exit 1; }
	@command -v cargo >/dev/null 2>&1 || { echo "ERROR: Cargo (Rust) not found"; exit 1; }
	@echo "  ✓ All dependencies OK"

# ── Install Arduino ─────────────────────────────────────────────────────────
.PHONY: install-arduino
install-arduino: ## Install Arduino CLI (prefer system package, fallback to download)
	@echo "  INSTALL   Arduino CLI"
	@if command -v arduino-cli >/dev/null 2>&1; then \
		echo "  ✓ Arduino CLI already installed"; \
	else \
		if command -v apt >/dev/null 2>&1; then \
			echo "  Using apt to install..."; \
			$(SUDO) apt update && $(SUDO) apt install -y arduino-cli || { echo "ERROR: apt install failed"; exit 1; }; \
		else \
			echo "  Downloading Arduino CLI..."; \
			curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh || { echo "ERROR: Download failed"; exit 1; }; \
			$(SUDO) mv bin/arduino-cli $(BINDIR)/arduino-cli || { echo "ERROR: Move failed"; exit 1; }; \
		fi; \
	fi
	@arduino-cli version || { echo "ERROR: Arduino CLI verification failed"; exit 1; }

# ── Build ───────────────────────────────────────────────────────────────────
.PHONY: build
build: $(BUILD_DIR)/$(BINARY)  ## Build the tsuki CLI binary
$(BUILD_DIR)/$(BINARY): cli/go.mod cli/go.sum $(shell find cli -name '*.go')
	@mkdir -p $(BUILD_DIR) || { echo "ERROR: mkdir failed"; exit 1; }
	@echo "  GO BUILD  $(BINARY) $(VERSION)"
	@cd cli && $(GO) build $(GOFLAGS) $(LDFLAGS) -o ../$(BUILD_DIR)/$(BINARY) ./cmd/tsuki || { echo "ERROR: Go build failed"; exit 1; }
	@echo "  OK        $(BUILD_DIR)/$(BINARY)"

.PHONY: build-core
build-core:  ## Build the tsuki-core Rust binary
	@echo "  CARGO BUILD  tsuki-core"
	@cd $(CORE_DIR) && cargo build --release || { echo "ERROR: Cargo build failed"; exit 1; }
	@mkdir -p $(BUILD_DIR)
	@cp $(CORE_DIR)/$(C_BUILD_DIR)/$(CORE_BINARY) $(BUILD_DIR)/$(CORE_BINARY) || { echo "ERROR: Copy failed"; exit 1; }
	@cp $(CORE_DIR)/$(C_BUILD_DIR)/$(FLASH_BINARY) $(BUILD_DIR)/$(FLASH_BINARY) || { echo "ERROR: Copy failed"; exit 1; }
	@echo "  OK  $(BUILD_DIR)/$(CORE_BINARY)"

# ── Install ─────────────────────────────────────────────────────────────────
.PHONY: install
install: build  ## Install tsuki CLI to $(BINDIR)
	@echo "  INSTALL   $(BINDIR)/$(BINARY)"
	@$(SUDO) install -d $(BINDIR) || { echo "ERROR: install -d failed"; exit 1; }
	@$(SUDO) install -m 0755 $(BUILD_DIR)/$(BINARY) $(BINDIR)/$(BINARY) || { echo "ERROR: install failed"; exit 1; }
	@echo "  ✓ tsuki installed to $(BINDIR)/$(BINARY)"
	@echo "    Run: tsuki --help"

.PHONY: install-all
install-all: build build-core  ## Install CLI + core to $(BINDIR)
	@$(MAKE) install
	@echo "  INSTALL   $(BINDIR)/$(CORE_BINARY)"
	@$(SUDO) install -m 0755 $(C_BUILD_DIR)/$(CORE_BINARY) $(BINDIR)/$(CORE_BINARY) || { echo "ERROR: install failed"; exit 1; }
	@$(SUDO) install -m 0755 $(C_BUILD_DIR)/$(FLASH_BINARY) $(BINDIR)/$(FLASH_BINARY) || { echo "ERROR: install failed"; exit 1; }
	@echo "  ✓ tsuki-core installed to $(BINDIR)/$(CORE_BINARY)"

.PHONY: uninstall
uninstall:  ## Remove installed binaries
	@$(SUDO) rm -f $(BINDIR)/$(BINARY) $(BINDIR)/$(CORE_BINARY) $(BINDIR)/$(FLASH_BINARY) || { echo "ERROR: uninstall failed"; exit 1; }
	@echo "  ✓ Uninstalled"

.PHONY: configure
configure:
	@tsuki config set libs_dir "$(LIBS_DIR)" || { echo "ERROR: config failed"; exit 1; }
	@tsuki config set core_binary $(BINDIR)/$(CORE_BINARY) || { echo "ERROR: config failed"; exit 1; }
	@tsuki config set registry_url "https://raw.githubusercontent.com/s7lver2/tsuki/refs/heads/main/pkg/packages.json" || { echo "ERROR: config failed"; exit 1; }

# ── Release ─────────────────────────────────────────────────────────────────
.PHONY: release
release:  ## Cross-compile for all platforms into dist/
	@mkdir -p $(BUILD_DIR)
	@for platform in $(PLATFORMS); do \
	  GOOS=$$(echo $$platform | cut -d/ -f1); \
	  GOARCH=$$(echo $$platform | cut -d/ -f2); \
	  OUTPUT=$(BUILD_DIR)/$(BINARY)-$$GOOS-$$GOARCH; \
	  if [ "$$GOOS" = "windows" ]; then OUTPUT=$$OUTPUT.exe; fi; \
	  echo "  CROSS     $$GOOS/$$GOARCH  →  $$OUTPUT"; \
	  cd cli && GOOS=$$GOOS GOARCH=$$GOARCH $(GO) build $(GOFLAGS) $(LDFLAGS) -o ../$$OUTPUT ./cmd/tsuki || exit 1; \
	done
	@echo "  ✓ Release binaries in $(BUILD_DIR)/"

# ── Dev tools ───────────────────────────────────────────────────────────────
.PHONY: test
test:  ## Run unit tests
	cd cli && $(GO) test ./... -v -count=1

.PHONY: lint
lint:  ## Run golangci-lint
	@command -v golangci-lint >/dev/null 2>&1 || { echo "ERROR: golangci-lint not found — install: https://golangci-lint.run/usage/install/"; exit 1; }
	cd cli && golangci-lint run ./...

.PHONY: clean
clean:  ## Remove build artifacts
	@rm -rf $(BUILD_DIR)
	@echo "  ✓ Cleaned"

# ── Help ────────────────────────────────────────────────────────────────────
.PHONY: help
help:  ## Show this help
	@echo "  tsuki Makefile — $(VERSION)"
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'