<#
.SYNOPSIS
  Verify the desktop Rust migration and build the unpacked Windows app from a native Windows shell.

.DESCRIPTION
  Run this from the repository root in PowerShell outside WSL. It performs the
  checks that are hard to complete from WSL: clean pnpm install/build, Rust
  formatting/tests, backend release build/startup verification, and the unpacked
  Windows app executable. The NSIS installer is optional.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\verify-desktop-windows.ps1

.EXAMPLE
  .\scripts\verify-desktop-windows.ps1 -IncludeWeb
#>

[CmdletBinding()]
param(
  [switch]$IncludeWeb,
  [switch]$SkipInstall,
  [switch]$SkipRustTests,
  [switch]$SkipApp,
  [switch]$BuildInstaller,
  [switch]$Clean
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on PATH."
  }
}

function Invoke-Step {
  param(
    [string]$Name,
    [string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory = $RepoRoot
  )

  Write-Step $Name
  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$Name failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$AppDir = Join-Path $RepoRoot "app"
$BackendDir = Join-Path $AppDir "backend"
$WebDir = Join-Path $RepoRoot "web"

if (-not (Test-Path (Join-Path $RepoRoot "package.json"))) {
  throw "Could not find repository package.json at $RepoRoot. Run this script from the checked-out Track Auto Chess repo."
}

if ($env:WSL_DISTRO_NAME) {
  throw "This script is intended for native Windows PowerShell, not WSL. Open PowerShell outside WSL and run it from the repo checkout."
}

Write-Host "Repository: $RepoRoot" -ForegroundColor DarkGray

Require-Command "node"
Require-Command "pnpm"
Require-Command "cargo"

Invoke-Step "Show tool versions" "cmd.exe" @("/c", "node --version && pnpm --version && cargo --version")

if ($Clean) {
  Write-Step "Clean generated desktop artifacts"
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue `
    (Join-Path $AppDir "node_modules"),
    (Join-Path $AppDir "dist"),
    (Join-Path $AppDir "release"),
    (Join-Path $BackendDir "dist")
}

if (-not $SkipInstall) {
  Invoke-Step "Install desktop dependencies" "pnpm" @("--dir", "app", "install", "--frozen-lockfile")
}

if (-not $SkipRustTests) {
  Invoke-Step "Check Rust formatting" "cargo" @("fmt", "--manifest-path", "app/backend/Cargo.toml", "--check")
  Invoke-Step "Run Rust tests" "cargo" @("test", "--manifest-path", "app/backend/Cargo.toml")
}

Invoke-Step "Build desktop frontend" "pnpm" @("--dir", "app", "run", "build")
Invoke-Step "Build Rust backend release bundle" "pnpm" @("--dir", "app", "run", "build:backend")
Invoke-Step "Verify backend daemon startup" "node" @("scripts/verify-desktop-backend.mjs")

if (-not $SkipApp) {
  Invoke-Step "Build unpacked Windows app" "pnpm" @("--dir", "app", "run", "build:app")
  $AppExe = Join-Path $AppDir "release\win-unpacked\Track Auto Chess.exe"
  if (-not (Test-Path $AppExe)) {
    throw "Expected unpacked app executable was not created: $AppExe"
  }
  Write-Host ""
  Write-Host "Windows app executable: $AppExe" -ForegroundColor Green
}

if ($BuildInstaller) {
  Invoke-Step "Build Windows installer" "pnpm" @("--dir", "app", "run", "build:installer")
}

if ($IncludeWeb) {
  if (-not $SkipInstall) {
    Invoke-Step "Install web dependencies" "pnpm" @("--dir", "web", "install", "--frozen-lockfile")
  }
  Invoke-Step "Build web app" "pnpm" @("--dir", "web", "run", "build")
}

Write-Host ""
Write-Host "All requested Windows verification steps passed." -ForegroundColor Green
