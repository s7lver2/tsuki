// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-dk :: sandbox  —  test the package in an isolated tsuki installation
//
//  Creates a clean tsuki environment in .tsuki-dk/sandbox/ with the current
//  package applied, then launches tsuki (or tsuki-ide) pointing at it.
//  The system installation is never touched.
// ─────────────────────────────────────────────────────────────────────────────

package dk

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/tsuki/cli/internal/ui"
)

const sandboxDir = ".tsuki-dk/sandbox"

func newSandboxCmd() *cobra.Command {
	var clean        bool
	var projectPath  string
	var buildFirst   bool
	var localIdePath string

	cmd := &cobra.Command{
		Use:   "sandbox",
		Short: "Test the package in an isolated tsuki environment",
		Long: `Launch a sandboxed tsuki that has this package installed.

The sandbox is created in .tsuki-dk/sandbox/ and is completely isolated
from your system tsuki installation. Perfect for testing IDE plugins,
SDK patches, and board packs before publishing.

On first run (or with --clean), the sandbox is bootstrapped by copying
the system tsuki binaries. Subsequent runs reuse the existing sandbox.

Pass --project to point at a plugin directory without cd-ing into it first.
Combined with --build, tsuki-dk will build the plugin before launching.

Pass --local-ide to use a local tsuki-ide source tree instead of the
system-installed binary. The IDE will be compiled (npm install + tauri build)
before the sandbox starts. Useful when developing IDE changes alongside a plugin.`,
		Example: `  tsuki-dk sandbox                                         # from inside a plugin dir
  tsuki-dk sandbox --project ./my-plugin                   # point at a dir directly
  tsuki-dk sandbox --project ./my-plugin --build            # build then sandbox
  tsuki-dk sandbox --local-ide ../tsuki-ide                 # use local IDE source
  tsuki-dk sandbox --local-ide ../tsuki-ide --build         # build plugin + local IDE`,
		RunE: func(cmd *cobra.Command, args []string) error {
			// If --project was given, change working directory to that path.
			// Everything that follows (loadManifest, sandboxDir, build) is
			// then relative to the project directory.
			if projectPath != "" {
				abs, err := filepath.Abs(projectPath)
				if err != nil {
					return fmt.Errorf("invalid --project path: %w", err)
				}
				if _, err := os.Stat(abs); os.IsNotExist(err) {
					return fmt.Errorf("--project path does not exist: %s", abs)
				}
				if err := os.Chdir(abs); err != nil {
					return fmt.Errorf("cannot enter project directory: %w", err)
				}
				ui.Note(fmt.Sprintf("Project: %s", abs))
			}

			m, err := loadManifest(".")
			if err != nil {
				return err
			}

			// --build: run tsuki-dk build before launching the sandbox
			if buildFirst {
				ui.Step("Building", m.Package.Name)
				if err := buildPackage(m); err != nil {
					return fmt.Errorf("build failed: %w", err)
				}
			}

			if clean {
				if err := os.RemoveAll(sandboxDir); err != nil {
					return fmt.Errorf("cleaning sandbox: %w", err)
				}
				ui.Note("Sandbox cleaned")
			}
			return runSandbox(m, localIdePath)
		},
	}

	cmd.Flags().BoolVar(&clean,        "clean",     false, "wipe and recreate the sandbox")
	cmd.Flags().StringVar(&projectPath, "project",  "",    "path to the plugin project directory (avoids cd)")
	cmd.Flags().BoolVar(&buildFirst,   "build",     false, "run tsuki-dk build before launching the sandbox")
	cmd.Flags().StringVar(&localIdePath,"local-ide", "",   "path to local tsuki-ide source directory (compiled before launch)")
	return cmd
}

