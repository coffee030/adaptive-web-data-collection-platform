# M15 Job Operations and Diagnostics implementation handoff

## Review versions

| Item | Version |
| --- | --- |
| M14 baseline | `b7cc87d2305c57cd8e5e523efa4ac5f21182de17`. The clean worktree, GitHub Compare, and remote ref matched. |
| M15 implementation commit | `c6ddd3244d525d0869344c6a734669a401986f0a`. The handoff has a separate docs-only commit. Branch HEAD is the full delivery. |
| Delivery branch | [feature/M15-job-operations-diagnostics](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/feature/M15-job-operations-diagnostics) |
| Design and browser evidence | [Design decisions](docs/evaluation/M15-Job-Operations-Design-Decisions.md) · [Screenshot index](docs/evaluation/M15-screenshots/README.md) |

## Audit and design

The audit covered AGENTS, PRODUCT, DESIGN, M3 execution, M4-E submission, M4 Closure, M10 reliability, M11–M14 decisions, current routes and Playwright, and Job, retry, dispatch, and result persistence. Available operations read Job, Events, Source, Profile, and results, and create or replay a single Job. Existing services manage dispatch and leases. The frontend uses persisted data and read-only status refresh and offers no global infrastructure metrics.

The team chose **Operations Ledger with Diagnostic Detail**. Putting exceptions first required several status queries to retain ordinary Jobs. Putting events first required an index across Jobs. The ledger uses the current API's paging and statuses and detail places errors and result links where operators can investigate. The design record compares the three low-fidelity structures.

Retained vendored UI Slop v1.7 (`6f8a7d22aff293e0e92183df93cf5d53e886ba1a`) and Cobalt and Slate. Structural Direction gives each Job a ledger row. Information Relationships connects status, results, and Evidence. Labels, counts, event descriptions, and technical disclosures have distinct presentations. Reactive Surfaces show relevant results as status changes. Task Continuity retains deep links and return position. Experiments began with display data and then verified relationships with the real API.

## Implementation

| Area | Behaviour |
| --- | --- |
| Job Ledger | Shows Source, short Job ID, pinned Profile Version, state, accepted, invalid and duplicate counts, UTC creation, recorded error, and Inspect Job. Resolve only distinct Source and Profile IDs for the current 20 rows, with at most four concurrent requests. After four seconds, use available names and short IDs. Technical metadata shows full IDs. |
| Filters, sorting, and empty states | Pending, Running, Succeeded, Partial, Failed, and All statuses. API sorts Oldest and Newest. Queries 20+1, with maximum offset 2147483647. Changing sort or filter returns to page one. Empty system, no match, empty offset, read failure, malformed ID, and 404 for valid ID have distinct feedback and return. |
| Outcome and diagnostics | Initial Pending and scheduled retry are distinct. Execution attempts count claims and Dispatch attempts count publications. Shows earliest retry, latest confirmed dispatch, and applicable dispatch deadline. An expired lease points to persisted events. Terminal state retains counts and errors. |
| Events and failures | Uses persisted sequence and retains each UTC time, state, attempt, and error attachment. Handles historical nulls and unknown kinds. Raw kind and ID expand. HTTP, Retry-After, and broker code appear when applicable. Troubleshooting links to events and pinned Source and Profile. |
| Automatic and manual reads | Visible Pending and Running wait three seconds after each read. Stop scheduling when hidden or terminal. Refresh job repeats GET. Temporary failures retain the last successful Job and Events, show freshness feedback, and allow rereading on visibility. |
| Results, Evidence, and Quarantine | Job-scoped live previews use existing Data Explorer and CSV and JSON export. Partial shows published Records. Per-page Evidence, direct Record Evidence, and Quarantine Evidence each retain links. Quarantine uses 10+1 pagination with source position, field, problem code and message, and persisted time. Duplicate counts and rejected entries are separate. Inspector retains Article links. |
| Web submission | Guided and Source or Profile entry. Review uses selected Source, approved pin, document path or search term, and allowed origin. Expand Profile paging and extraction rules where relevant. Explain Source or Profile ineligibility. |
| CSV submission | Approved dataset ID, inline UTF-8 CSV, header help, 1 MiB limit, NUL checks, and UTF-8 byte count in review. Writes through the existing single Job API. |
| UUID and uncertain submission | 201 creates, 200 replays identical intent, and 409 conflicts. Blocks double clicks. A 5xx, lost connection, timeout, or unreadable success retains the same body and UUID. SPA navigation can replay the in-memory submission. A same-tab reload keeps fingerprint and UUID and requires identical input. Confirmation or explicit rejection clears the intent. |
| URL, history, and focus | Ledger keeps `status`, `order`, and `offset`. Job preview offset is restorable, and existing routes support direct links. ContextLink and ReturnLink share results navigation. Request-linked deep links are checked against parent and child membership. Return restores focus and scroll from in-session history. |

