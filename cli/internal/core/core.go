// ─────────────────────────────────────────────────────────────────────────────
//  godotino :: core  (updated)
//  Shell-out to godotino-core with --libs-dir and --packages support.
// ─────────────────────────────────────────────────────────────────────────────

package core

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/godotino/cli/internal/ui"
)

const defaultBinary = "godotino-core"

// Transpiler wraps the godotino-core binary.
type Transpiler struct {
	binary  string
	verbose bool
}

func New(binary string, verbose bool) *Transpiler {
	if binary == "" {
		binary = defaultBinary
	}
	return &Transpiler{binary: binary, verbose: verbose}
}

// TranspileRequest bundles all parameters for a single transpilation run.
type TranspileRequest struct {
	InputFile  string
	OutputFile string
	Board      string
	SourceMap  bool
	// Optional: root directory where external libs are installed.
	// Passed as --libs-dir to godotino-core.
	LibsDir  string
	// Optional: names of packages declared in goduino.json.
	// Passed as --packages ws2812,dht to godotino-core.
	PkgNames []string
}

// TranspileResult holds the output of a transpilation run.
type TranspileResult struct {
	OutputFile string
	Warnings   []string
}

// Transpile transpiles a single .go file to C++.
func (t *Transpiler) Transpile(req TranspileRequest) (*TranspileResult, error) {
	args := []string{req.InputFile, req.OutputFile, "--board", req.Board}

	if req.SourceMap {
		args = append(args, "--source-map")
	}

	// Pass library info to core
	if req.LibsDir != "" {
		args = append(args, "--libs-dir", req.LibsDir)
	}
	if len(req.PkgNames) > 0 {
		args = append(args, "--packages", strings.Join(req.PkgNames, ","))
	}

	cmd := exec.Command(t.binary, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if t.verbose {
		ui.Step("core", strings.Join(append([]string{t.binary}, args...), " "))
	}

	if err := cmd.Run(); err != nil {
		errOutput := stderr.String()
		if errOutput != "" {
			renderCoreError(errOutput, req.InputFile)
		}
		return nil, fmt.Errorf("transpilation failed: %w", err)
	}

	return &TranspileResult{
		OutputFile: req.OutputFile,
		Warnings:   parseWarnings(stderr.String()),
	}, nil
}

// Check validates a .go source file without producing output.
func (t *Transpiler) Check(inputFile, board, libsDir string, pkgNames []string) ([]string, []string, error) {
	args := []string{inputFile, "--board", board, "--check"}
	if libsDir != "" {
		args = append(args, "--libs-dir", libsDir)
	}
	if len(pkgNames) > 0 {
		args = append(args, "--packages", strings.Join(pkgNames, ","))
	}

	cmd := exec.Command(t.binary, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	combined := stdout.String() + stderr.String()

	warnings := parseWarnings(combined)
	errors   := parseErrors(stderr.String())

	if err != nil {
		return warnings, errors, fmt.Errorf("check failed")
	}
	return warnings, errors, nil
}

// Version returns the version string of the core binary.
func (t *Transpiler) Version() (string, error) {
	out, err := exec.Command(t.binary, "--version").Output()
	if err != nil {
		return "", fmt.Errorf("cannot run %s: %w", t.binary, err)
	}
	return strings.TrimSpace(string(out)), nil
}

// Installed reports whether the core binary is on PATH.
func (t *Transpiler) Installed() bool {
	_, err := exec.LookPath(t.binary)
	return err == nil
}

// ── Error rendering ───────────────────────────────────────────────────────────

func renderCoreError(raw, inputFile string) {
	lines := strings.Split(raw, "\n")
	var errType, errMsg string
	var frames []ui.Frame
	var currentFrame *ui.Frame
	var codeLines []ui.CodeLine
	var errorLineNum int

	for _, line := range lines {
		line = strings.TrimRight(line, "\r")

		if strings.HasPrefix(line, "error") {
			parts := strings.SplitN(line, ": ", 2)
			errType = parts[0]
			if len(parts) > 1 {
				errMsg = parts[1]
			}
			continue
		}

		if strings.Contains(line, "-->") {
			if currentFrame != nil {
				currentFrame.Code = codeLines
				frames = append(frames, *currentFrame)
			}
			loc := strings.TrimSpace(strings.TrimPrefix(line, "-->"))
			parts := strings.Split(loc, ":")
			frame := ui.Frame{File: inputFile, Func: "main"}
			if len(parts) >= 1 { frame.File = parts[0] }
			if len(parts) >= 2 {
				fmt.Sscanf(parts[1], "%d", &errorLineNum)
				frame.Line = errorLineNum
			}
			codeLines = []ui.CodeLine{}
			currentFrame = &frame
			continue
		}

		if currentFrame != nil {
			trimmed := strings.TrimSpace(line)
			if len(trimmed) > 0 && trimmed[0] != '|' && trimmed[0] != '^' {
				var lineNum int
				if _, err := fmt.Sscanf(trimmed, "%d |", &lineNum); err == nil {
					pipeIdx := strings.Index(line, "|")
					rest := line
					if pipeIdx >= 0 && pipeIdx+1 < len(line) {
						rest = line[pipeIdx+1:]
					}
					codeLines = append(codeLines, ui.CodeLine{
						Number:    lineNum,
						Text:      rest,
						IsPointer: lineNum == errorLineNum,
					})
				}
			}
		}
	}

	if currentFrame != nil {
		currentFrame.Code = codeLines
		frames = append(frames, *currentFrame)
	}
	if errType == "" {
		errType = "TranspileError"
		errMsg  = strings.TrimSpace(raw)
	}
	if len(frames) == 0 {
		frames = []ui.Frame{{
			File: inputFile, Line: 0, Func: "transpile",
			Code: []ui.CodeLine{{Number: 0, Text: errMsg, IsPointer: true}},
		}}
	}

	ui.Traceback(errType, errMsg, frames)
	_ = os.Stderr
}

func parseWarnings(output string) []string {
	var w []string
	for _, line := range strings.Split(output, "\n") {
		if strings.Contains(strings.ToLower(line), "warning") {
			w = append(w, strings.TrimSpace(line))
		}
	}
	return w
}

func parseErrors(output string) []string {
	var e []string
	for _, line := range strings.Split(output, "\n") {
		if strings.Contains(strings.ToLower(line), "error") {
			e = append(e, strings.TrimSpace(line))
		}
	}
	return e
}