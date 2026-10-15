# Compatibility entry point; startup ownership is agents/start-all.ps1.
param([string]$RuntimeDir = '')
& (Join-Path $PSScriptRoot 'start-all.ps1') -RuntimeDir $RuntimeDir
