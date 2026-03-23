// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: pkgmgr/v2 :: types  —  shared data structures
// ─────────────────────────────────────────────────────────────────────────────

package v2

import "time"

// ── Package types ─────────────────────────────────────────────────────────────

type PkgType string

const (
	TypeApp       PkgType = "app"
	TypeLibrary   PkgType = "library"
	TypeBoardPack PkgType = "board-pack"
	TypeIdePlugin PkgType = "ide-plugin"
	TypeSdkPatch  PkgType = "sdk-patch"
)

// ── Source (registry server) ──────────────────────────────────────────────────

// Source is a remote registry URL that exposes packages.json and tsuki-keys.json.
type Source struct {
	URL      string    `json:"url"`
	AddedAt  time.Time `json:"added_at"`
	Priority int       `json:"priority"` // lower = higher priority; 0 = primary
}

// ── tsuki-keys.json ───────────────────────────────────────────────────────────

// KeyIndex is the top-level structure of tsuki-keys.json served by a source.
// It maps signer names to their full KeyEntry (public key + profile metadata).
type KeyIndex struct {
	// Signers maps a short signer handle (e.g. "tsuki-team", "s7lver")
	// to their full entry.  The map key is the canonical name that must match
	// [package.signing].key in tsuki.toml.
	Signers map[string]KeyEntry `json:"signers"`

	// SchemaVersion lets the CLI handle future format changes gracefully.
	SchemaVersion int `json:"schema_version,omitempty"` // current: 2
}

// KeyEntry is one signer's public key plus their public profile.
// All fields except PublicKey are optional but strongly encouraged —
// the IDE plugin browser uses them to display rich author cards.
type KeyEntry struct {
	// PublicKey is the Ed25519 public key used to verify package signatures.
	// Format: "ed25519:<base64-std-encoding>"
	PublicKey string `json:"public_key"`

	// DisplayName is the human-readable name shown in the IDE (e.g. "Tsuki Team").
	DisplayName string `json:"display_name,omitempty"`

	// AvatarURL is a public URL to a square avatar image (recommended: 128×128 px).
	AvatarURL string `json:"avatar_url,omitempty"`

	// Bio is a short one-line bio shown below the author name.
	Bio string `json:"bio,omitempty"`

	// Website is a link to the author's home page or GitHub profile.
	Website string `json:"website,omitempty"`

	// Verified marks signers that have been explicitly vouched for by the source
	// operator (e.g. tsuki-team).  The IDE renders a "verified" badge next to
	// plugins published by a verified signer.
	Verified bool `json:"verified,omitempty"`

	// Role is a short freeform label shown next to the name in the IDE.
	// Typical values: "core", "contributor", "community".
	Role string `json:"role,omitempty"`

	// AddedAt is when this signer was added to the key index.
	AddedAt time.Time `json:"added_at,omitempty"`
}

// ── packages.json ─────────────────────────────────────────────────────────────

// PackageIndex is the top-level packages.json structure served by a source.
type PackageIndex struct {
	Packages      []IndexEntry `json:"packages"`
	SchemaVersion int          `json:"schema_version,omitempty"` // current: 2
}

// IndexEntry describes one package in the registry.
// The IDE plugin browser consumes all fields — keep them populated.
type IndexEntry struct {
	// Core identity — required
	Name  string  `json:"name"`
	Owner string  `json:"owner"`
	Type  PkgType `json:"type"`

	// Human-facing metadata — shown in the IDE plugin browser
	Description string   `json:"description,omitempty"`
	Icon        string   `json:"icon,omitempty"`    // single emoji, e.g. "⚡"
	Tags        []string `json:"tags,omitempty"`    // e.g. ["lsp","diagnostics"]
	Repository  string   `json:"repository,omitempty"` // GitHub/GitLab URL

	// Engagement counters — updated by the registry server on publish
	Downloads int64   `json:"downloads,omitempty"`
	Rating    float64 `json:"rating,omitempty"`    // 0.0–5.0

	// ide-plugin specific — ignored for other types
	// Permissions lists the PermissionIds declared in the plugin's manifest.
	// The IDE shows these in the activation dialog and permission editor.
	Permissions []string `json:"permissions,omitempty"` // e.g. ["fs:read","shell:execute"]
	// Slots lists the extension points the plugin contributes to.
	Slots []string `json:"slots,omitempty"` // e.g. ["sidebar-tab","status-bar"]
	// SettingsSchema declares the configuration fields the plugin exposes in the
	// IDE Plugin Manager.  Each entry maps to one control in the settings panel.
	SettingsSchema []PluginSettingDef `json:"settings_schema,omitempty"`

	// Versions — all published releases, newest last
	Versions []Version `json:"versions"`

	// Computed at read time (not stored in JSON)
	LatestVersion string `json:"latest_version,omitempty"`
}

// PluginSettingDef describes one configuration field exposed by an ide-plugin.
// The IDE renders a matching control (toggle, text input, number, select) in
// the Plugin Manager settings panel for that plugin.
type PluginSettingDef struct {
	Key         string   `json:"key"`
	Label       string   `json:"label"`
	Description string   `json:"description,omitempty"`
	Type        string   `json:"type"`    // "toggle" | "text" | "number" | "select"
	Default     any      `json:"default,omitempty"`
	Options     []string `json:"options,omitempty"` // only for type = "select"
}

// FullName returns "owner/name".
func (e *IndexEntry) FullName() string { return e.Owner + "/" + e.Name }

// Version is one published release of a package.
type Version struct {
	Version string `json:"version"`

	// Used for library / board-pack / ide-plugin / sdk-patch:
	// single tarball download.
	URL       string `json:"url,omitempty"`
	Checksum  string `json:"checksum,omitempty"`  // "sha256:<hex>"
	Signature string `json:"signature,omitempty"` // Ed25519 over checksum, base64

	// Used for app: per-platform binary downloads.
	Binaries map[string]BinaryAsset `json:"binaries,omitempty"`
}

// BinaryAsset is one platform-specific binary for an app package.
type BinaryAsset struct {
	URL       string `json:"url"`
	Checksum  string `json:"checksum"`  // "sha256:<hex>"
	Signature string `json:"signature"` // Ed25519 over checksum, base64
}

// ── Resolved package ref ──────────────────────────────────────────────────────

// PackageRef is a parsed package reference from the command line.
// Examples:
//
//	"tsuki-flash"                → {Name: "tsuki-flash"}
//	"tsuki-team/tsuki-flash"     → {Owner: "tsuki-team", Name: "tsuki-flash"}
//	"tsuki-team/tsuki-flash@v6"  → {Owner: "tsuki-team", Name: "tsuki-flash", Constraint: "v6"}
type PackageRef struct {
	Owner      string // may be empty → match any owner
	Name       string
	Constraint string // semver constraint or exact version; empty = latest
}

// ── Installed package record ──────────────────────────────────────────────────

// InstalledEntry records a package that has been installed on this system.
type InstalledEntry struct {
	Owner   string    `json:"owner"`
	Name    string    `json:"name"`
	Version string    `json:"version"`
	Type    PkgType   `json:"type"`
	Source  string    `json:"source"` // URL of the source it came from
	Path    string    `json:"path"`   // absolute path to installed files
	InstalledAt time.Time `json:"installed_at"`
}

// FullName returns "owner/name".
func (e *InstalledEntry) FullName() string { return e.Owner + "/" + e.Name }