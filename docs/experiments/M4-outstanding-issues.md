# M4 Closure Issue Ledger

Baseline feature/M4E-frontend-integration @ 081c5f3, branch fix/M4-closure. The M4-A handoff in Git preserves acceptance history and issue numbers. M4-B through M4-E reports, manifests, contracts, and the existing demo runbook provide baseline evidence.

| Issue ID / Origin / Severity | Description and reproduction | Root cause / impact | Proposed fix / files | Tests required | Status / Fix commit / Evidence |
| --- | --- | --- | --- | --- | --- |
| M4CL-01 / C / P1 | Two clients read one Draft and send different PUTs. Both write. | PUT lacked expected revision. The Source lock serialised writes but allowed stale overwrite. | Compare Draft revision in the transaction and require expected revision. Covers Profiles API, service, and React editor. | PostgreSQL concurrent PUTs, missing revision, immutability, stale report, and browser conflicts. | VERIFIED / 668323a, f6606af / PostgreSQL concurrent 200 and 409, missing revision 428. Both editors retain the losing client's input. |
| M4CL-02 / B / P1 | Resend identical Source JSON or submit simultaneously over two connections. | Each created an ID without binding the intent. | Source request key, payload hash, PostgreSQL unique constraint, and original-key Retry. | DB concurrency, 200 replay, 409 conflict, replay after authorisation change, and browser recovery. | VERIFIED / 668323a, f6606af / Concurrent 201 and 200. Same key with different payload gives 409. Lost live HTTP 201 replayed from React with the original key, returning 200 and the same Source. |
| M4CL-03 / D / P2 | Job saves a capture and rejects all input. | Job had no Evidence field and no result row to link from. | Job-scoped Evidence metadata without storage reference. | Success, partial, failed capture, no capture, 404, and UI link. | VERIFIED / 668323a, f6606af / Backend checks cover success, partial, failure, capture and no capture. New browser workflow opens metadata with zero results. |
| M4CL-04 / A and B / P2 | Open page 2 of Sources or Profile Versions, open a child, then return through breadcrumb. Original page is lost. | Offset was component state and remount started page 1. | Save offset in the URL and retain parent query in links, using deterministic offset and ordering. | Sources and Profile return, status filters, empty tail pages, and offset bounds. | VERIFIED / f6606af / Sources return retains offset. Existing Jobs empty-tail guidance checked with a new regression. Records and Quarantine use deterministic offsets. |
| M4CL-05 / C and E / P0 | Send trusted local API write with non-loopback Host or Origin. | FastAPI lacked browser origin checks. Vite restricted approval only, leaving direct API and other proxied writes reachable. | Reject foreign browser origins and Hosts while retaining loopback proxy and trusted terminal operation. | Localhost success, foreign Origin and Host rejection, CORS, and demo proxy checks. | VERIFIED / 668323a, f6606af / Foreign requests returned 201 before the fix and 403 afterward. Trusted terminal and same-origin proxy succeeded. Existing restricted approval rejection passed. |
| M4CL-06 / A / P2 | Invalid timestamp reaches a date field. | Intl.DateTimeFormat can raise RangeError and break the page. | Shared Timestamp fallback. | Job Detail with an invalid timestamp. | VERIFIED / f6606af / Shows Unavailable and keeps Job Detail functional. |
| M4CL-07 / Closure / P3 | GitHub delivery and teammate review were initial gates. | User chose personal local acceptance. | Defer GitHub to M5 and remove team review from M4. | User runs local acceptance. | DEFERRED / OUT OF SCOPE by user decision. |
| M4CL-09 / Closure / P3 | Narrator, macOS Safari, physical iPhone Safari, and physical 8 GB Windows. | Limited manual and physical verification. | Remove macOS Safari by user decision and retain the actual states of the other three. | User runs Narrator and independently tests or accepts limitations for iPhone Safari and 8 GB Windows. | PARTIAL. macOS Safari OUT OF SCOPE / NOT RUN. Others BLOCKED / NOT RUN. |
| M4CL-10 / C / P3 | Playwright WebKit fills Record type outside viewport on a new Profile route and Save draft stays disabled. | Test filled after seeing the URL without clicking to focus and scroll. The app saved when clicked in controlled WebKit. | Click and assert enabled in the Core workflow test. | Live create, edit, preview, approve, and submit in three browsers. | VERIFIED / 7afe0b1 / Chromium 14, Firefox 6, and WebKit 6 live passes. App focus behaviour remained as before. |
| M4CL-11 / E / P2 | After rehearsal, compose stop times out on fixture and Dispatcher and exits 137. | Container PID 1 did not handle the default stop signal. | Set SIGINT for both, with fixture handling KeyboardInterrupt. | Actual Compose stop, exit and OOM status, and volume inspection. | VERIFIED / d1926e2 / All six containers in each isolated rehearsal and backend project exited 0 with OOMKilled false. Three named volumes per project remained. |
| M4CL-12 / B and E / P3 | Fresh isolated DB live Sources test cannot find Controlled fixture. | Old test relied on manually seeded data. | Create Source and valid Approved fixture via current API and test Job 503 recovery. | Run full live Chromium and representative Firefox and WebKit from empty DB. | VERIFIED / 439e1a2 / Each engine passed in isolated acceptance. |

