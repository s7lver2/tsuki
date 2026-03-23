// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: pkgmgr/v2 :: resolver  —  package ref parsing & version resolution
// ─────────────────────────────────────────────────────────────────────────────

package v2

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// ── Package ref parsing ───────────────────────────────────────────────────────

// ParseRef parses a package reference string into a PackageRef.
//
// Accepted formats:
//
//	"tsuki-flash"                    → {Name: "tsuki-flash"}
//	"tsuki-team/tsuki-flash"         → {Owner: "tsuki-team", Name: "tsuki-flash"}
//	"tsuki-team/tsuki-flash@v6.0.0"  → {..., Constraint: "v6.0.0"}
//	"tsuki-team/tsuki-flash@>=5.0"   → {..., Constraint: ">=5.0"}
func ParseRef(raw string) (PackageRef, error) {
	var ref PackageRef

	// Split off version constraint
	parts := strings.SplitN(raw, "@", 2)
	namepart := parts[0]
	if len(parts) == 2 {
		ref.Constraint = strings.TrimSpace(parts[1])
	}

	// Split owner/name
	slash := strings.SplitN(namepart, "/", 2)
	if len(slash) == 2 {
		ref.Owner = strings.TrimSpace(slash[0])
		ref.Name = strings.TrimSpace(slash[1])
	} else {
		ref.Name = strings.TrimSpace(slash[0])
	}

	if ref.Name == "" {
		return PackageRef{}, fmt.Errorf("invalid package reference %q: missing name", raw)
	}
	return ref, nil
}

// ── Version resolution ────────────────────────────────────────────────────────

// Resolve finds the best matching IndexEntry and Version for a PackageRef
// in the provided list of entries.
func Resolve(ref PackageRef, entries []IndexEntry) (*IndexEntry, *Version, error) {
	var candidates []IndexEntry
	for _, e := range entries {
		e := e
		if !strings.EqualFold(e.Name, ref.Name) {
			continue
		}
		if ref.Owner != "" && !strings.EqualFold(e.Owner, ref.Owner) {
			continue
		}
		candidates = append(candidates, e)
	}

	if len(candidates) == 0 {
		if ref.Owner != "" {
			return nil, nil, fmt.Errorf("package %s/%s not found", ref.Owner, ref.Name)
		}
		return nil, nil, fmt.Errorf("package %q not found in any configured source", ref.Name)
	}
	if len(candidates) > 1 {
		owners := make([]string, len(candidates))
		for i, c := range candidates {
			owners[i] = c.Owner
		}
		return nil, nil, fmt.Errorf(
			"ambiguous package %q — found in multiple owners: %s\n  Use owner/name syntax to disambiguate",
			ref.Name, strings.Join(owners, ", "),
		)
	}

	entry := candidates[0]
	ver, err := bestVersion(entry.Versions, ref.Constraint)
	if err != nil {
		return nil, nil, fmt.Errorf("%s/%s: %w", entry.Owner, entry.Name, err)
	}
	return &entry, ver, nil
}

// bestVersion picks the highest version that satisfies constraint.
// An empty constraint means "latest".
func bestVersion(versions []Version, constraint string) (*Version, error) {
	if len(versions) == 0 {
		return nil, fmt.Errorf("no versions published")
	}

	// Exact match first (e.g. "@v6.0.0")
	if constraint != "" && !isRange(constraint) {
		needle := strings.TrimPrefix(constraint, "v")
		for i := range versions {
			if strings.TrimPrefix(versions[i].Version, "v") == needle {
				return &versions[i], nil
			}
		}
		return nil, fmt.Errorf("version %q not published", constraint)
	}

	// Sort descending
	sorted := make([]Version, len(versions))
	copy(sorted, versions)
	sortVersionsDesc(sorted)

	// No constraint → latest
	if constraint == "" {
		return &sorted[0], nil
	}

	// Range constraint (>=, <=, >, <, ~, ^)
	for i := range sorted {
		if matchesConstraint(sorted[i].Version, constraint) {
			return &sorted[i], nil
		}
	}
	return nil, fmt.Errorf("no version satisfies constraint %q", constraint)
}

// ── Semver helpers ────────────────────────────────────────────────────────────

type semver struct{ major, minor, patch int }

var semverRe = regexp.MustCompile(`^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?`)

func parseSemver(s string) (semver, bool) {
	m := semverRe.FindStringSubmatch(s)
	if m == nil {
		return semver{}, false
	}
	atoi := func(s string) int {
		n, _ := strconv.Atoi(s)
		return n
	}
	return semver{atoi(m[1]), atoi(m[2]), atoi(m[3])}, true
}

func (a semver) compare(b semver) int {
	if a.major != b.major {
		if a.major > b.major {
			return 1
		}
		return -1
	}
	if a.minor != b.minor {
		if a.minor > b.minor {
			return 1
		}
		return -1
	}
	if a.patch != b.patch {
		if a.patch > b.patch {
			return 1
		}
		return -1
	}
	return 0
}

func sortVersionsDesc(versions []Version) {
	for i := 1; i < len(versions); i++ {
		for j := i; j > 0; j-- {
			a, aok := parseSemver(versions[j].Version)
			b, bok := parseSemver(versions[j-1].Version)
			if !aok || !bok {
				break
			}
			if a.compare(b) > 0 {
				versions[j], versions[j-1] = versions[j-1], versions[j]
			} else {
				break
			}
		}
	}
}

// isRange returns true when constraint looks like >=, <=, >, <, ~, ^.
func isRange(c string) bool {
	return strings.ContainsAny(c[:1], "><=~^")
}

// matchesConstraint evaluates a version against a constraint string.
// Supports: >=X, <=X, >X, <X, and comma-separated combinations (>=X,<Y).
func matchesConstraint(version, constraint string) bool {
	v, ok := parseSemver(version)
	if !ok {
		return false
	}
	for _, part := range strings.Split(constraint, ",") {
		part = strings.TrimSpace(part)
		if !matchesSingle(v, part) {
			return false
		}
	}
	return true
}

func matchesSingle(v semver, constraint string) bool {
	var op, verStr string
	for _, prefix := range []string{">=", "<=", ">", "<", "~", "^"} {
		if strings.HasPrefix(constraint, prefix) {
			op = prefix
			verStr = constraint[len(prefix):]
			break
		}
	}
	if op == "" {
		// Bare version — exact match
		c, ok := parseSemver(constraint)
		if !ok {
			return false
		}
		return v.compare(c) == 0
	}

	c, ok := parseSemver(verStr)
	if !ok {
		return false
	}

	cmp := v.compare(c)
	switch op {
	case ">=":
		return cmp >= 0
	case "<=":
		return cmp <= 0
	case ">":
		return cmp > 0
	case "<":
		return cmp < 0
	case "~": // patch-level: >=X.Y.Z, <X.(Y+1).0
		return v.major == c.major && v.minor == c.minor && cmp >= 0
	case "^": // minor-level: >=X.Y.Z, <(X+1).0.0
		return v.major == c.major && cmp >= 0
	}
	return false
}