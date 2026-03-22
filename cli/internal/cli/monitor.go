// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: cli :: monitor  —  serial port monitor
//
//  Streams bytes from a serial port to stdout and forwards stdin lines
//  to the board.  Designed to work both as a standalone tool and as the
//  backend for the IDE's built-in serial monitor tab.
//
//  Usage:
//    tsuki monitor                              # auto-detect port
//    tsuki monitor --port COM3                 # explicit port
//    tsuki monitor --port /dev/ttyUSB0 --baud 115200
//    tsuki monitor --port COM3 --raw           # raw bytes, no line buffering
//    tsuki monitor --list                      # list available ports and exit
//
//  Exit codes:
//    0  normal close (Ctrl-C or EOF on stdin)
//    1  error (port not found, permission denied, etc.)
// ─────────────────────────────────────────────────────────────────────────────

package cli

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"github.com/tsuki/cli/internal/ui"
)

func newMonitorCmd() *cobra.Command {
	var (
		port    string
		baud    int
		list    bool
		raw     bool
		timeout int
	)

	cmd := &cobra.Command{
		Use:   "monitor",
		Short: "Open an interactive serial port monitor",
		Long: `Connect to a serial port and stream data to/from the board.

Data received from the board is printed to stdout.
Lines typed in stdin are sent to the board followed by a newline.

Examples:
  tsuki monitor                         # auto-detect port @ 9600 baud
  tsuki monitor --port COM3             # explicit port
  tsuki monitor --port /dev/ttyUSB0 --baud 115200
  tsuki monitor --list                  # show available ports and exit`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if list {
				return runMonitorList()
			}
			return runMonitor(port, baud, raw, timeout)
		},
	}

	cmd.Flags().StringVarP(&port,    "port",    "p", "",    "serial port (e.g. COM3, /dev/ttyUSB0)")
	cmd.Flags().IntVarP(&baud,       "baud",    "b", 9600,  "baud rate")
	cmd.Flags().BoolVar(&list,       "list",    false,      "list available serial ports and exit")
	cmd.Flags().BoolVar(&raw,        "raw",     false,      "raw mode — no line-buffered input, no echo")
	cmd.Flags().IntVar(&timeout,     "timeout", 0,          "connect timeout in seconds (0 = wait forever)")

	return cmd
}

// ── Port listing ──────────────────────────────────────────────────────────────

func runMonitorList() error {
	ports, err := detectSerialPorts()
	if err != nil {
		return fmt.Errorf("listing ports: %w", err)
	}
	if len(ports) == 0 {
		ui.Warn("No serial ports detected.")
		ui.Info("Make sure your board is connected and drivers are installed.")
		return nil
	}
	ui.SectionTitle(fmt.Sprintf("Serial ports (%d)", len(ports)))
	for _, p := range ports {
		ui.Info(p)
	}
	return nil
}

// ── Auto-detect via tsuki-flash ───────────────────────────────────────────────

func autoDetectPort() (string, error) {
	// Try tsuki-flash detect first — it handles all board families.
	flashBin := "tsuki-flash"
	if cfg != nil && cfg.FlashBinary != "" {
		flashBin = cfg.FlashBinary
	}

	out, err := exec.Command(flashBin, "detect").Output()
	if err == nil {
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			line = strings.TrimSpace(line)
			if isSerialPort(line) {
				return line, nil
			}
		}
	}

	// Fallback: scan the OS directly.
	ports, err := detectSerialPorts()
	if err != nil || len(ports) == 0 {
		return "", fmt.Errorf("no serial port detected — connect a board or use --port")
	}
	return ports[0], nil
}

func isSerialPort(s string) bool {
	return strings.HasPrefix(s, "COM") ||
		strings.HasPrefix(s, "/dev/tty") ||
		strings.HasPrefix(s, "/dev/cu.")
}

