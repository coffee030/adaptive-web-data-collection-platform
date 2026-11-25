# M12 New Collection workspace implementation handoff

- **Delivery branch** `feature/M12-new-collection-workflow`
- **M11 baseline** `875c94c8f0c358904813fe1c41e1018034713049`
- **M12 tested implementation commit** `3461d14922e1a25196ba729de47d3ea65f750090`

## 1. Repository and changes

M12 started from the reviewed M11 commit. The SHA above identifies the implementation and tests. The delivery snapshot includes the handoff and screenshots. [Delivery snapshot](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/432119acc2ec0860d316877577bf0efd4c2db9c1)

| File | Change |
| --- | --- |
| `frontend/src/app/App.tsx` | Existing New Collection route opens the new workspace. |
| `frontend/src/features/topic-collections/{NewTopicRequest,TopicBrowser,CollectionSelection,CollectionReturn}.tsx` | Progressive workspace, paginated directory, approved Sources, review, and return from detail. |
| `frontend/src/features/topic-collections/{collectionDraft.ts,api.ts,support.tsx}` | Draft lifecycle, eligibility checks, existing response types, pagination, and cancellation scope for active operations. |
| `frontend/src/features/topic-collections/{Requests.tsx,TopicCatalog.tsx,topic-collections.css}` | Request inspection, result links, management return links, and M11 token styling. |
| `frontend/src/features/sources/SourceDetail.tsx` and `frontend/src/features/profiles/ProfilePage.tsx` | Return action when reached from a draft. |
| `frontend/tests/{topic-collections.spec.ts,topic-collections.integration.ts,dashboard.spec.ts,core-workflow.integration.ts}` | Behaviour, races, states, accessibility, and live collection tests. Updated selectors for changed methods and visible names. |
| `docs/evaluation/M12-New-Collection-Design-Decisions.md`, `docs/evaluation/M12-screenshots/`, and `M12-Implementation-Handoff.md` | Low-fidelity comparison, lifecycle, verification, screenshots, and review material. |

## 2. Structure and operation

The progressive vertical workspace uses side-by-side Category and Topic on desktop, followed by Sources, Keyword, and review on one page in dependency order. Narrow screens collapse the selected Category into a summary that can be reopened. A selected Topic still shows its Category after the Topic Browser collapses. Retains M11 Cobalt and Slate, Light, Dark and System, global navigation, and existing routes. UI Slop v1.7 Structural Direction records three options. Information Relationships and Reactive Surfaces follow Category → Topic → Binding → Job. Semantic Diversity uses directory buttons, checkboxes, status, and summaries for distinct information. [Design decisions](docs/evaluation/M12-New-Collection-Design-Decisions.md)

- **Topic Browser** fetches active-only Categories and Topics via existing REST. Loads 12 more per expansion and one additional row to detect another page. Category scopes Topic queries and binding queries wait for a selected Topic. Validates Overview's `topic_id` against Topic and current Category details. Missing, malformed, and inactive values can return to the directory. Directory, deep link, and Source failures have local Retry.
- **Approved sources** shows eligible, enabled bindings. Each explicit selection creates one child Job, up to four. Version comes from the actual data, with Source and pinned Profile Version links. Refresh compares binding ID, Source ID, Profile Version ID, and hash. Retains verifiable selections and reports removals. Ineligible Topics link to the existing Topic Bindings view.
- **Keyword and Review** allow complete editing. Trim and validate 1–128 printable Unicode characters. Review shows exact Category, Topic, submitted keyword, Sources, approved versions, and intended Job count. Field or pin changes invalidate old review.
- **Run and Inspect** creates a Request through existing POST and opens the same persisted Request Detail. GET and existing polling show actual state, Source Jobs, and valid records. Creation and execution report their own status. Available routes cover scoped Records, Job details, Quarantine, Evidence, Article History, previous run, Refresh, and CSV and JSON downloads. The Job path carries the Request return, and standalone Job and Request links still work.

## 3. Drafts and submission

