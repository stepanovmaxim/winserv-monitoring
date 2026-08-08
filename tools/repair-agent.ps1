# WinServ Monitoring - local agent repair
#
# Run ON the affected host, in an ELEVATED PowerShell ("Run as administrator").
# Needs only outbound HTTPS to the monitoring server - no SMB, no WinRM, so it
# works when the deployer cannot reach the machine across networks.
#
# It reports what it finds before changing anything, then recreates the
# scheduled task from scratch. That is the part that matters: agent v2.25/v2.26
# re-registered the task with logonType 3 (TASK_LOGON_INTERACTIVE_TOKEN), which
# only starts while somebody is logged on interactively - on a server, never.
# Removing that code from the agent stopped new damage but cannot repair a task
# that is already broken, because the agent no longer runs to repair it.

$Server = 'https://winserv.projectsms.uk'
$Dir    = 'C:\winserv-agent'
$Script = "$Dir\agent.ps1"
$Cfg    = "$env:ProgramData\WinServAgent\config.json"
$Log    = "$env:ProgramData\WinServAgent\agent.log"
$TN     = 'WinServAgent'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }

Say "=== WinServ agent repair ===" 'Cyan'
Say ("host        : " + $env:COMPUTERNAME)
Say ("PowerShell  : " + $PSVersionTable.PSVersion)
if ($PSVersionTable.PSVersion.Major -lt 3) {
  Say "PowerShell 2.0 - the agent needs 3.0 or newer. Install WMF 3.0+ first." 'Red'
}

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Say "NOT elevated - right-click PowerShell and choose 'Run as administrator'." 'Red'
  return
}

try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch {}

# --- 1. what does the machine look like before we touch it -------------------
Say ""
Say "--- current state ---" 'Cyan'
try {
  $svc = New-Object -ComObject Schedule.Service
  $svc.Connect()
  $folder = $svc.GetFolder("\")
  $task = $folder.GetTask($TN)
  $d = $task.Definition
  $lt = $d.Principal.LogonType
  Say ("task        : found, enabled=" + $task.Enabled + " state=" + $task.State)
  Say ("last run    : " + $task.LastRunTime + "  result=" + $task.LastTaskResult)
  Say ("run as      : userId='" + $d.Principal.UserId + "' logonType=" + $lt)
  Say ("time limit  : " + $d.Settings.ExecutionTimeLimit)
  if ($lt -eq 3) {
    Say "  ^ THIS IS THE FAULT: logonType 3 = interactive token. The task can only" 'Yellow'
    Say "    start while a user is logged on, so on a server it stops running." 'Yellow'
  }
} catch {
  Say ("task        : not found or unreadable - " + $_.Exception.Message) 'Yellow'
}
Say ("agent file  : " + $(if (Test-Path $Script) { "present" } else { "MISSING" }))

# --- 2. refresh the agent script --------------------------------------------
Say ""
Say "--- fetching current agent ---" 'Cyan'
$token = $null
if (Test-Path $Cfg) { try { $token = (Get-Content $Cfg -Raw | ConvertFrom-Json).token } catch {} }
if ($token) {
  try {
    if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }
    $req = [Net.HttpWebRequest]::Create("$Server/api/agent/self-update?token=$token")
    $req.Timeout = 30000; $req.ReadWriteTimeout = 30000; $req.Proxy = $null
    $req.UserAgent = "WinServ-Repair"
    $resp = $req.GetResponse()
    $sr = New-Object IO.StreamReader($resp.GetResponseStream())
    $text = $sr.ReadToEnd(); $sr.Close(); $resp.Close()
    if ($text -match 'AgentVersion') {
      [IO.File]::WriteAllText($Script, $text, (New-Object Text.UTF8Encoding($false)))
      $v = [regex]::Match($text, '\$AgentVersion\s*=\s*[''"]([\d.]+)').Groups[1].Value
      Say ("downloaded  : v$v (" + $text.Length + " bytes)") 'Green'
    } else {
      Say "server did not return an agent script - keeping the existing file" 'Yellow'
    }
  } catch {
    Say ("download failed: " + $_.Exception.Message) 'Yellow'
    Say "keeping the existing agent file and continuing with the task repair."
  }
} else {
  Say "no token in config - keeping the existing agent file." 'Yellow'
  if (-not (Test-Path $Script)) {
    Say "and there is no agent file either. Download agent.ps1 from the panel" 'Red'
    Say "(Settings -> agent script) into $Script, then run this again." 'Red'
    return
  }
}

