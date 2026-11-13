# JACO CODE installed Windows launcher. Always runs unelevated after setup.
# Code is installed under Program Files; secrets, workspaces and logs stay under LocalAppData.
param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$InstallRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$Node = Join-Path $InstallRoot 'tools\node\node.exe'
$DataRoot = Join-Path $env:LOCALAPPDATA 'JACO'
$EnvPath = Join-Path $DataRoot '.env'
if (-not (Test-Path -LiteralPath $Node)) { throw "JACO bundled Node.js is missing: $Node" }
if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot 'runtime\dist\server.cjs'))) { throw 'JACO production runtime is missing.' }
New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot 'logs\startup') | Out-Null

# Preserve existing credentials/settings on upgrades. Do not make a writable .env in Program Files.
if (-not (Test-Path -LiteralPath $EnvPath)) {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
  $settings = @(
    "JACO_GATEWAY_TOKEN=$token",
    'JACO_RUNTIME_DIR=runtime',
    'JACO_START_MODE=production',
    # JACO starts its GUI without assuming that Ollama is installed. Models connect through GUI.
    'JACO_MODEL_PROVIDER=aura'
  )
  [System.IO.File]::WriteAllLines($EnvPath, $settings, (New-Object System.Text.UTF8Encoding($false)))
}
$env:JACO_DATA_DIR = $DataRoot
$env:JACO_START_MODE = 'production'
$env:JACO_INSTALLED = '1'
$env:JACO_NODE_EXECUTABLE = $Node
$env:PATH = (Split-Path $Node -Parent) + [System.IO.Path]::PathSeparator + $env:PATH
$entry = Join-Path $InstallRoot 'agents\lib\local-stack.mjs'
$args = @($entry)
if (-not $NoBrowser) { $args += '--open' }
# Independent unelevated monitor survives closing the GUI; its PID/birth lock prevents duplicates.
$guardian = Join-Path $InstallRoot 'agents\lib\health-guardian.mjs'
if (Test-Path -LiteralPath $guardian) {
  try {
    $quotedGuardian = '"' + $guardian + '"'
    Start-Process -FilePath $Node -ArgumentList $quotedGuardian -WorkingDirectory $InstallRoot -WindowStyle Hidden
  } catch {
    Add-Content -Path (Join-Path $DataRoot 'logs\startup\launcher.log') -Value ('GUARDIAN_LAUNCH_FAILED: ' + $_.Exception.Message)
  }
}
Push-Location $InstallRoot
try {
  & $Node @args 2>&1 | Out-File -FilePath (Join-Path $DataRoot 'logs\startup\launcher.log') -Encoding utf8 -Append
  if ($LASTEXITCODE -ne 0) {
    # Optional model/CDP workers may be unavailable on first install. Accept DEGRADED
    # onboarding only if Core is really owned by the installed product, never by another checkout.
    $validCore = $false
    try {
      $receipt = Get-Content (Join-Path $DataRoot 'logs\startup\runtime.process.json') -Raw | ConvertFrom-Json
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$receipt.pid)" -ErrorAction Stop
      $identity = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/runtime/identity' -TimeoutSec 5
      $expected = (Get-Content (Join-Path $InstallRoot 'runtime\CURRENT_RELEASE.json') -Raw | ConvertFrom-Json).releaseId
      $validCore = ($process -and $process.CommandLine.Contains($InstallRoot) -and $identity.success -eq $true -and $identity.releaseId -eq $expected)
    } catch {}
    if (-not $validCore) { throw "JACO startup blocked (exit $LASTEXITCODE). See $DataRoot\logs\startup\launcher.log" }
    Add-Content -Path (Join-Path $DataRoot 'logs\startup\launcher.log') -Value 'JACO Core is available for onboarding. Optional services are not fully READY.'
  }
} finally { Pop-Location }
