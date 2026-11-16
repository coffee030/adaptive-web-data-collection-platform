#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

function Install-DemoShortcut([string]$Desktop, [string]$Checkout) {
    if (!$Desktop -or !(Test-Path -LiteralPath $Desktop -PathType Container)) {
        throw 'Windows could not locate your Desktop folder. Restore access to it and retry.'
    }
    $target = Join-Path $Checkout 'Start-FYP-Demo.bat'
    if (!(Test-Path -LiteralPath $target -PathType Leaf)) {
        throw 'Start-FYP-Demo.bat is missing. Run the installer from the complete checkout.'
    }
    $path = Join-Path $Desktop 'FYP Demo.lnk'
    $description = 'Adaptive Web Data Collection Platform | FYP Synthetic Demo'
    $icon = (Join-Path $env:SystemRoot 'System32/shell32.dll') + ',14'
    $shell = New-Object -ComObject WScript.Shell
    $exists = Test-Path -LiteralPath $path
    if ($exists) {
        $item = Get-Item -LiteralPath $path -Force
        if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'FYP Demo.lnk is already in use. Move the existing item yourself before retrying.'
        }
        $existing = $shell.CreateShortcut($path)
        if ($existing.Description -cne $description -or $existing.Arguments -or
            [IO.Path]::GetFileName($existing.TargetPath) -ine 'Start-FYP-Demo.bat') {
            throw 'The Desktop already has an unrelated FYP Demo shortcut. Move or rename it yourself before retrying.'
        }
        if ($existing.TargetPath -ieq $target -and $existing.WorkingDirectory -ieq $Checkout -and
            $existing.IconLocation -ieq $icon -and $existing.WindowStyle -eq 1) {
            return 'Already installed'
        }
    }

    $temporary = Join-Path $Desktop ('.fyp-demo-' + [Guid]::NewGuid().ToString('N') + '.lnk')
    try {
        $link = $shell.CreateShortcut($temporary)
        $link.TargetPath = $target
        $link.WorkingDirectory = $Checkout
        $link.Description = $description
        $link.IconLocation = $icon
        $link.WindowStyle = 1
        $link.Save()
        if ($exists) {
            [IO.File]::Replace($temporary, $path, [NullString]::Value)
            return 'Updated'
        }
        [IO.File]::Move($temporary, $path)
        return 'Installed'
    } finally {
        [IO.File]::Delete($temporary)
    }
}

if ($MyInvocation.InvocationName -eq '.') { return }
try {
    $checkout = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
    $desktop = [Environment]::GetFolderPath('DesktopDirectory')
    $result = Install-DemoShortcut $desktop $checkout
    Write-Host "[SUCCESS] ${result}. Double-click FYP Demo on your Desktop to start the Synthetic Demo."
    exit 0
} catch {
    Write-Host "[ERROR] The FYP Demo shortcut could not be installed. $($_.Exception.Message)"
    exit 1
}
