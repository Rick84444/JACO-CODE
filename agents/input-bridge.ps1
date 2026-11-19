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
  [Nullable[int]]$MaxHeight = $null,
  [long]$ExpectedHwnd = 0,
  [uint32]$ExpectedPid = 0,
  [int]$ExpectedLeft = 0,
  [int]$ExpectedTop = 0,
  [int]$ExpectedWidth = 0,
  [int]$ExpectedHeight = 0,
  [switch]$MeasureEntropy
)

$ErrorActionPreference = 'Stop'

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


  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(POINT pt);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd,out RECT rect);
  [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hwnd,int attribute,out RECT rect,int size);
  [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] private static extern IntPtr GetThreadDpiAwarenessContext();
  [DllImport("user32.dll")] private static extern bool AreDpiAwarenessContextsEqual(IntPtr a,IntPtr b);
  [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left,Top,Right,Bottom; }
  static IntPtr target;
  static uint targetPid;
  static int left,top,width,height,pointX,pointY;
  static bool pointRequired;
  public static bool DispatchAttempted {get;private set;}
  public static bool FocusDrifted {get;private set;}
  public static long PostDispatchHwnd {get;private set;}
  public static bool CursorChanged {get;private set;}
  public static bool EnableDpiV2() {
    try {
      IntPtr context=new IntPtr(-4);
      SetThreadDpiAwarenessContext(context);
      return AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(),context);
    } catch {return false;}
  }
  public static void Configure(long hwnd,uint pid,int x,int y,int w,int h,bool point,int px,int py) {
    if(hwnd<=0||pid==0||w<=0||h<=0) throw new InvalidOperationException("TARGET_BINDING_REQUIRED");
    target=new IntPtr(hwnd);targetPid=pid;left=x;top=y;width=w;height=h;
    pointRequired=point;pointX=px;pointY=py;
    if(!EnableDpiV2()) throw new InvalidOperationException("DPI_CONTEXT_UNVERIFIED");
    AssertTarget(false);
  }
  static bool MatchesRect(RECT r) {
    // UIA and Win32 can report different invisible resize borders; accept only
    // a small, explicit edge tolerance, never an arbitrary moved rectangle.
    const int tolerance=16;
    return Math.Abs((long)r.Left-left)<=tolerance&&Math.Abs((long)r.Top-top)<=tolerance
      &&Math.Abs((long)r.Right-left-width)<=tolerance&&Math.Abs((long)r.Bottom-top-height)<=tolerance;
  }
  static bool SameForeground() {
    uint pid;
    return GetForegroundWindow()==target&&GetWindowThreadProcessId(target,out pid)!=0&&pid==targetPid;
  }
  public static void AssertTarget(bool checkCursor) {
    if(!EnableDpiV2())throw new InvalidOperationException("DPI_CONTEXT_UNVERIFIED");
    if(target==IntPtr.Zero||!SameForeground())throw new InvalidOperationException("FOCUS_OR_PID_DRIFT");
    RECT rect,frame;
    if(!GetWindowRect(target,out rect))throw new InvalidOperationException("WINDOW_RECT_UNAVAILABLE");
    if(!MatchesRect(rect)&&(DwmGetWindowAttribute(target,9,out frame,Marshal.SizeOf(typeof(RECT)))!=0||!MatchesRect(frame)))throw new InvalidOperationException("WINDOW_GEOMETRY_DRIFT");
    if(pointRequired){
      POINT p=new POINT{X=pointX,Y=pointY};
      if(GetAncestor(WindowFromPoint(p),2)!=target)throw new InvalidOperationException("TARGET_POINT_OCCLUDED");
      if(checkCursor){POINT cursor;if(!GetCursorPos(out cursor)||cursor.X!=pointX||cursor.Y!=pointY)throw new InvalidOperationException("CURSOR_POSITION_DRIFT");}
    }
  }
  public static void MoveChecked(int x,int y) {
    AssertTarget(false);
    CursorChanged=true;
    if(!SetCursorPos(x,y))throw new InvalidOperationException("CURSOR_MOVE_REJECTED");
  }
  public static bool PostFocus() {
    PostDispatchHwnd=GetForegroundWindow().ToInt64();
    bool same=SameForeground();if(!same)FocusDrifted=true;return same;
  }

  public static void SendChecked(INPUT[] inputs) {
    AssertTarget(pointRequired);
    DispatchAttempted=true;
    uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    bool same=PostFocus();
    if (sent != (uint)inputs.Length) throw new InvalidOperationException("WINDOWS_INPUT_PARTIAL_OR_REJECTED");
    if(!same)throw new InvalidOperationException("FOCUS_DRIFT_AFTER_DISPATCH");
  }
  public static void MouseClick(uint down, uint up) {
    var inputs = new INPUT[2];
    inputs[0].type = INPUT_MOUSE; inputs[0].u.mi.dwFlags = down;
    inputs[1].type = INPUT_MOUSE; inputs[1].u.mi.dwFlags = up;
    SendChecked(inputs);
  }

  public static void KeyDown(ushort vk) {
    var i = new INPUT[1];
    i[0].type = INPUT_KEYBOARD; i[0].u.ki.wVk = vk;
    SendChecked(i);
  }
  public static void KeyUp(ushort vk) {
    var i = new INPUT[1];
    i[0].type = INPUT_KEYBOARD; i[0].u.ki.wVk = vk; i[0].u.ki.dwFlags = KEYEVENTF_KEYUP;
    SendChecked(i);
  }
  public static void TypeChar(char c) {
    var i = new INPUT[2];
    i[0].type = INPUT_KEYBOARD; i[0].u.ki.wScan = (ushort)c; i[0].u.ki.dwFlags = 0x0004; // UNICODE
    i[1].type = INPUT_KEYBOARD; i[1].u.ki.wScan = (ushort)c; i[1].u.ki.dwFlags = 0x0006; // UNICODE+KEYUP
    SendChecked(i);
  }
  public static void Chord(ushort[] keys) {
    INPUT[] batch=new INPUT[keys.Length*2];
    for(int i=0;i<keys.Length;i++){
      batch[i].type=INPUT_KEYBOARD;batch[i].u.ki.wVk=keys[i];
      int j=batch.Length-1-i;batch[j].type=INPUT_KEYBOARD;batch[j].u.ki.wVk=keys[i];batch[j].u.ki.dwFlags=KEYEVENTF_KEYUP;
    }
    SendChecked(batch);
  }
  public static void TypeBatch(string text) {
    if(String.IsNullOrEmpty(text)||text.Length>2000)throw new InvalidOperationException("INVALID_TYPE_LENGTH");
    INPUT[] batch=new INPUT[text.Length*2];
    for(int i=0;i<text.Length;i++){
      int j=2*i;
      batch[j].type=INPUT_KEYBOARD;batch[j].u.ki.wScan=text[i];batch[j].u.ki.dwFlags=4;
      batch[j+1].type=INPUT_KEYBOARD;batch[j+1].u.ki.wScan=text[i];batch[j+1].u.ki.dwFlags=6;
    }
    SendChecked(batch);
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
  [WinInput]::MoveChecked($x,$y)
  Start-Sleep -Milliseconds 50
  $p = New-Object WinInput+POINT
  if (-not [WinInput]::GetCursorPos([ref]$p) -or $p.X -ne $x -or $p.Y -ne $y) { throw 'CURSOR_POSITION_UNVERIFIED' }
}

