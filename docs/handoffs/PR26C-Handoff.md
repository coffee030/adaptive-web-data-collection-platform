# PR26 Stage C handoff

28 November 2026 · Submitted for independent review

## Source and scope

| Item | Identity |
| --- | --- |
| Repository | `coffee030/adaptive-web-data-collection-platform` |
| Checkout | `C:/Users/noob/Downloads/ITE4116M_Final_Year_Project/Adaptive-Web-Data-Collection-Platform-PR26A` |
| Branch | `codex/pr26-research-clarity` |
| Starting and current HEAD | `7cdeea8fe2cd749b8a3e79aaeb87707b66659223` |
| Accepted Stage B R1 starting tree | `d2e3a01ba8c4a80b0a685dd1cc6f556ed95db352` |
| Corrected Stage B archive SHA-256 | `4d707795cf8bc925eec9bbfc3907c1c504c2ce8ab865971a30a9e0db3948e212` |
| Stage B independent review SHA-256 | `c0234c02401031c6b9bfc62ef78db5762400aaf72aadf10051f42432c4b94553` |
| Migration head | `0034` |
| Complete Stage C Git tree | Recorded as `expected_git_tree` in the review archive manifest |

The selected checkout had 13 tracked modifications and 15 untracked files from accepted A and B. All 28 archived source, test, fixture and handoff bytes matched the checkout before editing. A separate replay of the accepted B patch produced the declared starting tree. Stage C remains a working-tree change on the same branch. The other local checkouts and the existing A and B handoffs were preserved.

The start pack supplied the implementation brief and the two historical reference archives. The current request authorized the local Stage C changes and review package. Stage D has not started. The work is local and has not been pushed, merged, deployed or communicated externally.

## C1–C8 outcomes

| Item | Implementation |
| --- | --- |
| C1 · Form session and provenance | The brief keeps raw inputs, seed context and touched fields separately from server decisions, preview and approval. The supported form fields distinguish defaults, intentional choices and inherited or unknown values. |
| C2 · Preview and clarification | Review shows current criteria, origins, candidates, blockers, scope and destination. The original interpretation remains in a disclosure. Platform, publication age, deliverable and language choices request a replacement preview. |
| C3 · Confirmation and association | Explicit approval submits the exact returned preparation with the finalized version and fingerprint. The prospective campaign ID is reserved locally, bound to the preview, and used for a versioned campaign save only after approval. |
| C4 · Errors and retries | Request generations, aborts and company scope prevent old responses from restoring approval. A frozen request key and body survive uncertain responses while the form remains open. Save conflicts, stale or unresolved proposals, key conflicts and integrity errors have separate recovery paths. |
| C5 · History and effective actions | History and resume use the stored run. Adjustment seeds a fresh session from the operational brief. Strategy adoption preserves the selected platform and budget together with the effective requirements. |
| C6 · Scope and evidence | Requested channels, recorded availability, returned public examples and company-authorized strategy evidence have distinct presentation and count populations. Unknown dates and unavailable metadata are explicit. |
| C7 · Findings and actions | The report shows usable quoted allocations when present. It offers same-run refresh, criteria adjustment, comparison, or a copyable quote-and-evidence request according to the returned evidence and status. |
| C8 · UI and compatibility | The flow uses existing Harbourline panels, form controls and theme tokens. Keyboard preview, review/error focus and a narrow viewport have maintained coverage. Stage C changes browser code and tests. |

## Provenance and request lifecycle

| Fields | Policy |
| --- | --- |
| Primary channel and comparison channels | Instagram and empty comparison channels are application defaults on a new form. Changing comparison channels leaves primary provenance alone. Both unranked comparison orders need the user to apply a primary role, including confirmation of the already displayed channel. |
| Deliverable | Social post is the new-form default. An edited deliverable is explicit. Review can resolve competing values while preserving the original wording and choice. |
| Publication age | “Use wording in the brief” supplies no structured override. A valid explicit number sets a maximum. “No publication-age limit” supplies explicit null. The review supports numeric and unrestricted decisions for eligible blockers. Invalid age input requires correction. Age wording inferred by the server remains a text origin. |
| Language and strength | Wording can leave language unspecified or trigger clarification. Choosing a language supplies an explicit preference with a separate requirement control. Removing a condition uses the typed null-language decision and retains the previous structured input in the audit. Editing wording clears that removal decision. |
| Market and audience share | Default market is HK only on a new form. Saved market and share are inherited. An edited value is explicit. An empty optional market or share carries no provenance entry. Inherited share precision is preserved. |
| Budget and currency | The budget starts blank. Editing it or choosing the supplied HKD example is explicit. HKD is the new-form currency default. Saved currency and minor units are preserved in the brief, scenario, draft and evaluation. An explicit currency edit changes the denomination shown in the form. |
| Creator range and facts | New-form counts and empty fact selections are defaults. Edited counts are explicit. Moving a fact updates both required and preferred provenance. Saved facts and counts are inherited until edited. |
| Other inputs | Objective, question, product, audience, focus, discovery scope, test share, scenario and destination participate in preview invalidation. They do not add keys to the provenance map. |

