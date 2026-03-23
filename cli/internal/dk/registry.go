// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-dk :: registry  —  manage a local package registry
//
//  A registry is a directory (usually a git repo) containing:
//    packages.json     — package index (with rich metadata for the IDE)
//    tsuki-keys.json  — public key + author profile index
//
//  After editing, 'tsuki-dk registry sync' pushes both files to GitHub
//  (or any git remote) so they become available via `tsuki source add <url>`.
// ─────────────────────────────────────────────────────────────────────────────

package dk

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
	v2 "github.com/tsuki/cli/internal/pkgmgr/v2"
	"github.com/tsuki/cli/internal/ui"
)

func newRegistryCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "registry",
		Short: "Manage a local package registry",
		Long: `Create and manage a local registry that you can host on GitHub or any HTTP server.

A registry is a directory containing:
  packages.json     — index of all published packages (with full metadata)
  tsuki-keys.json  — public keys and author profiles of all allowed signers

Once published, users can add it with:
  tsuki source add https://raw.githubusercontent.com/you/your-registry/main`,
	}
	cmd.AddCommand(
		newRegistryInitCmd(),
		newRegistryAddCmd(),
		newRegistryRemoveCmd(),
		newRegistryInfoCmd(),
		newRegistryAuthorCmd(),
		newRegistrySyncCmd(),
		newRegistryStatusCmd(),
	)
	return cmd
}

// ── init ──────────────────────────────────────────────────────────────────────

func newRegistryInitCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "init [directory]",
		Short: "Initialize a new registry in the given directory",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := "."
			if len(args) == 1 {
				dir = args[0]
			}
			return registryInit(dir)
		},
	}
}

func registryInit(dir string) error {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	pkgPath := filepath.Join(dir, "packages.json")
	keyPath := filepath.Join(dir, "tsuki-keys.json")

	if !fileExists(pkgPath) {
		empty := v2.PackageIndex{
			SchemaVersion: 2,
			Packages:      []v2.IndexEntry{},
		}
		data, _ := json.MarshalIndent(empty, "", "  ")
		if err := os.WriteFile(pkgPath, data, 0644); err != nil {
			return err
		}
	}

	if !fileExists(keyPath) {
		empty := v2.KeyIndex{
			SchemaVersion: 2,
			Signers:       map[string]v2.KeyEntry{},
		}
		data, _ := json.MarshalIndent(empty, "", "  ")
		if err := os.WriteFile(keyPath, data, 0644); err != nil {
			return err
		}
	}

	ui.Success(fmt.Sprintf("Registry initialized at %s", dir))
	fmt.Println()
	ui.Note("Next steps:")
	ui.Note(fmt.Sprintf("  1. tsuki-dk key generate <your-name>"))
	ui.Note(fmt.Sprintf("  2. tsuki-dk registry author set <your-name>      # add your profile"))
	ui.Note(fmt.Sprintf("  3. tsuki-dk publish                               # from your package dir"))
	ui.Note(fmt.Sprintf("  4. tsuki-dk registry sync                         # push to git"))
	fmt.Println()
	ui.Info("Set TSUKI_DK_REGISTRY to point to this directory:")
	fmt.Printf("\n  set TSUKI_DK_REGISTRY=%s  (Windows)\n", dir)
	fmt.Printf("  export TSUKI_DK_REGISTRY=%s  (Unix)\n\n", dir)
	return nil
}

// ── add ───────────────────────────────────────────────────────────────────────

func newRegistryAddCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "add [package-dir]",
		Short: "Add the current (or specified) package to the local registry",
		Long: `Add a package entry to packages.json, pulling all metadata from tsuki.toml.

For ide-plugin packages, the [ide-plugin] section in tsuki.toml provides
permissions and slots. Description, tags, and icon come from [package].`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := "."
			if len(args) == 1 {
				dir = args[0]
			}
			m, err := loadManifest(dir)
			if err != nil {
				return err
			}
			return registryAdd(m)
		},
	}
}

