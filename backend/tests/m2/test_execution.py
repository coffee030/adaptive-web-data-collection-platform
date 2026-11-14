from conftest import approve_job_profile

from backend.application.execution import JobExecutor


def test_execute_partial_job(sessions, job_setup):
    approve_job_profile(job_setup)
    _, source, version, entry, evidence = job_setup
    executor = JobExecutor(sessions, evidence)
    mixed = entry.model_copy(update={"content": "Name,Count\nAlpha,2\nBeta,invalid\n"})
    job, _ = executor.jobs.create(source, version, mixed)
    result = executor.execute(job.job_id)
    assert result.status == "partial"
    assert (result.valid_count, result.invalid_count, result.duplicate_count) == (
        1,
        1,
        0,
    )


def test_execution_rechecks_revoked_source(sessions, job_setup):
    approve_job_profile(job_setup)
    profiles, source, version, entry, evidence = job_setup
    executor = JobExecutor(sessions, evidence)
    job, _ = executor.jobs.create(source, version, entry)
    profiles.set_authorization(source, "revoked")
    result = executor.execute(job.job_id)
    assert result.status == "failed"
    assert result.error.code == "source_not_approved"