function Do-MouseClick($x, $y, $btn, $dbl) {
  Do-MouseMove $x $y
  Start-Sleep -Milliseconds 80
  switch ($btn) {
    "right"  { [WinInput]::MouseClick([WinInput]::MOUSEEVENTF_RIGHTDOWN,  [WinInput]::MOUSEEVENTF_RIGHTUP) }
    "middle" { [WinInput]::MouseClick([WinInput]::MOUSEEVENTF_MIDDLEDOWN, [WinInput]::MOUSEEVENTF_MIDDLEUP) }
    'left' { [WinInput]::MouseClick([WinInput]::MOUSEEVENTF_LEFTDOWN, [WinInput]::MOUSEEVENTF_LEFTUP) }
    default { throw 'INVALID_MOUSE_BUTTON' }
  }
  if ($dbl) {
    Start-Sleep -Milliseconds 100
    switch ($btn) {
      "right"  { [WinInput]::MouseClick([WinInput]::MOUSEEVENTF_RIGHTDOWN,  [WinInput]::MOUSEEVENTF_RIGHTUP) }
      'middle' { [WinInput]::MouseClick([WinInput]::MOUSEEVENTF_MIDDLEDOWN, [WinInput]::MOUSEEVENTF_MIDDLEUP) }
      'left' { [WinInput]::MouseClick([WinInput]::MOUSEEVENTF_LEFTDOWN, [WinInput]::MOUSEEVENTF_LEFTUP) }
      default { throw 'INVALID_MOUSE_BUTTON' }
    }
  }
}

