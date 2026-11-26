$ErrorActionPreference = 'Stop'
$script:Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$script:Local = Join-Path $Root '.local'
$script:Frontend = Join-Path $Root 'frontend'
$script:Utf8 = New-Object System.Text.UTF8Encoding($false)
$script:DockerHost = 'npipe:////./pipe/dockerDesktopLinuxEngine'
$script:LogFile = $null

function Set-LauncherMode([switch]$Demo, [switch]$Pilot, [switch]$Harbourline) {
    $script:PilotMode = [bool]$Pilot
    $script:DemoMode = [bool]$Demo
    $script:Local = Join-Path $Root $(if ($Demo) { '.local-demo' } elseif ($Pilot) { '.local-pilot' } else { '.local' })
    $script:StartCommand = if ($Pilot) { 'Start-Harbourline-Pilot.bat' } elseif ($Harbourline) { 'Start-Harbourline-Demo.bat' } elseif ($Demo) { 'Start-FYP-Demo.bat' } else { 'Start-Platform.bat' }
    $modeArgument = if ($Pilot) { ' -Pilot' } elseif ($Demo) { ' -Demo' } else { '' }
    $script:DiagnoseCommand = "Diagnose-Platform.bat$modeArgument"
    $script:StopCommand = "Stop-Platform.bat$modeArgument"
}

function Write-LauncherLog($Level, $Message) {
    if ($LogFile) {
        [IO.File]::AppendAllText($LogFile, ('{0:o} [{1}] {2}{3}' -f [DateTimeOffset]::Now, $Level, $Message, [Environment]::NewLine), $Utf8)
    }
}

function Write-Step($Message) {
    Write-Host $Message
    Write-LauncherLog INFO $Message
}

function Stop-WithError($Code, $Title, $What, $Cause, $Advice, $Recovery = 'Not attempted.') {
    Write-LauncherLog ERROR "$Code $Title | $What | $Cause | Recovery: $Recovery"
    Write-Host ""
    Write-Host "[$Code] $Title"
    Write-Host "`nWhat happened:`n$What"
    Write-Host "`nPossible cause:`n$Cause"
    Write-Host "`nRecommended action:"
    $number = 0
    foreach ($item in @($Advice)) {
        $number++
        Write-Host "$number. $item"
    }
    Write-Host "`nAutomatic recovery:`n$Recovery"
    Write-Host "`nLog file:`n$LogFile"
    $exception = New-Object System.InvalidOperationException($Code)
    $exception.Data['LauncherError'] = $true
    throw $exception
}

function Write-AtomicFile($Path, [string]$Contents) {
    $temporary = "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        [IO.File]::WriteAllText($temporary, $Contents, $Utf8)
        if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) }
        else { [IO.File]::Move($temporary, $Path) }
    }
    finally { [IO.File]::Delete($temporary) }
}

function Protect-LocalDirectory {
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $identities = @([Security.Principal.WindowsIdentity]::GetCurrent().User,
        (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))
    foreach ($identity in $identities) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
            $identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    }
    [IO.Directory]::SetAccessControl($Local, $acl)
}

function Assert-LocalDirectory {
    $directory = Get-Item -LiteralPath $Local -Force
    if (!$directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        Stop-WithError 'CFG-002' 'Unsafe Local Settings Folder' 'The launcher cannot use .local as its private settings folder.' `
            'The location is not a regular directory or redirects to another location.' `
            @('Use a regular .local folder in a writable local checkout.')
    }
}

function Find-Application($Name, $Paths = @()) {
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $candidates = @($command.Source) + @($Paths)
    return $candidates | Where-Object { $_ -and [IO.File]::Exists($_) } | Select-Object -First 1
}

