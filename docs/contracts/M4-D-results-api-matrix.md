# M4-D API Contract Matrix

This is the historical M4-D contract. The later API supports Job-scoped Evidence lookup and omits `storage_reference`. [M4 Closure API Contract](M4-closure-api-contract.md)

Baseline was M4-C documentation commit `bb7c856`. Review covered FastAPI routes, live `GET /openapi.json`, local `create_app().openapi()`, M1 ingestion and Evidence, M2 migration `0004`, and M3 Job publication. The paths below omit `/api/v1`.

| Capability | API | Contract and navigation |
| --- | --- | --- |
| Records List | `GET /records` | `Record[]`, optional UUID `job_id`, and an empty array for no match. Ordered by `created_at, id`. |
| Record Detail | `GET /records/{record_id}` | Same `Record` DTO queried by persisted UUID. Unknown ID returns 404. |
| Evidence Detail | `GET /evidence/{evidence_id}` | Query `Evidence` by UUID. Unknown ID returns 404. |
| Quarantine List | `GET /collection-jobs/{job_id}/quarantine` | `QuarantinedRecord[]`, ordered by position index and ID. Unknown Job returns 404. |
| Job Link | `GET /collection-jobs/{job_id}` | All three result DTOs have `job_id`. Job provides status, three distinct counts, and pinned Profile. Events use a separate endpoint. |
| Source Link | `GET /sources/{source_id}` | All three DTOs contain `source_id`. The existing Source view loads details. |
| Profile Version Link | `GET /sources/{source_id}/versions/{version_id}` | All three DTOs include Source and Profile Version IDs. The existing Profile view loads version number, approval status, and approval history. |
| Job → Evidence | Via Job-scoped `/records` or `/quarantine` | Job DTO has no Evidence ID. Use `evidence_reference` from a result row. A Job with Evidence alone had no API lookup at M4-D. |
| Evidence → Records | `GET /records?job_id=…` | Opens the same Job's valid Records. The M2 schema allows one Evidence per Job, and composite FKs bind Records and Quarantine to the same Job and Evidence. No Evidence ID filter or reverse index. |
| Raw Evidence Retrieval | Unsupported | Local storage can validate bytes. There is no raw HTTP or download route. The UI omits internal `storage_reference`. |
| Global Evidence / Quarantine, full-text search, totals | Unsupported | Open Evidence from a result link or ID route. Quarantine is Job-scoped. Full-text search, totals, and cross-Job Quarantine are unavailable. |

Both result lists use `limit` from 1 to 100, default 50, and `offset` from 0 to 2147483647, default 0. There is no total. The frontend fetches page size plus 1 to determine Next. Invalid UUIDs and pagination return 422. DB connectivity errors return 503. These GETs have no write conflict workflow. Job and results DTOs emit hyphenated UUIDs and Source and Profile emit hex. FastAPI paths accept both.

- **Record** stores `record_id`, `job_id`, `source_id`, `profile_version_id`, `record_type`, `schema_version`, nullable `source_record_key`, `deduplication_key` (SHA-256), `payload`, `source_position`, fixed `validation_status: passed`, `evidence_reference`, `created_at`, and `provenance`. Payload is a scalar object with string, integer, number, boolean, and null. The JSON viewer can display nested JSON too. Provenance includes Source, Run, Profile Version IDs, config SHA-256, and validation status.
- **QuarantinedRecord** has `record_id` (Quarantine entry UUID), Job, Source and Profile Version IDs, `evidence_reference`, `source_position`, `created_at`, and `problems[]`. A problem has `code`, nullable `field`, and `message`. CSV positions identify the physical start line, affected by headers and multiline fields. HTML positions are one-based item indexes. Duplicates have their own Job count. Persistence writes only invalid candidates to Quarantine.
- **Evidence** includes Evidence, Job, Source, Profile Version, and Run IDs, `config_hash`, `captured_at`, `content_hash`, `content_type`, `adapter_type`, `original_location`, `requested_location`, and `http_status`. Requested location, HTTP status, and content type are nullable. CSV original location is the dataset ID. Position belongs to Record or Quarantine. Evidence describes the complete capture. Metadata also carries internal `storage_reference`, which the frontend omits. The UI shows the backend's stored SHA-256, and the browser does not hash raw bytes.
