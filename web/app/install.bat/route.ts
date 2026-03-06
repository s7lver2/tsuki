import { NextResponse } from "next/server";

const GITHUB_REPO = "s7lver/tsuki";

const script = `@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1

:: tsuki installer for Windows
:: Usage: irm https://tsuki.sh/install.bat | iex
:: ──────────────────────────────────────────────

set "GITHUB_REPO=${GITHUB_REPO}"
set "TSUKI_HOME=%USERPROFILE%\\.tsuki"
set "INSTALL_DIR=%TSUKI_HOME%\\bin"
set "TEMP_DIR=%TEMP%\\tsuki-install-%RANDOM%"

echo.
echo   tsuki installer
echo   ---------------------------
echo.

:: ── Check PowerShell ────────────────────────────────
where powershell >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] PowerShell is required but not found.
    exit /b 1
)

:: ── Detect architecture ─────────────────────────────
set "ARCH_TYPE=amd64"
if "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH_TYPE=arm64"
if "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "ARCH_TYPE=arm64"

echo   Detected platform: windows/%ARCH_TYPE%

:: ── Create temp dir ─────────────────────────────────
mkdir "%TEMP_DIR%" 2>nul

:: ── Fetch latest release via PowerShell ─────────────
echo   Fetching latest release...

powershell -NoProfile -Command ^
  "$r = Invoke-RestMethod 'https://api.github.com/repos/%GITHUB_REPO%/releases/latest'; ^
   $r.tag_name | Out-File '%TEMP_DIR%\\version.txt' -Encoding UTF8 -NoNewline"

if %errorlevel% neq 0 (
    echo   [ERROR] Failed to fetch latest release. Check your internet connection.
    goto :cleanup
)

set /p LATEST=<"%TEMP_DIR%\\version.txt"
echo   Latest version: %LATEST%

:: ── Download ─────────────────────────────────────────
set "FILENAME=tsuki-windows-%ARCH_TYPE%.zip"
set "DOWNLOAD_URL=https://github.com/%GITHUB_REPO%/releases/download/%LATEST%/%FILENAME%"

echo   Downloading tsuki %LATEST%...

powershell -NoProfile -Command ^
  "Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%TEMP_DIR%\\tsuki.zip' -UseBasicParsing"

if %errorlevel% neq 0 (
    echo   [ERROR] Download failed.
    goto :cleanup
)

:: ── Extract ───────────────────────────────────────────
echo   Extracting...

powershell -NoProfile -Command ^
  "Expand-Archive -Path '%TEMP_DIR%\\tsuki.zip' -DestinationPath '%TEMP_DIR%' -Force"

:: ── Install ───────────────────────────────────────────
echo   Installing to %INSTALL_DIR%...

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

copy /y "%TEMP_DIR%\\tsuki.exe" "%INSTALL_DIR%\\tsuki.exe" >nul
if %errorlevel% neq 0 (
    echo   [ERROR] Failed to copy tsuki.exe to %INSTALL_DIR%
    goto :cleanup
)

:: ── Add to PATH ───────────────────────────────────────
powershell -NoProfile -Command ^
  "$path = [Environment]::GetEnvironmentVariable('PATH', 'User'); ^
   if ($path -notlike '*%INSTALL_DIR%*') { ^
     [Environment]::SetEnvironmentVariable('PATH', $path + ';%INSTALL_DIR%', 'User'); ^
     Write-Host '   Added %INSTALL_DIR% to PATH.' ^
   }"

:: ── Done ──────────────────────────────────────────────
echo.
echo   tsuki %LATEST% installed successfully!
echo   ------------------------------------------
echo   Run: tsuki --help
echo   Docs: https://tsuki.sh/docs
echo.
echo   NOTE: Restart your terminal for PATH changes to take effect.
echo.

:cleanup
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%" 2>nul
endlocal
`;

export async function GET() {
  return new NextResponse(script, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Content-Disposition": "inline; filename=install.bat",
    },
  });
}
