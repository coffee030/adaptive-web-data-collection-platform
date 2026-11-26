"""Create, claim, and transition durable single-input collection jobs."""

import hashlib
import logging
from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session, sessionmaker

from backend.core.contracts import (
    MAX_JOB_ATTEMPTS,
    CollectionError,
    Contract,
    canonical_json,
)
from backend.core.profiles import ProfileError, ProfileRepository
from backend.persistence.models import EventRow, JobRow
from backend.persistence.profiles import (
    ProfileStorage,
    profile_from_row,
    source_from_row,
)

from .inputs import Entry, check_entry

JobStatus = Literal["pending", "running", "succeeded", "partial", "failed"]
ExecutionOrigin = Literal["worker", "direct"]
TERMINAL = frozenset({"succeeded", "partial", "failed"})
ATTEMPT_EVENTS = frozenset(
    {
        "CLAIMED",
        "RETRY_SCHEDULED",
        "WORKER_LOST",
        "RECOVERY_REQUESTED",
        "SUCCEEDED",
        "PARTIAL",
        "FAILED",
    }
)
LEASE_DURATION = timedelta(seconds=90)
MAX_ATTEMPTS = MAX_JOB_ATTEMPTS
LOGGER = logging.getLogger(__name__)


def database_now(session: Session) -> datetime:
    return session.scalar(select(func.clock_timestamp()))


class Job(Contract):
    job_id: UUID
    source_id: UUID
    profile_version_id: UUID
    config_hash: str
    status: JobStatus
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    valid_count: int
    invalid_count: int
    duplicate_count: int
    error: CollectionError | None
    execution_attempt: int
    lease_expires_at: datetime | None
    next_attempt_at: datetime | None
    dispatch_due_at: datetime | None
    last_dispatched_at: datetime | None
    dispatch_attempts: int
    dispatch_error_code: str | None


class JobDetail(Job):
    latest_claim_worker_instance_id: UUID | None = None
    latest_claim_execution_origin: ExecutionOrigin | None = None


class ExecutionEvent(Contract):
    event_id: UUID
    job_id: UUID
    status: JobStatus
    occurred_at: datetime
    kind: str | None
    execution_attempt: int | None
    worker_instance_id: UUID | None = None
    execution_origin: ExecutionOrigin | None = None
    error: CollectionError | None


def job_from_row(row: JobRow) -> Job:
    return Job(
        job_id=row.id,
        source_id=row.source_id,
        profile_version_id=row.profile_version_id,
        config_hash=row.config_hash,
        status=row.status,
        created_at=row.created_at,
        started_at=row.started_at,
        finished_at=row.finished_at,
        valid_count=row.valid_count,
        invalid_count=row.invalid_count,
        duplicate_count=row.duplicate_count,
        error=row.error,
        execution_attempt=row.execution_attempt,
        lease_expires_at=row.lease_expires_at,
        next_attempt_at=row.next_attempt_at,
        dispatch_due_at=row.dispatch_due_at,
        last_dispatched_at=row.last_dispatched_at,
        dispatch_attempts=row.dispatch_attempts,
        dispatch_error_code=row.dispatch_error_code,
    )


def stage_job(
    session: Session,
    source_id: UUID,
    version_id: UUID,
    config_hash: str,
    entry: Entry,
    *,
    request_key: UUID | None = None,
) -> JobRow:
    """Stage the Job and dispatch intent inside its caller's transaction."""
    data = entry.model_dump(mode="json")
    row = JobRow(
        id=uuid4(),
        source_id=source_id,
        profile_version_id=version_id,
        config_hash=config_hash,
        request_key=request_key,
        input_hash=hashlib.sha256(canonical_json(data)).hexdigest(),
        input_payload=data,
        dispatch_due_at=database_now(session),
    )
    session.add(row)
    session.flush()
    Jobs._add_event(session, row, "JOB_CREATED")
    return row