func registryAdd(m *DkManifest) error {
	registryDir := getRegistryDir()
	pkgPath := filepath.Join(registryDir, "packages.json")

	idx, err := loadPackageIndex(pkgPath)
	if err != nil {
		return err
	}

	fullName := m.Package.Author + "/" + m.Package.Name

	// Check for existing entry — if found, update metadata instead of re-adding
	for i, p := range idx.Packages {
		if p.Owner == m.Package.Author && p.Name == m.Package.Name {
			idx.Packages[i] = enrichEntry(idx.Packages[i], m)
			if err := savePackageIndex(pkgPath, idx); err != nil {
				return err
			}
			ui.Success(fmt.Sprintf("Updated metadata for %s in registry", fullName))
			printEntryInfo(&idx.Packages[i])
			return nil
		}
	}

	entry := v2.IndexEntry{
		Name:     m.Package.Name,
		Owner:    m.Package.Author,
		Type:     v2.PkgType(m.Package.Type),
		Versions: []v2.Version{},
	}
	entry = enrichEntry(entry, m)

	idx.Packages = append(idx.Packages, entry)

	if err := savePackageIndex(pkgPath, idx); err != nil {
		return err
	}
	ui.Success(fmt.Sprintf("Added %s to registry", fullName))
	printEntryInfo(&entry)
	return nil
}

// enrichEntry copies all available metadata from the DkManifest into an IndexEntry.
func enrichEntry(e v2.IndexEntry, m *DkManifest) v2.IndexEntry {
	if m.Package.Description != "" {
		e.Description = m.Package.Description
	}
	if m.Package.Repository != "" {
		e.Repository = m.Package.Repository
	}
	// Propagate ide-plugin specific fields
	if m.IdePlugin != nil {
		if len(m.IdePlugin.Permissions) > 0 {
			e.Permissions = m.IdePlugin.Permissions
		}
		if len(m.IdePlugin.Slots) > 0 {
			e.Slots = m.IdePlugin.Slots
		}
		if len(m.IdePlugin.SettingsSchema) > 0 {
			defs := make([]v2.PluginSettingDef, 0, len(m.IdePlugin.SettingsSchema))
			for _, s := range m.IdePlugin.SettingsSchema {
				defs = append(defs, v2.PluginSettingDef{
					Key:         s.Key,
					Label:       s.Label,
					Description: s.Description,
					Type:        s.Type,
					Default:     coerceDefault(s.Default, s.Type),
					Options:     s.Options,
				})
			}
			e.SettingsSchema = defs
		}
	}
	// Tags and icon are set via 'tsuki-dk registry info edit' after add
	return e
}

func printEntryInfo(e *v2.IndexEntry) {
	fmt.Println()
	ui.Note(fmt.Sprintf("  type:        %s", e.Type))
	if e.Description != "" {
		ui.Note(fmt.Sprintf("  description: %s", e.Description))
	}
	if len(e.Tags) > 0 {
		ui.Note(fmt.Sprintf("  tags:        %s", joinStr(e.Tags, ", ")))
	}
	if len(e.Permissions) > 0 {
		ui.Note(fmt.Sprintf("  permissions: %s", joinStr(e.Permissions, ", ")))
	}
	if len(e.Slots) > 0 {
		ui.Note(fmt.Sprintf("  slots:       %s", joinStr(e.Slots, ", ")))
	}
	fmt.Println()
	ui.Info("Use 'tsuki-dk registry info <owner/name> [field] <value>' to edit metadata fields.")
}

// ── remove ────────────────────────────────────────────────────────────────────

func newRegistryRemoveCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "remove <owner/name>",
		Short: "Remove a package from the local registry",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return registryRemove(args[0])
		},
	}
}

func registryRemove(fullName string) error {
	registryDir := getRegistryDir()
	pkgPath := filepath.Join(registryDir, "packages.json")

	idx, err := loadPackageIndex(pkgPath)
	if err != nil {
		return err
	}

	filtered := idx.Packages[:0]
	found := false
	for _, p := range idx.Packages {
		if p.FullName() == fullName {
			found = true
			continue
		}
		filtered = append(filtered, p)
	}
	if !found {
		return fmt.Errorf("package %q not found in registry", fullName)
	}

	idx.Packages = filtered
	if err := savePackageIndex(pkgPath, idx); err != nil {
		return err
	}
	ui.Success(fmt.Sprintf("Removed %s from registry", fullName))
	return nil
}

