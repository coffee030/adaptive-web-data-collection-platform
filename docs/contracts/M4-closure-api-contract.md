# M4 Closure API Contract

This document supplements the M2, M4-C, M4-D, and M4-E contracts. The API defaults to loopback.

M5 retains this REST interface and adds terminal Job consumption, validated fields, and lineage. HTML entry rejects ambiguous path segments. Extracted text values are capped at 1 MiB UTF-8 in aggregate. [M5 Downstream Integration Contract](M5-downstream-integration-contract.md)

| Method and path | Behaviour at closure |
| --- | --- |
| POST `/api/v1/sources` | JSON may include UUID `request_key`. First creation returns 201. The same key and normalised registration return 200 and the current Source. A payload mismatch returns 409 `source_request_conflict`. Replay after an access change returns current authorisation. Omitting the key retains independent registration. |
| GET and POST `/api/v1/sources/{source_id}/versions` and single-version GET | Profile payload adds an integer `revision`. A new Draft starts at 1. |
| PUT `/api/v1/sources/{source_id}/versions/{version_id}` | Accepts `{"configuration":{…},"expected_revision":1}`. The same DB transaction locks and compares. A match updates the Draft and increments revision. A missing precondition returns 428 `draft_revision_required`, a stale revision returns 409 `draft_revision_conflict`, and a non-Draft still returns 409 `profile_not_draft`. |
| POST `…/validate` and `…/approve` | Still uses the saved Draft revision, latest passing report, config hash, and Source authorisation. Approval and retirement responses also contain revision. |
| GET `/api/v1/collection-jobs/{job_id}/evidence` | Returns Evidence Metadata for a capture, 200 `null` when there is no capture, and 404 for an unknown Job. |
| GET `/api/v1/evidence/{evidence_id}` | Uses the same DTO as the Job lookup and omits internal `storage_reference`. Backend storage retains raw files. |

Alembic `0006` adds a nullable request key, its companion hash, and a uniqueness constraint. Historical Sources can remain as they were. Successful replay returns the current Source to preserve newer authorisation state. React retains the request key for unconfirmed Source and Job writes. Across pages in the same tab, it stores only the fingerprint and key and requires resubmission of the same form content.

## Trusted-local boundary

FastAPI checks loopback Host. If a browser Origin is present, it must match the actual API scheme and Host. Vite forwards browser Host and retains opt-in, loopback peer, and same-origin approval rules. Compose publishes API and PostgreSQL host ports on 127.0.0.1 only. Bind native API explicitly to loopback. Trusted terminal clients can use direct API requests without Origin. The application adds no CORS allowlist. Keep the deployment off public reverse proxies and keep untrusted containers off its Compose network. The operator supplies the approver audit label. Host and Origin checks and local deployment provide no user identity or roles.

## Pagination and monitoring

Jobs, Records, and Quarantine use deterministic order and offset. Jobs and Records order by `created_at, id`, and Quarantine orders by `position_index, id`. The API keeps `limit` at 1–100 and offset nonnegative. The full Source list orders by `created_at, id`, and Versions order by unique version number within a Source. The browser can store both pages in the URL. Inserts or Job status changes between reads can change page membership. An empty tail page can return to its predecessor. There is no snapshot across requests.

Pending and Running Jobs schedule the next poll after each read while detail is visible. Terminal state, navigation away, and a hidden tab clear the timer. Active views defer result fetching. Terminal views fetch Records and Evidence and use actual Job and execution events.
