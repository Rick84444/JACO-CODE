# JACO Lite installer for Windows (PowerShell 5.1 or newer, no administrator rights).
#
#   irm https://github.com/Rick84444/JACO-CODE/releases/latest/download/install.ps1 | iex
#
# What it does, in order, and nothing else:
#   1. reads https://github.com/Rick84444/JACO-CODE/releases/latest/download/latest.json and picks the Windows file
#   2. downloads it and refuses to go on unless its SHA-256 matches latest.json
#   3. uses the Node.js you have if it is 22.5 or newer; otherwise downloads the official Node.js LTS zip from
#      nodejs.org into the JACO folder (checked against nodejs.org's SHASUMS256.txt)
#   4. unpacks into  <install>\versions\<build>  and points the  current  junction at it (the previous build is kept
#      for rollback, older ones are removed)
#   5. adds <install>\bin to your user PATH and a Start menu shortcut
# Nothing outside <install> except those two entries. Run it again to update.
#
#   jaco-lite             start JACO Lite in the current folder
#   jaco-lite update      install the newest build
#   jaco-lite rollback    go back to the previous build
#   jaco-lite doctor      what is installed and whether it can start
#   jaco-lite uninstall   remove it (your projects and %USERPROFILE%\.jaco are not touched)
#
# Environment (all optional): JACO_LITE_HOME (default %LOCALAPPDATA%\JACO Lite), JACO_LITE_BASE_URL (default
# https://github.com/Rick84444/JACO-CODE/releases/latest/download), JACO_LITE_NODE_DIST_URL (default https://nodejs.org/dist/latest-v24.x),
# JACO_LITE_FORCE=1, JACO_LITE_NO_MODIFY_PATH=1, JACO_LITE_NO_SHORTCUT=1, JACO_LITE_YES=1 (uninstall without asking).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is many times faster without the progress bar
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

function Env([string]$name, [string]$default) { $v = [Environment]::GetEnvironmentVariable($name); if ($v) { $v } else { $default } }
$BaseUrl = (Env 'JACO_LITE_BASE_URL' 'https://github.com/Rick84444/JACO-CODE/releases/latest/download').TrimEnd('/')
$NodeDist = (Env 'JACO_LITE_NODE_DIST_URL' 'https://nodejs.org/dist/latest-v24.x').TrimEnd('/')
$LocalApp = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME '.local/share' }
$InstallDir = Env 'JACO_LITE_HOME' (Join-Path $LocalApp 'JACO Lite')
$InstallDir = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\', '/')   # the launcher passes <folder>\bin\..
$Action = (Env 'JACO_LITE_ACTION' 'install').ToLowerInvariant()
$ScriptPath = $MyInvocation.MyCommand.Path   # empty under  irm | iex

function Say([string]$text) { Write-Host $text }
function Step([string]$text) { Write-Host ''; Write-Host "==> $text" }
function Fail([string]$text) { throw $text }
$script:Code = 0
function Sha256Of([string]$path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant() }
function NodeOk([string]$exe) {
  try { & $exe -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)" 2>$null; return ($LASTEXITCODE -eq 0) } catch { return $false }
}
# .NET's zip reader: it needs no Microsoft.PowerShell.Archive module (which can fail to load) and is faster for thousands of files.
function Unzip([string]$zip, [string]$dest) {
  try { Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop; [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $dest) }
  catch { Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force }
}
# A junction is removed without touching what it points to.
function RemoveLink([string]$path) { if (Test-Path -LiteralPath $path) { [System.IO.Directory]::Delete($path, $false) } }
# A junction on Windows (no administrator rights needed); PowerShell 7 on Linux/macOS, which the tests use, has symbolic links.
$LinkType = if ($IsLinux -or $IsMacOS) { 'SymbolicLink' } else { 'Junction' }
function SetLink([string]$link, [string]$target) { RemoveLink $link; New-Item -ItemType $LinkType -Path $link -Target $target | Out-Null }
function LinkTarget([string]$link) { if (Test-Path -LiteralPath $link) { (Get-Item -LiteralPath $link).Target | Select-Object -First 1 } else { $null } }
function ReadInfo {
  $f = Join-Path $InstallDir 'install.json'
  if (-not (Test-Path -LiteralPath $f)) { return $null }
  $text = Get-Content -LiteralPath $f -Raw
  $field = { param($n) $m = [regex]::Match($text, '"' + $n + '"\s*:\s*"([^"]+)"'); if ($m.Success) { $m.Groups[1].Value } else { '' } }
  [pscustomobject]@{ version = (& $field 'version'); builtAt = (& $field 'builtAt'); sha256 = (& $field 'sha256'); file = (& $field 'file') }
}

