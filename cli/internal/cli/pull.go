// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: cli :: pull  —  sync all dependencies from lock.json or manifest
// ─────────────────────────────────────────────────────────────────────────────

package cli

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/tsuki/cli/internal/pkgmgr"
	"github.com/tsuki/cli/internal/ui"
)

func newPullCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "pull",
		Short: "Sync all dependencies from the lock file or manifest",
		Long: `pull reads .tsuki/lock.json (if present) or the [dependencies] table in
tsuki-config.toml and installs every dependency at the pinned version.

This is equivalent to running 'tsuki install' with no arguments.`,
		Example: `  tsuki pull`,
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := projectDir()

			ui.SectionTitle("Pulling dependencies")

			results, err := pkgmgr.PullAll(dir)
			if err != nil {
				return fmt.Errorf("pull failed: %w", err)
			}

			if len(results) == 0 {
				ui.Info("Nothing to install — all dependencies already satisfied.")
				return nil
			}

			for _, r := range results {
				if r.Err != nil {
					ui.Fail(fmt.Sprintf("%-20s  %v", r.Name, r.Err))
				} else {
					ui.Success(fmt.Sprintf("%-20s  @ %s", r.Name, r.Version))
				}
			}

			ok := 0
			for _, r := range results {
				if r.Err == nil {
					ok++
				}
			}
			fmt.Println()
			ui.Step("result", fmt.Sprintf("%d/%d packages installed", ok, len(results)))
			return nil
		},
	}

	return cmd
}