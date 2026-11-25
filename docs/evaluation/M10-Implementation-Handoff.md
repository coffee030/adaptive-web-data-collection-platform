# M10 Implementation Handoff

## Delivery

| Item | Value |
| --- | --- |
| Branch | `feature/M10-core-reliability-evaluation` |
| Reviewed base | `aa636891496223dc1b35755879ae3879c4f11802` |
| Evaluation tooling checkpoint | `1edc1fea65a50b06c11bb96c10c66b8c0c15de9c` |
| Independently reviewed and regression-tested HEAD | `7418a3b5132da091f10be564dddc8649de2c1fce` |
| Final documentation HEAD | See the Draft PR head or run `git rev-parse HEAD` on the delivered branch. The workspace handoff records the exact local and remote SHA. |
| Delivery snapshot | [M10 Core Reliability Evaluation](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/1572fc8a8aab05f0d81a81c9b0a7ffc994218974) |
| M10 Draft PR | **CREATED** · [#4](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/4) · Base `feature/M9-dashboard-integration-export` |

M10 adds an isolated Compose test configuration, reproducible load runner, independent PostgreSQL and Evidence verifier, browser acceptance assertions and the evaluation reports. The benchmark uses real Celery-prefork replicas and unchanged production controls. The M9 base and its Draft PR #3 were verified on GitHub. The separate M7 working tree was preserved.

## Evidence

| Area | Observed result |
| --- | --- |
| Scalability | 27 measured batches and 792 Jobs. Median substantial CSV throughput was 3.82, 6.41 and 9.53 Jobs/s for 1, 2 and 4 Workers. Four Workers achieved 2.49× speedup and 62.3% efficiency. The short batch was dominated by dispatch timing. The shared-origin case held near 0.34 Jobs/s. |
| Integrity under load | 389,700 accepted Records, 828 captures, 216 expected duplicates and no execution retries, dispatch retries or Job errors. Accepted and capture counts matched SQL. |
| Backend regressions | One complete final run at the reviewed HEAD returned **270 PASS, 0 FAIL, 0 SKIP, 0 ERROR** in 500.07 s. The process exited with code 0. |
| Real recovery | Worker SIGKILL during publication, broker stop/start, PostgreSQL outage and restart, duplicate dispatch, terminal fences, in-flight revocation and persisted Evidence were exercised. Timeline and safety scope are in the reliability report. |
| Deployment | Fresh source export on Windows 11 and WSL2. Launcher Setup 19.3 s, first Start 44.6 s, repeated Start 11.7 s. All 23 launcher script tests passed. PostgreSQL at `0009 (head)`. Disposable populated migrations from `0004`, `0006` and `0008` passed. |
| Frontend | TypeScript and Vite build passed. 89 mocked Chromium regressions and 17 live Chromium tests passed. The targeted live Topic flow passed in Chromium, Firefox and WebKit, with trace, screenshots and download artifacts. |
| Restart and persisted bytes | Actual Launcher Stop and Start kept all three volumes. Direct SQL and disk verification covered six Jobs, six observations, two Articles and 14 Evidence captures. Six CSV/JSON attachments matched SQL and remained byte-identical across restart. Chrome opened the preserved Request on the printed Launcher URL. |

Ignored `.local/m10/` retains the execution logs, Playwright artifacts, raw measurements, SQL verifications and Launcher logs. [Original repository audit](https://github.com/coffee030/adaptive-web-data-collection-platform/blob/1572fc8a8aab05f0d81a81c9b0a7ffc994218974/docs/evaluation/M10-Repository-Audit.md) · [Scalability and raw trials](M10-Scalability-Evaluation.md) · [Reliability matrix](M10-Reliability-Evaluation.md) · [Deployment verification](M10-Deployment-Verification.md) · [Fixture demo runbook](M10-FYP-Core-Demo-Runbook.md)

## Final Backend regression

The 2026-11-16 final gate used Python 3.12.14, pytest 9.2.0 and a new Docker Compose project on Windows 11 with Docker Desktop Linux containers on WSL2. The project used new named volumes, a generated test credential and loopback API, PostgreSQL and Redis ports 18013, 55443 and 16393. The running Compose Worker used Redis DB 0. The subprocess broker tests used Redis DB 1. PostgreSQL integration fixtures created disposable `m2_test_*` schemas. The final stack reached Alembic `0009 (head)`.

From the repository root with the pinned Python environment active, load the isolated configuration. Apply the build, startup and migration sequence in the scalability reproduction section before running pytest. Use available ports and subnets if reproducing alongside this project. [Compose setup sequence](M10-Scalability-Evaluation.md#reproduction)

```powershell
. ./backend/experiments/m10_environment.ps1 -Project collection-m3-test-m10-final-gate -ApiPort 18013 -PostgresPort 55443 -RedisPort 16393 -FrontendPort 5200 -Subnet '10.249.127.0/24' -FixtureSubnet '10.249.128.0/24'
python -m pytest -q -rs -s --tb=short --junitxml=.local/collection-m3-test-m10-final-gate/backend-full.xml backend/tests
```

The pytest console summary and all 270 JUnit case entries agree. Raw output is under the ignored `.local/collection-m3-test-m10-final-gate/` directory in `backend-full.log`, `backend-full.xml`, `setup.log` and `compose.log`. The isolated project was stopped with all three volumes preserved. The final publication commit contains documentation changes only. The benchmark audit matched 27 raw trial rows, nine aggregate rows and nine resource rows against the original measurements.

## Real browser acceptance

1. Created two pending Sources through the Dashboard, authorized their exact fixture paths, and took the Cards Profile through Draft → Preview → Validate → Approve. The acceptance test staged the XPath Catalog Profile through the real API. The live Core suite also exercised CSS/XPath extraction, CSV, multi-page capture, quarantine and rejection of foreign Host/Origin headers.
2. Created a Category and Topic, approved both bindings, started at Overview and submitted `quick` by keyboard. The initial Chromium Request `691cd5bf-25e7-4532-aa21-94d0f7e90844` reached Succeeded with two child Jobs and two typed payloads. Followed Records, Article history and Evidence Metadata.
3. Refresh `514eadf7-e02b-4cfe-8e0f-d98c2c01c5eb` preserved both approved Profile pins. The Cards Article `41fa946a-da96-4e1b-8c80-1bfc60ec41b3` had one version with two observations before the Partial run. The earlier observation opened its own Evidence.
4. The `detail404` Request `cf4426e5-fd08-423e-82de-f875db4933b2` reached Partial with two Partial child Jobs and visible HTTP 404 errors. Both valid Alpha records remained downloadable. The initial request, one child Job and the Partial request each produced CSV and JSON, independently compared with PostgreSQL.
5. During live Core acceptance, a real PostgreSQL stop returned a structured 503 on submission. The UI retained the idempotency key and retry intent. Recovery returned a persisted Job and the prior completed rows, quarantine and Evidence remained accessible. The results suite also stopped the API and DB, displayed a retryable unavailable state and verified the original disk checksum after restart.

Chrome ran WCAG 2.0/2.1 A/AA axe scans against live pages. The tests exercised desktop, 768 px tablet and 390 px mobile layouts, keyboard submission, focus transfer to Capture Evidence and route overflow. Existing mocked Chromium coverage also exercised System, Light and Dark modes, keyboard-scrollable grids, loading and error states, and unusually long payloads. Firefox and WebKit performed the full functional Topic check and layout assertions. Manual assistive-technology testing is **NOT RUN**.

Representative artifacts are `.local/m10/topic-chromium/`, `topic-firefox/`, `topic-webkit/`, `browser-live.log`, `live-core-captures/`, `launcher-reopened.png` and the identical `topic-sql-{before,after}.json` snapshots. The snapshots contain all six attachment hashes. The initial Request JSON hash is `b78e5a58051be6023761add621e58a1bbabd9e122401edac02bf643841fc4f26`.

## Architecture and remaining limitations

| Area | Technical assessment |
| --- | --- |
| Modular design and maintainability | API, application services, collection adapters, persistence and queues have identifiable boundaries. FastAPI contracts keep Source access and Profile approval independent. The fixture and isolated database test path make workflow behavior repeatable. |
| Distributed execution and consistency | PostgreSQL owns Job state and retry/lease intent. Redis and Celery deliver work. Attempts are fenced during publication. Foreign keys, unique constraints and version hashes trace persisted results. Named volumes preserve database state and capture bytes. |
| Security | The trusted-local boundary uses loopback Host/Origin validation. Source approval, origin/path restrictions, bounded pagination, DNS and redirect checks, robots and shared request limits control access. These checks were evaluated with trusted local fixtures and component fault cases. |
| Performance | Dispatcher polling limits bursts of short Jobs. Extra replicas improve the tested write workload. Shared origin limits protect the upstream source through higher Worker concurrency. |
| Observability and operations | Job waits, errors, events, retries and provenance are visible through the API and Dashboard. Docker, PostgreSQL counters and persisted timestamps support local diagnosis. The Launcher checks its owned services and ports. |
| Durability scope | An abandoned attempt may leave an unreferenced file because capture writes and the database transaction are distinct. Fenced or rolled-back attempts do not publish committed Evidence or result rows. Long-run storage growth was outside the measured trial. |

Physical 8 GB Windows acceptance, bare Windows prerequisite provisioning, interactive default-browser opening and manual screen-reader testing remain **NOT RUN**. The controlled fixture demo is verified. The authorized public website demonstration is **NOT VERIFIED**. The release candidate is limited to the trusted-local FYP Core environment.

## Acceptance decisions

| Gate | Result | Basis |
| --- | --- | --- |
| A — Scalability | PASS | 1/2/4 actual Workers, three repetitions per topology, raw resource and timing evidence. |
| B — Reliability | PASS | Real service faults, redispatch, attempt fences and independent persisted data checks. |
| C — Deployment | PASS | Reproducible Windows/WSL2 launch, migration and stop/restart. Physical 8 GB validation remains separate. |
| D — Full E2E | PASS | Live operator and Topic workflow, Partial handling, refresh/history, Evidence and independently validated exports. |
| E — Final Core Review | PASS | Controlled demo and reports are backed by test evidence. Observed limits and remaining manual checks are documented. |
| Final Backend regression | PASS | One complete run at the reviewed HEAD with 270 PASS, 0 FAIL, 0 SKIP and 0 ERROR. |

**M10 TECHNICAL GO**

**CORE RELEASE CANDIDATE READY**

**DRAFT PR CREATED** · [#4](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/4)
