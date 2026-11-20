# M20 — Per-attempt Worker identity

**Acceptance passed.** The same Job recovered from Worker A to Worker B after an actual Worker interruption. The original attempt owners, event order, results and Evidence lineage remained readable through REST and the Dashboard after restart.

## Environment

The controlled acceptance ran on 20 November 2026 on Windows 11 Pro build 26200 with Docker Desktop 4.99.0, Linux Engine 29.9.3 and Compose 5.7.0. The stack used Python 3.12.14, Celery 5.6.3 with prefork, PostgreSQL 17 and Redis 7.4.8. The host checks used Python 3.13, Node 22.18.0 and Chrome 157.0.8103.79. The accepted M19 base was `65b8e7363f0c3fca7629d20627a67c8fce389d72`.

Compose project `collection-m3-test-m20` used API port `58020`, PostgreSQL port `55520`, Dashboard port `58220` and dedicated `postgres_data`, `redis_data` and `evidence_data` volumes. The M3 fixture served the M7 cards layout over the internal fixture network. All runtime changes were confined to the M20 project. The Normal and Demo environments were left running as found.

## Observed recovery

- Collection Request `4d858e54-9351-4199-b082-b1780c4f3693` had one child Job, `6b36d8ed-073b-454d-a769-d8403f5f5fd5`.
- Worker A logged `6a67f335-7add-4008-a7ef-52cd355f710c`. The Jobs `15265aaa-cd25-46d3-aa5b-22bd7896fc4e` and `8f40f8e7-3db4-492d-b8ca-c49f1b154c2a` both finished on that ID. Their successful task logs came from `ForkPoolWorker-1` and its replacement `ForkPoolWorker-2`.
- Worker B logged `760ba2fe-d573-4183-88b0-b3d4ff304902` before Worker A was interrupted. During the pending recovery window, Job detail still reported attempt 1 and Worker A as the latest claim owner. The API recorded `worker_lost`.

| Time (UTC) | Event in REST order | Status | Attempt counter | Claim owner |
| --- | --- | --- | ---: | --- |
| 12:15:29 | `JOB_CREATED` | pending | 0 | — |
| 12:15:29 | `DISPATCHED` | pending | 0 | — |
| 12:15:30 | `CLAIMED` | running | 1 | A |
| 12:17:00 | `WORKER_LOST` | running | 1 | A |
| 12:17:00 | `RECOVERY_REQUESTED` | pending | 1 | A |
| 12:17:05 | `DISPATCHED` | pending | 1 | — |
| 12:17:06 | `CLAIMED` | running | 2 | B |
| 12:17:11 | `PARTIAL` | partial | 2 | B |

The fixture expected **2 accepted, 1 invalid, 0 duplicates** and **5 published captures**. The API returned those exact counts. Attempt 1 had zero published Records and zero Evidence references. While attempt 2 was running, a stale success probe used the saved attempt 1 claim and the real executor publication method. It returned the current state `running 2`. The Job, events, Records and Evidence snapshots stayed identical during the probe. The PostgreSQL fencing test separately passed a populated stale result and checked that it could neither publish Evidence nor change attempt 2. After the live Job ended, a duplicate Celery message was skipped with `job_not_pending` and the terminal snapshot stayed identical.

| Capture | Evidence ID | Where it appears |
| --- | --- | --- |
| Search page 1 | `34a205e7-4ad1-47b4-bf68-88b0dff798f4` | Job captures |
| Search page 2 | `d2992f3a-47a8-4056-8032-1cad59b27f91` | Job captures |
| Alpha | `e1ebd994-a267-48cc-9457-2bce43eedc4a` | Accepted Record |
| Beta | `2d173bba-704b-40ca-8c06-87b066ca5b59` | Accepted Record |
| Bad | `56528a10-9f31-4b6c-a976-2a4997022cb3` | Quarantine |

## REST, Dashboard and restart

