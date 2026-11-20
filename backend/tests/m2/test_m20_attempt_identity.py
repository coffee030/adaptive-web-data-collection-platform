import os
import subprocess
import sys
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from conftest import ROOT, approve_job_profile
from sqlalchemy import text
from sqlalchemy.engine import make_url

from backend.application.jobs import Jobs


@pytest.mark.parametrize("pg_engine", ["0009"], indirect=True)
def test_upgrade_preserves_historical_claim_and_unclaimed_job(
    pg_engine, sessions, job_setup
):
    approved = approve_job_profile(job_setup)
    pending, historical, claim, finished = (uuid4() for _ in range(4))
    params = {
        "pending": pending,
        "historical": historical,
        "claim": claim,
        "finished": finished,
        "source": approved.source_id,
        "version": approved.profile_version_id,
        "hash": approved.config_hash,
    }
    with pg_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO collection_jobs (id, source_id, profile_version_id, "
                "config_hash, input_hash, status, execution_attempt, "
                "started_at, finished_at, input_payload, valid_count, dispatch_due_at) VALUES "
                "(:pending, :source, :version, :hash, :hash, 'pending', 0, "
                "NULL, NULL, '{}', 0, now()), "
                "(:historical, :source, :version, :hash, :hash, 'succeeded', 1, "
                "now(), now(), NULL, 1, NULL)"
            ),
            params,
        )
        connection.execute(
            text(
                "INSERT INTO execution_events (id, job_id, status, kind, execution_attempt) VALUES "
                "(:claim, :historical, 'running', 'CLAIMED', 1), "
                "(:finished, :historical, 'succeeded', 'SUCCEEDED', 1)"
            ),
            params,
        )
        config = Config(ROOT / "alembic.ini")
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
        command.check(config)

    jobs = Jobs(sessions)
    pending_detail = jobs.detail(pending)
    historical_detail = jobs.detail(historical)
    assert (pending_detail.execution_attempt, historical_detail.execution_attempt) == (
        0,
        1,
    )
    assert historical_detail.valid_count == 1
    for detail in (pending_detail, historical_detail):
        assert detail.latest_claim_worker_instance_id is None
        assert detail.latest_claim_execution_origin is None
    assert [
        (
            event.event_id,
            event.kind,
            event.execution_attempt,
            event.worker_instance_id,
            event.execution_origin,
        )
        for event in jobs.events(historical)
    ] == [
        (claim, "CLAIMED", 1, None, None),
        (finished, "SUCCEEDED", 1, None, None),
    ]


def test_cli_persists_direct_execution(sessions, job_setup, pg_url, pg_schema):
    approve_job_profile(job_setup)
    _, source, version, entry, store = job_setup
    jobs = Jobs(sessions)
    job, _ = jobs.create(source, version, entry)
    url = make_url(pg_url).update_query_dict({"options": f"-csearch_path={pg_schema}"})
    result = subprocess.run(
        [sys.executable, "-m", "backend.cli", str(job.job_id)],
        cwd=ROOT,
        check=False,
        env={
            **os.environ,
            "DATABASE_URL": url.render_as_string(hide_password=False),
            "EVIDENCE_ROOT": str(store.root),
        },
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, (result.stdout, result.stderr)
    detail = jobs.detail(job.job_id)
    assert detail.status == "succeeded"
    assert detail.latest_claim_execution_origin == "direct"
    assert detail.latest_claim_worker_instance_id is None
    assert [
        (event.kind, event.worker_instance_id, event.execution_origin)
        for event in jobs.events(job.job_id)
    ] == [
        ("JOB_CREATED", None, None),
        ("CLAIMED", None, "direct"),
        ("SUCCEEDED", None, "direct"),
    ]
