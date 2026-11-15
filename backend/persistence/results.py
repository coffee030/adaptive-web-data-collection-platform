"""Persist the shared M1 ingestion results for one locked job."""

from uuid import UUID, uuid5

from sqlalchemy.orm import Session

from backend.core.contracts import (
    CollectionRunResult,
    EvidenceReference,
    SourcePosition,
)
from backend.core.evidence import EvidenceError, LocalEvidenceStore

from .models import EvidenceRow, JobRow, QuarantineRow, RecordRow


def publish_results(
    session: Session,
    job: JobRow,
    result: CollectionRunResult,
    store: LocalEvidenceStore,
) -> None:
    by_id: dict[str, EvidenceRow] = {}
    for number, evidence in enumerate(result.all_evidence, start=1):
        row = _evidence_row(job, result.run_id, evidence, number, store)
        by_id[evidence.evidence_id] = row
        session.add(row)

    def evidence_for(reference: str | None) -> EvidenceRow:
        if reference is None or reference not in by_id:
            raise EvidenceError(
                "evidence_not_found", "Collection result lacks its source evidence"
            )
        row = by_id[reference]
        if row.capture_kind == "search":
            raise EvidenceError(
                "evidence_integrity_error", "Records require input or detail evidence"
            )
        return row

    session.flush()
    session.add_all(
        RecordRow(
            id=uuid5(job.id, record.record_id),
            job_id=job.id,
            evidence_id=evidence_for(record.evidence_reference).id,
            record_type=record.record_type,
            schema_version=record.schema_version,
            source_record_key=record.source_record_key,
            deduplication_key=record.record_id,
            validation_status=record.provenance.validation_status,
            payload=record.payload,
            source_position=record.source_position.model_dump(mode="json"),
        )
        for record in result.records
    )
    for item in result.invalid:
        row = evidence_for(item.evidence_reference)
        session.add(
            QuarantineRow(
                id=_quarantine_id(job.id, row.page_number, item.source_position),
                job_id=job.id,
                evidence_id=row.id,
                position_kind=item.source_position.kind,
                position_index=item.source_position.index,
                problems=[problem.model_dump(mode="json") for problem in item.problems],
            )
        )
    for item in result.duplicates:
        evidence_for(item.evidence_reference)


def _quarantine_id(job_id: UUID, page_number: int, position: SourcePosition) -> UUID:
    key = f"{position.kind}:{position.index}"
    # Keep the historical IDs for the first page and CSV rows.
    return uuid5(job_id, key if page_number == 1 else f"{page_number}:{key}")


def _evidence_row(
    job: JobRow,
    run_id: str,
    evidence: EvidenceReference,
    page_number: int,
    store: LocalEvidenceStore,
) -> EvidenceRow:
    stored, _ = store.resolve(evidence.evidence_id)
    if stored != evidence or (
        stored.source_id,
        stored.profile_version_id,
        stored.config_hash,
        stored.run_id,
        stored.page_number,
    ) != (
        job.source_id.hex,
        job.profile_version_id.hex,
        job.config_hash,
        run_id,
        page_number,
    ):
        raise EvidenceError(
            "evidence_integrity_error", "Stored evidence does not match the job"
        )
    evidence_id = UUID(evidence.evidence_id)
    return EvidenceRow(
        id=evidence_id,
        job_id=job.id,
        run_id=UUID(evidence.run_id),
        page_number=page_number,
        capture_kind=evidence.capture_kind,
        storage_reference=f"{evidence_id.hex}/input.bin",
        captured_at=evidence.captured_at,
        content_type=evidence.content_type,
        content_hash=evidence.content_hash,
        adapter_type=evidence.adapter_type,
        original_location=evidence.original_location,
        requested_location=evidence.requested_location,
        http_status=evidence.http_status,
    )
