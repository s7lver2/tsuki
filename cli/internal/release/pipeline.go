// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-dk :: internal/release/pipeline  —  build → compress → sign → publish
//
//  New flags vs the original tsuki-release tool:
//
//    --no-upload      Sign and hash artifacts locally but skip the GitHub
//                     Release upload step. The registry index is still updated
//                     with the local file path so you can inspect what would
//                     be published.
//
//    --no-compression Skip the UPX binary compression step that runs after
//                     each Go / Cargo binary is built. Useful when UPX is not
//                     installed or when building debug binaries.
//
//  Binary compression:
//    After a binary is compiled successfully, the pipeline attempts to run
//    `upx --best --lzma <binary>` to further shrink the output. If UPX is
//    not found in PATH the step is skipped with a warning (never a hard
//    failure). --no-compression disables this entirely.
// ─────────────────────────────────────────────────────────────────────────────

package release

import (
	"archive/tar"
	"compress/gzip"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/tsuki/cli/internal/ui"
)

// ── Platforms ─────────────────────────────────────────────────────────────────

type platform struct {
	GOOS       string
	GOARCH     string
	RustTarget string
	Key        string
}

var appPlatforms = []platform{
	{"windows", "amd64", "x86_64-pc-windows-msvc",    "x86_64-windows"},
	{"linux",   "amd64", "x86_64-unknown-linux-gnu",   "x86_64-linux"},
	{"linux",   "arm64", "aarch64-unknown-linux-gnu",  "aarch64-linux"},
	{"darwin",  "amd64", "x86_64-apple-darwin",        "x86_64-macos"},
	{"darwin",  "arm64", "aarch64-apple-darwin",        "aarch64-macos"},
}

// ── Result ────────────────────────────────────────────────────────────────────

type PublishedAsset struct {
	Platform  string
	URL       string
	Checksum  string // "sha256:<hex>"
	Signature string // base64 Ed25519 over checksum
}

// ── Entry point ───────────────────────────────────────────────────────────────

func RunRelease(cfg *Config, targets []Component, opts ReleaseOptions) error {
	privKey, err := LoadPrivateKey(cfg.Registry.Key)
	if err != nil {
		return err
	}

	idx, err := LoadPackageIndex(cfg)
	if err != nil {
		return err
	}

	fmt.Printf("\n  tsuki-dk  release\n")
	fmt.Printf("  registry  %s\n", cfg.Registry.Path)
	fmt.Printf("  key       %s\n", cfg.Registry.Key)
	if opts.DryRun {
		ui.Warn("dry-run mode — nothing will be uploaded or pushed")
	}
	if opts.NoUpload {
		ui.Note("--no-upload: artifacts will be signed locally, upload skipped")
	}
	if opts.NoCompression {
		ui.Note("--no-compression: UPX compression step disabled")
	}
	fmt.Println()

	workDir := filepath.Join(os.TempDir(), "tsuki-dk-release-"+timestamp())
	if err := os.MkdirAll(workDir, 0755); err != nil {
		return fmt.Errorf("creating work dir: %w", err)
	}
	defer os.RemoveAll(workDir)

	succeeded, failed := 0, 0

	for _, comp := range targets {
		err := releaseComponent(cfg, &comp, opts, privKey, idx, workDir)
		if err != nil {
			ui.Fail(fmt.Sprintf("  %s: %v", comp.Name, err))
			failed++
		} else {
			succeeded++
		}
		fmt.Println()
	}

	if !opts.DryRun && succeeded > 0 {
		if err := SavePackageIndex(cfg, idx); err != nil {
			return fmt.Errorf("saving packages.json: %w", err)
		}
		ui.Success("packages.json updated")
	}

	fmt.Println()
	fmt.Printf("  %d succeeded   %d failed\n\n", succeeded, failed)

	if !opts.DryRun && !opts.SkipPush && succeeded > 0 {
		if err := SyncRegistry(cfg, fmt.Sprintf("release: %d components (%s)",
			succeeded, time.Now().Format("2006-01-02"))); err != nil {
			ui.Warn("auto-sync failed: " + err.Error())
		}
	}

	if failed > 0 {
		return fmt.Errorf("%d component(s) failed", failed)
	}
	return nil
}

