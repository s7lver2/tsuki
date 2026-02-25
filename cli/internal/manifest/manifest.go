// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: manifest  —  tsuki-config.toml  +  legacy tsuki_package.json
//
//  Loads project configuration from tsuki-config.toml (v3, preferred) or
//  falls back to the old tsuki_package.json so that existing projects keep
//  working without changes.
//
//  The exported Manifest struct intentionally preserves every field that
//  check.go, flash.go, build.go, and pkgmgr.go already rely on:
//    • m.Board
//    • m.Build.OutputDir / .CppStd / .Optimize / .SourceMap / .ExtraFlags
//    • m.Packages  ([]Package  {Name, Version})
//    • m.PackageNames() / m.HasPackage() / m.AddPackage() / m.RemovePackage()
//
//  New v3 fields (used by run, push, pull, init):
//    • m.Project.Type          "program" | "library"
//    • m.Bins                  []BinTarget   (from [[bin]])
//    • m.Libs                  []LibTarget   (from [[lib]])
//    • m.Dependencies          map[string]DepSpec
//    • m.DevDependencies       map[string]DepSpec
//    • m.Profile               ProfileConfig
//    • m.Publish               PublishConfig
// ─────────────────────────────────────────────────────────────────────────────

package manifest

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ── File names ────────────────────────────────────────────────────────────────

const (
	TOMLFileName = "tsuki-config.toml"  // v3 preferred
	JSONFileName = "tsuki_package.json" // v1/v2 legacy

	// FileName is the legacy alias kept for backward compatibility with
	// existing code that references manifest.FileName (e.g. pkg.go).
	FileName = JSONFileName
)

// ── Core struct ───────────────────────────────────────────────────────────────

// Manifest is the in-memory representation of a tsuki project.
// It is hydrated from either tsuki-config.toml (v3) or tsuki_package.json
// (legacy).  All previously-existing fields are preserved so that check.go,
// flash.go, build.go, and pkgmgr.go compile without any changes.
type Manifest struct {
	// ── Identity (present in both formats) ───────────────────────────────
	Name        string `json:"name"       toml:"name"`
	Version     string `json:"version"    toml:"version"`
	Board       string `json:"board"      toml:"board"`
	GoVersion   string `json:"go_version" toml:"go_version"`
	Description string `json:"description,omitempty" toml:"description"`

	// ── Legacy dependency list (tsuki_package.json "packages") ───────────
	// check.go / build.go iterate over this.
	Packages []Package `json:"packages" toml:"-"`

	// ── Build config (legacy key "build") ────────────────────────────────
	Build BuildConfig `json:"build" toml:"-"`

	// ── v3: [package] metadata ────────────────────────────────────────────
	Project ProjectMeta `json:"-" toml:"package"`

	// ── v3: [[bin]] targets ───────────────────────────────────────────────
	Bins []BinTarget `json:"-" toml:"bin"`

	// ── v3: [[lib]] targets ───────────────────────────────────────────────
	Libs []LibTarget `json:"-" toml:"lib"`

	// ── v3: [dependencies] / [dev-dependencies] ───────────────────────────
	Dependencies    map[string]DepSpec `json:"-" toml:"dependencies"`
	DevDependencies map[string]DepSpec `json:"-" toml:"dev-dependencies"`

	// ── v3: [profile.release] ─────────────────────────────────────────────
	Profile ProfileConfig `json:"-" toml:"profile"`

	// ── v3: [publish] ────────────────────────────────────────────────────
	Publish PublishConfig `json:"-" toml:"publish"`
}

// ── Sub-types (legacy) ────────────────────────────────────────────────────────

// Package is a tsukilib dependency declared in tsuki_package.json.
type Package struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// BuildConfig mirrors the "build" object in tsuki_package.json.
type BuildConfig struct {
	OutputDir  string   `json:"output_dir"`
	CppStd     string   `json:"cpp_std"`
	Optimize   string   `json:"optimize"`
	ExtraFlags []string `json:"extra_flags"`
	SourceMap  bool     `json:"source_map"`
}

// ── Sub-types (v3) ────────────────────────────────────────────────────────────

