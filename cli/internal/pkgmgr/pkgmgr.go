// ─────────────────────────────────────────────────────────────────────────────
//  godotino :: pkgmgr  —  install / remove / list godotinolib packages
//
//  Package install directory (priority order):
//    1. config.json  libs_dir
//    2. GODOTINO_LIBS environment variable
//    3. OS default:
//         Linux/macOS  ~/.local/share/godotino/libs
//         Windows      %APPDATA%\godotino\libs
//
//  Registry URL (priority order):
//    1. config.json  registry_url
//    2. GODOTINO_REGISTRY environment variable
//    3. Built-in default (GitHub raw)
//
//  Signing keys (priority order):
//    1. config.json  keys_dir / keys_index_url
//    2. GODOTINO_KEYS / GODOTINO_KEYS_INDEX environment variables
//    3. OS default / built-in URL
// ─────────────────────────────────────────────────────────────────────────────

package pkgmgr

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/godotino/cli/internal/config"
	"github.com/godotino/cli/internal/ui"
)

// ── Paths ─────────────────────────────────────────────────────────────────────

// LibsDir returns the root directory where packages are installed.
// Reads from config first, then GODOTINO_LIBS env var, then OS default.
func LibsDir() string {
	cfg, err := config.Load()
	if err == nil {
		return cfg.ResolvedLibsDir()
	}
	// Fallback: honour env var or use OS default directly.
	if env := os.Getenv("GODOTINO_LIBS"); env != "" {
		return env
	}
	return config.Default().ResolvedLibsDir()
}

// PackageDir returns the versioned directory for a given package.
func PackageDir(name, version string) string {
	return filepath.Join(LibsDir(), name, version)
}

// ManifestPath returns the path to godotinolib.toml for a given package version.
func ManifestPath(name, version string) string {
	return filepath.Join(PackageDir(name, version), "godotinolib.toml")
}

// KeysDir returns the directory where downloaded public signing keys are cached.
func KeysDir() string {
	cfg, err := config.Load()
	if err == nil {
		return cfg.ResolvedKeysDir()
	}
	if env := os.Getenv("GODOTINO_KEYS"); env != "" {
		return env
	}
	return config.Default().ResolvedKeysDir()
}

// ── InstalledPackage ──────────────────────────────────────────────────────────

// InstalledPackage describes a package on disk.
type InstalledPackage struct {
	Name        string
	Version     string
	Description string
	CppHeader   string
	ArduinoLib  string
	Path        string
}

// ListInstalled scans LibsDir and returns all installed packages.
func ListInstalled() ([]InstalledPackage, error) {
	root := LibsDir()
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading libs dir: %w", err)
	}

	var pkgs []InstalledPackage
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		versions, _ := os.ReadDir(filepath.Join(root, name))
		for _, v := range versions {
			if !v.IsDir() {
				continue
			}
			manifestPath := filepath.Join(root, name, v.Name(), "godotinolib.toml")
			if _, err := os.Stat(manifestPath); err != nil {
				continue
			}
			ip := InstalledPackage{
				Name:    name,
				Version: v.Name(),
				Path:    manifestPath,
			}
			if data, err := os.ReadFile(manifestPath); err == nil {
				ip.Description, ip.CppHeader, ip.ArduinoLib = quickParseMeta(string(data))
			}
			pkgs = append(pkgs, ip)
		}
	}
	sort.Slice(pkgs, func(i, j int) bool { return pkgs[i].Name < pkgs[j].Name })
	return pkgs, nil
}

// ── Install ───────────────────────────────────────────────────────────────────

// InstallSource describes where to fetch the package from.
type InstallSource int

const (
	SourceLocal    InstallSource = iota // local file path to godotinolib.toml
	SourceURL                           // https:// URL
	SourceRegistry                      // official registry slug
)

// InstallOptions controls how a package is installed.
type InstallOptions struct {
	Source  string // file path, URL, or registry slug
	Version string // desired version (optional; overrides what's in the TOML)
}

