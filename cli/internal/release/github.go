// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-dk :: internal/release/github  —  GitHub Releases upload
//
//  Requires GITHUB_TOKEN in the environment.
//  The token needs the "contents:write" scope on the target repository.
// ─────────────────────────────────────────────────────────────────────────────

package release

import (
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const githubAPI = "https://api.github.com"

// UploadGitHubRelease uploads filePath to the GitHub Release for repo@tag,
// creating the release if it doesn't exist yet. It returns the browser_download_url.
//
// Requires the GITHUB_TOKEN environment variable.
func UploadGitHubRelease(filePath, repo, tag string) (string, error) {
	token := os.Getenv("GITHUB_TOKEN")
	if token == "" {
		return "", fmt.Errorf(
			"GITHUB_TOKEN is not set — cannot upload to GitHub Releases\n" +
				"  Set it with: export GITHUB_TOKEN=<your-token>\n" +
				"  Or use --no-upload to skip the upload step")
	}

	// 1. Get or create the release
	releaseID, uploadURL, err := getOrCreateRelease(token, repo, tag)
	if err != nil {
		return "", fmt.Errorf("get/create release %s@%s: %w", repo, tag, err)
	}
	_ = releaseID

	// 2. Delete existing asset with the same name (idempotent re-uploads)
	assetName := filepath.Base(filePath)
	if err := deleteExistingAsset(token, repo, releaseID, assetName); err != nil {
		// Non-fatal: warn and continue
		fmt.Printf("  warn: could not delete existing asset %s: %v\n", assetName, err)
	}

	// 3. Upload asset
	downloadURL, err := uploadReleaseAsset(token, uploadURL, filePath, assetName)
	if err != nil {
		return "", fmt.Errorf("upload %s: %w", assetName, err)
	}

	return downloadURL, nil
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func getOrCreateRelease(token, repo, tag string) (int64, string, error) {
	// Try to get existing release
	url := fmt.Sprintf("%s/repos/%s/releases/tags/%s", githubAPI, repo, tag)
	body, status, err := ghRequest(token, "GET", url, nil, "")
	if err != nil {
		return 0, "", err
	}
	if status == 200 {
		var rel struct {
			ID        int64  `json:"id"`
			UploadURL string `json:"upload_url"`
		}
		if err := json.Unmarshal(body, &rel); err != nil {
			return 0, "", err
		}
		// upload_url has a template suffix like {?name,label} — strip it
		uploadURL := strings.SplitN(rel.UploadURL, "{", 2)[0]
		return rel.ID, uploadURL, nil
	}

	// Create new release
	payload := fmt.Sprintf(`{"tag_name":%q,"name":%q,"draft":false,"prerelease":false}`,
		tag, tag)
	url = fmt.Sprintf("%s/repos/%s/releases", githubAPI, repo)
	body, status, err = ghRequest(token, "POST", url, strings.NewReader(payload), "application/json")
	if err != nil {
		return 0, "", err
	}
	if status != 201 {
		return 0, "", fmt.Errorf("create release: HTTP %d: %s", status, body)
	}

	var rel struct {
		ID        int64  `json:"id"`
		UploadURL string `json:"upload_url"`
	}
	if err := json.Unmarshal(body, &rel); err != nil {
		return 0, "", err
	}
	uploadURL := strings.SplitN(rel.UploadURL, "{", 2)[0]
	return rel.ID, uploadURL, nil
}

func deleteExistingAsset(token, repo string, releaseID int64, name string) error {
	// List assets
	url := fmt.Sprintf("%s/repos/%s/releases/%d/assets", githubAPI, repo, releaseID)
	body, status, err := ghRequest(token, "GET", url, nil, "")
	if err != nil || status != 200 {
		return nil // best-effort
	}

	var assets []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(body, &assets); err != nil {
		return nil
	}

	for _, a := range assets {
		if a.Name == name {
			del := fmt.Sprintf("%s/repos/%s/releases/assets/%d", githubAPI, repo, a.ID)
			_, _, _ = ghRequest(token, "DELETE", del, nil, "")
			break
		}
	}
	return nil
}

func uploadReleaseAsset(token, uploadURL, filePath, assetName string) (string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	contentType := mime.TypeByExtension(filepath.Ext(assetName))
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	url := fmt.Sprintf("%s?name=%s", uploadURL, assetName)
	body, status, err := ghRequest(token, "POST", url, f, contentType)
	if err != nil {
		return "", err
	}
	if status != 201 {
		return "", fmt.Errorf("upload asset: HTTP %d: %s", status, body)
	}

	var asset struct {
		BrowserDownloadURL string `json:"browser_download_url"`
	}
	if err := json.Unmarshal(body, &asset); err != nil {
		return "", err
	}
	return asset.BrowserDownloadURL, nil
}

func ghRequest(token, method, url string, body io.Reader, contentType string) ([]byte, int, error) {
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	return respBody, resp.StatusCode, err
}