// detectSerialPorts returns a sorted list of available serial port paths.
// This is a best-effort OS scan without importing serial port libraries.
func detectSerialPorts() ([]string, error) {
	var ports []string

	switch runtime.GOOS {
	case "windows":
		// On Windows, try COM1–COM256 by probing CreateFile.
		// Faster: read the registry key that lists active COM ports.
		// Since we can't use CGo here, we call PowerShell.
		out, err := exec.Command("powershell", "-NoProfile", "-Command",
			`[System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object`).Output()
		if err == nil {
			for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "COM") {
					ports = append(ports, line)
				}
			}
		}

	case "darwin":
		// macOS: glob /dev/cu.*
		matches, _ := filepath.Glob("/dev/cu.*")
		for _, m := range matches {
			if !strings.Contains(m, "Bluetooth") {
				ports = append(ports, m)
			}
		}

	default:
		// Linux: /dev/ttyUSB*, /dev/ttyACM*, /dev/ttyS0-3
		for _, pattern := range []string{"/dev/ttyUSB*", "/dev/ttyACM*", "/dev/rfcomm*"} {
			m, _ := filepath.Glob(pattern)
			ports = append(ports, m...)
		}
	}

	sort.Strings(ports)
	return ports, nil
}

// ── Main monitor loop ─────────────────────────────────────────────────────────

func runMonitor(port string, baud int, raw bool, timeoutSec int) error {
	// Resolve port
	if port == "" {
		ui.Info("Auto-detecting serial port…")
		var err error
		port, err = autoDetectPort()
		if err != nil {
			ui.Fail(err.Error())
			return err
		}
	}

	// Print connection header
	ui.SectionTitle(fmt.Sprintf("Serial Monitor  %s @ %d baud", port, baud))
	ui.Info("Press Ctrl-C to disconnect.")
	fmt.Println()

	// Open serial port using a platform helper.
	// We use the `stty` / `mode` approach (no cgo) with a temp named pipe trick
	// on POSIX, and a Python one-liner fallback if available.
	conn, err := openSerialConn(port, baud)
	if err != nil {
		// Give an actionable message for the most common errors
		msg := err.Error()
		switch {
		case strings.Contains(msg, "permission denied") || strings.Contains(msg, "Access is denied"):
			ui.Fail(fmt.Sprintf("Permission denied on %s", port))
			if runtime.GOOS == "linux" {
				ui.Info("Add your user to the 'dialout' group:  sudo usermod -aG dialout $USER")
				ui.Info("Then log out and back in.")
			}
		case strings.Contains(msg, "no such file") || strings.Contains(msg, "cannot find"):
			ui.Fail(fmt.Sprintf("Port %s not found — is the board connected?", port))
			ui.Info("Available ports:")
			if ps, e := detectSerialPorts(); e == nil && len(ps) > 0 {
				for _, p := range ps { ui.Info("  " + p) }
			} else {
				ui.Warn("  (none detected)")
			}
		default:
			ui.Fail(fmt.Sprintf("Cannot open %s: %s", port, msg))
		}
		return err
	}
	defer conn.Close()

	ui.Success(fmt.Sprintf("Connected to %s", port))
	fmt.Println()

	// Handle Ctrl-C gracefully
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	done := make(chan struct{})

	// RX goroutine: board → stdout
	go func() {
		defer close(done)
		scanner := bufio.NewScanner(conn)
		for scanner.Scan() {
			line := scanner.Text()
			// Timestamp option could go here; for now just print
			fmt.Println(line)
		}
	}()

	// TX goroutine: stdin → board
	go func() {
		scanner := bufio.NewScanner(os.Stdin)
		for scanner.Scan() {
			line := scanner.Text()
			_, _ = fmt.Fprintf(conn, "%s\n", line)
		}
	}()

	// Wait for disconnect or signal
	select {
	case <-done:
		fmt.Println()
		ui.Info("Connection closed by board.")
	case <-sigCh:
		fmt.Println()
		ui.Info("Disconnected.")
	}

	return nil
}

// ── Serial connection (pure-Go, no CGo) ───────────────────────────────────────
//
// Opening a serial port without cgo requires platform tricks.
// We use one of:
//   1. Python's serial module (pyserial) — available on most dev machines
//   2. stty + /dev/ttyXXX file I/O on Linux/macOS
//   3. PowerShell's [System.IO.Ports.SerialPort] on Windows
//
// The IDE's serial monitor calls `tsuki monitor` as a subprocess and
// reads stdout; this approach is compatible with that usage pattern.

type serialConn struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
}

func (s *serialConn) Read(p []byte) (n int, err error)  { return s.stdout.Read(p) }
func (s *serialConn) Write(p []byte) (n int, err error) { return s.stdin.Write(p) }
func (s *serialConn) Close() error {
	_ = s.stdin.Close()
	_ = s.stdout.Close()
	if s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	_ = s.cmd.Wait()
	return nil
}

