"""Persist the shared M1 ingestion results for one locked job."""

from uuid import UUID, uuid5

from sqlalchemy.orm import Session

from backend.core.contracts import CollectionRunResult
from backend.core.evidence import EvidenceError, LocalEvidenceStore

from .models import EvidenceRow, JobRow, QuarantineRow, RecordRow


def publish_results(
    session: Session,
    job: JobRow,
    result: CollectionRunResult,
    store: LocalEvidenceStore,
) -> None:
    evidence = result.evidence
    if evidence is None:
        if result.records or result.invalid or result.duplicates:
            raise EvidenceError(
                "evidence_not_found", "Collection results require raw evidence"
            )
        return
    stored, _ = store.resolve(evidence.evidence_id)
    if stored != evidence or (
        stored.source_id,
        stored.profile_version_id,
        stored.config_hash,
        stored.run_id,
    ) != (
        job.source_id.hex,
        job.profile_version_id.hex,
        job.config_hash,
        result.run_id,
    ):
        raise EvidenceError(
            "evidence_integrity_error", "Stored evidence does not match the job"
        )
    evidence_id = UUID(evidence.evidence_id)
    session.add(
        EvidenceRow(
            id=evidence_id,
            job_id=job.id,
            run_id=UUID(evidence.run_id),
            storage_reference=f"{evidence_id.hex}/input.bin",
            captured_at=evidence.captured_at,
            content_type=evidence.content_type,
            content_hash=evidence.content_hash,
            adapter_type=evidence.adapter_type,
            original_location=evidence.original_location,
            requested_location=evidence.requested_location,
            http_status=evidence.http_status,
        )
    )
    session.flush()
    session.add_all(
        RecordRow(
            id=uuid5(job.id, record.record_id),
            job_id=job.id,
            evidence_id=evidence_id,
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
    session.add_all(
        QuarantineRow(
            id=uuid5(
                job.id, f"{item.source_position.kind}:{item.source_position.index}"
            ),
            job_id=job.id,
            evidence_id=evidence_id,
            position_kind=item.source_position.kind,
            position_index=item.source_position.index,
            problems=[problem.model_dump(mode="json") for problem in item.problems],
        )
        for item in result.invalid
    )
