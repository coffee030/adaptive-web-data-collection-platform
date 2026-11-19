# M3 Reliability Decisions

2026-11-14 Hong Kong time. Implemented within the M3 scope, with peer review pending.

## ADR M3-01 Store dispatch intent in the Job row

Each Job has one controlled input and one task type. The team evaluated Job fields and a transactional Outbox table and chose Job fields. Job creation, dispatch intent, and the event commit together. The Dispatcher coordinates concurrent work one indexed due row at a time with `SKIP LOCKED`. Safe redispatch and idempotent claims address the gap between Redis publication and SQL commit. An Outbox could suit a future transaction that emits several independent messages. The current design holds a single Job lock during Redis I/O, so keep the socket timeout short and monitor backlog.

## ADR M3-02 Fixed lease and attempt generation

Each claim increments the generation using the PostgreSQL clock. The result transaction verifies ownership under lock before publishing. A 90-second lease and 60-second Linux hard limit are used without heartbeat renewals at this stage. This handles broker loss, crashes before claim, and hard termination after claim, which late acknowledgement or worker-loss requeue alone cannot cover. External HTTP work can repeat. SQL constraints and state transitions protect successful publication.

Migration 0005 adds dispatch and lease fields, two partial indexes, constraints, and event metadata. Existing pending Jobs become due. Terminal states are preserved. Existing running Jobs become expired attempt 1. Stop the M2 CLI and executors before migration so older processes cannot skip M3 ownership checks. The 0005 downgrade removes M3 metadata and retains existing result tables.

## ADR M3-03 Shared retry policy

The application decides execution retries from failure codes, HTTP status, and Retry-After. PostgreSQL manages the attempt budget. One polling service handles dispatch, lease recovery, and backoff. Celery handles transport. Scrapling makes one attempt per request. The policy favours one traceable terminal Evidence record. Previous failed-attempt files can be found through file and database comparison during downtime.

## ADR M3-04 Controlled tests and milestone scope

The Compose fixture is explicitly enabled, limited to a fixed origin, and uses an internal network. M2's default loopback rules and Source authorisation remain in effect. The brief called for one default worker, two test workers, multi-worker claims, and the Job API. The teammate brief's four-worker workload, fleet heartbeats, and statistics were extended verification. M4 UI, public-site egress, and general rate limiting were deferred to their milestones.
