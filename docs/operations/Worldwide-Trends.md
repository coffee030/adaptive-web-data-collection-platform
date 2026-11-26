# Worldwide trend collection

Open **Worldwide trends** from the Core Collection workspace or Operations desk. The browser and local operator API use the same dated Wikipedia series. An operator can discover popular topics by Wikipedia edition, start and pause saved article series, and compare dated counts. Any Wikipedia language edition can be requested. Edition identifies where an article was published. The series does not identify a reader's location or measure Google search interest.

## Operate a collection

Use the same loopback address, operator authorization and same-origin approval setting used for **Sources**. FastAPI serves the trend routes under `/api/v1/trends/wikimedia`. Use the following request paths with an authorized local client. An ordinary Core dispatcher and worker must be running.

| Action | Request |
| --- | --- |
| Discover dated popular articles | `POST /discover` with `{"project":"ja.wikipedia.org","day":"2026-11-24","limit":20}`. Select a completed UTC date. The response identifies the publisher's top-list URL and retains its published ranks without renumbering. |
| Approve the Wikimedia source | `POST /provider` with `project`, a discovered article title, a completed sample `day` and an operator `approver`. The sample is validated through the pinned Core CSV mapping before its approval. Check `GET /provider` for the live authorization, policy and next request time. |
| Schedule a series | `POST /series` with `project`, `article`, the initial `day` and a user-assigned `topic`. The initial date can be 2–90 days ago. One saved series per edition/article keeps its identity across replay. `GET /series` displays pending and last Core Job IDs, the data cursor, last check and next scheduled time. |
| Pause or resume a saved series | `PATCH /series/{id}` with `{"active":false}` or `{"active":true}`. An already queued job can finish. |
| Recheck older values | Include `backfill_from` in a series update to resume from a date in the saved series within the last 90 days. Wait for the pending job to finish first. |
| Compare and inspect provenance | `GET /compare?watch_id=…&watch_id=…&start=YYYY-MM-DD&end=YYYY-MM-DD` aligns up to eight series over up to 90 UTC days. Each point links its Job, Record, normalized CSV Evidence and provider response digest. `GET /captures/{job_id}` returns the exact upstream response for a validated batch. The normal Core Records and job CSV/JSON exports also contain these typed observations. |

The operator-visible trend read is released after the Core job succeeds with the expected number of validated, unique rows. The scheduler advances through the publisher dates, with a two-day availability lag and an overlap of three days on subsequent checks. A missing day stays null. An observed zero stays zero. A later available value or correction keeps the edition/article/day identity, and Core retains its preceding evidence. An unchanged recheck advances the schedule without creating another job. Coverage is reported as observed days over requested days. First-to-last change requires a complete selected interval. Percentage also requires a nonzero baseline. Raw volumes reflect differences in traffic between language editions.

## Source rights, retries and withdrawal

The [Wikimedia Analytics API access policy](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html) specifies CC0 data, an identifying User-Agent and serial requests. This adapter uses public HTTPS, no signing credentials, no redirects, bounded responses and a shared database request window. A 429 delays new requests to the API for at least an hour and honours a longer Retry-After. Other transient errors preserve the last published values. An explicit denial stops subsequent upstream requests and stays visible to the operator. Resumption after an explicit publisher denial requires review of the publisher's access decision.

A trusted operator can revoke the source from the Core Sources workflow. Trend reads and scheduled acquisition stop after revocation. The Core retains previous Jobs, Records and captures in its trusted audit storage. The API policy makes these aggregate counts available under CC0 and gives no fixed retention period. A new provider with different terms would require its own retention rules. If the mapping profile was retired, validate and approve a replacement with the same mapping and submit source approval again to select it. The recheck preserves any existing publisher block.

The top list and daily article views are separate Wikimedia Analytics measures. The top-list order is useful for discovering subjects, including pages used to navigate the site. The scheduled counts are raw all-access, user-agent-filtered article pageviews. This slice does not fetch Wikimedia country datasets. [Pageview definitions](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/concepts/page-views.html) · [Endpoint reference](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html)

## Google Trending Now RSS

The official RSS export supplies emerging searches for a selected region, with publisher timestamps and approximate traffic buckets. Store the bucket as reported together with its lower bound. An absent bucket stays unavailable. The feed scope and the event's first published timestamp are separate from when the Core observed the event. This source requires [Google Trends attribution](https://support.google.com/trends/answer/4365538) and compliance with [Google's terms](https://policies.google.com/terms). The collector reads the current robots rules and makes bounded, serial requests. It respects Retry-After and remembers an explicit refusal in the deployment Redis store. Review the current publisher instructions before any deliberate change to that refusal record. [RSS export guidance](https://support.google.com/trends/answer/3076011)

With the normal Core stack running, use the Compose dispatcher for capture so the command uses its configured shared Redis origin limiter. For submit and comparison, use the existing Core Python environment and loopback operator API. Supply the current operator bearer through `CORE_OPERATOR_TOKEN` when the workspace requires it. Create source approval only after verifying permissions and a sample.

```text
docker compose exec -T dispatcher python -m backend.trends.google_cli capture HK - > hk-first.json
python -m backend.trends.google_cli approve-source hk-first.json --approver "Local operator"
python -m backend.trends.google_cli submit hk-first.json --source SOURCE_ID --profile PROFILE_ID
python -m backend.trends.google_cli compare --job FIRST_JOB_ID
```

Set `--origin` to the address used by the local Core installation if it differs from `http://127.0.0.1:5173`. Commands return a Core Job ID. Check its status, records and CSV or JSON export through the normal Core workspace. Reusing the exact same captured receipt and baseline reuses the same Job. For refresh, collect a new timestamped receipt in the same region and pass the prior captured receipt as `submit --previous hk-first.json`. New events and differently reported traffic are retained. The command treats an initial event with an unknown bucket as an observation and drops duplicate unchanged events from a delta. Compare up to eight completed jobs together by repeating `--job`.

The command also supports one-off capture and replay. The trusted Core audit retains earlier jobs and evidence according to their recorded uses. The RSS export supplies rising searches for each requested region.

### Recurring regions

Open **Worldwide trends → Google Trending Now**. Under **Source approval**, have the local operator validate a sample and approve the source. An existing compatible Core approval from the CLI can be reused. Add a region and choose an interval from 10 minutes to 24 hours. The first collection is due immediately. The first successful read verifies whether Google serves that region. The default interval is one hour, counted from completion of the last check.

Every check uses Google's published RSS endpoint and the shared origin limits. The dispatcher preserves due times and claims across restarts. A claim interrupted before staging can be retried after its lease. A submitted Core job finishes through the normal worker and advances the region's snapshot only after the accepted counts match the validated input. Unchanged items preserve their original record and evidence. The snapshot's source timestamp and digest identify the latest verified feed. The timestamp on an individual observation identifies when its reported bucket last changed. A missing bucket is unknown, and a successful empty feed is recorded as a verified snapshot with zero items.

Pausing prevents new acquisitions and discards any capture still in progress before job submission. A submitted job may finish. A transient failure leaves the previous snapshot readable and defers further requests. Explicit publisher denial stops automatic acquisitions across regions. Resume and source reapproval preserve that stop. Revoke the Core source to stop collection and hide trend snapshots. The trusted audit retains the historical Core records. Review any changed publisher terms and access decision before considering a new grant.

Operators can also call the local REST routes under `/api/v1/trends/google`. Read or approve `/provider`, add or list `/schedules`, change activity or interval with `PATCH /schedules/{region}`, and read `GET /schedules/{region}/snapshot`. All times returned by the scheduler include their offset.
