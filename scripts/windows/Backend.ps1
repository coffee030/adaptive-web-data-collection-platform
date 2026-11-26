function Invoke-Docker([string[]]$Arguments, $Seconds = 20, $Environment = @{}) {
    $base = @{ DOCKER_CONTEXT = $null; DOCKER_HOST = $null; DOCKER_TLS_VERIFY = $null; DOCKER_CERT_PATH = $null }
    foreach ($key in $Environment.Keys) { $base[$key] = $Environment[$key] }
    # A Desktop install updates PATH for future shells. Image pulls in this shell still need its credential helper.
    $base.Path = "$(Split-Path -Parent $script:Docker.CLI);$env:Path"
    $result = Invoke-Tool $script:Docker.CLI (@('--host', $DockerHost) + $Arguments) $Seconds -Environment $base
    Write-LauncherLog INFO "Docker $($Arguments[0]): exit $($result.Code), details: $($result.Reason)."
    return $result
}

function Invoke-Compose([string[]]$Arguments, $Seconds = 25) {
    $options = @('compose', '--project-directory', $Root, '--env-file', (Join-Path $Local 'launcher.env'),
        '-p', $Config.COMPOSE_PROJECT_NAME, '-f', (Join-Path $Root 'compose.yaml'),
        '-f', (Join-Path $PSScriptRoot 'compose.launcher.yaml'))
    if ($Config.LAUNCHER_FIXTURE -eq '1') {
        $options += @('-f', (Join-Path $Root 'compose.fixture.yaml'), '-f', (Join-Path $PSScriptRoot 'compose.launcher-fixture.yaml'))
    }
    if ($DemoMode) { $options += @('-f', (Join-Path $PSScriptRoot 'compose.demo.yaml')) }
    if ($Config.MARKETING_PARTNER_REFRESH_HOST_DIR) { $options += @('-f', (Join-Path $Root 'compose.marketing-refresh.yaml')) }
    if ($Config.MARKETING_MODEL_HOST_DIR) { $options += @('-f', (Join-Path $Root 'compose.marketing-onnx.yaml')) }
    if ($Config.LAUNCHER_SUBNET) { $options += @('-f', (Join-Path $PSScriptRoot 'compose.subnet.yaml')) }
    if ($Config.LAUNCHER_FIXTURE -eq '1' -and $Config.LAUNCHER_FIXTURE_SUBNET) {
        $options += @('-f', (Join-Path $PSScriptRoot 'compose.fixture-subnet.yaml'))
    }
    $child = @{}
    Get-ChildItem Env: | Where-Object Name -like 'COMPOSE_*' | ForEach-Object { $child[$_.Name] = $null }
    foreach ($key in $Config.Keys) { $child[$key] = $Config[$key] }
    $child['COMPOSE_ANSI'] = 'never'
    return Invoke-Docker ($options + $Arguments) $Seconds $child
}

function Confirm-DockerOwnership {
    $project = $Config.COMPOSE_PROJECT_NAME
    $owner = $Config.LAUNCHER_OWNER
    foreach ($kind in @('container', 'network', 'volume')) {
        $format = if ($kind -eq 'container') { '{{.ID}}' } else { '{{.Name}}' }
        $arguments = @($kind, 'ls', '--filter', "label=com.docker.compose.project=$project", '--format', $format)
        if ($kind -eq 'container') { $arguments += '--all' }
        $listed = Invoke-Docker $arguments
        if ($listed.Code -ne 0) { return $false }
        $existing = @($listed.Out -split '\r?\n' | Where-Object { $_ })
        $names = switch ($kind) {
            'volume' {
                @($project + '_postgres_data'; $project + '_redis_data'; $project + '_evidence_data')
                if ($DemoMode) { $project + '_demo_state' }
            }
            'network' { @($project + '_default'; $project + '_fixtures') }
        }
        if ($names) {
            $resources = Invoke-Docker @($kind, 'ls', '--format', $format)
            if ($resources.Code -ne 0) { return $false }
            $existing += @($resources.Out -split '\r?\n' | Where-Object { $_ -cin $names })
        }
        foreach ($id in ($existing | Sort-Object -Unique)) {
            $location = if ($kind -eq 'container') { '.Config.Labels' } else { '.Labels' }
            $value = Invoke-Docker @($kind, 'inspect', '--format',
                "{{index $location `"org.adaptive-web.launcher-owner`"}}/{{index $location `"com.docker.compose.project`"}}", $id)
            if ($value.Code -ne 0 -or $value.Out -cne "$owner/$project") { return $false }
        }
    }
    return $true
}

