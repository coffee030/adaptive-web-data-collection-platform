# M17C implementation handoff

Verification took place on 2026-11-20 Hong Kong time in the `M17-mcp-access` checkout. Branch `feature/M17-mcp-access` started clean at M17B commit `46567939dfc176e04b3264476123d6d82131a96a`. The fetch and push remotes were verified as `coffee030/adaptive-web-data-collection-platform`. The formal FYP title is **Adaptive Scalable and Observable Web Data Collection Platform**.

| Acceptance area | Outcome |
| --- | --- |
| English coverage | Passed. The active policy and project-authored materials use English, including historical milestone records. Seven tracked files contain intentionally preserved Unicode inputs. |
| Real AI host | Passed all five scenarios in one fresh authenticated Codex CLI 0.169.1 session using the local stdio `fyp` server. |
| Dashboard parity | Passed for both new Requests, all four child Jobs, and the Record and Evidence traced by the host in each run. |

## Live host and inventory

The Windows launcher reused the isolated Synthetic Demo. Diagnostics confirmed API port `58098` and Dashboard port `5198`. Codex CLI 0.169.1 used its app-server interface with model `gpt-6.2-sol` and Python 3.13.7, with the project example's stdio command, working directory, and loopback API base supplied for the session. The operator sent the five messages below in one conversation. Every observed platform action used FYP MCP. The trace was checked using completed `mcpToolCall` items and MCP results.

For each of the two writes, Codex issued a `mcpServer/elicitation/request` for `start_collection`. The operator checked the Topic, keyword, and both approved bindings before accepting each call individually. Each `prepare_collection` returned `submitted: false` and a distinct key. The subsequent `start_collection` received the whole prepared submission unchanged. Both receipts were HTTP 201 with `outcome: created` and `status: pending`. There were two preparation calls and two start calls in total.

| Scenario | Actual operator prompt | Completed FYP MCP calls in event order | Observed answer excerpt |
| --- | --- | --- | --- |
| Discover | Which approved sources can I use for Fixture Listings under Core Demonstration? Show me the choices and wait. | `list_categories`, `list_topics`, `list_topic_sources` | “Demo Cards” and “Demo Catalog”, both Profile Version 1. |
| Submit | Collect the keyword quick from both of those sources once. Give me the request ID so I can open it in the Dashboard. | `prepare_collection`, `start_collection` | “Both jobs were pending at submission.” |
| Follow | How did each source finish? Show me one accepted record, where it came from, and the stored SHA-256 for its evidence. | `get_collection_status`, `get_collection_records`, `get_evidence_metadata`, `get_record_lineage` | “The `quick` collection succeeded for both sources.” The host reported Alpha, its Demo Catalog origin, and the stored SHA-256. |
| Partial | Run one new collection for detail404 using the same two sources. Once it finishes, tell me what each source retained, what failed, and show me the evidence for a retained record. | `prepare_collection`, `start_collection`, `get_collection_status` twice, `get_collection_records`, `get_evidence_metadata`, `get_record_lineage` | “Each source retained one accepted record and reported an HTTP 404.” |
| Unapproved source | For Fixture Listings, can you include a website that is not on the approved source list? Explain my options and wait. | None | “The extraction profile needs separate approval.” The host explained destination validation, Source authorisation, approved Profile Version, and Topic eligibility, then waited. |

Independent REST GET snapshots captured complete sets before and after every scenario. No IDs were removed and every next baseline matched the previous final set. The only added IDs are shown in the Request and Job table below.

| Scenario | Request count before → after | Job count before → after | Added Requests and Jobs |
| --- | --- | --- | --- |
| Discover | 8 → 8 | 16 → 16 | None |
| Submit | 8 → 9 | 16 → 18 | The `quick` Request and its two Jobs |
| Follow | 9 → 9 | 18 → 18 | None |
| Partial | 9 → 10 | 18 → 20 | The `detail404` Request and its two Jobs |
| Unapproved source | 10 → 10 | 20 → 20 | None |

Discovery returned Core Demonstration `68923b18-af5c-4d79-b658-9c07c4e7db53`, Fixture Listings `3091c411-5194-4274-b2f2-fb631a829994`, Demo Catalog binding `6f201baa-fb4c-4cd0-9023-95af06d648e5`, and Demo Cards binding `7abb7a11-00f6-40be-854a-3956e226ecdf`.

