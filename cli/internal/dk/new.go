// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-dk :: new  —  interactive scaffold wizard
// ─────────────────────────────────────────────────────────────────────────────

package dk

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"text/template"
	"time"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/tsuki/cli/internal/ui"
)

// ── Colors ────────────────────────────────────────────────────────────────────

var (
	wCyan    = color.New(color.FgCyan, color.Bold)
	wGreen   = color.New(color.FgHiGreen, color.Bold)
	wDim     = color.New(color.FgHiBlack)
	wBold    = color.New(color.FgHiWhite, color.Bold)
)

func newNewCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "new [type] [name]",
		Short: "Scaffold a new package project",
		Long: `Create a new tsuki package with an interactive wizard.

If type and name are omitted, the wizard asks for them interactively.`,
		Example: `  tsuki-dk new
  tsuki-dk new library my-sensor
  tsuki-dk new app my-tool`,
		Args: cobra.MaximumNArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			var pkgType, name string
			if len(args) >= 1 {
				pkgType = args[0]
			}
			if len(args) >= 2 {
				name = args[1]
			}
			return runWizard(pkgType, name)
		},
	}
	return cmd
}

// ── Wizard ────────────────────────────────────────────────────────────────────

func runWizard(pkgType, name string) error {
	reader := bufio.NewReader(os.Stdin)

	// Intro
	fmt.Println()
	wCyan.Println("  tsuki-dk  —  new package wizard")
	wDim.Println("  " + strings.Repeat("─", 40))
	fmt.Println()

	step := 1

	// ── Step 1: package type ──────────────────────────────────────────────
	if pkgType == "" {
		typeChoices := []string{
			"library    — Go/Python → C++ transpiler mappings",
			"app        — standalone binary (like tsuki-core, tsuki-flash)",
			"board-pack — hardware board definitions",
			"ide-plugin — Tauri IDE extension or patch",
			"sdk-patch  — patch applied over an existing app",
		}
		typeKeys := []string{"library", "app", "board-pack", "ide-plugin", "sdk-patch"}
		idx := promptArrow(step, "What type of package?", typeChoices, 0)
		pkgType = typeKeys[idx]
	} else {
		stepDone(step, "Package type", pkgType)
	}
	step++

	// Validate type
	validTypes := map[string]bool{
		"library": true, "app": true, "board-pack": true,
		"ide-plugin": true, "sdk-patch": true,
	}
	if !validTypes[pkgType] {
		return fmt.Errorf("unknown type %q", pkgType)
	}

	// ── Step 2: package name ──────────────────────────────────────────────
	if name == "" {
		name = promptText(reader, step, "Package name", "my-"+pkgType)
	} else {
		stepDone(step, "Package name", name)
	}
	step++

	if name == "" {
		return fmt.Errorf("package name is required")
	}

	// ── Step 3: author ────────────────────────────────────────────────────
	defaultAuthor := gitAuthor()
	author := promptText(reader, step, "Author / owner", defaultAuthor)
	step++

	// ── Step 4: description ───────────────────────────────────────────────
	description := promptText(reader, step, "Short description", "A tsuki "+pkgType)
	step++

	// ── Step 5: type-specific questions ──────────────────────────────────
	var extra extraAnswers

	switch pkgType {
	case "library":
		extra.cppHeader = promptText(reader, step, "C++ header file (e.g. DHT.h)", toCamel(name)+".h")
		step++
		extra.arduinoLib = promptText(reader, step, "Arduino library name (leave empty if none)", "")
		step++

	case "board-pack":
		archChoices := []string{"avr", "rp2040", "esp32", "esp8266", "sam"}
		archLabels := []string{
			"avr    — ATmega (Arduino Uno, Nano, Mega…)",
			"rp2040 — Raspberry Pi Pico, Seeed XIAO RP2040",
			"esp32  — ESP32 / ESP32-S2 / ESP32-S3",
			"esp8266 — ESP8266 / Wemos D1 Mini",
			"sam    — Arduino Due / Zero",
		}
		idx := promptArrow(step, "Target architecture", archLabels, 0)
		extra.architecture = archChoices[idx]
		step++

	case "sdk-patch":
		targetChoices := []string{
			"tsuki-team/tsuki-core  — transpiler (Go/Python → C++)",
			"tsuki-team/tsuki-flash — compiler/flasher",
		}
		targetKeys := []string{"tsuki-team/tsuki-core", "tsuki-team/tsuki-flash"}
		idx := promptArrow(step, "Which app to patch?", targetChoices, 0)
		extra.sdkTarget = targetKeys[idx]
		step++
	}

	// ── Step 6: git init? ─────────────────────────────────────────────────
	initGit := promptYesNo(reader, step, "Initialize git repository?", true)
	step++

	// ── Summary ───────────────────────────────────────────────────────────
	fmt.Println()
	wDim.Println("  " + strings.Repeat("─", 40))
	fmt.Println()
	wBold.Println("  Creating your package…")
	fmt.Println()

	// ── Scaffold ──────────────────────────────────────────────────────────
	ctx := scaffoldCtx{
		Name:        name,
		Type:        pkgType,
		Author:      author,
		Description: description,
		Year:        time.Now().Year(),
		NameUpper:   strings.ToUpper(strings.ReplaceAll(name, "-", "_")),
		NameCamel:   toCamel(name),
		Extra:       extra,
	}

	dir := name
	if _, err := os.Stat(dir); err == nil {
		return fmt.Errorf("directory %q already exists", dir)
	}

	sp := ui.NewSpinner(fmt.Sprintf("Scaffolding %s…", name))
	sp.Start()

	var err error
	switch pkgType {
	case "library":
		err = scaffoldLibrary(dir, ctx)
	case "app":
		err = scaffoldApp(dir, ctx)
	case "board-pack":
		err = scaffoldBoardPack(dir, ctx)
	case "ide-plugin":
		err = scaffoldIdePlugin(dir, ctx)
	case "sdk-patch":
		err = scaffoldSdkPatch(dir, ctx)
	}

	if err != nil {
		sp.Stop(false, "failed")
		_ = os.RemoveAll(dir)
		return err
	}

	if initGit {
		_, _ = runCaptureDir(dir, "git", "init", "-q")
		_, _ = runCaptureDir(dir, "git", "add", ".")
		_, _ = runCaptureDir(dir, "git", "commit", "-q", "-m", "chore: initial scaffold")
	}

	sp.Stop(true, fmt.Sprintf("Created %s/", name))
	fmt.Println()
	ui.PrintConfig("New package", []ui.ConfigEntry{
		{Key: "name",   Value: name},
		{Key: "type",   Value: pkgType},
		{Key: "author", Value: author},
		{Key: "path",   Value: dir},
	}, false)
	fmt.Println()
	wDim.Println("  " + strings.Repeat("─", 40))
	fmt.Println()
	wBold.Println("  Next steps")
	fmt.Println()
	wDim.Printf("    cd %s\n", name)
	wDim.Println("    tsuki-dk build")
	wDim.Println("    tsuki-dk test")
	wDim.Println("    tsuki-dk sandbox")
	fmt.Println()

	return nil
}

