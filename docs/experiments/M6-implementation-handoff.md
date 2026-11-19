# M6 Implementation Handoff Report

2026-11-16 Hong Kong time

## A. Repository Baseline

- Starting branch was `feature/M5.5-dashboard-redesign`, commit `cb3972132282df820e7486dcbdf910360c84150c`. The worktree already modified `Adaptive_Web_Data_Collection_Platform_Teammate_Implementation_Instructions(1).md` and deleted `M5-Windows-Launcher-ChatGPT-Handoff.txt`. Neither edit was included in M6 commits.
- Review covered `AGENTS.md`, project skills, README, PRODUCT, DESIGN, relevant Proposal sections, M2, M3, and M5 architecture and APIs, and existing FastAPI, SQLAlchemy, Alembic, Redis, Celery, Scrapling, Evidence, Jobs, and browser tests.
- Reused controlled HTML and CSV adapters, Source access and Profile review, pinned config hash, Generic Record validation and deduplication, Evidence store, PostgreSQL claim and lease, Dispatcher, Celery, existing React routes, and Windows launcher.
- Existing `uq_evidence_job` and `uq_evidence_run` limited Evidence to one page. Quarantine uniqueness also collided when separate pages had the same item index. Profile hashes had to remain compatible with approved versions. Existing SQL transaction fencing could publish one complete attempt, with the existing separate filesystem and DB commit boundary.
- Before changes, the full backend suite with temporary localhost fixtures had **135 passed and 48 skipped**. The 48 needed PostgreSQL, Redis, or Compose. The first restricted run reported localhost connection failures. Baseline passed after allowing local fixtures.

## B. Implementation Summary

- `backend/core/contracts.py`, `runner.py`, and `web_adapter.py` add an optional next-link strategy to approved versions. One to five pages, CSS or XPath, same-origin checks, a visited URL set, robots, and bounded redirects. No next link ends traversal. An unprocessed link at the limit reports `page_limit_reached`. Each page's Evidence has HTTP metadata, both URLs, page number, hash, and existing Source, Profile, and Run lineage.
- `backend/core/ingestion.py` retains Record identity and shares seen identities across the attempt. Every persisted Record and Quarantine entry points to its own Evidence. HTML item index is page-local. Job counts sum processed pages.
- `backend/application/execution.py` and `backend/persistence/results.py` retain PostgreSQL attempt fencing and the terminal transaction. Transient HTTP and connection errors retry from page one up to three times. Exhaustion with valid records is `partial` and keeps the stop reason. No valid records gives `failed`. Invalid candidates stay in Quarantine.
- Existing `GET /api/v1/collection-jobs/{job_id}/evidence` returns the first page or `null`. Added sorted `/evidence-pages` and `page_number` metadata. Job submission, Record, and Quarantine retain existing lineage fields.
- React Profile Editor adds two HTML-only settings and approval summary shows pinned values. Job Details lists pages and Evidence Metadata shows page number. Existing views, components, navigation, and design were reused.
- The contract gives behaviour, upgrade, and fixture steps. [M6 Controlled HTML Pagination](../contracts/M6-controlled-pagination.md)

## C. Database Migration

- Alembic `0007_multi_page_evidence.py`, `down_revision = 0006`, adds `raw_evidence.page_number` with default 1 for existing data, `CHECK (page_number > 0)`, and `UNIQUE (job_id, page_number)`. Removed single-column uniqueness for `job_id` and `run_id` so pages in an attempt share `run_id`.
- Retains Evidence `(job_id, id)`, composite FKs from Record and Quarantine, Job Profile pin, and per-Job Record dedup constraint. Quarantine uniqueness adds `evidence_id` and keeps the original first-page and CSV UUID calculation.
- In a PostgreSQL 17 `0006` test schema, inserted legacy Job, Evidence, Record, Quarantine, and a sidecar without page number. Ran `upgrade head` and `alembic check`. Checked original UUIDs, Source references, Profile, hash, raw bytes, and page default. An isolated Compose DB also migrated from empty to `0007 (head)`.
- Downgrade rebuilds old uniqueness. PostgreSQL rolls it back atomically if multi-page rows exist. Restore M5.5 using DB and Evidence volume backups from before enabling multi-page collection.

