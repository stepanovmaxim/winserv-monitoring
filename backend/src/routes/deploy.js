const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();
const REGISTRATION_KEY = process.env.REGISTRATION_KEY || 'winserv-reg-key-change-me';

function generateAgentScript(serverUrl, regKey) {
  return `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ServerUrl = "${serverUrl}"
$MetricsUrl = "$ServerUrl/api/metrics"
$EventsUrl = "$ServerUrl/api/events"
$RegKey = "${regKey}"
$ConfigFile = "$env:ProgramData\\WinServAgent\\config.json"

$FullHostname = try { [System.Net.Dns]::GetHostEntry('').HostName } catch { "$env:COMPUTERNAME.$env:USERDNSDOMAIN" }
if (-not $FullHostname -or $FullHostname -notmatch '\\.') { $FullHostname = "$env:COMPUTERNAME.$env:USERDNSDOMAIN" }

function Get-SystemMetrics {
  $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
  $os = Get-CimInstance Win32_OperatingSystem
  $memTotalMB = [math]::Round($os.TotalVisibleMemorySize / 1024, 0)
  $memFreeMB = [math]::Round($os.FreePhysicalMemory / 1024, 0)
  $memUsedMB = $memTotalMB - $memFreeMB
  $disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue
  $diskPerf = @{}
  try { Get-CimInstance Win32_PerfFormattedData_PerfDisk_LogicalDisk -ErrorAction Stop | Where-Object { $_.Name -match '^[A-Z]:$' } | ForEach-Object { $diskPerf[$_.Name] = @{read_bytes_sec=[math]::Round($_.DiskReadBytesPerSec,0);write_bytes_sec=[math]::Round($_.DiskWriteBytesPerSec,0);disk_time_pct=[math]::Round($_.PercentDiskTime,1);queue_length=[math]::Round($_.CurrentDiskQueueLength,1)} } } catch {}
  $diskArray = @(); $diskTotalGB = 0; $diskUsedGB = 0; $diskFreeGB = 0
  foreach ($d in $disks) {
    $sizeGB = [math]::Round($d.Size / 1GB, 1); $freeGB = [math]::Round($d.FreeSpace / 1GB, 1); $usedGB = [math]::Round(($d.Size - $d.FreeSpace) / 1GB, 1)
    $diskTotalGB += $sizeGB; $diskFreeGB += $freeGB; $diskUsedGB += $usedGB
    $entry = @{ drive = $d.DeviceID; total_gb = $sizeGB; used_gb = $usedGB; free_gb = $freeGB }
    $perf = $diskPerf[$d.DeviceID]; if ($perf) { $entry.read_bytes_sec = $perf.read_bytes_sec; $entry.write_bytes_sec = $perf.write_bytes_sec; $entry.disk_time_pct = $perf.disk_time_pct; $entry.queue_length = $perf.queue_length }
    $diskArray += $entry
  }
  $uptime = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalSeconds, 0)
  return @{ cpu_usage = $cpu; memory_total_mb = $memTotalMB; memory_used_mb = $memUsedMB; disk_total_gb = $diskTotalGB; disk_used_gb = $diskUsedGB; disk_free_gb = $diskFreeGB; disks = $diskArray; uptime_seconds = $uptime }
}

function Get-CriticalEvents {
  $since = (Get-Date).AddMinutes(-30); $events = $null
  try { $events = Get-WinEvent -FilterHashtable @{LogName='System';Level=1,2;StartTime=$since} -MaxEvents 100 -ErrorAction Stop }
  catch { try { $events = Get-EventLog -LogName System -EntryType Error -After $since -Newest 100 -ErrorAction Stop } catch { Write-Host "EventLog: cannot read System log"; return @() } }
  if (-not $events) { return @() }; $result = @()
  foreach ($e in $events) {
    $source = if ($e.ProviderName) { $e.ProviderName } else { $e.Source }; $eid = if ($e.Id) { $e.Id } else { $e.EventID }
    $lvlNum = if ($e.Level) { $e.Level } else { 2 }
    if ($lvlNum -le 1) { $lvl = 'Critical' } elseif ($lvlNum -le 2) { $lvl = 'Error' } elseif ($lvlNum -le 3) { $lvl = 'Warning' } else { $lvl = 'Information' }
    try { $msg = if ($e.Message) { if ($e.Message.Length -gt 2000) { $e.Message.Substring(0, 2000) } else { $e.Message } } else { '' } } catch { $msg = '' }
    $time = if ($e.TimeCreated) { $e.TimeCreated.ToString('yyyy-MM-ddTHH:mm:ss') } else { $e.TimeGenerated.ToString('yyyy-MM-ddTHH:mm:ss') }
    $result += @{source=$source;event_id=$eid;level=$lvl;message=$msg;recorded_at=$time}
  }
  Write-Host "Events collected: $($result.Count)"; return $result
}

function Save-Token { $dir = Split-Path $ConfigFile -Parent; if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }; @{token=$Token} | ConvertTo-Json | Set-Content $ConfigFile -Force }
function Send-Body($url, $body) { try { return Invoke-RestMethod -Uri $url -Method POST -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 15 } catch { Write-Warning "$url : $_"; return $null } }

$osInfo = (Get-CimInstance Win32_OperatingSystem).Caption
$ip = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
if (-not $ip) { $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' } | Select-Object -First 1).IPAddress }

$Token = $null
if (Test-Path $ConfigFile) { try { $config = Get-Content $ConfigFile -Raw | ConvertFrom-Json; $Token = $config.token } catch {} }
$metricsObj = Get-SystemMetrics

if ($Token) { $body = @{token=$Token;hostname=$FullHostname;ip_address=$ip;os_info=$osInfo;metrics=$metricsObj} | ConvertTo-Json -Depth 6; $response = Send-Body $MetricsUrl $body; if ($response) { if ($response.token) { $Token = $response.token; Save-Token }; Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Metrics OK" } else { $Token = $null } }
if (-not $Token) { $body = @{registration_key=$RegKey;hostname=$FullHostname;ip_address=$ip;os_info=$osInfo;metrics=$metricsObj} | ConvertTo-Json -Depth 6; $response = Send-Body $MetricsUrl $body; if ($response -and $response.token) { $Token = $response.token; Save-Token; Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Registered: $FullHostname" } }

$events = Get-CriticalEvents
if ($events.Count -gt 0) {
  if ($Token) { $ebody = @{token=$Token;hostname=$FullHostname;events=$events} | ConvertTo-Json -Depth 6; $r = Send-Body $EventsUrl $ebody; if ($r) { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Events sent: $($events.Count)" } }
  else { $ebody = @{registration_key=$RegKey;hostname=$FullHostname;events=$events} | ConvertTo-Json -Depth 6; $r = Send-Body $EventsUrl $ebody; if ($r) { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Events sent (reg): $($events.Count)" } }
}`;
}