// ── extraAnswers holds type-specific wizard answers ────────────────────────────

type extraAnswers struct {
	cppHeader    string
	arduinoLib   string
	architecture string
	sdkTarget    string
}

// ── Scaffold context ──────────────────────────────────────────────────────────

type scaffoldCtx struct {
	Name        string
	Type        string
	Author      string
	Description string
	Year        int
	NameUpper   string
	NameCamel   string
	Extra       extraAnswers
}

// ── Scaffold functions ────────────────────────────────────────────────────────

func scaffoldLibrary(dir string, ctx scaffoldCtx) error {
	header := ctx.Extra.cppHeader
	if header == "" {
		header = ctx.NameCamel + ".h"
	}
	files := map[string]string{
		"tsuki.toml":               renderT(tmplLibraryManifest, ctx),
		"lib/tsukilib.toml":        renderTsukilib(ctx, header),
		"lib/" + ctx.Name + ".go":  renderT(tmplLibGoStub, ctx),
		"examples/basic/main.go":   renderT(tmplExampleMain, ctx),
		"tests/transpile_test.go":  renderT(tmplLibTest, ctx),
		"tests/go.mod":             renderT(tmplTestsGoMod, ctx),
		".tsuki-dk/.gitkeep":       "",
		"README.md":                renderT(tmplReadme, ctx),
	}
	return writeFiles(dir, files)
}

