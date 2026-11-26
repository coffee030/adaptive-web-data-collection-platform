#Requires -Version 5.1
. "$PSScriptRoot/Platform.ps1"

$testRoot = Join-Path $Root ('logs/launcher/tests-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $testRoot -Force
$script:LogFile = Join-Path $testRoot 'suite.log'
$script:NonInteractive = $true
$script:Count = 0
$script:Failures = 0
$script:OriginalLocal = $Local

function Assert($Condition, $Message) { if (!$Condition) { throw $Message } }

function Expect-Error($Code, [scriptblock]$Body) {
    try { & $Body }
    catch {
        Assert ($_.Exception.Data['LauncherError'] -and $_.Exception.Message -ceq $Code) "Expected $Code, got $($_.Exception.Message)."
        return
    }
    throw "Expected $Code but the operation succeeded."
}

function Test-Case($Name, [scriptblock]$Body) {
    $script:Count++
    try {
        & $Body
        Write-Host "PASS $Name"
    } catch {
        $script:Failures++
        Write-Host "FAIL $Name - $($_.Exception.Message)"
    }
}

function Test-PortConflict($Code, $Name) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try {
        $port = $listener.LocalEndpoint.Port
        Expect-Error $Code { Assert-PortAvailable $port $Code $Name }
        Assert-PortAvailable $port $Code $Name -Owned
        Assert ($listener.Server.IsBound) 'The other listener was affected.'
    } finally { $listener.Stop() }
}

$ok = @{ Code = 0; Out = ''; Err = ''; Reason = 'none' }
$fail = @{ Code = 1; Out = ''; Err = ''; Reason = 'test failure' }
$system = @{ Build = 26200; Architecture = 'AMD64'; Virtualization = 'available' }
$script:WSL = @{ Available = $true }
$script:Config = @{ API_PORT = '58097'; FRONTEND_PORT = '5197'; POSTGRES_PORT = '55497'; LAUNCHER_FIXTURE = '0' }

Test-Case 'First run and configuration reuse' {
    $script:Local = Join-Path $testRoot ('space ' + [char]0x6E2C + [char]0x8A66)
    $null = New-Item -ItemType Directory -Path $Local
    $first = Get-LauncherConfig -Create
    $second = Get-LauncherConfig -Create
    Assert ($first.POSTGRES_PASSWORD.Length -eq 64) 'The generated secret has the wrong length.'
    Assert ($first.POSTGRES_PASSWORD -ceq $second.POSTGRES_PASSWORD) 'The secret changed.'
    Assert ($first.COMPOSE_PROJECT_NAME -ceq $second.COMPOSE_PROJECT_NAME) 'The Compose identity changed.'
    $script:ConfigSecret = $first.POSTGRES_PASSWORD
}
Test-Case 'Log generation, English error structure and no secrets' {
    $reason = Get-SafeReason "postgresql://user:$ConfigSecret@localhost permission denied"
    Assert ($reason -ceq 'access denied') 'The external error was not classified.'
    Expect-Error 'TST-001' { Stop-WithError 'TST-001' 'English Error' 'Test details.' $reason @('Try again.') }
    $log = [IO.File]::ReadAllText($LogFile)
    Assert ($log.Contains('TST-001 English Error') -and !$log.Contains($ConfigSecret) -and !$log.Contains('postgresql://')) 'The log was missing or contained secrets.'
}
Test-Case 'Ordinary Start never invokes host Node and gates browser on Docker health' {
    $Config = @{ FRONTEND_PORT = '5197' }
    $calls = [Collections.Generic.List[string]]::new()
    function Get-SystemFacts { return @{ Build = 26200; Architecture = 'AMD64'; FreeGB = 15; DockerGB = 20; RAM = 8GB } }
    function Get-WSLStatus { return @{ Available = $true } }
    function Initialize-Docker { return @{} }
    function Initialize-Node { throw 'Host Node was called.' }
    function Initialize-FrontendDependencies { throw 'Host npm was called.' }
    function Get-LauncherConfig { return $Config }
    function Invoke-Compose { return $ok }
    function Assert-OwnedDocker {}
    function Stop-OwnedFrontend { $calls.Add('legacy-stop') }
    function Assert-LauncherPorts {}
    function Update-PlatformImage($Service) { $calls.Add("build-$Service") }
    function Start-StorageServices { $calls.Add('storage') }
    function Update-DatabaseSchema { $calls.Add('migration') }
    function Start-BackendServices { $calls.Add('backend') }
    function Stop-DisabledFixture {}
    function Start-ContainerFrontend { $calls.Add('frontend') }
    function Open-PlatformBrowser { $calls.Add('browser') }
    $savedConfig = $script:Config
    try { Start-Platform } finally { $script:Config = $savedConfig }
    Assert (($calls -join ',') -ceq 'legacy-stop,build-api,build-frontend,storage,migration,backend,frontend,browser') 'Unexpected startup sequence.'
}

