from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from conftest import approve_job_profile
from fastapi.testclient import TestClient
from kombu.exceptions import OperationalError
from sqlalchemy import event, func, select, text, update
from sqlalchemy.exc import IntegrityError

from backend.api.app import create_app
from backend.application.execution import JobExecutor
from backend.application.jobs import MAX_ATTEMPTS
from backend.core.contracts import CollectionError
from backend.core.profiles import ProfileError
from backend.persistence.models import EvidenceRow, JobRow, RecordRow
from backend.queue.dispatcher import Dispatcher


@pytest.fixture
def execution(sessions, job_setup):
    approve_job_profile(job_setup)
    _, source, version, entry, store = job_setup
    executor = JobExecutor(sessions, store)
    job, _ = executor.jobs.create(source, version, entry)
    return executor, job.job_id


def expire(sessions, job_id, field):
    with sessions.begin() as session:
        session.execute(
            update(JobRow)
            .where(JobRow.id == job_id)
            .values({field: func.now() - text("interval '1 second'")})
        )


def make_retry_due(sessions, job_id):
    expire(sessions, job_id, JobRow.next_attempt_at)
    expire(sessions, job_id, JobRow.dispatch_due_at)


def test_failed_dispatch_remains_durable_and_can_be_republished(sessions, execution):
    executor, job_id = execution

    def unavailable(_):
        raise OperationalError("broker error with sensitive details")

    assert not Dispatcher(sessions, unavailable).dispatch_one()
    pending = executor.jobs.get(job_id)
    assert pending.status == "pending"
    assert pending.dispatch_attempts == 1
    assert pending.dispatch_error_code == "broker_unavailable"
    assert not Dispatcher(sessions, unavailable).dispatch_one()
    event = executor.jobs.events(job_id)[-1]
    assert event.kind == "DISPATCH_FAILED"
    assert "sensitive" not in event.error.message

    delivered = []
    expire(sessions, job_id, JobRow.dispatch_due_at)
    assert Dispatcher(sessions, delivered.append).dispatch_one()
    assert delivered == [job_id]
    pending = executor.jobs.get(job_id)
    assert pending.dispatch_attempts == 2
    assert pending.last_dispatched_at is not None
    assert pending.dispatch_error_code is None
    expire(sessions, job_id, JobRow.dispatch_due_at)
    assert Dispatcher(sessions, delivered.append).dispatch_one()
    assert delivered == [job_id, job_id]


def test_publication_before_rollback_and_concurrent_dispatch(sessions, execution):
    executor, job_id = execution
    delivered = []

    def interrupted(job_id):
        delivered.append(job_id)
        raise KeyboardInterrupt

    with pytest.raises(KeyboardInterrupt):
        Dispatcher(sessions, interrupted).dispatch_one()
    assert executor.jobs.get(job_id).dispatch_attempts == 0
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = pool.map(
            lambda _: Dispatcher(sessions, delivered.append).dispatch_one(), range(2)
        )
        assert sorted(results) == [False, True]
    assert delivered == [job_id, job_id]
    assert executor.execute(job_id).status == "succeeded"
    with pytest.raises(ProfileError, match="Only pending"):
        executor.execute(job_id)
    with sessions() as session:
        assert len(session.scalars(select(EvidenceRow)).all()) == 1
        assert len(session.scalars(select(RecordRow)).all()) == 1
    assert [event.kind for event in executor.jobs.events(job_id)].count(
        "SUCCEEDED"
    ) == 1


