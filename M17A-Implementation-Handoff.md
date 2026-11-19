# M17A handoff — Read persisted Demo data through MCP

Acceptance took place on 2026-11-20 (Hong Kong time). The baseline was `d01b1e84d591fd724b6ec4b836a440cb06fdfcbd` on `origin/main`, which included the merged M16. The feature branch was `feature/M17-mcp-access`. Commit `04631418a9acfdd252c1ff41049690345d788f1b` contains the implementation, tests, and Windows guide. The handoff is in a separate commit. [Windows setup and reproduction](docs/setup/Windows-MCP-Access.md)

## MCP tools and REST routes

| MCP tool | Route relative to `/api/v1` | Result |
| --- | --- | --- |
| `list_categories` | `GET /categories`, `active_only=true` | Active categories and their IDs |
| `list_topics` | `GET /topics`, `active_only=true`, optional `category_id` | Active topics and their categories |
| `list_topic_sources` | `GET /topics/{topic_id}/bindings`, `eligible_only=true` | Bindings the backend considers eligible, with their Sources and Profile Versions |
| `get_collection_status` | `GET /collection-requests/{request_id}` | Parent Request and child Job states, including partial and failed |
| `get_collection_records` | `GET /records`, required `request_id`, with `limit` and `offset` | Accepted records and extracted-data previews scoped to the specified Request |
| `get_record_lineage` | `GET /records/{record_id}`, `include_lineage=true` | Links between Record, Request, Job, Source, Profile Version, and Evidence |
| `get_evidence_metadata` | `GET /evidence/{evidence_id}` | Public capture metadata and stored `content_hash` |

Paginated tools fetch one extra row to determine `has_more` and return `next_offset` to continue. The existing Request-scoped Records API returned 404 for an unknown Request and 200 for an empty page. MCP runs over local stdio with separately installed dependencies. Extracted data has length limits and a truncation flag. The Evidence comparison used the backend's stored digest. Independent hashing of capture bytes was part of the existing launcher baseline check.

## Live Synthetic Demo comparison

`Start-Platform.bat -Demo -OneClickDemo -NonInteractive -NoBrowser` created and verified three presets in this checkout. `Diagnose-Platform.bat -Demo` showed Dashboard port `5198` and API port `58098`. In Chrome, we opened **Collection requests**, selected **Fixture Listings · quick**, and copied the Request UUID from the URL before running the live SDK trace.

| Field | Matching value | Dashboard UI | MCP and independent REST GET |
| --- | --- | --- | --- |
| Request | `9b98e289-9424-4592-a46c-03391b3e68d0` (Succeeded) | Request Detail URL and status | Request detail, Record lineage |
| Child Job | `5eeaa67c-fc4c-43f5-9b60-5dedb4584f15` (Succeeded) | Job details link and status under Child Jobs, and Record Inspector | Request detail, Record lineage, Evidence |
| Record | `e86eadff-abfd-50bc-ad73-8d2ca73461e6` (Alpha) | Data Explorer → Provenance and identifiers | Request Records page 1, Record detail |
| Source | `6ab64570-4cb0-486b-88c8-9b9572ad27e5` (Demo Catalog) | Name under Child Jobs and ID in Record Inspector | Request detail, Record lineage, Evidence |
| Profile Version | `4f6fe521-52fc-447d-b783-916d25c88536` (Version 1) | Pinned profile version link and Record Inspector | Request detail, Record lineage, Evidence |
| Evidence | `747eab7d-1197-496d-bb24-206e9cd98b34` | Record Inspector and Evidence Metadata | Record lineage, Evidence detail |
| Stored SHA-256 | `4ce7ceca659b894e809bc5e95a8c39a41a647bf7059336a8f96115b36c23710b` | Evidence Metadata → Content SHA-256 | Evidence detail `content_hash` |

