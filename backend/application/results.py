"""Read collection results and reconstruct their lineage from foreign keys."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from backend.core.contracts import (
    Contract,
    Positive,
    Provenance,
    RecordProblem,
    Scalar,
    Sha256,
    SourcePosition,
)
from backend.core.profiles import ProfileError
from backend.persistence.models import EvidenceRow, JobRow, QuarantineRow, RecordRow

from .jobs import Jobs


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


class Evidence(Contract):
    evidence_id: UUID
    job_id: UUID
    source_id: UUID
    profile_version_id: UUID
    config_hash: Sha256
    run_id: UUID
    page_number: Positive
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


def materialize_evidence(row: EvidenceRow, job: JobRow) -> Evidence:
    return Evidence(
        evidence_id=row.id,
        job_id=row.job_id,
        source_id=job.source_id,
        profile_version_id=job.profile_version_id,
        config_hash=job.config_hash,
        run_id=row.run_id,
        page_number=row.page_number,
        captured_at=row.captured_at,
        content_hash=row.content_hash,
        content_type=row.content_type,
        adapter_type=row.adapter_type,
        original_location=row.original_location,
        requested_location=row.requested_location,
        http_status=row.http_status,
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
    ) -> list[Record]:
        query = (
            select(RecordRow, JobRow, EvidenceRow)
            .join(JobRow, RecordRow.job_id == JobRow.id)
            .join(EvidenceRow, RecordRow.evidence_id == EvidenceRow.id)
        )
        if job_id is not None:
            query = query.where(RecordRow.job_id == job_id)
        order = (
            (RecordRow.created_at.desc(), RecordRow.id.desc())
            if newest_first
            else (RecordRow.created_at, RecordRow.id)
        )
        query = query.order_by(*order).offset(offset).limit(limit)
        with self.sessions() as session:
            return [
                materialize_record(row, job, evidence)
                for row, job, evidence in session.execute(query)
            ]

    def record(self, record_id: UUID) -> Record:
        query = (
            select(RecordRow, JobRow, EvidenceRow)
            .join(JobRow, RecordRow.job_id == JobRow.id)
            .join(EvidenceRow, RecordRow.evidence_id == EvidenceRow.id)
            .where(RecordRow.id == record_id)
        )
        with self.sessions() as session:
            result = session.execute(query).one_or_none()
            if result is None:
                raise ProfileError("record_not_found", "Record does not exist")
            return materialize_record(*result)

    def evidence(self, evidence_id: UUID) -> Evidence:
        query = (
            select(EvidenceRow, JobRow)
            .join(JobRow, EvidenceRow.job_id == JobRow.id)
            .where(EvidenceRow.id == evidence_id)
        )
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
            job = Jobs._get_row(session, job_id)
            rows = session.scalars(
                select(EvidenceRow)
                .where(EvidenceRow.job_id == job_id)
                .order_by(EvidenceRow.page_number)
            )
            return [materialize_evidence(row, job) for row in rows]

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
