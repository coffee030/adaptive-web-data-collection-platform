function Find-DemoPort([int]$Preferred) {
    foreach ($port in $Preferred..($Preferred + 19)) {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
        try {
            $listener.Server.ExclusiveAddressUse = $true
            $listener.Start()
            if ($port -ne $Preferred) { Write-Step "[INFO] Demo port $Preferred is unavailable. Selected loopback port $port." }
            return $port
        } catch [Net.Sockets.SocketException] {
            continue
        } finally { $listener.Stop() }
    }
    Stop-WithError 'NET-005' 'No Demo Port Is Available' "The launcher could not reserve a port near $Preferred." `
        'The candidate ports may be occupied or reserved by Windows.' @('Close other local development services if appropriate, then retry FYP Demo.')
}

function Get-IPv4Range([string]$Cidr) {
    if ($Cidr -notmatch '^(\d+\.\d+\.\d+\.\d+)/(\d+)$' -or [int]$Matches[2] -gt 32) {
        throw 'Unexpected IPv4 network prefix.'
    }
    $size = [uint64]1 -shl (32 - [int]$Matches[2])
    $bytes = ([Net.IPAddress]$Matches[1]).GetAddressBytes()
    [array]::Reverse($bytes)
    $first = [uint64][BitConverter]::ToUInt32($bytes, 0) -band (-bnot ($size - 1))
    return @{ First = $first; Last = $first + $size - 1 }
}

function Find-DemoSubnets {
    try {
        $routes = @(Get-NetRoute -AddressFamily IPv4 -ErrorAction Stop |
            Select-Object -ExpandProperty DestinationPrefix)
        $defaults = @('0.0.0.0/0')
        # VPNs can split their default route in two. Specific LAN and VPN routes still reserve their subnets.
        if ('0.0.0.0/1' -in $routes -and '128.0.0.0/1' -in $routes) {
            $defaults += @('0.0.0.0/1', '128.0.0.0/1')
        }
        $routes = @($routes | Where-Object { $_ -notin $defaults })
        $networks = Invoke-Docker @('network', 'ls', '--quiet')
        if ($networks.Code -ne 0 -or !$networks.Out) { throw 'Docker network inventory unavailable.' }
        $ids = @($networks.Out -split '\s+')
        if ($ids -cnotmatch '^[a-f0-9]{12,64}$') { throw 'Unexpected Docker network ID.' }
        $prefixes = Invoke-Docker (@('network', 'inspect', '--format', '{{range .IPAM.Config}}{{println .Subnet}}{{end}}') + $ids)
        if ($prefixes.Code -ne 0) { throw 'Docker network subnets unavailable.' }
        $ranges = @($routes + ($prefixes.Out -split '\s+') |
            Where-Object { $_ -and $_ -notmatch ':' } |
            ForEach-Object { Get-IPv4Range $_ })
        $selected = @()
        foreach ($segment in 249, 250) {
            foreach ($network in 0..255) {
                $cidr = "10.$segment.$network.0/24"
                $candidate = Get-IPv4Range $cidr
                if (!($ranges | Where-Object { $_.First -le $candidate.Last -and $_.Last -ge $candidate.First } |
                        Select-Object -First 1)) {
                    $selected += $cidr
                    if ($selected.Count -eq 2) { return $selected }
                }
            }
        }
    } catch {
        Write-LauncherLog WARN "Could not verify available Docker subnets ($($_.Exception.GetType().Name))."
    }
    Stop-WithError 'NET-004' 'Demo Networks Are Unavailable' 'The launcher could not verify two free private Docker subnets.' `
        'Existing Docker networks or VPN routes may overlap, or their inventory may be unavailable.' `
        @('Check that Docker Desktop is ready.', 'Ask your network administrator or teammate to check unused private subnets using the Windows setup guide.')
}

function Assert-DemoFixtureFiles {
    $files = @('backend/tests/m3_fixture_site.py', 'backend/tests/m7_fixture.py',
        'backend/tests/demo_fixture.py', 'backend/experiments/demo_presets.py',
        'backend/experiments/demo_provision.py')
    foreach ($file in $files) {
        if (!(Test-Path -LiteralPath (Join-Path $Root $file) -PathType Leaf)) {
            Stop-WithError 'DEMO-001' 'Synthetic Demo Files Missing' "The checkout is missing $file." `
                'The checkout may be incomplete.' @('Restore the bundled Demo files and run Setup-Platform.bat -Demo.')
        }
    }
}

function Invoke-DemoCheck([switch]$ReadOnly) {
    $arguments = @('exec', '-T', 'api', 'python', '-m', 'backend.experiments.demo_provision')
    if ($ReadOnly) { $arguments += '--check' }
    elseif ($DemoRetry) { $arguments += '--retry' }
    $seconds = if ($ReadOnly) { 45 } else { 540 }
    $result = Invoke-Compose $arguments $seconds
    foreach ($line in ($result.Out -split '\r?\n')) {
        if ($line -match '^(PASS |FAIL |Validating |Waiting for )') { Write-Step "[DEMO] $line" }
    }
    return $result
}

function Invoke-DemoProvisioning {
    Write-Step '[INFO] Preparing Synthetic Demo presets through the local API. First startup may take a few minutes.'
    $result = Invoke-DemoCheck
    if ($result.Code -ne 0) {
        Stop-WithError 'DEMO-002' 'Synthetic Demo Presets Are Incomplete' 'The Demo backend is running, but one or more baselines could not be verified.' `
            $result.Reason @('Run Diagnose-Platform.bat -Demo and check the preset messages.', `
                'After fixing the cause, run Start-Platform.bat -Demo again.', `
                'For a terminal failed or partial baseline, run Start-Platform.bat -Demo -DemoRetry.')
    }
}

function Write-DemoDiagnosis {
    $fixtureReady = (Get-ServiceState 'collection-fixture') -match '^running/healthy/'
    Write-Step "[INFO] Synthetic Demo fixture healthy: $fixtureReady."
    if ((Get-ServiceState api) -notmatch '^running/') {
        Write-Step '[WARN] Demo API is stopped. Migration and preset readiness are unavailable.'
        return
    }
    $migration = Invoke-Compose @('exec', '-T', 'api', 'python', '-m', 'alembic', 'current', '--check-heads') 20
    Write-Step "[INFO] Demo database is at the expected migration head: $($migration.Code -eq 0)."
    $api = "http://127.0.0.1:$($Config.API_PORT)/api/v1/marketing"
    try {
        $capability = Invoke-RestMethod -Uri "$api/capabilities" -TimeoutSec 5 -MaximumRedirection 0 -ErrorAction Stop
        if ($capability.demo_intelligence -eq 'available') {
            $status = Invoke-RestMethod -Uri "$api/intelligence/demo/processing" -TimeoutSec 5 -MaximumRedirection 0 -ErrorAction Stop
            Write-Step "[INFO] Harbourline catalog state: $($status.state). Indexed $($status.indexed_datasets) of $($status.eligible_datasets) eligible datasets."
            Write-Step "URL: http://127.0.0.1:$($Config.FRONTEND_PORT)/demo/connected"
            return
        }
    } catch {
        Write-Step '[WARN] Could not read the demo workspace status. Check API health and the dispatcher diagnostics above.'
        return
    }
    $result = Invoke-DemoCheck -ReadOnly
    Write-Step "[INFO] All Synthetic Demo baselines verified: $($fixtureReady -and $migration.Code -eq 0 -and $result.Code -eq 0)."
}
