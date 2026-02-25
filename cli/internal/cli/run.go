// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: cli :: run  —  execute a [[bin]] entrypoint
// ─────────────────────────────────────────────────────────────────────────────

package cli

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/spf13/cobra"
	"github.com/tsuki/cli/internal/manifest"
	"github.com/tsuki/cli/internal/ui"
)

func newRunCmd() *cobra.Command {
	var target string

	cmd := &cobra.Command{
		Use:   "run [-- args...]",
		Short: "Run the project entrypoint defined in tsuki-config.toml [[bin]]",
		Example: `  tsuki run
  tsuki run --target my-bin
  tsuki run -- --release`,
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := projectDir()
			m, err := manifest.Load(dir)
			if err != nil {
				return err
			}

			if len(m.Bins) == 0 {
				ui.Warn("No [[bin]] targets defined in tsuki-config.toml")
				ui.Info("Add a [[bin]] entry with an entrypoint to use 'tsuki run'")
				return fmt.Errorf("no runnable targets")
			}

			// Pick the right binary target.
			var bin *manifest.BinTarget
			if target != "" {
				for i := range m.Bins {
					if m.Bins[i].Name == target {
						bin = &m.Bins[i]
						break
					}
				}
				if bin == nil {
					return fmt.Errorf("target %q not found in [[bin]] entries", target)
				}
			} else {
				bin = &m.Bins[0]
			}

			if bin.Entrypoint == "" {
				return fmt.Errorf("[[bin]] %q has no entrypoint defined", bin.Name)
			}

			// Append any extra args passed after '--'.
			entrypoint := bin.Entrypoint
			if len(args) > 0 {
				entrypoint = entrypoint + " " + strings.Join(args, " ")
			}

			ui.SectionTitle(fmt.Sprintf("Run  [target: %s]", bin.Name))
			ui.Step("entrypoint", entrypoint)
			fmt.Println()

			parts := strings.Fields(entrypoint)
			command := exec.Command(parts[0], parts[1:]...)
			command.Dir = dir
			command.Stdout = os.Stdout
			command.Stderr = os.Stderr
			command.Stdin = os.Stdin

			if err := command.Run(); err != nil {
				if exitErr, ok := err.(*exec.ExitError); ok {
					ui.Fail(fmt.Sprintf("exited with code %d", exitErr.ExitCode()))
					return fmt.Errorf("run failed")
				}
				return fmt.Errorf("run error: %w", err)
			}

			fmt.Println()
			ui.Success(fmt.Sprintf("'%s' finished", bin.Name))
			return nil
		},
	}

	cmd.Flags().StringVar(&target, "target", "", "[[bin]] target name (default: first entry)")
	return cmd
}