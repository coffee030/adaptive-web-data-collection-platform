# M7 Controlled Website Collection

## Operator workflow

1. In **Sources → Create source**, register an `https://` origin, a verifiable permission reference, and applicable path prefixes. Use standard HTTPS port 443 and a lower-case DNS name. `allowed_paths` is keyed by origin. `/catalog` includes that path and its children. `/catalogue` is separate.
2. Review access policy and select **Authorize Source access**. The trusted local UI uses `LOCAL_PROFILE_APPROVAL=1`. Direct REST clients use `PATCH /api/v1/sources/{source_id}/authorization`.
3. In Profile Draft, select **Keyword search and detail pages**. Choose the registered origin and enter the search path, query parameter, result item selector, and detail link selector. Detail pages use the existing item selector, fields, types, and identity field. To opt into a different request timeout, select a value under **Pagination and request limits** and save the draft.
4. Use a sample keyword with **Preview** and **Validate sample**. Each reads one search page, checks the next link, and fetches the first detail result. Approve the Profile Version using a passing report matching the current configuration hash.
5. In **New Collection Job**, select the approved version and enter the keyword. When finished, inspect Search results and Detail pages under **Capture evidence** and trace individual Records to Evidence in **Data Explorer**.

## REST configuration

Add `search` to the HTML `configuration`. `selector_type` applies to search selectors. Each matching result item must contain exactly one `<a href>` matching the detail-link selector. The search path excludes a query and fragment. `keyword_parameter` is the fixed query key. At execution the keyword is added using UTF-8 percent encoding.

```json
{
  "origin": "https://example.com",
  "path": "/search",
  "keyword_parameter": "q",
  "result_item_selector": ".result",
  "detail_link_selector": "a.item",
  "pagination": {"next_link_selector": "a.next", "max_pages": 2},
  "max_detail_pages": 4,
  "max_requests": 12
}
```

Preview and Validate bodies and Job `entry` accept `{"adapter_type":"web","keyword":"C++ & 茶"}`. Keywords may contain 1–128 printable characters. Public HTTPS Job, Preview, and Validate calls require a search-configured version and keyword entry. The legacy controlled HTTP `url`, CSV entries, and hashes for Profiles without `search` remain valid.

| Control | Default | Allowed range |
| --- | --- | --- |
| Search pages | 1 without pagination | `pagination.max_pages` 1–5 |
| Unique detail links | 5 | `max_detail_pages` 1–10 |
| Outbound requests per attempt | 12 | `max_requests` 3–20 including robots and redirects |
| Redirects per document | 2 | `max_redirects` 0–2 |
| Response bytes | 1,048,576 | `max_body_bytes` 512,000–1,048,576 |
| DNS + transfer time per request | 2 seconds | `timeout_seconds` 1–5 whole seconds |
| Fetch and traversal time per attempt | 45 seconds | `max_seconds` 5–45 seconds |
| Execution attempts | 3 | `max_attempts` 1–3 including worker lease recovery |
| Minimum time between response completion and next request | 1 second | Source `min_request_interval_ms` 1,000–10,000. Robots rules can extend this interval. |
| Concurrent M7 requests per origin | 1 | Fixed Redis mutual exclusion |

An approved Profile retains its saved timeout. A change requires a fresh draft, validation and approval. Origin pacing and lock waits use traversal time. Each outbound request uses the smaller of its configured timeout and the remaining traversal time. DNS resolution and the complete transfer share that request deadline. A larger timeout can hold the origin slot and Worker for longer.

The worker hard limit is 60 seconds and the PostgreSQL lease is 90 seconds. The existing PostgreSQL and Celery retry model restarts from the first search page. A longer `Retry-After` is stored as a shared Redis cooldown. Above the Job's automatic retry limit of 300 seconds, the attempt ends with a readable error.

## Permissions and results

