// ─────────────────────────────────────────────────────────────────────────────
//  godotino :: check  —  validate source files without building
// ─────────────────────────────────────────────────────────────────────────────

package check

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/godotino/cli/internal/core"
	"github.com/godotino/cli/internal/manifest"
	"github.com/godotino/cli/internal/ui"
)

// Options controls the check command.
type Options struct {
	Board   string
	Verbose bool
	CoreBin string
}

// Report holds the results of a check run.
type Report struct {
	Files    int
	Warnings []Issue
	Errors   []Issue
}

// Issue is a single warning or error found during check.
type Issue struct {
	File    string
	Line    int
	Message string
	IsError bool
}

// Run checks all .go files in the project src/ directory.
func Run(projectDir string, m *manifest.Manifest, opts Options) (*Report, error) {
	board := opts.Board
	if board == "" {
		board = m.Board
	}

	transpiler := core.New(opts.CoreBin, opts.Verbose)
	if !transpiler.Installed() {
		return nil, fmt.Errorf(
			"godotino-core not found — install it or set core_binary in your config",
		)
	}

	srcDir := filepath.Join(projectDir, "src")
	goFiles, err := filepath.Glob(filepath.Join(srcDir, "*.go"))
	if err != nil || len(goFiles) == 0 {
		return nil, fmt.Errorf("no .go files found in %s", srcDir)
	}

	ui.SectionTitle(fmt.Sprintf("Checking  [board: %s]", board))

	report := &Report{Files: len(goFiles)}

	for _, goFile := range goFiles {
		ui.Info(fmt.Sprintf("Checking %s…", filepath.Base(goFile)))

		srcBytes, err := os.ReadFile(goFile)
		if err != nil {
			return nil, fmt.Errorf("cannot read %s: %w", goFile, err)
		}

		// Convert []manifest.Package -> []string
		pkgNames := make([]string, 0, len(m.Packages))
		for _, p := range m.Packages {
			pkgNames = append(pkgNames, p.Name)
		}

		warnings, errors, err := transpiler.Check(
			string(srcBytes),
			filepath.Base(goFile),
			board,
			pkgNames,
		)

		for _, w := range warnings {
			report.Warnings = append(report.Warnings, Issue{
				File:    goFile,
				Message: w,
				IsError: false,
			})
		}

		for _, e := range errors {
			report.Errors = append(report.Errors, Issue{
				File:    goFile,
				Message: e,
				IsError: true,
			})
		}

		if err != nil {
			report.Errors = append(report.Errors, Issue{
				File:    goFile,
				Message: err.Error(),
				IsError: true,
			})
		}
	}

	return report, nil
}

// PrintReport renders the check report to stdout.
func PrintReport(report *Report) {
	fmt.Println()

	if len(report.Errors) == 0 && len(report.Warnings) == 0 {
		ui.Success(fmt.Sprintf("All %d file(s) OK — no errors or warnings", report.Files))
		return
	}

	if len(report.Warnings) > 0 {
		ui.SectionTitle(fmt.Sprintf("Warnings (%d)", len(report.Warnings)))
		for _, w := range report.Warnings {
			file := filepath.Base(w.File)
			if w.Line > 0 {
				ui.Warn(fmt.Sprintf("%s:%d  %s", file, w.Line, w.Message))
			} else {
				ui.Warn(fmt.Sprintf("%s  %s", file, w.Message))
			}
		}
	}

	if len(report.Errors) > 0 {
		ui.SectionTitle(fmt.Sprintf("Errors (%d)", len(report.Errors)))
		for _, e := range report.Errors {
			file := filepath.Base(e.File)
			if e.Line > 0 {
				ui.Fail(fmt.Sprintf("%s:%d  %s", file, e.Line, e.Message))
			} else {
				ui.Fail(fmt.Sprintf("%s  %s", file, e.Message))
			}
		}

		// Rich traceback for errors
		frames := make([]ui.Frame, 0, len(report.Errors))
		for _, e := range report.Errors {
			frames = append(frames, ui.Frame{
				File: e.File,
				Line: e.Line,
				Func: "check",
				Code: []ui.CodeLine{{Number: e.Line, Text: e.Message, IsPointer: true}},
			})
		}
		if len(frames) > 0 {
			fmt.Fprintln(os.Stderr, "")
			ui.Traceback("CheckError", fmt.Sprintf("%d error(s) found", len(report.Errors)), frames)
		}
	}

	// Summary line
	fmt.Println()
	summary := fmt.Sprintf("%d file(s) checked — %d error(s), %d warning(s)",
		report.Files, len(report.Errors), len(report.Warnings))
	if len(report.Errors) > 0 {
		ui.Fail(summary)
	} else {
		ui.Warn(summary)
	}

	_ = strings.TrimSpace
}
