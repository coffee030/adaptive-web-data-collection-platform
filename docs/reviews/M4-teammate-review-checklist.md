# M4 personal local acceptance checklist

The user chose to perform M4 acceptance locally. GitHub was deferred to M5 and teammate review was removed from M4.

## Checkout

Branch `fix/M4-closure`. Code and test review baseline `439e1a2b1e98f4d3bf53919ec07507e8df099ece`. Start the diff from M4-E `081c5f3`. The handoff is in the parent project folder. Record the actual test commit with `git rev-parse HEAD`.

Use the existing repository for acceptance or a separate worktree for a clean checkout.

```powershell
git worktree add --detach ../Adaptive-Web-M4-review fix/M4-closure
Set-Location ../Adaptive-Web-M4-review
git status --short
git rev-parse HEAD
git diff --stat 081c5f3 439e1a2
git diff --exit-code 439e1a2 HEAD -- backend frontend compose.yaml compose.fixture.yaml
```

## Architecture and review checklist

React and TypeScript use Vite's loopback proxy to FastAPI. PostgreSQL stores Sources, immutable Approved Profiles, Jobs, events, and results. Dispatcher reads durable Jobs and sends them through Redis to Celery workers, which write results and Evidence metadata.

| Area | Check | Code and acceptance evidence |
| --- | --- | --- |
| Backend | [ ] Source authorisation, separate access and approval, and foreign Host and Origin rejection | `backend/api/app.py`, `backend/api/profiles.py`, `frontend/vite.config.ts`. Pending and revoked access should fail submission. Approval requires local setup, a valid report, and explicit confirmation. |
| Backend | [ ] Profile lifecycle and concurrency | `backend/application/profiles.py`, `backend/persistence/profiles.py`. Only one of two concurrent PUTs with the same revision succeeds. Check 409, 428, stale report, and approved immutability. |
| Backend | [ ] Source and Job idempotency and migration | `backend/migrations/versions/0006_source_request_key.py`, `backend/application/profiles.py`, `backend/application/jobs.py`. Same key and payload return the original ID. Different payload gives 409. Check exact Profile pin and 0006 drift. |
| Backend | [ ] Job execution and recovery | `backend/queue/dispatcher.py`, `backend/queue/celery_app.py`, `compose.yaml`. Check proxy, worker restart, 503, same-key retry, events, and terminal state. |
| Console | [ ] Source and Profile workflow and errors | `frontend/src/features/sources/`, `frontend/src/features/profiles/`, `frontend/src/lib/requestIntent.ts`. Use two Draft tabs to check conflict, unsaved inputs, reload, and confirmation. |
| Console | [ ] Job, Records, and Evidence traceability | `frontend/src/features/collection-jobs/`, `frontend/src/features/results/`, `backend/application/results.py`. Check 2/3/1 counts, Evidence-only Jobs, Source and Profile lineage, omission of internal storage paths, and terminal polling stop. |
| Console | [ ] Keyboard and Narrator | Listen and report focus, errors, confirmations, updates, and data navigation. [Narrator acceptance](M4-narrator-acceptance.md) |

## Test commands

Use the existing `.venv` in an isolated checkout or set it up with Python 3.12 and `backend/requirements.txt`. Run below in Windows PowerShell. Set ports and a unique `$demoProject`, start services, and migrate in the first window described in section 1 of the runbook. Retain database settings there. Playwright starts Vite, so keep its port free. Run live suites sequentially because some restart their own services. [README](../../README.md) [Demo runbook](../demo/M4-core-demo-runbook.md)

```powershell
# Repository root. Reuse the runbook Compose environment and $composeArgs / $demoProject.
$python = '.\.venv\Scripts\python.exe'
$env:M2_TEST_DATABASE_URL = "postgresql+psycopg://${env:POSTGRES_USER}:${env:POSTGRES_PASSWORD}@127.0.0.1:${env:POSTGRES_PORT}/${env:POSTGRES_DB}"
$env:M2_TEST_COMPOSE_PROJECT = $demoProject
$env:M3_TEST_COMPOSE_PROJECT = $demoProject
$env:M3_TEST_COMPOSE_API_URL = "http://127.0.0.1:${env:API_PORT}"

& $python -m ruff check backend
& $python -m ruff format --check backend
docker compose @composeArgs exec -T api python -m alembic current --check-heads
docker compose @composeArgs exec -T api python -m alembic check
& $python -m pytest -q -rs --tb=short backend/tests/m2/test_m4_closure.py

# Full backend uses isolated Redis to keep host and Compose workers on separate queues.
$reviewRedis = "m4-review-redis-$($demoProject.Split('-')[-1])"
$env:M3_TEST_BROKER_URL = 'redis://127.0.0.1:56396/0'
docker run --rm -d --name $reviewRedis -p 127.0.0.1:56396:6379 --tmpfs /data redis:7.4.8-alpine
if ($LASTEXITCODE -ne 0) { throw 'Dedicated review Redis did not start' }
try {
  docker exec $reviewRedis redis-cli ping
  & $python -m pytest -q -rs --tb=short backend/tests
} finally {
  docker stop $reviewRedis
}
```

If `56396` is occupied, update port mapping and `M3_TEST_BROKER_URL`. Check Compose health before browser tests. Enter frontend from the same window so live restart inherits Compose credentials.

```powershell
$env:API_PROXY_TARGET = "http://127.0.0.1:${env:API_PORT}"
Push-Location frontend
npm.cmd ci
npx.cmd playwright install chromium firefox webkit
npm.cmd run typecheck
npm.cmd run build
$env:M4_FRONTEND_PORT = '5195'
$env:M4_REAL_API = '0'
$env:PLAYWRIGHT_BROWSER = 'chromium'
npm.cmd test -- --workers=1

$env:M4_REAL_API = '1'
$env:LOCAL_PROFILE_APPROVAL = '1'
$env:M4E_COMPOSE_PROJECT = $demoProject
$env:M4D_COMPOSE_PROJECT = $demoProject
npm.cmd test -- --workers=1
Remove-Item Env:M4E_COMPOSE_PROJECT,Env:M4D_COMPOSE_PROJECT
foreach ($browser in @('firefox','webkit')) {
  $env:PLAYWRIGHT_BROWSER = $browser
  npm.cmd test -- tests/core-workflow.integration.ts tests/closure.integration.ts tests/sources.integration.ts --workers=1
}
Pop-Location
docker compose @composeArgs stop
```

In a fresh shell, confirm old `PLAYWRIGHT_CHANNEL`, `M3_TEST_COMPOSE_EXTRA_ARGS`, and `M4_COMPOSE_OVERLAYS` are unset. For images or axe evidence, set `M4E_CAPTURE_DIR` to an ignored or out-of-Git directory during live Chromium. Keep passed, failed, skipped, and actual versions from each output. [Verified baseline](../experiments/M4-remediation-test-results.md) [API contract](../contracts/M4-closure-api-contract.md)

## Record the review

The user retains the actual test record below and records their decision in the M4 ledger.

```text
Reviewer and date with time zone
Branch and actual checkout commit
Scope personally checked and commands run
Actual results (PASS, FAIL, or NOT RUN) and log, trace, or Job ID
Findings with severity, file:line, reproduction, expected and actual outcomes, and impact
Review decision (APPROVE, REQUEST CHANGES, or INCOMPLETE)
Scope requiring another review
```
