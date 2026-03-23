package v2

import (
	"testing"
)

// ── ParseRef ──────────────────────────────────────────────────────────────────

func TestParseRef(t *testing.T) {
	cases := []struct {
		input      string
		wantOwner  string
		wantName   string
		wantConstr string
		wantErr    bool
	}{
		{"tsuki-flash",                     "",            "tsuki-flash", "",        false},
		{"tsuki-team/tsuki-flash",          "tsuki-team",  "tsuki-flash", "",        false},
		{"tsuki-team/tsuki-flash@v6.0.0",  "tsuki-team",  "tsuki-flash", "v6.0.0", false},
		{"tsuki-team/tsuki-flash@>=5.0",   "tsuki-team",  "tsuki-flash", ">=5.0",  false},
		{"tsuki-team/dht@>=1.0,<3.0",      "tsuki-team",  "dht",         ">=1.0,<3.0", false},
		{"",                                "",            "",            "",        true},
		{"@v1.0",                           "",            "",            "",        true},
	}

	for _, c := range cases {
		ref, err := ParseRef(c.input)
		if c.wantErr {
			if err == nil {
				t.Errorf("ParseRef(%q): want error, got nil", c.input)
			}
			continue
		}
		if err != nil {
			t.Errorf("ParseRef(%q): unexpected error: %v", c.input, err)
			continue
		}
		if ref.Owner != c.wantOwner {
			t.Errorf("ParseRef(%q).Owner = %q, want %q", c.input, ref.Owner, c.wantOwner)
		}
		if ref.Name != c.wantName {
			t.Errorf("ParseRef(%q).Name = %q, want %q", c.input, ref.Name, c.wantName)
		}
		if ref.Constraint != c.wantConstr {
			t.Errorf("ParseRef(%q).Constraint = %q, want %q", c.input, ref.Constraint, c.wantConstr)
		}
	}
}

// ── parseSemver ───────────────────────────────────────────────────────────────

func TestParseSemver(t *testing.T) {
	cases := []struct {
		input string
		want  semver
		ok    bool
	}{
		{"1.2.3",  semver{1, 2, 3}, true},
		{"v1.2.3", semver{1, 2, 3}, true},
		{"6.0.0",  semver{6, 0, 0}, true},
		{"0.1.0",  semver{0, 1, 0}, true},
		{"1.0",    semver{1, 0, 0}, true},
		{"abc",    semver{}, false},
		{"",       semver{}, false},
	}
	for _, c := range cases {
		got, ok := parseSemver(c.input)
		if ok != c.ok {
			t.Errorf("parseSemver(%q): ok=%v, want %v", c.input, ok, c.ok)
			continue
		}
		if ok && got != c.want {
			t.Errorf("parseSemver(%q) = %+v, want %+v", c.input, got, c.want)
		}
	}
}

// ── matchesConstraint ─────────────────────────────────────────────────────────

func TestMatchesConstraint(t *testing.T) {
	cases := []struct {
		version    string
		constraint string
		want       bool
	}{
		// Exact
		{"6.0.0", "6.0.0",  true},
		{"6.0.0", "v6.0.0", true},
		{"6.0.0", "5.0.0",  false},
		// >=
		{"6.0.0", ">=5.0",  true},
		{"6.0.0", ">=6.0.0", true},
		{"4.9.9", ">=5.0",  false},
		// <=
		{"4.0.0", "<=5.0",  true},
		{"6.0.0", "<=5.0",  false},
		// >
		{"6.0.0", ">5.0",   true},
		{"5.0.0", ">5.0",   false},
		// <
		{"4.9.9", "<5.0",   true},
		{"5.0.0", "<5.0",   false},
		// ~ patch-level
		{"1.2.5", "~1.2.3", true},
		{"1.3.0", "~1.2.3", false},
		{"1.2.0", "~1.2.3", false},
		// ^ minor-level
		{"1.5.0", "^1.2.3", true},
		{"2.0.0", "^1.2.3", false},
		{"1.2.2", "^1.2.3", false},
		// Range (comma-separated)
		{"5.5.0", ">=5.0,<6.0", true},
		{"6.0.0", ">=5.0,<6.0", false},
		{"4.9.9", ">=5.0,<6.0", false},
		{"5.0.0", ">=5.0,<6.0", true},
	}

	for _, c := range cases {
		got := matchesConstraint(c.version, c.constraint)
		if got != c.want {
			t.Errorf("matchesConstraint(%q, %q) = %v, want %v",
				c.version, c.constraint, got, c.want)
		}
	}
}

// ── bestVersion ───────────────────────────────────────────────────────────────

func mkVersions(vs ...string) []Version {
	out := make([]Version, len(vs))
	for i, v := range vs {
		out[i] = Version{Version: v}
	}
	return out
}

