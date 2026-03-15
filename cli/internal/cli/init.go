// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: cli :: init  —  interactive project wizard
//
//  Styled after Astro's `create astro` experience:
//    • Animated intro banner
//    • Step-by-step prompts with arrow-key selection (raw terminal mode)
//    • Inline colour coding: cyan = question, green = selected, dim = hint
//    • Final "next steps" summary with copy-paste commands
// ─────────────────────────────────────────────────────────────────────────────

package cli

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/tsuki/cli/internal/manifest"
	"github.com/tsuki/cli/internal/ui"
)

// ── Color aliases for the wizard ─────────────────────────────────────────────

var (
	wCyan    = color.New(color.FgCyan, color.Bold)
	wGreen   = color.New(color.FgHiGreen, color.Bold)
	wYellow  = color.New(color.FgHiYellow)
	wDim     = color.New(color.FgHiBlack)
	wBold    = color.New(color.FgHiWhite, color.Bold)
	wMagenta = color.New(color.FgHiMagenta, color.Bold)
)

// ── Language choices ──────────────────────────────────────────────────────────

type langChoice struct {
	id   string
	name string
	note string
}

var langChoices = []langChoice{
	{"go",     "Go  ❆",       "statically typed · compiled · fast"},
	{"python", "Python  🐍",  "dynamic · readable · tsuki transpiles Python → C++"},
	{"cpp",    "C++",          "native Arduino C++ · full control"},
	{"ino",    "Arduino",      "classic .ino sketch · beginner-friendly"},
}

// ── Board catalog ─────────────────────────────────────────────────────────────

type boardChoice struct {
	id   string
	name string
	note string
}

var boardChoices = []boardChoice{
	{"uno", "Arduino Uno", "ATmega328P · 16 MHz · 32 KB"},
	{"nano", "Arduino Nano", "ATmega328P · 16 MHz · compact"},
	{"mega", "Arduino Mega 2560", "ATmega2560 · 16 MHz · 256 KB"},
	{"leonardo", "Arduino Leonardo", "ATmega32u4 · 16 MHz · native USB"},
	{"micro", "Arduino Micro", "ATmega32u4 · 16 MHz · native USB"},
	{"pro_mini_5v", "Pro Mini 5 V", "ATmega328P · 16 MHz · breadboard"},
	{"esp32", "ESP32 Dev Module", "Dual-core · 240 MHz · WiFi + BT"},
	{"esp8266", "ESP8266 Generic", "Single-core · 80 MHz · WiFi"},
	{"d1_mini", "Wemos D1 Mini", "ESP8266 · compact · popular"},
	{"pico",        "Raspberry Pi Pico",  "RP2040 · 133 MHz · 2 MB"},
	{"xiao_rp2040",  "Seeed XIAO RP2040",  "RP2040 · 133 MHz · 2 MB · tiny"},
}

// ── Compiler backend choices ──────────────────────────────────────────────────

type backendChoice struct {
	id   string
	name string
	note string
}

var backendChoices = []backendChoice{
	{"tsuki-flash", "tsuki-flash  ✦ recommended", "fast · parallel · needs existing .arduino15 cores"},
	{"tsuki-flash+cores", "tsuki-flash + cores  ✦ fully standalone", "auto-downloads SDK · zero arduino-cli dependency"},
	{"arduino-cli", "arduino-cli", "classic · requires arduino-cli install"},
}

// ── Template choices ──────────────────────────────────────────────────────────

type templateChoice struct {
	id   string
	name string
	code string
}

// templateChoice holds starter code indexed by language.
type templateChoiceEntry struct {
	id      string
	name    string
	default_ map[string]string // lang -> code
}

