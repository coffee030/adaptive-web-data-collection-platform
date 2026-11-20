# M21B — Fresh Windows 11 integrated acceptance

**Passed on 20 November 2026.** The tested revision was `fbb5393c6d5c5c3e347671223acdf9717994081b`, the fetched, reviewed M21A tip. The working tree was clean when the run started. The acceptance branch adds this report to that revision.

| Gate | Verdict | Observation on this revision |
| --- | --- | --- |
| Fresh Windows launcher | **Passed** | The isolated Synthetic Demo opened in Chrome with three presets and 18 validated Records. The separate Normal Dashboard and six REST inventories were empty before configuration. |
| Three approved HTTPS publishers | **Passed** | All three profiles were validated, approved and bound using fresh IDs. Each publisher had a succeeded Worker Job with an accepted Record and independently verified detail bytes. |
| Dashboard and actual MCP stdio | **Passed after a bounded rerun** | The Dashboard and the qualifying MCP Request both used `inflation` and the same two bindings. Each retained a Record from both publishers. The original MCP Request retained only the Welsh Record after a Scottish timeout. Each saved MCP intent replayed once with the original IDs and no additional Jobs. |
| Scoped exports and controlled retry | **Passed** | The live downloads reconciled against paginated REST. Both isolated fixture submissions recorded a 503 on attempt 1 and succeeded on attempt 2 of the same Job. The original fixture and presets were verified after restoration. |
| Persistence and isolation | **Passed** | Normal and Demo each stopped and started through the Windows launcher. All 11 Requests and 17 Jobs survived with matching attribution, Records, detail hashes and exports. Cross-project Request reads returned HTTP 404. |

## Fresh environment and launcher evidence

The host was Windows 11 Pro 25H2 build 26200 (AMD64) with 31.9 GB physical RAM reported by the launcher, 12.1 GB free at the successful Demo start and hardware virtualisation available. Windows PowerShell was 5.1.26100.9818. WSL was 3.0.5.0 with kernel 6.18.58.1. Docker Desktop 4.99.0 used Linux Engine 29.9.3 and Compose 5.7.0. Node 22.18.0, npm 10.9.3, Python 3.13.7 and Chrome 157.0.8103.79 were already installed. The host had npm and pip caches, Docker build cache, and cached images including Python 3.12.14, PostgreSQL 17 and Redis 7.4.8. In each fresh backend project the API and Worker used the same project-specific image, Python 3.12.14, PostgreSQL 17.12, Redis 7.4.8 and Alembic `0010 (head)`.

The new Git worktree had no launcher settings, application state or installed checkout dependencies. The launchers generated separate credentials and identities. Each project created its own PostgreSQL, Redis and Evidence volumes, and Demo also created `demo_state`. The fresh Normal project had zero volumes before Start. This run establishes fresh application setup on a configured host. OS installation and physical 8 GB cold start remain outside this gate.

| Mode | Compose project | Diagnosed Dashboard / API / PostgreSQL | Network |
| --- | --- | --- | --- |
| Normal | `adaptive-web-core-local-ca6affa7ed3a` | `http://127.0.0.1:5217/` / `http://127.0.0.1:58117/api/v1` / `55517` | `10.251.22.0/24` |
| Synthetic Demo | `adaptive-web-core-demo-b273f8603cc5` | `http://127.0.0.1:5199/` / `http://127.0.0.1:58099/api/v1` / `55499` | `10.249.11.0/24` and fixture `10.249.12.0/24` |

The Windows launcher identified itself as 1.0. The initial Demo Start and Normal Setup were invoked concurrently and shared `frontend/node_modules`. Both returned launcher exit 1 with `WEB-001` and npm exit `-4051`. The sequential retry ran `Start-Platform.bat -Demo -OneClickDemo -NonInteractive -NoBrowser` by itself, installed the lockfile and returned 0. `Setup-Platform.bat -NonInteractive` then returned 0 and created Normal settings. Sequential first launches avoid that conflict. Existing projects held the default ports. Demo picked its alternate loopback ports and subnets automatically. After checking ports, Docker networks and Windows routes, the Normal settings used the documented port and subnet fields and enabled `LOCAL_PROFILE_APPROVAL=1`. `Start-Platform.bat -NonInteractive -NoBrowser` and both `Diagnose-Platform.bat -NonInteractive` modes returned 0. Chrome was opened on the diagnosed URLs through Playwright.

