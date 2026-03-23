// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-dk :: root  —  cobra root command
// ─────────────────────────────────────────────────────────────────────────────

package dk

import (
	"fmt"

	"github.com/fatih/color"
	"github.com/spf13/cobra"

	"github.com/tsuki/cli/internal/ui"
)

var rootCmd = &cobra.Command{
	Use:   "tsuki-dk",
	Short: "Tsuki Development Kit — create, test, and publish packages",
	Long: `tsuki-dk is the development toolkit for creating tsuki packages.

Package types you can create:
  app          — standalone binary (like tsuki-core, tsuki-flash)
  library      — transpiler library (Go/Python → C++ mappings)
  board-pack   — board definitions for new hardware
  ide-plugin   — Tauri IDE extension or patch
  sdk-patch    — patch applied over an existing app

Workflow:
  tsuki-dk new library my-sensor     # scaffold a new package
  tsuki-dk build                     # compile / validate
  tsuki-dk test                      # run tests
  tsuki-dk sandbox                   # test in isolated tsuki copy
  tsuki-dk publish                   # sign and push to your registry

Release workflow (requires release.toml):
  tsuki-dk release --all             # build + sign + publish all components
  tsuki-dk release --component foo   # release one component
  tsuki-dk release auto              # let CI detect what to release
  tsuki-dk release watch             # poll for new tags
  tsuki-dk release ci generate       # generate GitHub Actions workflow`,
	SilenceErrors: true,
	SilenceUsage:  true,
}

// Execute runs the root command.
func Execute() error {
	if err := rootCmd.Execute(); err != nil {
		ui.Fail(err.Error())
		return err
	}
	return nil
}

func init() {
	rootCmd.AddCommand(
		newNewCmd(),
		newBuildCmd(),
		newTestCmd(),
		newInstallCmd(),
		newSandboxCmd(),
		newPublishCmd(),
		newRegistryCmd(),
		newKeyCmd(),
		newReleaseCmd(), // ← tsuki-release wrapper
	)
}

func banner() string {
	b := "\n  tsuki-dk — Development Kit\n"
	if color.NoColor {
		return b
	}
	return fmt.Sprintf("\033[1;96m%s\033[0m", b)
}