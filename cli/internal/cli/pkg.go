package cli

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/spf13/cobra"

	"github.com/tsuki/cli/internal/manifest"
	"github.com/tsuki/cli/internal/pkgmgr"
	v2 "github.com/tsuki/cli/internal/pkgmgr/v2"
	"github.com/tsuki/cli/internal/ui"
)

func newPkgCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "pkg",
		Short: "Manage tsuki packages",
		Long: `Install, remove, and list packages.

Packages v2 support libraries, board packs, IDE plugins, SDK patches,
and app binaries (including tsuki-core and tsuki-flash themselves).

Install syntax:
  tsuki pkg install <name>
  tsuki pkg install <owner>/<name>
  tsuki pkg install <owner>/<name>@<version>

Packages are stored under: ~/.tsuki/`,
	}

	cmd.AddCommand(
		newInstallCmd(),      // new v2 install
		newPkgRemoveCmd(),
		newPkgListCmd(),
		newPkgSearchCmd(),
		newPkgAddCmd(),
		newPkgInfoCmd(),
		newSourceCmd(),       // new v2 source management
	)
	return cmd
}

// ── install (v2) ──────────────────────────────────────────────────────────────

func newInstallCmd() *cobra.Command {
	var force bool
	var verbose bool

	cmd := &cobra.Command{
		Use:   "install <package>",
		Short: "Install a package from a configured source",
		Long: `Install a package from any configured source.

Package reference formats:
  tsuki-flash                        latest from any source
  tsuki-team/tsuki-flash             latest from specific owner
  tsuki-team/tsuki-flash@v6.0.0     exact version
  tsuki-team/tsuki-flash@>=5.0      semver range

Package types installed:
  app        → ~/.tsuki/bin/<name>
  library    → ~/.tsuki/libs/<owner>/<name>/<version>/
  board-pack → ~/.tsuki/boards/<owner>/<name>/<version>/
  ide-plugin → ~/.tsuki/plugins/<owner>/<name>/<version>/`,
		Example: `  tsuki pkg install tsuki-flash
  tsuki pkg install tsuki-team/tsuki-core@>=6.0
  tsuki pkg install tsuki-team/dht
  tsuki pkg install mysource/my-board-pack@v1.2.0`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			raw := args[0]

			// Fall back to v1 install for paths and plain URLs
			if strings.HasPrefix(raw, "./") || strings.HasPrefix(raw, "/") ||
				strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
				return legacyInstall(raw, "", false)
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

			return nil
		},
	}

	cmd.Flags().BoolVarP(&force, "force", "f", false, "reinstall even if already at that version")
	cmd.Flags().BoolVarP(&verbose, "verbose", "v", false, "show download details")
	return cmd
}

// legacyInstall delegates to the v1 pkgmgr for path/URL installs.
func legacyInstall(source, version string, verbose bool) error {
	sp := ui.NewSpinner(fmt.Sprintf("Installing %s…", source))
	sp.Start()

	pkg, err := pkgmgr.Install(pkgmgr.InstallOptions{
		Source:  source,
		Version: version,
	})
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

	if pkg.ArduinoLib != "" {
		fmt.Println()
		ui.Warn(fmt.Sprintf("This package requires the '%s' Arduino library.", pkg.ArduinoLib))
		autoInstallArduinoLib(pkg.ArduinoLib)
	}
	return nil
}

// ── source ────────────────────────────────────────────────────────────────────

func newSourceCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "source",
		Short: "Manage package sources",
		Long: `Add, remove, or list package sources.

A source is a URL that exposes:
  <url>/packages.json     — package index
  <url>/tsuki-keys.json  — signing key index`,
	}
	cmd.AddCommand(
		newSourceAddCmd(),
		newSourceRemoveCmd(),
		newSourceListCmd(),
		newSourceUpdateCmd(),
	)
	return cmd
}

func newSourceAddCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "add <url>",
		Short: "Add a package source",
		Example: `  tsuki pkg source add https://raw.githubusercontent.com/myorg/my-packages/main`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			url := args[0]
			if err := v2.AddSource(url); err != nil {
				return err
			}
			ui.Success(fmt.Sprintf("Source added: %s", url))
			ui.Info("Run 'tsuki pkg source update' to fetch the package index")
			return nil
		},
	}
}

func newSourceRemoveCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "remove <url>",
		Aliases: []string{"rm"},
		Short:   "Remove a package source",
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := v2.RemoveSource(args[0]); err != nil {
				return err
			}
			ui.Success(fmt.Sprintf("Source removed: %s", args[0]))
			return nil
		},
	}
}

func newSourceListCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "list",
		Aliases: []string{"ls"},
		Short:   "List configured sources",
		RunE: func(cmd *cobra.Command, args []string) error {
			sources, err := v2.LoadSources()
			if err != nil {
				return err
			}
			ui.SectionTitle(fmt.Sprintf("Package sources (%d)", len(sources)))
			fmt.Println()
			for _, s := range sources {
				tag := ""
				if s.Priority == 0 {
					tag = "  [official]"
				}
				fmt.Printf("  %s%s\n", s.URL, tag)
			}
			fmt.Println()
			return nil
		},
	}
}

func newSourceUpdateCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "update",
		Short: "Refresh package indexes from all sources",
		RunE: func(cmd *cobra.Command, args []string) error {
			sp := ui.NewSpinner("Refreshing package indexes…")
			sp.Start()
			if err := v2.InvalidateCache(); err != nil {
				sp.Stop(false, "failed")
				return err
			}
			_, err := v2.FetchAllIndexes()
			if err != nil {
				sp.Stop(false, "failed")
				return err
			}
			sp.Stop(true, "Package indexes updated")
			return nil
		},
	}
}