Demo diagnostics and Chrome confirmed Fixture Listings `902fda82-3530-4c92-91f7-c3c285a24910` (2 Records), Influencer Advertising and Sponsorship `a48ec212-1b10-49f6-842f-2861a491b079` (8), and Market News and Economic Updates `a8698e5c-ec07-491e-8a29-35b983fb0acb` (8). Normal showed no eligible checkboxes in **New Collection** and returned empty categories, topics, sources, Requests, Jobs and Records. The other 27 running container names and IDs matched before and after the acceptance restarts. [Windows setup](../setup/Windows-One-Click-Setup.md)

## Approved profiles and succeeded publisher Jobs

The trusted Normal API registered each Source pending, PATCHed its authorisation to `approved`, created a draft, and ran Preview and Validate as separate calls. Each validation reported one accepted sample, zero invalid and zero duplicates. Approval used the matching fresh report and configuration hash. A subsequent GET returned the approved immutable version. The operator bound each version to **Economics → UK economic publications**, Topic `2062cd1c-a07c-463f-9a85-d83956bf2401`.

| Publisher | Fresh Source / Profile Version / Binding | Matching historical configuration SHA-256 | Preview / Validate |
| --- | --- | --- | --- |
| Welsh Government | `7db9be45-5d75-476b-a84b-893e3749d4e2` / `4d461da5-f697-4d7c-8ed2-ca86f354b8d4` / `e95e3374-fdc6-412e-9f0e-6b1f1ccffb6d` | `493daad685f4f78ba8db86ea4e3c9cc98b2b71d20baa3ee9de070e61a17cd1c0` | 7.20 / 5.58 s |
| Scottish Fiscal Commission | `210272b6-3339-47a8-bab9-69324934b588` / `9a86c9f9-998d-4ef2-9b8c-aa4304a6e926` / `a5898d72-9a94-4ec7-8b1c-8ebb39b19a57` | `807f724c07a69719ddba687fb7964b83348bbc4720ba9accc9ef2f97ee411bd2` | 8.30 / 8.13 s |
| Economics Observatory | `0c301413-1b43-4048-8a94-e8f7d1bb6d33` / `987cb4c4-7344-4d27-9611-cd1bbf7dc979` / `f5d3ecfc-32ba-4d23-b260-0bcb3e5a92c0` | `35fe2ad718bd1d96b7966a52e666850734df7b571664d3e61ca1a86a15c76ed7` | 11.46 / 6.57 s |