## Observed verification

| Test | Evidence | Result |
| --- | --- | --- |
| TypeScript and production build | `npm.cmd run build` ran `tsc --noEmit` and Vite production build. | PASS |
| Playwright mocks and M10–M14 regression | Full Chrome Playwright passed 149 cases. Covered states, sorting, URL bounds, failure and replay, unknown and historic events, visibility and terminal state, Records, Evidence, Quarantine, keyboard, touch, and axe. Four final focused cases also checked scroll, zoom, and forms. | PASS |
| Normal | Immediately after dedicated PostgreSQL migration, GET Jobs returned zero. Chrome opened the empty ledger and existing Source and Profile setup. | PASS |
| Synthetic Demo | Read-only fixture verification for Fixture Listings, Influencer Advertising and Sponsorship, and Market News and Economic Updates. Navigated Request, child Job and Events, Evidence, back to Job, Records and Inspector, then Job and Request. Recorded focus restoration. Existing Demo services and storage remained available. | PASS |
| Live Web, CSV, and provenance | Isolated Core verified HTML Succeeded, CSV Partial, approved pinned Profile, persisted payload, and browser Evidence and Quarantine. M6 had 3 captures, and M7 search had 5 captures and 3 direct Record results. | PASS |
| Live failure and retry | Controlled empty search `0ef0a186-afc2-4879-af14-10f3a64256d7` ended Failed with 0 accepted. HTTP 429 Job `8c4ad1fb-d1dc-43de-beca-39f0e0e4b093` persisted 2 RETRY_SCHEDULED and 3 CLAIMED events and finished Partial with accepted records. | PASS |
| Live Redis and PostgreSQL recovery | While dedicated Redis stopped, Job `5c1d41e1-1e1d-49ad-8a06-3a6cafa2be1d` stayed Pending with 0 executions, DISPATCH_FAILED, and broker code. Restart led to 2 dispatches, 1 execution, and Partial. Stopping dedicated PostgreSQL caused POST 503. Recovery with the same body and UUID created `6a7517c7-d593-4aff-9acb-54c11208f59d` with 201 and replayed 200. Also restarted isolated DB and API and compared results and Evidence bytes. | PASS |
| Browser and accessibility | 1440, 900, 768, 390, and 320 px, plus native Chrome Appearance 200% with actual 720 CSS px reflow. Light, Dark, System, reduced motion, axe WCAG A/AA, visible focus, keyboard, and touch. | PASS |
| Physical screen reader, Demo Launcher restart, and worker SIGKILL | Used axe and native semantics, running Demo, live retries, and isolated Redis and DB failures. Worker termination and fresh launcher startup rely on historical M10 evidence. | NOT RUN |

Twelve distinct live tests passed, with 8 in the main rerun, 2 targeted Web and CSV cases, and 1 each for Normal and existing Demo. Normal and Demo were skipped in the main run because of flags and passed in their own environments. Later runs fixed stale selectors, query parameters, and Windows CRLF fixture hash differences. HTML digest assertions accept LF or CRLF from the same committed fixture. CSV digest uses actual submitted or fixture bytes.

### Workflow and visual review