function Get-ServiceId($Service) {
    $result = Invoke-Compose @('ps', '--all', '--quiet', $Service)
    if ($result.Code -eq 0 -and $result.Out -match '^[a-f0-9]{12,64}$') { return $result.Out }
    return $null
}

function Get-ServiceState($Service) {
    $id = Get-ServiceId $Service
    if (!$id) { return 'absent or ambiguous' }
    $result = Invoke-Docker @('container', 'inspect', '--format',
        '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}/{{.State.ExitCode}}/{{.State.OOMKilled}}', $id)
    if ($result.Code -eq 0 -and $result.Out -match '^\w+/(none|starting|healthy|unhealthy)/\d+/(true|false)$') {
        return $result.Out
    }
    return 'unavailable'
}

function Write-ServiceDiagnosis($Service) {
    $state = Get-ServiceState $Service
    $recent = Invoke-Compose @('logs', '--no-color', '--tail', '35', $Service) 10
    $reason = $recent.Reason
    if ("$($recent.Out) $($recent.Err)" -match 'read-only file system|could not (open|create).*directory|wrong ownership|invalid permissions') { $reason = 'volume access problem' }
    Write-Step "[INFO] $Service state: $state; recent log category: $reason."
    return "$state; $reason"
}

function Stop-DisabledFixture {
    if ($Config.LAUNCHER_FIXTURE -ne '0') { return }
    $project = $Config.COMPOSE_PROJECT_NAME
    $fixture = Invoke-Docker @('container', 'ls', '--filter', "label=com.docker.compose.project=$project",
        '--filter', 'label=com.docker.compose.service=collection-fixture', '--format', '{{.ID}}')
    if ($fixture.Code -eq 0 -and !$fixture.Out) { return }
    if ($fixture.Code -eq 0) {
        $Config.LAUNCHER_FIXTURE = '1'
        try { $fixture = Invoke-Compose @('stop', 'collection-fixture') 35 }
        finally { $Config.LAUNCHER_FIXTURE = '0' }
    }
    if ($fixture.Code -ne 0) {
        Stop-WithError 'STOP-002' 'Disabled Fixture Could Not Be Stopped' 'The launcher could not verify shutdown of its disabled fixture.' `
            $fixture.Reason @("Run $StopCommand before launching in a different fixture mode.")
    }
}

function Test-BackendPort($Service, $InternalPort, $HostPort) {
    $result = Invoke-Compose @('port', $Service, "$InternalPort") 8
    return $result.Code -eq 0 -and $result.Out -ceq "127.0.0.1:$HostPort"
}

function Assert-PortAvailable($Port, $Code, $Name, [switch]$Owned) {
    if ($Owned) { return }
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, [int]$Port)
    try {
        $listener.Server.ExclusiveAddressUse = $true
        $listener.Start()
    }
    catch [Net.Sockets.SocketException] {
        $owner = 'Unknown process or a Windows reserved port.'
        try {
            $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
            $process = Get-Process -Id $connection.OwningProcess -ErrorAction Stop
            if ($process.ProcessName -match '^[A-Za-z0-9_.-]{1,80}$') { $owner = "PID $($process.Id) ($($process.ProcessName))." }
        } catch {
            # CIM may be blocked even when the built-in socket table is readable.
            $table = Invoke-Tool (Join-Path $env:SystemRoot 'System32/netstat.exe') @('-ano', '-p', 'tcp') 5
            $entry = [regex]::Match($table.Out, ('(?m)^\s*TCP\s+\S+:{0}\s+\S+:0\s+\S+\s+(\d+)\s*$' -f $Port))
            if ($entry.Success) { $owner = "PID $($entry.Groups[1].Value)." }
        }
        $settings = "$(Split-Path -Leaf $Local)/launcher.env"
        Stop-WithError $Code "$Name Port Is Unavailable" "The launcher cannot bind TCP port $Port." $owner `
            @('Close the other application if appropriate.', "Or change the matching port in $settings after stopping this launcher installation.", "Run $StartCommand again.")
    }
    finally { $listener.Stop() }
}

