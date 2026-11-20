# M18B live multi-source acceptance

**Current verdict: PARTIAL.** Two of three independent publishers have verified successful Worker Jobs. The CSV reconciliation fix passed. [Closure evaluation on 20 November 2026](#closure-on-20-november-2026-utc)

Evaluation on **20 November 2026 (UTC)** from reviewed baseline `7b16e1a80b136067bf8e8897fb96617900009274`. **Overall PARTIAL.** Two of three real publishers met the full Worker success gate. The shared-topic MCP Request, Dashboard exports and controlled Worker retry comparison passed.

| Acceptance gate | Verdict | Direct evidence |
| --- | --- | --- |
| 1. Three independent real publishers with successful Worker Jobs and verified detail Evidence | **PARTIAL** | Welsh Government and Scottish Fiscal Commission each reached `succeeded` with a verified publication. The new Economics Observatory Job timed out. Its retained M18A detail trace still verifies. |
| 2. Real shared-topic MCP Request with accepted records from at least two origins | **PASS** | Stdio MCP created one `inflation` Request with two distinct pinned Jobs and two accepted Records from two origins. The parent was `partial` because the Scottish child reached the detail limit. |
| 3. Dashboard access and request-scoped CSV and JSON reconciliation | **PASS** | Both live Requests opened in the Dashboard and each downloaded file reconciled to two paginated REST Records, one per source and Job. |
| 4. Comparable controlled Worker retry through Dashboard and MCP | **PASS** | Both entry points produced one Job that received HTTP 503 on attempt 1, retried on the same Job and succeeded on attempt 2. Both pairs of fixture downloads reconciled. |

## Environments and approved inputs

Fetched the branch and verified that local and remote heads matched the M18A baseline before submitting. Normal and Synthetic Demo ran on Windows 11 build 26200 with separate PostgreSQL, Redis, dispatcher, Celery and Evidence volumes. The Normal API and Worker used the same baseline image. The test-only retry handler was mounted solely into the new Demo fixture container and then removed by restoring the normal fixture service.

| Environment | Launcher diagnostics | Dashboard | REST and MCP API base |
| --- | --- | --- | --- |
| Windows Normal · real publishers | `.\Diagnose-Platform.bat -NonInteractive` | `http://127.0.0.1:5197/` | `http://127.0.0.1:58097/api/v1` |
| Isolated Synthetic Demo · controlled retry | `.\Start-Platform.bat -Demo -OneClickDemo -NonInteractive -NoBrowser` and `.\Diagnose-Platform.bat -Demo -NonInteractive` | `http://127.0.0.1:5198/` | `http://127.0.0.1:58098/api/v1` |

The trusted Normal REST workflow created Category **Economics** `ebdea550-12e2-4ca2-8849-11fe4db3e5eb` and Topic **UK economic publications** `8637186a-2dda-4593-8ed0-04e19958edd1`, then approved the three eligible bindings. Stdio discovery against the Normal API returned the same Topic, Source and Profile Version IDs. The approved configurations, Source policies and two-second minimum request interval are from [M18A](M18A-Public-HTTPS-Source-Validation.md). All three kept the 2-second per-request DNS plus transfer limit, 15-second traversal deadline, three-request cap, zero redirects, one detail and one Worker attempt.

| Publisher and approved origin | Source ID | Immutable Profile Version and configuration SHA-256 | Topic binding ID |
| --- | --- | --- | --- |
| Welsh Government · `https://www.gov.wales` | `bdcfcc2a-18b0-478c-a27b-b1eca17625f4` | `416c007b-3099-4e97-9f9a-b557f3d89ae3` · `493daad685f4f78ba8db86ea4e3c9cc98b2b71d20baa3ee9de070e61a17cd1c0` | `fe86d658-eed1-403e-83b1-072509e500bc` |
| Scottish Fiscal Commission · `https://fiscalcommission.scot` | `5b8c960a-2e19-46ee-9ec3-13bb26705abd` | `566c575e-24a8-4258-a9bf-719b472de06e` · `807f724c07a69719ddba687fb7964b83348bbc4720ba9accc9ef2f97ee411bd2` | `7a002f83-f274-4b8c-a196-970e2109fe5c` |
| Economics Observatory · `https://www.economicsobservatory.com` | `3ac6a0c7-57cd-4ca2-b815-9f000fafe620` | `3d65cca7-9854-4903-a217-d1adb6cd3e97` · `2fb6d6d804bd5a473bbac5aa4a4fcadbde5f380377aa842e48680f2c3f27b0c5` | `eb9a9f08-3392-40c8-bceb-8f085c1a43cb` |

The preflight used the existing approved profiles and Core traversal in the API container. Welsh Government's bare `/search?globalkeywords=inflation` returned exactly one matched detail link under its statement allowlist. The Scottish Fiscal Commission search diagnostic timed out before selecting a link. The approved root scope and same-origin news-post selector were reviewed. Its later Worker Jobs reached the expected publication. The Economics Observatory diagnostic timed out at robots, so live result ordering could not be rechecked. The M18A ordering and allowlist stayed pinned.

## Real Requests and Worker results

The Python MCP SDK used `StdioServerParameters` to launch `python -m mcp_access.server` with `FYP_MCP_API_BASE=http://127.0.0.1:58097/api/v1`. It discovered nine tools, called `list_topics` and `list_topic_sources`, and saved the complete `prepare_collection` submission before calling `start_collection`. The first receipt was HTTP 201, `created`, `pending`, with key `9e09f956-c259-4834-af13-64506476e593`. Status was polled with a 78-second deadline. The Dashboard submission used **New Collection**, reviewed the same two bindings, then sent one HTTP 201 POST with fresh key `d970d269-f3c9-4dac-9f40-096272163ec0`. The Requests ran sequentially. REST receipts and MCP status confirmed the same Topic, exact keyword, Source, version and configuration hash for both Requests. [MCP workflow](../setup/Windows-MCP-Access.md) · [Topic contract](../contracts/M8-data-identity-collection-management.md)

| Entry point | Request ID | Exact keyword | Parent status | Created → finished (UTC) |
| --- | --- | --- | --- | --- |
| Normal MCP pair | `7c8ce197-f7eb-425d-9215-8982a61dc3ab` | `inflation` | `partial` | 10:31:13.028 → 10:31:27.868 |
| Normal Dashboard pair | `3c86c815-26d1-4055-97ae-accac8f37ea8` | `inflation` | `partial` | 10:32:55.129 → 10:33:08.974 |
| Normal MCP · third origin | `654c5a37-9e80-4ce8-8181-73f2dab2977d` | `Can higher inflation expectations ever stimulate the economy` | `failed` | 10:34:41.655 → 10:34:43.785 |
| Normal MCP · narrower Scottish follow-up | `c799a827-038a-4b3c-aaa3-f1909f157141` | `Supply and demand pressures on public funding` | `succeeded` | 10:34:48.043 → 10:34:57.042 |

| Request | Publisher | Worker Job ID | Started → finished (UTC) | Terminal status and error | Attempts | Accepted / invalid / duplicate | Captures |
| --- | --- | --- | --- | --- | ---: | --- | ---: |
| MCP pair | Scottish Fiscal Commission | `6bf5b641-1074-4be7-8e30-8e63427ad451` | 10:31:13.139 → 10:31:21.229 | `partial`, `detail_limit_reached` | 1 | 1 / 0 / 0 | 2 |
| MCP pair | Welsh Government | `a5d31ac4-35d5-463a-af64-37a733b29fb4` | 10:31:21.240 → 10:31:27.868 | `succeeded` | 1 | 1 / 0 / 0 | 2 |
| Dashboard pair | Scottish Fiscal Commission | `10e4bae1-2d47-465f-9f14-db624f2de582` | 10:32:55.435 → 10:33:03.443 | `partial`, `detail_limit_reached` | 1 | 1 / 0 / 0 | 2 |
| Dashboard pair | Welsh Government | `e7b89760-d2a1-485a-8f2e-bd6593b42636` | 10:33:03.449 → 10:33:08.974 | `succeeded` | 1 | 1 / 0 / 0 | 2 |
| Third origin | Economics Observatory | `b7e66621-64fd-4879-89e6-aec74ad59c5e` | 10:34:41.770 → 10:34:43.785 | `failed`, `timeout` | 1 | 0 / 0 / 0 | 0 |
| Narrower Scottish | Scottish Fiscal Commission | `463e4eb1-d227-4b17-bdc4-1122468e2348` | 10:34:48.794 → 10:34:57.042 | `succeeded` | 1 | 1 / 0 / 0 | 2 |

| Publisher | M18B succeeded | M18B partial | M18B failed | Accepted in M18B | Formal origin success |
| --- | ---: | ---: | ---: | ---: | --- |
| Welsh Government | 2 | 0 | 0 | 2 | Yes |
| Scottish Fiscal Commission | 1 | 2 | 0 | 3 | Yes |
| Economics Observatory | 0 | 0 | 1 | 0 | No |
| Total live M18B | 3 | 2 | 1 | 5 | **2 of 3 publishers** |

Historical M18A remains separate with three live profile validations, zero succeeded Jobs, one partial and two failed. The two controlled retry Jobs and the standard Demo presets are also excluded from the live counts.

The Economics Observatory Job's terminal error omitted the URL. It ended in roughly two seconds with no published capture. A separate same-Worker pinned transport probe timed out on robots after 1.936 seconds of transfer with zero bytes. The Windows host later got HTTP 200 in 1.952 seconds, but the same Worker still timed out after 2.006 seconds on the subsequent Core robots diagnostic. Search and detail were unreached in that diagnostic. There was no publisher denial. Submit one narrow Request again after the approved robots route and one eligible detail link can be confirmed from the Worker within the existing budgets. If result order actually changes, validate and approve a new immutable profile and binding through the operator workflow. No public fault was induced.

## Record-to-detail-Evidence verification

The Normal Dashboard opened the exact MCP Request and the UI Request. Each retained Record was followed from **Child jobs**, through the accepted Record and **Provenance and identifiers**, to **View capture evidence**. The Dashboard displayed the **Detail page** type, evidence identifier and stored digest. MCP `get_collection_records`, `get_record_lineage`, and `get_evidence_metadata` agreed with independent REST reads. REST furnished the full fetched location. The Dashboard displays its origin and path and omits query parameters. Each detail was page 2 with HTTP 200. A read-only `sha256sum /data/evidence/<evidence-uuid-without-hyphens>/input.bin` in the appropriate Worker independently matched each stored digest below.

The Job and Request IDs map to the run tables above. Source, version and configuration hash are the pinned values from the approval table. There is no parent Request for the standalone historical Economics Observatory Job `afc943ad-c1cc-401b-9c97-0e1b8fe28835`, which was reopened and reverified through Dashboard, MCP, REST and stored bytes during M18B.

| Request or historical run | Publisher | Record ID | Detail Evidence ID | Recomputed original-byte SHA-256 |
| --- | --- | --- | --- | --- |
| MCP pair | Scottish Fiscal Commission | `0787b228-b462-5e65-bd07-668ba5aed721` | `c5c52b26-8907-4f0e-95c9-9964a8d84aa0` | `6a567039c0df72aec01547c02111e654e7407a00fdb5af5e60ece5e92db5216d` |
| MCP pair | Welsh Government | `ff48d279-6df9-5e51-94f6-40cdec09f89d` | `5eaad603-057d-4243-9d93-abca9ba93de2` | `9c7eec62918df473da717efe42b0a1631778e14437fa950ddf4a14719db03d71` |
| Dashboard pair | Scottish Fiscal Commission | `02cfed78-2c2f-5df1-8904-516a29c350c9` | `1af0e7ef-2951-407c-a94d-745549fe06dd` | `9eb640fcdc485562f1a24ef0d209a3d05c50c9aa309290cc60d6981b9503f414` |
| Dashboard pair | Welsh Government | `483560c6-3361-5f0a-a363-04758038b19f` | `21376e1b-6c2e-4ed2-ae42-ada9caaf8c94` | `9c7eec62918df473da717efe42b0a1631778e14437fa950ddf4a14719db03d71` |
| Narrower Scottish | Scottish Fiscal Commission | `dc21817f-77d9-568c-8e0d-3d4e1f30206a` | `11a6e141-99d5-42fb-ae75-93621c3e8299` | `7bff28ab295277d405d4798cd83b7588f63cb8f28af2ff0978c8cbf0593d2fd8` |
| Historical M18A pilot | Economics Observatory | `a6c66510-5c05-5e8b-aec8-dfa9c7d151e7` | `4b76bfdc-a0be-42e4-b811-d2fcc53b52a1` | `d1ab295228e5ab878a2d251d6c8fdcd4890f44cfde445e291aac78d2d478a9f7` |

- The Welsh Record title is **Written Statement: The implications of the UK Autumn Budget** by Elin Jones. Fetched and canonical URLs match. Credit Welsh Government and its Open Government Licence for covered content. [Publication](https://www.gov.wales/written-statement-implications-uk-autumn-budget) · [Copyright](https://www.gov.wales/copyright-statement)
- The Scottish Record title is **Supply and demand pressures on public funding**, Professor Graeme Roy, Scottish Fiscal Commission. All three Records extracted the same clean canonical URL. REST returned the fetched links with the publisher's public `_rt` and `_rt_nonce` parameters. Credit the Commission and Crown copyright under the Open Government Licence for covered content. [Canonical publication](https://fiscalcommission.scot/supply-and-demand-pressures-on-public-funding/) · [Publication scheme](https://fiscalcommission.scot/our-work/governance/foi-eir-data-protection-publication-scheme-and-privacy-notice/)
- The historical Record title is **Can higher inflation expectations ever stimulate the economy?** by Stefano Fasani and Lorenza Rossi. Fetched and canonical URLs match. Credit the authors and Economics Observatory under CC BY-SA 4.0. [Publication](https://www.economicsobservatory.com/can-higher-inflation-expectations-ever-stimulate-the-economy) · [Reuse policy](https://www.economicsobservatory.com/about)

| Scottish Fiscal Commission run | Fetched detail URL from REST |
| --- | --- |
| MCP pair | `https://fiscalcommission.scot/supply-and-demand-pressures-on-public-funding/?_rt=MXwxfGluZmxhdGlvbnwxNzk1MTcwNjc4&_rt_nonce=ba7c9bbe6574d74da15df2137bf5b3b555afa9a15316429739bed63d4fc4332d` |
| Dashboard pair | `https://fiscalcommission.scot/supply-and-demand-pressures-on-public-funding/?_rt=MXwxfGluZmxhdGlvbnwxNzk1MTcwNzgw&_rt_nonce=0088a6331ffd836a326f9532b02f3a0f1bb7f8c916e4974f02ecd589c4ac676e` |
| Narrower Scottish | `https://fiscalcommission.scot/supply-and-demand-pressures-on-public-funding/?_rt=MXwxfHN1cHBseSBhbmQgZGVtYW5kIHByZXNzdXJlcyBvbiBwdWJsaWMgZnVuZGluZ3wxNzk1MTcwODk0&_rt_nonce=11d8646108c090b70849de0bb0b3d554d8534636cf5683f9e5968d0589b2f161` |

## Download reconciliation and entry-point comparison

Playwright-controlled Chrome used the two **Download validated records** buttons on each Request Detail and saved the actual browser downloads locally. The [reconciler](../../backend/experiments/m18b_reconcile.py) used standard CSV and JSON parsers and fetched the REST reference at `GET /records?request_id=<id>&limit=1&offset=<offset>` until the first empty page. It checked Record ID multisets, counts by Job and Source, and Job-scoped lineage. Every observed field matched under the existing representation, including nested payload, position and provenance decoded from CSV cells. Request membership was checked against its child Jobs and REST lineage. The export columns follow the Record schema.

| Dashboard download scope | REST / CSV / JSON rows | Rows in each file by Source and Job | CSV SHA-256 | JSON SHA-256 |
| --- | --- | --- | --- | --- |
| Normal MCP pair | 2 / 2 / 2 | Scottish `6bf5b641…` 1, Welsh `a5d31ac4…` 1 | `213da79bb04752c6bdaceeefb232f8a743639fd0a2ebb9b717ea53df5bc19c9a` | `ca5387132b8b2231d954e7e5072f892f6e72d002901a8c9dfd249e7a91bbc83a` |
| Normal Dashboard pair | 2 / 2 / 2 | Scottish `10e4bae1…` 1, Welsh `e7b89760…` 1 | `43b3968297cbf151b2eb9a50bbfcd028adf1e9a15561d4d993bfd6fdbf5ff96c` | `63d47a3e4b2e67a0cfb165c7e7b4564278edaf860c3a328a16efeb46c5c9e820` |
| Narrower Scottish | 1 / 1 / 1 | Scottish `463e4eb1…` 1 | `2c592373422934b5989f8426898c31331e8e9c188bd5786da8fe6b8c6febcfc4` | `43ecb7f79ae63342e5699783fc6301cdab2db43967a0d835ec4031d7b2766455` |
| Fixture MCP | 1 / 1 / 1 | Demo Cards `d5c5159a…` 1 | `2236ffaa47f72ee540fa3fe31083ac5d48591287cff97c71ab0268f3462beabb` | `cd40a962aa1ff8c00a47236435a4b8a44414f97c1c9c27666b4df91652892fb7` |
| Fixture Dashboard | 1 / 1 / 1 | Demo Cards `1947c18d…` 1 | `e09b6d173ac55f53123a04a9270c593955358b7651873fa930094600aef73170` | `8ee457f3a252f8cb73f85f40e70cf091e1c523ce65dfb0ee0599bd93c2bd1672` |

Every file had **zero missing, extra or repeated IDs and zero field discrepancies**. A separate negative check on a local copy removed one row, repeated another and changed its title. The verifier reported all four differences and returned exit 1.

Across the real MCP and Dashboard Requests, the `(source_id, publication_url)` sets and payload fields matched. Both produced one Welsh `succeeded` child and one Scottish `partial` child. The Record, Job, Evidence and Request IDs were distinct. The Welsh captured bytes matched across Requests. The Scottish fetched tracking parameters and raw capture digests differed, while the parsed title, canonical URL and date matched. The pinned profiles produce generic Records and neither Request projected Article History. Those observations explain the substantive match across independent submissions with different export digests.

## Controlled Worker retry parity

The isolated Demo used existing **Demo Cards** Source `6fec6cf3-1e76-4b37-9e95-b1224c3e6c24`, Topic `3ea76a5c-c119-4466-bc05-c728c357f61c`, binding `8b2ec2cf-f20f-4b5f-b5f4-c07bf583b92a`, and approved version 2 `f0ff217e-9cf5-4448-a202-49df2e7b999d` with config SHA-256 `8df405f6541f347686fe63133d4521d71add0886c3ea0623066d6fbd29fcfbff`. Version 2 reused the normal Cards selectors, changed `search.max_attempts` to 2 and passed Validate with `quick` before approval. Both requests used exactly `m18b-retry`. An opt-in [test-only handler](../../backend/tests/m18b_retry_fixture.py) served HTTP 503 on the first matching search and the ordinary one-result Cards response thereafter. Between runs only the fixture container restarted. PostgreSQL, Redis, API, dispatcher, Worker and published data were preserved.

| Entry point | Request ID and Job ID | Attempt 1 claim → retry event (UTC) | Scheduled retry → attempt 2 claim (UTC) | Terminal result (UTC) |
| --- | --- | --- | --- | --- |
| Real MCP stdio | `c075100b-3dc4-4930-b56d-8e5f245a7b8e` · `d5c5159a-3b04-4f8f-bd81-8a04790bb32b` | 10:36:26.084 → 10:36:27.113 `RETRY_SCHEDULED`, `http_error` 503 | 10:36:37.115 → 10:36:37.124 | `succeeded` at 10:36:39.154, 1 / 0 / 0, two captures |
| Dashboard New Collection | `a1407e5b-3f0b-44ed-912e-cdc173426190` · `1947c18d-d524-4be5-8824-2e7a8a411894` | 10:38:23.433 → 10:38:24.450 `RETRY_SCHEDULED`, `http_error` 503 | 10:38:34.452 → 10:38:34.470 | `succeeded` at 10:38:36.500, 1 / 0 / 0, two captures |

Each Job was dispatched and claimed twice under the original Job ID. At pending retry the Request exposed zero Records and zero published Evidence. Both terminal captures shared the attempt 2 run ID and were dated after its claim. The Alpha payload matched and both observations belong to Article `75287c72-cff9-4827-8494-f68786fea550`. MCP produced Record `82110d34-d788-5186-8664-9a4026312e82` and Evidence `d9ee4674-8cd3-42e1-b9bf-af27100252fd`. Dashboard produced Record `0807f10a-cf69-5107-a959-387d1a25bd9c` and Evidence `82cf7818-1483-4b7c-b9c3-7cef934c4554`. Both detail captures recorded HTTP 200 at `http://collection-fixture:8001/m7/cards/detail/alpha` and independently rehashed to `bbf25a9c35ea154e2e3b856679194ca5f37849345dbfafe2906e46edeac9b898`. The actual fixture downloads reconcile above. Restoring the standard fixture handler left all three original Demo presets healthy in launcher diagnostics.

## Reproduction and review

1. Use the actual ports from launcher diagnostics. Verify the three M18A versions and explicitly approve bindings to the active Topic. Set `FYP_MCP_API_BASE` to Normal, discover binding IDs over stdio, and use the Windows MCP guide to prepare, save and start the exact `inflation` pair. Poll `get_collection_status`. If submission is unconfirmed, retry the saved key with the same intent. Submit the matching pair once through New Collection after the first Request ends.
2. On each Request Detail use both download buttons. For each accepted Record follow its detail Evidence and compare the MCP metadata and REST `GET /records/{id}?include_lineage=true`, `GET /evidence/{id}`, and ordered `/collection-jobs/{id}/evidence-pages`. Use read-only `sha256sum` on the named Worker's mounted Evidence. Run `python -m backend.experiments.m18b_reconcile --port 58097 <request-id> <download.csv> <download.json>` with the Normal files. Use the Demo API port for fixture files.
3. Start a separate Synthetic Demo and reuse its Compose project and environment file. Add a local Compose override for `collection-fixture` with command `[python, -m, backend.tests.m18b_retry_fixture]` and a read-only mount of that module at `/app/backend/tests/m18b_retry_fixture.py`. Recreate only that service with `up -d --no-deps --no-build --wait collection-fixture`. Approve the Cards draft after setting `search.max_attempts=2` and validating `quick`. Bind it to a fresh test Topic and submit `m18b-retry` through MCP using the Demo base. After success, restart only the fixture container to reset its one-shot fault, then submit the same selection in the Dashboard. Retain both Jobs' events and download and reconcile both Requests. Restore the standard fixture by recreating that service with the launcher Compose files and no override.

Current verification ran `python -m pip check` and `python -m pytest -q -p no:cacheprovider mcp_access/tests` in the existing dedicated MCP environment. **14 passed** and requirements were consistent. The focused host fixture test passed. A disposable internal Compose project with PostgreSQL 17 and Redis 7.4 ran `backend/tests/test_m18b_retry_fixture.py` and M2 `test_m3_retry.py`, `test_m7_results.py`, `test_m8_collections.py`, and `test_m9_record_export.py` with `python -m pytest -q -rs -p no:cacheprovider`. **33 passed**. Full external pages, downloads, intent snapshots and credentials stayed out of Git.

No shared collection contract change was needed to verify the two successful publishers or retry parity. The open acceptance gap is an Economics Observatory Worker success with fresh detail Evidence under the approved transport budget.

## Closure on 20 November 2026 (UTC)

Fetched the feature branch and verified that local and remote heads both matched the reviewed closure baseline `d35e197b60b699714a10d473803c24324fdb47b9`. Launcher diagnostics confirmed the existing Windows Normal Dashboard at `http://127.0.0.1:5197/` and API at `http://127.0.0.1:58097/api/v1`. The running API and Worker shared local image `sha256:f2d7301d8be5fac49087a63f53ee284ea1e5582976c4e49745bfcd5b04c1102c`. The Worker's evidence volume was `adaptive-web-core-local-61e8e50ea0c3_evidence_data` at `/data/evidence`.

| Acceptance gate | Closure verdict | Current evidence |
| --- | --- | --- |
| 1. Three independent publishers with successful Worker Jobs and verified detail Evidence | **PARTIAL** | Welsh Government and Scottish Fiscal Commission meet the gate. Economics Observatory timed out at search in the Worker diagnostic. Three substitute screens also stopped before a passing qualification. |
| 2. Shared-topic MCP Request with accepted Records from two origins | **PASS** | The original `inflation` MCP Request remains `partial` with one accepted Record per origin. Its scoped REST records replayed successfully. |
| 3. Dashboard access and scoped CSV/JSON reconciliation | **PASS** | The saved Dashboard downloads for the original MCP and Dashboard Requests each reconciled to two live REST rows with the corrected verifier. |
| 4. Comparable Worker retry through Dashboard and MCP | **PASS** | The original Demo Jobs each succeeded on attempt 2 after HTTP 503. Both saved export pairs reconciled against the Demo REST API. |
| CSV reconciliation correction | **PASS** | The regression reproduced the false positive on `-123`. The corrected verifier accepted the production CSV spelling and detected missing protection, changed values, extra apostrophes and ID discrepancies. |

### Third-publisher check

The Normal REST reads confirmed active Topic `8637186a-2dda-4593-8ed0-04e19958edd1`, authorised Economics Observatory Source `3ac6a0c7-57cd-4ca2-b815-9f000fafe620` and eligible binding `eb9a9f08-3392-40c8-bceb-8f085c1a43cb` pinned to approved version `3d65cca7-9854-4903-a217-d1adb6cd3e97` with SHA-256 `2fb6d6d804bd5a473bbac5aa4a4fcadbde5f380377aa842e48680f2c3f27b0c5`.

At 10:57:24.569 UTC one diagnostic ran in the Normal Worker container against exactly `Can higher inflation expectations ever stimulate the economy`. It loaded the authorised Source and approved snapshot from PostgreSQL and used Core `SearchTraversal.documents`, the shared Redis origin limiter, and the same robots, destination and transfer checks as a Job. The two-second combined DNS/transfer cap, two-second minimum origin interval, 15-second traversal deadline, three-request budget, one-detail limit, zero redirects and one attempt were all confirmed.

| Stage | Actual outcome | Measured elapsed |
| --- | --- | ---: |
| Canonical `/robots.txt` | HTTP 200, 1,248 bytes, policy accepted | 1.900 s |
| `/search?keyword=Can+higher+inflation+expectations+ever+stimulate+the+economy` | Core `timeout`, no HTTP status, after robots allowed the route | 4.006 s including origin pacing |
| Detail and extraction | Unreached, zero candidates | — |
| Total | Stopped at the search error | 5.907 s |

The earlier M18B Job `b7e66621-64fd-4879-89e6-aec74ad59c5e` still reports `failed/timeout` with zero accepted Records. The historical M18A Job `afc943ad-c1cc-401b-9c97-0e1b8fe28835` remains a partial pilot. A separate read-only REST and Worker-volume check at 11:01:44 UTC linked Record `a6c66510-5c05-5e8b-aec8-dfa9c7d151e7` to its HTTP 200 detail Evidence `4b76bfdc-a0be-42e4-b811-d2fcc53b52a1`. The stored bytes independently hashed to `d1ab295228e5ab878a2d251d6c8fdcd4890f44cfde445e291aac78d2d478a9f7`.

The substitution screens reused prior M18A research. Each stayed within the existing budgets and stopped at its first error.

| Candidate and route | Closure observation |
| --- | --- |
| Resolution Foundation, an independent think tank. Existing authorised origin with root search `/?s=…` and `/publications/` detail selector. Credit the Foundation and authors under CC BY-NC-ND 4.0 for covered work. [Independence](https://www.resolutionfoundation.org/about-us/mission/) · [Copyright](https://www.resolutionfoundation.org/privacy/copyright/) | Normal API Preview at 10:58:58.339 UTC, Draft `fc8a48b5-9734-46bd-904a-e7aba69ed5c1` revision 2, keyword `What a ratchet!`. HTTP 400 `timeout` after 5.140 s. The error omitted the failing stage. |
| LSE Business Review, the London School of Economics publishing unit. Existing authorised origin with direct `/search/?swps=…` and scoped `/businessreview/` detail links. Credit the author, original article and licence for covered CC BY 4.0 articles. [Terms](https://blogs.lse.ac.uk/terms-of-use/) · [Republishing policy](https://blogs.lse.ac.uk/republishing-policy/) | Normal API Preview at 10:59:29.452 UTC, Draft `00dffb13-7f25-4a9f-b032-46f17671ac15` revision 1, keyword `Does raising public sector pay above inflation risk further inflation`. HTTP 400 `timeout` after 4.604 s. The error omitted the failing stage. |
| Bank for International Settlements, a separate international organisation. Proposed bare `/search?keywords=…` and `/publications/` working-paper detail scope. Covered material is available for non-commercial download, with BIS attribution and an original link for excerpts. [Terms](https://www.bis.org/about/terms-conditions) · [Robots](https://www.bis.org/robots.txt) · [Relevant working paper](https://www.bis.org/publications/working-paper-1082-public-debt-and-household-inflation-expectations) | Worker screening at 11:01:12.913 UTC, keyword `Public debt and household inflation expectations`. Robots returned HTTP 200 in 0.911 s and permitted the published bare search route. Search timed out after 4.005 s including pacing. Detail eligibility was unresolved and no Source was registered. |

No fresh Request was submitted because none of the closure searches established an eligible third-publisher sample. The existing two drafts remain unapproved. The counts below exclude the historical M18A pilot, diagnostics and Demo fixture Jobs.

| Publisher | Reviewed M18B Jobs (succeeded / partial / failed) | Closure Jobs (succeeded / partial / failed) | Cumulative accepted Records | Formal origin result |
| --- | ---: | ---: | ---: | --- |
| Welsh Government | 2 / 0 / 0 | 0 / 0 / 0 | 2 | **PASS** |
| Scottish Fiscal Commission | 1 / 2 / 0 | 0 / 0 / 0 | 3 | **PASS** |
| Economics Observatory | 0 / 0 / 1 | 0 / 0 / 0 | 0 | **BLOCKED** at the Worker search stage |
| Total | **3 / 2 / 1** | **0 / 0 / 0** | **5** | **2 of 3** |

### CSV verifier and export replay

The original verifier parsed the CSV cell `'-123` and compared it with the raw REST `source_record_key` of `-123`. It reported a field difference for an intact export. The exporter and verifier now share the same [text protection rule](../../backend/core/csv_export.py). The verifier applies that rule to the REST string before comparison. A legitimate leading apostrophe stays in place, nulls compare to empty cells, and nested objects are still parsed and compared structurally. Production CSV and JSON serialization retain their existing representation.

The [offline regression tests](../../backend/tests/test_m18b_reconcile.py) generated actual production CSV and JSON, parsed both, and asserted the expected apostrophes independently. They also checked missing protection, an altered string, extra apostrophes, a changed nested value and missing, extra and repeated Record IDs. A separate offline comparison loaded the reviewed implementations from Git and reproduced the false positive with the actual serialized CSV. Representative export bytes matched the reviewed implementation in both formats. From the checked-out backend mounted read-only in a disposable internal Compose environment with PostgreSQL 17 and Redis 7.4, `python -m pytest -q -rs -p no:cacheprovider backend/tests/test_m18b_reconcile.py backend/tests/m2/test_m9_record_export.py` returned **12 passed in 4.99 s**.

Replayed all five saved Dashboard download pairs with `python -m backend.experiments.m18b_reconcile --port <api-port> <request-id> <download.csv> <download.json>` from the existing dedicated Windows Python environment. Each Request used its original running Normal or Demo API as the paginated reference. The MCP pair and Dashboard pair each matched two Records. The narrower Scottish Request and the two fixture Requests each matched one. All ten files had zero missing, extra or repeated IDs and zero field differences. Every file SHA-256 matched the digest in the [initial download comparison](#download-reconciliation-and-entry-point-comparison).

### Reproduction and resumption

1. Run the Normal launcher diagnostic and confirm the approved Topic binding and evidence mount. After a measured change in search availability, repeat the one bounded Core preflight from the Worker and require one eligible link and successful detail extraction. A passing robots check alone only verifies robots.
2. When that preflight passes, use the Normal MCP stdio procedure above with the same keyword and single binding. Save the prepared key before `start_collection` and poll to a terminal state. Require `succeeded` with an accepted publication. Read the exact Request, Job, Record and detail Evidence through the Dashboard and API, independently rehash the original bytes in the Worker, then download both Request exports and run the corrected verifier.
3. To reproduce the CSV correction independently, run the focused test and existing export suite with the disposable PostgreSQL and Redis setup above. Replay the five original download pairs with their Request IDs and API ports.
