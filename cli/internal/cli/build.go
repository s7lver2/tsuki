// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: cli :: build
//
//  Transpiles Go → C++ and optionally:
//    --compile           compile to .hex with arduino-cli
//    --prepare-package   pack the project into a .tskp distributable
//
//  A .tskp file is a ZIP archive with the following layout:
//    tsuki-package.json   ← metadata (name, version, description, …)
//    src/                 ← original Go source files
//    build/<sketch>/      ← generated C++ sketch
//    build/.cache/        ← compiled firmware (.hex / .elf)  [if --compile]
//    README.md            ← if present in project root
//    tsuki-config.toml    ← project manifest
// ─────────────────────────────────────────────────────────────────────────────

package cli

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/tsuki/cli/internal/core"
	"github.com/tsuki/cli/internal/manifest"
	"github.com/tsuki/cli/internal/pkgmgr"
	"github.com/tsuki/cli/internal/ui"
)

// ── Build options / result ────────────────────────────────────────────────────

// Options controls the build pipeline.
type Options struct {
	Board          string
	Compile        bool
	PreparePackage bool
	OutputDir      string
	SourceMap      bool
	Verbose        bool
	CoreBin        string
	ArduinoCLI     string
}

// Result holds the outputs of a successful build.
type Result struct {
	CppFiles    []string
	SketchDir   string
	FirmwareHex string
	Warnings    []string
	PackagePath string // set when --prepare-package is used
}

// ── Main build runner ─────────────────────────────────────────────────────────

