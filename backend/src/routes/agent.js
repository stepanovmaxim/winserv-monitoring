const express = require('express');
const path = require('path');
const fs = require('fs');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const db = require('../db');

const router = express.Router();

const agentScriptTemplate = (serverUrl, token) => `# WinServ Monitoring Agent v1.0
# Configure the server URL and token
$ServerUrl = "${serverUrl}"
$MetricsUrl = "$ServerUrl/api/metrics"
$EventsUrl = "$ServerUrl/api/events"
$Token = "${token}"

function Get-SystemMetrics {
  $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
  $os = Get-CimInstance Win32_OperatingSystem
  $memTotal = [math]::Round($os.TotalVisibleMemorySize / 1024, 2)
  $memFree = [math]::Round($os.FreePhysicalMemory / 1024, 2)
  $memUsed = [math]::Round($memTotal - $memFree, 2)
  $disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue
  $diskTotal = 0; $diskUsed = 0; $diskFree = 0
  foreach ($d in $disks) {
    $diskTotal += [math]::Round($d.Size / 1GB, 2)
    $diskFree += [math]::Round($d.FreeSpace / 1GB, 2)
    $diskUsed += [math]::Round(($d.Size - $d.FreeSpace) / 1GB, 2)
  }
  $uptime = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalSeconds, 0)
  return @{
    cpu_usage = $cpu; memory_total_mb = $memTotal; memory_used_mb = $memUsed
    disk_total_gb = $diskTotal; disk_used_gb = $diskUsed; disk_free_gb = $diskFree
    uptime_seconds = $uptime
  }
}

function Get-CriticalEvents {
  $since = (Get-Date).AddMinutes(-10)
  $events = Get-WinEvent -FilterHashtable @{LogName='System';Level=1,2;StartTime=$since} -MaxEvents 100 -ErrorAction SilentlyContinue
  $result = @()
  foreach ($e in $events) {
    $result += @{source=$e.ProviderName;event_id=$e.Id;level=$e.LevelDisplayName;message=$e.Message.Substring(0,[math]::Min(2000,$e.Message.Length));recorded_at=$e.TimeCreated.ToString('yyyy-MM-ddTHH:mm:ss')}
  }
  return $result
}

$osInfo = (Get-CimInstance Win32_OperatingSystem).Caption + " (" + (Get-CimInstance Win32_OperatingSystem).Version + ")"
$ip = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress

$metrics = Get-SystemMetrics | ConvertTo-Json -Compress
$body = @{token=$Token;hostname=$env:COMPUTERNAME;ip_address=$ip;os_info=$osInfo;metrics=$metrics} | ConvertTo-Json -Compress -Depth 4
try { Invoke-RestMethod -Uri $MetricsUrl -Method POST -Body $body -ContentType "application/json" -TimeoutSec 15 } catch { Write-Warning "Metrics: $_" }

$events = Get-CriticalEvents
if ($events.Count -gt 0) {
  $eventsBody = @{token=$Token;hostname=$env:COMPUTERNAME;events=$events} | ConvertTo-Json -Compress -Depth 5
  try { Invoke-RestMethod -Uri $EventsUrl -Method POST -Body $eventsBody -ContentType "application/json" -TimeoutSec 20 } catch { Write-Warning "Events: $_" }
}
`;

router.get('/script', requireAuth, requireAdmin, async (req, res) => {
  res.type('text/plain');
  const instructions = [
    '# ====================================================================',
    '# WinServ Monitoring Agent - Installation Instructions',
    '# ====================================================================',
    '# 1. Open PowerShell as Administrator',
    '# 2. Copy this script to the target server (e.g., C:\\winserv-agent\\agent.ps1)',
    '# 3. The script is pre-configured with server URL and unique token',
    '# 4. Set up Task Scheduler to run every 5-10 minutes:',
    '#    schtasks /create /tn "WinServAgent" /tr "powershell.exe -ExecutionPolicy Bypass -File C:\\winserv-agent\\agent.ps1" /sc minute /mo 5 /ru SYSTEM',
    '# ====================================================================',
    ''
  ].join('\n');

  const servers = await db.queryAll('SELECT * FROM servers ORDER BY hostname');
  let scripts = instructions;

  for (const server of servers) {
    const tokenRecord = await db.queryOne('SELECT token FROM agent_tokens WHERE server_id = $1', [server.id]);
    const token = tokenRecord?.token || 'REPLACE_WITH_SERVER_TOKEN';
    const serverUrl = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
    scripts += `\n# ===== Agent for: ${server.hostname} =====\n`;
    scripts += agentScriptTemplate(serverUrl, token);
    scripts += '\n';
  }

  res.send(scripts);
});

router.get('/script/:serverId', requireAuth, requireAdmin, async (req, res) => {
  const server = await db.queryOne('SELECT * FROM servers WHERE id = $1', [req.params.id]);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  const tokenRecord = await db.queryOne('SELECT token FROM agent_tokens WHERE server_id = $1', [server.id]);
  const token = tokenRecord?.token || 'REPLACE_WITH_SERVER_TOKEN';
  const serverUrl = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

  const header = [
    '# ====================================================================',
    `# WinServ Monitoring Agent for: ${server.hostname}`,
    '# ====================================================================',
    '# Installation:',
    '# 1. Run PowerShell as Administrator',
    '# 2. Save this script to C:\\winserv-agent\\agent.ps1',
    '# 3. Create scheduled task:',
    '#    schtasks /create /tn "WinServAgent" /tr "powershell.exe -ExecutionPolicy Bypass -File C:\\winserv-agent\\agent.ps1" /sc minute /mo 5 /ru SYSTEM',
    '# ====================================================================',
    ''
  ].join('\n');

  res.type('text/plain');
  res.send(header + agentScriptTemplate(serverUrl, token));
});

module.exports = router;