function Test-DatabaseLogin {
    $result = Invoke-Compose @('exec', '-T', 'postgres', 'sh', '-ec',
        'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT 1"') 10
    return $result.Code -eq 0 -and $result.Out -eq '1'
}

function Test-Redis {
    $result = Invoke-Compose @('exec', '-T', 'redis', 'redis-cli', 'ping') 8
    return $result.Code -eq 0 -and $result.Out -ceq 'PONG'
}

function Start-StorageServices {
    $postgres = Invoke-Compose @('up', '-d', '--wait', '--wait-timeout', '60', 'postgres') 300
    if ($postgres.Code -ne 0 -or !(Test-DatabaseLogin)) {
        $details = Write-ServiceDiagnosis postgres
        if ($postgres.Reason -eq 'Docker network address pools exhausted') {
            Stop-WithError 'NET-004' 'Docker Network Address Pools Are Exhausted' 'Docker could not allocate this project a network.' `
                $postgres.Reason @('Check Docker networks and Windows/VPN routes.', 'Select an unused private subnet as described in the Windows setup guide.')
        }
        Stop-WithError 'DB-004' 'PostgreSQL Failed Its Startup Checks' 'PostgreSQL did not become healthy or rejected the saved database login.' `
            "$($postgres.Reason); $details." @('Check Docker Desktop and available disk space.', "Run $DiagnoseCommand and check the PostgreSQL state.", 'Restore the original launcher.env if its credentials changed. Keep the database volume.')
    }
    Write-Step '[PASS] PostgreSQL is healthy and accepts the saved login.'
    $redis = Invoke-Compose @('up', '-d', '--wait', '--wait-timeout', '45', 'redis') 180
    if ($redis.Code -ne 0 -or !(Test-Redis)) {
        $details = Write-ServiceDiagnosis redis
        Write-Step '[INFO] Retrying Redis with one restart.'
        $retry = Invoke-Compose @('restart', 'redis') 35
        if ($retry.Code -ne 0 -or !(Wait-Until { Test-Redis } 30)) {
            Stop-WithError 'DB-005' 'Redis Failed Its Health Check' 'The launcher could not verify the Redis broker.' "$($redis.Reason); $details." `
                @("Check the Redis state with $DiagnoseCommand.", 'Check available disk space and Docker Desktop resources.') 'Failed after one restart attempt.'
        }
        Write-LauncherLog INFO 'Redis recovery succeeded.'
    }
    Write-Step '[PASS] Redis returned PONG.'
}

function Get-ImageFingerprint([ValidateSet('api', 'frontend')][string]$Service) {
    $settings = ''
    if ($Service -eq 'api') {
        $settings = "onnx=$($Config.MARKETING_ONNX)"
        $files = @(Get-Item -LiteralPath @((Join-Path $Root 'Dockerfile'), (Join-Path $Root 'alembic.ini'), (Join-Path $Root '.dockerignore')))
        $files += @(Get-ChildItem -LiteralPath (Join-Path $Root 'backend') -File -Recurse |
            Where-Object { $_.FullName -notmatch '[\\/](?:__pycache__|\.pytest_cache|\.ruff_cache)[\\/]' -and $_.Extension -notin @('.pyc', '.pyo') })
    } else {
        $files = @(Get-ChildItem -LiteralPath $Frontend -File -Force |
            Where-Object { $_.Name -match '^(Dockerfile|\.dockerignore|package(-lock)?\.json|index\.html|vite\.config\.ts|(postcss|tailwind)\.config\.cjs|tsconfig.*\.json|nginx\.conf\.template)$' })
        foreach ($directory in @('src', 'public')) {
            $path = Join-Path $Frontend $directory
            if (Test-Path -LiteralPath $path) { $files += @(Get-ChildItem -LiteralPath $path -File -Recurse) }
        }
        $settings = "approval=$($Config.LOCAL_PROFILE_APPROVAL); demo=$DemoMode; installation=$($Config.HARBOURLINE_INSTALLATION); peer=$($Config.HARBOURLINE_PEER_PORT)"
    }
    $hash = [Security.Cryptography.SHA256]::Create()
    try {
        $entries = foreach ($file in ($files | Sort-Object FullName)) {
            $stream = [IO.File]::OpenRead($file.FullName)
            try { $file.FullName.Substring($Root.Length) + '=' + [BitConverter]::ToString($hash.ComputeHash($stream)) }
            finally { $stream.Dispose() }
        }
        return [BitConverter]::ToString($hash.ComputeHash($Utf8.GetBytes((@($settings) + $entries) -join "`n")))
    }
    finally { $hash.Dispose() }
}

function Update-PlatformImage([ValidateSet('api', 'frontend')][string]$Service, [switch]$NoCache, [switch]$AllowFailure) {
    $kind = if ($Service -eq 'api') { 'backend' } else { 'frontend' }
    $stamp = Join-Path $Local "$kind-image.txt"
    $fingerprint = Get-ImageFingerprint $Service
    $revision = 'source'
    if ((Test-Path -LiteralPath (Join-Path $Root '.git')) -and (Get-Command git.exe -ErrorAction SilentlyContinue)) {
        $head = & git.exe -C $Root rev-parse --verify HEAD 2>$null
        if ($LASTEXITCODE -eq 0 -and $head -match '^[a-f0-9]{40}$') {
            $revision = $head
            $changes = & git.exe -C $Root status --porcelain --untracked-files=normal 2>$null
            if ($LASTEXITCODE -ne 0 -or $changes) { $revision += '.working' }
        }
    }
    $Config['HARBOURLINE_BUILD_ID'] = $revision + '.' + $fingerprint.Replace('-', '').ToLowerInvariant()
    $imageName = "$($Config.COMPOSE_PROJECT_NAME)-${kind}:local"
    $image = Invoke-Docker @('image', 'inspect', '--format', '{{.Id}}', $imageName)
    if (!$NoCache -and $image.Code -eq 0 -and (Test-Path -LiteralPath $stamp) -and
        [IO.File]::ReadAllText($stamp) -ceq "$($Config.HARBOURLINE_BUILD_ID) $($image.Out)") {
        Write-Step "[PASS] Reusing the verified $kind image."
        if ($AllowFailure) { return $true }
        return
    }
    Write-Step "[INFO] Building the $kind image for this checkout. The first build downloads packages and may take several minutes."
    $arguments = @('build')
    if ($NoCache) { $arguments += '--no-cache' }
    $built = Invoke-Compose ($arguments + $Service) 1200
    if ($built.Code -ne 0) {
        if ($AllowFailure) { return $false }
        Stop-WithError 'SVC-001' 'Container Image Build Failed' "Docker could not build the $kind image." $built.Reason `
            @('Check internet access to Docker Hub and the package registries.', 'Check free disk space and Docker Desktop.', "Run $DiagnoseCommand, then try again.")
    }
    $image = Invoke-Docker @('image', 'inspect', '--format', '{{.Id}}', $imageName)
    if ($image.Code -eq 0) { Write-AtomicFile $stamp "$($Config.HARBOURLINE_BUILD_ID) $($image.Out)" }
    if ($AllowFailure) { return ($image.Code -eq 0) }
}

function Update-DatabaseSchema {
    $alembic = @('run', '--rm', '-T', '--no-deps', 'api', 'python', '-m', 'alembic')
    $head = Invoke-Compose ($alembic + @('current', '--check-heads')) 60
    if ($head.Code -ne 0) {
        $migration = Invoke-Compose @('stop', 'frontend', 'dispatcher', 'worker', 'api') 160
        if ($migration.Code -eq 0) {
            $migration = Invoke-Compose ($alembic + @('upgrade', 'head')) 120
        }
        if ($migration.Code -eq 0) {
            $migration = Invoke-Compose ($alembic + @('current', '--check-heads')) 60
        }
        if ($migration.Code -ne 0) {
            Stop-WithError 'DB-006' 'Database Migration Failed' 'Startup stopped before starting API, dispatcher, or worker for this run.' `
                "Migration sequence exit $($migration.Code): $($migration.Reason)." @('Keep the database and evidence volumes.', 'Check the repository migration files and the PostgreSQL state.', 'Ask a teammate to review the migration before retrying.')
        }
    }
    Write-Step '[PASS] Alembic verified the database is at the expected head.'
}

function Get-HttpStatus($Url) {
    $curl = Join-Path $env:SystemRoot 'System32/curl.exe'
    return Invoke-Tool $curl @('--silent', '--show-error', '--noproxy', '*', '--max-time', '3', '--write-out', '\n%{http_code}', $Url) 5
}

function Test-ApiHealth($Url) {
    $result = Get-HttpStatus $Url
    return $result.Code -eq 0 -and $result.Out -match '^\{\s*"status"\s*:\s*"ok"\s*\}\s+200$'
}

function Test-Dispatcher {
    $state = Get-ServiceState dispatcher
    $logs = Invoke-Compose @('logs', '--no-color', '--since', '2m', '--tail', '20', 'dispatcher') 10
    # Normal dispatcher runs log a startup line and then log only failures.
    if ($logs.Code -eq 0 -and $logs.Out -match 'database operation failed') { return $false }
    $startup = Invoke-Compose @('logs', '--no-color', '--tail', '20', 'dispatcher') 10
    return $state -match '^running/' -and $startup.Code -eq 0 -and $startup.Out -match 'Collection dispatcher polling PostgreSQL'
}

function Test-CeleryWorker {
    $scriptText = 'python -m celery -A backend.queue.celery_app:app inspect --timeout=4 --destination="celery@$HOSTNAME" registered'
    $result = Invoke-Compose @('exec', '-T', 'worker', 'sh', '-ec', $scriptText) 12
    return $result.Code -eq 0 -and $result.Out -match '(?m)^\s*\*\s+collection\.execute_job\s*$'
}

function Start-BackendServices {
    $services = @('api', 'dispatcher', 'worker')
    if ($Config.LAUNCHER_FIXTURE -eq '1') { $services += 'collection-fixture' }
    $startup = Invoke-Compose (@('up', '-d', '--no-build', '--wait', '--wait-timeout', '60') + $services) 130
    if ($startup.Code -ne 0) {
        foreach ($service in $services) { $null = Write-ServiceDiagnosis $service }
        Stop-WithError 'SVC-002' 'Backend Services Could Not Start' 'Docker Compose could not start all requested services.' $startup.Reason `
            @("Check the service states and port bindings with $DiagnoseCommand.", 'Check Docker Desktop resources and try again.')
    }
    $url = "http://127.0.0.1:$($Config.API_PORT)/api/v1/health"
    if (!(Wait-Until { Test-ApiHealth $url } 55)) {
        $details = Write-ServiceDiagnosis api
        Stop-WithError 'SVC-003' 'FastAPI Health Check Timed Out' 'The API did not return HTTP 200 with a healthy database connection.' $details `
            @("Check PostgreSQL and the API state with $DiagnoseCommand.", "After fixing the reported issue, run $StartCommand again.")
    }
    Write-Step '[PASS] FastAPI health endpoint confirmed database access.'
    if (!(Wait-Until { Test-Dispatcher } 25)) {
        $details = Write-ServiceDiagnosis dispatcher
        Stop-WithError 'SVC-004' 'Dispatcher Is Unavailable' 'The dispatcher did not confirm that it is polling PostgreSQL.' $details `
            @("Inspect the dispatcher and PostgreSQL states with $DiagnoseCommand.")
    }
    Write-Step '[PASS] Dispatcher is running and reported PostgreSQL polling.'
    if (!(Wait-Until { Test-CeleryWorker } 40)) {
        $details = Write-ServiceDiagnosis worker
        Write-Step '[INFO] Retrying the Celery worker with one restart.'
        $retry = Invoke-Compose @('restart', 'worker') 100
        if ($retry.Code -ne 0 -or !(Wait-Until { Test-CeleryWorker } 45)) {
            Stop-WithError 'SVC-005' 'Celery Worker Is Unavailable' 'The worker did not report the registered collection task through Redis.' $details `
                @("Check the worker and Redis states with $DiagnoseCommand.", 'Check Docker Desktop memory and try again.') 'Failed after one restart attempt.'
        }
        Write-LauncherLog INFO 'Celery worker recovery succeeded.'
    }
    Write-Step '[PASS] The Celery worker responded and registered collection.execute_job.'
    if ($Config.LAUNCHER_FIXTURE -eq '1' -and (Get-ServiceState 'collection-fixture') -match '^running/healthy/') {
        Write-Step '[PASS] The controlled fixture is healthy on its internal Docker network.'
    }
}
