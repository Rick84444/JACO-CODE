param(
  [int]$CorePort = 3000,
  [int]$McpPort = 2999,
  [int]$CdpPort = 9222,
  [string]$ProviderId = 'ollama',
  [string]$BrowserUrlIncludes = '',
  [switch]$SkipChromeLaunch,
  [switch]$SkipMcp,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
$ExpectedReleaseId = 'jaco-code-0.22.0'
$RuntimeDir = Join-Path $Root '.jaco\runtime'
$BootstrapEnv = Join-Path $RuntimeDir 'autonomous-bootstrap.env'
$BootstrapState = Join-Path $RuntimeDir 'autonomous-bootstrap-state.json'
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

function Step([string]$Message) { Write-Host "[JACO AUTO] $Message" -ForegroundColor Cyan }
function Good([string]$Message) { Write-Host "[JACO AUTO] PASS  $Message" -ForegroundColor Green }
function Warn([string]$Message) { Write-Host "[JACO AUTO] WARN  $Message" -ForegroundColor Yellow }
function Fail([string]$Message) { Write-Host "[JACO AUTO] FAIL  $Message" -ForegroundColor Red }
function New-Token { return [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 })) -replace '[+/=]','x' }
function Read-EnvFile([string]$Path) {
  $map = @{}
  if (Test-Path $Path) {
    Get-Content $Path | ForEach-Object {
      $line = $_.Trim()
      if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
        $p = $line.Split('=',2)
        $map[$p[0].Trim()] = $p[1]
      }
    }
  }
  return $map
}
function Get-LanIPv4 {
  $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Bluetooth' } |
    Sort-Object InterfaceMetric | Select-Object -First 1 -ExpandProperty IPAddress
  return $ip
}
function Wait-Http([string]$Uri,[int]$Seconds=30,[hashtable]$Headers=@{}) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    try { return Invoke-RestMethod -Uri $Uri -Headers $Headers -TimeoutSec 3 }
    catch { Start-Sleep -Milliseconds 600 }
  } while ((Get-Date) -lt $deadline)
  return $null
}
function Invoke-Jaco([string]$Path,[string]$Method='GET',$Body=$null) {
  $headers = @{}
  if ($script:CoreToken) { $headers['x-gateway-token'] = $script:CoreToken }
  $params = @{ Uri = "http://127.0.0.1:$CorePort$Path"; Method = $Method; Headers = $headers; TimeoutSec = 15 }
  if ($null -ne $Body) { $params.ContentType = 'application/json'; $params.Body = ($Body | ConvertTo-Json -Depth 30 -Compress) }
  try { return Invoke-RestMethod @params }
  catch {
    if ($script:CoreToken) {
      $params.Headers = @{}
      try { return Invoke-RestMethod @params } catch { throw }
    }
    throw
  }
}
function Save-State($State) {
  $State | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $BootstrapState
}

$state = [ordered]@{
  releaseId = $ExpectedReleaseId
  startedAt = (Get-Date).ToUniversalTime().ToString('o')
  core = [ordered]@{ state='UNKNOWN'; reused=$false; pid=$null }
  seer = [ordered]@{ state='UNKNOWN' }
  provider = [ordered]@{ id=$ProviderId; state='UNKNOWN' }
  chrome = [ordered]@{ state='UNKNOWN'; cdpPort=$CdpPort; attached=$false; target=$null }
  mcp = [ordered]@{ state='UNKNOWN'; port=$McpPort; lanUrl=$null; officialNegotiation='UNKNOWN' }
  wordpress = [ordered]@{ state='UNKNOWN' }
  android = [ordered]@{ state='UNKNOWN' }
  evidence = @()
}

Step "JACO autonomous bootstrap — $ExpectedReleaseId"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm is required.' }
$nodeVersion = (& node -p "process.versions.node").Trim()
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 22) { throw "Node 22+ required; found $nodeVersion" }
Good "Node $nodeVersion"

$persisted = Read-EnvFile $BootstrapEnv
$script:CoreToken = if ($env:GATEWAY_TOKEN) { $env:GATEWAY_TOKEN } elseif ($persisted['GATEWAY_TOKEN']) { $persisted['GATEWAY_TOKEN'] } else { '' }
$McpBearer = if ($env:JACO_MCP_BEARER) { $env:JACO_MCP_BEARER } elseif ($persisted['JACO_MCP_BEARER']) { $persisted['JACO_MCP_BEARER'] } else { New-Token }
$LanIp = Get-LanIPv4

