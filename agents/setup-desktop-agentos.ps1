param(
  [string]$RepoRoot = (Split-Path $PSScriptRoot -Parent),
  [switch]$InstallDependencies
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') { throw 'Desktop AgentOS setup requires Windows.' }
$RepoRoot = (Resolve-Path $RepoRoot).Path
$EnvPath = Join-Path $RepoRoot '.env'
$RuntimeName = 'runtime'
$RuntimeRoot = Join-Path $RepoRoot $RuntimeName
$UiaBridge = Join-Path $RuntimeRoot 'scripts\windows\jaco-uia-bridge.ps1'

function Require-Node24 {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) { throw 'Node.js 24 or newer is required and was not found in PATH.' }
  $major = [int](& $node.Source -p "process.versions.node.split('.')[0]")
  if ($major -lt 24) { throw "Node.js 24 or newer is required. Found major version $major." }
  return $node.Source
}

function New-StringList {
  return New-Object 'System.Collections.Generic.List[string]'
}

function Read-EnvLines {
  $lines = New-StringList
  if (Test-Path $EnvPath) {
    foreach ($line in Get-Content $EnvPath) { [void]$lines.Add([string]$line) }
  }
  return $lines
}

function Get-EnvValue([System.Collections.Generic.List[string]]$Lines, [string]$Key) {
  foreach ($line in $Lines) {
    if ($line -match ('^\s*' + [regex]::Escape($Key) + '=(.*)$')) { return $Matches[1].Trim() }
  }
  return $null
}

function Set-EnvValue([System.Collections.Generic.List[string]]$Lines, [string]$Key, [string]$Value) {
  for ($i = 0; $i -lt $Lines.Count; $i++) {
    if ($Lines[$i] -match ('^\s*' + [regex]::Escape($Key) + '=')) {
      $Lines[$i] = "$Key=$Value"
      return
    }
  }
  [void]$Lines.Add("$Key=$Value")
}

function New-GatewayToken {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) }
  finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}

$Node = Require-Node24
if (-not (Test-Path (Join-Path $RuntimeRoot 'package.json'))) { throw "Runtime package is missing: $RuntimeRoot" }
if (-not (Test-Path $UiaBridge)) { throw "Windows UI Automation bridge is missing: $UiaBridge" }
if (-not (Test-Path (Join-Path $RepoRoot 'agents\desktop-agentos.mjs'))) { throw 'agents/desktop-agentos.mjs is missing.' }
if (-not (Test-Path (Join-Path $RepoRoot 'agents\run-desktop-agentos.mjs'))) { throw 'agents/run-desktop-agentos.mjs is missing.' }
if (-not (Test-Path (Join-Path $RepoRoot 'agents\lib\windows-wmi-read.mjs'))) { throw 'agents/lib/windows-wmi-read.mjs is missing.' }
if (-not (Test-Path (Join-Path $RepoRoot 'agents\windows-wmi-read.ps1'))) { throw 'agents/windows-wmi-read.ps1 is missing.' }

& $Node --check (Join-Path $RepoRoot 'agents\desktop-agentos.mjs')
if ($LASTEXITCODE -ne 0) { throw 'desktop-agentos.mjs failed Node syntax validation.' }
& $Node --check (Join-Path $RepoRoot 'agents\run-desktop-agentos.mjs')
if ($LASTEXITCODE -ne 0) { throw 'run-desktop-agentos.mjs failed Node syntax validation.' }
& $Node --check (Join-Path $RepoRoot 'agents\lib\windows-wmi-read.mjs')
if ($LASTEXITCODE -ne 0) { throw 'windows-wmi-read.mjs failed Node syntax validation.' }

$lines = Read-EnvLines
$token = Get-EnvValue $lines 'JACO_GATEWAY_TOKEN'
if (-not $token -or $token.Length -lt 24) {
  $token = New-GatewayToken
  Set-EnvValue $lines 'JACO_GATEWAY_TOKEN' $token
}

Set-EnvValue $lines 'JACO_RUNTIME_DIR' $RuntimeName
Set-EnvValue $lines 'JACO_RUNTIME_URL' 'http://127.0.0.1:3000'
Set-EnvValue $lines 'SEER_URL' 'http://127.0.0.1:2997'
Set-EnvValue $lines 'JACO_EXECUTOR' 'desktop-agentos'
Set-EnvValue $lines 'JACO_ALLOW_COORDINATE_FALLBACK' '0'
Set-EnvValue $lines 'JACO_ALLOW_SHELL_TASKS' '1'
Set-EnvValue $lines 'JACO_LEVEL5_AUTONOMY' '1'
Set-EnvValue $lines 'JACO_REMOTE_ALLOW_MUTATIONS' '1'

$requiredTasks = @('detect-surfaces','health-check','check-revenue','browser-survey-site','browser-click','browser-type','desktop-windows','desktop-observe','desktop-action','desktop-invoke','windows-wmi-read','screenshot','get-cursor','invoke-worker','shell','repo-list','repo-read','repo-write','repo-test','git-status','git-diff','git-commit','git-push','git-merge')
$currentTasks = Get-EnvValue $lines 'JACO_NOVA_ALLOWED_TASKS'
$tasks = New-StringList
if ($currentTasks) {
  foreach ($item in ($currentTasks -split ',')) {
    $value = $item.Trim()
    if ($value -and -not $tasks.Contains($value)) { [void]$tasks.Add($value) }
  }
}
foreach ($task in $requiredTasks) { if (-not $tasks.Contains($task)) { [void]$tasks.Add($task) } }
Set-EnvValue $lines 'JACO_NOVA_ALLOWED_TASKS' ($tasks -join ',')

[System.IO.File]::WriteAllLines($EnvPath, $lines.ToArray(), (New-Object System.Text.UTF8Encoding($false)))

if ($InstallDependencies) {
  Push-Location $RuntimeRoot
  try {
    if (Test-Path (Join-Path $RuntimeRoot 'package-lock.json')) { & npm.cmd ci }
    else { & npm.cmd install }
    if ($LASTEXITCODE -ne 0) { throw 'Runtime dependency installation failed.' }
  } finally { Pop-Location }
}

Write-Host ''
Write-Host 'Desktop AgentOS setup completed.' -ForegroundColor Green
Write-Host "Repository: $RepoRoot"
Write-Host "Runtime:    $RuntimeRoot"
Write-Host "UIA bridge: $UiaBridge"
Write-Host "Config:     $EnvPath"
Write-Host 'Gateway token is configured but is not printed.'
Write-Host ''
Write-Host 'Next:' -ForegroundColor Cyan
Write-Host '  1. Start the stack: .\agents\start-all.ps1'
Write-Host '  2. The durable Level-5 mandate is created by the runtime; use grant-desktop-agentos.ps1 only to narrow a specific desktop process scope.'
Write-Host '  3. Submit one operator goal through Aura/SEER; Git, shell, web and verified execution are pre-authorized.'
Write-Host ''
Write-Host 'Coordinate fallback remains disabled. Local shell is available only when an explicit mission requests it.' -ForegroundColor Yellow
