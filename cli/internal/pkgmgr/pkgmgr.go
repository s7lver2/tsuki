// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: pkgmgr  —  install / remove / list tsukilib packages
//
//  Package install directory (priority order):
//    1. config.json  libs_dir
//    2. tsuki_LIBS environment variable
//    3. OS default: ~/.local/share/tsuki/libs  (Linux/macOS)
//                   %APPDATA%\tsuki\libs        (Windows)
//
//  Registries (priority order — first registry wins on name collision):
//    1. tsuki_REGISTRY env var  (single URL, prepended)
//    2. config.json  registry_urls  (ordered list)
//    3. config.json  registry_url   (legacy single-URL, backward compat)
//    4. Built-in default (github.com/s7lver/tsuki-pkgs)
//
//  Each registry JSON may include a "key_index_url" field pointing to its
//  own signing-key index.  The global key index in config is the fallback.
//
//  Signature verification uses Ed25519:
//    - Public keys are PEM-encoded ("PUBLIC KEY" block, raw Ed25519).
//    - Signature files are fetched from <toml_url>.sig (raw 64-byte binary).
// ─────────────────────────────────────────────────────────────────────────────

package pkgmgr

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/tsuki/cli/internal/config"
	"github.com/tsuki/cli/internal/ui"
)

// ── Paths ─────────────────────────────────────────────────────────────────────

func LibsDir() string {
	cfg, err := config.Load()
	if err == nil {
		return cfg.ResolvedLibsDir()
	}
	if env := os.Getenv("tsuki_LIBS"); env != "" {
		return env
	}
	return config.Default().ResolvedLibsDir()
}

func PackageDir(name, version string) string {
	return filepath.Join(LibsDir(), name, version)
}

func ManifestPath(name, version string) string {
	return filepath.Join(PackageDir(name, version), "tsukilib.toml")
}

func KeysDir() string {
	cfg, err := config.Load()
	if err == nil {
		return cfg.ResolvedKeysDir()
	}
	if env := os.Getenv("tsuki_KEYS"); env != "" {
		return env
	}
	return config.Default().ResolvedKeysDir()
}

// ── InstalledPackage ──────────────────────────────────────────────────────────

type InstalledPackage struct {
	Name        string
	Version     string
	Description string
	CppHeader   string
	ArduinoLib  string
	Path        string
}

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
			mpath := filepath.Join(root, name, v.Name(), "tsukilib.toml")
			if _, err := os.Stat(mpath); err != nil {
				continue
			}
			ip := InstalledPackage{Name: name, Version: v.Name(), Path: mpath}
			if data, err := os.ReadFile(mpath); err == nil {
				ip.Description, ip.CppHeader, ip.ArduinoLib = quickParseMeta(string(data))
			}
			pkgs = append(pkgs, ip)
		}
	}
	sort.Slice(pkgs, func(i, j int) bool { return pkgs[i].Name < pkgs[j].Name })
	return pkgs, nil
}

// ── Install ───────────────────────────────────────────────────────────────────

type InstallSource int

const (
	SourceLocal    InstallSource = iota
	SourceURL
	SourceRegistry
)

type InstallOptions struct {
	// ── legacy ────────────────────────────────────────────────────────────
	Source  string
	Version string

	// ── v3 ────────────────────────────────────────────────────────────────
	// Spec is the user-facing package specifier: "name", "name:1.2.3", or
	// "registry@name:1.2.3".  When set it takes precedence over Source.
	Spec   string
	Dir    string // project root for local installs
	Global bool   // install to global deps dir instead of .tsuki/deps/
	Dev    bool   // add to [dev-dependencies]
}

// Install fetches a tsukilib package and installs it.
//
// When opts.Spec is set (v3 path) the spec is parsed as "registry@name:version"
// and the package is looked up in the local DB cache then placed in either
// the project-local .tsuki/deps/ or the global deps dir.
//
// When opts.Source is set (legacy path) the TOML is fetched directly from that
// URL or file path and placed in LibsDir().
func Install(opts InstallOptions) (*InstalledPackage, error) {
	if opts.Spec != "" {
		return installFromSpec(opts)
	}
	return installFromSource(opts)
}