func releaseComponent(
	cfg *Config,
	comp *Component,
	opts ReleaseOptions,
	privKey ed25519.PrivateKey,
	idx *PackageIndex,
	workDir string,
) error {
	fmt.Printf("\n  %s  %s  [%s]\n", comp.Icon, comp.Name, comp.Type)

	// 1. Clone source
	srcDir, version, err := fetchSource(comp, cfg, workDir)
	if err != nil {
		return fmt.Errorf("fetch: %w", err)
	}

	// 2. Bump version
	if opts.Bump != "" {
		version, err = bumpVersion(version, opts.Bump)
		if err != nil {
			return err
		}
		ui.Note(fmt.Sprintf("  version bumped to %s", version))
	}

	// 3. Already published?
	if !opts.Force && idx.HasVersion(comp.Name, cfg.Registry.Owner, version) {
		ui.Note(fmt.Sprintf("  %s@%s already in registry — skipping (--force to override)",
			comp.Name, version))
		return nil
	}

	// 4. Build
	var assets []PublishedAsset
	if opts.SkipBuild {
		ui.Note("  skipping build (--skip-build)")
	} else {
		assets, err = buildComponent(comp, cfg, opts, privKey, srcDir, version)
		if err != nil {
			return fmt.Errorf("build: %w", err)
		}
	}

	// 5. Update registry index
	if !opts.DryRun {
		idx.Upsert(comp, cfg.Registry.Owner, version, assets)
	} else {
		ui.Note(fmt.Sprintf("  [dry-run] would index %s@%s", comp.Name, version))
	}

	ui.Success(fmt.Sprintf("  %s/%s@%s", cfg.Registry.Owner, comp.Name, version))
	return nil
}

// ── Source fetch ──────────────────────────────────────────────────────────────

func fetchSource(comp *Component, cfg *Config, workDir string) (srcDir, version string, err error) {
	repo := comp.FullRepo(cfg)
	destDir := filepath.Join(workDir, comp.Name)

	fmt.Printf("  fetch  %s\n", repo)

	cloneURL := fmt.Sprintf("https://github.com/%s.git", repo)
	out, err := RunCapture("git", "clone", "--depth=1", cloneURL, destDir)
	if err != nil {
		return "", "", fmt.Errorf("git clone %s:\n%s", repo, out)
	}

	srcDir = filepath.Join(destDir, comp.BuildDir)
	version, err = readVersion(comp, srcDir)
	if err != nil {
		return "", "", fmt.Errorf("reading version: %w", err)
	}

	fmt.Printf("  ok  %s → v%s\n", repo, version)
	return srcDir, version, nil
}

func readVersion(comp *Component, dir string) (string, error) {
	switch comp.BuildTool {
	case BuildCargo:
		return readCargoVersion(dir)
	case BuildGo, BuildTauri:
		if v, err := readGoModVersion(dir); err == nil {
			return v, nil
		}
		return readGitTag(dir)
	case BuildNpm:
		return readPackageJsonVersion(dir)
	case BuildNone:
		if v, err := readTsukiTomlVersion(dir); err == nil {
			return v, nil
		}
		return readGitTag(dir)
	}
	return readGitTag(dir)
}

func readCargoVersion(dir string) (string, error) {
	data, err := os.ReadFile(filepath.Join(dir, "Cargo.toml"))
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(data), "\n") {
		k, v, ok := ParseKV(strings.TrimSpace(line))
		if ok && k == "version" {
			return strings.TrimPrefix(v, "v"), nil
		}
	}
	return "", fmt.Errorf("version not found in Cargo.toml")
}

func readGoModVersion(dir string) (string, error) {
	out, err := RunCaptureDir(dir, "go", "list", "-m", "-f", "{{.Version}}")
	if err != nil {
		return "", err
	}
	v := strings.TrimSpace(out)
	if v == "" || v == "<nil>" {
		return "", fmt.Errorf("no version")
	}
	return strings.TrimPrefix(v, "v"), nil
}

func readPackageJsonVersion(dir string) (string, error) {
	data, err := os.ReadFile(filepath.Join(dir, "package.json"))
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, `"version"`) {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				v := strings.Trim(strings.TrimSpace(strings.TrimSuffix(parts[1], ",")), `"`)
				return strings.TrimPrefix(v, "v"), nil
			}
		}
	}
	return "", fmt.Errorf("version not found in package.json")
}

