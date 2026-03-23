// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-dk :: publish  —  pack, sign, and push to a registry source
//
//  Flow:
//    1. Load tsuki.toml
//    2. Build + test
//    3. Create tarball (or per-platform binaries for app)
//    4. SHA-256 each artifact
//    5. Sign each checksum with the private key in ~/.tsuki/keys/<key>.pem
//    6. Upload artifacts to GitHub Releases (or custom URL)
//    7. Update packages.json in the source registry
// ─────────────────────────────────────────────────────────────────────────────

package dk

import (
	"archive/tar"
	"compress/gzip"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/spf13/cobra"
	v2 "github.com/tsuki/cli/internal/pkgmgr/v2"
	"github.com/tsuki/cli/internal/ui"
)

func newPublishCmd() *cobra.Command {
	var dryRun    bool
	var bumpPart  string
	var skipBuild bool
	var skipTests bool

	cmd := &cobra.Command{
		Use:   "publish",
		Short: "Pack, sign, and publish the current package",
		Long: `Build, test, sign, and push the current package to your registry.

Requires:
  - A signing key in ~/.tsuki/keys/<key-name>.pem  (create with: tsuki-dk key generate)
  - The [package.signing] key field set in tsuki.toml
  - A configured registry source (set TSUKI_DK_REGISTRY or run tsuki-dk registry init)`,
		Example: `  tsuki-dk publish
  tsuki-dk publish --dry-run
  tsuki-dk publish --bump minor
  tsuki-dk publish --skip-tests`,
		RunE: func(cmd *cobra.Command, args []string) error {
			m, err := loadManifest(".")
			if err != nil {
				return err
			}

			if bumpPart != "" {
				m.Package.Version, err = bumpVersion(m.Package.Version, bumpPart)
				if err != nil {
					return err
				}
				ui.Info(fmt.Sprintf("Bumped version to %s", m.Package.Version))
			}

			return publish(m, dryRun, skipBuild, skipTests)
		},
	}

	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "simulate without uploading")
	cmd.Flags().StringVar(&bumpPart, "bump", "", "bump version: major | minor | patch")
	cmd.Flags().BoolVar(&skipBuild, "skip-build", false, "skip build step")
	cmd.Flags().BoolVar(&skipTests, "skip-tests", false, "skip tests")
	return cmd
}

func publish(m *DkManifest, dry, skipBuild, skipTests bool) error {
	ui.SectionTitle(fmt.Sprintf("Publishing %s v%s", m.Package.Name, m.Package.Version))
	fmt.Println()

	// ── 1. Build ──────────────────────────────────────────────────────────
	if !skipBuild {
		if err := buildPackage(m); err != nil {
			return err
		}
	}

	// ── 2. Test ───────────────────────────────────────────────────────────
	if !skipTests {
		if err := testPackage(m); err != nil {
			return err
		}
	}

	// ── 3. Load signing key ───────────────────────────────────────────────
	keyName := m.Package.Signing.Key
	if keyName == "" {
		return fmt.Errorf("tsuki.toml: [package.signing] key is not set\n  Run: tsuki-dk key generate <name>")
	}
	privKey, err := loadPrivateKey(keyName)
	if err != nil {
		return err
	}

	// ── 4. Pack & sign ────────────────────────────────────────────────────
	var assets []publishedAsset

	if m.Package.Type == "app" {
		assets, err = packApp(m, privKey, dry)
	} else {
		assets, err = packTarball(m, privKey, dry)
	}
	if err != nil {
		return err
	}

	// ── 5. Update packages.json ───────────────────────────────────────────
	if err := updateRegistryIndex(m, assets, dry); err != nil {
		return err
	}

	// ── 6. Persist bumped version ─────────────────────────────────────────
	if !dry {
		if err := saveManifestVersion(m); err != nil {
			return fmt.Errorf("saving version: %w", err)
		}
	}

	fmt.Println()
	if dry {
		ui.Note("Dry run — nothing was uploaded")
	} else {
		ui.Success(fmt.Sprintf("Published %s/%s@%s", m.Package.Author, m.Package.Name, m.Package.Version))
	}
	return nil
}

// publishedAsset holds the result of packing one artifact.
type publishedAsset struct {
	Platform  string // "" for non-app types
	URL       string
	Checksum  string // "sha256:<hex>"
	Signature string // base64 Ed25519
}

// ── Tarball packing ───────────────────────────────────────────────────────────

