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

function Start-ContainerFrontend {
    $result = Invoke-Compose @('up', '-d', '--no-deps', '--no-build', '--wait', '--wait-timeout', '65', 'frontend') 100
    $url = "http://127.0.0.1:$($Config.FRONTEND_PORT)"
    if ($result.Code -ne 0 -or !(Test-ApiHealth "$url/api/v1/health")) {
        $details = Write-ServiceDiagnosis frontend
        Stop-WithError 'WEB-003' 'Frontend Startup Failed' 'The container or its API proxy did not become ready.' `
            "$($result.Reason); $details." @('Run Diagnose-Platform.bat and check Docker Desktop and the configured frontend port.')
    }
    Write-Step '[PASS] The containerized frontend and its API proxy are ready.'
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