// openSerialConn opens a serial port via the best available method.
// Returns an io.ReadWriteCloser that streams serial data.
func openSerialConn(port string, baud int) (io.ReadWriteCloser, error) {
	// Strategy 1: use Python pyserial if available (cross-platform, reliable)
	if pyConn, err := openViaPython(port, baud); err == nil {
		return pyConn, nil
	}

	// Strategy 2: platform-specific fallback
	switch runtime.GOOS {
	case "windows":
		return openViaPowershell(port, baud)
	default:
		return openViaStty(port, baud)
	}
}

const pySerialScript = `
import sys, serial, threading, time

port = sys.argv[1]
baud = int(sys.argv[2])

try:
    ser = serial.Serial(port, baud, timeout=1)
except serial.SerialException as e:
    print(f"error: {e}", file=sys.stderr)
    sys.exit(1)

def rx():
    while True:
        try:
            data = ser.readline()
            if data:
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
        except Exception:
            break

t = threading.Thread(target=rx, daemon=True)
t.start()

for line in sys.stdin:
    try:
        ser.write((line.rstrip('\n') + '\n').encode())
    except Exception:
        break
`

func openViaPython(port string, baud int) (io.ReadWriteCloser, error) {
	// Find python3 or python
	pyBin := ""
	for _, name := range []string{"python3", "python"} {
		if p, err := exec.LookPath(name); err == nil {
			pyBin = p
			break
		}
	}
	if pyBin == "" {
		return nil, fmt.Errorf("python not found")
	}

	cmd := exec.Command(pyBin, "-c", pySerialScript, port, strconv.Itoa(baud))
	stdin, err := cmd.StdinPipe()
	if err != nil { return nil, err }
	stdout, err := cmd.StdoutPipe()
	if err != nil { return nil, err }
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	// Brief pause to allow Python to open the port and fail fast if unavailable
	time.Sleep(300 * time.Millisecond)
	if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
		return nil, fmt.Errorf("python serial failed to open %s", port)
	}

	return &serialConn{cmd: cmd, stdin: stdin, stdout: stdout}, nil
}

// openViaStty configures the port with stty then opens it as a file.
// This is a simplified approach — works for most Linux/macOS use cases.
func openViaStty(port string, baud int) (io.ReadWriteCloser, error) {
	// Configure baud rate and raw mode
	sttyArgs := []string{"-F", port, strconv.Itoa(baud), "raw", "-echo"}
	if runtime.GOOS == "darwin" {
		sttyArgs = []string{"-f", port, strconv.Itoa(baud), "raw", "-echo"}
	}
	if out, err := exec.Command("stty", sttyArgs...).CombinedOutput(); err != nil {
		return nil, fmt.Errorf("stty: %s — %s", err, strings.TrimSpace(string(out)))
	}

	f, err := os.OpenFile(port, os.O_RDWR, 0666)
	if err != nil {
		return nil, err
	}

	// Wrap *os.File as a serialConn (no subprocess)
	return &fileConn{f: f}, nil
}

type fileConn struct{ f *os.File }
func (c *fileConn) Read(p []byte) (int, error)  { return c.f.Read(p) }
func (c *fileConn) Write(p []byte) (int, error) { return c.f.Write(p) }
func (c *fileConn) Close() error                { return c.f.Close() }

// openViaPowershell opens a serial port on Windows via a PowerShell script.
func openViaPowershell(port string, baud int) (io.ReadWriteCloser, error) {
	script := fmt.Sprintf(`
$port = New-Object System.IO.Ports.SerialPort('%s', %d)
$port.Open()
$stdin = [Console]::In
$tx = [System.Threading.Tasks.Task]::Run({
    while($true) {
        $line = $stdin.ReadLine()
        if ($line -eq $null) { break }
        $port.WriteLine($line)
    }
})
while($port.IsOpen) {
    $data = $port.ReadLine()
    Write-Output $data
}
`, port, baud)

	cmd := exec.Command("powershell", "-NoProfile", "-Command", script)
	stdin, err := cmd.StdinPipe()
	if err != nil { return nil, err }
	stdout, err := cmd.StdoutPipe()
	if err != nil { return nil, err }
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	time.Sleep(500 * time.Millisecond)
	if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
		return nil, fmt.Errorf("powershell serial failed to open %s", port)
	}

	return &serialConn{cmd: cmd, stdin: stdin, stdout: stdout}, nil
}