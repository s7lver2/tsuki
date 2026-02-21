// ─────────────────────────────────────────────────────────────────────────────
//  godotino :: build  (updated)
//  Passes external package info to godotino-core via --libs-dir and
//  --packages flags so the transpiler loads the correct godotinolib.toml files.
// ─────────────────────────────────────────────────────────────────────────────

package cli

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/godotino/cli/internal/core"
	"github.com/godotino/cli/internal/manifest"
	"github.com/godotino/cli/internal/pkgmgr"
	"github.com/godotino/cli/internal/ui"
)

// Options controls the build pipeline.
type Options struct {
	Board      string
	Compile    bool
	OutputDir  string
	SourceMap  bool
	Verbose    bool
	CoreBin    string
	ArduinoCLI string
}

// Result holds the outputs of a successful build.
type Result struct {
	CppFiles    []string
	FirmwareHex string
	Warnings    []string
}

// Run executes the full build pipeline.
func Run(projectDir string, m *manifest.Manifest, opts Options) (*Result, error) {
	board := opts.Board
	if board == "" {
		board = m.Board
	}
	outDir := opts.OutputDir
	if outDir == "" {
		outDir = filepath.Join(projectDir, m.Build.OutputDir)
	}

	if err := os.MkdirAll(outDir, 0755); err != nil {
		return nil, fmt.Errorf("creating output dir: %w", err)
	}

	transpiler := core.New(opts.CoreBin, opts.Verbose)
	if !transpiler.Installed() {
		return nil, fmt.Errorf(
			"godotino-core not found — install it or set core_binary in config\n" +
				"  godotino config set core_binary /path/to/godotino-core",
		)
	}

	srcDir := filepath.Join(projectDir, "src")
	goFiles, err := filepath.Glob(filepath.Join(srcDir, "*.go"))
	if err != nil || len(goFiles) == 0 {
		return nil, fmt.Errorf("no .go files found in %s", srcDir)
	}

	// Resolve declared packages
	pkgNames := m.PackageNames()
	libsDir  := pkgmgr.LibsDir()

	if len(pkgNames) > 0 {
		ui.SectionTitle(fmt.Sprintf("Transpiling  [board: %s]  [packages: %s]",
			board, strings.Join(pkgNames, ", ")))

		// Verify each declared package is actually installed
		for _, name := range pkgNames {
			if ok, _ := pkgmgr.IsInstalled(name); !ok {
				return nil, fmt.Errorf(
					"package %q declared in goduino.json is not installed\n"+
						"  Run: godotino pkg install %s", name, name,
				)
			}
		}
	} else {
		ui.SectionTitle(fmt.Sprintf("Transpiling  [board: %s]", board))
	}

	result := &Result{}
	for _, goFile := range goFiles {
		base    := strings.TrimSuffix(filepath.Base(goFile), ".go")
		cppFile := filepath.Join(outDir, base+".cpp")

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
		result.Warnings  = append(result.Warnings, tr.Warnings...)
	}

	for _, w := range result.Warnings {
		ui.Warn(w)
	}

	if !opts.Compile {
		return result, nil
	}

	// ── arduino-cli compile ──────────────────────────────────────────────────
	ui.SectionTitle("Compiling")
	fqbn, err := boardFQBN(board)
	if err != nil {
		return result, fmt.Errorf("unknown board %q — run `godotino boards list`", board)
	}

	arduinoCLI := opts.ArduinoCLI
	if arduinoCLI == "" {
		arduinoCLI = "arduino-cli"
	}

	args := []string{"compile", "--fqbn", fqbn, "--build-path", outDir, "--warnings", "all"}
	if opts.Verbose {
		args = append(args, "--verbose")
	}
	args = append(args, projectDir)

	sp := ui.NewSpinner(fmt.Sprintf("arduino-cli compile --fqbn %s", fqbn))
	sp.Start()

	cmd := exec.Command(arduinoCLI, args...)
	cmd.Dir = projectDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		sp.Stop(false, "compilation failed")
		renderArduinoError(string(out))
		return result, fmt.Errorf("arduino-cli compile failed")
	}
	sp.Stop(true, fmt.Sprintf("firmware written to %s", outDir))

	hexFiles, _ := filepath.Glob(filepath.Join(outDir, "*.hex"))
	if len(hexFiles) > 0 {
		result.FirmwareHex = hexFiles[0]
	}

	return result, nil
}

func newBuildCmd() *cobra.Command {
	var board string
	var output string
	var compile bool
	var verbose bool

	cmd := &cobra.Command{
		Use:   "build",
		Short: "Transpile and optionally compile the project",
		Example: `  godotino build
  godotino build --board esp32
  godotino build --compile`,
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := projectDir()
			m, err := manifest.Load(dir)
			if err != nil {
				return err
			}

			opts := Options{
				Board:     board,
				Compile:   compile,
				OutputDir: output,
				Verbose:   verbose,
			}

			_, err = Run(dir, m, opts)
			if err != nil {
				return err
			}
			ui.Success("Build finished!")
			return nil
		},
	}

	cmd.Flags().StringVarP(&board, "board", "b", "", "target board (default from manifest)")
	cmd.Flags().StringVarP(&output, "out", "o", "", "output directory")
	cmd.Flags().BoolVarP(&compile, "compile", "c", false, "compile to firmware after transpile")
	cmd.Flags().BoolVarP(&verbose, "verbose", "v", false, "verbose output")
	return cmd
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
		"uno": "arduino:avr:uno", "nano": "arduino:avr:nano", "mega": "arduino:avr:mega",
		"leonardo": "arduino:avr:leonardo", "micro": "arduino:avr:micro",
		"due": "arduino:sam:arduino_due_x", "mkr1000": "arduino:samd:mkr1000",
		"esp32": "esp32:esp32:esp32", "esp8266": "esp8266:esp8266:generic",
		"pico": "rp2040:rp2040:rpipico", "teensy40": "teensy:avr:teensy40",
	}
	fqbn, ok := table[strings.ToLower(id)]
	if !ok {
		return "", fmt.Errorf("unknown board")
	}
	return fqbn, nil
}