// Run executes the full build pipeline.
func Run(projectDir string, m *manifest.Manifest, opts Options) (*Result, error) {
	board := opts.Board
	if board == "" {
		board = m.Board
	}

	baseOutDir := opts.OutputDir
	if baseOutDir == "" {
		baseOutDir = filepath.Join(projectDir, m.Build.OutputDir)
	}

	sketchName := sanitizeSketchName(m.Name)
	if sketchName == "" {
		sketchName = "sketch"
	}
	sketchDir := filepath.Join(baseOutDir, sketchName)

	if err := os.MkdirAll(sketchDir, 0755); err != nil {
		return nil, fmt.Errorf("creating sketch dir: %w", err)
	}

	transpiler := core.New(opts.CoreBin, opts.Verbose)
	if !transpiler.Installed() {
		return nil, fmt.Errorf(
			"tsuki-core not found — install it or set core_binary in config\n" +
				"  tsuki config set core_binary /path/to/tsuki-core",
		)
	}

	srcDir := filepath.Join(projectDir, "src")
	goFiles, err := filepath.Glob(filepath.Join(srcDir, "*.go"))
	if err != nil || len(goFiles) == 0 {
		return nil, fmt.Errorf("no .go files found in %s", srcDir)
	}

	pkgNames := m.PackageNames()
	libsDir := pkgmgr.LibsDir()

	if len(pkgNames) > 0 {
		ui.SectionTitle(fmt.Sprintf("Transpiling  [board: %s]  [packages: %s]",
			board, strings.Join(pkgNames, ", ")))
		for _, name := range pkgNames {
			if ok, _ := pkgmgr.IsInstalled(name); !ok {
				return nil, fmt.Errorf(
					"package %q is not installed\n  Run: tsuki install %s", name, name,
				)
			}
		}
	} else {
		ui.SectionTitle(fmt.Sprintf("Transpiling  [board: %s]", board))
	}

	result := &Result{SketchDir: sketchDir}

	for _, goFile := range goFiles {
		base := strings.TrimSuffix(filepath.Base(goFile), ".go")
		cppFile := filepath.Join(sketchDir, base+".cpp")

		sp := ui.NewSpinner(fmt.Sprintf("%s → %s", filepath.Base(goFile), filepath.Base(cppFile)))
		sp.Start()

		tr, err := transpiler.Transpile(core.TranspileRequest{
			InputFile:  goFile,
			OutputFile: cppFile,
			Board:      board,
			SourceMap:  opts.SourceMap || m.Build.SourceMap,
			LibsDir:    libsDir,
			PkgNames:   pkgNames,
		})
		if err != nil {
			sp.Stop(false, fmt.Sprintf("failed: %s", filepath.Base(goFile)))
			return nil, err
		}

		sp.Stop(true, fmt.Sprintf("%s  →  %s", filepath.Base(goFile), filepath.Base(cppFile)))
		result.CppFiles = append(result.CppFiles, tr.OutputFile)
		result.Warnings = append(result.Warnings, tr.Warnings...)
	}

	for _, w := range result.Warnings {
		ui.Warn(w)
	}

	if err := writeInoStub(sketchDir, sketchName, result.CppFiles); err != nil {
		return nil, fmt.Errorf("writing .ino stub: %w", err)
	}
	ui.Step("sketch", fmt.Sprintf("wrote %s/%s.ino", sketchName, sketchName))

	// ── Optional: arduino-cli compile ─────────────────────────────────────
	if opts.Compile {
		ui.SectionTitle("Compiling")
		fqbn, err := boardFQBN(board)
		if err != nil {
			return result, fmt.Errorf("unknown board %q — run `tsuki boards list`", board)
		}

		arduinoCLI := opts.ArduinoCLI
		if arduinoCLI == "" {
			arduinoCLI = "arduino-cli"
		}

		buildCacheDir := filepath.Join(baseOutDir, ".cache")
		_ = os.MkdirAll(buildCacheDir, 0755)

		args := []string{
			"compile",
			"--fqbn", fqbn,
			"--build-path", buildCacheDir,
			"--warnings", "all",
		}
		if opts.Verbose {
			args = append(args, "--verbose")
		}
		args = append(args, sketchDir)

		sp := ui.NewSpinner(fmt.Sprintf("arduino-cli compile --fqbn %s", fqbn))
		sp.Start()

		cmd := exec.Command(arduinoCLI, args...)
		cmd.Dir = sketchDir
		out, cmdErr := cmd.CombinedOutput()
		if cmdErr != nil {
			sp.Stop(false, "compilation failed")
			renderArduinoError(string(out))
			return result, fmt.Errorf("arduino-cli compile failed")
		}
		sp.Stop(true, fmt.Sprintf("firmware written to %s", buildCacheDir))

		hexFiles, _ := filepath.Glob(filepath.Join(buildCacheDir, "*.hex"))
		if len(hexFiles) > 0 {
			result.FirmwareHex = hexFiles[0]
		}
	}

	// ── Optional: pack .tskp ──────────────────────────────────────────────
	if opts.PreparePackage {
		pkgPath, err := packTSKP(projectDir, m, result)
		if err != nil {
			return result, fmt.Errorf("packaging failed: %w", err)
		}
		result.PackagePath = pkgPath
	}

	return result, nil
}

// ── .tskp packaging ───────────────────────────────────────────────────────────

// tskpMeta is written as tsuki-package.json inside the .tskp archive.
type tskpMeta struct {
	Name        string   `json:"name"`
	Version     string   `json:"version"`
	Description string   `json:"description,omitempty"`
	Board       string   `json:"board,omitempty"`
	Authors     []string `json:"authors,omitempty"`
	License     string   `json:"license,omitempty"`
	PackagedAt  string   `json:"packaged_at"`
}

