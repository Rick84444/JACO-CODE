<#
  Aura Desktop real-guest acceptance probe (read-only).
  Run INSIDE the interactive Windows Hyper-V guest, after connecting your
  Chrome Remote Desktop viewer to that same guest.

  This does not provision a VM, install software, issue a mission, inject input
  or approve a mandate. Mission completion must be proven separately through
  the existing Mission Bus and independent output evidence.

  Usage:
    powershell -NoProfile -File agents/aura-desktop-acceptance.ps1
    powershell -NoProfile -File agents/aura-desktop-acceptance.ps1 `
      -MissionId mission-example -ExpectedFile C:\guest\result.txt -ExpectedSha256 <sha256>

  Use only an operator-owned guest. Do not upload this output or desktop pixels
  to a public issue / CI log; it represents a local acceptance observation.
#>
[CmdletBinding()]
param(
  [ValidateRange(1,65535)][int]$RuntimePort = 3000,
  [ValidatePattern('^mission-[A-Za-z0-9-]{1,120}$')][string]$MissionId = '',
  [string]$ExpectedFile = '',
  [ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256 = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$report = [ordered]@{
  schema = 'jaco.aura-desktop-acceptance/v1'
  observedAt = [DateTimeOffset]::UtcNow.ToString('o')
  platform = 'WINDOWS'
  guest = 'UNVERIFIED'
  interactiveSession = 'UNVERIFIED'
  win32Capture = 'UNVERIFIED'
  canonicalRuntime = 'UNVERIFIED'
  desktopUiAutomation = 'UNVERIFIED'
  missionEvidence = 'UNVERIFIED'
  independentOutput = 'UNVERIFIED'
  chromeRemoteViewer = 'REQUIRES_OPERATOR_LIVE_OBSERVATION'
  liveAcceptance = 'NOT_VERIFIED'
  blockers = @()
}
function Add-Blocker([string]$Message) {
  $script:report.blockers = @($script:report.blockers) + @($Message)
}
function Probe-Runtime([string]$Route) {
  $headers = @{}
  $token = if ($env:JACO_GATEWAY_TOKEN) { $env:JACO_GATEWAY_TOKEN } else { $env:GATEWAY_TOKEN }
  if ($token) { $headers['x-gateway-token'] = $token }
  # Never print or persist the response headers, token or raw mission receipts.
  return Invoke-RestMethod -Method Get -Uri ("http://127.0.0.1:{0}{1}" -f $RuntimePort,$Route) -Headers $headers -TimeoutSec 8 -ErrorAction Stop
}
if ($env:OS -ne 'Windows_NT') {
  Add-Blocker 'WINDOWS_GUEST_REQUIRED'
} else {
  try {
    $system = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
    if ($system.Manufacturer -eq 'Microsoft Corporation' -and $system.Model -eq 'Virtual Machine') {
      $report.guest = 'OBSERVED_HYPERV_GUEST'
    } else {
      Add-Blocker 'HYPERV_GUEST_IDENTITY_NOT_VERIFIED'
    }
  } catch { Add-Blocker 'WINDOWS_CIM_UNAVAILABLE' }

  try {
    $bridge = Join-Path $PSScriptRoot 'input-bridge.ps1'
    if (-not (Test-Path -LiteralPath $bridge -PathType Leaf)) { throw 'INPUT_BRIDGE_MISSING' }
    $raw = & powershell.exe -NoProfile -NonInteractive -File $bridge -Op session_status | Select-Object -Last 1
    $session = $raw | ConvertFrom-Json -ErrorAction Stop
    if ($session.schema -ne 'jaco.desktop-session/v1' -or
        $session.ok -ne $true -or $session.verified -ne $true -or
        $session.interactive -ne $true -or $session.inputDesktop -ne 'Default' -or
        [int]$session.sessionId -le 0 -or [long]$session.foregroundHwnd -le 0) {
      throw 'DESKTOP_SESSION_NOT_INTERACTIVE'
    }
    $report.interactiveSession = 'OBSERVED'
    $report.sessionId = [int]$session.sessionId
  } catch { Add-Blocker 'INTERACTIVE_SESSION_UNVERIFIED' }

  if ($report.interactiveSession -eq 'OBSERVED') {
    $image = Join-Path ([IO.Path]::GetTempPath()) ('jaco-acceptance-' + [Guid]::NewGuid().ToString('N') + '.png')
    try {
      $raw = & powershell.exe -NoProfile -NonInteractive -File $bridge -Op screenshot -OutFile $image | Select-Object -Last 1
      $capture = $raw | ConvertFrom-Json -ErrorAction Stop
      $item = Get-Item -LiteralPath $image -ErrorAction Stop
      if ($capture.ok -ne $true -or $item.Length -lt 8) { throw 'SCREENSHOT_CAPTURE_FAILED' }
      $bytes = [IO.File]::ReadAllBytes($image)
      $pngMagic = [byte[]](137,80,78,71,13,10,26,10)
      for ($i=0; $i -lt 8; $i++) {
        if ($bytes[$i] -ne $pngMagic[$i]) { throw 'SCREENSHOT_NOT_PNG' }
      }
      if ([int]$capture.sessionId -ne [int]$session.sessionId) { throw 'SCREENSHOT_SESSION_MISMATCH' }
      $report.win32Capture = 'OBSERVED'
      $report.screenSha256 = (Get-FileHash -LiteralPath $image -Algorithm SHA256).Hash.ToLowerInvariant()
    } catch { Add-Blocker 'WIN32_SCREENSHOT_UNVERIFIED' }
    finally { Remove-Item -LiteralPath $image -Force -ErrorAction SilentlyContinue }
  }

  try {
    $identity = Probe-Runtime '/api/runtime/identity'
    if (-not $identity) { throw 'NO_IDENTITY' }
    $report.canonicalRuntime = 'OBSERVED'
  } catch { Add-Blocker 'CANONICAL_RUNTIME_UNREACHABLE' }

  try {
    $desktop = Probe-Runtime '/api/desktop/hands-off/status'
    if ($desktop.success -ne $true -or $desktop.status.supported -ne $true -or
        $desktop.status.evidenceState -ne 'OBSERVED') { throw 'UIA_NOT_READY' }
    $report.desktopUiAutomation = 'OBSERVED'
  } catch { Add-Blocker 'DESKTOP_UIA_NOT_OBSERVED' }

  if ($MissionId) {
    try {
      $mission = Probe-Runtime ('/api/connected/nova/missions/' + $MissionId)
      if ($mission.success -ne $true -or $mission.mission.id -ne $MissionId -or
          $mission.mission.status -ne 'DONE' -or
          @($mission.mission.verifiedEvidenceRefs).Count -eq 0) { throw 'MISSION_UNVERIFIED' }
      $report.missionEvidence = 'VERIFIED_RECEIPTS_PRESENT'
    } catch { Add-Blocker 'MISSION_NOT_INDEPENDENTLY_VERIFIED' }
  }
  if ($ExpectedFile -or $ExpectedSha256) {
    if (-not $ExpectedFile -or -not $ExpectedSha256) {
      Add-Blocker 'EXPECTED_FILE_AND_SHA256_REQUIRED_TOGETHER'
    } else {
      try {
        $actual = (Get-FileHash -LiteralPath $ExpectedFile -Algorithm SHA256 -ErrorAction Stop).Hash
        if ($actual -ine $ExpectedSha256) { throw 'EXPECTED_OUTPUT_MISMATCH' }
        $report.independentOutput = 'SHA256_MATCH'
      } catch { Add-Blocker 'INDEPENDENT_OUTPUT_NOT_VERIFIED' }
    }
  }
}
# Deliberate: even a perfect probe is not proof that Chrome Remote Desktop
# shows the same Windows session and that the entire mission was observed.
# That final gate requires actual human-viewer + mission-run evidence.
$report.blockers = @($report.blockers)
$report | ConvertTo-Json -Depth 5 -Compress
if ($report.blockers.Count -gt 0) { exit 2 }
exit 0
