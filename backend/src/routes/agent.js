const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();
const REGISTRATION_KEY = process.env.REGISTRATION_KEY || 'winserv-reg-key-change-me';

function generateUniversalScript(serverUrl, regKey) {
  return `# WinServ Monitoring Agent v2.2
# ====================================================================
# Auto-registers on first run. One script for all servers.
# Save to C:\\winserv-agent\\agent.ps1 and schedule:
#   schtasks /create /tn "WinServAgent" /tr "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -ExecutionPolicy Bypass -NoProfile -NonInteractive -WindowStyle Hidden -File \"C:\winserv-agent\agent.ps1\"" /sc minute /mo 1 /ru SYSTEM
# ====================================================================
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$ErrorActionPreference = "Continue"
$ServerUrl = "${serverUrl}"
$MetricsUrl = "$ServerUrl/api/metrics"
$EventsUrl = "$ServerUrl/api/events"
$RegKey = "${regKey}"
$ConfigFile = "$env:ProgramData\\WinServAgent\\config.json"
$LogFile = "$env:ProgramData\\WinServAgent\\agent.log"

function Write-Log($msg) {
  $dir = Split-Path $LogFile -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  "$ts $msg" | Out-File $LogFile -Append -Encoding UTF8
}

Write-Log "Agent started"

$FullHostname = try { [System.Net.Dns]::GetHostEntry('').HostName } catch { "$env:COMPUTERNAME.$env:USERDNSDOMAIN" }
if (-not $FullHostname -or $FullHostname -notmatch '\.') { $FullHostname = "$env:COMPUTERNAME.$env:USERDNSDOMAIN" }

function Get-SystemMetrics {
  $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average

  $os = Get-CimInstance Win32_OperatingSystem
  $memTotalMB = [math]::Round($os.TotalVisibleMemorySize / 1024, 0)
  $memFreeMB = [math]::Round($os.FreePhysicalMemory / 1024, 0)
  $memUsedMB = $memTotalMB - $memFreeMB

  $disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue
  $diskPerf = @{}
  try {
    Get-CimInstance Win32_PerfFormattedData_PerfDisk_LogicalDisk -ErrorAction Stop | Where-Object { $_.Name -match '^[A-Z]:$' } | ForEach-Object {
      $diskPerf[$_.Name] = @{
        read_bytes_sec = [math]::Round($_.DiskReadBytesPerSec, 0)
        write_bytes_sec = [math]::Round($_.DiskWriteBytesPerSec, 0)
        disk_time_pct = [math]::Round($_.PercentDiskTime, 1)
        queue_length = [math]::Round($_.CurrentDiskQueueLength, 1)
      }
    }
  } catch {}

  $diskArray = @()
  $diskTotalGB = 0; $diskUsedGB = 0; $diskFreeGB = 0
  foreach ($d in $disks) {
    $sizeGB = [math]::Round($d.Size / 1GB, 1)
    $freeGB = [math]::Round($d.FreeSpace / 1GB, 1)
    $usedGB = [math]::Round(($d.Size - $d.FreeSpace) / 1GB, 1)
    $diskTotalGB += $sizeGB
    $diskFreeGB += $freeGB
    $diskUsedGB += $usedGB
    $perf = $diskPerf[$d.DeviceID]
    $diskEntry = @{ drive = $d.DeviceID; total_gb = $sizeGB; used_gb = $usedGB; free_gb = $freeGB }
    if ($perf) {
      $diskEntry.read_bytes_sec = $perf.read_bytes_sec
      $diskEntry.write_bytes_sec = $perf.write_bytes_sec
      $diskEntry.disk_time_pct = $perf.disk_time_pct
      $diskEntry.queue_length = $perf.queue_length
    }
    $diskArray += $diskEntry
  }

  $uptime = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalSeconds, 0)

  return @{
    cpu_usage = $cpu
    memory_total_mb = $memTotalMB
    memory_used_mb = $memUsedMB
    disk_total_gb = $diskTotalGB
    disk_used_gb = $diskUsedGB
    disk_free_gb = $diskFreeGB
    disks = $diskArray
    uptime_seconds = $uptime
  }
}

function Get-CriticalEvents {
  $since = (Get-Date).AddMinutes(-30)
  $events = $null
  try {
    $events = Get-WinEvent -FilterHashtable @{LogName='System';Level=1,2,3;StartTime=$since} -MaxEvents 200 -ErrorAction Stop
  } catch {
    try {
      $events = Get-EventLog -LogName System -EntryType Error,Warning -After $since -Newest 200 -ErrorAction Stop
    } catch {
      Write-Log "EventLog: cannot read System log"'
      return @()
    }
  }
  if (-not $events) { return @() }
  $result = @()
  foreach ($e in $events) {
    $source = if ($e.ProviderName) { $e.ProviderName } else { $e.Source }
    $eid = if ($e.Id) { $e.Id } else { $e.EventID }
    $lvlNum = if ($e.Level) { $e.Level } else { 2 }
    if ($lvlNum -le 1) { $lvl = 'Critical' }
    elseif ($lvlNum -le 2) { $lvl = 'Error' }
    elseif ($lvlNum -le 3) { $lvl = 'Warning' }
    else { $lvl = 'Information' }
    try {
      $msg = if ($e.Message) { if ($e.Message.Length -gt 2000) { $e.Message.Substring(0, 2000) } else { $e.Message } } else { '' }
    } catch { $msg = '' }
    $time = if ($e.TimeCreated) { $e.TimeCreated.ToString('yyyy-MM-ddTHH:mm:ss') } else { $e.TimeGenerated.ToString('yyyy-MM-ddTHH:mm:ss') }
    $result += @{source=$source;event_id=$eid;level=$lvl;message=$msg;recorded_at=$time}
  }
  Write-Log "Events collected: $($result.Count)"
  return $result
}

function Save-Token {
  try {
    $dir = Split-Path $ConfigFile -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    @{token=$Token} | ConvertTo-Json | Set-Content $ConfigFile -Force
  } catch { Write-Log "Save-Token error: $_" }
}

function Send-Body($url, $body) {
  try {
    return Invoke-RestMethod -Uri $url -Method POST -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 15
  } catch {
    Write-Log "Send-Body $url : $_"
    return $null
  }
}

# --- Main execution ---
try {
  Write-Log "Starting collection"

  try { $osInfo = (Get-CimInstance Win32_OperatingSystem).Caption } catch { $osInfo = "Windows" }
  Write-Log "OS: $osInfo"

  try {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
    if (-not $ip) { $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' } | Select-Object -First 1).IPAddress }
  } catch { $ip = "" }
  Write-Log "IP: $ip"

  $Token = $null
  if (Test-Path $ConfigFile) {
    try { $config = Get-Content $ConfigFile -Raw | ConvertFrom-Json; $Token = $config.token } catch {}
  }
  Write-Log "Token loaded: $($Token -ne $null)"

  try { $metricsObj = Get-SystemMetrics } catch { Write-Log "Metrics error: $_"; $metricsObj = $null }
  Write-Log "Metrics collected: $($metricsObj -ne $null)"

  if ($metricsObj) {
    if ($Token) {
      $body = @{token=$Token;hostname=$FullHostname;ip_address=$ip;os_info=$osInfo;metrics=$metricsObj} | ConvertTo-Json -Depth 6
      $response = Send-Body $MetricsUrl $body
      if ($response) {
        if ($response.token) { $Token = $response.token; Save-Token }
        Write-Log "Metrics sent with token"
      } else {
        $Token = $null
        Write-Log "Metrics failed, will re-register"
      }
    }

    if (-not $Token) {
      $body = @{registration_key=$RegKey;hostname=$FullHostname;ip_address=$ip;os_info=$osInfo;metrics=$metricsObj} | ConvertTo-Json -Depth 6
      $response = Send-Body $MetricsUrl $body
      if ($response -and $response.token) {
        $Token = $response.token; Save-Token
        Write-Log "Registered: $FullHostname"
      } else {
        Write-Log "Registration failed"
      }
    }
  }

  try { $events = Get-CriticalEvents } catch { Write-Log "Events collection error: $_"; $events = @() }
  Write-Log "Events found: $($events.Count)"

  if ($events.Count -gt 0) {
    if ($Token) {
      $eventsBody = @{token=$Token;hostname=$FullHostname;events=$events} | ConvertTo-Json -Depth 6
      $r = Send-Body $EventsUrl $eventsBody
      if ($r) { Write-Log "Events sent: $($events.Count)" }
    } else {
      $eventsBody = @{registration_key=$RegKey;hostname=$FullHostname;events=$events} | ConvertTo-Json -Depth 6
      $r = Send-Body $EventsUrl $eventsBody
      if ($r) { Write-Log "Events sent (reg): $($events.Count)" }
    }
  }

  Write-Log "Agent completed successfully"
} catch {
  Write-Log "FATAL: $_"
  throw
}
`;
}

router.get('/script', requireAuth, requireAdmin, async (req, res) => {
  const serverUrl = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  res.type('text/plain; charset=utf-8');
  res.send(generateUniversalScript(serverUrl, REGISTRATION_KEY));
});

router.get('/script/:serverId', requireAuth, requireAdmin, async (req, res) => {
  const serverUrl = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  res.type('text/plain; charset=utf-8');
  res.send(generateUniversalScript(serverUrl, REGISTRATION_KEY));
});

module.exports = router;
module.exports.generateUniversalScript = generateUniversalScript;