// ProjectMeta maps to the [package] table in tsuki-config.toml.
type ProjectMeta struct {
	Name        string   `toml:"name"`
	Version     string   `toml:"version"`
	Edition     string   `toml:"edition"`
	Description string   `toml:"description"`
	License     string   `toml:"license"`
	Authors     []string `toml:"authors"`
	Readme      string   `toml:"readme"`
	Type        string   `toml:"type"` // "program" | "library"
}

// BinTarget maps to a [[bin]] entry.
type BinTarget struct {
	Name       string `toml:"name"`
	Path       string `toml:"path"`
	Entrypoint string `toml:"entrypoint"` // e.g. "cargo run" or "make all"
}

// LibTarget maps to a [[lib]] entry.
type LibTarget struct {
	Name string `toml:"name"`
	Path string `toml:"path"`
}

// DepSpec can be either a bare version string or a table with extra fields.
// TOML unmarshalling uses a custom approach — see tomlRawManifest below.
type DepSpec struct {
	Version  string
	Features []string
	Default  bool // default-features
}

// ProfileConfig maps to [profile.release].
type ProfileConfig struct {
	Release ReleaseProfile `toml:"release"`
}

// ReleaseProfile holds release-mode compiler settings.
type ReleaseProfile struct {
	OptLevel     int    `toml:"opt-level"`
	LTO          bool   `toml:"lto"`
	CodegenUnits int    `toml:"codegen-units"`
	Strip        bool   `toml:"strip"`
}

// PublishConfig maps to [publish].
type PublishConfig struct {
	Registry string   `toml:"registry"`
	Targets  []string `toml:"targets"`
}

// ── TOML raw intermediate ─────────────────────────────────────────────────────
// We parse deps as map[string]interface{} first so we can handle both
//   dep = "1.0"
// and
//   dep = { version = "1.0", features = ["derive"] }

type tomlRawManifest struct {
	Package struct {
		Name        string   `toml:"name"`
		Version     string   `toml:"version"`
		Edition     string   `toml:"edition"`
		Description string   `toml:"description"`
		License     string   `toml:"license"`
		Authors     []string `toml:"authors"`
		Readme      string   `toml:"readme"`
		Type        string   `toml:"type"`
		Board       string   `toml:"board"`
		GoVersion   string   `toml:"go_version"`
	} `toml:"package"`

	Bins []BinTarget `toml:"bin"`
	Libs []LibTarget `toml:"lib"`

	RawDeps    map[string]interface{} `toml:"dependencies"`
	RawDevDeps map[string]interface{} `toml:"dev-dependencies"`

	Profile ProfileConfig `toml:"profile"`
	Publish PublishConfig `toml:"publish"`

	// Legacy build section (ignored in v3 but kept for hybrid files)
	Build struct {
		OutputDir  string   `toml:"output_dir"`
		CppStd     string   `toml:"cpp_std"`
		Optimize   string   `toml:"optimize"`
		ExtraFlags []string `toml:"extra_flags"`
		SourceMap  bool     `toml:"source_map"`
	} `toml:"build"`
}

// parseDeps converts raw TOML dep values into DepSpec.
func parseDeps(raw map[string]interface{}) map[string]DepSpec {
	if raw == nil {
		return nil
	}
	out := make(map[string]DepSpec, len(raw))
	for k, v := range raw {
		switch val := v.(type) {
		case string:
			out[k] = DepSpec{Version: val}
		case map[string]interface{}:
			ds := DepSpec{}
			if ver, ok := val["version"].(string); ok {
				ds.Version = ver
			}
			if feats, ok := val["features"].([]interface{}); ok {
				for _, f := range feats {
					if s, ok := f.(string); ok {
						ds.Features = append(ds.Features, s)
					}
				}
			}
			if df, ok := val["default-features"].(bool); ok {
				ds.Default = df
			}
			out[k] = ds
		}
	}
	return out
}

// ── Loaders ───────────────────────────────────────────────────────────────────

// Load reads the manifest from dir, preferring tsuki-config.toml over
// the legacy tsuki_package.json.
func Load(dir string) (*Manifest, error) {
	tomlPath := filepath.Join(dir, TOMLFileName)
	if _, err := os.Stat(tomlPath); err == nil {
		return loadTOML(tomlPath)
	}
	jsonPath := filepath.Join(dir, JSONFileName)
	if _, err := os.Stat(jsonPath); err == nil {
		return loadJSON(jsonPath)
	}
	return nil, fmt.Errorf(
		"no %s or %s found in %s — run `tsuki init` first",
		TOMLFileName, JSONFileName, dir,
	)
}