func runSandbox(m *DkManifest, localIdePath string) error {
	// ── Resolve local IDE binary (compile if --local-ide was given) ───────
	var localIdeBin string
	if localIdePath != "" {
		bin, err := buildLocalIde(localIdePath)
		if err != nil {
			return err
		}
		localIdeBin = bin
		ui.Success(fmt.Sprintf("Local IDE binary: %s", localIdeBin))
	}

	// ── Bootstrap sandbox if needed ───────────────────────────────────────
	if !fileExists(sandboxDir) {
		if err := bootstrapSandbox(); err != nil {
			return err
		}
	}

	// ── Install current package into sandbox ──────────────────────────────
	if err := installIntoSandbox(m); err != nil {
		return err
	}

	// ── Start local registry server (for library/board-pack/plugin/patch) ─
	var srv *sandboxServer
	sandboxDataAbs := absPath(sandboxDir)

	if server, err := startSandboxServer(m); err != nil {
		ui.Warn(fmt.Sprintf("local registry unavailable: %v", err))
	} else if server != nil {
		srv = server
		defer srv.stop()
		// Inject the local server as the highest-priority source inside the sandbox
		if err := injectSandboxSource(sandboxDataAbs, srv.url()); err != nil {
			ui.Warn(fmt.Sprintf("could not register local source: %v", err))
		}
	}

	// ── Launch tsuki or tsuki-ide pointing at the sandbox ────────────────
	return launchSandbox(m, localIdeBin)
}

func bootstrapSandbox() error {
	ui.SectionTitle("Bootstrap Sandbox")
	if err := os.MkdirAll(sandboxDir, 0755); err != nil {
		return err
	}

	// All binaries that should be available inside the sandbox.
	// Copied from the host install so the sandbox is self-contained.
	bins := []string{"tsuki", "tsuki-core", "tsuki-flash", "tsuki-sim"}
	sandboxBin := filepath.Join(sandboxDir, "bin")
	if err := os.MkdirAll(sandboxBin, 0755); err != nil {
		return err
	}

	copied := 0
	for _, bin := range bins {
		src := findBinary(bin)
		if src == "" {
			ui.Note(fmt.Sprintf("  %s  not found — skipping", bin))
			continue
		}
		dst := filepath.Join(sandboxBin, filepath.Base(src))
		if fileExists(dst) {
			// Already copied in a previous bootstrap — skip to keep sandbox fast
			ui.Note(fmt.Sprintf("  ✔  %-16s  (cached)", bin))
			copied++
			continue
		}
		if err := copyFile(src, dst); err != nil {
			return fmt.Errorf("copying %s: %w", bin, err)
		}
		if err := os.Chmod(dst, 0755); err != nil {
			return err
		}
		ui.Note(fmt.Sprintf("  ✔  %-16s  %s", bin, src))
		copied++
	}

	for _, d := range []string{"libs", "boards", "plugins", "bin", "cache", "config"} {
		if err := os.MkdirAll(filepath.Join(sandboxDir, d), 0755); err != nil {
			return err
		}
	}

	ui.Artifact(sandboxDir, fmt.Sprintf("%d binaries", copied))
	ui.SectionEnd()
	return nil
}

func installIntoSandbox(m *DkManifest) error {
	sp := ui.NewSpinner(fmt.Sprintf("Installing %s into sandbox…", m.Package.Name))
	sp.Start()

	switch m.Package.Type {
	case "library":
		dst := filepath.Join(sandboxDir, "libs", m.Package.Author, m.Package.Name, m.Package.Version)
		if err := os.MkdirAll(dst, 0755); err != nil {
			sp.Stop(false, "failed")
			return err
		}
		// Copy lib/ into the sandbox libs dir
		if err := copyDir("lib", dst); err != nil {
			sp.Stop(false, "failed")
			return err
		}

	case "app":
		// Build and copy the binary
		binName := m.Package.Name
		binSrc := filepath.Join(".tsuki-dk", "build", binName)
		if !fileExists(binSrc) {
			sp.Stop(false, "build first")
			return fmt.Errorf("binary not found at %s — run 'tsuki-dk build' first", binSrc)
		}
		binDst := filepath.Join(sandboxDir, "bin", binName)
		if err := copyFile(binSrc, binDst); err != nil {
			sp.Stop(false, "failed")
			return err
		}
		if err := os.Chmod(binDst, 0755); err != nil {
			return err
		}

	case "board-pack":
		dst := filepath.Join(sandboxDir, "boards", m.Package.Author, m.Package.Name)
		if err := copyDir("boards", dst); err != nil {
			sp.Stop(false, "failed")
			return err
		}

	case "ide-plugin":
		dst := filepath.Join(sandboxDir, "plugins", m.Package.Author, m.Package.Name, m.Package.Version)
		if err := os.MkdirAll(dst, 0755); err != nil {
			sp.Stop(false, "failed")
			return err
		}
		// Copy the plugin/ bundle into <version>/plugin/
		if err := copyDir("plugin", filepath.Join(dst, "plugin")); err != nil {
			sp.Stop(false, "failed")
			return err
		}
		// Copy tsuki.toml so the Rust scanner can read description/permissions/slots
		if err := copyFile("tsuki.toml", filepath.Join(dst, "tsuki.toml")); err != nil {
			sp.Stop(false, "failed")
			return err
		}

	default:
		sp.Stop(true, "nothing to install for "+m.Package.Type)
		return nil
	}

	sp.Stop(true, fmt.Sprintf("%s installed into sandbox", m.Package.Name))
	return nil
}

