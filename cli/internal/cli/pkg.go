package cli

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/spf13/cobra"

	"github.com/tsuki/cli/internal/manifest"
	"github.com/tsuki/cli/internal/pkgmgr"
	"github.com/tsuki/cli/internal/ui"
)

func newPkgCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "pkg",
		Short: "Manage tsukilib packages",
		Long: `Install, remove, and list external library packages.

Packages extend the tsuki transpiler with new Go→C++ mappings.
Each package is a tsukilib.toml file describing a C++ library binding.

Packages are stored at: ` + pkgmgr.LibsDir() + `

Declared packages in goduino.json are automatically loaded during
'tsuki build' and 'tsuki check'.`,
	}

	cmd.AddCommand(
		newPkgInstallCmd(),
		newPkgRemoveCmd(),
		newPkgListCmd(),
		newPkgSearchCmd(),
		newPkgAddCmd(),
		newPkgInfoCmd(),
	)
	return cmd
}

// ── pkg install ───────────────────────────────────────────────────────────────

func newPkgInstallCmd() *cobra.Command {
	var version string

	cmd := &cobra.Command{
		Use:   "install <source>",
		Short: "Install a package from a local path or URL",
		Long: `Install a tsukilib package into the local package store.

<source> can be:
  - A local file path:   ./my-lib/tsukilib.toml
  - An HTTPS URL:        https://example.com/ws2812/tsukilib.toml
  - A registry name:     ws2812   (future — uses official registry)`,
		Example: `  tsuki pkg install ./ws2812/tsukilib.toml
  tsuki pkg install https://raw.githubusercontent.com/tsuki/packages/main/ws2812/1.0.0/tsukilib.toml
  tsuki pkg install ws2812`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			source := args[0]

			sp := ui.NewSpinner(fmt.Sprintf("Installing %s…", source))
			sp.Start()

			var pkg *pkgmgr.InstalledPackage
			var err error

			// If it's a bare name (no slashes or dots), use the registry
			if !strings.Contains(source, "/") && !strings.HasPrefix(source, ".") &&
				!strings.HasPrefix(source, "http://") && !strings.HasPrefix(source, "https://") {
				pkg, err = pkgmgr.InstallFromRegistry(source, version)
			} else {
				pkg, err = pkgmgr.Install(pkgmgr.InstallOptions{
					Source:  source,
					Version: version,
				})
			}

			if err != nil {
				sp.Stop(false, "installation failed")
				return err
			}

			sp.Stop(true, fmt.Sprintf("Installed %s@%s", pkg.Name, pkg.Version))
			fmt.Println()

			ui.PrintConfig("Package installed", []ui.ConfigEntry{
				{Key: "name",        Value: pkg.Name},
				{Key: "version",     Value: pkg.Version},
				{Key: "description", Value: pkg.Description},
				{Key: "cpp_header",  Value: pkg.CppHeader},
				{Key: "arduino_lib", Value: pkg.ArduinoLib},
				{Key: "path",        Value: pkg.Path},
			}, false)

			// Suggest adding to project manifest
			fmt.Println()
			ui.Info(fmt.Sprintf("Add to your project: tsuki pkg add %s", pkg.Name))

			// If arduino_lib is set, auto-install it via tsuki-flash or arduino-cli.
			if pkg.ArduinoLib != "" {
				fmt.Println()
				ui.Warn(fmt.Sprintf("This package requires the '%s' Arduino library.", pkg.ArduinoLib))

				flashBin := cfg.FlashBinary
				if flashBin == "" {
					flashBin = "tsuki-flash"
				}

				// Use tsuki-flash when: backend is explicitly set, OR the binary is on PATH.
				useTsukiFlash := cfg.Backend == "tsuki-flash"
				if !useTsukiFlash {
					if _, err := exec.LookPath(flashBin); err == nil {
						useTsukiFlash = true
					}
				}

				if useTsukiFlash {
					ui.Info(fmt.Sprintf("Installing '%s' via tsuki-flash lib install…", pkg.ArduinoLib))
					libCmd := exec.Command(flashBin, "lib", "install", pkg.ArduinoLib)
					libCmd.Stdout = os.Stdout
					libCmd.Stderr = os.Stderr
					if libErr := libCmd.Run(); libErr != nil {
						ui.Warn("Auto-install failed. Run manually:")
						ui.Info(fmt.Sprintf("  tsuki-flash lib install \"%s\"", pkg.ArduinoLib))
					} else {
						ui.Success(fmt.Sprintf("'%s' installed successfully.", pkg.ArduinoLib))
					}
				} else {
					arduinoCLI := cfg.ArduinoCLI
					if arduinoCLI == "" {
						arduinoCLI = "arduino-cli"
					}
					ui.Info(fmt.Sprintf("Installing '%s' via arduino-cli…", pkg.ArduinoLib))
					libCmd := exec.Command(arduinoCLI, "lib", "install", pkg.ArduinoLib)
					libCmd.Stdout = os.Stdout
					libCmd.Stderr = os.Stderr
					if libErr := libCmd.Run(); libErr != nil {
						ui.Warn("Auto-install failed. Run manually:")
						ui.Info(fmt.Sprintf("  arduino-cli lib install \"%s\"", pkg.ArduinoLib))
					} else {
						ui.Success(fmt.Sprintf("'%s' installed successfully.", pkg.ArduinoLib))
					}
				}
			}

			return nil
		},
	}

	cmd.Flags().StringVar(&version, "version", "", "override version from TOML")
	return cmd
}