func readTsukiTomlVersion(dir string) (string, error) {
	data, err := os.ReadFile(filepath.Join(dir, "tsuki.toml"))
	if err != nil {
		return "", err
	}
	inPkg := false
	for _, line := range strings.Split(string(data), "\n") {
		t := strings.TrimSpace(line)
		if t == "[package]" { inPkg = true; continue }
		if strings.HasPrefix(t, "[") { inPkg = false }
		if inPkg {
			if k, v, ok := ParseKV(t); ok && k == "version" {
				return strings.TrimPrefix(v, "v"), nil
			}
		}
	}
	return "", fmt.Errorf("version not found in tsuki.toml")
}

func readGitTag(dir string) (string, error) {
	out, err := RunCaptureDir(dir, "git", "describe", "--tags", "--abbrev=0")
	if err != nil {
		return "0.0.1", nil
	}
	return strings.TrimPrefix(strings.TrimSpace(out), "v"), nil
}

// ── Build dispatcher ──────────────────────────────────────────────────────────

func buildComponent(
	comp *Component,
	cfg *Config,
	opts ReleaseOptions,
	privKey ed25519.PrivateKey,
	srcDir, version string,
) ([]PublishedAsset, error) {
	repo := comp.FullRepo(cfg)
	switch comp.Type {
	case "app":
		return buildApp(comp, cfg, opts, privKey, srcDir, version, repo)
	case "library", "sdk-patch", "ide-plugin":
		return buildTarball(comp, cfg, opts, privKey, srcDir, version, repo)
	default:
		return nil, fmt.Errorf("unknown component type %q", comp.Type)
	}
}

// ── App: multi-platform binaries ──────────────────────────────────────────────

