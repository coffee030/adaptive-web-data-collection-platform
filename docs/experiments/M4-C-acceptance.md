# M4-C Acceptance Report

This report records the historical result. The later Draft PUT adds a server-enforced revision precondition. [M4 Closure API Contract](../contracts/M4-closure-api-contract.md)

Verification ran on 2026-11-14 Hong Kong time from baseline `3699e75`. Nine Source and Profile routes and schema components agreed across M1 and M2 documentation, Pydantic, and live FastAPI `/openapi.json`.

## API contract matrix

| Operation | Method and path relative to `/api/v1/sources/{source_id}` | Input and result |
| --- | --- | --- |
| Source access context | GET root | Exact authorization and controlled policy |
| History | GET `/versions` | Array ordered by version |
| New draft | POST `/versions` | `{ configuration }`, returns 201 and version |
| Open version | GET `/versions/{version_id}` | Status, config, hash and approval metadata |
| Update draft | PUT `/versions/{version_id}` | `{ configuration }`, returns normalized persisted DTO |
| Preview | POST `/versions/{version_id}/preview` | Controlled Web or CSV input, up to 5 Candidate Records |
| Validate | POST `/versions/{version_id}/validate` | Same sample input, authoritative report and outcome |
| Approve | POST `/versions/{version_id}/approve` | `{ approver, report_id, config_hash }`, returns immutable version |

Record Schema and config schema use version `1`. Fields support string, integer, finite number and boolean. HTML supports CSS/XPath and per-field override, text/attribute extraction and URL resolution. CSV maps one header per output field. Sample input is the allowed origin plus a document path, or the allowed dataset ID plus inline UTF-8 CSV up to 1 MiB.

## Commands and results

Run frontend steps in `frontend/` with Node 22.18.0, npm 10.9.3, and the Chrome channel.

```powershell
npm.cmd run typecheck
npm.cmd run build
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:M4_FRONTEND_PORT = '5179'
npm.cmd test
$env:M4_REAL_API = '1'
$env:LOCAL_PROFILE_APPROVAL = '1'
$env:API_PROXY_TARGET = 'http://127.0.0.1:58004'
npm.cmd test
```

- Baseline build passed, and all 27 existing M4-A and M4-B tests passed.
- Final typecheck and Vite production build passed. All 40 controlled tests passed (30.3s). All 6 live tests passed (5.6s), including 2 Jobs, 1 Sources, and 3 Profiles tests.
- The isolated `collection-m4a-local` API used `127.0.0.1:58004`. Controlled HTML and CSV completed creation, save, Preview, Validate, explicit Approval, read-only reload, and PUT 409. CSV also showed a real failing report. Changing server configuration and then restoring the same hash still invalidated the old report's revision, which the backend rejected. Approval succeeded after revalidation.
- Vite returned 403 for cross-origin requests, requests without Origin, and same-origin approval requests to production preview. After revoking a validated fixture Source, FastAPI still rejected approval through the demo proxy with `source_not_approved`.
- Full HTML DTO `e9071721c70648bb8aa888961bb52369` and CSV DTO `3aeed954741d48d6b1625dc852115d4f` matched before and after `docker compose -p collection-m4a-local -f compose.yaml -f compose.fixture.yaml restart api`. Reopening read-only pages in Chrome showed the same hashes. Retiring a dedicated HTML fixture via the existing API still left original config, hash, and approver visible in history.

Full backend regression used separate project `collection-m3-test-m4c` (API 58005, PostgreSQL 55437, native test Redis 56381). Set M2 and M3 test variables and start Compose and dedicated Redis per README. Run from the repository root.

```powershell
& .venv/Scripts/python.exe -m pytest -q -rs --tb=short backend/tests
& .venv/Scripts/python.exe -m ruff check backend
& .venv/Scripts/python.exe -m ruff format --check backend
```

172 passed, 0 failed, and 0 skipped (217.40s). Ruff passed with 56 files already formatted. In the Compose API container, `python -m alembic upgrade head`, `python -m alembic current --check-heads`, and `python -m alembic check` passed and reported `0005 (head)` with no drift. The regression project was stopped.

## Design and accessibility

Used Impeccable 4.9.0, the FYP frontend skill, PRODUCT.md, and DESIGN.md. Operate review covered field groups, current state, error recovery, and read-only flow. The first render found `nested-cards` and `gray-on-color` on a disabled primary button. Fine separators kept groups and the disabled button adopted the existing surface. Final source and live 1280 and 390 scans returned `[]` and exit 0.

Run the historical detector commands from the [M5.5 checkout](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/86994a84a96423371995efef79093a6a94c31f70).

```powershell
& .agents/skills/impeccable/scripts/impeccable.cmd detect --json frontend/src
$env:PUPPETEER_EXECUTABLE_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$base = 'http://127.0.0.1:5178/sources/3b70bfdd286a4e39b86b33607a0362a6/profiles/'
foreach ($view in @('1280x900','390x844')) {
  & .agents/skills/impeccable/scripts/impeccable.cmd detect --json --viewport $view ($base+'new') ($base+'03ea7b69e4a546f28f5ce87313c26f0e') ($base+'2c760cb374a043208ae5bef31a37328f')
}
```

Reviewed Draft with live Preview, Report, and Approval review, and Approved at 1440, 1280, 768, and 390px. Eight axe A/AA scans found no violations or page-wide overflow. Also reviewed the 390px HTML editor. Playwright verified keyboard submission, visible named errors, the unsaved changes prompt, and read-only semantics. Wide tables scroll locally on narrow screens. Chrome emulated viewports. Safari, physical devices, and screen reader remained untested. Hooks and Live Mode stayed disabled.

## Operational limits

Approval was available only through the opt-in loopback Vite dev proxy, with peer loopback, Host, and same-origin Origin checks. FastAPI remained the trusted local operator service and direct requests did not pass through Vite. The approver supplied their audit label. At this milestone PUT lacked an ETag, revision token, or conditional write. The frontend reread hash and state to catch visible conflicts, with a race still possible between requests. The backend enforced report revision, current hash, Source authorisation, and immutability.
