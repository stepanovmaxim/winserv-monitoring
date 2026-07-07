# Build winserv-deployer.exe from the deployer PowerShell script using ps2exe.
# ====================================================================
# Usage (on Windows with Internet access):
#   1) In the panel -> Deploy, download the deployer as winserv-deployer.ps1
#      (or save the output of GET /api/deploy/script).
#   2) Run:  powershell -ExecutionPolicy Bypass -File .\build-deployer-exe.ps1
#   3) Ship winserv-deployer.exe. It self-elevates (UAC) and runs the same
#      interactive deployer as the .ps1 — no execution-policy hassle.
# ====================================================================
param(
  [string]$In = ".\winserv-deployer.ps1",
  [string]$Out = ".\winserv-deployer.exe"
)

if (-not (Test-Path $In)) {
  Write-Error "Input not found: $In. Save the deployer script from the panel (Deploy page) first."
  exit 1
}

if (-not (Get-Module -ListAvailable -Name ps2exe)) {
  Write-Host "Installing ps2exe from PSGallery (current user)..." -ForegroundColor Yellow
  try { Install-Module ps2exe -Scope CurrentUser -Force -ErrorAction Stop }
  catch { Write-Error "Could not install ps2exe: $_"; exit 1 }
}
Import-Module ps2exe

# Interactive tool -> keep the console; requireAdmin adds a UAC manifest.
Invoke-ps2exe -inputFile $In -outputFile $Out -requireAdmin -title "WinServ Deployer" -company "WinServ Monitoring" -noConsole:$false

if (Test-Path $Out) { Write-Host "Built $Out" -ForegroundColor Green }
else { Write-Error "Build failed." }
