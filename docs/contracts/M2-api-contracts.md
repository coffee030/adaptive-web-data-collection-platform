# M2 REST API Contracts

This is the original M2 contract. Current Source POST replay, conditional Draft PUT, Evidence, and loopback HTTP behaviour are in the later closure contract. [M4 Closure API Contract](M4-closure-api-contract.md)

The development URL is `http://127.0.0.1:8000`. OpenAPI is at `/openapi.json` and `/docs`, and data routes use `/api/v1`. For audit, the local caller supplies operator identity. This environment relies on localhost and a trusted operator.

| Method | Path relative to `/api/v1` | Behaviour |
| --- | --- | --- |
| GET | `/health` | Checks DB connectivity with `SELECT 1` |
| POST, GET | `/sources` | Creates and lists Sources |
| GET | `/sources/{source_id}` | Reads a Source |
| PATCH | `/sources/{source_id}/authorization` | Changes Source access status |
| POST, GET | `/sources/{source_id}/versions` | Creates a Draft and lists by version number |
| GET, PUT | `/sources/{source_id}/versions/{version_id}` | Reads a version or updates a Draft |
| POST | Same version path plus `/preview` | Up to five candidates |
| POST | Same version path plus `/validate` | Saves a report and returns `passed`, counts, errors, sample hash, and config hash |
| POST | Same version path plus `/approve` | Approves the current Draft with `approver`, `report_id`, and `config_hash` |
| POST | Same version path plus `/retire` | Retires an approved version and retains previous approval and history |
| POST, GET | `/collection-jobs` | Creates a pending Job or lists Jobs with pagination |
| GET | `/collection-jobs/{job_id}` | Job status, pinned version, times, counts, and error |
| GET | Same Job path plus `/events` | Lists status events by sequence |
| GET | Same Job path plus `/quarantine` | Paginates entries with Evidence references and rule errors |
| GET | `/records`, `/records/{record_id}` | Paginates or reads one Record. The list can filter by `job_id`. |
| GET | `/evidence/{evidence_id}` | Relative storage reference, raw data SHA-256, and Source, Run, and Job lineage |

Creating a Source requires `source_name`, `adapter_type`, `permission_reference`, and a policy. Source access is `pending`, `approved`, or `revoked`, defaulting to `pending`. Web uses `allowed_origins` with exact `http://127.0.0.1:PORT` values. CSV uses `allowed_datasets`. Profile POST and PUT take `{"configuration": {...}}`, where configuration uses the M1 discriminated union. Source and Profile DTOs emit Core UUID hex strings. Job and result DTOs emit hyphenated UUIDs. UUID paths accept both.

Preview, Validation, and Jobs use the same controlled inputs. Web accepts `{"adapter_type":"web","url":"http://127.0.0.1:8001/table.html"}`. CSV accepts `{"adapter_type":"csv","dataset_id":"listings","content":"Name,Count\nAlpha,2\n"}`. CSV uses UTF-8 text up to 1 MiB after encoding and supports BOM. The API excludes server paths, file names, and arbitrary URLs. Preview and Validation read one sample within M1 limits. Job creation stores input and the pinned version for the separate CLI executor.

Job POST accepts `source_id`, `profile_version_id`, `entry`, and optional UUID `request_key`. First creation returns 201. Resubmitting the same Source, key, version, and input returns the existing Job and 200. Reusing a key with another version or input returns 409. A different or omitted key creates a new Job. Terminal states are `succeeded`, `partial`, and `failed`. Pagination uses `limit` from 1 to 100 with default 50 and `offset` with default 0.

All domain and request errors use `{"error":{"code":"…","message":"…"}}`. A 422 also returns `fields` locations and types. HTTP 400 means invalid domain input, 403 unauthorised access, 404 unknown ID, 409 approval or Job conflict, 413 oversized request, and 503 PostgreSQL temporarily unavailable. Responses omit database credentials, raw CSV request bodies, and stack traces.
