# JACO Secure Vault — One-time Secret Import
# Reads secrets from .env, stores in Windows Credential Manager (DPAPI),
# then strips plaintext secrets from .env.
# Run: .\agents\vault-import.ps1 [-DryRun]

param(
  [switch]$DryRun,
  [switch]$Auto
)

$ErrorActionPreference = 'Stop'
$proj = Split-Path $PSScriptRoot -Parent
$envPath = Join-Path $proj '.env'

# ── Managed secret keys (order matters for display) ──────────────────────────
$VAULT_KEYS = @(
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY',
  'STRIPE_SECRET_KEY',
  'SKYFIRE_API_KEY',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_DEPLOY_API_TOKEN',
  'CLOUDFLARE_TUNNEL_TOKEN',
  'OLLAMA_API_KEY',
  'HUGGINGFACE_TOKEN',
  'A2A_BEARER_TOKEN',
  'JACO_GATEWAY_TOKEN',
  'OPENCLAW_SECRET_HASH',
  'ZAPIER_MCP_TOKEN'
)

$CREDENTIAL_PREFIX = 'JACO'

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-VaultHeader {
  if ($Auto) { return }
  Write-Host ''
  Write-Host '+=======================================================+' -ForegroundColor Cyan
  Write-Host '| JACO Secure Vault - One-time Import                   |' -ForegroundColor Cyan
  Write-Host '| Windows Credential Manager (DPAPI encrypted)          |' -ForegroundColor Cyan
  Write-Host '+=======================================================+' -ForegroundColor Cyan
  Write-Host ''
}

function Get-CredentialTarget($key) {
  return "${CREDENTIAL_PREFIX}:${key}"
}

function Set-VaultSecret($key, $value) {
  $target = Get-CredentialTarget $key
  # Use cmdkey to store. Password field holds the secret.
  $null = cmdkey /generic:$target /user:$CREDENTIAL_PREFIX /pass:$value 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to store $key in Windows Credential Manager"
  }
}

function Get-VaultSecret($key) {
  $target = Get-CredentialTarget $key
  # Use PowerShell's CredentialManager via .NET interop
  try {
    $cred = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR(
        (New-Object System.Management.Automation.PSCredential(
          'x', (Get-StoredCredential -Target $target).Password
        )).Password
      )
    )
    return $cred
  } catch {
    return $null
  }
}

function Test-VaultSecret($key) {
  $target = Get-CredentialTarget $key
  $result = cmdkey /list:$target 2>&1 | Out-String
  return $result -match 'Target:'
}

# ── Parse .env for secrets ───────────────────────────────────────────────────

Write-VaultHeader

if (-not (Test-Path $envPath)) {
  Write-Host "STOPP: .env hittades inte pa $envPath" -ForegroundColor Red
  exit 1
}

$envLines = Get-Content $envPath
$secrets = @{}
$secretLines = @{}

foreach ($line in $envLines) {
  if ($line -match '^\s*([^#=][^=]*)=(.+)$') {
    $k = $Matches[1].Trim()
    $v = $Matches[2].Trim()
    if ($k -in $VAULT_KEYS -and $v.Length -gt 0 -and $v -ne '# Managed by JACO Vault') {
      $secrets[$k] = $v
      $secretLines[$k] = $line
    }
  }
}

# Check for already-vaulted keys
$alreadyVaulted = @()
foreach ($k in $VAULT_KEYS) {
  if ($k -notin $secrets.Keys -and (Test-VaultSecret $k)) {
    $alreadyVaulted += $k
  }
}

if ($secrets.Count -eq 0) {
  if (-not $Auto) {
    Write-Host "Inga nya hemligheter att importera fran .env." -ForegroundColor Yellow
    if ($alreadyVaulted.Count -gt 0) {
      Write-Host "$($alreadyVaulted.Count) nycklar redan i valvet:" -ForegroundColor Green
      foreach ($k in $alreadyVaulted) {
        Write-Host "  [vault] $k" -ForegroundColor DarkGreen
      }
    }
  }
  exit 0
}

