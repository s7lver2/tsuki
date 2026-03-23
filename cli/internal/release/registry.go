// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-dk :: internal/release/registry  —  packages.json + tsuki-keys.json
// ─────────────────────────────────────────────────────────────────────────────

package release

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/tsuki/cli/internal/ui"
)

// ── PackageIndex ──────────────────────────────────────────────────────────────

type PackageIndex struct {
	SchemaVersion int          `json:"schema_version"`
	Packages      []IndexEntry `json:"packages"`
}

type IndexEntry struct {
	Name        string    `json:"name"`
	Owner       string    `json:"owner"`
	Type        string    `json:"type"`
	Description string    `json:"description,omitempty"`
	Icon        string    `json:"icon,omitempty"`
	Tags        []string  `json:"tags,omitempty"`
	Repository  string    `json:"repository,omitempty"`
	Downloads   int64     `json:"downloads,omitempty"`
	Rating      float64   `json:"rating,omitempty"`
	Versions    []Version `json:"versions"`
}

type Version struct {
	Version   string                 `json:"version"`
	URL       string                 `json:"url,omitempty"`
	Checksum  string                 `json:"checksum,omitempty"`
	Signature string                 `json:"signature,omitempty"`
	Binaries  map[string]BinaryAsset `json:"binaries,omitempty"`
}

type BinaryAsset struct {
	URL       string `json:"url"`
	Checksum  string `json:"checksum"`
	Signature string `json:"signature"`
}

func (idx *PackageIndex) HasVersion(name, owner, version string) bool {
	for _, p := range idx.Packages {
		if p.Name == name && p.Owner == owner {
			for _, v := range p.Versions {
				if v.Version == version {
					return true
				}
			}
		}
	}
	return false
}

func (idx *PackageIndex) Upsert(comp *Component, owner, version string, assets []PublishedAsset) {
	ver := buildVersion(comp, version, assets)

	for i, p := range idx.Packages {
		if p.Name == comp.Name && p.Owner == owner {
			filtered := p.Versions[:0]
			for _, v := range p.Versions {
				if v.Version != version {
					filtered = append(filtered, v)
				}
			}
			idx.Packages[i].Versions = append(filtered, ver)
			idx.Packages[i] = enrichIndexEntry(idx.Packages[i], comp)
			return
		}
	}

	entry := IndexEntry{
		Name:     comp.Name,
		Owner:    owner,
		Type:     comp.Type,
		Versions: []Version{ver},
	}
	entry = enrichIndexEntry(entry, comp)
	idx.Packages = append(idx.Packages, entry)
}

func enrichIndexEntry(e IndexEntry, comp *Component) IndexEntry {
	if comp.Description != "" { e.Description = comp.Description }
	if comp.Icon != ""        { e.Icon = comp.Icon }
	if len(comp.Tags) > 0    { e.Tags = comp.Tags }
	if comp.Repo != ""        { e.Repository = "https://github.com/" + comp.Repo }
	return e
}

func buildVersion(comp *Component, version string, assets []PublishedAsset) Version {
	ver := Version{Version: version}
	if comp.Type == "app" {
		ver.Binaries = make(map[string]BinaryAsset)
		for _, a := range assets {
			ver.Binaries[a.Platform] = BinaryAsset{
				URL:       a.URL,
				Checksum:  a.Checksum,
				Signature: a.Signature,
			}
		}
	} else if len(assets) > 0 {
		ver.URL       = assets[0].URL
		ver.Checksum  = assets[0].Checksum
		ver.Signature = assets[0].Signature
	}
	return ver
}

// ── Storage ───────────────────────────────────────────────────────────────────

func LoadPackageIndex(cfg *Config) (*PackageIndex, error) {
	path := filepath.Join(cfg.Registry.Path, "packages.json")
	idx := &PackageIndex{SchemaVersion: 2}

	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return idx, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading packages.json: %w", err)
	}
	if err := json.Unmarshal(data, idx); err != nil {
		return nil, fmt.Errorf("parsing packages.json: %w", err)
	}
	if idx.SchemaVersion == 0 {
		idx.SchemaVersion = 2
	}
	return idx, nil
}