// ── pkg add ───────────────────────────────────────────────────────────────────

func newPkgAddCmd() *cobra.Command {
	var version string

	cmd := &cobra.Command{
		Use:   "add <package-name>",
		Short: "Add an installed package to the current project's manifest",
		Long: `Declare a package as a dependency in goduino.json.

The package must already be installed (run 'tsuki pkg install' first).
This records the dependency so 'tsuki build' loads it automatically.`,
		Example: `  tsuki pkg add ws2812
  tsuki pkg add dht --version "^1.0.0"`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]

			dir := projectDir()
			projDir, m, err := manifest.Find(dir)
			if err != nil {
				return err
			}

			installed, installedVer := pkgmgr.IsInstalled(name)
			if !installed {
				return fmt.Errorf(
					"package %q is not installed\n"+
						"  Run: tsuki pkg install %s", name, name)
			}

			ver := version
			if ver == "" {
				ver = "^" + installedVer
			}

			if !m.AddPackage(name, ver) {
				ui.Warn(fmt.Sprintf("Package %q is already declared in %s", name, manifest.FileName))
				return nil
			}

			if err := m.Save(projDir); err != nil {
				return fmt.Errorf("saving manifest: %w", err)
			}

			ui.Success(fmt.Sprintf("Added %s@%s to goduino.json", name, ver))
			ui.Info("Run 'tsuki build' to transpile with this package")
			return nil
		},
	}

	cmd.Flags().StringVar(&version, "version", "", "version constraint (e.g. ^1.0.0)")
	return cmd
}

// ── pkg remove ────────────────────────────────────────────────────────────────

func newPkgRemoveCmd() *cobra.Command {
	var fromManifest bool

	cmd := &cobra.Command{
		Use:     "remove <package-name>",
		Aliases: []string{"rm", "uninstall"},
		Short:   "Remove an installed package",
		Example: `  tsuki pkg remove ws2812
  tsuki pkg remove ws2812 --manifest   # also removes from goduino.json`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]

			// Find installed version
			pkgs, err := pkgmgr.ListInstalled()
			if err != nil {
				return err
			}
			var found *pkgmgr.InstalledPackage
			for i := range pkgs {
				if pkgs[i].Name == name {
					found = &pkgs[i]
					break
				}
			}
			if found == nil {
				return fmt.Errorf("package %q is not installed", name)
			}

			sp := ui.NewSpinner(fmt.Sprintf("Removing %s@%s…", found.Name, found.Version))
			sp.Start()
			if err := pkgmgr.Remove(found.Name, found.Version); err != nil {
				sp.Stop(false, "removal failed")
				return err
			}
			sp.Stop(true, fmt.Sprintf("Removed %s@%s", found.Name, found.Version))

			// Optionally remove from manifest
			if fromManifest {
				dir := projectDir()
				projDir, m, err := manifest.Find(dir)
				if err == nil {
					if m.RemovePackage(name) {
						if err := m.Save(projDir); err == nil {
							ui.Info(fmt.Sprintf("Removed %s from goduino.json", name))
						}
					}
				}
			}

			return nil
		},
	}

	cmd.Flags().BoolVar(&fromManifest, "manifest", false, "also remove from goduino.json")
	return cmd
}

// ── pkg list ─────────────────────────────────────────────────────────────────

func newPkgListCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "list",
		Aliases: []string{"ls"},
		Short:   "List installed packages",
		RunE: func(cmd *cobra.Command, args []string) error {
			pkgs, err := pkgmgr.ListInstalled()
			if err != nil {
				return err
			}
			pkgmgr.PrintList(pkgs)
			ui.Info(fmt.Sprintf("Packages directory: %s", pkgmgr.LibsDir()))
			return nil
		},
	}
	return cmd
}

// ── pkg search ────────────────────────────────────────────────────────────────

func newPkgSearchCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "search [query]",
		Short: "Search the package registry",
		Example: `  tsuki pkg search
  tsuki pkg search sensor
  tsuki pkg search neopixel`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			query := ""
			if len(args) > 0 {
				query = args[0]
			}

			sp := ui.NewSpinner("Searching registry…")
			sp.Start()
			entries, err := pkgmgr.SearchRegistry(query)
			sp.Stop(err == nil, "done")

			if err != nil {
				return err
			}

			ui.SectionTitle("Package registry")
			fmt.Println()
			pkgmgr.PrintRegistryResults(entries)
			return nil
		},
	}
	return cmd
}

// ── pkg info ──────────────────────────────────────────────────────────────────

func newPkgInfoCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "info <package-name>",
		Short: "Show details about an installed package",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			pkgs, err := pkgmgr.ListInstalled()
			if err != nil {
				return err
			}
			for _, p := range pkgs {
				if p.Name == name {
					ui.PrintConfig(fmt.Sprintf("Package: %s", p.Name), []ui.ConfigEntry{
						{Key: "name",        Value: p.Name},
						{Key: "version",     Value: p.Version},
						{Key: "description", Value: p.Description},
						{Key: "cpp_header",  Value: p.CppHeader},
						{Key: "arduino_lib", Value: p.ArduinoLib},
						{Key: "path",        Value: p.Path},
					}, false)
					return nil
				}
			}
			return fmt.Errorf("package %q is not installed", name)
		},
	}
	return cmd
}