// ── info ──────────────────────────────────────────────────────────────────────
//
// tsuki-dk registry info <owner/name>                       → print all fields
// tsuki-dk registry info <owner/name> description "..."     → set description
// tsuki-dk registry info <owner/name> tags "lsp,diag,..."   → set tags (comma-sep)
// tsuki-dk registry info <owner/name> icon "⚡"             → set emoji icon
// tsuki-dk registry info <owner/name> permissions "fs:read,shell:execute"
// tsuki-dk registry info <owner/name> slots "sidebar-tab,status-bar"
// tsuki-dk registry info <owner/name> repository "https://..."
// tsuki-dk registry info <owner/name> downloads 1234
// tsuki-dk registry info <owner/name> rating 4.8

func newRegistryInfoCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "info <owner/name> [field] [value]",
		Short: "View or edit metadata for a package in the registry",
		Long: `View or edit the rich metadata fields for a package entry.

Without field/value: prints all current metadata.
With field + value:  sets that field and saves packages.json.

Editable fields:
  description   — one-line summary shown in the IDE
  icon          — single emoji icon (e.g. "⚡")
  tags          — comma-separated list (e.g. "lsp,diagnostics,go")
  permissions   — comma-separated permission IDs (ide-plugin only)
  slots         — comma-separated slot names (ide-plugin only)
  repository    — URL to source repo
  downloads     — integer download counter
  rating        — float 0.0–5.0

Example:
  tsuki-dk registry info tsuki-team/ide-lsp description "LSP integration"
  tsuki-dk registry info tsuki-team/ide-lsp tags "lsp,diagnostics,completions"
  tsuki-dk registry info tsuki-team/ide-lsp icon "⚡"`,
		Args: cobra.RangeArgs(1, 3),
		RunE: func(cmd *cobra.Command, args []string) error {
			fullName := args[0]
			if len(args) == 1 {
				return registryInfoPrint(fullName)
			}
			if len(args) == 3 {
				return registryInfoSet(fullName, args[1], args[2])
			}
			return fmt.Errorf("usage: tsuki-dk registry info <owner/name> [field] [value]")
		},
	}
}

func registryInfoPrint(fullName string) error {
	registryDir := getRegistryDir()
	idx, err := loadPackageIndex(filepath.Join(registryDir, "packages.json"))
	if err != nil {
		return err
	}
	for _, p := range idx.Packages {
		if p.FullName() == fullName {
			fmt.Println()
			ui.SectionTitle(fullName)
			fmt.Println()
			rows := [][2]string{
				{"type", string(p.Type)},
				{"description", orDash(p.Description)},
				{"icon", orDash(p.Icon)},
				{"tags", orDash(joinStr(p.Tags, ", "))},
				{"permissions", orDash(joinStr(p.Permissions, ", "))},
				{"slots", orDash(joinStr(p.Slots, ", "))},
				{"repository", orDash(p.Repository)},
				{"downloads", fmt.Sprintf("%d", p.Downloads)},
				{"rating", fmt.Sprintf("%.1f", p.Rating)},
				{"versions", fmt.Sprintf("%d published", len(p.Versions))},
			}
			for _, r := range rows {
				fmt.Printf("  %-14s %s\n", r[0], r[1])
			}
			fmt.Println()
			return nil
		}
	}
	return fmt.Errorf("package %q not found in registry", fullName)
}

func registryInfoSet(fullName, field, value string) error {
	registryDir := getRegistryDir()
	pkgPath := filepath.Join(registryDir, "packages.json")
	idx, err := loadPackageIndex(pkgPath)
	if err != nil {
		return err
	}

	found := false
	for i, p := range idx.Packages {
		if p.FullName() != fullName {
			continue
		}
		found = true
		switch field {
		case "description":
			idx.Packages[i].Description = value
		case "icon":
			idx.Packages[i].Icon = value
		case "tags":
			idx.Packages[i].Tags = splitComma(value)
		case "permissions":
			idx.Packages[i].Permissions = splitComma(value)
		case "slots":
			idx.Packages[i].Slots = splitComma(value)
		case "repository":
			idx.Packages[i].Repository = value
		case "downloads":
			var n int64
			fmt.Sscanf(value, "%d", &n)
			idx.Packages[i].Downloads = n
		case "rating":
			var f float64
			fmt.Sscanf(value, "%f", &f)
			if f < 0 { f = 0 }
			if f > 5 { f = 5 }
			idx.Packages[i].Rating = f
		default:
			return fmt.Errorf("unknown field %q — run 'tsuki-dk registry info --help' for valid fields", field)
		}
		break
	}
	if !found {
		return fmt.Errorf("package %q not found in registry", fullName)
	}

	if err := savePackageIndex(pkgPath, idx); err != nil {
		return err
	}
	ui.Success(fmt.Sprintf("Set %s.%s = %s", fullName, field, value))
	return nil
}