func launchSandbox(m *DkManifest, localIdeBin string) error {
	sandboxAbs := absPath(sandboxDir)
	sandboxBin := filepath.Join(sandboxAbs, "bin")

	// ── Seed settings.json if it doesn't exist yet ────────────────────────────
	// Write the tsuki binary paths so the IDE uses sandbox copies, not host ones.
	if err := seedSandboxSettings(sandboxAbs, sandboxBin); err != nil {
		ui.Warn(fmt.Sprintf("could not seed sandbox settings: %v", err))
	}

	// ── Build sandbox-first PATH ──────────────────────────────────────────────
	// Prepend sandbox/bin so every binary lookup (tsuki, tsuki-core, tsuki-flash)
	// resolves to the sandboxed copies, not whatever the host has in PATH.
	hostPath := os.Getenv("PATH")
	sep := string(os.PathListSeparator)
	sandboxPath := sandboxBin + sep + hostPath

	env := append(os.Environ(),
		"TSUKI_DATA_DIR="+sandboxAbs,
		"TSUKI_DK_SANDBOX=1",
		"TSUKI_DK_SANDBOX_PKG="+m.Package.Name,
		"PATH="+sandboxPath,
		// Also set TSUKI_PATH so any code that reads this env var directly
		// also gets the sandbox binary, not the host one.
		"TSUKI_PATH="+filepath.Join(sandboxBin, exeName("tsuki")),
	)

	// Determine IDE binary: --local-ide > system PATH > shell fallback
	ideBin := localIdeBin
	if ideBin == "" {
		if p, err := exec.LookPath("tsuki-ide"); err == nil {
			ideBin = p
		}
	}

	// ── Print sandbox summary ─────────────────────────────────────────────────
	ui.SectionTitle("Sandbox")

	ideLabel := "shell (tsuki-ide not found)"
	ideSource := ""
	if ideBin != "" {
		ideLabel = ideBin
		if localIdeBin != "" {
			ideSource = "local build"
		} else {
			ideSource = "system PATH"
		}
	}
	if ideSource != "" {
		ideLabel = ideLabel + "  [" + ideSource + "]"
	}

	sandboxTsuki := filepath.Join(sandboxBin, exeName("tsuki"))
	tsukiLabel := sandboxTsuki
	if !fileExists(sandboxTsuki) {
		tsukiLabel = sandboxTsuki + "  (not found — will use host PATH)"
	}

	ui.PrintConfig("Environment", []ui.ConfigEntry{
		{Key: "package",        Value: m.Package.Author + "/" + m.Package.Name},
		{Key: "type",           Value: m.Package.Type},
		{Key: "TSUKI_DATA_DIR", Value: sandboxAbs},
		{Key: "tsuki bin",      Value: tsukiLabel},
		{Key: "IDE",            Value: ideLabel},
	}, false)

	ui.Box("Quick commands",
		"tsuki install "+m.Package.Name+"   # install this package\n"+
			"tsuki pkg list                      # list installed packages\n"+
			"tsuki pkg search                    # browse available packages\n"+
			"exit  /  Ctrl-D                     # leave the sandbox",
	)

	ui.SectionEnd()
	fmt.Println()

	// ── Launch IDE or shell ───────────────────────────────────────────────────
	if ideBin != "" && (m.Package.Type == "ide-plugin" || localIdeBin != "") {
		cmd := exec.Command(ideBin)
		cmd.Env  = env
		cmd.Stdin  = os.Stdin
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		return cmd.Run()
	}

	if m.Package.Type == "ide-plugin" {
		ui.Warn("tsuki-ide not found — falling back to CLI shell")
		fmt.Println()
	}

	shellCmd := sandboxShell(m.Package.Name, env)
	shellCmd.Stdin  = os.Stdin
	shellCmd.Stdout = os.Stdout
	shellCmd.Stderr = os.Stderr
	err := shellCmd.Run()

	fmt.Println()
	ui.Note(fmt.Sprintf("Left sandbox (%s)", m.Package.Name))
	_ = err
	return nil
}