// ── pkg add ───────────────────────────────────────────────────────────────────

func newPkgAddCmd() *cobra.Command {
	var version string

	cmd := &cobra.Command{
		Use:   "add <package-name>",
		Short: "Add an installed library to the current project's manifest",
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
		Use:     "remove <package>",
		Aliases: []string{"rm", "uninstall"},
		Short:   "Remove an installed package",
		Example: `  tsuki pkg remove ws2812
  tsuki pkg remove ws2812 --manifest`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]

			// Try v2 first
			if err := v2.Remove(name); err == nil {
				ui.Success(fmt.Sprintf("Removed %s", name))
				return nil
			}

			// Fall back to v1
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
			// v2 installed
			v2pkgs, _ := v2.ListInstalled()
			if len(v2pkgs) > 0 {
				ui.SectionTitle("Installed packages (v2)")
				fmt.Println()
				for _, p := range v2pkgs {
					fmt.Printf("  %-40s  %s  [%s]\n", p.FullName(), p.Version, p.Type)
				}
				fmt.Println()
			}

			// v1 installed
			pkgs, err := pkgmgr.ListInstalled()
			if err != nil {
				return err
			}
			if len(pkgs) > 0 {
				ui.SectionTitle("Installed packages (v1 libraries)")
				fmt.Println()
				pkgmgr.PrintList(pkgs)
				ui.Info(fmt.Sprintf("Libraries directory: %s", pkgmgr.LibsDir()))
			}

			if len(v2pkgs) == 0 && len(pkgs) == 0 {
				ui.Note("No packages installed.")
				ui.Info("Run 'tsuki pkg search' to find packages")
			}

			return nil
		},
	}
	return cmd
}

// ── pkg search ────────────────────────────────────────────────────────────────

func newPkgSearchCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "search [query]",
		Short: "Search for packages across all sources",
		Example: `  tsuki pkg search
  tsuki pkg search sensor
  tsuki pkg search rp2040`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			query := ""
			if len(args) > 0 {
				query = strings.ToLower(args[0])
			}

			sp := ui.NewSpinner("Searching packages…")
			sp.Start()
			entries, err := v2.FetchAllIndexes()
			sp.Stop(err == nil, "done")
			if err != nil {
				return err
			}

			fmt.Println()
			ui.SectionTitle("Packages")
			fmt.Println()
			fmt.Printf("  %-40s  %-12s  %-12s  %s\n", "NAME", "TYPE", "LATEST", "OWNER")
			fmt.Printf("  %s\n", strings.Repeat("─", 80))

			count := 0
			for _, e := range entries {
				if query != "" {
					if !strings.Contains(strings.ToLower(e.Name), query) &&
						!strings.Contains(strings.ToLower(e.Owner), query) &&
						!strings.Contains(strings.ToLower(string(e.Type)), query) {
						continue
					}
				}
				latest := ""
				if len(e.Versions) > 0 {
					latest = e.Versions[len(e.Versions)-1].Version
				}
				fmt.Printf("  %-40s  %-12s  %-12s  %s\n",
					e.FullName(), e.Type, latest, e.Owner)
				count++
			}

			fmt.Println()
			ui.Note(fmt.Sprintf("%d packages found", count))
			return nil
		},
	}
	return cmd
}

// ── pkg info ──────────────────────────────────────────────────────────────────

func newPkgInfoCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "info <package>",
		Short: "Show details about a package",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]

			// Check v2 installed first
			if p, err := v2.FindInstalled(name); err == nil {
				ui.PrintConfig(fmt.Sprintf("Package: %s", p.FullName()), []ui.ConfigEntry{
					{Key: "name",         Value: p.FullName()},
					{Key: "version",      Value: p.Version},
					{Key: "type",         Value: string(p.Type)},
					{Key: "path",         Value: p.Path},
					{Key: "installed_at", Value: p.InstalledAt.Format("2006-01-02")},
				}, false)
				return nil
			}

			// Fall back to v1
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

// ── Helpers ───────────────────────────────────────────────────────────────────

func autoInstallArduinoLib(lib string) {
	flashBin := cfg.FlashBinary
	if flashBin == "" {
		flashBin = "tsuki-flash"
	}

	useTsukiFlash := cfg.Backend == "tsuki-flash"
	if !useTsukiFlash {
		if _, err := exec.LookPath(flashBin); err == nil {
			useTsukiFlash = true
		}
	}

	if useTsukiFlash {
		ui.Info(fmt.Sprintf("Installing '%s' via tsuki-flash lib install…", lib))
		c := exec.Command(flashBin, "lib", "install", lib)
		c.Stdout = os.Stdout
		c.Stderr = os.Stderr
		if err := c.Run(); err != nil {
			ui.Warn("Auto-install failed. Run manually:")
			ui.Info(fmt.Sprintf("  tsuki-flash lib install \"%s\"", lib))
		} else {
			ui.Success(fmt.Sprintf("'%s' installed successfully.", lib))
		}
		return
	}

	arduinoCLI := cfg.ArduinoCLI
	if arduinoCLI == "" {
		arduinoCLI = "arduino-cli"
	}
	ui.Info(fmt.Sprintf("Installing '%s' via arduino-cli…", lib))
	c := exec.Command(arduinoCLI, "lib", "install", lib)
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr
	if err := c.Run(); err != nil {
		ui.Warn("Auto-install failed. Run manually:")
		ui.Info(fmt.Sprintf("  arduino-cli lib install \"%s\"", lib))
	} else {
		ui.Success(fmt.Sprintf("'%s' installed successfully.", lib))
	}
}