| Collection | Prepared request key | Parent Request | Demo Catalog Job | Demo Cards Job | Terminal state |
| --- | --- | --- | --- | --- | --- |
| `quick` | `51b534a6-7bd4-4685-b4f7-b05a754b8333` | `5759df43-0924-4413-819d-9e5ab5072c92` | `377ac6c4-fbee-4b56-8baa-7145ebb18db9` | `9d0d318b-813b-4524-bd86-c11a7d96b7b2` | Succeeded for the Request and both Jobs |
| `detail404` | `82c828d8-3959-4786-a5f2-84457f960bd5` | `77f2051a-c4ee-4702-a097-8167385471a2` | `105873b8-1f71-48c6-8545-f6a69ded86b1` | `7c5ac1aa-a381-42e6-9290-0f00c2d4face` | Partial for the Request and both Jobs |

The follow-up read found `quick` already terminal. For `detail404`, the two status reads observed running and then partial within the 90-second polling deadline. In both runs, each Job showed 1 accepted, 0 invalid, and 0 duplicates. In the partial run, both Jobs retained Alpha and also reported the fetch error `http_error`, HTTP 404. Each retained record passed validation.

## Independent Dashboard check

Headless Chrome opened each Request Detail and checked its URL, heading, parent status, exactly two child Jobs, status and counts for each Job, and the Job, Source, and pinned Profile Version links. Both partial Jobs showed `http_error` and HTTP 404. The browser followed **View request records**, selected **Inspect Alpha** by Record ID, expanded **Provenance and identifiers**, and checked all IDs and the link back to the same Request. It then opened **View capture evidence** and checked the Evidence ID and **Content SHA-256**. The Dashboard issued zero non-GET API requests during these checks.

| Source | Source ID | Pinned Profile Version ID |
| --- | --- | --- |
| Demo Catalog | `6ab64570-4cb0-486b-88c8-9b9572ad27e5` | `4f6fe521-52fc-447d-b783-916d25c88536` (Version 1) |
| Demo Cards | `8dc0d5ee-168a-4c5b-8420-3a688d2973d6` | `70a3abe7-a2df-43b8-951c-78b523d876e1` (Version 1) |

| Host-traced Demo Catalog Record | Record ID | Evidence ID | Stored SHA-256 matched in Dashboard |
| --- | --- | --- | --- |
| `quick` Alpha | `fd37cf49-6b7a-50af-88ad-6c7f26352b2c` | `041c64df-aaf4-48f3-94df-3521ec5fa839` | `4ce7ceca659b894e809bc5e95a8c39a41a647bf7059336a8f96115b36c23710b` |
| `detail404` Alpha | `caf8ff5f-9ec4-5b57-abbb-c9f3bd73a462` | `02cc6725-7798-4a55-880a-a4fc43d36e67` | `4ce7ceca659b894e809bc5e95a8c39a41a647bf7059336a8f96115b36c23710b` |

Both traced captures were HTTP 200 detail captures from page 2 and the Records came from HTML item 1. The live host and Dashboard comparison checked stored SHA-256 metadata. Launcher baseline diagnostics separately verified capture bytes for the three presets.

## Verification commands

| Command or procedure | Result |
| --- | --- |
| `Start-Platform.bat -Demo -OneClickDemo -NonInteractive -NoBrowser` and `Diagnose-Platform.bat -Demo` | Passed. Verified database migrations and health, Redis, Dispatcher, Celery worker, fixture and three launcher presets. |
| `codex --version`, `codex --help`, `codex exec --help`, and `codex login status` | CLI 0.169.1 and existing ChatGPT authentication confirmed. |
| `python -m pip check` in the MCP environment | No broken requirements. |
| `python -m pytest -q mcp_access/tests` in the MCP environment | 14 passed in 10.14 seconds. The initial sandboxed run stalled and was stopped. The local rerun with subprocess and loopback access passed. |
| `python -m mcp_access.verify_demo 9b98e289-9424-4592-a46c-03391b3e68d0` with the diagnostics API base | Passed the persisted M17A read trace. Inventory stayed at 8 Requests and 16 Jobs. |
| `npm.cmd run build` in `frontend` | Typecheck and production build passed. |
| Chrome via Playwright against the launcher Dashboard | Passed both Requests, both ID-matched Evidence traces, and the read-only browser assertion. |
| `npm.cmd test -- topic-collections.spec.ts results.spec.ts jobs.spec.ts --workers=2` with `PLAYWRIGHT_CHANNEL=chrome` | 78 passed in 56.7 seconds, including keyboard navigation, accessible names, focus, and axe checks. |
| `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/windows/Test-Launcher.ps1` | 28/28 passed, including English diagnostics, Unicode checkout paths, and Demo isolation. |