# Core identity is intentionally unauthenticated and is the source-truth preflight.
$coreIdentity = $null
try { $coreIdentity = Invoke-RestMethod -Uri "http://127.0.0.1:$CorePort/api/runtime/identity" -TimeoutSec 2 } catch {}
if ($coreIdentity -and $coreIdentity.releaseId -ne $ExpectedReleaseId) {
  throw "Different canonical JACO runtime is active ($($coreIdentity.releaseId)). Preserve it; run START_CONTINUUM_CANDIDATE_WINDOWS.cmd and promote separately after candidate proof."
}

if (-not $coreIdentity) {
  if (-not $script:CoreToken) { $script:CoreToken = New-Token }
  $env:GATEWAY_TOKEN = $script:CoreToken
  $env:HOST = '127.0.0.1'
  $env:PORT = [string]$CorePort

  if (-not (Test-Path 'node_modules\tsx')) {
    Step 'Installing root dependencies'
    & npm ci --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  }
  & node scripts/ensure_rollup_native.mjs
  if ($LASTEXITCODE -ne 0) { throw 'platform Rollup repair failed' }
  if (-not $SkipBuild -or -not (Test-Path 'dist\server.cjs')) {
    Step 'Building canonical JACO Autonomous IDE + Core'
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'JACO production build failed' }
  }
  $coreOut = Join-Path $RuntimeDir 'core.autonomous.out.log'
  $coreErr = Join-Path $RuntimeDir 'core.autonomous.err.log'
  $coreProcess = Start-Process -FilePath 'node.exe' -ArgumentList @('dist/server.cjs') -WorkingDirectory $Root -RedirectStandardOutput $coreOut -RedirectStandardError $coreErr -PassThru
  $state.core.pid = $coreProcess.Id
  $coreIdentity = Wait-Http "http://127.0.0.1:$CorePort/api/runtime/identity" 40
  if (-not $coreIdentity) { throw "Core did not become READY; inspect $coreOut and $coreErr" }
  $state.core.state='READY'; $state.core.reused=$false
  Good "Core READY PID=$($coreProcess.Id)"
} else {
  $state.core.state='READY'; $state.core.reused=$true
  Good "Reusing current Continuum Core on :$CorePort"
}
$state.evidence += @{ type='core_identity'; value=$coreIdentity }

# Persist only runtime transport secrets locally; never print their literal values.
@(
  "JACO_LAN_IP=$LanIp",
  $(if ($script:CoreToken) { "GATEWAY_TOKEN=$($script:CoreToken)" } else { 'GATEWAY_TOKEN=' }),
  "JACO_MCP_BEARER=$McpBearer"
) | Set-Content -Encoding UTF8 $BootstrapEnv

# Ensure durable dispatcher is running and record SEER evidence.
try {
  Invoke-Jaco '/api/connected/dispatcher/start' 'POST' @{ intervalMs = 1200 } | Out-Null
  $seer = Invoke-RestMethod -Uri "http://127.0.0.1:$CorePort/api/seer/live" -TimeoutSec 5
  $state.seer.state='READY'; $state.evidence += @{ type='seer_live'; value=$seer.state }
  Good 'SEER live + durable dispatcher READY'
} catch { $state.seer.state='DEGRADED'; $state.seer.error=$_.Exception.Message; Warn "SEER/dispatcher: $($_.Exception.Message)" }

# Provider: default registry is OpenAI-compatible; probe real HTTP only.
try {
  $probe = Invoke-Jaco "/api/connected/providers/$ProviderId/probe" 'POST' @{}
  if ($probe.success -and $probe.receipt.ok) {
    $state.provider.state='READY'; $state.provider.models=$probe.receipt.models; $state.evidence += @{ type='provider_probe'; value=$probe.receipt }
    Good "Provider '$ProviderId' READY"
  } else { $state.provider.state='UNAVAILABLE'; $state.provider.receipt=$probe.receipt; Warn "Provider '$ProviderId' unavailable" }
} catch { $state.provider.state='UNAVAILABLE'; $state.provider.error=$_.Exception.Message; Warn "Provider '$ProviderId' unavailable: $($_.Exception.Message)" }

