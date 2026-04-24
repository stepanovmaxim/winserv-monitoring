# WinServ Monitoring Agent v1.0
# ====================================================================
# Windows Server monitoring agent. Collects CPU, RAM, disk, and system
# event log errors, then sends them to the central monitoring server.
#
# CONFIGURATION (only two settings needed):
#   $ServerUrl - URL of your WinServ Monitoring backend (e.g. https://your-app.onrender.com)
#   $Token     - Unique token for this server (get it from the dashboard)
#
# SCHEDULED TASK SETUP (run as Administrator):
#   schtasks /create /tn "WinServAgent" /tr "powershell.exe -ExecutionPolicy Bypass -File C:\winserv-agent\agent.ps1" /sc minute /mo 5 /ru SYSTEM
# ====================================================================

param(
    [string]$ServerUrl = $env:WINSERV_SERVER_URL,
    [string]$Token = $env:WINSERV_TOKEN
)

if (-not $ServerUrl -or -not $Token) {
    Write-Error "ServerUrl and Token must be configured."
    Write-Error "Edit this script or set environment variables:"
    Write-Error '  $env:WINSERV_SERVER_URL = "https://your-backend.onrender.com"'
    Write-Error '  $env:WINSERV_TOKEN = "your-server-token"'
    exit 1
}

$serverUrl = $ServerUrl.TrimEnd('/')
$MetricsUrl = "$serverUrl/api/metrics"
$EventsUrl = "$serverUrl/api/events"

# --- Collect CPU, RAM, Disk metrics ---
function Get-SystemMetrics {
    try {
        $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average

        $os = Get-CimInstance Win32_OperatingSystem
        $memTotal = [math]::Round($os.TotalVisibleMemorySize / 1024, 2)
        $memFree = [math]::Round($os.FreePhysicalMemory / 1024, 2)
        $memUsed = [math]::Round($memTotal - $memFree, 2)

        $disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue
        $diskTotal = 0
        $diskUsed = 0
        $diskFree = 0
        foreach ($d in $disks) {
            $diskTotal += [math]::Round($d.Size / 1GB, 2)
            $diskFree += [math]::Round($d.FreeSpace / 1GB, 2)
            $diskUsed += [math]::Round(($d.Size - $d.FreeSpace) / 1GB, 2)
        }

        $uptime = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalSeconds, 0)

        return @{
            cpu_usage        = $cpu
            memory_total_mb  = $memTotal
            memory_used_mb   = $memUsed
            disk_total_gb    = $diskTotal
            disk_used_gb     = $diskUsed
            disk_free_gb     = $diskFree
            uptime_seconds   = $uptime
        }
    } catch {
        Write-Warning "Failed to collect metrics: $_"
        return $null
    }
}

# --- Collect recent Critical and Error system events ---
function Get-CriticalEvents {
    try {
        $since = (Get-Date).AddMinutes(-10)

        $events = Get-WinEvent -FilterHashtable @{
            LogName   = 'System'
            Level     = 1, 2
            StartTime = $since
        } -MaxEvents 100 -ErrorAction SilentlyContinue

        if (-not $events) { return @() }

        $result = @()
        foreach ($e in $events) {
            $result += @{
                source      = $e.ProviderName
                event_id    = $e.Id
                level       = if ($e.LevelDisplayName -match 'Critical|Error|Warning') { $e.LevelDisplayName } else { 'Error' }
                message     = if ($e.Message.Length -gt 2000) { $e.Message.Substring(0, 2000) } else { $e.Message }
                recorded_at = $e.TimeCreated.ToString('yyyy-MM-ddTHH:mm:ss')
            }
        }
        return $result
    } catch {
        Write-Warning "Failed to collect events: $_"
        return @()
    }
}

# --- Get OS info ---
function Get-OSInfo {
    try {
        $os = Get-CimInstance Win32_OperatingSystem
        return "$($os.Caption) ($($os.Version))"
    } catch {
        return "Windows (unknown version)"
    }
}

# --- Send metrics to server ---
function Send-Metrics {
    $metrics = Get-SystemMetrics
    if (-not $metrics) { return }

    $body = @{
        token    = $Token
        hostname = $env:COMPUTERNAME
        ip_address = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
        os_info  = Get-OSInfo
        metrics  = $metrics
    } | ConvertTo-Json -Compress -Depth 4

    try {
        $response = Invoke-RestMethod -Uri $MetricsUrl -Method POST -Body $body -ContentType "application/json" -TimeoutSec 15
        Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Metrics sent successfully"
    } catch {
        Write-Warning "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Failed to send metrics: $_"
    }
}

# --- Send events to server ---
function Send-Events {
    $events = Get-CriticalEvents
    if ($events.Count -eq 0) { return }

    $body = @{
        token    = $Token
        hostname = $env:COMPUTERNAME
        events   = $events
    } | ConvertTo-Json -Compress -Depth 5

    try {
        $response = Invoke-RestMethod -Uri $EventsUrl -Method POST -Body $body -ContentType "application/json" -TimeoutSec 20
        Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $($events.Count) events sent"
    } catch {
        Write-Warning "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Failed to send events: $_"
    }
}

# --- Main ---
Send-Metrics
Send-Events
