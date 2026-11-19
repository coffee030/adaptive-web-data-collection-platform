# M4-E Acceptance Report

This report preserves M4-E results. The closure report covers the later HEAD's regressions and cross-browser checks. [M4 Closure Remediation Results](M4-remediation-test-results.md)

2026-11-14 Hong Kong time. Baseline `2eeb72b`, branch `feature/M4E-frontend-integration`, no Git remote. Acceptance used Chrome 157.0.8103.51, Node 22.18.0, npm 10.9.3, and the existing Docker image. [Job submission contract](../contracts/M4-E-job-submission-contract.md)

## Frontend and Backend gates

M4-D baseline build passed with 58 controlled tests in 39.2s. M4-E TypeScript and Vite build passed, with 74 controlled tests in 55.1s. Both Jobs suites reran after final copy edits. New cases covered HTML and CSV, selection and eligibility, UTF-8 limit, HTTP 403, 409, 422 and 503, network failure and 10-second timeout, same-key replay, returning to a filtered Jobs page, keyboard, four viewports, and pending → running → partial. The first polling mock advanced by fetch counts, which could skip pending and mount preview twice in React StrictMode. It now advances from observed UI state and checks that terminal state stops status and records requests.

```powershell
# frontend/
npm.cmd run typecheck
npm.cmd run build
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:M4_FRONTEND_PORT = '5193'
npm.cmd test -- --output=test-results/m4e-baseline # baseline checkout
npm.cmd test -- --output=test-results/m4e-controlled-verified # M4-E
npm.cmd test -- tests/jobs.spec.ts tests/job-create.spec.ts --output=test-results/m4e-polish

# repository root
& .venv/Scripts/python.exe -m pytest -q -rs --tb=short backend/tests
& .venv/Scripts/python.exe -m ruff check backend
& .venv/Scripts/python.exe -m ruff format --check backend
docker compose @composeArgs exec -T api python -m alembic upgrade head
docker compose @composeArgs exec -T api python -m alembic current --check-heads
docker compose @composeArgs exec -T api python -m alembic check
git diff --check 2eeb72b HEAD
```

Backend regression used `collection-m3-test-m4e`, API 58017, PostgreSQL 55449, and separate local Redis 56392. Follow README M3 settings for `M3_TEST_COMPOSE_PROJECT`, `M3_TEST_COMPOSE_API_URL`, `M2_TEST_COMPOSE_PROJECT`, `M2_TEST_DATABASE_URL`, `M3_TEST_BROKER_URL`, and `M3_TEST_REDIS_SERVER`. Redis came from `var/m3-redis-test` and used `--port 56392 --bind 127.0.0.1 --appendonly no --save ""`. Full regression passed 172 in 226.62s, with 0 skips. Ruff passed, formatting passed for 56 files, and Alembic showed `0005 (head)` with no drift. This included existing live broker outage and recovery. The M4-E browser failure case stopped API and PostgreSQL. Test projects stopped with `stop` and retained volumes.

## Real browser E2E

The isolated `collection-m3-test-m4e-ui` used API 58018 and PostgreSQL 55450. The M3 fixture overlay started PostgreSQL, FastAPI, Redis, Dispatcher, Celery prefork worker, and the HTML fixture. Existing `create_approved_source` and `submit_job` created the legacy suites' `Controlled fixture` and one partial Job. New end-to-end cases create their own Source and Profile in React, then authorise Source access via the fixture setup's trusted terminal API.

```powershell
# frontend/ with isolated services running
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:M4_FRONTEND_PORT = '5194'
$env:M4_REAL_API = '1'
$env:LOCAL_PROFILE_APPROVAL = '1'
$env:API_PROXY_TARGET = 'http://127.0.0.1:58018'
$env:M4E_COMPOSE_PROJECT = 'collection-m3-test-m4e-ui'
$env:M4D_COMPOSE_PROJECT = $env:M4E_COMPOSE_PROJECT
$env:POSTGRES_USER = 'collection_test'
$env:POSTGRES_DB = 'collection_m3_test'
$env:POSTGRES_PORT = '55450'
$env:API_PORT = '58018'
$env:POSTGRES_PASSWORD = 'unused-by-start-stop-and-exec'
# Set M4E_CAPTURE_DIR to an absolute path for browser captures.
npm.cmd test -- --workers=1 --output=test-results/m4e-live-final
# Focused screenshot recheck after the final wording adjustment. Set M4_FRONTEND_PORT=5196.
npm.cmd test -- tests/core-workflow.integration.ts --grep 'Core web workflow' --workers=1 --output=test-results/m4e-jobs-capture
```

**12 passed in 1.2m**, 9 existing and 3 M4-E. The browser opened Job Detail after POST 201 Pending. Observed event order was `JOB_CREATED → DISPATCHED → CLAIMED → SUCCEEDED/PARTIAL`. Fixtures finished quickly, so CLAIMED recorded Running. Controlled polling separately observed Running in the UI.

