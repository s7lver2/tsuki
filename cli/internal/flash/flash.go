// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: flash  —  upload firmware to the connected board
// ─────────────────────────────────────────────────────────────────────────────

package flash

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/tsuki/cli/internal/manifest"
	"github.com/tsuki/cli/internal/ui"
)

// Options controls the flash operation.
type Options struct {
	Port        string // serial port; empty = auto-detect
	Board       string // override manifest board
	BuildDir    string // directory with compiled firmware (.hex)
	ArduinoCLI  string
	FlashBinary string // path to tsuki-flash binary
	Backend     string // "tsuki-flash" or "arduino-cli"
	Verbose     bool
}

// boardFQBN maps short board IDs to FQBNs.
var boardFQBN = map[string]string{
	"uno":      "arduino:avr:uno",
	"nano":     "arduino:avr:nano",
	"mega":     "arduino:avr:mega",
	"leonardo": "arduino:avr:leonardo",
	"micro":    "arduino:avr:micro",
	"due":      "arduino:sam:arduino_due_x",
	"esp32":    "esp32:esp32:esp32",
	"esp8266":  "esp8266:esp8266:generic",
	"pico":     "rp2040:rp2040:rpipico",
}

// Run uploads the firmware to the board.
func Run(projectDir string, m *manifest.Manifest, opts Options) error {
	board := opts.Board
	if board == "" {
		board = m.Board
	}

	// Firmware lives in build/.cache. Respect explicit --build-dir if given.
	buildDir := opts.BuildDir
	if buildDir == "" {
		buildDir = filepath.Join(projectDir, m.Build.OutputDir, ".cache")
	}

	backend := opts.Backend
	if backend == "" {
		backend = "arduino-cli"
	}

	switch backend {
	case "tsuki-flash":
		return uploadTsukiFlash(board, buildDir, opts)
	default:
		return uploadArduinoCLI(board, buildDir, opts)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
//  Backend: tsuki-flash upload
// ─────────────────────────────────────────────────────────────────────────────

func uploadTsukiFlash(board, buildDir string, opts Options) error {
	flashBin := opts.FlashBinary
	if flashBin == "" {
		flashBin = "tsuki-flash"
	}

	port := opts.Port
	if port == "" {
		ui.Info("Auto-detecting board on serial ports...")
		detected, err := detectPortTsukiFlash(flashBin)
		if err != nil {
			return fmt.Errorf(
				"no board detected: %w\n  Hint: connect the board and try again, or pass --port /dev/ttyUSBx", err,
			)
		}
		port = detected
		ui.Success(fmt.Sprintf("Found board on %s", port))
	}

	args := []string{
		"upload",
		"--board", board,
		"--port", port,
		"--build-dir", buildDir,
	}
	if opts.Verbose {
		args = append(args, "--verbose")
	}

	ui.SectionTitle(fmt.Sprintf("Uploading to %s  [board: %s]  [tsuki-flash]", port, board))
	sp := ui.NewSpinner("Flashing firmware...")
	sp.Start()

	cmd := exec.Command(flashBin, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		sp.Stop(false, "upload failed")
		renderFlashError(string(out), port)
		return fmt.Errorf("upload failed")
	}

	sp.Stop(true, fmt.Sprintf("firmware uploaded to %s", port))
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
//  Backend: arduino-cli upload
// ─────────────────────────────────────────────────────────────────────────────

func uploadArduinoCLI(board, buildDir string, opts Options) error {
	fqbn, ok := boardFQBN[strings.ToLower(board)]
	if !ok {
		return fmt.Errorf("unknown board %q — run `tsuki boards list` for the full list", board)
	}

	port := opts.Port
	if port == "" {
		ui.Info("Auto-detecting board on serial ports...")
		detected, err := detectPortArduinoCLI(opts.ArduinoCLI)
		if err != nil {
			return fmt.Errorf(
				"no board detected: %w\n  Hint: connect the board and try again, or pass --port /dev/ttyUSBx", err,
			)
		}
		port = detected
		ui.Success(fmt.Sprintf("Found board on %s", port))
	}

	arduinoCLI := opts.ArduinoCLI
	if arduinoCLI == "" {
		arduinoCLI = "arduino-cli"
	}

	args := []string{
		"upload",
		"--fqbn", fqbn,
		"--port", port,
		"--input-dir", buildDir,
	}
	if opts.Verbose {
		args = append(args, "--verbose")
	}

	ui.SectionTitle(fmt.Sprintf("Uploading to %s  [%s]", port, fqbn))
	sp := ui.NewSpinner("Flashing firmware...")
	sp.Start()

	cmd := exec.Command(arduinoCLI, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		sp.Stop(false, "upload failed")
		renderFlashError(string(out), port)
		return fmt.Errorf("upload failed")
	}

	sp.Stop(true, fmt.Sprintf("firmware uploaded to %s", port))
	return nil
}

func renderFlashError(output, port string) {
	lines := strings.Split(output, "\n")
	var relevant []string
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l != "" && (strings.Contains(l, "error") || strings.Contains(l, "Error") || strings.Contains(l, "not found")) {
			relevant = append(relevant, l)
		}
	}
	msg := strings.Join(relevant, "; ")
	if msg == "" {
		msg = strings.TrimSpace(output)
	}
	ui.Traceback("FlashError", msg, []ui.Frame{
		{
			File: port,
			Func: "upload",
			Line: 0,
			Code: []ui.CodeLine{{Number: 0, Text: msg, IsPointer: true}},
		},
	})
}

// detectPortTsukiFlash uses `tsuki-flash detect` to find the board port.
func detectPortTsukiFlash(flashBin string) (string, error) {
	out, err := exec.Command(flashBin, "detect").Output()
	if err != nil {
		return "", fmt.Errorf("tsuki-flash detect failed: %w", err)
	}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 1 {
			port := fields[0]
			if strings.HasPrefix(port, "/dev/") || strings.HasPrefix(port, "COM") {
				return port, nil
			}
		}
	}
	return "", fmt.Errorf("no board found on any serial port")
}

// detectPortArduinoCLI uses `arduino-cli board list` to find the board port.
func detectPortArduinoCLI(arduinoCLI string) (string, error) {
	if arduinoCLI == "" {
		arduinoCLI = "arduino-cli"
	}
	out, err := exec.Command(arduinoCLI, "board", "list").Output()
	if err != nil {
		return "", fmt.Errorf("arduino-cli board list failed: %w", err)
	}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 1 {
			port := fields[0]
			if strings.HasPrefix(port, "/dev/") || strings.HasPrefix(port, "COM") {
				return port, nil
			}
		}
	}
	return "", fmt.Errorf("no board found on any serial port")
}