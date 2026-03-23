// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: cli :: update  —  `tsuki update [package]`
//
//  With no arguments: updates all installed v2 packages to their latest version.
//  With an argument:  updates only the specified package.
//
//  Apps (tsuki-core, tsuki-flash, etc.) are updated the same way as libraries.
// ─────────────────────────────────────────────────────────────────────────────

package cli

import (
	"fmt"

	"github.com/spf13/cobra"

	v2 "github.com/tsuki/cli/internal/pkgmgr/v2"
	"github.com/tsuki/cli/internal/ui"
)

func newUpdateCmd() *cobra.Command {
	var verbose bool

	cmd := &cobra.Command{
		Use:   "update [package]",
		Short: "Update installed packages to their latest versions",
		Long: `Update all installed v2 packages, or a specific one.

Without arguments, updates every installed package to the latest version
that satisfies its constraints. This includes app packages like tsuki-core
and tsuki-flash.

With a package name, updates only that package.`,
		Example: `  tsuki update                         # update everything
  tsuki update tsuki-flash             # update a specific package
  tsuki update tsuki-team/tsuki-core   # with owner`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 1 {
				return updateOne(args[0], verbose)
			}
			return updateAll(verbose)
		},
	}

	cmd.Flags().BoolVarP(&verbose, "verbose", "v", false, "show download details")
	return cmd
}

func updateOne(raw string, verbose bool) error {
	ref, err := v2.ParseRef(raw)
	if err != nil {
		return err
	}

	sp := ui.NewSpinner(fmt.Sprintf("Updating %s…", raw))
	sp.Start()

	pkg, err := v2.Install(v2.InstallOptions{
		Ref:     ref,
		Verbose: verbose,
		Force:   true, // always reinstall — update means "get latest"
	})
	if err != nil {
		sp.Stop(false, "update failed")
		return err
	}

	sp.Stop(true, fmt.Sprintf("%s → %s", pkg.FullName(), pkg.Version))
	return nil
}

func updateAll(verbose bool) error {
	installed, err := v2.ListInstalled()
	if err != nil {
		return err
	}
	if len(installed) == 0 {
		ui.Note("No v2 packages installed.")
		ui.Info("Run 'tsuki install <package>' to install packages")
		return nil
	}

	ui.SectionTitle("Updating packages")
	fmt.Println()

	updated := 0
	skipped := 0
	failed := 0

	for _, p := range installed {
		ref := v2.PackageRef{Owner: p.Owner, Name: p.Name}
		sp := ui.NewSpinner(fmt.Sprintf("Checking %s…", p.FullName()))
		sp.Start()

		pkg, err := v2.Install(v2.InstallOptions{
			Ref:     ref,
			Verbose: verbose,
			Force:   false, // skip if already at latest
		})

		if err == v2.ErrAlreadyInstalled {
			sp.Stop(true, fmt.Sprintf("%s %s (up to date)", p.FullName(), p.Version))
			skipped++
			continue
		}
		if err != nil {
			sp.Stop(false, fmt.Sprintf("%s: %v", p.FullName(), err))
			failed++
			continue
		}

		sp.Stop(true, fmt.Sprintf("%s %s → %s", pkg.FullName(), p.Version, pkg.Version))
		updated++
	}

	fmt.Println()
	ui.SectionEnd()

	if updated > 0 {
		ui.Success(fmt.Sprintf("%d package(s) updated", updated))
	}
	if skipped > 0 {
		ui.Note(fmt.Sprintf("%d package(s) already up to date", skipped))
	}
	if failed > 0 {
		ui.Warn(fmt.Sprintf("%d package(s) failed to update", failed))
	}

	return nil
}