| Workflow | Observed result |
| --- | --- |
| HTML | Job `fdb62ba9-930d-43db-8098-20590a4b7b48` created at 12:40:04.310 HKT and finished at 12:40:04.508. Succeeded, 2 Valid, 0 Invalid, 0 Duplicates. Profile `11968b0a7a8c403191e621d1e72c3f58`, Record `47a1c9c0-260a-5f50-a674-f1ad9ea52754`, Evidence `96fa10fc-bd81-4ed9-8a3d-71be3855905d`. |
| CSV | Job `6d363930-0857-4806-8e9d-cd956e62c7d8` created at 12:40:16.522 HKT and finished at 12:40:16.580. Partial, 2 Valid, 3 Invalid, 1 Duplicate. Quarantine start lines 5, 6, and 7. Profile `ee8cbe542aa74eadbeeb1e52226d5c2c`, Record `605f2ea7-8df9-551d-99d1-42e8098d1c82`, Evidence `0e9da6a0-e43b-41fb-b782-6a3e5d417514`. |
| Rejections | Pending Source with Approved Profile returned POST 403. Draft returned 409, invalid body 422, unapproved dataset 403. A failed report had no Approve action, and the live API rejected it with 409. Existing live checks passed for stale report, revoked access, and approved PUT 409. The first test expected 403 when both Draft and Pending applied. Checks were separated to match gate order. |
| Recovery and persistence | Stopping dedicated FastAPI and PostgreSQL left the result unconfirmed and the form retained inputs. After restoring the same services and volumes, Retry POST reused the full body, returned 201 for `5afbc25e-c962-4321-85d0-9a872089fd5b`, and replay returned 200 with the same ID. Source, Profile, Job, Events, Records, Quarantine, and Evidence DTOs matched before and after restart. M4-D also verified the named volume and SHA-256 of raw backend bytes. |

HTML Evidence SHA-256 was `5d65fc9aec1cc428b872490e5e1d7049e947c47fcafb0f38eb535316940162e0`. CSV was `15ad900bbc23656d0049eeb4dc48c51b501cd9d24cce4976876b8f138b02acfa`. Browser metadata was compared to live API, Node checked fixture digests, and backend storage separately verified persisted bytes. Frontend reads Evidence Metadata.

## UX and accessibility findings

Used installed Impeccable 4.9.0 Operate, audit, and polish with existing light-first tokens, shell, tables, forms, and status. Chrome screenshots at 1440, 1280, 768, and 390px covered Collection Jobs list, Sources list and create and detail, Configuration, Preview, Validation, Approval, Approved Profile, HTML and CSV Job form and detail, Records list and detail, Quarantine, and Evidence. Fifty-six app-wide axe A/AA checks (14 states × 4 widths) had zero violations and no global horizontal overflow. Tests also covered keyboard submission, visible focus, named errors, disabled options, narrow scroll regions, and long IDs and JSON. Existing confirmation included inline approval and native browser confirmation. The new form shows page-level feedback without a custom modal.

| Severity | Finding | Change and recheck |
| --- | --- | --- |
| Medium | Version selection and submission were separate, leaving operators to construct the API request. | Open the form from the real approved Profile Version. Show the contextual action only for an authorised Source with an available version. Retain backend rejection and uncertain-write recovery. |
| Medium | The small-screen textarea showed part of the fixture and failures needed a clear input association. | Use 7 rows, monospace CSV, shorter help, and field-linked errors. Recheck the 390px Chrome capture, keyboard, and axe. |
| Advisory | Partial help left `separately.` stranded at 1280 and 390px. The first edit still had an isolated word at 390px. | Shortened to “See quarantine for rejected candidates.” Counts remain separate. Reran Jobs suites and detector. |

Manual sRGB checks measured primary white on teal 6.89:1, secondary on white 5.56:1, Partial warning 4.91:1, error on white 5.85:1, focus on white 4.91:1, and field border on white 3.52:1. Safari, physical mobile, screen reader, and full WCAG conformance were NOT RUN.

```powershell
# repository root, with Vite on 5195 and the isolated API up
& .agents/skills/impeccable/scripts/impeccable.cmd detect --json frontend/src
$env:PUPPETEER_EXECUTABLE_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:IMPECCABLE_SKILL_DIR = (Resolve-Path '.agents/skills/impeccable').Path
$detector = Join-Path $env:IMPECCABLE_SKILL_DIR 'scripts/bin/windows-x64/impeccable.exe'
foreach ($vp in @('1280x900','390x844')) {
  & $detector detect --json --viewport $vp @urls
}
```

`@urls` contains Collection Jobs list, new, and detail, Sources list, new, and detail, Approved Profile, Records list and detail, Quarantine, and Evidence. Job form uses the CSV Job Source and Profile query parameters above. The Windows batch launcher first split a URL at `&`. Using the same installed engine directly (`0.1.23`) retained the full arguments. Final source and both rendered scans returned `[]` and exit 0. Local screenshots are in visualisations `m4e/`. Hooks and Live Mode were disabled.

[Demo runbook](../demo/M4-core-demo-runbook.md) · [Issue Manifest](M4-E-issue-manifest.md) · [M5 readiness](M5-readiness-review.md)
