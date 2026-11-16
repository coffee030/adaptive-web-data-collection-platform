function Get-FrontendState {
    $path = Join-Path $Local 'frontend.json'
    if (!(Test-Path -LiteralPath $path)) { return $null }
    try { $state = [IO.File]::ReadAllText($path) | ConvertFrom-Json }
    catch { $state = $null }
    if ($state.Marker -notmatch '^[a-f0-9]{32}$' -or $state.Pid -lt 1 -or
        $state.Port -lt 1024 -or $state.Port -gt 65535 -or !$state.Executable -or !$state.StartTicks) {
        Stop-WithError 'WEB-004' 'Frontend Ownership Could Not Be Verified' 'The launcher state file is invalid.' 'The frontend state file may have been edited.' `
            @('Check whether the previous launcher frontend is still running before moving frontend.json aside.')
    }
    return $state
}

function Test-FrontendProcess($State) {
    if (!$State) { return $false }
    try {
        $process = Get-Process -Id $State.Pid -ErrorAction Stop
        return $process.StartTime.ToUniversalTime().Ticks -eq [long]$State.StartTicks -and $process.Path -eq $State.Executable
    } catch { return $false }
}

function Test-FrontendMarker($State) {
    $probe = Get-HttpStatus "http://127.0.0.1:$($State.Port)/__launcher_ready"
    return $probe.Code -eq 0 -and $probe.Out -match ('\A' + [regex]::Escape($State.Marker) + '\s+200\z')
}

function Test-FrontendReady($State) {
    if (!(Test-FrontendProcess $State) -or !(Test-FrontendMarker $State)) { return $false }
    $url = "http://127.0.0.1:$($State.Port)"
    $page = Get-HttpStatus "$url/"
    $entry = Get-HttpStatus "$url/src/main.tsx"
    return $page.Code -eq 0 -and $page.Out -match '(?s)<!doctype html>.*id="root".*\s200$' -and
        $entry.Code -eq 0 -and $entry.Out -match '\s200$' -and (Test-ApiHealth "$url/api/v1/health")
}

function Stop-OwnedFrontend {
    $state = Get-FrontendState
    if (!$state) { return }
    $stopFile = Join-Path $Local "frontend-$($state.Marker).stop"
    if (Test-FrontendProcess $state) {
        Write-AtomicFile $stopFile 'stop'
        if (!(Wait-Until { !(Test-FrontendProcess $state) } 12 1)) {
            Stop-WithError 'WEB-004' 'Frontend Did Not Stop' 'The verified frontend did not exit after its shutdown request.' `
                'The development server may still be serving an active connection.' @('Close the platform tab and retry Stop-Platform.bat.') 'Graceful shutdown attempted.'
        }
        Write-Step '[PASS] The launcher frontend stopped.'
    }
    [IO.File]::Delete($stopFile)
    [IO.File]::Delete($stopFile + '.error')
    [IO.File]::Delete((Join-Path $Local 'frontend.json'))
}

function Start-Frontend($Node) {
    $state = Get-FrontendState
    if (Test-FrontendProcess $state) {
        if ($state.Port -eq [int]$Config.FRONTEND_PORT -and $state.ApiPort -eq [int]$Config.API_PORT -and
            $state.Approval -eq $Config.LOCAL_PROFILE_APPROVAL -and (Test-FrontendReady $state)) {
            Write-Step '[PASS] Existing launcher frontend and API proxy are ready.'
            return $false
        }
        Stop-OwnedFrontend
    }
    Assert-PortAvailable $Config.FRONTEND_PORT 'NET-002' 'Frontend'
    $marker = [Guid]::NewGuid().ToString('N')
    $stopFile = Join-Path $Local "frontend-$marker.stop"
    $envChanges = @{
        API_PROXY_TARGET = "http://127.0.0.1:$($Config.API_PORT)"
        VITE_API_BASE_URL = '/api/v1'
        LOCAL_PROFILE_APPROVAL = $Config.LOCAL_PROFILE_APPROVAL
        PLATFORM_SYNTHETIC_DEMO = if ($DemoMode) { '1' } else { '0' }
        NODE_OPTIONS = $null
        NODE_PATH = $null
    }
    $previous = @{}
    try {
        foreach ($key in $envChanges.Keys) {
            $previous[$key] = [Environment]::GetEnvironmentVariable($key)
            [Environment]::SetEnvironmentVariable($key, $envChanges[$key], 'Process')
        }
        $arguments = ConvertTo-NativeArguments @((Join-Path $PSScriptRoot 'frontend.mjs'), $Config.FRONTEND_PORT, $stopFile, $marker)
        $process = Start-Process -FilePath $Node.Node -ArgumentList $arguments -WorkingDirectory $Frontend -WindowStyle Hidden -PassThru
        $state = @{
            Pid = $process.Id; StartTicks = "$($process.StartTime.ToUniversalTime().Ticks)"; Executable = $Node.Node
            Marker = $marker; Port = [int]$Config.FRONTEND_PORT; ApiPort = [int]$Config.API_PORT; Approval = $Config.LOCAL_PROFILE_APPROVAL
        }
        try { Write-AtomicFile (Join-Path $Local 'frontend.json') ($state | ConvertTo-Json -Compress) }
        catch {
            Write-AtomicFile $stopFile 'stop'
            throw
        }
    }
    finally {
        foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
    }

    $ready = @{ Value = $false }
    $null = Wait-Until {
        if (!(Test-FrontendProcess $state)) { return $true }
        $ready.Value = Test-FrontendReady $state
        return $ready.Value
    } 45
    if (!$ready.Value) {
        $phase = 'readiness or API proxy check'
        if (Test-Path -LiteralPath ($stopFile + '.error')) {
            $stage = [IO.File]::ReadAllText($stopFile + '.error')
            if ($stage -in @('load-vite', 'configure-vite', 'listen')) { $phase = $stage }
        }
        Stop-OwnedFrontend
        Stop-WithError 'WEB-003' 'Frontend Startup Failed' 'Vite could not serve the Overview route, its entry module, and the API proxy.' `
            "Failed stage: $phase." @('Run Setup-Platform.bat and check the saved port settings.', 'Check your local Vite settings and run Diagnose-Platform.bat.')
    }
    Write-Step '[PASS] React route, entry module, and API proxy are responding.'
    return $true
}

function Open-PlatformBrowser($Url, [switch]$Required) {
    try {
        Start-Process -FilePath $Url -ErrorAction Stop
        Write-Step '[PASS] Sent the URL to your default browser.'
    } catch {
        try {
            Stop-WithError 'WEB-005' 'Browser Did Not Open' 'Windows could not open the platform URL automatically.' `
                'The default browser may be missing or its URL association may need repair.' @('Copy the URL below into your browser.') 'Automatic opening failed.'
        } catch { if ($Required -or !$_.Exception.Data['LauncherError']) { throw } }
    }
}
