// ─────────────────────────────────────────────────────────────────────────────
//  godotino :: config  —  persistent CLI configuration
//
//  Stored at:
//    Linux/macOS: ~/.config/godotino/config.json
//    Windows:     %APPDATA%\godotino\config.json
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

// Config holds all persistent user-level settings.
type Config struct {
	// ── Core tools ──────────────────────────────────────────────────────────

	// Core binary path (empty = search PATH)
	CoreBinary string `json:"core_binary" comment:"path to godotino-core binary"`

	// arduino-cli path (empty = search PATH)
	ArduinoCLI string `json:"arduino_cli" comment:"path to arduino-cli binary"`

	// Default board id
	DefaultBoard string `json:"default_board" comment:"default target board"`

	// Default baud rate for serial monitor
	DefaultBaud int `json:"default_baud" comment:"default serial baud rate"`

	// ── Output ──────────────────────────────────────────────────────────────

	// Color output
	Color bool `json:"color" comment:"enable colored output"`

	// Verbose build output
	Verbose bool `json:"verbose" comment:"verbose command output"`

	// Auto-detect board on flash/monitor
	AutoDetect bool `json:"auto_detect" comment:"auto-detect connected boards"`

	// ── Package management ──────────────────────────────────────────────────

	// Directory where godotinolib packages are installed.
	// Overrides the GODOTINO_LIBS environment variable.
	// Default (Linux/macOS): ~/.local/share/godotino/libs
	// Default (Windows):     %APPDATA%\godotino\libs
	LibsDir string `json:"libs_dir" comment:"directory where packages are installed (leave empty for default)"`

	// URL of the package registry JSON.
	// Overrides the GODOTINO_REGISTRY environment variable.
	// Default: https://raw.githubusercontent.com/s7lver/godotino-pkgs/main/registry.json
	RegistryURL string `json:"registry_url" comment:"package registry URL (leave empty for default)"`

	// ── Signing keys ────────────────────────────────────────────────────────

	// Directory where downloaded public signing keys are cached.
	// Default (Linux/macOS): ~/.local/share/godotino/keys
	// Default (Windows):     %APPDATA%\godotino\keys
	KeysDir string `json:"keys_dir" comment:"directory where package signing keys are cached (leave empty for default)"`

	// URL from which the official key index is fetched.
	// The key index is a JSON file mapping key IDs to their download URLs.
	// Default: https://raw.githubusercontent.com/s7lver/godotino-pkgs/main/keys/index.json
	KeysIndexURL string `json:"keys_index_url" comment:"URL of the signing-key index JSON"`

	// Whether to verify package signatures before installing.
	// Requires a valid entry in the key index for the package author.
	VerifySignatures bool `json:"verify_signatures" comment:"verify package signatures on install"`
}

// Default returns a Config with sensible defaults.
func Default() *Config {
	return &Config{
		CoreBinary:       "",
		ArduinoCLI:       "arduino-cli",
		DefaultBoard:     "uno",
		DefaultBaud:      9600,
		Color:            true,
		Verbose:          false,
		AutoDetect:       true,
		LibsDir:          "",
		RegistryURL:      "",
		KeysDir:          "",
		KeysIndexURL:     "https://raw.githubusercontent.com/s7lver/godotino-pkgs/main/keys/index.json",
		VerifySignatures: false,
	}
}

// ── Computed paths ────────────────────────────────────────────────────────────

// ResolvedLibsDir returns the effective package-install directory, honouring
// (in priority order): config field -> GODOTINO_LIBS env var -> OS default.
func (c *Config) ResolvedLibsDir() string {
	if c.LibsDir != "" {
		return c.LibsDir
	}
	if env := os.Getenv("GODOTINO_LIBS"); env != "" {
		return env
	}
	return defaultLibsDir()
}

// ResolvedRegistryURL returns the effective registry URL, honouring:
// config field -> GODOTINO_REGISTRY env var -> built-in default.
func (c *Config) ResolvedRegistryURL() string {
	if c.RegistryURL != "" {
		return c.RegistryURL
	}
	if env := os.Getenv("GODOTINO_REGISTRY"); env != "" {
		return env
	}
	return "https://raw.githubusercontent.com/s7lver/godotino-pkgs/main/registry.json"
}

// ResolvedKeysDir returns the effective signing-keys directory, honouring:
// config field -> GODOTINO_KEYS env var -> OS default.
func (c *Config) ResolvedKeysDir() string {
	if c.KeysDir != "" {
		return c.KeysDir
	}
	if env := os.Getenv("GODOTINO_KEYS"); env != "" {
		return env
	}
	return defaultKeysDir()
}

// ResolvedKeysIndexURL returns the effective keys-index URL, honouring:
// config field -> GODOTINO_KEYS_INDEX env var -> built-in default.
func (c *Config) ResolvedKeysIndexURL() string {
	if c.KeysIndexURL != "" {
		return c.KeysIndexURL
	}
	if env := os.Getenv("GODOTINO_KEYS_INDEX"); env != "" {
		return env
	}
	return "https://raw.githubusercontent.com/s7lver/godotino-pkgs/main/keys/index.json"
}

// ── OS-specific default paths ─────────────────────────────────────────────────

func defaultLibsDir() string {
	if runtime.GOOS == "windows" {
		base := os.Getenv("APPDATA")
		if base == "" {
			base = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Roaming")
		}
		return filepath.Join(base, "godotino", "libs")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "share", "godotino", "libs")
}

func defaultKeysDir() string {
	if runtime.GOOS == "windows" {
		base := os.Getenv("APPDATA")
		if base == "" {
			base = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Roaming")
		}
		return filepath.Join(base, "godotino", "keys")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "share", "godotino", "keys")
}

// ── Config file I/O ───────────────────────────────────────────────────────────

// configPath returns the OS-appropriate config file path.
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
	return filepath.Join(base, "godotino", "config.json"), nil
}

// Load reads the config from disk. Returns defaults if the file doesn't exist.
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
		tag := field.Tag.Get("json")
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
		tag := field.Tag.Get("json")
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
			default:
				return fmt.Errorf("unsupported type for key %q", key)
			}
			return nil
		}
	}
	return fmt.Errorf("unknown config key %q", key)
}

// AllEntries returns all config keys with metadata (for display).
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
		tag := field.Tag.Get("json")
		comment := field.Tag.Get("comment")
		entries = append(entries, Entry{
			Key:     tag,
			Value:   rv.Field(i).Interface(),
			Comment: comment,
		})
	}
	return entries
}

// Path returns the path of the config file on disk.
func Path() (string, error) {
	return configPath()
}