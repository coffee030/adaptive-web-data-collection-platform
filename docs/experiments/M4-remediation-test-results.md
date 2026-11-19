# M4 Remediation Test Results

Verification on 2026-11-14 used baseline `081c5f3`. The environment report lists browser recovery versions, official sources, and startup smoke tests. This page records the runs from this milestone. Historical M4-E counts remain as recorded. [Environment readiness](M4-environment-readiness.md)

## Regression and verification evidence

| Check | Status | Observation |
| --- | --- | --- |
| Baseline controlled Chromium suite | PASS | 74 passed in 55.5 seconds. |
| Baseline Draft concurrency, Source replay, and local boundary | FAIL (reproduced) | Both old PUTs returned 200. Identical Source content created two IDs. A foreign Host or Origin could create a Source with 201. |
| First full backend run | FAIL (fixed) | 174 passed, 2 failed. Old tests tried to downgrade a forward-only schema and OpenAPI checks still used obsolete component names. The fix creates the fixture from 0004, upgrades to head, and verifies DTO revision. |
| Full backend regression | PASS | 176 passed in 213.66 seconds with zero skipped, using PostgreSQL and Redis. Covered M0–M3, concurrent Source replay and conflict, concurrent Draft 200 and 409, missing revision 428, stale reports, immutable approval, Evidence-only and missing capture, status, authorisation, and retry. |
| Ruff lint / formatting | PASS | `ruff check`, `ruff format --check`. |
| Alembic | PASS | Upgraded isolated PostgreSQL from used 0005 to 0006 and exercised historical 0004 data. `current --check-heads` found 0006 and `alembic check` found no drift. |
| TypeScript / Vite | PASS | `npm.cmd run typecheck` and `npm.cmd run build`. Vite 8.3.8 emitted 54 modules. |
| Chromium controlled | PASS | 78 passed in 55.5 seconds, covering status, events, terminal polling, stopping polling after Job Detail, form 403, 409, 422 and 503, pagination, and invalid timestamps. |
| First Chromium live Docker run | FAIL (fixed) | 13 passed, 1 failed. An extra frontend approval GET prevented an existing server-side stale-report 409 test. Retained the backend transaction check and removed the extra GET. |
| Chromium live Docker | PASS | 14 passed in about 1.3 minutes. Covered HTML and CSV, failure and recovery, real before and after submission, Source retry returning the same ID, two-tab Draft conflict retaining input, and Evidence-only Jobs. |
| Firefox representative Docker | PASS | Final rerun 6 passed in 23.7 seconds. Covered live HTML and CSV, three integrity cases, and the Source contract. |
| First WebKit representative Docker run | FAIL (reproduced) | Filling a field beyond the viewport directly did not trigger editing. Commit 7afe0b1 changed automation to click the field before typing. A shared database across restart suites also caused temporary 502s, so final tests ran sequentially. |
| WebKit representative Docker | PASS | Final rerun 6 passed in 29.5 seconds. Covered HTML, CSV, authorisation, exact version, Records, Quarantine, Evidence and provenance, Source replay, and Draft conflict. |
| Firefox and WebKit Job monitoring | PASS | Two focused controlled tests each, covering active polling, terminal detection, and stopping after route exit. Full Chromium covered Compose restart and volumes. |
| Firefox cold-start retry | FAIL (once) | The Evidence case reported Page crashed during axe analysis. The other 5 passed. All 6 passed in the preceding Firefox round and in a separate rerun on the same acceptance project. The cause of the one renderer crash remained unknown. |
| Fresh volume preflight | FAIL (fixed) | Launching with an old isolated volume and mismatched credentials returned API 503. A separate fresh rehearsal had 13 passes and 1 failure because the Sources test depended on a historical Controlled fixture Source. The test now creates its own controlled Source and valid Approved fixture via API (439e1a2). The final run used fresh migrated volumes. |
| Real Job database outage | PASS | With PostgreSQL stopped, the still-running FastAPI returned 503 database_unavailable to Job POST. After restart, the same key created one Job and then replayed with 200 and the same Job ID. |
| Impeccable 4.9.0 | PASS | Source scan returned `[]`. Rendered scans covered 11 live routes across four viewports, 44 renders in total, all returning `[]`. |
| axe A/AA | PASS | 56 checks in live Chromium with 0 violations reported. Also ran controlled keyboard, focus, label, and overflow checks. |
| Real spoken screen reader | NOT RUN | Narrator was available. Manual audio verification was outstanding. NVDA was not installed. |
| Physical 8 GB Windows, Safari, and iPhone | NOT RUN | The devices were unavailable locally. Playwright WebKit version was 27.2. |

