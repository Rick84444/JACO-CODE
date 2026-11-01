param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [string]$ExpectedCommit = $env:GITHUB_SHA,
  [string]$ReportPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'This acceptance script requires a real Windows host.' }

$installerFile = (Resolve-Path -LiteralPath $Installer).Path
$receipt = Get-Content -LiteralPath "$installerFile.receipt.json" -Raw | ConvertFrom-Json
$actualHash = (Get-FileHash -LiteralPath $installerFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($receipt.sha256 -ne $actualHash) { throw 'INSTALLER_RECEIPT_HASH_MISMATCH' }
if ($ExpectedCommit -and $receipt.sourceCommit -ne $ExpectedCommit) { throw 'INSTALLER_SOURCE_COMMIT_MISMATCH' }
if ($receipt.signature -ne 'unsigned') { throw 'This acceptance script expects the builder unsigned receipt.' }

$localApp = [Environment]::GetFolderPath('LocalApplicationData')
$installRoot = Join-Path $localApp 'Programs\JACO'
if (Test-Path -LiteralPath $installRoot) { throw 'Use a clean Windows test account; an existing JACO installation will not be overwritten.' }
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('jaco-install-acceptance-' + [Guid]::NewGuid().ToString('N'))
$workspace = Join-Path $testRoot 'workspace'
$oldWorkspace = $env:JACO_WORKSPACE_ROOT
$oldUpdateCheck = $env:JACO_LITE_NO_UPDATE_CHECK
$env:JACO_WORKSPACE_ROOT = $workspace
$env:JACO_LITE_NO_UPDATE_CHECK = '1'
$node = $null; $launcher = $null; $ownedLauncher = $null; $uninstalled = $false
$observations = [ordered]@{
  schema = 'jaco.windows-host-acceptance/v1'; observedAt = [DateTime]::UtcNow.ToString('o')
  sourceCommit = $receipt.sourceCommit; installerSha256 = $receipt.sha256
  environment = 'fresh Windows test account'; architecture = $receipt.arch
  install = 'unobserved'; bundledDevelopmentTools = 'unobserved'; runtimeIdentity = 'unobserved'
  setupGate = 'unobserved'; setupConsentRestart = 'unobserved'; duplicateLaunch = 'unobserved'
  uninstall = 'unobserved'; userDataPreserved = 'unobserved'; windowsSignInReboot = 'unobserved'
}

function Run-Node([string[]]$NodeArgs) {
  $output = & $script:node @NodeArgs 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "BUNDLED_NODE_COMMAND_FAILED: $output" }
  return $output.Trim()
}

function Desktop-Status {
  if (-not $script:node -or -not $script:launcher) { return $null }
  $raw = Run-Node @($script:launcher, '--status')
  if (-not $raw) { return $null }
  $state = $raw | ConvertFrom-Json
  if ($state.schema -ne 'jaco.desktop-control/v1') { throw 'DESKTOP_STATUS_INVALID' }
  return $state
}

function Wait-Identity([bool]$Pending, [int]$TimeoutSeconds = 120) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $state = Desktop-Status
    if ($state -and $state.ready -and $state.url) {
      $address = [Uri]$state.url
      if ($address.Scheme -ne 'http' -or $address.Host -ne '127.0.0.1') { throw 'NONLOCAL_DESKTOP_URL' }
      $origin = $address.GetLeftPart([UriPartial]::Authority)
      try {
        $identity = Invoke-RestMethod -Uri "$origin/api/runtime/identity" -TimeoutSec 3
        $pageMatches = if ($Pending) { $address.AbsolutePath -eq '/connect.html' } else { $address.AbsolutePath -eq '/' }
        if ($pageMatches -and $identity.success -eq $true -and $identity.product -eq 'JACO Autonomus IDE' -and $identity.setupPending -eq $Pending) {
          return [pscustomobject]@{ origin = $origin; identity = $identity; status = $state }
        }
      } catch { }
    }
    Start-Sleep -Milliseconds 300
  }
  throw "RUNTIME_IDENTITY_TIMEOUT: expected setupPending=$Pending"
}

