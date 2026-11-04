# JACO - read-only performance diagnosis of a Windows machine (changes nothing).
# Run: powershell -ExecutionPolicy Bypass -File .\diagnose-machine.ps1
# Writes jaco-diagnos-<computer>.txt to the Desktop; send that file back for analysis.

$ErrorActionPreference = 'SilentlyContinue'
$out = Join-Path ([Environment]::GetFolderPath('Desktop')) ("jaco-diagnos-{0}.txt" -f $env:COMPUTERNAME)
$lines = New-Object System.Collections.Generic.List[string]
function Add([string]$text) { $lines.Add($text); Write-Host $text }
function Section([string]$title) { Add ''; Add ('== ' + $title + ' ==') }

Add ("JACO diagnosis {0} {1}" -f $env:COMPUTERNAME, (Get-Date -Format 'yyyy-MM-dd HH:mm'))

Section 'System'
$cs = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
Add ("Model: {0} {1}" -f $cs.Manufacturer, $cs.Model)
Add ("Windows: {0} build {1}" -f $os.Caption, $os.BuildNumber)
Add ("CPU: {0} ({1} cores / {2} threads)" -f $cpu.Name.Trim(), $cpu.NumberOfCores, $cpu.NumberOfLogicalProcessors)
Add ("Uptime: {0:N1} days" -f ((Get-Date) - $os.LastBootUpTime).TotalDays)
Add ("Power scheme: " + ((powercfg /getactivescheme) -join ' '))

Section 'Memory'
Add ("RAM total: {0:N1} GB, free: {1:N1} GB" -f ($cs.TotalPhysicalMemory / 1GB), ($os.FreePhysicalMemory / 1MB))
Add ("Commit used: {0:N1} / {1:N1} GB" -f (($os.TotalVirtualMemorySize - $os.FreeVirtualMemory) / 1MB), ($os.TotalVirtualMemorySize / 1MB))
Get-CimInstance Win32_PhysicalMemory | ForEach-Object { Add ("  Module {0}: {1} GB {2} MHz" -f $_.BankLabel, ($_.Capacity / 1GB), $_.Speed) }
Get-CimInstance Win32_PageFileUsage | ForEach-Object { Add ("Page file {0}: {1} MB, used {2} MB" -f $_.Name, $_.AllocatedBaseSize, $_.CurrentUsage) }

Section 'GPU'
Get-CimInstance Win32_VideoController | ForEach-Object { Add ("{0} driver {1}" -f $_.Name, $_.DriverVersion) }
$smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($smi) {
  (& nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu,power.draw,pstate,driver_version --format=csv) | ForEach-Object { Add $_ }
  Add 'GPU processes:'
  (& nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv) | ForEach-Object { Add ('  ' + $_) }
} else { Add 'nvidia-smi missing (NVIDIA driver not installed or not in PATH)' }

Section 'Disks'
Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { Add ("{0} {1:N0} GB free of {2:N0} GB" -f $_.DeviceID, ($_.FreeSpace / 1GB), ($_.Size / 1GB)) }
Get-PhysicalDisk | ForEach-Object { Add ("{0} {1} {2:N0} GB health={3}" -f $_.FriendlyName, $_.MediaType, ($_.Size / 1GB), $_.HealthStatus) }

Section 'CPU usage per process (10 s sample)'
$before = @{}; Get-Process | ForEach-Object { $before[$_.Id] = $_.CPU }
Start-Sleep -Seconds 10
Get-Process | ForEach-Object {
  $prev = $before[$_.Id]; if ($null -ne $prev -and $null -ne $_.CPU) { [pscustomobject]@{ Name = $_.ProcessName; Id = $_.Id; Sec = $_.CPU - $prev } }
} | Sort-Object Sec -Descending | Select-Object -First 15 | ForEach-Object { Add ("{0,-30} pid {1,-7} {2,6:N1} s CPU ({3,5:N0} % of one core)" -f $_.Name, $_.Id, $_.Sec, ($_.Sec * 10)) }

Section 'Memory per program (grouped)'
Get-Process | Group-Object ProcessName | ForEach-Object {
  [pscustomobject]@{ Name = $_.Name; MB = ($_.Group | Measure-Object WorkingSet64 -Sum).Sum / 1MB; Priv = ($_.Group | Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB; N = $_.Count }
} | Sort-Object Priv -Descending | Select-Object -First 20 | ForEach-Object { Add ("{0,-30} {1,7:N0} MB in RAM {2,7:N0} MB reserved ({3} processes)" -f $_.Name, $_.MB, $_.Priv, $_.N) }

Section 'Autostart'
Get-CimInstance Win32_StartupCommand | ForEach-Object { Add ("{0} -> {1}" -f $_.Name, $_.Command) }

Section 'Background activity'
$tiw = Get-Process TiWorker, TrustedInstaller -ErrorAction SilentlyContinue
Add ("Windows Update installing right now: " + [bool]$tiw)
$mp = Get-MpComputerStatus
if ($mp) { Add ("Defender: real-time protection={0}, last quick scan {1}, last full scan {2}" -f $mp.RealTimeProtectionEnabled, $mp.QuickScanEndTime, $mp.FullScanEndTime) }
$thermal = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature
foreach ($t in $thermal) { Add ("Thermal zone: {0:N0} C" -f (($t.CurrentTemperature / 10) - 273.15)) }

Section 'Ollama'
$ollama = Get-Process ollama*, llama-server -ErrorAction SilentlyContinue
if ($ollama) { $ollama | ForEach-Object { Add ("{0} pid {1} {2:N0} MB reserved" -f $_.ProcessName, $_.Id, ($_.PrivateMemorySize64 / 1MB)) } } else { Add 'Ollama is not running' }
try {
  $tags = Invoke-RestMethod http://127.0.0.1:11434/api/tags -TimeoutSec 3
  Add ('Installed models: ' + (($tags.models | ForEach-Object { '{0} ({1:N1} GB)' -f $_.name, ($_.size / 1GB) }) -join ', '))
  $ps = Invoke-RestMethod http://127.0.0.1:11434/api/ps -TimeoutSec 3
  Add ('Loaded models: ' + (($ps.models | ForEach-Object { '{0} {1:N1} GB in VRAM of {2:N1} GB' -f $_.name, ($_.size_vram / 1GB), ($_.size / 1GB) }) -join ', '))
} catch { Add 'Ollama API is not answering on 127.0.0.1:11434' }
foreach ($k in 'OLLAMA_HOST', 'OLLAMA_CONTEXT_LENGTH', 'OLLAMA_KEEP_ALIVE', 'CUDA_VISIBLE_DEVICES') {
  $v = [Environment]::GetEnvironmentVariable($k, 'User'); if (-not $v) { $v = [Environment]::GetEnvironmentVariable($k, 'Machine') }
  if ($v) { Add ("{0}={1}" -f $k, $v) }
}

Section 'Network'
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | ForEach-Object { Add ("{0} {1}" -f $_.InterfaceAlias, $_.IPAddress) }

$lines | Set-Content -Path $out -Encoding UTF8
Write-Host ''
Write-Host "Done. Result saved to: $out" -ForegroundColor Green
