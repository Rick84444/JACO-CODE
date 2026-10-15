# JACO Dynamic Vault Tool Helper (100% Native Win32 P/Invoke)
# Provides zero-subprocess, zero-escaping DPAPI Credential operations
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('Get', 'Set', 'Delete', 'List')]
  [string]$Action,

  [string]$Key,
  [string]$Value,
  [switch]$ValueFromStdin,
  [string]$Prefix = 'JACO'
)

$ErrorActionPreference = 'Stop'

Add-Type -Namespace 'JACO' -Name 'CredManagerNative' -MemberDefinition @'
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredRead(
    string target,
    int type,
    int reserved,
    out IntPtr credential
  );

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredWrite(
    [In] ref CREDENTIAL credential,
    uint flags
  );

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredDelete(
    string target,
    int type,
    int reserved
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

function Read-NativeCredential($Target) {
  $ptr = [IntPtr]::Zero
  $CRED_TYPE_GENERIC = 1
  $success = [JACO.CredManagerNative]::CredRead($Target, $CRED_TYPE_GENERIC, 0, [ref]$ptr)
  if (-not $success -or $ptr -eq [IntPtr]::Zero) { return $null }
  try {
    $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [Type][JACO.CredManagerNative+CREDENTIAL])
    if ($cred.CredentialBlobSize -gt 0 -and $cred.CredentialBlob -ne [IntPtr]::Zero) {
      return [System.Runtime.InteropServices.Marshal]::PtrToStringUni($cred.CredentialBlob, $cred.CredentialBlobSize / 2)
    }
    return $null
  } finally {
    [JACO.CredManagerNative]::CredFree($ptr)
  }
}

function Write-NativeCredential($Target, $UserName, $Password) {
  $CRED_TYPE_GENERIC = 1
  $CRED_PERSIST_LOCAL_MACHINE = 2
  $bytes = [System.Text.Encoding]::Unicode.GetBytes($Password)
  $blobPtr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  try {
    [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blobPtr, $bytes.Length)
    $cred = New-Object JACO.CredManagerNative+CREDENTIAL
    $cred.Type = $CRED_TYPE_GENERIC
    $cred.TargetName = $Target
    $cred.UserName = $UserName
    $cred.CredentialBlobSize = $bytes.Length
    $cred.CredentialBlob = $blobPtr
    $cred.Persist = $CRED_PERSIST_LOCAL_MACHINE
    return [JACO.CredManagerNative]::CredWrite([ref]$cred, 0)
  } finally {
    if ($blobPtr -ne [IntPtr]::Zero) {
      [System.Runtime.InteropServices.Marshal]::FreeHGlobal($blobPtr)
    }
  }
}

function Delete-NativeCredential($Target) {
  $CRED_TYPE_GENERIC = 1
  return [JACO.CredManagerNative]::CredDelete($Target, $CRED_TYPE_GENERIC, 0)
}

try {
  if ($Action -eq 'Get') {
    if (-not $Key) { throw "Key parameter required for Get action" }
    $target = if ($Key.StartsWith("${Prefix}:")) { $Key } else { "${Prefix}:${Key}" }
    $val = Read-NativeCredential -Target $target
    if ($null -eq $val) {
      @{ ok = $false; error = "SECRET_NOT_FOUND"; key = $Key } | ConvertTo-Json -Compress
    } else {
      @{ ok = $true; key = $Key; value = $val; target = $target } | ConvertTo-Json -Compress
    }
  }
  elseif ($Action -eq 'Set') {
    if (-not $Key) { throw "Key parameter required for Set action" }
    if ($ValueFromStdin) {
      $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
      if ($null -eq $request.value) { throw 'Value required in stdin JSON' }
      $Value = [string]$request.value
    }
    if ($null -eq $Value) { throw "Value parameter required for Set action" }
    $target = if ($Key.StartsWith("${Prefix}:")) { $Key } else { "${Prefix}:${Key}" }
    $success = Write-NativeCredential -Target $target -UserName $Prefix -Password $Value
    if (-not $success) { throw "Win32 CredWrite failed to save secret" }
    @{ ok = $true; key = $Key; message = "Secret saved to DPAPI vault via CredWrite"; target = $target } | ConvertTo-Json -Compress
  }
  elseif ($Action -eq 'Delete') {
    if (-not $Key) { throw "Key parameter required for Delete action" }
    $target = if ($Key.StartsWith("${Prefix}:")) { $Key } else { "${Prefix}:${Key}" }
    $success = Delete-NativeCredential -Target $target
    @{ ok = [bool]$success; key = $Key; target = $target } | ConvertTo-Json -Compress
  }
  elseif ($Action -eq 'List') {
    $raw = cmdkey /list 2>&1 | Out-String
    $matches = [regex]::Matches($raw, "Target:\s*(LegacyGeneric:target=)?(?<target>${Prefix}:[^\s\r\n]+)")
    $keys = @()
    foreach ($m in $matches) {
      $t = $m.Groups['target'].Value
      $cleanKey = $t -replace "^${Prefix}:", ""
      if ($cleanKey -notin $keys) { $keys += $cleanKey }
    }
    @{ ok = $true; prefix = $Prefix; keys = $keys; count = $keys.Count } | ConvertTo-Json -Compress
  }
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
