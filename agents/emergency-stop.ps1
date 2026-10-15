# JACO brute-force emergency stop.
#
#   .\agents\emergency-stop.ps1                   stop everything now and latch
#   .\agents\emergency-stop.ps1 -Clear            remove the latch (does not re-grant anything)
#   .\agents\emergency-stop.ps1 -InstallShortcut  desktop shortcut with hotkey Ctrl+Alt+Shift+Q
#
# Does not ask the runtime for permission and does not wait for it: a hung or misbehaving runtime
# must not be able to delay the stop. Order:
#   1. latch file, so start-all.ps1 refuses to start again
#   2. kill executors first (they act on the desktop and browser), then every other JACO process
#   3. revoke on disk: autonomy mandates, Hands-Off grants, Continuum emergency latch
#   4. verify that no JACO process or port remains
# Written for Windows PowerShell 5.1 and PowerShell 7.

param(
  [string]$Reason = 'operator brute-force emergency stop',
  [switch]$Clear,
  [switch]$InstallShortcut
)

$ErrorActionPreference = 'Continue'
$Proj = Split-Path $PSScriptRoot -Parent
$Runtime = Join-Path $Proj 'runtime'
$Latch = Join-Path $Proj '.jaco-emergency-stop.json'
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-JsonFile([string]$Path, $Value) {
  [System.IO.File]::WriteAllText($Path, (ConvertTo-Json -InputObject $Value -Depth 30), $Utf8)
}

if ($InstallShortcut) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $link = Join-Path $desktop 'JACO NODSTOPP.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($link)
  $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  $shortcut.WorkingDirectory = $Proj
  $shortcut.Hotkey = 'CTRL+ALT+SHIFT+Q'
  $shortcut.Description = 'JACO brute-force emergency stop'
  $shortcut.Save()
  Write-Host "Shortcut: $link (Ctrl+Alt+Shift+Q)" -ForegroundColor Green
  exit 0
}

if ($Clear) {
  if (Test-Path $Latch) { Remove-Item -LiteralPath $Latch -Force; Write-Host 'Emergency latch removed.' -ForegroundColor Yellow }
  else { Write-Host 'No emergency latch present.' }
  Write-Host 'Mandates and grants stay revoked; grant them again deliberately. The Continuum latch is reset through its operator API.'
  exit 0
}

$started = Get-Date

# 1. Latch first, before anything can restart.
Write-JsonFile $Latch ([ordered]@{ latched = $true; at = $started.ToUniversalTime().ToString('o'); reason = $Reason; by = $env:USERNAME; host = $env:COMPUTERNAME })

# 2. Kill. Match on JACO script names, the project path and the tunnel config; never on generic names alone.
$executorPattern = 'desktop-agentos\.mjs|run-desktop-agentos\.mjs|hands-off-agent\.mjs|nova-autonomous-agent\.mjs|serra-desktop-agent\.mjs|jaco-uia-bridge\.ps1|serra-input-bridge\.ps1|input-bridge\.ps1'
$servicePattern = 'nova-bridge\.mjs|cdp-bridge\.mjs|gateway[\\/]src[\\/]seer|seer-start\.mjs|chatgpt-nova-gateway\.mjs|a2a-server\.mjs|workplace-server\.mjs|standalone-server\.mjs|continuum-sentinel\.mjs|server\.ts|npm run dev|start-all\.ps1|cloudflared-config\.yml|JACO\\Chrome-CDP|agent-trader\.mjs|jaco-ctl\.mjs'
$projPattern = [regex]::Escape($Proj)
$self = $PID

function Get-JacoProcesses([string]$Pattern) {
  Get-CimInstance Win32_Process -Property ProcessId, Name, CommandLine | Where-Object {
    $_.ProcessId -ne $self -and $_.CommandLine -and
    $_.CommandLine -notmatch 'emergency-stop\.ps1' -and
    # Never the operator's own tools (Claude Code, VS Code extensions).
    $_.CommandLine -notmatch '(?i)claude|\.vscode[\\/]extensions' -and
    ($_.CommandLine -match $Pattern -or ($_.Name -in @('node.exe') -and $_.CommandLine -match $projPattern))
  }
}

# One process snapshot; executors die first because they are the ones acting on the desktop and browser.
$killed = New-Object System.Collections.ArrayList
$targets = @(Get-JacoProcesses "$executorPattern|$servicePattern")
$ordered = @($targets | Where-Object { $_.CommandLine -match $executorPattern }) + @($targets | Where-Object { $_.CommandLine -notmatch $executorPattern })
foreach ($p in $ordered) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  [void]$killed.Add(('{0} {1}' -f $p.ProcessId, $p.Name))
}