## Historical manifests

M4-B, C, D, and E manifests retain their original dates and PASS records. M4-C-03 describes historical UI and API behaviour. M4CL-01 documents server-enforced concurrency. M4CL-02 covers replayable M4-B-02 registration, and M4CL-03 covers M4-D-04 direct Evidence from Jobs.

## Baseline and code evidence

- M4CL-01 and M4CL-02. Baseline used FastAPI and live PostgreSQL. Regressions are in `backend/tests/m2/test_m4_closure.py`, `test_approval.py`, and `frontend/tests/closure.integration.ts`.
- M4CL-03. API, data layer, and UI changes are in `backend/api/results.py`, `backend/application/results.py`, and `frontend/src/features/collection-jobs/JobDetail.tsx`. Results tests also cover successful and partial persisted Evidence.
- M4CL-04. Backend query supplies ordering. Pagination context fixes are in `SourceList.tsx`, `SourceDetail.tsx`, and `ProfilePage.tsx`. Offset pagination does not give a cross-request snapshot.
- M4CL-05. See API middleware in `backend/api/app.py`, proxy in `frontend/vite.config.ts`, and Docker port binding in `compose.yaml`. Check `test_loopback_http_boundary`, browser proxy rejection, and live runbook.
- M4CL-06. Timestamp fallback is in `frontend/src/components/feedback.tsx` with a controlled case in `frontend/tests/jobs.spec.ts`.

Firefox reported Page crashed during one axe analysis. After restart, that case and all six in the suite passed. The single crash had no identified application-level cause. The report retains the failure and reruns.

## Final Gate external tasks and owners

Updated to the user's latest decision at the gate. M4CL-01 through 06 and 10 through 12 remain VERIFIED.

| Issue / Gate | Current status | Required action and owner | Evidence | Codex can finish independently | User decision | Human testing |
| --- | --- | --- | --- | --- | --- | --- |
| M4CL-07A GitHub delivery | DEFERRED TO M5 | M4 used local Git. GitHub was deferred until M5 authorisation. | `git remote -v` empty, no PR. | No M4 work | Decided | None |
| M4CL-07B Team review | OUT OF SCOPE | User performs personal M4 acceptance. | Team review was not run. Original checklist supports self-check. | No M4 work | Decided | Team review did not apply |
| M4CL-09A Narrator | BLOCKED / NOT RUN | User listens and records results. | Narrator executable exists. Chromium keyboard smoke and axe results are available. [Narrator procedure](../reviews/M4-narrator-acceptance.md) | No | User report pending | Required |
| M4CL-09B macOS Safari | OUT OF SCOPE / NOT RUN | User removed the gate because no Mac was available. | Playwright WebKit on Windows was tested. | No M4 work | Decided | None |
| M4CL-09C iPhone Safari and 8 GB Windows | BLOCKED / NOT RUN | User separately tests or accepts an MVP limitation. | Windows Playwright was tested. 1792 MiB measures container limits, and physical 8 GB was untested. [Device evidence](M4-device-and-resource-acceptance.md) | Required equipment unavailable locally | Untested items await decision | Required if tested |

The Firefox crash trace was investigated. All six Evidence reruns passed. The cause remained unknown. [Investigation and limitations](M4-device-and-resource-acceptance.md#firefox-page-crashed-investigation)
