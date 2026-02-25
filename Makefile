# ─────────────────────────────────────────────────────────────────────────────
#  tsuki — Makefile
#  Builds the Go CLI + Rust core/flash, and installs both.
#
#  Usage:
#    make                  — build CLI binary
#    make install          — build + install to /usr/local/bin
#    make build-core       — build the Rust binaries (tsuki-core + tsuki-flash)
#    make all              — build CLI + core
#    make release          — cross-compile Go CLI for all platforms
#    make release-<target> — build Rust for a specific target (used by CI)
#                            targets: x86_64-linux  aarch64-linux
#                                     x86_64-windows x86_64-macos aarch64-macos
#    make push             — run `tsuki push` to publish a GitHub Release
#    make clean            — remove build artifacts
#    make test             — run Go unit tests + Rust tests
#    make lint             — run golangci-lint
#    make uninstall        — remove installed binaries
# ─────────────────────────────────────────────────────────────────────────────
# ── Variables ─────────────────────────────────────────────────────────────────
BINARY      := tsuki
CORE_BINARY := tsuki-core
FLASH_BINARY:= tsuki-flash
MODULE      := github.com/tsuki/cli
VERSION     := $(shell git describe --tags --always --dirty 2>/dev/null || echo "0.1.0")
COMMIT      := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
DATE        := $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
# Go build flags
GO          := go
GOFLAGS     := -trimpath
LDFLAGS     := -ldflags "-s -w \
  -X $(MODULE)/internal/cli.Version=$(VERSION) \
  -X $(MODULE)/internal/cli.Commit=$(COMMIT) \
  -X $(MODULE)/internal/cli.BuildDate=$(DATE)"
# Directories
BUILD_DIR   := dist
C_BUILD_DIR   := target/release
CLI_DIR     := cli/cmd/tsuki
CORE_DIR    := .  # path to Cargo.toml (relative to this Makefile)
LIBS_DIR := /usr/share
# Install prefix
PREFIX      := /usr/local
BINDIR      := $(PREFIX)/bin
# Cross-compile targets
PLATFORMS   := \
  linux/amd64 \
  linux/arm64 \
  darwin/amd64 \
  darwin/arm64 \
  windows/amd64
# ── Default target ────────────────────────────────────────────────────────────
.PHONY: all
all: clean install-arduino build build-core install-all configure  ## Build CLI and Rust core
# ── Dependences ───────────────────────────────────────────────────────────────
.PHONY: install-arduino
install-arduino: ## Install Arduino CLI locally
	@echo "  INSTALL   Arduino CLI"
	@if command -v arduino-cli >/dev/null 2>&1; then \
		echo "  ✓ Arduino CLI already installed"; \
	else \
		echo "  Downloading Arduino CLI..."; \
		curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh; \
		sudo mv bin/arduino-cli /usr/local/bin/arduino-cli; \
	fi
	@arduino-cli version
# ── Build ─────────────────────────────────────────────────────────────────────
.PHONY: build
build: $(BUILD_DIR)/$(BINARY)  ## Build the tsuki CLI binary
$(BUILD_DIR)/$(BINARY): cli/go.mod cli/go.sum $(shell find cli -name '*.go')
	@mkdir -p $(BUILD_DIR)
	@echo "  GO BUILD  $(BINARY) $(VERSION)"
	@cd cli && $(GO) build $(GOFLAGS) $(LDFLAGS) -o ../$(BUILD_DIR)/$(BINARY) ./cmd/tsuki
	@echo "  OK        $(BUILD_DIR)/$(BINARY)"
.PHONY: build-core
build-core:  ## Build the tsuki-core Rust binary
	@echo "  CARGO BUILD  tsuki-core"
	@cd $(CORE_DIR) && cargo build --release
	@mkdir -p $(BUILD_DIR)
	@cp $(CORE_DIR)/target/release/tsuki $(BUILD_DIR)/$(CORE_BINARY) 2>/dev/null || \
	   cp $(CORE_DIR)/target/release/tsuki.exe $(BUILD_DIR)/$(CORE_BINARY).exe 2>/dev/null || true
	@cp $(CORE_DIR)/target/release/tsuki-flash $(BUILD_DIR)/$(FLASH_BINARY) 2>/dev/null || \
	   cp $(CORE_DIR)/target/release/tsuki-flash.exe $(BUILD_DIR)/$(FLASH_BINARY).exe 2>/dev/null || true
	@echo "  OK  $(BUILD_DIR)/$(CORE_BINARY)"