func packTarball(m *DkManifest, privKey ed25519.PrivateKey, dry bool) ([]publishedAsset, error) {
	outName := fmt.Sprintf("%s-%s.tar.gz", m.Package.Name, m.Package.Version)
	outPath := filepath.Join(".tsuki-dk", "build", outName)
	if err := os.MkdirAll(filepath.Dir(outPath), 0755); err != nil {
		return nil, err
	}

	sp := ui.NewSpinner(fmt.Sprintf("Packing %s…", outName))
	sp.Start()

	if err := createTarGz(outPath, "."); err != nil {
		sp.Stop(false, "packing failed")
		return nil, err
	}
	sp.Stop(true, outName)

	data, err := os.ReadFile(outPath)
	if err != nil {
		return nil, err
	}

	checksum, sig, err := checksumAndSign(data, privKey)
	if err != nil {
		return nil, err
	}

	uploadURL, err := uploadArtifact(outPath, m, dry)
	if err != nil {
		return nil, err
	}

	return []publishedAsset{{URL: uploadURL, Checksum: checksum, Signature: sig}}, nil
}

// ── App packing (multi-platform) ──────────────────────────────────────────────

var appPlatforms = []struct{ goos, goarch, rustTarget, key string }{
	{"windows", "amd64", "x86_64-pc-windows-msvc", "x86_64-windows"},
	{"linux", "amd64", "x86_64-unknown-linux-gnu", "x86_64-linux"},
	{"linux", "arm64", "aarch64-unknown-linux-gnu", "aarch64-linux"},
	{"darwin", "amd64", "x86_64-apple-darwin", "x86_64-macos"},
	{"darwin", "arm64", "aarch64-apple-darwin", "aarch64-macos"},
}

func packApp(m *DkManifest, privKey ed25519.PrivateKey, dry bool) ([]publishedAsset, error) {
	var assets []publishedAsset
	buildDir := filepath.Join(".tsuki-dk", "build")
	if err := os.MkdirAll(buildDir, 0755); err != nil {
		return nil, err
	}

	isRust := fileExists("Cargo.toml")

	for _, plat := range appPlatforms {
		ext := ""
		if plat.goos == "windows" {
			ext = ".exe"
		}
		binName := fmt.Sprintf("%s-%s%s", m.Package.Name, plat.key, ext)
		binPath := filepath.Join(buildDir, binName)

		b := ui.NewLiveBlock(fmt.Sprintf("build %s", plat.key))
		b.Start()

		var out string
		var buildErr error

		if isRust {
			out, buildErr = runCapture("cargo", "build", "--release",
				"--target", plat.rustTarget)
			if buildErr == nil {
				// Copy binary from target/
				src := filepath.Join("target", plat.rustTarget, "release", m.Package.Name+ext)
				buildErr = copyFile(src, binPath)
			}
		} else {
			env := append(os.Environ(),
				"GOOS="+plat.goos,
				"GOARCH="+plat.goarch,
				"CGO_ENABLED=0",
			)
			cmd := exec.Command("go", "build", "-o", binPath, "./cmd/...")
			cmd.Env = env
			var o []byte
			o, buildErr = cmd.CombinedOutput()
			out = string(o)
		}

		if buildErr != nil {
			b.Line(out)
			b.Finish(false, fmt.Sprintf("failed: %s", plat.key))
			// Non-fatal: skip unsupported platforms
			ui.Warn(fmt.Sprintf("skipping %s: %v", plat.key, buildErr))
			continue
		}
		b.Finish(true, plat.key)

		data, err := os.ReadFile(binPath)
		if err != nil {
			return nil, err
		}

		checksum, sig, err := checksumAndSign(data, privKey)
		if err != nil {
			return nil, err
		}

		uploadURL, err := uploadArtifact(binPath, m, dry)
		if err != nil {
			return nil, err
		}

		assets = append(assets, publishedAsset{
			Platform:  plat.key,
			URL:       uploadURL,
			Checksum:  checksum,
			Signature: sig,
		})
	}

	if len(assets) == 0 {
		return nil, fmt.Errorf("no platforms built successfully")
	}
	return assets, nil
}

// ── Registry update ───────────────────────────────────────────────────────────

