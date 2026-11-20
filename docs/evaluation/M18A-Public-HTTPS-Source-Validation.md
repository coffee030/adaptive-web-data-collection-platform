# M18A public HTTPS source validation handoff

The original run below is preserved. See the [20 November continuation](#continuation-on-20-november-2026-utc) for the current counts and readiness verdict.

**20 November 2026 (UTC). M18A verified a live Record-to-detail-Evidence trace. M18B is not ready.** Economics Observatory passed live Core Preview and Validate for `inflation` and received an approved immutable Profile Version. Two Jobs failed with `timeout`. The third Job finished `partial` at the approved detail-page limit and persisted one accepted Record. The Dashboard, REST API and stored capture bytes agree on its detail Evidence.

| Validated profiles | Fully successful Jobs | Partial Jobs | Failed Jobs |
| ---: | ---: | ---: | ---: |
| 1 | 0 | 1 | 2 |

The Topic candidate remains **UK economic publications**, with the exact shared keyword **`inflation`**. The [follow-up plan](M18-Real-Source-and-Follow-Up-Plan.md) sets the readiness gate of three independent live-validated origins, two returning comparable publications for the shared keyword, and one persisted trace.

## Environment

- Fetched `feature/M18-real-source-validation` into a separate worktree at `51c6df124520ce7196c0c68049dc5e06c29a1859`. Both the M17 merge `1b1ed19fe03670dac57a6006d3b1a5be149700b0` and the M18 plan were ancestors.
- Windows 11 AMD64 build 26200, WSL 3.0.5.0, Docker Engine 29.9.3, Compose 5.7.0, Node 22.18.0 and npm 10.9.3. Started the installed Docker Desktop when the Linux engine pipe was absent. Ran `.\Setup-Platform.bat -NonInteractive`, then `.\Start-Platform.bat -NonInteractive -NoBrowser`. First Start reported `NET-004`. After checking `docker network inspect` and Windows IPv4 routes, set the unused `LAUNCHER_SUBNET=10.249.141.0/24` and Start passed. [Windows setup guide](../setup/Windows-One-Click-Setup.md)
- `.\Diagnose-Platform.bat -NonInteractive` confirmed Normal mode, Dashboard at `http://127.0.0.1:5197/`, API base `http://127.0.0.1:58097/api/v1`, PostgreSQL on loopback port 55497, and Redis healthy. Startup verified the Alembic head, database-backed API health, dispatcher polling and the Celery task registration. The API and Worker used the same image, private Docker network and named `adaptive-web-core-local-61e8e50ea0c3_evidence_data` volume mounted at `/data/evidence`. The isolated settings used `LAUNCHER_FIXTURE=0` and `LOCAL_PROFILE_APPROVAL=1`. The existing Synthetic Demo projects and presets were left available.

## Source feasibility

Checked robots with bounded GETs using `curl.exe -sS --max-time 8 -A "FYP-Collection-Core/1.0" -o <local-file> -w "%{http_code} %{content_type} %{redirect_url} %{time_total}" <url>` (seven to ten seconds for some preliminary requests). Followed published form targets and inspected only received HTML. A confirmed 404/410 is handled as absent by Core. A timeout, challenge/block, redirect, unsupported response type or invalid robots content prevents traversal under the [M7 contract](../contracts/M7-controlled-website-collection.md). The preliminary checks kept external HTML local.

| Publisher and origin | Policy and paths checked | Keyword and extraction | Core outcome |
| --- | --- | --- | --- |
| House of Commons Library · `https://commonslibrary.parliament.uk` | [Open Parliament Licence](https://www.parliament.uk/site-information/copyright/open-parliament-licence/) requires source attribution and a licence link for covered material. [Robots](https://commonslibrary.parliament.uk/robots.txt) returned 403 with a challenge. Prior plan lists `/search/?s=` and [`/research-briefings/sn02792/`](https://commonslibrary.parliament.uk/research-briefings/sn02792/). | Stopped at robots. Search selectors and access remain unresolved. | **Unsuitable in this environment.** No Preview, Validate, approval or Job. |
| Office for National Statistics · `https://www.ons.gov.uk` | [Robots](https://www.ons.gov.uk/robots.txt) returned confirmed 404. The [fair use policy](https://www.ons.gov.uk/help/fair-use-policy) requires a crawler User-Agent with contact information. [Bot guidance](https://developer.ons.gov.uk/bots/) specifies an organisation contact or bot information URL. [Terms](https://www.ons.gov.uk/help/terms-conditions) apply OGL to most content with exceptions. | The planned HTML search and [consumer price bulletin detail family](https://www.ons.gov.uk/economy/inflationandpriceindices/bulletins/consumerpriceinflation) were held at the policy gate. The fixed Core agent has no contact information. | **Unsuitable under the current Core configuration.** No Preview, Validate, approval or Job. |
| Institute for Fiscal Studies · `https://ifs.org.uk` | [Copyright](https://ifs.org.uk/copyright) permits covered non-commercial reuse with IFS credit, CC BY-NC 4.0 link and change notice. [Robots](https://ifs.org.uk/robots.txt) returned 200 and disallows `/search/` and `/index.php/search/`. The advertised bare [`/search`](https://ifs.org.uk/search) returned 403. | Stopped at the bare search response. Keyword parameter, selectors and detail paths remain unresolved. | **Unsuitable in this environment.** No Preview, Validate, approval or Job. |
| Resolution Foundation · `https://www.resolutionfoundation.org` | [Copyright](https://www.resolutionfoundation.org/privacy/copyright/) encourages electronic access and licenses covered work CC BY-NC-ND 4.0. Credit Foundation, authors and licence. [Robots](https://www.resolutionfoundation.org/robots.txt) returned 200, wildcard `Allow: /`. Root search `/?s=…` and `/publications/` detail links. | `inflation` and `productivity` yielded different server HTML. The former linked [What a ratchet!](https://www.resolutionfoundation.org/publications/what-a-ratchet/). Publication card class, headline, canonical URL and `time[datetime]` found. Additional results use scripted loading. | **Environment-blocked.** Draft v1 `fc8a48b5-9734-46bd-904a-e7aba69ed5c1` timed out in Preview on `inflation` twice and on `What a ratchet!` once. No passing validation report, approved version or Job. |
| Economics Observatory · `https://www.economicsobservatory.com` | [About and reuse licence](https://www.economicsobservatory.com/about) and the article footer reference CC BY-SA 4.0. Credit the author, source and licence and indicate changes. Apex robots returned a redirect. [Canonical robots](https://www.economicsobservatory.com/robots.txt) returned 200 plain text with comments and no applicable path or timing restrictions. `/search?keyword=…` links to same-origin, root-level article slugs. | `inflation` and `productivity` changed the server-rendered article cards. The profile selects titled article-card anchors in the search results and excludes the charts grid. | **Profile-validated, live partial.** Preview and Validate passed for `inflation`, then v1 was approved. Two Jobs timed out. The third retained one accepted Record and its detail Evidence with `detail_limit_reached`. |
| LSE Business Review · `https://blogs.lse.ac.uk` | [Terms](https://blogs.lse.ac.uk/terms-of-use/) and [republishing policy](https://blogs.lse.ac.uk/republishing-policy/) distinguish site downloads for own use and licensed articles. For covered CC BY 4.0 material credit title, author, source and licence and indicate changes. [Robots](https://blogs.lse.ac.uk/robots.txt) returned 404. `/businessreview/?swps=…` redirected to `/search/?swps=…` on the same origin. | Direct global search with `inflation` returned article cards and a next-page anchor. Scope extraction to `/businessreview/`, where the first sampled article exposed a canonical URL and date metadata. | **Environment-blocked.** Draft v1 `00dffb13-7f25-4a9f-b032-46f17671ac15` timed out twice in Preview. No passing validation report, approved version or Job. |
| Economic Statistics Centre of Excellence · `https://www.escoe.ac.uk` | [Robots](https://www.escoe.ac.uk/robots.txt) returned 200 with an empty wildcard disallow. Permission to retain raw HTML Evidence remained unresolved. | `/?s=inflation` and `/?s=productivity` returned different cards. `article.card--single` includes mixed types. An `a.entry--link` under `/publications/` led to a [working paper detail](https://www.escoe.ac.uk/publications/what-explains-recent-uk-inflation-an-application-of-the-bernanke-blanchard-model/) with title, canonical and time. | **Researched.** The operator stopped before authorization and Core runs. |
| UK in a Changing Europe · `https://ukandeu.ac.uk` | [Robots](https://ukandeu.ac.uk/robots.txt) returned 200 with an empty wildcard disallow. [Individual open access reports](https://ukandeu.ac.uk/reports/uk-eu-divergence-tracker-q1-2026/) have item-specific licensing. Permission to retain the matched blog HTML was unresolved. | `/?s=inflation` and `/?s=productivity` returned different mixed result cards. The inflation sample led with a blog via `.post-template__content h3 a`. Search took 5.50 seconds in the host probe. | **Researched.** No authorisation or Core runs. |
| Bank for International Settlements · `https://www.bis.org` | [Terms](https://www.bis.org/about/terms-conditions) allow covered non-commercial use with BIS credit for extracts. [Robots](https://www.bis.org/robots.txt) returned 200 and excludes `/search/`. The advertised bare `/search` accepted `keywords`. | `/search?keywords=inflation` returned mixed international cards, including ECB speeches. Search took 5.77 seconds in the host probe. A comparable UK subset was unverified. | **Researched.** No authorisation or Core runs. |

Other replacement screens ended at access or scope. [CEPR](https://cepr.org/voxeu/about-voxeu) allowed the wildcard robots agent but `/voxeu` returned 403. The [OBR robots file](https://obr.uk/robots.txt) returned 403 and [Scottish Government robots](https://www.gov.scot/robots.txt) returned 202 with an empty HTML response. The [FCA robots file](https://www.fca.org.uk/robots.txt) disallows query-bearing paths for the wildcard agent. NIESR and UK Data Service remained preliminary robots checks with permissions and extraction unresolved. The prior Bank of England, GOV.UK, FTC and New York Fed exclusions are recorded in the [follow-up plan](M18-Real-Source-and-Follow-Up-Plan.md) and [M10 assessment](M10-Real-Website-Feasibility.md).

## Reproduce the profiles

In the trusted local API, use `POST /sources` with `adapter_type=web`, the exact origin and permission reference, the path allowlist and `min_request_interval_ms=2000`. Use a separate `PATCH /sources/{source}/authorization` with `approval_status=approved`. Create the Draft with `POST /sources/{source}/versions` and a `configuration` envelope. Send `{"adapter_type":"web","keyword":"inflation"}` separately to `/sources/{source}/versions/{version}/preview` and `/validate` on the same version path. The pilot left three seconds between checks. Approve with `POST .../approve` using the returned `report_id`, `config_hash` and an `approver` label. The operator workflow is also documented in [M7](../contracts/M7-controlled-website-collection.md).

For Economics Observatory, use the [About page](https://www.economicsobservatory.com/about) as the permission reference. Use the tested allowlist of `/search` and these four observed detail paths. The one-detail pilot reached its limit after resolving a second distinct allowed link. Reassess the result order and allowlist before increasing coverage.

- `/can-higher-inflation-expectations-ever-stimulate-the-economy`
- `/the-good-the-bad-and-the-ugly-what-scenarios-for-uk-inflation`
- `/how-might-the-middle-east-conflict-shape-europes-inflation-outlook`
- `/can-we-explain-why-inflation-in-the-uk-is-higher-than-in-the-euro-area`

```json
{
  "adapter_type": "web",
  "config_schema_version": "1",
  "selector_type": "xpath",
  "item_selector": "//html",
  "record_schema": {
    "record_type": "publication",
    "schema_version": "1",
    "identity_field": "publication_url",
    "fields": [{"name": "title"}, {"name": "publication_url"}]
  },
  "fields": [
    {"name": "title", "selector_type": "css", "selector": "h1.article__title"},
    {
      "name": "publication_url",
      "selector_type": "css",
      "selector": "head link[rel=\"canonical\"]",
      "mode": "attribute",
      "attribute": "href"
    }
  ],
  "search": {
    "origin": "https://www.economicsobservatory.com",
    "path": "/search",
    "keyword_parameter": "keyword",
    "result_item_selector": "//*[@id=\"search-results\"]//div[@class=\"home__blocks-grid \"]/a[@title]",
    "detail_link_selector": "self::a",
    "max_detail_pages": 1,
    "max_requests": 3,
    "max_redirects": 0,
    "max_body_bytes": 512000,
    "timeout_seconds": 2,
    "max_seconds": 15,
    "max_attempts": 1
  }
}
```

Each Preview, Validate or Job can spend up to three requests total including robots, search and one detail. Redirects and pagination are disabled for this profile. Core applies the configured interval between requests. The site exposes a date next to the authors and a JSON-LD date. The validated profile omits the date because the selected DOM text combines the date with other metadata and the profile does not parse JSON-LD.

The two timed-out drafts used the same budgets and common `publication` schema, with optional string `published_at` and `publication_url` as identity.

| Draft | Source allowlist and search | Result and detail mapping |
| --- | --- | --- |
| Resolution Foundation | Root prefix `/` is required for `/?s=…` under the current path-prefix contract. No pagination. | CSS `article.type-cpt_publications` → `h2.entry-title > a`. Detail item `html`. CSS text `h1.entry-title`, `head link[rel="canonical"]@href`, `p.meta time.published@datetime`. |
| LSE Business Review | `/search`, `/businessreview`. Search `/search/?swps=…`. One page with XPath next link `//nav[@class="pagination"]/a[normalize-space(.)="Next"]`. | XPath `//div[@class="cta-card"]/a[starts-with(@href,"https://blogs.lse.ac.uk/businessreview/")]` → `self::a`. Detail item `//html`. Title XPath `(//h1)[1]`, CSS `head link[rel="canonical"]@href` and `head meta[property="article:published_time"]@content`. |

## Live pilot and trace outcome

Economics Observatory Source `3ac6a0c7-57cd-4ca2-b815-9f000fafe620` was created pending and explicitly authorised. Preview returned HTTP 200 with one candidate and no problems. Validate returned HTTP 200 with `passed=true`, 1 valid, 0 invalid and 0 duplicates. It sampled [Can higher inflation expectations ever stimulate the economy?](https://www.economicsobservatory.com/can-higher-inflation-expectations-ever-stimulate-the-economy) by Stefano Fasani and Lorenza Rossi. The operator approved version 1 using the matching report `552e4830-591c-45d4-b9e9-8392179ab883`. The pinned version ID is `3d65cca7-9854-4903-a217-d1adb6cd3e97` with configuration SHA-256 `2fb6d6d804bd5a473bbac5aa4a4fcadbde5f380377aa842e48680f2c3f27b0c5`.

Submitted through `POST /collection-jobs` with the Source and pinned version IDs, the same keyword entry and a fresh UUID `request_key` per submission. Each submission returned HTTP 201. The single-source flow creates no Collection Request. Polled `GET /collection-jobs/{job_id}` at up to two-second intervals with a 40–45-second deadline when polling was needed.

| Job ID | Worker interval (UTC) | Terminal state | Accepted / invalid / duplicate | Evidence |
| --- | --- | --- | --- | --- |
| `9bc2e270-02b6-4832-bbe1-deaef5d741f4` | 09:34:51.171 to 09:34:53.197 | `failed`, `timeout` | 0 / 0 / 0 | 0 |
| `ca874cc7-01d4-4837-8a77-4c453c177264` | 09:36:00.305 to 09:36:02.319 | `failed`, `timeout` | 0 / 0 / 0 | 0 |
| `afc943ad-c1cc-401b-9c97-0e1b8fe28835` | 09:43:19.595 to 09:43:26.233 | `partial`, `detail_limit_reached` | 1 / 0 / 0 | 2 |

Each Job was dispatched and claimed once. Normal Dashboard Job Details and independent API reads confirmed the first two failures, empty Records and Evidence, and terminal `FAILED` events. The timeout error does not name a URL. Both attempts ended about two seconds after claim, consistent with an initial robots transport timeout. Diagnostics using `docker exec` and the Core `resolve_public` and `public_get` functions reproduced curl error 28 with zero bytes in both containers. A subsequent Worker diagnostic returned HTTP 200 `text/plain` in 1.943 seconds within the unchanged combined DNS and transfer budget. That recovery prompted the third submission with the same approved version, keyword and limits. The underlying cause of the intermittent timeout remains unresolved.

### Accepted Record and detail Evidence

The third Job reported `More results than the approved detail-page limit` and ended in a `PARTIAL` event. It saved search Evidence first, then an HTTP 200 HTML detail capture. The accepted Record contains the published title and the canonical URL listed above. Its validation status is `passed` and its source record key equals `publication_url`.

| Trace field | Observed value |
| --- | --- |
| Job ID | `afc943ad-c1cc-401b-9c97-0e1b8fe28835` |
| Collection Request ID | None. The Job was submitted directly. |
| Source ID | `3ac6a0c7-57cd-4ca2-b815-9f000fafe620` |
| Pinned Profile Version ID | `3d65cca7-9854-4903-a217-d1adb6cd3e97` |
| Record ID | `a6c66510-5c05-5e8b-aec8-dfa9c7d151e7` |
| Search Evidence ID · page 1 | `ff1cfdcb-c820-4113-be6b-2eb58e9a962f` |
| Detail Evidence ID · page 2 | `4b76bfdc-a0be-42e4-b811-d2fcc53b52a1` |
| Detail capture time (UTC) | `2026-11-20T09:43:26.220442Z` |
| Detail URL | [Economics Observatory publication](https://www.economicsobservatory.com/can-higher-inflation-expectations-ever-stimulate-the-economy) |
| Detail SHA-256 | `d1ab295228e5ab878a2d251d6c8fdcd4890f44cfde445e291aac78d2d478a9f7` |

In the Normal Dashboard, Playwright and Chrome opened Job Details, followed the publication from **Related records**, expanded **Provenance and identifiers**, and followed **View capture evidence**. Evidence Metadata displayed **Detail page**, page 2, HTTP 200, the captured URL and the SHA-256 above. An independent REST check used `GET /collection-jobs/{job_id}`, `/collection-jobs/{job_id}/events`, `/records?job_id={job_id}`, `/records/{id}?include_lineage=true`, `/evidence/{id}` and `/collection-jobs/{job_id}/evidence-pages`. It matched the Job, Source, pinned Profile Version, Record and Evidence identifiers, configuration hash and provenance run ID across the responses.

A read-only `docker exec` check in the Worker used Python `hashlib.sha256` to independently rehash both stored `input.bin` captures. The detail capture was 338,283 bytes and its digest matched the REST and Dashboard value. Scrapling confirmed the first matched link in the stored search HTML points to the detail capture, whose visible heading and declared canonical URL match the Record. The captured search HTML had 76 matched anchors. The one-detail budget limited how many eligible links the Worker followed.

## Next gate

From a Normal environment with reliable HTTPS egress, resume at the Resolution Foundation and LSE drafts. Verify their permitted routes within the Core budget, rerun Preview and Validate for `inflation`, and approve each matching immutable version only after a passing report. Qualify independent substitutes if either draft remains blocked. Before the multi-source Job, verify comparable `inflation` results from at least two publishers, recheck the Economics Observatory path list against current search ordering, and explicitly approve the corresponding Topic bindings. The [M8 Topic contract](../contracts/M8-data-identity-collection-management.md) describes bindings and Request submission.

If timeouts recur on an otherwise healthy and permitted route, review a generic, bounded public transfer timeout separately. Keep a total attempt deadline and worker hard limit. Expose the effective budget consistently to the Profile UI, REST schema and Worker. A fixture with a delayed first response and a response beyond the proposed cap should demonstrate bounded success and continued fail-closed behavior. This change would increase connection occupancy and could affect retry timing. For ONS, a separate generic operator-configured institutional contact suffix on the User-Agent would address the observed policy gap while retaining the stable robots product token. Verify the header on robots, search and detail requests in a fixture before revisiting the ONS HTML search.

The embedded profile passed Core schema validation and reproduced the approved configuration SHA-256. All seven internal links resolved. Only this handoff is tracked. Source pages, credentials, captures, launcher settings and database state are local.

## Continuation on 20 November 2026 (UTC)

**Ready for M18B.** Three independently operated public HTTPS origins passed live Core Preview and Validate for **UK economic publications** using exactly `inflation`. Their samples address inflation expectations or the effects of inflation on UK public budgets. The earlier Economics Observatory Job still resolves from its accepted Record to the matching article-detail Evidence. The three Profile Versions are approved. Topic creation and binding approvals are pending.

| Independent live-validated publishers | Fully successful Jobs | Partial Jobs | Failed Jobs |
| ---: | ---: | ---: | ---: |
| 3 | 0 | 1 | 2 |

Fetched `feature/M18-real-source-validation`. Local and remote heads matched `350f8093750a463a59255b13e429d0249bb6f47b` before this evaluation. `.\Diagnose-Platform.bat -NonInteractive` confirmed the same Windows Normal stack, its loopback frontend and API, and healthy PostgreSQL, Redis, dispatcher and Worker. The existing Drafts and authorised Sources for Resolution Foundation and LSE were present. The FastAPI container runs synchronous Preview and Validate via the Core profile service. The Celery Worker runs Jobs in a separate process and container with the same image and Evidence volume. These continuation timeouts were observed in the API container. The earlier Worker failures remain separate observations. Synthetic Demo remained available.

### Existing drafts and failing stages

All continuation profiles used a two-second DNS-plus-transfer cap per request, a 15-second traversal deadline, at most three outbound requests, one detail, zero redirects, and a 512,000-byte response cap. The minimum interval was two seconds per origin and the Job attempt setting was one. Preview and Validate each performed their own bounded traversal. HTTP elapsed times below include origin pacing and local API overhead.

| UTC start | Publisher and FastAPI call | HTTP and elapsed | Observed stage and outcome |
| --- | --- | --- | --- |
| 10:07:13.419 | Resolution Foundation Preview, v1 revision 1 | 200, 8.510 s | Robots, search, detail and extraction completed. One candidate, [What a ratchet!](https://www.resolutionfoundation.org/publications/what-a-ratchet/), title, canonical URL and published time `2026-06-10T06:50:54+01:00`. It examines the effect of price inflation on the UK's State Pension triple lock. |
| 10:07:14.185 | LSE Business Review Preview, v1 revision 1 | 400, 5.006 s | `timeout`. The API response omits the stage. Detail and extraction success were unverified. |
| 10:07:23.971 | Resolution Foundation Validate, v1 revision 1 | 200, 4.918 s | `passed=false`, `timeout`, no sample location. The API response omits the stage. No validated field sample. Report `3f287e1d-589c-43d4-b23f-06153e7930d1`. |
| 10:11:03.948 | Resolution Foundation Preview, v1 revision 2 | 400, 4.930 s | `timeout`. The API response omits the stage. No extraction result and no Validate for revision 2. |

Separate same-runtime diagnostics ran in the FastAPI container with the existing SearchTraversal, robots policy, Redis origin lock, pinned HTTPS transport and the same budgets. Each diagnostic stopped at the first error. These measurements describe the diagnostic calls.

| UTC start | Origin | Robots result | First failure |
| --- | --- | --- | --- |
| 10:08:58.579 | Resolution Foundation | HTTP 200, 23 bytes of `text/plain`. DNS 0.129 s, transfer 0.887 s | Root `/?s=inflation` transport timed out. DNS 0.007 s and transfer 1.995 s. Detail and extraction were unreached. |
| 10:09:03.999 | LSE Blogs | HTTP 404. Core treated robots as absent. DNS 0.065 s, transfer 0.906 s | Canonical `/search/?swps=inflation` transport timed out. DNS 0.003 s and transfer 2.000 s. Detail and extraction were unreached. |
| 10:08:59.220 | Economics Observatory | DNS 0.064 s, transfer timed out after 1.938 s | Robots transport. Search, detail and extraction were unreached. |

DNS and whole-transfer times were measured in the API container. Connect, TLS and first-byte times were unavailable there. A separate host check for Resolution Foundation's root keyword route returned HTTP 200 with first byte at 2.188 s and total time 2.711 s. The timeouts establish a transport budget failure. There was no publisher denial response on those diagnostic routes.

Resolution Foundation's policy permits electronic access and covered non-commercial reproduction with attribution, with third-party material excluded. The public form submits `s` at `/`. The narrower `/search/?s=inflation` returned HTTP 404. Under current prefix matching, authorising `/` covers the entire origin. Revision 2 keeps the single search page and replaces the detail link selector with `h2.entry-title > a[href^="https://www.resolutionfoundation.org/publications/"]`. This narrows the tested profile's detail selection while the Source permission remains broad. The Foundation draft remains unapproved after the failed Preview. Its v1 ID is `fc8a48b5-9734-46bd-904a-e7aba69ed5c1` and revision 2 hash is `d993a41af07ce8de5dd98823f35eef345ea73ba211285344440a6b2db009245d`. [Resolution Foundation copyright](https://www.resolutionfoundation.org/privacy/copyright/)

The LSE Draft retains the `/search` and `/businessreview` allowlist and direct same-origin `/search/?swps=inflation`. Its selector matches only absolute Business Review anchors in result cards. The LSE Blogs policy licenses covered articles under CC BY 4.0 with title, author, source and licence attribution. The site terms apply to the evaluation and third-party assets have separate terms. The Draft remains v1 revision 1 `00dffb13-7f25-4a9f-b032-46f17671ac15` with hash `22047d9661fdbbe498ef5eaa12fe4e612c9c893b900a614637602c8daea132a7`. [Terms of use](https://blogs.lse.ac.uk/terms-of-use/) · [Republishing policy](https://blogs.lse.ac.uk/republishing-policy/)

### Per-origin continuation verdict

| Origin and publisher | Current evidence | Outcome |
| --- | --- | --- |
| `https://www.economicsobservatory.com` · Economics Observatory | Historical live Preview, Validate, approved v1, and one partial Job with an accepted Record and retained detail capture. Host `/search?keyword=inflation` returned HTTP 200. Parsing its HTML with the stored selector gave the first two allowed detail paths in their existing order. The first is the persisted sample. The separate API diagnostic timed out on robots. | **Validated.** Current host result order fits the pinned allowlist. Live API egress was intermittent. |
| `https://www.resolutionfoundation.org` · Resolution Foundation | One successful live Preview. Validate and revised Preview timed out. A separate API diagnostic timed out on search. | **Preview only.** Immutable approval pending a passing report. |
| `https://blogs.lse.ac.uk` · LSE Business Review | Live Preview timed out. A separate API diagnostic timed out on search. | **Transport blocked during the continuation.** Draft remains unapproved. |
| `https://www.gov.wales` · Welsh Government | Published form `/search?globalkeywords=inflation` returned server-rendered results. Wildcard robots disallows `/search/`. The advertised bare `/search` and the detail route passed live under Core. Results also contain HTTP links. The XPath scopes selection to same-origin HTTPS budget statements. [Copyright and OGL conditions](https://www.gov.wales/copyright-statement) | **Validated and approved.** Credit Welsh Government, link the licence and observe exceptions for logos and third-party material. |
| `https://fiscalcommission.scot` · Scottish Fiscal Commission | Official independent non-ministerial forecaster. The root search form submits `s`, and robots rules restrict calendar routes unrelated to the tested search and detail. The root prefix covers the origin. For this bounded academic evaluation it was explicitly authorised with a single origin, a news-post selector, zero redirects and one detail. Search anchors include publisher tracking parameters and the profile extracts the clean declared canonical URL. [Independence](https://fiscalcommission.scot/about-us/what-we-do/) · [Crown copyright and publication scheme](https://fiscalcommission.scot/our-work/governance/foi-eir-data-protection-publication-scheme-and-privacy-notice/) | **Validated and approved.** Credit the Commission, acknowledge Crown copyright and the OGL, and preserve the publication's meaning. Review the root scope again when binding the profile. |
| `https://www.parliament.scot` · Scottish Parliament | Advertised `/search?qry=inflation` returned HTTP 200 with SPICe briefing links. Two listed detail routes timed out in six-second host probes with zero bytes. [Reuse terms](https://www.parliament.scot/about/copyright/) | **Screened.** Detail markup could not be confirmed. No Core profile was authorised. |
| `https://www.ukri.org` · UK Research and Innovation | Root `/?st=inflation` returned mixed grant guidance and corporate reports. The narrower `/search/?st=inflation` returned 404. [Terms of use](https://www.ukri.org/who-we-are/terms-of-use/) | **Screened.** The sample and broad root were less suitable than the qualified substitutes. No Core profile was authorised. |

No additional Economics Observatory Job was needed. The read API verified the original three Job IDs and the accepted Record's detail reference. A read-only Worker `sha256sum` check over both existing `input.bin` captures matched the historical search SHA-256 `f1fee63ce50f43082120c4ae34059fd3baab46c4329cbf2eaa2d1a0abb148d1c` and the detail SHA-256 listed above.

### Shared keyword samples

The Topic is **UK economic publications** and the search entry in all three cases was **`inflation`**. Titles and canonical URLs are the actual Core field values.

| Publisher and approved Profile Version | Sample publication | Why it matches |
| --- | --- | --- |
| Economics Observatory · v1 `3d65cca7-9854-4903-a217-d1adb6cd3e97` | [Can higher inflation expectations ever stimulate the economy?](https://www.economicsobservatory.com/can-higher-inflation-expectations-ever-stimulate-the-economy) | Stefano Fasani and Lorenza Rossi examine inflation expectations and monetary policy. This sample is the accepted pilot Record. |
| Welsh Government · v1 `416c007b-3099-4e97-9f9a-b557f3d89ae3` | [Written Statement: The implications of the UK Autumn Budget](https://www.gov.wales/written-statement-implications-uk-autumn-budget) | Elin Jones explains how inflation reduces the real value of the Welsh block grant. The extracted publication time is `2026-11-05T12:18:07Z`. |
| Scottish Fiscal Commission · v1 `566c575e-24a8-4258-a9bf-719b472de06e` | [Supply and demand pressures on public funding](https://fiscalcommission.scot/supply-and-demand-pressures-on-public-funding/) | Graeme Roy discusses how higher inflation reduces the spending power of Scottish public budgets. The page's publication metadata is `2022-10-03T14:13:40+00:00`. |

### Approved profiles and reproduction

Use the REST procedure above in isolated Normal mode. Register each Source with its listed origin, permission reference and paths, then authorise it with `PATCH /sources/{source}/authorization`. Create a draft with the JSON embedded as `configuration`. Use `POST /sources/{source}/versions/{version}/preview` and `/validate` with `{"adapter_type":"web","keyword":"inflation"}`. Require one clean publication and a passing report before `POST .../approve` with the matching report ID and hash. Set `min_request_interval_ms=2000` on both Sources. The runs waited two seconds between Preview and Validate.

| Publisher | Source ID and paths | Live Preview and Validate (UTC start) | Approval |
| --- | --- | --- | --- |
| Welsh Government | `bdcfcc2a-18b0-478c-a27b-b1eca17625f4`. `/search` and `/written-statement-implications-uk-autumn-budget`. | Preview 10:11:03.943, HTTP 200 in 6.306 s. Validate 10:11:12.268, HTTP 200 in 5.834 s. One valid, zero invalid, zero duplicates. Report `64e5d305-53f9-47ee-ba46-d301ab0ac7a3`, sample SHA-256 `988ba2515255f96c3968b249b4395bd10ddb6ba6e29b89fb9e346e7dd1e39558`. | HTTP 200 at 10:12:06.894, config SHA-256 `493daad685f4f78ba8db86ea4e3c9cc98b2b71d20baa3ee9de070e61a17cd1c0`. |
| Scottish Fiscal Commission | `5b8c960a-2e19-46ee-9ec3-13bb26705abd`. Root prefix `/`. | Preview 10:14:27.033, HTTP 200 in 8.056 s. Validate 10:14:37.111, HTTP 200 in 7.930 s. One valid, zero invalid, zero duplicates. Report `a56207fb-7531-4af6-8767-b21d34cb8567`, sample SHA-256 `d2d4c07c886f6150574071af31ae722c58ad0ab560c830821f0dd8b6ea069204`. | HTTP 200 at 10:15:12.194, config SHA-256 `807f724c07a69719ddba687fb7964b83348bbc4720ba9accc9ef2f97ee411bd2`. |

Welsh Government configuration

```json
{
  "adapter_type": "web", "config_schema_version": "1", "selector_type": "xpath", "item_selector": "//html",
  "record_schema": {
    "record_type": "publication", "schema_version": "1", "identity_field": "publication_url",
    "fields": [{"name":"title"}, {"name":"publication_url"}, {"name":"published_at","required":false}]
  },
  "fields": [
    {"name":"title","selector_type":"css","selector":"h1.page-header__title"},
    {"name":"publication_url","selector_type":"css","selector":"head link[rel=\"canonical\"]","mode":"attribute","attribute":"href"},
    {"name":"published_at","selector":"(.//time[@datetime])[1]","mode":"attribute","attribute":"datetime"}
  ],
  "search": {
    "origin": "https://www.gov.wales", "path": "/search", "keyword_parameter": "globalkeywords",
    "result_item_selector": "//h3/a[starts-with(@href,\"https://www.gov.wales/written-statement-\") and contains(@href,\"budget\")]",
    "detail_link_selector": "self::a",
    "max_detail_pages": 1, "max_requests": 3, "max_redirects": 0, "max_body_bytes": 512000,
    "timeout_seconds": 2, "max_seconds": 15, "max_attempts": 1
  }
}
```

Scottish Fiscal Commission configuration

```json
{
  "adapter_type": "web", "config_schema_version": "1", "selector_type": "css", "item_selector": "html",
  "record_schema": {
    "record_type": "publication", "schema_version": "1", "identity_field": "publication_url",
    "fields": [{"name":"title"}, {"name":"publication_url"}, {"name":"published_at","required":false}]
  },
  "fields": [
    {"name":"title","selector":"article.category-news header h2.entry-title"},
    {"name":"publication_url","selector":"head link[rel=\"canonical\"]","mode":"attribute","attribute":"href"},
    {"name":"published_at","selector":"head meta[property=\"article:published_time\"]","mode":"attribute","attribute":"content"}
  ],
  "search": {
    "origin": "https://fiscalcommission.scot", "path": "/", "keyword_parameter": "s",
    "result_item_selector": "article.type-post.category-news",
    "detail_link_selector": "header h2.entry-title > a[href^=\"https://fiscalcommission.scot/\"]",
    "max_detail_pages": 1, "max_requests": 3, "max_redirects": 0, "max_body_bytes": 512000,
    "timeout_seconds": 2, "max_seconds": 15, "max_attempts": 1
  }
}
```

The two search-stage timeouts demonstrate sensitivity to the current transport cap. They did not prevent qualification because independent substitutes passed. There is no shared Core change in this continuation. If latency is revisited separately, measure the delay in the failing runtime first. One reusable proposal for review is a bounded per-request transport budget for new profile versions. Preserve existing approved bytes and defaults, apply the same bound in API Preview, Validate and Worker Jobs, and retain the overall traversal deadline and the 60-second Celery hard limit. A controlled fixture should return one response within the reviewed bound and delay another past it, with tests for success, fail-closed timeout and the overall traversal deadline. The current two-second cap governs this handoff.

The Topic list was empty in this isolated environment. For M18B, create the intended Topic and approve bindings to the three versions above. Recheck Economics Observatory's first two eligible paths and the Welsh Government statement against current result ordering before submitting a Request. The next milestone owns the three formal Jobs, multi-origin Request, export reconciliation and retry comparison. [Topic and binding procedure](../contracts/M8-data-identity-collection-management.md)

All three JSON examples parsed against the deployed Core schema, reproduced their approved configuration SHA-256 values and generated the observed search URLs for `inflation`. The relative links and continuation anchor resolved.
