$ErrorActionPreference = "Stop"

# ── Paths ────────────────────────────────────────────────────────────────────

$BackendDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Split-Path -Parent $BackendDir
$RepoDir = Split-Path -Parent $AppDir
$Venv = Join-Path $BackendDir ".venv"
$PyInstaller = Join-Path $Venv "Scripts\pyinstaller.exe"
$Python = Join-Path $Venv "Scripts\python.exe"
$SpecFile = Join-Path $BackendDir "dac_tracker.spec"
$BuildDir = Join-Path $BackendDir "build"

# ── Validate ─────────────────────────────────────────────────────────────────

Write-Host "Validating build environment..." -ForegroundColor Cyan
$RequiredPaths = [ordered]@{
    "Data directory"    = Join-Path $RepoDir "data"
    "Icons directory"   = Join-Path $RepoDir "data\icons"
    "units.json"        = Join-Path $RepoDir "data\units.json"
    "items.json"        = Join-Path $RepoDir "data\items.json"
    "relics.json"       = Join-Path $RepoDir "data\relics.json"
    "prompts directory" = Join-Path $BackendDir "prompts"
    "spec file"         = $SpecFile
    "app directory"     = $AppDir
    "package.json"      = Join-Path $AppDir "package.json"
}
$ValidationFailed = $false
foreach ($entry in $RequiredPaths.GetEnumerator()) {
    if (-not (Test-Path $entry.Value)) {
        Write-Host "  [MISSING] $($entry.Key): $($entry.Value)" -ForegroundColor Red
        $ValidationFailed = $true
    }
}
if ($ValidationFailed) { throw "Build environment validation failed." }
Write-Host "  Environment OK." -ForegroundColor Green

# ── Pull latest ──────────────────────────────────────────────────────────────

Write-Host "Pulling latest changes..." -ForegroundColor Cyan
git -C $RepoDir pull
if ($LASTEXITCODE -ne 0) { throw "git pull failed" }

# ── Python venv + deps ───────────────────────────────────────────────────────

if (-not (Test-Path $Python)) {
    Write-Host "Creating venv..." -ForegroundColor Cyan
    uv venv $Venv
    if ($LASTEXITCODE -ne 0) { throw "uv venv failed" }
}

Write-Host "Installing Python dependencies..." -ForegroundColor Cyan
uv pip install --python $Python pyinstaller -r (Join-Path $BackendDir "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "uv pip install failed" }

# ── Kill running instance ────────────────────────────────────────────────────

$running = Get-Process -Name "DAC Tracker" -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "Killing running DAC Tracker (pid $($running.Id))..." -ForegroundColor Yellow
    Stop-Process -Name "DAC Tracker" -Force
    Start-Sleep -Seconds 1
}

# ── Build headless backend with PyInstaller ──────────────────────────────────

Write-Host ""
Write-Host "=== Step 1/3: Building headless backend ===" -ForegroundColor Magenta

if (Test-Path $BuildDir) {
    Write-Host "Cleaning build cache..." -ForegroundColor Cyan
    Remove-Item -Recurse -Force $BuildDir
}

& $PyInstaller $SpecFile --workpath $BuildDir --noconfirm --clean
if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed" }

$HeadlessDir = Join-Path $BackendDir "dist\headless"
if (-not (Test-Path (Join-Path $HeadlessDir "headless.exe"))) {
    throw "headless.exe not found in $HeadlessDir"
}
Write-Host "  headless.exe built OK." -ForegroundColor Green

# ── Build Electron frontend ──────────────────────────────────────────────────

Write-Host ""
Write-Host "=== Step 2/3: Building Electron frontend ===" -ForegroundColor Magenta

Push-Location $AppDir
try {
    # Install node deps if needed
    if (-not (Test-Path (Join-Path $AppDir "node_modules"))) {
        Write-Host "Installing node dependencies..." -ForegroundColor Cyan
        pnpm install
        if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
    }

    # Build Vite frontend
    Write-Host "Building Vite frontend..." -ForegroundColor Cyan
    pnpm run build
    if ($LASTEXITCODE -ne 0) { throw "vite build failed" }
} finally {
    Pop-Location
}
Write-Host "  Frontend built OK." -ForegroundColor Green

# ── Package installer with electron-builder ──────────────────────────────────

Write-Host ""
Write-Host "=== Step 3/3: Packaging installer ===" -ForegroundColor Magenta

Push-Location $AppDir
try {
    pnpm exec electron-builder --win --config electron-builder.json
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
} finally {
    Pop-Location
}

$ReleaseDir = Join-Path $AppDir "release"
Write-Host ""
Write-Host "Done! Installer is in:" -ForegroundColor Green
Write-Host "  $ReleaseDir" -ForegroundColor White
Write-Host ""
Get-ChildItem $ReleaseDir -Filter "*.exe" | ForEach-Object {
    $sizeMB = [math]::Round($_.Length / 1MB, 1)
    Write-Host "  $($_.Name) ($sizeMB MB)" -ForegroundColor White
}

# ── Publish release to public repo ──────────────────────────────────────────

$PackageJson = Get-Content (Join-Path $AppDir "package.json") -Raw | ConvertFrom-Json
$Version = "v$($PackageJson.version)"
$PublicRepo = "jackthb/dac-tracker"

Write-Host ""
Write-Host "Publish $Version to $PublicRepo? (y/N)" -ForegroundColor Yellow -NoNewline
$answer = Read-Host " "
if ($answer -eq "y" -or $answer -eq "Y") {
    Write-Host "Publishing $Version to $PublicRepo..." -ForegroundColor Cyan
    $installers = Get-ChildItem $ReleaseDir -Filter "*.exe"
    $ghArgs = @("release", "create", $Version, "--repo", $PublicRepo, "--title", $Version, "--generate-notes")
    foreach ($file in $installers) {
        $ghArgs += $file.FullName
    }
    & gh @ghArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Release publish failed." -ForegroundColor Red
    } else {
        Write-Host "  Published: https://github.com/$PublicRepo/releases/tag/$Version" -ForegroundColor Green
    }
} else {
    Write-Host "  Skipped release publish." -ForegroundColor Gray
}
