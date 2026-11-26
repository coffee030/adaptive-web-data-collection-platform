from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Request
from sqlalchemy import text

from backend.core.contracts import Contract


class QueueState(Contract):
    pending: int
    running: int
    retrying: int
    dispatch_errors: int
    expired_leases: int
    oldest_pending: datetime | None


class JobTotals(Contract):
    completed: int
    failed: int
    partial: int
    accepted: int
    quarantined: int
    duplicates: int
    p50_seconds: float | None
    p95_seconds: float | None


class Bucket(Contract):
    starts_at: datetime
    completed: int
    accepted: int
    quarantined: int
    duplicates: int


class SourceSummary(Contract):
    source_id: UUID
    name: str
    completed: int
    failed: int
    partial: int
    accepted: int
    quarantined: int
    duplicates: int
    last_job: UUID
    last_finished: datetime


class Pulse(Contract):
    observed_at: datetime
    starts_at: datetime
    workers_observed: int
    queue: QueueState
    totals: JobTotals
    series: list[Bucket]
    sources: list[SourceSummary]


router = APIRouter(prefix="/operations", tags=["operations"])

pulse_query = text("""
WITH bounds AS NOT MATERIALIZED (
    SELECT CURRENT_TIMESTAMP AS observed_at,
           CURRENT_TIMESTAMP - :hours * INTERVAL '1 hour' AS starts_at,
           :width * INTERVAL '1 hour' AS bucket_width
), finished AS (
    SELECT j.id, j.source_id, j.finished_at, j.status, j.valid_count,
           j.invalid_count, j.duplicate_count,
           EXTRACT(EPOCH FROM j.finished_at - j.started_at) AS duration
    FROM collection_jobs j CROSS JOIN bounds b
    WHERE j.finished_at >= b.starts_at AND j.finished_at < b.observed_at
), queue_state AS (
    SELECT count(*) FILTER (WHERE j.status = 'pending') AS pending,
           count(*) FILTER (WHERE j.status = 'running') AS running,
           count(*) FILTER (WHERE j.next_attempt_at IS NOT NULL) AS retrying,
           count(*) FILTER (WHERE j.status = 'pending' AND j.dispatch_error_code IS NOT NULL) AS dispatch_errors,
           count(*) FILTER (WHERE j.status = 'running' AND j.lease_expires_at <= b.observed_at) AS expired_leases,
           min(j.created_at) FILTER (WHERE j.status = 'pending') AS oldest_pending
    FROM collection_jobs j CROSS JOIN bounds b
    WHERE j.status IN ('pending', 'running')
), totals AS (
    SELECT count(*) AS completed, count(*) FILTER (WHERE status = 'failed') AS failed,
           count(*) FILTER (WHERE status = 'partial') AS partial,
           coalesce(sum(valid_count), 0) AS accepted,
           coalesce(sum(invalid_count), 0) AS quarantined,
           coalesce(sum(duplicate_count), 0) AS duplicates,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY duration) AS p50_seconds,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY duration) AS p95_seconds
    FROM finished
), workers AS (
    SELECT count(DISTINCT e.worker_instance_id) AS observed
    FROM execution_events e CROSS JOIN bounds b
    WHERE e.kind = 'CLAIMED' AND e.worker_instance_id IS NOT NULL
      AND e.occurred_at >= b.starts_at AND e.occurred_at < b.observed_at
), activity AS (
    SELECT date_bin(b.bucket_width, f.finished_at, b.starts_at) AS starts_at,
           count(*) AS completed, sum(f.valid_count) AS accepted,
           sum(f.invalid_count) AS quarantined, sum(f.duplicate_count) AS duplicates
    FROM finished f CROSS JOIN bounds b
    GROUP BY 1
), buckets AS (
    SELECT s.starts_at, coalesce(a.completed, 0) AS completed,
           coalesce(a.accepted, 0) AS accepted, coalesce(a.quarantined, 0) AS quarantined,
           coalesce(a.duplicates, 0) AS duplicates
    FROM bounds b CROSS JOIN LATERAL (
        SELECT b.starts_at + bucket * b.bucket_width AS starts_at
        FROM generate_series(0, CAST(:hours AS integer) / CAST(:width AS integer) - 1) bucket
    ) s LEFT JOIN activity a ON a.starts_at = s.starts_at
), source_totals AS (
    SELECT f.source_id, s.name, count(*) AS completed,
           count(*) FILTER (WHERE f.status = 'failed') AS failed,
           count(*) FILTER (WHERE f.status = 'partial') AS partial,
           sum(f.valid_count) AS accepted, sum(f.invalid_count) AS quarantined,
           sum(f.duplicate_count) AS duplicates,
           (array_agg(f.id ORDER BY f.finished_at DESC, f.id DESC))[1] AS last_job,
           max(f.finished_at) AS last_finished
    FROM finished f JOIN sources s ON s.id = f.source_id
    GROUP BY f.source_id, s.name
    ORDER BY failed DESC, partial DESC, last_finished DESC, f.source_id
    LIMIT 12
)
SELECT b.observed_at, b.starts_at, w.observed AS workers_observed,
       row_to_json(q) AS queue, row_to_json(t) AS totals,
       (SELECT json_agg(k ORDER BY k.starts_at) FROM buckets k) AS series,
       coalesce((SELECT json_agg(s ORDER BY s.failed DESC, s.partial DESC, s.last_finished DESC, s.source_id)
                 FROM source_totals s), '[]'::json) AS sources
FROM bounds b CROSS JOIN queue_state q CROSS JOIN totals t CROSS JOIN workers w
""")


@router.get("/pulse", response_model=Pulse)
def pulse(request: Request, window: Literal["24h", "7d"] = "24h"):
    hours, width = (24, 2) if window == "24h" else (168, 24)
    with request.app.state.sessions() as session:
        return (
            session.execute(pulse_query, {"hours": hours, "width": width})
            .mappings()
            .one()
        )
