// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: ui  —  rich terminal output
//  Inspired by Python's `rich` library: boxed panels, syntax-highlighted
//  tracebacks, colored key/value tables, spinners, and more.
// ─────────────────────────────────────────────────────────────────────────────

package ui

import (
	"fmt"
	"math"
	"os"
	"strings"
	"time"

	"github.com/fatih/color"
)

// ── Color palette ─────────────────────────────────────────────────────────────

var (
	// Primary
	ColorTitle    = color.New(color.FgHiWhite, color.Bold)
	ColorKey      = color.New(color.FgHiCyan)
	ColorValue    = color.New(color.FgHiYellow)
	ColorString   = color.New(color.FgHiGreen)
	ColorNumber   = color.New(color.FgHiBlue)
	ColorBool     = color.New(color.FgHiMagenta)
	ColorNull     = color.New(color.FgHiBlack)
	ColorComment  = color.New(color.FgHiBlack, color.Italic)

	// Status
	ColorSuccess = color.New(color.FgHiGreen, color.Bold)
	ColorError   = color.New(color.FgHiRed, color.Bold)
	ColorWarn    = color.New(color.FgHiYellow, color.Bold)
	ColorInfo    = color.New(color.FgHiCyan)
	ColorMuted   = color.New(color.FgHiBlack)

	// Traceback
	ColorTBBorder  = color.New(color.FgRed)
	ColorTBTitle   = color.New(color.FgHiRed, color.Bold)
	ColorTBFile    = color.New(color.FgHiCyan)
	ColorTBLine    = color.New(color.FgHiYellow)
	ColorTBFunc    = color.New(color.FgHiGreen)
	ColorTBCode    = color.New(color.FgHiWhite)
	ColorTBHigh    = color.New(color.FgHiRed, color.Bold)  // highlighted error line
	ColorTBLocals  = color.New(color.FgHiYellow)
	ColorTBErrType = color.New(color.FgHiRed, color.Bold)
	ColorTBErrMsg  = color.New(color.FgHiWhite)
)

// ── Box drawing ───────────────────────────────────────────────────────────────

func termWidth() int {
	// default 100 if we can't detect
	return 100
}

func hline(width int, ch string) string {
	if width <= 0 {
		return ""
	}
	return strings.Repeat(ch, width)
}

// Box draws a bordered panel with a title.
//
//	╭── Title ──────────────────────────────────╮
//	│  content...                               │
//	╰───────────────────────────────────────────╯
func Box(title, content string, titleColor *color.Color) {
	w := termWidth()
	inner := w - 2 // 2 for side borders

	// top border
	titleStr := " " + title + " "
	dashes := inner - len(titleStr) - 2
	left := dashes / 2
	right := dashes - left

	topLine := "╭" + hline(left, "─") + titleStr + hline(right, "─") + "╮"
	ColorTBBorder.Fprint(os.Stderr, "╭"+hline(left, "─"))
	if titleColor != nil {
		titleColor.Fprint(os.Stderr, titleStr)
	} else {
		fmt.Fprint(os.Stderr, titleStr)
	}
	_ = topLine
	ColorTBBorder.Fprintln(os.Stderr, hline(right, "─")+"╮")

	// content lines
	for _, line := range strings.Split(content, "\n") {
		// pad/truncate
		pad := inner - len(stripANSI(line)) - 1 // -1 for leading space
		if pad < 0 {
			pad = 0
		}
		ColorTBBorder.Fprint(os.Stderr, "│")
		fmt.Fprint(os.Stderr, " "+line+strings.Repeat(" ", pad))
		ColorTBBorder.Fprintln(os.Stderr, "│")
	}

	// bottom border
	ColorTBBorder.Fprintln(os.Stderr, "╰"+hline(inner, "─")+"╯")
}

