from conftest import approve_job_profile
from fastapi.testclient import TestClient
from sqlalchemy import update

from backend.api.app import create_app
from backend.application.execution import JobExecutor
from backend.application.jobs import Jobs
from backend.persistence.models import JobRow


def test_recent_lists_reverse_stable_order_and_keep_filters(
    pg_engine, sessions, job_setup
):
    approve_job_profile(job_setup)
    _, source, version, entry, store = job_setup
    jobs = Jobs(sessions)
    first, _ = jobs.create(source, version, entry)
    second, _ = jobs.create(source, version, entry)
    pending, _ = jobs.create(source, version, entry)
    executor = JobExecutor(sessions, store)
    for job in (first, second):
        assert executor.execute(job.job_id).status == "succeeded"
    with sessions.begin() as session:
        session.execute(update(JobRow).values(created_at=first.created_at))

    with TestClient(
        create_app(engine=pg_engine, evidence_root=store.root),
        base_url="http://127.0.0.1",
    ) as client:
        jobs_path = "/api/v1/collection-jobs"
        records_path = "/api/v1/records"

        def ids(path, key, **params):
            response = client.get(path, params=params)
            assert response.status_code == 200
            return [row[key] for row in response.json()]

        ordered_jobs = sorted(str(job.job_id) for job in (first, second, pending))
        assert ids(jobs_path, "job_id") == ordered_jobs
        assert ids(jobs_path, "job_id", order="newest", limit=1, offset=1) == [
            ordered_jobs[1]
        ]
        assert ids(jobs_path, "job_id", order="newest", status="succeeded") == sorted(
            [str(first.job_id), str(second.job_id)], reverse=True
        )

        records = ids(records_path, "record_id")
        assert len(records) == 2
        assert ids(records_path, "record_id", order="newest", limit=1) == records[-1:]
        assert (
            ids(records_path, "record_id", order="newest", limit=1, offset=1)
            == records[:1]
        )
        assert (
            len(ids(records_path, "record_id", order="newest", job_id=first.job_id))
            == 1
        )
        for path in (jobs_path, records_path):
            assert client.get(path, params={"order": "unknown"}).status_code == 422
