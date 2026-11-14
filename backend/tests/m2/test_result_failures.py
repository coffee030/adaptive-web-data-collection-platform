from uuid import UUID, uuid4

import pytest
from conftest import approve_job_profile
from sqlalchemy import event, select, update
from sqlalchemy.exc import IntegrityError

from backend.application.execution import JobExecutor
from backend.application.results import Results
from backend.core.profiles import ProfileError
from backend.persistence.models import EvidenceRow, RecordRow


def test_lost_evidence_never_publishes_records(sessions, job_setup, monkeypatch):
    approve_job_profile(job_setup)
    _, source, version, entry, store = job_setup
    executor = JobExecutor(sessions, store)
    job, _ = executor.jobs.create(source, version, entry)
    save = store.save

    def lose_content(*args):
        evidence = save(*args)
        (store.root / evidence.evidence_id / "input.bin").unlink()
        return evidence

    monkeypatch.setattr(store, "save", lose_content)
    result = executor.execute(job.job_id)
    assert result.status == "failed"
    assert result.error.code == "evidence_not_found"
    assert Results(sessions).list_records(job.job_id, 10, 0) == []


def test_database_failure_rolls_back_publication(sessions, job_setup, pg_engine):
    approve_job_profile(job_setup)
    _, source, version, entry, store = job_setup
    executor = JobExecutor(sessions, store)
    job, _ = executor.jobs.create(source, version, entry)

    def reject_record_insert(connection, _cursor, statement, *_):
        if statement.startswith("INSERT INTO generic_records"):
            connection.exec_driver_sql("SELECT 1 / 0")

    event.listen(pg_engine, "before_cursor_execute", reject_record_insert)
    try:
        failed = executor.execute(job.job_id)
    finally:
        event.remove(pg_engine, "before_cursor_execute", reject_record_insert)
    assert failed.status == "failed"
    assert failed.error.code == "result_persistence_failed"
    assert Results(sessions).list_records(job.job_id, 10, 0) == []
    with sessions() as session:
        assert (
            session.scalar(select(EvidenceRow).where(EvidenceRow.job_id == job.job_id))
            is None
        )
    assert len(list(store.root.glob("*/input.bin"))) == 1
    assert [event.status for event in executor.jobs.events(job.job_id)] == [
        "pending",
        "running",
        "failed",
    ]


def test_job_idempotency_and_per_source_identity(
    sessions, job_setup, config, csv_source
):
    approve_job_profile(job_setup)
    profiles, source, version, entry, store = job_setup
    other_id = uuid4()
    profiles.register_source(csv_source.model_copy(update={"source_id": other_id.hex}))
    other = profiles.create_draft(other_id, config)
    other_version = UUID(other.profile_version_id)
    approve_job_profile((profiles, other_id, other_version, entry, store))
    executor = JobExecutor(sessions, store)
    key = uuid4()
    job, _ = executor.jobs.create(source, version, entry, key)
    other_job, _ = executor.jobs.create(other_id, other_version, entry, key)
    executor.execute(job.job_id)
    executor.execute(other_job.job_id)
    assert executor.jobs.create(source, version, entry, key)[1] is False
    with pytest.raises(ProfileError, match="Only pending"):
        executor.execute(job.job_id)
    records = Results(sessions).list_records(None, 10, 0)
    assert len(records) == 2
    assert len({record.deduplication_key for record in records}) == 2
    with pytest.raises(IntegrityError), sessions.begin() as session:
        session.execute(
            update(RecordRow)
            .where(RecordRow.id == records[0].record_id)
            .values(evidence_id=records[1].evidence_reference)
        )
