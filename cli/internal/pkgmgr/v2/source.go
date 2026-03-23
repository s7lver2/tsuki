// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: pkgmgr/v2 :: source  —  source management, index fetching & caching
//
//  A source is a URL that exposes:
//    <url>/packages.json      — package index
//    <url>/tsuki-keys.json   — signing key index
//
//  Both files are cached locally under ~/.tsuki/cache/sources/<hash>/ and
//  refreshed when older than INDEX_TTL (24h by default).
// ─────────────────────────────────────────────────────────────────────────────

package v2

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	indexTTL        = 24 * time.Hour
	packagesFile    = "packages.json"
	keysFile        = "tsuki-keys.json"
	sourcesFile     = "sources.json"
	defaultSourceURL = "https://raw.githubusercontent.com/s7lver2/tsuki/refs/heads/main/pkg"
)

// ── Source list persistence ───────────────────────────────────────────────────

type sourceList struct {
	Sources []Source `json:"sources"`
}

// LoadSources returns the configured source list.
// Always includes the default official source at priority 0.
func LoadSources() ([]Source, error) {
	path := sourcesPath()
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return defaultSources(), nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var sl sourceList
	if err := json.Unmarshal(data, &sl); err != nil {
		return nil, fmt.Errorf("sources.json malformed: %w", err)
	}
	// Ensure default source is always present at priority 0
	sl.Sources = ensureDefault(sl.Sources)
	return sl.Sources, nil
}

