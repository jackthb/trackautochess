param(
    [string]$Scenario = "dac-active",
    [int]$Seconds = 300,
    [string]$ProcessName = "dota2.exe",
    [string]$OutputDir = "presentmon-runs",
    [switch]$Admin
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$presentMon = Join-Path $repoRoot "tools\presentmon\PresentMon.exe"

if (!(Test-Path $presentMon)) {
    throw "PresentMon.exe not found at $presentMon. Download it to tools\presentmon\PresentMon.exe first."
}

if ($Seconds -lt 1) {
    throw "Seconds must be >= 1."
}

$safeScenario = $Scenario -replace '[^a-zA-Z0-9_.-]', '-'
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDirPath = Join-Path $repoRoot $OutputDir
New-Item -ItemType Directory -Force -Path $outDirPath | Out-Null

$outputFile = Join-Path $outDirPath "$stamp-$safeScenario-$ProcessName.csv"

$argsList = @(
    "--process_name", $ProcessName,
    "--output_file", $outputFile,
    "--timed", $Seconds,
    "--terminate_after_timed",
    "--date_time",
    "--stop_existing_session"
)

if ($Admin) {
    $argsList += "--restart_as_admin"
}

Write-Host "Capturing $ProcessName FPS for $Seconds seconds"
Write-Host "Scenario: $Scenario"
Write-Host "Output: $outputFile"
Write-Host ""

& $presentMon @argsList
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    throw "PresentMon exited with code $exitCode. If it missed data, try rerunning with -Admin or from an Administrator terminal."
}

Write-Host ""
Write-Host "Capture complete: $outputFile"