# --- 3. recreate the task from scratch --------------------------------------
Say ""
Say "--- recreating the scheduled task ---" 'Cyan'
$tr = "powershell.exe -ExecutionPolicy Bypass -NonInteractive -File `"$Script`""
schtasks /end /tn $TN 2>&1 | Out-Null
schtasks /delete /tn $TN /f 2>&1 | Out-Null
$o = schtasks /create /tn $TN /ru SYSTEM /rl HIGHEST /sc minute /mo 1 /tr $tr /f 2>&1
if ($LASTEXITCODE -ne 0) {
  $o = schtasks /create /tn $TN /ru SYSTEM /sc minute /mo 1 /tr $tr /f 2>&1
  if ($LASTEXITCODE -ne 0) {
    Say ("FAILED to create the task: " + (($o | Out-String) -replace '\s+', ' ').Trim()) 'Red'
    return
  }
  Say "created without /rl HIGHEST (older schtasks)" 'Yellow'
}
Say "task recreated as SYSTEM" 'Green'

# --- 4. cap a single run ----------------------------------------------------
# schtasks defaults to 72 hours, and Task Scheduler will not start a second
# instance while one is running: one wedged run then blocks every later tick
# for three days and the host reads OFFLINE while perfectly healthy.
try {
  $svc = New-Object -ComObject Schedule.Service; $svc.Connect()
  $folder = $svc.GetFolder("\")
  $t = $folder.GetTask($TN)
  $orig = $t.Xml
  $def = $t.Definition
  $def.Settings.ExecutionTimeLimit = "PT5M"
  # 4 = TASK_UPDATE, 5 = TASK_LOGON_SERVICE_ACCOUNT (3 is INTERACTIVE_TOKEN and
  # is what broke these hosts in the first place)
  [void]$folder.RegisterTaskDefinition($TN, $def, 4, "SYSTEM", $null, 5)
  $chk = $folder.GetTask($TN)
  $cd = $chk.Definition
  if ($cd.Settings.ExecutionTimeLimit -eq "PT5M" -and $cd.Principal.LogonType -eq 5 -and $chk.Enabled -and $cd.Triggers.Count -ge 1) {
    Say "run time limit set to 5 minutes (logonType 5, verified)" 'Green'
  } else {
    [void]$folder.RegisterTask($TN, $orig, 4, "SYSTEM", $null, 5, $null)
    Say "limit rolled back - task restored to the working definition" 'Yellow'
  }
} catch {
  Say ("limit not set (not fatal): " + $_.Exception.Message) 'Yellow'
}

# --- 5. run it once and show what actually happens ---------------------------
Say ""
Say "--- test run (as SYSTEM, real conditions) ---" 'Cyan'
$before = if (Test-Path $Log) { (Get-Item $Log).Length } else { 0 }
schtasks /run /tn $TN 2>&1 | Out-Null
Start-Sleep -Seconds 45
if (Test-Path $Log) {
  $lines = Get-Content $Log
  $new = @($lines | Select-Object -Last 25)
  Say "last log lines:"
  $new | ForEach-Object { Say ("  " + $_) }
  if ((Get-Item $Log).Length -le $before) {
    Say "the log did not grow - the task did not actually run." 'Red'
  }
} else {
  Say "no agent log was written - the task did not run at all." 'Red'
}

Say ""
Say "Done. The host should appear in the panel within a minute or two." 'Cyan'
Say "If it does not, copy everything above - the log lines say why."
