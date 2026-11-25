#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Start', 'Setup', 'Stop', 'Diagnose')][string]$Action = 'Start',
    [switch]$NonInteractive,
    [switch]$NoBrowser,
    [switch]$Demo,
    [switch]$DemoRetry,
    [switch]$OneClickDemo,
    [switch]$Harbourline,
    [switch]$HarbourlineTextOnly
)

. "$PSScriptRoot/Common.ps1"
. "$PSScriptRoot/Setup-Environment.ps1"
. "$PSScriptRoot/Backend.ps1"
. "$PSScriptRoot/Frontend.ps1"
. "$PSScriptRoot/Demo.ps1"
. "$PSScriptRoot/Harbourline.ps1"
Set-LauncherMode -Demo:$Demo

function Assert-OwnedDocker {
    if (!(Confirm-DockerOwnership)) {
        Stop-WithError 'CFG-003' 'Docker Project Ownership Could Not Be Verified' 'The launcher could not verify all Docker resources for its project.' `
            'A resource may already use the project name or the Engine may have lost access.' `
            @('Keep the existing containers and volumes.', 'Run Diagnose-Platform.bat and ask a teammate to check the saved launcher identity.')
    }
}

function Assert-LauncherPorts {
    Assert-PortAvailable $Config.FRONTEND_PORT 'NET-002' 'Frontend' -Owned:(Test-BackendPort frontend 8080 $Config.FRONTEND_PORT)
    Assert-PortAvailable $Config.API_PORT 'NET-001' 'API' -Owned:(Test-BackendPort api 8000 $Config.API_PORT)
    Assert-PortAvailable $Config.POSTGRES_PORT 'NET-003' 'PostgreSQL' -Owned:(Test-BackendPort postgres 5432 $Config.POSTGRES_PORT)
    Write-Step '[PASS] Configured ports are available or owned by this launcher.'
}

function Start-Platform {
    Write-Step '[1/7] Checking system requirements...'
    $system = Get-SystemFacts
    if ($system.Build -lt 22000 -or $system.Architecture -ne 'AMD64') {
        Stop-WithError 'ENV-001' 'Windows 11 x64 Is Required' 'This launcher targets Windows 11 on x64.' 'The OS build or CPU architecture was unsupported.' `
            @('Use a supported Windows 11 x64 computer.')
    }
    Write-Step '[PASS] 64-bit Windows 11 detected.'
    if ($system.FreeGB -lt 1 -or $system.DockerGB -lt 1) {
        Stop-WithError 'ENV-002' 'Disk Space Is Low' 'Less than 1 GB is available on a required drive.' 'Setup and container startup need writable disk space.' `
            @('Free disk space without removing project data and try again.')
    }
    if ($system.FreeGB -lt 5 -or $system.DockerGB -lt 10) {
        Write-Step '[WARN] Free space is limited. Installing packages and Docker images may require more space.'
    }
    if ($system.RAM -and $system.RAM -lt 7GB) {
        Write-Step '[WARN] Installed RAM is below the approximately 8 GB target. Builds may fail or run slowly.'
    }
    $script:WSL = Get-WSLStatus
    $script:Docker = Initialize-Docker $system
    Write-Step '[2/7] Checking project dependencies...'
    if ($DemoMode) { Assert-DemoFixtureFiles }
    Write-Step '[3/7] Loading private local configuration...'
    $script:Config = Get-LauncherConfig -Create -AutoDemoNetwork:$DemoMode
    if ($Harbourline) { Initialize-HarbourlineSettings }
    $compose = Invoke-Compose @('config', '--quiet')
    if ($compose.Code -ne 0) {
        Stop-WithError 'CFG-004' 'Compose Configuration Failed Validation' 'Docker Compose rejected the local configuration.' `
            $compose.Reason @('Check your checkout and supported settings in the Windows setup guide.')
    }
    Assert-OwnedDocker
    if ($Action -eq 'Setup') {
        Write-Step '[PASS] Compose configuration and resource ownership verified.'
        $command = if ($DemoMode) { 'Start-FYP-Demo.bat' } else { 'Start-Platform.bat' }
        Write-Step "[SUCCESS] Setup checks passed. Run $command to launch the application."
        return
    }
    Stop-OwnedFrontend
    Assert-LauncherPorts
    if ($Harbourline) { Initialize-HarbourlineImage }
    else { Update-PlatformImage api }
    Update-PlatformImage frontend
    Write-Step '[4/7] Starting PostgreSQL and Redis...'
    Start-StorageServices
    Write-Step '[5/7] Checking migrations and starting API, dispatcher, and worker...'
    Update-DatabaseSchema
    Start-BackendServices
    Stop-DisabledFixture
    if ($Harbourline) { Invoke-HarbourlineProvisioning }
    elseif ($DemoMode) { Invoke-DemoProvisioning }
    Write-Step '[6/7] Starting the React frontend...'
    Start-ContainerFrontend
    Write-Step '[7/7] Preparing the browser...'
    $url = "http://127.0.0.1:$($Config.FRONTEND_PORT)/"
    if ($Harbourline) { $url += "demo/connected" }
    Write-Step "URL: $url"
    if (!$NoBrowser) { Open-PlatformBrowser $url }
    if ($Harbourline) { Write-Step '[SUCCESS] Harbourline Fictional Demo is ready!' }
    elseif ($DemoMode) { Write-Step '[SUCCESS] Synthetic Demo is ready!' }
    else { Write-Step '[SUCCESS] Platform is ready!' }
}

function Stop-Platform {
    $frontendStopped = $true
    try { Stop-OwnedFrontend }
    catch {
        if (!$_.Exception.Data['LauncherError']) { throw }
        $frontendStopped = $false
    }
    $script:Config = Get-LauncherConfig
    if (!$Config) {
        Write-Step '[PASS] No launcher configuration was found.'
        return
    }
    $script:Docker = Get-DockerTools
    $engine = Get-LinuxEngine $Docker
    if (!(Test-LinuxEngine $engine)) {
        Stop-WithError 'STOP-001' 'Docker Stop Could Not Be Verified' 'The launcher could not reach the Linux Engine to stop its services.' `
            $engine.Reason @('Open Docker Desktop, then run Stop-Platform.bat again.')
    }
    Assert-OwnedDocker
    # Include the optional fixture even if its setting was changed while it was running.
    $Config.LAUNCHER_FIXTURE = '1'
    $result = Invoke-Compose @('stop') 220
    $running = Invoke-Docker @('container', 'ls', '--filter', "label=com.docker.compose.project=$($Config.COMPOSE_PROJECT_NAME)", '--format', '{{.ID}}')
    if ($result.Code -ne 0 -or $running.Code -ne 0 -or $running.Out) {
        Stop-WithError 'STOP-002' 'Docker Services Did Not Fully Stop' 'The launcher could not verify shutdown of its Docker project.' `
            $result.Reason @('Run Diagnose-Platform.bat to inspect the remaining services.', 'Retry Stop-Platform.bat.') 'Graceful shutdown attempted.'
    }
    if (!$frontendStopped) {
        Stop-WithError 'STOP-003' 'Backend Stopped but Frontend Is Still Running' 'Docker services have stopped and the frontend shutdown could not be verified.' `
            'See the frontend shutdown error above.' @('Close the platform tab and retry Stop-Platform.bat.') 'Graceful shutdown attempted.'
    }
    Write-Step '[SUCCESS] Launcher services stopped. All data volumes were kept.'
}

