param(
  [Parameter(Mandatory=$true)]
  [string[]]$Processes,
  [ValidateRange(1,8)]
  [int]$Hours = 1,
  [string]$Mission = 'Operator-authorized JACO Desktop AgentOS session'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path $PSScriptRoot -Parent
$EnvPath = Join-Path $RepoRoot '.env'

if (-not (Test-Path $EnvPath)) { throw '.env is missing. Run agents/setup-desktop-agentos.ps1 first.' }
Get-Content $EnvPath | ForEach-Object {
  if ($_ -match '^\s*([^#=][^=]*)=(.*)$') {
    $key = $Matches[1].Trim()
    $value = $Matches[2].Trim()
    if ($key -and $value -and -not [Environment]::GetEnvironmentVariable($key, 'Process')) {
      [Environment]::SetEnvironmentVariable($key, $value, 'Process')
    }
  }
}

$Token = $env:JACO_GATEWAY_TOKEN
$RuntimeUrl = if ($env:JACO_RUNTIME_URL) { $env:JACO_RUNTIME_URL.TrimEnd('/') } else { 'http://127.0.0.1:3000' }
if (-not $Token -or $Token.Length -lt 24) { throw 'JACO_GATEWAY_TOKEN is missing or too short.' }

$normalized = @($Processes | ForEach-Object { $_.Trim().ToLower().Replace('.exe','') } | Where-Object { $_ } | Select-Object -Unique)
if ($normalized.Count -lt 1 -or $normalized.Count -gt 10) { throw 'Processes must contain 1-10 application process names.' }
foreach ($process in $normalized) {
  if ($process -notmatch '^[a-z0-9_.-]{2,64}$') { throw "Invalid process name: $process" }
}

$Headers = @{ 'x-gateway-token' = $Token }
try {
  $desktop = Invoke-RestMethod -Method Get -Uri "$RuntimeUrl/api/desktop/hands-off/status" -Headers $Headers -TimeoutSec 10
} catch {
  throw "JACO runtime is unavailable at $RuntimeUrl. Start agents/start-all.ps1 first."
}
if ($desktop.success -ne $true -or $desktop.status.supported -ne $true -or $desktop.status.evidenceState -ne 'OBSERVED') {
  throw "Desktop UI Automation is not verified. evidenceState=$($desktop.status.evidenceState)"
}

$body = @{
  name = 'Desktop AgentOS Session'
  mission = $Mission
  allowedDesktopProcesses = $normalized
  maxHours = $Hours
  decisions = @{
    READ = 'ALLOW'
    LOCAL_MUTATION = 'ALLOW'
    EXTERNAL_MUTATION = 'ALLOW'
    PUBLISH = 'ALLOW'
    FINANCIAL = 'REVIEW'
    AUTH = 'ALLOW'
    SECURITY = 'ALLOW'
    DESTRUCTIVE = 'ALLOW'
  }
  requireSemanticVerificationFor = @('EXTERNAL_MUTATION','PUBLISH','DESTRUCTIVE')
} | ConvertTo-Json -Depth 8

$created = Invoke-RestMethod -Method Post -Uri "$RuntimeUrl/api/relay/mandates" -Headers $Headers -ContentType 'application/json' -Body $body -TimeoutSec 10
if ($created.success -ne $true -or -not $created.mandate.id) { throw 'Runtime did not create an autonomy mandate.' }

$id = $created.mandate.id
try {
  $signed = Invoke-RestMethod -Method Post -Uri "$RuntimeUrl/api/relay/mandates/$id/sign" -Headers $Headers -ContentType 'application/json' -Body '{}' -TimeoutSec 15
} catch {
  throw "Mandate $id was created but could not be signed: $($_.Exception.Message)"
}
if ($signed.success -ne $true -or $signed.mandate.signedByOperator -ne $true) { throw 'Runtime did not return a signed mandate.' }

Write-Host ''
Write-Host 'Desktop mandate active.' -ForegroundColor Green
Write-Host "Mandate:  $id"
Write-Host "Processes: $($normalized -join ', ')"
Write-Host "Expires:   $($signed.mandate.expiresAt)"
Write-Host 'Local desktop mutation is allowed only inside this signed scope.'
Write-Host 'Level-5 profile allows non-financial execution with receipts. Outgoing payments remain operator-approved.'
