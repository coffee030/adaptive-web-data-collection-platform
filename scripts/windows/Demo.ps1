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
    $result = Invoke-DemoCheck -ReadOnly
    Write-Step "[INFO] All Synthetic Demo baselines verified: $($fixtureReady -and $migration.Code -eq 0 -and $result.Code -eq 0)."
}
