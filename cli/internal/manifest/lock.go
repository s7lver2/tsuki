// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: manifest :: lock  —  .tsuki/lock.json management
//
//  The lock file pins every resolved dependency to an exact version so that
//  builds are reproducible.  It lives at <project>/.tsuki/lock.json.
// ─────────────────────────────────────────────────────────────────────────────

package manifest

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const LockFileName = "lock.json"

// lockDir returns the .tsuki/ directory inside a project.
func lockDir(projectDir string) string {
	return filepath.Join(projectDir, ".tsuki")
}

// lockPath returns the full path to the lock file.
func lockPath(projectDir string) string {
	return filepath.Join(lockDir(projectDir), LockFileName)
}

// ── LockEntry ─────────────────────────────────────────────────────────────────

// LockEntry is one pinned dependency in the lock file.
type LockEntry struct {
	Name     string `json:"name"`
	Version  string `json:"version"`
	Registry string `json:"registry,omitempty"`
	Checksum string `json:"checksum,omitempty"`
	Path     string `json:"path,omitempty"`
}

// ── LockFile ──────────────────────────────────────────────────────────────────

// LockFile is the in-memory representation of .tsuki/lock.json.
type LockFile struct {
	Entries []LockEntry `json:"dependencies"`
}

// LoadLock reads the lock file from projectDir/.tsuki/lock.json.
// Returns an empty LockFile (not an error) when the file does not exist yet.
func LoadLock(projectDir string) (*LockFile, error) {
	data, err := os.ReadFile(lockPath(projectDir))
	if os.IsNotExist(err) {
		return &LockFile{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading lock file: %w", err)
	}
	var lf LockFile
	if err := json.Unmarshal(data, &lf); err != nil {
		return nil, fmt.Errorf("parsing lock file: %w", err)
	}
	return &lf, nil
}

// Save writes the lock file to projectDir/.tsuki/lock.json, creating the
// .tsuki/ directory if necessary.
func (lf *LockFile) Save(projectDir string) error {
	if err := os.MkdirAll(lockDir(projectDir), 0755); err != nil {
		return fmt.Errorf("creating .tsuki dir: %w", err)
	}
	data, err := json.MarshalIndent(lf, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(lockPath(projectDir), append(data, '\n'), 0644)
}

// Get returns the LockEntry for name, or nil if not present.
func (lf *LockFile) Get(name string) *LockEntry {
	for i := range lf.Entries {
		if lf.Entries[i].Name == name {
			return &lf.Entries[i]
		}
	}
	return nil
}

// Upsert adds or updates the entry for pkg.Name.
func (lf *LockFile) Upsert(entry LockEntry) {
	for i := range lf.Entries {
		if lf.Entries[i].Name == entry.Name {
			lf.Entries[i] = entry
			return
		}
	}
	lf.Entries = append(lf.Entries, entry)
}

// Remove deletes the entry for name. Returns true if it was present.
func (lf *LockFile) Remove(name string) bool {
	for i, e := range lf.Entries {
		if e.Name == name {
			lf.Entries = append(lf.Entries[:i], lf.Entries[i+1:]...)
			return true
		}
	}
	return false
}