var templateChoices = []templateChoice{
	{
		id:   "blink",
		name: "Blink  (LED)",
		code: `package main

import "arduino"

func setup() {
	arduino.PinMode(arduino.LED_BUILTIN, arduino.OUTPUT)
}

func loop() {
	arduino.DigitalWrite(arduino.LED_BUILTIN, arduino.HIGH)
	arduino.Delay(500)
	arduino.DigitalWrite(arduino.LED_BUILTIN, arduino.LOW)
	arduino.Delay(500)
}
`,
	},
	{
		id:   "serial",
		name: "Serial Hello",
		code: `package main

import "arduino"

func setup() {
	arduino.SerialBegin(9600)
}

func loop() {
	arduino.SerialPrintln("Hello from tsuki!")
	arduino.Delay(1000)
}
`,
	},
	{
		id:   "empty",
		name: "Empty project",
		code: `package main

import "arduino"

func setup() {
}

func loop() {
}
`,
	},
}

// templateChoicesCpp contains starter C++ templates.
var templateChoicesCpp = []templateChoice{
	{
		id:   "blink",
		name: "Blink  (LED)",
		code: `#include <Arduino.h>

void setup() {
    pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
    digitalWrite(LED_BUILTIN, HIGH);
    delay(500);
    digitalWrite(LED_BUILTIN, LOW);
    delay(500);
}
`,
	},
	{
		id:   "serial",
		name: "Serial Hello",
		code: `#include <Arduino.h>

void setup() {
    Serial.begin(9600);
}

void loop() {
    Serial.println("Hello from tsuki!");
    delay(1000);
}
`,
	},
	{
		id:   "empty",
		name: "Empty project",
		code: `#include <Arduino.h>

void setup() {
}

void loop() {
}
`,
	},
}

// templateChoicesIno contains starter .ino templates.
var templateChoicesIno = []templateChoice{
	{
		id:   "blink",
		name: "Blink  (LED)",
		code: `void setup() {
    pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
    digitalWrite(LED_BUILTIN, HIGH);
    delay(500);
    digitalWrite(LED_BUILTIN, LOW);
    delay(500);
}
`,
	},
	{
		id:   "serial",
		name: "Serial Hello",
		code: `void setup() {
    Serial.begin(9600);
}

void loop() {
    Serial.println("Hello from tsuki!");
    delay(1000);
}
`,
	},
	{
		id:   "empty",
		name: "Empty project",
		code: `void setup() {
}

void loop() {
}
`,
	},
}

// templateChoicesPython contains starter Python templates.
var templateChoicesPython = []templateChoice{
	{
		id:   "blink",
		name: "Blink  (LED)",
		code: `import arduino
import time

LED_PIN: int = 13

def setup():
    arduino.pinMode(LED_PIN, arduino.OUTPUT)

def loop():
    arduino.digitalWrite(LED_PIN, arduino.HIGH)
    time.sleep(500 * time.Millisecond)
    arduino.digitalWrite(LED_PIN, arduino.LOW)
    time.sleep(500 * time.Millisecond)
`,
	},
	{
		id:   "serial",
		name: "Serial Hello",
		code: `import arduino
import time

def setup():
    arduino.Serial.begin(9600)

def loop():
    print("Hello from tsuki!")
    time.sleep(1000 * time.Millisecond)
`,
	},
	{
		id:   "empty",
		name: "Empty project",
		code: `import arduino

def setup():
    pass

def loop():
    pass
`,
	},
}

// templatesForLang returns the right set of templates for the selected language.
func templatesForLang(langID string) []templateChoice {
	switch langID {
	case "python":
		return templateChoicesPython
	case "cpp":
		return templateChoicesCpp
	case "ino":
		return templateChoicesIno
	default:
		return templateChoices
	}
}

// ─────────────────────────────────────────────────────────────────────────────
//  Command
// ─────────────────────────────────────────────────────────────────────────────

func newInitCmd() *cobra.Command {
	var (
		flagBoard    string
		flagName     string
		flagYes      bool
		flagBackend  string
		flagLanguage string
	)

	cmd := &cobra.Command{
		Use:   "init [project-name]",
		Short: "Initialize a new tsuki project",
		Args:  cobra.MaximumNArgs(1),
		Example: `  tsuki init
  tsuki init my-robot
  tsuki init my-robot --board esp32 --yes`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) > 0 {
				flagName = args[0]
			}
			return runWizard(flagName, flagBoard, flagBackend, flagLanguage, flagYes)
		},
	}

	cmd.Flags().StringVarP(&flagBoard, "board", "b", "", "skip board prompt")
	cmd.Flags().StringVarP(&flagName, "name", "n", "", "skip name prompt")
	cmd.Flags().StringVar(&flagBackend, "backend", "", "compiler backend: tsuki-flash or arduino-cli")
	cmd.Flags().StringVarP(&flagLanguage, "language", "l", "", "programming language (go)")
	cmd.Flags().BoolVarP(&flagYes, "yes", "y", false, "accept all defaults")
	return cmd
}

