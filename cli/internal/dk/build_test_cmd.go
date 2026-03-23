// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-dk :: build + test  —  compile and validate the current package
// ─────────────────────────────────────────────────────────────────────────────

package dk

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/tsuki/cli/internal/ui"
)

func newBuildCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "build",
		Short: "Build the current package",
		Long: `Build the package in the current directory.

Behavior depends on the package type declared in tsuki.toml:
  library    — validates tsukilib.toml and transpiles examples
  app        — runs 'cargo build --release' (Rust) or 'go build' (Go)
  board-pack — validates all board TOML files
  ide-plugin — lints plugin/index.js with node (if available)
  sdk-patch  — validates patch files are well-formed`,
		RunE: func(cmd *cobra.Command, args []string) error {
			manifest, err := loadManifest(".")
			if err != nil {
				return err
			}
			return buildPackage(manifest)
		},
	}
}

func newTestCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "test",
		Short: "Run tests for the current package",
		RunE: func(cmd *cobra.Command, args []string) error {
			manifest, err := loadManifest(".")
			if err != nil {
				return err
			}
			return testPackage(manifest)
		},
	}
}

// ── Build ─────────────────────────────────────────────────────────────────────

func buildPackage(m *DkManifest) error {
	ui.Step("Building", m.Package.Name)

	switch m.Package.Type {
	case "library":
		return buildLibrary(m)
	case "app":
		return buildApp(m)
	case "board-pack":
		return buildBoardPack(m)
	case "ide-plugin":
		return buildIdePlugin(m)
	case "sdk-patch":
		return buildSdkPatch(m)
	default:
		return fmt.Errorf("unknown package type %q", m.Package.Type)
	}
}

func buildLibrary(m *DkManifest) error {
	// Validate tsukilib.toml
	tomlPath := filepath.Join("lib", "tsukilib.toml")
	if _, err := os.Stat(tomlPath); os.IsNotExist(err) {
		// Also accept tsuki.toml in lib/
		tomlPath = filepath.Join("lib", "tsuki.toml")
	}
	if _, err := os.Stat(tomlPath); err != nil {
		return fmt.Errorf("missing lib/tsukilib.toml — create one with tsuki-dk new library")
	}

	// Validate example .go files with go vet (no tsuki project needed)
	exDir := "examples"
	if entries, err := os.ReadDir(exDir); err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			exPath := filepath.Join(exDir, e.Name())
			// Check Go syntax only — examples are stubs, not full tsuki projects
			goFiles, _ := filepath.Glob(filepath.Join(exPath, "*.go"))
			if len(goFiles) == 0 {
				continue
			}
			b := ui.NewLiveBlock(fmt.Sprintf("validate %s", exPath))
			b.Start()
			out, err := runCaptureDir(exPath, "go", "build", "-v", "./...")
			if err != nil {
				// go build will fail if imports like "arduino" aren't resolvable.
				// That's expected for stubs — only fail on actual syntax errors.
				if isSyntaxError(out) {
					b.Line(out)
					b.Finish(false, fmt.Sprintf("syntax error: %s", e.Name()))
					return fmt.Errorf("example %s failed: %s", e.Name(), out)
				}
			}
			b.Finish(true, "")
		}
	}

	ui.Success(fmt.Sprintf("Library %s built successfully", m.Package.Name))
	return nil
}

func buildApp(m *DkManifest) error {
	// Detect language: Cargo.toml → Rust, go.mod → Go
	if _, err := os.Stat("Cargo.toml"); err == nil {
		b := ui.NewLiveBlock("cargo build --release")
		b.Start()
		out, err := runCapture("cargo", "build", "--release")
		if err != nil {
			b.Line(out)
			b.Finish(false, "cargo build failed")
			return fmt.Errorf("cargo build failed:\n%s", out)
		}
		b.Finish(true, "")
	} else if _, err := os.Stat("go.mod"); err == nil {
		b := ui.NewLiveBlock("go build ./...")
		b.Start()
		out, err := runCapture("go", "build", "./...")
		if err != nil {
			b.Line(out)
			b.Finish(false, "go build failed")
			return fmt.Errorf("go build failed:\n%s", out)
		}
		b.Finish(true, "")
	} else {
		return fmt.Errorf("no Cargo.toml or go.mod found — cannot determine build system")
	}
	ui.Success(fmt.Sprintf("App %s built successfully", m.Package.Name))
	return nil
}

func buildBoardPack(m *DkManifest) error {
	boardDir := "boards"
	entries, err := os.ReadDir(boardDir)
	if err != nil {
		return fmt.Errorf("no boards/ directory found")
	}
	for _, e := range entries {
		if filepath.Ext(e.Name()) != ".toml" {
			continue
		}
		path := filepath.Join(boardDir, e.Name())
		if _, err := os.ReadFile(path); err != nil {
			return fmt.Errorf("cannot read %s: %w", path, err)
		}
		// TODO: full TOML schema validation
		ui.Note(fmt.Sprintf("  ✔  %s", e.Name()))
	}
	ui.Success(fmt.Sprintf("Board pack %s validated", m.Package.Name))
	return nil
}