## Live Demo and retained data

The clean rehearsal used `collection-m3-test-closure-acceptance`, API 58025, and PostgreSQL 55455. Earlier sizing used `collection-m3-test-closure-ui` with internal fixture `collection-fixture:8001`. Chromium ran both workflows from Source creation and Pending through trusted Source Authorisation, Draft creation and edit, Preview, Validation, approval confirmation, pinned Job, Linux Celery prefork, Records, Quarantine, Evidence, and return to Source and Profile. Approval with the invalid CSV sample first returned 409, then passed with a clean sample.

| Check | Evidence |
| --- | --- |
| HTML | `060d2406-1270-487c-acc9-d357994c0cbb`, Succeeded, Valid/Invalid/Duplicates=2/0/0.Evidence `9d91545a-0854-4019-9c42-d2841a79caa0`, SHA-256 `5d65fc9aec1cc428b872490e5e1d7049e947c47fcafb0f38eb535316940162e0`. |
| CSV | `f634cee9-6498-4313-a0cf-67797ab99c53`, Partial, 2/3/1. Quarantine physical start lines 5–7. Evidence `e5ed0aaa-3199-4ade-b126-8f435c854d0a`, SHA-256 `15ad900bbc23656d0049eeb4dc48c51b501cd9d24cce4976876b8f138b02acfa`. |
| Events | Observed sequence in both Jobs was JOB_CREATED → DISPATCHED → CLAIMED → SUCCEEDED or PARTIAL. |
| API + PostgreSQL restart | Stopped PostgreSQL first. Running FastAPI returned 503 `database_unavailable` to Job POST. Then stopped API, restarted PostgreSQL and API, and waited for health. Retrying with the original key created and completed `0db473c2-b1d9-4a5b-a471-cc1168e3c0d9`. Source, Profile, Job, Events, Records, Quarantine, and Evidence JSON matched before and after restart. Actual bytes verified the checksum for both fixtures. |
| Safety boundary | Vite proxies Profile Approval only with opt-in. Foreign Host and Origin were rejected with 403. Loopback same-origin succeeded. Terminal Source authorisation used loopback and CORS was disabled. The operator-supplied label remains in the approval audit. |
| Failed capture | With persisted Evidence and no Records or Quarantine, Job Detail opened metadata. With no capture it showed the corresponding empty state. HTTP JSON omitted internal storage reference. |

## Accessibility / Responsive

Chromium captured actual views at 1440, 1280, 768, and 390 px. Manual sampling covered CSV Job 390, Source Create 768, Approved Profile 1280, and Records 1440. Automated checks covered skip link, keyboard, labels, error focus, confirmation, status and alert roles, desktop tables, and narrow layouts. Long IDs and JSON wrap or scroll in their regions. Calculated sRGB contrast was accent on white 4.91:1, accent ink on white 6.89:1, control border on white 3.52:1, and warning on warning surface 4.91:1. The scans used WCAG 2.0 and 2.1 A/AA axe tags. Full manual WCAG acceptance was unrun. Local ignored output is in `var/m4-closure-captures`. Impeccable used existing audit, harden, and polish guidance and source and rendered detectors, with Hooks and Live Mode disabled.

## Resource / performance

The table reports `docker stats --no-stream` MiB from one constrained Compose project with per-container limits. Docker VM memory was about 15.56 GiB. Compose readiness including migration took about 10.60 seconds.

| Service | Limit MiB | MiB after startup | MiB after Demo |
| --- | ---: | ---: | ---: |
| API | 256 | 73.31 | 79.86 |
| Fixture | 128 | 13.52 | 13.38 |
| Dispatcher | 256 | 70.71 | 73.59 |
| PostgreSQL | 512 | 35.24 | 37.98 |
| Redis | 128 | 4.289 | 4.465 |
| Celery prefork Worker | 512 | 90.82 | 113.8 |

The limit total was 1792 MiB. After the rehearsal, all test containers had `State.OOMKilled` false. Capacity figures are samples. Vite dev Node had about 117.1 MiB working set and a 141.2 MiB peak. Sampling the build's Node working set at about 8 ms found 142.5 MiB maximum. Vite build took 161 ms and exited 0. This sampling covers Vite, with TypeScript and npm also part of the full process. Windows and Docker global settings were untouched. These limits cannot measure physical 8 GB Windows availability, pagefile, or whole-machine contention.

## Rerun commands

