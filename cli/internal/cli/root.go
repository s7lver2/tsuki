// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: cli  —  root cobra command + subcommand registration
// ─────────────────────────────────────────────────────────────────────────────

package cli

import (
	"fmt"
	"os"

	"github.com/fatih/color"
	"github.com/spf13/cobra"

	"github.com/tsuki/cli/internal/config"
	"github.com/tsuki/cli/internal/ui"
)

var (
	globalVerbose bool
	globalNoColor bool
	cfg           *config.Config
)

var rootCmd = &cobra.Command{
	Use:   "tsuki",
	Short: "Go-to-Arduino transpiler & project manager",
	Long: banner() + `
tsuki lets you write Arduino firmware in Go and transpiles it to C++.

Run 'tsuki <command> --help' for details on each command.
`,
	SilenceErrors: true,
	SilenceUsage:  true,
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		if globalNoColor {
			color.NoColor = true
		}
		var err error
		cfg, err = config.Load()
		if err != nil {
			ui.Warn(fmt.Sprintf("Config load error: %v — using defaults", err))
			cfg = config.Default()
		}
		if globalVerbose {
			cfg.Verbose = true
		}
		return nil
	},
}

// Execute is the entry point called from main().
func Execute() error {
	if err := rootCmd.Execute(); err != nil {
		ui.Fail(err.Error())
		return err
	}
	return nil
}

func init() {
	rootCmd.PersistentFlags().BoolVarP(&globalVerbose, "verbose", "v", false, "verbose output")
	rootCmd.PersistentFlags().BoolVar(&globalNoColor, "no-color", false, "disable colored output")

	rootCmd.AddCommand(
		// original commands
		newInitCmd(),
		newBuildCmd(),
		newUploadCmd(),
		newCheckCmd(),
		newConfigCmd(),
		newBoardsCmd(),
		newCleanCmd(),
		newVersionCmd(),
		newPkgCmd(),
		// v3 commands
		newRunCmd(),
		newInstallCmd(),
		newPullCmd(),
		newPushCmd(),
		newUpdateDBCmd(),
	)
}

func banner() string {
	b := `
  ████████╗███████╗██╗   ██╗██╗  ██╗██╗    
  ╚══██╔══╝██╔════╝██║   ██║██║ ██╔╝██║    
     ██║   ███████╗██║   ██║█████╔╝ ██║    
     ██║   ╚════██║██║   ██║██╔═██╗ ██║    
     ██║   ███████║╚██████╔╝██║  ██╗██║    
     ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝
`
	if color.NoColor {
		return b
	}
	return ui.ColorInfo.Sprint(b)
}

func projectDir() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}