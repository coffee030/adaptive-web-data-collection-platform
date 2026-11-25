# M5 Core Test Results

Verification ran on 2026-11-14 Hong Kong time with the corrected M5 code, CPython 3.12.14, PostgreSQL 17.12, Redis 7.4.8, Celery 5.6.3, Node 22.18.0, and Playwright 1.65.0. [Environment and ports](../evaluation/M5-core-evaluation-results.md) [Runbook](../demo/M5-core-demo-runbook.md)

## Baseline and repair

| Check | Observed result |
| --- | --- |
| Original M4 delivery backend suite | 176 passed in 216.18 s, zero skipped. Live PostgreSQL, Redis, and Celery included Linux worker kill, broker restart, and named volume persistence. |
| M4 delivery Chromium controlled | 78 passed, 55.0 s. |
| M4 delivery Chromium live | 13 passed and 1 failed in 59.0 s. The Jobs test counted all descendant `listitem` elements, including the nested error code for `DISPATCH_FAILED` as a sixth event. The API returned five events. |
| Batch B defect reproduction | Three new tests deliberately checked existing requirements and all failed on baseline. Robots URL checks differed from actual libcurl normalisation, Scrapling logged a synthetic marker, and HTML extraction lacked a total text budget. |
| Batch B focused regression | 120 passed in 11.24 s. Covered literal and encoded dot segments, encoded slash, redirect recheck, safe logs, size bounds, and real PostgreSQL Source replay, Draft concurrency, attempt fencing, and failure classification. |
| Chromium rerun with the same fault | 2 passed in 3.9 s. Checked each event count and order and the nested error code. |

## Final regression

| Gate | Observed result |
| --- | --- |
| Full backend | **182 passed** in 219.96 s, zero skipped. Included live PostgreSQL, Redis broker, native Celery, and Linux prefork Compose. |
| TypeScript, Vite | PASS.Vite 8.3.8 build 54 modules, 143 ms, JS 399.09 kB (gzip 119.36 kB). |
| Chromium controlled | **78 passed**, 55.6 s. |
| Chromium live Docker | **14 passed** in 1.4 min. Source registration and authorisation, Draft edit, Preview, Validation, Approval, HTML, CSV, pinned Job, failed-response replay, durable data, and Evidence. 14 UI states × 4 widths (1440, 1280, 768, 390px) gave 56 axe A/AA checks with no reported violations. Global overflow checks passed. |
| Firefox 159 live representative | **6 passed**, 26.6 s. |
| WebKit 27.2 live representative | **6 passed**, 34.0 s.Windows Playwright engine. |
| Firefox and WebKit controlled polling | Each **2 passed**, in 16.8 s and 17.2 s. The first follow-up selected the wrong spec and collected 0 tests. The corrected command used `job-create.spec.ts` with original assertions. |
| Ruff, pip check, and Alembic | PASS. Ruff found 59 formatted files and pip found no broken requirements. Both isolated databases reached `0006 (head)` and `alembic check` found no drift. |
| Impeccable source | PASS, 4.9.0/engine 0.1.23, `[]`. |
| Impeccable rendered | PASS with Chrome 157.0.8103.51. Each of 1440×900, 1280×900, 768×900, and 390×844 covered 11 live routes, 44 renders total. All four returned `[]` and exit 0. |
| Cold-start final image | PASS. Fresh dedicated `collection-m3-test-m5-cold-final` reached API readiness in 11.295 s. Registered `collection.execute_job`. Fourteen live Jobs passed fixture checks. All six services exited 0 and OOM=false. |
| Final shutdown | PASS. All six services in the main M5 project exited 0 with OOM=false. Three named volumes remained. |

## Recovery and integrity evidence