function Uninstall-TestApplication {
  if (-not (Test-Path -LiteralPath $installRoot)) { return }
  if ($script:node -and $script:launcher -and (Test-Path -LiteralPath $script:node)) {
    try { $null = Run-Node @($script:launcher, '--stop') } catch { }
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while ([DateTime]::UtcNow -lt $deadline) {
      if (-not (Desktop-Status)) { break }
      Start-Sleep -Milliseconds 200
    }
  }
  $uninstaller = Join-Path $installRoot 'Uninstall JACO.exe'
  if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'UNINSTALLER_MISSING' }
  $remove = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
  if ($remove.ExitCode -ne 0) { throw "UNINSTALL_FAILED:$($remove.ExitCode)" }
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while ((Test-Path -LiteralPath $installRoot) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
  if (Test-Path -LiteralPath $installRoot) { throw 'UNINSTALL_LEFT_APPLICATION_FILES' }
}

try {
  New-Item -ItemType Directory -Force -Path $workspace | Out-Null
  Set-Content -LiteralPath (Join-Path $workspace 'keep-user-data.txt') -Value 'installer acceptance: preserve me' -Encoding UTF8
  $setup = Start-Process -FilePath $installerFile -ArgumentList '/S', '/ACCEPT=1' -Wait -PassThru
  if ($setup.ExitCode -ne 0) { throw "SETUP_FAILED:$($setup.ExitCode)" }
  $pointer = Get-Content -LiteralPath (Join-Path $installRoot 'current.json') -Raw | ConvertFrom-Json
  if ($pointer.sourceCommit -ne $receipt.sourceCommit -or $pointer.buildId -ne $receipt.buildId) { throw 'INSTALLED_POINTER_IDENTITY_MISMATCH' }
  $payload = Join-Path (Join-Path $installRoot 'versions') $pointer.buildId
  $node = Join-Path $payload 'node\node.exe'
  $launcher = Join-Path $payload 'installed-launch.mjs'
  $release = Get-Content -LiteralPath (Join-Path $payload 'app\release.json') -Raw | ConvertFrom-Json
  if ($release.sourceCommit -ne $receipt.sourceCommit) { throw 'INSTALLED_RUNTIME_SOURCE_MISMATCH' }
  $privateFiles = @(Get-ChildItem -LiteralPath (Join-Path $payload 'app') -Force -Recurse -File | Where-Object { $_.Name -eq '.env' })
  if ($privateFiles.Count) { throw 'PRIVATE_ENV_IN_APPLICATION_PAYLOAD' }
  $null = Run-Node @((Join-Path $payload 'install-state.mjs'), 'verify', $payload)
  $check = Run-Node @($launcher, '--check')
  if ($check -notmatch 'installation OK') { throw 'INSTALLED_RUNTIME_CHECK_FAILED' }
  $observations.install = 'passed'

  $nodeVersion = Run-Node @('--version')
  if ($nodeVersion -notmatch '^v24\.') { throw 'BUNDLED_NODE_VERSION_UNEXPECTED' }
  $npmVersion = Run-Node @((Join-Path $payload 'node\node_modules\npm\bin\npm-cli.js'), '--version')
  if ($npmVersion -notmatch '^\d+\.\d+\.\d+') { throw 'BUNDLED_NPM_MISSING' }
  $gitVersion = & (Join-Path $payload 'git\cmd\git.exe') --version
  if ($LASTEXITCODE -ne 0 -or $gitVersion -notmatch '^git version ') { throw 'BUNDLED_GIT_MISSING' }
  $observations.bundledDevelopmentTools = 'passed'

  $ownedLauncher = Start-Process -FilePath $node -ArgumentList ('"' + $launcher + '"') -WindowStyle Hidden -PassThru
  $before = Wait-Identity $true
  if ($before.identity.version -ne $receipt.version -or $before.status.sourceCommit -ne $receipt.sourceCommit) { throw 'LIVE_IDENTITY_MISMATCH' }
  $observations.runtimeIdentity = 'passed'
  $setupState = Invoke-RestMethod -Uri "$($before.origin)/api/aura/workbench/setup" -Headers @{ Origin = $before.origin } -TimeoutSec 5
  if ($setupState.setupPending -ne $true -or $null -ne $setupState.setup) { throw 'FRESH_INSTALL_DID_NOT_REQUIRE_SETUP' }
  $blocked = $false
  try { Invoke-RestMethod -Uri "$($before.origin)/api/aura/workbench/live" -TimeoutSec 5 | Out-Null }
  catch { $blocked = ([int]$_.Exception.Response.StatusCode -eq 409) }
  if (-not $blocked) { throw 'UNAPPROVED_RUNTIME_API_WAS_NOT_BLOCKED' }
  $observations.setupGate = 'passed'

  # This explicit consent belongs to the disposable test account, never to an end user's future installation.
  $choices = @{ confirmed = $true; language = 'en'; discoverLocal = $false; connectTools = $false; runAgent = $false; cloudModels = $false } | ConvertTo-Json
  $accepted = Invoke-RestMethod -Uri "$($before.origin)/api/aura/workbench/setup/complete" -Method Post `
    -Headers @{ Origin = $before.origin } -ContentType 'application/json' -Body $choices -TimeoutSec 10
  if ($accepted.success -ne $true -or $accepted.restartRequired -ne $true) { throw 'SETUP_CONSENT_NOT_SAVED' }
  $after = Wait-Identity $false
  $saved = Get-Content -LiteralPath (Join-Path $workspace '.jaco\installation.json') -Raw | ConvertFrom-Json
  if ($saved.schema -ne 'jaco.installation/v1' -or $saved.cloudModels -ne $false -or $saved.runAgent -ne $false -or $saved.connectTools -ne $false) { throw 'SETUP_CHOICES_CHANGED' }
  $economic = Get-Content -LiteralPath (Join-Path $workspace '.jaco\continuum\economic-policy.json') -Raw | ConvertFrom-Json
  if ($economic.cloudEnabled -ne $false) { throw 'CLOUD_POLICY_CHANGED_WITHOUT_APPROVAL' }
  $observations.setupConsentRestart = 'passed'

  & "$env:SystemRoot\System32\cscript.exe" //nologo (Join-Path $installRoot 'launch.vbs') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'SHORTCUT_LAUNCH_FAILED' }
  Start-Sleep -Milliseconds 800
  $again = Desktop-Status
  if (-not $again -or $again.url -ne $after.status.url) { throw 'DUPLICATE_LAUNCH_CHANGED_RUNTIME' }
  $owners = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($launcher) })
  if ($owners.Count -ne 1 -or $owners[0].ProcessId -ne $ownedLauncher.Id) { throw 'DUPLICATE_RUNTIME_LAUNCHER' }
  $observations.duplicateLaunch = 'passed'

  Uninstall-TestApplication
  $uninstalled = $true
  $observations.uninstall = 'passed'
  if (-not (Test-Path -LiteralPath (Join-Path $workspace 'keep-user-data.txt')) -or -not (Test-Path -LiteralPath (Join-Path $workspace '.jaco\installation.json'))) { throw 'UNINSTALL_REMOVED_USER_DATA' }
  $observations.userDataPreserved = 'passed'
  $report = if ($ReportPath) { $ReportPath } else { "$installerFile.windows-host.json" }
  $observations | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $report -Encoding UTF8
  Write-Host "Windows installer host acceptance passed. Evidence: $report"
} finally {
  if (-not $uninstalled -and (Test-Path -LiteralPath $installRoot)) {
    try { Uninstall-TestApplication } catch { Write-Warning 'Acceptance cleanup could not verify removal; inspect this test account before reuse.' }
  }
  $env:JACO_WORKSPACE_ROOT = $oldWorkspace
  $env:JACO_LITE_NO_UPDATE_CHECK = $oldUpdateCheck
}