func buildApp(
	comp *Component,
	cfg *Config,
	opts ReleaseOptions,
	privKey ed25519.PrivateKey,
	srcDir, version, repo string,
) ([]PublishedAsset, error) {
	if comp.BuildTool == BuildTauri {
		return buildTauriApp(comp, cfg, opts, privKey, srcDir, version, repo)
	}

	outDir := filepath.Join(srcDir, ".tsuki-release", "build")
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return nil, err
	}

	var assets []PublishedAsset

	for _, plat := range appPlatforms {
		ext := ""
		if plat.GOOS == "windows" {
			ext = ".exe"
		}
		installName := comp.InstallAs
		if installName == "" {
			installName = comp.Name
		}
		binName := fmt.Sprintf("%s-%s%s", installName, plat.Key, ext)
		binPath := filepath.Join(outDir, binName)

		fmt.Printf("  build  %s\n", plat.Key)

		var buildErr error
		var buildOut string

		switch comp.BuildTool {
		case BuildCargo:
			buildOut, buildErr = RunCaptureDir(srcDir,
				"cargo", "build", "--release", "--target", plat.RustTarget)
			if buildErr == nil {
				src := filepath.Join(srcDir, "target", plat.RustTarget, "release", installName+ext)
				buildErr = copyFile(src, binPath)
			}
		case BuildGo:
			env := append(os.Environ(),
				"GOOS="+plat.GOOS,
				"GOARCH="+plat.GOARCH,
				"CGO_ENABLED=0",
			)
			cmd := exec.Command("go", "build", "-trimpath",
				"-ldflags", fmt.Sprintf("-s -w -X main.Version=%s", version),
				"-o", binPath, comp.Entry)
			cmd.Dir = srcDir
			cmd.Env = env
			o, err := cmd.CombinedOutput()
			buildOut = string(o)
			buildErr = err
		}

		if buildErr != nil {
			fmt.Println(buildOut)
			ui.Warn(fmt.Sprintf("  skipping %s: %v", plat.Key, buildErr))
			continue
		}

		// ── UPX compression ───────────────────────────────────────────────────
		// Skip for Windows binaries when cross-compiling on non-Windows hosts
		// (UPX can compress Windows PE on Linux/macOS, but it's optional).
		// Always skip for Tauri bundles (they are installers, not raw ELFs).
		if !opts.NoCompression && plat.GOOS != "" {
			compressWithUPX(binPath, plat.Key)
		}

		data, err := os.ReadFile(binPath)
		if err != nil {
			return nil, err
		}
		checksum, sig, err := checksumAndSign(data, privKey)
		if err != nil {
			return nil, err
		}

		tag := "v" + version
		uploadURL, err := uploadAsset(binPath, repo, tag, opts)
		if err != nil {
			return nil, err
		}

		infoAfter, _ := os.Stat(binPath)
		if infoAfter != nil {
			fmt.Printf("  %s  ok  (%s)\n", plat.Key, HumanSize(infoAfter.Size()))
		}

		assets = append(assets, PublishedAsset{
			Platform:  plat.Key,
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

func buildTauriApp(
	comp *Component,
	cfg *Config,
	opts ReleaseOptions,
	privKey ed25519.PrivateKey,
	srcDir, version, repo string,
) ([]PublishedAsset, error) {
	fmt.Println("  tauri build...")
	out, err := RunCaptureDir(srcDir, "npx", "tauri", "build")
	if err != nil {
		fmt.Println(out)
		return nil, fmt.Errorf("tauri build: %w", err)
	}

	bundleDir := filepath.Join(srcDir, "src-tauri", "target", "release", "bundle")
	var assets []PublishedAsset

	_ = filepath.WalkDir(bundleDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".msi" && ext != ".appimage" && ext != ".dmg" && ext != ".deb" {
			return nil
		}

		platformKey := platformFromInstaller(path)
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil
		}

		checksum, sig, signErr := checksumAndSign(data, privKey)
		if signErr != nil {
			return nil
		}

		tag := "v" + version
		uploadURL, uploadErr := uploadAsset(path, repo, tag, opts)
		if uploadErr != nil {
			ui.Warn(fmt.Sprintf("  upload failed: %v", uploadErr))
			return nil
		}

		assets = append(assets, PublishedAsset{
			Platform:  platformKey,
			URL:       uploadURL,
			Checksum:  checksum,
			Signature: sig,
		})
		return nil
	})

	return assets, nil
}

func platformFromInstaller(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".msi":
		return "x86_64-windows"
	case ".dmg":
		if strings.Contains(path, "arm64") || strings.Contains(path, "aarch64") {
			return "aarch64-macos"
		}
		return "x86_64-macos"
	case ".appimage", ".deb":
		if strings.Contains(path, "arm64") || strings.Contains(path, "aarch64") {
			return "aarch64-linux"
		}
		return "x86_64-linux"
	}
	return runtime.GOARCH + "-" + runtime.GOOS
}

// ── Tarball: library / sdk-patch / ide-plugin ─────────────────────────────────

func buildTarball(
	comp *Component,
	cfg *Config,
	opts ReleaseOptions,
	privKey ed25519.PrivateKey,
	srcDir, version, repo string,
) ([]PublishedAsset, error) {
	outDir := filepath.Join(srcDir, ".tsuki-release")
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return nil, err
	}

	if comp.BuildTool == BuildNpm {
		fmt.Println("  npm install && build...")
		out, err := RunCaptureDir(srcDir, "npm", "install")
		if err != nil {
			return nil, fmt.Errorf("npm install: %s\n%s", err, out)
		}
		out, err = RunCaptureDir(srcDir, "npm", "run", "build")
		if err != nil {
			return nil, fmt.Errorf("npm build: %s\n%s", err, out)
		}
	}

	tarName := fmt.Sprintf("%s-%s.tar.gz", comp.Name, version)
	tarPath := filepath.Join(outDir, tarName)

	fmt.Printf("  pack  %s\n", tarName)

	if err := createTarGz(tarPath, srcDir); err != nil {
		return nil, fmt.Errorf("creating tarball: %w", err)
	}

	info, _ := os.Stat(tarPath)
	if info != nil {
		fmt.Printf("  ok  %s  (%s)\n", tarName, HumanSize(info.Size()))
	}

	data, err := os.ReadFile(tarPath)
	if err != nil {
		return nil, err
	}

	checksum, sig, err := checksumAndSign(data, privKey)
	if err != nil {
		return nil, err
	}

	tag := "v" + version
	uploadURL, err := uploadAsset(tarPath, repo, tag, opts)
	if err != nil {
		return nil, err
	}

	return []PublishedAsset{{
		URL:       uploadURL,
		Checksum:  checksum,
		Signature: sig,
	}}, nil
}

