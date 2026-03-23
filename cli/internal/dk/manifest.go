// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-dk :: manifest  —  load/save tsuki.toml from a package directory
// ─────────────────────────────────────────────────────────────────────────────

package dk

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// DkManifest is the in-memory representation of tsuki.toml.
type DkManifest struct {
	Package    PackageSection
	App        *AppSection
	Library    *LibSection
	IdePlugin  *IdePluginSection
	rawDeps    string // raw lines from [dependencies]
	rawDevDeps string // raw lines from [dev-dependencies]
}

type PackageSection struct {
	Name        string
	Version     string
	Type        string
	Description string
	Author      string
	License     string
	Repository  string
	Signing     SigningSection
}

type SigningSection struct {
	Key string
}

type AppSection struct {
	InstallAs string
}

type LibSection struct {
	CppHeader  string
	ArduinoLib string
}

// IdePluginSection holds the [ide-plugin] block from tsuki.toml.
// It provides permissions and slots that are written into packages.json
// by 'tsuki-dk registry add'.
type IdePluginSection struct {
	Entry          string   // path to plugin entry point (e.g. "plugin/index.js")
	Permissions    []string // e.g. ["fs:read", "shell:execute"]
	Slots          []string // e.g. ["sidebar-tab", "status-bar"]
	// SettingsSchema is declared via [[ide-plugin.settings]] entries in tsuki.toml.
	// Each entry becomes one control in the IDE Plugin Manager settings panel.
	// Example:
	//   [[ide-plugin.settings]]
	//   key         = "diagnostic_delay"
	//   label       = "Diagnostic delay (ms)"
	//   description = "How long to wait after typing before running diagnostics."
	//   type        = "number"
	//   default     = 600
	SettingsSchema []IdePluginSetting
}

// IdePluginSetting is one entry in [[ide-plugin.settings]] in tsuki.toml.
type IdePluginSetting struct {
	Key         string
	Label       string
	Description string
	Type        string   // "toggle" | "text" | "number" | "select"
	Default     string   // stored as string, coerced by type at read time
	Options     []string // for type = "select"
}

func loadManifest(dir string) (*DkManifest, error) {
	path := filepath.Join(dir, "tsuki.toml")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("tsuki.toml not found in %s\n  Run: tsuki-dk new <type> <n>", dir)
	}

	m := &DkManifest{}
	var section string

	for _, rawLine := range strings.Split(string(data), "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// Section header
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			// Strip [[ ]] for array-of-tables (e.g. [[ide-plugin.settings]])
			inner := line[1 : len(line)-1]
			if strings.HasPrefix(inner, "[") && strings.HasSuffix(inner, "]") {
				inner = inner[1 : len(inner)-1]
			}
			section = inner
			if section == "app" && m.App == nil {
				m.App = &AppSection{}
			}
			if section == "library" && m.Library == nil {
				m.Library = &LibSection{}
			}
			if (section == "ide-plugin" || section == "ide-plugin.settings") && m.IdePlugin == nil {
				m.IdePlugin = &IdePluginSection{}
			}
			continue
		}
		k, v, ok := parseTomlKV(line)
		if !ok {
			continue
		}
		switch section {
		case "dependencies":
			m.rawDeps += rawLine + "\n"
			continue
		case "dev-dependencies":
			m.rawDevDeps += rawLine + "\n"
			continue
		case "package":
			switch k {
			case "name":        m.Package.Name = v
			case "version":     m.Package.Version = v
			case "type":        m.Package.Type = v
			case "description": m.Package.Description = v
			case "author":      m.Package.Author = v
			case "license":     m.Package.License = v
			case "repository":  m.Package.Repository = v
			}
		case "package.signing":
			if k == "key" {
				m.Package.Signing.Key = v
			}
		case "app":
			if m.App != nil && k == "install_as" {
				m.App.InstallAs = v
			}
		case "library":
			if m.Library != nil {
				switch k {
				case "cpp_header":  m.Library.CppHeader = v
				case "arduino_lib": m.Library.ArduinoLib = v
				}
			}
		case "ide-plugin":
			if m.IdePlugin != nil {
				switch k {
				case "entry":
					m.IdePlugin.Entry = v
				case "permissions":
					m.IdePlugin.Permissions = parseTomlStringSlice(v)
				case "slots":
					m.IdePlugin.Slots = parseTomlStringSlice(v)
				}
			}
		case "ide-plugin.settings":
			// [[ide-plugin.settings]] — array of tables (one entry per block).
			// Each block starts a new IdePluginSetting; fields fill the last one.
			if m.IdePlugin != nil {
				if k == "key" {
					// New block — append a fresh entry
					m.IdePlugin.SettingsSchema = append(m.IdePlugin.SettingsSchema, IdePluginSetting{Key: v})
				} else if len(m.IdePlugin.SettingsSchema) > 0 {
					last := &m.IdePlugin.SettingsSchema[len(m.IdePlugin.SettingsSchema)-1]
					switch k {
					case "label":       last.Label = v
					case "description": last.Description = v
					case "type":        last.Type = v
					case "default":     last.Default = v
					case "options":     last.Options = parseTomlStringSlice(v)
					}
				}
			}
		}
	}

	if m.Package.Name == "" {
		return nil, fmt.Errorf("tsuki.toml: [package] name is required")
	}
	if m.Package.Version == "" {
		return nil, fmt.Errorf("tsuki.toml: [package] version is required")
	}
	if m.Package.Type == "" {
		return nil, fmt.Errorf("tsuki.toml: [package] type is required")
	}
	return m, nil
}