// loadTOML parses a tsuki-config.toml file.
func loadTOML(path string) (*Manifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}

	var raw tomlRawManifest
	if err := decodeTOML(data, &raw); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}

	m := &Manifest{}

	// Identity — prefer [package] fields, but also check top-level for compat.
	m.Name = raw.Package.Name
	m.Version = raw.Package.Version
	m.Description = raw.Package.Description
	m.Board = raw.Package.Board
	m.GoVersion = raw.Package.GoVersion

	// v3 sub-structs
	m.Project = ProjectMeta{
		Name:        raw.Package.Name,
		Version:     raw.Package.Version,
		Edition:     raw.Package.Edition,
		Description: raw.Package.Description,
		License:     raw.Package.License,
		Authors:     raw.Package.Authors,
		Readme:      raw.Package.Readme,
		Type:        raw.Package.Type,
	}

	m.Bins    = raw.Bins
	m.Libs    = raw.Libs
	m.Profile = raw.Profile
	m.Publish = raw.Publish

	m.Dependencies    = parseDeps(raw.RawDeps)
	m.DevDependencies = parseDeps(raw.RawDevDeps)

	// Synthesise legacy Build from TOML [build] section or sensible defaults.
	m.Build = BuildConfig{
		OutputDir:  raw.Build.OutputDir,
		CppStd:     raw.Build.CppStd,
		Optimize:   raw.Build.Optimize,
		ExtraFlags: raw.Build.ExtraFlags,
		SourceMap:  raw.Build.SourceMap,
	}
	if m.Build.OutputDir == "" {
		m.Build.OutputDir = "build"
	}
	if m.Build.CppStd == "" {
		m.Build.CppStd = "c++11"
	}
	if m.Build.Optimize == "" {
		m.Build.Optimize = "Os"
	}

	// Synthesise legacy Packages from [dependencies] for build.go / check.go.
	for name, dep := range m.Dependencies {
		m.Packages = append(m.Packages, Package{Name: name, Version: dep.Version})
	}

	return m, nil
}

// loadJSON parses the legacy tsuki_package.json.
func loadJSON(path string) (*Manifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	// Provide v3 defaults so callers don't need nil checks.
	if m.Build.OutputDir == "" {
		m.Build.OutputDir = "build"
	}
	if m.Build.CppStd == "" {
		m.Build.CppStd = "c++11"
	}
	if m.Build.Optimize == "" {
		m.Build.Optimize = "Os"
	}
	// Expose packages as v3 dependencies too.
	if m.Dependencies == nil {
		m.Dependencies = make(map[string]DepSpec)
	}
	for _, p := range m.Packages {
		m.Dependencies[p.Name] = DepSpec{Version: p.Version}
	}
	return &m, nil
}

// ── Persistence ───────────────────────────────────────────────────────────────

// Save writes the manifest as tsuki-config.toml in dir.
func (m *Manifest) Save(dir string) error {
	return os.WriteFile(filepath.Join(dir, TOMLFileName), []byte(m.ToTOML()), 0644)
}

// SaveLegacy writes the legacy tsuki_package.json in dir (for old projects).
func (m *Manifest) SaveLegacy(dir string) error {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, JSONFileName), append(data, '\n'), 0644)
}

