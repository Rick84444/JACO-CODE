# JACO Input Bridge — Raw mouse + keyboard via Win32 SendInput
# Usage: powershell -File input-bridge.ps1 -Op <op> [args...]
#
# Ops:
#   mouse_move   -X 100 -Y 200
#   mouse_click  -X 100 -Y 200 [-Button left|right|middle] [-Double]
#   mouse_scroll -X 100 -Y 200 -Delta 3
#   key_press    -Keys "ctrl+c"
#   type_text    -Text "hello world"
#   screenshot   [-OutFile path.png] [-CropX n -CropY n -CropWidth n -CropHeight n] [-MaxWidth n -MaxHeight n]
#   get_cursor

param(
  [string]$Op,
  [int]$X = 0,
  [int]$Y = 0,
  [string]$Button = "left",
  [switch]$Double,
  [int]$Delta = 3,
  [string]$Keys = "",
  [string]$Text = "",
  [string]$OutFile = "",
  [Nullable[int]]$CropX = $null,
  [Nullable[int]]$CropY = $null,
  [Nullable[int]]$CropWidth = $null,
  [Nullable[int]]$CropHeight = $null,
  [Nullable[int]]$MaxWidth = $null,
  [Nullable[int]]$MaxHeight = $null
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class WinInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);

  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public int type;
    public INPUTUNION u;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx, dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  public const int INPUT_MOUSE = 0;
  public const int INPUT_KEYBOARD = 1;
  public const uint MOUSEEVENTF_LEFTDOWN   = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP     = 0x0004;
  public const uint MOUSEEVENTF_RIGHTDOWN  = 0x0008;
  public const uint MOUSEEVENTF_RIGHTUP    = 0x0010;
  public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
  public const uint MOUSEEVENTF_MIDDLEUP   = 0x0040;
  public const uint MOUSEEVENTF_WHEEL      = 0x0800;
  public const uint KEYEVENTF_KEYUP        = 0x0002;

  public static void MouseClick(uint down, uint up) {
    var inputs = new INPUT[2];
    inputs[0].type = INPUT_MOUSE; inputs[0].u.mi.dwFlags = down;
    inputs[1].type = INPUT_MOUSE; inputs[1].u.mi.dwFlags = up;
    SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void KeyDown(ushort vk) {
    var i = new INPUT[1];
    i[0].type = INPUT_KEYBOARD; i[0].u.ki.wVk = vk;
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void KeyUp(ushort vk) {
    var i = new INPUT[1];
    i[0].type = INPUT_KEYBOARD; i[0].u.ki.wVk = vk; i[0].u.ki.dwFlags = KEYEVENTF_KEYUP;
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void TypeChar(char c) {
    var i = new INPUT[2];
    i[0].type = INPUT_KEYBOARD; i[0].u.ki.wScan = (ushort)c; i[0].u.ki.dwFlags = 0x0004; // UNICODE
    i[1].type = INPUT_KEYBOARD; i[1].u.ki.wScan = (ushort)c; i[1].u.ki.dwFlags = 0x0006; // UNICODE+KEYUP
    SendInput(2, i, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@ -ErrorAction Stop

# VK codes
$VK = @{
  ctrl=0x11; alt=0x12; shift=0x10; win=0x5B; enter=0x0D; tab=0x09; esc=0x1B
  backspace=0x08; delete=0x2E; space=0x20; home=0x24; end=0x23
  up=0x26; down=0x28; left=0x25; right=0x27; pgup=0x21; pgdn=0x22
  f1=0x70; f2=0x71; f3=0x72; f4=0x73; f5=0x74; f6=0x75
  f7=0x76; f8=0x77; f9=0x78; f10=0x79; f11=0x7A; f12=0x7B
  a=0x41; b=0x42; c=0x43; d=0x44; e=0x45; f=0x46; g=0x47; h=0x48
  i=0x49; j=0x4A; k=0x4B; l=0x4C; m=0x4D; n=0x4E; o=0x4F; p=0x50
  q=0x51; r=0x52; s=0x53; t=0x54; u=0x55; v=0x56; w=0x57; x=0x58
  y=0x59; z=0x5A; "0"=0x30; "1"=0x31; "2"=0x32; "3"=0x33; "4"=0x34
  "5"=0x35; "6"=0x36; "7"=0x37; "8"=0x38; "9"=0x39
}

function Do-MouseMove($x, $y) {
  [WinInput]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 50
}

function Do-MouseClick($x, $y, $btn, $dbl) {
  Do-MouseMove $x $y
  Start-Sleep -Milliseconds 80
  switch ($btn) {
    "right"  { [WinInput]::MouseClick([WinInput]::MOUSEEVENTF_RIGHTDOWN,  [WinInput]::MOUSEEVENTF_RIGHTUP) }
    "middle" { [WinInput]::MouseClick([WinInput]::MOUSEEVENTF_MIDDLEDOWN, [WinInput]::MOUSEEVENTF_MIDDLEUP) }
    default  { [WinInput]::MouseClick([WinInput]::MOUSEEVENTF_LEFTDOWN,   [WinInput]::MOUSEEVENTF_LEFTUP) }
  }
  if ($dbl) {
    Start-Sleep -Milliseconds 100
    switch ($btn) {
      "right"  { [WinInput]::MouseClick([WinInput]::MOUSEEVENTF_RIGHTDOWN,  [WinInput]::MOUSEEVENTF_RIGHTUP) }
      default  { [WinInput]::MouseClick([WinInput]::MOUSEEVENTF_LEFTDOWN,   [WinInput]::MOUSEEVENTF_LEFTUP) }
    }
  }
}

function Do-KeyPress($keysStr) {
  # "ctrl+shift+s" → hold modifiers, press key, release modifiers
  $parts = $keysStr.ToLower() -split '\+'
  $mods = $parts | Select-Object -SkipLast 1
  $key  = $parts | Select-Object -Last 1

  foreach ($m in $mods) {
    if ($VK.ContainsKey($m)) { [WinInput]::KeyDown([System.UInt16]$VK[$m]) }
  }
  Start-Sleep -Milliseconds 30
  if ($VK.ContainsKey($key)) {
    [WinInput]::KeyDown([System.UInt16]$VK[$key])
    Start-Sleep -Milliseconds 30
    [WinInput]::KeyUp([System.UInt16]$VK[$key])
  }
  Start-Sleep -Milliseconds 30
  if ($mods -and $mods.Count -gt 0) {
    $revMods = [System.Linq.Enumerable]::Reverse([string[]]$mods)
    foreach ($m in $revMods) {
      if ($VK.ContainsKey($m)) { [WinInput]::KeyUp([System.UInt16]$VK[$m]) }
    }
  }
}

function Do-TypeText($text) {
  foreach ($c in $text.ToCharArray()) {
    [WinInput]::TypeChar($c)
    Start-Sleep -Milliseconds 20
  }
}

function Do-Screenshot($outFile, $cropX, $cropY, $cropWidth, $cropHeight, $maxWidth, $maxHeight) {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing

  # Virtual desktop coordinates may be negative on multi-monitor systems.
  $screens = [System.Windows.Forms.Screen]::AllScreens
  $bounds = [System.Drawing.Rectangle]::Empty
  foreach ($s in $screens) { $bounds = [System.Drawing.Rectangle]::Union($bounds, $s.Bounds) }

  $capture = $bounds
  $cropRequested = ($null -ne $cropWidth -or $null -ne $cropHeight -or $null -ne $cropX -or $null -ne $cropY)
  if ($cropRequested) {
    if ($null -eq $cropWidth -or $null -eq $cropHeight -or $cropWidth -le 0 -or $cropHeight -le 0) {
      throw 'CropWidth and CropHeight must both be positive when a crop is requested'
    }
    $cx = if ($null -ne $cropX) { [int]$cropX } else { $bounds.X }
    $cy = if ($null -ne $cropY) { [int]$cropY } else { $bounds.Y }
    $requested = New-Object System.Drawing.Rectangle($cx, $cy, [int]$cropWidth, [int]$cropHeight)
    $capture = [System.Drawing.Rectangle]::Intersect($bounds, $requested)
    if ($capture.Width -le 0 -or $capture.Height -le 0) { throw 'requested crop does not intersect the virtual desktop' }
  }

  # Copy only the requested region from the framebuffer. This avoids first
  # materialising a multi-million-pixel full desktop when the model only needs a terminal/window ROI.
  $source = New-Object System.Drawing.Bitmap($capture.Width, $capture.Height)
  $g = [System.Drawing.Graphics]::FromImage($source)
  $g.CopyFromScreen($capture.Location, [System.Drawing.Point]::Empty, $capture.Size)
  $g.Dispose()

  $limitW = if ($null -ne $maxWidth -and $maxWidth -gt 0) { [int]$maxWidth } else { $capture.Width }
  $limitH = if ($null -ne $maxHeight -and $maxHeight -gt 0) { [int]$maxHeight } else { $capture.Height }
  $scale = [Math]::Min(1.0, [Math]::Min($limitW / [double]$capture.Width, $limitH / [double]$capture.Height))
  $outW = [Math]::Max(1, [int][Math]::Round($capture.Width * $scale))
  $outH = [Math]::Max(1, [int][Math]::Round($capture.Height * $scale))

  $output = $source
  if ($outW -ne $capture.Width -or $outH -ne $capture.Height) {
    $output = New-Object System.Drawing.Bitmap($outW, $outH)
    $rg = [System.Drawing.Graphics]::FromImage($output)
    $rg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $rg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $rg.DrawImage($source, 0, 0, $outW, $outH)
    $rg.Dispose()
  }

  if (-not $outFile) { $outFile = "$env:TEMP\jaco-screenshot-$(Get-Date -Format 'yyyyMMddHHmmss').png" }
  $output.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)
  if ($output -ne $source) { $output.Dispose() }
  $source.Dispose()

  $size = (Get-Item $outFile).Length
  [ordered]@{
    ok = $true
    file = ($outFile -replace '\\','/')
    width = $outW
    height = $outH
    sourceWidth = $capture.Width
    sourceHeight = $capture.Height
    virtualDesktop = [ordered]@{ x = $bounds.X; y = $bounds.Y; width = $bounds.Width; height = $bounds.Height }
    capture = [ordered]@{ x = $capture.X; y = $capture.Y; width = $capture.Width; height = $capture.Height }
    scale = [Math]::Round($scale, 4)
    bytes = $size
  } | ConvertTo-Json -Depth 4 -Compress
}

function Do-GetCursor {
  $p = New-Object WinInput+POINT
  [WinInput]::GetCursorPos([ref]$p) | Out-Null
  Write-Output "{`"x`":$($p.X),`"y`":$($p.Y)}"
}

function Do-Scroll($x, $y, $delta) {
  Do-MouseMove $x $y
  Start-Sleep -Milliseconds 50
  $i = New-Object WinInput+INPUT
  $i.type = [WinInput]::INPUT_MOUSE
  $i.u.mi.dwFlags = [WinInput]::MOUSEEVENTF_WHEEL
  $i.u.mi.mouseData = [uint32]($delta * 120)
  [WinInput]::SendInput(1, [WinInput+INPUT[]]@($i), [System.Runtime.InteropServices.Marshal]::SizeOf([type][WinInput+INPUT])) | Out-Null
}

switch ($Op) {
  "mouse_move"   { Do-MouseMove $X $Y; Write-Output '{"ok":true}' }
  "mouse_click"  { Do-MouseClick $X $Y $Button $Double; Write-Output '{"ok":true}' }
  "mouse_scroll" { Do-Scroll $X $Y $Delta; Write-Output '{"ok":true}' }
  "key_press"    { Do-KeyPress $Keys; Write-Output '{"ok":true}' }
  "type_text"    { Do-TypeText $Text; Write-Output '{"ok":true}' }
  "screenshot"   { Do-Screenshot $OutFile $CropX $CropY $CropWidth $CropHeight $MaxWidth $MaxHeight }
  "get_cursor"   { Do-GetCursor }
  default        { Write-Output "{`"error`":`"unknown op: $Op`"}" }
}
