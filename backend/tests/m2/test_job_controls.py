import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from conftest import approve_job_profile
from sqlalchemy import func, update

from backend.application.collection import request_status
from backend.application.execution import JobExecutor
from backend.application.results import Results
from backend.core.profiles import ProfileError
from backend.persistence.models import JobRow
from backend.queue.dispatcher import Dispatcher


@pytest.fixture
def control_target(sessions, job_setup):
    approve_job_profile(job_setup)
    _, source, version, entry, evidence = job_setup
    executor = JobExecutor(sessions, evidence)
    job, _ = executor.jobs.create(source, version, entry)
    return executor, job.job_id


def test_pause_blocks_claim_and_dispatch_but_keeps_future_retry(
    sessions, control_target
):
    executor, job_id = control_target
    jobs = executor.jobs
    paused = jobs.control(job_id, "pause")
    assert paused.status == "paused" and paused.dispatch_due_at is None
    assert jobs.control(job_id, "pause") == paused
    dispatcher = Dispatcher(sessions, lambda _: pytest.fail("Dispatched a held Job"))
    assert not dispatcher.dispatch_one()
    with pytest.raises(ProfileError, match="Only pending"):
        jobs.claim(job_id)
    with pytest.raises(ProfileError, match="Wait for all jobs"):
        Results(sessions).export_records("job", job_id, "json")
    assert request_status([SimpleNamespace(job=paused)]) == "paused"
    assert jobs.control(job_id, "resume").status == "pending"
    first, _ = jobs.claim(job_id, worker_instance_id=uuid4())
    assert jobs.control(job_id, "pause").status == "pausing"
    assert jobs.renew(job_id, first.execution_attempt)
    with sessions.begin() as session:
        session.execute(
            update(JobRow)
            .where(JobRow.id == job_id)
            .values(lease_expires_at=func.clock_timestamp())
        )
    assert dispatcher.recover_one()
    held = jobs.get(job_id)
    assert (
        held.status == "paused"
        and held.next_attempt_at
        and held.dispatch_due_at is None
    )
    assert not dispatcher.dispatch_one()
    resumed = jobs.control(job_id, "resume")
    assert resumed.dispatch_due_at == resumed.next_attempt_at
    with pytest.raises(ProfileError, match="not due"):
        jobs.claim(job_id)
    assert [e.kind for e in jobs.events(job_id)].count("PAUSED") == 1


def test_pause_allows_active_completion_and_protects_committed_result(
    sessions, control_target
):
    executor, job_id = control_target
    jobs = executor.jobs
    attempt, entry = jobs.claim(job_id, worker_instance_id=uuid4())
    assert jobs.control(job_id, "pause").status == "pausing"
    with pytest.raises(ProfileError, match="Wait for all jobs"):
        Results(sessions).export_records("job", job_id, "json")
    assert jobs.control(job_id, "resume").status == "running"
    jobs.control(job_id, "pause")
    final = executor._publish(attempt, executor._run(attempt, entry))
    assert final.status == "succeeded" and final.valid_count > 0
    with pytest.raises(ProfileError, match="finished job"):
        jobs.control(job_id, "cancel")
    assert (
        len(json.loads(Results(sessions).export_records("job", job_id, "json")))
        == final.valid_count
    )


@pytest.mark.parametrize("claimed", [True, False])
def test_cancellation_fences_future_writes_and_repeated_controls(
    sessions, control_target, claimed
):
    executor, job_id = control_target
    jobs = executor.jobs
    if claimed:
        attempt, entry = jobs.claim(job_id, worker_instance_id=uuid4())
        uncommitted = executor._run(attempt, entry)
    cancelled = jobs.control(job_id, "cancel")
    assert (
        cancelled.status == "cancelled"
        and cancelled.finished_at
        and cancelled.dispatch_due_at is None
    )
    if claimed:
        assert not jobs.renew(job_id, attempt.execution_attempt)
        with pytest.raises(ProfileError, match="no longer owns"):
            executor._run(attempt, entry)
        assert executor._publish(attempt, uncommitted) == cancelled
    assert jobs.control(job_id, "cancel") == cancelled
    assert [e.kind for e in jobs.events(job_id)].count("CANCELLED") == 1
    assert request_status([SimpleNamespace(job=cancelled)]) == "cancelled"
    assert json.loads(Results(sessions).export_records("job", job_id, "json")) == []
    with pytest.raises(ProfileError, match="finished job"):
        jobs.control(job_id, "resume")
    assert not Dispatcher(sessions).recover_one()
    with pytest.raises(ProfileError, match="Only pending"):
        jobs.claim(job_id)
