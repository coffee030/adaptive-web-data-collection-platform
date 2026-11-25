# M5 Core RC Demo Runbook

Run PowerShell 7 from the repository root. You need Python 3.12, Docker Desktop in Linux container mode with WSL2, Docker Compose, Node.js 22, and npm. Use the project dependencies and run `npm.cmd ci` for the first npm installation. Install browsers through the locked Playwright package. [Setup instructions](../../README.md)

## Start isolated Compose and the frontend

```powershell
$env:POSTGRES_USER = 'collection_test'
$env:POSTGRES_DB = 'collection_m5_test'
$env:POSTGRES_PASSWORD = [Guid]::NewGuid().ToString('N')
$env:POSTGRES_PORT = '55495'
$env:API_PORT = '58095'
$demoProject = 'collection-m3-test-m5-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$composeArgs = @('-p',$demoProject,'-f','compose.yaml','-f','compose.fixture.yaml')
docker compose @composeArgs build api
docker compose @composeArgs up -d --wait postgres redis
docker compose @composeArgs run --rm --no-deps api python -m alembic upgrade head
docker compose @composeArgs up -d --wait
Invoke-RestMethod "http://127.0.0.1:${env:API_PORT}/api/v1/health"
docker compose @composeArgs exec -T api python -m alembic current --check-heads
docker compose @composeArgs exec -T api python -m alembic check
docker compose @composeArgs logs --tail 50 dispatcher worker
```

Health should return `{"status":"ok"}`, migration should show `0006 (head)` with no drift, and worker logs should show `collection.execute_job` and `ready`. If a port is not ready on first launch, wait briefly and retry health. Keep the terminal settings, project name, and database password for stop and restart. The tests use the Compose project's PostgreSQL, Redis, and Evidence volumes.