// ── UPX compression ───────────────────────────────────────────────────────────
//
// compressWithUPX attempts to run `upx --best --lzma` on the given binary.
// It is intentionally best-effort: if UPX is not installed or fails for any
// reason (e.g. the binary format is not supported), a warning is printed and
// the uncompressed binary is used as-is. This never blocks the release.

func compressWithUPX(binPath, platformKey string) {
	upxBin, err := exec.LookPath("upx")
	if err != nil {
		// UPX not available — skip silently (common on CI)
		ui.Note(fmt.Sprintf("  [upx] not found in PATH, skipping compression for %s", platformKey))
		return
	}

	infoBefore, _ := os.Stat(binPath)
	sizeBefore := int64(0)
	if infoBefore != nil {
		sizeBefore = infoBefore.Size()
	}

	fmt.Printf("  upx  compressing %s...\n", platformKey)
	out, err := RunCapture(upxBin, "--best", "--lzma", "--quiet", binPath)
	if err != nil {
		ui.Warn(fmt.Sprintf("  [upx] compression failed for %s (continuing with uncompressed binary): %v\n%s",
			platformKey, err, strings.TrimSpace(out)))
		return
	}

	infoAfter, _ := os.Stat(binPath)
	if infoAfter != nil && sizeBefore > 0 {
		ratio := float64(infoAfter.Size()) / float64(sizeBefore) * 100
		fmt.Printf("  upx  %s  %s → %s  (%.0f%%)\n",
			platformKey,
			HumanSize(sizeBefore),
			HumanSize(infoAfter.Size()),
			ratio)
	}
}

// ── Upload dispatch ───────────────────────────────────────────────────────────
//
// uploadAsset decides whether to upload to GitHub or skip based on flags.
// When --no-upload is set it returns the local file path as the URL so the
// registry index is still populated (useful for local testing / dry-run
// inspection without requiring a GITHUB_TOKEN).

func uploadAsset(filePath, repo, tag string, opts ReleaseOptions) (string, error) {
	if opts.DryRun || opts.NoUpload {
		label := "[dry-run]"
		if opts.NoUpload && !opts.DryRun {
			label = "[no-upload]"
		}
		absPath, _ := filepath.Abs(filePath)
		fmt.Printf("  %s  would upload %s to %s@%s\n",
			label, filepath.Base(filePath), repo, tag)
		// Return a local file:// URL so the index entry isn't empty
		return "file://" + filepath.ToSlash(absPath), nil
	}
	return UploadGitHubRelease(filePath, repo, tag)
}

// ── Crypto ────────────────────────────────────────────────────────────────────

func checksumAndSign(data []byte, key ed25519.PrivateKey) (checksum, signature string, err error) {
	h := sha256.Sum256(data)
	checksum = fmt.Sprintf("sha256:%x", h)
	sig := ed25519.Sign(key, []byte(checksum))
	signature = base64.StdEncoding.EncodeToString(sig)
	return
}

// ── Tarball creation ──────────────────────────────────────────────────────────

var tarExcludeDirs = map[string]bool{
	".tsuki-release": true, ".git": true, "target": true,
	"node_modules": true, ".next": true,
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
		top := strings.SplitN(rel, string(os.PathSeparator), 2)[0]
		if tarExcludeDirs[top] {
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

// ── Helpers ───────────────────────────────────────────────────────────────────

func RunCapture(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func RunCaptureDir(dir, name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	return string(out), err
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
	case "major": major++; minor, patch = 0, 0
	case "minor": minor++; patch = 0
	case "patch": patch++
	default:
		return "", fmt.Errorf("unknown bump part %q (use: major, minor, patch)", part)
	}
	return fmt.Sprintf("%d.%d.%d", major, minor, patch), nil
}

func HumanSize(n int64) string {
	const (KB = 1 << 10; MB = 1 << 20)
	switch {
	case n >= MB: return fmt.Sprintf("%.1f MB", float64(n)/MB)
	case n >= KB: return fmt.Sprintf("%.1f KB", float64(n)/KB)
	default:      return fmt.Sprintf("%d B", n)
	}
}

func timestamp() string {
	return time.Now().Format("20060102-150405")
}