- Pass A checked ledger, mobile Job Detail, and forms. Found the blank action heading misaligned with rows, horizontal scroll in narrow Record preview, and some accessible link names omitting visible words.
- The fix aligned action columns, used a compact two-column narrow filter, made Record preview rows and Evidence links readable, and corrected names for links to the same Job, Record, and Evidence. Used the physical viewport for native zoom to avoid clipped 200% captures.
- Pass B rechecked desktop, 320 and 390 px, 200%, failure, retry, Quarantine, and submission. AI Fingerprint Gate examined ledger, live dispatch and execution fields, and ordered events. Evidence Gate used axe, browser behaviour, persisted API results, and return tests. Taste Gate checked short Job IDs, exception placement, separators, and result links for readability. Unmocked optional metadata GETs can log proxy warnings and fall back to short IDs. Live temporary errors came from fault tests.

### Reproduction

- In `frontend/`, set `PLAYWRIGHT_CHANNEL=chrome` and run `npm.cmd test`. Set `M15_CAPTURE_DIR=../docs/evaluation/M15-screenshots` to retain screenshots.
- Live used `collection-m3-test-m15-job-qa`, isolated PostgreSQL, Redis, and Evidence, and a controlled HTTP fixture. Compose used `compose.yaml`, `compose.fixture.yaml`, `backend/experiments/m10.compose.yaml`, and both Windows subnet overlays. API loopback `18175`, PostgreSQL `55545`, Redis `16445`. After Alembic, set `M4_REAL_API=1`, `API_PROXY_TARGET=http://127.0.0.1:18175`, and `LOCAL_PROFILE_APPROVAL=1`. Run `core-workflow.integration.ts`, `jobs.integration.ts`, and `results.integration.ts` with one worker to isolate faults. Restart tests require `M4E_COMPOSE_PROJECT` and `M4D_COMPOSE_PROJECT` for that project and `M4_COMPOSE_OVERLAYS`.
- Set `M15_EMPTY_NORMAL=1` for fresh Normal ledger. Use `M15_DEMO_READ=1`, `PLATFORM_SYNTHETIC_DEMO=1`, and existing isolated Demo `API_PROXY_TARGET` to read all three presets through jobs integration.

## Changed files

| Area | Files |
| --- | --- |
| Ledger, diagnostics, submission | `frontend/src/features/collection-jobs/{JobList,JobDetail,JobCreate,GuidedPicker,presentation}.tsx`, `api.ts`, `jobContext.ts`, `submission.ts`, `useJobSubmission.ts`, `jobs.css` |
| Results and Request navigation | `frontend/src/features/results/{QuarantinePage,RecordsExplorer,presentation,resultNavigation}.tsx`, `results.css`, `frontend/src/features/topic-collections/Requests.tsx` |
| Shared foundation | `frontend/src/lib/useResource.ts`, `frontend/src/styles/console.css` |
| Verification | `frontend/tests/{jobs,job-create,dashboard,results}.spec.ts`, `{jobs,core-workflow,results}.integration.ts`, `m15Capture.ts` |
| Review attachments | `docs/evaluation/M15-Job-Operations-Design-Decisions.md`, `docs/evaluation/M15-screenshots/`, and this handoff |

## Known limits and acceptance

Setup follows available APIs. New Jobs and state changes can shift offset pages. Job DTO lacks Request ID and a retry-exhaustion flag. Known navigation context shows parent Request, and terminal state, recorded error, and claim count show retry outcomes. After same-tab reload, if original data cannot be re-entered, inspect Jobs and resolve the original intent in the controlled environment. Raw CSV stays in the open page's memory. Hardware performance and physical screen readers were NOT RUN.

| Gate | Result |
| --- | --- |
| A Scope and operator boundaries | PASS |
| B Job Ledger | PASS |
| C Dispatch, execution, retry, lease, and Events | PASS |
| D Failures and result inspection | PASS |
| E Web and CSV and uncertain write | PASS |
| F Task Continuity | PASS |
| G M10–M14 product regression | PARTIAL. All frontend regression and existing Synthetic Demo passed. Launcher cold start NOT RUN. |
| H Accessibility and reflow | PASS. Physical screen reader NOT RUN. |
| I Verification and handoff | PASS, with code, tests, two visual passes, and commit. |

**Recommended GO for independent M15 review.** Cross-milestone integration and presentation preparation were M16 work, pending independent review and approval.
