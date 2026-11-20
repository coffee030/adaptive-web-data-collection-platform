# M18A public HTTPS source validation handoff

**20 November 2026 (UTC). M18B is not ready.** One independent origin passed live Core Preview and Validate and received an approved immutable Profile Version. Both live Jobs failed in the Worker with `timeout`. The Dashboard and REST API showed zero accepted Records and zero Evidence for each Job. There is no persisted Record-to-detail-Evidence trace.

| Validated profiles | Fully successful Jobs | Partial Jobs | Failed Jobs |
| ---: | ---: | ---: | ---: |
| 1 | 0 | 0 | 2 |

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
| Economics Observatory · `https://www.economicsobservatory.com` | [About and reuse licence](https://www.economicsobservatory.com/about) and the article footer reference CC BY-SA 4.0. Credit the author, source and licence and indicate changes. Apex robots returned a redirect. [Canonical robots](https://www.economicsobservatory.com/robots.txt) returned 200 plain text with comments and no applicable path or timing restrictions. `/search?keyword=…` links to same-origin, root-level article slugs. | `inflation` and `productivity` changed the server-rendered article cards. The profile selects titled article-card anchors from the first results grid and excludes charts. | **Profile-validated, live Jobs failed.** Preview and Validate passed for `inflation`, then v1 was approved. Both Jobs failed with `timeout` and empty result lists. |
| LSE Business Review · `https://blogs.lse.ac.uk` | [Terms](https://blogs.lse.ac.uk/terms-of-use/) and [republishing policy](https://blogs.lse.ac.uk/republishing-policy/) distinguish site downloads for own use and licensed articles. For covered CC BY 4.0 material credit title, author, source and licence and indicate changes. [Robots](https://blogs.lse.ac.uk/robots.txt) returned 404. `/businessreview/?swps=…` redirected to `/search/?swps=…` on the same origin. | Direct global search with `inflation` returned article cards and a next-page anchor. Scope extraction to `/businessreview/`, where the first sampled article exposed a canonical URL and date metadata. | **Environment-blocked.** Draft v1 `00dffb13-7f25-4a9f-b032-46f17671ac15` timed out twice in Preview. No passing validation report, approved version or Job. |
| Economic Statistics Centre of Excellence · `https://www.escoe.ac.uk` | [Robots](https://www.escoe.ac.uk/robots.txt) returned 200 with an empty wildcard disallow. Permission to retain raw HTML Evidence remained unresolved. | `/?s=inflation` and `/?s=productivity` returned different cards. `article.card--single` includes mixed types. An `a.entry--link` under `/publications/` led to a [working paper detail](https://www.escoe.ac.uk/publications/what-explains-recent-uk-inflation-an-application-of-the-bernanke-blanchard-model/) with title, canonical and time. | **Researched.** The operator stopped before authorization and Core runs. |
| UK in a Changing Europe · `https://ukandeu.ac.uk` | [Robots](https://ukandeu.ac.uk/robots.txt) returned 200 with an empty wildcard disallow. [Individual open access reports](https://ukandeu.ac.uk/reports/uk-eu-divergence-tracker-q1-2026/) have item-specific licensing. Permission to retain the matched blog HTML was unresolved. | `/?s=inflation` and `/?s=productivity` returned different mixed result cards. The inflation sample led with a blog via `.post-template__content h3 a`. Search took 5.50 seconds in the host probe. | **Researched.** No authorisation or Core runs. |
| Bank for International Settlements · `https://www.bis.org` | [Terms](https://www.bis.org/about/terms-conditions) allow covered non-commercial use with BIS credit for extracts. [Robots](https://www.bis.org/robots.txt) returned 200 and excludes `/search/`. The advertised bare `/search` accepted `keywords`. | `/search?keywords=inflation` returned mixed international cards, including ECB speeches. Search took 5.77 seconds in the host probe. A comparable UK subset was unverified. | **Researched.** No authorisation or Core runs. |

Other replacement screens ended at access or scope. [CEPR](https://cepr.org/voxeu/about-voxeu) allowed the wildcard robots agent but `/voxeu` returned 403. The [OBR robots file](https://obr.uk/robots.txt) returned 403 and [Scottish Government robots](https://www.gov.scot/robots.txt) returned 202 with an empty HTML response. The [FCA robots file](https://www.fca.org.uk/robots.txt) disallows query-bearing paths for the wildcard agent. NIESR and UK Data Service remained preliminary robots checks with permissions and extraction unresolved. The prior Bank of England, GOV.UK, FTC and New York Fed exclusions are recorded in the [follow-up plan](M18-Real-Source-and-Follow-Up-Plan.md) and [M10 assessment](M10-Real-Website-Feasibility.md).

## Reproduce the profiles

In the trusted local API, use `POST /sources` with `adapter_type=web`, the exact origin and permission reference, the path allowlist and `min_request_interval_ms=2000`. Use a separate `PATCH /sources/{source}/authorization` with `approval_status=approved`. Create the Draft with `POST /sources/{source}/versions` and a `configuration` envelope. Send `{"adapter_type":"web","keyword":"inflation"}` separately to `/sources/{source}/versions/{version}/preview` and `/validate` on the same version path. Leave at least three seconds between checks. Approve with `POST .../approve` and the returned `report_id`, `config_hash` and operator label. The operator workflow is also documented in [M7](../contracts/M7-controlled-website-collection.md).

For Economics Observatory, use the [About page](https://www.economicsobservatory.com/about) as the permission reference. Allow `/search` and the following observed detail paths only. Reassess this list when the live result cards change.

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

Both Jobs recorded create, dispatch, claim and failure events and one Worker attempt. In Normal Dashboard Job Details, a Playwright-driven Chrome session confirmed `Failed`, the controlled HTTP timeout and the empty Records and Evidence panels for both IDs. Independent REST reads of `/collection-jobs/{job_id}/events`, `/records?job_id={job_id}` and `/collection-jobs/{job_id}/evidence-pages` confirmed the event sequence and empty result lists. There are no Record IDs, Evidence IDs or stored Evidence hashes for these Jobs.

The terminal error does not name a URL. Each Worker attempt ended about two seconds after claim with zero captures, consistent with an initial robots transport timeout. Separate `docker exec … python -c …` diagnostics called the existing `resolve_public` and `public_get` functions against the canonical robots URL with the same combined two-second DNS and transfer budget. Both containers later hit curl error 28 with zero bytes, and a final Worker check also timed out at 2.003 seconds. The final check gated a possible third Job, so only two were submitted. API Preview and Validate had previously succeeded within the unchanged limits. The cause of the later transport timeout was not isolated to the publisher or the local network path.

## Next gate

On the same isolated stack or an approved environment with reliable HTTPS egress, check Economics Observatory robots from the Worker with the pinned transport. Once it responds within budget, recheck the observed paths and resubmit one `inflation` Job using the approved version. For a persisted record, compare its Job and pinned Source/Profile IDs and its detail Evidence ID, capture location and stored hash using Job Details → Record → **View capture evidence**, `GET /records/{id}?include_lineage=true` and `GET /evidence/{id}`. Recheck the permitted Resolution Foundation and LSE drafts or qualify independently operated substitutes for the same keyword before approving Topic bindings. The [M8 Topic contract](../contracts/M8-data-identity-collection-management.md) describes bindings and Request submission.

If timeouts recur on an otherwise healthy and permitted route, review a generic, bounded public transfer timeout separately. Keep a total attempt deadline and worker hard limit. Expose the effective budget consistently to the Profile UI, REST schema and Worker. A fixture with a delayed first response and a response beyond the proposed cap should demonstrate bounded success and continued fail-closed behavior. This change would increase connection occupancy and could affect retry timing. For ONS, a separate generic operator-configured institutional contact suffix on the User-Agent would address the observed policy gap while retaining the stable robots product token. Verify the header on robots, search and detail requests in a fixture before revisiting the ONS HTML search.

The embedded profile passed Core schema validation and reproduced the approved configuration SHA-256. All seven internal links resolved. Only this handoff is tracked. Source pages, credentials, captures, launcher settings and database state are local.