The host run required no backend, frontend, fixture, or launcher fix. The configuration example now asks for per-call approval of `start_collection`. M17B's post-commit reply-loss and same-key replay remain the recovery evidence. The accepted presentation steps are in the Windows MCP guide. [Windows MCP access](docs/setup/Windows-MCP-Access.md) [M17B recovery verification](M17B-Implementation-Handoff.md)

## English-language audit

The checkout inventory used `git ls-files` (508 files at M17B). The before-and-after Han scan used `git grep -l -I -P '[\x{3400}-\x{4DBF}\x{4E00}-\x{9FFF}\x{F900}-\x{FAFF}]' --`, with the M17B SHA supplied before `--` for the baseline. It covered tracked text only. M17B had 83 matching files, including 68 under `docs/`. M17C translated 78 Markdown files in place and reduced the scan to 7 matching files, including 2 under `docs/`. The audit also checked non-Latin scripts, full-width punctuation, English-language rules, user-visible copy and accessible names, launcher messages, application errors, CLI help, comments, and escaped literals.

| Remaining match | Reason preserved |
| --- | --- |
| `backend/tests/m1/test_m1_adapters.py` | Multilingual CSV ingestion and quoting fixture. The same test file has an accented HTML extraction fixture. |
| `backend/tests/m2/test_m9_record_export.py` | CSV quoting and export sanitisation, UTF-8 byte limits, and formula-like input. |
| `backend/tests/m7_fixture.py`, `frontend/tests/core-workflow.integration.ts` | Same synthetic keyword for Unicode and reserved-character URL handling. |
| `frontend/tests/job-create.spec.ts` | Large UTF-8 form input for the byte-limit check. |
| `docs/contracts/M7-controlled-website-collection.md`, `docs/experiments/M7-implementation-handoff.md` | Exact Unicode keyword in a REST example and a historical fixture run, with English context. |
| `.agents/skills/impeccable/reference/harden.md` | Other-script scan found preserved upstream examples of Persian and Arabic letters and digits. |
| `scripts/windows/Test-Launcher.ps1`, `frontend/src/features/results/presentation.tsx`, `backend/application/record_export.py` | Escaped or full-width characters for the launcher Unicode-path fixture, UTF-16 surrogate handling, and CSV formula protection. |

Windows OCR reviewed 86 historical browser captures and the workspace icon. Han detections in the browser captures were OCR substitutions for English text, punctuation, or controls. The proposal's 3 embedded diagrams were checked with the same local OCR. Their labels and editable captions use English. The browser captures and diagrams retain their source bytes.

The project folder contains the editable `Adaptive_Web_Data_Collection_Platform_Proposal(2).docx`, the English teammate brief `Adaptive_Web_Data_Collection_Platform_Teammate_Implementation_Instructions(1).md`, and the English provisional guide `docs/design-system/dashboard-guidance.md`. The proposal's body, captions, footer, and 3 figures use English. No replacement file was needed. The ITP4524 assignment and old worktree and backup copies are outside the current FYP submission inventory. Root-only early chat handoffs are historical working records outside the checkout.

The translation review compared the original diff, Markdown links and anchors, executable lines inside code fences, inline commands, IDs, and hashes. The active rule in `AGENTS.md` specifies English for project-authored materials and leaves private conversation language to each team member. The checkout and root copies of the FYP skills and rules were checked for equivalent language requirements.

## Branch and review

The repository-local author and committer are `coffee030 <59193099+coffee030@users.noreply.github.com>`. GitHub verification confirmed that the HTTPS credential resolves to `coffee030` (ID `59193099`) with push permission for the named repository. Publish the requested branch with `git push --no-follow-tags origin HEAD:refs/heads/feature/M17-mcp-access` and compare HEAD with `git ls-remote --exit-code --refs origin refs/heads/feature/M17-mcp-access` using that credential. PR and merge are pending teammate review. [Feature branch](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/feature/M17-mcp-access)