// installFromSpec handles "registry@name:version" specifiers (v3).
func installFromSpec(opts InstallOptions) (*InstalledPackage, error) {
	registry, name, version := parseInstallSpec(opts.Spec)

	// Resolve install root: local (.tsuki/deps/) or global.
	installRoot := specLocalDepDir(opts.Dir)
	if opts.Global {
		installRoot = specGlobalDepDir()
	}

	// Return early if already cached.
	if cached := findCachedPkg(installRoot, name, version); cached != nil {
		return cached, nil
	}

	// Resolve via local DB cache → live registry.
	tomlURL, resolvedVer, err := resolveSpecURL(registry, name, version)
	if err != nil {
		return nil, err
	}

	tomlData, err := fetchTOML(tomlURL)
	if err != nil {
		return nil, fmt.Errorf("downloading %s: %w", name, err)
	}

	pkgName, pkgVer, desc, header, lib, parseErr := parseTOMLMeta(tomlData)
	if parseErr != nil || pkgName == "" {
		pkgName = name
	}
	if pkgVer == "" {
		pkgVer = resolvedVer
	}

	destDir := filepath.Join(installRoot, pkgName, pkgVer)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return nil, fmt.Errorf("creating install dir: %w", err)
	}
	destFile := filepath.Join(destDir, "tsukilib.toml")
	if err := os.WriteFile(destFile, []byte(tomlData), 0644); err != nil {
		return nil, fmt.Errorf("writing tsukilib.toml: %w", err)
	}

	return &InstalledPackage{
		Name:        pkgName,
		Version:     pkgVer,
		Description: desc,
		CppHeader:   header,
		ArduinoLib:  lib,
		Path:        destFile,
	}, nil
}