On isolated Compose, ran full `python -m pytest -q`, `python -m ruff check`, `python -m ruff format --check`, `python -m alembic current --check-heads`, and `python -m alembic check`. Use the locked frontend toolchain below. [Isolated service setup](../demo/M4-core-demo-runbook.md)

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
# Live run. Start isolated Compose and set M4_REAL_API, LOCAL_PROFILE_APPROVAL, and API_PROXY_TARGET.
npm.cmd test -- --workers=1
# Representative run. Set PLAYWRIGHT_BROWSER=firefox or webkit.
npm.cmd test -- tests/core-workflow.integration.ts tests/closure.integration.ts tests/sources.integration.ts --workers=1
```

Live restart requires `M4E_COMPOSE_PROJECT` for a dedicated project, using the original database settings. Evidence validation uses that project's `M4D_COMPOSE_PROJECT`. Set `M4E_CAPTURE_DIR` to save viewport captures. Browser logs and traces remain in ignored `frontend/test-results`.

## Stop test services

Previously, fixture and Dispatcher timed out and exited 137 with OOMKilled false. Commit d1926e2 switched to SIGINT and made the fixture handle KeyboardInterrupt. Afterward, two rehearsals and the final isolated acceptance stopped with `docker compose stop`. All six services exited 0 and reported OOMKilled false. Each project's `postgres_data`, `redis_data`, and `evidence_data` remained. Development data and existing volumes were preserved.

## Final Gate follow-up verification

`fix/M4-closure` started from `25d47ab9ffcf555a945b636279aa6e40e918392b`. Code and tests matched `439e1a2`. Final Gate delivered docs only, so the original full-suite report is shown alongside focused reruns.

| Check | Actual result |
| --- | --- |
| Draft concurrency, Source replay, Evidence-only, Host and Origin (live PostgreSQL) | `backend/tests/m2/test_m4_closure.py` 4 passed in 1.82 seconds. |
| Chromium keyboard, forms, polling, Records, and Evidence | 10 passed in 12.3 seconds. |
| Firefox Evidence and axe bounded reproduction | 5 passed in 27.7 seconds, with separate Playwright workers per run, serial execution, retries disabled, and 5 traces retained. |
| Firefox live closure smoke | 2 passed in 9.4 seconds, including the sixth Evidence run, Source replay after response loss, and two Draft editors. |
| TypeScript, Vite, Ruff, and Alembic | Typecheck and build exited 0, Ruff lint passed, and 58 files were formatted. A fresh isolated database upgraded to 0006. `alembic current --check-heads` and `alembic check` passed. |
| Compose shutdown | All six `collection-m3-test-final-gate` services exited 0 and reported OOMKilled false. Stopped again after PostgreSQL smoke. Three named volumes remained. |
| Narrator, macOS Safari, iPhone Safari, and physical 8 GB Windows | NOT RUN. No user acceptance of untested items had been recorded. |

Used pinned browsers. The test selectors below were run. The review checklist provides isolated Compose, browser, and variable setup. The device report investigates the original Firefox failure. [Teammate review checklist](../reviews/M4-teammate-review-checklist.md) [Device and Resource Acceptance](M4-device-and-resource-acceptance.md#firefox-page-crashed-investigation)

```powershell
# Repository root. Point M2_TEST_DATABASE_URL at isolated PostgreSQL.
.\.venv\Scripts\python.exe -m pytest -q -rs --tb=short backend/tests/m2/test_m4_closure.py
.\.venv\Scripts\python.exe -m ruff check backend
.\.venv\Scripts\python.exe -m ruff format --check backend

# frontend/ in controlled mode, with Chromium.
npm.cmd run typecheck
npm.cmd run build
node node_modules/playwright/cli.js test tests/sources.spec.ts tests/profiles.spec.ts tests/job-create.spec.ts tests/results.spec.ts --grep 'keyboard|polling stops|Evidence shows' --workers=1 --output=test-results/final-gate-chromium

# frontend/. Set M4_REAL_API=1, LOCAL_PROFILE_APPROVAL=1, API_PROXY_TARGET,
# PLAYWRIGHT_BROWSER=firefox, and an isolated frontend port.
node node_modules/playwright/cli.js test tests/closure.integration.ts --grep 'failed capture opens Evidence' --repeat-each=5 --workers=1 --retries=0 --trace=on --output=test-results/final-gate-firefox
node node_modules/playwright/cli.js test tests/closure.integration.ts --workers=1 --retries=0 --output=test-results/final-gate-firefox-smoke
```
