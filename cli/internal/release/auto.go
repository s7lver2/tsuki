// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-dk :: internal/release/auto  —  auto-detect, watch, CI generation
// ─────────────────────────────────────────────────────────────────────────────

package release

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/tsuki/cli/internal/ui"
)

// ── Trigger detection ─────────────────────────────────────────────────────────

type triggerInfo struct {
	Source    string // "github-actions" | "env-tag" | "explicit"
	Tag       string // e.g. "v2.1.0"
	Component string // "" = all
}

func detectTrigger(explicitTag, explicitComponent string) (triggerInfo, error) {
	// 1. GitHub Actions — GITHUB_REF is "refs/tags/v2.1.0"
	if os.Getenv("GITHUB_ACTIONS") == "true" {
		ref := os.Getenv("GITHUB_REF")
		if strings.HasPrefix(ref, "refs/tags/") {
			tag := strings.TrimPrefix(ref, "refs/tags/")
			comp := os.Getenv("TSUKI_RELEASE_COMPONENT")
			return triggerInfo{Source: "github-actions", Tag: tag, Component: comp}, nil
		}
		return triggerInfo{}, fmt.Errorf(
			"GITHUB_ACTIONS=true but GITHUB_REF is not a tag push (%q)", ref)
	}

	// 2. Generic CI — TAG env var
	if tag := os.Getenv("TAG"); tag != "" && os.Getenv("CI") == "true" {
		return triggerInfo{Source: "env-tag", Tag: tag}, nil
	}

	// 3. Explicit --tag flag
	if explicitTag != "" {
		return triggerInfo{Source: "explicit", Tag: explicitTag, Component: explicitComponent}, nil
	}

	return triggerInfo{}, fmt.Errorf(
		"no trigger detected\n" +
			"  Set GITHUB_REF (GitHub Actions), TAG (generic CI), or pass --tag <v0.0.0>")
}

func resolveTargets(cfg *Config, t triggerInfo) ([]Component, error) {
	if t.Component != "" {
		c, ok := cfg.ComponentByName(t.Component)
		if !ok {
			return nil, fmt.Errorf("component %q not found in release.toml", t.Component)
		}
		return []Component{*c}, nil
	}

	// Tag matches "<component-name>-v<version>" pattern
	for _, comp := range cfg.Components {
		if strings.HasPrefix(t.Tag, comp.Name+"-") {
			return []Component{comp}, nil
		}
	}

	// Global "v<version>" tag — release all
	if strings.HasPrefix(t.Tag, "v") {
		return cfg.Components, nil
	}

	return nil, fmt.Errorf("tag %q does not match any component or global pattern", t.Tag)
}

// ── RunAuto ───────────────────────────────────────────────────────────────────

func RunAuto(cfg *Config, baseOpts ReleaseOptions) error {
	trigger, err := detectTrigger("", "")
	if err != nil {
		return err
	}

	fmt.Printf("\n  tsuki-dk  release  auto\n")
	fmt.Printf("  source    %s\n", trigger.Source)
	fmt.Printf("  tag       %s\n", trigger.Tag)
	if trigger.Component != "" {
		fmt.Printf("  component %s\n", trigger.Component)
	}
	if baseOpts.DryRun {
		ui.Warn("dry-run mode — nothing will be uploaded or pushed")
	}
	fmt.Println()

	targets, err := resolveTargets(cfg, trigger)
	if err != nil {
		return err
	}
	if len(targets) == 0 {
		ui.Note("No components to release for this tag.")
		return nil
	}

	version := strings.TrimPrefix(trigger.Tag, "v")
	opts := baseOpts
	opts.AutoTag   = version
	opts.SkipTests = os.Getenv("TSUKI_SKIP_TESTS") == "1"

	return RunRelease(cfg, targets, opts)
}

// ── RunWatch ──────────────────────────────────────────────────────────────────

func RunWatch(cfg *Config) error {
	poll := cfg.Automation.PollInterval
	if poll <= 0 {
		poll = 60
	}

	fmt.Printf("\n  tsuki-dk  release  watch\n")
	fmt.Printf("  interval  %ds\n\n", poll)

	for {
		if err := watchCycle(cfg); err != nil {
			ui.Warn("cycle error: " + err.Error())
		}
		time.Sleep(time.Duration(poll) * time.Second)
	}
}

