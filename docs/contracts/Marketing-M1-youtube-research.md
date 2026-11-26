# Marketing M1 backend contracts

The Adaptive Scalable and Observable Web Data Collection Platform hosts a separate marketing research module. This milestone adds a candidate downstream application while the formal FYP scope remains a reusable collection Core. The formal Proposal was unavailable in the checkout for direct comparison. Team review of the marketing scope and production policy is pending.

## Access and retention

The connector uses the official YouTube Data API with an API key. Public API results acquired this way remain subject to the policies for data collected without channel-owner credentials. The application allows only approved local research and denies analytics, aggregation, model training, commercial customer access, and exports. The capability contract reports `additional_permission_pending`. Eligibility for derived metrics and longer statistical retention requires explicit permission through YouTube's audit process. [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies)

- Every provider result has the YouTube attribution, operation, run ID, observation timestamp, and expiry. Channels and videos include canonical YouTube links. Normalized metadata and metrics expire after 28 days, and discovery leads expire after one day. Reads apply expiry immediately. The dispatcher purges expired rows at startup and on its one-minute maintenance cycle. Run the dispatcher continuously and apply the same deletion requirements to any backups and replicas before enabling research.
- A successful refresh replaces current statistics and removes videos missing from the authoritative video lookup or returned as non-public. If the channel is missing, its snapshot, posts, and cached leads are removed. Failed transient attempts leave current data available until its expiry. An explicit publisher access block halts requests and clears provider payloads. An operator can resume the connector after access is confirmed.
- Withdrawal removes the channel snapshot, posts, cached leads, and refresh runs, including in-flight refreshes. The operator-supplied channel ID stays in a local withdrawal record to prevent reacquisition. Withdrawal affects this deployment's copies. Manage any deletion at YouTube separately.
- Turning off research rejects research reads and purges stored provider payloads at dispatcher startup or maintenance. Turning off discovery removes cached leads and cancels discovery work.
- Marketing data is outside the Core's record, export, MCP, and immutable raw Evidence paths. The worker discards raw API responses after normalization. Routine automation uses synthetic fixtures.

## Data and state

| Contract | Identity and behavior |
| --- | --- |
| Creator and platform account | Local creator UUID associated with one validated YouTube channel ID. Repeat watches preserve the UUID. Cross-platform identity linking is deferred. |
| Content post | Globally unique YouTube video ID associated with its channel, with title, publication time, category, ISO 8601 duration, and lineage. Format remains `unsupported`. |
| Metric observation | Latest provider observation with an explicit timestamp. `available` requires a nonnegative number, including zero. `unavailable` and `hidden` have null values. Expiration removes observations and appears as `expired` on the account or discovery result. |
| Collection run | UUID with kind, state, attempt count, safe failure code, and counts for standard requests and search calls. Results and completion are committed together. Terminal operations are retained for seven days. |
| Discovery lead | Channel returned by a bounded query, in provider relevance order. A lead is separate from a scheduled watch. Audience composition, sponsorship quotes, and Hong Kong audience share remain outside this connector's contract. |

## HTTP interface

All paths are relative to `/api/v1/marketing`. The research API inherits the Core's loopback boundary and requires a separate operator bearer token. Responses carry `Cache-Control: no-store`.

| Method and path | Contract |
| --- | --- |
| `GET /capabilities` | Public permission status and eligible uses, with no provider payloads or connector credentials. |
| `POST /intelligence-requests` | Accepts a query-shaped request and currently returns `403 commercial_permission_pending` without scheduling provider work. |
| `PUT /research/accounts/{channel_id}` | Creates or updates a watch. The body accepts `refresh_hours` from 6 to 168, with 24 as the default. New watches are due immediately. |
| `GET /research/accounts/{channel_id}` | Returns account state, current research snapshot and posts, next refresh timestamp, and latest run status. |
| `POST /research/accounts/{channel_id}/refresh` | Returns `202` and the run. Reuses active research work or a run created in the previous 15 minutes. |
| `DELETE /research/accounts/{channel_id}` | Withdraws a watched or discovered channel and returns `204`. |
| `POST /research/discoveries` | Accepts a normalized `query` of 2–100 characters and returns a run. Matching pending or fresh searches are reused. Discovery requires a separate deployment opt-in. |
| `GET /research/discoveries/{run_id}` | Returns `pending`, `available`, `expired`, or `unavailable` and any current research leads. |
| `GET /research/runs/{run_id}` | Polls durable run status, safe failure code, and quota charged. |
| `POST /research/provider/resume` | Clears a publisher access block. Existing publisher cooldowns and quota limits still apply. |

The analytics milestone can use independently authorized or synthetic inputs. The frontend milestone can use the capability response and stable unavailable code for customer-facing UI. Production access, policy changes, and customer authentication need separate integration.

## Local deployment

Run the normal Core deployment with research disabled by default. To run approved research, use an isolated local Compose project. Set `MARKETING_YOUTUBE_RESEARCH=1` for the API, worker, and dispatcher. Provide `MARKETING_OPERATOR_TOKEN` to the API and a restricted `YOUTUBE_API_KEY` to the worker from untracked local configuration. Use a randomly generated token with at least 24 characters. Set `MARKETING_YOUTUBE_DISCOVERY=1` only if discovery is within the approved use. Apply Alembic through revision `0011` before starting the services.

The existing dispatcher checks PostgreSQL for due work, lease recovery, and cleanup. The existing Celery worker processes marketing messages through Redis. PostgreSQL holds the schedule, attempts, cooldowns, and quota counters. The deployment allows one active provider run, up to 20 watches, at most two pages of 25 recent uploads per scan, up to 50 retained posts per watch, and one page of up to 10 leads per discovery. An upload scan that reaches its limit without overlap reports `scan_truncated`. Use that field when interpreting the current scan's coverage.

Each outbound attempt is charged before sending. Local ceilings are 250 standard units and 10 search calls per Pacific day, with separate counters for the two buckets. A shared project key can also consume quota outside this deployment. Provider quota exhaustion waits for the next Pacific day where the run can still be retried. Choose discovery terms appropriate to the approved research purpose. Search results give channel leads and cannot establish audience location. [YouTube quota documentation](https://developers.google.com/youtube/data/determine_quota_cost), [YouTube channel search](https://developers.google.com/youtube/data/reference/rest/v3/search/list)
