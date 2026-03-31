// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: build  (fixed)
//
//  THE BUG: arduino-cli compile requires a *sketch directory* — a folder
//  whose name matches the .ino file inside it.  The old code passed the
//  project root directly, which never contains a .ino file.
//
//  THE FIX: after transpiling, we:
//    1. Write .cpp files into  build/<project-name>/
//    2. Generate              build/<project-name>/<project-name>.ino
//    3. Pass the sketch dir   build/<project-name>/   to arduino-cli
//    4. Cache .hex/.elf into  build/.cache/
// ─────────────────────────────────────────────────────────────────────────────

package cli

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/tsuki/cli/internal/core"
	"github.com/tsuki/cli/internal/manifest"
	"github.com/tsuki/cli/internal/pkgmgr"
	"github.com/tsuki/cli/internal/ui"
)

// Options controls the build pipeline.
type Options struct {
	Board       string
	Compile     bool
	OutputDir   string
	SourceMap   bool
	Verbose     bool
	CoreBin     string
	ArduinoCLI  string
	// FlashBinary is the path to tsuki-flash (used when Backend == "tsuki-flash").
	FlashBinary string
	// Backend selects the compiler: "tsuki-flash" or "arduino-cli".
	// Defaults to "arduino-cli" if empty.
	Backend     string
}

// Result holds the outputs of a successful build.
type Result struct {
	CppFiles    []string
	SketchDir   string // path to the generated Arduino sketch dir
	FirmwareHex string
	Warnings    []string
}

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

	switch m.EffectiveLanguage() {
	case manifest.LangPython:
		return runPython(projectDir, m, opts, board, baseOutDir)
	case manifest.LangCpp:
		return runNative(projectDir, m, opts, board, baseOutDir, "cpp")
	case manifest.LangIno:
		return runNative(projectDir, m, opts, board, baseOutDir, "ino")
	default:
		return runGo(projectDir, m, opts, board, baseOutDir)
	}
}

// runPython is the Python → transpile → compile pipeline.
// It mirrors runGo exactly but searches for *.py files and passes
// --lang python to tsuki-core so PythonPipeline is used.
func runPython(projectDir string, m *manifest.Manifest, opts Options, board, baseOutDir string) (*Result, error) {
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

	srcDir  := filepath.Join(projectDir, "src")
	pyFiles, err := filepath.Glob(filepath.Join(srcDir, "*.py"))
	if err != nil || len(pyFiles) == 0 {
		return nil, fmt.Errorf("no .py files found in %s", srcDir)
	}

	pkgNames := m.PackageNames()
	libsDir  := pkgmgr.LibsDir()

	if len(pkgNames) > 0 {
		ui.SectionTitle(fmt.Sprintf("Transpiling Python  [board: %s]  [packages: %s]",
			board, strings.Join(pkgNames, ", ")))
		for _, name := range pkgNames {
			if ok, _ := pkgmgr.IsInstalled(name); !ok {
				return nil, fmt.Errorf(
					"package %q declared in tsuki_package.json is not installed\n"+
						"  Run: tsuki pkg install %s", name, name,
				)
			}
		}
	} else {
		ui.SectionTitle(fmt.Sprintf("Transpiling Python  [board: %s]", board))
	}

	result := &Result{SketchDir: sketchDir}

	for _, pyFile := range pyFiles {
		base    := strings.TrimSuffix(filepath.Base(pyFile), ".py")
		cppFile := filepath.Join(sketchDir, base+".cpp")

		blk := ui.NewLiveBlock(fmt.Sprintf("%s → %s", filepath.Base(pyFile), filepath.Base(cppFile)))
		blk.Start()

		tr, err := transpiler.Transpile(core.TranspileRequest{
			InputFile:  pyFile,
			OutputFile: cppFile,
			Board:      board,
			Language:   "python",
			SourceMap:  opts.SourceMap || m.Build.SourceMap,
			LibsDir:    libsDir,
			PkgNames:   pkgNames,
		})
		if err != nil {
			blk.Line(err.Error())
			blk.Finish(false, fmt.Sprintf("failed: %s", filepath.Base(pyFile)))
			return nil, err
		}
		for _, w := range tr.Warnings {
			blk.Line("⚠ " + w)
		}
		blk.Finish(true, "")
		result.CppFiles = append(result.CppFiles, tr.OutputFile)
		result.Warnings  = append(result.Warnings, tr.Warnings...)
	}

	for _, w := range result.Warnings {
		ui.Warn(w)
	}

	if err := writeInoStub(sketchDir, sketchName, result.CppFiles); err != nil {
		return nil, fmt.Errorf("writing .ino stub: %w", err)
	}
	ui.Step("sketch", fmt.Sprintf("wrote %s/%s.ino", sketchName, sketchName))

	if !opts.Compile {
		return result, nil
	}

	return compileSketch(result, m, board, opts, sketchDir, baseOutDir)
}

