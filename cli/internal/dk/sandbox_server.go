// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-dk :: sandbox server  —  ephemeral but fully-valid local registry
//
//  Exposes three endpoints on 127.0.0.1:<random-port>:
//    GET /packages.json      rich IndexEntry (schema v2, all metadata fields)
//    GET /tsuki-keys.json   KeyIndex with author's real pub key (or placeholder)
//    GET /pkg/<n>.tar.gz  package tarball (sha256 checked)
//
//  "Valid registry" contract:
//    • schema_version = 2 in both JSON files
//    • description, icon, tags, permissions, slots from tsuki.toml
//    • latest_version = current version
//    • Signers entry for the package author (real Ed25519 or local-dev stub)
//    • Signature = "local-dev-no-sig"  →  CLI skips Ed25519 for 127.0.0.1
// ─────────────────────────────────────────────────────────────────────────────

package dk

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	v2 "github.com/tsuki/cli/internal/pkgmgr/v2"
	"github.com/tsuki/cli/internal/ui"
)

// sandboxServer is a local HTTP server acting as a fully valid package registry.
type sandboxServer struct {
	m        *DkManifest
	addr     string
	tarball  []byte
	checksum string // "sha256:<hex>"
	idx      v2.PackageIndex
	ki       v2.KeyIndex
	srv      *http.Server
}

// startSandboxServer packs the package, builds rich registry JSON, starts the
// HTTP server, and prints a formatted summary.  Call srv.stop() on exit.
func startSandboxServer(m *DkManifest) (*sandboxServer, error) {
	switch m.Package.Type {
	case "library", "board-pack", "ide-plugin", "sdk-patch":
	default:
		return nil, nil
	}

	ui.SectionTitle("Local Registry")

	// 1. Pack tarball
	sp := ui.NewSpinner("Packing package…")
	sp.Start()
	var buf bytes.Buffer
	if err := buildTarball(&buf); err != nil {
		sp.Stop(false, "failed")
		return nil, fmt.Errorf("building tarball: %w", err)
	}
	tarball := buf.Bytes()
	sum := sha256.Sum256(tarball)
	checksum := fmt.Sprintf("sha256:%x", sum)
	sp.Stop(true, fmt.Sprintf("%d KB packed  ·  %s…", len(tarball)/1024, checksum[7:19]))

	// 2. Bind port
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("could not bind local port: %w", err)
	}
	addr    := ln.Addr().String()
	baseURL := "http://" + addr

	// 3. Build registry JSON
	sp2 := ui.NewSpinner("Assembling registry manifest…")
	sp2.Start()
	downloadURL := fmt.Sprintf("%s/pkg/%s.tar.gz", baseURL, m.Package.Name)
	entry := buildIndexEntry(m, downloadURL, checksum)
	idx := v2.PackageIndex{SchemaVersion: 2, Packages: []v2.IndexEntry{entry}}
	ki  := buildKeyIndex(m)
	sp2.Stop(true, "packages.json + tsuki-keys.json ready")

	// 4. Print summary
	printRegistrySummary(m, addr, &entry, &ki)

	// 5. Start server
	s := &sandboxServer{
		m: m, addr: addr, tarball: tarball, checksum: checksum, idx: idx, ki: ki,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/packages.json",   cors(s.servePackages))
	mux.HandleFunc("/tsuki-keys.json", cors(s.serveKeys))
	mux.HandleFunc("/pkg/",           cors(s.serveTarball))
	s.srv = &http.Server{Handler: mux}
	go s.srv.Serve(ln) //nolint:errcheck

	return s, nil
}

func (s *sandboxServer) stop() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = s.srv.Shutdown(ctx)
}

func (s *sandboxServer) url() string { return "http://" + s.addr }

// cors wraps a handler and injects the headers Tauri's webview requires.
// Without these the browser same-origin policy blocks every fetch() call.
func cors(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, r)
	}
}

// ── HTTP handlers ──────────────────────────────────────────────────────────────

func (s *sandboxServer) servePackages(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.Encode(s.idx) //nolint:errcheck
}