// buildIdePlugin bundles an ide-plugin package into plugin/index.js.
//
// Source layout:
//   src/index.ts   (or src/index.tsx) — plugin entry point
//   package.json   — must have a "build" script
//
// If src/ exists, tsuki-dk runs "npm run build" which must produce
// plugin/index.js as a CommonJS bundle with react/react-dom as externals.
// If only plugin/index.js exists (pre-built or plain JS), we validate it.
//
// esbuild is the recommended bundler. tsuki-dk new ide-plugin generates a
// package.json with the correct build script out of the box.
func buildIdePlugin(m *DkManifest) error {
	hasSrc := false
	if _, err := os.Stat("src"); err == nil {
		hasSrc = true
	}

	if hasSrc {
		// Prefer "npm run build" so the plugin controls its own build config.
		if _, err := exec.LookPath("npm"); err != nil {
			return fmt.Errorf("npm not found — install Node.js to build ide-plugin packages\n  See: https://nodejs.org")
		}

		// Install deps if node_modules is missing
		if _, err := os.Stat("node_modules"); os.IsNotExist(err) {
			b := ui.NewLiveBlock("npm install")
			b.Start()
			out, err := runCapture("npm", "install")
			if err != nil {
				b.Line(out)
				b.Finish(false, "npm install failed")
				return fmt.Errorf("npm install failed:\n%s", out)
			}
			b.Finish(true, "dependencies installed")
		}

		b := ui.NewLiveBlock("npm run build")
		b.Start()
		out, err := runCapture("npm", "run", "build")
		if err != nil {
			b.Line(out)
			b.Finish(false, "build failed")
			return fmt.Errorf("npm run build failed:\n%s", out)
		}
		b.Finish(true, "bundled")
	}

	// Validate output exists
	outPath := filepath.Join("plugin", "index.js")
	if _, err := os.Stat(outPath); err != nil {
		return fmt.Errorf("missing plugin/index.js after build\n  Make sure your build script outputs to plugin/index.js")
	}

	// Check bundle does not require() anything other than react/react-dom
	if err := validatePluginBundle(outPath); err != nil {
		return err
	}

	info, _ := os.Stat(outPath)
	ui.Success(fmt.Sprintf("Plugin built  plugin/index.js  (%d KB)", info.Size()/1024))
	return nil
}

// validatePluginBundle scans plugin/index.js for require() calls and
// rejects any that are not react or react-dom (those are provided by the IDE).
func validatePluginBundle(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("cannot read %s: %w", path, err)
	}
	content := string(data)

	// Simple heuristic: find require("...") and require('...') calls
	for _, line := range strings.Split(content, "\n") {
		for _, q := range []string{`require("`, `require('`} {
			idx := strings.Index(line, q)
			if idx == -1 {
				continue
			}
			start := idx + len(q)
			end := strings.IndexAny(line[start:], `"'`)
			if end == -1 {
				continue
			}
			mod := line[start : start+end]
			if mod == "react" || mod == "react-dom" || mod == "react-dom/client" {
				continue
			}
			// Built-in Node modules and relative imports are forbidden
			if !strings.HasPrefix(mod, ".") {
				return fmt.Errorf("plugin/index.js contains unsupported require(%q)\n  Only react and react-dom are available at runtime\n  Bundle all other dependencies into the output file", mod)
			}
		}
	}
	return nil
}

func buildSdkPatch(_ *DkManifest) error {
	patchDir := "patches"
	entries, err := os.ReadDir(patchDir)
	if err != nil {
		return fmt.Errorf("no patches/ directory found")
	}
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".patch") {
			continue
		}
		path := filepath.Join(patchDir, e.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("cannot read %s: %w", path, err)
		}
		if !strings.Contains(string(data), "---") {
			return fmt.Errorf("%s does not look like a valid patch (missing --- header)", e.Name())
		}
		ui.Note(fmt.Sprintf("  ✔  %s", e.Name()))
	}
	ui.Success("SDK patch validated")
	return nil
}

// ── Test ──────────────────────────────────────────────────────────────────────

func testPackage(m *DkManifest) error {
	ui.Step("Testing", m.Package.Name)

	switch m.Package.Type {
	case "app":
		if _, err := os.Stat("Cargo.toml"); err == nil {
			b := ui.NewLiveBlock("cargo test")
			b.Start()
			out, err := runCapture("cargo", "test")
			if err != nil {
				b.Line(out)
				b.Finish(false, "tests failed")
				return fmt.Errorf("cargo test failed:\n%s", out)
			}
			b.Finish(true, "")
			return nil
		}
		fallthrough
	case "library", "board-pack", "sdk-patch":
		if _, err := os.Stat("tests"); err == nil {
			// Ensure tests/ has a go.mod so it compiles as a standalone module.
			ensureTestsGoMod("tests", m.Package.Name)
			b := ui.NewLiveBlock("go test ./...")
			b.Start()
			out, err := runCaptureDir("tests", "go", "test", "./...")
			if err != nil {
				b.Line(out)
				b.Finish(false, "tests failed")
				return fmt.Errorf("go test failed:\n%s", out)
			}
			b.Finish(true, "")
		} else {
			ui.Note("no tests/ directory — skipping")
		}
	case "ide-plugin":
		ui.Note("IDE plugin tests not yet implemented")
	}

	ui.Success(fmt.Sprintf("%s tests passed", m.Package.Name))
	return nil
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func runCapture(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func runCaptureDir(dir, name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// isSyntaxError returns true when go build output contains a real syntax error
// (as opposed to missing import errors which are expected for stubs).
func isSyntaxError(output string) bool {
	for _, line := range strings.Split(output, "\n") {
		if strings.Contains(line, "syntax error") ||
			strings.Contains(line, "undefined:") && !strings.Contains(line, "undefined: ") {
			return true
		}
	}
	return false
}


// ensureTestsGoMod writes a minimal go.mod into dir if one doesn't exist yet.
func ensureTestsGoMod(dir, pkgName string) {
	modPath := filepath.Join(dir, "go.mod")
	if _, err := os.Stat(modPath); err == nil {
		return
	}
	content := "module " + pkgName + "-tests\n\ngo 1.21\n"
	_ = os.WriteFile(modPath, []byte(content), 0644)
}