// installFromSource is the original install path (legacy, uses opts.Source).
func installFromSource(opts InstallOptions) (*InstalledPackage, error) {
	tomlData, err := fetchTOML(opts.Source)
	if err != nil {
		return nil, err
	}

	name, version, description, header, arduinoLib, err := parseTOMLMeta(tomlData)
	if err != nil {
		return nil, err
	}
	if opts.Version != "" {
		version = opts.Version
	}

	// Signature verification
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

	destFile := filepath.Join(destDir, "tsukilib.toml")
	if err := os.WriteFile(destFile, []byte(tomlData), 0644); err != nil {
		return nil, fmt.Errorf("writing tsukilib.toml: %w", err)
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

func Remove(name, version string) error {
	dir := PackageDir(name, version)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return fmt.Errorf("package %s@%s is not installed", name, version)
	}
	if err := os.RemoveAll(dir); err != nil {
		return fmt.Errorf("removing %s: %w", dir, err)
	}
	parent := filepath.Join(LibsDir(), name)
	if entries, _ := os.ReadDir(parent); len(entries) == 0 {
		os.Remove(parent)
	}
	return nil
}

func IsInstalled(name string) (bool, string) {
	pkgs, _ := ListInstalled()
	for _, p := range pkgs {
		if p.Name == name {
			return true, p.Version
		}
	}
	return false, ""
}

// ── Ed25519 Signature verification ───────────────────────────────────────────

// KeyIndexEntry is one entry in a keys/index.json file.
type KeyIndexEntry struct {
	// KeyID is an arbitrary identifier (e.g. "tsuki-team").
	KeyID string `json:"key_id"`
	// PublicKeyURL is where the PEM-encoded Ed25519 public key lives.
	PublicKeyURL string `json:"public_key_url"`
	// SignatureURLTemplate is the URL pattern for .sig files.
	// Use "{toml_url}" as placeholder, e.g.:
	//   "https://raw.githubusercontent.com/.../sigs/{toml_url}.sig"
	// If empty, the signature URL defaults to <toml_url>.sig
	SignatureURLTemplate string `json:"signature_url_template"`
}

// KeyIndex is the top-level object in a keys/index.json.
type KeyIndex struct {
	Keys []KeyIndexEntry `json:"keys"`
}

// FetchKeyIndex downloads the key index from the given URL.
func FetchKeyIndex(url string) (*KeyIndex, error) {
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

// FetchGlobalKeyIndex fetches the key index from the configured global URL.
func FetchGlobalKeyIndex() (*KeyIndex, error) {
	url := config.Default().ResolvedKeysIndexURL()
	if cfg, err := config.Load(); err == nil {
		url = cfg.ResolvedKeysIndexURL()
	}
	return FetchKeyIndex(url)
}

// EnsureKeyDownloaded downloads and caches a public key by key ID.
// Returns the local file path.
func EnsureKeyDownloaded(entry KeyIndexEntry) (string, error) {
	dir := KeysDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("creating keys dir: %w", err)
	}

	localPath := filepath.Join(dir, entry.KeyID+".pub")
	// Re-download if missing; cached keys are trusted on disk.
	if _, err := os.Stat(localPath); err == nil {
		return localPath, nil
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

// verifySignature verifies the Ed25519 signature of a TOML package file.
//
// Algorithm:
//  1. Load all configured key indexes (per-registry + global).
//  2. For each key entry, fetch (or use cached) public key.
//  3. Derive the signature URL: use SignatureURLTemplate if set,
//     otherwise append ".sig" to the toml URL.
//  4. Fetch the .sig file (raw 64-byte Ed25519 signature).
//  5. Verify ed25519.Verify(pubkey, []byte(tomlData), sig).
//  6. Return nil on the first successful verification; error if all fail.
func verifySignature(tomlURL, tomlData string, cfg *config.Config) error {
	// Collect all key index URLs to try: per-registry indexes + global fallback.
	var keyIndexURLs []string
	for _, regURL := range cfg.ResolvedRegistryURLs() {
		idx, err := fetchRegistryFromURL(regURL)
		if err == nil && idx.KeyIndexURL != "" {
			keyIndexURLs = append(keyIndexURLs, idx.KeyIndexURL)
		}
	}
	keyIndexURLs = append(keyIndexURLs, cfg.ResolvedKeysIndexURL())

	// Deduplicate
	seen := make(map[string]bool)
	var uniqueIndexURLs []string
	for _, u := range keyIndexURLs {
		if !seen[u] {
			seen[u] = true
			uniqueIndexURLs = append(uniqueIndexURLs, u)
		}
	}

	var lastErr error
	for _, idxURL := range uniqueIndexURLs {
		keyIdx, err := FetchKeyIndex(idxURL)
		if err != nil {
			lastErr = err
			continue
		}
		for _, entry := range keyIdx.Keys {
			if err := tryVerifyWithKey(entry, tomlURL, tomlData); err == nil {
				return nil // verified successfully
			} else {
				lastErr = err
			}
		}
	}

	if lastErr != nil {
		return fmt.Errorf("no key could verify the package signature: %w", lastErr)
	}
	return fmt.Errorf("no signing keys found in any key index")
}

// tryVerifyWithKey attempts to verify tomlData's signature using one key entry.
func tryVerifyWithKey(entry KeyIndexEntry, tomlURL, tomlData string) error {
	// 1. Determine signature URL
	sigURL := tomlURL + ".sig"
	if entry.SignatureURLTemplate != "" {
		sigURL = strings.ReplaceAll(entry.SignatureURLTemplate, "{toml_url}", tomlURL)
	}

	// 2. Fetch the signature (raw bytes)
	sigBytes, err := httpGet(sigURL)
	if err != nil {
		return fmt.Errorf("fetching signature from %s: %w", sigURL, err)
	}
	if len(sigBytes) != ed25519.SignatureSize {
		return fmt.Errorf("invalid signature length %d (expected %d)", len(sigBytes), ed25519.SignatureSize)
	}

	// 3. Fetch (or use cached) public key
	keyPath, err := EnsureKeyDownloaded(entry)
	if err != nil {
		return fmt.Errorf("fetching public key %s: %w", entry.KeyID, err)
	}

	// 4. Parse PEM-encoded Ed25519 public key
	pubKey, err := loadEd25519PublicKey(keyPath)
	if err != nil {
		return fmt.Errorf("loading public key %s: %w", entry.KeyID, err)
	}

	// 5. Verify
	if !ed25519.Verify(pubKey, []byte(tomlData), sigBytes) {
		return fmt.Errorf("signature invalid for key %s", entry.KeyID)
	}
	return nil
}

// loadEd25519PublicKey parses an Ed25519 public key from a PEM file.
// Accepts "PUBLIC KEY" PEM blocks (PKIX/DER-encoded).
func loadEd25519PublicKey(path string) (ed25519.PublicKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("no PEM block found in %s", path)
	}
	if block.Type != "PUBLIC KEY" {
		return nil, fmt.Errorf("expected PEM type 'PUBLIC KEY', got %q", block.Type)
	}

	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parsing PKIX public key: %w", err)
	}

	ed, ok := pub.(ed25519.PublicKey)
	if !ok {
		return nil, fmt.Errorf("key is not Ed25519 (got %T)", pub)
	}
	return ed, nil
}

// ── Registry ──────────────────────────────────────────────────────────────────

// RegistryIndex is the top-level object in a registry.json file.
type RegistryIndex struct {
	// KeyIndexURL optionally points to this registry's own signing-key index.
	// If set, it is consulted first during signature verification.
	KeyIndexURL string `json:"key_index_url,omitempty"`

	Packages map[string]RegistryPackage `json:"packages"`
}

type RegistryPackage struct {
	Description string            `json:"description"`
	Author      string            `json:"author"`
	Latest      string            `json:"latest"`
	Versions    map[string]string `json:"versions"` // version -> TOML URL
}

type RegistryEntry struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	Description string `json:"description"`
	URL         string `json:"toml_url"`
	ArduinoLib  string `json:"arduino_lib"`
	// RegistryURL is the source registry this entry came from.
	RegistryURL string `json:"registry_url"`
}