# ── Install ───────────────────────────────────────────────────────────────────
.PHONY: install
install: build  ## Install tsuki CLI to $(BINDIR)
	@echo "  INSTALL   $(BINDIR)/$(BINARY)"
	@sudo install -d $(BINDIR)
	@sudo install -m 0755 $(BUILD_DIR)/$(BINARY) $(BINDIR)/$(BINARY)
	@echo "  ✓  tsuki installed to $(BINDIR)/$(BINARY)"
	@echo "     Run: tsuki --help"
.PHONY: install-all
install-all: build build-core  ## Install CLI + core to $(BINDIR)
	@$(MAKE) install
	@echo "  INSTALL   $(BINDIR)/$(CORE_BINARY)"
	@sudo install -m 0755 $(C_BUILD_DIR)/$(CORE_BINARY) $(BINDIR)/$(CORE_BINARY)
	@sudo install -m 0755 $(C_BUILD_DIR)/$(FLASH_BINARY) $(BINDIR)/$(FLASH_BINARY)
	@echo "  ✓  tsuki-core installed to $(BINDIR)/$(CORE_BINARY)"
	@echo "  ✓  Rembember to run tsuki config set core_binary $(BINDIR)/$(CORE_BINARY)"
.PHONY: install-user
install-user: build  ## Install tsuki CLI to ~/bin (no sudo)
	@mkdir -p $(HOME)/bin
	@cp $(BUILD_DIR)/$(BINARY) $(HOME)/bin/$(BINARY)
	@echo "  ✓  tsuki installed to ~/bin/$(BINARY)"
	@echo "     Make sure ~/bin is on your PATH:"
	@echo "       export PATH=\"\$$HOME/bin:\$$PATH\""
.PHONY: uninstall
uninstall:  ## Remove installed binaries
	@rm -f $(BINDIR)/$(BINARY) $(BINDIR)/$(CORE_BINARY)
	@echo "  ✓  Uninstalled"
.PHONY: configure
configure:
	@tsuki config set libs_dir "$(LIBS_DIR)/tsuki-libs"
	@tsuki config set core_binary $(BINDIR)/$(CORE_BINARY)
	@tsuki config set registry_url "https://raw.githubusercontent.com/s7lver2/tsuki/refs/heads/main/pkg/packages.json"
# ── Release (cross-compile) ───────────────────────────────────────────────────
.PHONY: release
release:  ## Cross-compile Go CLI for all platforms into dist/
	@mkdir -p $(BUILD_DIR)
	@for platform in $(PLATFORMS); do \
	  GOOS=$$(echo $$platform | cut -d/ -f1); \
	  GOARCH=$$(echo $$platform | cut -d/ -f2); \
	  OUTPUT=$(BUILD_DIR)/$(BINARY)-$$GOOS-$$GOARCH; \
	  if [ "$$GOOS" = "windows" ]; then OUTPUT=$$OUTPUT.exe; fi; \
	  echo "  CROSS     $$GOOS/$$GOARCH  →  $$OUTPUT"; \
	  cd cli && GOOS=$$GOOS GOARCH=$$GOARCH $(GO) build $(GOFLAGS) $(LDFLAGS) -o ../$$OUTPUT ./cmd/tsuki || exit 1; \
	done
	@echo ""
	@echo "  ✓  Release binaries in $(BUILD_DIR)/"
	@ls -lh $(BUILD_DIR)/$(BINARY)-* 2>/dev/null | awk '{print "     " $$NF " (" $$5 ")"}'

# ── Rust release targets (called by GitHub Actions) ───────────────────────────
# Cada target compila tsuki-core y tsuki-flash para una plataforma específica,
# empaqueta los binarios en dist/ y genera un .sha256.
# En CI, `cross` debe estar instalado para aarch64-linux.

RUST_TARGET_x86_64-linux   := x86_64-unknown-linux-gnu
RUST_TARGET_aarch64-linux  := aarch64-unknown-linux-gnu
RUST_TARGET_x86_64-windows := x86_64-pc-windows-msvc
RUST_TARGET_x86_64-macos   := x86_64-apple-darwin
RUST_TARGET_aarch64-macos  := aarch64-apple-darwin

