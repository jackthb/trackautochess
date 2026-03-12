$ErrorActionPreference = "Stop"

$TrackerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoDir = Split-Path -Parent $TrackerDir
$Venv = Join-Path $TrackerDir ".venv"
$PyInstaller = Join-Path $Venv "Scripts\pyinstaller.exe"
$Python = Join-Path $Venv "Scripts\python.exe"
$SpecFile = Join-Path $TrackerDir "dac_tracker.spec"
$BuildDir = Join-Path $TrackerDir "build"
$DistDir = Join-Path ([Environment]::GetFolderPath("Desktop")) ""

# Validate build environment before starting
Write-Host "Validating build environment..." -ForegroundColor Cyan
$RequiredPaths = [ordered]@{
    "Data directory"    = Join-Path $RepoDir "data"
    "icons directory"   = Join-Path $RepoDir "data\icons"
    "units.json"        = Join-Path $RepoDir "data\units.json"
    "items.json"        = Join-Path $RepoDir "data\items.json"
    "relics.json"       = Join-Path $RepoDir "data\relics.json"
    "prompts directory" = Join-Path $TrackerDir "prompts"
    "spec file"         = $SpecFile
}
$ValidationFailed = $false
foreach ($entry in $RequiredPaths.GetEnumerator()) {
    if (-not (Test-Path $entry.Value)) {
        Write-Host "  [MISSING] $($entry.Key): $($entry.Value)" -ForegroundColor Red
        $ValidationFailed = $true
    }
}
if ($ValidationFailed) { throw "Build environment validation failed - one or more required paths are missing." }

$DacConsoleRaw = $env:DAC_CONSOLE
if ($DacConsoleRaw -and $DacConsoleRaw -notin @("0", "1")) {
    throw "DAC_CONSOLE must be '0' or '1', got '$DacConsoleRaw'"
}

Write-Host "  Environment OK." -ForegroundColor Green

# Pull latest
Write-Host "Pulling latest changes..." -ForegroundColor Cyan
git -C $RepoDir pull
if ($LASTEXITCODE -ne 0) { throw "git pull failed" }

# Create venv if missing
if (-not (Test-Path $Python)) {
    Write-Host "Creating venv..." -ForegroundColor Cyan
    uv venv $Venv
    if ($LASTEXITCODE -ne 0) { throw "uv venv failed" }
}

# Install/update dependencies
Write-Host "Installing dependencies..." -ForegroundColor Cyan
uv pip install --python $Python pyinstaller -r (Join-Path $TrackerDir "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "uv pip install failed" }

# Kill running DACTracker so PyInstaller can overwrite the exe
$running = Get-Process -Name "DACTracker" -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "Killing running DACTracker (pid $($running.Id))..." -ForegroundColor Yellow
    Stop-Process -Name "DACTracker" -Force
    Start-Sleep -Seconds 1
}

# Clean previous build cache so PyInstaller picks up all changes
if (Test-Path $BuildDir) {
    Write-Host "Cleaning build cache..." -ForegroundColor Cyan
    Remove-Item -Recurse -Force $BuildDir
}

# Build
Write-Host "Building DACTracker.exe..." -ForegroundColor Cyan
& $PyInstaller $SpecFile --distpath $DistDir --workpath $BuildDir --noconfirm --clean
if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed" }

Write-Host "Done! DACTracker.exe is on your Desktop." -ForegroundColor Green
