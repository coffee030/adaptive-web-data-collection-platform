function Get-SystemFacts {
    $build = [Environment]::OSVersion.Version.Build
    $buildFromRegistry = Get-ItemPropertyValue 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' CurrentBuildNumber -ErrorAction SilentlyContinue
    if ($buildFromRegistry) { $build = [int]$buildFromRegistry }
    $architecture = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITEW6432')
    if (!$architecture) { $architecture = $env:PROCESSOR_ARCHITECTURE }
    $os = $null
    $cpu = @()
    $computer = $null
    try {
        $os = Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 4
        $computer = Get-CimInstance Win32_ComputerSystem -OperationTimeoutSec 4
        $cpu = @(Get-CimInstance Win32_Processor -OperationTimeoutSec 4)
    } catch { Write-LauncherLog WARN 'Windows hardware details are unavailable from CIM.' }
    $virtualization = 'unknown'
    if ($computer.HypervisorPresent -or @($cpu | Where-Object VirtualizationFirmwareEnabled).Count) { $virtualization = 'available' }
    elseif ($cpu.Count -and @($cpu | Where-Object { $_.VirtualizationFirmwareEnabled -eq $false }).Count -eq $cpu.Count) { $virtualization = 'disabled' }

    $disk = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($Root))
    $freeGB = [math]::Round($disk.AvailableFreeSpace / 1GB, 1)
    $localDisk = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($env:LOCALAPPDATA))
    $dockerGB = [math]::Round($localDisk.AvailableFreeSpace / 1GB, 1)
    $ram = 'unknown'
    if ($os) { $ram = '{0:N1} GB total, {1:N1} GB free' -f ($os.TotalVisibleMemorySize / 1MB), ($os.FreePhysicalMemory / 1MB) }
    Write-Step "[INFO] Windows build $build ($architecture), PowerShell $($PSVersionTable.PSVersion), RAM: $ram."
    Write-Step "[INFO] Free disk space: checkout $freeGB GB, default Docker drive $dockerGB GB. Hardware virtualization: $virtualization."
    return @{ Build = $build; Architecture = $architecture; Virtualization = $virtualization; FreeGB = $freeGB; DockerGB = $dockerGB; RAM = $computer.TotalPhysicalMemory }
}

function Get-WSLStatus {
    $file = Join-Path $env:SystemRoot 'System32/wsl.exe'
    $version = Invoke-Tool $file @('--version') 8
    $status = Invoke-Tool $file @('--status') 8
    $number = [regex]::Match($version.Out, '\b[0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?\b').Value
    $modern = $number -and [version]$number -ge [version]'2.1.5'
    Write-Step "[INFO] WSL version: $(if ($number) { $number } else { 'unavailable' }); status exit: $($status.Code)."
    return @{ File = $file; Available = ($version.Code -eq 0 -and $status.Code -eq 0 -and $modern); Outdated = ($number -and !$modern) }
}

