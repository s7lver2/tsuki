// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: ui  —  shim over internal/tsukiux
//
//  Adapts the legacy 2-arg Step / SectionTitle API and exposes the inline
//  color helpers used by boards.go and config.go.
// ─────────────────────────────────────────────────────────────────────────────

package ui

import (
	"fmt"
	"strings"

	"github.com/tsuki-team/tsuki-ux/go/tsukiux"
)

// ── Re-exported types ─────────────────────────────────────────────────────────

type ConfigEntry = tsukiux.ConfigEntry
type Frame       = tsukiux.Frame
type CodeLine    = tsukiux.CodeLine

// ── Status primitives ─────────────────────────────────────────────────────────

func Success(msg string)  { tsukiux.Success(msg) }
func Fail(msg string)     { tsukiux.Fail(msg) }
func Warn(msg string)     { tsukiux.Warn(msg) }
func Info(msg string)     { tsukiux.Info(msg) }
func Note(msg string)     { tsukiux.Note(msg) }
func Header(title string) { tsukiux.Header(title) }

// Step adapts the legacy 2-arg API to tsukiux's single-arg Step.
func Step(label, msg string) {
	tsukiux.Step(label + "  →  " + msg)
}

// SectionTitle is the legacy name for tsukiux.Section.
func SectionTitle(title string) { tsukiux.Section(title) }
func SectionEnd()               { tsukiux.SectionEnd() }

func Artifact(name, size string) { tsukiux.Artifact(name, size) }
func ProgressBar(label string, done, total, width int) {
	tsukiux.ProgressBar(label, done, total, width)
}

func PrintConfig(title string, entries []ConfigEntry, raw bool) {
	tsukiux.PrintConfig(title, entries, raw)
}

func Traceback(errType, errMsg string, frames []Frame) {
	tsukiux.Traceback(errType, errMsg, frames)
}

func Box(title, content string) { tsukiux.Box(title, content) }

// ── LiveBlock ─────────────────────────────────────────────────────────────────

type LiveBlock = tsukiux.LiveBlock

func NewLiveBlock(label string) *LiveBlock { return tsukiux.NewLiveBlock(label) }

// ── Spinner ───────────────────────────────────────────────────────────────────
// Wraps LiveBlock — tsukiux has no separate Spinner type in Go.

type Spinner struct{ block *tsukiux.LiveBlock }

func NewSpinner(msg string) *Spinner {
	return &Spinner{block: tsukiux.NewLiveBlock(msg)}
}
func (s *Spinner) Start()                     { s.block.Start() }
func (s *Spinner) Stop(ok bool, msg string)   { s.block.Finish(ok, msg) }
func (s *Spinner) StopSilent()                { s.block.Finish(true, "") }

// ── Inline color helpers ──────────────────────────────────────────────────────
// Used for table-style output in boards.go and config.go.

type colorPrinter struct{ code string }

func (c colorPrinter) Sprint(s string) string {
	if tsukiux.IsTTY() {
		return c.code + s + "\033[0m"
	}
	return s
}

func (c colorPrinter) Sprintf(format string, a ...interface{}) string {
	return c.Sprint(fmt.Sprintf(format, a...))
}

func (c colorPrinter) Printf(format string, a ...interface{}) {
	if tsukiux.IsTTY() {
		fmt.Printf(c.code+format+"\033[0m", a...)
	} else {
		fmt.Printf(format, a...)
	}
}

func (c colorPrinter) Println(s string) {
	if tsukiux.IsTTY() {
		fmt.Println(c.code + s + "\033[0m")
	} else {
		fmt.Println(s)
	}
}

var (
	ColorTitle   = colorPrinter{"\033[1;97m"}
	ColorKey     = colorPrinter{"\033[96m"}
	ColorValue   = colorPrinter{"\033[93m"}
	ColorString  = colorPrinter{"\033[92m"}
	ColorNumber  = colorPrinter{"\033[94m"}
	ColorBool    = colorPrinter{"\033[95m"}
	ColorNull    = colorPrinter{"\033[90m"}
	ColorMuted   = colorPrinter{"\033[90m"}
	ColorSuccess = colorPrinter{"\033[1;92m"}
	ColorError   = colorPrinter{"\033[1;91m"}
	ColorWarn    = colorPrinter{"\033[1;93m"}
	ColorInfo    = colorPrinter{"\033[96m"}
)

// ── FlashBadge ────────────────────────────────────────────────────────────────

func FlashBadge(mode string) {
	if mode == "" || mode == "arduino-cli" {
		return
	}
	var label string
	normalized := strings.ToLower(strings.TrimSpace(mode))
	switch {
	case strings.Contains(normalized, "+cores") ||
		(strings.Contains(normalized, "tsuki-flash") && strings.Contains(normalized, "modules")):
		label = "⚡ tsuki-flash + cores"
	case strings.HasPrefix(normalized, "tsuki-flash"):
		label = "⚡ tsuki-flash"
	default:
		label = "⚡ " + mode
	}
	if tsukiux.IsTTY() {
		fmt.Printf("\033[1;93m  [ %s ]\033[0m\n", label)
	} else {
		fmt.Printf("  [ %s ]\n", label)
	}
}