# --- actions other than install ------------------------------------------------------------------------------------
function Invoke-JacoLite {
if ($Action -eq 'version') { $i = ReadInfo; if ($i) { Write-Output $i.version }; return }
if ($Action -eq 'doctor') {
  $i = ReadInfo
  Say "install folder : $InstallDir"; Say "current build  : $(LinkTarget (Join-Path $InstallDir 'current'))"; Say "previous build : $(if (LinkTarget (Join-Path $InstallDir 'previous')) { LinkTarget (Join-Path $InstallDir 'previous') } else { 'none' })"
  $node = Join-Path $InstallDir 'runtime\node\node.exe'; if (-not (Test-Path -LiteralPath $node)) { $node = 'node' }
  Say "node           : $node ($(try { & $node --version } catch { 'does not start' }))"
  if ($i) { Say "builtAt        : $($i.builtAt)"; Say "sha256         : $($i.sha256)" }
  & $node (Join-Path (Join-Path $InstallDir 'current') 'start.mjs') --check; $script:Code = $LASTEXITCODE; return
}
if ($Action -eq 'rollback') {
  $prev = LinkTarget (Join-Path $InstallDir 'previous'); $cur = LinkTarget (Join-Path $InstallDir 'current')
  if (-not $prev) { Write-Host 'jaco-lite: there is no previous build to go back to.'; $script:Code = 1; return }
  SetLink (Join-Path $InstallDir 'current') $prev; SetLink (Join-Path $InstallDir 'previous') $cur
  Say "jaco-lite: now on $prev (was $cur)."; return
}
if ($Action -eq 'uninstall') {
  if ((Env 'JACO_LITE_YES' '') -ne '1') { $a = Read-Host "Remove $InstallDir? Your projects and %USERPROFILE%\.jaco are not touched. [y/N]"; if ($a -notmatch '^[yY]') { Say 'kept.'; return } }
  # take the folder off the PATH, remove the shortcut, then the folder (junctions first, so nothing behind them is followed)
  $bin = Join-Path $InstallDir 'bin'
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($userPath) { [Environment]::SetEnvironmentVariable('Path', (($userPath -split ';' | Where-Object { $_ -and ($_.TrimEnd('\') -ne $bin) }) -join ';'), 'User') }
  try { $lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'JACO Lite.lnk'; if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force } } catch { }
  RemoveLink (Join-Path $InstallDir 'current'); RemoveLink (Join-Path $InstallDir 'previous')
  if ($IsLinux -or $IsMacOS) { Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue }
  else {
    # The launcher (bin\jaco-lite.cmd) that started this is still running: cmd goes back to read a batch file after each command, so
    # deleting it now makes cmd fail ('The system cannot find the path specified'). Everything else goes now; the folder itself is
    # removed by a hidden cmd a moment after the launcher has exited.
    Get-ChildItem -LiteralPath $InstallDir -Force | Where-Object { $_.Name -ne 'bin' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Start-Process -FilePath "$env:ComSpec" -ArgumentList '/d', '/c', "ping -n 4 127.0.0.1 >nul & rd /s /q `"$InstallDir`"" -WindowStyle Hidden
  }
  Say 'jaco-lite: removed.'; return
}
if ($Action -ne 'install' -and $Action -ne 'update') { Fail "unknown action '$Action'" }

# --- install / update ------------------------------------------------------------------------------------------------
if ($env:PROCESSOR_ARCHITECTURE -eq 'x86' -and -not $env:PROCESSOR_ARCHITEW6432) { Fail 'JACO Lite needs a 64-bit Windows.' }
Step 'Looking up the newest JACO Lite (Windows)'
try { $raw = (Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/latest.json").Content } catch { Fail "could not read $BaseUrl/latest.json (offline?)." }
if ($raw -is [byte[]]) { $raw = [Text.Encoding]::UTF8.GetString($raw) }
$meta = $raw | ConvertFrom-Json
# ConvertFrom-Json turns an ISO date into a DateTime (and a local format); the text itself is what we keep.
function RawField([string]$name) { $m = [regex]::Match($raw, '"' + $name + '"\s*:\s*"([^"]+)"'); if ($m.Success) { $m.Groups[1].Value } else { '' } }
$entry = $meta.files.windows
if (-not $entry -or -not $entry.file -or -not $entry.sha256) { Fail "latest.json has no download for Windows." }
if ($entry.file -notmatch '^[A-Za-z0-9._-]+$' -or $entry.file -match '\.\.') { Fail "latest.json names an unsafe file: $($entry.file)" }
if ($entry.sha256 -notmatch '^[0-9a-f]{64}$') { Fail 'latest.json has a bad checksum.' }
$builtAt = RawField 'builtAt'
$version = RawField 'version'
Say "    build $builtAt  ($($entry.file))"

$work = Join-Path ([IO.Path]::GetTempPath()) ('jaco-lite-install-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  $info = ReadInfo
  $upToDate = $info -and $info.sha256 -eq $entry.sha256 -and (Test-Path -LiteralPath (Join-Path $InstallDir 'current')) -and (Env 'JACO_LITE_FORCE' '0') -ne '1'
  if ($upToDate) { Say '    already up to date.' }
  else {
    Step "Downloading $($entry.file)"
    $zip = Join-Path $work $entry.file
    Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/$($entry.file)" -OutFile $zip
    $got = Sha256Of $zip
    if ($got -ne $entry.sha256) { Fail "the download does not match its SHA-256 (expected $($entry.sha256), got $got). Nothing was installed." }
    Say '    SHA-256 matches.'
  }

  Step 'Checking Node.js'
  $nodeExe = $null
  $sys = Get-Command node -ErrorAction SilentlyContinue
  if ($sys -and (NodeOk $sys.Source)) { $nodeExe = $sys.Source; Say "    using $nodeExe ($(& $nodeExe --version))" }
  else {
    $private = Join-Path $InstallDir 'runtime\node\node.exe'
    if ((Test-Path -LiteralPath $private) -and (NodeOk $private)) { $nodeExe = $private; Say "    using the Node.js JACO installed earlier ($(& $nodeExe --version))" }
    else {
      $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
      Say "    Node.js 22.5+ not found; downloading the official Node.js LTS build (it stays inside $InstallDir)"
      try { $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$NodeDist/SHASUMS256.txt").Content } catch { Fail "could not read $NodeDist/SHASUMS256.txt" }
      $line = ($sums -split "`n" | Where-Object { $_ -match "\s+node-v[0-9.]+-win-$arch\.zip\s*$" } | Select-Object -First 1)
      if (-not $line) { Fail "nodejs.org has no win-$arch zip in $NodeDist." }
      $parts = ($line.Trim() -split '\s+'); $nodeSha = $parts[0].ToLowerInvariant(); $nodeZip = $parts[-1]
      $nz = Join-Path $work $nodeZip
      Invoke-WebRequest -UseBasicParsing -Uri "$NodeDist/$nodeZip" -OutFile $nz
      if ((Sha256Of $nz) -ne $nodeSha) { Fail "the Node.js download does not match nodejs.org's checksum. Nothing was installed." }
      Unzip $nz (Join-Path $work 'node-unpack')
      $runtime = Join-Path $InstallDir 'runtime'; New-Item -ItemType Directory -Force -Path $runtime | Out-Null
      if (Test-Path -LiteralPath (Join-Path $runtime 'node')) { Remove-Item -LiteralPath (Join-Path $runtime 'node') -Recurse -Force }
      Move-Item -LiteralPath (Get-ChildItem (Join-Path $work 'node-unpack') -Directory | Select-Object -First 1).FullName -Destination (Join-Path $runtime 'node')
      $nodeExe = $private
      if (-not (NodeOk $nodeExe)) { Fail 'the downloaded Node.js does not start on this machine.' }
      Say "    installed Node.js $(& $nodeExe --version)"
    }
  }

  if (-not $upToDate) {
    Step 'Installing'
    $stamp = ($builtAt -replace '[^A-Za-z0-9]', '-').Trim('-'); if (-not $stamp) { $stamp = (Get-Date -Format 'yyyyMMddHHmmss') }
    $versions = Join-Path $InstallDir 'versions'; New-Item -ItemType Directory -Force -Path $versions | Out-Null
    $unpack = Join-Path $work 'unpack'
    Unzip $zip $unpack
    $top = Get-ChildItem $unpack -Directory | Select-Object -First 1
    if (-not $top -or -not (Test-Path -LiteralPath (Join-Path $top.FullName 'start.mjs'))) { Fail 'the archive does not look like JACO Lite (no start.mjs). Nothing was installed.' }
    $dest = Join-Path $versions $stamp
    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
    Move-Item -LiteralPath $top.FullName -Destination $dest
    $current = Join-Path $InstallDir 'current'
    $before = LinkTarget $current
    if ($before -and ((Split-Path $before -Leaf) -ne $stamp)) { SetLink (Join-Path $InstallDir 'previous') $before }
    SetLink $current $dest
    $keep = @($stamp); $prevNow = LinkTarget (Join-Path $InstallDir 'previous'); if ($prevNow) { $keep += (Split-Path $prevNow -Leaf) }
    Get-ChildItem $versions -Directory | Where-Object { $keep -notcontains $_.Name } | Remove-Item -Recurse -Force
    @{ version = $version; builtAt = $builtAt; file = $entry.file; sha256 = $entry.sha256; kind = 'windows' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $InstallDir 'install.json') -Encoding UTF8
  }

  # --- launcher, this installer (for  jaco-lite update ), PATH, shortcut -----------------------------------------
  $bin = Join-Path $InstallDir 'bin'; New-Item -ItemType Directory -Force -Path $bin | Out-Null
  $self = $ScriptPath
  if ($self -and (Test-Path -LiteralPath $self) -and ((Resolve-Path $self).Path -ne (Join-Path $InstallDir 'install.ps1'))) { Copy-Item -LiteralPath $self -Destination (Join-Path $InstallDir 'install.ps1') -Force }
  elseif (-not (Test-Path -LiteralPath (Join-Path $InstallDir 'install.ps1'))) {
    try { Invoke-WebRequest -UseBasicParsing -Uri (Env 'JACO_LITE_INSTALL_URL' 'https://github.com/Rick84444/JACO-CODE/releases/latest/download/install.ps1') -OutFile (Join-Path $work 'install.ps1.new'); if ((Get-Item (Join-Path $work 'install.ps1.new')).Length -gt 0) { Copy-Item (Join-Path $work 'install.ps1.new') (Join-Path $InstallDir 'install.ps1') -Force } } catch { }
  }
  $launcher = @'
@echo off
setlocal
set "JACO_LITE_HOME=%~dp0.."
set "JACO_LITE_INSTALLER=1"
for %%A in (update rollback doctor uninstall version) do if /i "%~1"=="%%A" goto action
set "NODE=%JACO_LITE_HOME%\runtime\node\node.exe"
if not exist "%NODE%" set "NODE=NODEFALLBACK"
"%NODE%" "%JACO_LITE_HOME%\current\start.mjs" %*
exit /b %errorlevel%
:action
set "JACO_LITE_ACTION=%~1"
if /i "%~2"=="--yes" set "JACO_LITE_YES=1"
rem One line: cmd has parsed it all before PowerShell runs, so "uninstall" can delete this very file without cmd reading on from it.
powershell -NoProfile -ExecutionPolicy Bypass -File "%JACO_LITE_HOME%\install.ps1" && exit /b 0 || exit /b 1
'@
  $fallback = if ($sys) { $sys.Source } else { 'node' }
  Set-Content -LiteralPath (Join-Path $bin 'jaco-lite.cmd') -Value ($launcher.Replace('NODEFALLBACK', $fallback)) -Encoding ASCII

  if ((Env 'JACO_LITE_NO_MODIFY_PATH' '0') -ne '1') {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $userPath -or (($userPath -split ';') | Where-Object { $_.TrimEnd('\') -eq $bin }).Count -eq 0) {
      [Environment]::SetEnvironmentVariable('Path', (($userPath, $bin | Where-Object { $_ }) -join ';'), 'User')
      Say '    added the bin folder to your user PATH (open a new terminal to use  jaco-lite )'
    }
  }
  if ((Env 'JACO_LITE_NO_SHORTCUT' '0') -ne '1') {
    try {
      $sh = New-Object -ComObject WScript.Shell
      $lnk = $sh.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'JACO Lite.lnk'))
      $lnk.TargetPath = Join-Path $bin 'jaco-lite.cmd'; $lnk.WorkingDirectory = $env:USERPROFILE; $lnk.Description = 'JACO Lite'; $lnk.Save()
    } catch { Say '    (could not create the Start menu shortcut; jaco-lite works without it)' }
  }
}
finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }

Step 'Done'
Say "    JACO Lite is installed in $InstallDir"
Say '    Start it in any project folder with:  jaco-lite     (or from the Start menu)'
Say '    Update:  jaco-lite update    Remove:  jaco-lite uninstall'
}

# Under  irm | iex  there is no script file and  exit  would close the user's PowerShell; as a file (jaco-lite update) the exit code matters.
try { Invoke-JacoLite } catch { Write-Host "jaco-lite install: $($_.Exception.Message)" -ForegroundColor Red; $script:Code = 1 }
if ($ScriptPath) { exit $script:Code }
