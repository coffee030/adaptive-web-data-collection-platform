# M2 Persistence Architecture

This document records the M2 architecture and original migrations. M4 Closure retains the Source row lock, adds a required expected Draft revision and the 0006 Source request key and payload digest, and supports Evidence metadata lookup by Job. [M4 Closure API Contract](../contracts/M4-closure-api-contract.md)

FastAPI receives requests in `backend/api`, `backend/application` starts use-case transactions, and `backend/persistence` owns the ORM and PostgreSQL. The separate `backend.cli` uses the same `JobExecutor`. The M1 `CollectionRunner`, Scrapling and CSV adapters, `ingest()`, canonical hash, and `LocalEvidenceStore` remain in `backend/core`.

| Migration | Table | Relations and data |
| --- | --- | --- |
| 0001 | `sources` | UUID, adapter, authorisation, permission reference, and JSONB input policy |
| 0001 | `profile_versions` | Source FK, unique `(source_id, version)`, JSONB config, schema, hash, Draft revision, and approval audit |
| 0002 | `profile_validation_reports` | Profile FK, revision, hash, sequence, UTC time, and JSONB diagnostics. Approval uses a composite FK to a report for the same version and hash. |
| 0003 | `collection_jobs` | Composite FK pins Source, Profile Version, and config hash. Includes state, counts, time, input hash, and optional request key. |
| 0003 | `execution_events` | Job FK. Status and errors are read by sequence. |
| 0004 | `raw_evidence` | One per Job and unique per Run. Capture metadata, raw data SHA-256, and relative storage reference. |
| 0004 | `generic_records` | Composite FK to Evidence in the same Job, JSONB payload and position, and unique `(job_id, deduplication_key)`. |
| 0004 | `quarantined_records` | Composite FK to Evidence in the same Job, one per position, with JSONB problems. |

M2 generates the Core string Source ID from a UUID. SQL `id` maps to domain IDs. The Core `GenericRecord.record_id` is a SHA-256 identity saved unchanged as `deduplication_key`. REST `record_id` is UUIDv5 derived from the Job UUID and that key. FK joins recover Source, version, hash, and Run lineage. The database uses `timestamptz` and UTC connections. M2 has one input and one M1 Run per Job. Evidence metadata stores `run_id`. Executions without Evidence are traceable through Job and events. M1 `completed` maps to M2 `succeeded`.

Profile writes serialise on the Source row with `FOR UPDATE`. Creation, edits, approvals, retirement, authorisation changes, and Job creation for the same Source share the lock order. The M1 repository can read a transaction-scoped snapshot and reuse approval rules. Preview and Validation I/O run outside the transaction. Publishing validation relocks the Source, checks Draft revision and authorisation, applies existing report and hash checks, and inserts the report. Returning to the original hash does not revive an older revision's report. Insertion sequence determines the latest report. Approval checks supplied hash, Source authorisation, current passing report, and operator, then commits once. A DB trigger protects approved config, identifiers, and approval data while allowing approved → retired.

Claim locks the Job row and commits `running` with an event before execution. The runner rechecks version and Source authorisation. Web reads current authorisation before robots and each hop. Jobs not yet started fail after retirement. Work already in the runner can complete. On completion, relock the Job, verify finalised Evidence, write Evidence metadata, Records, Quarantine, counts, and the terminal event, and commit together. A failed results commit rolls back all results and the executor attempts to record failure separately. Normal terminal states clear temporary input JSONB and retain the hash and request key.

`LocalEvidenceStore` stages and renames capture files on one filesystem. Verification rereads metadata and bytes, computes SHA-256, and publishes DB metadata only after it passes. Filesystem and database commit separately. Rollback or process termination can leave files without a DB row. After stopping all executors, compare 32-character UUID hex directories under the Evidence root with `raw_evidence.id`. Verify files are unreferenced before acting on them. Retain original files for investigation when the database is down or a result is unconfirmed.
