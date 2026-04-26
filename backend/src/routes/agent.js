const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();
const REGISTRATION_KEY = process.env.REGISTRATION_KEY || 'winserv-reg-key-change-me';

function generateUniversalScript(serverUrl, regKey) {
  return `# WinServ Monitoring Agent v2.0
# ====================================================================
# Auto-registers on first run. One script for all servers.
# Save to C:\\winserv-agent\\agent.ps1 and schedule:
#   schtasks /create /tn "WinServAgent" /tr "powershell.exe -ExecutionPolicy Bypass -File C:\\winserv-agent\\agent.ps1" /sc minute /mo 1 /ru SYSTEM
# ====================================================================
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ServerUrl = "${serverUrl}"
$MetricsUrl = "$ServerUrl/api/metrics"
$EventsUrl = "$ServerUrl/api/events"
$RegKey = "${regKey}"
$ConfigFile = "$env:ProgramData\\WinServAgent\\config.json"

$FullHostname = try { [System.Net.Dns]::GetHostEntry('').HostName } catch { "$FullHostname.$env:USERDNSDOMAIN" }
if (-not $FullHostname -or $FullHostname -notmatch '\.') { $FullHostname = $FullHostname }

function Get-SystemMetrics {
  $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average

  $os = Get-CimInstance Win32_OperatingSystem
  $memTotalMB = [math]::Round($os.TotalVisibleMemorySize / 1024, 0)
  $memFreeMB = [math]::Round($os.FreePhysicalMemory / 1024, 0)
  $memUsedMB = $memTotalMB - $memFreeMB

  $disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue
  $diskArray = @()
  $diskTotalGB = 0; $diskUsedGB = 0; $diskFreeGB = 0
  foreach ($d in $disks) {
    $sizeGB = [math]::Round($d.Size / 1GB, 1)
    $freeGB = [math]::Round($d.FreeSpace / 1GB, 1)
    $usedGB = [math]::Round(($d.Size - $d.FreeSpace) / 1GB, 1)
    $diskTotalGB += $sizeGB
    $diskFreeGB += $freeGB
    $diskUsedGB += $usedGB
    $diskArray += @{ drive = $d.DeviceID; total_gb = $sizeGB; used_gb = $usedGB; free_gb = $freeGB }
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
    $events = Get-WinEvent -FilterHashtable @{LogName='System';Level=1,2;StartTime=$since} -MaxEvents 100 -ErrorAction Stop
  } catch {
    try {
      $events = Get-EventLog -LogName System -EntryType Error -After $since -Newest 100 -ErrorAction Stop
    } catch {
      Write-Host "EventLog: cannot read System log (may need admin rights)"
      return @()
    }
  }
  if (-not $events) { return @() }
  $result = @()
  foreach ($e in $events) {
    $source = if ($e.ProviderName) { $e.ProviderName } else { $e.Source }
    $eid = if ($e.Id) { $e.Id } else { $e.EventID }
    $lvl = if ($e.LevelDisplayName) { $e.LevelDisplayName } else { 'Error' }
    $msg = if ($e.Message) { if ($e.Message.Length -gt 2000) { $e.Message.Substring(0, 2000) } else { $e.Message } } else { '' }
    $time = if ($e.TimeCreated) { $e.TimeCreated.ToString('yyyy-MM-ddTHH:mm:ss') } else { $e.TimeGenerated.ToString('yyyy-MM-ddTHH:mm:ss') }
    $result += @{source=$source;event_id=$eid;level=$lvl;message=$msg;recorded_at=$time}
  }
  Write-Host "Events collected: $($result.Count)"
  return $result
}

function Save-Token {
  $dir = Split-Path $ConfigFile -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  @{token=$Token} | ConvertTo-Json | Set-Content $ConfigFile -Force
}

$osInfo = (Get-CimInstance Win32_OperatingSystem).Caption
$ip = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
if (-not $ip) { $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' } | Select-Object -First 1).IPAddress }

$Token = $null
if (Test-Path $ConfigFile) {
  try { $config = Get-Content $ConfigFile -Raw | ConvertFrom-Json; $Token = $config.token } catch {}
}

$metricsObj = Get-SystemMetrics

function Send-Body($url, $body) {
  try {
    $response = Invoke-RestMethod -Uri $url -Method POST -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 15
    return $response
  } catch {
    Write-Warning "$url : $_"
    return $null
  }
}

$Token = $null
if (Test-Path $ConfigFile) {
  try { $config = Get-Content $ConfigFile -Raw | ConvertFrom-Json; $Token = $config.token } catch {}
}

$metricsObj = Get-SystemMetrics

if ($Token) {
  $body = @{token=$Token;hostname=$FullHostname;ip_address=$ip;os_info=$osInfo;metrics=$metricsObj} | ConvertTo-Json -Depth 6
  $response = Send-Body $MetricsUrl $body
  if ($response) {
    if ($response.token) { $Token = $response.token; Save-Token }
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Metrics OK"
  } else {
    $Token = $null
  }
}

if (-not $Token) {
  $body = @{registration_key=$RegKey;hostname=$FullHostname;ip_address=$ip;os_info=$osInfo;metrics=$metricsObj} | ConvertTo-Json -Depth 6
  $response = Send-Body $MetricsUrl $body
  if ($response -and $response.token) {
    $Token = $response.token; Save-Token
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Registered: $FullHostname"
  }
}

# Always collect and send events, regardless of metrics status
$events = Get-CriticalEvents
if ($events.Count -gt 0) {
  if ($Token) {
    $eventsBody = @{token=$Token;hostname=$FullHostname;events=$events} | ConvertTo-Json -Depth 6
    $r = Send-Body $EventsUrl $eventsBody
    if ($r) { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Events sent: $($events.Count)" }
  } else {
    $eventsBody = @{registration_key=$RegKey;hostname=$FullHostname;events=$events} | ConvertTo-Json -Depth 6
    $r = Send-Body $EventsUrl $eventsBody
    if ($r) { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Events sent (reg): $($events.Count)" }
  }
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