func (s *sandboxServer) serveKeys(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.Encode(s.ki) //nolint:errcheck
}

func (s *sandboxServer) serveTarball(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(s.tarball)))
	w.Header().Set("X-Checksum", s.checksum)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(s.tarball)
}

// ── Registry construction ─────────────────────────────────────────────────────

// buildIndexEntry assembles a schema-v2 IndexEntry from the manifest,
// filling every field the IDE Plugin Manager and CLI rely on.
func buildIndexEntry(m *DkManifest, downloadURL, checksum string) v2.IndexEntry {
	entry := v2.IndexEntry{
		Name:          m.Package.Name,
		Owner:         m.Package.Author,
		Type:          v2.PkgType(m.Package.Type),
		Description:   m.Package.Description,
		Repository:    m.Package.Repository,
		LatestVersion: m.Package.Version,
		Versions: []v2.Version{
			{
				Version:   m.Package.Version,
				URL:       downloadURL,
				Checksum:  checksum,
				Signature: "local-dev-no-sig", // CLI skips Ed25519 for 127.0.0.1
			},
		},
	}
	if m.IdePlugin != nil {
		entry.Permissions = m.IdePlugin.Permissions
		entry.Slots       = m.IdePlugin.Slots
		if len(m.IdePlugin.SettingsSchema) > 0 {
			defs := make([]v2.PluginSettingDef, 0, len(m.IdePlugin.SettingsSchema))
			for _, s := range m.IdePlugin.SettingsSchema {
				defs = append(defs, v2.PluginSettingDef{
					Key:         s.Key,
					Label:       s.Label,
					Description: s.Description,
					Type:        s.Type,
					Options:     s.Options,
				})
			}
			entry.SettingsSchema = defs
		}
	}
	return entry
}

// buildKeyIndex constructs a schema-v2 KeyIndex for the package author.
// If the author has a real Ed25519 public key in ~/.tsuki/keys/ it is used;
// otherwise a clearly-labelled placeholder is inserted so the JSON stays valid.
func buildKeyIndex(m *DkManifest) v2.KeyIndex {
	signerName := m.Package.Author
	if m.Package.Signing.Key != "" {
		signerName = m.Package.Signing.Key
	}

	pubKey  := loadPublicKeyString(signerName)
	isReal  := pubKey != ""
	if !isReal {
		pubKey = "ed25519:local-dev-placeholder-not-a-real-key-" + signerName
	}

	role := "local-dev"
	if isReal { role = "contributor" }
	displayName := m.Package.Author
	if !isReal { displayName += " (local dev)" }

	entry := v2.KeyEntry{
		PublicKey:   pubKey,
		DisplayName: displayName,
		Bio:         m.Package.Description,
		Role:        role,
		AddedAt:     time.Now(),
	}
	if m.Package.Repository != "" {
		entry.Website = m.Package.Repository
	}

	return v2.KeyIndex{
		SchemaVersion: 2,
		Signers:       map[string]v2.KeyEntry{signerName: entry},
	}
}

// loadPublicKeyString reads ~/.tsuki/keys/<n>.pub.pem and returns
// "ed25519:<base64>", or "" if the file is absent or unparseable.
func loadPublicKeyString(name string) string {
	data, err := os.ReadFile(filepath.Join(tsukiKeysDir(), name+".pub.pem"))
	if err != nil { return "" }
	block, _ := pem.Decode(data)
	if block == nil { return "" }
	return "ed25519:" + base64.StdEncoding.EncodeToString(block.Bytes)
}

// ── Pretty-print summary ──────────────────────────────────────────────────────

