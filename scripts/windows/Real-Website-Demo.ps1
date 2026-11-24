#Requires -Version 5.1
[CmdletBinding()]
param([switch]$NoBrowser)

. "$PSScriptRoot/Common.ps1"
. "$PSScriptRoot/Setup-Environment.ps1"
Set-LauncherMode

function Read-LauncherValue([string]$Name) {
    $path = Join-Path $Root '.local/launcher.env'
    if (![IO.File]::Exists($path)) { return $null }
    $line = Get-Content -LiteralPath $path | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -First 1
    if (!$line) { return $null }
    return $line.Substring($line.IndexOf('=') + 1)
}

function Read-OutputValue($Result, [string]$Name) {
    foreach ($line in @($Result.Out -split "`r?`n")) {
        if ($line -match "^$([regex]::Escape($Name))=(.*)$") { return $Matches[1] }
    }
    return $null
}

function Invoke-RealDemo([string[]]$Arguments) {
    $result = Invoke-Tool $Docker.CLI (@(
        '--host', $DockerHost, 'exec', $script:ApiContainer,
        'python', '-m', 'backend.experiments.real_demo_provision'
    ) + $Arguments) 210 -Environment $script:DockerEnvironment
    if ($result.Out) { Write-Host $result.Out }
    if ($result.Code -ne 0) { throw "Real demo command failed: $($Arguments -join ' ')" }
    return $result
}

Write-Host 'Quick Real Website Demo | Welsh Government'
Write-Host '[INFO] This uses the public GOV.WALES website. Live publisher availability and markup can change.'
Write-Host '[INFO] Starting the existing Normal platform first...'

$start = Join-Path $Root 'Start-Platform.bat'
& $env:ComSpec /d /c "`"$start`" -NoBrowser"
if ($LASTEXITCODE -ne 0) {
    Write-Host '[ERROR] Normal platform startup did not complete. Fix the launcher error, then run this file again.'
    exit $LASTEXITCODE
}

$project = Read-LauncherValue 'COMPOSE_PROJECT_NAME'
$frontendPort = Read-LauncherValue 'FRONTEND_PORT'
if (!$project -or !$frontendPort) {
    Write-Host '[ERROR] Could not read the Normal launcher settings from .local/launcher.env.'
    exit 1
}

$script:Docker = Get-DockerTools
if (!$Docker.CLI) {
    Write-Host '[ERROR] Docker CLI could not be found after platform startup.'
    exit 1
}

$script:DockerEnvironment = @{
    DOCKER_HOST = $null
    DOCKER_CONTEXT = $null
    DOCKER_TLS_VERIFY = $null
    DOCKER_CERT_PATH = $null
    Path = "$(Split-Path -Parent $Docker.CLI);$env:Path"
}
$container = Invoke-Tool $Docker.CLI @(
    '--host', $DockerHost, 'container', 'ls',
    '--filter', "label=com.docker.compose.project=$project",
    '--filter', 'label=com.docker.compose.service=api',
    '--format', '{{.ID}}'
) 15 -Environment $DockerEnvironment
$ids = @($container.Out -split "`r?`n" | Where-Object { $_ })
if ($container.Code -ne 0 -or $ids.Count -ne 1) {
    Write-Host '[ERROR] Could not identify exactly one owned API container.'
    exit 1
}
$script:ApiContainer = $ids[0]

try {
    $source = Invoke-RealDemo @('source')
    $sourceStatus = Read-OutputValue $source 'REAL_DEMO_SOURCE_STATUS'
    if ($sourceStatus -eq 'pending') {
        Write-Host ''
        Write-Host 'Source authorization review:'
        Write-Host '  Origin: https://www.gov.wales'
        Write-Host '  Paths:  /announcements/search and /written-statement-implications-uk-autumn-budget'
        Write-Host '  Permission reference: https://www.gov.wales/copyright-statement'
        $answer = Read-Host 'Type YES to authorize this Source scope'
        if ($answer -cne 'YES') { Write-Host '[INFO] Source authorization was not approved.'; exit 2 }
        $source = Invoke-RealDemo @('source', '--authorize')
        if ((Read-OutputValue $source 'REAL_DEMO_SOURCE_STATUS') -ne 'approved') { throw 'Source authorization did not persist.' }
    }

    $profile = Invoke-RealDemo @('profile')
    $approved = Read-OutputValue $profile 'REAL_DEMO_PROFILE_APPROVED'
    $runArgs = @('run')
    if ($approved -eq '0') {
        $reportId = Read-OutputValue $profile 'REAL_DEMO_REPORT_ID'
        $configHash = Read-OutputValue $profile 'REAL_DEMO_CONFIG_HASH'
        if (!$reportId -or !$configHash) { throw 'Validation passed but approval references were missing.' }
        Write-Host ''
        Write-Host 'Profile approval review:'
        Write-Host '  Live validation: PASS'
        Write-Host "  Config hash: $configHash"
        Write-Host "  Report ID:   $reportId"
        $answer = Read-Host 'Type APPROVE to approve this exact validated Profile and run the collection'
        if ($answer -cne 'APPROVE') { Write-Host '[INFO] Profile approval was not granted.'; exit 2 }
        $runArgs += @('--report-id', $reportId, '--config-hash', $configHash)
    }

    $result = Invoke-RealDemo $runArgs
    $requestId = Read-OutputValue $result 'REAL_DEMO_REQUEST_ID'
    if (!$requestId) { throw 'Live collection finished but its Request ID was not reported.' }
    $url = "http://127.0.0.1:$frontendPort/collection-requests/$requestId"
    Write-Host '[SUCCESS] Live website collection completed.'
    Write-Host "URL: $url"
    if (!$NoBrowser) {
        try { Start-Process $url }
        catch { Write-Host '[WARN] Browser did not open automatically. Copy the URL above.' }
    }
}
catch {
    Write-Host "[ERROR] $($_.Exception.Message)"
    Write-Host '[INFO] The Normal platform is still running.'
    Write-Host '[INFO] A live publisher can fail because of changed markup, robots policy, latency or availability.'
    Write-Host "[INFO] Open http://127.0.0.1:$frontendPort/ to inspect the Source, Profile and Jobs."
    exit 1
}