// runGo is the original Go → transpile → compile pipeline.
func runGo(projectDir string, m *manifest.Manifest, opts Options, board, baseOutDir string) (*Result, error) {
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
			"tsuki-core not found \u2014 install it or set core_binary in config\n" +
				"  tsuki config set core_binary /path/to/tsuki-core",
		)
	}

	srcDir := filepath.Join(projectDir, "src")
	goFiles, err := filepath.Glob(filepath.Join(srcDir, "*.go"))
	if err != nil || len(goFiles) == 0 {
		return nil, fmt.Errorf("no .go files found in %s", srcDir)
	}

	pkgNames := m.PackageNames()
	libsDir  := pkgmgr.LibsDir()

	if len(pkgNames) > 0 {
		ui.SectionTitle(fmt.Sprintf("Transpiling  [board: %s]  [packages: %s]",
			board, strings.Join(pkgNames, ", ")))
		for _, name := range pkgNames {
			if ok, _ := pkgmgr.IsInstalled(name); !ok {
				return nil, fmt.Errorf(
					"package %q declared in goduino.json is not installed\n"+
						"  Run: tsuki pkg install %s", name, name,
				)
			}
		}
	} else {
		ui.SectionTitle(fmt.Sprintf("Transpiling  [board: %s]", board))
	}

	result := &Result{SketchDir: sketchDir}

	for _, goFile := range goFiles {
		base    := strings.TrimSuffix(filepath.Base(goFile), ".go")
		cppFile := filepath.Join(sketchDir, base+".cpp")

		blk := ui.NewLiveBlock(fmt.Sprintf("%s → %s", filepath.Base(goFile), filepath.Base(cppFile)))
		blk.Start()

		tr, err := transpiler.Transpile(core.TranspileRequest{
			InputFile:  goFile,
			OutputFile: cppFile,
			Board:      board,
			SourceMap:  opts.SourceMap || m.Build.SourceMap,
			LibsDir:    libsDir,
			PkgNames:   pkgNames,
		})
		if err != nil {
			blk.Line(err.Error())
			blk.Finish(false, fmt.Sprintf("failed: %s", filepath.Base(goFile)))
			return nil, err
		}
		for _, w := range tr.Warnings {
			blk.Line("⚠ " + w)
		}
		blk.Finish(true, "")
		result.CppFiles = append(result.CppFiles, tr.OutputFile)
		result.Warnings  = append(result.Warnings, tr.Warnings...)
	}

	for _, w := range result.Warnings {
		ui.Warn(w)
	}

	if err := writeInoStub(sketchDir, sketchName, result.CppFiles); err != nil {
		return nil, fmt.Errorf("writing .ino stub: %w", err)
	}
	ui.Step("sketch", fmt.Sprintf("wrote %s/%s.ino", sketchName, sketchName))

	if !opts.Compile {
		return result, nil
	}

	return compileSketch(result, m, board, opts, sketchDir, baseOutDir)
}

