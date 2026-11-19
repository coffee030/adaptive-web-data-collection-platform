# M16 final MVP acceptance

## Repository and integration audit

Verification used GitHub REST, `git ls-remote`, and the local commit graph. The starting worktree was clean. `main` was `2f880f9ae1e30fa3fff7e11261194873b8ccd2de` and independently reviewed M15 was `0b609b198146fdc2e0ab494e7a4a3b58083abc5d`. `git rev-list --left-right --count mainSHA...M15SHA` returned `0 33`. M16 branched from that M15 commit. M6 commit `7eea6cc` through the M15 handoff shared an ancestry chain, with 33 commits covering M6–M15. Backend, Dockerfile, and Alembic matched the completed M10 version.

| Existing Draft PR | Target | Scope |
| --- | --- | --- |
| [#1](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/1) | `main` | M6 multi-page Evidence |
| [#2](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/2) | `feature/M7-controlled-website-collection` | M8 content identity, observations, and Topics |
| [#3](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/3) | `feature/M8-data-identity-collection-management` | M9 Dashboard and exports |
| [#4](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/4) | `feature/M9-dashboard-integration-export` | M10 Core reliability and Demo |

REST reported `push`, `maintain`, and `admin`, with merge commit, squash, and rebase available. The effective branch rules query returned empty, and the classic protection route returned HTTP 404. Actions were enabled and the baseline had no workflow. Branch rules and permissions required another check in M16-H. Independent review was a delivery condition.

The audit covered AGENTS, PRODUCT, DESIGN, UI Slop v1.7, M10 reliability and deployment reports, and M11–M15 handoffs. M16 made a narrow fix. Job Detail previously trusted `requestId` in Router state. The originating URL now supplies only a query hint. The return link appears only if a matching Request is fetched and its saved child Jobs include the current Job. The original Request URL and focus return are retained. A direct Job link works independently.

## Architecture and product scope

React and Vite use a loopback same-origin proxy to FastAPI. PostgreSQL stores authorisation, immutable configurations, Topic Bindings, Jobs, Events, results, and provenance. The Dispatcher polls for due work and sends it to workers through Redis and Celery. The worker protects writes with leases, claim attempts, and terminal fencing. Controlled HTML and HTTPS search parse search and detail pages within policy. CSV uses an approved dataset and mapping. Valid data is submitted after deduplication, and validation problems remain in Quarantine. Evidence metadata points to persisted capture bytes and SHA-256. Article identity, content versions, and observations retain what each run saw. CSV and JSON exports include validated records for a whole terminal Job or Request.

M6–M10 integrated Core, Topics, Evidence, exports, and the Windows Demo. M11–M15 delivered Overview, New Collection, Data Explorer, the operator workspace, and Job diagnostics. M16 removed the Desktop Shortcut Installer, fixed the origin of return-navigation data, added minimal CI, and verified the full MVP.

## Verification results

The table distinguishes checks run for M16 from earlier evidence. Individual results were saved in ignored `.local/m16/`.

| Area | Checks and evidence | Result |
| --- | --- | --- |
| Full backend | 270 PASS, 0 FAIL, 0 SKIP, 0 ERROR in 532.11 s. Includes 6 Compose fault and recovery cases, 7 broker cases, 8 reliability cases, and 21 retry cases. Python 3.12.14 and pytest 9.2.0 with live PostgreSQL, Redis, and Celery. Evidence in `backend-complete.log` and JUnit `backend-complete.xml`. | PASS |
| FastAPI, SQL, and Evidence | Verified persisted APIs, repeatable fixture data, migrations, real PostgreSQL restart, and Evidence bytes. Before writes, SQL confirmed zero Normal Sources, Profiles, Topics, Requests, Jobs, Records, and Evidence. | PASS |
| Frontend build and behaviour | Ran `npm.cmd run build` and the full Chrome suite. Added five regressions covering Request membership, direct URLs, stale hints, and Back and Forward. The suite had 154 PASS, 0 FAIL, 0 SKIP in `frontend-final.json`. All 187 backend-only tests selected by CI also passed in the Linux image. | PASS |
| Live frontend integration | 26 distinct Playwright cases passed across environments. Browser QA Core and operator 17, fresh Normal 3, Launcher Demo 4, and dedicated financial version and lineage 2. The 9 skips in `browser-live.json` each ran in their assigned environment. Covered controlled Web and CSV, Source, Profile, and Binding checks, Host and Origin rules, Redis and DB outage, return navigation with GETs, replay with the same UUID, Request and Job scope, CSV and JSON, Evidence, and Article History. | PASS |
| Demo startup and baselines | Ran `cmd.exe /d /c Start-FYP-Demo.bat` from a fresh archive on Windows. Exit 0 in 103.78 s. Lockfile install, port conflict handling, WSL2 Linux Engine, PostgreSQL and Redis, Alembic, API, worker, Dispatcher, fixture, and Vite all passed. Windows received the browser URL and the API recorded the live Overview GETs. The Desktop shortcut inventory matched. | PASS |
| Other Windows operations | 28/28 PowerShell 5.1 launcher regressions. Normal, invalid-option exit 1, Setup, Diagnose, and Stop ran from an archive directory with spaces and Unicode. Actual Normal SQL found all 7 tables empty. Repeated Demo Start took 28.68 s and reused the Vite PID. Direct BAT restart after Stop took 31.71 s. The same four volumes remained, with 7 Requests, 14 Jobs, 38 Records, 38 Observations, and 62 Evidence. No cross-Job Evidence was missing, and content digests matched. The real BAT test used an archive of `74202d4`. Later code changes were confined to frontend display and were verified separately. | PASS |
| Persisted Synthetic Demo and controlled Partial | The manifest reported 2, 8, and 8 Records and Observations, and 4, 12, and 12 hash-verified Evidence captures. The actual browser checked approved Sources, Profiles, and Bindings, exports, creating each preset from Overview, uncertain replies that retained the exact request UUID, and two Partial Jobs for `detail404`. A separate version fixture retained initial content and its original Observation and created a version for the new revision. | PASS |
| Design and accessibility | Actual UI Slop v1.7 review found and corrected the Overview heading conflict and small Binding link touch targets. After correction, 17 route and viewport combinations showed no page-wide horizontal overflow or axe WCAG A or AA violations. See `visual-review-verified/audit.json` and 17 screenshots. Existing Playwright regressions covered 1440, 900, 768, 390, and 320 px, native Chrome 200%, Light, Dark, System, keyboard focus, touch, and reduced motion. | PASS |
| Constrained memory | Windows 11 build 26200, 31.89 GiB host RAM, Docker Engine 29.9.3 with 15.56 GiB Linux RAM. Candidate Demo used one worker with prefork concurrency 1. Container memory and swap limits were API 384, worker 512, Dispatcher 256, PostgreSQL 256, Redis 128, and fixture 128 MiB, totalling 1,664 MiB. Samples before and after collection and browser use totalled about 348 and 353 MiB. All six containers had OOMKilled=false and restart count=0. | PASS |
| Physical 8 GiB, Docker Desktop cold start, and physical screen reader | Other projects were using the existing Windows Docker Engine. Launcher tests covered simulated Engine unavailability and error paths. Accessibility used keyboard, native 200% zoom, responsive views, and axe. | NOT RUN |

The audit rechecked historical M10 evidence from 27 batches with one, two, and four workers, and shared-origin rate limiting. M16 safely reran the reliability cases against the same Core and retained the historical throughput measurements. [M10 Reliability](M10-Reliability-Evaluation.md) [M10 Scalability](M10-Scalability-Evaluation.md)

## Reproduction

The environment was Windows 11 AMD64, WSL 3.0.5, Docker Compose 5.7.0, Node 22.18.0, npm 10.9.3, CPython 3.12.14, and pytest 9.2.0. These environment variables refer to a dedicated project. Select free loopback ports and non-overlapping RFC1918 subnets before reproducing the run.

```powershell
python -m venv .local/m16/venv
. ./.local/m16/venv/Scripts/Activate.ps1
python -m pip install -r backend/requirements.txt
python -m pip check
. ./backend/experiments/m10_environment.ps1 -Project collection-m3-test-m10-m16-core -ApiPort 18176 -PostgresPort 55546 -RedisPort 16446 -FrontendPort 52910 -Subnet '10.250.251.0/24' -FixtureSubnet '10.250.252.0/24'
```

Build with `docker build -t collection-backend:m16-release-qa .`. In `.local/m16/core-image.yaml`, use that image for `api`, `worker`, `dispatcher`, and `collection-fixture`, then run the following commands.

```powershell
$composeArgs += @('-f','.local/m16/core-image.yaml')
$env:M3_TEST_COMPOSE_EXTRA_ARGS += ' -f .local/m16/core-image.yaml'
docker compose @composeArgs up -d --no-build --wait postgres redis collection-fixture
docker compose @composeArgs run --rm --no-deps api python -m alembic upgrade head
docker compose @composeArgs up -d --no-build --wait
python -m pytest -q -rs --tb=short --junitxml=.local/m16/backend-complete.xml backend/tests
```

Browser recovery cases that stop services used a separate project, `collection-m3-test-m10-m16-browser` (API 18177, PostgreSQL 55547, Redis 16447, Vite 52913, subnets 10.250.249.0/24 and 10.250.250.0/24). Initialise it the same way, add the image overlay to `M4_COMPOSE_OVERLAYS`, and point `M9_TEST_PYTHON` to the Python above. For the fresh Normal tests, set `M12_EMPTY_NORMAL=1`, `M14_EMPTY_NORMAL=1`, and `M15_EMPTY_NORMAL=1`, and select with `--grep "fresh Normal|isolated empty Normal"`. Clear the three flags before the full live API suite.

```powershell
cd frontend
$env:PLAYWRIGHT_CHANNEL='chrome'
npm.cmd ci
npm.cmd run build
npm.cmd test -- --workers=1
```

Set `M4_REAL_API=1` for integration. In a separate shell, leave it unset and run the same `npm.cmd test` for mocks. On the running candidate Demo set `M10_SYNTHETIC_URL=http://127.0.0.1:5201` and run `npm.cmd test -- --grep "existing Synthetic|launcher dashboard" --workers=1`. Test Job Detail with `M15_DEMO_READ=1`, `PLATFORM_SYNTHETIC_DEMO=1`, and `API_PROXY_TARGET=http://127.0.0.1:58101`. Run version switching only on the dedicated `collection-m3-test-m10-m13-m16-demo` fixture (API 18178, Vite 52916). Use `scripts/windows/compose.demo.yaml` and `python -m backend.experiments.demo_provision`, set `M13_QA_DEMO_URL` and `M13_QA_FIXTURE=collection-m3-test-m10-m13-m16-demo-collection-fixture-1`, then run `npm.cmd test -- m13-continuity.integration.ts --workers=1`.

Run launcher regression with `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/windows/Test-Launcher.ps1`. Archive the candidate with `git archive --format=zip HEAD` and extract to a new directory containing spaces and Unicode. Start with `cmd.exe /d /c Start-FYP-Demo.bat` and check the exit code. [Windows setup](../setup/Windows-One-Click-Setup.md)