# Anything still listening on a JACO port is killed by owner, whatever its command line says.
$jacoPorts = @(2995, 2996, 2997, 2998, 3000, 4243, 4250, 9222)
foreach ($conn in @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $jacoPorts -contains $_.LocalPort })) {
  $owner = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
  if ($owner -and $owner.ProcessName -in @('node', 'cloudflared', 'powershell', 'pwsh', 'chrome')) {
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    [void]$killed.Add(('{0} {1} (port {2})' -f $conn.OwningProcess, $owner.ProcessName, $conn.LocalPort))
  }
}
$killedAt = [int]((Get-Date) - $started).TotalMilliseconds

# 3. Revoke on disk. The runtime is dead, so it cannot overwrite these files afterwards.
$revoked = New-Object System.Collections.ArrayList
foreach ($root in @($Runtime, (Join-Path $Runtime '.jaco-substrate'), (Join-Path $Runtime '.jaco-peer-b'))) {
  $mandatesFile = Join-Path $root '.jaco\state\autonomy\mandates.json'
  if (Test-Path $mandatesFile) {
    try {
      $mandates = @(Get-Content -Raw -LiteralPath $mandatesFile | ConvertFrom-Json)
      $active = 0
      foreach ($m in $mandates) { if ($m.enabled) { $m.enabled = $false; $active++ } }
      Write-JsonFile $mandatesFile $mandates
      [void]$revoked.Add("$active mandate(s) disabled in $mandatesFile")
    } catch { [void]$revoked.Add("FAILED to rewrite $mandatesFile : $($_.Exception.Message)") }
  }
  $stateDir = Join-Path $root '.jaco\state'
  if (Test-Path $stateDir) {
    foreach ($grant in @(Get-ChildItem -LiteralPath $stateDir -Recurse -Filter 'grant.json' -ErrorAction SilentlyContinue)) {
      try {
        $g = Get-Content -Raw -LiteralPath $grant.FullName | ConvertFrom-Json
        if ($g.PSObject.Properties.Name -contains 'enabled') { $g.enabled = $false } else { $g | Add-Member -NotePropertyName enabled -NotePropertyValue $false }
        Write-JsonFile $grant.FullName $g
        [void]$revoked.Add("grant disabled: $($grant.FullName)")
      } catch { [void]$revoked.Add("FAILED to rewrite $($grant.FullName) : $($_.Exception.Message)") }
    }
  }
  # The operator file only exists after a first operator action, so create it when the runtime has state.
  $continuumDir = Join-Path $root '.jaco\continuum'
  if (Test-Path $continuumDir) {
    $operatorFile = Join-Path $continuumDir 'operator-control.json'
    try {
      $generation = 1
      if (Test-Path $operatorFile) { $previous = Get-Content -Raw -LiteralPath $operatorFile | ConvertFrom-Json; $generation = [int]$previous.generation + 1 }
      Write-JsonFile $operatorFile ([ordered]@{ mode = 'STOPPED'; emergencyLatched = $true; reason = $Reason; changedAt = (Get-Date).ToUniversalTime().ToString('o'); changedBy = 'emergency-stop.ps1'; generation = $generation })
      [void]$revoked.Add("Continuum emergency latch set: $operatorFile")
    } catch { [void]$revoked.Add("FAILED to latch $operatorFile : $($_.Exception.Message)") }
  }
}

# 4. Verify.
Start-Sleep -Milliseconds 800
$remaining = @(Get-JacoProcesses "$executorPattern|$servicePattern")
$openPorts = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $jacoPorts -contains $_.LocalPort } | ForEach-Object { $_.LocalPort } | Sort-Object -Unique)
$elapsed = [int]((Get-Date) - $started).TotalMilliseconds

Write-Host ''
Write-Host "JACO EMERGENCY STOP (processes killed after $killedAt ms, done after $elapsed ms)" -ForegroundColor Red
Write-Host "Killed: $($killed.Count)"
foreach ($k in $killed) { Write-Host "  $k" }
foreach ($r in $revoked) { Write-Host "  $r" }
if ($remaining.Count -eq 0 -and $openPorts.Count -eq 0) {
  Write-Host '[OK] No JACO process or port remains.' -ForegroundColor Green
} else {
  foreach ($p in $remaining) { Write-Host "[FAIL] still running: $($p.ProcessId) $($p.Name)" -ForegroundColor Red }
  foreach ($port in $openPorts) { Write-Host "[FAIL] still listening: $port" -ForegroundColor Red }
}
Write-Host "Latched: $Latch  (start-all.ps1 refuses to start until: .\agents\emergency-stop.ps1 -Clear)" -ForegroundColor Yellow