# Uso: make release-x86_64-linux  /  make release-aarch64-linux  / etc.
release-%:
	$(eval TSUKI_TARGET := $*)
	$(eval RUST_TARGET  := $(RUST_TARGET_$(TSUKI_TARGET)))
	@test -n "$(RUST_TARGET)" || \
	  (echo "Target desconocido: $(TSUKI_TARGET). Válidos: x86_64-linux aarch64-linux x86_64-windows x86_64-macos aarch64-macos" && exit 1)
	@echo "  CARGO BUILD  $(RUST_TARGET)"
	@if echo "$(TSUKI_TARGET)" | grep -q "aarch64-linux"; then \
	  cross build --release --target $(RUST_TARGET); \
	else \
	  cargo build --release --target $(RUST_TARGET); \
	fi
	@mkdir -p $(BUILD_DIR)
	@EXT=""; \
	 if echo "$(TSUKI_TARGET)" | grep -q "windows"; then EXT=".exe"; fi; \
	 CORE_SRC=target/$(RUST_TARGET)/release/tsuki-core$$EXT; \
	 FLASH_SRC=target/$(RUST_TARGET)/release/tsuki-flash$$EXT; \
	 ARTIFACT=$(BUILD_DIR)/tsuki-$(TSUKI_TARGET)-$(VERSION); \
	 mkdir -p $$ARTIFACT; \
	 cp $$CORE_SRC  $$ARTIFACT/$(CORE_BINARY)$$EXT; \
	 cp $$FLASH_SRC $$ARTIFACT/$(FLASH_BINARY)$$EXT; \
	 cp README.md $$ARTIFACT/ 2>/dev/null || true; \
	 cp LICENSE   $$ARTIFACT/ 2>/dev/null || true; \
	 if echo "$(TSUKI_TARGET)" | grep -q "windows"; then \
	   cd $(BUILD_DIR) && zip -r tsuki-$(TSUKI_TARGET)-$(VERSION).zip tsuki-$(TSUKI_TARGET)-$(VERSION)/; \
	   sha256sum tsuki-$(TSUKI_TARGET)-$(VERSION).zip > tsuki-$(TSUKI_TARGET)-$(VERSION).zip.sha256; \
	 else \
	   cd $(BUILD_DIR) && tar czf tsuki-$(TSUKI_TARGET)-$(VERSION).tar.gz tsuki-$(TSUKI_TARGET)-$(VERSION)/; \
	   sha256sum tsuki-$(TSUKI_TARGET)-$(VERSION).tar.gz > tsuki-$(TSUKI_TARGET)-$(VERSION).tar.gz.sha256; \
	 fi
	@echo "  ✓  $(BUILD_DIR)/tsuki-$(TSUKI_TARGET)-$(VERSION)"

# ── Publish via tsuki push ────────────────────────────────────────────────────
.PHONY: push
push:  ## Publish a GitHub Release using `tsuki push` (requiere GITHUB_TOKEN)
	@command -v tsuki >/dev/null 2>&1 || { echo "tsuki CLI no encontrado — instala con: make install"; exit 1; }
	tsuki push

# ── Dev tools ─────────────────────────────────────────────────────────────────
.PHONY: deps
deps:  ## Download Go dependencies
	cd cli && $(GO) mod download
	cd cli && $(GO) mod tidy
.PHONY: test
test:  ## Run Go unit tests + Rust tests
	cd cli && $(GO) test ./... -v -count=1
	cargo test
.PHONY: test-short
test-short:  ## Run unit tests (skip slow tests)
	cd cli && $(GO) test ./... -short
.PHONY: lint
lint:  ## Run golangci-lint
	@command -v golangci-lint >/dev/null 2>&1 || { \
	  echo "golangci-lint not found — install: https://golangci-lint.run/usage/install/"; exit 1; }
	cd cli && golangci-lint run ./...
.PHONY: fmt
fmt:  ## Format Go source files
	cd cli && $(GO) fmt ./...
	@echo "  ✓  Formatted"
.PHONY: vet
vet:  ## Run go vet
	cd cli && $(GO) vet ./...
# ── Clean ─────────────────────────────────────────────────────────────────────
.PHONY: clean
clean:  ## Remove build artifacts
	@rm -rf $(BUILD_DIR)
	@echo "  ✓  Cleaned"
# ── Info ──────────────────────────────────────────────────────────────────────
.PHONY: help
help:  ## Show this help
	@echo ""
	@echo "  tsuki Makefile — $(VERSION)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@echo ""
.PHONY: info
info:  ## Print build info
	@echo "  Binary   : $(BINARY)"
	@echo "  Version  : $(VERSION)"
	@echo "  Commit   : $(COMMIT)"
	@echo "  Date     : $(DATE)"
	@echo "  BINDIR   : $(BINDIR)"
	@echo "  Go       : $(shell $(GO) version)"
.DEFAULT_GOAL := build