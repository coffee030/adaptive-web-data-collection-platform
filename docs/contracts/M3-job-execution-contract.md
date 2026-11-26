# M3 Job Execution Contract

The `/api/v1/collection-jobs` request and initial 201 and idempotent replay 200 remain compatible. A 201 confirms that the Job and dispatch intent were written to PostgreSQL. Clients use `GET /api/v1/collection-jobs/{job_id}` or filter the list with `status`. Jobs can be pending, running, pausing, paused, cancelled, succeeded, partial or failed.

Operators use `POST /api/v1/collection-jobs/{job_id}/control` with an `action` of `pause`, `resume` or `cancel`. A pending Job becomes paused immediately. A running Job becomes pausing and its active attempt may finish. When an active paused attempt would retry, the Job becomes paused and keeps its original retry deadline. Resume makes it dispatchable when that deadline is due. Repeated deliveries cannot claim a held Job.

Cancellation ends unfinished work, removes its dispatch and lease, and fences subsequent publication. A request already in flight can finish. Future HTTP operations check the current attempt and source authorization. Previously committed results remain available. Finished Jobs reject control changes with HTTP 409. Repeating cancellation on a cancelled Job returns the same result. Upgrade to `core_job_control_01` before starting the updated services. The prior schema cannot store control history, so reverting after controls have been used requires a pre-upgrade backup.

| New Job field | Meaning |
| --- | --- |
| `execution_attempt` | Number of claims, starting at 0. While running, it is the fencing generation for the active attempt. |
| `lease_expires_at` | UTC deadline for a running lease. Expired leases are eligible for recovery. |
| `next_attempt_at` | Earliest execution retry in UTC, or null otherwise. |
| `dispatch_due_at` | First or next dispatch time for a pending Job, or null otherwise. |
| `last_dispatched_at` | Time of last confirmed publication. |
| `dispatch_attempts` | Total submitted publish attempts. |
| `dispatch_error_code` | Outstanding broker error, for example `broker_unavailable`. |

Job detail (`GET /api/v1/collection-jobs/{job_id}`) also includes the following nullable fields.

| Detail field | Meaning |
| --- | --- |
| `latest_claim_worker_instance_id` | Public UUID recorded on the latest successful claim. It continues to identify that claim while the Job waits for a retry. |
| `latest_claim_execution_origin` | `worker` for a Celery claim, `direct` for a CLI or other direct claim, or null when identity was never recorded or the Job is unclaimed. `execution_attempt: 0` identifies a Job that has never been claimed. |
| `latest_worker_heartbeat_at` | Last UTC heartbeat PostgreSQL received from the latest claim's Worker instance. Null when no heartbeat is recorded. |
| `latest_worker_offline_detected_at` | First UTC observation by the presence watchdog after 15 seconds without a heartbeat. A later heartbeat from the same instance clears this field. |

The Worker parent sends a heartbeat every five seconds, including while its child is busy. The Dispatcher checks presence every five seconds. A missing heartbeat reports an observation about that Worker. Job recovery follows the execution lease. A Celery claim has a 30-second lease renewed by its running child every ten seconds. Renewal locks the Job and checks the current attempt and unexpired deadline against PostgreSQL time. A direct CLI claim retains its fixed 90-second lease. Worker presence requires schema revision `core_worker_presence_01`.

`pending → running → succeeded / partial / failed`. Retryable failures and lease recovery move `running → pending`, preserve the input, and clear the current `started_at`. A new claim sets a new `started_at`. Earlier start times remain in events. Terminal states retain counts and errors, release the lease, and clear temporary input.

The Events API returns entries in persisted sequence order with `status`, `kind` and `execution_attempt`. It includes `JOB_CREATED`, `DISPATCHED`, `DISPATCH_FAILED`, `CLAIMED`, `RETRY_SCHEDULED`, `WORKER_LOST`, `RECOVERY_REQUESTED`, and terminal events. `kind` and `execution_attempt` can be null for historical M2 events. `CollectionError` adds nullable `retry_after_seconds` and retains the existing fields.

| Event field | Meaning |
| --- | --- |
| `worker_instance_id` | Public UUID of the Worker that claimed this Job and attempt. Null for direct execution, legacy claims with no attribution and events outside execution, including creation and dispatch. |
| `execution_origin` | `worker` or `direct` from the attempt's claim. Null for historical claims with no attribution and events outside execution. |

Each Celery node generates a random public UUID once during startup. Its prefork children inherit that UUID, including replacement children. Concurrent replicas have distinct IDs and a restarted node gets a new one. The UUID encodes no host, broker or credential information. PostgreSQL stores the owner on the `CLAIMED` event in the same transaction that advances the attempt and sets the lease. Retry, recovery and terminal events resolve their owner from the claim for the same Job and attempt. In particular, `WORKER_LOST` refers to the owner of the expired attempt. The Dispatcher emits that event. Upgrade the schema to Alembic revision `0010` before starting the new application services. The migration leaves existing claims with unknown attribution.

Job creation, Job list, Collection Request child summaries and the MCP status projection retain their existing fields. Record CSV and JSON export schemas are unchanged.

| Condition | Execution policy |
| --- | --- |
| Network transport, timeout, temporary DB connection or pool error | 10 seconds, then 20 seconds, at most three claims |
| HTTP 429 | 30 seconds, then 60 seconds, respecting a later valid Retry-After |
| HTTP 5xx, including unavailable robots policy | 10 seconds, then 20 seconds, respecting a later valid Retry-After |
| Lease expiry | At most three claims. The next claim is eligible five seconds after the expired lease deadline. A watchdog that observes the loss later uses the same deadline. |
| HTTP 401 or 403, explicit challenge, unauthorised access, robots denial, or other HTTP 4xx | Terminal failure |
| Retired or invalid Profile, content and validation errors, Evidence error, and non-transient SQL failure | Existing failed or partial outcome |

`Retry-After` accepts delta-seconds or an HTTP date with time zone. Invalid values use fixed backoff. End the Job above 300 seconds. An attempt allows up to one robots request and three same-origin document requests, each attempted once. The Job allows at most 12 controlled HTTP requests. Preview and Validation retain separate bounded limits. If a stopped DB prevents claiming, a pending Job is redispatched after the deadline. A claimed Job recovers by lease. The Celery task has no retry or ETA scheduling.

The CLI accepts a Job UUID and shares claim, lease, and retry behaviour. Its successful claim records `direct` with a null Worker UUID. The Dashboard displays **Direct execution**, **Unknown Worker**, or **Awaiting first claim** as appropriate. Success and partial return exit 0. Other outcomes return exit 1, and scheduled retry is visible through the API. A running Dispatcher can claim the same Job first.