function Do-KeyPress($keysStr) {
  # "ctrl+shift+s" → hold modifiers, press key, release modifiers
  $parts = $keysStr.ToLower() -split '\+'
  $mods = $parts | Select-Object -SkipLast 1
  $key  = $parts | Select-Object -Last 1

  if (-not $VK.ContainsKey($key)) { throw 'UNSUPPORTED_KEY' }
  foreach ($m in $mods) { if ($m -notin @('ctrl','alt','shift','win')) { throw 'UNSUPPORTED_MODIFIER' } }
  # Submit press and release in one batch; never send a repair chord to another window.
  $codes = @($mods | ForEach-Object { [UInt16]$VK[$_] }) + @([UInt16]$VK[$key])
  [WinInput]::Chord([UInt16[]]$codes)
}

function Do-TypeText($text) {
  [WinInput]::TypeBatch($text)
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
  if (-not [WinInput]::GetCursorPos([ref]$p)) { throw 'CURSOR_READ_REJECTED' }
  [ordered]@{ok=$true;verified=$true;x=$p.X;y=$p.Y} | ConvertTo-Json -Compress
}

function Do-Scroll($x, $y, $delta) {
  Do-MouseMove $x $y
  Start-Sleep -Milliseconds 50
  $i = New-Object WinInput+INPUT
  $i.type = [WinInput]::INPUT_MOUSE
  $i.u.mi.dwFlags = [WinInput]::MOUSEEVENTF_WHEEL
  $i.u.mi.mouseData = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]($delta * 120)),0)
  [WinInput]::SendChecked([WinInput+INPUT[]]@($i))
}


