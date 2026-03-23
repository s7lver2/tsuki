// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: pkgmgr/v2 :: install  —  download, verify, extract and install
// ─────────────────────────────────────────────────────────────────────────────

package v2

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// ── Public API ────────────────────────────────────────────────────────────────

// InstallOptions controls an install operation.
type InstallOptions struct {
	Ref     PackageRef
	Verbose bool
	Force   bool // reinstall even if already at that version
}

// Install resolves, downloads, verifies, and installs a package.
func Install(opts InstallOptions) (*InstalledEntry, error) {
	// ── 1. Resolve from indexes ───────────────────────────────────────────
	entries, err := FetchAllIndexes()
	if err != nil {
		return nil, fmt.Errorf("fetching indexes: %w", err)
	}

	entry, ver, err := Resolve(opts.Ref, entries)
	if err != nil {
		return nil, err
	}

	// ── 2. Check if already installed ────────────────────────────────────
	if !opts.Force {
		if existing, err := FindInstalled(entry.FullName()); err == nil {
			if existing.Version == ver.Version {
				return existing, ErrAlreadyInstalled
			}
		}
	}

	// ── 3. Download & verify ──────────────────────────────────────────────
	var data []byte
	var destPath string

	switch entry.Type {
	case TypeApp:
		data, destPath, err = downloadApp(entry, ver, opts.Verbose)
	default:
		data, err = downloadTarball(entry, ver, opts.Verbose)
	}
	if err != nil {
		return nil, err
	}

	// ── 4. Install ────────────────────────────────────────────────────────
	var installPath string
	switch entry.Type {
	case TypeApp:
		installPath, err = installApp(entry, ver, data, destPath)
	case TypeLibrary:
		installPath, err = installTarball(entry, ver, data, libsInstallDir())
	case TypeBoardPack:
		installPath, err = installTarball(entry, ver, data, boardsInstallDir())
	case TypeIdePlugin:
		installPath, err = installTarball(entry, ver, data, pluginsInstallDir())
	case TypeSdkPatch:
		installPath, err = installSdkPatch(entry, ver, data)
	default:
		return nil, fmt.Errorf("unknown package type %q", entry.Type)
	}
	if err != nil {
		return nil, err
	}

	// ── 5. Record installation ────────────────────────────────────────────
	installed := &InstalledEntry{
		Owner:       entry.Owner,
		Name:        entry.Name,
		Version:     ver.Version,
		Type:        entry.Type,
		Path:        installPath,
		InstalledAt: time.Now(),
	}
	if err := recordInstalled(installed); err != nil {
		return nil, err
	}
	return installed, nil
}

// Remove uninstalls a package by full name ("owner/name").
func Remove(fullName string) error {
	entry, err := FindInstalled(fullName)
	if err != nil {
		return err
	}
	if err := os.RemoveAll(entry.Path); err != nil {
		return fmt.Errorf("removing files: %w", err)
	}
	return removeInstalled(fullName)
}

// FindInstalled returns the installed record for "owner/name".
func FindInstalled(fullName string) (*InstalledEntry, error) {
	all, err := ListInstalled()
	if err != nil {
		return nil, err
	}
	for i := range all {
		if all[i].FullName() == fullName {
			return &all[i], nil
		}
		// Also match by name alone when unambiguous
		if all[i].Name == fullName {
			return &all[i], nil
		}
	}
	return nil, fmt.Errorf("package %q is not installed", fullName)
}

// ListInstalled returns all installed packages.
func ListInstalled() ([]InstalledEntry, error) {
	data, err := os.ReadFile(installedDBPath())
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var entries []InstalledEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return nil, fmt.Errorf("installed.json malformed: %w", err)
	}
	return entries, nil
}

// ErrAlreadyInstalled is returned when the requested version is already present.
var ErrAlreadyInstalled = fmt.Errorf("already installed")

// ── App installation ──────────────────────────────────────────────────────────

func downloadApp(entry *IndexEntry, ver *Version, verbose bool) ([]byte, string, error) {
	platform := currentPlatform()
	asset, ok := ver.Binaries[platform]
	if !ok {
		// Try fallback platform keys
		for _, fallback := range platformFallbacks(platform) {
			if a, found := ver.Binaries[fallback]; found {
				asset = a
				ok = true
				break
			}
		}
	}
	if !ok {
		available := make([]string, 0, len(ver.Binaries))
		for k := range ver.Binaries {
			available = append(available, k)
		}
		return nil, "", fmt.Errorf(
			"no binary for platform %q\n  available: %s",
			platform, strings.Join(available, ", "),
		)
	}

	if verbose {
		fmt.Fprintf(os.Stderr, "  downloading %s\n", asset.URL)
	}

	data, err := httpGet(asset.URL)
	if err != nil {
		return nil, "", fmt.Errorf("download failed: %w", err)
	}

	if err := VerifyAsset(data, asset.Checksum, asset.Signature, entry.Owner); err != nil {
		return nil, "", fmt.Errorf("verification failed: %w", err)
	}

	return data, "", nil
}

