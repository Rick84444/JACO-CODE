# Uninstaller hook: stop only this installation's health guardian, not any user Node processes.
$ErrorActionPreference = 'SilentlyContinue'
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$RecordPath = Join-Path $env:LOCALAPPDATA 'JACO\logs\startup\health-guardian.json'
if (-not (Test-Path -LiteralPath $RecordPath)) { exit 0 }
$record = Get-Content -LiteralPath $RecordPath -Raw | ConvertFrom-Json
if (-not $record.pid -or -not $record.birth) { exit 0 }
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$record.pid)"
if (-not $process) { Remove-Item -LiteralPath $RecordPath -Force; exit 0 }
$actualBirth = $process.CreationDate.ToUniversalTime().ToString('o')
$command = [string]$process.CommandLine
if ($actualBirth -eq [string]$record.birth -and $command.Contains('health-guardian.mjs') -and $command.Contains($Root)) {
  Stop-Process -Id ([int]$record.pid) -Force
  Remove-Item -LiteralPath $RecordPath -Force
}