func SavePackageIndex(cfg *Config, idx *PackageIndex) error {
	if err := os.MkdirAll(cfg.Registry.Path, 0755); err != nil {
		return err
	}
	idx.SchemaVersion = 2
	data, err := json.MarshalIndent(idx, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(cfg.Registry.Path, "packages.json"), data, 0644)
}

// ── KeyIndex ──────────────────────────────────────────────────────────────────

type KeyIndex struct {
	SchemaVersion int                 `json:"schema_version"`
	Signers       map[string]KeyEntry `json:"signers"`
}

type KeyEntry struct {
	PublicKey   string    `json:"public_key"`
	DisplayName string    `json:"display_name,omitempty"`
	AvatarURL   string    `json:"avatar_url,omitempty"`
	Bio         string    `json:"bio,omitempty"`
	Website     string    `json:"website,omitempty"`
	Verified    bool      `json:"verified,omitempty"`
	Role        string    `json:"role,omitempty"`
	AddedAt     time.Time `json:"added_at,omitempty"`
}

func LoadKeyIndex(cfg *Config) (*KeyIndex, error) {
	ki := &KeyIndex{SchemaVersion: 2, Signers: map[string]KeyEntry{}}
	path := filepath.Join(cfg.Registry.Path, "tsuki-keys.json")
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return ki, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, ki); err != nil {
		return nil, fmt.Errorf("parsing tsuki-keys.json: %w", err)
	}
	if ki.Signers == nil {
		ki.Signers = map[string]KeyEntry{}
	}
	return ki, nil
}

func SaveKeyIndex(cfg *Config, ki *KeyIndex) error {
	if err := os.MkdirAll(cfg.Registry.Path, 0755); err != nil {
		return err
	}
	ki.SchemaVersion = 2
	data, err := json.MarshalIndent(ki, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(cfg.Registry.Path, "tsuki-keys.json"), data, 0644)
}

// ── Key management ────────────────────────────────────────────────────────────

func GenerateKey(name string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	keyDir := filepath.Join(home, ".tsuki", "keys")
	if err := os.MkdirAll(keyDir, 0700); err != nil {
		return err
	}
	keyPath := filepath.Join(keyDir, name+".pem")
	if _, err := os.Stat(keyPath); err == nil {
		ui.Warn("key already exists at " + keyPath + " — not overwriting")
		return nil
	}

	pubKey, privKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return fmt.Errorf("generating key: %w", err)
	}

	privPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "ED25519 PRIVATE KEY",
		Bytes: privKey,
	})
	if err := os.WriteFile(keyPath, privPEM, 0600); err != nil {
		return fmt.Errorf("writing private key: %w", err)
	}

	pubB64 := "ed25519:" + base64.StdEncoding.EncodeToString(pubKey)
	ui.Success("Generated Ed25519 key: " + keyPath)
	fmt.Printf("\n  public key:  %s\n\n", pubB64)
	ui.Note("Run 'tsuki-dk release key export' to add this key to the registry.")
	return nil
}

func LoadPrivateKey(name string) (ed25519.PrivateKey, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	path := filepath.Join(home, ".tsuki", "keys", name+".pem")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf(
			"private key %q not found at %s\n  Run: tsuki-dk release key generate",
			name, path)
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("invalid PEM in %s", path)
	}
	if len(block.Bytes) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("unexpected key size in %s", path)
	}
	return ed25519.PrivateKey(block.Bytes), nil
}

func ExportPublicKey(cfg *Config) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	keyPath := filepath.Join(home, ".tsuki", "keys", cfg.Registry.Key+".pem")
	data, err := os.ReadFile(keyPath)
	if err != nil {
		return fmt.Errorf("key not found at %s — run: tsuki-dk release key generate", keyPath)
	}

	block, _ := pem.Decode(data)
	if block == nil {
		return fmt.Errorf("invalid PEM")
	}
	privKey := ed25519.PrivateKey(block.Bytes)
	pubKey  := privKey.Public().(ed25519.PublicKey)
	pubB64  := "ed25519:" + base64.StdEncoding.EncodeToString(pubKey)

	ki, err := LoadKeyIndex(cfg)
	if err != nil {
		return err
	}

	existing, ok := ki.Signers[cfg.Registry.Key]
	if !ok {
		existing = KeyEntry{AddedAt: time.Now()}
	}
	existing.PublicKey = pubB64
	if !existing.Verified {
		existing.Verified = (cfg.Registry.Key == "tsuki-team")
	}
	if existing.Role == "" {
		existing.Role = "core"
	}
	ki.Signers[cfg.Registry.Key] = existing

	if err := SaveKeyIndex(cfg, ki); err != nil {
		return err
	}
	ui.Success(fmt.Sprintf("Exported public key for %q to tsuki-keys.json", cfg.Registry.Key))
	fmt.Printf("\n  public_key  %s\n\n", pubB64)
	return nil
}

