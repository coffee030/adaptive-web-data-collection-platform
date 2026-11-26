"""Read collection results and reconstruct their lineage from foreign keys."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from backend.core.contracts import (
    CaptureKind,
    Contract,
    Positive,
    Provenance,
    RecordProblem,
    RenderedEvidence,
    Scalar,
    Sha256,
    SourcePosition,
)
from backend.core.profiles import ProfileError
from backend.persistence.collection import (
    CollectionRequestRow,
    ObservationRow,
    RequestJobRow,
)
from backend.persistence.models import (
    EvidenceRow,
    JobRow,
    ProfileRow,
    QuarantineRow,
    RecordRow,
)

from .jobs import TERMINAL, Jobs
from .record_export import MAX_EXPORT_ROWS, ExportFormat, encode_records


class Record(Contract):
    record_id: UUID
    job_id: UUID
    source_id: UUID
    profile_version_id: UUID
    record_type: str
    schema_version: str
    source_record_key: str | None
    deduplication_key: Sha256
    payload: dict[str, Scalar]
    source_position: SourcePosition
    validation_status: Literal["passed"]
    evidence_reference: UUID
    provenance: Provenance
    created_at: datetime


class RecordDetail(Record):
    request_id: UUID | None
    article_id: UUID | None


class Evidence(Contract):
    evidence_id: UUID
    job_id: UUID
    source_id: UUID
    profile_version_id: UUID
    config_hash: Sha256
    run_id: UUID
    page_number: Positive
    capture_kind: CaptureKind
    rendered_dom: RenderedEvidence | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    captured_at: datetime
    content_hash: Sha256
    content_type: str | None
    adapter_type: Literal["web", "csv"]
    original_location: str
    requested_location: str | None
    http_status: int | None


class QuarantinedRecord(Contract):
    record_id: UUID
    job_id: UUID
    source_id: UUID
    profile_version_id: UUID
    evidence_reference: UUID
    source_position: SourcePosition
    problems: tuple[RecordProblem, ...]
    created_at: datetime


def materialize_record(row: RecordRow, job: JobRow, evidence: EvidenceRow) -> Record:
    return Record(
        record_id=row.id,
        job_id=row.job_id,
        source_id=job.source_id,
        profile_version_id=job.profile_version_id,
        record_type=row.record_type,
        schema_version=row.schema_version,
        source_record_key=row.source_record_key,
        deduplication_key=row.deduplication_key,
        payload=row.payload,
        source_position=row.source_position,
        validation_status=row.validation_status,
        evidence_reference=row.evidence_id,
        created_at=row.created_at,
        provenance=Provenance(
            source_id=job.source_id.hex,
            run_id=evidence.run_id.hex,
            profile_version_id=job.profile_version_id.hex,
            config_hash=job.config_hash,
            validation_status=row.validation_status,
        ),
    )


def _evidence_query():
    return (
        select(
            EvidenceRow,
            JobRow,
            ProfileRow.configuration["rendering"].astext.is_not(None),
        )
        .join(JobRow, EvidenceRow.job_id == JobRow.id)
        .join(ProfileRow, JobRow.profile_version_id == ProfileRow.id)
    )


def materialize_evidence(
    row: EvidenceRow, job: JobRow, rendered_profile: bool
) -> Evidence:
    return Evidence(
        evidence_id=row.id,
        job_id=row.job_id,
        source_id=job.source_id,
        profile_version_id=job.profile_version_id,
        config_hash=job.config_hash,
        run_id=row.run_id,
        page_number=row.page_number,
        capture_kind=row.capture_kind,
        rendered_dom=row.rendered_dom if rendered_profile else None,
        captured_at=row.captured_at,
        content_hash=row.content_hash,
        content_type=row.content_type,
        adapter_type=row.adapter_type,
        original_location=row.original_location,
        requested_location=row.requested_location,
        http_status=row.http_status,
    )


def _records_query(job_id: UUID | None, request_id: UUID | None):
    query = (
        select(RecordRow, JobRow, EvidenceRow)
        .join(JobRow, RecordRow.job_id == JobRow.id)
        .join(EvidenceRow, RecordRow.evidence_id == EvidenceRow.id)
        .where(RecordRow.validation_status == "passed")
    )
    if job_id is not None:
        query = query.where(RecordRow.job_id == job_id)
    if request_id is not None:
        query = query.join(
            RequestJobRow, RequestJobRow.job_id == RecordRow.job_id
        ).where(RequestJobRow.request_id == request_id)
    return query


def _require_request(session: Session, request_id: UUID) -> None:
    if session.get(CollectionRequestRow, request_id) is None:
        raise ProfileError(
            "collection_request_not_found", "Collection request does not exist"
        )


class Results:
    def __init__(self, sessions: sessionmaker[Session]):
        self.sessions = sessions

    def list_records(
        self,
        job_id: UUID | None,
        limit: int,
        offset: int,
        *,
        newest_first: bool = False,
        request_id: UUID | None = None,
    ) -> list[Record]:
        query = _records_query(job_id, request_id)
        order = (
            (RecordRow.created_at.desc(), RecordRow.id.desc())
            if newest_first
            else (RecordRow.created_at, RecordRow.id)
        )
        query = query.order_by(*order).offset(offset).limit(limit)
        with self.sessions() as session:
            if request_id is not None:
                _require_request(session, request_id)
            return [
                materialize_record(row, job, evidence)
                for row, job, evidence in session.execute(query)
            ]

    def record(self, record_id: UUID, *, include_lineage: bool = False) -> Record:
        query = _records_query(None, None).where(RecordRow.id == record_id)
        if include_lineage:
            query = (
                query.outerjoin(RequestJobRow, RequestJobRow.job_id == RecordRow.job_id)
                .outerjoin(ObservationRow, ObservationRow.record_id == RecordRow.id)
                .add_columns(RequestJobRow.request_id, ObservationRow.article_id)
            )
        with self.sessions() as session:
            result = session.execute(query).one_or_none()
            if result is None:
                raise ProfileError("record_not_found", "Record does not exist")
            row, job, evidence, *lineage = result
            record = materialize_record(row, job, evidence)
            if not include_lineage:
                return record
            request_id, article_id = lineage
            return RecordDetail(
                **record.model_dump(),
                request_id=request_id,
                article_id=article_id,
            )

    def export_records(
        self, scope: Literal["job", "request"], scope_id: UUID, format: ExportFormat
    ) -> bytes:
        job_id = scope_id if scope == "job" else None
        request_id = scope_id if scope == "request" else None
        with self.sessions() as session:
            if request_id is not None:
                _require_request(session, request_id)
                statuses = list(
                    session.scalars(
                        select(JobRow.status)
                        .join(RequestJobRow, RequestJobRow.job_id == JobRow.id)
                        .where(RequestJobRow.request_id == request_id)
                    )
                )
            else:
                statuses = [Jobs._get_row(session, scope_id).status]
            if not statuses or not set(statuses) <= TERMINAL:
                raise ProfileError(
                    "record_export_pending", "Wait for all jobs in this scope to finish"
                )
            # Terminal jobs publish their records in the same transaction as the final status.
            query = (
                _records_query(job_id, request_id)
                .order_by(RecordRow.created_at, RecordRow.id)
                .limit(MAX_EXPORT_ROWS + 1)
                .execution_options(yield_per=8)
            )
            records = (materialize_record(*row) for row in session.execute(query))
            return encode_records(records, tuple(Record.model_fields), format)

    def evidence(self, evidence_id: UUID) -> Evidence:
        query = _evidence_query().where(EvidenceRow.id == evidence_id)
        with self.sessions() as session:
            match = session.execute(query).one_or_none()
            if match is None:
                raise ProfileError(
                    "evidence_not_found", "Evidence metadata does not exist"
                )
            return materialize_evidence(*match)

    def job_evidence(self, job_id: UUID) -> Evidence | None:
        pages = self.job_evidence_pages(job_id)
        return pages[0] if pages else None

    def job_evidence_pages(self, job_id: UUID) -> list[Evidence]:
        with self.sessions() as session:
            Jobs._get_row(session, job_id)
            rows = session.execute(
                _evidence_query()
                .where(EvidenceRow.job_id == job_id)
                .order_by(EvidenceRow.page_number)
            )
            return [materialize_evidence(*row) for row in rows]

    def quarantine(
        self, job_id: UUID, limit: int, offset: int
    ) -> list[QuarantinedRecord]:
        with self.sessions() as session:
            job = Jobs._get_row(session, job_id)
            rows = session.scalars(
                select(QuarantineRow)
                .join(EvidenceRow, QuarantineRow.evidence_id == EvidenceRow.id)
                .where(QuarantineRow.job_id == job_id)
                .order_by(
                    EvidenceRow.page_number,
                    QuarantineRow.position_index,
                    QuarantineRow.id,
                )
                .offset(offset)
                .limit(limit)
            )
            return [
                QuarantinedRecord(
                    record_id=row.id,
                    job_id=job_id,
                    source_id=job.source_id,
                    profile_version_id=job.profile_version_id,
                    evidence_reference=row.evidence_id,
                    source_position=SourcePosition(
                        kind=row.position_kind, index=row.position_index
                    ),
                    problems=row.problems,
                    created_at=row.created_at,
                )
                for row in rows
            ]
