param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('system','computer','cpu','memory','disks','network','processes','services')]
  [string]$Query,

  [ValidateRange(1,200)]
  [int]$Limit = 100
)

$ErrorActionPreference = 'Stop'

$profiles = @{
  system = @{
    Class = 'Win32_OperatingSystem'
    Properties = @('Caption','Version','BuildNumber','OSArchitecture','LastBootUpTime','TotalVisibleMemorySize','FreePhysicalMemory')
    Filter = $null
    Sort = $null
  }
  computer = @{
    Class = 'Win32_ComputerSystem'
    Properties = @('Name','Manufacturer','Model','TotalPhysicalMemory','Domain','Workgroup')
    Filter = $null
    Sort = $null
  }
  cpu = @{
    Class = 'Win32_Processor'
    Properties = @('DeviceID','Name','NumberOfCores','NumberOfLogicalProcessors','LoadPercentage','MaxClockSpeed')
    Filter = $null
    Sort = 'DeviceID'
  }
  memory = @{
    Class = 'Win32_OperatingSystem'
    Properties = @('TotalVisibleMemorySize','FreePhysicalMemory','TotalVirtualMemorySize','FreeVirtualMemory')
    Filter = $null
    Sort = $null
  }
  disks = @{
    Class = 'Win32_LogicalDisk'
    Properties = @('DeviceID','VolumeName','FileSystem','Size','FreeSpace','DriveType')
    Filter = 'DriveType=3'
    Sort = 'DeviceID'
  }
  network = @{
    Class = 'Win32_NetworkAdapterConfiguration'
    Properties = @('Description','MACAddress','IPAddress','DefaultIPGateway','DHCPEnabled','DNSServerSearchOrder')
    Filter = 'IPEnabled=TRUE'
    Sort = 'Description'
  }
  processes = @{
    Class = 'Win32_Process'
    Properties = @('ProcessId','ParentProcessId','Name','ExecutablePath','CreationDate','WorkingSetSize','KernelModeTime','UserModeTime')
    Filter = $null
    Sort = 'ProcessId'
  }
  services = @{
    Class = 'Win32_Service'
    Properties = @('Name','DisplayName','State','StartMode','Status','ProcessId')
    Filter = $null
    Sort = 'Name'
  }
}

$profile = $profiles[$Query]
$params = @{ ClassName = $profile.Class }
if ($profile.Filter) { $params.Filter = $profile.Filter }

$rows = @(Get-CimInstance @params | Select-Object -Property $profile.Properties)
if ($profile.Sort) { $rows = @($rows | Sort-Object -Property $profile.Sort) }
$rows = @($rows | Select-Object -First $Limit)

$result = [ordered]@{
  schema = 'jaco.windows-wmi-read/v1'
  ok = $true
  verified = $true
  observed = $true
  source = 'windows-cim'
  query = $Query
  count = $rows.Count
  observedAt = (Get-Date).ToUniversalTime().ToString('o')
  host = $env:COMPUTERNAME
  data = $rows
}

$result | ConvertTo-Json -Depth 7 -Compress