def test_expired_attempt_cannot_publish_or_fail_a_new_claim(
    sessions, execution, caplog, pg_engine
):
    executor, job_id = execution
    worker_a, worker_b = uuid4(), uuid4()
    old, entry = executor.jobs.claim(job_id, worker_instance_id=worker_a)
    stale_result = executor._run(old, entry)
    expire(sessions, job_id, JobRow.lease_expires_at)
    with caplog.at_level("INFO"):
        assert executor._publish(old, stale_result).status == "running"
        assert Dispatcher(sessions).recover_one()
        with pytest.raises(ProfileError, match="not due"):
            executor.jobs.claim(job_id)
        make_retry_due(sessions, job_id)
        current, entry = executor.jobs.claim(job_id, worker_instance_id=worker_b)
        assert current.execution_attempt == 2
        assert executor._publish(old, stale_result) == current
        assert (
            executor._fail(old, CollectionError(code="fixture", message="Stale"))
            == current
        )
        assert executor.jobs.detail(job_id).latest_claim_worker_instance_id == worker_b
    assert "rejected stale completion from attempt 1" in caplog.text
    with sessions() as session:
        assert session.scalar(select(EvidenceRow)) is None
    final = executor._publish(current, executor._run(current, entry))
    assert final.status == "succeeded"
    with sessions() as session:
        evidence = session.scalar(select(EvidenceRow))
        assert evidence.id.hex != stale_result.evidence.evidence_id
    assert (
        executor.evidence.root / stale_result.evidence.evidence_id / "input.bin"
    ).is_file()
    path = f"/api/v1/collection-jobs/{job_id}"
    with TestClient(
        create_app(engine=pg_engine, evidence_root=executor.evidence.root),
        base_url="http://127.0.0.1",
    ) as client:
        detail = client.get(path)
        history = client.get(f"{path}/events")
    assert detail.status_code == history.status_code == 200
    assert detail.json() == final.model_dump(mode="json") | {
        "latest_claim_worker_instance_id": str(worker_b),
        "latest_claim_execution_origin": "worker",
    }
    assert [
        (
            event["kind"],
            event["execution_attempt"],
            event["worker_instance_id"],
            event["execution_origin"],
        )
        for event in history.json()
    ] == [
        ("JOB_CREATED", 0, None, None),
        ("CLAIMED", 1, str(worker_a), "worker"),
        ("WORKER_LOST", 1, str(worker_a), "worker"),
        ("RECOVERY_REQUESTED", 1, str(worker_a), "worker"),
        ("CLAIMED", 2, str(worker_b), "worker"),
        ("SUCCEEDED", 2, str(worker_b), "worker"),
    ]


def test_recovery_stops_after_maximum_attempts(sessions, execution):
    executor, job_id = execution
    for attempt in range(1, MAX_ATTEMPTS + 1):
        claim, _ = executor.jobs.claim(job_id)
        assert claim.execution_attempt == attempt
        expire(sessions, job_id, JobRow.lease_expires_at)
        assert Dispatcher(sessions).recover_one()
        if attempt < MAX_ATTEMPTS:
            make_retry_due(sessions, job_id)
    final = executor.jobs.get(job_id)
    assert final.status == "failed"
    assert final.error.code == "worker_lost"
    assert final.next_attempt_at is None
    assert final.dispatch_due_at is None
    assert not Dispatcher(sessions).recover_one()
    with pytest.raises(ProfileError, match="Only pending"):
        executor.execute(job_id)


def test_database_requires_lease_for_running_job(sessions, execution):
    executor, job_id = execution
    executor.jobs.claim(job_id)
    with pytest.raises(IntegrityError), sessions.begin() as session:
        session.execute(
            update(JobRow).where(JobRow.id == job_id).values(lease_expires_at=None)
        )


def test_worker_wrapper_handles_invalid_missing_and_database_failure(
    monkeypatch, caplog
):
    from sqlalchemy.exc import OperationalError as DatabaseError

    from backend.queue import tasks

    worker = uuid4()

    class Executor:
        failure = ProfileError("job_not_found", "Collection job does not exist")

        def execute(self, job_id, *, worker_instance_id):
            assert worker_instance_id == worker
            raise self.failure

    executor = Executor()
    monkeypatch.setattr(tasks, "worker_executor", lambda: executor)
    monkeypatch.setattr(tasks, "worker_instance_id", lambda: worker)
    assert tasks.execute_job.run("invalid") is None
    assert "invalid job UUID" in caplog.text
    assert tasks.execute_job.run(str(uuid4())) is None
    executor.failure = DatabaseError("secret statement", {}, OSError())
    with pytest.raises(RuntimeError, match="state could not be confirmed"):
        tasks.execute_job.run(str(uuid4()))
    assert "secret statement" not in caplog.text


