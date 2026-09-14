<#
  getcfg.ps1 - domain PC inventory collector for WinServ Monitoring.

  Runs on every workstation from a Group Policy script and writes ONE JSON file
  describing the machine into an SMB drop share. A relay host (any domain machine
  running the WinServ agent) picks the files up and forwards them to the panel;
  the workstation itself never needs internet access.

  DEPLOY (see tools/GETCFG-DEPLOY.md for the full walk-through):
    1. Create a share, e.g. \\FS01\winserv-inv$  (hidden). Grant:
         - "Domain Computers"  Change  (if you run this as a STARTUP script / SYSTEM)
         - "Domain Users"       Change  (if you run it as a LOGON script / the user)
       NTFS: same principals, Modify. Deny listing to normal users if you like -
       the script only ever creates/replaces its own file.
    2. Set $DropShare below (or pass -DropShare) to that UNC path.
    3. GPO: Computer (startup) is preferred - runs as SYSTEM, so SMART/hardware
       is fully readable. Logon is fine too and captures the real user.
       Computer Config > Policies > Windows Settings > Scripts > Startup >
         Add PowerShell script, point at this file on NETLOGON.

  Read-only. Never changes anything on the PC. Safe to run repeatedly.
#>

param(
  [string]$DropShare = '\\FS01\winserv-inv$'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Off

function TryGet([scriptblock]$b, $default = $null) {
  try { return (& $b) } catch { return $default }
}

# --- identity ---------------------------------------------------------------
# MachineGuid is the stable identity; hostname and serial are attributes. The
# panel keys on the uid so a rename or re-image never duplicates or mismatches.
$uid = TryGet { (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid).MachineGuid } ''
$cs  = TryGet { Get-CimInstance Win32_ComputerSystem }
$bios = TryGet { Get-CimInstance Win32_BIOS }
$os  = TryGet { Get-CimInstance Win32_OperatingSystem }
$cpu = TryGet { Get-CimInstance Win32_Processor | Select-Object -First 1 }
$enc = TryGet { Get-CimInstance Win32_SystemEnclosure | Select-Object -First 1 }

$fqdn = TryGet {
  $d = ([System.Net.Dns]::GetHostEntry('')).HostName
  if ($d) { $d } else { $env:COMPUTERNAME }
} $env:COMPUTERNAME

$chassisMap = @{ 3='Desktop';4='Desktop';5='Desktop';6='Tower';7='Tower';8='Laptop';9='Laptop';10='Laptop';14='Laptop';30='Tablet';31='Laptop';32='Tablet' }
$chassis = ''
if ($enc -and $enc.ChassisTypes) { $chassis = $chassisMap["$($enc.ChassisTypes[0])"]; if (-not $chassis) { $chassis = 'Other' } }

# --- domain / OU / site (best-effort, no RSAT) ------------------------------
$adDomain = TryGet { if ($cs.PartOfDomain) { $cs.Domain } else { '' } } ''
$adOu = TryGet {
  $s = [ADSISEARCHER]"(&(objectCategory=computer)(name=$env:COMPUTERNAME))"
  $s.PageSize = 1
  $r = $s.FindOne()
  if ($r) {
    $dn = $r.Properties['distinguishedname'][0]
    # strip the leading CN=<name>, leaving the OU path
    ($dn -replace '^CN=[^,]+,', '')
  } else { '' }
} ''
$adSite = TryGet { (& nltest /dsgetsite 2>$null | Select-Object -First 1).Trim() } ''

# --- network ----------------------------------------------------------------
$nic = TryGet {
  Get-CimInstance Win32_NetworkAdapterConfiguration |
    Where-Object { $_.IPEnabled -and $_.IPAddress } |
    Select-Object -First 1
}
$ip = ''
if ($nic -and $nic.IPAddress) { $ip = ($nic.IPAddress | Where-Object { $_ -notmatch ':' } | Select-Object -First 1) }
if (-not $ip -and $nic -and $nic.IPAddress) { $ip = $nic.IPAddress[0] }
$mac = TryGet { $nic.MACAddress } ''

# --- current / last user ----------------------------------------------------
# A logon script runs as the user; a startup script as SYSTEM, where the console
# user is on Win32_ComputerSystem.UserName.
$lastUser = ''
if ($env:USERNAME -and $env:USERNAME -ne "$env:COMPUTERNAME`$" -and $env:USERNAME -notmatch '^(SYSTEM|.*\$)$') {
  $lastUser = "$env:USERDOMAIN\$env:USERNAME"
} else {
  $lastUser = TryGet { $cs.UserName } ''
}

# --- disks: size, free, media, SMART health ---------------------------------
$disks = @()
$logical = TryGet { Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' } @()
$phys = TryGet { Get-CimInstance -Namespace root\Microsoft\Windows\Storage -ClassName MSFT_PhysicalDisk } @()
foreach ($d in $logical) {
  $disks += [pscustomobject]@{
    model   = $d.DeviceID
    size_gb = [math]::Round($d.Size / 1GB, 1)
    free_gb = [math]::Round($d.FreeSpace / 1GB, 1)
    media   = 'Volume'
    health  = ''
  }
}
foreach ($p in $phys) {
  $media = switch ("$($p.MediaType)") { '3' {'HDD'} '4' {'SSD'} '5' {'SCM'} default {'Disk'} }
  $health = switch ("$($p.HealthStatus)") { '0' {'Healthy'} '1' {'Warning'} '2' {'Unhealthy'} default {'' } }
  $disks += [pscustomobject]@{
    model   = "$($p.FriendlyName)".Trim()
    size_gb = [math]::Round($p.Size / 1GB, 1)
    free_gb = 0
    media   = $media
    health  = $health
  }
}

# --- monitors: model + serial (from EDID) -----------------------------------
$monitors = @()
$mons = TryGet { Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID } @()
foreach ($m in $mons) {
  $decode = { param($arr) if ($arr) { (-join ($arr | Where-Object { $_ -gt 0 } | ForEach-Object { [char]$_ })).Trim() } else { '' } }
  $monitors += [pscustomobject]@{
    manufacturer = (& $decode $m.ManufacturerName)
    model        = (& $decode $m.UserFriendlyName)
    serial       = (& $decode $m.SerialNumberID)
  }
}

# --- installed software (both registry views) -------------------------------
$software = @()
$paths = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$seen = @{}
foreach ($path in $paths) {
  $items = TryGet { Get-ItemProperty $path } @()
  foreach ($it in $items) {
    $name = "$($it.DisplayName)".Trim()
    if (-not $name) { continue }
    if ($it.SystemComponent -eq 1) { continue }
    $key = "$name|$($it.DisplayVersion)"
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    $rawDate = "$($it.InstallDate)"
    $instOn = if ($rawDate -match '^(\d{4})(\d{2})(\d{2})$') { "$($matches[1])-$($matches[2])-$($matches[3])" } else { '' }
    $software += [pscustomobject]@{
      name = $name; version = "$($it.DisplayVersion)".Trim()
      publisher = "$($it.Publisher)".Trim(); installed_on = $instOn
    }
  }
}

# --- patches ----------------------------------------------------------------
$hotfixes = @()
$hf = TryGet { Get-CimInstance Win32_QuickFixEngineering | Where-Object { $_.HotFixID -match 'KB' } } @()
foreach ($h in $hf) {
  $d = ''
  if ($h.InstalledOn) { try { $d = (Get-Date $h.InstalledOn -Format 'yyyy-MM-dd') } catch {} }
  $hotfixes += [pscustomobject]@{ id = $h.HotFixID; installed_on = $d }
}
$lastPatch = ''
if ($hotfixes.Count) {
  $dates = $hotfixes | Where-Object { $_.installed_on } | Sort-Object installed_on
  if ($dates) { $lastPatch = $dates[-1].installed_on }
}

$lastBoot = ''
if ($os -and $os.LastBootUpTime) { try { $lastBoot = (Get-Date $os.LastBootUpTime).ToString('o') } catch {} }

# --- assemble ---------------------------------------------------------------
$payload = [pscustomobject]@{
  uid          = "$uid"
  hostname     = "$fqdn"
  serial       = "$($bios.SerialNumber)".Trim()
  ad_domain    = "$adDomain"
  ad_ou        = "$adOu"
  ad_site      = "$adSite"
  manufacturer = "$($cs.Manufacturer)".Trim()
  model        = "$($cs.Model)".Trim()
  chassis      = "$chassis"
  os_caption   = "$($os.Caption)".Trim()
  os_version   = "$($os.Version)"
  os_build     = "$($os.BuildNumber)"
  cpu          = "$($cpu.Name)".Trim()
  cpu_cores    = [int]$cpu.NumberOfCores
  cpu_logical  = [int]$cpu.NumberOfLogicalProcessors
  ram_gb       = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
  ip           = "$ip"
  mac          = "$mac"
  last_user    = "$lastUser"
  last_boot    = "$lastBoot"
  last_patch_date = "$lastPatch"
  disks        = $disks
  monitors     = $monitors
  hotfixes     = $hotfixes
  software     = $software
  collected_at = (Get-Date).ToString('o')
}

$json = $payload | ConvertTo-Json -Depth 6 -Compress

# --- write to the drop share, atomically ------------------------------------
# File is named by uid (falls back to hostname) so re-runs replace, not pile up.
$fileBase = if ($uid) { $uid } else { $env:COMPUTERNAME }
$fileBase = ($fileBase -replace '[^A-Za-z0-9._-]', '_')
$dest = Join-Path $DropShare ($fileBase + '.json')
$tmp  = Join-Path $DropShare ($fileBase + '.' + [System.Guid]::NewGuid().ToString('N') + '.tmp')

try {
  # UTF-8 without BOM, so the relay/JSON parser reads it cleanly.
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($tmp, $json, $utf8)
  # Move is atomic within a share; overwrite any previous file for this machine.
  if (Test-Path $dest) { Remove-Item $dest -Force -ErrorAction SilentlyContinue }
  [System.IO.File]::Move($tmp, $dest)
} catch {
  # Startup-context failures are silent by design (no user to see them); leave a
  # trace in the local event log for troubleshooting without failing the GPO.
  try { Remove-Item $tmp -Force -ErrorAction SilentlyContinue } catch {}
  try {
    if (-not [System.Diagnostics.EventLog]::SourceExists('WinServGetCfg')) {
      New-EventLog -LogName Application -Source 'WinServGetCfg' -ErrorAction SilentlyContinue
    }
    Write-EventLog -LogName Application -Source 'WinServGetCfg' -EntryType Warning -EventId 1 -Message "getcfg could not write to $dest : $($_.Exception.Message)" -ErrorAction SilentlyContinue
  } catch {}
  exit 0
}
