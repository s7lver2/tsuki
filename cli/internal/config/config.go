// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: config  —  persistent CLI configuration
//
//  Stored at:
//    Linux/macOS: ~/.config/tsuki/config.json
//    Windows:     %APPDATA%\tsuki\config.json
// ─────────────────────────────────────────────────────────────────────────────

package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strconv"
	"strings"
)

const defaultRegistryURL = "https://raw.githubusercontent.com/s7lver2/tsuki/refs/heads/main/pkg/packages.json"
const defaultKeysIndexURL = "https://raw.githubusercontent.com/s7lver2/tsuki/refs/heads/main/pkg/keys/index.json"

// Config holds all persistent user-level settings.
type Config struct {
	// ── Core tools ──────────────────────────────────────────────────────────
	CoreBinary  string `json:"core_binary"  comment:"path to tsuki-core binary"`
	ArduinoCLI  string `json:"arduino_cli"  comment:"path to arduino-cli binary"`
	FlashBinary string `json:"flash_binary" comment:"path to tsuki-flash binary (used when backend=tsuki-flash)"`
	// Backend selects the compile+upload toolchain: "tsuki-flash" or "arduino-cli".
	// Set with: tsuki config set backend tsuki-flash
	Backend      string `json:"backend"       comment:"compiler backend: tsuki-flash or arduino-cli (default: arduino-cli)"`
	DefaultBoard string `json:"default_board" comment:"default target board"`
	DefaultBaud  int    `json:"default_baud"  comment:"default serial baud rate"`

	// ── Output ──────────────────────────────────────────────────────────────
	Color      bool `json:"color"       comment:"enable colored output"`
	Verbose    bool `json:"verbose"     comment:"verbose command output"`
	AutoDetect bool `json:"auto_detect" comment:"auto-detect connected boards"`

	// ── Package management ──────────────────────────────────────────────────

	// LibsDir is where tsukilib packages are installed.
	LibsDir string `json:"libs_dir" comment:"directory where packages are installed (leave empty for default)"`

	// RegistryURL is kept for backward compatibility with existing config files.
	// Prefer RegistryURLs for multi-registry setups.
	RegistryURL string `json:"registry_url,omitempty" comment:"[deprecated] single registry URL — use registry_urls instead"`

	// RegistryURLs is the list of registry JSON URLs to consult, in priority
	// order (first registry wins on name collisions).
	RegistryURLs []string `json:"registry_urls" comment:"ordered list of package registry URLs"`

	// ── Signing keys ────────────────────────────────────────────────────────

	// KeysDir is where downloaded public signing keys are cached.
	KeysDir string `json:"keys_dir" comment:"directory where package signing keys are cached (leave empty for default)"`

	// KeysIndexURL is the global fallback key-index URL.
	// Individual registries may declare their own key index inside registry.json.
	KeysIndexURL string `json:"keys_index_url" comment:"URL of the signing-key index JSON (global fallback)"`

	// VerifySignatures controls whether package signatures are verified on install.
	VerifySignatures bool `json:"verify_signatures" comment:"verify package signatures on install"`
}

// Default returns a Config with sensible defaults.
func Default() *Config {
	return &Config{
		CoreBinary:       "",
		ArduinoCLI:       "arduino-cli",
		FlashBinary:      "tsuki-flash",
		Backend:          "arduino-cli",
		DefaultBoard:     "uno",
		DefaultBaud:      9600,
		Color:            true,
		Verbose:          false,
		AutoDetect:       true,
		LibsDir:          "",
		RegistryURL:      "",
		RegistryURLs:     []string{}, // empty: falls through to registry_url or env var
		KeysDir:          "",
		KeysIndexURL:     defaultKeysIndexURL,
		VerifySignatures: false,
	}
}

// ── Computed paths ────────────────────────────────────────────────────────────

func (c *Config) ResolvedLibsDir() string {
	if c.LibsDir != "" {
		return c.LibsDir
	}
	if env := os.Getenv("tsuki_LIBS"); env != "" {
		return env
	}
	return defaultLibsDir()
}

// ResolvedRegistryURLs returns the effective ordered list of registry URLs,
// merging the legacy single-URL field with the new multi-URL field and
// environment variable overrides.
//
// Priority (highest first):
//  1. tsuki_REGISTRY env var  (single URL, prepended)
//  2. Config RegistryURLs list
//  3. Config RegistryURL (legacy, appended if not already present)
//  4. Built-in default
func (c *Config) ResolvedRegistryURLs() []string {
	seen := make(map[string]bool)
	var urls []string

	add := func(u string) {
		u = strings.TrimSpace(u)
		if u != "" && !seen[u] {
			seen[u] = true
			urls = append(urls, u)
		}
	}

	// Env var override (prepend)
	if env := os.Getenv("tsuki_REGISTRY"); env != "" {
		add(env)
	}

	// Configured list
	for _, u := range c.RegistryURLs {
		add(u)
	}

	// Legacy single-URL field (backward compat)
	add(c.RegistryURL)

	// Fallback to built-in default if nothing resolved
	if len(urls) == 0 {
		add(defaultRegistryURL)
	}
	return urls
}

