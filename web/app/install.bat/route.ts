import { NextResponse } from "next/server";

const GITHUB_REPO = "s7lver2/tsuki";

const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$repo    = "${GITHUB_REPO}"
$tempDir = "$env:TEMP\\tsuki-install-$([System.IO.Path]::GetRandomFileName())"

Write-Host ""
Write-Host "  tsuki installer"
Write-Host "  ---------------------------"
Write-Host ""

# ── Detect architecture ────────────────────────────────────────────
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64" -or $env:PROCESSOR_ARCHITEW6432 -eq "ARM64") { "arm64" } else { "x64" }
Write-Host "  Detected platform: windows/$arch"

New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

try {
    # ── Fetch latest stable release (skip pre-releases) ───────────
    Write-Host "  Fetching latest release..."
    $releases = Invoke-RestMethod "https://api.github.com/repos/$repo/releases"
    $release  = $releases | Where-Object { -not $_.prerelease -and -not $_.draft } | Select-Object -First 1

    if (-not $release) {
        throw "No stable release found."
    }

    $version = $release.tag_name
    Write-Host "  Latest stable version: $version"

    # ── Find the installer asset ───────────────────────────────────
    $assetName = "tsuki-$version-windows-$arch-setup.exe"
    $asset     = $release.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1

    if (-not $asset) {
        # fallback: any .exe asset in the release
        $asset = $release.assets | Where-Object { $_.name -like "*windows*$arch*.exe" -or $_.name -like "*setup*.exe" } | Select-Object -First 1
    }

    if (-not $asset) {
        throw "No installer (.exe) found in release $version. Assets: $($release.assets.name -join ', ')"
    }

    $exePath = "$tempDir\\$($asset.name)"

    # ── Download ───────────────────────────────────────────────────
    Write-Host "  Downloading $($asset.name)..."
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $exePath -UseBasicParsing

    # ── Run installer ──────────────────────────────────────────────
    Write-Host "  Launching installer..."
    Start-Process -FilePath $exePath -ArgumentList "/SILENT", "/NORESTART" -Wait

    Write-Host ""
    Write-Host "  tsuki $version installed successfully!"
    Write-Host "  ------------------------------------------"
    Write-Host "  Run: tsuki --help"
    Write-Host "  Docs: https://tsuki.s7lver.xyz/docs"
    Write-Host ""
    Write-Host "  NOTE: Restart your terminal for PATH changes to take effect."
    Write-Host ""

} catch {
    Write-Host ""
    Write-Host "  [ERROR] $_" -ForegroundColor Red
    Write-Host ""
} finally {
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
}
`;

export async function GET() {
  return new NextResponse(script, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Content-Disposition": "inline; filename=install.ps1",
    },
  });
}