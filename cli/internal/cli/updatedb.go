// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: cli :: updatedb  —  refresh local registry cache from keys.json
// ─────────────────────────────────────────────────────────────────────────────

package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"
	"github.com/tsuki/cli/internal/ui"
)

// keysFilePath returns the path to the user's keys.json.
func keysFilePath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "tsuki", "keys.json")
}

// dbCacheDir returns the directory where per-registry packages.json are cached.
func dbCacheDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".cache", "tsuki", "db")
}

// registryKey holds one entry from keys.json.
type registryKey struct {
	Name string `json:"name"`
	URL  string `json:"url"` // base URL; packages.json is fetched from URL/packages.json
}

func newUpdateDBCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "updatedb",
		Short: "Refresh the local registry cache from keys.json",
		Long: `updatedb reads ~/.config/tsuki/keys.json, fetches the packages.json from
every listed registry, and caches the results in ~/.cache/tsuki/db/.

Run this after adding a new registry key or when packages seem out of date.`,
		Example: `  tsuki updatedb`,
		RunE: func(cmd *cobra.Command, args []string) error {
			keysPath := keysFilePath()

			ui.SectionTitle("Updating package database")
			ui.Step("keys", keysPath)
			fmt.Println()

			data, err := os.ReadFile(keysPath)
			if err != nil {
				if os.IsNotExist(err) {
					ui.Warn("keys.json not found — creating default at " + keysPath)
					if err2 := writeDefaultKeys(keysPath); err2 != nil {
						return fmt.Errorf("creating keys.json: %w", err2)
					}
					data, _ = os.ReadFile(keysPath)
				} else {
					return fmt.Errorf("reading keys.json: %w", err)
				}
			}

			var keys []registryKey
			if err := json.Unmarshal(data, &keys); err != nil {
				return fmt.Errorf("parsing keys.json: %w", err)
			}

			if len(keys) == 0 {
				ui.Info("No registry keys configured — add entries to " + keysPath)
				return nil
			}

			cacheDir := dbCacheDir()
			_ = os.MkdirAll(cacheDir, 0755)

			var ok, fail int
			for _, key := range keys {
				sp := ui.NewSpinner(fmt.Sprintf("%-20s  %s", key.Name, key.URL))
				sp.Start()

				pkgURL := key.URL
				if pkgURL[len(pkgURL)-1] != '/' {
					pkgURL += "/"
				}
				pkgURL += "packages.json"

				body, err := httpGet(pkgURL)
				if err != nil {
					sp.Stop(false, fmt.Sprintf("%s — %v", key.Name, err))
					fail++
					continue
				}

				cacheFile := filepath.Join(cacheDir, key.Name+".json")
				if err := os.WriteFile(cacheFile, body, 0644); err != nil {
					sp.Stop(false, fmt.Sprintf("%s — write error: %v", key.Name, err))
					fail++
					continue
				}

				// Count packages in the response.
				var pkgs []map[string]interface{}
				_ = json.Unmarshal(body, &pkgs)
				sp.Stop(true, fmt.Sprintf("%-20s  %d package(s)", key.Name, len(pkgs)))
				ok++
			}

			fmt.Println()
			if fail > 0 {
				ui.Warn(fmt.Sprintf("updated %d/%d registries (%d failed)", ok, len(keys), fail))
			} else {
				ui.Success(fmt.Sprintf("updated %d registry sources", ok))
			}
			return nil
		},
	}

	return cmd
}

func httpGet(url string) ([]byte, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}
	return io.ReadAll(resp.Body)
}

func writeDefaultKeys(path string) error {
	_ = os.MkdirAll(filepath.Dir(path), 0755)
	defaults := []registryKey{
		{Name: "tsuki-official", URL: "https://raw.githubusercontent.com/tsuki-team/registry/main"},
	}
	data, _ := json.MarshalIndent(defaults, "", "  ")
	return os.WriteFile(path, append(data, '\n'), 0644)
}