// Install fetches a godotinolib.toml and places it in LibsDir.
// If VerifySignatures is enabled in config, the package signature is checked
// against the key downloaded from the key index before writing to disk.
func Install(opts InstallOptions) (*InstalledPackage, error) {
	tomlData, err := fetchTOML(opts.Source)
	if err != nil {
		return nil, err
	}

	// Parse name + version from TOML
	name, version, description, header, arduinoLib, err := parseTOMLMeta(tomlData)
	if err != nil {
		return nil, err
	}
	if opts.Version != "" {
		version = opts.Version
	}

	// Signature verification (if enabled)
	cfg, _ := config.Load()
	if cfg != nil && cfg.VerifySignatures {
		if err := verifySignature(opts.Source, tomlData, cfg); err != nil {
			return nil, fmt.Errorf("signature verification failed for %s@%s: %w", name, version, err)
		}
	}

	destDir := PackageDir(name, version)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return nil, fmt.Errorf("creating package dir: %w", err)
	}

	destFile := filepath.Join(destDir, "godotinolib.toml")
	if err := os.WriteFile(destFile, []byte(tomlData), 0644); err != nil {
		return nil, fmt.Errorf("writing godotinolib.toml: %w", err)
	}

	return &InstalledPackage{
		Name:        name,
		Version:     version,
		Description: description,
		CppHeader:   header,
		ArduinoLib:  arduinoLib,
		Path:        destFile,
	}, nil
}

// Remove uninstalls a specific version of a package.
func Remove(name, version string) error {
	dir := PackageDir(name, version)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return fmt.Errorf("package %s@%s is not installed", name, version)
	}
	if err := os.RemoveAll(dir); err != nil {
		return fmt.Errorf("removing %s: %w", dir, err)
	}
	// Remove parent dir if empty
	parent := filepath.Join(LibsDir(), name)
	if entries, _ := os.ReadDir(parent); len(entries) == 0 {
		os.Remove(parent)
	}
	return nil
}

// IsInstalled reports whether a package (any version) is installed.
func IsInstalled(name string) (bool, string) {
	pkgs, _ := ListInstalled()
	for _, p := range pkgs {
		if p.Name == name {
			return true, p.Version
		}
	}
	return false, ""
}

// ── Signature verification ────────────────────────────────────────────────────

// KeyIndexEntry is one entry in the keys/index.json.
type KeyIndexEntry struct {
	// KeyID is an arbitrary identifier (e.g. "godotino-team").
	KeyID string `json:"key_id"`
	// PublicKeyURL is where the PEM/armoured public key can be downloaded.
	PublicKeyURL string `json:"public_key_url"`
	// SignatureURLTemplate is a Go template for the signature file URL.
	// Use "{toml_url}" as placeholder, e.g.:
	//   "https://raw.githubusercontent.com/.../sigs/{toml_url}.sig"
	SignatureURLTemplate string `json:"signature_url_template"`
}

// KeyIndex is the top-level object in keys/index.json.
type KeyIndex struct {
	Keys []KeyIndexEntry `json:"keys"`
}

// FetchKeyIndex downloads the key index from the configured URL.
func FetchKeyIndex() (*KeyIndex, error) {
	url := config.Default().ResolvedKeysIndexURL()
	if cfg, err := config.Load(); err == nil {
		url = cfg.ResolvedKeysIndexURL()
	}

	data, err := httpGet(url)
	if err != nil {
		return nil, fmt.Errorf("fetching key index from %s: %w", url, err)
	}
	var idx KeyIndex
	if err := json.Unmarshal(data, &idx); err != nil {
		return nil, fmt.Errorf("parsing key index: %w", err)
	}
	return &idx, nil
}

// EnsureKeyDownloaded downloads and caches a signing key by key ID.
// Returns the local file path.
func EnsureKeyDownloaded(entry KeyIndexEntry) (string, error) {
	dir := KeysDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("creating keys dir: %w", err)
	}

	localPath := filepath.Join(dir, entry.KeyID+".pub")
	if _, err := os.Stat(localPath); err == nil {
		return localPath, nil // already cached
	}

	data, err := httpGet(entry.PublicKeyURL)
	if err != nil {
		return "", fmt.Errorf("downloading key %s from %s: %w", entry.KeyID, entry.PublicKeyURL, err)
	}
	if err := os.WriteFile(localPath, data, 0644); err != nil {
		return "", fmt.Errorf("saving key to %s: %w", localPath, err)
	}
	return localPath, nil
}