class Jobs:
    def __init__(self, sessions: sessionmaker[Session]):
        self.sessions = sessions

    def create(
        self,
        source_id: UUID,
        version_id: UUID,
        entry: Entry,
        request_key: UUID | None = None,
    ):
        with self.sessions.begin() as session:
            profiles = ProfileStorage(session)
            source = source_from_row(profiles.source(source_id, lock=True))
            if request_key is not None:
                existing = session.scalar(
                    select(JobRow).where(
                        JobRow.source_id == source_id, JobRow.request_key == request_key
                    )
                )
                if existing is not None:
                    if (
                        existing.profile_version_id != version_id
                        or existing.input_hash
                        != hashlib.sha256(
                            canonical_json(entry.model_dump(mode="json"))
                        ).hexdigest()
                    ):
                        raise ProfileError(
                            "job_request_conflict",
                            "Request key already belongs to a different job input",
                        )
                    return job_from_row(existing), False

            version = profile_from_row(profiles.profile(source_id, version_id))
            ProfileRepository.from_snapshot(source, version).approved_for_run(
                version.profile_version_id
            )
            check_entry(source, version.configuration, entry.collection_input())
            row = stage_job(
                session,
                source_id,
                version_id,
                version.config_hash,
                entry,
                request_key=request_key,
            )
            return job_from_row(row), True

    def get(self, job_id: UUID) -> Job:
        with self.sessions() as session:
            return job_from_row(self._get_row(session, job_id))

    def detail(self, job_id: UUID) -> JobDetail:
        query = (
            select(JobRow, EventRow.worker_instance_id, EventRow.execution_origin)
            .outerjoin(
                EventRow,
                and_(
                    EventRow.job_id == JobRow.id,
                    EventRow.execution_attempt == JobRow.execution_attempt,
                    EventRow.kind == "CLAIMED",
                ),
            )
            .where(JobRow.id == job_id)
        )
        with self.sessions() as session:
            match = session.execute(query).one_or_none()
            if match is None:
                raise ProfileError("job_not_found", "Collection job does not exist")
            row, worker, origin = match
            return JobDetail(
                **job_from_row(row).model_dump(),
                latest_claim_worker_instance_id=worker,
                latest_claim_execution_origin=origin,
            )

    def list_jobs(
        self,
        limit: int,
        offset: int,
        *,
        status: JobStatus | None = None,
        newest_first: bool = False,
    ) -> list[Job]:
        order = (
            (JobRow.created_at.desc(), JobRow.id.desc())
            if newest_first
            else (JobRow.created_at, JobRow.id)
        )
        query = select(JobRow)
        if status is not None:
            query = query.where(JobRow.status == status)
        with self.sessions() as session:
            return [
                job_from_row(row)
                for row in session.scalars(
                    query.order_by(*order).limit(limit).offset(offset)
                )
            ]

    def events(self, job_id: UUID) -> list[ExecutionEvent]:
        with self.sessions() as session:
            self._get_row(session, job_id)
            rows = session.scalars(
                select(EventRow)
                .where(EventRow.job_id == job_id)
                .order_by(EventRow.sequence)
            ).all()
            claims = {
                row.execution_attempt: row for row in rows if row.kind == "CLAIMED"
            }
            events = []
            for row in rows:
                claim = (
                    claims.get(row.execution_attempt)
                    if row.kind in ATTEMPT_EVENTS
                    else None
                )
                events.append(
                    ExecutionEvent(
                        event_id=row.id,
                        job_id=row.job_id,
                        status=row.status,
                        occurred_at=row.occurred_at,
                        kind=row.kind,
                        execution_attempt=row.execution_attempt,
                        worker_instance_id=claim.worker_instance_id if claim else None,
                        execution_origin=claim.execution_origin if claim else None,
                        error=row.error,
                    )
                )
            return events

    def claim(
        self, job_id: UUID, *, worker_instance_id: UUID | None = None
    ) -> tuple[Job, dict]:
        with self.sessions.begin() as session:
            row = self._get_row(session, job_id, lock=True)
            if row.status != "pending":
                raise ProfileError(
                    "job_not_pending", "Only pending jobs may be claimed"
                )
            now = database_now(session)
            if row.next_attempt_at is not None and row.next_attempt_at > now:
                raise ProfileError("job_not_due", "Collection job retry is not due")
            row.status = "running"
            row.execution_attempt += 1
            row.started_at = now
            row.lease_expires_at = now + LEASE_DURATION
            row.dispatch_due_at = None
            row.next_attempt_at = None
            row.error = None
            row.dispatch_error_code = None
            claim = self._add_event(session, row, "CLAIMED")
            claim.worker_instance_id = worker_instance_id
            claim.execution_origin = (
                "direct" if worker_instance_id is None else "worker"
            )
            return job_from_row(row), row.input_payload

    @staticmethod
    def _get_row(session: Session, job_id: UUID, *, lock: bool = False) -> JobRow:
        row = session.get(JobRow, job_id, with_for_update=lock)
        if row is None:
            raise ProfileError("job_not_found", "Collection job does not exist")
        return row

    @staticmethod
    def _add_event(
        session: Session,
        job: JobRow,
        kind: str,
        *,
        error: CollectionError | None = None,
    ) -> EventRow:
        event = EventRow(
            id=uuid4(),
            job_id=job.id,
            status=job.status,
            kind=kind,
            execution_attempt=job.execution_attempt,
            error=error.model_dump(mode="json") if error else None,
        )
        session.add(event)
        return event

    @staticmethod
    def owns_attempt(session: Session, row: JobRow, attempt: int) -> bool:
        owns = (
            row.status == "running"
            and row.execution_attempt == attempt
            and row.lease_expires_at > database_now(session)
        )
        if not owns:
            LOGGER.info(
                "Job %s rejected stale completion from attempt %s", row.id, attempt
            )
        return owns

    def retry(
        self,
        session: Session,
        row: JobRow,
        error: CollectionError,
        delay: timedelta,
        *,
        kind: str = "RETRY_SCHEDULED",
        attempt_limit: int | None = None,
    ) -> Job:
        if row.execution_attempt >= (attempt_limit or self.attempt_limit(session, row)):
            return self._finish(session, row, "failed", error=error)
        row.status = "pending"
        row.started_at = None
        row.lease_expires_at = None
        row.error = error.model_dump(mode="json")
        row.next_attempt_at = database_now(session) + delay
        row.dispatch_due_at = row.next_attempt_at
        self._add_event(session, row, kind, error=error)
        return job_from_row(row)

    @staticmethod
    def attempt_limit(session: Session, row: JobRow) -> int:
        profile = ProfileStorage(session).profile(row.source_id, row.profile_version_id)
        search = profile.configuration.get("search") or {}
        return search.get("max_attempts", MAX_ATTEMPTS)

    def _finish(
        self,
        session: Session,
        row: JobRow,
        status: JobStatus,
        *,
        counts: tuple[int, int, int] = (0, 0, 0),
        error: CollectionError | None = None,
    ) -> Job:
        if row.status != "running" or status not in TERMINAL:
            raise ProfileError(
                "invalid_job_transition", "A running job requires a terminal outcome"
            )
        row.status = status
        row.finished_at = database_now(session)
        row.lease_expires_at = None
        row.valid_count, row.invalid_count, row.duplicate_count = counts
        row.error = error.model_dump(mode="json") if error else None
        row.input_payload = None
        self._add_event(session, row, status.upper(), error=error)
        return job_from_row(row)
