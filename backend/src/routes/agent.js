const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const db = require('../db');

const router = express.Router();

const REGISTRATION_KEY = process.env.REGISTRATION_KEY || 'winserv-reg-key-change-me';

router.get('/script', requireAuth, requireAdmin, async (req, res) => {
  const serverUrl = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  res.type('text/plain');
  res.send(generateUniversalScript(serverUrl, REGISTRATION_KEY));
});

router.get('/script/:serverId', requireAuth, requireAdmin, async (req, res) => {
  const server = await db.queryOne('SELECT * FROM servers WHERE id = $1', [req.params.id]);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  const serverUrl = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  res.type('text/plain');
  res.send(generateUniversalScript(serverUrl, REGISTRATION_KEY));
});

function generateUniversalScript(serverUrl, regKey) {
  return [
    '# ====================================================================',
    '# WinServ Monitoring Agent v2.0 — Universal Auto-Register',
    '# ====================================================================',
    '# This script auto-registers the server on first run.',
    '# Just copy it to any Windows Server and run. No per-server token needed.',
    '#',
    '# SCHEDULED TASK (run as Administrator):',
    '#   schtasks /create /tn "WinServAgent" /tr "powershell.exe -ExecutionPolicy Bypass -File C:\\winserv-agent\\agent.ps1" /sc minute /mo 5 /ru SYSTEM',
    '# ====================================================================',
    '',
    `$ServerUrl = "${serverUrl}"`,
    `$MetricsUrl = "$ServerUrl/api/metrics"`,
    `$EventsUrl = "$ServerUrl/api/events"`,
    `$RegKey = "${regKey}"`,
    `$ConfigFile = "$env:ProgramData\\WinServAgent\\config.json"`,
    '',
    'function Get-SystemMetrics {',
    '  $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average',
    '  $os = Get-CimInstance Win32_OperatingSystem',
    '  $memTotal = [math]::Round($os.TotalVisibleMemorySize / 1024, 2)',
    '  $memFree = [math]::Round($os.FreePhysicalMemory / 1024, 2)',
    '  $memUsed = [math]::Round($memTotal - $memFree, 2)',
    '  $disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue',
    '  $diskTotal = 0; $diskUsed = 0; $diskFree = 0',
    '  foreach ($d in $disks) {',
    '    $diskTotal += [math]::Round($d.Size / 1GB, 2)',
    '    $diskFree += [math]::Round($d.FreeSpace / 1GB, 2)',
    '    $diskUsed += [math]::Round(($d.Size - $d.FreeSpace) / 1GB, 2)',
    '  }',
    '  $uptime = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalSeconds, 0)',
    '  return @{ cpu_usage = $cpu; memory_total_mb = $memTotal; memory_used_mb = $memUsed; disk_total_gb = $diskTotal; disk_used_gb = $diskUsed; disk_free_gb = $diskFree; uptime_seconds = $uptime }',
    '}',
    '',
    'function Get-CriticalEvents {',
    '  $since = (Get-Date).AddMinutes(-10)',
    '  $events = Get-WinEvent -FilterHashtable @{LogName=' + "'System'" + ';Level=1,2;StartTime=$since} -MaxEvents 100 -ErrorAction SilentlyContinue',
    '  $result = @()',
    '  foreach ($e in $events) {',
    '    $result += @{source=$e.ProviderName;event_id=$e.Id;level=$e.LevelDisplayName;message=$e.Message.Substring(0,[math]::Min(2000,$e.Message.Length));recorded_at=$e.TimeCreated.ToString(' + "'" + "yyyy-MM-ddTHH:mm:ss" + "'" + ')}',
    '  }',
    '  return $result',
    '}',
    '',
    '# --- Load or register token ---',
    '$Token = $null',
    'if (Test-Path $ConfigFile) {',
    '  try { $config = Get-Content $ConfigFile -Raw | ConvertFrom-Json; $Token = $config.token } catch {}',
    '}',
    '',
    '$osInfo = (Get-CimInstance Win32_OperatingSystem).Caption + " (" + (Get-CimInstance Win32_OperatingSystem).Version + ")"',
    '$ip = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress',
    '$metrics = Get-SystemMetrics | ConvertTo-Json -Compress',
    '',
    'if ($Token) {',
    '  # Use existing token',
    '  $body = @{token=$Token;hostname=$env:COMPUTERNAME;ip_address=$ip;os_info=$osInfo;metrics=$metrics} | ConvertTo-Json -Compress -Depth 4',
    '  try {',
    '    $response = Invoke-RestMethod -Uri $MetricsUrl -Method POST -Body $body -ContentType "application/json" -TimeoutSec 15',
    '    if ($response.token) {',
    '      $Token = $response.token',
    '      $dir = Split-Path $ConfigFile -Parent',
    '      if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }',
    '      @{token=$Token} | ConvertTo-Json | Set-Content $ConfigFile -Force',
    '    }',
    '  } catch {',
    '    if ($_.Exception.Response.StatusCode -eq 401) { $Token = $null }',
    '    else { Write-Warning "Metrics: $_" }',
    '  }',
    '}',
    '',
    'if (-not $Token) {',
    '  # Register new server',
    '  $body = @{registration_key=$RegKey;hostname=$env:COMPUTERNAME;ip_address=$ip;os_info=$osInfo;metrics=$metrics} | ConvertTo-Json -Compress -Depth 4',
    '  try {',
    '    $response = Invoke-RestMethod -Uri $MetricsUrl -Method POST -Body $body -ContentType "application/json" -TimeoutSec 15',
    '    if ($response.token) {',
    '      $Token = $response.token',
    '      $dir = Split-Path $ConfigFile -Parent',
    '      if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }',
    '      @{token=$Token} | ConvertTo-Json | Set-Content $ConfigFile -Force',
    '      Write-Host "Server registered: $($response.server_id)"',
    '    }',
    '  } catch { Write-Warning "Registration: $_" }',
    '}',
    '',
    'if ($Token) {',
    '  $events = Get-CriticalEvents',
    '  if ($events.Count -gt 0) {',
    '    $eventsBody = @{token=$Token;hostname=$env:COMPUTERNAME;events=$events} | ConvertTo-Json -Compress -Depth 5',
    '    try { Invoke-RestMethod -Uri $EventsUrl -Method POST -Body $eventsBody -ContentType "application/json" -TimeoutSec 20 } catch { Write-Warning "Events: $_" }',
    '  }',
    '}',
  ].join('\n');
}

module.exports = router;
