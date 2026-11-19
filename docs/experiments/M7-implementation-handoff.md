# M7 Implementation Handoff Report

2026-11-16 Hong Kong time

## A. Repository Baseline

- Local baseline was `2b95b26ef55f47702dfdc1d257c2642f595bab09` on `feature/M6-multi-page-evidence`. GitHub Draft PR #1 was open and unmerged. GitHub `main` was `2f880f9ae1e30fa3fff7e11261194873b8ccd2de`. [Draft PR #1](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/1)
- Remote M6 baseline `96e7a5c1bc2ae9f3a849641327de6f1ef2167053` directly followed accepted `654134983654aaeabb63c4de7d36d4f3e5784c72` and differed only by the M6 handoff. Comparing 287 remote and 290 local tracked blobs found matching runtime code, schema, frontend, and tests. Nine README, guidance, or documentation blobs differed, with three additional local historical or collaboration files.
- Read repository instructions, project skills, M2 and M3 architecture, Job and REST contracts, M6 handoff, and pagination contract. Reused Source authorisation, Profile hash pin, Scrapling selectors, Generic Record ingestion, Quarantine, Evidence sidecars, PostgreSQL attempt fencing, Dispatcher, and Celery.
- M6 lacked public destination controls, shared pacing, and distinct capture kinds. Existing Job payload and Profile JSONB could hold keyword and search strategy. Only the queryable Evidence kind needed DDL.

## B. Completed Tasks

| Work | Implementation and verification |
| --- | --- |
| M7.0 Audit and baseline | Compared local and remote M6 and ran unmodified local regression. |
| M7.1 Approved HTTPS | Added explicit origin and path authorisation, DNS pinning, TLS peer check, and robots policy. |
| M7.2 Keyword configuration | Included endpoint, query key, selectors, and limits in the Profile hash, with a new version and validated sample before approval. |
| M7.3 Search pagination | Reused M6 next-link checks, URL normalisation, and visited tracking. |
| M7.4 Detail and Evidence | Shared ingestion validates details while preserving search and detail captures, Quarantine, and Record lineage. |
| M7.5 Per-origin rate | Redis Lua shares an origin lock and interval across API, workers, Jobs, and Source registrations. |
| M7.6 Recovery | Reused claim, lease, retry, dispatch, and SQL publication with live M7 retry and worker-loss checks. |
| M7.7 Operator controls | Added inputs and Evidence types to existing Sources, Profiles, Collection Jobs, and Data Explorer. |

## C. Architecture Changes

- Authorised Source → approved Profile → pinned Job version and hash → robots → Keyword Search and M6 next link → authorised detail → Generic Record validation and deduplication → Evidence and Quarantine → attempt fencing and terminal publication.
- Existing Job, Preview, and Validate bodies still accept controlled Web `url` or CSV. Search submits `{ "adapter_type": "web", "keyword": "…" }`. Search pages and details have separate counts. Normalisation deduplicates URLs within an attempt. Without Search configuration, a Profile keeps the previous hash algorithm and serialisation.
- Alembic `0008_evidence_capture_kind.py` defaults earlier rows to `input` and constrains kinds to `input`, `search`, and `detail`. Evidence ID, page, Run, FK, and sidecar hash persist. The original single-Evidence endpoint returns page one and the multi-page endpoint sorts by `page_number`.
- One request per origin. The holder releases the lock with its token and Redis sets a shared pacing deadline atomically. The minimum release interval uses the stricter Source or robots rule. HTTP 429 also records `Retry-After`. Requests fail closed when Redis cannot confirm, and existing PostgreSQL retry and lease policy handles later attempts. [M7 REST and operator contract](../contracts/M7-controlled-website-collection.md)

## D. Security Review