func scaffoldApp(dir string, ctx scaffoldCtx) error {
	files := map[string]string{
		"tsuki.toml":        renderT(tmplAppManifest, ctx),
		"src/main.rs":       renderT(tmplAppMainRs, ctx),
		"Cargo.toml":        renderT(tmplAppCargoToml, ctx),
		"tests/basic.rs":    renderT(tmplAppTest, ctx),
		".tsuki-dk/.gitkeep": "",
		"README.md":         renderT(tmplReadme, ctx),
	}
	return writeFiles(dir, files)
}

func scaffoldBoardPack(dir string, ctx scaffoldCtx) error {
	files := map[string]string{
		"tsuki.toml":           renderT(tmplBoardPackManifest, ctx),
		"boards/my_board.toml": renderT(tmplBoardToml, ctx),
		"tests/boards_test.go": renderT(tmplBoardTest, ctx),
		"tests/go.mod":         renderT(tmplTestsGoMod, ctx),
		".tsuki-dk/.gitkeep":   "",
		"README.md":            renderT(tmplReadme, ctx),
	}
	return writeFiles(dir, files)
}

func scaffoldIdePlugin(dir string, ctx scaffoldCtx) error {
	files := map[string]string{
		"tsuki.toml":              renderT(tmplIdePluginManifest, ctx),
		"package.json":            renderT(tmplPluginPackageJson, ctx),
		"tsconfig.json":           tmplPluginTsConfig,
		"src/index.ts":            renderT(tmplPluginSrcIndex, ctx),
		"plugin/styles.css":       renderT(tmplPluginCss, ctx),
		".gitignore":              tmplPluginGitignore,
		".tsuki-dk/.gitkeep":      "",
		"README.md":               renderT(tmplReadme, ctx),
	}
	return writeFiles(dir, files)
}

func scaffoldSdkPatch(dir string, ctx scaffoldCtx) error {
	files := map[string]string{
		"tsuki.toml":          renderT(tmplSdkPatchManifest, ctx),
		"patches/fix.patch":   renderT(tmplPatchFile, ctx),
		"tests/patch_test.go": renderT(tmplPatchTest, ctx),
		"tests/go.mod":        renderT(tmplTestsGoMod, ctx),
		".tsuki-dk/.gitkeep":  "",
		"README.md":           renderT(tmplReadme, ctx),
	}
	return writeFiles(dir, files)
}

// ── Prompt helpers ────────────────────────────────────────────────────────────

