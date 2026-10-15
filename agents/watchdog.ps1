# Compatibility monitor: the canonical launcher owns all readiness and recovery.
param([int]$IntervalSeconds = 60, [switch]$Once)
$ErrorActionPreference = 'Stop'
if ($IntervalSeconds -lt 5) { throw 'WATCHDOG_INTERVAL_TOO_SHORT' }
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskLogs = Join-Path $taskRoot 'logs'
New-Item -ItemType Directory -Force $taskLogs | Out-Null
do {
  try {
    & (Join-Path $PSScriptRoot 'start-all.ps1')
    Add-Content -LiteralPath (Join-Path $taskLogs 'watchdog.log') -Value ((Get-Date -Format o) + ' READY canonical local startup')
  } catch {
    Add-Content -LiteralPath (Join-Path $taskLogs 'watchdog.log') -Value ((Get-Date -Format o) + ' BLOCKED ' + $_.Exception.Message)
  }
  if ($Once) { break }
  Start-Sleep -Seconds $IntervalSeconds
} while ($true)
