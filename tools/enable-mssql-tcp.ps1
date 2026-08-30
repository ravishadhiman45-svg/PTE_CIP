# Enables SQL Server's TCP/IP protocol on port 1433 and restarts the service.
#
# MUST be run as Administrator: it writes under HKLM and restarts a service.
#
# Why this is needed: the node driver (mssql/tedious) speaks ONLY TCP. It cannot
# use Shared Memory or Named Pipes, which are the protocols a default SQL Server
# install leaves enabled. Port 1434 on this machine is the Dedicated Admin
# Connection (sysadmin-only, single connection) and is not usable by an
# application, so the normal TCP endpoint has to be turned on.
#
# Usage (from an elevated PowerShell):
#   powershell -ExecutionPolicy Bypass -File tools\enable-mssql-tcp.ps1

#Requires -RunAsAdministrator

$ErrorActionPreference = 'Stop'

# Find the instance key rather than hardcoding MSSQL16 — this also works on a
# machine running a different SQL Server version.
$base = 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server'
$instances = @(Get-ChildItem $base | Where-Object { $_.PSChildName -match '^MSSQL\d+\.' })

if ($instances.Count -eq 0) {
    Write-Error 'No SQL Server instance found under HKLM. Is SQL Server installed?'
}

foreach ($inst in $instances) {
    $name = $inst.PSChildName
    Write-Host "Instance: $name"

    $tcp = Join-Path $inst.PSPath 'MSSQLServer\SuperSocketNetLib\Tcp'
    if (-not (Test-Path $tcp)) {
        Write-Warning "  no TCP key; skipping"
        continue
    }

    # 1. Turn the protocol on.
    Set-ItemProperty -Path $tcp -Name 'Enabled' -Value 1 -Type DWord
    Write-Host '  TCP/IP protocol: enabled'

    # 2. Pin IPAll to 1433 and clear the dynamic port. Both matter: with a
    #    dynamic port set, SQL Server picks a new port on every restart and the
    #    connection string would break each time.
    $ipAll = Join-Path $tcp 'IPAll'
    Set-ItemProperty -Path $ipAll -Name 'TcpPort' -Value '1433' -Type String
    Set-ItemProperty -Path $ipAll -Name 'TcpDynamicPorts' -Value '' -Type String
    Write-Host '  IPAll: static port 1433, dynamic ports cleared'
}

# 3. Restart, because the protocol settings are only read at startup.
$svc = Get-Service -Name 'MSSQLSERVER' -ErrorAction SilentlyContinue
if (-not $svc) {
    $svc = Get-Service | Where-Object { $_.Name -like 'MSSQL$*' } | Select-Object -First 1
}
if (-not $svc) { Write-Error 'Could not find the SQL Server service to restart.' }

Write-Host "Restarting $($svc.Name)..."
Restart-Service -Name $svc.Name -Force
Write-Host "  $($svc.Name) is now $((Get-Service $svc.Name).Status)"

# 4. Confirm something is actually listening, so this script proves its own work
#    rather than leaving you to discover a silent failure later.
Start-Sleep -Seconds 3
$listening = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
             Where-Object { $_.LocalPort -eq 1433 }

if ($listening) {
    Write-Host ''
    Write-Host 'SUCCESS: SQL Server is listening on TCP 1433.' -ForegroundColor Green
    $listening | Select-Object LocalAddress, LocalPort | Format-Table -AutoSize
} else {
    Write-Warning 'Nothing is listening on 1433 yet. Give the service a few more seconds, then check:'
    Write-Warning '  Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 1433'
}
