# M0 Core Contracts

These are conceptual contracts. Fields express meaning across services and adapters. The relevant milestones will decide the actual SQL schema, API DTOs, and deployment. Use opaque IDs for entities, record UTC times, and version snapshots and payloads.

| Entity | Fields | Invariants |
| --- | --- | --- |
| Source | `source_id`, `source_name`, `adapter_type`, `allowed_origins`, `permission_reference`, `approval_status` | A `web` Source has an exact-origin allowlist and an authorisation record. A `csv` Source uses dataset permission and import boundaries. Stop issuing new requests when authorisation is suspended or revoked. |
| Source Profile Version | `profile_version_id`, `source_id`, `version`, `extraction_config`, `record_type`, `schema_version`, `validation_status`, `approval_status`, `config_hash` | Versions are unique within a Source. An edit to a Draft invalidates prior validation. A report records the current hash, sample, and result. Human approval must apply to the same validated hash and record the approver, time, and decision. Approved content is immutable. Retirement changes availability and retains history. |
| Generic Record | `record_id`, `record_type`, `schema_version`, `source_record_key`, `payload`, `source_position`, `evidence_reference`, `provenance` | Interpret payload by `record_type` and `schema_version`. Source position is a DOM record index or key or a CSV row reference. Deduplication and Task idempotency have separate roles. |
| Evidence | `evidence_id`, `source_reference`, `task_reference`, `profile_version_reference`, `original_location`, `captured_at`, `content_hash`, `storage_reference`, `metadata` | Keep verifiable original bytes and SHA-256. Web metadata tracks requested and final URLs, status, permitted headers, and attempt. CSV metadata tracks dataset ID, encoding, and import details. The system manages storage references. |
| Collection Job | `job_id`, `source_id`, `profile_version_id`, `status`, `created_at`, `started_at`, `finished_at`, `error_summary` | At creation, verify both Source authorisation and validation and approval of the specified Profile for the same `source_id`. Pin the Job to that version and config hash. |
| Collection Task | `task_id`, `job_id`, `input_key`, `status`, `attempt_count`, `idempotency_key`, `error_code` | A canonical page URL or dataset segment determines `input_key`. Queue payload carries `task_id`, and the worker reads durable state. Record attempts, errors, terminal states, and duplicate delivery. |

## Profile and authorisation workflow

`draft → preview → validate → human approval → approved version → job`. Preview may show a limited sample, selector match counts, field errors, and an Evidence reference. Source Access Policy applies throughout. A Draft creates a new version for new configuration. A new Job transaction locks and checks consistency among Source, Profile Version, and validation snapshot. Before running, the worker rechecks current Source authorisation and uses the pinned extraction version. Define how to stop in-flight work upon operator revocation while retaining existing Evidence and audit.

## Shared ingestion and durable execution

- The web adapter reads approved HTTP pages and returns candidate payload, source position, and Evidence. The CSV adapter produces the same candidate shape from a bounded import and preserves the original file and row reference. Both share schema validation, normalisation, Quarantine, record deduplication, and storage. The CSV contract preserves permission, dataset version, and size and format limits.
- PostgreSQL stores Jobs, Tasks, attempts, and outcomes. FastAPI creates durable Jobs and Tasks before Celery dispatch. Dispatch failures need a retryable state so a successful DB write cannot silently lose queued work. Workers acknowledge after writing results or failures. Conditional transitions and a unique idempotency key control duplicate delivery. Queue payload and events carry safe identifiers and diagnostics only.
- Initial Task states are `pending → queued → running → succeeded/failed`. Bounded transient retries record each attempt and return to a dispatchable state. Job state derives from Task outcomes, dispatch state, and explicit partial-failure rules. Cancellation, scheduling, and recovery are future decisions.
- Write Evidence bytes safely before publishing metadata or Records. If Evidence is incomplete, retain diagnostics and prevent success. Verify content with hashes, separate permissions, and record Source, version, Job, Task, time, and validation results.
- FastAPI transport and Celery task wrappers can share Python services and domain functions, each with its own transaction and session. Scrapling and CSV import are adapters. ML and IA read through versioned Core Records interfaces. Downstream applications own their additional fields and analysis results.

## Open decisions

- Canonical serialisation for `config_hash`, Profile approval permissions, and validation report samples and thresholds.
- Record identity namespace by schema and Source, update semantics, cross-source deduplication, and Quarantine remediation.
- Evidence capacity, retention, deletion, access policy, orphan cleanup, and raw payload retention.
- Partial success and cancellation, DB-to-queue dispatch, fencing, indexes, and migrations.
- CSV dialect, encoding, dataset size limits, and schema release and compatibility.
