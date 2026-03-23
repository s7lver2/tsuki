// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-dk :: internal/release/config  —  load release.toml
// ─────────────────────────────────────────────────────────────────────────────

package release

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// ── Types ─────────────────────────────────────────────────────────────────────

type Config struct {
	Registry   RegistryConfig
	GitHub     GitHubConfig
	Automation AutomationConfig
	Components []Component
}

type RegistryConfig struct {
	Path   string
	Owner  string
	Key    string
	Remote string
	Branch string
}

type GitHubConfig struct {
	Org string
}

type AutomationConfig struct {
	OnTag           string
	OnGitHubRelease bool
	CI              string
	NotifyWebhook   string
	AutoSync        bool
	RetryCount      int
	PollInterval    int
}

func defaultAutomation() AutomationConfig {
	return AutomationConfig{
		OnTag:        "v*.*.*",
		AutoSync:     true,
		RetryCount:   1,
		PollInterval: 60,
	}
}

// BuildTool is how the component is compiled.
type BuildTool string

const (
	BuildCargo BuildTool = "cargo"
	BuildGo    BuildTool = "go"
	BuildTauri BuildTool = "tauri"
	BuildNpm   BuildTool = "npm"
	BuildNone  BuildTool = "none"
)

// Component is one releasable unit declared in release.toml.
type Component struct {
	Name        string
	Type        string
	Description string
	Icon        string
	Tags        []string
	Repo        string
	BuildDir    string
	BuildTool   BuildTool
	Entry       string
	InstallAs   string
}

func (c *Component) FullRepo(cfg *Config) string {
	if strings.Contains(c.Repo, "/") {
		return c.Repo
	}
	return cfg.GitHub.Org + "/" + c.Repo
}

func (cfg *Config) ComponentByName(name string) (*Component, bool) {
	for i := range cfg.Components {
		if cfg.Components[i].Name == name {
			return &cfg.Components[i], true
		}
	}
	return nil, false
}

// ReleaseOptions carries flags for one release run.
type ReleaseOptions struct {
	Bump          string // "major" | "minor" | "patch" | ""
	AutoTag       string // version extracted from a git tag
	DryRun        bool
	SkipBuild     bool
	SkipTests     bool
	SkipPush      bool
	Force         bool
	NoUpload      bool   // sign + hash locally, skip GitHub Release upload
	NoCompression bool   // skip UPX binary compression step
}

// ── Loader ────────────────────────────────────────────────────────────────────

func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("cannot read %s: %w", path, err)
	}

	auto := defaultAutomation()
	cfg := &Config{
		Registry: RegistryConfig{
			Path:   "./registry",
			Remote: "origin",
			Branch: "main",
		},
		Automation: auto,
	}

	var currentComponent *Component
	var section string

	for _, rawLine := range strings.Split(string(data), "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		if strings.HasPrefix(line, "[") {
			if line == "[[component]]" {
				if currentComponent != nil {
					cfg.Components = append(cfg.Components, *currentComponent)
				}
				currentComponent = &Component{}
				section = "component"
				continue
			}
			inner := strings.Trim(line, "[]")
			section = inner
			currentComponent = nil
			continue
		}

		k, v, ok := ParseKV(line)
		if !ok {
			continue
		}

		switch section {
		case "registry":
			switch k {
			case "path":   cfg.Registry.Path = v
			case "owner":  cfg.Registry.Owner = v
			case "key":    cfg.Registry.Key = v
			case "remote": cfg.Registry.Remote = v
			case "branch": cfg.Registry.Branch = v
			}
		case "github":
			if k == "org" {
				cfg.GitHub.Org = v
			}
		case "automation":
			switch k {
			case "on_tag":            cfg.Automation.OnTag = v
			case "on_github_release": cfg.Automation.OnGitHubRelease = v == "true"
			case "ci":                cfg.Automation.CI = v
			case "notify_webhook":    cfg.Automation.NotifyWebhook = v
			case "auto_sync":         cfg.Automation.AutoSync = v == "true"
			case "retry_count":
				if n, err := strconv.Atoi(v); err == nil {
					cfg.Automation.RetryCount = n
				}
			case "poll_interval":
				if n, err := strconv.Atoi(v); err == nil {
					cfg.Automation.PollInterval = n
				}
			}
		case "component":
			if currentComponent != nil {
				switch k {
				case "name":        currentComponent.Name = v
				case "type":        currentComponent.Type = v
				case "description": currentComponent.Description = v
				case "icon":        currentComponent.Icon = v
				case "tags":        currentComponent.Tags = parseStringSlice(v)
				case "repo":        currentComponent.Repo = v
				case "build_dir":   currentComponent.BuildDir = v
				case "build_tool":  currentComponent.BuildTool = BuildTool(v)
				case "entry":       currentComponent.Entry = v
				case "install_as":  currentComponent.InstallAs = v
				}
			}
		}
	}

	if currentComponent != nil {
		cfg.Components = append(cfg.Components, *currentComponent)
	}

	if cfg.Registry.Owner == "" {
		return nil, fmt.Errorf("release.toml: [registry] owner is required")
	}
	if cfg.Registry.Key == "" {
		return nil, fmt.Errorf("release.toml: [registry] key is required")
	}
	if cfg.GitHub.Org == "" {
		return nil, fmt.Errorf("release.toml: [github] org is required")
	}

	if env := os.Getenv("TSUKI_DK_REGISTRY"); env != "" {
		cfg.Registry.Path = env
	}
	if env := os.Getenv("TSUKI_RELEASE_KEY"); env != "" {
		cfg.Registry.Key = env
	}

	return cfg, nil
}

// ── TOML helpers ──────────────────────────────────────────────────────────────

func ParseKV(line string) (key, value string, ok bool) {
	idx := strings.IndexByte(line, '=')
	if idx < 0 {
		return
	}
	key = strings.TrimSpace(line[:idx])
	val := strings.TrimSpace(line[idx+1:])
	if ci := strings.Index(val, " #"); ci >= 0 {
		val = strings.TrimSpace(val[:ci])
	}
	if len(val) >= 2 && val[0] == '"' && val[len(val)-1] == '"' {
		val = val[1 : len(val)-1]
	}
	return key, val, key != ""
}

func parseStringSlice(raw string) []string {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "[") && strings.HasSuffix(raw, "]") {
		inner := raw[1 : len(raw)-1]
		var out []string
		for _, p := range strings.Split(inner, ",") {
			p = strings.TrimSpace(strings.Trim(p, `"'`))
			if p != "" {
				out = append(out, p)
			}
		}
		return out
	}
	if raw != "" {
		return []string{raw}
	}
	return nil
}