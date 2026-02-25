// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: registry  —  multi-registry package resolution
//
//  Two files govern the registry system:
//
//  keys.json  (~/.config/tsuki/keys.json)
//  ──────────────────────────────────────
//  User-editable list of package sources:
//  {
//    "registries": [
//      {
//        "id":           "tsuki-team",
//        "name":         "Tsuki Official Registry",
//        "packages_url": "https://raw.githubusercontent.com/.../packages.json",
//        "trusted":      true
//      }
//    ]
//  }
//
//  packages.json  (one per registry, served from that registry's URL)
//  ──────────────────────────────────────────────────────────────────
//  {
//    "packages": {
//      "ws2812": {
//        "description": "...",
//        "author":      "tsuki-team",
//        "latest":      "1.0.0",
//        "versions": {
//          "1.0.0": {
//            "download_url":  "https://.../ws2812-1.0.0.tar.gz",
//            "metadata_url":  "https://.../tsuki-package.json",
//            "checksum":      "sha256:abc...",
//            "published_at":  "2025-01-01T00:00:00Z"
//          }
//        }
//      }
//    }
//  }
//
//  Spec format for tsuki install:
//    tsuki install ws2812                     → search all registries
//    tsuki install ws2812:1.0.0               → specific version
//    tsuki install tsuki-team@ws2812          → specific registry
//    tsuki install tsuki-team@ws2812:1.0.0    → registry + version
// ─────────────────────────────────────────────────────────────────────────────

package registry

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

// ── Keys.json ─────────────────────────────────────────────────────────────────

// RegistrySource describes a single entry in keys.json.
type RegistrySource struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	PackagesURL string `json:"packages_url"`
	Trusted     bool   `json:"trusted"`
}

// KeysFile is the structure of ~/.config/tsuki/keys.json.
type KeysFile struct {
	Registries []RegistrySource `json:"registries"`
}

// DefaultKeysFile returns the path to keys.json.
func DefaultKeysFile() string {
	return filepath.Join(configDir(), "keys.json")
}

func configDir() string {
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		return filepath.Join(xdg, "tsuki")
	}
	if runtime.GOOS == "windows" {
		base := os.Getenv("APPDATA")
		if base == "" {
			base = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Roaming")
		}
		return filepath.Join(base, "tsuki")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "tsuki")
}

// LoadKeys reads keys.json from disk, returning defaults if it doesn't exist.
func LoadKeys() (*KeysFile, error) {
	path := DefaultKeysFile()
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return defaultKeys(), nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading keys.json: %w", err)
	}
	var kf KeysFile
	if err := json.Unmarshal(data, &kf); err != nil {
		return nil, fmt.Errorf("parsing keys.json: %w", err)
	}
	return &kf, nil
}