// fetchRegistryFromURL downloads and parses a single registry JSON.
func fetchRegistryFromURL(url string) (*RegistryIndex, error) {
	data, err := httpGet(url)
	if err != nil {
		return nil, fmt.Errorf("fetching registry from %s: %w", url, err)
	}
	var idx RegistryIndex
	if err := json.Unmarshal(data, &idx); err != nil {
		return nil, fmt.Errorf("parsing registry JSON from %s: %w", url, err)
	}
	return &idx, nil
}

// FetchAllRegistries fetches and merges packages from all configured registry
// URLs.  The first registry in the list wins on name collisions.  A warning
// is printed whenever a package name is shadowed by an earlier registry.
func FetchAllRegistries() (map[string]RegistryPackage, []string, error) {
	cfg, _ := config.Load()
	if cfg == nil {
		cfg = config.Default()
	}

	merged := make(map[string]RegistryPackage)   // name → package
	sourceMap := make(map[string]string)          // name → registry URL that owns it
	var registryURLs []string                     // which URLs were successfully fetched

	var firstErr error
	for _, regURL := range cfg.ResolvedRegistryURLs() {
		idx, err := fetchRegistryFromURL(regURL)
		if err != nil {
			ui.Warn(fmt.Sprintf("registry unavailable: %s — %v", regURL, err))
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		registryURLs = append(registryURLs, regURL)
		for name, pkg := range idx.Packages {
			if existing, exists := merged[name]; exists {
				_ = existing // suppress unused warning
				ui.Warn(fmt.Sprintf(
					"package %q from %s shadowed by earlier registry %s",
					name, regURL, sourceMap[name],
				))
			} else {
				merged[name] = pkg
				sourceMap[name] = regURL
			}
		}
	}

	if len(registryURLs) == 0 {
		if firstErr != nil {
			return nil, nil, firstErr
		}
		return nil, nil, fmt.Errorf("no registries could be reached")
	}
	return merged, registryURLs, nil
}

// SearchRegistry queries all configured registries for packages matching query.
func SearchRegistry(query string) ([]RegistryEntry, error) {
	packages, _, err := FetchAllRegistries()
	if err != nil {
		return nil, err
	}

	q := strings.ToLower(query)
	var results []RegistryEntry
	for name, pkg := range packages {
		if q == "" ||
			strings.Contains(strings.ToLower(name), q) ||
			strings.Contains(strings.ToLower(pkg.Description), q) ||
			strings.Contains(strings.ToLower(pkg.Author), q) {

			results = append(results, RegistryEntry{
				Name:        name,
				Version:     pkg.Latest,
				Description: pkg.Description,
				URL:         pkg.Versions[pkg.Latest],
			})
		}
	}
	sort.Slice(results, func(i, j int) bool { return results[i].Name < results[j].Name })
	return results, nil
}

// InstallFromRegistry installs a package by name from the merged registry.
func InstallFromRegistry(name, version string) (*InstalledPackage, error) {
	packages, _, err := FetchAllRegistries()
	if err != nil {
		return nil, err
	}

	entry, ok := packages[name]
	if !ok {
		return nil, fmt.Errorf(
			"package %q not found in any registry — run `tsuki pkg search` to see available packages",
			name,
		)
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
			"version %q not found for package %q. Available: %s",
			ver, name, strings.Join(versions, ", "),
		)
	}

	return Install(InstallOptions{Source: tomlURL, Version: ver})
}

