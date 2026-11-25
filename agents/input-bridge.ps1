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
  [switch]$MeasureEntropy,
  [switch]$Activate,
  [switch]$Daemon
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
  [DllImport("kernel32.dll",SetLastError=true)] private static extern uint GetCurrentProcessId();
  [DllImport("kernel32.dll",SetLastError=true)] private static extern bool ProcessIdToSessionId(uint pid,out uint sessionId);
  [DllImport("user32.dll",SetLastError=true)] private static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
  [DllImport("user32.dll",SetLastError=true)] private static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll",SetLastError=true,CharSet=CharSet.Unicode)]
  private static extern bool GetUserObjectInformation(IntPtr handle,int index,System.Text.StringBuilder value,int length,ref int needed);

  // UOI_NAME=2 and DESKTOP_READOBJECTS=0x1. Check the *input* desktop, not
  // only the process/window station. Winlogon/UAC/locked desktops must veto.
  private static bool DefaultInputDesktop() {
    IntPtr desktop=OpenInputDesktop(0,false,0x1);
    if(desktop==IntPtr.Zero)return false;
    try {
      var name=new System.Text.StringBuilder(256);
      int needed=0;
      return GetUserObjectInformation(desktop,2,name,name.Capacity*2,ref needed)
        && String.Equals(name.ToString().TrimEnd('\0'),"Default",StringComparison.OrdinalIgnoreCase);
    } finally {CloseDesktop(desktop);}
  }
  public static uint InteractiveSessionId() {
    AssertLive();
    uint self=0, foregroundSession=0;
    if(!ProcessIdToSessionId(GetCurrentProcessId(),out self)||self==0)
      throw new InvalidOperationException("NONINTERACTIVE_SESSION_ZERO");
    IntPtr foreground=GetForegroundWindow();
    uint foregroundPid=0;
    if(foreground==IntPtr.Zero||GetWindowThreadProcessId(foreground,out foregroundPid)==0
        ||foregroundPid==0||!ProcessIdToSessionId(foregroundPid,out foregroundSession)
        ||foregroundSession!=self)
      throw new InvalidOperationException("FOREGROUND_SESSION_MISMATCH");
    if(!DefaultInputDesktop())
      throw new InvalidOperationException("INPUT_DESKTOP_NOT_DEFAULT");
    return self;
  }
  public static long ForegroundWindowId() { return GetForegroundWindow().ToInt64(); }


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
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hwnd,int cmd);
  [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint from,uint to,bool attach);
  [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
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
  static long deadlineMs;
  public static void ResetRequest(long deadline) {
    target=IntPtr.Zero;targetPid=0;pointRequired=false;
    DispatchAttempted=false;FocusDrifted=false;PostDispatchHwnd=0;CursorChanged=false;
    deadlineMs=deadline;
  }
  static void AssertLive() {
    if(deadlineMs>0 && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()>=deadlineMs)
      throw new InvalidOperationException("BRIDGE_REQUEST_EXPIRED");
    string stop=Environment.GetEnvironmentVariable("JACO_KILL_SWITCH_FILE");
    if(!String.IsNullOrEmpty(stop)&&System.IO.File.Exists(stop))
      throw new InvalidOperationException("HUMAN_KILL_SWITCH_ACTIVE");
  }
  public static bool EnableDpiV2() {
    try {
      IntPtr context=new IntPtr(-4);
      SetThreadDpiAwarenessContext(context);
      return AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(),context);
    } catch {return false;}
  }
  // Brings the bound window to the front before a raw action, only when the operator allowed it (host mode, -Activate). The window
  // is already bound to a fresh observation and a granted process; AssertTarget below still refuses if it is not in front.
  static void ActivateTarget() {
    if(SameForeground()) return;
    if(IsIconic(target)) ShowWindow(target,9);
    uint foregroundPid;
    IntPtr foreground=GetForegroundWindow();
    uint foregroundThread=foreground==IntPtr.Zero?0:GetWindowThreadProcessId(foreground,out foregroundPid);
    uint thisThread=GetCurrentThreadId();
    bool attached=foregroundThread!=0&&foregroundThread!=thisThread&&AttachThreadInput(thisThread,foregroundThread,true);
    try { BringWindowToTop(target); SetForegroundWindow(target); }
    finally { if(attached) AttachThreadInput(thisThread,foregroundThread,false); }
    for(int i=0;i<10&&!SameForeground();i++) System.Threading.Thread.Sleep(50);
  }
  public static void Configure(long hwnd,uint pid,int x,int y,int w,int h,bool point,int px,int py,bool activate) {
    if(hwnd<=0||pid==0||w<=0||h<=0) throw new InvalidOperationException("TARGET_BINDING_REQUIRED");
    target=new IntPtr(hwnd);targetPid=pid;left=x;top=y;width=w;height=h;
    pointRequired=point;pointX=px;pointY=py;
    if(!EnableDpiV2()) throw new InvalidOperationException("DPI_CONTEXT_UNVERIFIED");
    if(activate) ActivateTarget();
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
    AssertLive();
    // Recheck immediately before every Win32 SendInput, not just at startup:
    // Chrome Remote Desktop disconnect, Winlogon/UAC and Windows session
    // switches may happen between mission planning and actuator dispatch.
    InteractiveSessionId();
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
    AssertLive();
    CursorChanged=true;
    if(!SetCursorPos(x,y))throw new InvalidOperationException("CURSOR_MOVE_REJECTED");
  }
  public static bool PostFocus() {
    PostDispatchHwnd=GetForegroundWindow().ToInt64();
    bool same=SameForeground();if(!same)FocusDrifted=true;return same;
  }

  public static void SendChecked(INPUT[] inputs) {
    AssertTarget(pointRequired);
    AssertLive();
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

  [StructLayout(LayoutKind.Sequential)] private struct BITMAPINFOHEADER {
    public uint biSize;public int biWidth,biHeight;public ushort biPlanes,biBitCount;
    public uint biCompression,biSizeImage;public int biXPelsPerMeter,biYPelsPerMeter;
    public uint biClrUsed,biClrImportant;
  }
  [StructLayout(LayoutKind.Sequential)] private struct BITMAPINFO {
    public BITMAPINFOHEADER header;public uint colors;
  }
  [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hwnd,IntPtr dc);
  [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleBitmap(IntPtr dc,int w,int h);
  [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc,IntPtr obj);
  [DllImport("gdi32.dll")] private static extern bool BitBlt(IntPtr dest,int x,int y,int w,int h,IntPtr src,int sx,int sy,uint rop);
  [DllImport("gdi32.dll")] private static extern int GetDIBits(IntPtr dc,IntPtr bitmap,uint start,uint lines,[Out] byte[] bytes,ref BITMAPINFO info,uint usage);
  [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
  [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
  static bool ValidHandle(IntPtr p){return p!=IntPtr.Zero&&p!=new IntPtr(-1);}
  public static byte[] CaptureGrayRoi64(int cx,int cy) {
    AssertTarget(false);
    int x=cx-32,y=cy-32;
    // ROI is an optional local visual signal, not a general screen capture.
    for(int i=0;i<4;i++){
      POINT corner=new POINT{X=x+((i&1)!=0?63:0),Y=y+((i&2)!=0?63:0)};
      if(GetAncestor(WindowFromPoint(corner),2)!=target)throw new InvalidOperationException("ROI_OUTSIDE_TARGET");
    }
    IntPtr screen=IntPtr.Zero,mem=IntPtr.Zero,bmp=IntPtr.Zero,old=IntPtr.Zero;
    bool selected=false;
    try {
      screen=GetDC(IntPtr.Zero);if(!ValidHandle(screen))throw new InvalidOperationException("ROI_DC_FAILED");
      mem=CreateCompatibleDC(screen);if(!ValidHandle(mem))throw new InvalidOperationException("ROI_MEM_DC_FAILED");
      bmp=CreateCompatibleBitmap(screen,64,64);if(!ValidHandle(bmp))throw new InvalidOperationException("ROI_BITMAP_FAILED");
      old=SelectObject(mem,bmp);if(!ValidHandle(old))throw new InvalidOperationException("ROI_SELECT_FAILED");
      selected=true;
      if(!BitBlt(mem,0,0,64,64,screen,x,y,0x00CC0020))throw new InvalidOperationException("ROI_COPY_FAILED");
      // GetDIBits requires the bitmap not to be selected into a DC.
      if(!ValidHandle(SelectObject(mem,old)))throw new InvalidOperationException("ROI_DESELECT_FAILED");
      selected=false;
      BITMAPINFO info=new BITMAPINFO();
      info.header.biSize=(uint)Marshal.SizeOf(typeof(BITMAPINFOHEADER));
      info.header.biWidth=64;info.header.biHeight=-64;info.header.biPlanes=1;info.header.biBitCount=32;
      byte[] bgra=new byte[64*64*4];
      if(GetDIBits(screen,bmp,0,64,bgra,ref info,0)!=64)throw new InvalidOperationException("ROI_READ_FAILED");
      AssertTarget(false);
      byte[] gray=new byte[4096];
      for(int i=0,j=0;i<gray.Length;i++,j+=4)gray[i]=(byte)((bgra[j]*18+bgra[j+1]*183+bgra[j+2]*54)>>8);
      return gray;
    } finally {
      // Delete the memory DC before its bitmap if deselection failed.
      if(selected&&ValidHandle(mem)&&ValidHandle(old))SelectObject(mem,old);
      if(ValidHandle(mem))DeleteDC(mem);
      if(ValidHandle(bmp))DeleteObject(bmp);
      if(ValidHandle(screen))ReleaseDC(IntPtr.Zero,screen);
    }
  }

  public static void Chord(ushort[] keys) {
    INPUT[] batch=new INPUT[keys.Length*2];
    for(int i=0;i<keys.Length;i++){
      batch[i].type=INPUT_KEYBOARD;batch[i].u.ki.wVk=keys[i];
      int j=batch.Length-1-i;batch[j].type=INPUT_KEYBOARD;batch[j].u.ki.wVk=keys[i];batch[j].u.ki.dwFlags=KEYEVENTF_KEYUP;
    }
    SendChecked(batch);
  }
  // One character per send with a short pause. A single block of every key-down and key-up made the Windows 11 Notepad keep
  // the first characters and repeat the last one ("Aura 444444444444444", 2026-11-25); plain text boxes were unaffected.
  // SendChecked re-verifies the foreground window before and after each character, so typing stops the moment focus moves.
  public static void TypeBatch(string text) {
    if(String.IsNullOrEmpty(text)||text.Length>2000)throw new InvalidOperationException("INVALID_TYPE_LENGTH");
    for(int i=0;i<text.Length;i++){
      INPUT[] pair=new INPUT[2];
      pair[0].type=INPUT_KEYBOARD;pair[0].u.ki.wScan=text[i];pair[0].u.ki.dwFlags=4;
      pair[1].type=INPUT_KEYBOARD;pair[1].u.ki.wScan=text[i];pair[1].u.ki.dwFlags=6;
      SendChecked(pair);
      if(i+1<text.Length)System.Threading.Thread.Sleep(12);
    }
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
  # Cursor is already positioned and checked; SendChecked revalidates it immediately.
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
  # Reject Session 0, a switched Windows user session and the Winlogon/UAC
  # secure desktop. Never publish a service/locked screen as visual evidence.
  $sessionId=[WinInput]::InteractiveSessionId()
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
  # A switch to another input desktop during screen copy is a rejected read.
  if ([WinInput]::InteractiveSessionId() -ne $sessionId) { throw 'SCREEN_SESSION_CHANGED' }

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
  if ([WinInput]::InteractiveSessionId() -ne $sessionId) { throw 'SCREEN_SESSION_CHANGED' }
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
    sessionId = [int]$sessionId
  } | ConvertTo-Json -Depth 4 -Compress
}

function Do-GetCursor {
  [void][WinInput]::InteractiveSessionId()
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
  return ,([WinInput]::CaptureGrayRoi64($cx,$cy))
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
# Deterministic Windows CI probe: compile Win32 bindings, exercise entropy and
# invalid-binding refusal; never dispatch an actual input event.
function Invoke-BridgeRequest {
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
  [switch]$MeasureEntropy,
  [long]$DeadlineMs=0
)
[WinInput]::ResetRequest($DeadlineMs)
if($Op -eq 'self_test'){
  $a=New-Object byte[] 4096
  $b=New-Object byte[] 4096
  $same=Measure-Roi $a $b
  if($same.changedPixelRatio -ne 0 -or $same.deltaEntropyBits -ne 0){throw 'ROI_ZERO_DIFFERENCE_FAILED'}
  for($i=0;$i -lt 2048;$i++){$b[$i]=[byte]64}
  $different=Measure-Roi $a $b
  if($different.changedPixelRatio -ne 0.5 -or $different.deltaEntropyBits -ne 1 -or $different.signal -ne 'VISUAL_CHANGE_DETECTED'){throw 'ROI_ENTROPY_FIXTURE_FAILED'}
  $rejected=$false
  try{[WinInput]::Configure(0,0,0,0,0,0,$false,0,0,$false)}catch{$rejected=$true}
  if(-not $rejected -or [WinInput]::DispatchAttempted){throw 'INVALID_BINDING_DISPATCHED'}
  Write-Output '{"ok":true,"checks":3,"inputDispatched":false}'
  return
}
$mutating=$Op -in @('mouse_move','mouse_click','mouse_scroll','key_press','type_text')
if($mutating){
  $visual=$null
  try {
    $point=$Op -in @('mouse_move','mouse_click','mouse_scroll')
    [WinInput]::Configure($ExpectedHwnd,$ExpectedPid,$ExpectedLeft,$ExpectedTop,$ExpectedWidth,$ExpectedHeight,$point,$X,$Y,[bool]$Activate)
    if($Op -eq 'mouse_click'){
      if($Button -notin @('left','right','middle')){throw 'INVALID_MOUSE_BUTTON'}
      Do-MouseMove $X $Y
      Start-Sleep -Milliseconds 80
    }
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
    [ordered]@{ok=$true;verified=$true;outcomeUnknown=$false;postconditionVerified=$false;focusDriftedDuringDispatch=[WinInput]::FocusDrifted;evidence=$(if($Op -eq 'mouse_move'){'cursor-position-observed'}else{'input-dispatch-only'});visualObservation=$visual;telemetry=[ordered]@{hwnd=$ExpectedHwnd;pid=$ExpectedPid;postDispatchHwnd=[WinInput]::PostDispatchHwnd;dispatchAttempted=[WinInput]::DispatchAttempted;cursorMoveAttempted=[WinInput]::CursorChanged}} | ConvertTo-Json -Depth 5 -Compress
  } catch {
    $unknown=[WinInput]::DispatchAttempted -or ($Op -eq 'mouse_move' -and [WinInput]::CursorChanged)
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
    'session_status' {
      $sessionId=[WinInput]::InteractiveSessionId()
      [ordered]@{schema='jaco.desktop-session/v1';ok=$true;verified=$true;interactive=$true;sessionId=[int]$sessionId;foregroundHwnd=[WinInput]::ForegroundWindowId();inputDesktop='Default'} | ConvertTo-Json -Compress
    }
    default {throw 'UNKNOWN_INPUT_OPERATION'}
  }
}

}

if(-not $Daemon){
  $bound=@{}
  foreach($k in $PSBoundParameters.Keys){if($k -ne 'Daemon'){$bound[$k]=$PSBoundParameters[$k]}}
  Invoke-BridgeRequest @bound
  return
}
# Strict local stdio protocol. No evaluation, no arbitrary command or script.
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$allowed=@('Op','X','Y','Button','Double','Delta','Keys','Text','OutFile','CropX','CropY','CropWidth','CropHeight','MaxWidth','MaxHeight','ExpectedHwnd','ExpectedPid','ExpectedLeft','ExpectedTop','ExpectedWidth','ExpectedHeight','MeasureEntropy','Activate','DeadlineMs')
while($null -ne ($line=[Console]::ReadLine())){
  $reqId=$null;$started=$false;$mutation=$false
  try{
    if($line.Length -gt 65536){throw 'BRIDGE_FRAME_TOO_LARGE'}
    $req=$line | ConvertFrom-Json -ErrorAction Stop
    $reqId=$req.reqId
    if($reqId -isnot [string] -or $reqId -notmatch '^[0-9a-f-]{36}$'){throw 'BRIDGE_INVALID_REQUEST_ID'}
    $bound=@{}
    foreach($property in $req.PSObject.Properties){
      $name=$property.Name
      if($name -eq 'reqId'){continue}
      if($allowed -notcontains $name){throw 'BRIDGE_INVALID_FIELD'}
      if($name -in @('Double','MeasureEntropy','Activate') -and $property.Value -isnot [bool]){throw 'BRIDGE_INVALID_FLAG'}
      $bound[$name]=$property.Value
    }
    if($bound.Op -notin @('mouse_move','mouse_click','mouse_scroll','key_press','type_text','get_cursor','screenshot','session_status','self_test')){throw 'UNKNOWN_INPUT_OPERATION'}
    if(-not $bound.DeadlineMs -or [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge [long]$bound.DeadlineMs){throw 'BRIDGE_REQUEST_EXPIRED'}
    $mutation=$bound.Op -in @('mouse_move','mouse_click','mouse_scroll','key_press','type_text')
    $started=$true
    $output=Invoke-BridgeRequest @bound
    $receipt=$output | ConvertFrom-Json -ErrorAction Stop
    if($null -eq $receipt.verified){$receipt | Add-Member -NotePropertyName verified -NotePropertyValue ($receipt.ok -eq $true)}
    $receipt | Add-Member -NotePropertyName reqId -NotePropertyValue $reqId
    [Console]::WriteLine(($receipt | ConvertTo-Json -Depth 8 -Compress))
  }catch{
    [Console]::WriteLine(([ordered]@{reqId=$reqId;ok=$false;verified=$false;outcomeUnknown=($started -and $mutation);error='BRIDGE_REQUEST_FAILED'} | ConvertTo-Json -Compress))
  }
}