// SaveSources persists the source list.
func SaveSources(sources []Source) error {
	if err := os.MkdirAll(filepath.Dir(sourcesPath()), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(sourceList{Sources: sources}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(sourcesPath(), data, 0644)
}

// AddSource adds a new source URL. Returns error if already present.
func AddSource(rawURL string) error {
	rawURL = strings.TrimRight(rawURL, "/")
	sources, err := LoadSources()
	if err != nil {
		return err
	}
	for _, s := range sources {
		if s.URL == rawURL {
			return fmt.Errorf("source already added: %s", rawURL)
		}
	}
	// Assign priority = len (added sources go after existing ones)
	sources = append(sources, Source{
		URL:      rawURL,
		AddedAt:  time.Now(),
		Priority: len(sources),
	})
	return SaveSources(sources)
}

// RemoveSource removes a source by URL. Cannot remove the default source.
func RemoveSource(rawURL string) error {
	rawURL = strings.TrimRight(rawURL, "/")
	if rawURL == defaultSourceURL {
		return fmt.Errorf("cannot remove the official tsuki source")
	}
	sources, err := LoadSources()
	if err != nil {
		return err
	}
	filtered := sources[:0]
	found := false
	for _, s := range sources {
		if s.URL == rawURL {
			found = true
			continue
		}
		filtered = append(filtered, s)
	}
	if !found {
		return fmt.Errorf("source not found: %s", rawURL)
	}
	// Re-assign priorities
	for i := range filtered {
		filtered[i].Priority = i
	}
	return SaveSources(filtered)
}

// ── Index fetching ────────────────────────────────────────────────────────────

// FetchPackageIndex returns the package index for the given source, using
// a local cache when fresh enough.
//
// Supports two formats:
//   v2 (new):    {"packages": [...]}
//   v1 (compat): [{...}, ...]  — old flat array; wrapped into IndexEntry stubs.
func FetchPackageIndex(source Source) (*PackageIndex, error) {
	data, err := fetchCached(source.URL, packagesFile)
	if err != nil {
		return nil, fmt.Errorf("source %s: %w", source.URL, err)
	}
	return parsePackageIndex(data, source.URL)
}

// parsePackageIndex handles both v1 (array) and v2 (object) packages.json.
func parsePackageIndex(data []byte, sourceURL string) (*PackageIndex, error) {
	trimmed := strings.TrimSpace(string(data))
	if len(trimmed) == 0 {
		return &PackageIndex{}, nil
	}

	if trimmed[0] == '[' {
		// v1: flat array — [{"name":"dht","version":"1.0.0","url":"..."}]
		var v1 []struct {
			Name    string `json:"name"`
			Version string `json:"version"`
			URL     string `json:"url"`
		}
		if err := json.Unmarshal(data, &v1); err != nil {
			return nil, fmt.Errorf("source %s: malformed packages.json (v1): %w", sourceURL, err)
		}
		idx := &PackageIndex{}
		for _, e := range v1 {
			if e.Name == "" {
				continue
			}
			idx.Packages = append(idx.Packages, IndexEntry{
				Name:  e.Name,
				Owner: "tsuki-team",
				Type:  TypeLibrary,
				Versions: []Version{{Version: e.Version, URL: e.URL}},
			})
		}
		return idx, nil
	}

	// Peek at the "packages" field to detect legacy object-map format:
	// {"packages": {"dht": {"latest":"1.0.0", "versions": {"1.0.0": "<url>"}}}}
	var raw struct {
		Packages json.RawMessage `json:"packages"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("source %s: malformed packages.json: %w", sourceURL, err)
	}
	if len(raw.Packages) == 0 {
		return &PackageIndex{}, nil
	}

	// Check if packages value is an object (legacy map) or an array (v2)
	pkgTrimmed := strings.TrimSpace(string(raw.Packages))
	if len(pkgTrimmed) > 0 && pkgTrimmed[0] == '{' {
		// Legacy map format: {"dht": {"description":"...","author":"...","latest":"1.0.0","versions":{"1.0.0":"<url>"}}}
		var pkgMap map[string]struct {
			Description string            `json:"description"`
			Author      string            `json:"author"`
			Latest      string            `json:"latest"`
			Versions    map[string]string `json:"versions"`
		}
		if err := json.Unmarshal(raw.Packages, &pkgMap); err != nil {
			return nil, fmt.Errorf("source %s: malformed packages map: %w", sourceURL, err)
		}
		idx := &PackageIndex{}
		for name, pkg := range pkgMap {
			entry := IndexEntry{
				Name:  name,
				Owner: pkg.Author,
				Type:  TypeLibrary,
			}
			if entry.Owner == "" {
				entry.Owner = "tsuki-team"
			}
			// Add versions sorted: latest first, rest in map order
			if pkg.Latest != "" {
				if url, ok := pkg.Versions[pkg.Latest]; ok {
					entry.Versions = append(entry.Versions, Version{
						Version: pkg.Latest,
						URL:     url,
					})
				}
			}
			for ver, url := range pkg.Versions {
				if ver == pkg.Latest {
					continue // already added
				}
				entry.Versions = append(entry.Versions, Version{Version: ver, URL: url})
			}
			idx.Packages = append(idx.Packages, entry)
		}
		return idx, nil
	}

	// v2: packages is an array
	var idx PackageIndex
	if err := json.Unmarshal(data, &idx); err != nil {
		return nil, fmt.Errorf("source %s: malformed packages.json: %w", sourceURL, err)
	}
	return &idx, nil
}

// FetchKeyIndex returns the key index for the given source.
func FetchKeyIndex(source Source) (*KeyIndex, error) {
	data, err := fetchCached(source.URL, keysFile)
	if err != nil {
		return nil, fmt.Errorf("source %s: %w", source.URL, err)
	}
	var idx KeyIndex
	if err := json.Unmarshal(data, &idx); err != nil {
		return nil, fmt.Errorf("source %s: malformed tsuki-keys.json: %w", source.URL, err)
	}
	return &idx, nil
}

// FetchAllIndexes returns the merged package index from all configured sources,
// with higher-priority sources winning on name collisions.
func FetchAllIndexes() ([]IndexEntry, error) {
	sources, err := LoadSources()
	if err != nil {
		return nil, err
	}

	// Sort by priority (ascending = higher priority first)
	sortSources(sources)

	seen := map[string]bool{} // "owner/name" → already added
	var entries []IndexEntry

	for _, src := range sources {
		idx, err := FetchPackageIndex(src)
		if err != nil {
			// Non-fatal: skip unreachable sources
			continue
		}
		for _, e := range idx.Packages {
			key := e.FullName()
			if seen[key] {
				continue
			}
			seen[key] = true
			entries = append(entries, e)
		}
	}
	return entries, nil
}

// InvalidateCache deletes the cached index files for all sources, forcing
// a fresh fetch on the next operation.
func InvalidateCache() error {
	sources, err := LoadSources()
	if err != nil {
		return err
	}
	for _, src := range sources {
		dir := cacheDir(src.URL)
		_ = os.RemoveAll(dir)
	}
	return nil
}

// ── Internal: cache helpers ───────────────────────────────────────────────────

func fetchCached(sourceURL, filename string) ([]byte, error) {
	sourceURL = strings.TrimRight(sourceURL, "/")
	dir := cacheDir(sourceURL)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}

	cachePath := filepath.Join(dir, filename)

	// Check if cache is still fresh
	if info, err := os.Stat(cachePath); err == nil {
		if time.Since(info.ModTime()) < indexTTL {
			return os.ReadFile(cachePath)
		}
	}

	// Build fetch URL.
	// If the source URL itself ends with .json, the user added a direct file URL
	// (e.g. .../packages.json). Only use it as-is when fetching packages.json;
	// for other files (tsuki-keys.json) fall back to the parent directory.
	var url string
	if strings.HasSuffix(sourceURL, ".json") {
		if filename == packagesFile {
			url = sourceURL
		} else {
			// Derive base dir from the direct file URL
			base := sourceURL[:strings.LastIndex(sourceURL, "/")]
			url = base + "/" + filename
		}
	} else {
		url = sourceURL + "/" + filename
	}
	data, err := httpGet(url)
	if err != nil {
		// If stale cache exists, use it rather than failing
		if _, serr := os.Stat(cachePath); serr == nil {
			return os.ReadFile(cachePath)
		}
		return nil, fmt.Errorf("fetch %s: %w", url, err)
	}

	// Persist to cache
	if err := os.WriteFile(cachePath, data, 0644); err != nil {
		return nil, err
	}
	return data, nil
}

func cacheDir(sourceURL string) string {
	// Use a short hash of the URL as the directory name
	h := sha256.Sum256([]byte(sourceURL))
	name := fmt.Sprintf("%x", h[:8])
	return filepath.Join(tsukiCacheDir(), "sources", name)
}

func httpGet(url string) ([]byte, error) {
	resp, err := http.Get(url) //nolint:gosec
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

// ── Path helpers ──────────────────────────────────────────────────────────────

func sourcesPath() string {
	return filepath.Join(tsukiDataDir(), sourcesFile)
}

func tsukiDataDir() string {
	if d := os.Getenv("TSUKI_DATA_DIR"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".tsuki")
}

func tsukiCacheDir() string {
	return filepath.Join(tsukiDataDir(), "cache")
}

func defaultSources() []Source {
	return []Source{
		{URL: defaultSourceURL, AddedAt: time.Now(), Priority: 0},
	}
}

func ensureDefault(sources []Source) []Source {
	for _, s := range sources {
		if s.URL == defaultSourceURL {
			return sources
		}
	}
	return append([]Source{{URL: defaultSourceURL, Priority: 0}}, sources...)
}

func sortSources(sources []Source) {
	for i := 1; i < len(sources); i++ {
		for j := i; j > 0 && sources[j].Priority < sources[j-1].Priority; j-- {
			sources[j], sources[j-1] = sources[j-1], sources[j]
		}
	}
}