The URL stores only shareable Topic ID. Route history stores a draft ID. JavaScript memory in the loaded page retains the latest 20 draft contexts, including browsed Source pages, selected pins, Keyword, Review, and unconfirmed POST. Opening a new workflow creates a draft. Switching Category or Topic keeps Keyword and clears incompatible selections and Review. Back or Back to collection from Profile or Source restores the original history entry and rechecks selections. Focus returns to the trigger if available, otherwise the Source heading. Browser history uses M11 ScrollRestoration. Reload clears in-memory drafts.

Before first submit, reread Topic, current Category, and Source pages already loaded and compare the review. Existing `POST /api/v1/collection-requests` takes sorted `binding_ids`, `topic_id`, `keyword`, and UUID `request_key`. Reuse request-intent logic. Tab sessionStorage only stores the fingerprint and UUID. Retry can still use in-memory intent if storage is unavailable. Clear the stored entry after confirmed success or rejection.

Block duplicate actions during the request. Recover an unconfirmed first POST with only the original UUID and content. Backend checks replay first and eligibility and authorisation for a new transaction. First write 201 and replay 200 confirm outcome. Success clears sensitive draft fields and replaces the history entry with Request Detail. Earlier entries for the draft offer the same Request or a new collection. Refresh, single-source Job, and other entry points retain their retry paths.

## 4. Verification results

PASS means run and met expectations. FAIL means an observed assertion or workflow failure. PARTIAL means only part was checked. BLOCKED means an external prerequisite stopped it. NOT RUN means it was not executed.

| Check | Status | Evidence |
| --- | --- | --- |
| Gate A, backend API and persistence | PASS | Existing PostgreSQL suites for M8 Collections and M9 Record Export passed 8. Backend, access rules, database, Demo, launcher, and lockfile were outside changes. |
| Gates B–E, frontend REST boundaries | PASS | Mocked Edge suite 114 passed. Covered 101 Categories and 101 Topics, read races, no Sources, four maximum, invalid pin re-review, deep links, Unicode, 201 and 200, duplicate actions, lost responses, 403, 409, 422 and 503, Source and Profile return, and Back and Forward. |
| Gate F, Request Detail | PASS | Mocked REST covered Pending, Running, Partial, Failed, Succeeded, and polling. Live Demo verified Succeeded and Partial, Request → Job → Evidence, and persisted Records through the API. |
| Empty Normal database | PASS | Seven empty lists after fresh isolated PostgreSQL migration. Edge at 390px showed setup, with no Demo banner or selectable Sources. |
| Synthetic Demo and isolation | PASS | Checkout-specific settings, volumes, and loopback ports. Initial preset provisioning checked 6 Jobs, 18 Records and Observations, 28 Evidence captures, and 6 exports. Four actual M12 UI submissions verified persistence. Existing Demo was outside the write target. |
| Exports and existing live browser regression | PASS | Controlled live fixture suite 17 passed. Three isolated Normal and Demo cases passed separately, 20 total. Covered single-source HTML and CSV, Source and Profile approval, Jobs and Evidence, CSV and JSON, Article History, Refresh, restart, and replay. |
| Launcher | PASS | Windows PowerShell 29/29. One-click route ran with `-NoBrowser -NonInteractive`, and Edge opened the generated Demo. |
| Gate G, Browser QA and accessibility | PASS | Edge 157.0.4341.60 at 1440, 900, 390, 320px, Light, Dark and System, 320px touch, and reduced motion. Native Chrome 157.0.8103.51 200% with DPR 2 and clientWidth and scrollWidth both 712 CSS px. Review and submit were focusable. |
| Gate H, build and handoff | PASS | `npm --prefix frontend run build` with TypeScript, `git diff --check`, tested commit, screenshots, and review documents. |
| Physical screen reader, cold installer, full backend suite, and public sites | NOT RUN | Ran axe, keyboard checks, launcher startup, and related backend suites. All data came from controlled local fixtures. |

### Actual M12 UI Demo submissions

