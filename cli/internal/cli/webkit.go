package cli

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/spf13/cobra"
	"github.com/tsuki/cli/internal/manifest"
	"github.com/tsuki/cli/internal/ui"
)

// ── webkit command group ───────────────────────────────────────────────────────

func newWebkitCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "webkit",
		Short: "tsuki-webkit — JSX → HTML/CSS/JS compiler for ESP8266/ESP32",
		Long: `tsuki-webkit: Compile JSX components into self-contained HTML control panels
served directly from your ESP8266 or ESP32 over WiFi.

Supported imports inside app.jsx:
  import { Api, Json, Serial } from 'tsuki-webkit'

  Api    — fetch/poll endpoints your Go handler exposes
  Json   — JSON parsing helpers
  Serial — stream serial output to the browser console
`,
	}

	cmd.AddCommand(
		newWebkitBuildCmd(),
		newWebkitCheckCmd(),
		newWebkitInitCmd(),
		newWebkitInfoCmd(),
		newWebkitPreviewCmd(),
	)

	return cmd
}

// ── webkit build ──────────────────────────────────────────────────────────────

func newWebkitBuildCmd() *cobra.Command {
	var board  string
	var config string
	var outDir string

	cmd := &cobra.Command{
		Use:   "build",
		Short: "Compile app.jsx → HTML + C++ fragment",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg   := resolveWebkitConfig(config)
			entry := filepath.Join(filepath.Dir(config), cfg.Entrypoint)

			ui.Info(fmt.Sprintf("tsuki-webkit build — entry: %s  board: %s", entry, board))

			if _, err := os.Stat(entry); os.IsNotExist(err) {
				return fmt.Errorf("entry-point not found: %s\n  Create an app.jsx or set Entrypoint in tsuki-webkit.conf.json", entry)
			}

			binary := resolveWebkitBinary()
			if binary == "" {
				ui.Warn("tsuki-webkit binary not found in PATH — using embedded stub")
				return runEmbeddedBuild(entry, outDir)
			}

			c := exec.Command(binary, "build", "--board", board, "--config", config)
			c.Stdout = os.Stdout
			c.Stderr = os.Stderr
			if err := c.Run(); err != nil {
				return fmt.Errorf("build failed: %w", err)
			}
			ui.Info(fmt.Sprintf("Output written to %s/", outDir))
			return nil
		},
	}

	cmd.Flags().StringVar(&board,  "board",  "esp8266",                "Target board: esp8266 or esp32")
	cmd.Flags().StringVar(&config, "config", "tsuki-webkit.conf.json", "Path to tsuki-webkit.conf.json")
	cmd.Flags().StringVar(&outDir, "out",    "dist",                   "Output directory")
	return cmd
}

// ── webkit check ─────────────────────────────────────────────────────────────

func newWebkitCheckCmd() *cobra.Command {
	var config string

	cmd := &cobra.Command{
		Use:   "check",
		Short: "Validate app.jsx without producing output",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg   := resolveWebkitConfig(config)
			entry := filepath.Join(filepath.Dir(config), cfg.Entrypoint)
			ui.Info(fmt.Sprintf("tsuki-webkit check — %s", entry))

			binary := resolveWebkitBinary()
			if binary == "" {
				ui.Warn("tsuki-webkit binary not in PATH; skipping deep check")
				return checkEntryExists(entry)
			}

			c := exec.Command(binary, "check", "--config", config)
			c.Stdout = os.Stdout
			c.Stderr = os.Stderr
			return c.Run()
		},
	}

	cmd.Flags().StringVar(&config, "config", "tsuki-webkit.conf.json", "Path to config")
	return cmd
}

// ── webkit init ───────────────────────────────────────────────────────────────

func newWebkitInitCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "init",
		Short: "Scaffold a tsuki-webkit project in the current directory",
		RunE: func(cmd *cobra.Command, args []string) error {
			name := "my-app"
			if mf, err := manifest.Load("."); err == nil {
				name = mf.Name
			}

			conf := fmt.Sprintf(`{
  "Name": %q,
  "Author": "",
  "Version": "0.1.0",
  "Description": "",
  "app": {
    "Entrypoint": "app.jsx"
  }
}`, name)
			if err := os.WriteFile("tsuki-webkit.conf.json", []byte(conf), 0o644); err != nil {
				return err
			}
			ui.Info("Created tsuki-webkit.conf.json")

			jsx := fmt.Sprintf(`import { Api, Json, Serial } from 'tsuki-webkit'

export default function App() {
  return (
    <div className="wk-card">
      <h1>%s</h1>
      <p>Your tsuki-webkit control panel.</p>

      <div className="wk-row" style="margin-top:12px">
        <button className="wk-btn"
          onClick={() => Api.get('/api/status', data => Serial.log(Json.stringify(data)))}>
          Get Status
        </button>
      </div>

      <div id="__serial_log" className="wk-serial" style="margin-top:12px"></div>
    </div>
  )
}
`, name)
			if err := os.WriteFile("app.jsx", []byte(jsx), 0o644); err != nil {
				return err
			}
			ui.Info("Created app.jsx")

			if _, err := os.Stat("src/main.go"); err == nil {
				hint := `
// ── tsuki-webkit ──────────────────────────────────────────────────────────────
// import "tsuki-webkit"
// const app = tsuki-webkit.ApiInit()
// func setup() { app.setup() }
// func loop()  { app.tick()  }
`
				if f, err := os.OpenFile("src/main.go", os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
					f.WriteString(hint)
					f.Close()
					ui.Info("Appended tsuki-webkit stub to src/main.go")
				}
			}

			ui.SectionTitle("Next steps")
			fmt.Println("  1. Edit app.jsx")
			fmt.Println("  2. tsuki webkit build --board esp8266")
			fmt.Println("  3. tsuki build --board esp8266")
			fmt.Println("  4. tsuki upload --port /dev/ttyUSB0")
			return nil
		},
	}
}