- Each HTTP request requires Source authorisation and the shared origin lock. Search, next, detail, and redirect links are individually checked for same origin and allowed path. Only exact `/robots.txt` can bypass the path prefix requirement when fetching robots. Every public DNS answer must be eligible. HTTPS connects to an approved IP and verifies the TLS hostname and actual peer. Public traffic ignores environment proxies.
- A 200 from `/robots.txt` must be UTF-8 plain text. A 404 or 410 means the file is absent. Supports matching user-agent groups, longest path, `*`, `$`, `Crawl-delay`, and `Request-rate`. Explicit blocking, another unsuccessful status, redirects, or timing directives that exceed limits stop collection. The legacy M6 HTTP fixture retains its robots and request behaviour.
- Search pages use `capture_kind=search` and detail pages use `detail`. Existing inputs default to `input`. `page_number` is the published capture order. The legacy single-Evidence endpoint still returns the first page. `/evidence-pages` returns an ordered capture list.
- Empty results retain search Evidence and finish with `empty_search_results`. A next-page loop, detail fetch failures, or a reached limit may produce `partial`. At least one record must pass field validation for `partial`. Existing Quarantine retains invalid fields per candidate. A 403 or detected challenge stops the run. A 429 or transient connection or HTTP failure follows the retry policy.
- Within one attempt, normalised detail URLs deduplicate links, and existing Generic Record validation and identity handle duplicate records. A terminal Job publishes one attempt's results. File storage and PostgreSQL commit separately, so an invalidated attempt can leave unreferenced Evidence files.

Public network transport uses libcurl DNS pinning. [libcurl CURLOPT_RESOLVE](https://curl.se/libcurl/c/CURLOPT_RESOLVE.html)

Robots rule matching follows the applicable portions of the Robots Exclusion Protocol. [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html)

## Single-document rendering for controlled local fixtures

An operator may opt in to a rendered DOM on a Web Profile for an approved, self-authored local HTTP fixture. Set `CORE_RENDER_FIXTURE_ORIGIN` on the API and worker to its exact registered controlled origin. The Source retains its path and permission checks. The source's `rendering-policy` endpoint reports the eligible origin. A Profile without a `rendering` field keeps its original configuration hash.

```json
{
  "rendering": {
    "ready_selector": "#catalog-ready",
    "script_sha256": ["638895eb8531a2d47a01c9279503d990a3a04423e5fa5da717fd2457ac42c1d2"],
    "timeout_ms": 1500
  }
}
```

The example hash identifies the inline script in the repository’s controlled catalogue. Supply the SHA-256 of the inline script’s parsed text encoded as UTF-8, including whitespace. HTML parsing normalizes line endings to LF. One to eight lowercase hexadecimal hashes are accepted. The CSS readiness selector must fit within 1,024 characters. The readiness timeout defaults to 1,500 ms and accepts 250–5,000 ms. This mode handles one URL per input. Search and pagination require their existing static Profiles.

Provision Node.js, the frontend lockfile’s Playwright installation and a sandbox-capable Chromium on each execution host. `CORE_RENDER_NODE_MODULES` can identify that dependency directory. `CORE_RENDER_BROWSER` can specify the full browser executable path. The standard Core worker image does not provision this optional runtime. An unavailable renderer returns `render_unavailable`.

The HTTP adapter checks the registered origin, robots policy and response before rendering. A restricted fresh browser runs the approved inline code against the captured HTML with network access disabled. Publisher HTTP content security policy, unapproved scripts and disallowed resource requests end the attempt with a readable failure. Readiness timeouts use the Job’s existing bounded transient retry policy. The renderer caps serialized DOM at 1 MiB.

Preview, validation and queued jobs extract from the generated DOM. Evidence retains the original HTTP bytes and digest. A successful render adds a distinct `rendered_dom` receipt with the derived HTML’s SHA-256, byte count, collection time and Chromium version. The Evidence store saves both files together and verifies both at readback. Records retain their source, Profile version and Evidence reference.
