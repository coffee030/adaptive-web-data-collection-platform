param(
    [Parameter(Mandatory)]
    [ValidatePattern('^(reference(?:-[a-z0-9-]+)?|M22A-0[1-4])$')]
    [string]$Session,
    [string]$Project = 'm22c-operator-pilot',
    [string]$EnvFile = '.local/m22c/pilot.env'
)
$ErrorActionPreference = 'Stop'
$stack = @('-p',$Project,'--env-file',$EnvFile,
    '-f','compose.yaml','-f','compose.fixture.yaml','-f','backend/experiments/m22c.compose.yaml')
$directory = Join-Path '.local/m22c' $Session
$events = Get-Content -LiteralPath (Join-Path $directory 'session.jsonl') |
    ForEach-Object { ConvertFrom-Json -DateKind String $_ }
$start = $events | Where-Object event -eq 'start' | Select-Object -First 1
$stop = $events | Where-Object event -eq 'stop' | Select-Object -Last 1
if ($Session.StartsWith('reference') -and $events[-1].event -eq 'rehearsal_finished') {
    $since = $events[0].utc
    $until = $events[-1].utc
} elseif ($start -and $stop) {
    $since = $start.utc
    $until = ([DateTimeOffset]::Parse($events[-1].utc)).AddSeconds(2).ToString('o')
} else {
    throw 'No complete observation window. Preserve the evidence and record the gap.'
}
foreach ($entry in @(
    @{ Service = 'collection-fixture'; File = 'internal.jsonl' },
    @{ Service = 'browser-mirror'; File = 'mirror.jsonl' }
)) {
    $path = Join-Path $directory $entry.File
    if (Test-Path -LiteralPath $path) { throw "Receipt archive already exists at $path" }
    $receipts = docker compose @stack logs --no-color --no-log-prefix --since $since --until $until $entry.Service
    if ($LASTEXITCODE -ne 0) { throw "Could not capture fixture logs for $($entry.Service)" }
    [IO.File]::WriteAllLines((Join-Path $PWD $path), [string[]]@($receipts), [Text.UTF8Encoding]::new($false))
}