Test-Case 'Missing Docker offers consent without installing' {
    function Get-DockerTools { return @{} }
    function Confirm-Change { return $false }
    Expect-Error 'ENV-005' { Initialize-Docker $system }
}
Test-Case 'Docker installed but stopped attempts Desktop startup and recovers' {
    $calls = @{ Count = 0; Started = 0 }
    function Get-DockerTools { return @{ Desktop = 'desktop.exe'; CLI = 'docker.exe' } }
    function Get-LinuxEngine($docker) {
        $calls.Count++
        if ($calls.Count -eq 1) { return $fail }
        return @{ Code = 0; Out = 'linux' }
    }
    function Get-Process { return $null }
    function Start-Process { $calls.Started++ }
    function Invoke-Tool { return @{ Code = 0; Out = '2.40.0' } }
    $docker = Initialize-Docker $system
    Assert ($docker.CLI -eq 'docker.exe' -and $calls.Started -eq 1) 'Desktop recovery was not verified.'
}
Test-Case 'Docker subprocess can find the credential helper after a per-user install' {
    $directory = Join-Path $testRoot 'Docker Desktop/bin'
    $savedDocker = $script:Docker
    $inheritedPath = $env:Path
    $script:Docker = @{ CLI = (Join-Path $directory 'docker.exe') }
    function Invoke-Tool($File, $Arguments, $Seconds, $Environment) {
        Assert ($File -ceq $script:Docker.CLI) 'Docker was not invoked by its discovered path.'
        Assert ($Environment.Path -ceq "$directory;$inheritedPath") 'Docker directory was not prepended to the subprocess PATH.'
        Assert ($Arguments[0] -eq '--host' -and $Arguments[1] -ceq $DockerHost) 'Docker did not use the local Linux engine.'
        return $ok
    }
    try { $null = Invoke-Docker @('compose', 'build', 'api') }
    finally { $script:Docker = $savedDocker }
    Assert ($env:Path -ceq $inheritedPath) 'The launcher changed its own PATH.'
}
Test-Case 'Docker Linux Engine unavailable after bounded startup' {
    function Get-DockerTools { return @{ Desktop = 'desktop.exe'; CLI = 'docker.exe' } }
    function Get-LinuxEngine { return $fail }
    function Get-Process { return $null }
    function Start-Process {}
    function Wait-Until { return $false }
    Expect-Error 'ENV-006' { Initialize-Docker $system }
}
Test-Case 'Disabled virtualization reports BIOS guidance' {
    function Get-DockerTools { return @{} }
    Expect-Error 'ENV-003' { Initialize-Docker @{ Virtualization = 'disabled' } }
}
Test-Case 'Failed frontend build leaves no success stamp and can resume' {
    $Config = @{ COMPOSE_PROJECT_NAME = 'test-project'; LOCAL_PROFILE_APPROVAL = '1' }
    $state = @{ Built = 0 }
    function Get-ImageFingerprint { return 'fingerprint' }
    function Invoke-Docker {
        if ($state.Built -lt 2) { return $fail }
        return @{ Code = 0; Out = 'image-id' }
    }
    function Invoke-Compose($Arguments) {
        Assert (($Arguments -join ' ') -ceq 'build frontend') 'Unexpected frontend build arguments.'
        if (++$state.Built -eq 1) { return $fail }
        return $ok
    }
    $stamp = Join-Path $Local 'frontend-image.txt'
    Expect-Error 'SVC-001' { Update-PlatformImage frontend }
    Assert (!(Test-Path -LiteralPath $stamp)) 'A failed build was marked complete.'
    Update-PlatformImage frontend
    Update-PlatformImage frontend
    Assert ($state.Built -eq 2 -and [IO.File]::ReadAllText($stamp) -ceq 'fingerprint image-id') 'Successful build was not reused.'
    [IO.File]::Delete($stamp)
}

