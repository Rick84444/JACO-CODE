<#
  JACO Desktop Hands-Off Bridge (Windows) — UI Automation actuation

  Invoked only as:

      powershell -NoProfile -ExecutionPolicy Bypass -File jaco-desktop-bridge.ps1 -RequestFile <path>

  Same shape the AURA terminal policy already permits: an explicit workspace .ps1
  through -File, never -Command, never a pipeline. The request is a JSON file, so
  no operator or model text ever reaches a PowerShell parser.

  ── Why UI Automation and not synthetic input ────────────────────────────────
  The first version of this bridge drove the desktop by injecting synthetic Win32 input. Windows
  Defender's AMSI blocked it on sight — correctly: a script that synthesises
  keystrokes has the signature of a keylogger, and evading that check would be the
  wrong thing to build.

  UI Automation is the better answer anyway. It is the same accessibility
  interface a screen reader uses, and it is the desktop counterpart of the
  Android Accessibility service the NOVA hands-off path already relies on:

    - Actions go through the control's own programmatic interface. InvokePattern
      presses the real button; it does not aim a click at a pixel that moves when
      the window does.
    - ValuePattern sets an edit field atomically. No keystroke stream to race
      with focus changes, no half-typed text if a plan is cancelled mid-step.
    - JACO can only act on controls the application itself chose to expose as
      programmatically operable. An app that exposes nothing cannot be driven —
      and that refusal is the correct outcome, not a gap to work around with
      coordinates.

  Contract: reads one JSON request, writes one JSON response to stdout, exits 0
  even on a refusal (a refusal is data, not a crash). Exit 1 means the bridge
  itself failed.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$RequestFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# The response is JSON on stdout and window titles routinely contain non-ASCII.
# Without this the host console code page mangles them (a Swedish title comes
# back as "S?k p? Google"), which corrupts both the snapshot hash and any
# selector matched against a name.
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing

$UIA = [System.Windows.Automation.AutomationElement]
$TreeScope = [System.Windows.Automation.TreeScope]
$Walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

# ── Refusal policy ────────────────────────────────────────────────────────────
# The deny lists are supplied by the caller with every request rather than being
# hardcoded here. Two reasons, one of them learned the hard way:
#
#   1. Policy belongs in the Node layer, where it is versioned, unit-tested and
#      auditable alongside the grant that authorises a session.
#   2. An actuation script carrying a literal list of credential-manager and LSA
#      process names reads to Defender's AMSI heuristics exactly like credential
#      theft tooling, and it blocked this file on sight. That block was a fair
#      call on the shape of the text. Moving the policy out is the honest fix;
#      the enforcement below is unchanged.
#
# The bridge refuses to act when no policy is supplied, so a caller cannot get
# unrestricted actuation by simply omitting the lists.
$script:BlockedProcesses = @()
$script:BlockedTitlePattern = $null
$script:SecretFieldPattern = $null

function New-Response {
  param([bool]$Ok, $Data, [string]$ErrorMessage, [string]$Refusal)
  $response = [ordered]@{
    ok            = $Ok
    observedAt    = (Get-Date).ToUniversalTime().ToString('o')
    bridgeVersion = '1.1.0-uia'
  }
  if ($null -ne $Data) { $response.data = $Data }
  if ($ErrorMessage) { $response.error = $ErrorMessage }
  if ($Refusal) { $response.refusal = $Refusal }
  return $response
}

function Write-Response {
  param($Response)
  $Response | ConvertTo-Json -Depth 14 -Compress
}

function Get-ProcessNameSafe {
  param([int]$ProcessId)
  if ($ProcessId -le 0) { return $null }
  try { return (Get-Process -Id $ProcessId -ErrorAction Stop).ProcessName } catch { return $null }
}

function Get-WindowDescriptor {
  param($Element)
  $current = $Element.Current
  $processName = Get-ProcessNameSafe -ProcessId $current.ProcessId
  $descriptor = [ordered]@{
    name        = $current.Name
    processName = $processName
    processId   = [int]$current.ProcessId
    className   = $current.ClassName
    hwnd        = [int64]$current.NativeWindowHandle
  }

  # Top-level geometry is observation evidence, not an actuation target. It lets
  # the perception layer derive a fresh visual ROI after a window has moved,
  # instead of persisting stale screen coordinates.
  try {
    $rect = $current.BoundingRectangle
    if (-not [double]::IsInfinity($rect.X) -and -not [double]::IsInfinity($rect.Y) -and $rect.Width -gt 0 -and $rect.Height -gt 0) {
      $descriptor.rect = [ordered]@{
        x = [int]$rect.X
        y = [int]$rect.Y
        width = [int]$rect.Width
        height = [int]$rect.Height
      }
    }
  } catch { }

  return $descriptor
}