// stripANSI removes escape sequences for length calculation.
func stripANSI(s string) string {
	var b strings.Builder
	inEsc := false
	for _, r := range s {
		if r == '\x1b' {
			inEsc = true
			continue
		}
		if inEsc {
			if r == 'm' {
				inEsc = false
			}
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// ── Traceback (rich-style) ────────────────────────────────────────────────────

// Frame represents one stack frame in a traceback.
type Frame struct {
	File     string
	Line     int
	Func     string
	Code     []CodeLine // surrounding source lines
	Locals   map[string]string
}

// CodeLine is one line of source context.
type CodeLine struct {
	Number    int
	Text      string
	IsPointer bool // the line that caused the error (marked with ❱)
}

// Traceback renders a rich-style traceback to stderr, mirroring the style
// in the reference screenshot (Python `rich` tracebacks).
//
// Example output:
//
//	╭─── Traceback (most recent call last) ──────────────────────╮
//	│  • main.go:21 in divide_all                                │
//	│                                                            │
//	│   19 │ try:                                               │
//	│   20 │   for n, d in divides:                            │
//	│ ❱ 21 │     result = divide_by(n, d)                      │
//	│   22 │     print(f"{n} / {d} = {result}")                │
//	│                                                            │
//	│  locals ─────────────────────────────────────────────     │
//	│  │  divides = [(1000, 200), ...]                          │
//	│  │  divisor = 0                                           │
//	╰────────────────────────────────────────────────────────────╯
//	ZeroDivisionError: division by zero
func Traceback(errType, errMsg string, frames []Frame) {
	w := termWidth()
	inner := w - 2

	var sb strings.Builder

	// ── header
	ColorTBBorder.Fprint(os.Stderr, "╭"+hline(3, "─"))
	ColorTBTitle.Fprint(os.Stderr, " Traceback (most recent call last) ")
	ColorTBBorder.Fprintln(os.Stderr, hline(inner-40, "─")+"╮")

	sb.Reset()

	printBorderLine := func(content string) {
		pad := inner - len(stripANSI(content)) - 1 // -1 for leading space
		if pad < 0 {
			pad = 0
		}
		ColorTBBorder.Fprint(os.Stderr, "│")
		fmt.Fprint(os.Stderr, " "+content+strings.Repeat(" ", pad))
		ColorTBBorder.Fprintln(os.Stderr, "│")
	}

	printEmpty := func() {
		ColorTBBorder.Fprint(os.Stderr, "│")
		fmt.Fprint(os.Stderr, strings.Repeat(" ", inner))
		ColorTBBorder.Fprintln(os.Stderr, "│")
	}

	for i, frame := range frames {
		_ = i
		// file + func title line
		fileStr := ColorTBFile.Sprint(frame.File) + ":" + ColorTBLine.Sprint(fmt.Sprintf("%d", frame.Line))
		funcStr := " in " + ColorTBFunc.Sprint(frame.Func)
		printBorderLine(fileStr + funcStr)
		printEmpty()

		// source lines
		for _, cl := range frame.Code {
			lineNum := fmt.Sprintf("%4d", cl.Number)
			if cl.IsPointer {
				prefix := ColorTBHigh.Sprint(" ❱ ")
				numStr := ColorTBHigh.Sprint(lineNum)
				sep := ColorTBBorder.Sprint(" │ ")
				code := ColorTBHigh.Sprint(cl.Text)
				printBorderLine(prefix + numStr + sep + code)
			} else {
				numStr := ColorMuted.Sprint(lineNum)
				sep := ColorTBBorder.Sprint(" │ ")
				code := ColorTBCode.Sprint(cl.Text)
				printBorderLine("   " + numStr + sep + code)
			}
		}

		// locals
		if len(frame.Locals) > 0 {
			printEmpty()
			locTitle := ColorTBLocals.Sprint(" locals ") + ColorTBBorder.Sprint(hline(inner-12, "─"))
			printBorderLine(locTitle)
			for k, v := range frame.Locals {
				localLine := ColorTBBorder.Sprint("│  ") + ColorKey.Sprint(k) + " = " + ColorValue.Sprint(v)
				printBorderLine(localLine)
			}
		}

		printEmpty()
	}

	ColorTBBorder.Fprintln(os.Stderr, "╰"+hline(inner, "─")+"╯")

	// error type + message
	ColorTBErrType.Fprint(os.Stderr, errType)
	fmt.Fprint(os.Stderr, ": ")
	ColorTBErrMsg.Fprintln(os.Stderr, errMsg)
}

// ── Config display ────────────────────────────────────────────────────────────

// ConfigEntry is one key/value row in the config display.
type ConfigEntry struct {
	Key     string
	Value   interface{}
	Comment string
}

// PrintConfig renders a styled config table.
// Supports --key, --param and --raw modes.
func PrintConfig(title string, entries []ConfigEntry, raw bool) {
	if raw {
		for _, e := range entries {
			fmt.Printf("%s = %v\n", e.Key, e.Value)
		}
		return
	}

	// ── Compute key column width ─────────────────────────────────────────────
	keyWidth := 0
	for _, e := range entries {
		if len(e.Key) > keyWidth {
			keyWidth = len(e.Key)
		}
	}

	// Build all lines first so we can measure the widest one.
	type renderedLine struct {
		display string // with ANSI colours
		plain   string // stripped, for width calculation
	}
	lines := make([]renderedLine, 0, len(entries))
	for _, e := range entries {
		keyStr := ColorKey.Sprint(fmt.Sprintf("%-*s", keyWidth, e.Key))
		sep := ColorMuted.Sprint("  =  ")
		valStr := formatConfigValue(e.Value)
		display := keyStr + sep + valStr
		plain := fmt.Sprintf("%-*s  =  %v", keyWidth, e.Key, e.Value)
		if e.Comment != "" {
			comment := "  # " + e.Comment
			display += ColorComment.Sprint(comment)
			plain += comment
		}
		lines = append(lines, renderedLine{display: display, plain: plain})
	}

	// inner width = max(terminal width − 2, longest line + 2 side spaces)
	minInner := len(title) + 6 // header must fit the title at minimum
	for _, l := range lines {
		if n := len(l.plain) + 2; n > minInner {
			minInner = n
		}
	}
	w := termWidth()
	inner := w - 2
	if minInner > inner {
		inner = minInner
	}

	// ── Header ───────────────────────────────────────────────────────────────
	ColorTBBorder.Fprint(os.Stdout, "╭"+hline(2, "─"))
	ColorTitle.Fprint(os.Stdout, " "+title+" ")
	ColorTBBorder.Fprintln(os.Stdout, hline(inner-len(title)-4, "─")+"╮")

	printLine := func(rl renderedLine) {
		// 1 space before content + 1 space after = 2 side margins
		pad := inner - len(rl.plain) - 1 // -1 for the leading space
		if pad < 0 {
			pad = 0
		}
		ColorTBBorder.Fprint(os.Stdout, "│")
		fmt.Fprint(os.Stdout, " "+rl.display+strings.Repeat(" ", pad))
		ColorTBBorder.Fprintln(os.Stdout, "│")
	}
	printEmpty := func() {
		ColorTBBorder.Fprint(os.Stdout, "│")
		fmt.Fprint(os.Stdout, strings.Repeat(" ", inner))
		ColorTBBorder.Fprintln(os.Stdout, "│")
	}
	_ = printEmpty

	for _, l := range lines {
		printLine(l)
	}

	ColorTBBorder.Fprintln(os.Stdout, "╰"+hline(inner, "─")+"╯")
}

func formatConfigValue(v interface{}) string {
	switch val := v.(type) {
	case string:
		return ColorString.Sprint(`"` + val + `"`)
	case bool:
		return ColorBool.Sprint(fmt.Sprintf("%v", val))
	case int, int64, float64:
		return ColorNumber.Sprint(fmt.Sprintf("%v", val))
	case []interface{}:
		if len(val) == 0 {
			return ColorNull.Sprint("[]")
		}
		parts := make([]string, len(val))
		for i, item := range val {
			parts[i] = formatConfigValue(item)
		}
		return "[" + strings.Join(parts, ", ") + "]"
	case nil:
		return ColorNull.Sprint("null")
	default:
		return ColorValue.Sprint(fmt.Sprintf("%v", val))
	}
}

// ── Status messages ───────────────────────────────────────────────────────────

func Success(msg string) {
	ColorSuccess.Fprint(os.Stdout, "  ✓ ")
	fmt.Fprintln(os.Stdout, msg)
}

func Fail(msg string) {
	ColorError.Fprint(os.Stderr, "  ✗ ")
	fmt.Fprintln(os.Stderr, msg)
}

func Info(msg string) {
	ColorInfo.Fprint(os.Stdout, "  • ")
	fmt.Fprintln(os.Stdout, msg)
}

func Warn(msg string) {
	ColorWarn.Fprint(os.Stdout, "  ⚠ ")
	fmt.Fprintln(os.Stdout, msg)
}

func Step(label, msg string) {
	ColorMuted.Fprint(os.Stdout, "  ")
	ColorTitle.Fprint(os.Stdout, label)
	ColorMuted.Fprint(os.Stdout, " → ")
	fmt.Fprintln(os.Stdout, msg)
}

// SectionTitle prints a section header.
func SectionTitle(title string) {
	w := termWidth()
	pad := w - len(title) - 4
	if pad < 0 {
		pad = 0
	}
	ColorMuted.Fprintln(os.Stdout, "")
	ColorTitle.Fprint(os.Stdout, "  "+title+"  ")
	ColorMuted.Fprintln(os.Stdout, hline(pad, "─"))
}

// ── Spinner ───────────────────────────────────────────────────────────────────

type Spinner struct {
	msg    string
	frames []string
	done   chan struct{}
}

var spinnerFrames = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}

func NewSpinner(msg string) *Spinner {
	return &Spinner{msg: msg, frames: spinnerFrames, done: make(chan struct{})}
}

func (s *Spinner) Start() {
	// If stdout is not a real TTY (e.g. piped through the IDE), \r does not
	// overwrite the current line — every frame becomes a new line, flooding
	// the output.  In that case we print a single static status line and skip
	// the animation entirely.
	fi, err := os.Stdout.Stat()
	isTTY := err == nil && (fi.Mode()&os.ModeCharDevice) != 0
	if !isTTY {
		fmt.Fprintf(os.Stdout, "  …  %s\n", s.msg)
		return
	}
	go func() {
		i := 0
		for {
			select {
			case <-s.done:
				fmt.Fprintf(os.Stdout, "\r%-80s\r", "")
				return
			default:
				frame := ColorInfo.Sprint(s.frames[i%len(s.frames)])
				fmt.Fprintf(os.Stdout, "\r  %s  %s", frame, s.msg)
				time.Sleep(80 * time.Millisecond)
				i++
			}
		}
	}()
}

func (s *Spinner) Stop(ok bool, finalMsg string) {
	// Only close the channel (and wait for the goroutine) if we actually
	// started the animation — i.e. when running in a real TTY.
	fi, err := os.Stdout.Stat()
	isTTY := err == nil && (fi.Mode()&os.ModeCharDevice) != 0
	if isTTY {
		close(s.done)
		time.Sleep(100 * time.Millisecond)
	}
	if ok {
		Success(finalMsg)
	} else {
		Fail(finalMsg)
	}
}

// StopSilent stops the spinner animation and erases its line without printing
// a final message. Used by LiveBlock which handles its own final output.
func (s *Spinner) StopSilent() {
	fi, err := os.Stdout.Stat()
	isTTY := err == nil && (fi.Mode()&os.ModeCharDevice) != 0
	if isTTY {
		close(s.done)
		time.Sleep(100 * time.Millisecond)
		fmt.Fprintf(os.Stdout, "\r\033[K") // erase the spinner line
	}
}

// ── Flash Backend Badge ───────────────────────────────────────────────────────
// FlashBadge prints a bold orange inline tag showing the active flash backend.
// Printed before the "Compiling" / "Uploading" section titles.
//
// "tsuki-flash"       → [⚡ tsuki-flash]
// "tsuki-flash+cores" → [⚡ tsuki-flash + cores]
// "arduino-cli" / ""  → silent
func FlashBadge(mode string) {
	if mode == "" || mode == "arduino-cli" {
		return
	}

	// Bold orange — FgHiYellow looks orange in most terminal themes.
	orange := color.New(color.FgHiYellow, color.Bold)

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

	orange.Fprintf(os.Stdout, "  [ %s ]\n", label)
}

// ── Progress bar ──────────────────────────────────────────────────────────────

func ProgressBar(label string, done, total int) {
	w := 40
	pct := float64(done) / float64(total)
	filled := int(math.Round(float64(w) * pct))
	bar := ColorSuccess.Sprint(strings.Repeat("█", filled)) +
		ColorMuted.Sprint(strings.Repeat("░", w-filled))
	fmt.Printf("  %s  [%s]  %d%%\n", label, bar, int(pct*100))
}
// ── LiveBlock: Docker-style collapsible command output ────────────────────────
//
// Usage:
//
//	b := ui.NewLiveBlock("tsuki-flash compile --board nano")
//	b.Start()
//	// ... stream lines ...
//	b.Line("compiling main.cpp...")
//	b.Finish(true, "compiled in 3.2s")   // collapses on success
//	b.Finish(false, "compile failed")     // keeps output expanded on error
//
// Success (collapsed):
//
//	✓ tsuki-flash compile --board nano  [3.2s]
//
// Failure (expanded):
//
//	✗ tsuki-flash compile --board nano
//	│  compiling main.cpp...
//	│  error: DHT.h not found
//	╰─ exit 1

var (
	colorLiveLabel  = color.New(color.FgHiWhite)
	colorLiveLine   = color.New(color.FgHiBlack)        // dimmed — secondary info
	colorLiveBorder = color.New(color.FgHiBlack)
	colorLiveTime   = color.New(color.FgHiBlack, color.Italic)
)

// LiveBlock manages a collapsible command-output block.
type LiveBlock struct {
	label    string
	lines    []string
	start    time.Time
	spinner  *Spinner
	isTTY    bool
}

// NewLiveBlock creates a new block with the given header label.
func NewLiveBlock(label string) *LiveBlock {
	fi, err := os.Stdout.Stat()
	isTTY := err == nil && (fi.Mode()&os.ModeCharDevice) != 0
	return &LiveBlock{label: label, start: time.Now(), isTTY: isTTY}
}

// Start prints the spinning header line.
func (b *LiveBlock) Start() {
	b.spinner = NewSpinner(colorLiveLabel.Sprint(b.label))
	b.spinner.Start()
}

// Line buffers a line of output.
// If running in a TTY the line is printed live (dimmed) below the spinner.
func (b *LiveBlock) Line(s string) {
	b.lines = append(b.lines, s)
	if b.isTTY && s != "" {
		// Print below the spinner using a simple newline then reposition
		fmt.Fprintf(os.Stdout, "\r  \033[2m│  %s\033[0m\033[K\n", truncate(s, termWidth()-6))
	}
}

// Finish collapses (ok=true) or expands (ok=false) the block.
func (b *LiveBlock) Finish(ok bool, summary string) {
	elapsed := time.Since(b.start)

	// Stop the spinner and erase its line.
	if b.spinner != nil {
		b.spinner.StopSilent()
	}

	// On success: single collapsed line
	if ok {
		timeStr := formatElapsed(elapsed)
		if summary != "" {
			ColorSuccess.Fprint(os.Stdout, "  ✓ ")
			colorLiveLabel.Fprint(os.Stdout, b.label)
			colorLiveTime.Fprintf(os.Stdout, "  [%s]\n", timeStr)
		} else {
			ColorSuccess.Fprint(os.Stdout, "  ✓ ")
			colorLiveLabel.Fprintln(os.Stdout, b.label)
		}
		// On success, discard buffered lines (they collapse)
		return
	}

	// On failure: print header + all buffered lines + footer
	ColorError.Fprint(os.Stdout, "  ✗ ")
	colorLiveLabel.Fprintln(os.Stdout, b.label)

	// If lines were already printed live in TTY mode, they're already on screen
	// and we just need the footer. In non-TTY mode, print them now.
	if !b.isTTY {
		for _, l := range b.lines {
			if l != "" {
				colorLiveBorder.Fprint(os.Stdout, "  │  ")
				colorLiveLine.Fprintln(os.Stdout, truncate(l, termWidth()-6))
			}
		}
	}
	colorLiveBorder.Fprintf(os.Stdout, "  ╰─ %s\n", summary)
}

func truncate(s string, max int) string {
	if max <= 3 || len(s) <= max {
		return s
	}
	return s[:max-3] + "…"
}

func formatElapsed(d time.Duration) string {
	if d < time.Second {
		return fmt.Sprintf("%dms", d.Milliseconds())
	}
	return fmt.Sprintf("%.1fs", d.Seconds())
}