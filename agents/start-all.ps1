# JACO canonical Windows startup. All entry points delegate to the same owner.
param([switch]$PreflightOnly, [switch]$Status, [switch]$Open, [string]$RuntimeDir = '')
$ErrorActionPreference = 'Stop'
$proj = Split-Path $PSScriptRoot -Parent
$taskArgs = @((Join-Path $PSScriptRoot 'lib/local-stack.mjs'))
if ($PreflightOnly) { $taskArgs += '--preflight' }
elseif ($Status) { $taskArgs += '--status' }
if ($Open) { $taskArgs += '--open' }
if ($RuntimeDir) { $taskArgs += @('--runtime', $RuntimeDir) }
& node @taskArgs
if ($LASTEXITCODE -ne 0) { throw 'JACO_STARTUP_BLOCKED: see logs/startup/status.json and service logs.' }
