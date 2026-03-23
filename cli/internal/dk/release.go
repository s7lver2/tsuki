// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-dk :: release  —  integrated release pipeline
//
//  Previously this was a thin shim that shelled out to the external
//  tsuki-release binary. The pipeline is now implemented natively inside
//  tsuki-dk via the internal/release package, so no separate tool is needed.
//
//  Usage:
//    tsuki-dk release --all                         release all components
//    tsuki-dk release --component tsuki-flash        release one component
//    tsuki-dk release --component tsuki-flash --bump minor
//    tsuki-dk release --all --dry-run               simulate, no upload/push
//    tsuki-dk release --all --no-upload             sign locally, skip upload
//    tsuki-dk release --all --no-compression        skip UPX compression
//    tsuki-dk release auto                          auto-detect CI env
//    tsuki-dk release watch                         poll for new tags
//    tsuki-dk release ci generate                   write GitHub Actions workflow
//    tsuki-dk release registry sync                 push registry to git
//    tsuki-dk release registry status               show current index
//    tsuki-dk release key export                    write public key to registry
//    tsuki-dk release status                        show component versions
// ─────────────────────────────────────────────────────────────────────────────

package dk

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/tsuki/cli/internal/release"
	"github.com/tsuki/cli/internal/ui"
)

func newReleaseCmd() *cobra.Command {
	var (
		all           bool
		component     string
		bump          string
		dryRun        bool
		skipBuild     bool
		skipTests     bool
		skipPush      bool
		force         bool
		noUpload      bool
		noCompression bool
		configPath    string
	)

	cmd := &cobra.Command{
		Use:   "release",
		Short: "Build, sign, and publish components to the package registry",
		Long: `Build, sign, and publish one or all components defined in release.toml.

Each component goes through:
  1. Clone / update from GitHub
  2. Build for all target platforms (Go, Cargo, Tauri, npm)
  3. Compress binaries with UPX (--best --lzma) for smaller distribution
  4. Hash each artifact (SHA-256) and sign with the Ed25519 registry key
  5. Upload to the component's GitHub Release (unless --no-upload)
  6. Index in the registry's packages.json

New flags:

  --no-upload      Skip the GitHub Release upload. Artifacts are still built,
                   hashed, and signed — and the registry index is updated with
                   a local file:// URL. Useful for testing the full pipeline
                   without publishing or needing GITHUB_TOKEN.

  --no-compression Skip the UPX binary compression step. Use when UPX is not
                   installed, when targeting formats it cannot handle, or when
                   you need the unmodified binary for debugging.`,
		Example: `  tsuki-dk release --all
  tsuki-dk release --component tsuki-flash
  tsuki-dk release --component tsuki-flash --bump minor
  tsuki-dk release --all --dry-run
  tsuki-dk release --all --no-upload
  tsuki-dk release --all --no-compression
  tsuki-dk release --component dht --skip-build
  tsuki-dk release auto`,
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := release.LoadConfig(configPath)
			if err != nil {
				return fmt.Errorf("loading config: %w", err)
			}

			var targets []release.Component
			switch {
			case all:
				targets = cfg.Components
			case component != "":
				c, ok := cfg.ComponentByName(component)
				if !ok {
					return fmt.Errorf("component %q not found in release.toml", component)
				}
				targets = []release.Component{*c}
			default:
				return fmt.Errorf("specify --all or --component <name>")
			}

			opts := release.ReleaseOptions{
				Bump:          bump,
				DryRun:        dryRun,
				SkipBuild:     skipBuild,
				SkipTests:     skipTests,
				SkipPush:      skipPush,
				Force:         force,
				NoUpload:      noUpload,
				NoCompression: noCompression,
			}

			return release.RunRelease(cfg, targets, opts)
		},
	}

	// Original flags (parity with tsuki-release)
	cmd.Flags().BoolVar(&all, "all", false, "release all components in release.toml")
	cmd.Flags().StringVar(&component, "component", "", "release a single component by name")
	cmd.Flags().StringVar(&bump, "bump", "", "bump version: major | minor | patch")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "simulate without uploading or pushing")
	cmd.Flags().BoolVar(&skipBuild, "skip-build", false, "skip build (use existing artifacts)")
	cmd.Flags().BoolVar(&skipTests, "skip-tests", false, "skip test step")
	cmd.Flags().BoolVar(&skipPush, "skip-push", false, "update registry locally but don't git push")
	cmd.Flags().BoolVar(&force, "force", false, "re-release even if version already in registry")

	// New flags
	cmd.Flags().BoolVar(&noUpload, "no-upload", false,
		"sign + hash locally, skip GitHub Release upload (indexes with file:// URLs)")
	cmd.Flags().BoolVar(&noCompression, "no-compression", false,
		"skip UPX binary compression step")

	cmd.PersistentFlags().StringVarP(&configPath, "config", "c", "release.toml",
		"path to release.toml")

	// Subcommands
	cmd.AddCommand(
		newReleaseAutoCmd(),
		newReleaseWatchCmd(),
		newReleaseCICmd(),
		newReleaseRegistryCmd(),
		newReleaseKeyCmd(),
		newReleaseStatusCmd(),
	)

	return cmd
}

// ── release auto ──────────────────────────────────────────────────────────────

