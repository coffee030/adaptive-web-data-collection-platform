# Worldwide trend collection

The Core exposes daily Wikimedia article pageviews through the local operator API. An operator can discover popular topics by Wikipedia edition, start and pause saved article series, and compare dated counts. Any Wikipedia language edition can be requested. Edition identifies where an article was published. The series does not identify a reader's location or measure Google search interest.

## Operate a collection

Use the same loopback address, operator authorization and same-origin approval setting used for **Sources**. FastAPI serves the trend routes under `/api/v1/trends/wikimedia`. In an installed Core console, open `/docs` on its local API for the interactive request schema or use the endpoints below. An ordinary Core dispatcher and worker must be running.

| Action | Request |
| --- | --- |
| Discover dated popular articles | `POST /discover` with `{"project":"ja.wikipedia.org","day":"2026-11-24","limit":20}`. Select a completed UTC date. The response identifies the publisher's top-list URL and retains its published ranks without renumbering. |
| Approve the Wikimedia source | `POST /provider` with `project`, a discovered article title, a completed sample `day` and an operator `approver`. The sample is validated through the pinned Core CSV mapping before its approval. Check `GET /provider` for the live authorization, policy and next request time. |
| Schedule a series | `POST /series` with `project`, `article`, the initial `day` and a user-assigned `topic`. The initial date can be 2–90 days ago. One saved series per edition/article keeps its identity across replay. `GET /series` displays pending and last Core Job IDs, the data cursor, last check and next scheduled time. |
| Pause or resume a saved series | `PATCH /series/{id}` with `{"active":false}` or `{"active":true}`. An already queued job can finish. |
| Recheck older values | Include `backfill_from` in a series update to resume from a date in the saved series within the last 90 days. Wait for the pending job to finish first. |
| Compare and inspect provenance | `GET /compare?watch_id=…&watch_id=…&start=YYYY-MM-DD&end=YYYY-MM-DD` aligns up to eight series over up to 90 UTC days. Each point links its Job, Record, normalized CSV Evidence and provider response digest. `GET /captures/{job_id}` returns the exact upstream response for a validated batch. The normal Core Records and job CSV/JSON exports also contain these typed observations. |

The customer-visible trend read is released after the Core job succeeds with the expected number of validated, unique rows. The scheduler advances through the publisher dates, with a two-day availability lag and an overlap of three days on subsequent checks. A missing day stays null. An observed zero stays zero. A later available value or correction keeps the edition/article/day identity, and Core retains its preceding evidence. An unchanged recheck advances the schedule without creating another job. Coverage is reported as observed days over requested days. First-to-last change requires a complete selected interval. Percentage also requires a nonzero baseline. Raw volumes reflect differences in traffic between language editions.

## Source rights, retries and withdrawal

The [Wikimedia Analytics API access policy](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html) specifies CC0 data, an identifying User-Agent and serial requests. This adapter uses public HTTPS, no signing credentials, no redirects, bounded responses and a shared database request window. A 429 delays new requests to the API for at least an hour and honours a longer Retry-After. Other transient errors preserve the last published values. An explicit denial stops subsequent upstream requests and stays visible to the operator. Resumption after an explicit publisher denial requires review of the publisher's access decision.

A trusted operator can revoke the source from the Core Sources workflow. Trend reads and scheduled acquisition stop after revocation. The Core retains previous Jobs, Records and captures in its trusted audit storage. These public CC0 records have no provider deletion deadline. A new provider with different terms would require its own retention rules. If the mapping profile was retired, validate and approve a replacement with the same mapping and submit source approval again to select it. This recheck preserves space for an existing publisher block.

The top list and daily article views are separate Wikimedia Analytics measures. The top-list order is useful for discovering subjects, including pages used to navigate the site. The scheduled counts are raw all-access, user-agent-filtered article pageviews. This slice does not fetch Wikimedia country datasets. [Pageview definitions](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/concepts/page-views.html) · [Endpoint reference](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html)