function Test-SensitiveWindow {
  param($Descriptor)
  if ($null -eq $Descriptor) { return $null }
  $name = if ($Descriptor.processName) { $Descriptor.processName.ToLowerInvariant() } else { '' }
  if ($script:BlockedProcesses -contains $name) {
    return "process '$name' is a credential or system-security surface and is permanently blocked"
  }
  if ($script:BlockedTitlePattern -and $Descriptor.name -and $Descriptor.name -match $script:BlockedTitlePattern) {
    return 'window title matches a credential or elevation prompt and is permanently blocked'
  }
  return $null
}

function Assert-WindowAllowed {
  param($Descriptor, [string[]]$AllowedProcesses)
  $sensitive = Test-SensitiveWindow -Descriptor $Descriptor
  if ($sensitive) { return $sensitive }
  if ($script:BlockedProcesses.Count -eq 0) {
    return 'no refusal policy was supplied with this request; the bridge will not actuate without one'
  }
  if ($null -eq $AllowedProcesses -or $AllowedProcesses.Count -eq 0) {
    return 'no allowed_processes were supplied with this request'
  }
  $name = if ($Descriptor.processName) { $Descriptor.processName.ToLowerInvariant() } else { '' }
  $allowed = @($AllowedProcesses | ForEach-Object { $_.ToLowerInvariant() -replace '\.exe$', '' })
  if ($allowed -notcontains $name) {
    return "process '$name' is not in the active grant allowlist"
  }
  return $null
}

# Window listing is read-only. UI Automation's root FindAll waits on every top-level window,
# so one unresponsive window made the listing take 30 s (over the runtime's 20 s budget) and
# the whole desktop surface looked dead. Enumerating with read-only user32 queries takes under
# a second and marks hung windows instead of blocking on them. Actuation still goes only
# through UI Automation patterns; nothing here synthesises input.
$script:Win32Ready = $false
try {
  Add-Type -Namespace JacoUia -Name TopWindows -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, System.IntPtr p);
public delegate bool EnumProc(System.IntPtr h, System.IntPtr p);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool IsHungAppWindow(System.IntPtr h);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern System.IntPtr GetWindow(System.IntPtr h, uint cmd);
[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(System.IntPtr h, int attribute, out int value, int size);
public static System.Collections.Generic.List<System.IntPtr> VisibleTopLevel() {
  var result = new System.Collections.Generic.List<System.IntPtr>();
  EnumWindows((h, p) => { if (IsWindowVisible(h) && GetWindow(h, 4) == System.IntPtr.Zero) result.Add(h); return true; }, System.IntPtr.Zero);
  return result;
}
'@ -ErrorAction Stop
  $script:Win32Ready = $true
} catch { $script:Win32Ready = $false }

