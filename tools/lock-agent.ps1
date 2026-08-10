# WinServ Monitoring - lock the agent to SYSTEM, with a self-test and auto-revert
#
# Run ON a host, in an ELEVATED PowerShell ("Run as administrator").
#
# Makes C:\winserv-agent readable only by SYSTEM, so an ordinary user - or an
# administrator who merely opens the file - is denied. An administrator can
# still take ownership and read it (inherent to Windows); combined with the
# comment-free agent, that is the realistic maximum for a file on a machine the
# customer controls.
#
# WHY THIS EXISTS AS A SEPARATE, SELF-TESTING SCRIPT rather than being applied by
# the deployer automatically: a SYSTEM-only file lock is extremely sensitive to
# icacls ordering, caller privilege and how Windows recomputes inheritance, and
# the exact same intent bricked this fleet twice. The one reliable way to know a
# lock is safe is to apply it on the real host and check the agent STILL RUNS.
# So this script locks, triggers a run, reads the agent log (which lives in
# %ProgramData% and is deliberately NOT locked), and if the agent did not run
# under the lock it REVERTS automatically. The worst case is an unchanged host.
#
# Test it on ONE host first. Confirm "LOCK CONFIRMED" and that the host keeps
# reporting in the panel, before locking more.

param(
  [string]$Dir = 'C:\winserv-agent'
)

$Task = 'WinServAgent'
$Log  = "$env:ProgramData\WinServAgent\agent.log"
$Script = Join-Path $Dir 'agent.ps1'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }

Say '=== WinServ agent lock (self-testing) ===' 'Cyan'
Say ("host: $env:COMPUTERNAME  dir: $Dir")

# --- must be elevated -------------------------------------------------------
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Say 'NOT elevated - right-click PowerShell and choose "Run as administrator".' 'Red'
  return
}
if (-not (Test-Path $Script)) { Say "No agent at $Script - install it first." 'Red'; return }
if (-not (Test-Path $Log)) { Say "No agent log at $Log - let the agent run once first, then re-run this." 'Red'; return }

# --- capture how far along the log is, so we can detect a fresh run ----------
function Log-Len { try { (Get-Item $Log -ErrorAction Stop).Length } catch { 0 } }
$before = Log-Len

# --- current DACL, for the record and for revert ----------------------------
Say ''
Say '--- current permissions ---' 'Cyan'
& icacls $Dir 2>&1 | Select-Object -First 6 | ForEach-Object { Say "  $_" }

# --- apply the lock ---------------------------------------------------------
# Order matters. Grant SYSTEM onto existing files BEFORE stripping inheritance:
# once inheritance is off, a non-SYSTEM caller can lose the access needed to
# modify child files, so the grant must land while it still has that access.
# (OI)(CI) makes future files (self-update writes new ones) inherit SYSTEM; the
# plain grant lands SYSTEM on files that already exist.
Say ''
Say '--- applying SYSTEM-only lock ---' 'Cyan'
& icacls $Dir /grant '*S-1-5-18:(OI)(CI)(F)' /t /c 2>&1 | Out-Null
& icacls $Dir /grant '*S-1-5-18:(F)' /t /c 2>&1 | Out-Null
& icacls $Dir /inheritance:r /t /c 2>&1 | Out-Null
# Remove every non-SYSTEM principal by well-known SID (names are localised):
# Administrators, Users, Everyone, Authenticated Users.
& icacls $Dir /remove:g '*S-1-5-32-544' '*S-1-5-32-545' '*S-1-1-0' '*S-1-5-11' /t /c 2>&1 | Out-Null
Say 'lock applied - now testing whether the agent still runs as SYSTEM' 'Yellow'

# --- the real test: can the SYSTEM task still launch the locked script? ------
# End any in-progress run, trigger a fresh one, and watch the log grow. The log
# is written by the agent (as SYSTEM) into %ProgramData% (not locked), so if it
# grows with a completed run, SYSTEM could read and execute the locked script.
& schtasks /end /tn $Task 2>&1 | Out-Null
Start-Sleep -Seconds 1
& schtasks /run /tn $Task 2>&1 | Out-Null

$ran = $false
foreach ($i in 1..18) {   # up to ~90s
  Start-Sleep -Seconds 5
  if ((Log-Len) -gt $before) {
    $tail = Get-Content $Log -Tail 12 -ErrorAction SilentlyContinue
    if ($tail -match 'completed successfully') { $ran = $true; break }
  }
}

Say ''
if ($ran) {
  Say '=== LOCK CONFIRMED ===' 'Green'
  Say 'The agent ran to completion under the lock, so SYSTEM can still read and'
  Say 'launch it. C:\winserv-agent is now readable only by SYSTEM.'
  Say ''
  Say 'Verify in the panel that this host keeps reporting, then lock other hosts.'
  Say 'To read the agent later you (an admin) must take ownership first:'
  Say '  takeown /f C:\winserv-agent /r /d Y   then   icacls C:\winserv-agent /reset /t'
} else {
  Say '=== SELF-TEST FAILED - REVERTING ===' 'Red'
  Say 'The agent did NOT complete a run under the lock within 90s. Rather than'
  Say 'leave the host broken, the lock is being removed now.'
  & takeown /f $Dir /r /d Y /a 2>&1 | Out-Null
  & icacls $Dir /reset /t /c 2>&1 | Out-Null
  & icacls $Dir /grant '*S-1-5-18:(OI)(CI)(F)' /t /c 2>&1 | Out-Null
  & schtasks /end /tn $Task 2>&1 | Out-Null
  Start-Sleep -Seconds 1
  & schtasks /run /tn $Task 2>&1 | Out-Null
  Start-Sleep -Seconds 20
  if ((Log-Len) -gt $before) { Say 'Revert OK - the agent is running again, directory left unlocked.' 'Yellow' }
  else { Say 'Revert done but no fresh run yet - check the host; the deployer can reinstall it.' 'Red' }
  Say ''
  Say 'Please send me the last ~30 lines of the agent log so I can see why SYSTEM'
  Say "could not run the locked script:  Get-Content '$Log' -Tail 30"
}