// ToTOML serialises the manifest to a readable tsuki-config.toml string.
func (m *Manifest) ToTOML() string {
	var sb strings.Builder

	sb.WriteString("# ── generated by tsuki ────────────────────────────────────\n\n")
	sb.WriteString("[package]\n")
	writeKV := func(k, v string) {
		if v != "" {
			sb.WriteString(fmt.Sprintf("%-12s = %q\n", k, v))
		}
	}
	writeKV("name", m.Name)
	writeKV("version", m.Version)
	if m.Project.Edition != "" {
		writeKV("edition", m.Project.Edition)
	}
	writeKV("description", m.Description)
	writeKV("board", m.Board)
	if m.Project.Type != "" {
		writeKV("type", m.Project.Type)
	}
	if len(m.Project.Authors) > 0 {
		sb.WriteString(fmt.Sprintf("%-12s = [", "authors"))
		for i, a := range m.Project.Authors {
			if i > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString(fmt.Sprintf("%q", a))
		}
		sb.WriteString("]\n")
	}

	for _, bin := range m.Bins {
		sb.WriteString("\n[[bin]]\n")
		sb.WriteString(fmt.Sprintf("name        = %q\n", bin.Name))
		sb.WriteString(fmt.Sprintf("path        = %q\n", bin.Path))
		if bin.Entrypoint != "" {
			sb.WriteString(fmt.Sprintf("entrypoint  = %q\n", bin.Entrypoint))
		}
	}

	for _, lib := range m.Libs {
		sb.WriteString("\n[[lib]]\n")
		sb.WriteString(fmt.Sprintf("name = %q\n", lib.Name))
		sb.WriteString(fmt.Sprintf("path = %q\n", lib.Path))
	}

	if len(m.Dependencies) > 0 {
		sb.WriteString("\n[dependencies]\n")
		for name, dep := range m.Dependencies {
			if len(dep.Features) == 0 {
				sb.WriteString(fmt.Sprintf("%-14s = %q\n", name, dep.Version))
			} else {
				sb.WriteString(fmt.Sprintf(
					"%-14s = { version = %q, features = [%s] }\n",
					name, dep.Version,
					`"`+strings.Join(dep.Features, `", "`)+`"`,
				))
			}
		}
	}

	if len(m.DevDependencies) > 0 {
		sb.WriteString("\n[dev-dependencies]\n")
		for name, dep := range m.DevDependencies {
			sb.WriteString(fmt.Sprintf("%-14s = %q\n", name, dep.Version))
		}
	}

	sb.WriteString("\n[build]\n")
	sb.WriteString(fmt.Sprintf("output_dir = %q\n", m.Build.OutputDir))
	sb.WriteString(fmt.Sprintf("cpp_std    = %q\n", m.Build.CppStd))
	sb.WriteString(fmt.Sprintf("optimize   = %q\n", m.Build.Optimize))
	sb.WriteString(fmt.Sprintf("source_map = %v\n", m.Build.SourceMap))

	return sb.String()
}

// ── Search ────────────────────────────────────────────────────────────────────

// Find searches upward from startDir for a tsuki-config.toml or tsuki_package.json.
func Find(startDir string) (string, *Manifest, error) {
	dir := startDir
	for {
		for _, name := range []string{TOMLFileName, JSONFileName} {
			if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
				m, err := Load(dir)
				return dir, m, err
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", nil, fmt.Errorf(
		"no %s or %s found (searched upward from %s)",
		TOMLFileName, JSONFileName, startDir,
	)
}

// ── Default ───────────────────────────────────────────────────────────────────

// Default returns a new Manifest with sensible defaults.
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
		Dependencies: make(map[string]DepSpec),
	}
}

// ── Helpers (used by build.go / check.go / pkgmgr.go) ───────────────────────

// PackageNames returns a slice of dependency names for passing to the core.
func (m *Manifest) PackageNames() []string {
	names := make([]string, len(m.Packages))
	for i, p := range m.Packages {
		names[i] = p.Name
	}
	return names
}

// HasPackage reports whether the manifest declares the given package.
func (m *Manifest) HasPackage(name string) bool {
	for _, p := range m.Packages {
		if p.Name == name {
			return true
		}
	}
	return false
}

// AddPackage appends a dependency (if not already present).
func (m *Manifest) AddPackage(name, version string) bool {
	if m.HasPackage(name) {
		return false
	}
	m.Packages = append(m.Packages, Package{Name: name, Version: version})
	if m.Dependencies == nil {
		m.Dependencies = make(map[string]DepSpec)
	}
	m.Dependencies[name] = DepSpec{Version: version}
	return true
}

// RemovePackage removes a dependency by name.
func (m *Manifest) RemovePackage(name string) bool {
	for i, p := range m.Packages {
		if p.Name == name {
			m.Packages = append(m.Packages[:i], m.Packages[i+1:]...)
			delete(m.Dependencies, name)
			return true
		}
	}
	return false
}