func newReleaseAutoCmd() *cobra.Command {
	var configPath string
	cmd := &cobra.Command{
		Use:   "auto",
		Short: "Auto-detect CI environment and release appropriate components",
		Long: `Examines the environment to determine what triggered the build:

  1. GITHUB_ACTIONS + GITHUB_REF → extracts tag, releases matching component
  2. CI + TAG env var → generic CI with explicit tag
  3. --tag flag → explicit override
  4. Latest local git tag not yet in the registry (polling fallback)`,
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := release.LoadConfig(configPath)
			if err != nil {
				return fmt.Errorf("loading config: %w", err)
			}
			return release.RunAuto(cfg, release.ReleaseOptions{})
		},
	}
	cmd.PersistentFlags().StringVarP(&configPath, "config", "c", "release.toml", "path to release.toml")
	return cmd
}

// ── release watch ─────────────────────────────────────────────────────────────

func newReleaseWatchCmd() *cobra.Command {
	var configPath string
	cmd := &cobra.Command{
		Use:   "watch",
		Short: "Poll for new git tags and release automatically",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := release.LoadConfig(configPath)
			if err != nil {
				return fmt.Errorf("loading config: %w", err)
			}
			return release.RunWatch(cfg)
		},
	}
	cmd.PersistentFlags().StringVarP(&configPath, "config", "c", "release.toml", "path to release.toml")
	return cmd
}

// ── release ci ────────────────────────────────────────────────────────────────

func newReleaseCICmd() *cobra.Command {
	cmd := &cobra.Command{Use: "ci", Short: "Generate CI workflow files"}
	var configPath string
	generate := &cobra.Command{
		Use:   "generate",
		Short: "Generate a GitHub Actions workflow that runs tsuki-dk release on tag push",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := release.LoadConfig(configPath)
			if err != nil {
				return fmt.Errorf("loading config: %w", err)
			}
			return release.GenerateCIWorkflow(cfg)
		},
	}
	generate.PersistentFlags().StringVarP(&configPath, "config", "c", "release.toml", "path to release.toml")
	cmd.AddCommand(generate)
	return cmd
}

// ── release registry ──────────────────────────────────────────────────────────

func newReleaseRegistryCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "registry", Short: "Manage the local registry index"}
	var configPath, message string

	syncCmd := &cobra.Command{
		Use:   "sync",
		Short: "Commit and push packages.json and tsuki-keys.json to git",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := release.LoadConfig(configPath)
			if err != nil {
				return fmt.Errorf("loading config: %w", err)
			}
			return release.SyncRegistry(cfg, message)
		},
	}
	syncCmd.Flags().StringVarP(&message, "message", "m", "", "git commit message")
	syncCmd.PersistentFlags().StringVarP(&configPath, "config", "c", "release.toml", "path to release.toml")

	statusCmd := &cobra.Command{
		Use:   "status",
		Short: "Show current registry index",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := release.LoadConfig(configPath)
			if err != nil {
				return fmt.Errorf("loading config: %w", err)
			}
			return release.PrintRegistryStatus(cfg)
		},
	}
	statusCmd.PersistentFlags().StringVarP(&configPath, "config", "c", "release.toml", "path to release.toml")

	cmd.AddCommand(syncCmd, statusCmd)
	return cmd
}

// ── release key ───────────────────────────────────────────────────────────────

func newReleaseKeyCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "key", Short: "Manage the registry signing key"}
	var configPath string

	exportCmd := &cobra.Command{
		Use:   "export",
		Short: "Write public key into the registry's tsuki-keys.json",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := release.LoadConfig(configPath)
			if err != nil {
				return fmt.Errorf("loading config: %w", err)
			}
			return release.ExportPublicKey(cfg)
		},
	}
	exportCmd.PersistentFlags().StringVarP(&configPath, "config", "c", "release.toml", "path to release.toml")

	generateCmd := &cobra.Command{
		Use:   "generate",
		Short: "Generate a new Ed25519 signing key at ~/.tsuki/keys/<key>.pem",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := release.LoadConfig(configPath)
			if err != nil {
				return fmt.Errorf("loading config: %w", err)
			}
			return release.GenerateKey(cfg.Registry.Key)
		},
	}
	generateCmd.PersistentFlags().StringVarP(&configPath, "config", "c", "release.toml", "path to release.toml")

	cmd.AddCommand(exportCmd, generateCmd)
	return cmd
}

// ── release status ────────────────────────────────────────────────────────────

func newReleaseStatusCmd() *cobra.Command {
	var configPath string
	cmd := &cobra.Command{
		Use:   "status",
		Short: "Show all components and their latest published versions",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := release.LoadConfig(configPath)
			if err != nil {
				return fmt.Errorf("loading config: %w", err)
			}
			return release.PrintStatus(cfg)
		},
	}
	cmd.PersistentFlags().StringVarP(&configPath, "config", "c", "release.toml", "path to release.toml")
	return cmd
}

// ── legacy shim (no-op, kept for clarity) ────────────────────────────────────

// ensureTsukiRelease was the old auto-install helper when tsuki-release was
// an external binary. The pipeline is now built-in; this is a no-op kept
// here only to avoid breaking any internal callers during the migration.
func ensureTsukiRelease() (string, error) {
	ui.Note("tsuki-release is now built into tsuki-dk — no separate install needed")
	return "", nil
}