// packTSKP creates <name>-<version>.tskp in the project root.
func packTSKP(projectDir string, m *manifest.Manifest, result *Result) (string, error) {
	name := m.Name
	if name == "" {
		name = "project"
	}
	version := m.Version
	if version == "" {
		version = "0.0.0"
	}

	outName := fmt.Sprintf("%s-%s.tskp", name, version)
	outPath := filepath.Join(projectDir, outName)

	ui.SectionTitle(fmt.Sprintf("Packaging → %s", outName))

	f, err := os.Create(outPath)
	if err != nil {
		return "", fmt.Errorf("create archive: %w", err)
	}
	defer f.Close()

	zw := zip.NewWriter(f)
	defer zw.Close()

	sp := ui.NewSpinner("Collecting files…")
	sp.Start()

	var entries int

	// ── tsuki-package.json metadata ───────────────────────────────────────
	meta := tskpMeta{
		Name:        name,
		Version:     version,
		Description: m.Description,
		Board:       m.Board,
		Authors:     m.Project.Authors,
		License:     m.Project.License,
		PackagedAt:  time.Now().UTC().Format(time.RFC3339),
	}
	metaBytes, _ := json.MarshalIndent(meta, "", "  ")
	if err := addBytesToZip(zw, "tsuki-package.json", metaBytes); err != nil {
		sp.Stop(false, "failed writing metadata")
		return "", err
	}
	entries++

	// ── tsuki-config.toml (or tsuki_package.json) ─────────────────────────
	for _, cfgName := range []string{manifest.TOMLFileName, manifest.JSONFileName} {
		cfgPath := filepath.Join(projectDir, cfgName)
		if _, err := os.Stat(cfgPath); err == nil {
			if err := addFileToZip(zw, cfgPath, cfgName); err != nil {
				sp.Stop(false, "failed writing config")
				return "", err
			}
			entries++
			break
		}
	}

	// ── README.md (optional) ──────────────────────────────────────────────
	for _, readmeName := range []string{"README.md", "readme.md", "Readme.md"} {
		rp := filepath.Join(projectDir, readmeName)
		if _, err := os.Stat(rp); err == nil {
			_ = addFileToZip(zw, rp, readmeName)
			entries++
			break
		}
	}

	// ── src/ — original Go sources ────────────────────────────────────────
	srcDir := filepath.Join(projectDir, "src")
	n, err := addDirToZip(zw, srcDir, "src")
	if err != nil {
		sp.Stop(false, "failed adding src/")
		return "", err
	}
	entries += n

	// ── build/<sketch>/ — generated C++ ──────────────────────────────────
	if result.SketchDir != "" {
		rel, _ := filepath.Rel(projectDir, result.SketchDir)
		n, err = addDirToZip(zw, result.SketchDir, rel)
		if err == nil {
			entries += n
		}
	}

	// ── build/.cache/ — firmware (only if compiled) ───────────────────────
	if result.FirmwareHex != "" {
		cacheDir := filepath.Dir(result.FirmwareHex)
		rel, _ := filepath.Rel(projectDir, cacheDir)
		hexFiles, _ := filepath.Glob(filepath.Join(cacheDir, "*.hex"))
		for _, hf := range hexFiles {
			r, _ := filepath.Rel(cacheDir, hf)
			_ = addFileToZip(zw, hf, filepath.Join(rel, r))
			entries++
		}
	}

	sp.Stop(true, fmt.Sprintf("packed %d files → %s", entries, outName))
	ui.Info(fmt.Sprintf("Archive: %s", outPath))

	return outPath, nil
}

// ── zip helpers ───────────────────────────────────────────────────────────────

func addBytesToZip(zw *zip.Writer, name string, data []byte) error {
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}

func addFileToZip(zw *zip.Writer, fsPath, zipPath string) error {
	data, err := os.ReadFile(fsPath)
	if err != nil {
		return err
	}
	return addBytesToZip(zw, zipPath, data)
}

// addDirToZip walks a directory and adds all files under zipRoot inside the archive.
// Returns the number of files added.
func addDirToZip(zw *zip.Writer, dir, zipRoot string) (int, error) {
	var count int
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		zipPath := filepath.Join(zipRoot, rel)

		w, err := zw.Create(zipPath)
		if err != nil {
			return err
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(w, f)
		if err == nil {
			count++
		}
		return err
	})
	return count, err
}

// ── Cobra command ─────────────────────────────────────────────────────────────

