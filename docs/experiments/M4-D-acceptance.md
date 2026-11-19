# M4-D Acceptance Report

Verification ran on 2026-11-14 Hong Kong time. M4-C documentation baseline was `bb7c856`, with earlier implementation `b2cd571`. Implementation commit `f0e7bed` and test commit `6f1f53b`. Live FastAPI OpenAPI and the checkout matched for 8 GET operations and 6 result schemas. [API Contract Matrix](../contracts/M4-D-results-api-matrix.md)

## Browser and build gates

Run in `frontend/` with Node 22.18.0, npm 10.9.3, and Chrome channel.

```powershell
npm.cmd run typecheck
npm.cmd run build
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:M4_FRONTEND_PORT = '5190'
npm.cmd test -- --output=test-results/controlled-m4d
```

- Before changes, build, 40 controlled, and 6 live tests passed against API 58004.
- Final typecheck and Vite build passed. Controlled suite had 58 passes in 41.2s, including 40 existing and 18 M4-D, with zero failures or skips. New checks covered keyboard, filters, pagination, list return, 404, 422, 503, network retry, nested JSON, long values, clipboard, escaping HTML, three Job counts, Quarantine, and Evidence navigation.
- A parallel rerun shared the Playwright artifact directory and two teardowns reported ENOENT. Final reruns used distinct output directories. The first full live run also found the old Sources suite lacked an approved CSV Source named `Controlled fixture`. A dedicated fixture was created with existing `create_approved_source` and the suite reran with existing assertions.

## Live FastAPI, PostgreSQL and worker acceptance

The isolated `collection-m3-test-m4d-ui` used API 58016 and PostgreSQL 55448. The README M3 Compose workflow created new named volumes, initialised with `docker compose ... run --rm api python -m alembic upgrade head`, and started fixture, API, Redis, Dispatcher, and worker using the existing image. Final commands ran in `frontend/`.

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:M4_FRONTEND_PORT = '5191'
$env:M4_REAL_API = '1'
$env:LOCAL_PROFILE_APPROVAL = '1'
$env:API_PROXY_TARGET = 'http://127.0.0.1:58016'
$env:M4D_COMPOSE_PROJECT = 'collection-m3-test-m4d-ui'
$env:POSTGRES_USER = 'collection_test'
$env:POSTGRES_DB = 'collection_m4d_ui'
$env:POSTGRES_PORT = '55448'
$env:API_PORT = '58016'
$env:POSTGRES_PASSWORD = 'unused-by-start-stop-and-exec'
# Optional. Choose an absolute path for 16 screenshots.
# $env:M4D_CAPTURE_DIR = '...'
npm.cmd test -- --workers=1 --output=test-results/live-m4d
```

Final result was 9 passed in 34.9s, 6 existing and 3 new cases below, with zero failures or skips.

| Workflow | Observed result |
| --- | --- |
| Valid HTML | `ecb5fc92-d16c-4a63-9d1a-ecd0254e351a` succeeded with Valid 2, Invalid 0, Duplicates 0. River Walk and Lake View were HTML items 1 and 2. Opened Records from the Job, checked JSON against the API and capture metadata, returned to the Job, and opened the approved Profile. Evidence `73b7feb4-0ff2-4193-b6d0-d979ffd28f11` SHA-256 was `5d65fc9aec1cc428b872490e5e1d7049e947c47fcafb0f38eb535316940162e0`. |
| Partial CSV | `f36f9043-4f4c-4434-a5a3-1d6dff2367a7` was partial, with Valid 2, Invalid 3, Duplicates 1. Lines 5, 6, and 7 returned `required_field`, `wrong_type`, and `invalid_row`. The line 4 duplicate was absent from Quarantine. Two Records and three Quarantine entries referenced Evidence `814f5d66-12ff-4ae3-82d7-f479cc5f5167`, SHA-256 `15ad900bbc23656d0049eeb4dc48c51b501cd9d24cce4976876b8f138b02acfa`. |
| Persistence and recovery | Stopped dedicated API and PostgreSQL. Vite lost the connection and UI showed Backend unavailable while retaining the Job ID filter. Restarted the same services, waited for `/health`, and Retry loaded the same URL. For Job `02009e58-264e-41c4-8fde-1077ba17b11f`, Job, Record, Quarantine, Evidence, and Profile DTOs matched individually, with the same PostgreSQL named volume. In-container `LocalEvidenceStore.resolve()` read original bytes and recomputed SHA-256, matching API and CSV fixture. |

Node SHA-256 also compared HTML and CSV fixture bytes against backend metadata. The browser displays the stored digest. The backend test process independently recomputed the raw bytes. The test project stopped with volumes retained.

## Backend gates

Full regression used `collection-m3-test-m4d` (API 58015, PostgreSQL 55447) and separate Windows Redis 56391. The README M3 procedure used the existing Docker test image, separate PostgreSQL volumes, a random test DB password, and the existing Redis binary in `var/m3-redis-test`. Point `M3_TEST_COMPOSE_PROJECT` and `M2_TEST_COMPOSE_PROJECT` at the project, `M3_TEST_COMPOSE_API_URL` at its API, `M2_TEST_DATABASE_URL` at its DB, `M3_TEST_BROKER_URL=redis://127.0.0.1:56391/0`, and `M3_TEST_REDIS_SERVER` at the test executable.