def test_commit_error_rolls_back_results(sessions, execution, pg_engine):
    executor, job_id = execution
    job, entry = executor.jobs.claim(job_id)
    result = executor._run(job, entry)

    def reject_commit(connection):
        connection.exec_driver_sql("SELECT 1 / 0")

    event.listen(pg_engine, "commit", reject_commit)
    try:
        from sqlalchemy.exc import DBAPIError

        with pytest.raises(DBAPIError):
            executor._publish(job, result)
    finally:
        event.remove(pg_engine, "commit", reject_commit)
    with sessions() as session:
        assert session.scalar(select(EvidenceRow)) is None
        assert session.scalar(select(RecordRow)) is None
    assert executor.jobs.get(job_id).status == "running"
    assert (executor.evidence.root / result.evidence.evidence_id / "input.bin").exists()
    expire(sessions, job_id, JobRow.lease_expires_at)
    assert Dispatcher(sessions).recover_one()
    make_retry_due(sessions, job_id)
    assert executor.execute(job_id).status == "succeeded"


@pytest.mark.parametrize("pg_engine", ["0004"], indirect=True)
def test_upgrade_from_m2_with_pending_running_and_terminal_rows(sessions, pg_engine):
    from alembic import command
    from alembic.config import Config
    from conftest import ROOT

    from backend.application.jobs import Jobs

    source, version, pending_id, running_id, terminal_id, evidence_id = [
        uuid4() for _ in range(6)
    ]
    hash_value = "a" * 64
    jobs = Jobs(sessions)
    params = {
        "source": source,
        "version": version,
        "hash": hash_value,
        "pending": pending_id,
        "running": running_id,
        "terminal": terminal_id,
        "evidence": evidence_id,
        "run": uuid4(),
        "record": uuid4(),
        "event": uuid4(),
    }
    config = Config(ROOT / "alembic.ini")
    with pg_engine.begin() as connection:
        for sql in (
            (
                "INSERT INTO sources (id, name, adapter_type, permission_reference, approval_status, access_policy) "
                "VALUES (:source, 'Legacy source', 'csv', 'Fixture', 'approved', '{}')"
            ),
            (
                "INSERT INTO profile_versions (id, source_id, version, configuration, config_hash, approval_status) "
                "VALUES (:version, :source, 1, '{}', :hash, 'draft')"
            ),
            (
                "INSERT INTO collection_jobs (id, source_id, profile_version_id, config_hash, input_hash, "
                "status, started_at, finished_at, input_payload, valid_count) VALUES "
                "(:pending, :source, :version, :hash, :hash, 'pending', NULL, NULL, '{}', 0), "
                "(:running, :source, :version, :hash, :hash, 'running', now(), NULL, '{}', 0), "
                "(:terminal, :source, :version, :hash, :hash, 'succeeded', now(), now(), NULL, 1)"
            ),
            "INSERT INTO execution_events (id, job_id, status) VALUES (:event, :terminal, 'succeeded')",
            (
                "INSERT INTO raw_evidence (id, job_id, run_id, storage_reference, captured_at, "
                "content_hash, adapter_type, original_location) "
                "VALUES (:evidence, :terminal, :run, 'legacy/input.bin', now(), :hash, 'csv', 'listings')"
            ),
            (
                "INSERT INTO generic_records (id, job_id, evidence_id, record_type, schema_version, "
                "deduplication_key, validation_status, payload, source_position) "
                "VALUES (:record, :terminal, :evidence, 'listing', '1', :hash, 'passed', '{}', '{}')"
            ),
        ):
            connection.execute(text(sql), params)
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
        command.check(config)
    pending = jobs.get(pending_id)
    assert pending.execution_attempt == 0
    assert pending.dispatch_due_at is not None
    assert Dispatcher(sessions).recover_one()
    assert jobs.get(running_id).status == "pending"
    assert jobs.get(terminal_id).status == "succeeded"
    assert jobs.events(terminal_id)[-1].kind is None
    with sessions() as session:
        assert len(session.scalars(select(EvidenceRow)).all()) == 1
        assert len(session.scalars(select(RecordRow)).all()) == 1
