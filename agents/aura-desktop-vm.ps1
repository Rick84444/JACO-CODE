<#
  JACO Aura Desktop — operator-side Hyper-V viewer and start preflight.

  This is NOT a second agent or control plane. It deliberately never creates
  VMs, mounts host disks, changes network rules, provisions credentials or
  executes commands in the guest. The canonical JACO Runtime runs in exactly
  one chosen environment; VMConnect is only an operator-viewer surface.

  Usage from a Windows Hyper-V host:
    powershell -NoProfile -File agents/aura-desktop-vm.ps1 -Action Status
    powershell -NoProfile -File agents/aura-desktop-vm.ps1 -Action Start
    powershell -NoProfile -File agents/aura-desktop-vm.ps1 -Action Open

  A pre-created, separately configured VM named JACO-Aura-Desktop is required.
#>
[CmdletBinding()]
param(
  [ValidateSet('Status', 'Start', 'Open')][string]$Action = 'Status',
  [ValidatePattern('^[A-Za-z][A-Za-z0-9_.-]{0,63}$')][string]$VMName = 'JACO-Aura-Desktop'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-State([string]$State, [string]$Reason, [string]$VMState, [string]$Display) {
  [ordered]@{
    schema = 'jaco.aura-desktop-vm/v1'
    state = $State
    reason = $Reason
    vmName = $VMName
    vmState = $VMState
    viewer = $Display
    guestRuntime = 'UNVERIFIED'
    guestDesktopEvidence = 'UNVERIFIED'
    networkIsolation = 'UNVERIFIED'
    hostFileRedirection = 'UNVERIFIED'
    singleAura = 'REQUIRES_OPERATOR_CONFIGURATION'
  } | ConvertTo-Json -Compress
}

if (-not (Get-Command Get-VM -ErrorAction SilentlyContinue)) {
  Write-State 'BLOCKED' 'HYPERV_MODULE_UNAVAILABLE' 'UNKNOWN' 'UNAVAILABLE'
  exit 2
}

try {
  $vm = Get-VM -Name $VMName -ErrorAction Stop
} catch {
  Write-State 'BLOCKED' 'AURA_DESKTOP_VM_NOT_FOUND' 'UNKNOWN' 'UNAVAILABLE'
  exit 3
}

$viewerPath = Join-Path $env:WINDIR 'System32\vmconnect.exe'
if (-not (Test-Path -LiteralPath $viewerPath -PathType Leaf)) {
  $viewerPath = Join-Path $env:WINDIR 'Sysnative\vmconnect.exe'
}

$vmState = [string]$vm.State
if ($Action -eq 'Status') {
  $display = if (Test-Path -LiteralPath $viewerPath -PathType Leaf) { 'AVAILABLE' } else { 'UNAVAILABLE' }
  Write-State 'OBSERVED' 'HYPERV_VM_STATE_ONLY' $vmState $display
  exit 0
}

if ($Action -eq 'Start') {
  if ($vmState -eq 'Off') {
    try {
      Start-VM -VM $vm -ErrorAction Stop | Out-Null
      $vm = Get-VM -Name $VMName -ErrorAction Stop
      $vmState = [string]$vm.State
    } catch {
      Write-State 'BLOCKED' 'HYPERV_START_FAILED' $vmState 'UNVERIFIED'
      exit 4
    }
  } elseif ($vmState -ne 'Running') {
    Write-State 'BLOCKED' 'HYPERV_VM_NOT_STARTABLE' $vmState 'UNVERIFIED'
    exit 5
  }
  Write-State 'START_REQUESTED' 'GUEST_HEALTH_NOT_YET_ATTESTED' $vmState 'NOT_OPENED'
  exit 0
}

if ($vmState -ne 'Running') {
  Write-State 'BLOCKED' 'VM_MUST_BE_RUNNING_TO_OPEN' $vmState 'NOT_OPENED'
  exit 6
}
if (-not (Test-Path -LiteralPath $viewerPath -PathType Leaf)) {
  Write-State 'BLOCKED' 'VMCONNECT_UNAVAILABLE' $vmState 'UNAVAILABLE'
  exit 7
}
try {
  # Windows VMConnect is an independent screen window, not a browser/CDP tab.
  # The VMName validation above intentionally forbids argument metacharacters.
  Start-Process -FilePath $viewerPath -ArgumentList @('localhost', $VMName) -ErrorAction Stop | Out-Null
  Write-State 'OPEN_REQUESTED' 'VIEWER_LAUNCH_IS_NOT_GUEST_READINESS' $vmState 'OPEN_REQUESTED'
} catch {
  Write-State 'BLOCKED' 'VMCONNECT_LAUNCH_FAILED' $vmState 'FAILED'
  exit 8
}