function Get-DockerTools {
    $roots = @((Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop'), (Join-Path $env:ProgramFiles 'Docker/Docker'))
    $desktop = $roots | ForEach-Object { Join-Path $_ 'Docker Desktop.exe'; Join-Path $_ 'frontend/Docker Desktop.exe' } |
        Where-Object { [IO.File]::Exists($_) } | Select-Object -First 1
    $cli = $null
    if ($desktop) { $cli = Find-Application 'docker.exe' @($roots | ForEach-Object { Join-Path $_ 'resources/bin/docker.exe' }) }
    if (!$cli) { $cli = Find-Application 'docker.exe' }
    return @{ Desktop = $desktop; CLI = $cli }
}

function Get-LinuxEngine($Docker) {
    if (!$Docker.CLI) { return @{ Code = -1; Out = ''; Reason = 'Docker CLI unavailable' } }
    return Invoke-Tool $Docker.CLI @('--host', $DockerHost, 'info', '--format', '{{.OSType}}') 8 -Environment @{
        DOCKER_HOST = $null; DOCKER_CONTEXT = $null; DOCKER_TLS_VERIFY = $null; DOCKER_CERT_PATH = $null
    }
}

function Test-LinuxEngine($Result) { return $Result.Code -eq 0 -and $Result.Out -ceq 'linux' }

function Install-DockerDesktop($System) {
    if ($System.Build -lt 22631 -or $System.Architecture -notin @('AMD64', 'ARM64') -or
        ($System.RAM -and $System.RAM -lt 7GB)) {
        Stop-WithError 'ENV-005' 'Docker Desktop Requirements Are Unmet' 'The computer did not pass Docker Desktop installation checks.' `
            'Docker Desktop requires a supported Windows release, 64-bit CPU, and about 8 GB RAM.' `
            @('Check the current requirements at https://docs.docker.com/desktop/setup/install/windows-install/.')
    }
    $architecture = if ($System.Architecture -eq 'AMD64') { 'amd64' } else { 'arm64' }
    $uri = "https://desktop.docker.com/win/main/$architecture/Docker%20Desktop%20Installer.exe"
    if (!(Confirm-Change 'Docker Desktop is missing. Download the signed installer from Docker and install for this user using WSL 2? Read and accept Docker terms in Docker Desktop when it opens. Windows may ask for permissions.')) {
        Stop-WithError 'ENV-005' 'Docker Desktop Is Missing' 'Start requires Docker Desktop and its Linux Engine.' 'Installation approval was unavailable or declined.' `
            @('Run Setup-Platform.bat and approve the install, or install Docker Desktop from the official Docker website.')
    }
    $installer = Join-Path $Local "DockerDesktop-$([Guid]::NewGuid().ToString('N')).exe"
    try {
        Write-Step '[INFO] Downloading the Docker Desktop installer from Docker.'
        $curl = Join-Path $env:SystemRoot 'System32/curl.exe'
        $download = Invoke-Tool $curl @('--fail', '--silent', '--show-error', '--connect-timeout', '15', '--max-time', '900', '--output', $installer, $uri) 910
        if ($download.Code -ne 0) {
            Stop-WithError 'ENV-008' 'Docker Download Failed' 'The official installer could not be downloaded.' $download.Reason `
                @('Check your connection or download the installer from the Docker Desktop installation guide.') 'Failed.'
        }
        $signature = Get-AuthenticodeSignature -LiteralPath $installer
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)CN="?Docker Inc\.?"?(?:,|$)') {
            Stop-WithError 'ENV-008' 'Docker Installer Verification Failed' 'Windows could not verify the Docker publisher.' 'The signature was invalid or the publisher was unexpected.' `
                @('Download Docker Desktop from the official Docker website and check the digital signature.') 'Failed. The installer was never run.'
        }
        $installed = Invoke-Tool $installer @('install', '--user', '--backend=wsl-2') 1200 -Interactive
        Write-LauncherLog INFO "Docker installer exit: $($installed.Code)."
        if ($installed.Code -ne 0 -or !(Get-DockerTools).Desktop) {
            Stop-WithError 'ENV-008' 'Docker Installation Could Not Be Verified' 'The Docker installer did not leave a verified installation.' `
                "Installer exit $($installed.Code). Windows may require a restart or user action." @('Complete the installer or any requested Windows restart, then run Setup-Platform.bat again.') 'Failed.'
        }
    }
    finally { [IO.File]::Delete($installer) }
}