Test-Case 'API port conflict leaves other listener bound' { Test-PortConflict 'NET-001' 'API' }
Test-Case 'Frontend port conflict leaves other listener bound' { Test-PortConflict 'NET-002' 'Frontend' }
Test-Case 'PostgreSQL startup failure halts storage startup' {
    function Invoke-Compose($Arguments) {
        Assert ($Arguments[-1] -ceq 'postgres') 'Storage startup continued past PostgreSQL.'
        return $fail
    }
    function Write-ServiceDiagnosis { return 'unhealthy' }
    Expect-Error 'DB-004' { Start-StorageServices }
}
Test-Case 'Redis startup failure attempts only one restart' {
    $calls = @{ Restart = 0 }
    function Invoke-Compose($Arguments) {
        if ($Arguments[0] -eq 'restart') { $calls.Restart++; return $fail }
        return $ok
    }
    function Test-DatabaseLogin { return $true }
    function Test-Redis { return $false }
    function Write-ServiceDiagnosis { return 'unhealthy' }
    Expect-Error 'DB-005' { Start-StorageServices }
    Assert ($calls.Restart -eq 1) 'Redis restart count was incorrect.'
}
Test-Case 'Celery failure attempts only one restart' {
    $calls = @{ Restart = 0 }
    function Invoke-Compose($Arguments) {
        if ($Arguments[0] -eq 'restart') { $calls.Restart++ }
        return $ok
    }
    function Test-ApiHealth { return $true }
    function Test-Dispatcher { return $true }
    function Test-CeleryWorker { return $false }
    function Wait-Until($Check) { return (& $Check) }
    function Write-ServiceDiagnosis { return 'unhealthy' }
    Expect-Error 'SVC-005' { Start-BackendServices }
    Assert ($calls.Restart -eq 1) 'Worker restart count was incorrect.'
}
Test-Case 'API health timeout prevents worker readiness reporting' {
    function Invoke-Compose { return $ok }
    function Test-ApiHealth { return $false }
    function Test-Dispatcher { throw 'Readiness incorrectly continued after API failure.' }
    function Wait-Until($Check) { return (& $Check) }
    function Write-ServiceDiagnosis { return 'running' }
    Expect-Error 'SVC-003' { Start-BackendServices }
}
Test-Case 'Migration failure stops consumers and does not downgrade the schema' {
    $calls = [Collections.Generic.List[string]]::new()
    function Invoke-Compose($Arguments) {
        if ($Arguments[0] -eq 'stop') {
            $calls.Add($Arguments -join ' ')
            return $ok
        }
        $calls.Add(($Arguments[-2..-1] -join ' '))
        return $fail
    }
    Expect-Error 'DB-006' { Update-DatabaseSchema }
    Assert (($calls -join '|') -ceq 'current --check-heads|stop frontend dispatcher worker api|upgrade head') 'Unexpected migration sequence.'
}
Test-Case 'Harbourline diagnosis checks live catalog coverage' {
    function Get-ServiceState { return 'running/healthy/0/false' }
    function Invoke-Compose { return $ok }
    function Invoke-RestMethod($Uri) {
        if ($Uri -like '*/capabilities') { return @{ demo_intelligence = 'available' } }
        Assert ($Uri -like '*/intelligence/demo/processing') 'Expected the demo processing endpoint.'
        return @{ state = 'preparing'; indexed_datasets = 1; eligible_datasets = 2 }
    }
    function Invoke-DemoCheck { throw 'Core teaching presets do not describe this workspace.' }
    Write-DemoDiagnosis
    Assert ([IO.File]::ReadAllText($LogFile).Contains('Harbourline catalog state: preparing. Indexed 1 of 2')) 'Missing catalog diagnostics.'
}

Test-Case 'Up-to-date database skips upgrade on repeated start' {
    function Invoke-Compose($Arguments) {
        Assert ($Arguments[-1] -eq '--check-heads') 'An upgrade was attempted after a successful head check.'
        return $ok
    }
    Update-DatabaseSchema
}
Test-Case 'Frontend startup fails when proxy readiness does not pass' {
    function Invoke-Compose { return $ok }
    function Test-ApiHealth { return $false }
    function Write-ServiceDiagnosis { return 'running/unhealthy/0/false' }
    Expect-Error 'WEB-003' { Start-ContainerFrontend }
}

