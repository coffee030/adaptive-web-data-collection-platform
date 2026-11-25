# M13 Data Explorer implementation handoff

## Review baseline and delivery

- Starting M12 SHA was `432119acc2ec0860d316877577bf0efd4c2db9c1`. Local and GitHub M12 HEAD matched before M13 branched.
- Final M13 implementation SHA was `e0e5c48710d2fc8cee01cdd71884d49bcf3c02fa`. A later commit contains this handoff and QA screenshots. Obtain the full tip from GitHub or `git rev-parse feature/M13-evidence-first-data-explorer`.
- [M13 delivery snapshot](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/ff211bef68dec3e304b5fa253d89a50230e25255)
- The design review covers API and persistence, entity relationships, and three low-fidelity options. The screenshot index identifies browser evidence and data sources. [M13 design decisions](docs/evaluation/M13-Data-Explorer-Design-Decisions.md) [Index of 21 screenshots](docs/evaluation/M13-screenshots/README.md)

## Workflow and data

Data Explorer uses a Record Ledger and dismissible Inspector. Global, Job, and Request scopes are explicit. It fetches ten rows plus one to detect another page. Oldest and Newest use PostgreSQL persistence time and ID. Scope or sort changes return to page one. Conflicting and invalid IDs are rejected. Unknown, deleted, off-page, and out-of-scope selections get explicit feedback. API state drives the view. A Partial Request still lists published records. Job Quality keeps valid, invalid, and duplicate counts and the Quarantine link.

On wide screens the Inspector opens beside the ledger. It uses full width on narrow screens. Content, Source, and validation state come first, with Capture Evidence and Article History actions based on real links. Close or Escape returns to the row. Record Detail retains a standalone URL and full JSON. Provenance disclosure contains long hashes, IDs, source position, and deduplication key. Evidence displays stored capture kind, HTTP status, page, time, location, and SHA-256. Web metadata strips credentials, query, and fragment. A direct Evidence link can fall back to Job Records. An identified Request can open after verifying Job membership. Search, Detail, and Input capture types remain distinct.

The URL stores scope, sort, offset, Record selection, Article version and observation, and their separate offsets. Explicit return uses bounded internal paths and the original history entry when available. App Shell ScrollRestoration still manages general scrolling. M13 also records trigger and scroll position for up to 64 history entries and restores after REST loads. Fields to Display retains up to 12 scopes and 160 field names and selections from visited pages per scope. Session reload resets it. Missing, Null, empty string, 0, and false have distinct labels. Display settings and history store no payload in the browser.

Latest Article content and version history span collections. Request entry scopes Observation History to that Request and verifies a selected observation's returned Request ID. Observations link to original Record, Evidence, Job, Source, and Profile, and can select the actual captured Content Version. Version and observation return independently. Unmapped Records keep the same inspection workflow.

Existing detail pages still download the whole Request or Job with CSV and JSON, filenames, every persisted field, and errors. Checks covered terminal state, limits of 5,000 records and 8 MiB, and correct scope. Ledger fields and pagination affect display only.

## Verification and acceptance

| Gate | Status | Actual result |
| --- | --- | --- |
| A API and integrity | PASS | 8 passed in PostgreSQL and Redis for M8 Article and M9 Export. Live REST checked Record ID, Request FK, original Job, Profile, Evidence, and Version. |
| B Record Ledger | PASS | A live 12-record Request compared UI Oldest and Newest with API Record IDs. Edge covered global, Job, and Request entry, empty pages, mixed fields, invalid scope, and 10 + 1 paging. |
| C Inspector | PASS | Edge covered opening, closing, Escape, deep links, invalid selection, desktop and narrow layouts. Standalone Record Detail still loaded. |
| D Evidence | PASS | Live HTML, CSV, Detail Evidence, and Job Capture matched hash, Source, and Profile. A simulated URL with query, credentials, and fragment was redacted in UI. |
| E Article History | PASS | In isolation, fixture Revision 2 recollection created Content Version 2. Original Request observation still opened Version 1. Mocks covered offsets and reload. Restored Revision 1. |
| F Task continuity | PASS | Live Request → page 2 → Record → Evidence → original Inspector → original page → next record. Article → Version or Observation → Record → Evidence → Back × 2. Mocks checked exact scroll, fields, second and third items, and Back and Forward. |
| G Downloads and state | PASS | Controlled live Request and Job CSV and JSON checked field by field against API. Two Partial Jobs retained valid records. A separate Failed Job had none. API and UI checked pending and limit errors. |
| H Responsive and accessible | PASS | Edge 1440, 900, 768, 390, and 320 px and native Chrome 200%. Representative views had no whole-page horizontal overflow or axe WCAG 2 or 2.1 A or AA violations. Keyboard, focus, mobile touch simulation, Light, Dark, System, and reduced motion were checked. |
| I Regression and handoff | PASS | `npm.cmd run build` passed TypeScript and Vite. Mocked Edge 119 passed and Windows launcher harness 29/29 passed. Implementation, results, and captures support independent review. |
| Physical screen reader | NOT RUN | Checked semantics with browser accessibility tree, keyboard, and axe. |

### Normal and Synthetic Demo