# Chrome CDP. Start a dedicated loopback-only Chrome instance only if none exists.
$cdp = $null
try { $cdp = Invoke-RestMethod -Uri "http://127.0.0.1:$CdpPort/json/version" -TimeoutSec 2 } catch {}
if (-not $cdp -and -not $SkipChromeLaunch) {
  $chromeCandidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { $_ -and (Test-Path $_) }
  $chrome = $chromeCandidates | Select-Object -First 1
  if ($chrome) {
    $profile = Join-Path $RuntimeDir 'chrome-cdp-profile'
    Step "Starting Chrome CDP on 127.0.0.1:$CdpPort"
    Start-Process -FilePath $chrome -ArgumentList @("--remote-debugging-address=127.0.0.1","--remote-debugging-port=$CdpPort","--user-data-dir=$profile") | Out-Null
    $cdp = Wait-Http "http://127.0.0.1:$CdpPort/json/version" 20
  }
}
if ($cdp) {
  $state.chrome.state='READY'; $state.evidence += @{ type='chrome_cdp'; value=@{ browser=$cdp.Browser; protocol=$cdp.'Protocol-Version' } }
  Good "Chrome CDP READY :$CdpPort"
  try {
    $targets = Invoke-Jaco "/api/browser/hands-off/targets?port=$CdpPort"
    $pages = @($targets.targets | Where-Object { $_.type -eq 'page' -and $_.url -match '^https?://' })
    $selected = $null
    if ($BrowserUrlIncludes) { $selected = $pages | Where-Object { $_.url -like "*$BrowserUrlIncludes*" } | Select-Object -First 1 }
    if (-not $selected) { $selected = $pages | Where-Object { $_.url -match '/wp-admin/|/wp-login\.php|customize\.php' } | Select-Object -First 1 }
    if (-not $selected) { $selected = $pages | Where-Object { $_.url -notmatch "127\.0\.0\.1:$CorePort" } | Select-Object -First 1 }
    if ($selected) {
      $attachKey = if ($BrowserUrlIncludes) { $BrowserUrlIncludes } else { ([uri]$selected.url).Host }
      $attached = Invoke-Jaco '/api/browser/hands-off/attach' 'POST' @{ port=$CdpPort; urlIncludes=$attachKey }
      $survey = Invoke-Jaco '/api/browser/hands-off/survey' 'POST' @{ label='autonomous-bootstrap' }
      $state.chrome.attached=$true; $state.chrome.target=$selected.url
      $state.evidence += @{ type='browser_attach'; value=$attached.session }
      $state.evidence += @{ type='browser_survey'; value=$survey.survey }
      Good "Browser Hands-Off attached and surveyed: $($selected.title)"
    } else { Warn 'CDP is ready but no attachable http(s) page is open yet' }
  } catch { $state.chrome.attachError=$_.Exception.Message; Warn "JACO→Chrome attach/survey: $($_.Exception.Message)" }
} else { $state.chrome.state='UNAVAILABLE'; Warn 'Chrome CDP unavailable' }

# WordPress lane: report REST configuration, while browser lane can still use authenticated CDP session.
try {
  $wp = Invoke-Jaco '/api/connected/wordpress/status'
  $state.wordpress.state = if ($wp.wordpress.configured) { 'READY_REST' } elseif ($state.chrome.attached) { 'BROWSER_SESSION_ONLY' } else { 'UNCONFIGURED' }
  $state.wordpress.config = $wp.wordpress
  if ($wp.wordpress.configured) { Good 'WordPress REST adapter configured' } elseif ($state.chrome.attached) { Warn 'WordPress REST credentials not configured; authenticated Chrome lane remains available' } else { Warn 'WordPress is not configured' }
} catch { $state.wordpress.state='UNAVAILABLE'; $state.wordpress.error=$_.Exception.Message }

# Android status is probed, never fabricated.
try {
  $android = Invoke-Jaco '/api/hands-off/status'
  $state.android.state = if ($android.status.evidenceState) { [string]$android.status.evidenceState } else { 'OBSERVED' }
  $state.android.status=$android.status
} catch { $state.android.state='UNAVAILABLE'; $state.android.error=$_.Exception.Message }

