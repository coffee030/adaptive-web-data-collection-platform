# PR26 Stage B handoff

The original Stage B submission and its verification are recorded first. The correction R1 section gives the current contract and results.

Stage B implements confirmed research criteria for the company API and MCP. Preview returns a proposal for review. Submission requires an explicit confirmation of the exact finalized proposal and stores its interpretation with the run. The existing browser form continues to use the legacy submission contract until Stage C. The implementation is local and ready for independent review.

## Checkout and reconstruction base

| Item | Recorded value |
| --- | --- |
| Repository | [coffee030/adaptive-web-data-collection-platform](https://github.com/coffee030/adaptive-web-data-collection-platform) |
| Checkout | `C:\Users\noob\Downloads\ITE4116M_Final_Year_Project\Adaptive-Web-Data-Collection-Platform-PR26A` |
| Branch | `codex/pr26-research-clarity` |
| Starting HEAD, final HEAD, and reconstruction base | `7cdeea8fe2cd749b8a3e79aaeb87707b66659223` |
| Starting worktree | Three accepted Stage A source/test files and the Stage A handoff, all untracked |
| Final worktree | 11 tracked modifications and 12 untracked additions, including the four accepted A files. The index is unchanged. |
| Migration | `0034_confirmed_research_criteria.py`, revision `0034` after `0033` |
| Review archive | `C:\Users\noob\Downloads\ITE4116M_Final_Year_Project\PR26B_Review_Package.zip` |

The separate M10 checkout had a different HEAD and no Stage A files. The dedicated PR26 checkout held the four accepted R2 files. No `AGENTS.md` applied to that checkout. All four accepted files were compared byte for byte with `PR26A_Corrected_Review_Package_R2.zip`. The accepted source and test hashes also match section B of the Stage A handoff. The change remains uncommitted for review.

## API and MCP workflow

Use `POST /api/v1/marketing/companies/research-runs/preview` with a company session. The request has `protocol: "confirmed-v1"`, a `BusinessBrief`, an optional `campaign_id`, an optional provenance map, and optional `decisions`. The authenticated endpoint calls the same pure preparation service for browser/API and MCP clients. Authentication reads the company session. Preparation performs no database writes, collection, network requests, dispatch, or clock reads. The preview can bind a proposed campaign identifier without reading that campaign. Run submission still enforces campaign ownership.

The response contains the validated `preparation`, the Stage A `initial` resolution, the `finalized` resolution, the `effective_brief` when ready, and a company-bound `fingerprint`. The fingerprint covers the typed request, provenance, review decisions, initial and finalized resolutions, and effective brief. An untagged non-null structured value has legacy provenance. Supply `application_default` for a known default and `explicit` for a value entered by the user. For publication age, an absent value and an explicit unrestricted value both serialize as `null`. Their field states distinguish them.

Use these typed decisions to clarify a proposal and preview it again.

| Decision | Contents |
| --- | --- |
| `publication_age` | `max_evidence_age_days` as an integer from 1 to 3,650, or `null` to explicitly choose an unrestricted window |
| `platforms` | Main `platform`, `alternative_platforms`, `platform_intent` (`single`, `comparison`, or `alternatives`), and `excluded_platforms`. Choose distinct channels and keep targets outside the exclusions. |
| `deliverable` | A supported `Campaign` deliverable |
| `language` | A supported `language` or `null`, and a strict boolean `require_language`. A mandatory language requires a named language. |

The initial audit remains available after applying decisions. Correct invalid input in the brief and preview again. A `ready` proposal is eligible for the next step. Ask the user to approve that exact proposal, then submit its `preparation` plus a `request_key` UUID and this confirmation to `POST /api/v1/marketing/companies/research-runs`.

```json
{
  "action": "confirm",
  "version": "research-criteria-v1",
  "proposal_fingerprint": "<the fingerprint of the final preview>"
}
```

The server recomputes the proposal for a new key. Missing or malformed confirmation returns HTTP 422. A mismatched fingerprint returns 409 `research_confirmation_stale`. Confirming a matching unresolved or invalid proposal returns 422 `research_criteria_unresolved`. The legacy request shape is strict and rejects confirmed-protocol fields. A granted request stores the original brief, version, validated proposal, confirmation, time, and canonical request fingerprint in the transaction that inserts the queued run. Exact retries return the existing run before invoking the resolver, even after the active interpretation changes. A changed request under the same key returns 409 `research_request_changed`. Company and campaign scope still apply.

Company MCP exposes read-only `preview_campaign_research`. Clients with `-AllowWorkspaceEdits` submit through `start_campaign_research` with the same preparation and confirmation fields. A confirmed MCP submission missing approval is rejected. The original unversioned MCP signature and unversioned API shape are available to existing clients. The frontend has typed clients for both protocols. The browser form calls the unversioned client, as asserted by the Playwright request capture.

## Execution and storage

Migration `0034` adds a nullable `criteria_version` string and a nullable `confirmed_criteria` JSONB snapshot with a paired-column constraint. Existing rows retain SQL NULL in both columns, so there is no backfill. Downgrade to `0033` takes a table lock before checking for confirmed runs. It refuses to erase saved interpretation while confirmed runs exist.

The worker and report endpoint verify the saved snapshot and use its effective brief and finalized interpretation. The active resolver is used only for preview and validation of a new confirmation. The stored publication window, channels and exclusions, deliverable, and language requirements drive evidence classification. The effective campaign supplies the stored business criteria to the existing recommendation and allocation rules. Existing public-source rights, company grants, evidence requirements and report consistency checks still apply. The confirmed workflow preserves `all_sources` for legacy or application-default channel values without a text or explicit target. A confirmed explicit target still limits direct channel matches. Excluded channels are removed from matching. Alternative channels with eligible evidence follow the selected scope.

Historical runs exercise the existing text matcher and preserve the existing report digest. Confirmed revisions bind the saved fingerprint to the report contents. Both paths recompute against current authorized evidence and reject revision mismatches. The optional `criteria_version` and `confirmed_criteria` receipt and report metadata are appended after computing the revision. The internal request fingerprint stays in storage. A malformed or mismatched saved snapshot produces `research_snapshot_invalid`.

## Verification

The checks ran on Windows with CPython 3.12.16, the repository’s pinned backend dependencies, a separate MCP 2.3.0 environment, Node 22.18.0, and PostgreSQL 17.7. PostgreSQL ran in a new loopback-only cluster. The database-backed pytest fixtures created disposable schemas. Playwright used a local API and an isolated pilot on the same test cluster. Published examples in the worker test used a controlled fixture. The browser checked the real company save and legacy research paths. No external publisher was contacted for the verification.

| Gate | Observed result |
| --- | --- |
| Stage A, unchanged legacy matcher, and new preparation tests | `192 passed in 2.08s` |
| Confirmed and legacy PostgreSQL research plus live company MCP | `10 passed in 17.16s` on the final migration. This includes the authenticated HTTP API, atomic replay, worker/report reuse, corrupt-snapshot rejection, ownership, and the MCP client connected over stdio to the local API. |
| Broader backend suite with PostgreSQL and Redis | `557 passed, 3 skipped in 283.54s`. The skip gate exited nonzero because OpenSSL was missing from `PATH` for three local TLS fixture cases. Those three cases were rerun with OpenSSL 3.5.3 and all passed in 10.73s. |
| Standalone MCP protocol suite | `17 passed in 20.75s` |
| Historic report captured at the reconstruction base | Actual legacy digest `804399c238cb0ee2a40620797abd8fba154db7aeeba394c78a71a368f9a02d5b` and a 90-day legacy reading for `最近30日`. The upgrade regression seeds this digest in `0033`, upgrades to `0034`, and verifies the unchanged report and stored brief. The confirmed worker fixture reported 30 days. |
| Frontend | `npm ci` installed the lockfile. `npm run build` passed TypeScript and the production build. `playwright test campaign-research.integration.ts --workers=1` passed both cases in 8.5s. |
| Alembic and schema consistency | Single head `0034`. PostgreSQL upgrade, legacy-only downgrade and confirmed-run downgrade guard passed. `alembic check` detected no schema drift. Offline upgrade and downgrade SQL rendered with the expected constraint and downgrade guard. |
| Ruff and whitespace | Lint passed, all 208 Python files matched Ruff formatting, and both the live tracked diff and reconstructed staged diff passed `git diff --check`. |

The first live company MCP run hit a Windows PowerShell script execution policy before launching its stdio client. The passing rerun used process-scoped `RemoteSigned` for the local connection helper. The first browser runs omitted the isolated partner API workspace or its required test token and received 403 on market requests. The passing run used both fixture settings. No repository dependency pin or machine execution policy changed. The broad backend run excluded the separate Compose gate. The focused suite above was rerun after the final downgrade guard change.

Run the core commands from the checkout with the test environment variables for your isolated services. The Playwright gate uses the pilot installation, self-registration, a partner workspace and fixture customer token, and `M4_REAL_API=1`, `HARBOURLINE_RESEARCH_TEST_PILOT=1`, and a local `API_PROXY_TARGET`.

```powershell
& $backendPython -m ruff check --config ruff.toml backend mcp_access scripts
& $backendPython -m ruff format --config ruff.toml --check backend mcp_access scripts
& $backendPython -m pytest -p scripts.require_pytest_pass -q -ra backend/tests/test_research_criteria.py backend/tests/test_research_matching.py backend/tests/test_research_preparation.py
& $backendPython -m pytest -p scripts.require_pytest_pass -q -ra backend/tests/m2/test_confirmed_research.py backend/tests/m2/test_company_research.py backend/tests/m2/test_marketing_mcp.py
& $backendPython -m pytest -p scripts.require_pytest_pass -q -ra backend/tests --ignore=backend/tests/m2/test_m3_compose.py
& $backendPython -m pytest -p scripts.require_pytest_pass -q -ra backend/tests/m1/test_m7_timeout.py::test_real_curl_transfer_deadline
& $mcpPython -m pytest -p scripts.require_pytest_pass -q -ra -o faulthandler_timeout=30 mcp_access/tests
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend run test -- campaign-research.integration.ts --workers=1
```

## Review package

The archive includes every changed file at its repository-relative path, including the four accepted A files, B backend and client source, migration, tests, fixture, and both handoffs. `MANIFEST.json` records the base, expected Git tree, patch digest, file statuses and verbatim file hashes. `PR26B.patch` is a full-index binary-capable patch against the recorded base. `DELETIONS.txt` is empty because no path was deleted. `RECONSTRUCT.md` describes the replay procedure and how to restore the original Windows file bytes. Verification checks the supplied ZIP for integrity, applies its patch to a separate clean checkout, and checks the resulting Git tree and every supplied file digest.

Stage B ends at independent review. Stage C, publication, and deployment remain outside this handoff.

## Stage B correction R1

### Checkout and review identities

| Item | Value |
| --- | --- |
| Repository and checkout | `coffee030/adaptive-web-data-collection-platform` in `C:\Users\noob\Downloads\ITE4116M_Final_Year_Project\Adaptive-Web-Data-Collection-Platform-PR26A` |
| Branch, starting HEAD, final HEAD and reconstruction base | `codex/pr26-research-clarity` at `7cdeea8fe2cd749b8a3e79aaeb87707b66659223` |
| Starting worktree | 11 tracked modifications and 12 untracked additions. There were no staged changes. |
| Final worktree | 13 tracked modifications and 15 untracked additions against HEAD, with no deletions or staged changes. The correction remains uncommitted. |
| Reviewed B | Archive SHA-256 `b87bc5f47829849295b4222ad45343eb5dd32a38c482ae2290a1b37e0cab6d96`, Git tree `f530d4875bc2b1360a1092b92dd899ce7884db05` |
| Corrected implementation tree with original handoff bytes retained | `85abe1a4662c3c8b4ad4ab9ed726f46af0573c79`. The manifest records the complete reconstructed tree including this updated handoff, which avoids a self-referential document hash. |
| Migration | `0034_confirmed_research_criteria.py`, sole head `0034`, byte-identical to reviewed B |
| Corrected package | `C:\Users\noob\Downloads\ITE4116M_Final_Year_Project\PR26B_Corrected_Review_Package_R1.zip` |

No repository or ancestor `AGENTS.md` applies to this checkout. The four accepted A R2 files stay byte-identical to their reviewed copies. The resolver hash is `f265220df11cf34028626de2c8f0b1027c8e3bdb70315002e4020fca059a1335`, the contracts hash is `9376035c3165e17b53978661de6a56411d33bf7903d688b086733d524de9df80`, the test hash is `f49bea570ea3caed5c4983316497df11be5f60ba3d112011d2cb784ebe80906b`, and the accepted A handoff hash is `fcf9adce05cbd4661eeb42dc02b3cb55308cbafdb3d93d4e84655a8b06c4d370`. The original B ZIP stays intact. There was no reset or restaging of repository work.

### Findings and corrections

| Item | Root cause and correction | Maintained evidence |
| --- | --- | --- |
| R1 | `ResearchCampaign.tsx` was using the original `run.brief` for its header, findings and quote-draft props, adjustment, and strategy adoption. `researchClient.ts` now selects the confirmed effective brief after checking the receipt and relevant criteria. Invalid or missing confirmed metadata produces a retryable integrity message and blocks the affected actions. Adoption starts with the effective campaign, applies the selected strategy platform and budget, and saves matching campaign/evaluation values. Legacy receipts continue to use their original briefs. | `campaign-research.integration.ts` uses real registration, preview, submit, run reads and campaign writes. A controlled ready state and report make the browser action path deterministic. It checks YouTube and short-video display and quote text, adjusted legacy submission, TikTok alternative adoption with the selected cap and effective Cantonese requirements, genuine legacy display/adjustment, and missing or incompatible saved metadata. |
| R2 | Parser readiness was used as the condition for constructing an executable campaign. `research_preparation.py` now checks runtime completeness before calling `BusinessBrief` validation and exposes typed `execution` status and issues through the preview response. An excluded default can leave A legitimately `ready` with an absent platform. The preview reports `main_platform_required`, keeps the exclusion, and offers a platform decision. | The original code raised a campaign platform `literal_error` for the supplied phrase. The corrected PostgreSQL-backed ASGI API test gets HTTP 200 preview with an absent platform and actionable issue, HTTP 422 on an exact blocked submission with zero runs created, and a queued run after selecting YouTube while retaining the Instagram exclusion. A stale fingerprint is rejected before submission. |
| R3 | The MCP SDK's normal function arguments could collapse an explicitly supplied null into an omitted default. `harbourline.py` publishes a strict two-branch JSON schema and validates raw tool arguments against it before SDK function coercion. A legacy call must omit all confirmed-only fields. A confirmed call carries a validated approval and preparation. | Reviewed B was reconstructed and its real stdio invocation sent a legacy POST for explicit null confirmation. The corrected stdio regression asserts zero outbound POSTs for null, empty or malformed confirmation, explicit legacy with new fields, unknown protocol and invalid provenance/decisions. Valid legacy and confirmed controls forward their canonical requests. |
| R4 | The shared MCP HTTP wrapper discarded the known research error codes. Its research branch now preserves the allowlisted code and recovery action, includes bounded field guidance when available, and uses the existing generic HTTP recovery for unknown or malformed responses. | Reviewed B stdio reduced stale and unresolved errors to generic 409/422. Corrected stdio assertions cover all four required codes, known issues, malformed, oversized and unknown bodies, 401/403, rate-request handling, and a transport-double disconnect. The separate configured live MCP case uses the real company API and database for stale, unresolved and changed-request cases. |
| R5 | A deterministic platform order was treated as approval of the primary role. Preparation now requires explicit structured provenance, a typed platform decision, or the primary role recognized by the unchanged Stage A parser structure. It retains the initial interpretation and its audit assumption. | The original code accepted first mention as operational primary in both wording orders. Corrected API cases block matching whole-proposal confirmation for both orders until a typed decision is supplied. Preparation tests separately exercise explicitly structured and parser-recognized primary roles, legacy/unknown provenance, and an unrelated unresolved date criterion. |

The existing frontend form still sends a legacy request. Adjustment uses a fresh request key and does not copy a confirmed snapshot or approval. The browser compatibility work ends at mixed receipt handling. Stage C has not started.

### Corrected contract and compatibility

Both `POST /api/v1/marketing/companies/research-runs/preview` and `preview_campaign_research` return `execution.status` of `ready` or `blocked`. `execution.issues` contains the field, stable issue code, explanation, and corrective action. The `initial` and `finalized` resolver statuses retain their interpretation meaning. A blocked proposal keeps `effective_brief` null. The preparation in `frontend/tests/fixtures/pr26b_confirmed_brief.json` is an executable example for an authenticated test company. The blocked-primary API cases in `test_confirmed_research.py` show the request, explicit platform decision, and submission using the replacement fingerprint. Use the `confirmation` envelope shown above for a new confirmed request after the user approves the exact executable preview. A matching blocked submission returns HTTP 422 `research_criteria_unresolved` with its blocking issues. A stale binding returns HTTP 409 `research_confirmation_stale` first.

MCP `start_campaign_research` accepts the strict legacy envelope with an omitted protocol or explicit `legacy`, or the strict `confirmed-v1` envelope. Confirmed-only fields on a legacy call are rejected at the raw argument boundary, including null and empty values. For recovery, `research_confirmation_stale` directs the caller to preview again and approve the new proposal. `research_criteria_unresolved` lists allowed field guidance before another attempt. `research_request_changed` directs the caller to read the existing run or use a new key for a new request. `research_snapshot_invalid` directs the caller to stop and report the saved integrity problem. These responses do not initiate a follow-up request.

`ResearchPreview.execution` exists only on the preview response. The v1 fingerprint projection remains `preparation`, `initial`, `finalized`, and `effective_brief`. The accepted-request projection and stored `ResearchProposal` are unchanged. For a newly blocked proposal, the absent effective brief makes its fingerprint distinct from the original executable interpretation. Storage and exact replay do not call the corrected readiness policy on already accepted snapshots. A frozen snapshot still undergoes the existing version, request and fingerprint integrity checks.

An author-run comparison of the reconstructed original B source and the corrected code also checked an ordinary non-comparison proposal from `pr26b_research.json`. Both runs produced the same executable 30-day interpretation, proposal fingerprint `87595e4fc3315fff3f02367f964f90c7b51d744622b0ba9e72f623d69b016b2f`, and request fingerprint `ea37d59fe8df73f4ef29acff3f9b5c1c9f0d1a05dd09c809dbda2534f9cf871a` for the same company and submission.

`backend/tests/fixtures/pr26b_pre_correction_v1.json` was captured from the original running Stage B before source edits, using a real `start`, a PostgreSQL run row, all worker phases and report recomputation. Its proposal fingerprint is `f94c1c66d42c9836ca5d22a235766f75f2af7ddc0f4b671a8f36ae3e12b1a60f`, accepted-request fingerprint `800d2d658e61318c3c23892e88b3b3242c214a2dcef591d5650cf7f54ee90d0f`, and report revision `2aa5a66a228e39616172353fb45bf2138296ba95b3d6addc5b0ecddfe1f00803`. The compatibility test seeds those exact bytes into a fresh migrated schema. It verifies authenticated read and exact HTTP replay, rejects the old confirmation on a new key and detects a changed same-key request, reconfirms the report revision after resume and worker phases, and fails the test if any of those stored paths call the active resolver. The stored strategies remain YouTube, YouTube, and Instagram. Existing legacy serialization, digest, scope, worker fencing and evidence tests run separately.

### Correction verification

Verification used Windows, CPython 3.12.16, repository pins including pytest 9.2.0 and Ruff 0.17.5, separate MCP 2.3.0 dependencies, PostgreSQL 17.7 on loopback, Node 22.18.0, and Chrome 158.0.8127.88. The database-backed pytest fixtures used disposable PostgreSQL schemas. The browser harness used an isolated pilot API, Vite, and Chrome. Only the browser presentation test used stubbed run completion and findings. The PostgreSQL compatibility test and live MCP transport gate used the application and test database. The standalone MCP stdio suite drove the actual tool server against a separate HTTP capture fixture. No production database, account, or publisher API was used.

| Gate | Correction result |
| --- | --- |
| Stage A, old matching and B preparation | Exit 0. `195 passed in 1.74s`. |
| Actual PostgreSQL, worker, HTTP API and configured live MCP | Exit 0. `14 passed in 23.02s`. Includes migration/legacy upgrade and downgrade checks, concurrency, company and campaign scope, stored snapshots and old request identity. |
| Standalone MCP transport and controlled server | Exit 0. `20 passed in 16.70s`. |
| Frontend | `npm run build` exited 0 and ran TypeScript and the Vite production build. Playwright exited 0 with `3 passed in 16.4s` against the final receipt guard. |
| Broader backend | The final run exited 0 with `567 passed in 293.01s` and no skips. An earlier run collected the regression before its test provenance correction and exited 1 with `566 passed, 1 failed in 297.08s`. The corrected fixture explicitly identifies both platform input defaults as `application_default`. |
| Ruff and Alembic | Exit 0. Lint passed, 209 Python files matched formatting, and Alembic reported `0034 (head)`. Patch replays include Git whitespace checks. |

Commands ran from the repository root except the npm commands, which ran from `frontend`. The database run used `M2_TEST_DATABASE_URL` and `HARBOURLINE_MCP_TEST_PYTHON` for the disposable services. The broader run also used isolated Redis with `M3_TEST_BROKER_URL` and the installed OpenSSL on `PATH`. Process-scoped `RemoteSigned` allowed the existing Windows MCP helper. Browser variables were `M4_REAL_API=1`, `HARBOURLINE_RESEARCH_TEST_PILOT=1`, `HARBOURLINE_INSTALLATION=pilot`, `HARBOURLINE_SELF_REGISTRATION=1`, `PLAYWRIGHT_CHANNEL=chrome`, and the local `API_PROXY_TARGET` with fixture partner credentials. Repository pins and machine policy were unchanged.

```powershell
& $backendPython -m ruff check --config ruff.toml backend mcp_access scripts
& $backendPython -m ruff format --config ruff.toml --check backend mcp_access scripts
& $backendPython -m alembic heads
& $backendPython -m pytest -p scripts.require_pytest_pass -q -ra --tb=short backend/tests/test_research_criteria.py backend/tests/test_research_matching.py backend/tests/test_research_preparation.py
& $backendPython -m pytest -p scripts.require_pytest_pass -q -ra --tb=short backend/tests/m2/test_confirmed_research.py backend/tests/m2/test_company_research.py backend/tests/m2/test_marketing_mcp.py
& $backendPython -m pytest -p scripts.require_pytest_pass -q -ra --tb=short backend/tests --ignore=backend/tests/m2/test_m3_compose.py
& $mcpPython -m pytest -p scripts.require_pytest_pass -q -ra --tb=short -o faulthandler_timeout=30 mcp_access/tests
npm.cmd run build
npm.cmd run test -- campaign-research.integration.ts --workers=1
```

The separate Compose deployment gate was outside these local database and test commands. The referenced `PR26B_Independent_Review.zip` was absent from this chat's attachments and the checked local file locations. Its README, supplied browser fixture and private test harness were unavailable. The known reproductions in the local correction prompt were exercised with the included maintained fixtures, and the original package was used for the historical compatibility and stdio reproductions. The independent archive's own checks remain unexecuted.

### Corrected archive and disposition

The corrected ZIP supplies the complete reconstruction patch `PR26B_R1.patch`, a separate `CORRECTION_R1.patch` against the reconstructed reviewed B tree, the correction inventory, an explicit deletion list, verbatim files, and the manifest. Both patches are verified in fresh directories. The ZIP and standalone handoff are compared byte for byte. Raw Windows file hashes and Git-normalized tree identity are documented separately in `RECONSTRUCT.md`.

Stage B corrections are ready for independent review on the evidence recorded above. The independent review archive remains outstanding. Stage C has not started.