// runNative handles native C++ and .ino projects without a transpilation step.
func runNative(projectDir string, m *manifest.Manifest, opts Options, board, baseOutDir, lang string) (*Result, error) {
	sketchName := sanitizeSketchName(m.Name)
	if sketchName == "" {
		sketchName = "sketch"
	}
	sketchDir := filepath.Join(baseOutDir, sketchName)
	if err := os.MkdirAll(sketchDir, 0755); err != nil {
		return nil, fmt.Errorf("creating sketch dir: %w", err)
	}

	srcDir := filepath.Join(projectDir, "src")
	var pattern string
	switch lang {
	case "ino":
		pattern = "*.ino"
	default:
		pattern = "*.cpp"
	}

	srcFiles, err := filepath.Glob(filepath.Join(srcDir, pattern))
	if err != nil || len(srcFiles) == 0 {
		return nil, fmt.Errorf("no .%s files found in %s", lang, srcDir)
	}

	// For C++, also bring over headers
	var hFiles []string
	if lang == "cpp" {
		hFiles, _ = filepath.Glob(filepath.Join(srcDir, "*.h"))
		h2, _ := filepath.Glob(filepath.Join(srcDir, "*.hpp"))
		hFiles = append(hFiles, h2...)
	}

	langLabel := map[string]string{"cpp": "C++", "ino": "Arduino (.ino)"}[lang]
	ui.SectionTitle(fmt.Sprintf("Preparing  [lang: %s]  [board: %s]", langLabel, board))

	result := &Result{SketchDir: sketchDir}

	for _, src := range append(srcFiles, hFiles...) {
		dst := filepath.Join(sketchDir, filepath.Base(src))
		data, err := os.ReadFile(src)
		if err != nil {
			return nil, fmt.Errorf("reading %s: %w", src, err)
		}
		if err := os.WriteFile(dst, data, 0644); err != nil {
			return nil, fmt.Errorf("copying %s: %w", filepath.Base(src), err)
		}
		sp := ui.NewSpinner(fmt.Sprintf("copy %s", filepath.Base(src)))
		sp.Start()
		sp.Stop(true, fmt.Sprintf("src/%s  →  build/%s/%s",
			filepath.Base(src), sketchName, filepath.Base(src)))
		ext := strings.ToLower(filepath.Ext(src))
		if ext == ".cpp" || ext == ".ino" {
			result.CppFiles = append(result.CppFiles, dst)
		}
	}

	if lang == "ino" {
		// arduino-cli requires the primary .ino to match the sketch dir name
		primary  := filepath.Join(sketchDir, filepath.Base(srcFiles[0]))
		expected := filepath.Join(sketchDir, sketchName+".ino")
		if primary != expected {
			data, _ := os.ReadFile(primary)
			_ = os.WriteFile(expected, data, 0644)
			_ = os.Remove(primary)
			for i, f := range result.CppFiles {
				if f == primary {
					result.CppFiles[i] = expected
				}
			}
		}
	} else {
		if err := writeInoStub(sketchDir, sketchName, result.CppFiles); err != nil {
			return nil, fmt.Errorf("writing .ino stub: %w", err)
		}
		ui.Step("sketch", fmt.Sprintf("wrote %s/%s.ino stub", sketchName, sketchName))
	}

	if !opts.Compile {
		return result, nil
	}

	return compileSketch(result, m, board, opts, sketchDir, baseOutDir)
}

