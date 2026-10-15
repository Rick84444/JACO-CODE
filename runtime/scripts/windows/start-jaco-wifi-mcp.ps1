$ErrorActionPreference = 'Stop'
$Bootstrap = Join-Path $PSScriptRoot 'bootstrap-jaco-autonomous.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Bootstrap -SkipChromeLaunch -SkipBuild
exit $LASTEXITCODE