| Topic | Keyword | Request ID | Outcome and validated records |
| --- | --- | --- | --- |
| Fixture Listings | `quick` | `601399d9-f1ea-4d44-9e4e-1949cce3c4f8` | Succeeded, 2 Jobs and 2 Records. The backend returned 201 and the browser reply was dropped. Replay with the UUID returned 200 and the same ID. |
| Influencer Advertising and Sponsorship | `partnership` | `4d9e4081-e095-47ab-9223-a48e73e5d2d8` | Succeeded, 2 Jobs and 8 Records. |
| Market News and Economic Updates | `market` | `d6a89f29-3eb5-4f13-aa6b-047122981fb7` | Succeeded, 2 Jobs and 8 Records. Records page and payload carry `SIMULATED DATA — NOT LIVE MARKET PRICES`. |
| Fixture Listings | `detail404` | `d07efc7c-5f67-465d-9882-bd561ebf96e6` | Partial, 2 Jobs and 2 Records. Both Sources have inspectable errors and Evidence. |

The Edge live entry point for M12 Normal and Demo and six baseline exports was `tests/topic-collections.integration.ts -g "M12|launcher dashboard"`, 3 passed. Set `M4_REAL_API=1`, `API_PROXY_TARGET` for isolated Normal API, `M12_EMPTY_NORMAL=1`, and `M10_SYNTHETIC_URL` for isolated Demo. First full live run found stale selectors, a CSV recovery timeout, and a cached fixture LF and CRLF digest mismatch. Existing behaviour and hash assertions were retained. The full run including recovery passed after aligning M11 labels and building fixture from the same checkout. General fixture regression used a separate Compose project configured by `backend/experiments/m10_environment.ps1` with a fixture image built from this checkout.

## 5. Visual and accessibility review

Pass A used Edge on desktop Sources and Review, mobile Review and Partial, and empty Normal. A single Topic could appear static, a narrow version label was cut off, empty state still requested Category, and a fresh Request overemphasised Refresh. The fix made Topic actions scannable, kept version labels complete, concentrated empty-state setup, and prioritised existing Records and child Jobs. Pass B recaptured main states and rechecked focus after review, return, narrow layouts, touch, and 200% reflow. For AI Fingerprint and Taste, the workspace used directory, source rows, and actual review data without duplicate step cards or metrics bars.

axe WCAG 2 and 2.1 A and AA reported zero violations on checked views. Used Enter, Tab, and Space to select Topic and Sources, move from Keyword to Review, open a Profile Version, and return. Draft contents and focus on the Profile trigger were restored. The 320px touch test checked restored selection, and the console had no unhandled exceptions. Loading and HTTP 503 screenshots used browser interception. Others came from the live isolated environment.

| View | Screenshot |
| --- | --- |
| 1440px Topic directory and one selected Source | [Topic](docs/evaluation/M12-screenshots/topic-browser.png) · [Sources](docs/evaluation/M12-screenshots/approved-sources.png) |
| Review and zoom | [Desktop](docs/evaluation/M12-screenshots/review-desktop.png) · [390px Dark](docs/evaluation/M12-screenshots/review-mobile-dark.png) · [320px Dark](docs/evaluation/M12-screenshots/review-narrow-dark.png) · [Chrome 200%](docs/evaluation/M12-screenshots/review-chrome-zoom-200.png) |
| 900px loading and recovery | [Loading](docs/evaluation/M12-screenshots/simulated-loading-tablet.png) · [HTTP 503](docs/evaluation/M12-screenshots/simulated-api-503-tablet.png) |
| Live Request, results, and empty Normal | [Succeeded](docs/evaluation/M12-screenshots/request-succeeded.png) · [Partial](docs/evaluation/M12-screenshots/request-partial.png) · [Simulated finance records](docs/evaluation/M12-screenshots/demo-financial-records.png) · [Normal](docs/evaluation/M12-screenshots/normal-empty.png) |

## 6. Limits and handoff

- Category and Topic use pagination, and the API has no full-text search. The eligible binding endpoint has no single-ID lookup. Refresh rereads the browsed range of 24 items. A moved pin outside that range is removed as unverified, and Load more can recover it for selection.
- Reloading or closing loses unsent draft and the unconfirmed POST view. With sessionStorage available, entering the same eligible intent reuses its UUID. Collection requests can also locate the outcome.
- M13 was reserved for Data Explorer and Article History deep navigation and state. M14 was reserved for Operations forms, Job diagnostics, and consistency.

**GO for independent review. M12 authorisation, eligibility, UUID replay, live submission, and results handoff passed.**