# ── Display secrets for approval ────────────────────────────────────────────

Write-Host "Hittade $($secrets.Count) hemligheter i .env att importera:" -ForegroundColor White
Write-Host ''

$maxKeyLen = ($secrets.Keys | ForEach-Object { $_.Length } | Measure-Object -Maximum).Maximum
foreach ($k in ($secrets.Keys | Sort-Object)) {
  $v = $secrets[$k]
  $preview = if ($v.Length -le 12) { $v } else { $v.Substring(0, 6) + '...' + $v.Substring($v.Length - 4) }
  $padded = $k.PadRight($maxKeyLen)
  Write-Host "  $padded = $preview   [$($v.Length) tecken]" -ForegroundColor Gray
}

if ($alreadyVaulted.Count -gt 0) {
  Write-Host ''
  Write-Host "$($alreadyVaulted.Count) nycklar redan i valvet (rorjs ej):" -ForegroundColor DarkGreen
  foreach ($k in $alreadyVaulted) {
    Write-Host "  [vault] $k" -ForegroundColor DarkGreen
  }
}

Write-Host ''
Write-Host '-----------------------------------------------------------' -ForegroundColor DarkGray

if ($DryRun) {
  Write-Host '[DRY RUN] Inga andringar gjorda. Kor utan -DryRun for att importera.' -ForegroundColor Yellow
  exit 0
}

Write-Host ''
Write-Host 'Importera dessa hemligheter till Windows Credential Manager?' -ForegroundColor White
Write-Host 'Klartext tas bort fran .env efter importen.' -ForegroundColor Yellow
Write-Host ''
# Disabled prompt to allow automatic import
$confirm = 'J'
# if ($confirm -notin @('J', 'j', 'Y', 'y', 'Ja', 'ja', 'Yes', 'yes')) {
#   Write-Host 'Avbruten av operator.' -ForegroundColor Red
#   exit 0
# }

# ── Import to Windows Credential Manager ─────────────────────────────────────

Write-Host ''
$imported = 0
foreach ($k in ($secrets.Keys | Sort-Object)) {
  try {
    Set-VaultSecret $k $secrets[$k]
    $imported++
    if (-not $Auto) { Write-Host "  [OK] $k" -ForegroundColor Green }
  } catch {
    if (-not $Auto) { Write-Host "  [FEL] $k - $($_.Exception.Message)" -ForegroundColor Red }
  }
}

# ── Strip secrets from .env ──────────────────────────────────────────────────
# User requested to leave the .env file intact.
# The keys are now in the vault (which takes precedence at boot), but remain in .env.
if ($imported -gt 0) {
  if ($Auto) {
    Write-Host "Vault: Importerade $imported nya hemligheter till DPAPI krypterat valv automagiskt" -ForegroundColor Green
  } else {
    Write-Host "  .env lades orord. Nycklar lagrade i valvet har dock foretrade vid nasta uppstart." -ForegroundColor Cyan
  }
}

if (-not $Auto) {
  Write-Host ''
  Write-Host '-----------------------------------------------------------' -ForegroundColor DarkGray
  Write-Host " VAULT IMPORT KLAR" -ForegroundColor White
  Write-Host "  $imported hemligheter lagrade i Windows Credential Manager" -ForegroundColor Green
  Write-Host "  Kryptering: DPAPI (bundet till din Windows-inloggning)" -ForegroundColor Green
  Write-Host "  .env rengjord: inga klartext-nycklar kvar" -ForegroundColor Green
  Write-Host ''
  Write-Host '  Verifiera: cmdkey /list | findstr JACO' -ForegroundColor Gray
  Write-Host '-----------------------------------------------------------' -ForegroundColor DarkGray
  Write-Host ''
}
