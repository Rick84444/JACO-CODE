$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $Root
$env:PORT = if ($env:PORT) { $env:PORT } else { "3000" }
$env:HOST = if ($env:HOST) { $env:HOST } else { "127.0.0.1" }

Write-Host "JACO Autonomus IDE 0.18.0-RC1" -ForegroundColor Cyan
Write-Host "Canonical GUI: JACO Autonomous IDE · http://127.0.0.1:$($env:PORT)"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is required." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is required." }

& node scripts/preflight_port.mjs
$Preflight = $LASTEXITCODE
if ($Preflight -eq 10) {
  Write-Host "Current JACO release is already running. Opening canonical GUI." -ForegroundColor Green
  Start-Process "http://127.0.0.1:$($env:PORT)/"
  exit 0
}
if ($Preflight -eq 20) {
  Write-Host "Port $($env:PORT) is occupied by another or unidentifiable runtime." -ForegroundColor Red
  try {
    Get-NetTCPConnection -State Listen -LocalPort ([int]$env:PORT) | ForEach-Object {
      $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
      Write-Host ("PID {0} · {1} · {2}" -f $_.OwningProcess, $p.ProcessName, $p.Path)
    }
  } catch {}
  Write-Host "JACO stopped fail-closed instead of hiding the JACO Autonomous IDE behind the wrong process." -ForegroundColor Yellow
  exit 20
}
if ($Preflight -ne 0) { throw "Port preflight failed with exit code $Preflight." }

if (-not (Test-Path "node_modules\tsx")) {
  Write-Host "Installing JavaScript dependencies (native install scripts disabled; SQLite has a runtime fallback)..." -ForegroundColor Cyan
  & npm ci --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
}

Write-Host "Building canonical JACO Autonomous IDE + runtime..." -ForegroundColor Cyan
& npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed; JACO will not start an unverified fallback GUI." }

$OpenJob = Start-Job -ScriptBlock {
  param($port)
  Start-Sleep -Seconds 3
  Start-Process "http://127.0.0.1:$port/"
} -ArgumentList $env:PORT

Write-Host "Starting JACO on $($env:HOST):$($env:PORT)..." -ForegroundColor Green
& npm run start
exit $LASTEXITCODE