The SDK found Core Demonstration (`68923b18-af5c-4d79-b658-9c07c4e7db53`), Fixture Listings (`3091c411-5194-4274-b2f2-fb631a829994`), and two eligible bindings for Demo Cards and Demo Catalog. It read two pages of Records at one per page. Page 2 contained `249a91f3-e443-5d6f-a688-09004f3ce62b`. The before and after REST ID sets matched at 3 Requests and 6 Jobs. The Chrome comparison recorded zero non-GET API requests.

## Verification results

| Command or action run | Result |
| --- | --- |
| `python -m pip check` (isolated MCP environment, Python 3.13.7) | Passed. The official SDK was pinned to [mcp 2.3.0](https://pypi.org/project/mcp/2.3.0/). |
| `python -m pytest -q mcp_access/tests` | 12 passed. Covered a real stdio child process, all tools and GET filters, pagination, Request A/B isolation, partial and failed states, empty pages and unknown IDs, invalid inputs, redirect rejection, offline operation, and response limits. REST fixtures were controlled test data. |
| `python -m mcp_access.verify_demo 9b98e289-9424-4592-a46c-03391b3e68d0` | Passed. Compared the real Demo REST API with SDK stdio. Chrome independently opened the same Request, Record, and Evidence. |
| Fresh `codex exec --ignore-user-config --ephemeral --sandbox read-only --json` with the MCP configuration injected via `-c` | Codex CLI 0.169.1 found `fyp`, completed `list_categories` with `limit=1`, and reported Core Demonstration and its UUID. The JSON output recorded a completed `mcp_tool_call`. |
| `python -m pytest -q -rs -p no:cacheprovider backend/tests/m2/test_m7_results.py backend/tests/m2/test_m8_collections.py backend/tests/m2/test_m9_record_export.py` with isolated PostgreSQL and Redis | 11 passed. With only PostgreSQL on the first run, M8/M9 had 6 pass and 2 skip because Redis was missing. The full rerun included both services. |
| `npm.cmd run build` | TypeScript and the production build passed. |
| `npm.cmd test -- topic-collections.spec.ts results.spec.ts m13-continuity.spec.ts jobs.spec.ts --workers=2` | 82 passed in headless Chrome with mock fixtures. |
| `npm.cmd test -- operator.integration.ts topic-collections.integration.ts --grep 'three existing Synthetic Demo presets expose\|launcher dashboard displays' --workers=1` | 2 passed against the live launcher Demo with `M4_REAL_API=1`, `M10_SYNTHETIC_URL=http://127.0.0.1:5198`, and `PLAYWRIGHT_CHANNEL=chrome`. |
| `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/windows/Test-Launcher.ps1` | 28/28 launcher tests passed. |
| Close the MCP clients, then run `Stop-Platform.bat -Demo` and `Start-Platform.bat -Demo -OneClickDemo -NonInteractive -NoBrowser` | The first Stop reported `CFG-003`. Diagnose confirmed the API and existing presets, and the Dashboard was restored. A complete stop and startup retry returned exit code 0 for both. Chrome and the SDK still found the same Request, Record, and Evidence IDs. |

Browser verification used an independent headless Chrome session. AI host acceptance covered the single Codex CLI read above. M17A accepted read-only lineage for persisted data. The remaining M17 work was deferred to later milestones.

## Publication and review

The repository-local Git author and committer were both `coffee030 <59193099+coffee030@users.noreply.github.com>`. The verified GitHub HTTPS publication account was `coffee030` (ID `59193099`) and the destination was `coffee030/adaptive-web-data-collection-platform`. GitHub confirmed the account and repository push permission using the same credential.

`git push --no-follow-tags --set-upstream origin HEAD:refs/heads/feature/M17-mcp-access` created the remote feature branch. `git ls-remote --exit-code --refs origin refs/heads/feature/M17-mcp-access` confirmed implementation SHA `04631418a9acfdd252c1ff41049690345d788f1b`. This handoff is in a later commit on the same branch. The branch ref gives the current SHA. Independent review was pending. [GitHub feature branch](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/feature/M17-mcp-access)