| Scenario | Expected and observed behaviour |
| --- | --- |
| Redis stop/start | Compose returned 201 during Redis downtime and persisted pending state with `DISPATCH_FAILED` and `broker_unavailable`. Job `01f8420b-5842-4bd4-9783-84bb462c6adc` took 9.017 s from `DISPATCH_FAILED` to `DISPATCHED` and 9.402 s to `PARTIAL`, including test observation and restart waits. Recovery published one result set (CSV partial 2/1/1). Redelivery logged `job_not_pending` and preserved Job and events. |
| Worker termination and lease | Final Docker Job `5f6a5244-a321-479a-9c59-bb41b5705215` received worker-container SIGKILL while publication waited for a SQL lock. Its 90 s lease expired at 13:35:06.683086Z, `WORKER_LOST` at 13:35:06.875329Z (+0.192 s), and attempt 2 finished at 13:35:12.002006Z (+5.127 s more). One terminal event, one valid Record, and matching Evidence bytes. |
| SQL outage and service restart | PostgreSQL restarted with `collection-m3-test-m5-20261114_postgres_data`. Controlled DB failure delayed worker claim until recovery. Chromium CSV POST during downtime returned 503 `database_unavailable`. After recovery, same-key 201 and 200 found `443633c9-66f4-4bbf-b4e2-2bcc42676bc9`, and seven existing snapshots matched. A separate full restart reached health in 5.623 s, with six API bodies matching, three volumes retained, and CSV checksum matching the fixture. |
| Bounded execution retry | SQL and controlled HTTP verified timeout, transport and transient DB errors, HTTP 429 and 5xx, Retry-After, and fixed backoff. Attempt 3 is the limit. Authorisation, robots denial, explicit block, configuration, validation, and nontransient persistence or Evidence errors are final outcomes or terminal failures. Redis dispatch recovery uses a separate budget. |
| PostgreSQL transaction fence | Verified stale attempts cannot commit or fail a newer claim, two workers competing, rollback without partial results, recovery only after lease expiry, and replay preserving input and pin. |
| Data lineage | Approved config trigger, concurrent Draft 200 and 409, Source 201 and 200 replay and key conflict, one capture per Job, cross-Job Evidence FK, HTML item and CSV physical line, SHA-256 tamper detection, and failed Evidence-only lookup passed. |
| Local security | Foreign and null Host or Origin rejected, same-origin and trusted terminal successful. Destination and dataset checks, redirects, robots, 1 MiB input and HTML value limit, metadata path and absence of a raw-bytes route, and a safe 503 envelope were tested or reviewed. API and PostgreSQL publish on loopback. Only the acceptance overlay publishes Redis on loopback. |

Each outage or recovery case ran once in the final suite. PostgreSQL restart and worker lease times are individual local observations. Availability coverage excludes host power loss, data corruption, and prolonged multi-service outage.

Chromium's live HTML Job `fe52e8bd-893f-4b77-94eb-77d3f2404892` had Evidence `ed83ef18-06c5-4dad-968a-8e374a5594cf` and 2/0/0. The CSV Job `575a1f7c-79a7-4dc6-992e-0bf9302c4259` had Evidence `5729a681-8b33-4cec-83f4-60604bc47aa5` and 2/3/1. Both Evidence SHA-256 values match the original fixtures in the evaluation table.

Visually inspected live Playwright captures of CSV Job at 390 px, Records at 1440 px, and Evidence at 768 px. Status, counts, long IDs, horizontal table scrolling, digest, and lineage were readable.

## Reproduction

The historical detector commands use the tool included in the [M5.5 checkout](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/86994a84a96423371995efef79093a6a94c31f70).

```powershell
# Repository root. Configure and start isolated Compose as in the runbook.
.\.venv\Scripts\python.exe -m pytest -q -rs --tb=short -s backend/tests
.\.venv\Scripts\python.exe -m ruff check backend
.\.venv\Scripts\python.exe -m ruff format --check backend
.\.venv\Scripts\python.exe -m pip check
docker compose @composeArgs exec -T api python -m alembic current --check-heads
docker compose @composeArgs exec -T api python -m alembic check
.\.agents\skills\impeccable\scripts\impeccable.cmd detect --json frontend/src
# frontend/. Use M4_REAL_API=0 for controlled and M4_REAL_API=1 with loopback proxy for live.
npm.cmd run typecheck
npm.cmd run build
npm.cmd test -- --workers=2
# Run live suites serially so restart tests cannot interrupt each other.
npm.cmd test -- --workers=1
# PLAYWRIGHT_BROWSER=firefox or webkit
npm.cmd test -- tests/core-workflow.integration.ts tests/closure.integration.ts tests/sources.integration.ts --workers=1
# Representative polling uses M4_REAL_API=0.
npm.cmd test -- tests/job-create.spec.ts --grep poll --workers=1
```

M5 ran installed `.agents/skills/impeccable/scripts/bin/windows-x64/impeccable.exe detect --json --viewport <WxH> @urls` from the repository root with `PUPPETEER_EXECUTABLE_PATH` pointing to Chrome and Vite on 5199. The 11 URLs were Job list, new and detail, Quarantine, Source list, new and detail, Approved Profile, Record list and detail, and Evidence. [Rendered command example](M4-E-acceptance.md#ux-and-accessibility-findings)

Full logs, evaluation JSON, rendered checks, and failure evidence were kept locally in `var/m5-local/` and `frontend/test-results/`. [Physical and manual checks](Post-M5-device-acceptance-checklist.md)