func updateRegistryIndex(m *DkManifest, assets []publishedAsset, dry bool) error {
	registryDir := os.Getenv("TSUKI_DK_REGISTRY")
	if registryDir == "" {
		registryDir = filepath.Join(".tsuki-dk", "registry")
	}

	pkgPath := filepath.Join(registryDir, "packages.json")
	var idx v2.PackageIndex

	if data, err := os.ReadFile(pkgPath); err == nil {
		_ = json.Unmarshal(data, &idx)
	}

	// Build new version entry
	ver := v2.Version{Version: m.Package.Version}

	if m.Package.Type == "app" {
		ver.Binaries = make(map[string]v2.BinaryAsset)
		for _, a := range assets {
			ver.Binaries[a.Platform] = v2.BinaryAsset{
				URL:       a.URL,
				Checksum:  a.Checksum,
				Signature: a.Signature,
			}
		}
	} else {
		ver.URL = assets[0].URL
		ver.Checksum = assets[0].Checksum
		ver.Signature = assets[0].Signature
	}

	// Upsert package entry
	found := false
	for i, p := range idx.Packages {
		if p.Owner == m.Package.Author && p.Name == m.Package.Name {
			// Remove old version entry if same version
			filtered := p.Versions[:0]
			for _, v := range p.Versions {
				if v.Version != m.Package.Version {
					filtered = append(filtered, v)
				}
			}
			idx.Packages[i].Versions = append(filtered, ver)
			found = true
			break
		}
	}
	if !found {
		idx.Packages = append(idx.Packages, v2.IndexEntry{
			Name:     m.Package.Name,
			Owner:    m.Package.Author,
			Type:     v2.PkgType(m.Package.Type),
			Versions: []v2.Version{ver},
		})
	}

	if dry {
		ui.Note(fmt.Sprintf("[dry-run] would update %s", pkgPath))
		return nil
	}

	if err := os.MkdirAll(registryDir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(idx, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(pkgPath, data, 0644); err != nil {
		return err
	}
	ui.Success(fmt.Sprintf("Updated %s", pkgPath))
	return nil
}

// ── Crypto helpers ────────────────────────────────────────────────────────────

func checksumAndSign(data []byte, key ed25519.PrivateKey) (checksum, signature string, err error) {
	h := sha256.Sum256(data)
	checksum = fmt.Sprintf("sha256:%x", h)
	sig := ed25519.Sign(key, []byte(checksum))
	signature = base64.StdEncoding.EncodeToString(sig)
	return
}

func loadPrivateKey(name string) (ed25519.PrivateKey, error) {
	home, _ := os.UserHomeDir()
	path := filepath.Join(home, ".tsuki", "keys", name+".pem")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("private key %q not found at %s\n  Run: tsuki-dk key generate %s", name, path, name)
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

// ── Tar.gz creation ───────────────────────────────────────────────────────────

var excludeDirs = map[string]bool{
	".tsuki-dk": true, ".git": true, "target": true, "node_modules": true,
}

func createTarGz(outPath, srcDir string) error {
	f, err := os.Create(outPath)
	if err != nil {
		return err
	}
	defer f.Close()

	gw := gzip.NewWriter(f)
	defer gw.Close()
	tw := tar.NewWriter(gw)
	defer tw.Close()

	return filepath.WalkDir(srcDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(srcDir, path)
		if rel == "." {
			return nil
		}
		// Exclude dirs
		top := strings.SplitN(rel, string(os.PathSeparator), 2)[0]
		if excludeDirs[top] {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		hdr, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		hdr.Name = filepath.ToSlash(rel)

		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()
		_, err = io.Copy(tw, file)
		return err
	})
}

// ── Upload ────────────────────────────────────────────────────────────────────

func uploadArtifact(path string, m *DkManifest, dry bool) (string, error) {
	tag := "v" + m.Package.Version
	filename := filepath.Base(path)

	if dry {
		fakeURL := fmt.Sprintf("https://github.com/%s/%s/releases/download/%s/%s",
			m.Package.Author, m.Package.Name, tag, filename)
		ui.Note(fmt.Sprintf("[dry-run] would upload %s → %s", filename, fakeURL))
		return fakeURL, nil
	}

	// Use gh CLI if available
	if gh, err := exec.LookPath("gh"); err == nil {
		sp := ui.NewSpinner(fmt.Sprintf("Uploading %s…", filename))
		sp.Start()
		out, err := runCapture(gh, "release", "upload", tag, path, "--clobber")
		if err != nil {
			sp.Stop(false, "upload failed")
			return "", fmt.Errorf("gh release upload failed:\n%s", out)
		}
		sp.Stop(true, filename)

		return fmt.Sprintf("https://github.com/%s/%s/releases/download/%s/%s",
			m.Package.Author, m.Package.Name, tag, filename), nil
	}

	return "", fmt.Errorf("gh CLI not found — install GitHub CLI to upload releases\n  https://cli.github.com")
}

// ── Misc helpers ──────────────────────────────────────────────────────────────

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func bumpVersion(v, part string) (string, error) {
	v = strings.TrimPrefix(v, "v")
	parts := strings.SplitN(v, ".", 3)
	for len(parts) < 3 {
		parts = append(parts, "0")
	}
	parse := func(s string) int {
		n := 0
		for _, c := range s {
			if c >= '0' && c <= '9' {
				n = n*10 + int(c-'0')
			}
		}
		return n
	}
	major, minor, patch := parse(parts[0]), parse(parts[1]), parse(parts[2])
	switch part {
	case "major":
		major++
		minor, patch = 0, 0
	case "minor":
		minor++
		patch = 0
	case "patch":
		patch++
	default:
		return "", fmt.Errorf("unknown bump part %q (use: major, minor, patch)", part)
	}
	return fmt.Sprintf("%d.%d.%d", major, minor, patch), nil
}

// currentPlatformKey returns the key used in [app.binaries] for the current host.
func currentPlatformKey() string {
	os_ := runtime.GOOS
	arch := runtime.GOARCH
	if arch == "amd64" {
		arch = "x86_64"
	}
	return arch + "-" + os_
}

// Key generation is in key.go; referenced here via loadPrivateKey.
var _ = rand.Reader // ensure crypto/rand is used