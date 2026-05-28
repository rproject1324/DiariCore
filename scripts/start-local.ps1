param(
    [string]$WebPort = "5000",
    [string]$DatabasePath = "diaricore.local.db"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$activatePath = Join-Path $repoRoot ".venv\Scripts\Activate.ps1"
$venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
$webUrl = "http://127.0.0.1:$WebPort"
$webHealthUrl = "http://127.0.0.1:$WebPort/api/health"

Write-Host "Starting DiariCore web app..."
Write-Host "Web: $webUrl"
Write-Host "DB:  $DatabasePath"
Write-Host "Mood: HF Space (see SPACE_URL in space_nlp.py)"

$webCommand = @"
cd '$repoRoot'
if (Test-Path '$activatePath') { . '$activatePath' }
`$env:PORT = '$WebPort'
`$env:DATABASE_PATH = '$DatabasePath'
if (Test-Path '$venvPython') { & '$venvPython' app.py } elseif (Get-Command python -ErrorAction SilentlyContinue) { python app.py } elseif (Get-Command py -ErrorAction SilentlyContinue) { py -3 app.py } else { Write-Error 'Python runtime not found.'; exit 1 }
"@

Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $webCommand | Out-Null

function Test-HttpUp([string]$url, [int]$timeoutSec = 25) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
            if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
                return $true
            }
        } catch {
            Start-Sleep -Milliseconds 700
        }
    }
    return $false
}

$webUp = Test-HttpUp -url $webHealthUrl -timeoutSec 25

Write-Host ""
Write-Host "Web health: $webHealthUrl => $webUp"
if (-not $webUp) {
    Write-Host "Web app did not respond yet. Check the terminal for errors." -ForegroundColor Yellow
}
