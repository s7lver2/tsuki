import { NextRequest, NextResponse } from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
//  /api/update/[channel]
//
//  Serves the update manifest for a given channel ("stable" or "testing").
//
//  How it works:
//    1. Queries the GitHub Releases API for this repo.
//    2. Picks the latest release that matches the channel:
//         stable  → latest non-prerelease, non-draft release
//         testing → latest prerelease (or any release tagged *-testing / *-beta)
//    3. Finds the "manifest.json" asset attached to that release.
//    4. Fetches and returns it verbatim with cache headers.
//
//  This means zero files to commit to any branch — the single source of
//  truth is the GitHub Release and its uploaded artifacts.
//
//  Env vars (set in Vercel / your host):
//    GITHUB_TOKEN  — optional but recommended to avoid rate limits (5000 req/h
//                    authenticated vs 60 req/h anonymous).
//    GITHUB_REPO   — override the repo slug (default: s7lver2/tsuki)
// ─────────────────────────────────────────────────────────────────────────────

const REPO    = process.env.GITHUB_REPO ?? "s7lver2/tsuki";
const GH_API  = "https://api.github.com";
const HEADERS: HeadersInit = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}),
};

type Channel = "stable" | "testing";

interface GhRelease {
  tag_name:   string;
  prerelease: boolean;
  draft:      boolean;
  published_at: string;
  body:       string;
  assets: { name: string; browser_download_url: string; size: number }[];
}

/** Fetch up to 30 most-recent releases and find the best one for the channel. */
async function findRelease(channel: Channel): Promise<GhRelease | null> {
  const res = await fetch(`${GH_API}/repos/${REPO}/releases?per_page=30`, {
    headers: HEADERS,
    // Revalidate every 5 minutes server-side so hot deployments propagate fast
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }

  const releases: GhRelease[] = await res.json();

  if (channel === "testing") {
    // Prefer prerelease; also match tags ending in -testing, -beta, -rc, -alpha
    return (
      releases.find(
        (r) =>
          !r.draft &&
          (r.prerelease ||
            /-(testing|beta|rc|alpha)\b/.test(r.tag_name))
      ) ?? null
    );
  }

  // stable: latest non-draft, non-prerelease
  return releases.find((r) => !r.draft && !r.prerelease) ?? null;
}

/** Download the manifest.json asset from a release and return its content. */
async function fetchManifest(release: GhRelease): Promise<object> {
  const asset = release.assets.find((a) => a.name === "manifest.json");

  if (asset) {
    const res = await fetch(asset.browser_download_url, {
      headers: HEADERS,
      next: { revalidate: 300 },
    });
    if (res.ok) {
      return res.json();
    }
  }

  // Fallback: synthesize a minimal manifest from the release metadata.
  // build.py uploads individual artifacts with predictable names like
  // tsuki-1.2.3-linux-amd64.tar.gz / tsuki-Setup-1.2.3-windows-amd64.exe
  const version = release.tag_name.replace(/^v/, "");
  const channel: Channel = release.prerelease ? "testing" : "stable";

  const PLATFORM_PATTERNS: Record<string, RegExp> = {
    "linux-amd64":   /linux[-_]amd64.*\.tar\.gz$/i,
    "linux-arm64":   /linux[-_]arm64.*\.tar\.gz$/i,
    "linux-arm":     /linux[-_]arm[^6].*\.tar\.gz$/i,
    "darwin-amd64":  /darwin[-_]amd64.*\.tar\.gz$/i,
    "darwin-arm64":  /darwin[-_]arm64.*\.tar\.gz$/i,
    "windows-amd64": /windows[-_]amd64.*\.exe$/i,
    "windows-arm64": /windows[-_]arm64.*\.exe$/i,
  };

  const platforms: Record<string, { url: string; signature: string; size: number }> = {};

  for (const [pk, pattern] of Object.entries(PLATFORM_PATTERNS)) {
    const a = release.assets.find((x) => pattern.test(x.name));
    if (a) {
      // Look for a companion .sig asset (e.g. tsuki-1.2.3-linux-amd64.tar.gz.sig)
      const sig = release.assets.find((x) => x.name === a.name + ".sig");
      let signature = "";
      if (sig) {
        try {
          const sr = await fetch(sig.browser_download_url);
          signature = (await sr.text()).trim();
        } catch { /* no sig */ }
      }
      platforms[pk] = { url: a.browser_download_url, signature, size: a.size };
    }
  }

  return {
    version,
    channel,
    pub_date: release.published_at,
    notes:    release.body?.split("\n")[0]?.slice(0, 200) ?? "",
    platforms,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ channel: string }> }
) {
  const { channel: rawChannel } = await params;
  const channel = rawChannel as Channel;

  if (channel !== "stable" && channel !== "testing") {
    return NextResponse.json(
      { error: `Unknown channel "${channel}". Use stable or testing.` },
      { status: 400 }
    );
  }

  try {
    const release = await findRelease(channel);

    if (!release) {
      return NextResponse.json(
        { error: `No ${channel} release found in ${REPO}.` },
        { status: 404 }
      );
    }

    const manifest = await fetchManifest(release);

    return NextResponse.json(manifest, {
      headers: {
        // Cache at the CDN edge for 5 min, allow stale for 1 min while revalidating
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
        "X-Tsuki-Channel": channel,
        "X-Tsuki-Release": release.tag_name,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}