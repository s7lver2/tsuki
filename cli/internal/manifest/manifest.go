// ─────────────────────────────────────────────────────────────────────────────
//  godotino :: manifest  —  load / save goduino.json  (updated)
//
//  New field: "packages" — lists external godotinolib packages required
//  by this project. These are loaded by the core during build.
//
//  Example goduino.json:
//  {
//    "name": "led-strip",
//    "version": "0.1.0",
//    "board": "uno",
//    "go_version": "1.21",
//    "packages": [
//      { "name": "ws2812",  "version": "^1.0.0" },
//      { "name": "dht",     "version": "^1.0.0" }
//    ],
//    "build": { ... }
//  }
// ─────────────────────────────────────────────────────────────────────────────

package manifest

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const FileName = "goduino.json"

type Manifest struct {
	Name        string       `json:"name"`
	Version     string       `json:"version"`
	Board       string       `json:"board"`
	GoVersion   string       `json:"go_version"`
	Description string       `json:"description,omitempty"`
	// External godotinolib packages used by this project.
	Packages    []Package    `json:"packages"`
	Build       BuildConfig  `json:"build"`
}

// Package is a single godotinolib dependency declared in the manifest.
type Package struct {
	// Canonical package name (must match godotinolib.toml [package].name).
	Name    string `json:"name"`
	// Semver range (e.g. "^1.0.0", "1.2.3", ">=1.0.0 <2.0.0").
	Version string `json:"version"`
}

type BuildConfig struct {
	OutputDir  string   `json:"output_dir"`
	CppStd     string   `json:"cpp_std"`
	Optimize   string   `json:"optimize"`
	ExtraFlags []string `json:"extra_flags"`
	SourceMap  bool     `json:"source_map"`
}

// Default returns a manifest with sensible defaults.
func Default(name, board string) *Manifest {
	return &Manifest{
		Name:      name,
		Version:   "0.1.0",
		Board:     board,
		GoVersion: "1.21",
		Packages:  []Package{},
		Build: BuildConfig{
			OutputDir:  "build",
			CppStd:     "c++11",
			Optimize:   "Os",
			ExtraFlags: []string{},
			SourceMap:  false,
		},
	}
}

// Load reads goduino.json from the given directory.
func Load(dir string) (*Manifest, error) {
	path := filepath.Join(dir, FileName)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("no %s found in %s — run `godotino init` first", FileName, dir)
		}
		return nil, fmt.Errorf("reading %s: %w", FileName, err)
	}
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", FileName, err)
	}
	return &m, nil
}

// Save writes the manifest to goduino.json in the given directory.
func (m *Manifest) Save(dir string) error {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, FileName), append(data, '\n'), 0644)
}

// Find searches upward from dir for a goduino.json file.
func Find(startDir string) (string, *Manifest, error) {
	dir := startDir
	for {
		path := filepath.Join(dir, FileName)
		if _, err := os.Stat(path); err == nil {
			m, err := Load(dir)
			return dir, m, err
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", nil, fmt.Errorf("no %s found (searched from %s upward)", FileName, startDir)
}

// PackageNames returns a slice of just the package names (for passing to the core).
func (m *Manifest) PackageNames() []string {
	names := make([]string, len(m.Packages))
	for i, p := range m.Packages {
		names[i] = p.Name
	}
	return names
}

// HasPackage reports whether the manifest already declares the given package.
func (m *Manifest) HasPackage(name string) bool {
	for _, p := range m.Packages {
		if p.Name == name {
			return true
		}
	}
	return false
}

// AddPackage appends a package dependency (if not already present).
func (m *Manifest) AddPackage(name, version string) bool {
	if m.HasPackage(name) {
		return false
	}
	m.Packages = append(m.Packages, Package{Name: name, Version: version})
	return true
}

// RemovePackage removes a package dependency by name.
func (m *Manifest) RemovePackage(name string) bool {
	for i, p := range m.Packages {
		if p.Name == name {
			m.Packages = append(m.Packages[:i], m.Packages[i+1:]...)
			return true
		}
	}
	return false
}