Test-Case 'Repeated frontend startup uses the same scoped Compose service' {
    $calls = [Collections.Generic.List[string]]::new()
    function Invoke-Compose($Arguments) { $calls.Add(($Arguments -join ' ')); return $ok }
    function Test-ApiHealth($Url) {
        Assert ($Url -ceq 'http://127.0.0.1:5197/api/v1/health') 'The configured proxy URL was ignored.'
        return $true
    }
    Start-ContainerFrontend
    Start-ContainerFrontend
    Assert ($calls.Count -eq 2 -and $calls[0] -ceq $calls[1] -and $calls[0] -match '^up .*--no-build .*--wait .*frontend$') 'Expected idempotent Compose startup.'
}

Test-Case 'Opening browser failure reports an actionable error' {
    function Start-Process { throw 'test error' }
    Open-PlatformBrowser 'http://127.0.0.1:5197/collection-jobs'
    Assert ([IO.File]::ReadAllText($LogFile).Contains('WEB-005')) 'Browser failure was not logged.'
    Expect-Error 'WEB-005' { Open-PlatformBrowser 'http://127.0.0.1:5198/' -Required }
}
Test-Case 'Graceful frontend shutdown writes only the owned stop marker' {
    $state = @{ Marker = ('b' * 32) }
    $stop = Join-Path $Local ('frontend-' + $state.Marker + '.stop')
    function Get-FrontendState { return $state }
    function Test-FrontendProcess { return !(Test-Path -LiteralPath $stop) }
    function Wait-Until($Check) { return (& $Check) }
    Stop-OwnedFrontend
    Assert (!(Test-Path -LiteralPath $stop)) 'The stop signal was not cleaned up.'
}
Test-Case 'Configured frontend port is checked against the owned container' {
    $calls = [Collections.Generic.List[string]]::new()
    function Test-BackendPort($Service, $InternalPort, $HostPort) {
        $calls.Add("$Service/$InternalPort/$HostPort")
        return $true
    }
    function Assert-PortAvailable($Port, $Code, $Name, [switch]$Owned) { Assert $Owned 'Owned port was not recognized.' }
    Assert-LauncherPorts
    Assert ($calls[0] -ceq 'frontend/8080/5197') 'Frontend port did not use the Compose binding.'
}

Test-Case 'Compose stop preserves volumes and checks for remaining project containers' {
    $calls = @{ Stop = 0; Inspect = 0 }
    function Stop-OwnedFrontend {}
    function Get-LauncherConfig { return @{ COMPOSE_PROJECT_NAME = 'test-project'; LAUNCHER_FIXTURE = '0' } }
    function Get-DockerTools { return @{ CLI = 'docker.exe' } }
    function Get-LinuxEngine { return @{ Code = 0; Out = 'linux' } }
    function Confirm-DockerOwnership { return $true }
    function Invoke-Compose($Arguments) {
        Assert (($Arguments -join ' ') -ceq 'stop') 'Compose received a destructive or unexpected command.'
        $calls.Stop++
        return $ok
    }
    function Invoke-Docker($Arguments) {
        Assert (($Arguments -join ' ') -match 'container ls .*label=com\.docker\.compose\.project=test-project') 'Project was not scoped.'
        $calls.Inspect++
        return $ok
    }
    Stop-Platform
    Assert ($calls.Stop -eq 1 -and $calls.Inspect -eq 1) 'Shutdown and its verification must each run once.'
}
Test-Case 'Native arguments preserve spaces and Unicode' {
    $command = Join-Path $env:SystemRoot 'System32/where.exe'
    $pattern = $Local + ':launcher.env'
    $result = Invoke-Tool $command @($pattern) 10
    # Where may use an OEM code page. Successful lookup verifies argument transmission.
    Assert ($result.Code -eq 0) 'Windows did not receive the Unicode path as a single argument.'
}
Test-Case 'Demo settings use a distinct identity, credentials, flags and ports' {
    $previousRoot = $Root
    $previousLocal = $Local
    try {
        $script:Root = $testRoot
        Set-LauncherMode
        $null = New-Item -ItemType Directory -Path $Local
        $normal = Get-LauncherConfig -Create
        Set-LauncherMode -Demo
        $null = New-Item -ItemType Directory -Path $Local
        $demo = Get-LauncherConfig -Create
        Assert ($demo.COMPOSE_PROJECT_NAME -match '^adaptive-web-core-demo-' -and
            $normal.COMPOSE_PROJECT_NAME -match '^adaptive-web-core-local-') 'Compose identities overlapped.'
        Assert ($demo.POSTGRES_PASSWORD -cne $normal.POSTGRES_PASSWORD -and
            $demo.POSTGRES_DB -cne $normal.POSTGRES_DB -and $demo.LAUNCHER_OWNER -cne $normal.LAUNCHER_OWNER) 'State credentials overlapped.'
        Assert ($demo.API_PORT -ne $normal.API_PORT -and $demo.FRONTEND_PORT -ne $normal.FRONTEND_PORT -and
            $demo.POSTGRES_PORT -ne $normal.POSTGRES_PORT) 'Default ports overlapped.'
        Assert ($demo.LAUNCHER_FIXTURE -eq '1' -and $demo.LOCAL_PROFILE_APPROVAL -eq '1' -and
            $normal.LAUNCHER_FIXTURE -eq '0' -and $normal.LOCAL_PROFILE_APPROVAL -eq '0') 'Mode defaults were wrong.'
        $normalFile = Join-Path $testRoot '.local/launcher.env'
        $demoFile = Join-Path $testRoot '.local-demo/launcher.env'
        $current = [IO.File]::ReadAllText($demoFile)
        Write-AtomicFile $demoFile ([IO.File]::ReadAllText($normalFile))
        Expect-Error 'CFG-001' { Get-LauncherConfig }
        Write-AtomicFile $demoFile ($current.Replace('LAUNCHER_FIXTURE=1', 'LAUNCHER_FIXTURE=0'))
        Expect-Error 'CFG-001' { Get-LauncherConfig }
    } finally {
        [IO.File]::Delete((Join-Path $testRoot '.local/launcher.env'))
        [IO.File]::Delete((Join-Path $testRoot '.local-demo/launcher.env'))
        $script:Root = $previousRoot
        Set-LauncherMode
        $script:Local = $previousLocal
    }
}
Test-Case 'Missing WSL stops before Docker installation' {
    $script:WSL = @{ Available = $false }
    try {
        function Get-DockerTools { return @{} }
        function Confirm-Change { return $false }
        function Install-DockerDesktop { throw 'Docker install ran before WSL was available.' }
        Expect-Error 'ENV-004' { Initialize-Docker $system }
    } finally { $script:WSL = @{ Available = $true } }
}

