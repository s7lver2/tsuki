// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-dk :: install  —  install all dependencies declared in tsuki.toml
//
//  Reads [dependencies] and [dev-dependencies] from the current package's
//  tsuki.toml and installs each via the pkgmgr v2 resolver.
//
//  Usage:
//    tsuki-dk install          # install [dependencies] + [dev-dependencies]
//    tsuki-dk install --no-dev # skip dev-dependencies
// ─────────────────────────────────────────────────────────────────────────────

package dk

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	v2 "github.com/tsuki/cli/internal/pkgmgr/v2"
	"github.com/tsuki/cli/internal/ui"
)

func newInstallCmd() *cobra.Command {
	var noDev    bool
	var verbose  bool

	cmd := &cobra.Command{
		Use:   "install",
		Short: "Install all dependencies declared in tsuki.toml",
		Long: `Download and install every package listed in [dependencies] and
[dev-dependencies] of the current tsuki.toml.

This is equivalent to running 'tsuki install <pkg>' for each dependency,
but reads the list directly from the manifest so you don't have to type
each one manually.`,
		Example: `  tsuki-dk install
  tsuki-dk install --no-dev
  tsuki-dk install --verbose`,
		RunE: func(cmd *cobra.Command, args []string) error {
			m, err := loadManifest(".")
			if err != nil {
				return err
			}
			return installDeps(m, noDev, verbose)
		},
	}

	cmd.Flags().BoolVar(&noDev, "no-dev", false, "skip dev-dependencies")
	cmd.Flags().BoolVarP(&verbose, "verbose", "v", false, "show download details")
	return cmd
}

// ── Dependency parsing ────────────────────────────────────────────────────────
// tsuki.toml uses simple key-value syntax for dependencies:
//
//   [dependencies]
//   "tsuki-team/tsuki-core" = ">=6.0"
//   "tsuki-team/dht"        = "1.0.0"
//
//   [dev-dependencies]
//   "tsuki-team/tsuki-dk" = ">=1.0"

type depEntry struct {
	raw        string // "owner/name" or "name"
	constraint string // ">=6.0" or "1.0.0"
}

func installDeps(m *DkManifest, noDev, verbose bool) error {
	deps := parseDeps(m.rawDeps)
	if !noDev {
		deps = append(deps, parseDeps(m.rawDevDeps)...)
	}

	if len(deps) == 0 {
		ui.Note("No dependencies declared in tsuki.toml")
		return nil
	}

	ui.SectionTitle(fmt.Sprintf("Installing %d dependenc%s", len(deps), map[bool]string{true: "y", false: "ies"}[len(deps) == 1]))
	fmt.Println()

	failed := 0
	for _, dep := range deps {
		raw := dep.raw
		if dep.constraint != "" {
			raw += "@" + dep.constraint
		}

		ref, err := v2.ParseRef(raw)
		if err != nil {
			ui.Warn(fmt.Sprintf("skipping %q: %v", raw, err))
			failed++
			continue
		}

		sp := ui.NewSpinner(fmt.Sprintf("Installing %s…", raw))
		sp.Start()

		pkg, err := v2.Install(v2.InstallOptions{
			Ref:     ref,
			Verbose: verbose,
		})

		if err == v2.ErrAlreadyInstalled {
			sp.Stop(true, fmt.Sprintf("%s (already installed)", dep.raw))
			continue
		}
		if err != nil {
			sp.Stop(false, fmt.Sprintf("failed: %v", err))
			failed++
			continue
		}

		sp.Stop(true, fmt.Sprintf("%s@%s", pkg.FullName(), pkg.Version))
	}

	fmt.Println()
	if failed > 0 {
		return fmt.Errorf("%d dependenc%s failed to install",
			failed, map[bool]string{true: "y", false: "ies"}[failed == 1])
	}
	ui.Success("All dependencies installed")
	return nil
}

func parseDeps(raw string) []depEntry {
	var out []depEntry
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := parseTomlKV(line)
		if !ok {
			continue
		}
		// k = "tsuki-team/dht"  (may have quotes stripped already)
		// v = ">=1.0"
		out = append(out, depEntry{raw: k, constraint: v})
	}
	return out
}