function generateDeployerScript(serverUrl, regKey) {
  const agentLines = generateAgentScript(serverUrl, regKey).split('\n');
  const agentScriptEncoded = agentLines.map(l => `'${l.replace(/'/g, "''")}'`).join(' + "`n" + \n');

  return `# WinServ Monitoring — Mass Deployer v2.1
# ====================================================================
# Run on a domain-joined machine with Domain Admin rights.
# Discovers servers in domain, select with checkboxes, remote installs agent.
# ====================================================================
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Continue"
$ServerUrl = "${serverUrl}"

# --- Embedded agent script ---
$AgentScript = @(
${agentScriptEncoded}
) -join ""

# --- Discover domain servers ---
function Get-DomainServers {
  param($Domain)
  Import-Module ActiveDirectory -ErrorAction Stop
  if ($Domain) {
    Get-ADComputer -Filter {OperatingSystem -like "*Server*" -and Enabled -eq $true} -Server $Domain -Properties OperatingSystem,DNSHostName
  } else {
    Get-ADComputer -Filter {OperatingSystem -like "*Server*" -and Enabled -eq $true} -Properties OperatingSystem,DNSHostName
  }
}

# --- Install agent on remote server ---
function Install-Agent {
  param($ComputerName)
  try { $ping = Test-Connection -ComputerName $ComputerName -Count 1 -Quiet -ErrorAction Stop } catch { return "OFFLINE" }
  if (-not $ping) { return "OFFLINE" }
  try {
    $remotePath = "\\\\$ComputerName\\C$\\winserv-agent"
    if (-not (Test-Path $remotePath)) { New-Item -ItemType Directory -Path $remotePath -Force | Out-Null }
    $AgentScript | Set-Content -Path "$remotePath\\agent.ps1" -Encoding UTF8 -Force
    schtasks /delete /tn "WinServAgent" /s $ComputerName /f 2>$null
    schtasks /create /tn "WinServAgent" /s $ComputerName /ru SYSTEM /sc minute /mo 1 /tr "powershell.exe -ExecutionPolicy Bypass -File C:\\winserv-agent\\agent.ps1" /f
    return "OK"
  } catch { return "ERROR: $_" }
}

function Get-RemoteVersion {
  param($ComputerName)
  try {
    $c = Get-Content "\\\\$ComputerName\\C$\\winserv-agent\\agent.ps1" -Raw -ErrorAction Stop
    if ($c -match 'Deployer v([0-9.]+)') { return $matches[1] }
    return "unknown"
  } catch { return $null }
}

# --- MAIN ---
Clear-Host
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " WinServ Mass Deployer v2.1" -ForegroundColor Cyan
Write-Host " Server: $ServerUrl" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$domain = $null; $domainInput = Read-Host "Enter domain name (or Enter for current domain)"
if ($domainInput) { $domain = $domainInput } else { try { $domain = (Get-ADDomain).DNSRoot } catch {} }

Write-Host "Discovering servers in domain: $domain ..." -ForegroundColor Yellow
try {
  $allServers = Get-DomainServers -Domain $domain | Select-Object Name, DNSHostName, OperatingSystem
  Write-Host "Found $($allServers.Count) servers" -ForegroundColor Green
} catch {
  Write-Host "ActiveDirectory module not available!" -ForegroundColor Red
  Write-Host "On a DC: Import-Module ActiveDirectory" -ForegroundColor Yellow
  Write-Host "On Win10/11: Install-WindowsFeature RSAT-AD-PowerShell" -ForegroundColor Yellow
  exit 1
}

if ($allServers.Count -eq 0) { Write-Host "No servers found." -ForegroundColor Red; exit 1 }

# --- Build indexed list ---
$serverList = @()
$checked = @{}
for ($i=0; $i -lt $allServers.Count; $i++) {
  $s = $allServers[$i]
  $h = if ($s.DNSHostName) { $s.DNSHostName } else { $s.Name }
  $checked["$i"] = $true
  $serverList += @{idx=$i; hostname=$h; name=$s.Name; os=$s.OperatingSystem}
}

function Show-Menu {
  Clear-Host
  Write-Host "========================================" -ForegroundColor Cyan
  Write-Host " Select servers for agent installation" -ForegroundColor Cyan
  Write-Host " [A] All  [N] None  [D] Deploy  [Q] Quit" -ForegroundColor Cyan
  Write-Host "========================================" -ForegroundColor Cyan
  Write-Host ""
  foreach ($s in $serverList) {
    $mark = if ($checked["$($s.idx)"]) { "[x]" } else { "[ ]" }
    $num = "{0:D2}" -f ($s.idx + 1)
    Write-Host "  $mark $num`t$($s.hostname)" -NoNewline
    Write-Host "`t$($s.os)" -ForegroundColor DarkGray
  }
  Write-Host ""
  Write-Host "Enter number to toggle, or command letter: " -NoNewline
}

