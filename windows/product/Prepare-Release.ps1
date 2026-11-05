# Build a curated immutable JACO CODE payload. Run only on a clean GitHub Actions checkout.
param([string]$Destination = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'build\windows\payload'))
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$Destination = [System.IO.Path]::GetFullPath($Destination)
if ($Destination -eq $root -or -not $Destination.StartsWith((Join-Path $root 'build\windows') + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'PAYLOAD_DESTINATION_OUTSIDE_BUILD_DIRECTORY' }
$dist = Join-Path $root 'runtime\dist\server.cjs'
if (-not (Test-Path $dist)) { throw 'PRODUCTION_SERVER_NOT_BUILT' }
if (-not (Test-Path (Join-Path $root 'runtime\dist\index.html'))) { throw 'PRODUCTION_GUI_NOT_BUILT' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
if (-not $node) { throw 'NODE_NOT_FOUND' }
$version = & $node -p "require('./runtime/package.json').version"
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^\d+\.\d+\.\d+$') { throw 'INVALID_RUNTIME_VERSION' }
if (Test-Path $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
# Exactly the product's runtime, not the repository metadata, CI tokens, developer keys or workspaces.
$dirs = @('agents', 'gateway', 'runtime', 'skills', 'scripts', 'node_modules', 'public')
foreach ($name in $dirs) {
  $source = Join-Path $root $name
  if (-not (Test-Path $source)) { throw "RELEASE_DIRECTORY_MISSING:$name" }
  Copy-Item -LiteralPath $source -Destination (Join-Path $Destination $name) -Recurse -Force
}
foreach ($name in @('package.json', 'package-lock.json')) {
  Copy-Item -LiteralPath (Join-Path $root $name) -Destination (Join-Path $Destination $name) -Force
}
$nodeDir = Join-Path $Destination 'tools\node'
New-Item -ItemType Directory -Force -Path $nodeDir | Out-Null
Copy-Item -LiteralPath $node -Destination (Join-Path $nodeDir 'node.exe') -Force
# Guard against secrets or runtime state accidentally packaged by a future git change.
foreach ($dir in @((Join-Path $Destination 'agents'), (Join-Path $Destination 'gateway'), (Join-Path $Destination 'runtime'))) {
  Get-ChildItem -LiteralPath $dir -Recurse -Force -Directory |
    Where-Object { $_.Name -in @('.git', '.jaco', 'logs', '.agent-state', '.env') } |
    Sort-Object FullName -Descending | Remove-Item -Force -Recurse
}
Get-ChildItem -LiteralPath $Destination -Recurse -Force -File |
  Where-Object { $_.Name -in @('.env', '.env.local', '.env.production') -or $_.Name -like '*.pem' } |
  Remove-Item -Force
$nodeVersion = & (Join-Path $nodeDir 'node.exe') --version
Write-Host "JACO_WINDOWS_PAYLOAD_READY version=$version node=$nodeVersion"