```powershell
& .venv/Scripts/python.exe -m pytest -q -rs --tb=short backend/tests
& .venv/Scripts/python.exe -m ruff check backend
& .venv/Scripts/python.exe -m ruff format --check backend
docker compose @composeArgs run --rm api python -m alembic upgrade head
docker compose @composeArgs exec -T api python -m alembic current --check-heads
docker compose @composeArgs exec -T api python -m alembic check
git diff --check bb7c856 HEAD
```

172 passed, 0 failed, 0 skipped in 221.16s, covering M1 ingestion and Evidence, M2 Record, Quarantine and Evidence, and M3 worker and restart. Ruff lint and formatting passed for 56 files. Alembic showed `0005 (head)` with no drift. Scoped Git diff check passed.

## Impeccable and accessibility

Used installed Impeccable 4.9.0 Operate, polish, and audit with existing `PRODUCT.md`, `DESIGN.md`, and CSS tokens. The first context interpreted the planned `/records` route as an absolute file path. Reviewed project files directly instead. Hooks and Live Mode stayed disabled.

- The Job ID label wrapped and the input showed only part of the UUID. The fix keeps the label together and widens the desktop input. Records controls column widths, announces horizontal scrolling on narrow screens, and puts Record ID and payload first.
- Mobile Record JSON initially followed long lineage. Payload moved below the compact overview, and the two SHA-256 values use wider provenance fields. Keyboard JSON navigation restores focus and scrolling to the JSON viewport.
- Quarantine uses the same Job counts and labels by actual CSV or HTML position. Narrow rows stack problems and evidence while retaining the named problem list and raw code.
- First 390px rendered scan flagged a one-word last line in Evidence hash help. Added `text-wrap: pretty` and checked again.
- Captured and checked live CSV Records, Record, Quarantine, and Evidence at 1440, 1280, 768, and 390px. Sixteen live axe A/AA scans and 16 controlled long-data scans had zero violations. All widths had no page-wide overflow. Keyboard checks covered focus, routes, horizontal scrolling, filter submission, and JSON copying. Manual screenshot review checked hashes, structure, actions, and status. Safari, physical phones, screen readers, and full compliance audit were NOT RUN.

```powershell
& .agents/skills/impeccable/scripts/impeccable.cmd detect --json frontend/src
$env:PUPPETEER_EXECUTABLE_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$base = 'http://127.0.0.1:5189'
$job = 'f36f9043-4f4c-4434-a5a3-1d6dff2367a7'
$record = '25af2197-68df-53e1-ab9e-1c9589f62e29'
$evidence = '814f5d66-12ff-4ae3-82d7-f479cc5f5167'
$urls = @("$base/records?job_id=$job", "$base/records/$record", "$base/collection-jobs/$job/quarantine", "$base/evidence/$evidence")
foreach ($viewport in @('1440x900','1280x900','768x900','390x844')) {
  & .agents/skills/impeccable/scripts/impeccable.cmd detect --json --viewport $viewport @urls
}
```

Final source and rendered detectors returned `[]` and exit 0. One render run shared restart services and lost proxy connection, so it did not count. The final run started independent API and Vite, verified four live paths, then scanned. Local visualisations were saved in `m4d/` with `records-`, `record-`, `quarantine-`, and `evidence-` prefixes.

## Operational limits

- API Payload is a scalar-valued JSON object. The viewer can also browse nested JSON, checked with out-of-contract controlled data. It renders about 4096 UTF-16 code units at a time and preserves surrogate pairs. Copy JSON uses the full browser-parsed payload. API still sends the whole payload. JavaScript precision applies beyond safe integers.
- Web Evidence shows origin and pathname and omits credentials, query, fragment, and internal storage reference. Operators review and copy Record payload as needed. The existing trusted local API boundary applies.
- Evidence lookup starts from a known ID. Only Record and Quarantine provide the Job's Evidence reference. At this milestone, a Job with only Evidence exposed no ID in its DTO.
- Teammate review was pending. Git remote was unset.