Open another PowerShell window at the repository root, run the commands below, and use Collection Jobs in the trusted local console. [Collection Jobs](http://127.0.0.1:5197/collection-jobs)

```powershell
Set-Location frontend
npm.cmd ci
npm.cmd run build
$env:API_PROXY_TARGET = 'http://127.0.0.1:58095'
$env:LOCAL_PROFILE_APPROVAL = '1'
npm.cmd run dev -- --port 5197 --strictPort
```

Vite runs the React frontend on Windows and proxies same-origin `/api/v1` to the API. The Compose fixture has no host port. Vite production build and preview disable UI approval opt-in. `LOCAL_PROFILE_APPROVAL=1` applies to the local development proxy. The operator supplies the label.

## Run both inputs and trace results

Follow sections 2–4 of the M4 runbook to create two Pending Sources, approve each Source's access from the terminal, then create versions and complete Preview, Validation, and Approval. Replace the other guide's API port with this run's `API_PORT`. HTML uses `#entries tr`, `a`, and `data-code`. CSV maps `Key`, `Name`, and `Count` and is validated with the clean sample. [Console procedure](M4-core-demo-runbook.md)

- Verify HTML finishes **Succeeded** with Valid, Invalid, and Duplicates at 2/0/0. Paste `backend/tests/fixtures/m1/listings.csv` and verify CSV finishes **Partial** at 2/3/1.
- In Job Details, verify event order, Source, and pinned Profile. Open Record and Quarantine. CSV errors refer to physical start lines 5, 6, and 7.
- Open Evidence Metadata and verify SHA-256. A backend operator can read raw bytes by UUID hex in the isolated container. Obtain `$evidenceId` from the UI or API.

```powershell
$evidenceHex = ([Guid]$evidenceId).ToString('N')
docker compose @composeArgs exec -T api sha256sum "/data/evidence/$evidenceHex/input.bin"
```

## Repeat the full acceptance suite

Set the variables below in the Compose terminal. Full broker integration requires a host Celery test Redis DB or instance isolated from Compose broker DB `0`. In the acceptance overlay only, add `127.0.0.1:56395:6379` and set `M3_TEST_BROKER_URL` to `redis://127.0.0.1:56395/1`. Add the overlay to `$composeArgs` before startup. Pass the same extra Compose files in order to test subprocesses.

```powershell
New-Item -ItemType Directory -Force var/m5-local | Out-Null
@'
services:
  api:
    image: collection-backend:m5-acceptance
    mem_limit: 256m
  worker:
    image: collection-backend:m5-acceptance
    mem_limit: 512m
  dispatcher:
    image: collection-backend:m5-acceptance
    mem_limit: 256m
  collection-fixture:
    image: collection-backend:m5-acceptance
    mem_limit: 128m
  postgres:
    mem_limit: 512m
  redis:
    mem_limit: 128m
    ports:
      - "127.0.0.1:56395:6379"
'@ | Set-Content -Encoding utf8 var/m5-local/compose.acceptance.yaml
$composeArgs += @('-f','var/m5-local/compose.acceptance.yaml')
# Run the same build, up, upgrade, up, and health checks from the startup section.
```

```powershell
# On a fresh checkout, create the host test environment first.
py -3.12 -m venv .venv
$python = '.\.venv\Scripts\python.exe'
& $python -m pip install -r backend/requirements.txt
& $python -m pip check
$env:M2_TEST_DATABASE_URL = "postgresql+psycopg://${env:POSTGRES_USER}:${env:POSTGRES_PASSWORD}@127.0.0.1:${env:POSTGRES_PORT}/${env:POSTGRES_DB}"
$env:M2_TEST_COMPOSE_PROJECT = $demoProject
$env:M3_TEST_COMPOSE_PROJECT = $demoProject
$env:M3_TEST_COMPOSE_API_URL = "http://127.0.0.1:${env:API_PORT}"
$env:M3_TEST_BROKER_URL = 'redis://127.0.0.1:56395/1'
# Example overlay used for acceptance. Change the filename to match the actual overlay.
$env:M3_TEST_COMPOSE_EXTRA_ARGS = '-f var/m5-local/compose.acceptance.yaml'
$env:M4_COMPOSE_OVERLAYS = 'var/m5-local/compose.acceptance.yaml'
& $python -m pytest -q -rs --tb=short -s backend/tests
& $python -m backend.experiments.m5_evaluation --workers 1
```

For the pull-request backend checks without PostgreSQL or Redis, run these commands from the checkout root after installing `backend/requirements.txt`. The required test plugin rejects skipped tests.

```powershell
& $python -m ruff check --config ruff.toml backend mcp_access scripts
& $python -m ruff format --config ruff.toml --check backend mcp_access scripts
& $python -m pytest -p scripts.require_pytest_pass -q -ra backend/tests --ignore=backend/tests/m2 backend/experiments/test_m22a_onboarding.py backend/experiments/test_m22b_suggestions.py
```

Run the [Compose release gate](../evaluation/Clean-Checkout-Acceptance.md#hosted-release-gate) for the deployed browser journeys, Worker recovery, and live MCP checks.

Set `M3_TEST_REDIS_SERVER` to the existing local Redis executable so the native outage case can stop and start actual Redis on the dedicated port. A separate Compose outage case also stops and restores Redis. Run browser suites in sequence and close any Vite process on the same port first. The live Jobs test reads a completed Partial Job, created by the earlier backend tests, evaluation, or manual demo.

```powershell
Push-Location frontend
npm.cmd ci
npx.cmd playwright install chromium firefox webkit
npm.cmd run typecheck
npm.cmd run build
$env:M4_FRONTEND_PORT = '5197'
$env:PLAYWRIGHT_BROWSER = 'chromium'
$env:M4_REAL_API = '0'
$testOutput = '../var/m5-local/playwright-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
npm.cmd test -- --workers=2 "--output=$testOutput-controlled-chromium"
$env:M4_REAL_API = '1'
$env:LOCAL_PROFILE_APPROVAL = '1'
$env:API_PROXY_TARGET = $env:M3_TEST_COMPOSE_API_URL
$env:M4D_COMPOSE_PROJECT = $demoProject
$env:M4E_COMPOSE_PROJECT = $demoProject
npm.cmd test -- --workers=1 "--output=$testOutput-live-chromium"
Remove-Item Env:M4D_COMPOSE_PROJECT,Env:M4E_COMPOSE_PROJECT
foreach ($browser in @('firefox','webkit')) {
  $env:PLAYWRIGHT_BROWSER = $browser
  npm.cmd test -- tests/core-workflow.integration.ts tests/closure.integration.ts tests/sources.integration.ts --workers=1 "--output=$testOutput-live-$browser"
}
Pop-Location
```

If a project-local cache already contains the required browser version, set `PLAYWRIGHT_BROWSERS_PATH` and run tests directly. Otherwise confirm Node, lockfile, and packages before using the official Playwright download. Set `M4E_CAPTURE_DIR` or `M4D_CAPTURE_DIR` to ignored folders to retain viewport captures from axe verification.

## Stop and restart safely

```powershell
docker compose @composeArgs ps
docker compose @composeArgs logs --tail 50 api dispatcher worker
# Stop Vite with Ctrl+C in the frontend terminal.
docker compose @composeArgs stop
docker compose @composeArgs up -d --wait
Invoke-RestMethod "http://127.0.0.1:${env:API_PORT}/api/v1/health"
# Compare the original Job, Events, Records, Quarantine, Evidence, and checksum before finishing.
docker compose @composeArgs stop
```

If Docker reports `all predefined address pools have been fully subnetted`, inspect used Docker subnets with `docker network ls` and `docker network inspect` and check host or VPN routes. In the isolated acceptance overlay, set two non-overlapping subnets in `networks.default.ipam.config` and `networks.fixtures.ipam.config`. Retain existing projects, networks, and named volumes. For API 503, check PostgreSQL health, the login for that project, and Vite proxy settings. [M4 UI troubleshooting](M4-core-demo-runbook.md#5-troubleshooting-and-safe-shutdown)