# Sentinel/MCP. Reuse Core; never start a second :3000 process.
if (-not $SkipMcp) {
  if (-not $LanIp) { $state.mcp.state='BLOCKED_NO_LAN_IP'; Warn 'No LAN IPv4 found; MCP LAN not started' }
  else {
    if (-not (Test-Path 'gateway\node_modules\@modelcontextprotocol\server')) {
      Step 'Installing official MCP v2 gateway dependencies'
      Push-Location gateway
      & npm install --ignore-scripts --no-audit --no-fund
      $gatewayInstall = $LASTEXITCODE
      Pop-Location
      if ($gatewayInstall -ne 0) { throw 'gateway npm install failed' }
    }

    # Official in-process SDK negotiation gate.
    & node gateway/test/mcp-runtime.test.mjs
    if ($LASTEXITCODE -eq 0) { $state.mcp.officialNegotiation='PASS' } else { $state.mcp.officialNegotiation='FAIL' }

    $env:JACO_BASE_URL = "http://127.0.0.1:$CorePort"
    $env:JACO_GATEWAY_TOKEN = $script:CoreToken
    $env:JACO_MCP_BEARER = $McpBearer
    $env:JACO_GATEWAY_HOST = '0.0.0.0'
    $env:JACO_GATEWAY_PORT = [string]$McpPort
    $env:JACO_GATEWAY_MODE = 'lan'
    $env:JACO_ALLOWED_HOSTS = "127.0.0.1,localhost,[::1],$LanIp"
    $env:JACO_MODEL_ID = 'jaco-autonomous-bootstrap'
    $env:JACO_MCP_ALLOW_ACTIVATION = '0'

    $existingSentinel = $null
    try {
      $existingSentinel = Invoke-RestMethod -Uri "http://127.0.0.1:$McpPort/health" -Headers @{ Host="$LanIp`:$McpPort"; Authorization="Bearer $McpBearer" } -TimeoutSec 2
    } catch {}
    if (-not $existingSentinel) {
      $mcpOut = Join-Path $RuntimeDir 'sentinel.autonomous.out.log'
      $mcpErr = Join-Path $RuntimeDir 'sentinel.autonomous.err.log'
      $sentinel = Start-Process -FilePath 'node.exe' -ArgumentList @('gateway/src/sentinel.mjs') -WorkingDirectory $Root -RedirectStandardOutput $mcpOut -RedirectStandardError $mcpErr -PassThru
      Start-Sleep -Seconds 2
      try { $existingSentinel = Invoke-RestMethod -Uri "http://127.0.0.1:$McpPort/health" -Headers @{ Host="$LanIp`:$McpPort"; Authorization="Bearer $McpBearer" } -TimeoutSec 8 } catch {}
      if ($existingSentinel) { $state.mcp.pid=$sentinel.Id }
    }
    if ($existingSentinel) {
      $state.mcp.state='READY'; $state.mcp.lanUrl="http://$LanIp`:$McpPort/mcp"; $state.evidence += @{ type='sentinel_health'; value=$existingSentinel }
      Good "MCP Sentinel READY — $($state.mcp.lanUrl)"
    } else { $state.mcp.state='UNAVAILABLE'; Warn 'Sentinel did not become READY' }
  }
} else { $state.mcp.state='SKIPPED' }

$state.completedAt = (Get-Date).ToUniversalTime().ToString('o')
Save-State $state
Write-Host ''
Write-Host '=== JACO AUTONOMOUS BOOTSTRAP SUMMARY ===' -ForegroundColor White
Write-Host ("Core       : {0}" -f $state.core.state)
Write-Host ("SEER       : {0}" -f $state.seer.state)
Write-Host ("Provider   : {0} ({1})" -f $state.provider.state,$ProviderId)
Write-Host ("Chrome/CDP : {0}; attached={1}" -f $state.chrome.state,$state.chrome.attached)
Write-Host ("WordPress  : {0}" -f $state.wordpress.state)
Write-Host ("Android    : {0}" -f $state.android.state)
Write-Host ("MCP        : {0}; official SDK negotiation={1}" -f $state.mcp.state,$state.mcp.officialNegotiation)
if ($state.mcp.lanUrl) { Write-Host ("MCP URL    : {0}" -f $state.mcp.lanUrl) }
Write-Host ("State file : {0}" -f $BootstrapState)
Write-Host 'Bearer/token values remain only in .jaco/runtime and are not printed.'