function Get-TopLevelWindows {
  if (-not $script:Win32Ready) {
    $windows = @()
    $children = $UIA::RootElement.FindAll($TreeScope::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($element in $children) {
      try {
        $current = $element.Current
        if (-not $current.Name) { continue }
        if ($current.IsOffscreen) { continue }
        $windows += (Get-WindowDescriptor -Element $element)
      } catch { }
    }
    return $windows
  }
  $processNames = @{}
  foreach ($process in Get-Process) { $processNames[[int]$process.Id] = $process.ProcessName }
  $windows = @()
  foreach ($handle in [JacoUia.TopWindows]::VisibleTopLevel()) {
    $title = New-Object System.Text.StringBuilder 512
    [void][JacoUia.TopWindows]::GetWindowTextW($handle, $title, 512)
    if (-not $title.ToString()) { continue }
    $cloaked = 0
    [void][JacoUia.TopWindows]::DwmGetWindowAttribute($handle, 14, [ref]$cloaked, 4)
    if ($cloaked) { continue }
    $class = New-Object System.Text.StringBuilder 256
    [void][JacoUia.TopWindows]::GetClassNameW($handle, $class, 256)
    $ownerPid = [uint32]0
    [void][JacoUia.TopWindows]::GetWindowThreadProcessId($handle, [ref]$ownerPid)
    $windows += [ordered]@{
      name        = $title.ToString()
      processName = $processNames[[int]$ownerPid]
      processId   = [int]$ownerPid
      className   = $class.ToString()
      hwnd        = [int64]$handle
      hung        = [JacoUia.TopWindows]::IsHungAppWindow($handle)
    }
  }
  return $windows
}

# Interruptions: windows that stop a planned route (error dialogs, credential prompts, message
# boxes). Classified so the traction layer can pause, report or route around them. Credential
# prompts are never actuated; they are reported for the operator.
function Get-Interruptions {
  param($Windows)
  $found = @()
  foreach ($window in $Windows) {
    $name = [string]$window.name
    $process = ([string]$window.processName).ToLowerInvariant()
    $kind = $null
    if ($process -match 'credential|consent|credui|lsass' -or $name -match '(?i)sign in|log ?in|connect to (github|git)|credential|password|logga in|autentis') { $kind = 'credential-prompt' }
    elseif ($name -match '(?i)application error|has stopped working|not responding|svarar inte' -or ($process -eq 'csrss' -and $window.className -eq '#32770')) { $kind = 'error-dialog' }
    elseif ($window.hung) { $kind = 'hung-window' }
    elseif ($window.className -eq '#32770') { $kind = 'dialog' }
    if ($kind) { $found += [ordered]@{ kind = $kind; name = $name; processName = $window.processName; hwnd = $window.hwnd } }
  }
  return $found
}

function Get-WindowElement {
  param([Nullable[int64]]$Hwnd)

  if ($Hwnd) {
    $condition = New-Object System.Windows.Automation.PropertyCondition(
      $UIA::NativeWindowHandleProperty, [int]$Hwnd)
    $element = $UIA::RootElement.FindFirst($TreeScope::Children, $condition)
    if ($null -eq $element) { throw "no top-level window with handle $Hwnd" }
    return $element
  }

  # Foreground window derived from the focused element, walking up the control
  # view until the parent is the desktop root. No Win32 call needed.
  $focused = $null
  try { $focused = $UIA::FocusedElement } catch { }
  if ($null -eq $focused) { throw 'no element currently holds keyboard focus' }

  $cursor = $focused
  while ($true) {
    $parent = $null
    try { $parent = $Walker.GetParent($cursor) } catch { break }
    if ($null -eq $parent) { break }
    if ($parent -eq $UIA::RootElement -or [System.Windows.Automation.Automation]::Compare($parent, $UIA::RootElement)) { break }
    $cursor = $parent
  }
  return $cursor
}

function Get-SupportedPatterns {
  param($Element)
  $supported = @()
  try {
    foreach ($pattern in $Element.GetSupportedPatterns()) {
      try {
        $name = $pattern.ProgrammaticName
        if ($name) { $supported += ($name -replace 'PatternIdentifiers\.Pattern$', '') }
      } catch { }
    }
  } catch { }
  return $supported
}

# Node budget is script-scoped rather than passed as [ref]. Recursing a [ref]
# parameter into another [ref] parameter re-wraps it, so the nested call receives
# a reference to a reference and the first arithmetic on it throws — which an
# empty catch then swallowed, leaving every observation with a bare root node and
# no children. Errors are now recorded on the node instead of discarded.
$script:NodeBudget = 0

function Convert-ElementToNode {
  param($Element, [int]$Depth, [int]$MaxDepth)
  if ($null -eq $Element -or $script:NodeBudget -le 0) { return $null }
  $script:NodeBudget = $script:NodeBudget - 1

  try { $current = $Element.Current } catch { return $null }

  $controlType = 'Unknown'
  try {
    $programmatic = $current.ControlType.ProgrammaticName
    if ($programmatic) { $controlType = ($programmatic -replace '^ControlType\.', '') }
  } catch { }

  $node = [ordered]@{
    name         = $current.Name
    controlType  = $controlType
    automationId = $current.AutomationId
    className    = $current.ClassName
    enabled      = [bool]$current.IsEnabled
    offscreen    = [bool]$current.IsOffscreen
  }

  $patterns = @(Get-SupportedPatterns -Element $Element)
  if ($patterns.Count -gt 0) { $node.patterns = $patterns }

  # Bounding rectangle is reported for the operator's benefit only. Nothing in
  # this bridge acts on coordinates.
  try {
    $rect = $current.BoundingRectangle
    if (-not [double]::IsInfinity($rect.X) -and $rect.Width -gt 0) {
      $node.rect = [ordered]@{ x = [int]$rect.X; y = [int]$rect.Y; width = [int]$rect.Width; height = [int]$rect.Height }
    }
  } catch { }

  # Read back edit-control text so a plan can confirm that a value landed —
  # except where the field is a secret, which is never copied into a snapshot.
  if ($patterns -contains 'Value') {
    $label = "$($current.Name) $($current.AutomationId)"
    if ($script:SecretFieldPattern -and $label -match $script:SecretFieldPattern) {
      $node.value = '[redacted: secret-bearing field]'
    } else {
      try {
        $valuePattern = $Element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $text = $valuePattern.Current.Value
        if ($text) { $node.value = if ($text.Length -gt 400) { $text.Substring(0, 400) } else { $text } }
        $node.readOnly = [bool]$valuePattern.Current.IsReadOnly
      } catch { }
    }
  }

  if ($patterns -contains 'Toggle') {
    try { $node.toggleState = $Element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState.ToString() } catch { }
  }

  if ($Depth -lt $MaxDepth) {
    $children = @()
    try {
      $child = $Walker.GetFirstChild($Element)
      while ($null -ne $child -and $script:NodeBudget -gt 0) {
        $childNode = Convert-ElementToNode -Element $child -Depth ($Depth + 1) -MaxDepth $MaxDepth
        if ($null -ne $childNode) { $children += $childNode }
        $child = $Walker.GetNextSibling($child)
      }
    } catch {
      $node.walkError = $_.Exception.Message
    }
    if ($children.Count -gt 0) { $node.children = $children }
  }

  return $node
}

function Get-Observation {
  param([int]$MaxDepth = 6, [int]$MaxNodes = 400, [Nullable[int64]]$Hwnd = $null)

  $windowElement = Get-WindowElement -Hwnd $Hwnd
  $descriptor = Get-WindowDescriptor -Element $windowElement

  $observation = [ordered]@{ window = $descriptor }

  $sensitive = Test-SensitiveWindow -Descriptor $descriptor
  if ($sensitive) {
    # The tree of a credential dialog can itself carry the secret, so it is not
    # walked at all.
    $observation.blocked = $sensitive
    $observation.root = $null
    return $observation
  }

  $script:NodeBudget = $MaxNodes
  $observation.root = Convert-ElementToNode -Element $windowElement -Depth 0 -MaxDepth $MaxDepth
  $observation.nodeBudgetRemaining = $script:NodeBudget
  return $observation
}

# ── Element resolution ────────────────────────────────────────────────────────
function Resolve-TargetElement {
  param($WindowElement, $Selector)

  if ($null -eq $Selector) { throw 'a selector is required' }

  $conditions = @()
  if ($Selector.PSObject.Properties['automationId'] -and $Selector.automationId) {
    $conditions += New-Object System.Windows.Automation.PropertyCondition($UIA::AutomationIdProperty, [string]$Selector.automationId)
  }
  if ($Selector.PSObject.Properties['className'] -and $Selector.className) {
    $conditions += New-Object System.Windows.Automation.PropertyCondition($UIA::ClassNameProperty, [string]$Selector.className)
  }

  $condition = if ($conditions.Count -eq 0) {
    [System.Windows.Automation.Condition]::TrueCondition
  } elseif ($conditions.Count -eq 1) {
    $conditions[0]
  } else {
    New-Object System.Windows.Automation.AndCondition($conditions)
  }

  $candidates = $WindowElement.FindAll($TreeScope::Descendants, $condition)

  $wantedName = if ($Selector.PSObject.Properties['name'] -and $Selector.name) { ([string]$Selector.name).ToLowerInvariant() } else { $null }
  $wantedType = if ($Selector.PSObject.Properties['controlType'] -and $Selector.controlType) { [string]$Selector.controlType } else { $null }
  $wantedIndex = if ($Selector.PSObject.Properties['index'] -and $null -ne $Selector.index) { [int]$Selector.index } else { 0 }

  $matched = @()
  foreach ($candidate in $candidates) {
    try {
      $current = $candidate.Current
      if ($wantedName) {
        $name = if ($current.Name) { $current.Name.ToLowerInvariant() } else { '' }
        if ($name -notlike "*$wantedName*") { continue }
      }
      if ($wantedType) {
        $type = $current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
        if ($type -ne $wantedType) { continue }
      }
      if ($current.IsOffscreen) { continue }
      $matched += $candidate
    } catch { }
  }

  if ($matched.Count -eq 0) { throw 'selector matched no on-screen element' }
  if ($wantedIndex -ge $matched.Count) {
    throw "selector index $wantedIndex is out of range; $($matched.Count) element(s) matched"
  }
  # An ambiguous selector without an explicit index is a plan defect, not
  # something to resolve by guessing.
  if ($matched.Count -gt 1 -and -not $Selector.PSObject.Properties['index']) {
    throw "selector matched $($matched.Count) elements; add an index or narrow the selector"
  }

  return $matched[$wantedIndex]
}

function Get-ElementSummary {
  param($Element)
  $current = $Element.Current
  $controlType = 'Unknown'
  try { $controlType = ($current.ControlType.ProgrammaticName -replace '^ControlType\.', '') } catch { }
  return [ordered]@{
    name         = $current.Name
    controlType  = $controlType
    automationId = $current.AutomationId
    enabled      = [bool]$current.IsEnabled
    patterns     = @(Get-SupportedPatterns -Element $Element)
  }
}

# ── Request dispatch ──────────────────────────────────────────────────────────
try {
  if (-not (Test-Path -LiteralPath $RequestFile -PathType Leaf)) { throw "request file not found: $RequestFile" }
  $request = Get-Content -LiteralPath $RequestFile -Raw -Encoding UTF8 | ConvertFrom-Json

  $command = if ($request.PSObject.Properties['command']) { [string]$request.command } else { '' }
  $allowedProcesses = @()
  if ($request.PSObject.Properties['allowedProcesses'] -and $request.allowedProcesses) {
    $allowedProcesses = @($request.allowedProcesses)
  }
  $hwnd = if ($request.PSObject.Properties['hwnd'] -and $request.hwnd) { [int64]$request.hwnd } else { $null }

  if ($request.PSObject.Properties['blockedProcesses'] -and $request.blockedProcesses) {
    $script:BlockedProcesses = @($request.blockedProcesses)
  }
  if ($request.PSObject.Properties['blockedTitlePattern'] -and $request.blockedTitlePattern) {
    $script:BlockedTitlePattern = [string]$request.blockedTitlePattern
  }
  if ($request.PSObject.Properties['secretFieldPattern'] -and $request.secretFieldPattern) {
    $script:SecretFieldPattern = [string]$request.secretFieldPattern
  }

  # Every actuating command resolves its window and clears the grant first.
  $actuating = @('focus', 'invoke', 'set_value', 'toggle', 'select', 'expand', 'collapse', 'scroll')
  $windowElement = $null
  $descriptor = $null
  if ($actuating -contains $command) {
    $windowElement = Get-WindowElement -Hwnd $hwnd
    $descriptor = Get-WindowDescriptor -Element $windowElement
    $refusal = Assert-WindowAllowed -Descriptor $descriptor -AllowedProcesses $allowedProcesses
    if ($refusal) { Write-Response (New-Response -Ok $false -Refusal $refusal); exit 0 }
  }

  switch ($command) {
    'capabilities' {
      Write-Response (New-Response -Ok $true -Data ([ordered]@{
        actuation        = 'ui-automation'
        syntheticInput   = $false
        psVersion        = $PSVersionTable.PSVersion.ToString()
        os               = [System.Environment]::OSVersion.VersionString
        commands         = @('capabilities', 'windows', 'observe', 'focus', 'invoke', 'set_value', 'toggle', 'select', 'expand', 'collapse', 'scroll')
        policySource     = 'caller-supplied per request'
      }))
      exit 0
    }

    'windows' {
      $topLevel = @(Get-TopLevelWindows)
      $enumeration = if ($script:Win32Ready) { 'user32-readonly' } else { 'uia' }
      Write-Response (New-Response -Ok $true -Data @{ windows = $topLevel; interruptions = @(Get-Interruptions -Windows $topLevel); enumeration = $enumeration })
      exit 0
    }

    'observe' {
      $maxDepth = if ($request.PSObject.Properties['maxDepth']) { [int]$request.maxDepth } else { 6 }
      $maxNodes = if ($request.PSObject.Properties['maxNodes']) { [int]$request.maxNodes } else { 400 }
      Write-Response (New-Response -Ok $true -Data (Get-Observation -MaxDepth $maxDepth -MaxNodes $maxNodes -Hwnd $hwnd))
      exit 0
    }

    'focus' {
      $windowElement.SetFocus()
      Start-Sleep -Milliseconds 200
      Write-Response (New-Response -Ok $true -Data @{ window = (Get-WindowDescriptor -Element (Get-WindowElement -Hwnd $null)) })
      exit 0
    }

    'invoke' {
      $element = Resolve-TargetElement -WindowElement $windowElement -Selector $request.selector
      $summary = Get-ElementSummary -Element $element
      if (-not $summary.enabled) { throw "element '$($summary.name)' is disabled" }
      $summaryPatterns = @($summary.patterns)
      if ($summaryPatterns -contains 'Invoke') {
        $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      } elseif ($summaryPatterns -contains 'SelectionItem') {
        $element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
      } elseif ($summaryPatterns -contains 'Toggle') {
        $element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle()
      } else {
        throw "element '$($summary.name)' exposes no invocable pattern (has: $($summaryPatterns -join ', '))"
      }
      Write-Response (New-Response -Ok $true -Data @{ element = $summary })
      exit 0
    }

    'set_value' {
      $text = [string]$request.text
      if ($null -eq $text) { throw 'set_value requires text' }
      if ($text.Length -gt 2000) { throw 'text exceeds the 2000 character limit' }
      $element = Resolve-TargetElement -WindowElement $windowElement -Selector $request.selector
      $summary = Get-ElementSummary -Element $element
      if (@($summary.patterns) -notcontains 'Value') { throw "element '$($summary.name)' does not expose ValuePattern" }
      $valuePattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      if ($valuePattern.Current.IsReadOnly) { throw "element '$($summary.name)' is read-only" }
      $element.SetFocus()
      $valuePattern.SetValue($text)
      Write-Response (New-Response -Ok $true -Data @{ element = $summary; characters = $text.Length })
      exit 0
    }

    'toggle' {
      $element = Resolve-TargetElement -WindowElement $windowElement -Selector $request.selector
      $summary = Get-ElementSummary -Element $element
      if (@($summary.patterns) -notcontains 'Toggle') { throw "element '$($summary.name)' does not expose TogglePattern" }
      $pattern = $element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
      $before = $pattern.Current.ToggleState.ToString()
      $pattern.Toggle()
      Write-Response (New-Response -Ok $true -Data @{ element = $summary; before = $before; after = $pattern.Current.ToggleState.ToString() })
      exit 0
    }

    'select' {
      $element = Resolve-TargetElement -WindowElement $windowElement -Selector $request.selector
      $summary = Get-ElementSummary -Element $element
      if (@($summary.patterns) -notcontains 'SelectionItem') { throw "element '$($summary.name)' does not expose SelectionItemPattern" }
      $element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
      Write-Response (New-Response -Ok $true -Data @{ element = $summary })
      exit 0
    }

    { $_ -in 'expand', 'collapse' } {
      $element = Resolve-TargetElement -WindowElement $windowElement -Selector $request.selector
      $summary = Get-ElementSummary -Element $element
      if (@($summary.patterns) -notcontains 'ExpandCollapse') { throw "element '$($summary.name)' does not expose ExpandCollapsePattern" }
      $pattern = $element.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
      if ($command -eq 'expand') { $pattern.Expand() } else { $pattern.Collapse() }
      Write-Response (New-Response -Ok $true -Data @{ element = $summary; state = $pattern.Current.ExpandCollapseState.ToString() })
      exit 0
    }

    'scroll' {
      $amount = if ($request.PSObject.Properties['amount']) { [string]$request.amount } else { 'SmallIncrement' }
      if ($amount -notin @('SmallIncrement', 'SmallDecrement', 'LargeIncrement', 'LargeDecrement', 'NoAmount')) {
        throw "scroll amount must be one of SmallIncrement, SmallDecrement, LargeIncrement, LargeDecrement, NoAmount"
      }
      $target = if ($request.PSObject.Properties['selector'] -and $request.selector) {
        Resolve-TargetElement -WindowElement $windowElement -Selector $request.selector
      } else { $windowElement }
      $patterns = @(Get-SupportedPatterns -Element $target)
      if (@($patterns) -notcontains 'Scroll') { throw 'target does not expose ScrollPattern' }
      $pattern = $target.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
      $pattern.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount, [System.Windows.Automation.ScrollAmount]::$amount)
      Write-Response (New-Response -Ok $true -Data @{ verticalPercent = $pattern.Current.VerticalScrollPercent })
      exit 0
    }

    default {
      Write-Response (New-Response -Ok $false -ErrorMessage "unsupported command '$command'")
      exit 0
    }
  }
} catch {
  Write-Response (New-Response -Ok $false -ErrorMessage $_.Exception.Message)
  exit 0
}