// ── author ────────────────────────────────────────────────────────────────────
//
// Manages author profiles in tsuki-keys.json:
//
//   tsuki-dk registry author set  <name> [field] [value]   → set one field
//   tsuki-dk registry author show <name>                    → print profile
//   tsuki-dk registry author list                           → list all signers

func newRegistryAuthorCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "author",
		Short: "Manage author profiles in tsuki-keys.json",
		Long: `View and edit the author profiles stored in tsuki-keys.json.

Author profiles are displayed in the IDE plugin browser alongside
the plugins published by each signer.

Editable fields (via 'author set'):
  display_name  — shown next to the author's name in the IDE
  avatar_url    — public URL to a square profile image
  bio           — one-line bio
  website       — home page or GitHub URL
  verified      — "true" or "false"  (marks official tsuki-team signers)
  role          — "core", "contributor", or "community"`,
	}
	cmd.AddCommand(
		newRegistryAuthorSetCmd(),
		newRegistryAuthorShowCmd(),
		newRegistryAuthorListCmd(),
	)
	return cmd
}

func newRegistryAuthorSetCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "set <signer-name> <field> <value>",
		Short: "Set a profile field for a signer in tsuki-keys.json",
		Long: `Set one profile field for a signer.

The signer must already exist in tsuki-keys.json (added via 'tsuki-dk key export').
Use 'tsuki-dk registry author show <name>' to inspect current values.

Examples:
  tsuki-dk registry author set s7lver display_name "Salvador"
  tsuki-dk registry author set s7lver avatar_url "https://github.com/s7lver.png"
  tsuki-dk registry author set s7lver bio "tsuki creator"
  tsuki-dk registry author set s7lver website "https://github.com/s7lver"
  tsuki-dk registry author set s7lver verified true
  tsuki-dk registry author set s7lver role core`,
		Args: cobra.ExactArgs(3),
		RunE: func(cmd *cobra.Command, args []string) error {
			return registryAuthorSet(args[0], args[1], args[2])
		},
	}
}

func registryAuthorSet(name, field, value string) error {
	registryDir := getRegistryDir()
	keyPath := filepath.Join(registryDir, "tsuki-keys.json")

	ki, err := loadKeyIndex(keyPath)
	if err != nil {
		return err
	}

	entry, ok := ki.Signers[name]
	if !ok {
		return fmt.Errorf("signer %q not found in tsuki-keys.json — run 'tsuki-dk key export %s' first", name, name)
	}

	switch field {
	case "display_name":
		entry.DisplayName = value
	case "avatar_url":
		entry.AvatarURL = value
	case "bio":
		entry.Bio = value
	case "website":
		entry.Website = value
	case "verified":
		entry.Verified = strings.EqualFold(value, "true") || value == "1" || value == "yes"
	case "role":
		entry.Role = value
	default:
		return fmt.Errorf("unknown field %q — valid fields: display_name, avatar_url, bio, website, verified, role", field)
	}

	ki.Signers[name] = entry
	if err := saveKeyIndex(keyPath, ki); err != nil {
		return err
	}
	ui.Success(fmt.Sprintf("Set %s.%s = %s", name, field, value))
	return nil
}

func newRegistryAuthorShowCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "show <signer-name>",
		Short: "Print the full profile for a signer",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return registryAuthorShow(args[0])
		},
	}
}