func newBuildCmd() *cobra.Command {
	var (
		board          string
		output         string
		compile        bool
		preparePackage bool
		verbose        bool
	)

	cmd := &cobra.Command{
		Use:   "build",
		Short: "Transpile and optionally compile the project",
		Example: `  tsuki build
  tsuki build --board esp32
  tsuki build --compile
  tsuki build --compile --prepare-package`,
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := projectDir()
			m, err := manifest.Load(dir)
			if err != nil {
				return err
			}

			opts := Options{
				Board:          board,
				Compile:        compile,
				PreparePackage: preparePackage,
				OutputDir:      output,
				Verbose:        verbose,
				CoreBin:        cfg.CoreBinary,
				ArduinoCLI:     cfg.ArduinoCLI,
				SourceMap:      m.Build.SourceMap,
			}

			res, err := Run(dir, m, opts)
			if err != nil {
				return err
			}

			if res.SketchDir != "" {
				ui.Step("sketch", res.SketchDir)
			}
			if res.FirmwareHex != "" {
				ui.Step("firmware", res.FirmwareHex)
			}
			if res.PackagePath != "" {
				ui.Step("package", res.PackagePath)
			}
			ui.Success("Build finished!")
			return nil
		},
	}

	cmd.Flags().StringVarP(&board, "board", "b", "", "target board (default from manifest)")
	cmd.Flags().StringVarP(&output, "out", "o", "", "output directory")
	cmd.Flags().BoolVarP(&compile, "compile", "c", false, "compile to firmware after transpile")
	cmd.Flags().BoolVar(&preparePackage, "prepare-package", false, "pack project into a .tskp archive after build")
	cmd.Flags().BoolVarP(&verbose, "verbose", "v", false, "verbose output")
	return cmd
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func writeInoStub(sketchDir, sketchName string, _ []string) error {
	const stub = "// Auto-generated by tsuki — do not edit.\n" +
		"// arduino-cli compiles the .cpp files in this directory automatically.\n"
	return os.WriteFile(filepath.Join(sketchDir, sketchName+".ino"), []byte(stub), 0644)
}

func sanitizeSketchName(name string) string {
	var sb strings.Builder
	for i, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r == '_':
			sb.WriteRune(r)
		case r >= '0' && r <= '9':
			if i > 0 {
				sb.WriteRune(r)
			}
		default:
			if sb.Len() > 0 {
				sb.WriteRune('_')
			}
		}
	}
	return sb.String()
}

func renderArduinoError(output string) {
	lines := strings.Split(output, "\n")
	var frames []ui.Frame
	var errMsg string

	for _, line := range lines {
		if strings.Contains(line, ": error:") {
			parts := strings.SplitN(line, ": error:", 2)
			loc := parts[0]
			msg := ""
			if len(parts) > 1 {
				msg = strings.TrimSpace(parts[1])
			}
			locParts := strings.Split(loc, ":")
			frame := ui.Frame{Func: "compile"}
			if len(locParts) >= 1 {
				frame.File = locParts[0]
			}
			if len(locParts) >= 2 {
				fmt.Sscanf(locParts[1], "%d", &frame.Line)
			}
			frame.Code = []ui.CodeLine{{Number: frame.Line, Text: msg, IsPointer: true}}
			frames = append(frames, frame)
			if errMsg == "" {
				errMsg = msg
			}
		}
	}

	if len(frames) == 0 {
		frames = []ui.Frame{{
			File: "sketch", Func: "compile",
			Code: []ui.CodeLine{{Number: 0, Text: strings.TrimSpace(output), IsPointer: true}},
		}}
		errMsg = "compilation failed"
	}
	ui.Traceback("CompileError", errMsg, frames)
}

func boardFQBN(id string) (string, error) {
	table := map[string]string{
		"uno":      "arduino:avr:uno",
		"nano":     "arduino:avr:nano",
		"mega":     "arduino:avr:mega",
		"leonardo": "arduino:avr:leonardo",
		"micro":    "arduino:avr:micro",
		"due":      "arduino:sam:arduino_due_x",
		"mkr1000":  "arduino:samd:mkr1000",
		"esp32":    "esp32:esp32:esp32",
		"esp8266":  "esp8266:esp8266:generic",
		"pico":     "rp2040:rp2040:rpipico",
		"teensy40": "teensy:avr:teensy40",
	}
	fqbn, ok := table[strings.ToLower(id)]
	if !ok {
		return "", fmt.Errorf("unknown board")
	}
	return fqbn, nil
}