function ConvertTo-NativeArguments([string[]]$Arguments) {
    $quoted = foreach ($argument in $Arguments) {
        '"' + ($argument -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
    }
    return ($quoted -join ' ')
}

function Invoke-Tool($File, [string[]]$Arguments, $Seconds = 20, $Directory = $Root, [switch]$Interactive, $Environment = @{}) {
    $process = New-Object Diagnostics.Process
    $info = $process.StartInfo
    $info.FileName = $File
    if ([IO.Path]::GetFileName($File) -eq 'wsl.exe' -and $Arguments.Count -eq 1 -and $Arguments[0] -in @('--version', '--status')) {
        $info.Arguments = $Arguments[0]
        $info.StandardOutputEncoding = [Text.Encoding]::Unicode
    } else { $info.Arguments = ConvertTo-NativeArguments $Arguments }
    $info.WorkingDirectory = $Directory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = !$Interactive
    $info.RedirectStandardOutput = !$Interactive
    $info.RedirectStandardError = !$Interactive
    foreach ($key in $Environment.Keys) {
        if ($null -eq $Environment[$key]) { $info.EnvironmentVariables.Remove($key) }
        else { $info.EnvironmentVariables[$key] = $Environment[$key] }
    }
    try {
        $null = $process.Start()
        if (!$Interactive) {
            $stdout = $process.StandardOutput.ReadToEndAsync()
            $stderr = $process.StandardError.ReadToEndAsync()
        }
        if (!$process.WaitForExit($Seconds * 1000)) {
            try { $process.Kill() } catch [InvalidOperationException] {}
            return @{ Code = -1; Out = ''; Err = ''; Reason = 'timeout' }
        }
        $output = ''
        $errorOutput = ''
        if (!$Interactive) {
            if (!$stdout.Wait(1500) -or !$stderr.Wait(1500)) {
                return @{ Code = -1; Out = ''; Err = ''; Reason = 'output timeout' }
            }
            $output = $stdout.Result.Replace([string][char]0, '').Trim()
            $errorOutput = $stderr.Result.Replace([string][char]0, '').Trim()
        }
        return @{ Code = $process.ExitCode; Out = $output; Err = $errorOutput; Reason = (Get-SafeReason "$output $errorOutput") }
    }
    catch [ComponentModel.Win32Exception] {
        return @{ Code = -1; Out = ''; Err = ''; Reason = "Windows error $($_.Exception.NativeErrorCode)" }
    }
    finally { $process.Dispose() }
}

function Get-SafeReason($Text) {
    switch -Regex ($Text) {
        'password authentication failed' { return 'database login rejected' }
        'permission denied|access is denied|unauthorized|forbidden|EACCES|EPERM' { return 'access denied' }
        'address already in use|port is already allocated|EADDRINUSE|failed to bind' { return 'port already allocated' }
        'all predefined address pools|could not find an available.*address pool|pool overlaps' { return 'Docker network address pools exhausted' }
        'no space left|ENOSPC' { return 'insufficient disk space' }
        'out of memory|cannot allocate memory|OOMKilled' { return 'insufficient memory' }
        'no matching manifest|pull access denied|manifest unknown|failed to resolve source metadata' { return 'container image unavailable' }
        'can.t locate revision|target database is not up to date|multiple head revisions' { return 'migration revision mismatch' }
        'EUSAGE|package-lock.json.*in sync' { return 'package manifest and lockfile mismatch' }
        'ERR_MODULE_NOT_FOUND|cannot find module' { return 'frontend module missing' }
        'certificate|CERT_' { return 'certificate validation problem' }
        'timeout|timed out|ETIMEDOUT|EAI_AGAIN' { return 'timeout' }
        'connection refused|ECONNREFUSED' { return 'connection refused' }
        'could not resolve|no such host|network is unreachable|ENOTFOUND' { return 'registry or network unavailable' }
        'system cannot find the file specified|cannot connect to the docker daemon|error during connect' { return 'Docker or a required local file is unavailable' }
        default { return 'no recognized details' }
    }
}

function Wait-Until([scriptblock]$Check, [int]$Seconds, [int]$Interval = 2) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        if (& $Check) { return $true }
        if ($timer.Elapsed.TotalSeconds -ge $Seconds) { break }
        Start-Sleep -Seconds $Interval
    } while ($timer.Elapsed.TotalSeconds -lt $Seconds)
    return $false
}

function Confirm-Change($Message) {
    Write-Host $Message
    if ($script:NonInteractive -or [Console]::IsInputRedirected) { return $false }
    return (Read-Host 'Type YES to continue') -ceq 'YES'
}