func promptArrow(stepNum int, question string, choices []string, defaultIdx int) int {
	wDim.Printf(" %d  ", stepNum)
	wBold.Printf("%s\n", question)
	fmt.Println()

	if !isatty() {
		for i, c := range choices {
			if i == defaultIdx {
				wGreen.Printf("   ● %d. %s\n", i+1, c)
			} else {
				wDim.Printf("   ○ %d. %s\n", i+1, c)
			}
		}
		wDim.Print("\n   Enter number")
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

	fd := int(os.Stdin.Fd())
	oldState, err := term.MakeRaw(fd)
	if err != nil {
		return defaultIdx
	}
	defer term.Restore(fd, oldState) //nolint:errcheck

	fmt.Print("\033[?25l")
	defer fmt.Print("\033[?25h")

	cur := defaultIdx
	n := len(choices)

	render := func() {
		for i, c := range choices {
			if i == cur {
				fmt.Print("   \033[K")
				wGreen.Print("▶ ")
				wBold.Printf("%s\n", c)
			} else {
				fmt.Print("   \033[K")
				wDim.Printf("  %s\n", c)
			}
		}
		fmt.Printf("\033[%dA", n)
	}
	render()

	buf := make([]byte, 3)
	for {
		nr, _ := os.Stdin.Read(buf)
		if nr == 0 {
			continue
		}
		switch {
		case buf[0] == '\r' || buf[0] == '\n':
			fmt.Printf("\033[%dB\n", n)
			stepDone(stepNum, question, choices[cur])
			return cur
		case buf[0] == 3:
			fmt.Printf("\033[%dB\n", n)
			fmt.Print("\033[?25h")
			term.Restore(fd, oldState) //nolint:errcheck
			os.Exit(1)
		case nr >= 3 && buf[0] == 27 && buf[1] == '[':
			switch buf[2] {
			case 'A':
				cur = (cur - 1 + n) % n
			case 'B':
				cur = (cur + 1) % n
			}
			render()
		}
	}
}

func promptText(r *bufio.Reader, step int, question, defaultVal string) string {
	wDim.Printf(" %d  ", step)
	wBold.Printf("%s\n", question)
	wDim.Printf("   (default: %s)\n", defaultVal)
	wCyan.Print("   › ")

	line, _ := r.ReadString('\n')
	line = strings.TrimSpace(strings.TrimRight(line, "\r\n"))
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
	wDim.Printf(" %d  ", step)
	wBold.Printf("%s\n", question)
	wDim.Printf("   (%s)\n", hint)
	wCyan.Print("   › ")

	line, _ := r.ReadString('\n')
	line = strings.ToLower(strings.TrimSpace(strings.TrimRight(line, "\r\n")))

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

func stepDone(n int, question, answer string) {
	wDim.Printf(" %d  %s  ", n, question)
	wGreen.Printf("✓ %s\n", answer)
}

func isatty() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}

// ── Template rendering ────────────────────────────────────────────────────────

func renderT(tmpl string, ctx scaffoldCtx) string {
	t, err := template.New("").Parse(tmpl)
	if err != nil {
		return tmpl
	}
	var sb strings.Builder
	_ = t.Execute(&sb, ctx)
	return sb.String()
}

func renderTsukilib(ctx scaffoldCtx, header string) string {
	c := ctx
	c.Extra.cppHeader = header
	return renderT(tmplTsukilibToml, c)
}

func writeFiles(baseDir string, files map[string]string) error {
	for relPath, content := range files {
		absPath := filepath.Join(baseDir, filepath.FromSlash(relPath))
		if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(absPath, []byte(content), 0644); err != nil {
			return err
		}
	}
	return nil
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func gitAuthor() string {
	out, err := runCapture("git", "config", "user.name")
	if err == nil && strings.TrimSpace(out) != "" {
		return strings.TrimSpace(out)
	}
	if u := os.Getenv("USER"); u != "" {
		return u
	}
	if u := os.Getenv("USERNAME"); u != "" {
		return u
	}
	return "your-name"
}

func toCamel(s string) string {
	parts := strings.FieldsFunc(s, func(r rune) bool {
		return r == '-' || r == '_'
	})
	for i, p := range parts {
		if len(p) > 0 {
			parts[i] = strings.ToUpper(p[:1]) + p[1:]
		}
	}
	return strings.Join(parts, "")
}

// ── Templates ─────────────────────────────────────────────────────────────────

const tmplLibraryManifest = `[package]
name        = "{{.Name}}"
version     = "0.1.0"
type        = "library"
description = "{{.Description}}"
author      = "{{.Author}}"
license     = "MIT"

[package.signing]
key = "{{.Author}}"

[library]
cpp_header  = "{{.Extra.cppHeader}}"
arduino_lib = "{{.Extra.arduinoLib}}"
`

const tmplTsukilibToml = `[package]
name        = "{{.Name}}"
version     = "0.1.0"
cpp_header  = "{{.Extra.cppHeader}}"

# ── Constructor ──────────────────────────────────────────────────────────────
[[function]]
go     = "New"
python = "new"
cpp    = "{{.NameCamel}}()"

# ── Methods ──────────────────────────────────────────────────────────────────
[[function]]
go     = "Begin"
python = "begin"
cpp    = "{0}.begin()"
`

const tmplLibGoStub = `package {{.NameCamel}}

// Go API stubs for {{.Name}}.
// The C++ implementation lives in lib/tsukilib.toml.

type {{.NameCamel}} struct{}

func New() *{{.NameCamel}}       { return nil }
func (d *{{.NameCamel}}) Begin() {}
`

const tmplExampleMain = `package main

import "arduino"

func setup() {
	arduino.Serial.Begin(9600)
}

func loop() {
	arduino.Delay(1000)
}
`

const tmplLibTest = `package tests

import "testing"

func TestPlaceholder(t *testing.T) {
	t.Log("{{.Name}} test placeholder — add real tests here")
}
`

const tmplTestsGoMod = `module {{.Name}}-tests

go 1.21
`

const tmplAppManifest = `[package]
name        = "{{.Name}}"
version     = "0.1.0"
type        = "app"
description = "{{.Description}}"
author      = "{{.Author}}"
license     = "MIT"

[package.signing]
key = "{{.Author}}"

[app]
install_as = "{{.Name}}"
`

const tmplAppCargoToml = `[package]
name    = "{{.Name}}"
version = "0.1.0"
edition = "2021"

[dependencies]
`

const tmplAppMainRs = `fn main() {
    println!("{{.Name}}");
}
`

const tmplAppTest = `#[cfg(test)]
mod tests {
    #[test]
    fn placeholder() { assert_eq!(1 + 1, 2); }
}
`

const tmplBoardPackManifest = `[package]
name        = "{{.Name}}"
version     = "0.1.0"
type        = "board-pack"
description = "{{.Description}}"
author      = "{{.Author}}"
license     = "MIT"

[package.signing]
key = "{{.Author}}"

[board-pack]
architecture = "{{.Extra.architecture}}"
`

const tmplBoardToml = `[board]
id           = "my_board"
name         = "My Custom Board"
architecture = "{{.Extra.architecture}}"
fqbn         = "arduino:{{.Extra.architecture}}:my_board"
cpu          = ""
f_cpu        = 16000000
flash_kb     = 32
ram_kb       = 2

[board.upload]
tool     = "avrdude"
protocol = "arduino"
speed    = 115200
`

const tmplBoardTest = `package tests

import "testing"

func TestBoardsValid(t *testing.T) {
	t.Log("board validation placeholder")
}
`

const tmplIdePluginManifest = `[package]
name        = "{{.Name}}"
version     = "0.1.0"
type        = "ide-plugin"
description = "{{.Description}}"
author      = "{{.Author}}"
license     = "MIT"

[package.signing]
key = "{{.Author}}"

[ide-plugin]
entry       = "plugin/index.js"
permissions = []
patches     = []
`

// tmplPluginPackageJson: package.json with esbuild build script
const tmplPluginPackageJson = `{
  "name": "{{.Name}}",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "esbuild src/index.ts --bundle --format=cjs --outfile=plugin/index.js --external:react --external:react-dom --platform=browser",
    "watch": "esbuild src/index.ts --bundle --format=cjs --outfile=plugin/index.js --external:react --external:react-dom --platform=browser --watch"
  },
  "devDependencies": {
    "esbuild": "^0.20.0",
    "@types/react": "^18.0.0"
  }
}
`

// tmplPluginTsConfig: tsconfig.json for the plugin source
const tmplPluginTsConfig = `{
  "compilerOptions": {
    "target": "ES2017",
    "module": "commonjs",
    "lib": ["dom", "dom.iterable", "esnext"],
    "jsx": "react",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
`

// tmplPluginGitignore
const tmplPluginGitignore = `node_modules/
dist/
plugin/index.js
`

// tmplPluginSrcIndex: TypeScript entry point template
const tmplPluginSrcIndex = `// {{.Name}} — tsuki IDE plugin
// Built with: tsuki-dk build  (uses esbuild, react/react-dom provided by IDE)
//
// context API reference:
//   context.registerSidebarTab({ id, label, icon?, render })
//   context.registerWorkstation({ id, label, icon?, shortcut?, render })
//   context.registerBottomTab({ id, label, render })
//   context.registerToolbarAction({ id, label, icon?, onClick })
//   context.registerSettingsPanel({ id, label, render })
//   context.registerStatusBarItem({ id, position: 'left'|'right', render })
//   context.registerEditorExtension({ id, getDiagnostics?, getCompletions?, getInlayHints?, dispose? })
//   context.getState()                          → { projectPath, board, theme, ... }
//   context.onStateChange(selector, handler)    → unsubscribe()
//   context.renderReact(container, element)     → ReactDOM root
//   context.invokeCommand(cmd, args?)           → Promise
//   context.on(event, handler) / off(event, handler)
//   context.showMessage(msg, type?)
//   context.getProjectPath()

// React is provided by the IDE — import from context, not from npm
declare const React: typeof import('react')

export function activate(context: any) {
  // Example: register a sidebar tab
  context.registerSidebarTab({
    id: '{{.Name}}-panel',
    label: '{{.NameCamel}}',
    render(): HTMLElement {
      const container = document.createElement('div')
      container.style.cssText = 'padding:16px;height:100%;overflow:auto'

      const root = context.renderReact(
        container,
        React.createElement(PluginPanel, { context }),
      )
      // Store root for cleanup
      ;(container as any).__root = root
      return container
    },
  })
}

// ── Components ────────────────────────────────────────────────────────────────

function PluginPanel({ context }: { context: any }) {
  const [board, setBoard] = React.useState(context.getState().board)

  React.useEffect(() => {
    return context.onStateChange(
      (s: any) => s.board,
      (b: string) => setBoard(b),
    )
  }, [])

  return React.createElement(
    'div',
    { style: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)' } },
    React.createElement('p', null, '{{.Name}} plugin'),
    React.createElement('p', null, 'Board: ' + board),
  )
}
`

const tmplPluginCss = `/* {{.Name}} plugin styles */
`

const tmplSdkPatchManifest = `[package]
name        = "{{.Name}}"
version     = "0.1.0"
type        = "sdk-patch"
description = "{{.Description}}"
author      = "{{.Author}}"
license     = "MIT"

[package.signing]
key = "{{.Author}}"

[sdk-patch]
target       = "{{.Extra.sdkTarget}}"
target_range = ">=6.0,<8.0"
apply_order  = 10
`

const tmplPatchFile = `--- a/src/example.rs
+++ b/src/example.rs
@@ -1,3 +1,3 @@
-// original line
+// patched line
`

const tmplPatchTest = `package tests

import "testing"

func TestPatchApplies(t *testing.T) {
	t.Log("patch test placeholder")
}
`

const tmplReadme = `# {{.Name}}

{{.Description}}

## Install

` + "```bash" + `
tsuki install {{.Author}}/{{.Name}}
` + "```" + `

## Development

` + "```bash" + `
tsuki-dk build
tsuki-dk test
tsuki-dk sandbox
` + "```" + `

## License

MIT © {{.Year}} {{.Author}}
`