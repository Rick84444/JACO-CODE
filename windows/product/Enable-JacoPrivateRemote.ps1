# JACO Private Remote: optional Windows-hosted private HTTPS access through Tailscale Serve.
# No Cloudflare tunnel, router port forwarding, second JACO agent, or shared credentials.
# Run manually from PowerShell after signing in to Tailscale.
param([ValidateRange(1024,65535)][int]$Port = 3000)

$ErrorActionPreference = 'Stop'
$DataRoot = Join-Path $env:LOCALAPPDATA 'JACO'
$EnvFile = Join-Path $DataRoot '.env'
if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
  throw 'JACO_NOT_INITIALIZED: Launch the installed JACO CODE app once before enabling Remote.'
}
if ($env:JACO_IDE_PUBLIC_HOST) {
  throw 'JACO_HOST_ENV_OVERRIDE: Remove process-level JACO_IDE_PUBLIC_HOST override before configuring this persistent JACO setting.'
}
$cliCommand = Get-Command tailscale.exe -ErrorAction SilentlyContinue
$cli = if ($cliCommand) { $cliCommand.Source } else { $null }
if (-not $cli) {
  $candidate = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
  if (Test-Path -LiteralPath $candidate) { $cli = $candidate }
}
if (-not $cli) { throw 'TAILSCALE_NOT_INSTALLED: Install Tailscale from https://tailscale.com/download/windows and sign in.' }

try {
  $identity = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/runtime/identity" -TimeoutSec 5 -ErrorAction Stop
  if ($identity.success -ne $true) { throw 'Core identity was not successful.' }
} catch {
  throw "JACO_CORE_NOT_READY: Start JACO CODE on this Windows PC and verify localhost port $Port first."
}

$rawStatus = & $cli status --json 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw 'TAILSCALE_NOT_CONNECTED: Sign in to Tailscale before enabling private Remote.' }
try { $status = $rawStatus | ConvertFrom-Json -ErrorAction Stop } catch { throw 'TAILSCALE_STATUS_INVALID' }
$dns = [string]$status.Self.DNSName
$dns = $dns.Trim().TrimEnd('.').ToLowerInvariant()
if ($status.BackendState -ne 'Running' -or $dns -notmatch '^([a-z0-9-]+\.)+[a-z0-9-]+\.ts\.net$') {
  throw 'TAILSCALE_PRIVATE_DNS_UNAVAILABLE: Enable MagicDNS and HTTPS in your tailnet.'
}

# Serve is private to your tailnet. Do NOT use Tailscale Funnel.
& $cli serve --bg "http://127.0.0.1:$Port"
if ($LASTEXITCODE -ne 0) { throw 'TAILSCALE_SERVE_FAILED: Complete the Tailscale HTTPS consent flow and retry.' }
$serve = (& $cli serve status 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or -not $serve.Contains("https://$dns") -or -not $serve.Contains("127.0.0.1:$Port")) {
  throw 'TAILSCALE_SERVE_NOT_VERIFIED: JACO settings were not changed. Inspect tailscale serve status.'
}

# Preserve credentials and settings in user data, never Program Files.
$before = [System.IO.File]::ReadAllText($EnvFile)
$clean = [regex]::Replace($before, '(?m)^JACO_IDE_PUBLIC_HOST=[^\r\n]*(\r?\n|$)', '')
$clean = $clean.TrimEnd([char[]]@([char]13,[char]10)) + [Environment]::NewLine
$after = $clean + "JACO_IDE_PUBLIC_HOST=$dns" + [Environment]::NewLine
if ($after -ne $before) {
  $backup = "$EnvFile.private-remote-$(Get-Date -Format yyyyMMddHHmmss).bak"
  Copy-Item -LiteralPath $EnvFile -Destination $backup -ErrorAction Stop
  $temp = "$EnvFile.$PID.tmp"
  try {
    [System.IO.File]::WriteAllText($temp, $after, (New-Object System.Text.UTF8Encoding($false)))
    if ([System.IO.File]::ReadAllText($EnvFile) -cne $before) { throw 'JACO_SETTINGS_CHANGED_RETRY' }
    Move-Item -LiteralPath $temp -Destination $EnvFile -Force -ErrorAction Stop
  } finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
  }
}
Write-Host 'JACO_PRIVATE_REMOTE_CONFIGURED'
Write-Host "PRIVATE_URL=https://$dns/ide-login?next=remote"
Write-Host 'NEXT: Restart JACO CODE; open Devices > Add device > Browser, generate one-time code.'
Write-Host 'On the phone: install/sign in to Tailscale for the same tailnet and open that private URL.'
Write-Host 'Remote is the same Aura. Tailscale Serve does not publish a public website.'
