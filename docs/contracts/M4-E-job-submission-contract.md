# M4-E Job Submission Contract

M4 Closure retains the Job submission contract and adds Draft, Source, Evidence, loopback, and pagination details. [M4 Closure API Contract](M4-closure-api-contract.md)

The audit compared checkout `create_app().openapi()`, isolated FastAPI `GET /openapi.json`, `backend/api/jobs.py`, and `backend/application/jobs.py`. The POST operation and the five CreateJob, WebEntry, CsvEntry, Job, and ExecutionEvent schemas agreed. OpenAPI lists 200, 201, and 422. Application exception handlers return other domain errors.

| Operation | Request and result |
| --- | --- |
| GET `/api/v1/sources` | Returns Sources with actual `approval_status`, adapter, and allowed origins or datasets. |
| GET `/api/v1/sources/{source_id}/versions` | Returns version history. Draft, Approved, and Retired are distinct. Only Approved can be submitted for new work. |
| POST `/api/v1/collection-jobs` | Accepts UUID `source_id`, UUID `profile_version_id`, discriminated `entry`, and optional UUID `request_key`. The UI sends a key with each submission. |
| `entry.adapter_type = web` | `url` has a maximum of 2048 characters. The form combines the allowed origin with the operator's document path. FastAPI checks the URL and Source policy. The Core checks access again during fetch or redirect. |
| `entry.adapter_type = csv` | `dataset_id` and inline `content`. The limit is 1 MiB UTF-8 and NUL is prohibited. |
| GET `/api/v1/collection-jobs/{job_id}` | Returns actual status, lineage, timestamps, counts, and execution fields. |
| GET `/api/v1/collection-jobs/{job_id}/events` | Returns execution events in persisted sequence order. |

First success returns HTTP 201 and a durable pending Job. The backend transaction stores the Job, pinned configuration hash, input hash, and dispatch intent. Replay with the same Source, key, Profile Version, and input returns HTTP 200 and the existing Job DTO. Reusing the key with different input or version returns 409 `job_request_conflict`. Replay lookup precedes eligibility checks for new writes. Draft or Retired gives 409. An approved Profile with unapproved Source access gives 403. If both conditions fail, the backend checks the Profile first. Unauthorised origins or datasets return 403, and an invalid request shape returns 422.

The request ref prevents re-entry during submission. A 5xx, network failure, timeout, or unreadable response keeps the original request for **Retry submission**. The tab session stores only the input fingerprint and key. The operator can recover that key by re-entering identical content in the same tab. Clear it after confirmed rejection or Job confirmation. Different versions, Sources, or input have different fingerprints. Resubmitting a restored form after the key was cleared is a new intent. Browser tab, storage, and secure context bound cross-page recovery. The backend enforces Source authorisation, Profile eligibility, and Job deduplication.
