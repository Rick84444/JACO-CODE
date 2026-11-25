# Start an already installed llama.cpp/PrismML server as an inference provider for JACO/Aura.
# This is NOT another Aura runtime and does not install models, start JACO, change policies,
# allocate a new tool executor, kill processes or alter Windows environment persistently.
# Compatible with Windows PowerShell 5.1.
[CmdletBinding()]
param(
  [string]$ServerExe = '',
  [string]$ModelFile = '',
  [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$')][string]$Alias = 'bonsai-9b',
  [ValidateRange(1, 65535)][int]$Port = 8081,
  [ValidateRange(512, 65536)][int]$Context = 32000,
  [ValidateRange(0, 999)][int]$GpuLayers = 99,
  # One slot gives the whole context to one request. Aura sends one long prompt at a time; several slots split the shared context.
  [ValidateRange(1, 16)][int]$Parallel = 1,
  # Vision models: the multimodal projector (mmproj) file that belongs to the GGUF. Empty = text only.
  [string]$MmprojFile = '',
  # Extra llama-server arguments as one string, split on spaces, for example cache quantization: -ExtraArgs '-fa on -ctk q8_0 -ctv q8_0'
  [string]$ExtraArgs = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Join-Path $env:LOCALAPPDATA 'Bonsai9B-Test'
if ([string]::IsNullOrWhiteSpace($ServerExe)) {
  $binaryRoot = Join-Path $root 'bin'
  if (-not (Test-Path -LiteralPath $binaryRoot -PathType Container)) {
    throw "LOCAL_MODEL_SERVER_NOT_FOUND: pass -ServerExe or install the server under $binaryRoot"
  }
  $candidates = @(Get-ChildItem -LiteralPath $binaryRoot -Recurse -File -Filter 'llama-server.exe')
  if ($candidates.Count -ne 1) {
    throw "LOCAL_MODEL_SERVER_AMBIGUOUS: expected exactly one llama-server.exe; pass -ServerExe"
  }
  $ServerExe = $candidates[0].FullName
}
if ([string]::IsNullOrWhiteSpace($ModelFile)) {
  $ModelFile = Join-Path (Join-Path $root 'models') 'Ternary-Bonsai-2-9B-PQ2_0.gguf'
}
if (-not (Test-Path -LiteralPath $ServerExe -PathType Leaf)) {
  throw "LOCAL_MODEL_SERVER_NOT_FOUND: $ServerExe"
}
if (-not (Test-Path -LiteralPath $ModelFile -PathType Leaf)) {
  throw "LOCAL_MODEL_FILE_NOT_FOUND: $ModelFile"
}
$ServerExe = (Resolve-Path -LiteralPath $ServerExe).ProviderPath
if (-not [string]::IsNullOrWhiteSpace($MmprojFile)) {
  if (-not (Test-Path -LiteralPath $MmprojFile -PathType Leaf)) { throw "LOCAL_MODEL_MMPROJ_NOT_FOUND: $MmprojFile" }
  $MmprojFile = (Resolve-Path -LiteralPath $MmprojFile).ProviderPath
}
$ModelFile = (Resolve-Path -LiteralPath $ModelFile).ProviderPath

# Do not assume an existing listener belongs to this model or terminate another process.
$listener = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($listener.Count -gt 0) {
  throw "LOCAL_MODEL_PORT_OCCUPIED: $Port; inspect the port owner before starting another server"
}

Write-Host "Local model endpoint: http://127.0.0.1:$Port/v1"
Write-Host "Model alias: $Alias"
Write-Host "JACO_LLAMACPP_URL=http://127.0.0.1:$Port/v1"
Write-Host "JACO_LLAMACPP_MODEL_ALIAS=$Alias"
Write-Host 'Select this already running endpoint in Aura Connections; do not launch a second JACO instance.'
Write-Host 'The server remains in this terminal. Model listing alone does not prove native tool calling.'

$arguments = @(
  '-m', $ModelFile,
  '--alias', $Alias,
  '--host', '127.0.0.1',
  '--port', [string]$Port,
  '-ngl', [string]$GpuLayers,
  '-c', [string]$Context,
  '-np', [string]$Parallel,
  '--jinja'
)
if (-not [string]::IsNullOrWhiteSpace($MmprojFile)) { $arguments += @('--mmproj', $MmprojFile) }
if (-not [string]::IsNullOrWhiteSpace($ExtraArgs)) { $arguments += @($ExtraArgs.Trim() -split '\s+') }
Push-Location (Split-Path -Parent $ServerExe)
try {
  & $ServerExe @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "LOCAL_MODEL_SERVER_EXITED: llama-server returned exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}