function Initialize-Docker($System) {
    $docker = Get-DockerTools
    $engine = Get-LinuxEngine $docker
    if (!(Test-LinuxEngine $engine)) {
        if ($System.Virtualization -eq 'disabled') {
            Stop-WithError 'ENV-003' 'Hardware Virtualization Is Disabled' 'Windows reports that firmware virtualization is disabled.' `
                'AMD SVM Mode or Intel Virtualization Technology may be disabled in BIOS/UEFI.' `
                @('Restart into BIOS/UEFI and enable hardware virtualization.', 'Start Windows, open Docker Desktop, and run Start-Platform.bat again.')
        }
        if (!$script:WSL.Available -and $engine.Reason -ne 'access denied') {
            $flag = if ($script:WSL.Outdated) { '--update' } else { '--install' }
            $arguments = if ($flag -eq '--install') { @($flag, '--no-distribution') } else { @($flag) }
            if (Confirm-Change "WSL 2 could not be verified. Run wsl $($arguments -join ' ') with administrator approval? Windows may request a restart.") {
                Write-Step "[INFO] Requesting Windows approval for wsl $flag."
                try {
                    $wslSetup = Start-Process -FilePath $script:WSL.File -ArgumentList $arguments -Verb RunAs -PassThru
                    if ($wslSetup.WaitForExit(300000)) { Write-LauncherLog INFO "WSL setup exit: $($wslSetup.ExitCode)." }
                    else { Write-LauncherLog WARN 'WSL setup is still running.' }
                }
                catch { Write-LauncherLog WARN 'Windows did not start WSL setup.' }
                $script:WSL = Get-WSLStatus
            }
            if (!$script:WSL.Available) {
                Stop-WithError 'ENV-004' 'WSL 2 Is Unavailable' 'The WSL checks did not verify a working WSL installation.' `
                    'WSL may be outdated or the Virtual Machine Platform feature may need enabling or a restart.' `
                    @('Follow https://learn.microsoft.com/windows/wsl/install.', 'Complete any Windows restart, then run Setup-Platform.bat again.')
            }
        }
        if (!$docker.Desktop -and !$docker.CLI) {
            Install-DockerDesktop $System
            $docker = Get-DockerTools
        }
        elseif (!$docker.Desktop) {
            Stop-WithError 'ENV-005' 'Docker Desktop Installation Is Unverified' 'A Docker CLI was found, but the local Desktop application could not be located.' `
                'Docker Desktop may use a custom location or the CLI may belong to another Docker installation.' `
                @('Open Docker Desktop from the Start menu and try again.', 'Repair or install Docker Desktop if the Start menu entry is missing.')
        }
        if (!$docker.CLI) {
            Stop-WithError 'ENV-005' 'Docker CLI Is Unavailable' 'Docker Desktop was located, but its CLI is unavailable.' 'The installation may be incomplete.' `
                @('Repair Docker Desktop using the official installer.')
        }
        if ($engine.Reason -eq 'access denied') {
            Stop-WithError 'ENV-006' 'Docker Engine Access Was Denied' 'Windows denied access to the local Docker Linux Engine.' `
                'Docker Desktop or the current Windows security context blocks access to its local engine.' `
                @('Open Docker Desktop using the same Windows account.', 'If access is managed by your school, ask its IT support.')
        }
        Write-Step '[INFO] Waiting for Docker Desktop. Complete any Docker setup or license prompts.'
        $attempt = 'Attempted. Docker Linux Engine did not become ready.'
        try { if ($docker.Desktop -and !(Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue)) {
            Start-Process -FilePath $docker.Desktop -WindowStyle Hidden
        } } catch { Write-LauncherLog WARN 'Windows did not start Docker Desktop.' }
        $probe = @{ Engine = $engine }
        if (!(Wait-Until { $probe.Engine = Get-LinuxEngine $docker; Test-LinuxEngine $probe.Engine } 120 3)) {
            Stop-WithError 'ENV-006' 'Docker Linux Engine Is Unavailable' 'The Docker Desktop Linux Engine did not respond within the startup window.' `
                $probe.Engine.Reason @('Open Docker Desktop and finish its prompts.', 'Check that it uses Linux containers and the WSL 2 backend.', 'Run Diagnose-Platform.bat if the problem persists.') $attempt
        }
        Write-LauncherLog INFO 'Docker startup recovery succeeded.'
    }
    $compose = Invoke-Tool $docker.CLI @('--host', $DockerHost, 'compose', 'version', '--short') 10
    if ($compose.Code -ne 0 -or $compose.Out -notmatch '^v?(?<major>\d+)\.(?<minor>\d+)') {
        Stop-WithError 'ENV-007' 'Docker Compose Is Unavailable' 'The Docker Compose plugin did not return a usable version.' `
            $compose.Reason @('Update or repair Docker Desktop.')
    }
    if ([int]$Matches.major -lt 2 -or ([int]$Matches.major -eq 2 -and [int]$Matches.minor -lt 20)) {
        Stop-WithError 'ENV-007' 'Docker Compose Is Outdated' 'The launcher needs Docker Compose 2.20 or later.' `
            'The installed plugin is older than the supported minimum.' @('Update Docker Desktop.')
    }
    Write-Step "[PASS] Docker Linux Engine and Compose $($compose.Out) are available."
    return $docker
}

function Get-NodeTools {
    $paths = @((Join-Path $env:ProgramFiles 'nodejs/node.exe'), (Join-Path $env:LOCALAPPDATA 'Programs/nodejs/node.exe'))
    $node = Find-Application 'node.exe' $paths
    if (!$node) { return @{ State = 'missing' } }
    $result = Invoke-Tool $node @('--version') 8 -Environment @{ NODE_OPTIONS = $null; NODE_PATH = $null }
    $version = [regex]::Match($result.Out, '^v(?<version>\d+\.\d+\.\d+)$').Groups['version'].Value
    if ($result.Code -ne 0 -or !$version) { return @{ State = 'unusable'; Node = $node } }
    $parsed = [version]$version
    # The root manifest is less restrictive than locked Playwright and React plugin versions.
    if (!(($parsed.Major -eq 22 -and $parsed.Minor -ge 13) -or $parsed -ge [version]'23.5.0')) {
        return @{ State = 'incompatible'; Node = $node; Version = $version }
    }
    $npm = Join-Path (Split-Path $node) 'npm.cmd'
    $cli = Join-Path (Split-Path $node) 'node_modules/npm/bin/npm-cli.js'
    if (!(Test-Path -LiteralPath $npm) -or !(Test-Path -LiteralPath $cli)) { return @{ State = 'npm unavailable'; Node = $node; Version = $version } }
    $tools = @{ State = 'healthy'; Node = $node; Npm = $npm; Version = $version }
    $npmVersion = Invoke-Npm $tools @('--version') 10
    if ($npmVersion.Code -ne 0 -or $npmVersion.Out -notmatch '^\d+\.\d+\.\d+') { $tools.State = 'npm unusable' }
    else { $tools.NpmVersion = $npmVersion.Out }
    return $tools
}

