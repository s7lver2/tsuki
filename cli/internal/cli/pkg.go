package cli

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"github.com/godotino/cli/internal/manifest"
	"github.com/godotino/cli/internal/pkgmgr"
	"github.com/godotino/cli/internal/ui"
)

func newPkgCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "pkg",
		Short: "Manage godotinolib packages",
		Long: `Install, remove, and list external library packages.

Packages extend the godotino transpiler with new Go→C++ mappings.
Each package is a godotinolib.toml file describing a C++ library binding.

Packages are stored at: ` + pkgmgr.LibsDir() + `

Declared packages in goduino.json are automatically loaded during
'godotino build' and 'godotino check'.`,
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
		Long: `Install a godotinolib package into the local package store.

<source> can be:
  - A local file path:   ./my-lib/godotinolib.toml
  - An HTTPS URL:        https://example.com/ws2812/godotinolib.toml
  - A registry name:     ws2812   (future — uses official registry)`,
		Example: `  godotino pkg install ./ws2812/godotinolib.toml
  godotino pkg install https://raw.githubusercontent.com/godotino/packages/main/ws2812/1.0.0/godotinolib.toml
  godotino pkg install ws2812`,
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
			ui.Info(fmt.Sprintf("Add to your project: godotino pkg add %s", pkg.Name))

			// If arduino_lib is set, suggest installing it
			if pkg.ArduinoLib != "" {
				fmt.Println()
				ui.Warn(fmt.Sprintf("This package requires the '%s' Arduino library.", pkg.ArduinoLib))
				ui.Info(fmt.Sprintf("Install it with: arduino-cli lib install \"%s\"", pkg.ArduinoLib))
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

The package must already be installed (run 'godotino pkg install' first).
This records the dependency so 'godotino build' loads it automatically.`,
		Example: `  godotino pkg add ws2812
  godotino pkg add dht --version "^1.0.0"`,
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
						"  Run: godotino pkg install %s", name, name)
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
			ui.Info("Run 'godotino build' to transpile with this package")
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
		Example: `  godotino pkg remove ws2812
  godotino pkg remove ws2812 --manifest   # also removes from goduino.json`,
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
		Example: `  godotino pkg search
  godotino pkg search sensor
  godotino pkg search neopixel`,
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