func TestBestVersion(t *testing.T) {
	versions := mkVersions("1.0.0", "2.0.0", "2.1.0", "3.0.0-beta", "2.5.0")

	cases := []struct {
		constraint string
		wantVer    string
		wantErr    bool
	}{
		{"",        "3.0.0-beta", false}, // latest (last after sort; beta counts as a string)
		{"2.0.0",   "2.0.0",      false}, // exact
		{">=2.0",   "2.5.0",      false}, // highest that matches (non-beta)
		{"<2.0",    "1.0.0",      false},
		{"^2.0",    "2.5.0",      false},
		{"~2.0.0",  "2.0.0",      false},
		{">=9.0",   "",           true},  // no match
		{"9.9.9",   "",           true},  // exact not found
	}

	for _, c := range cases {
		ver, err := bestVersion(versions, c.constraint)
		if c.wantErr {
			if err == nil {
				t.Errorf("bestVersion(%q): want error, got %q", c.constraint, ver.Version)
			}
			continue
		}
		if err != nil {
			t.Errorf("bestVersion(%q): unexpected error: %v", c.constraint, err)
			continue
		}
		if ver.Version != c.wantVer {
			t.Errorf("bestVersion(%q) = %q, want %q", c.constraint, ver.Version, c.wantVer)
		}
	}
}

// ── Resolve ───────────────────────────────────────────────────────────────────

func TestResolve(t *testing.T) {
	entries := []IndexEntry{
		{
			Name: "tsuki-flash", Owner: "tsuki-team", Type: TypeApp,
			Versions: mkVersions("5.0.0", "6.0.0", "6.1.0"),
		},
		{
			Name: "dht", Owner: "tsuki-team", Type: TypeLibrary,
			Versions: mkVersions("1.0.0", "2.0.0"),
		},
		{
			Name: "dht", Owner: "community", Type: TypeLibrary,
			Versions: mkVersions("1.5.0"),
		},
	}

	t.Run("exact name", func(t *testing.T) {
		ref, _ := ParseRef("tsuki-flash")
		e, v, err := Resolve(ref, entries)
		if err != nil {
			t.Fatal(err)
		}
		if e.Owner != "tsuki-team" || v.Version != "6.1.0" {
			t.Errorf("got %s/%s@%s", e.Owner, e.Name, v.Version)
		}
	})

	t.Run("owner/name", func(t *testing.T) {
		ref, _ := ParseRef("tsuki-team/tsuki-flash@>=6.0")
		e, v, err := Resolve(ref, entries)
		if err != nil {
			t.Fatal(err)
		}
		if v.Version != "6.1.0" {
			t.Errorf("want 6.1.0, got %s", v.Version)
		}
		_ = e
	})

	t.Run("exact version", func(t *testing.T) {
		ref, _ := ParseRef("tsuki-team/tsuki-flash@6.0.0")
		_, v, err := Resolve(ref, entries)
		if err != nil {
			t.Fatal(err)
		}
		if v.Version != "6.0.0" {
			t.Errorf("want 6.0.0, got %s", v.Version)
		}
	})

	t.Run("ambiguous owner", func(t *testing.T) {
		ref, _ := ParseRef("dht")
		_, _, err := Resolve(ref, entries)
		if err == nil {
			t.Error("want error for ambiguous owner, got nil")
		}
	})

	t.Run("disambiguate by owner", func(t *testing.T) {
		ref, _ := ParseRef("community/dht")
		e, v, err := Resolve(ref, entries)
		if err != nil {
			t.Fatal(err)
		}
		if e.Owner != "community" || v.Version != "1.5.0" {
			t.Errorf("got %s/%s@%s", e.Owner, e.Name, v.Version)
		}
	})

	t.Run("not found", func(t *testing.T) {
		ref, _ := ParseRef("nonexistent")
		_, _, err := Resolve(ref, entries)
		if err == nil {
			t.Error("want error for nonexistent package")
		}
	})

	t.Run("version not found", func(t *testing.T) {
		ref, _ := ParseRef("tsuki-team/tsuki-flash@>=99.0")
		_, _, err := Resolve(ref, entries)
		if err == nil {
			t.Error("want error for unsatisfiable constraint")
		}
	})
}

// ── sortVersionsDesc ──────────────────────────────────────────────────────────

func TestSortVersionsDesc(t *testing.T) {
	versions := mkVersions("1.0.0", "3.0.0", "2.0.0", "2.1.0", "0.9.0")
	sortVersionsDesc(versions)

	want := []string{"3.0.0", "2.1.0", "2.0.0", "1.0.0", "0.9.0"}
	for i, v := range versions {
		if v.Version != want[i] {
			t.Errorf("versions[%d] = %q, want %q", i, v.Version, want[i])
		}
	}
}