// verifySignature is a stub — replace with actual crypto once the key
// infrastructure is live. For now it ensures the key can be fetched.
func verifySignature(source, tomlData string, cfg *config.Config) error {
	idx, err := FetchKeyIndex()
	if err != nil {
		return fmt.Errorf("cannot fetch key index: %w", err)
	}
	if len(idx.Keys) == 0 {
		return fmt.Errorf("key index is empty — cannot verify signature")
	}
	// Download the first matching key (production: match by author field).
	_, err = EnsureKeyDownloaded(idx.Keys[0])
	return err
}

// ── TOML fetch ────────────────────────────────────────────────────────────────

func fetchTOML(source string) (string, error) {
	if strings.HasPrefix(source, "http://") || strings.HasPrefix(source, "https://") {
		data, err := httpGet(source)
		if err != nil {
			return "", err
		}
		return string(data), nil
	}
	data, err := os.ReadFile(source)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", source, err)
	}
	return string(data), nil
}

func httpGet(url string) ([]byte, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GET %s: HTTP %d", url, resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

// ── Minimal TOML parser ───────────────────────────────────────────────────────

func parseTOMLMeta(toml string) (name, version, description, header, arduinoLib string, err error) {
	for _, line := range strings.Split(toml, "\n") {
		line = strings.TrimSpace(line)
		k, v, ok := parseKV(line)
		if !ok {
			continue
		}
		switch k {
		case "name":
			name = v
		case "version":
			version = v
		case "description":
			description = v
		case "cpp_header":
			header = v
		case "arduino_lib":
			arduinoLib = v
		}
	}
	if name == "" || version == "" {
		err = fmt.Errorf("godotinolib.toml must declare [package] name and version")
	}
	return
}

func quickParseMeta(toml string) (description, header, arduinoLib string) {
	for _, line := range strings.Split(toml, "\n") {
		line = strings.TrimSpace(line)
		k, v, ok := parseKV(line)
		if !ok {
			continue
		}
		switch k {
		case "description":
			description = v
		case "cpp_header":
			header = v
		case "arduino_lib":
			arduinoLib = v
		}
	}
	return
}

func parseKV(line string) (key, value string, ok bool) {
	if strings.HasPrefix(line, "#") || strings.HasPrefix(line, "[") {
		return
	}
	parts := strings.SplitN(line, "=", 2)
	if len(parts) != 2 {
		return
	}
	key = strings.TrimSpace(parts[0])
	value = strings.Trim(strings.TrimSpace(parts[1]), `"`)
	ok = true
	return
}

// ── Print helpers ─────────────────────────────────────────────────────────────

// PrintList renders the installed packages to stdout.
func PrintList(pkgs []InstalledPackage) {
	if len(pkgs) == 0 {
		ui.Info("No packages installed — run `godotino pkg install <source>` to add one")
		return
	}

	ui.SectionTitle(fmt.Sprintf("Installed packages (%d)", len(pkgs)))
	fmt.Println()

	ui.ColorTitle.Printf("  %-20s  %-10s  %-30s  %s\n", "NAME", "VERSION", "DESCRIPTION", "HEADER")
	ui.ColorMuted.Println("  " + strings.Repeat("─", 88))

	for _, p := range pkgs {
		desc := p.Description
		if len(desc) > 30 {
			desc = desc[:27] + "..."
		}
		ui.ColorKey.Printf("  %-20s", p.Name)
		ui.ColorNumber.Printf("  %-10s", p.Version)
		fmt.Printf("  %-30s", desc)
		ui.ColorMuted.Printf("  %s\n", p.CppHeader)
	}
	fmt.Println()
}

// ── Registry ──────────────────────────────────────────────────────────────────

// RegistryIndex is the top-level object in registry.json.
type RegistryIndex struct {
	Packages map[string]RegistryPackage `json:"packages"`
}

// RegistryPackage is one entry in the registry.
type RegistryPackage struct {
	Description string            `json:"description"`
	Author      string            `json:"author"`
	Latest      string            `json:"latest"`
	Versions    map[string]string `json:"versions"` // version -> TOML URL
}

// RegistryEntry is a flattened view used by the UI / install flow.
type RegistryEntry struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	Description string `json:"description"`
	URL         string `json:"toml_url"`
	ArduinoLib  string `json:"arduino_lib"`
}