- Public collection requires HTTPS, lower-case DNS hostname, standard port 443, registered origin, and allowed path. Check Source and Profile before execution and Source again before every outbound request. Reject cross-origin next, detail, and redirect links, user information, anomalous encoding, and ambiguous paths.
- Validate every DNS answer per HTTPS request. Reject loopback, private, link-local, multicast, translated IPv6, listed special public or metadata addresses, and mixed safe and unsafe answers. A fresh curl handle pins an eligible IP, verifies TLS for the SNI hostname, and checks the actual peer. Disable automatic redirects and environment proxies. [libcurl CURLOPT_RESOLVE](https://curl.se/libcurl/c/CURLOPT_RESOLVE.html)
- Robots uses the public product user agent, longest matching paths, groups, wildcards, and timing directives. Explicit denial, challenge, unparseable policy, or unsupported interval stops collection. Timeout, 429, 5xx, request budget, response size, and redirect limit have structured errors. Errors use fixed messages. Full discovered URLs remain in Evidence within its authorisation boundary. [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html)
- Each attempt allows 1–5 search pages, up to 10 unique details, 20 HTTP requests, 2 redirects per page, 1 MiB per response, 2 seconds for combined DNS and transfer, 45 seconds total, and 3 execution attempts per Job. Celery hard limit remains 60 seconds and PostgreSQL lease 90 seconds. Keyword Preview and Validate wait up to 50 seconds in the frontend to allow robots pacing and network limits.

## E. Test Results

| Command run | Result |
| --- | --- |
| `.\.venv\Scripts\python.exe -m pytest -q -rs --tb=short backend/tests` (M6 baseline with localhost fixtures) | 148 passed, 52 skipped due to PostgreSQL, Redis, and Compose not running at that point. |
| `.\.venv\Scripts\python.exe -m pytest -q --tb=short backend/tests/m1/test_m7_search.py -k 'robots or timeout'` | 6 passed, 45 deselected. |
| `.\.venv\Scripts\python.exe -m pytest -q -s --tb=short backend/tests/m2/test_m3_compose.py -k m7_recovers` (after fix) | 1 passed, 4 deselected in 32.85s. |
| `.\.venv\Scripts\python.exe -m ruff check backend` and `-m ruff format --check backend` | Both passed. |
| `npm.cmd test` (`frontend/`, Chrome, port 5195) | 86 passed. |
| `npm.cmd run typecheck` and `npm.cmd run build` (`frontend/`) | Both passed. |
| `npm.cmd test -- tests/core-workflow.integration.ts --workers=1 -g 'M7 browser'` (Chrome, `M4_REAL_API=1`, `LOCAL_PROFILE_APPROVAL=1`) | 1 passed, 0 failed. No horizontal overflow at 1,440 and 390 px, and no axe violations. |
| `npm.cmd test -- tests/core-workflow.integration.ts --workers=1` (Chrome, `M4_REAL_API=1`, `LOCAL_PROFILE_APPROVAL=1`, API port 18007) | 5 passed in 37.4s, covering M7, M6, single-page HTML, CSV, and denied access. |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows/Test-Launcher.ps1` | 23/23 passed. |
| `.\.venv\Scripts\python.exe .local/m7-verify/live_https.py` | Two real HTTPS runs succeeded, each with one Record and two Evidence captures. |
| `.\.venv\Scripts\python.exe -m pytest -q -rs -s --tb=short --junitxml=.local/m7-verify/backend-regression-final.xml backend/tests` (`fe779b1`) | **256 passed in 420.12s**, exit 0. JUnit 256 total, 0 failed, 0 errors, 0 skipped. Log in `.local/m7-verify/backend-regression-final.log`. |

Full tests set `M2_TEST_DATABASE_URL` to PostgreSQL 17 loopback `55437`, `M3_TEST_BROKER_URL=redis://127.0.0.1:16387/1`, `M2_TEST_COMPOSE_PROJECT` and `M3_TEST_COMPOSE_PROJECT` to `collection-m3-test-m7-verify`, and `M3_TEST_COMPOSE_API_URL=http://127.0.0.1:18007`. Compose used the project, `compose.yaml`, `compose.fixture.yaml`, and `-f .local/m7-verify/compose.image.yaml -f scripts/windows/compose.subnet.yaml -f scripts/windows/compose.fixture-subnet.yaml`. Migrated an empty DB to `0008` and confirmed with `alembic current --check-heads`. Legacy data ran `0006 → head` and `alembic check`, retaining Record, Quarantine, and Evidence IDs, bytes, and new defaults.

First regression was 249 passed and 1 failed in 387.33s. Global `CELERY_BROKER_URL` redirected the existing outage test to a working broker, and removing it passed. After adding M7 worker-loss coverage, 255 passed and 1 failed in 449.11s. The live kill revealed Dispatcher reran fixture host validation when reading retry bounds. The fix reads the bound from the approved version. The worker still checks destinations. Focused recovery passed and full regression ran on the corrected commit.

## F. Actual End-to-End Verification

- Dedicated image `collection-backend:m7-verify` used existing PostgreSQL, Redis, API, Celery, Dispatcher, and fixture services. `docker compose @m7ComposeArgs config --quiet`, `up -d --wait postgres redis`, `build api`, `run --rm --no-deps api python -m alembic upgrade head`, `run --rm --no-deps api python -m alembic current --check-heads`, and `up -d --wait --no-build` passed. Health returned `{"status":"ok"}`. First subnet overlapped M6, so used `10.249.115.0/24` and `10.249.116.0/24`. One early health response was empty, then recovery succeeded.
- Two actual prefork workers ran simultaneous same-origin Cards/CSS and Catalog/XPath Jobs. Final test Jobs `726d44ff-8fa0-43ae-aab3-74f6e72a9696` and `8d7cb697-c1ee-415a-94d8-fe33b5a574d9` each had five Evidence captures, two valid Records, and one Quarantine entry. The layouts sent 12 requests, with shortest completion-to-start gap 1.004 seconds. Capture, Record, and Quarantine references were checked.
- Chrome Job `e7e22be8-c80e-4357-b58d-0b0a3f10d2f0` completed Source registration and authorisation, Draft, Preview, Validate, Approve, and keyword submission, then opened Detail Evidence. The Unicode fixture keyword `C++ & 茶#/` returned two search and three detail captures and three correctly linked Records. Browser sample used a title-only schema. Two backend fixtures used an integer field for Quarantine. Local screenshots were ignored under `.local/m7-verify/browser/`.
- Public HTTPS used **Catalog108**, which explicitly permitted scraping practice. The approved `/jobs` policy and site `robots.txt` covered a search and detail with keyword `DevRel Advocate`. Second live Job `12312afe-367d-4d92-ac2a-cd178995bd39` was `succeeded` on attempt 1, with 1 valid Record, 0 Quarantine, and HTTP 200 for both captures. Record `cfbf9dc6-da40-55a9-9400-836c6d129209` referenced detail Evidence `f60f9461-3733-4df8-9db8-2fd6f28aaffc`. [Catalog108 practice sandbox](https://practice.scrapingcentral.com/)
- Catalog108 used `/jobs/search`, parameter `q`, XPath `(//tbody/tr)[1]` and `./td[1]/a`, detail selector `//article[@class="job-detail"]`, and title `.//h1`. Source pacing 1,500 ms, up to one detail and four requests. The script used live FastAPI to create Source and Profile, validate sample, approve, and submit.
- After the corrected Compose restart, API still returned that Catalog108 Job's Record and both Evidence captures. Both raw files in API and worker containers matched their SHA-256 values.
- Corrected focused Job `a50b49c3-e039-4643-9181-a58ebdb89c0c` and full-regression Job `053f514e-3b4c-4081-aa7d-ce69d542f5f2` were interrupted with `SIGKILL` while waiting for the Evidence publication lock. The test expired their isolated leases to trigger Dispatcher. Attempt 2 verified five Evidence captures and correct Record links. The old attempt produced no visible results. Redelivery logged `job_not_pending`. Redis, PostgreSQL, and API restarts preserved API snapshots and all five capture SHA-256 values. M6 regression Job `a8aee1c9-726c-44a0-a2d6-9dca13e78751` separately waited for the actual 90-second lease.
- Ran `docker compose @m7ComposeArgs stop` and checked `ps --status running --quiet` showed no running containers. PostgreSQL, Redis, and Evidence volumes remained.

## G. Known Limitations

- Static `text/html` and one origin. The Profile uses one GET keyword parameter and does not log in, submit POST forms, load subresources, or execute JavaScript. Sources needing robots redirects, intervals over 10 seconds, or other robots formats stop safely.
- Preview and Validate use the first search page and first detail. The full link chain and remaining results are checked at runtime. Redis mutual exclusion stays at one request per origin. The legacy M6 HTTP fixture keeps its runner. Complete distributed Redis data loss was unverified, and Compose used existing AOF. A new attempt fetches again and may observe changed site content.
- Superseded or interrupted attempts may leave SQL-unreferenced Evidence files at the existing filesystem and DB boundary. Cross-Job Article Identity and Observation History were outside scope.
- M8 Category and Topic, Article Identity, Observation History, and Manual Refresh, M9 guided flow, and M10 were outside M7. No production browser dependency, public deployment, or downstream application logic was added.

## H. Git Information

- Local and GitHub branch names were `feature/M7-controlled-website-collection`. GitHub branch started at remote M6 `96e7a5c1bc2ae9f3a849641327de6f1ef2167053`.
- `4251f892365129f1e4fffb063969e2fdcb4816df` — Collect approved keyword searches and preserve detail evidence.
- `72f00d8ac569f044652885791632c454a4db04d0` — Expose keyword collection in the operator console.
- `4dc96b48d60d641a87dda0254085657db1c11968` — Verify keyword recovery and document the M7 contract.
- `fe779b1a288a3ccbe09780eafde737bea42a1b6f` — Read the pinned retry bound during dispatcher recovery.
- Draft PR URL remained pending. GitHub tools created the branch, and automatic approval review rejected uploading local code because it lacked confirmed authorisation in trusted conversation. Remote M7 still pointed at M6 at that time. Local commits contained M7 files only, excluding the existing teammate brief edit and deleted M5 launcher handoff. No PR was merged and `main` stayed as before.

## I. Acceptance Checklist

| M7 acceptance criterion | Status | Observation |
| --- | --- | --- |
| M6 retains functionality | PASS | Full backend regression includes M6 pagination and worker recovery. |
| Explicitly authorised public HTTPS Source | PASS | Actual Catalog108 Job and allowlist and DNS tests. |
| Keyword uses operator-approved pinned config | PASS | Chrome approval and pinned hash. |
| Search result pagination | PASS | Two pages with Cards, Catalog, and Chrome, plus loop and invalid-link checks. |
| Fetch detail only from a verified destination | PASS | HTTPS URL, DNS, redirects, robots, and blocked-address tests. |
| Detail extraction produces Generic Records | PASS | Both fixtures and Catalog108. |
| Accepted Record has correct Evidence lineage | PASS | CSS, XPath, Chrome, and public HTTPS lineage matched. |
| Trace search and detail | PASS | `capture_kind`, API, and Evidence Metadata. |
| Same-origin rate control across workers | PASS | Two live prefork workers, 12 requests, shortest interval 1.004 seconds. |
| Safety and recovery tested | PASS | DNS, blocked redirects, robots, 403, 429, 5xx, timeouts, Redis, PostgreSQL, and worker loss. |
| Existing HTML and CSV regression | PASS | Existing M5.5 and M6 backend and browser regression. |
| Two controlled end-to-end fixtures | PASS | CSS Cards and XPath Catalog. |
| Actual startup and browser verification | PASS | Compose, FastAPI health, and Chrome against a persisted Job. |
| Live HTTPS | PASS | Catalog108 attempt 1. |
| M8–M10 and application-specific scope remain separate | PASS | Changes limited to the shared Core and operator integration above. |
| Stacked Draft PR ready for independent review | NOT VERIFIED | GitHub source upload required trusted conversation authorisation. |

## J. Independent Review Recommendation

Local implementation and functional acceptance passed and were available on the local branch and in this report. For independent GitHub review, confirm publication authorisation, push the commits to M7, and open a Draft PR targeting M6. Independent M7 acceptance was pending. M8 had not started.
