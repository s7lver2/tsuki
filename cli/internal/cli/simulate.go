// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: cli :: simulate
//
//  Runs the Go source through the tsuki-core interpreter and streams
//  newline-delimited JSON events to stdout.  The IDE sandbox panel reads
//  this stream via Tauri's spawn_process IPC.
//
//  Usage:
//    tsuki simulate [--steps N] [--board B] [--source <file>]
//
//  Each line of stdout is a StepResult JSON object:
//    {"ok":true,"events":[...],"pins":{...},"serial":[...],"ms":0.0}
// ─────────────────────────────────────────────────────────────────────────────

package cli

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
	"github.com/tsuki/cli/internal/ui"
)

func newSimulateCmd() *cobra.Command {
	var (
		flagSteps  int
		flagBoard  string
		flagSource string
	)

	cmd := &cobra.Command{
		Use:   "simulate",
		Short: "Simulate firmware in the IDE sandbox (streams JSON events)",
		Long: `Run the active project's Go source through tsuki-core's built-in
interpreter and stream newline-delimited JSON events to stdout.

The IDE sandbox panel spawns this command internally — you normally don't
need to call it directly.  When called from the terminal it's useful for
debugging: each line of output is one loop() call.

Example:
  tsuki simulate --steps 10
  tsuki simulate --source src/main.go --board esp32 --steps 50`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			// ── Resolve source file ───────────────────────────────────────────
			source := flagSource
			if source == "" {
				// Auto-detect: look for src/main.go, src/<project>.go, or main.go
				candidates := []string{
					filepath.Join(projectDir(), "src", "main.go"),
					filepath.Join(projectDir(), "main.go"),
				}
				for _, c := range candidates {
					if _, err := os.Stat(c); err == nil {
						source = c
						break
					}
				}
			}
			if source == "" {
				return fmt.Errorf("no Go source file found — use --source <file>")
			}
			if _, err := os.Stat(source); err != nil {
				return fmt.Errorf("source file not found: %s", source)
			}

			// ── Resolve tsuki-core binary ─────────────────────────────────────
			coreBin := cfg.CoreBinary
			if coreBin == "" {
				coreBin = "tsuki-core"
			}

			// ── Build args ────────────────────────────────────────────────────
			args := []string{"simulate", source}

			board := flagBoard
			if board == "" {
				board = cfg.DefaultBoard
			}
			if board != "" {
				args = append(args, "--board", board)
			}

			if flagSteps > 0 {
				args = append(args, "--steps", strconv.Itoa(flagSteps))
			}

			// ── Verbose hint ──────────────────────────────────────────────────
			if cfg.Verbose {
				ui.Step("simulate", strings.Join(append([]string{coreBin}, args...), " "))
			}

			// ── Stream output directly — let tsuki-core own stdout/stderr ─────
			c := exec.Command(coreBin, args...)
			c.Stdout = os.Stdout
			c.Stderr = os.Stderr

			if err := c.Run(); err != nil {
				// Exit codes from tsuki-core are already meaningful; don't wrap.
				os.Exit(1)
			}
			return nil
		},
	}

	cmd.Flags().IntVar(&flagSteps, "steps", 0, "number of loop() iterations (0 = unlimited)")
	cmd.Flags().StringVar(&flagBoard, "board", "", "target board (default from config)")
	cmd.Flags().StringVar(&flagSource, "source", "", "path to .go source file (auto-detected if omitted)")

	return cmd
}