// ── webkit info ───────────────────────────────────────────────────────────────

func newWebkitInfoCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "info",
		Short: "Show tsuki-webkit version and compiler path",
		Run: func(cmd *cobra.Command, args []string) {
			ui.SectionTitle("tsuki-webkit")
			binary := resolveWebkitBinary()
			if binary == "" {
				ui.Warn("tsuki-webkit binary not found in PATH")
				fmt.Println("  Install:  cargo install tsuki-webkit")
				fmt.Println("  Or build: cd libs/tsuki-webkit && cargo build --release")
			} else {
				ui.Info(fmt.Sprintf("Binary: %s", binary))
				c := exec.Command(binary, "info")
				c.Stdout = os.Stdout
				c.Stderr = os.Stderr
				c.Run() //nolint:errcheck
			}

			fmt.Println()
			fmt.Println("  Compatible boards : esp8266, esp32")
			fmt.Println("  Imports           : Api · Json · Serial  (from 'tsuki-webkit')")
			fmt.Println("  Config            : tsuki-webkit.conf.json")
			fmt.Println("  Output            : dist/index.html · dist/webkit.cpp")
		},
	}
}

// ── webkit preview ────────────────────────────────────────────────────────────

func newWebkitPreviewCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "preview",
		Short: "Open the built preview in the default browser",
		RunE: func(cmd *cobra.Command, args []string) error {
			if _, err := os.Stat("dist/index.html"); os.IsNotExist(err) {
				return fmt.Errorf("dist/index.html not found — run `tsuki webkit build` first")
			}

			path, _ := filepath.Abs("dist/index.html")
			url     := "file://" + path

			var opener string
			switch runtime.GOOS {
			case "darwin":  opener = "open"
			case "windows": opener = "cmd /c start"
			default:        opener = "xdg-open"
			}

			ui.Info(fmt.Sprintf("Opening: %s", url))
			exec.Command(opener, url).Start() //nolint:errcheck
			return nil
		},
	}
	return cmd
}

// ── helpers ───────────────────────────────────────────────────────────────────

type webkitConf struct {
	Entrypoint string
	Name       string
}

func resolveWebkitConfig(path string) webkitConf {
	cfg := webkitConf{Entrypoint: "app.jsx"}
	data, err := os.ReadFile(path)
	if err != nil {
		return cfg
	}
	s := string(data)
	extract := func(key string) string {
		needle := `"` + key + `"`
		idx := 0
		for i := 0; i+len(needle) <= len(s); i++ {
			if s[i:i+len(needle)] == needle {
				idx = i + len(needle)
				break
			}
		}
		if idx == 0 {
			return ""
		}
		rest := s[idx:]
		for len(rest) > 0 && rest[0] != ':' {
			rest = rest[1:]
		}
		if len(rest) == 0 {
			return ""
		}
		rest = rest[1:]
		for len(rest) > 0 && rest[0] != '"' {
			rest = rest[1:]
		}
		if len(rest) == 0 {
			return ""
		}
		rest = rest[1:]
		end := 0
		for end < len(rest) && rest[end] != '"' {
			end++
		}
		return rest[:end]
	}

	if v := extract("Entrypoint"); v != "" {
		cfg.Entrypoint = v
	}
	if v := extract("Name"); v != "" {
		cfg.Name = v
	}
	return cfg
}

func resolveWebkitBinary() string {
	if p, err := exec.LookPath("tsuki-webkit"); err == nil {
		return p
	}
	return ""
}

func runEmbeddedBuild(entry, outDir string) error {
	src, err := os.ReadFile(entry)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return err
	}
	html := "<!-- tsuki-webkit stub (install binary for full compile) -->\n<pre>" +
		string(src) + "</pre>"
	if err := os.WriteFile(filepath.Join(outDir, "index.html"), []byte(html), 0o644); err != nil {
		return err
	}
	ui.Warn("Stub output only — install tsuki-webkit for full JSX→HTML compilation")
	return nil
}

func checkEntryExists(path string) error {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return fmt.Errorf("entry-point not found: %s", path)
	}
	ui.Info(fmt.Sprintf("Entry-point OK: %s", path))
	return nil
}