function Invoke-Diagnosis {
    $null = Get-SystemFacts
    $null = Get-WSLStatus
    Write-Step '[INFO] The frontend runs in Docker. Host Node.js and npm are optional developer tools.'
    $script:Docker = Get-DockerTools
    Write-Step "[INFO] Docker Desktop executable found: $([bool]$Docker.Desktop); Docker CLI found: $([bool]$Docker.CLI)."
    $engine = Get-LinuxEngine $Docker
    Write-Step "[INFO] Docker Linux Engine reachable: $(Test-LinuxEngine $engine); result: $($engine.Reason)."
    if ($Docker.CLI) {
        $compose = Invoke-Docker @('compose', 'version', '--short') 10
        if ($compose.Out -match '^v?[\d.]+(?:-[\w.]+)?$') { Write-Step "[INFO] Docker Compose version: $($compose.Out)." }
    }
    try { $script:Config = Get-LauncherConfig -Probe }
    catch { if (!$_.Exception.Data['LauncherError']) { throw } }
    if ($Config) {
        Write-Step "[INFO] Launcher settings valid. API port $($Config.API_PORT), frontend port $($Config.FRONTEND_PORT), PostgreSQL port $($Config.POSTGRES_PORT)."
        if ($DemoMode) { Write-Step "URL: http://127.0.0.1:$($Config.FRONTEND_PORT)/" }
        $state = Get-FrontendState
        Write-Step "[INFO] Previous host frontend detected: $(Test-FrontendProcess $state)."
        if (Test-LinuxEngine $engine) {
            if (Confirm-DockerOwnership) {
                $services = @('postgres', 'redis', 'api', 'dispatcher', 'worker', 'frontend')
                if ($Config.LAUNCHER_FIXTURE -eq '1') { $services += 'collection-fixture' }
                foreach ($service in $services) { $null = Write-ServiceDiagnosis $service }
                Write-Step "[INFO] API health: $(Test-ApiHealth "http://127.0.0.1:$($Config.API_PORT)/api/v1/health")."
                Write-Step "[INFO] Frontend proxy health: $(Test-ApiHealth "http://127.0.0.1:$($Config.FRONTEND_PORT)/api/v1/health")."
                if ($DemoMode) { Write-DemoDiagnosis }
            } else { Write-Step '[WARN] Docker project ownership could not be verified.' }
        }
    } else { Write-Step '[INFO] Valid launcher settings are unavailable.' }
    Write-Step "[SUCCESS] Diagnostic report: $LogFile"
}