// ─────────────────────────────────────────────────────────────────────────────
//  Wizard runner
// ─────────────────────────────────────────────────────────────────────────────

func runWizard(prefillName, prefillBoard, prefillBackend, prefillLanguage string, acceptDefaults bool) error {
	printIntro()

	reader := bufio.NewReader(os.Stdin)

	// ── 1. Project name ────────────────────────────────────────────────────
	var projectName string
	if prefillName != "" {
		projectName = prefillName
		stepDone(1, "Project name", projectName)
	} else if acceptDefaults {
		projectName = "my-tsuki-project"
		stepDone(1, "Project name", projectName+" (default)")
	} else {
		projectName = promptText(reader, 1, "What should we call your project?", "my-tsuki-project")
	}
	projectName = sanitizeName(projectName)

	// ── 2. Language ─────────────────────────────────────────────────────────
	var lang langChoice
	if prefillLanguage != "" {
		lang = findLangChoice(prefillLanguage)
		stepDone(2, "Language", lang.name)
	} else if acceptDefaults {
		lang = langChoices[0]
		stepDone(2, "Language", lang.name+" (default)")
	} else {
		idx := promptArrowSelect(2, "Which language do you want to use?", langChoicesLabels(), 0)
		lang = langChoices[idx]
	}

	// ── 3. Board ────────────────────────────────────────────────────────────
	var board boardChoice
	if prefillBoard != "" {
		board = findBoardChoice(prefillBoard)
		stepDone(3, "Target board", board.name)
	} else if acceptDefaults {
		board = boardChoices[0]
		stepDone(3, "Target board", board.name+" (default)")
	} else {
		idx := promptArrowSelect(3, "Which board are you targeting?", boardChoicesLabels(), 0)
		board = boardChoices[idx]
	}

	// ── 4. Compiler backend ─────────────────────────────────────────────────
	var backend backendChoice
	if prefillBackend != "" {
		backend = findBackendChoice(prefillBackend)
		stepDone(4, "Compiler backend", backend.name)
	} else if acceptDefaults {
		backend = backendChoices[0]
		stepDone(4, "Compiler backend", backend.name+" (default)")
	} else {
		idx := promptArrowSelect(4, "Which compiler backend?", backendChoicesLabels(), 0)
		backend = backendChoices[idx]
	}

	// ── 5. Starter template ─────────────────────────────────────────────────
	var tmpl templateChoice
	templates := templatesForLang(lang.id)
	if acceptDefaults {
		tmpl = templates[0]
		stepDone(5, "Starter template", tmpl.name+" (default)")
	} else {
		idx := promptArrowSelect(5, "How should we start your project?", templateLabelsFor(templates), 0)
		tmpl = templates[idx]
	}

	// ── 6. Git init ──────────────────────────────────────────────────────────
	gitInit := true
	if !acceptDefaults {
		gitInit = promptYesNo(reader, 6, "Initialize a git repository?", true)
	} else {
		stepDone(6, "Git repository", "yes (default)")
	}

	// ── Scaffold ─────────────────────────────────────────────────────────────
	fmt.Println()
	printLine()
	fmt.Println()

	return scaffold(projectName, lang, board, backend, tmpl, gitInit)
}

// ─────────────────────────────────────────────────────────────────────────────
//  Scaffold
// ─────────────────────────────────────────────────────────────────────────────

