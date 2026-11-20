#Requires -Version 5.1
[CmdletBinding()]
param([switch]$Physical8GB, [switch]$NoCache)

. "$PSScriptRoot/Platform.ps1" -Demo
$ErrorActionPreference = 'Stop'
foreach ($path in @('.local', '.local-demo', 'frontend/node_modules', 'frontend/dist', 'frontend/test-results', 'logs/launcher')) {
    if (Test-Path -LiteralPath (Join-Path $Root $path)) {
        throw "Use a fresh disposable checkout without $path."
    }
}
$null = New-Item -ItemType Directory -Path (Join-Path $Root '.local') -Force
$report = Join-Path $Root '.local/release-acceptance'
$null = New-Item -ItemType Directory -Path $report
$hostFacts = Get-SystemFacts
if ($Physical8GB -and (!$hostFacts.RAM -or $hostFacts.RAM -lt 7GB -or $hostFacts.RAM -gt 9GB)) {
    throw 'Physical acceptance requires measurable installed RAM near 8 GB.'
}
$label = if ($Physical8GB) { 'Physical 8 GB candidate. Complete the manual checklist and attest that the host is physical.' } else { 'Simulated or current-host resource evidence, not physical 8 GB acceptance.' }
$label | Set-Content -LiteralPath (Join-Path $report 'host.txt')
$physicalFacts = @($hostFacts.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" })
$physicalFacts | Add-Content -LiteralPath (Join-Path $report 'host.txt')
if (Get-Command node.exe -ErrorAction SilentlyContinue) {
    Write-Warning 'Node is visible in PATH. Record this host separately from the Node-free acceptance run.'
}

$powershell = Join-Path $PSHOME 'powershell.exe'
if (!(Test-Path -LiteralPath $powershell)) { $powershell = (Get-Process -Id $PID).Path }
$timings = Join-Path $report 'timings.csv'
'stage,elapsed_ms' | Set-Content -LiteralPath $timings
function Measure-Stage([string]$Name, [scriptblock]$Operation) {
    Set-Content -LiteralPath (Join-Path $report 'stage.txt') $Name
    $watch = [Diagnostics.Stopwatch]::StartNew()
    & $Operation
    Add-Content -LiteralPath $timings "$Name,$($watch.ElapsedMilliseconds)"
}
function Invoke-DemoLauncher([string]$Task) {
    & $powershell -NoProfile -ExecutionPolicy RemoteSigned -File (Join-Path $PSScriptRoot 'Platform.ps1') -Action $Task -Demo -NonInteractive -NoBrowser
    if ($LASTEXITCODE -ne 0) { throw "$Task failed with exit $LASTEXITCODE. See logs/launcher/demo/latest.log." }
}
function Read-DemoApi([string]$Path) {
    Invoke-RestMethod -Uri "http://127.0.0.1:$($Config.FRONTEND_PORT)/api/v1$Path" -TimeoutSec 15
}

Measure-Stage setup { Invoke-DemoLauncher Setup }
$script:Config = Get-LauncherConfig
$script:Docker = Get-DockerTools
Assert-OwnedDocker
$samples = Join-Path $report 'container-stats.jsonl'
$sampler = Start-Job -ArgumentList @($Docker.CLI, $DockerHost, $Config.COMPOSE_PROJECT_NAME, $report, $samples) -ScriptBlock {
    param($Cli, $Endpoint, $Project, $Directory, $Samples)
    $env:DOCKER_CONTEXT = $null
    while ($true) {
        $ids = @(& $Cli --host $Endpoint container ls --quiet --filter "label=com.docker.compose.project=$Project")
        if ($ids.Count) {
            $stage = Get-Content -LiteralPath (Join-Path $Directory 'stage.txt') -TotalCount 1
            $utc = [DateTimeOffset]::UtcNow.ToString('o')
            & $Cli --host $Endpoint stats --no-stream --format '{{json .}}' @ids |
                ForEach-Object { Add-Content -LiteralPath $Samples ('{"utc":"' + $utc + '","stage":"' + $stage + '","stats":' + $_ + '}') }
        }
        Start-Sleep -Seconds 2
    }
}

try {
    if ($NoCache) {
        Measure-Stage no-cache-build {
            Update-PlatformImage api -NoCache
            Update-PlatformImage frontend -NoCache
        }
    }
    Measure-Stage first-start-and-demo-seed { Invoke-DemoLauncher Start }
    $health = Read-DemoApi '/health'
    if ($health.status -ne 'ok') { throw 'Frontend proxy health failed.' }
    Measure-Stage idle { Start-Sleep -Seconds 8 }
    $requests = @(Read-DemoApi '/collection-requests')
    if ($requests.Count -ne 3) { throw 'Expected the three isolated preset Requests.' }
    $captures = foreach ($request in $requests) {
        foreach ($child in $request.jobs) {
            $job = $child.job.job_id
            $events = @(Read-DemoApi "/collection-jobs/$job/events")
            if (!$events.Count) { throw "Job $job has no execution events." }
            Read-DemoApi "/collection-jobs/$job/evidence-pages"
        }
    }
    if (!$captures.Count) { throw 'No Evidence was returned.' }
    foreach ($format in @('csv', 'json')) {
        Measure-Stage "export-$format" {
            foreach ($request in $requests) {
                $download = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$($Config.FRONTEND_PORT)/api/v1/collection-requests/$($request.id)/records/export?format=$format" -TimeoutSec 15
                if ($download.StatusCode -ne 200 -or !$download.RawContentLength) { throw "Empty $format export." }
            }
            Start-Sleep -Seconds 3
        }
    }
    Measure-Stage evidence-verification {
        foreach ($capture in $captures) {
            $metadata = Read-DemoApi "/evidence/$($capture.evidence_id)"
            if ($metadata.content_hash -notmatch '^[0-9a-f]{64}$') { throw 'Invalid Evidence digest.' }
        }
        $result = Invoke-DemoCheck -ReadOnly
        if ($result.Code -ne 0) { throw 'Demo Evidence byte hashes, lineage or export equality check failed.' }
    }
    Measure-Stage stop { Invoke-DemoLauncher Stop }
    Measure-Stage restart { Invoke-DemoLauncher Start }
    $restarted = @(Read-DemoApi '/collection-requests')
    if (Compare-Object @($requests.id) @($restarted.id)) { throw 'Preset Request identities changed after restart.' }
    $result = Invoke-DemoCheck -ReadOnly
    if ($result.Code -ne 0) { throw 'Demo persistence check failed.' }
    Measure-Stage repeated-start { Invoke-DemoLauncher Start }
    Measure-Stage diagnose { Invoke-DemoLauncher Diagnose }
    Measure-Stage clean-shutdown { Invoke-DemoLauncher Stop }
    Write-Host "PASS Windows Demo automation. Evidence saved in $report. Complete the manual acceptance checklist."
}
finally {
    Stop-Job -Job $sampler
    Remove-Job -Job $sampler
}