## D. Testing Evidence

### Final full regression of Draft PR HEAD

On 2026-11-16 Hong Kong time, the full backend suite reported **200 passed in 323.88s (0:05:23)** and pytest exit `0`. JUnit confirmed 200 total, 0 failures, 0 errors, and 0 skips. [Draft PR #1 tested commit `654134983654aaeabb63c4de7d36d4f3e5784c72`](https://github.com/coffee030/adaptive-web-data-collection-platform/commit/654134983654aaeabb63c4de7d36d4f3e5784c72)

The isolated snapshot came from GitHub commit tree `7faadfa697c56c3beb1959750f43df30511aded9`. Checked all 287 files against Git blob SHAs before and after. Built the image from that snapshot with fresh PostgreSQL, Redis, Celery prefork worker, and fixture containers. Alembic showed `0007 (head)`. The first API health check returned an empty response. Bounded retries returned `{"status":"ok"}`, then one full suite ran with Python 3.12.14 and pytest 9.2.0.

```powershell
& $python -m pytest -q -rs -s --tb=short --junitxml=../backend-regression.xml backend/tests
```

All three live Compose checks passed for Redis outage, prefork worker termination, and PostgreSQL restart. Multi-page Job `2f28f4c1-049a-453c-b710-872015ad3d91` recovered on attempt 2 and kept three pages of Evidence after restart. Isolated project `collection-m3-test-m6-regression-6541349` was stopped with volumes retained. Host `backend-regression.log` and `backend-regression.xml` were in ignored `.local/m6-regression-6541349/`.

### Verification during implementation

| Command run | Result |
| --- | --- |
| `.\.venv\Scripts\python.exe -m pytest -q -rs --tb=short backend/tests` | Before changes, 135 passed and 48 skipped |
| `.\.venv\Scripts\python.exe -m pytest -q --tb=short backend/tests/m1/test_m6_pagination.py backend/tests/m2/test_m6_results.py backend/tests/m2/test_vertical_slice.py backend/tests/m2/test_result_failures.py` | 21 passed. Three pages, clean stop, limit, URL loop, redirect, 429, 500, timeout, upgrade, later-page 503 retry, and M5.5 HTTP and CSV regression. |
| `.\.venv\Scripts\python.exe -m pytest -q -rs -s --tb=short backend/tests` | 199 passed, 1 failed, 0 skipped. The new Compose test compared one Profile UUID in hyphenated and unhyphenated forms. |
| `.\.venv\Scripts\python.exe -m pytest -q -rs -s --tb=short backend/tests/m2/test_m3_compose.py -k multi_page` | After correcting the UUID assertion, 1 passed and 2 deselected in 103.00 seconds. Live SIGKILL, lease recovery, duplicate delivery, PostgreSQL and API restart, and raw Evidence in both containers. |
| `.\.venv\Scripts\python.exe -m ruff check backend`, `.\.venv\Scripts\python.exe -m ruff format --check backend` | Both passed |
| `npm.cmd test` (`frontend/`, `PLAYWRIGHT_CHANNEL=chrome`, `M4_FRONTEND_PORT=5195`) | 86 passed |
| `npm.cmd run typecheck` and `npm.cmd run build` (`frontend/`) | Both passed, including M6 browser test TypeScript |
| `npm.cmd test -- tests/core-workflow.integration.ts --workers=1` (`frontend/`, `PLAYWRIGHT_CHANNEL=chrome`, `M4_FRONTEND_PORT=5194`, `M4_REAL_API=1`, `LOCAL_PROFILE_APPROVAL=1`, `API_PROXY_TARGET=http://127.0.0.1:18006`) | 4 passed, including live M6 HTML, single-page HTML, CSV, and unauthorised Job rejection |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows/Test-Launcher.ps1` | 23/23 launcher tests passed |
| `git diff --check cb39721 HEAD` | M6 commit whitespace passed. Whole-worktree check showed the pre-existing teammate document's trailing blank line. |

Backend set `M2_TEST_DATABASE_URL` to isolated PostgreSQL (`127.0.0.1:55436`), `M3_TEST_BROKER_URL=redis://127.0.0.1:16386/1`, `M3_TEST_COMPOSE_PROJECT` and `M2_TEST_COMPOSE_PROJECT` to `collection-m3-test-m6-a6c43b`, and `M3_TEST_COMPOSE_API_URL=http://127.0.0.1:18006`. Additional `-f` overlays passed through `M3_TEST_COMPOSE_EXTRA_ARGS`. Runtime setup follows.

Reran after correcting fixture `register_source` return handling, PostgreSQL retry TestClient loopback base URL, Evidence store subclass compatibility, and the Compose Profile UUID assertion. First Playwright launch lacked default Chromium and passed with installed Chrome. The first browser run failed to bind the API host port and passed on an available loopback port.

## E. Actual Runtime Verification

- Used Docker Desktop Linux Engine 29.9.3, Compose 5.7.0, and repo `Dockerfile`. In the isolated project ran `docker compose @composeArgs config --quiet`, `docker compose @composeArgs up -d --wait postgres redis`, `docker compose @composeArgs build api`, `docker compose @composeArgs run --rm api python -m alembic upgrade head`, `docker compose @composeArgs run --rm api python -m alembic current --check-heads`, and `docker compose @composeArgs up -d --wait`. `curl.exe --retry 8 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:18006/api/v1/health` returned `{"status":"ok"}`.
- `$composeArgs` used `-p collection-m3-test-m6-a6c43b -f compose.yaml -f compose.fixture.yaml -f .local/m6-compose.image.yaml -f scripts/windows/compose.subnet.yaml -f scripts/windows/compose.fixture-subnet.yaml`. The local overlay used dedicated `collection-backend:m6-a6c43b` image and loopback Redis test port. Exhausted Docker pools required the repo subnet overlays and verified `10.249.111.0/24` and `10.249.112.0/24`. Windows denied API `58006`, so the isolated test used `18006`.
- Live browser Job `9d3ea0d0-d827-4b9c-8813-603981ef2738` collected 3 HTTP pages through Chrome, Vite proxy, FastAPI, Dispatcher, Redis, Celery, and PostgreSQL. Terminal `partial`, 3 valid, 2 invalid, and 1 duplicate. Used UI to create Profile, Preview, Validate, Approve, and Submit, then opened Page 3 Evidence and Quarantine to compare URL, digest, and page-specific links. `Alpha`, `Beta`, and `Gamma` respectively referenced pages 1, 2, and 3. Both Quarantine entries were item 2 and linked to pages 2 and 3.
- In the same Chrome session, single-page Job `a6eefe3a-823e-4ca3-ac11-737e35cb9cb3` was `succeeded` with 2 valid. CSV Job `3987a61a-5147-4b64-b163-b363c92363dc` was `partial` with 2 valid, 3 invalid, and 1 duplicate.
- Ran an inline HTTP smoke check with `.\.venv\Scripts\python.exe -`, using `create_approved_source` and `submit_job` with an XPath Profile on the same API. Item selector `//article[h2[normalize-space()]]`, field `./h2`, next link `//a[@class='next']`. Job `729be76a-f8b0-4c3f-a34f-ed276835ba0d` traversed 3 pages on attempt 1, `succeeded`, with 3 valid, 0 invalid, 1 duplicate, and `error=null`.
- Compose Job `f4ff85c3-fb1f-4b0a-802f-d4e5f4252cf4` had fetched pages and was waiting on a SQL lock when attempt 1's worker received SIGKILL. Dispatcher recovered after 90-second lease expiry. Attempt 2 committed 3 Evidence, 3 Records, 2 Quarantine, 1 duplicate, and one `PARTIAL` event. Redis redelivery logged `job_not_pending`, with identical results and events. PostgreSQL and API restart retained all API snapshots, all 3 SHA-256 digests, and raw bytes read by both API and worker.
- Stopped only the isolated project with `docker compose @composeArgs stop` and used `docker compose @composeArgs ps --status running --quiet` to confirm. PostgreSQL, Redis, and Evidence volumes remained.

## F. Known Issues and Limitations

- Retries fetch from page one, and changed sources can return different bytes. SQL publishes one completed attempt. Termination or rollback may leave unreferenced Evidence directories. Filesystem rename and PostgreSQL commit are separate.
- Preview and Validate sample one page. Job runtime verifies the link chain. Timeout without a response produces a Job error without raw capture for that page. The worker hard limit is 60 seconds and lease 90 seconds. Extreme page-load performance remained untested.
- M6 used controlled next links. Public HTTPS, Topic and Keyword Search, Search-to-Detail, Article Identity, Observation History, scheduling, AI and Sentiment, and IA and KOL were outside scope.
- Independent Windows tests checked launcher logic. Deployment walkthrough used Compose and Vite. Another 8 GB Windows cold installation and manual assistive technology acceptance were unrun.

## G. Git Status

- Local branch `feature/M6-multi-page-evidence`.
- `ff87fd4cebe9b5831ed7d1a416448dd24ff1e9a0` — Collect controlled HTML pages with page-level evidence.
- `1af3200fa6552ecc3ab5e97433f8f328223d4537` — Configure pagination and inspect page evidence in the dashboard.
- `0b6dbe221d8e65d1a8449ce4af7d9474efc5821e` — Compare profile pin UUIDs in the live recovery test.
- The two pre-existing edits in section A stayed in the worktree. Original M5.5 branch retained its starting commit. `main` was not changed or merged, and there was no deployment.
- After user authorisation, the GitHub connector published `feature/M6-multi-page-evidence` and opened Draft PR #1. Remote baseline was `2f880f9ae1e30fa3fff7e11261194873b8ccd2de` on `main`. The local M5.5 commit was absent from remote history. Thirty-five base and dependency blobs matched before publication. Remote commits were `7eea6cc`, `acb9d86`, `fa8fa3b`, and `d22a5a1` in order. Before opening the PR, 32 changed files matched local M6 commits. [Draft PR #1](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/1)

## H. Acceptance Checklist

| Condition | Status | Observed evidence |
| --- | --- | --- |
| M5.5 Core, Dashboard, and launcher regression | PASS | PR HEAD 200 backend passed, live HTML and CSV, 86 Chrome, and 23 launcher tests |
| One Job visits at least three controlled HTML pages | PASS | Browser Job `9d3ea0d0-d827-4b9c-8813-603981ef2738` with 3 Evidence objects |
| Page limit, URL loop, and authorised origin and redirect controls | PASS | Fixture verified no next page request at limit, fragment and encoding aliases, cross-origin rejection, redirect loop, and relative URL |
| Accepted Record links to its page | PASS | 3 Records reference separate page 1–3 Evidence |
| Quarantine links to its page | PASS | Pages 2 and 3 each have item 2 with distinct Evidence and Quarantine IDs |
| Upgrade from old schema | PASS | PostgreSQL 17 ran `0006 → 0007`, and old links, raw bytes, and SHA-256 matched |
| HTTP timeout, 429, 5xx, partial, and retry | PASS | Loopback fixtures and PostgreSQL retry exhaustion and recovery |
| Worker interruption and duplicate execution | PASS | Real prefork worker killed while waiting on SQL lock, attempt 2 recovered, and terminal redelivery added no data |
| API compatibility and PostgreSQL restart persistence | PASS | Legacy single-object API returned Page 1. All M6 snapshots, Evidence SHA-256, and raw files matched after restart. |
| Live Compose and browser walkthrough | PASS | API health and Chrome Profile → Job → Evidence |
| M6 scope and limitations | PASS | Contract, tests, and this report. M7–M10 features were outside this change. |
| Draft PR publication (conditional delivery) | PASS | GitHub confirmed open Draft targeting `main`. [PR #1](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/1) |

## I. Recommendation

M6 met local functional acceptance and was ready for independent ChatGPT or teammate review. M7 awaited M6 review and user authorisation. [Draft PR #1](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/1)