// compileSketch dispatches to the selected backend. Used by both runGo and runNative.
func compileSketch(result *Result, m *manifest.Manifest, board string, opts Options, sketchDir, baseOutDir string) (*Result, error) {
	backend := opts.Backend
	if backend == "" {
		backend = "arduino-cli"
	}

	ui.FlashBadge(backend)
	ui.SectionTitle("Compiling")

	pkgNames := m.PackageNames()
	libsDir  := pkgmgr.LibsDir()

	buildCacheDir := filepath.Join(baseOutDir, ".cache")
	_ = os.MkdirAll(buildCacheDir, 0755)

	switch backend {
	case "tsuki-flash":
		if err := compileTsukiFlash(result, m, board, opts, buildCacheDir, pkgNames, libsDir, false); err != nil {
			return result, err
		}
	case "tsuki-flash+cores":
		if err := compileTsukiFlash(result, m, board, opts, buildCacheDir, pkgNames, libsDir, true); err != nil {
			return result, err
		}
	default:
		if err := compileArduinoCLI(result, board, opts, sketchDir, buildCacheDir); err != nil {
			return result, err
		}
	}

	hexFiles, _ := filepath.Glob(filepath.Join(buildCacheDir, "*.hex"))
	if len(hexFiles) > 0 {
		result.FirmwareHex = hexFiles[0]
	}

	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
//  Backend: tsuki-flash
// ─────────────────────────────────────────────────────────────────────────────

func compileTsukiFlash(
	result *Result,
	m *manifest.Manifest,
	board string,
	opts Options,
	buildCacheDir string,
	pkgNames []string,
	libsDir string,
	useModules bool, // true → backend is "tsuki-flash+cores", pass --use-modules
) error {
	flashBin := opts.FlashBinary
	if flashBin == "" {
		flashBin = "tsuki-flash"
	}

	// Build the --include list from installed tsuki packages.
	// Arduino libraries follow a standard layout:
	//   libsDir/<PkgName>/<version>/         ← versioned root (added)
	//   libsDir/<PkgName>/<version>/src/     ← headers live here (also added)
	// We add both so that both DHT.h (root) and src/DHT.h variants work.
	var includeArgs []string
	for _, pkg := range pkgNames {
		pkgDir := filepath.Join(libsDir, pkg)
		entries, err := os.ReadDir(pkgDir)
		if err == nil {
			for _, e := range entries {
				if e.IsDir() {
					versionedDir := filepath.Join(pkgDir, e.Name())
					includeArgs = append(includeArgs, versionedDir)
					// Standard Arduino library layout: headers in src/
					srcDir := filepath.Join(versionedDir, "src")
					if info, statErr := os.Stat(srcDir); statErr == nil && info.IsDir() {
						includeArgs = append(includeArgs, srcDir)
					}
					break
				}
			}
		} else {
			// Package not versioned or installed directly — add root + src/
			includeArgs = append(includeArgs, pkgDir)
			srcDir := filepath.Join(pkgDir, "src")
			if info, statErr := os.Stat(srcDir); statErr == nil && info.IsDir() {
				includeArgs = append(includeArgs, srcDir)
			}
		}
	}

	cppStd := m.Build.CppStd
	if cppStd == "" {
		// RP2040 SDK 5.x requires C++17 (uses digit separators, structured
		// bindings, and REG_FIELD_WIDTH macros that fail to parse under C++11/14).
		// Fall back to c++17 for all RP2040 boards automatically.
		rp2040Boards := map[string]bool{
			"xiao_rp2040": true,
			"pico":        true,
			"pico2":       true,
		}
		if rp2040Boards[strings.ToLower(board)] {
			cppStd = "c++17"
		} else {
			cppStd = "c++11"
		}
	}

	lang := m.EffectiveLanguage()

	args := []string{
		"compile",
		"--board", board,
		"--sketch", result.SketchDir,
		"--build-dir", buildCacheDir,
		"--name", sanitizeSketchName(m.Name),
		"--cpp-std", cppStd,
		"--language", lang,
	}
	for _, inc := range includeArgs {
		args = append(args, "--include", inc)
	}
	if opts.Verbose {
		args = append(args, "--verbose")
	}
	if useModules {
		// Instructs tsuki-flash to use ~/.tsuki/modules as the SDK root instead
		// of .arduino15. The first invocation auto-installs the SDK via the
		// tsuki-modules AVR module if it is not already present.
		args = append(args, "--use-modules")
	}

	cmd := exec.Command(flashBin, args...)

	// Use LiveBlock for real-time streaming output with Docker-style collapse.
	// tsuki-flash writes progress lines to stderr and the final error to stderr,
	// so we capture stderr line-by-line and stream it live.
	label := fmt.Sprintf("tsuki-flash compile --board %s", board)
	block := ui.NewLiveBlock(label)
	block.Start()

	var outBuf strings.Builder
	pipeR, pipeW, pipeErr := os.Pipe()
	if pipeErr == nil {
		cmd.Stdout = pipeW
		cmd.Stderr = pipeW
	} else {
		// Fallback: capture combined without streaming
		var combined []byte
		combined, _ = cmd.CombinedOutput()
		outBuf.Write(combined)
		pipeR = nil
	}

	if err := cmd.Start(); err != nil {
		if pipeR != nil { pipeW.Close(); pipeR.Close() }
		block.Finish(false, fmt.Sprintf("failed to start: %s", err))
		return fmt.Errorf("tsuki-flash compile failed")
	}

	// Stream output lines live into the block
	if pipeR != nil {
		pipeW.Close() // close write-end in this process
		scanner := bufio.NewScanner(pipeR)
		for scanner.Scan() {
			line := scanner.Text()
			outBuf.WriteString(line + "\n")
			block.Line(line)
		}
		pipeR.Close()
	}

	cmdErr := cmd.Wait()
	outStr := strings.TrimSpace(outBuf.String())

	if cmdErr != nil {
		block.Finish(false, "compilation failed")
		if outStr != "" {
			renderTsukiFlashError(outStr)
		}
		return fmt.Errorf("tsuki-flash compile failed")
	}

	elapsed := ""
	block.Finish(true, elapsed)
	if opts.Verbose && outStr != "" {
		fmt.Print(outStr)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
//  Backend: arduino-cli
// ─────────────────────────────────────────────────────────────────────────────

func compileArduinoCLI(
	result *Result,
	board string,
	opts Options,
	sketchDir string,
	buildCacheDir string,
) error {
	fqbn, err := boardFQBN(board)
	if err != nil {
		return fmt.Errorf("unknown board %q — run `tsuki boards list`", board)
	}

	arduinoCLI := opts.ArduinoCLI
	if arduinoCLI == "" {
		arduinoCLI = "arduino-cli"
	}

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

	acliLabel := fmt.Sprintf("arduino-cli compile --fqbn %s", fqbn)
	acliBlock := ui.NewLiveBlock(acliLabel)
	acliBlock.Start()

	cmd := exec.Command(arduinoCLI, args...)
	cmd.Dir = sketchDir

	var acliOut strings.Builder
	acliPipeR, acliPipeW, acliPipeErr := os.Pipe()
	if acliPipeErr == nil {
		cmd.Stdout = acliPipeW
		cmd.Stderr = acliPipeW
	}

	if startErr := cmd.Start(); startErr != nil {
		if acliPipeR != nil { acliPipeW.Close(); acliPipeR.Close() }
		acliBlock.Finish(false, fmt.Sprintf("failed to start: %s", startErr))
		return fmt.Errorf("arduino-cli compile failed")
	}

	if acliPipeR != nil {
		acliPipeW.Close()
		acliScanner := bufio.NewScanner(acliPipeR)
		for acliScanner.Scan() {
			line := acliScanner.Text()
			acliOut.WriteString(line + "\n")
			acliBlock.Line(line)
		}
		acliPipeR.Close()
	}

	acliErr := cmd.Wait()
	if acliErr != nil {
		acliBlock.Finish(false, "compilation failed")
		renderArduinoError(acliOut.String())
		return fmt.Errorf("arduino-cli compile failed")
	}

	acliBlock.Finish(true, "")
	return nil
}
// writeInoStub creates <sketchDir>/<sketchName>.ino — the required entry
// point for arduino-cli. The stub must NOT #include the generated .cpp files:
// arduino-cli independently compiles every .cpp in the sketch directory as its
// own translation unit, so including them here causes duplicate setup()/loop()
// definitions and the linker exits with "ld returned 1 exit status".
func writeInoStub(sketchDir, sketchName string, _ []string) error {
	const stub = "// Auto-generated by tsuki — do not edit.\n" +
		"// arduino-cli compiles the .cpp files in this directory automatically.\n"
	return os.WriteFile(filepath.Join(sketchDir, sketchName+".ino"), []byte(stub), 0644)
}

// sanitizeSketchName converts a project name to a valid Arduino sketch name:
// only letters, digits, underscores; cannot start with a digit.
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

func newBuildCmd() *cobra.Command {
	var board string
	var output string
	var compile bool
	var verbose bool

	cmd := &cobra.Command{
		Use:   "build",
		Short: "Transpile and optionally compile the project",
		Example: `  tsuki build
  tsuki build --board esp32
  tsuki build --compile`,
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := projectDir()
			m, err := manifest.Load(dir)
			if err != nil {
				return err
			}

			opts := Options{
				Board:       board,
				Compile:     compile,
				OutputDir:   output,
				Verbose:     verbose,
				CoreBin:     cfg.CoreBinary,
				ArduinoCLI:  cfg.ArduinoCLI,
				FlashBinary: cfg.FlashBinary,
				Backend:     m.Backend,
				SourceMap:   m.Build.SourceMap,
			}

			res, err := Run(dir, m, opts)
			if err != nil {
				return err
			}
			if res.SketchDir != "" {
				ui.Info(fmt.Sprintf("Sketch: %s", res.SketchDir))
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

func renderTsukiFlashError(output string) {
	lines := strings.Split(output, "\n")
	var frames []ui.Frame
	var errMsg string

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		isErr := strings.HasPrefix(line, "✗") ||
			strings.Contains(line, "error:") ||
			strings.Contains(line, "Error:") ||
			strings.Contains(line, "failed:") ||
			strings.Contains(line, "Failed:") ||
			strings.Contains(line, "failed —") ||
			strings.Contains(line, "AVR SDK") ||
			strings.Contains(line, "SDK install") ||
			strings.Contains(line, "Some downloads")

		if isErr {
			if errMsg == "" {
				errMsg = strings.TrimPrefix(strings.TrimPrefix(strings.TrimPrefix(
					line, "✗ "), "error: "), "Error: ")
			}
			frames = append(frames, ui.Frame{
				File: "tsuki-flash", Func: "compile",
				Code: []ui.CodeLine{{Number: 0, Text: line, IsPointer: len(frames) == 0}},
			})
		}
	}

	if len(frames) == 0 {
		// Fallback: show first few non-empty lines
		errMsg = strings.TrimSpace(output)
		for i, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			frames = append(frames, ui.Frame{
				File: "tsuki-flash", Func: "compile",
				Code: []ui.CodeLine{{Number: 0, Text: line, IsPointer: i == 0}},
			})
			if len(frames) >= 5 {
				break
			}
		}
	}

	if len(frames) == 0 {
		frames = []ui.Frame{{
			File: "tsuki-flash", Func: "compile",
			Code: []ui.CodeLine{{Number: 0, Text: errMsg, IsPointer: true}},
		}}
	}
	ui.Traceback("CompileError", errMsg, frames)
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
		"uno":          "arduino:avr:uno",
		"nano":         "arduino:avr:nano",
		"mega":         "arduino:avr:mega",
		"leonardo":     "arduino:avr:leonardo",
		"micro":        "arduino:avr:micro",
		"due":          "arduino:sam:arduino_due_x",
		"mkr1000":      "arduino:samd:mkr1000",
		"esp32":        "esp32:esp32:esp32",
		"esp8266":      "esp8266:esp8266:generic",
		"pico":         "rp2040:rp2040:rpipico",
		"xiao_rp2040":  "rp2040:rp2040:seeed_xiao_rp2040",
		"teensy40":     "teensy:avr:teensy40",
	}
	fqbn, ok := table[strings.ToLower(id)]
	if !ok {
		return "", fmt.Errorf("unknown board")
	}
	return fqbn, nil
}