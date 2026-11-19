# M5 Downstream Integration Contract

The M6 and M7 data entry point was the trusted local `/api/v1`. Applications consume REST JSON with their own domain schema. The Core retains original data and lineage, while downstream storage holds import checkpoints, derived attributes, and analysis results. Source access and Profile Approval are separate actions. Get the machine-readable schema at `/openapi.json` on the running API origin. [M4 Closure contract](M4-closure-api-contract.md)

## Supported routes

The following paths omit `/api/v1`.

| Resource | Routes |
| --- | --- |
| Health | `GET /health` checks PostgreSQL. Inspect Dispatcher, workers, and events for queue health. |
| Source | `GET`/`POST /sources`, `GET /sources/{source_id}`, `PATCH /sources/{source_id}/authorization`. |
| Profile | `GET` and `POST /sources/{source_id}/versions`, `GET` and `PUT /sources/{source_id}/versions/{version_id}`, and version-level `POST /preview`, `/validate`, `/approve`, and `/retire`. |
| Job | `GET`/`POST /collection-jobs`, `GET /collection-jobs/{job_id}`, `GET /collection-jobs/{job_id}/events`. |
| Record | `GET /records?job_id=…&limit=…&offset=…`, `GET /records/{record_id}`. |
| Quarantine | `GET /collection-jobs/{job_id}/quarantine?limit=…&offset=…`. |
| Evidence | `GET /evidence/{evidence_id}` and `GET /collection-jobs/{job_id}/evidence`. The latter returns 200 `null` for an existing Job without a capture. |

Job POST requires `source_id`, `profile_version_id`, and `entry`. HTML entry uses `adapter_type: "web"` and `url`. CSV uses `adapter_type: "csv"`, `dataset_id`, and UTF-8 `content`. Source POST requires `source_name`, `adapter_type`, `permission_reference`, and applicable `allowed_origins` or `allowed_datasets`. Source creation accepts an explicit authorisation status and defaults to pending. The console workflow uses terminal PATCH. Supply UUID `request_key` values for Source and Job requests. First creation returns 201, identical replay 200, and conflict 409. Job keys are scoped to each Source. Source creation keys are globally unique. Neither key appears in the success DTO. Approval requires `approver`, `report_id`, and `config_hash`. Draft PUT needs `configuration` and `expected_revision`. A missing revision returns 428 and a stale one 409.

## DTO and lineage

The table lists all response fields. Nullable fields still appear in JSON. Write models and response DTOs are separate.

Pydantic defaults drive OpenAPI response `required`. Source `approval_status` and both lists, Profile status and approval fields, and Provenance `validation_status` have defaults and still serialize in runtime responses. OpenAPI marks only three common CreateSource fields required. The runtime policy checks the adapter-specific allowlist. DraftEdit's OpenAPI marks `expected_revision` as nullable with a default. An actual Draft write requires it.

| DTO | Fields present | Nullable | Mutability |
| --- | --- | --- | --- |
| Source | `source_id, source_name, adapter_type, permission_reference, approval_status, allowed_origins, allowed_datasets` | None. The applicable list has at least one entry and the other is empty. | The API changes only `approval_status` (pending, approved, or revoked). |
| ProfileSnapshot | `source_id, profile_version_id, version, revision, configuration, config_hash, approval_status` | `approved_by, approved_at, validation_report_id` are null in Draft and required after approval. | Draft revision increments from 1. Approved and Retired identity, config, hash, and audit are fixed. Approved versions can be retired. |
| Job | `job_id, source_id, profile_version_id, config_hash, status, created_at, valid_count, invalid_count, duplicate_count, execution_attempt, dispatch_attempts` | `started_at, finished_at, error, lease_expires_at, next_attempt_at, dispatch_due_at, last_dispatched_at, dispatch_error_code` | Source, Profile, hash, and submission identity are fixed. The orchestrator updates state, attempts, times, and counts until terminal. |
| ExecutionEvent | `event_id, job_id, status, occurred_at` | `kind, execution_attempt, error`. Historical kind and attempt may be null. | API array order follows DB sequence. Events are append-only. |
| Record | `record_id, job_id, source_id, profile_version_id, record_type, schema_version, deduplication_key, payload, source_position, validation_status, evidence_reference, provenance, created_at` | `source_record_key`. Optional payload values may be null. | No update API after publication. Payload values are scalar (string, integer, number, boolean, null), and `validation_status=passed`. |
| QuarantinedRecord | `record_id, job_id, source_id, profile_version_id, evidence_reference, source_position, problems, created_at` | `problems[].field`. Each problem has `code` and `message`. | No update API after publication. ID refers to the Quarantine entry. Duplicates are counted separately and have no Quarantine row. |
| Evidence | `evidence_id, job_id, source_id, profile_version_id, config_hash, run_id, captured_at, content_hash, adapter_type, original_location` | `requested_location, http_status, content_type`. | At most one published capture per Job at this milestone. Metadata has no update API. HTML location is a URL and CSV location is a dataset ID. |

`Record.provenance` includes `source_id, run_id, profile_version_id, config_hash, validation_status`. Record and Quarantine `source_position` includes `kind, index` as a 1-based HTML item or physical CSV start line. Headers and multiline fields count in line numbers. Source, Profile, and nested provenance often use unhyphenated UUIDs. Outer Job, Record, Quarantine, and Evidence UUIDs are hyphenated. Compare by UUID value. Time includes UTC offset. HTTP errors use `error.code` and `message`. Request validation may include `fields`. Job and event errors have `code, message, http_status, retry_after_seconds`, with the last two nullable.

## Consumption protocol

1. Submit using an authorised Source and Approved Profile. Persist `job_id`, immutable Profile pin, and request intent. Replay unconfirmed submission using the original key and payload. Recover or reread an older Job by its ID.
2. Poll Job detail to `succeeded`, `partial`, or `failed` and use events to diagnose dispatch and failures. Pending and running can still retry. Treat counts as final at terminal state.
3. Load validated Records for `succeeded`. For `partial`, app policy decides whether to use the valid subset. Retain invalid and duplicate counts and the Quarantine link. For `failed`, record failure and use Evidence metadata if available. Only validated payload from the Records API enters the app.
4. Query `GET /records` with explicit `job_id` and `limit=100`. Advance by actual rows received. Stop on a short page and compare `valid_count`. A global live offset across Jobs can shift. A terminal Job's results are fixed through the existing API, so it supports per-Job checkpointing.
5. Use Core `record_id` as the downstream idempotency key. Rereading a Job returns the same IDs. First valid wins per Job. `deduplication_key` is SHA-256 over Source, record type, schema version, and identity or payload. A new Job may save a new snapshot for the same identity. Downstream owns cross-Job versioning.
6. Derived data keeps Core `record_id`, Job, Source, Profile, config hash, Run, Evidence ID, and Evidence content SHA-256. Distinguish original data from derived fields. Keep the input schema version and evolve the app's own mapping version.

Jobs, Records, and Quarantine default to 50 per page, maximum 100, with offset at most 2147483647. Jobs supports `status` and Records supports `job_id`. Source, Profile, and Events lack server pagination. Cancel and pause, fleet state, totals, global Quarantine and Evidence lists, cursor pagination, global search, CSV export, and raw Evidence download were outside this API. Redispatch uses commit fencing, while controlled HTTP requests can repeat.

M6 can define review text, rating, and provenance mapping. For M7, requirements still needed to determine inputs, policy, payload, and matching interface. Both could use these read and lineage contracts for later design.