// saveManifestVersion rewrites only the version field in tsuki.toml.
func saveManifestVersion(m *DkManifest) error {
	path := "tsuki.toml"
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	lines := strings.Split(string(data), "\n")
	inPackage := false
	replaced := false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "[package]" {
			inPackage = true
			continue
		}
		if len(trimmed) > 0 && trimmed[0] == '[' {
			inPackage = false
		}
		if inPackage && strings.HasPrefix(trimmed, "version") && !replaced {
			lines[i] = `version = "` + m.Package.Version + `"`
			replaced = true
		}
	}
	if !replaced {
		return fmt.Errorf("could not find version field in tsuki.toml")
	}
	return os.WriteFile(path, []byte(strings.Join(lines, "\n")), 0644)
}

// parseTomlKV parses a single TOML key = "value" line.
func parseTomlKV(line string) (key, value string, ok bool) {
	idx := strings.IndexByte(line, '=')
	if idx < 0 {
		return
	}
	key = strings.TrimSpace(line[:idx])
	val := strings.TrimSpace(line[idx+1:])
	// Strip inline comments
	if ci := strings.Index(val, " #"); ci >= 0 {
		val = strings.TrimSpace(val[:ci])
	}
	// Strip surrounding quotes
	if len(val) >= 2 && val[0] == '"' && val[len(val)-1] == '"' {
		val = val[1 : len(val)-1]
	}
	return key, val, key != ""
}

// parseTomlStringSlice parses a TOML inline array like ["a","b","c"] or
// a single quoted string "a" into a []string.
func parseTomlStringSlice(raw string) []string {
	raw = strings.TrimSpace(raw)
	// Inline array: ["a", "b"]
	if strings.HasPrefix(raw, "[") && strings.HasSuffix(raw, "]") {
		inner := raw[1 : len(raw)-1]
		parts := strings.Split(inner, ",")
		var out []string
		for _, p := range parts {
			p = strings.TrimSpace(p)
			p = strings.Trim(p, `"'`)
			if p != "" {
				out = append(out, p)
			}
		}
		return out
	}
	// Single value
	if raw != "" {
		return []string{raw}
	}
	return nil
}