function Get-LauncherConfig([switch]$Create, [switch]$Probe, [switch]$AutoDemoNetwork) {
    if (Test-Path -LiteralPath $Local) { Assert-LocalDirectory }
    $file = Join-Path $Local 'launcher.env'
    if ((Test-Path -LiteralPath $file) -and ((Get-Item -LiteralPath $file -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        Stop-WithError 'CFG-001' 'Invalid Local Settings' 'The settings file redirects to another location.' `
            'The launcher requires a regular launcher.env file.' @('Restore a private copy of launcher.env.')
    }
    if (!(Test-Path -LiteralPath $file)) {
        if (!$Create) { return $null }
        if (Test-Path -LiteralPath (Join-Path $Root '.env')) {
            Write-Step '[INFO] Found a manual .env file. The launcher will use its own database and settings.'
        }
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $password = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
        $owner = [Guid]::NewGuid().ToString('N')
        $mode = if ($DemoMode) { 'demo' } elseif ($PilotMode) { 'pilot' } else { 'local' }
        $offset = if ($DemoMode) { 1 } elseif ($PilotMode) { 2 } else { 0 }
        $fixture = [int][bool]$DemoMode
        $postgresPort = 55497 + $offset
        $apiPort = 58097 + $offset
        $frontendPort = 5197 + $offset
        $networkSettings = ''
        if ($AutoDemoNetwork -or $PilotMode) {
            $postgresPort = Find-DemoPort $postgresPort
            $apiPort = Find-DemoPort $apiPort
            $frontendPort = Find-DemoPort $frontendPort
        }
        if ($AutoDemoNetwork) {
            $subnets = Find-DemoSubnets
            $networkSettings = "`nLAUNCHER_SUBNET=$($subnets[0])`nLAUNCHER_FIXTURE_SUBNET=$($subnets[1])"
        }
        $contents = @"
LAUNCHER_OWNER=$owner
COMPOSE_PROJECT_NAME=adaptive-web-core-$mode-$($owner.Substring(0,12))
POSTGRES_USER=collection_$mode
POSTGRES_DB=collection_$mode
POSTGRES_PASSWORD=$password
POSTGRES_PORT=$postgresPort
API_PORT=$apiPort
FRONTEND_PORT=$frontendPort
LAUNCHER_FIXTURE=$fixture
LOCAL_PROFILE_APPROVAL=$fixture$networkSettings
"@
        Write-AtomicFile $file ($contents + [Environment]::NewLine)
        Write-Step '[PASS] Created private local settings.'
    }
    elseif (!$Probe) { Write-Step '[INFO] Reading existing local settings.' }

    $mode = if ($DemoMode) { 'demo' } elseif ($PilotMode) { 'pilot' } else { 'local' }
    $fixtureFlag = if ($DemoMode) { '1' } else { '[01]' }
    $rules = @{
        LAUNCHER_OWNER = '[a-f0-9]{32}'
        COMPOSE_PROJECT_NAME = "adaptive-web-core-$mode-[a-f0-9]{12}"
        POSTGRES_USER = "collection_$mode"
        POSTGRES_DB = "collection_$mode"
        POSTGRES_PASSWORD = '[a-f0-9]{64}'
        POSTGRES_PORT = '[0-9]{4,5}'
        API_PORT = '[0-9]{4,5}'
        FRONTEND_PORT = '[0-9]{4,5}'
        LAUNCHER_FIXTURE = $fixtureFlag
        LOCAL_PROFILE_APPROVAL = $fixtureFlag
    }
    $required = @($rules.Keys)
    $subnetPattern = '(?:10\.(?:[0-9]{1,3})|172\.(?:1[6-9]|2[0-9]|3[01])|192\.168)\.[0-9]{1,3}\.0/24'
    $rules['LAUNCHER_SUBNET'] = $subnetPattern
    $rules['LAUNCHER_FIXTURE_SUBNET'] = $subnetPattern
    $config = @{}
    $valid = $true
    foreach ($line in [IO.File]::ReadAllLines($file)) {
        if ($line -match '^\s*(#.*)?$') { continue }
        if ($line -cmatch '^([A-Z_]+)=(.*)$') {
            $key = $Matches[1]
            $value = $Matches[2]
            if ($rules.ContainsKey($key) -and !$config.ContainsKey($key) -and $value -cmatch "\A$($rules[$key])\z") {
                $config[$key] = $value
                continue
            }
        }
        $valid = $false
        break
    }
    $ports = @($config.POSTGRES_PORT, $config.API_PORT, $config.FRONTEND_PORT)
    $subnets = @($config.LAUNCHER_SUBNET, $config.LAUNCHER_FIXTURE_SUBNET) | Where-Object { $_ }
    $invalidOctets = @($subnets -split '[./]' | Where-Object { [int]$_ -gt 255 -or $_ -match '^0\d' })
    if (!$valid -or @($required | Where-Object { !$config.ContainsKey($_) }).Count -or $invalidOctets.Count -or
        ($config.LAUNCHER_SUBNET -and $config.LAUNCHER_SUBNET -eq $config.LAUNCHER_FIXTURE_SUBNET) -or
        $config.COMPOSE_PROJECT_NAME -cne "adaptive-web-core-$mode-$($config.LAUNCHER_OWNER -replace '^(.{12}).*$', '$1')" -or
        @($ports | Sort-Object -Unique).Count -ne 3 -or
        @($ports | Where-Object { [int]$_ -lt 1024 -or [int]$_ -gt 65535 -or $_.StartsWith('0') }).Count) {
        Stop-WithError 'CFG-001' 'Invalid Local Settings' 'The launcher settings failed validation.' `
            'A setting is missing, duplicated, or invalid.' @('Restore the original launcher.env from your private backup.', 'See the Windows setup guide for supported settings.')
    }
    if (!$Probe) { Write-Step '[PASS] Local settings validated.' }
    return $config
}