do {
  Show-Menu
  $key = Read-Host
  if ($key -eq 'Q' -or $key -eq 'q') { exit 0 }
  if ($key -eq 'A' -or $key -eq 'a') { foreach ($s in $serverList) { $checked["$($s.idx)"] = $true } }
  if ($key -eq 'N' -or $key -eq 'n') { foreach ($s in $serverList) { $checked["$($s.idx)"] = $false } }
  if ($key -match '^\d+$') {
    $num = [int]$key - 1
    if ($num -ge 0 -and $num -lt $serverList.Count) {
      $checked["$num"] = -not $checked["$num"]
    }
  }
} while ($key -ne 'D' -and $key -ne 'd')

$selected = $serverList | Where-Object { $checked["$($_.idx)"] }
if ($selected.Count -eq 0) { Write-Host "No servers selected."; exit 0 }

Write-Host ""; Write-Host "Deploying to $($selected.Count) servers..." -ForegroundColor Yellow
$results = @(); $i = 1

foreach ($srv in $selected) {
  $h = $srv.hostname
  Write-Host "  [$i/$($selected.Count)] $h " -NoNewline
  $ex = Get-RemoteVersion -ComputerName $h
  if ($ex) { Write-Host "(v$ex) " -NoNewline }
  $r = Install-Agent -ComputerName $h
  if ($r -eq "OK") { Write-Host "INSTALLED" -ForegroundColor Green }
  elseif ($r -eq "OFFLINE") { Write-Host "OFFLINE" -ForegroundColor Red }
  else { Write-Host $r -ForegroundColor Red }
  $results += @{hostname=$h;result=$r}; $i++
}

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host " DEPLOYMENT COMPLETE" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host " Installed: $(($results|?{$_.result -eq 'OK'}).Count)  Offline: $(($results|?{$_.result -eq 'OFFLINE'}).Count)  Errors: $(($results|?{$_.result -match 'ERROR'}).Count)"
Write-Host "Servers appear in dashboard within 1-2 minutes." -ForegroundColor Yellow
`;
}

router.get('/script', requireAuth, requireAdmin, (req, res) => {
  const serverUrl = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  res.type('text/plain; charset=utf-8');
  res.send(generateDeployerScript(serverUrl, REGISTRATION_KEY));
});

module.exports = router;
