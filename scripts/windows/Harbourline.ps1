function Initialize-HarbourlineSettings {
    $secretPath = Join-Path $Local 'harbourline-operator.token'
    if ((Test-Path -LiteralPath $secretPath) -and
        ((Get-Item -LiteralPath $secretPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        Stop-WithError 'HL-001' 'Invalid Harbourline Operator Settings' 'The local demo token file redirects elsewhere.' `
            'A private regular token file is required.' @('Remove the redirect from the isolated demo settings and retry.')
    }
    if (!(Test-Path -LiteralPath $secretPath)) {
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        Write-AtomicFile $secretPath ([BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant())
    }
    $token = [IO.File]::ReadAllText($secretPath)
    if ($token -cnotmatch '^[a-f0-9]{64}$') {
        Stop-WithError 'HL-001' 'Invalid Harbourline Operator Settings' 'The local demo token could not be validated.' `
            'The private token file has an unexpected format.' @('Restore the isolated demo token file and retry.')
    }
    $Config['MARKETING_OPERATOR_TOKEN'] = $token
    $Config['MARKETING_DEMO_ENABLED'] = '1'
    $Config['MARKETING_PARTNER_WORKSPACE'] = ''
    $Config['MARKETING_CUSTOMER_TOKEN'] = ''
    $Config['MARKETING_YOUTUBE_RESEARCH'] = '0'
    $Config['MARKETING_YOUTUBE_DISCOVERY'] = '0'
    $Config['MARKETING_ONNX'] = '0'
}

function Initialize-HarbourlineImage {
    if ($HarbourlineTextOnly) {
        Write-Step '[INFO] Harbourline will use text retrieval for this start.'
        Update-PlatformImage api
        return
    }
    $Config['MARKETING_ONNX'] = '1'
    if (!(Update-PlatformImage api -AllowFailure)) {
        Write-Step '[WARN] Could not prepare ONNX dependencies. Starting with text retrieval.'
        $Config['MARKETING_ONNX'] = '0'
        Update-PlatformImage api
        return
    }
    $directory = Join-Path $Local 'harbourline-granite'
    foreach ($path in @($directory, (Join-Path $directory 'onnx'), (Join-Path $directory 'tokenizer.json'),
            (Join-Path $directory 'onnx/model_quint8_avx2.onnx'))) {
        if ((Test-Path -LiteralPath $path) -and
            ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            Write-Step '[WARN] Model cache redirects outside its private location. Starting with text retrieval.'
            return
        }
    }
    $null = New-Item -ItemType Directory -Path $directory -Force
    $image = "$($Config.COMPOSE_PROJECT_NAME)-backend:local"
    $helper = [Guid]::NewGuid().ToString('N')
    $name = "harbourline-model-$helper"
    Write-Step '[INFO] Verifying the pinned Granite files. Missing files will be downloaded.'
    $prepared = Invoke-Docker @('run', '--rm', '--name', $name, '--mount',
        "type=bind,source=$directory,target=/models", $image,
        'python', '-m', 'backend.intelligence.fetch_model', '/models') 180
    if ($prepared.Code -ne 0) {
        $label = Invoke-Docker @('container', 'inspect', '--format', '{{.Name}}', $name)
        if ($label.Code -eq 0 -and $label.Out -ceq "/$name") {
            $null = Invoke-Docker @('container', 'rm', '-f', $name)
        }
        Write-Step '[WARN] Granite files could not be prepared. Starting with text retrieval.'
        return
    }
    $Config['MARKETING_MODEL_HOST_DIR'] = $directory
    Write-Step '[PASS] Granite files passed pinned digest verification.'
}

function Invoke-HarbourlineProvisioning {
    Write-Step '[INFO] Preparing fictional creator data and validating the Core CSV Evidence.'
    $result = Invoke-Compose @('exec', '-T', 'api', 'python', '-m', 'backend.experiments.marketing_m2.harbourline_demo') 160
    if ($result.Code -ne 0) {
        $detail = @($result.Out -split '\r?\n' | Where-Object { $_ -match '(DemoError|EvidenceError):' } | Select-Object -Last 1) -join ''
        Stop-WithError 'HL-002' 'Harbourline Demo Could Not Be Prepared' 'Fictional intelligence or its collection evidence could not be verified.' `
            "$($result.Reason) $detail" @('Run Diagnose-Platform.bat -Demo and review the fixture and backend state.')
    }
    foreach ($line in ($result.Out -split '\r?\n')) {
        if ($line -match '^PASS ') { Write-Step "[HARBOURLINE] $line" }
    }
}