func registryAuthorShow(name string) error {
	registryDir := getRegistryDir()
	ki, err := loadKeyIndex(filepath.Join(registryDir, "tsuki-keys.json"))
	if err != nil {
		return err
	}
	entry, ok := ki.Signers[name]
	if !ok {
		return fmt.Errorf("signer %q not found in tsuki-keys.json", name)
	}

	fmt.Println()
	ui.SectionTitle(name)
	fmt.Println()
	rows := [][2]string{
		{"public_key",   truncate(entry.PublicKey, 48)},
		{"display_name", orDash(entry.DisplayName)},
		{"avatar_url",   orDash(entry.AvatarURL)},
		{"bio",          orDash(entry.Bio)},
		{"website",      orDash(entry.Website)},
		{"verified",     fmt.Sprintf("%v", entry.Verified)},
		{"role",         orDash(entry.Role)},
		{"added_at",     entry.AddedAt.Format("2006-01-02")},
	}
	for _, r := range rows {
		fmt.Printf("  %-14s %s\n", r[0], r[1])
	}
	fmt.Println()
	return nil
}

func newRegistryAuthorListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List all signers in tsuki-keys.json",
		RunE: func(cmd *cobra.Command, args []string) error {
			return registryAuthorList()
		},
	}
}

func registryAuthorList() error {
	registryDir := getRegistryDir()
	ki, err := loadKeyIndex(filepath.Join(registryDir, "tsuki-keys.json"))
	if err != nil {
		return err
	}

	fmt.Println()
	fmt.Printf("  %-20s  %-24s  %-10s  %s\n", "SIGNER", "DISPLAY NAME", "ROLE", "VERIFIED")
	fmt.Printf("  %s\n", repeatStr("─", 70))
	for name, e := range ki.Signers {
		verified := ""
		if e.Verified {
			verified = "✓"
		}
		fmt.Printf("  %-20s  %-24s  %-10s  %s\n",
			name,
			orDash(e.DisplayName),
			orDash(e.Role),
			verified,
		)
	}
	fmt.Printf("\n  %d signers\n\n", len(ki.Signers))
	return nil
}

// ── sync ──────────────────────────────────────────────────────────────────────

func newRegistrySyncCmd() *cobra.Command {
	var message string
	cmd := &cobra.Command{
		Use:   "sync",
		Short: "Commit and push packages.json and tsuki-keys.json to git",
		RunE: func(cmd *cobra.Command, args []string) error {
			return registrySync(message)
		},
	}
	cmd.Flags().StringVarP(&message, "message", "m", "", "commit message")
	return cmd
}

func registrySync(message string) error {
	registryDir := getRegistryDir()

	if message == "" {
		message = "chore: update package registry"
		if m, err := loadManifest("."); err == nil {
			message = fmt.Sprintf("chore: publish %s/%s v%s",
				m.Package.Author, m.Package.Name, m.Package.Version)
		}
	}

	b := ui.NewLiveBlock("git commit")
	b.Start()

	cmds := [][]string{
		{"git", "-C", registryDir, "add", "packages.json", "tsuki-keys.json"},
		{"git", "-C", registryDir, "commit", "-m", message},
		{"git", "-C", registryDir, "push", "origin", "HEAD"},
	}

	for _, c := range cmds {
		out, err := runCapture(c[0], c[1:]...)
		if err != nil {
			b.Line(out)
			b.Finish(false, fmt.Sprintf("failed: %s", c[2]))
			return fmt.Errorf("%s failed:\n%s", c[2], out)
		}
		b.Line(out)
	}
	b.Finish(true, "registry pushed")
	return nil
}

// ── status ────────────────────────────────────────────────────────────────────

func newRegistryStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show the local registry contents",
		RunE: func(cmd *cobra.Command, args []string) error {
			return registryStatus()
		},
	}
}