// ── Registry sync ─────────────────────────────────────────────────────────────

func SyncRegistry(cfg *Config, message string) error {
	if message == "" {
		message = fmt.Sprintf("chore: update registry (%s)", time.Now().Format("2006-01-02"))
	}

	fmt.Println("  pushing registry to git...")

	cmds := [][]string{
		{"git", "-C", cfg.Registry.Path, "add", "packages.json", "tsuki-keys.json"},
		{"git", "-C", cfg.Registry.Path, "commit", "--allow-empty", "-m", message},
		{"git", "-C", cfg.Registry.Path, "push", cfg.Registry.Remote, cfg.Registry.Branch},
	}

	for _, c := range cmds {
		out, err := RunCapture(c[0], c[1:]...)
		if err != nil {
			return fmt.Errorf("%s failed:\n%s", strings.Join(c[2:], " "), out)
		}
	}

	ui.Success("registry pushed")
	return nil
}

// ── Status ────────────────────────────────────────────────────────────────────

func PrintRegistryStatus(cfg *Config) error {
	idx, err := LoadPackageIndex(cfg)
	if err != nil {
		return err
	}
	ki, _ := LoadKeyIndex(cfg)

	fmt.Println()
	fmt.Printf("  Registry  %s\n\n", cfg.Registry.Path)
	fmt.Printf("  %-36s  %-12s  %-8s  %s\n", "PACKAGE", "TYPE", "VERSIONS", "LATEST")
	fmt.Printf("  %s\n", strings.Repeat("─", 76))

	for _, p := range idx.Packages {
		latest := "—"
		if len(p.Versions) > 0 {
			latest = p.Versions[len(p.Versions)-1].Version
		}
		icon := p.Icon
		if icon == "" {
			icon = " "
		}
		fmt.Printf("  %-36s  %-12s  %-8d  %s\n",
			icon+" "+p.Owner+"/"+p.Name, p.Type, len(p.Versions), latest)
	}

	fmt.Printf("\n  %d packages\n", len(idx.Packages))

	if ki != nil && len(ki.Signers) > 0 {
		fmt.Println()
		fmt.Printf("  Signers (%d):\n", len(ki.Signers))
		for name, e := range ki.Signers {
			badge := ""
			if e.Verified { badge = "  ✓ verified" }
			role := ""
			if e.Role != "" { role = "  [" + e.Role + "]" }
			fmt.Printf("    %-20s%s%s\n", name, role, badge)
		}
	}
	fmt.Println()
	return nil
}

func PrintStatus(cfg *Config) error {
	idx, err := LoadPackageIndex(cfg)
	if err != nil {
		return err
	}

	fmt.Println()
	fmt.Printf("  tsuki-dk  release  status\n\n")
	fmt.Printf("  %-12s  %-36s  %-10s  %-12s  %s\n",
		"COMPONENT", "REPO", "TYPE", "PUBLISHED", "VERSION")
	fmt.Printf("  %s\n", strings.Repeat("─", 84))

	for _, comp := range cfg.Components {
		published := "—"
		version   := "—"

		for _, p := range idx.Packages {
			if p.Name == comp.Name && p.Owner == cfg.Registry.Owner {
				if len(p.Versions) > 0 {
					published = time.Now().Format("2006-01-02")
					version   = p.Versions[len(p.Versions)-1].Version
				}
				break
			}
		}

		icon := comp.Icon
		if icon == "" { icon = "·" }
		fmt.Printf("  %-12s  %-36s  %-10s  %-12s  %s\n",
			icon+" "+comp.Name, comp.Repo, comp.Type, published, version)
	}

	fmt.Println()
	return nil
}