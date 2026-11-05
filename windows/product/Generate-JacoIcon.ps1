# Create a Windows ICO from the checked-in JACO logo during the Windows release build.
param(
  [string]$Source = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'runtime\public\branding\jaco-logo.png'),
  [string]$Destination = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'build\windows\payload\JACO.ico')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
if (-not (Test-Path $Source)) { throw 'JACO_BRAND_IMAGE_MISSING' }
$image = [System.Drawing.Image]::FromFile($Source)
$bitmap = New-Object System.Drawing.Bitmap 64,64
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $scale = [Math]::Min(64 / $image.Width, 64 / $image.Height)
  $w = [int][Math]::Round($image.Width * $scale)
  $h = [int][Math]::Round($image.Height * $scale)
  $graphics.DrawImage($image, [int]((64-$w)/2), [int]((64-$h)/2), $w, $h)
  $memory = New-Object System.IO.MemoryStream
  try {
    $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $memory.ToArray()
  } finally { $memory.Dispose() }
} finally { $graphics.Dispose(); $bitmap.Dispose(); $image.Dispose() }
$stream = [System.IO.File]::Create($Destination)
try {
  $out = New-Object System.IO.BinaryWriter($stream)
  $out.Write([UInt16]0)
  $out.Write([UInt16]1)
  $out.Write([UInt16]1)
  $out.Write([Byte]64)
  $out.Write([Byte]64)
  $out.Write([Byte]0)
  $out.Write([Byte]0)
  $out.Write([UInt16]1)
  $out.Write([UInt16]32)
  $out.Write([UInt32]$bytes.Length)
  $out.Write([UInt32]22)
  $out.Write($bytes)
  $out.Flush()
} finally { $stream.Dispose() }
Write-Host "JACO_BRAND_ICO_READY $Destination"