func watchCycle(cfg *Config) error {
	idx, err := LoadPackageIndex(cfg)
	if err != nil {
		return err
	}

	privKey, err := LoadPrivateKey(cfg.Registry.Key)
	if err != nil {
		return err
	}

	workDir := filepath.Join(os.TempDir(), "tsuki-dk-watch-"+timestamp())
	if err := os.MkdirAll(workDir, 0755); err != nil {
		return err
	}
	defer os.RemoveAll(workDir)

	released := 0
	for _, comp := range cfg.Components {
		latestTag, err := fetchLatestGitHubTag(cfg, &comp)
		if err != nil {
			ui.Warn(fmt.Sprintf("  %s: could not fetch latest tag: %v", comp.Name, err))
			continue
		}
		version := strings.TrimPrefix(latestTag, "v")

		if idx.HasVersion(comp.Name, cfg.Registry.Owner, version) {
			continue
		}

		ui.Note(fmt.Sprintf("  new version: %s/%s@%s", cfg.Registry.Owner, comp.Name, version))
		opts := ReleaseOptions{
			AutoTag:  version,
			SkipPush: true,
		}
		if err := releaseComponent(cfg, &comp, opts, privKey, idx, workDir); err != nil {
			ui.Fail(fmt.Sprintf("  %s: %v", comp.Name, err))
		} else {
			released++
		}
	}

	if released > 0 {
		if err := SavePackageIndex(cfg, idx); err != nil {
			return fmt.Errorf("saving packages.json: %w", err)
		}
		if err := SyncRegistry(cfg, fmt.Sprintf("watch: %d new releases", released)); err != nil {
			ui.Warn("sync failed: " + err.Error())
		}
	}

	return nil
}

func fetchLatestGitHubTag(cfg *Config, comp *Component) (string, error) {
	repo := comp.FullRepo(cfg)
	url := fmt.Sprintf("https://api.github.com/repos/%s/tags?per_page=1", repo)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if token := os.Getenv("GITHUB_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("GitHub API %d for %s", resp.StatusCode, repo)
	}

	var tags []struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tags); err != nil {
		return "", err
	}
	if len(tags) == 0 {
		return "", fmt.Errorf("no tags found for %s", repo)
	}
	return tags[0].Name, nil
}

// ── GenerateCIWorkflow ────────────────────────────────────────────────────────

func GenerateCIWorkflow(cfg *Config) error {
	outDir := ".github/workflows"
	tagPattern := cfg.Automation.OnTag
	if tagPattern == "" {
		tagPattern = "v*.*.*"
	}

	var buf bytes.Buffer
	fmt.Fprintf(&buf, `# Generated by tsuki-dk release ci generate
# Re-run to regenerate: tsuki-dk release ci generate
name: tsuki-release

on:
  push:
    tags:
      - '%s'

permissions:
  contents: write

jobs:
  release:
    name: Release ${{ github.ref_name }}
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Go
        uses: actions/setup-go@v5
        with:
          go-version: stable

      - name: Install Rust cross-compile targets
        run: |
          rustup target add x86_64-unknown-linux-gnu
          rustup target add aarch64-unknown-linux-gnu
          rustup target add x86_64-apple-darwin
          rustup target add aarch64-apple-darwin
          rustup target add x86_64-pc-windows-msvc

      - name: Install UPX
        run: sudo apt-get install -y upx-ucl

      - name: Install tsuki-dk
        run: go install github.com/tsuki-team/tsuki/cli/cmd/tsuki-dk@latest

      - name: Release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: tsuki-dk release auto
`, tagPattern)

	if err := os.MkdirAll(outDir, 0755); err != nil {
		return fmt.Errorf("creating %s: %w", outDir, err)
	}

	outPath := filepath.Join(outDir, "tsuki-release.yml")
	if err := os.WriteFile(outPath, buf.Bytes(), 0644); err != nil {
		return err
	}

	ui.Success("Generated " + outPath)
	fmt.Printf("\n  Commit and push this file to activate the workflow.\n\n")
	return nil
}