Focus, blur, rendering and hydration do not count as edits. Saved campaign forms load the campaign’s draft and evaluation. They do not infer association or prior approval from matching description text. Enter an audience if the saved draft has no research audience. Adjustment retains the earlier run as audit context, uses its operational values and marks inherited structured selections accordingly. An exact explicit unrestricted-age choice can carry its original provenance. Approval and request identity are new for each adjusted request.

Preview and clarification use the authenticated read-only preparation endpoint. Only an executable proposal for the current form and destination can be approved. Editing the raw form, applying a different decision or leaving review clears the current approval opportunity. Scenario inputs participate through the form change handler. Company context and unmount are checked in addition to cancellation and generations.

The confirmation action freezes the server’s preparation with protocol `confirmed-v1`, the finalized criteria version `research-criteria-v1`, the returned proposal fingerprint and a request UUID. A new campaign uses the same prospective UUID through preview, save and submission. The draft uses approved effective values. The submitted preparation retains the server-returned original brief and audit inputs. Existing-campaign approval links without rewriting the draft. Standalone approval keeps the campaign ID null.

If a response is lost, use **Retry approved research**. The campaign save uses the same UUID, version and draft until acknowledged. The research retry uses the same complete envelope and request key. A saved campaign remains available if research submission is interrupted. A save conflict offers the current saved campaign or a deliberate return to destination selection. Stale and unresolved responses retrieve a fresh authoritative preview and require another explicit approval. Identity conflicts point to Recent research before a new intent. Snapshot integrity errors remove the affected actions and display recovery guidance. An interrupted in-memory attempt can be lost on navigation or reload. Check Recent research before starting a replacement.

## Browser walkthrough

1. Open Campaign Advisor. Enter “Find YouTube short videos for local cafés”, a product, an audience and a budget. Select **Company research library only** and choose **Preview research criteria**. The preview shows YouTube and Short video from the wording even though Instagram and Social post were untouched form defaults. The audit shows the displaced defaults.
2. Choose **Confirm and start research** to create a single standalone confirmed run. Choose **Create a new company campaign** before preview when a campaign and run are both needed. Its final button explicitly names both operations.
3. For “Compare YouTube and Instagram”, the preview requires a primary role. Use **Confirm primary channel** and **Use selected primary and preview**. Verify the primary, comparison channels and exclusions on the replacement proposal, then approve it explicitly. For a recency blocker such as “recent publications”, supply a numeric window or choose no age limit and review the replacement preview.
4. An earlier run’s **Adjust brief** action opens fresh preparation with its original run intact. **Refresh evidence for this run** resumes analysis under the stored interpretation and the existing current-evidence checks.

## Evidence and findings semantics

- **Requested channels** are brief/report scope. Recorded source availability comes from the run receipt. Pending refresh, unavailable and expired source states can coexist with completed processing. The reported source time is the data observation date when supplied. Missing source inventory, observation dates, per-source query activity and per-source contribution remain unknown.
- **Direct examples** count examples in the returned report. Background examples retain their qualifications, source links, attribution, dates and licence. The market activity table counts retained activity, creators and activities with public metrics before the example display limit, including context. Market records retained for ranking are a bounded population. Public metrics use their source’s measurement window.
- **Company-authorized strategy evidence** counts reviewed profiles per strategy. Exclusion reasons can overlap. Profiles and reasons are kept within each strategy. Evidence links, current quote terms, expiry, observed periods and measurement context are displayed when supplied.
- **Allocation** requires a usable returned selection and spend. Optimal, evidence needed, infeasible and search limit retain their meanings. A search can reach its limit with a usable candidate allocation or with feasibility still undetermined. The plan action can carry forward a strategy’s constraints even when no allocation is available.
- **Next actions** use the run/strategy condition and returned examples. Refresh keeps the same run. Adjustment starts preparation again. A quote-and-evidence draft asks for firm pricing, usage rights, expiry and shareable supporting evidence, and stays available for the user's review or copying. A public match alone establishes neither a usable quote nor company authorization. A failed current-evidence read removes the current report and can show a labeled historical summary.

Stage C’s narrow shared client changes expose the existing company scope, versioned draft save and optional source observation time, and preserve currency for downstream scenario edits. The existing backend endpoints, v1 proposal and request identity, authorization, report revisions, legacy API/MCP requests, migration and research algorithms remain at accepted B. There is no new company access to operator-side source endpoints.

## Verification