// SaveKeys writes keys.json to disk.
func SaveKeys(kf *KeysFile) error {
	dir := configDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(kf, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(DefaultKeysFile(), append(data, '\n'), 0644)
}

// defaultKeys returns built-in registry sources when keys.json doesn't exist.
func defaultKeys() *KeysFile {
	return &KeysFile{
		Registries: []RegistrySource{
			{
				ID:          "tsuki-team",
				Name:        "Tsuki Official Registry",
				PackagesURL: "https://raw.githubusercontent.com/s7lver/tsuki/main/pkg/packages.json",
				Trusted:     true,
			},
		},
	}
}

// AddRegistry adds a new source to keys.json (saves to disk).
func AddRegistry(id, name, packagesURL string, trusted bool) error {
	kf, err := LoadKeys()
	if err != nil {
		return err
	}
	// Check duplicate
	for _, r := range kf.Registries {
		if r.ID == id {
			return fmt.Errorf("registry %q already exists in keys.json", id)
		}
	}
	kf.Registries = append(kf.Registries, RegistrySource{
		ID: id, Name: name, PackagesURL: packagesURL, Trusted: trusted,
	})
	return SaveKeys(kf)
}

// RemoveRegistry removes a source from keys.json by id.
func RemoveRegistry(id string) error {
	kf, err := LoadKeys()
	if err != nil {
		return err
	}
	for i, r := range kf.Registries {
		if r.ID == id {
			kf.Registries = append(kf.Registries[:i], kf.Registries[i+1:]...)
			return SaveKeys(kf)
		}
	}
	return fmt.Errorf("registry %q not found in keys.json", id)
}

// ── packages.json ─────────────────────────────────────────────────────────────

// VersionMeta holds metadata for a single package version.
type VersionMeta struct {
	DownloadURL string `json:"download_url"`
	MetadataURL string `json:"metadata_url"`
	Checksum    string `json:"checksum"`
	PublishedAt string `json:"published_at"`
}

// PackageEntry is a single package in the packages.json index.
type PackageEntry struct {
	Description string                 `json:"description"`
	Author      string                 `json:"author"`
	Latest      string                 `json:"latest"`
	Versions    map[string]VersionMeta `json:"versions"`
}

// PackagesDB is the structure of a packages.json file.
type PackagesDB struct {
	Packages map[string]PackageEntry `json:"packages"`
	// The registry this DB came from (injected after loading, not from file)
	SourceID string `json:"-"`
}

// ── DB cache ──────────────────────────────────────────────────────────────────

// CacheDir returns the path to the local registry cache.
func CacheDir() string {
	if runtime.GOOS == "windows" {
		base := os.Getenv("LOCALAPPDATA")
		if base == "" {
			base = os.Getenv("APPDATA")
		}
		return filepath.Join(base, "tsuki", "db")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".cache", "tsuki", "db")
}

// cachedDBPath returns the cache path for a given registry id.
func cachedDBPath(id string) string {
	return filepath.Join(CacheDir(), id+".json")
}

// LoadCachedDB loads a registry DB from the local cache.
func LoadCachedDB(id string) (*PackagesDB, error) {
	data, err := os.ReadFile(cachedDBPath(id))
	if err != nil {
		return nil, fmt.Errorf("no cached DB for %q — run `tsuki updatedb`", id)
	}
	var db PackagesDB
	if err := json.Unmarshal(data, &db); err != nil {
		return nil, fmt.Errorf("parsing cached DB for %q: %w", id, err)
	}
	db.SourceID = id
	return &db, nil
}

// SaveCachedDB writes a PackagesDB to the local cache.
func SaveCachedDB(id string, db *PackagesDB) error {
	dir := CacheDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(db, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(cachedDBPath(id), append(data, '\n'), 0644)
}

// FetchDB downloads and parses a packages.json from a URL.
func FetchDB(url string) (*PackagesDB, error) {
	body, err := httpGet(url)
	if err != nil {
		return nil, fmt.Errorf("fetching packages.json from %s: %w", url, err)
	}
	var db PackagesDB
	if err := json.Unmarshal([]byte(body), &db); err != nil {
		return nil, fmt.Errorf("parsing packages.json from %s: %w", url, err)
	}
	return &db, nil
}

// UpdateDB downloads all registries from keys.json and saves them to the cache.
// Returns a map of registry-id → number of packages, plus any per-registry errors.
func UpdateDB() (map[string]int, []error) {
	kf, err := LoadKeys()
	if err != nil {
		return nil, []error{err}
	}

	results := make(map[string]int)
	var errs []error

	for _, src := range kf.Registries {
		db, err := FetchDB(src.PackagesURL)
		if err != nil {
			errs = append(errs, fmt.Errorf("[%s] %w", src.ID, err))
			continue
		}
		db.SourceID = src.ID
		if err := SaveCachedDB(src.ID, db); err != nil {
			errs = append(errs, fmt.Errorf("[%s] saving cache: %w", src.ID, err))
			continue
		}
		results[src.ID] = len(db.Packages)
	}

	return results, errs
}

// ── Package resolution ────────────────────────────────────────────────────────

// ResolvedPackage is the result of resolving a package spec.
type ResolvedPackage struct {
	Name        string
	Version     string
	RegistryID  string
	DownloadURL string
	MetadataURL string
	Checksum    string
}

// ParseSpec parses an install spec into its components:
//   "ws2812"                  → ("", "ws2812", "")
//   "ws2812:1.0.0"            → ("", "ws2812", "1.0.0")
//   "tsuki-team@ws2812"       → ("tsuki-team", "ws2812", "")
//   "tsuki-team@ws2812:1.0.0" → ("tsuki-team", "ws2812", "1.0.0")
func ParseSpec(spec string) (registryID, name, version string) {
	// Split on '@' first for registry prefix
	if at := strings.Index(spec, "@"); at != -1 {
		registryID = spec[:at]
		spec = spec[at+1:]
	}
	// Split remaining on ':' for version
	if colon := strings.Index(spec, ":"); colon != -1 {
		name = spec[:colon]
		version = spec[colon+1:]
	} else {
		name = spec
	}
	return
}

// Resolve finds a package from the local cache (or optionally fetches live).
// If registryID is empty, searches all registries in keys.json order.
// If version is empty, resolves to latest.
func Resolve(spec string, allowFetch bool) (*ResolvedPackage, error) {
	regID, name, version := ParseSpec(spec)

	kf, err := LoadKeys()
	if err != nil {
		return nil, err
	}

	var sources []RegistrySource
	if regID != "" {
		// Specific registry requested
		for _, src := range kf.Registries {
			if src.ID == regID {
				sources = []RegistrySource{src}
				break
			}
		}
		if len(sources) == 0 {
			return nil, fmt.Errorf("registry %q not found in keys.json", regID)
		}
	} else {
		sources = kf.Registries
	}

	for _, src := range sources {
		db, err := loadDB(src, allowFetch)
		if err != nil {
			continue // skip unavailable registries
		}

		entry, ok := db.Packages[name]
		if !ok {
			continue
		}

		resolvedVer := version
		if resolvedVer == "" {
			resolvedVer = entry.Latest
		}

		vmeta, ok := entry.Versions[resolvedVer]
		if !ok {
			// Try semver resolution (simplified: find highest matching version)
			resolvedVer, vmeta, ok = resolveSemver(entry.Versions, version)
			if !ok {
				return nil, fmt.Errorf(
					"version %q not found for package %q in registry %q",
					version, name, src.ID)
			}
		}

		return &ResolvedPackage{
			Name:        name,
			Version:     resolvedVer,
			RegistryID:  src.ID,
			DownloadURL: vmeta.DownloadURL,
			MetadataURL: vmeta.MetadataURL,
			Checksum:    vmeta.Checksum,
		}, nil
	}

	return nil, fmt.Errorf(
		"package %q not found in any configured registry\n"+
			"  hint: run `tsuki updatedb` to refresh the package index, or\n"+
			"        run `tsuki registry list` to see configured sources", name)
}

// loadDB tries cache first, then fetches if allowFetch is true.
func loadDB(src RegistrySource, allowFetch bool) (*PackagesDB, error) {
	db, err := LoadCachedDB(src.ID)
	if err == nil {
		return db, nil
	}
	if !allowFetch {
		return nil, err
	}
	db, fetchErr := FetchDB(src.PackagesURL)
	if fetchErr != nil {
		return nil, fetchErr
	}
	db.SourceID = src.ID
	_ = SaveCachedDB(src.ID, db) // best-effort cache save
	return db, nil
}

// ── Semver resolution (simplified) ───────────────────────────────────────────

// resolveSemver finds the highest version in versions that satisfies the
// constraint string. Supports:  "1", "1.0", "1.0.0", "^1", "~1.0", ">=1.0"
func resolveSemver(versions map[string]VersionMeta, constraint string) (string, VersionMeta, bool) {
	if constraint == "" {
		// No constraint: pick highest version
		return pickLatest(versions)
	}

	// Collect all valid versions
	var candidates []string
	for v := range versions {
		if matchesConstraint(v, constraint) {
			candidates = append(candidates, v)
		}
	}
	if len(candidates) == 0 {
		return "", VersionMeta{}, false
	}

	sort.Slice(candidates, func(i, j int) bool {
		return compareSemver(candidates[i], candidates[j]) < 0
	})
	best := candidates[len(candidates)-1]
	return best, versions[best], true
}

func pickLatest(versions map[string]VersionMeta) (string, VersionMeta, bool) {
	if len(versions) == 0 {
		return "", VersionMeta{}, false
	}
	var keys []string
	for k := range versions {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		return compareSemver(keys[i], keys[j]) < 0
	})
	best := keys[len(keys)-1]
	return best, versions[best], true
}

// matchesConstraint is a minimal semver constraint checker.
// Supports: "1.2.3" (exact), "^1.2.3" (compatible), "~1.2.3" (patch).
func matchesConstraint(version, constraint string) bool {
	// Strip leading ^, ~, >=, etc.
	constraint = strings.TrimLeft(constraint, "^~>=<")
	cv := parseSemver(version)
	cc := parseSemver(constraint)

	if cc[0] != cv[0] {
		return false
	}
	if len(constraint) > 0 && constraint[0] == '~' {
		return cc[1] == cv[1]
	}
	return true // ^ allows any patch/minor with same major
}

func parseSemver(s string) [3]int {
	var major, minor, patch int
	fmt.Sscanf(s, "%d.%d.%d", &major, &minor, &patch)
	return [3]int{major, minor, patch}
}

func compareSemver(a, b string) int {
	av := parseSemver(a)
	bv := parseSemver(b)
	for i := range av {
		if av[i] != bv[i] {
			if av[i] < bv[i] {
				return -1
			}
			return 1
		}
	}
	return 0
}

// ── Search ────────────────────────────────────────────────────────────────────

// SearchResult represents a single search hit.
type SearchResult struct {
	Name        string
	Version     string
	Description string
	Author      string
	RegistryID  string
}

// Search queries the local cache for packages matching the query string.
func Search(query string) ([]SearchResult, error) {
	kf, err := LoadKeys()
	if err != nil {
		return nil, err
	}

	var results []SearchResult
	seen := make(map[string]bool)

	for _, src := range kf.Registries {
		db, err := LoadCachedDB(src.ID)
		if err != nil {
			continue
		}
		for name, entry := range db.Packages {
			if seen[name] {
				continue
			}
			q := strings.ToLower(query)
			if q == "" ||
				strings.Contains(strings.ToLower(name), q) ||
				strings.Contains(strings.ToLower(entry.Description), q) {
				results = append(results, SearchResult{
					Name:        name,
					Version:     entry.Latest,
					Description: entry.Description,
					Author:      entry.Author,
					RegistryID:  src.ID,
				})
				seen[name] = true
			}
		}
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Name < results[j].Name
	})
	return results, nil
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

func httpGet(url string) (string, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}
	body, err := io.ReadAll(resp.Body)
	return string(body), err
}