- **REST.** Job detail returned `partial`, `execution_attempt: 2`, `dispatch_attempts: 2`, `latest_claim_execution_origin: "worker"` and Worker B's original UUID in `latest_claim_worker_instance_id`. The Events endpoint returned both owners in the order above. Its dispatch entries carried null attribution. The test compared the full JSON for the Request, Job, Events, Evidence pages, Records and quarantine before and after restart. All six responses matched, including event IDs, order, counts and Evidence references. The five saved capture files still matched their recorded SHA-256 hashes.
- **Dashboard.** In the live Request, **Child jobs → Job details** showed **Partial**, **Execution attempts** of 2 and Worker B as **Latest claim owner**. **Execution events** showed Worker A's full UUID on the first claim, lease expiry and recovery rows, and Worker B's full UUID on the second claim and partial outcome. Chrome passed the same assertions before and after restart at desktop and mobile widths. The test also opened a detail capture, verified keyboard focus on return to the Job, and returned to the original child Job link. The mobile viewport was 390 px wide with no page-level horizontal overflow. [Desktop before restart](M20-screenshots/m20-before-desktop.png) · [Mobile after restart](M20-screenshots/m20-after-mobile.png)
- **Restart.** PostgreSQL, Redis, the fixture, API, Dispatcher and Worker B restarted on the existing volumes. The same Worker B container logged a fresh ID, `7910438d-fdc4-472c-837b-428478482e2f`. Both original IDs remained in Job history.
- **MCP.** The live stdio `get_collection_status` call after restart returned the same child Job, `partial`, attempt 2 and counts 2/1/0 using the existing status projection.

## Migration and compatibility

The fresh Compose database upgraded to Alembic `0010 (head)`. `alembic check` reported no pending operations. The populated upgrade test created an unclaimed Job and a claimed terminal Job on revision `0009`, then upgraded to `0010`. The existing Job counts, claim and terminal event IDs, attempt number and event order survived. Both Jobs had null owner fields after upgrade. The unclaimed Job was distinguishable from the historical claim by its attempt counter of 0. An actual CLI invocation recorded `direct` with a null Worker ID. The focused tests also exercised concurrent duplicate claims, claim rollback and HTTP retry attribution.

Record export schemas and the Collection Request child status projection retain their existing fields. [Job execution contract](../contracts/M3-job-execution-contract.md)

## How to repeat the run

Run these PowerShell commands from the repository root in the M20 checkout. Use an unused project name, ports and private subnets if any of these are already assigned on your machine. Docker Desktop on the test host had exhausted its default subnet pools, so the override assigns two free subnets explicitly. Keep both dependency environments separate because the backend and MCP pin different HTTP client versions.

```powershell
New-Item -ItemType Directory -Force .local | Out-Null
python -m venv .local/m20-venv
.local/m20-venv/Scripts/python.exe -m pip install -r backend/requirements.txt pytest
python -m venv .local/m20-mcp
.local/m20-mcp/Scripts/python.exe -m pip install -r mcp_access/requirements.txt pytest
npm.cmd ci --prefix frontend

@'
POSTGRES_USER=collection
POSTGRES_PASSWORD=m20-fixture-only
POSTGRES_DB=collection_m20
POSTGRES_PORT=55520
API_PORT=58020
'@ | Set-Content .local/m20.env
@'
services:
  api:
    image: collection-backend:m20
    environment:
      LOCAL_PROFILE_APPROVAL: "1"
  dispatcher:
    image: collection-backend:m20
  worker:
    image: collection-backend:m20
    command: ["python", "-m", "celery", "-A", "backend.queue.celery_app:app", "worker", "--loglevel=INFO", "--pool=prefork", "--without-gossip", "--without-mingle", "--max-tasks-per-child=1"]
  collection-fixture:
    image: collection-backend:m20
networks:
  default:
    ipam:
      config:
        - subnet: 10.251.20.0/24
  fixtures:
    ipam:
      config:
        - subnet: 10.251.21.0/24
'@ | Set-Content .local/m20.compose.yaml

$opts = @('--env-file','.local/m20.env','-p','collection-m3-test-m20','-f','compose.yaml','-f','compose.fixture.yaml','-f','.local/m20.compose.yaml')
docker compose @opts up -d --wait postgres redis
docker compose @opts build api
docker compose @opts run --rm --no-deps api alembic upgrade head
docker compose @opts up -d --no-build --wait api dispatcher collection-fixture
docker compose @opts up -d --no-build --scale worker=1 worker
docker compose @opts exec -T api alembic current
docker compose @opts exec -T api alembic check

$env:M3_TEST_COMPOSE_PROJECT = 'collection-m3-test-m20'
$env:M3_TEST_COMPOSE_API_URL = 'http://127.0.0.1:58020'
$env:M3_TEST_COMPOSE_EXTRA_ARGS = '--env-file .local/m20.env -f .local/m20.compose.yaml'
$env:M20_TEST_WORKER_IDENTITY = '1'
$env:M20_DASHBOARD_DIR = Join-Path (Get-Location) '.local/m20-browser'
$env:M4_FRONTEND_PORT = '58220'
$env:PLAYWRIGHT_CHANNEL = 'chrome'
.local/m20-venv/Scripts/python.exe -m pytest -q -s backend/tests/m2/test_m3_compose.py -k m20
```

