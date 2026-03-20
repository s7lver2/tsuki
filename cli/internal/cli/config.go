package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/tsuki/cli/internal/config"
	"github.com/tsuki/cli/internal/ui"
)

func newConfigCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Get or set CLI configuration",
		Long: `Manage tsuki CLI configuration.

The config file is stored at ~/.config/tsuki/config.json.

Use 'tsuki config set <key> <value>' to set a value.
Use 'tsuki config get <key>' to read a specific key.
Use 'tsuki config show' to display all settings.`,
	}

	cmd.AddCommand(
		newConfigSetCmd(),
		newConfigGetCmd(),
		newConfigShowCmd(),
		newConfigPathCmd(),
		newConfigRegistryCmd(),
	)
	return cmd
}

// ── config set ────────────────────────────────────────────────────────────────

func newConfigSetCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "set <key> <value>",
		Short: "Set a configuration key",
		Example: `  tsuki config set default_board esp32
  tsuki config set arduino_cli /usr/local/bin/arduino-cli
  tsuki config set verbose true
  tsuki config set default_baud 115200`,
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			key, value := args[0], args[1]

			c, err := config.Load()
			if err != nil {
				return err
			}

			if err := c.Set(key, value); err != nil {
				ui.Fail(err.Error())
				fmt.Fprintln(os.Stderr, "")
				ui.Info("Available keys:")
				for _, e := range config.Default().AllEntries() {
					ui.Step("  "+e.Key, e.Comment)
				}
				return fmt.Errorf("unknown key")
			}

			if err := c.Save(); err != nil {
				return fmt.Errorf("saving config: %w", err)
			}

			ui.Success(fmt.Sprintf("Set %s = %s", key, value))

			// Show updated entry in styled box
			ui.PrintConfig("tsuki config", []ui.ConfigEntry{
				{Key: key, Value: value},
			}, false)

			return nil
		},
	}
	return cmd
}

// ── config get ────────────────────────────────────────────────────────────────

func newConfigGetCmd() *cobra.Command {
	var (
		rawFlag   bool
		paramFlag string
	)

	cmd := &cobra.Command{
		Use:   "get <key>",
		Short: "Get a configuration key",
		Example: `  tsuki config get default_board
  tsuki config get default_board --raw
  tsuki config get default_board --param`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			key := args[0]
			_ = paramFlag

			c, err := config.Load()
			if err != nil {
				return err
			}

			val, err := c.Get(key)
			if err != nil {
				return err
			}

			if rawFlag {
				fmt.Println(val)
				return nil
			}

			// Find comment
			comment := ""
			for _, e := range c.AllEntries() {
				if e.Key == key {
					comment = e.Comment
					break
				}
			}

			ui.PrintConfig("tsuki config", []ui.ConfigEntry{
				{Key: key, Value: val, Comment: comment},
			}, false)

			return nil
		},
	}

	cmd.Flags().BoolVar(&rawFlag, "raw", false, "print raw value only (no styling)")
	cmd.Flags().StringVar(&paramFlag, "param", "", "filter by param (same as key)")
	return cmd
}

// ── config show ───────────────────────────────────────────────────────────────

func newConfigShowCmd() *cobra.Command {
	var rawFlag bool

	cmd := &cobra.Command{
		Use:     "show",
		Short:   "Show all configuration values",
		Aliases: []string{"list", "ls"},
		Example: `  tsuki config show
  tsuki config show --raw`,
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := config.Load()
			if err != nil {
				return err
			}

			entries := c.AllEntries()
			uiEntries := make([]ui.ConfigEntry, len(entries))
			for i, e := range entries {
				uiEntries[i] = ui.ConfigEntry{
					Key:     e.Key,
					Value:   e.Value,
					Comment: e.Comment,
				}
			}

			ui.PrintConfig("tsuki config", uiEntries, rawFlag)
			return nil
		},
	}

	cmd.Flags().BoolVar(&rawFlag, "raw", false, "print raw key=value pairs")
	return cmd
}

// ── config path ───────────────────────────────────────────────────────────────

func newConfigPathCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "path",
		Short: "Print the path to the config file",
		RunE: func(cmd *cobra.Command, args []string) error {
			p, err := config.Path()
			if err != nil {
				return err
			}
			ui.Info(fmt.Sprintf("Config file: %s", p))
			if _, err := os.Stat(p); os.IsNotExist(err) {
				ui.Warn("File does not exist yet — it will be created on first `tsuki config set`")
			}
			return nil
		},
	}
}

// ── config registry ───────────────────────────────────────────────────────────
//
// Manages the ordered list of package registry URLs (registry_urls in config).
// First entry has highest priority — on name collision, the first registry wins.
//
//	tsuki config registry list
//	tsuki config registry add    <url>
//	tsuki config registry remove <url>
//	tsuki config registry up     <url>   — raise priority
//	tsuki config registry down   <url>   — lower priority
//	tsuki config registry clear          — remove all custom registries (revert to default)

func newConfigRegistryCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "registry",
		Short: "Manage package registry URLs",
		Long: `Manage the ordered list of package registry URLs.

Registries are consulted in priority order — the first one wins on package
name collisions.  The built-in default registry is always the last fallback.

Priority chain (highest → lowest):
  1. tsuki_REGISTRY env var  (single URL, highest — overrides everything)
  2. registry_urls list      (managed by this command)
  3. Built-in default        (https://raw.githubusercontent.com/s7lver2/tsuki/…/packages.json)

Typical workflow when working on a branch:
  tsuki config registry add https://raw.githubusercontent.com/s7lver2/tsuki/refs/heads/my-branch/pkg/packages.json
  tsuki pkg install dht       # now fetches from your branch first
  tsuki config registry remove <url>   # when done`,
		Example: `  tsuki config registry list
  tsuki config registry add https://raw.githubusercontent.com/you/tsuki/refs/heads/v6.0/pkg/packages.json
  tsuki config registry remove https://raw.githubusercontent.com/you/tsuki/refs/heads/v6.0/pkg/packages.json
  tsuki config registry up   <url>
  tsuki config registry down <url>
  tsuki config registry clear`,
	}

	cmd.AddCommand(
		newRegistryListCmd(),
		newRegistryAddCmd(),
		newRegistryRemoveCmd(),
		newRegistryUpCmd(),
		newRegistryDownCmd(),
		newRegistryClearCmd(),
	)
	return cmd
}

func newRegistryListCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "list",
		Aliases: []string{"ls"},
		Short:   "List configured registries in priority order",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := config.Load()
			if err != nil {
				return err
			}
			effective := c.ResolvedRegistryURLs()
			if len(effective) == 0 {
				ui.Info("No registries configured — built-in default will be used")
				return nil
			}
			ui.SectionTitle(fmt.Sprintf("Registries (%d, priority order)", len(effective)))
			fmt.Println()
			for i, u := range effective {
				label := ""
				if i == 0 {
					label = "  ← highest priority"
				}
				if i == len(effective)-1 {
					label = "  ← fallback"
				}
				ui.ColorKey.Printf("  %d. ", i+1)
				fmt.Printf("%s", u)
				ui.ColorMuted.Printf("%s\n", label)
			}
			fmt.Println()
			ui.Info("First registry wins on package name collision.")
			return nil
		},
	}
}

func newRegistryAddCmd() *cobra.Command {
	var prepend bool
	cmd := &cobra.Command{
		Use:   "add <url>",
		Short: "Add a registry URL (prepended = highest priority by default)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			url := args[0]
			c, err := config.Load()
			if err != nil {
				return err
			}

			if prepend {
				// already default — just a flag for clarity
			}
			added := c.AddRegistry(url)
			if !added {
				ui.Warn(fmt.Sprintf("Registry already in list: %s", url))
				return nil
			}
			if err := c.Save(); err != nil {
				return fmt.Errorf("saving config: %w", err)
			}
			ui.Success(fmt.Sprintf("Registry added (priority 1): %s", url))
			printRegistryList(c)
			return nil
		},
	}
	cmd.Flags().BoolVar(&prepend, "prepend", true, "add as highest priority (default: true)")
	return cmd
}

func newRegistryRemoveCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "remove <url>",
		Aliases: []string{"rm", "del"},
		Short:   "Remove a registry URL from the list",
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			url := args[0]
			c, err := config.Load()
			if err != nil {
				return err
			}
			removed := c.RemoveRegistry(url)
			if !removed {
				ui.Warn(fmt.Sprintf("Registry not found in list: %s", url))
				ui.Info("Run `tsuki config registry list` to see current registries")
				return nil
			}
			if err := c.Save(); err != nil {
				return fmt.Errorf("saving config: %w", err)
			}
			ui.Success(fmt.Sprintf("Registry removed: %s", url))
			printRegistryList(c)
			return nil
		},
	}
}

func newRegistryUpCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "up <url>",
		Short: "Raise the priority of a registry (move it earlier in the list)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return moveRegistry(args[0], -1)
		},
	}
}

func newRegistryDownCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "down <url>",
		Short: "Lower the priority of a registry (move it later in the list)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return moveRegistry(args[0], +1)
		},
	}
}

func moveRegistry(url string, direction int) error {
	c, err := config.Load()
	if err != nil {
		return err
	}
	moved := c.MoveRegistry(url, direction)
	if !moved {
		if direction < 0 {
			ui.Warn("Registry not found or already at highest priority")
		} else {
			ui.Warn("Registry not found or already at lowest priority")
		}
		return nil
	}
	if err := c.Save(); err != nil {
		return fmt.Errorf("saving config: %w", err)
	}
	ui.Success("Registry priority updated")
	printRegistryList(c)
	return nil
}

func newRegistryClearCmd() *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:   "clear",
		Short: "Remove all custom registries (revert to built-in default only)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !yes {
				fmt.Print("  Remove all custom registries? [y/N] ")
				var input string
				fmt.Scanln(&input)
				if input != "y" && input != "Y" && input != "yes" {
					fmt.Println("  Cancelled.")
					return nil
				}
			}
			c, err := config.Load()
			if err != nil {
				return err
			}
			c.RegistryURLs = []string{}
			c.RegistryURL = ""
			if err := c.Save(); err != nil {
				return fmt.Errorf("saving config: %w", err)
			}
			ui.Success("Custom registries cleared — built-in default will be used")
			return nil
		},
	}
	cmd.Flags().BoolVarP(&yes, "yes", "y", false, "skip confirmation")
	return cmd
}

// printRegistryList prints the effective registry order after a mutation.
func printRegistryList(c *config.Config) {
	effective := c.ResolvedRegistryURLs()
	fmt.Println()
	ui.ColorMuted.Println("  Current registry order (highest → lowest priority):")
	for i, u := range effective {
		ui.ColorKey.Printf("    %d. ", i+1)
		fmt.Println(u)
	}
	fmt.Println()
}