// seedSandboxSettings writes a minimal settings.json into the sandbox config
// dir pointing all tsuki binary paths to the sandbox-local copies.
// It only writes on first bootstrap — it never overwrites an existing file
// so user changes inside the sandbox are preserved across runs.
func seedSandboxSettings(sandboxAbs, sandboxBin string) error {
	configDir := filepath.Join(sandboxAbs, "config")
	settingsPath := filepath.Join(configDir, "settings.json")

	// Don't overwrite — preserve any settings the user changed in a previous run
	if fileExists(settingsPath) {
		return nil
	}
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return err
	}

	tsukiExe      := filepath.Join(sandboxBin, exeName("tsuki"))
	tsukiCoreExe  := filepath.Join(sandboxBin, exeName("tsuki-core"))
	tsukiFlashExe := filepath.Join(sandboxBin, exeName("tsuki-flash"))

	// Build a minimal JSON object.  We quote paths manually to avoid pulling
	// in encoding/json just for this; all paths are absolute so no special chars.
	quote := func(s string) string {
		// Escape backslashes (Windows paths)
		return `"` + strings.ReplaceAll(s, `\`, `\\`) + `"`
	}

	settings := "{\n" +
		`  "tsukiPath":      ` + quote(tsukiExe)      + ",\n" +
		`  "tsukiCorePath":  ` + quote(tsukiCoreExe)  + ",\n" +
		`  "tsukiFlashPath": ` + quote(tsukiFlashExe) + ",\n" +
		`  "sandboxMode":    true` + "\n" +
		"}\n"

	return os.WriteFile(settingsPath, []byte(settings), 0644)
}

// exeName appends .exe on Windows.
func exeName(name string) string {
	if isWindows() {
		return name + ".exe"
	}
	return name
}

// sandboxShell returns an exec.Cmd for an interactive shell with the sandbox
// environment and a visible prompt indicator.
func sandboxShell(pkgName string, env []string) *exec.Cmd {
	indicator := fmt.Sprintf("[sandbox:%s]", pkgName)

	var cmd *exec.Cmd
	if isWindows() {
		// On Windows use cmd.exe. The PROMPT variable changes the prompt.
		cmd = exec.Command("cmd.exe")
		env = append(env, fmt.Sprintf("PROMPT=%s $P$G", indicator))
	} else {
		shell := os.Getenv("SHELL")
		if shell == "" {
			shell = "/bin/sh"
		}
		cmd = exec.Command(shell)
		// For bash/zsh set PS1; for fish use fish_greeting override
		ps1 := fmt.Sprintf(`\[[1;93m\]%s\[[0m\] \w$ `, indicator)
		env = append(env,
			"PS1="+ps1,
			"ZDOTDIR=/dev/null", // prevent zsh from loading user dotfiles
		)
	}
	cmd.Env = env
	return cmd
}

func isWindows() bool {
	return os.PathSeparator == 92 // backslash
}

// ── Dir copy ──────────────────────────────────────────────────────────────────

func copyDir(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, path)
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		return copyFile(path, target)
	})
}

// findBinary looks for a binary in PATH, next to the current executable,
// and in ./dist/ relative to cwd. Returns the full path or "".
func findBinary(name string) string {
	// 1. System PATH
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	// 2. Same directory as the running tsuki-dk executable
	if self, err := os.Executable(); err == nil {
		selfDir := filepath.Dir(self)
		for _, candidate := range []string{name, name + ".exe"} {
			p := filepath.Join(selfDir, candidate)
			if _, err := os.Stat(p); err == nil {
				return p
			}
		}
	}
	// 3. dist/ relative to current working directory
	if cwd, err := os.Getwd(); err == nil {
		for _, candidate := range []string{name, name + ".exe"} {
			p := filepath.Join(cwd, "dist", candidate)
			if _, err := os.Stat(p); err == nil {
				return p
			}
			// Also try ../dist/ (when inside a package subdir)
			p = filepath.Join(cwd, "..", "dist", candidate)
			if _, err := os.Stat(p); err == nil {
				return p
			}
		}
	}
	return ""
}


// ── Local IDE build ───────────────────────────────────────────────────────────