// ResolvedKeysDir returns the effective signing-keys directory.
func (c *Config) ResolvedKeysDir() string {
	if c.KeysDir != "" {
		return c.KeysDir
	}
	if env := os.Getenv("tsuki_KEYS"); env != "" {
		return env
	}
	return defaultKeysDir()
}

// ResolvedKeysIndexURL returns the effective global key-index URL.
func (c *Config) ResolvedKeysIndexURL() string {
	if c.KeysIndexURL != "" {
		return c.KeysIndexURL
	}
	if env := os.Getenv("tsuki_KEYS_INDEX"); env != "" {
		return env
	}
	return defaultKeysIndexURL
}

// ── OS-specific default paths ─────────────────────────────────────────────────

func defaultLibsDir() string {
	if runtime.GOOS == "windows" {
		base := os.Getenv("APPDATA")
		if base == "" {
			base = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Roaming")
		}
		return filepath.Join(base, "tsuki", "libs")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "share", "tsuki", "libs")
}

func defaultKeysDir() string {
	if runtime.GOOS == "windows" {
		base := os.Getenv("APPDATA")
		if base == "" {
			base = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Roaming")
		}
		return filepath.Join(base, "tsuki", "keys")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "share", "tsuki", "keys")
}

// ── Config file I/O ───────────────────────────────────────────────────────────

func configPath() (string, error) {
	var base string
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		base = xdg
	} else {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "tsuki", "config.json"), nil
}

// Load reads the config from disk. Returns defaults if the file doesn't exist.
// After loading, it migrates a legacy registry_url into registry_urls if needed.
func Load() (*Config, error) {
	path, err := configPath()
	if err != nil {
		return Default(), nil
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return Default(), nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading config: %w", err)
	}
	c := Default()
	if err := json.Unmarshal(data, c); err != nil {
		return nil, fmt.Errorf("parsing config: %w", err)
	}
	// Migration: if registry_urls is empty but legacy registry_url is set,
	// move it into the list so existing configs keep working.
	if len(c.RegistryURLs) == 0 && c.RegistryURL != "" {
		c.RegistryURLs = []string{c.RegistryURL}
	}
	return c, nil
}

// Save writes the config to disk.
func (c *Config) Save() error {
	path, err := configPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0644)
}

// Get returns the value of a config key by its JSON name.
func (c *Config) Get(key string) (interface{}, error) {
	rv := reflect.ValueOf(c).Elem()
	rt := rv.Type()
	for i := 0; i < rt.NumField(); i++ {
		field := rt.Field(i)
		tag := strings.Split(field.Tag.Get("json"), ",")[0]
		if tag == key || strings.ToLower(field.Name) == strings.ToLower(key) {
			return rv.Field(i).Interface(), nil
		}
	}
	return nil, fmt.Errorf("unknown config key %q", key)
}

// Set updates a config key by its JSON name.
func (c *Config) Set(key, value string) error {
	rv := reflect.ValueOf(c).Elem()
	rt := rv.Type()
	for i := 0; i < rt.NumField(); i++ {
		field := rt.Field(i)
		tag := strings.Split(field.Tag.Get("json"), ",")[0]
		if tag == key || strings.ToLower(field.Name) == strings.ToLower(key) {
			fv := rv.Field(i)
			switch fv.Kind() {
			case reflect.String:
				fv.SetString(value)
			case reflect.Bool:
				b, err := strconv.ParseBool(value)
				if err != nil {
					return fmt.Errorf("invalid bool value %q for key %q", value, key)
				}
				fv.SetBool(b)
			case reflect.Int:
				n, err := strconv.ParseInt(value, 10, 64)
				if err != nil {
					return fmt.Errorf("invalid int value %q for key %q", value, key)
				}
				fv.SetInt(n)
			case reflect.Slice:
				// For string slices: comma-separated input
				if fv.Type().Elem().Kind() == reflect.String {
					parts := strings.Split(value, ",")
					slice := reflect.MakeSlice(fv.Type(), len(parts), len(parts))
					for i, p := range parts {
						slice.Index(i).SetString(strings.TrimSpace(p))
					}
					fv.Set(slice)
				} else {
					return fmt.Errorf("unsupported slice type for key %q", key)
				}
			default:
				return fmt.Errorf("unsupported type for key %q", key)
			}
			return nil
		}
	}
	return fmt.Errorf("unknown config key %q", key)
}

type Entry struct {
	Key     string
	Value   interface{}
	Comment string
}

func (c *Config) AllEntries() []Entry {
	rv := reflect.ValueOf(c).Elem()
	rt := rv.Type()
	entries := make([]Entry, 0, rt.NumField())
	for i := 0; i < rt.NumField(); i++ {
		field := rt.Field(i)
		tag := strings.Split(field.Tag.Get("json"), ",")[0]
		comment := field.Tag.Get("comment")
		entries = append(entries, Entry{
			Key:     tag,
			Value:   rv.Field(i).Interface(),
			Comment: comment,
		})
	}
	return entries
}

func Path() (string, error) {
	return configPath()
}