Test-Case 'Demo check diagnoses via a read-only command and failed provisioning blocks readiness' {
    function Invoke-Compose($Arguments, $Seconds) {
        $script:demoTestArguments = $Arguments
        return $fail
    }
    $null = Invoke-DemoCheck -ReadOnly
    Assert ($demoTestArguments[-1] -ceq '--check') 'Diagnostics did not select the read-only command.'
    Expect-Error 'DEMO-002' { Invoke-DemoProvisioning }
    Assert ($demoTestArguments[-1] -ceq 'backend.experiments.demo_provision') 'Startup did not call the provisioner.'
}
Test-Case 'One-click Demo preserves the preferred port or selects a free alternative' {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Server.ExclusiveAddressUse = $true
    $listener.Start()
    $port = $listener.LocalEndpoint.Port
    try {
        $selected = Find-DemoPort $port
        Assert ($selected -gt $port -and $selected -le $port + 19 -and $listener.Server.IsBound) 'The occupied port was affected.'
    } finally { $listener.Stop() }
    Assert ((Find-DemoPort $port) -eq $port) 'The now-free preferred port was skipped.'
}
Test-Case 'One-click Demo skips overlapping Windows routes and Docker networks' {
    function Get-NetRoute {
        '0.0.0.0/0', '0.0.0.0/1', '128.0.0.0/1', '10.249.0.0/16' |
            ForEach-Object { [pscustomobject]@{ DestinationPrefix = $_ } }
    }
    function Invoke-Docker($Arguments) {
        if ($Arguments[1] -eq 'ls') { return @{ Code = 0; Out = 'abcdef123456' } }
        return @{ Code = 0; Out = "10.250.0.0/23`n10.250.2.0/25`nfd47::/64" }
    }
    Assert (((Find-DemoSubnets) -join ',') -ceq '10.250.3.0/24,10.250.4.0/24') 'Subnets overlapped with existing routes.'
    function Invoke-Docker { return $fail }
    Expect-Error 'NET-004' { Find-DemoSubnets }
}
$script:Local = $OriginalLocal
Write-Host "$($Count - $Failures)/$Count launcher tests passed."
$testConfig = Join-Path (Join-Path $testRoot ('space ' + [char]0x6E2C + [char]0x8A66)) 'launcher.env'
[IO.File]::Delete($testConfig)
if ($Failures) { exit 1 }