if ($MyInvocation.InvocationName -eq '.') { return }

$lock = $null
$exitCode = 1
$logDirectory = Join-Path $Root 'logs/launcher'
if ($DemoMode) { $logDirectory = Join-Path $logDirectory 'demo' }
try {
    $null = New-Item -ItemType Directory -Path $logDirectory -Force
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssfff')
    $script:LogFile = Join-Path $logDirectory "$stamp-$PID.log"
    Write-Step 'Adaptive Web Data Collection Platform | Windows Launcher 1.0'
    $modeLabel = if ($DemoMode) { 'Synthetic Demo' } else { 'Normal' }
    Write-Step "[INFO] $modeLabel mode. Action: $Action."
    if ($DemoRetry -and (!$DemoMode -or $Action -ne 'Start')) {
        Stop-WithError 'DEMO-003' 'Invalid Demo Retry Option' 'The -DemoRetry option requires Start with -Demo.' `
            'A different launcher action or mode was selected.' @('Use Start-Platform.bat -Demo -DemoRetry.')
    }
    if (($Harbourline -and (!$DemoMode -or $Action -ne 'Start')) -or ($HarbourlineTextOnly -and !$Harbourline)) {
        Stop-WithError 'HL-003' 'Invalid Harbourline Demo Option' 'This option is available during an isolated Harbourline Demo start.' `
            'The selected launcher mode does not support it.' @('Use Start-Harbourline-Demo.bat.')
    }
    if ($OneClickDemo -and (!$DemoMode -or $Action -ne 'Start')) {
        Stop-WithError 'DEMO-003' 'Invalid One-Click Demo Option' 'One-click startup requires Start with -Demo.' `
            'A different launcher action or mode was selected.' @('Double-click Start-FYP-Demo.bat.')
    }
    if ($Action -ne 'Diagnose') {
        $null = New-Item -ItemType Directory -Path $Local -Force
        Assert-LocalDirectory
        if ($Action -ne 'Stop' -and !(Test-Path -LiteralPath (Join-Path $Local 'launcher.env'))) {
            try { Protect-LocalDirectory }
            catch {
                Write-LauncherLog ERROR "Local ACL update failed: $($_.Exception.GetType().Name)."
                Stop-WithError 'CFG-002' 'Cannot Protect Local Settings' 'Windows could not restrict access to .local.' `
                    'Windows permissions could not be applied to the folder.' `
                    @('Use a writable local NTFS folder and check that you own the launcher settings directory.')
            }
        }
        try { $lock = [IO.File]::Open((Join-Path $Local 'launcher.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
        catch [IO.IOException] {
            Stop-WithError 'RUN-001' 'Launcher Is Busy' 'The launcher could not acquire the checkout lock.' `
                'Another Start, Setup, or Stop operation may be running.' @('Wait for the other launcher window to finish and try again.')
        }
    }
    switch ($Action) {
        'Stop' { Stop-Platform }
        'Diagnose' { Invoke-Diagnosis }
        default { Start-Platform }
    }
    $exitCode = 0
}
catch {
    if (!$_.Exception.Data['LauncherError']) {
        $position = $_.InvocationInfo
        $name = [IO.Path]::GetFileName($position.ScriptName)
        Write-LauncherLog ERROR "Unexpected $($_.Exception.GetType().Name) at $name line $($position.ScriptLineNumber)."
        try {
            Stop-WithError 'RUN-002' 'Launcher Could Not Complete' 'Windows reported an unexpected launcher error.' `
                'The log identifies the failed script location. Check writable project folders and supported prerequisites.' `
                @('Run Diagnose-Platform.bat and share the launcher report with your teammate.')
        } catch { }
    }
}
finally {
    try {
        Write-LauncherLog INFO "Exit status: $exitCode."
        if ($LogFile) { Write-AtomicFile (Join-Path $logDirectory 'latest.log') ([IO.File]::ReadAllText($LogFile)) }
    } catch { Write-Host '[WARN] Windows could not update the latest log reference.' }
    if ($lock) { $lock.Dispose() }
}
exit $exitCode
