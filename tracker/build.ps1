$ErrorActionPreference = "Stop"

$TrackerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoDir = Split-Path -Parent $TrackerDir
$Venv = Join-Path $TrackerDir ".venv"
$PyInstaller = Join-Path $Venv "Scripts\pyinstaller.exe"
$Python = Join-Path $Venv "Scripts\python.exe"
$SpecFile = Join-Path $TrackerDir "dac_tracker.spec"
$BuildDir = Join-Path $TrackerDir "build"
$DistDir = Join-Path ([Environment]::GetFolderPath("Desktop")) ""

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

# Build
Write-Host "Building DACTracker.exe..." -ForegroundColor Cyan
& $PyInstaller $SpecFile --distpath $DistDir --workpath $BuildDir --noconfirm
if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed" }

Write-Host "Done! DACTracker.exe is on your Desktop." -ForegroundColor Green
