from uuid import uuid4

from conftest import approve_job_profile
from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.application.execution import JobExecutor
from backend.application.jobs import Jobs


def test_pulse_uses_durable_counts_and_worker_claims(pg_engine, sessions, job_setup):
    approve_job_profile(job_setup)
    _, source, version, entry, store = job_setup
    jobs = Jobs(sessions)
    with TestClient(
        create_app(engine=pg_engine, evidence_root=store.root),
        base_url="http://127.0.0.1",
    ) as client:
        route = "/api/v1/operations/pulse"
        blank = client.get(route).json()
        assert blank["sources"] == []
        assert blank["totals"]["p50_seconds"] is None
        assert blank["workers_observed"] == 0
        assert len(blank["series"]) == 12
        done, _ = jobs.create(source, version, entry)
        worker_job, _ = jobs.create(source, version, entry)
        jobs.create(source, version, entry)
        assert JobExecutor(sessions, store).execute(done.job_id).status == "succeeded"
        jobs.claim(worker_job.job_id, worker_instance_id=uuid4())
        for window, buckets in (("24h", 12), ("7d", 7)):
            response = client.get(route, params={"window": window})
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["queue"]["pending"] == data["queue"]["running"] == 1
            assert data["queue"]["oldest_pending"]
            assert data["queue"]["retrying"] == data["queue"]["expired_leases"] == 0
            assert data["workers_observed"] == 1
            assert data["totals"]["completed"] == data["totals"]["accepted"] == 1
            assert data["totals"]["p50_seconds"] >= 0
            assert len(data["series"]) == buckets
            assert sum(row["completed"] for row in data["series"]) == 1
            assert sum(row["accepted"] for row in data["series"]) == 1
            assert data["sources"][0]["last_job"] == str(done.job_id)
        assert client.get(route, params={"window": "forever"}).status_code == 422