// buildLocalIde compiles tsuki-ide from a local source directory and returns
// the path to the resulting binary. It expects a Tauri + Next.js project with
// a src-tauri/ subdirectory.
//
// Steps:
//  1. Validate the directory looks like a Tauri project
//  2. Run `npm install` if node_modules is absent
//  3. Run `npm run tauri build`
//  4. Locate and return the release binary
func buildLocalIde(srcDir string) (string, error) {
	abs, err := filepath.Abs(srcDir)
	if err != nil {
		return "", fmt.Errorf("--local-ide: invalid path: %w", err)
	}
	if _, err := os.Stat(abs); os.IsNotExist(err) {
		return "", fmt.Errorf("--local-ide: path does not exist: %s", abs)
	}

	tauriDir := filepath.Join(abs, "src-tauri")
	if _, err := os.Stat(tauriDir); os.IsNotExist(err) {
		return "", fmt.Errorf("--local-ide: no src-tauri/ found in %s — is this a Tauri project?", abs)
	}

	ui.Step("Building local tsuki-ide", abs)

	// On Windows the previous sandbox may have left tsuki-ide.exe running.
	// Rust's linker cannot replace a locked executable, causing "Access Denied".
	// Kill it before we try to compile.
	if isWindows() {
		killRunningIde(filepath.Join(tauriDir, "target", "release", "tsuki-ide.exe"))
	}

	// Install npm dependencies if node_modules is missing
	if _, err := os.Stat(filepath.Join(abs, "node_modules")); os.IsNotExist(err) {
		sp := ui.NewSpinner("npm install…")
		sp.Start()
		npmInstall := exec.Command("npm", "install")
		npmInstall.Dir = abs
		npmInstall.Stdout = os.Stdout
		npmInstall.Stderr = os.Stderr
		if err := npmInstall.Run(); err != nil {
			sp.Stop(false, "npm install failed")
			return "", fmt.Errorf("--local-ide: npm install failed: %w", err)
		}
		sp.Stop(true, "dependencies installed")
	}

	// Build the Tauri app
	sp := ui.NewSpinner("npm run tauri build…")
	sp.Start()
	tauriBuild := exec.Command("npm", "run", "tauri", "build")
	tauriBuild.Dir = abs
	tauriBuild.Stdout = os.Stdout
	tauriBuild.Stderr = os.Stderr
	if err := tauriBuild.Run(); err != nil {
		sp.Stop(false, "tauri build failed")
		return "", fmt.Errorf("--local-ide: tauri build failed: %w", err)
	}
	sp.Stop(true, "compiled")

	releaseDir := filepath.Join(tauriDir, "target", "release")
	bin, err := findLocalIdeBinary(releaseDir)
	if err != nil {
		return "", fmt.Errorf("--local-ide: %w", err)
	}

	ui.Artifact(bin, "tsuki-ide  local build")
	return bin, nil
}

// killRunningIde attempts to terminate any process that has binPath open.
// On Windows this uses taskkill /F /IM <name> to force-close it before the
// Rust linker tries to replace the file.  Errors are silently ignored —
// if the process isn't running the build will just succeed normally.
func killRunningIde(binPath string) {
	name := filepath.Base(binPath) // "tsuki-ide.exe"
	sp   := ui.NewSpinner(fmt.Sprintf("Stopping running %s…", name))
	sp.Start()

	cmd := exec.Command("taskkill", "/F", "/IM", name)
	out, err := cmd.CombinedOutput()
	if err != nil {
		// "process not found" is fine — just means nothing was running
		sp.Stop(true, fmt.Sprintf("%s was not running", name))
		return
	}

	msg := strings.TrimSpace(string(out))
	if len(msg) > 60 {
		msg = msg[:60] + "…"
	}
	sp.Stop(true, msg)

	// Give Windows a moment to fully release the file handle
	time.Sleep(500 * time.Millisecond)
}

// findLocalIdeBinary searches for the tsuki-ide binary produced by a Tauri
// release build. Checks common names on the current platform.
func findLocalIdeBinary(releaseDir string) (string, error) {
	candidates := []string{"tsuki-ide", "tsuki-ide.exe"}
	for _, name := range candidates {
		p := filepath.Join(releaseDir, name)
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("tsuki-ide binary not found in %s — check that the build succeeded", releaseDir)
}

func absPath(p string) string {
	abs, err := filepath.Abs(p)
	if err != nil {
		return p
	}
	return abs
}