func printRegistrySummary(m *DkManifest, addr string, entry *v2.IndexEntry, ki *v2.KeyIndex) {
	signerName := m.Package.Author
	if m.Package.Signing.Key != "" { signerName = m.Package.Signing.Key }
	signer    := ki.Signers[signerName]
	isRealKey := !strings.Contains(signer.PublicKey, "local-dev-placeholder")

	// Package table
	pkgFields := []ui.ConfigEntry{
		{Key: "id",      Value: m.Package.Author + "/" + m.Package.Name},
		{Key: "type",    Value: string(entry.Type)},
		{Key: "version", Value: m.Package.Version},
		{Key: "url",     Value: "http://" + addr},
	}
	if m.Package.Description != "" {
		pkgFields = append(pkgFields, ui.ConfigEntry{Key: "description", Value: m.Package.Description})
	}
	if len(entry.Permissions) > 0 {
		pkgFields = append(pkgFields, ui.ConfigEntry{Key: "permissions", Value: strings.Join(entry.Permissions, ", ")})
	}
	if len(entry.Slots) > 0 {
		pkgFields = append(pkgFields, ui.ConfigEntry{Key: "slots", Value: strings.Join(entry.Slots, ", ")})
	}
	ui.PrintConfig("Package", pkgFields, false)

	// Signer table
	keyDesc := "Ed25519 public key loaded"
	if !isRealKey {
		keyDesc = "placeholder  (run: tsuki-dk key generate " + signerName + ")"
	}
	ui.PrintConfig("Signer", []ui.ConfigEntry{
		{Key: "name", Value: signerName},
		{Key: "role", Value: signer.Role},
		{Key: "key",  Value: keyDesc},
	}, false)

	// Endpoint list
	tarName := m.Package.Name + ".tar.gz"
	ui.Box("Endpoints",
		"GET  /packages.json       packages index  (schema v2)\n"+
			"GET  /tsuki-keys.json    key index       (schema v2)\n"+
			"GET  /pkg/"+tarName+"  package tarball",
	)

	ui.SectionEnd()
}

// ── Tarball builder ───────────────────────────────────────────────────────────

func buildTarball(w io.Writer) error {
	gw := gzip.NewWriter(w)
	tw := tar.NewWriter(gw)
	pkgName := filepath.Base(mustAbs("."))

	skip := map[string]bool{
		".tsuki-dk": true, ".git": true,
		"target": true, "node_modules": true,
	}

	err := filepath.WalkDir(".", func(path string, d os.DirEntry, err error) error {
		if err != nil { return err }
		if d.IsDir() {
			if skip[d.Name()] { return filepath.SkipDir }
			return nil
		}
		info, err := d.Info()
		if err != nil { return err }
		hdr, err := tar.FileInfoHeader(info, "")
		if err != nil { return err }
		hdr.Name = pkgName + "/" + filepath.ToSlash(path)
		if err := tw.WriteHeader(hdr); err != nil { return err }
		f, err := os.Open(path)
		if err != nil { return err }
		defer f.Close()
		_, err = io.Copy(tw, f)
		return err
	})
	if err != nil { return err }
	if err := tw.Close(); err != nil { return err }
	return gw.Close()
}

func mustAbs(p string) string { abs, _ := filepath.Abs(p); return abs }

// ── Source injection ──────────────────────────────────────────────────────────

// injectSandboxSource writes sources.json so the sandbox shell's tsuki CLI
// finds the local server as its highest-priority package source.
func injectSandboxSource(sandboxDataDir, serverURL string) error {
	type sourceList struct {
		Sources []v2.Source `json:"sources"`
	}
	sl := sourceList{Sources: []v2.Source{{
		URL:      serverURL,
		AddedAt:  time.Now(),
		Priority: 0,
	}}}
	data, err := json.MarshalIndent(sl, "", "  ")
	if err != nil { return err }
	if err := os.MkdirAll(sandboxDataDir, 0755); err != nil { return err }
	return os.WriteFile(filepath.Join(sandboxDataDir, "sources.json"), data, 0644)
}

// platform returns the current platform key ("x86_64-windows" etc.)
func platform() string {
	arch := runtime.GOARCH
	if arch == "amd64" { arch = "x86_64" }
	switch runtime.GOOS {
	case "windows": return arch + "-windows"
	case "darwin":  return arch + "-macos"
	default:        return arch + "-linux"
	}
}