Welsh kept its approved HTTPS search and statement paths. Scottish kept the reviewed single-origin `/` scope with the news-post selector. Both used the two-second per-request timeout. Economics Observatory used the final M18B v3 scope and selector. It kept the four approved detail slugs in root-relative and absolute form and used five seconds per request for that profile alone. All three retained normal robots handling, 2,000 ms origin pacing, a 15-second traversal, three requests, one detail, zero redirects, a 512,000-byte response cap and one execution attempt. The hashes matched without any profile revision during M21B. [M18A policies and configurations](M18A-Public-HTTPS-Source-Validation.md#approved-profiles-and-reproduction) · [M18B final timeout and selector](M18B-Live-Multi-Source-Acceptance.md#timeout-validation-and-final-acceptance-on-20-november-2026-utc)

| Publisher | Succeeded Worker Job and keyword | Accepted Record | HTTP 200 detail Evidence and recomputed SHA-256 |
| --- | --- | --- | --- |
| Welsh Government | `1c34bc32-140f-4dc4-9a0e-a6f29e72114c` · `inflation` | `dd214d1b-8966-5306-a928-0c913d3e8d8c` | `e645ba09-98e8-4849-b85c-f5c869b78c65` · `2c29eee4760fdee1451a471caddf75ab56afa3cbc53b62e02ce35a7f088d70f0` |
| Scottish Fiscal Commission | `afaef5ca-cc61-44ca-84eb-cbe082828f08` · `Supply and demand pressures on public funding` | `eb8a5b80-f2c5-59ed-a66c-63226de02d57` | `d1e1fe69-d92f-4895-9792-87677e34c142` · `3c00b6ac2898dd4ab5bde9f9badb7534ebba2b2f444d0a616d6f416e56f3d626` |
| Economics Observatory | `11a1fcdf-daca-4c53-8779-edb29b596e57` · `Can higher inflation expectations ever stimulate the economy` | `61273185-b7ab-5be1-bc05-892f6d720ad4` | `3118fd0b-8663-40af-a91e-941487834759` · `e1334089b753f159ce2ecadc8bcf32e00d47c7b631191f613642e6e53967d9b9` |

Each succeeded Job above finished on attempt 1 with counts **1 accepted / 0 invalid / 0 duplicate**. Chrome followed the accepted Record to Evidence Metadata. REST Record lineage, Job Detail and Evidence pages linked the same Job, Source, pinned Profile Version and detail Evidence. The MCP SDK returned the same sample lineage and digest. A read-only `sha256sum` on `/data/evidence/<evidence-id-without-hyphens>/input.bin` in the owning Worker verified the original bytes. [Record and Evidence contract](../contracts/M3-job-execution-contract.md)

## Dashboard and MCP comparison

Playwright drove installed Chrome through **New Collection → Review collection → Start topic collection** and observed one HTTP 201 response from the Dashboard. The Python MCP SDK 2.3.0 launched `python -m mcp_access.server` over actual stdio from the checkout, discovered the Topic and eligible bindings, and verified the saved `prepare_collection` submission fields before calling `start_collection`. The test used the SDK directly. The runs were sequential. The two qualifying Requests had different keys and IDs and identical Topic, keyword, binding IDs, profile versions and configuration hashes. MCP `get_collection_status` read the Dashboard Request. Chrome opened the MCP Request and its Job Details, Records and Evidence.

| Field | Dashboard | MCP qualifying rerun |
| --- | --- | --- |
| Request | `519a9d94-4584-4705-bbde-8b772dd2bbf0` | `b602799d-d532-403e-bb27-c7151974b83e` |
| Time (UTC) and parent result | 13:07:22–13:07:36, `partial` | 13:09:28–13:09:41, `partial` |
| Welsh Government Job using the Welsh pin above | `1c34bc32-140f-4dc4-9a0e-a6f29e72114c`, `succeeded`, 1 / 0 / 0 | `8a58fb4f-9539-4de3-b266-c4f42f0af4bc`, `succeeded`, 1 / 0 / 0 |
| Scottish Fiscal Commission Job using the Scottish pin above | `c958a79e-af16-477f-bd88-ff6b89bf46e6`, `partial`, 1 / 0 / 0 | `7c8ddbcc-0449-4841-a6e0-cab55a2ec885`, `partial`, 1 / 0 / 0 |
| Claim owner for all four Jobs | Attempt 1, Worker `5dcdd220-5209-4c97-9053-588a9872a291` | Attempt 1, the same Worker |
| Reconciled exports | 2 CSV and 2 JSON rows | 2 CSV and 2 JSON rows |

Both Scottish `partial` Jobs reported `detail_limit_reached`. Each retained one accepted Record and a successful detail capture before reaching the approved one-detail bound. The original MCP Request `ee8713ab-2f19-47c8-a4e1-da0926cac78a` finished partial when Scottish Job `57e3ef58-ff9d-42c0-b333-c5087eb372e8` timed out after its HTTP 200 search capture and before a detail capture. Welsh Job `a9a7fa03-2f49-4bbc-bb66-2c72089f6842` succeeded with one Record. The first narrow Scottish Request `4462fd68-5660-4e55-a2f9-adb8caa0cbb8` also timed out, with no saved capture. One repeat of that narrow query succeeded as Request `b72d2574-36a3-4adf-bda3-0f7a896461a0`. The MCP pair then passed its Record requirement on one bounded rerun using the original pins. Both timeout outcomes were retained, exported and rechecked after restart.

Each MCP pair saved the full submitted intent and replayed it once with the original key and arguments. The replay returned HTTP 200 `replayed` and the same Request and child Job IDs. The Request/Job inventory was 2/4 immediately before and after the original replay, and 6/9 immediately before and after the rerun replay. Each initial HTTP 201 had added exactly one Request and two Jobs. The paired Records had disjoint IDs. [MCP submission and replay](../setup/Windows-MCP-Access.md#submit-one-topic-collection)

Both downloads came from the actual **Download validated records** buttons. The existing reconciler paginated REST by Request and matched IDs, Source and Job counts, fields, nested payloads and lineage for every export. The qualifying paired requests had one Record from each publisher and zero records from the other Request. Representative hashes below matched before and after restart. [Reconciliation utility](../../backend/experiments/m18b_reconcile.py)

| Qualifying Request | CSV SHA-256 | JSON SHA-256 |
| --- | --- | --- |
| Dashboard | `abdc811098d4ef15b083f0aea84094a96228f02c496f4b07e1c2c2d0e13a694a` | `ffe7395ed7d3b8f963d79fb4444e9a334d0ce7987d249856263f789d8f039067` |
| MCP | `c82031a61b2a7d0ca9b94a97b5cc738b5691d66f9e5daf83f80c3771136414c8` | `4e5af04c1cdc32dda32b6e58845a664cbbdcaa3f2e3e5826f3aef9c0900a4ba2` |

## Controlled 503 and Worker attribution

Demo Cards Version 2 `fdd14e06-fa00-4e58-b0b3-ae8c26262e5a` used the standard configuration with `search.max_attempts=2`. It passed Preview and Validate with `quick`, then was approved and bound to **Transient retry verification** using binding `e23ad0d6-a8cb-4ecf-9f8e-04da94aabab7` and hash `8df405f6541f347686fe63133d4521d71add0886c3ea0623066d6fbd29fcfbff`. A temporary Compose override mounted the repository’s one-shot fixture read-only and changed only the fixture service command. The service was recreated and healthy before each `m18b-retry` submission. Both attempts for both Jobs belonged to Worker `96775eed-f9a0-43f4-9d58-b2aae4f3184f`, as shown in API event history and Chrome Job Details.

| Entry | Request and Job | Claim 1 → 503 retry scheduled (UTC) | Claim 2 → succeeded (UTC) | Accepted Record / detail Evidence |
| --- | --- | --- | --- | --- |
| Dashboard | `f9edec20-e9d5-4887-b5d2-3af8475eca34` / `1fff332e-db38-470b-ae98-ff8700598a27` | 13:07:27.126 → 13:07:28.150 | 13:07:38.169 → 13:07:40.194 | `092834dd-e93b-5da9-a52c-2432a6aa883e` / `38b12303-7f61-4356-b856-4c560411f83d` |
| MCP stdio | `a4f0934f-f429-4772-bc18-34f6dba729a7` / `5568fe4d-cb80-4814-b3b5-6631dc05214b` | 13:07:47.203 → 13:07:48.224 | 13:07:58.243 → 13:08:00.266 | `01f6fcee-367f-5933-8011-26ba471e4c99` / `298800ce-7262-4a71-834f-ecfac20e9fe5` |

Both histories were `JOB_CREATED`, `DISPATCHED`, `CLAIMED`, `RETRY_SCHEDULED` (`http_error`, HTTP 503), `DISPATCHED`, `CLAIMED`, `SUCCEEDED`. Each Job published one Record and exactly two HTTP 200 captures (search and detail), with zero invalid, zero duplicate and no published 503 capture. Each CSV and JSON reconciled to the one published Record. The two detail files each hashed to `bbf25a9c35ea154e2e3b856679194ca5f37849345dbfafe2906e46edeac9b898`. The standard `backend.tests.m3_fixture_site` command was restored, and Diagnose and Chrome verified the same three preset Requests and 18 Records again. This exercise reused the same Worker for a normal retry. M20 separately exercised Worker interruption and a different Worker taking the next claim. [One-shot fixture](../../backend/tests/m18b_retry_fixture.py) · [M20 recovery](M20-Worker-Attempt-Identity.md)

## Stop, start and persistence

After all Requests reached terminal status, the local manifests captured full Request and Job Detail, ordered Events, Record and Evidence metadata, stored-byte digests and reconciled export digests. The supported `Stop-Platform.bat` and `Start-Platform.bat` commands, then `Diagnose-Platform.bat`, returned 0 for Normal and for `-Demo`. Stop left no running containers or listening ports for each target project. Docker volume names and creation timestamps were identical after Start. Each project logged a new Worker ID while the existing Job claims and Events kept the original Worker ID. A fresh MCP stdio client in each project reread status, Records, sample lineage and Evidence. The browser reopened the same Requests and redownloaded both formats.

| Project | Compared before and after | Original Worker → restarted Worker | Matching local manifest SHA-256 |
| --- | --- | --- | --- |
| Normal | 6 Requests, 9 Jobs, 7 Records and detail hashes, 12 exports | `5dcdd220-5209-4c97-9053-588a9872a291` → `934a1f80-5e57-4c0e-9352-b75059735b9a` | `1729baedc6b3949c1bf7ef4dd2efb9da1114acc57043d0ed3603802170e68ac7` |
| Synthetic Demo | 5 Requests, 8 Jobs, 20 Records and detail hashes, 10 exports | `96775eed-f9a0-43f4-9d58-b2aae4f3184f` → `ca3e0046-deed-4dab-a8f5-148ccaa7783f` | `cd0064d409b38513998431e4b528a37621328f8c4f7e3b7b01a7dd10255bfbbf` |

All REST snapshots, recomputed detail digests, export reconciliations and MCP snapshots matched. Each project listed its own Requests and returned 404 for every Request ID from the other. Launcher logs, private settings, browser screenshots, request submissions, local manifests, downloads and publisher captures stayed local.

## Teammate walkthrough

1. Use a fresh Windows checkout of the tested SHA. Check Docker, ports and routes. Set `$env:PLATFORM_NO_PAUSE='1'` for unattended runs. Start Demo with `Start-Platform.bat -Demo -OneClickDemo -NonInteractive -NoBrowser`, then `Diagnose-Platform.bat -Demo -NonInteractive`. Open the diagnosed Dashboard in Chrome and verify the three presets and 18 Records. Complete initial dependency installation before launching the other mode.
2. Run `Setup-Platform.bat -NonInteractive`. Keep the new private launcher identity and credentials. If needed use the documented unused loopback ports and private subnet. Set `LOCAL_PROFILE_APPROVAL=1` on a trusted local account. Run `Start-Platform.bat -NonInteractive -NoBrowser` and `Diagnose-Platform.bat -NonInteractive`. Verify the empty New Collection view and REST inventory before adding anything. [Launcher settings](../setup/Windows-One-Click-Setup.md#settings-data-and-the-controlled-demo)
3. Recreate the three Source policies and approve the fresh drafts using the linked M18A and final M18B configurations. Bind all three to the Topic. Submit `inflation` with just Welsh and Scottish through the Dashboard and wait for a terminal result. In a separately installed MCP environment, point `FYP_MCP_API_BASE` at the diagnosed Normal API. Discover the same two bindings, save the complete `prepare_collection` submission, call `start_collection`, and replay those exact arguments once. Use `get_collection_status` to read both Requests across entry points. Run the exact-title searches when a publisher still needs a succeeded Job. [Windows MCP setup](../setup/Windows-MCP-Access.md)
4. In each terminal Request, follow an accepted Record to its detail Evidence and download CSV and JSON. Run `python -m backend.experiments.m18b_reconcile --port <api-port> <request-id> <download.csv> <download.json>` and confirm that no foreign Record IDs are present. Use `docker exec <project>-worker-1 sha256sum /data/evidence/<evidence-id-without-hyphens>/input.bin` to compare the stored bytes with Evidence Metadata.
5. Follow the M18B retry reproduction in the isolated Demo. Reset the fault-only fixture before each identical `m18b-retry` submission and restore the normal fixture afterward. Compare the two attempt traces and both download pairs. Save the terminal manifest locally. Stop and Start each project with its saved settings, reconnect MCP, reopen the same Requests, and compare Events, Records, export bytes and capture digests. [Fixture override and reset](M18B-Live-Multi-Source-Acceptance.md#reproduction-and-review)

## Supporting checks

- In the fresh MCP virtual environment, `python -m pip check` found no broken requirements and `python -m pytest -q mcp_access/tests` passed 14 tests in 10.52 seconds.
- In the Normal backend image with external networking disabled and the checkout mounted read-only, `python -m pytest -q -p no:cacheprovider backend/tests/test_m18b_reconcile.py backend/tests/test_m18b_retry_fixture.py` passed 9 tests in 1.96 seconds.
- `npm.cmd run build --prefix frontend` passed TypeScript and the production Vite build. `git diff --check` passed. This branch changes only the acceptance report.

M21A hosted PR verification is tracked separately. The reliability benchmarks, 1/2/4-Worker comparison and physical 8 GB cold-start certification remain with M21C.
