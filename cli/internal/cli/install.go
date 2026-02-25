// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: cli :: install  —  install a package into a project or globally
//
//  Usage:
//    tsuki install                         pull all deps from manifest
//    tsuki install ws2812                  install latest from default registry
//    tsuki install tsuki-team@ws2812:1.0   install specific version from registry
//    tsuki install ws2812 --global         install to ~/.local/share/tsuki/global/
//    tsuki install ws2812 --dev            add to [dev-dependencies]
// ─────────────────────────────────────────────────────────────────────────────

package cli

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/tsuki/cli/internal/manifest"
	"github.com/tsuki/cli/internal/pkgmgr"
	"github.com/tsuki/cli/internal/ui"
)

func newInstallCmd() *cobra.Command {
	var (
		global bool
		dev    bool
	)

	cmd := &cobra.Command{
		Use:   "install [package-spec]",
		Short: "Install a package dependency",
		Long: `Install a package into the current project (local) or globally.

Package spec format:
  name                  latest version from default registry
  name:1.2.3            specific version
  registry@name:1.2.3   specific registry + version
`,
		Example: `  tsuki install
  tsuki install ws2812
  tsuki install ws2812:1.0.0
  tsuki install tsuki-team@ws2812:1.0.0
  tsuki install ws2812 --global
  tsuki install ws2812 --dev`,
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := projectDir()

			// No args = pull everything from manifest.
			if len(args) == 0 {
				return runPullAll(dir)
			}

			spec := args[0]
			ui.SectionTitle(fmt.Sprintf("Installing  %s", spec))

			opts := pkgmgr.InstallOptions{
				Spec:   spec,
				Global: global,
				Dev:    dev,
				Dir:    dir,
			}

			pkg, err := pkgmgr.Install(opts)
			if err != nil {
				ui.Fail(fmt.Sprintf("install failed: %v", err))
				return err
			}

			ui.Success(fmt.Sprintf("installed %s @ %s", pkg.Name, pkg.Version))

			// Update the manifest unless global.
			if !global {
				m, err := manifest.Load(dir)
				if err == nil {
					if dev {
						if m.DevDependencies == nil {
							m.DevDependencies = make(map[string]manifest.DepSpec)
						}
						m.DevDependencies[pkg.Name] = manifest.DepSpec{Version: pkg.Version}
					} else {
						m.AddPackage(pkg.Name, pkg.Version)
					}
					if saveErr := m.Save(dir); saveErr != nil {
						ui.Warn(fmt.Sprintf("could not update manifest: %v", saveErr))
					} else {
						ui.Step("manifest", fmt.Sprintf("added %s = %q", pkg.Name, pkg.Version))
					}
				}
			}

			return nil
		},
	}

	cmd.Flags().BoolVar(&global, "global", false, "install globally (~/.local/share/tsuki/global/)")
	cmd.Flags().BoolVar(&dev, "dev", false, "add to [dev-dependencies]")
	return cmd
}

// runPullAll installs every dependency listed in the project manifest.
func runPullAll(dir string) error {
	m, err := manifest.Load(dir)
	if err != nil {
		return err
	}

	if len(m.Dependencies) == 0 && len(m.Packages) == 0 {
		ui.Info("No dependencies listed in manifest.")
		return nil
	}

	ui.SectionTitle("Installing dependencies")

	var count int
	for name, dep := range m.Dependencies {
		spec := name
		if dep.Version != "" {
			spec = name + ":" + dep.Version
		}
		sp := ui.NewSpinner(spec)
		sp.Start()
		pkg, err := pkgmgr.Install(pkgmgr.InstallOptions{Spec: spec, Dir: dir})
		if err != nil {
			sp.Stop(false, fmt.Sprintf("%s — %v", name, err))
		} else {
			sp.Stop(true, fmt.Sprintf("%s @ %s", pkg.Name, pkg.Version))
			count++
		}
	}

	ui.Success(fmt.Sprintf("installed %d package(s)", count))
	return nil
}