// ── Print helpers ─────────────────────────────────────────────────────────────

func PrintList(pkgs []InstalledPackage) {
	if len(pkgs) == 0 {
		ui.Info("No packages installed — run `tsuki pkg install <source>` to add one")
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

	ui.Info("Install with: tsuki pkg install <name>")
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
		err = fmt.Errorf("tsukilib.toml must declare [package] name and version")
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

// ── Lock file ─────────────────────────────────────────────────────────────────

type LockEntry struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Path    string `json:"path"`
}

func WriteLock(projectDir string, pkgs []InstalledPackage) error {
	entries := make([]LockEntry, len(pkgs))
	for i, p := range pkgs {
		entries[i] = LockEntry{Name: p.Name, Version: p.Version, Path: p.Path}
	}
	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(projectDir, "tsuki.lock"), append(data, '\n'), 0644)
}

func ReadLock(projectDir string) ([]LockEntry, error) {
	data, err := os.ReadFile(filepath.Join(projectDir, "tsuki.lock"))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var entries []LockEntry
	return entries, json.Unmarshal(data, &entries)
}
// ─────────────────────────────────────────────────────────────────────────────
//  v3 helpers: spec parsing, local/global dep dirs, cache lookup, PullAll
// ─────────────────────────────────────────────────────────────────────────────

// parseInstallSpec splits "registry@name:version" into its three parts.
// All parts are optional:
//   "ws2812"                   → ("", "ws2812", "")
//   "ws2812:1.0.0"             → ("", "ws2812", "1.0.0")
//   "tsuki-team@ws2812:1.0.0"  → ("tsuki-team", "ws2812", "1.0.0")
func parseInstallSpec(spec string) (registry, name, version string) {
	if at := strings.Index(spec, "@"); at >= 0 {
		registry = spec[:at]
		spec = spec[at+1:]
	}
	if colon := strings.LastIndex(spec, ":"); colon >= 0 {
		version = spec[colon+1:]
		name = spec[:colon]
	} else {
		name = spec
	}
	return
}

// specLocalDepDir returns <projectDir>/.tsuki/deps.
func specLocalDepDir(projectDir string) string {
	if projectDir == "" {
		projectDir = "."
	}
	return filepath.Join(projectDir, ".tsuki", "deps")
}

// specGlobalDepDir returns ~/.local/share/tsuki/global/deps.
func specGlobalDepDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "share", "tsuki", "global", "deps")
}

// findCachedPkg returns an already-installed package from root, or nil.
func findCachedPkg(root, name, version string) *InstalledPackage {
	if version == "" {
		dir := filepath.Join(root, name)
		entries, err := os.ReadDir(dir)
		if err != nil || len(entries) == 0 {
			return nil
		}
		version = entries[len(entries)-1].Name()
	}
	tomlPath := filepath.Join(root, name, version, "tsukilib.toml")
	if _, err := os.Stat(tomlPath); err != nil {
		return nil
	}
	data, _ := os.ReadFile(tomlPath)
	desc, header, lib := quickParseMeta(string(data))
	return &InstalledPackage{
		Name:        name,
		Version:     version,
		Description: desc,
		CppHeader:   header,
		ArduinoLib:  lib,
		Path:        tomlPath,
	}
}

// resolveSpecURL looks up a package in the local DB cache (populated by
// `tsuki updatedb`) and returns its toml_url and resolved version.
func resolveSpecURL(registryName, name, version string) (url, resolvedVer string, err error) {
	home, _ := os.UserHomeDir()
	cacheDir := filepath.Join(home, ".cache", "tsuki", "db")

	var cacheFiles []string
	if registryName != "" {
		cacheFiles = []string{filepath.Join(cacheDir, registryName+".json")}
	} else {
		entries, _ := os.ReadDir(cacheDir)
		for _, e := range entries {
			if strings.HasSuffix(e.Name(), ".json") {
				cacheFiles = append(cacheFiles, filepath.Join(cacheDir, e.Name()))
			}
		}
	}

	for _, cf := range cacheFiles {
		data, readErr := os.ReadFile(cf)
		if readErr != nil {
			continue
		}
		u, v, lookupErr := lookupPackagesJSON(data, name, version)
		if lookupErr == nil {
			return u, v, nil
		}
	}
	return "", "", fmt.Errorf(
		"package %q not found in local registry cache — run `tsuki updatedb` first", name,
	)
}

