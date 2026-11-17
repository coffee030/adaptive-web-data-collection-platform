# Dot-source from the repository root. Use a dedicated project with unused ports and subnets.
param(
    [ValidatePattern('^collection-m3-test-m10-[a-z0-9-]+$')]
    [string]$Project = 'collection-m3-test-m10-evaluation',
    [int]$ApiPort = 18011,
    [int]$PostgresPort = 55441,
    [int]$RedisPort = 16391,
    [int]$FrontendPort = 5198,
    [string]$Subnet = '10.249.123.0/24',
    [string]$FixtureSubnet = '10.249.124.0/24'
)

if (!(Test-Path -LiteralPath 'backend/experiments/m10.compose.yaml')) {
    throw 'Run from the repository root.'
}
$m10EvidenceDir = Join-Path '.local' $Project
New-Item -ItemType Directory -Force $m10EvidenceDir | Out-Null
$m10PasswordPath = Join-Path $m10EvidenceDir 'db-password.txt'
if (!(Test-Path -LiteralPath $m10PasswordPath)) {
    [Guid]::NewGuid().ToString('N') | Set-Content -LiteralPath $m10PasswordPath -Encoding ascii
}
$env:POSTGRES_USER = 'm10_fixture'
$env:POSTGRES_DB = 'm10_fixture'
$env:POSTGRES_PASSWORD = (Get-Content -LiteralPath $m10PasswordPath -Raw).Trim()
$env:API_PORT = "$ApiPort"
$env:POSTGRES_PORT = "$PostgresPort"
$env:M10_REDIS_PORT = "$RedisPort"
$env:LAUNCHER_SUBNET = $Subnet
$env:LAUNCHER_FIXTURE_SUBNET = $FixtureSubnet
$env:M2_TEST_COMPOSE_PROJECT = $Project
$env:M3_TEST_COMPOSE_PROJECT = $Project
$env:M3_TEST_COMPOSE_API_URL = "http://127.0.0.1:$ApiPort"
$env:M2_TEST_DATABASE_URL = "postgresql+psycopg://m10_fixture:$($env:POSTGRES_PASSWORD)@127.0.0.1:$PostgresPort/m10_fixture"
# Compose workers use database 0. Subprocess worker tests use a different queue namespace.
$env:M3_TEST_BROKER_URL = "redis://127.0.0.1:$RedisPort/1"
$env:M4D_COMPOSE_PROJECT = $Project
$env:M4E_COMPOSE_PROJECT = $Project
$env:M4_REAL_API = '1'
$env:LOCAL_PROFILE_APPROVAL = '1'
$env:M4_FRONTEND_PORT = "$FrontendPort"
$env:API_PROXY_TARGET = $env:M3_TEST_COMPOSE_API_URL
$m10Overlays = @(
    'backend/experiments/m10.compose.yaml',
    'scripts/windows/compose.subnet.yaml',
    'scripts/windows/compose.fixture-subnet.yaml'
)
$env:M3_TEST_COMPOSE_EXTRA_ARGS = ($m10Overlays | ForEach-Object { "-f $_" }) -join ' '
$env:M4_COMPOSE_OVERLAYS = $m10Overlays -join ';'
$composeArgs = @('-p', $Project, '-f', 'compose.yaml', '-f', 'compose.fixture.yaml') +
    $env:M3_TEST_COMPOSE_EXTRA_ARGS.Split(' ')
