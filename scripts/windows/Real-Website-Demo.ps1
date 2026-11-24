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

$environment = @{
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
) 15 -Environment $environment

$ids = @($container.Out -split "`r?`n" | Where-Object { $_ })
if ($container.Code -ne 0 -or $ids.Count -ne 1) {
    Write-Host '[ERROR] Could not identify exactly one owned API container.'
    Write-Host $container.Reason
    exit 1
}

Write-Host '[INFO] Provisioning the bounded Source/Profile and running a fresh live collection...'
$result = Invoke-Tool $Docker.CLI @(
    '--host', $DockerHost, 'exec', $ids[0],
    'python', '-m', 'backend.experiments.real_demo_provision'
) 210 -Environment $environment

if ($result.Out) { Write-Host $result.Out }
if ($result.Code -ne 0) {
    Write-Host '[ERROR] The live demo did not complete. The Normal platform is still running.'
    Write-Host '[INFO] This can happen if GOV.WALES changes, is slow, or is temporarily unavailable.'
    Write-Host "[INFO] Open http://127.0.0.1:$frontendPort/ to inspect Sources, Profiles and Jobs."
    exit $result.Code
}

$requestId = $null
foreach ($line in @($result.Out -split "`r?`n")) {
    if ($line -match '^REAL_DEMO_REQUEST_ID=([0-9a-fA-F-]{36})$') { $requestId = $Matches[1] }
}
if (!$requestId) {
    Write-Host '[ERROR] Live collection finished but its Request ID was not reported.'
    exit 1
}

$url = "http://127.0.0.1:$frontendPort/collection-requests/$requestId"
Write-Host '[SUCCESS] Live website collection completed.'
Write-Host "URL: $url"
if (!$NoBrowser) {
    try { Start-Process $url }
    catch { Write-Host '[WARN] Browser did not open automatically. Copy the URL above.' }
}