func registryStatus() error {
	registryDir := getRegistryDir()
	pkgPath := filepath.Join(registryDir, "packages.json")
	keyPath := filepath.Join(registryDir, "tsuki-keys.json")

	idx, err := loadPackageIndex(pkgPath)
	if err != nil {
		return fmt.Errorf("registry not initialized — run: tsuki-dk registry init")
	}

	fmt.Println()
	ui.SectionTitle(fmt.Sprintf("Registry: %s", registryDir))
	fmt.Println()
	fmt.Printf("  %-40s  %-12s  %-6s  %s\n", "PACKAGE", "TYPE", "VERS", "DESCRIPTION")
	fmt.Printf("  %s\n", repeatStr("─", 80))

	for _, p := range idx.Packages {
		desc := p.Description
		if len(desc) > 38 {
			desc = desc[:35] + "…"
		}
		fmt.Printf("  %-40s  %-12s  %-6d  %s\n",
			p.FullName(), p.Type, len(p.Versions), desc)
	}

	fmt.Printf("\n  %d packages\n", len(idx.Packages))

	// Show signers
	if ki, err := loadKeyIndex(keyPath); err == nil && len(ki.Signers) > 0 {
		fmt.Println()
		fmt.Printf("  Signers (%d):\n", len(ki.Signers))
		for name, e := range ki.Signers {
			verified := ""
			if e.Verified {
				verified = " ✓"
			}
			display := name
			if e.DisplayName != "" {
				display = fmt.Sprintf("%s (%s)", name, e.DisplayName)
			}
			fmt.Printf("    %s%s\n", display, verified)
		}
	}
	fmt.Println()
	return nil
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func getRegistryDir() string {
	if d := os.Getenv("TSUKI_DK_REGISTRY"); d != "" {
		return d
	}
	return filepath.Join(".tsuki-dk", "registry")
}

func loadPackageIndex(path string) (*v2.PackageIndex, error) {
	var idx v2.PackageIndex
	if data, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(data, &idx); err != nil {
			return nil, fmt.Errorf("packages.json malformed: %w", err)
		}
	}
	if idx.Packages == nil {
		idx.Packages = []v2.IndexEntry{}
	}
	if idx.SchemaVersion == 0 {
		idx.SchemaVersion = 2
	}
	return &idx, nil
}

func savePackageIndex(path string, idx *v2.PackageIndex) error {
	idx.SchemaVersion = 2
	data, err := json.MarshalIndent(idx, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

func loadKeyIndex(path string) (*v2.KeyIndex, error) {
	ki := &v2.KeyIndex{
		SchemaVersion: 2,
		Signers:       map[string]v2.KeyEntry{},
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return ki, nil
		}
		return nil, err
	}
	if err := json.Unmarshal(data, ki); err != nil {
		return nil, fmt.Errorf("tsuki-keys.json malformed: %w", err)
	}
	if ki.Signers == nil {
		ki.Signers = map[string]v2.KeyEntry{}
	}
	return ki, nil
}

func saveKeyIndex(path string, ki *v2.KeyIndex) error {
	ki.SchemaVersion = 2
	data, err := json.MarshalIndent(ki, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

// coerceDefault converts the string value from tsuki.toml into the correct
// Go type so that JSON serialization produces the right JSON type.
func coerceDefault(raw, typ string) any {
	if raw == "" {
		return nil
	}
	switch typ {
	case "toggle":
		return raw == "true" || raw == "1" || raw == "yes"
	case "number":
		var n float64
		fmt.Sscanf(raw, "%f", &n)
		return n
	default:
		return raw
	}
}

func splitComma(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func orDash(s string) string {
	if s == "" {
		return "—"
	}
	return s
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func repeatStr(s string, n int) string {
	result := ""
	for i := 0; i < n; i++ {
		result += s
	}
	return result
}

func joinStr(parts []string, sep string) string {
	result := ""
	for i, p := range parts {
		if i > 0 {
			result += sep
		}
		result += p
	}
	return result
}

// addKeyToIndex is called by 'tsuki-dk key export' to write a signer's public
// key into tsuki-keys.json.  It preserves existing profile fields if the signer
// is already present.
func addKeyToIndex(name, publicKey string) error {
	registryDir := getRegistryDir()
	keyPath := filepath.Join(registryDir, "tsuki-keys.json")

	ki, err := loadKeyIndex(keyPath)
	if err != nil {
		return err
	}

	entry, exists := ki.Signers[name]
	if !exists {
		entry = v2.KeyEntry{AddedAt: time.Now()}
	}
	entry.PublicKey = publicKey
	ki.Signers[name] = entry

	return saveKeyIndex(keyPath, ki)
}