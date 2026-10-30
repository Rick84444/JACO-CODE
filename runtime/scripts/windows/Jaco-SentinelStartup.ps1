# Installs or removes a per-user Startup shortcut for the existing Windows Sentinel receiver.
# Explicit operator action required: this script never runs at login unless installed locally.
[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$Remove,
  [switch]$Status
)
$ErrorActionPreference = 'Stop'
if ((@([bool]$Install, [bool]$Remove, [bool]$Status) | Where-Object { $_ }).Count -ne 1) {
  throw 'Specify exactly one of -Install, -Remove, or -Status'
}
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$receiver = Join-Path $root 'runtime\bin\sentinel-windows.mjs'
$startup = [Environment]::GetFolderPath('Startup')
$link = Join-Path $startup 'JACO Sentinel.lnk'
$expected = '"'+$receiver+'"'
$ws = New-Object -ComObject WScript.Shell

if ($Status) {
  $exists = Test-Path -LiteralPath $link
  $owned = $false
  if ($exists) {
    $shortcut = $ws.CreateShortcut($link)
    $owned = $shortcut.Arguments -eq $expected
  }
  [pscustomobject]@{Installed=$exists;MatchesThisRepo=$owned;ReceiverExists=(Test-Path -LiteralPath $receiver)}
  return
}

if ($Remove) {
  if (-not (Test-Path -LiteralPath $link)) { Write-Output 'JACO Sentinel startup is not installed';return }
  $shortcut = $ws.CreateShortcut($link)
  if ($shortcut.Arguments -ne $expected) { throw 'STARTUP_SHORTCUT_OWNERSHIP_MISMATCH: refusing to delete another installation' }
  Remove-Item -LiteralPath $link -Force
  Write-Output 'Removed this repository JACO Sentinel startup shortcut'
  return
}

if (-not (Test-Path -LiteralPath $receiver)) {
  throw 'WINDOWS_SENTINEL_RECEIVER_MISSING: commit and install sentinel-windows.mjs before enabling startup'
}
if (Test-Path -LiteralPath $link) {
  $existing=$ws.CreateShortcut($link)
  if ($existing.Arguments -ne $expected) {
    throw 'STARTUP_SHORTCUT_OWNERSHIP_MISMATCH: refusing to overwrite another installation'
  }
}
$node = (Get-Command node -ErrorAction Stop).Source
$shortcut = $ws.CreateShortcut($link)
$shortcut.TargetPath=$node
$shortcut.Arguments=$expected
$shortcut.WorkingDirectory=$root
$shortcut.Description='JACO Sentinel — authenticated fixed-verb control receiver (per-user startup)'
$shortcut.WindowStyle=7
$shortcut.Save()
Write-Output 'Registered JACO Sentinel on Windows user login. No reboot was performed.'
