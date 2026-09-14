@echo off
REM Startup wrapper for getcfg.ps1 - use this from GPO instead of pointing the
REM policy at the .ps1 directly.
REM
REM Why: a Computer > Startup "PowerShell Scripts" entry runs powershell.exe
REM WITHOUT -ExecutionPolicy Bypass, so on a client whose machine policy is the
REM default Restricted, the .ps1 never runs and nothing appears - no error, no
REM file. Launching it through this .cmd forces Bypass and pins the domain path.
REM
REM GPO: Computer Configuration > Policies > Windows Settings > Scripts >
REM      Startup > tab "Scripts" (NOT "PowerShell Scripts") > Add:
REM        Script Name: \\inroel.ru\NETLOGON\getcfg-startup.cmd
REM Adjust the domain and the drop share below to your environment.

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "\\inroel.ru\NETLOGON\getcfg.ps1" -DropShare "\\DC01\winserv-inv$"
exit /b 0