- Normal used a fresh migrated isolated PostgreSQL. Data Explorer showed empty state and New Collection. Navigation used reads and unsent actions. Normal showed no Synthetic Demo notice.
- Demo used existing `backend.experiments.demo_provision` in a separate Compose project. Fixture Listings had 2 records, Influencer Advertising and Sponsorship 8, and Market News and Economic Updates 8. Checked Job and Request, Observation, Evidence, and both downloads for each. Market records carried the simulated price notice. Also used M12 UI for a new collection and a controlled Partial Request. Verification used run-specific counts.
- Live Edge included existing Demo and M12, Topic, HTML, CSV, failed Capture, isolated Normal, and two M13-specific scenarios. Core HTML and CSV and M6 and M7 pagination and Search and Detail captures passed. POST and fixture revision used only isolated environments. The user's Demo data remained as before.
- Mocked and live Edge ran separately. Controlled PostgreSQL and fixtures supplied contract data. Mocks covered empty and error, 503 and network retry, mixed types, return, reflow, export failures, and page states, retaining M11 Shell and M12 regression.
- Initial live verification exposed Python path and stale UI selectors and passed after correction. First M8 and M9 smoke skipped two tests without Redis. All eight passed after adding Redis to the isolated environment.

### Browser review and UI Slop v1.7

Pass A checked wide and narrow layouts, nested paths, and actual payloads. At 320 px controls pushed the first record below the fold. Some accessible labels omitted visible words and Chrome zoom screenshots clipped. The fix tightened scope and sort controls, showed price and summary, collapsed long IDs, aligned visible and accessible names, and improved Article breadcrumb spacing and narrow Inspector focus and scroll. The delayed 503 harness retained the mock through StrictMode remount until Retry returned to live API. Pass B used Edge 157.0.4341.60 for 18 representative states, focus, return, and Retry, with no unexpected browser errors. Chrome 157.0.8103.51 used native 200% at DPR 2 and 712 CSS px for a recapture.

- **AI Fingerprint Gate PASS**. Record and Evidence relationships shape the layout. Styling distinguishes ledger rows, position cues, actual state, and capture metadata.
- **Evidence Gate PASS**. Live evidence covers keyboard, scope and Record identity, data sources, empty, loading and error, return, and required reflow.
- **Taste Gate PASS**. Retains Cobalt and Slate and M11 Shell. Preview and verification actions stay with the selected Record, and narrow layout moves to the actionable Inspector.

### Reproduce

Run `npm.cmd run build` and `npm.cmd test` in `frontend/`. Used `PLAYWRIGHT_CHANNEL=msedge`. Live uses `M4_REAL_API=1`, `LOCAL_PROFILE_APPROVAL=1`, and isolated `API_PROXY_TARGET`. Demo entry uses `M10_SYNTHETIC_URL`. CSV can use `M9_TEST_PYTHON`. Fresh Normal sets `M12_EMPTY_NORMAL=1`. M13 runs `tests/m13-continuity.integration.ts` with `M13_QA_DEMO_URL` and isolated `M13_QA_FIXTURE`, subject to the test's loopback and Compose naming limits.

## Changed files

| Path | Change |
| --- | --- |
| `frontend/src/features/results/RecordsExplorer.tsx` and `displayFields.ts` | Ledger, supported scopes, sort and pagination, mixed fields, scoped preferences, and quality links. |
| `frontend/src/features/results/RecordInspector.tsx`, `RecordDetail.tsx`, and `resultNavigation.tsx` | Shared inspector, URL lineage, canonical detail, focus, scroll, and selection return. |
| `frontend/src/features/results/EvidenceDetail.tsx`, `api.ts`, and `presentation.tsx` | Evidence metadata, capture kind and safe location, scope links, and values. |
| `frontend/src/features/results/RecordExport.tsx` and `results.css` | Whole-scope export explanation and responsive ledger, Inspector, and Evidence layout. |
| `frontend/src/features/collection-jobs/JobDetail.tsx` | Job capture kinds, Request context, and Evidence return. |
| `frontend/src/features/topic-collections/Articles.tsx`, `support.tsx`, and `topic-collections.css` | Latest, versions, and observations with two shareable paginated lists and links. |
| `frontend/tests/m13-continuity.spec.ts`, `results.spec.ts`, and `dashboard.spec.ts` | Interaction, focus, narrow layouts, mixed fields, and existing navigation regression. |
| `frontend/tests/m13-continuity.integration.ts`, `topic-collections.integration.ts`, `results.integration.ts`, `core-workflow.integration.ts`, and `closure.integration.ts` | Persisted data, version, Evidence and export links, failure, and Partial. |
| `docs/evaluation/M13-Data-Explorer-Design-Decisions.md`, `docs/evaluation/M13-screenshots/`, and `M13-Implementation-Handoff.md` | Review, design decisions, browser evidence, and handoff. |

## Limits and next milestone

Concurrent inserts can shift REST offset membership. Inspector rechecks the current page. The API returns persisted Evidence metadata and the Core retains raw-byte verification. Full-dataset search, arbitrary field sorting, global Export, raw Evidence browsing, and Version Diff lack product contracts. Operator Job diagnostics were scoped to M14 at this point, with M15 for later milestones.

**GO for independent M13 review.**