// lookupPackagesJSON finds name@version in a packages.json byte slice.
// packages.json is an array: [{"name":"ws2812","version":"1.0.0","toml_url":"https://..."}]
func lookupPackagesJSON(data []byte, name, version string) (url, resolvedVersion string, err error) {
	var entries []map[string]interface{}
	if err = json.Unmarshal(data, &entries); err != nil {
		return
	}
	for _, e := range entries {
		n, _ := e["name"].(string)
		v, _ := e["version"].(string)
		u, _ := e["toml_url"].(string)
		if u == "" {
			u, _ = e["download_url"].(string)
		}
		if strings.EqualFold(n, name) && (version == "" || version == v) {
			return u, v, nil
		}
	}
	err = fmt.Errorf("package %q @ %q not found", name, version)
	return
}

// ── PullAll ───────────────────────────────────────────────────────────────────

// PullResult holds the outcome for a single package during PullAll.
type PullResult struct {
	Name    string
	Version string
	Err     error
}

// PullAll installs every dependency from the manifest at dir.
func PullAll(dir string) ([]PullResult, error) {
	// Import manifest inline to avoid import cycle — read the file directly.
	// We use the pkgmgr's own lock file as the source of truth when present.
	lockEntries, _ := ReadLock(dir)
	if len(lockEntries) > 0 {
		var results []PullResult
		for _, le := range lockEntries {
			pkg, err := Install(InstallOptions{Spec: le.Name + ":" + le.Version, Dir: dir})
			if err != nil {
				results = append(results, PullResult{Name: le.Name, Err: err})
			} else {
				results = append(results, PullResult{Name: pkg.Name, Version: pkg.Version})
			}
		}
		return results, nil
	}

	// No lock file — fall back to reading tsuki-config.toml / tsuki_package.json.
	deps, err := readManifestDeps(dir)
	if err != nil {
		return nil, err
	}

	var results []PullResult
	for name, version := range deps {
		spec := name
		if version != "" {
			spec = name + ":" + version
		}
		pkg, err := Install(InstallOptions{Spec: spec, Dir: dir})
		if err != nil {
			results = append(results, PullResult{Name: name, Err: err})
		} else {
			results = append(results, PullResult{Name: pkg.Name, Version: pkg.Version})
		}
	}
	return results, nil
}

// readManifestDeps returns name→version from the project manifest without
// importing the manifest package (avoids potential import cycle).
func readManifestDeps(dir string) (map[string]string, error) {
	// Try tsuki-config.toml first, then tsuki_package.json.
	for _, fname := range []string{"tsuki-config.toml", "tsuki_package.json"} {
		data, err := os.ReadFile(filepath.Join(dir, fname))
		if err != nil {
			continue
		}
		deps := make(map[string]string)
		if strings.HasSuffix(fname, ".json") {
			// Parse "packages": [{"name":"...","version":"..."}]
			var raw struct {
				Packages []struct {
					Name    string `json:"name"`
					Version string `json:"version"`
				} `json:"packages"`
			}
			if json.Unmarshal(data, &raw) == nil {
				for _, p := range raw.Packages {
					deps[p.Name] = p.Version
				}
			}
		} else {
			// Minimal TOML parse: lines under [dependencies] as  name = "version"
			inDeps := false
			for _, line := range strings.Split(string(data), "\n") {
				line = strings.TrimSpace(line)
				if line == "[dependencies]" {
					inDeps = true
					continue
				}
				if strings.HasPrefix(line, "[") {
					inDeps = false
					continue
				}
				if inDeps {
					k, v, ok := parseKV(line)
					if ok {
						// v may be `"1.0"` or `{ version = "1.0", ... }`
						v = strings.Trim(v, `"`)
						if idx := strings.Index(v, `"`); idx >= 0 {
							v = v[idx+1:]
							if end := strings.Index(v, `"`); end >= 0 {
								v = v[:end]
							}
						}
						deps[k] = v
					}
				}
			}
		}
		if len(deps) > 0 {
			return deps, nil
		}
	}
	return nil, nil
}