package cli

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/tsuki/cli/internal/manifest"
	"github.com/tsuki/cli/internal/ui"
)

// ── boards ────────────────────────────────────────────────────────────────────

type boardInfo struct {
	ID      string
	Name    string
	FlashKB int
	RAMKB   int
	FQBN    string
}

var boardCatalog = []boardInfo{
	{"uno",      "Arduino Uno",                  32,    2,   "arduino:avr:uno"},
	{"nano",     "Arduino Nano",                 32,    2,   "arduino:avr:nano"},
	{"mega",     "Arduino Mega 2560",            256,   8,   "arduino:avr:mega"},
	{"leonardo", "Arduino Leonardo",             32,    2,   "arduino:avr:leonardo"},
	{"micro",    "Arduino Micro",                32,    2,   "arduino:avr:micro"},
	{"due",      "Arduino Due (SAM3X8E)",        512,   96,  "arduino:sam:arduino_due_x"},
	{"mkr1000",  "Arduino MKR1000 (SAMD21)",     256,   32,  "arduino:samd:mkr1000"},
	{"esp32",    "ESP32 Dev Module",             4096,  520, "esp32:esp32:esp32"},
	{"esp8266",  "ESP8266 Generic",              4096,  80,  "esp8266:esp8266:generic"},
	// TEMP HIDDEN: {"pico",     "Raspberry Pi Pico (RP2040)",   2048,  264, "rp2040:rp2040:rpipico"},
	{"teensy40", "Teensy 4.0 (iMXRT1062)",       1984,  1024,"teensy:avr:teensy40"},
}

func newBoardsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "boards",
		Short: "List and detect supported boards",
	}

	cmd.AddCommand(newBoardsListCmd(), newBoardsDetectCmd())
	return cmd
}

func newBoardsListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List all supported boards",
		Run: func(cmd *cobra.Command, args []string) {
			ui.SectionTitle("Supported Boards")
			fmt.Println()

			// Header
			ui.ColorTitle.Printf("  %-12s  %-34s  %7s  %6s  %s\n", "ID", "NAME", "FLASH", "RAM", "FQBN")
			ui.ColorMuted.Println("  " + hline(90, "─"))

			for _, b := range boardCatalog {
				ui.ColorKey.Printf("  %-12s", b.ID)
				fmt.Printf("  %-34s", b.Name)
				ui.ColorNumber.Printf("  %5dK", b.FlashKB)
				ui.ColorNumber.Printf("  %4dK", b.RAMKB)
				ui.ColorMuted.Printf("  %s\n", b.FQBN)
			}
			fmt.Println()
		},
	}
}

func newBoardsDetectCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "detect",
		Short: "Detect boards connected via USB",
		Run: func(cmd *cobra.Command, args []string) {
			ui.SectionTitle("Detecting connected boards")
			sp := ui.NewSpinner("Scanning serial ports…")
			sp.Start()

			// Shell out to arduino-cli board list
			import_cmd := "arduino-cli board list"
			_ = import_cmd
			sp.Stop(false, "Use `arduino-cli board list` to detect boards")
			ui.Info("Run: arduino-cli board list")
		},
	}
}

func hline(n int, ch string) string {
	s := ""
	for i := 0; i < n; i++ {
		s += ch
	}
	return s
}

// ── clean ─────────────────────────────────────────────────────────────────────

func newCleanCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "clean",
		Short: "Remove the build/ directory",
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := projectDir()
			_, m, err := manifest.Find(dir)
			if err != nil {
				return err
			}

			buildDir := filepath.Join(dir, m.Build.OutputDir)
			if _, err := os.Stat(buildDir); os.IsNotExist(err) {
				ui.Info(fmt.Sprintf("%s does not exist — nothing to clean", m.Build.OutputDir))
				return nil
			}

			sp := ui.NewSpinner(fmt.Sprintf("Removing %s…", buildDir))
			sp.Start()
			if err := os.RemoveAll(buildDir); err != nil {
				sp.Stop(false, "failed to remove build directory")
				return err
			}
			sp.Stop(true, fmt.Sprintf("Removed %s", buildDir))
			return nil
		},
	}
}

// ── version ───────────────────────────────────────────────────────────────────

const Version = "0.1.0"

func newVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print version information",
		Run: func(cmd *cobra.Command, args []string) {
			ui.PrintConfig("tsuki version", []ui.ConfigEntry{
				{Key: "cli",  Value: Version,         Comment: "tsuki CLI"},
				{Key: "core", Value: "(not detected)", Comment: "tsuki-core (Rust transpiler)"},
			}, false)
		},
	}
}