function Invoke-Npm($Node, [string[]]$Arguments, $Seconds) {
    # Use npm.cmd with fixed launcher arguments. CMD expands the quoted executable path once.
    $processEnv = @{ LAUNCHER_NPM_COMMAND = $Node.Npm; NODE_OPTIONS = $null; NODE_PATH = $null
        NPM_CONFIG_PRODUCTION = $null; NPM_CONFIG_OMIT = $null; NPM_CONFIG_INCLUDE = $null; NODE_ENV = $null }
    $file = Join-Path $env:SystemRoot 'System32/cmd.exe'
    $native = @('/d', '/v:off', '/c', '%LAUNCHER_NPM_COMMAND%') + $Arguments
    return Invoke-Tool $file $native $Seconds $Frontend -Environment $processEnv
}

function Initialize-Node {
    $node = Get-NodeTools
    if ($node.State -ne 'healthy') {
        Write-Step "[INFO] Node.js status: $($node.State) $($node.Version)."
        $id = 'OpenJS.NodeJS.22'
        $winget = Find-Application 'winget.exe' @((Join-Path $env:LOCALAPPDATA 'Microsoft/WindowsApps/winget.exe'))
        $available = $null
        if ($winget) {
            $query = Invoke-Tool $winget @('show', '--id', $id, '--exact', '--source', 'winget', '--versions', '--disable-interactivity') 35
            $versions = [regex]::Matches($query.Out, '(?m)^\s*(22\.\d+\.\d+)\s*$')
            $available = $versions | ForEach-Object { [version]$_.Groups[1].Value } |
                Where-Object { $_ -ge [version]'22.13.0' } | Sort-Object -Descending | Select-Object -First 1
        }
        $recovery = 'Not attempted. No approved compatible installer was available.'
        if ($available -and (Confirm-Change "Install Node.js $available with npm from the verified Windows Package Manager source? The Node.js installer may ask for administrator permissions.")) {
            Write-Step "[INFO] Starting WinGet for Node.js $available. Review the package and any installer prompts."
            $installed = Invoke-Tool $winget @('install', '--id', $id, '--exact', '--version', "$available", '--source', 'winget', '--interactive') 900 -Interactive
            Write-LauncherLog INFO "WinGet exit: $($installed.Code)."
            $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
            $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
            $env:Path = "$machinePath;$userPath;$env:Path"
            $node = Get-NodeTools
            $recovery = "WinGet installation attempted. Installer exit: $($installed.Code)."
        }
        if ($node.State -ne 'healthy') {
            Stop-WithError 'ENV-009' 'A Compatible Node.js and npm Are Required' 'The frontend dependency check could not verify Node.js and npm.' `
                "Node.js status: $($node.State). WinGet may be unavailable or installation may require approval." `
                @('Install a compatible Node.js 22 release from https://nodejs.org/en/download and include npm.', 'Close and reopen Start-Platform.bat.') $recovery
        }
    }
    Write-Step "[PASS] Node.js $($node.Version) and npm $($node.NpmVersion) verified."
    return $node
}

function Test-FrontendDependencies($Node) {
    if (!(Test-Path -LiteralPath (Join-Path $Frontend 'node_modules/.package-lock.json'))) { return $false }
    $check = Invoke-Tool $Node.Node @((Join-Path $PSScriptRoot 'check-dependencies.cjs')) 20 $Frontend -Environment @{ NODE_OPTIONS = $null; NODE_PATH = $null }
    Write-LauncherLog INFO "Frontend locked dependency check exit: $($check.Code)."
    return $check.Code -eq 0
}

function Initialize-FrontendDependencies($Node) {
    if (!(Test-FrontendDependencies $Node)) {
        Write-Step '[INFO] Installing frontend dependencies from package-lock.json. This can take a few minutes.'
        $installArgs = @('ci', '--include=dev', '--include=optional', '--no-audit', '--no-fund', '--fetch-retries=1')
        $installed = Invoke-Npm $Node $installArgs 600
        Write-LauncherLog INFO "npm ci exit: $($installed.Code); details: $($installed.Reason)."
        if ($installed.Code -ne 0 -or !(Test-FrontendDependencies $Node)) {
            Stop-WithError 'WEB-001' 'Frontend Dependency Installation Failed' 'The locked npm packages could not be installed and verified.' `
                $installed.Reason @('Check network access to the package registry and available disk space.', 'Check that package.json and package-lock.json match this checkout.', 'Run Setup-Platform.bat again.') 'Attempted with npm ci.'
        }
    }
    Write-Step '[PASS] Frontend dependencies match the lockfile.'
}