# ROI telemetry is optional and read-only. It never attests a semantic effect.
function Get-GrayRoi($cx,$cy) {
  Add-Type -AssemblyName System.Windows.Forms,System.Drawing
  $r=New-Object System.Drawing.Rectangle(($cx-32),($cy-32),64,64)
  $bounds=[System.Windows.Forms.SystemInformation]::VirtualScreen
  if (-not $bounds.Contains($r)) { throw 'ROI_OUTSIDE_DESKTOP' }
  $bmp=$null;$g=$null
  try {
    $bmp=New-Object System.Drawing.Bitmap(64,64)
    $g=[System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.Location,[System.Drawing.Point]::Empty,$r.Size)
    $gray=New-Object byte[] 4096
    for($y=0;$y -lt 64;$y++){for($x=0;$x -lt 64;$x++){
      $c=$bmp.GetPixel($x,$y)
      $gray[$y*64+$x]=[byte](($c.B*18+$c.G*183+$c.R*54) -shr 8)
    }}
    return ,$gray
  } finally {if($null -ne $g){$g.Dispose()};if($null -ne $bmp){$bmp.Dispose()}}
}
function Measure-Roi($before,$after) {
  if($before.Length -ne 4096 -or $after.Length -ne 4096){throw 'INVALID_ROI'}
  $bins=New-Object int[] 16;$changed=0
  for($i=0;$i -lt 4096;$i++){
    $d=[Math]::Abs([int]$after[$i]-[int]$before[$i])
    if($d -ge 8){$changed++}
    $bins[($d -shr 4)]++
  }
  $entropy=0.0
  foreach($count in $bins){if($count -gt 0){$p=$count/4096.0;$entropy-=$p*[Math]::Log($p,2)}}
  $ratio=$changed/4096.0
  $signal=if($entropy -ge 0.45 -and $ratio -ge 0.015){'VISUAL_CHANGE_DETECTED'}elseif($ratio -gt 0){'VISUAL_CHANGE_WEAK'}else{'NO_VISUAL_CHANGE_DETECTED'}
  return [ordered]@{signal=$signal;changedPixelRatio=[Math]::Round($ratio,4);deltaEntropyBits=[Math]::Round($entropy,4)}
}
$mutating=$Op -in @('mouse_move','mouse_click','mouse_scroll','key_press','type_text')
if($mutating){
  $visual=$null
  try {
    $point=$Op -in @('mouse_move','mouse_click','mouse_scroll')
    [WinInput]::Configure($ExpectedHwnd,$ExpectedPid,$ExpectedLeft,$ExpectedTop,$ExpectedWidth,$ExpectedHeight,$point,$X,$Y)
    $before=$null
    if($MeasureEntropy -and $Op -eq 'mouse_click'){
      try{$before=Get-GrayRoi $X $Y}catch{$visual=[ordered]@{signal='UNAVAILABLE'}}
    }
    switch($Op){
      'mouse_move' {Do-MouseMove $X $Y}
      'mouse_click' {Do-MouseClick $X $Y $Button $Double}
      'mouse_scroll' {Do-Scroll $X $Y $Delta}
      'key_press' {Do-KeyPress $Keys}
      'type_text' {Do-TypeText $Text}
    }
    if(-not [WinInput]::PostFocus()){throw 'FOCUS_DRIFT_AFTER_DISPATCH'}
    if($null -ne $before){
      try{
        Start-Sleep -Milliseconds 120
        [WinInput]::AssertTarget($true)
        $after=Get-GrayRoi $X $Y
        [WinInput]::AssertTarget($true)
        $visual=Measure-Roi $before $after
      }catch{$visual=[ordered]@{signal='UNAVAILABLE_OR_TARGET_CHANGED'}}
    }
    [ordered]@{ok=$true;verified=$true;outcomeUnknown=$false;postconditionVerified=$false;focusDriftedDuringDispatch=[WinInput]::FocusDrifted;evidence=$(if($Op -eq 'mouse_move'){'cursor-position-observed'}else{'input-dispatch-only'});visualObservation=$visual;telemetry=[ordered]@{hwnd=$ExpectedHwnd;pid=$ExpectedPid;postDispatchHwnd=[WinInput]::PostDispatchHwnd}} | ConvertTo-Json -Depth 5 -Compress
  } catch {
    $unknown=[WinInput]::DispatchAttempted -or [WinInput]::CursorChanged
    # Do not leak typed text or arbitrary exception content in the receipt.
    $message=$_.Exception.GetBaseException().Message
    $errorCode=if($message -match '^[A-Z][A-Z0-9_]{2,80}$'){$message}else{'WINDOWS_INPUT_GUARD_FAILED'}
    [ordered]@{ok=$false;verified=$false;outcomeUnknown=$unknown;postconditionVerified=$false;focusDriftedDuringDispatch=[WinInput]::FocusDrifted;error=$errorCode;telemetry=[ordered]@{hwnd=$ExpectedHwnd;postDispatchHwnd=[WinInput]::PostDispatchHwnd}} | ConvertTo-Json -Depth 5 -Compress
  }
} else {
  if(-not [WinInput]::EnableDpiV2()){throw 'DPI_CONTEXT_UNVERIFIED'}
  switch($Op){
    'screenshot' {Do-Screenshot $OutFile $CropX $CropY $CropWidth $CropHeight $MaxWidth $MaxHeight}
    'get_cursor' {Do-GetCursor}
    default {throw 'UNKNOWN_INPUT_OPERATION'}
  }
}
