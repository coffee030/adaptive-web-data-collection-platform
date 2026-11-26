from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4

import pytest
from conftest import approve_job_profile
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.exc import DBAPIError

from backend.api.app import create_app
from backend.application.jobs import Jobs
from backend.core.contracts import CollectionError
from backend.core.profiles import ProfileError


def test_job_pins_approved_version_and_idempotency(
    sessions, job_setup, config, pg_engine
):
    profiles, source, version, entry, _ = job_setup
    jobs = Jobs(sessions)
    with pytest.raises(ProfileError, match="approved profile"):
        jobs.create(source, version, entry)
    approved = approve_job_profile(job_setup)
    key = uuid4()
    job, created = jobs.create(source, version, entry, key)
    assert created
    assert job.profile_version_id == version
    assert job.config_hash == approved.config_hash
    newer = profiles.create_draft(source, config)
    approve_job_profile(
        (profiles, source, UUID(newer.profile_version_id), entry, job_setup[-1])
    )
    with pytest.raises(ProfileError, match="different job input"):
        jobs.create(source, UUID(newer.profile_version_id), entry, key)
    profiles.retire(source, version)
    with pytest.raises(ProfileError, match="approved profile"):
        jobs.create(source, version, entry)
    pg_engine.dispose()
    restarted = Jobs(sessions)
    assert restarted.get(job.job_id) == job
    assert restarted.create(source, version, entry, key) == (job, False)


def test_concurrent_claim_and_protected_terminal_state(sessions, job_setup):
    approve_job_profile(job_setup)
    _, source, version, entry, _ = job_setup
    jobs = Jobs(sessions)
    job, _ = jobs.create(source, version, entry)

    workers = [uuid4(), uuid4()]

    def claim(worker):
        try:
            jobs.claim(job.job_id, worker_instance_id=worker)
            return worker
        except ProfileError as error:
            assert error.code == "job_not_pending"
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        owners = [owner for owner in pool.map(claim, workers) if owner is not None]
    assert len(owners) == 1
    with sessions.begin() as session:
        row = jobs._get_row(session, job.job_id, lock=True)
        result = jobs._finish(
            session,
            row,
            "failed",
            error=CollectionError(code="test_failure", message="Simulated failure"),
        )
    assert result.finished_at >= result.started_at
    assert jobs.get(job.job_id) == result
    assert [
        (event.status, event.worker_instance_id) for event in jobs.events(job.job_id)
    ] == [
        ("pending", None),
        ("running", owners[0]),
        ("failed", owners[0]),
    ]
    with pytest.raises(ProfileError, match="running job"), sessions.begin() as session:
        row = jobs._get_row(session, job.job_id, lock=True)
        jobs._finish(session, row, "partial", counts=(1, 1, 0))


def test_job_api_creates_a_pending_job(pg_engine, tmp_path, job_setup):
    approved = approve_job_profile(job_setup)
    _, _, _, entry, _ = job_setup
    with TestClient(
        create_app(engine=pg_engine, evidence_root=tmp_path),
        base_url="http://127.0.0.1",
    ) as client:
        body = {
            "source_id": approved.source_id,
            "profile_version_id": approved.profile_version_id,
            "entry": entry.model_dump(mode="json"),
            "request_key": uuid4().hex,
        }
        created = client.post("/api/v1/collection-jobs", json=body)
        assert created.status_code == 201, created.text
        job = created.json()
        assert job["status"] == "pending"
        assert "input_payload" not in job
        assert client.post("/api/v1/collection-jobs", json=body).status_code == 200
        url = f"/api/v1/collection-jobs/{job['job_id']}"
        assert client.get(url).json() == job | {
            "latest_claim_worker_instance_id": None,
            "latest_claim_execution_origin": None,
            "latest_worker_heartbeat_at": None,
            "latest_worker_offline_detected_at": None,
        }
        assert [event["status"] for event in client.get(url + "/events").json()] == [
            "pending"
        ]
        assert client.get(f"/api/v1/collection-jobs/{uuid4()}").status_code == 404
        rejected = body | {
            "request_key": uuid4().hex,
            "entry": {
                "adapter_type": "csv",
                "dataset_id": "non-approved",
                "content": "",
            },
        }
        assert client.post("/api/v1/collection-jobs", json=rejected).status_code == 403


def test_rolled_back_claim_leaves_no_owner(pg_engine, sessions, job_setup):
    approve_job_profile(job_setup)
    _, source, version, entry, _ = job_setup
    jobs = Jobs(sessions)
    job, _ = jobs.create(source, version, entry)

    def reject_commit(connection):
        connection.exec_driver_sql("SELECT 1 / 0")

    event.listen(pg_engine, "commit", reject_commit)
    try:
        with pytest.raises(DBAPIError):
            jobs.claim(job.job_id, worker_instance_id=uuid4())
    finally:
        event.remove(pg_engine, "commit", reject_commit)

    detail = jobs.detail(job.job_id)
    assert detail.execution_attempt == 0
    assert detail.latest_claim_worker_instance_id is None
    assert detail.latest_claim_execution_origin is None
    assert [event.kind for event in jobs.events(job.job_id)] == ["JOB_CREATED"]