func installApp(entry *IndexEntry, ver *Version, data []byte, _ string) (string, error) {
	dir := appsInstallDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}

	binName := entry.Name
	if runtime.GOOS == "windows" {
		binName += ".exe"
	}
	binPath := filepath.Join(dir, binName)

	// Write to a temp file first then rename (atomic on most OSes)
	tmp := binPath + ".tmp"
	if err := os.WriteFile(tmp, data, 0755); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, binPath); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	return binPath, nil
}

// ── Tarball installation ──────────────────────────────────────────────────────

func downloadTarball(entry *IndexEntry, ver *Version, verbose bool) ([]byte, error) {
	if ver.URL == "" {
		return nil, fmt.Errorf("version %s of %s has no download URL", ver.Version, entry.FullName())
	}
	if verbose {
		fmt.Fprintf(os.Stderr, "  downloading %s\n", ver.URL)
	}
	data, err := httpGet(ver.URL)
	if err != nil {
		return nil, fmt.Errorf("download failed: %w", err)
	}
	if err := VerifyAsset(data, ver.Checksum, ver.Signature, entry.Owner); err != nil {
		return nil, fmt.Errorf("verification failed: %w", err)
	}
	return data, nil
}

func installTarball(entry *IndexEntry, ver *Version, data []byte, baseDir string) (string, error) {
	dest := filepath.Join(baseDir, entry.Owner, entry.Name, ver.Version)
	if err := os.MkdirAll(dest, 0755); err != nil {
		return "", err
	}
	if err := extractTarGz(data, dest); err != nil {
		return "", fmt.Errorf("extraction failed: %w", err)
	}
	return dest, nil
}

func installSdkPatch(_ *IndexEntry, _ *Version, _ []byte) (string, error) {
	// SDK patches require knowing which app they target — handled separately.
	// For now, store the patch files alongside other packages.
	return "", fmt.Errorf("sdk-patch installation not yet implemented")
}

// ── tar.gz extraction ─────────────────────────────────────────────────────────

func extractTarGz(data []byte, dest string) error {
	gr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("not a gzip archive: %w", err)
	}
	defer gr.Close()

	tr := tar.NewReader(gr)
	var prefix string // top-level directory to strip

	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		// Strip top-level directory component (like --strip-components=1)
		name := hdr.Name
		if prefix == "" {
			if idx := strings.Index(name, "/"); idx != -1 {
				prefix = name[:idx+1]
			}
		}
		if prefix != "" {
			name = strings.TrimPrefix(name, prefix)
		}
		if name == "" {
			continue
		}

		target := filepath.Join(dest, filepath.FromSlash(name))
		// Guard against path traversal
		if !strings.HasPrefix(target, filepath.Clean(dest)+string(os.PathSeparator)) {
			return fmt.Errorf("invalid path in archive: %s", hdr.Name)
		}

		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return err
			}
			f, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, hdr.FileInfo().Mode())
			if err != nil {
				return err
			}
			if _, err := io.Copy(f, tr); err != nil {
				f.Close()
				return err
			}
			f.Close()
		}
	}
	return nil
}

// ── Installed DB ──────────────────────────────────────────────────────────────

func recordInstalled(entry *InstalledEntry) error {
	all, _ := ListInstalled()
	// Remove any existing record for this package
	filtered := all[:0]
	for _, e := range all {
		if e.FullName() != entry.FullName() {
			filtered = append(filtered, e)
		}
	}
	filtered = append(filtered, *entry)
	return saveInstalled(filtered)
}

func removeInstalled(fullName string) error {
	all, _ := ListInstalled()
	filtered := all[:0]
	for _, e := range all {
		if e.FullName() != fullName {
			filtered = append(filtered, e)
		}
	}
	return saveInstalled(filtered)
}

func saveInstalled(entries []InstalledEntry) error {
	if err := os.MkdirAll(filepath.Dir(installedDBPath()), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(installedDBPath(), data, 0644)
}

// ── Platform detection ────────────────────────────────────────────────────────

func currentPlatform() string {
	os_ := runtime.GOOS
	arch := runtime.GOARCH
	if arch == "amd64" {
		arch = "x86_64"
	}
	return arch + "-" + os_
}

func platformFallbacks(platform string) []string {
	// Allow matching without arch for simple cases
	parts := strings.SplitN(platform, "-", 2)
	if len(parts) == 2 {
		return []string{parts[1]} // just the OS
	}
	return nil
}

// ── Install paths ─────────────────────────────────────────────────────────────

func appsInstallDir() string {
	return filepath.Join(tsukiDataDir(), "bin")
}

func libsInstallDir() string {
	if env := os.Getenv("TSUKI_LIBS"); env != "" {
		return env
	}
	return filepath.Join(tsukiDataDir(), "libs")
}

func boardsInstallDir() string {
	return filepath.Join(tsukiDataDir(), "boards")
}

func pluginsInstallDir() string {
	return filepath.Join(tsukiDataDir(), "plugins")
}

func installedDBPath() string {
	return filepath.Join(tsukiDataDir(), "installed.json")
}