The test starts from one Worker and makes two short fixture Requests to verify consecutive prefork children. It then submits a controlled Request through the normal REST entry point and holds its first attempt at Evidence publication using the M3 test lock. Once the API confirms the claim, the test starts Worker B, checks both startup logs and interrupts only Worker A. It releases the lock and waits for the existing 90-second lease and five-second recovery delay. The test never updates the Job to force expiry or resubmits the Request to achieve recovery. It prints the Request and Job IDs, both startup UUIDs and the final REST snapshot. The browser reads the live API before and after the service restart.

### Teammate walkthrough

1. Keep the isolated API running. Set `$env:API_PROXY_TARGET = 'http://127.0.0.1:58020'` and run `npm.cmd run dev --prefix frontend -- --port 58220 --strictPort`.
2. Open `http://127.0.0.1:58220/collection-requests/<request-id>`. In **Child jobs**, choose **Job details**. Check **Execution attempts** and **Latest claim owner** in **Execution and dispatch**.
3. Choose **Execution events**. Compare **Execution claimed**, **Lease expiry recorded** and **Recovery requested** for attempt 1 with **Execution claimed** and **Run produced partial results** for attempt 2. The full Worker IDs are selectable in the timeline.
4. Open **Capture evidence** and inspect the detail capture for Alpha or Beta. Go back to Job Details and then return to the Request using **View parent request**.

## Verification runs

Run the backend suite in a fresh shell with the isolated Compose PostgreSQL instance running. The database tests create and remove disposable schemas. Run the frontend suite with an installed Chrome and an unused port.

```powershell
$env:M2_TEST_DATABASE_URL = 'postgresql+psycopg://collection:m20-fixture-only@127.0.0.1:55520/collection_m20'
.local/m20-venv/Scripts/python.exe -m pip check
.local/m20-venv/Scripts/python.exe -m pytest -q -rs --tb=short backend/tests
.local/m20-mcp/Scripts/python.exe -m pip check
.local/m20-mcp/Scripts/python.exe -m pytest -q mcp_access/tests
npm.cmd run build --prefix frontend
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:M4_FRONTEND_PORT = '58225'
npm.cmd test --prefix frontend -- --reporter=dot
git diff --check
```

| Check | Result |
| --- | --- |
| Dedicated Compose recovery test | 1 passed in 141.60 seconds, with 6 other Compose tests deselected. |
| Live Chrome integration | 1 passed before restart and 1 passed after restart. |
| Full backend suite with PostgreSQL | 279 passed, 22 skipped in 65.96 seconds. The default run skipped 7 opt-in Compose cases, 12 cases needing a host-accessible test Redis and 3 cases needing OpenSSL on the host path. |
| Supplemental broker suite | 14 passed in 139.59 seconds against a temporary loopback Redis, covering the 12 skipped broker cases. |
| Supplemental TLS fixture suite | With Git for Windows OpenSSL on `PATH`, `pytest -q -rs --tb=short backend/tests/m1/test_m7_timeout.py` passed all 18 cases, including the 3 skipped above. |
| Full Chrome frontend suite | 156 passed, including all 34 Job tests. Typecheck and production build passed. |
| Isolated MCP dependencies and suite | `pip check` passed. 14 protocol tests passed and the live stdio status check passed. |
| Fresh and populated migrations | `alembic current` returned `0010 (head)`. `alembic check` passed on the fresh and populated databases. |
| Static checks | Backend `pip check`, Ruff lint and format checks on all 15 changed Python files, and `git diff --check` passed. |

The initial Dashboard test counted nested error details as timeline rows. After scoping the assertion to top-level rows, the full acceptance passed. The earlier backend sweep exposed two migration tests that used the current ORM to seed revisions `0006` and `0008`. Both now use a fixture that writes only legacy event columns during setup. The initial frontend sweep with Playwright's bundled Chromium returned 150 passed and 6 failed. Two failures reproduced on the accepted M19 checkout. The complete rerun in installed Chrome passed all 156 tests.

To repeat the supplemental broker suite, start `redis:7.4.8-alpine` as a disposable container bound to `127.0.0.1:56320`, set `M3_TEST_BROKER_URL=redis://127.0.0.1:56320/0` alongside the PostgreSQL setting above, and run `pytest -q -rs --tb=short backend/tests/m2/test_m3_broker.py backend/tests/m2/test_m7_results.py backend/tests/m2/test_m8_collections.py` in the backend environment. Stop that temporary Redis container afterward. The M20 Compose stack and its volumes remain available for the walkthrough. Six other opt-in Compose cases remain outside this acceptance run.

The integrated release exercise, PR CI expansion and the physical 8 GB Windows cold-start test belong to M21. [M21 follow-up](M18-Real-Source-and-Follow-Up-Plan.md#m21-verify-the-integrated-release)
