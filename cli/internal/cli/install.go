// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: cli :: install  —  top-level `tsuki install` shortcut
//
//  This mirrors `tsuki pkg install` but lives at the root level so that
//  the common workflow matches familiar package managers:
//
//    tsuki install tsuki-flash
//    tsuki install tsuki-team/tsuki-core@>=6.0
//    tsuki install tsuki-team/dht
// ─────────────────────────────────────────────────────────────────────────────

package cli

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	v2 "github.com/tsuki/cli/internal/pkgmgr/v2"
	"github.com/tsuki/cli/internal/ui"
)

func newTopInstallCmd() *cobra.Command {
	var force   bool
	var verbose bool

	cmd := &cobra.Command{
		Use:   "install <package>",
		Short: "Install a package",
		Long: `Install a package from any configured source.

This is a shortcut for 'tsuki pkg install'.

Package reference formats:
  tsuki-flash                        latest from any source
  tsuki-team/tsuki-flash             owner/name
  tsuki-team/tsuki-flash@v6.0.0     exact version
  tsuki-team/tsuki-flash@>=5.0      semver range

Package types:
  app        → installed to ~/.tsuki/bin/  and available on PATH
  library    → installed to ~/.tsuki/libs/
  board-pack → installed to ~/.tsuki/boards/
  ide-plugin → installed to ~/.tsuki/plugins/`,
		Example: `  tsuki install tsuki-flash
  tsuki install tsuki-core
  tsuki install tsuki-team/dht
  tsuki install tsuki-team/tsuki-flash@v6.0.0
  tsuki install tsuki-team/tsuki-flash@>=5.0`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			raw := args[0]

			// Delegate path/URL installs to v1 legacy handler
			if strings.HasPrefix(raw, "./") || strings.HasPrefix(raw, "/") ||
				strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
				return legacyInstall(raw, "", verbose)
			}

			ref, err := v2.ParseRef(raw)
			if err != nil {
				return err
			}

			sp := ui.NewSpinner(fmt.Sprintf("Resolving %s…", raw))
			sp.Start()

			pkg, err := v2.Install(v2.InstallOptions{
				Ref:     ref,
				Verbose: verbose,
				Force:   force,
			})

			if err == v2.ErrAlreadyInstalled {
				sp.Stop(true, fmt.Sprintf("%s is already at the latest version", raw))
				return nil
			}
			if err != nil {
				sp.Stop(false, "installation failed")
				return err
			}

			sp.Stop(true, fmt.Sprintf("Installed %s@%s", pkg.FullName(), pkg.Version))
			fmt.Println()

			ui.PrintConfig("Package installed", []ui.ConfigEntry{
				{Key: "name",    Value: pkg.FullName()},
				{Key: "version", Value: pkg.Version},
				{Key: "type",    Value: string(pkg.Type)},
				{Key: "path",    Value: pkg.Path},
			}, false)

			if pkg.Type == v2.TypeLibrary {
				fmt.Println()
				ui.Info(fmt.Sprintf("Add to your project: tsuki pkg add %s", pkg.Name))
			}
			if pkg.Type == v2.TypeApp {
				fmt.Println()
				ui.Info(fmt.Sprintf("'%s' is now available. Make sure ~/.tsuki/bin is in your PATH.", pkg.Name))
			}

			return nil
		},
	}

	cmd.Flags().BoolVarP(&force, "force", "f", false, "reinstall even if already at that version")
	cmd.Flags().BoolVarP(&verbose, "verbose", "v", false, "show download details")
	return cmd
}