func scaffold(name string, lang langChoice, board boardChoice, backend backendChoice, tmpl templateChoice, gitInit bool) error {
	dir := filepath.Join(projectDir(), name)
	srcDir := filepath.Join(dir, "src")

	var mainFile string
	switch lang.id {
	case "cpp":
		mainFile = "main.cpp"
	case "ino":
		mainFile = name + ".ino"
	case "python":
		mainFile = "main.py"
	default:
		mainFile = "main.go"
	}

	steps := []struct {
		label string
		fn    func() error
	}{
		{"Creating project directory", func() error { return os.MkdirAll(srcDir, 0755) }},
		{"Writing tsuki_package.json", func() error {
			m := manifest.DefaultWithLanguage(name, board.id, lang.id)
			m.Backend = backend.id
			return m.Save(dir)
		}},
		{fmt.Sprintf("Writing src/%s", mainFile), func() error {
			p := filepath.Join(srcDir, mainFile)
			if _, err := os.Stat(p); os.IsNotExist(err) {
				return os.WriteFile(p, []byte(tmpl.code), 0644)
			}
			return nil
		}},
		{"Writing .gitignore", func() error {
			p := filepath.Join(dir, ".gitignore")
			if _, err := os.Stat(p); os.IsNotExist(err) {
				return os.WriteFile(p, []byte("build/\n*.hex\n*.bin\n*.uf2\n.tsuki-cache.json\n"), 0644)
			}
			return nil
		}},
	}

	if gitInit {
		steps = append(steps, struct {
			label string
			fn    func() error
		}{"Initializing git repository", func() error {
			if _, err := os.Stat(filepath.Join(dir, ".git")); os.IsNotExist(err) {
				return exec.Command("git", "-C", dir, "init", "-q").Run()
			}
			return nil
		}})
	}

	for _, step := range steps {
		sp := ui.NewSpinner(step.label)
		sp.Start()
		time.Sleep(60 * time.Millisecond)
		if err := step.fn(); err != nil {
			sp.Stop(false, step.label)
			return err
		}
		sp.Stop(true, step.label)
	}

	printSuccess(name, lang, board, backend)
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
//  Arrow-key interactive select (raw terminal mode)
// ─────────────────────────────────────────────────────────────────────────────

// promptArrowSelect shows a live arrow-key navigable menu.
// Falls back to a numbered list when stdin is not a TTY (e.g. pipes, CI).
func promptArrowSelect(stepNum int, question string, choices []string, defaultIdx int) int {
	stepLabel(stepNum, question)
	fmt.Println()

	// ── Non-interactive fallback ──────────────────────────────────────────
	if !isatty() {
		for i, c := range choices {
			if i == defaultIdx {
				wGreen.Printf("   %s %d. %s\n", "●", i+1, c)
			} else {
				wDim.Printf("   %s %d. %s\n", "○", i+1, c)
			}
		}
		wDim.Printf("\n   Enter number")
		wCyan.Printf(" [1-%d]", len(choices))
		wDim.Printf(" (default %d)\n", defaultIdx+1)
		wCyan.Print("   › ")

		reader := bufio.NewReader(os.Stdin)
		line, _ := reader.ReadString('\n')
		line = strings.TrimSpace(line)
		idx := defaultIdx
		if line != "" {
			var n int
			if _, err := fmt.Sscanf(line, "%d", &n); err == nil && n >= 1 && n <= len(choices) {
				idx = n - 1
			}
		}
		fmt.Println()
		stepDone(stepNum, question, choices[idx])
		return idx
	}

	// ── Raw-mode setup (portable via golang.org/x/term) ───────────────────
	fd := int(os.Stdin.Fd())
	oldState, err := term.MakeRaw(fd)
	if err != nil {
		// Can't enter raw mode — fall through to the fallback above would be
		// ideal, but we already printed the question header. Return default.
		return defaultIdx
	}
	// NOTE: defer won't fire on os.Exit, so we call term.Restore explicitly
	// in the Ctrl-C branch before exiting.
	defer term.Restore(fd, oldState) //nolint:errcheck

	// Hide cursor while navigating.
	fmt.Print("\033[?25l")
	defer fmt.Print("\033[?25h")

	cur := defaultIdx
	n := len(choices)

	renderMenu := func() {
		for i, c := range choices {
			if i == cur {
				// Highlighted row: bright green arrow + text.
				fmt.Print("   \033[K") // clear to end of line
				wGreen.Printf("▶ ")
				wBold.Printf("%s\n", c)
			} else {
				fmt.Print("   \033[K")
				wDim.Printf("  %s\n", c)
			}
		}
		// Move cursor back to top of the rendered list.
		fmt.Printf("\033[%dA", n)
	}

	renderMenu()

	buf := make([]byte, 3)
	for {
		nread, _ := os.Stdin.Read(buf)
		if nread == 0 {
			continue
		}

		switch {
		// Enter / carriage-return → confirm.
		case buf[0] == '\r' || buf[0] == '\n':
			// Move cursor below the list before printing stepDone.
			fmt.Printf("\033[%dB", n)
			fmt.Println()
			stepDone(stepNum, question, choices[cur])
			return cur

		// Ctrl-C → restore terminal and exit cleanly.
		// Defers don't run on os.Exit, so we restore manually first.
		case buf[0] == 3:
			fmt.Printf("\033[%dB", n)
			fmt.Println()
			fmt.Print("\033[?25h") // show cursor
			term.Restore(fd, oldState) //nolint:errcheck
			os.Exit(1)

		// Escape sequences (arrow keys: ESC [ A/B).
		case nread >= 3 && buf[0] == 27 && buf[1] == '[':
			switch buf[2] {
			case 'A': // ↑
				cur = (cur - 1 + n) % n
			case 'B': // ↓
				cur = (cur + 1) % n
			}
			renderMenu()
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
//  Text + yes/no prompts
// ─────────────────────────────────────────────────────────────────────────────

func promptText(r *bufio.Reader, step int, question, defaultVal string) string {
	stepLabel(step, question)
	wDim.Printf("   (default: %s)\n", defaultVal)
	wCyan.Print("   › ")
	color.New(color.FgHiWhite).Print("")

	line, _ := r.ReadString('\n')
	line = strings.TrimSpace(line)
	if line == "" {
		line = defaultVal
	}

	stepDone(step, question, line)
	return line
}

func promptYesNo(r *bufio.Reader, step int, question string, defaultYes bool) bool {
	hint := "Y/n"
	if !defaultYes {
		hint = "y/N"
	}
	stepLabel(step, question)
	wDim.Printf("   (%s)\n", hint)
	wCyan.Print("   › ")

	line, _ := r.ReadString('\n')
	line = strings.ToLower(strings.TrimSpace(line))

	result := defaultYes
	if line == "y" || line == "yes" {
		result = true
	} else if line == "n" || line == "no" {
		result = false
	}

	ans := "yes"
	if !result {
		ans = "no"
	}
	stepDone(step, question, ans)
	return result
}

// ─────────────────────────────────────────────────────────────────────────────
//  Visual helpers
// ─────────────────────────────────────────────────────────────────────────────

func printIntro() {
	fmt.Println()
	wMagenta.Println(" ████████╗███████╗██╗   ██╗██╗  ██╗██╗")
	wMagenta.Println(" ╚══██╔══╝██╔════╝██║   ██║██║ ██╔╝██║")
	wCyan.Println("    ██║   ███████╗██║   ██║█████╔╝ ██║")
	wCyan.Println("    ██║   ╚════██║██║   ██║██╔═██╗ ██║")
	wBold.Println("    ██║   ███████║╚██████╔╝██║  ██╗██║")
	wDim.Println("    ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝")
	fmt.Println()
	wBold.Print("  Let's build something for your ")
	wCyan.Print("Arduino")
	wBold.Println(".")
	wDim.Println("  Use ↑ ↓ arrows to navigate, Enter to confirm.")
	wDim.Println("  Press Ctrl+C at any time to cancel.\n")
	printLine()
	fmt.Println()
}

func stepLabel(n int, question string) {
	wDim.Printf(" %d  ", n)
	wBold.Printf("%s\n", question)
}

func stepDone(n int, question, answer string) {
	wDim.Printf(" %d  ", n)
	wDim.Printf("%s  ", question)
	wGreen.Printf("✓ %s\n", answer)
}

func printLine() {
	wDim.Println(" " + strings.Repeat("─", 58))
}

func printSuccess(name string, lang langChoice, board boardChoice, backend backendChoice) {
	fmt.Println()
	printLine()
	fmt.Println()
	wGreen.Print(" ✦ ")
	wBold.Printf("Project ")
	wCyan.Printf("%s", name)
	wBold.Println(" is ready!")
	fmt.Println()

	wDim.Printf("   %-14s", "language")
	wGreen.Printf("%s", lang.name)
	wDim.Printf("  %s\n", lang.note)

	wDim.Printf("   %-14s", "board")
	wYellow.Printf("%s", board.name)
	wDim.Printf("  %s\n", board.note)

	wDim.Printf("   %-14s", "backend")
	switch backend.id {
	case "tsuki-flash":
		wGreen.Printf("%s", backend.id)
	case "tsuki-flash+cores":
		color.New(color.FgHiMagenta, color.Bold).Printf("%s", backend.id)
	default:
		wYellow.Printf("%s", backend.id)
	}
	wDim.Printf("  %s\n", backend.note)

	fmt.Println()
	wBold.Println("  Next steps")
	fmt.Println()
	printStep("cd", name)
	var editFile string
	switch lang.id {
	case "cpp":
		editFile = "src/main.cpp"
	case "ino":
		editFile = "src/" + name + ".ino"
	case "python":
		editFile = "src/main.py"
	default:
		editFile = "src/main.go"
	}
	printStep("edit", editFile)
	printStep("tsuki build", "--compile")
	printStep("tsuki upload", "")
	fmt.Println()
	printLine()
	fmt.Println()
	wDim.Println("  Need help? → https://github.com/s7lver/tsuki")
	fmt.Println()
}

func printStep(cmd, arg string) {
	wDim.Print("   $ ")
	wCyan.Printf("%-20s", cmd)
	if arg != "" {
		wDim.Print(arg)
	}
	fmt.Println()
}

// ─────────────────────────────────────────────────────────────────────────────
//  Label builders
// ─────────────────────────────────────────────────────────────────────────────

func langChoicesLabels() []string {
	out := make([]string, len(langChoices))
	for i, l := range langChoices {
		out[i] = fmt.Sprintf("%-22s  %s", l.name, l.note)
	}
	return out
}

func boardChoicesLabels() []string {
	out := make([]string, len(boardChoices))
	for i, b := range boardChoices {
		out[i] = fmt.Sprintf("%-22s  %s", b.name, b.note)
	}
	return out
}

func backendChoicesLabels() []string {
	out := make([]string, len(backendChoices))
	for i, b := range backendChoices {
		out[i] = fmt.Sprintf("%-36s  %s", b.name, b.note)
	}
	return out
}

func templateLabels() []string {
	return templateLabelsFor(templateChoices)
}

func templateLabelsFor(choices []templateChoice) []string {
	out := make([]string, len(choices))
	for i, t := range choices {
		out[i] = t.name
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────────
//  Finders & misc helpers
// ─────────────────────────────────────────────────────────────────────────────

func findLangChoice(id string) langChoice {
	for _, l := range langChoices {
		if strings.EqualFold(l.id, id) {
			return l
		}
	}
	return langChoices[0]
}

func findBoardChoice(id string) boardChoice {
	for _, b := range boardChoices {
		if strings.EqualFold(b.id, id) {
			return b
		}
	}
	return boardChoices[0]
}

func findBackendChoice(id string) backendChoice {
	for _, b := range backendChoices {
		if strings.EqualFold(b.id, id) {
			return b
		}
	}
	return backendChoices[0]
}

func sanitizeName(s string) string {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, " ", "-")
	var out []rune
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '-' || r == '_' {
			out = append(out, r)
		}
	}
	if len(out) == 0 {
		return "my-tsuki-project"
	}
	return string(out)
}

// isatty reports whether stdin is an interactive terminal.
func isatty() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}