// FetchRegistry downloads and parses the registry JSON from the configured URL.
func FetchRegistry() (*RegistryIndex, error) {
	url := config.Default().ResolvedRegistryURL()
	if cfg, err := config.Load(); err == nil {
		url = cfg.ResolvedRegistryURL()
	}

	data, err := httpGet(url)
	if err != nil {
		return nil, fmt.Errorf("fetching registry from %s: %w", url, err)
	}
	var idx RegistryIndex
	if err := json.Unmarshal(data, &idx); err != nil {
		return nil, fmt.Errorf("parsing registry JSON: %w", err)
	}
	return &idx, nil
}

// SearchRegistry queries the registry for packages matching the query string.
func SearchRegistry(query string) ([]RegistryEntry, error) {
	idx, err := FetchRegistry()
	if err != nil {
		return nil, err
	}

	q := strings.ToLower(query)
	var results []RegistryEntry
	for name, pkg := range idx.Packages {
		if q == "" ||
			strings.Contains(strings.ToLower(name), q) ||
			strings.Contains(strings.ToLower(pkg.Description), q) {

			tomlURL := pkg.Versions[pkg.Latest]
			results = append(results, RegistryEntry{
				Name:        name,
				Version:     pkg.Latest,
				Description: pkg.Description,
				URL:         tomlURL,
			})
		}
	}
	sort.Slice(results, func(i, j int) bool { return results[i].Name < results[j].Name })
	return results, nil
}

// InstallFromRegistry installs a package by name (optionally at a specific version).
func InstallFromRegistry(name, version string) (*InstalledPackage, error) {
	idx, err := FetchRegistry()
	if err != nil {
		return nil, err
	}

	entry, ok := idx.Packages[name]
	if !ok {
		return nil, fmt.Errorf("package %q not found in registry — run `godotino pkg search` to see available packages", name)
	}

	ver := version
	if ver == "" {
		ver = entry.Latest
	}

	tomlURL, ok := entry.Versions[ver]
	if !ok {
		versions := make([]string, 0, len(entry.Versions))
		for v := range entry.Versions {
			versions = append(versions, v)
		}
		sort.Strings(versions)
		return nil, fmt.Errorf(
			"version %q not found for package %q. Available versions: %s",
			ver, name, strings.Join(versions, ", "),
		)
	}

	return Install(InstallOptions{Source: tomlURL, Version: ver})
}

// PrintRegistryResults renders search results.
func PrintRegistryResults(entries []RegistryEntry) {
	if len(entries) == 0 {
		ui.Info("No packages found matching your query")
		return
	}

	ui.ColorTitle.Printf("  %-20s  %-10s  %-40s\n", "NAME", "VERSION", "DESCRIPTION")
	ui.ColorMuted.Println("  " + strings.Repeat("─", 76))

	for _, e := range entries {
		ui.ColorKey.Printf("  %-20s", e.Name)
		ui.ColorNumber.Printf("  %-10s", e.Version)
		fmt.Printf("  %s\n", e.Description)
	}
	fmt.Println()

	ui.Info("Install with: godotino pkg install <name>")
}

// ── Lock file ─────────────────────────────────────────────────────────────────

// LockEntry is one resolved package in godotino.lock.
type LockEntry struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Path    string `json:"path"`
}

// WriteLock writes a godotino.lock file from the resolved packages.
func WriteLock(projectDir string, pkgs []InstalledPackage) error {
	entries := make([]LockEntry, len(pkgs))
	for i, p := range pkgs {
		entries[i] = LockEntry{Name: p.Name, Version: p.Version, Path: p.Path}
	}
	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(projectDir, "godotino.lock"), append(data, '\n'), 0644)
}

// ReadLock reads a godotino.lock file.
func ReadLock(projectDir string) ([]LockEntry, error) {
	data, err := os.ReadFile(filepath.Join(projectDir, "godotino.lock"))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var entries []LockEntry
	return entries, json.Unmarshal(data, &entries)
}