Windows test runtime: Node 22.18.0, npm 10.9.3, Vite 8.3.8, Playwright 1.65.0, Chrome 158.0.8127.88, Python 3.12.16, FastAPI 0.162.7, Pydantic 2.14.3, SQLAlchemy 2.0.57, Alembic 1.20.1, psycopg 3.3.9, pytest 9.2.0, Ruff 0.17.5, PostgreSQL 17.7, MCP 2.3.0 and httpx2 2.16.2. The existing frontend lockfile and installed Python environments were used.

| Gate | Result | Boundary |
| --- | --- | --- |
| Frontend typecheck and pilot production build | Exit 0 | `npm run build` runs TypeScript and Vite. |
| Chrome Playwright research integration | Exit 0 · 11 passed, 0 skipped · 32.1 s | Real registration, authenticated API preview/clarification/approval, receipts and isolated PostgreSQL persistence. Includes standalone, existing and prospective campaigns. |
| Stage A criteria, B preparation and legacy matching | Exit 0 · 195 passed, 0 skipped · 1.69 s | Repository unit suite with skip enforcement. |
| PostgreSQL, worker, authenticated HTTP and configured company MCP | Exit 0 · 14 passed, 0 skipped · 22.06 s | Isolated schemas. Includes legacy report revision, frozen v1 snapshot, exact retry, concurrency, campaign/company scope and evidence-change rejection. |
| Standalone MCP stdio | Exit 0 · 20 passed, 0 skipped · 16.39 s | Pinned actual transport with a controlled loopback HTTP fixture. |
| Ruff and Alembic | Exit 0 | Lint passed, 209 Python files formatted, migrated disposable database and migration head both reported 0034. |

An earlier 11-case run passed 10 cases. Its remaining assertion expected a different denial status for a mismatched company. The final test asserts the API’s actual 409 `company_changed` response and checks the resulting browser session behavior.

The browser ran against the real FastAPI application and two disposable services on loopback. The browser database and pytest database were separate. The ordinary comparison workflow and the save/conflict cases used actual application writes. The lost-response case let real writes complete, discarded the first response in the browser, and verified the same stored campaign and run on retry. Delay and coded submission errors used Playwright routes. The history presentation case controlled returned completion, sources, reports and a rights-error response while reading real receipts and saving the adopted strategy through the API. The database compatibility gate independently exercised actual storage, worker and report validation.

The commands ran from the checkout root except npm commands, which ran from `frontend`.

```powershell
npm run build
npm run test -- campaign-research.integration.ts research-preparation.integration.ts --workers=1

& $backendPython -m alembic upgrade head
& $backendPython -m alembic current
& $backendPython -m alembic heads
& $backendPython -m uvicorn backend.api.app:create_app --factory --host 127.0.0.1 --port 18146
& $backendPython -m pytest -p scripts.require_pytest_pass -q -ra --tb=short backend/tests/test_research_criteria.py backend/tests/test_research_matching.py backend/tests/test_research_preparation.py
& $backendPython -m pytest -p scripts.require_pytest_pass -q -ra --tb=short backend/tests/m2/test_confirmed_research.py backend/tests/m2/test_company_research.py backend/tests/m2/test_marketing_mcp.py
& $mcpPython -m pytest -p scripts.require_pytest_pass -q -ra --tb=short -o faulthandler_timeout=30 mcp_access/tests
& $backendPython -m ruff check --config ruff.toml backend mcp_access scripts
& $backendPython -m ruff format --config ruff.toml --check backend mcp_access scripts
```

The browser used `M4_REAL_API=1`, `HARBOURLINE_RESEARCH_TEST_PILOT=1`, `HARBOURLINE_INSTALLATION=pilot`, `HARBOURLINE_SELF_REGISTRATION=1`, `PLAYWRIGHT_CHANNEL=chrome`, `M4_FRONTEND_PORT=5186` and a loopback `API_PROXY_TARGET`. The API used disposable pilot and partner credentials, `DATABASE_URL` for the browser database and a local evidence directory. The PostgreSQL suite used `M2_TEST_DATABASE_URL`, `HARBOURLINE_MCP_TEST_PYTHON` and process-scoped PowerShell `RemoteSigned`. The full Compose/deployment gate and live publisher fetching were outside this verification. Docker Desktop’s daemon was unavailable. The tested company pilot uses Harbourline’s dark theme and offers no separate light theme on this route.

## Review artifacts

Use `PR26C_Review_Package.zip` with the standalone `PR26C-Handoff.md`. The ZIP includes the verbatim sources, tests, fixtures and handoffs at repository-relative paths, the complete base patch, the Stage C-only diff and inventory, the deletion list, and a per-file size and SHA-256 manifest. The reconstruction instructions record both replay routes and the Windows line-ending handling. The archive’s handoff is byte-identical to both supplied handoff copies.
