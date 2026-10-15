# JACO Secure Vault — Boot-time Secret Loader
# Called automatically by start-all.ps1 at startup.
# Reads JACO-prefixed credentials from Windows Credential Manager
# and injects them into the current process environment (memory only).
#
# This script is dot-sourced: . .\agents\vault-load.ps1
# After execution, $vaultLoaded contains the number of loaded secrets.

$CREDENTIAL_PREFIX = 'JACO'

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

# ── Read secrets from Windows Credential Manager via cmdkey ──────────────────
# cmdkey stores passwords but cannot retrieve them. We use the Windows
# CredentialManager API through .NET P/Invoke to read the actual password value.

# P/Invoke signature for CredRead
Add-Type -Namespace 'JACO' -Name 'CredManager' -MemberDefinition @'
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredRead(
    string target,
    int type,
    int reserved,
    out IntPtr credential
  );

  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr credential);

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags;
    public int Type;
    public string TargetName;
    public string Comment;
    public long LastWritten;
    public int CredentialBlobSize;
    public IntPtr CredentialBlob;
    public int Persist;
    public int AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
'@ -ErrorAction SilentlyContinue

function Read-WindowsCredential {
  param([string]$Target)
  $ptr = [IntPtr]::Zero
  $CRED_TYPE_GENERIC = 1
  $success = [JACO.CredManager]::CredRead($Target, $CRED_TYPE_GENERIC, 0, [ref]$ptr)
  if (-not $success -or $ptr -eq [IntPtr]::Zero) { return $null }
  try {
    $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [Type][JACO.CredManager+CREDENTIAL])
    if ($cred.CredentialBlobSize -gt 0 -and $cred.CredentialBlob -ne [IntPtr]::Zero) {
      return [System.Runtime.InteropServices.Marshal]::PtrToStringUni($cred.CredentialBlob, $cred.CredentialBlobSize / 2)
    }
    return $null
  } finally {
    [JACO.CredManager]::CredFree($ptr)
  }
}

# ── Load all managed secrets into process environment ────────────────────────

$vaultLoaded = 0
$vaultMissing = @()

foreach ($key in $VAULT_KEYS) {
  $target = "${CREDENTIAL_PREFIX}:${key}"
  $value = Read-WindowsCredential -Target $target
  if ($value -and $value.Length -gt 0) {
    [Environment]::SetEnvironmentVariable($key, $value, 'Process')
    $vaultLoaded++
  } else {
    # Only report missing if .env also doesn't have it (checked later by start-all.ps1)
    $vaultMissing += $key
  }
}

# Sync GATEWAY_TOKEN from JACO_GATEWAY_TOKEN if loaded from vault
if ($env:JACO_GATEWAY_TOKEN -and -not $env:GATEWAY_TOKEN) {
  $env:GATEWAY_TOKEN = $env:JACO_GATEWAY_TOKEN
}

# Export for caller
$script:vaultLoaded = $vaultLoaded
