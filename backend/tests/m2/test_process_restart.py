"""Exercise server and CLI process boundaries with durable PostgreSQL and evidence."""

import hashlib
import os
import socket
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path
from time import monotonic, sleep
from uuid import UUID, uuid4

import httpx2
from conftest import ROOT
from sqlalchemy.engine import make_url
from test_vertical_slice import create_approved_source, submit_job

from backend.core.evidence import LocalEvidenceStore


def child_environment(pg_url, pg_schema, evidence_root):
    url = make_url(pg_url)
    options = f"{url.query.get('options', '')} -c search_path={pg_schema}".strip()
    return os.environ | {
        "DATABASE_URL": url.update_query_dict({"options": options}).render_as_string(
            hide_password=False
        ),
        "EVIDENCE_ROOT": str(evidence_root),
    }


def wait_for_health(client, process):
    deadline = monotonic() + 25
    while monotonic() < deadline and process.poll() is None:
        try:
            if client.get("/api/v1/health").status_code == 200:
                return
        except httpx2.RequestError:
            pass
        sleep(0.1)
    raise AssertionError("The restarted API did not become healthy")


@contextmanager
def server(env, log_path):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    with log_path.open("w", encoding="utf-8") as log:
        api = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "backend.api.app:create_app",
                "--factory",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
            ],
            cwd=ROOT,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            with httpx2.Client(
                base_url=f"http://127.0.0.1:{port}", trust_env=False, timeout=2
            ) as client:
                wait_for_health(client, api)
                yield api.pid, client
        finally:
            api.terminate()
            try:
                api.wait(timeout=10)
            except subprocess.TimeoutExpired:
                api.kill()
                api.wait(timeout=5)


def snapshot(client, paths):
    responses = [client.get(path) for path in paths]
    assert all(response.status_code == 200 for response in responses)
    return [response.json() for response in responses]


def restart_database_if_requested(env):
    compose_project = os.environ.get("M2_TEST_COMPOSE_PROJECT")
    pgctl = os.environ.get("M2_TEST_PG_CTL")
    pgdata = os.environ.get("M2_TEST_PGDATA")
    if compose_project:
        compose = ["docker", "compose", "-p", compose_project]

        def command(*args):
            return (
                subprocess.check_output(
                    args,
                    cwd=ROOT,
                    env=env,
                    timeout=60,
                )
                .decode()
                .strip()
            )

        container = command(*compose, "ps", "-q", "postgres")
        assert container

        def volume():
            mount = command(
                "docker",
                "inspect",
                "--format",
                '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}} {{.Name}}{{end}}{{end}}',
                container,
            )
            mount_type, name = mount.split()
            assert mount_type == "volume"
            return name

        original_volume = volume()
        command(*compose, "restart", "postgres")
        assert command(*compose, "ps", "-q", "postgres") == container
        assert volume() == original_volume
        print(f"PostgreSQL container {container} retained volume {original_volume}")
    elif pgctl and pgdata:
        subprocess.run(
            [
                pgctl,
                "restart",
                "-D",
                pgdata,
                "-m",
                "fast",
                "-w",
                "-l",
                str(Path(pgdata) / "m2-restart.log"),
            ],
            check=True,
            cwd=ROOT,
            env=env,
            timeout=60,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def test_real_api_restart_preserves_committed_job_and_lineage(
    pg_engine, pg_url, pg_schema, tmp_path, config
):
    env = child_environment(pg_url, pg_schema, tmp_path)
    entry = {
        "adapter_type": "csv",
        "dataset_id": "listings",
        "content": "Name,Count\nAlpha,2\n",
    }
    with server(env, tmp_path / "api-before.log") as (before_pid, client):
        profile = create_approved_source(
            client,
            {"adapter_type": "csv", "allowed_datasets": ["listings"]},
            config.model_dump(mode="json"),
            entry,
        )
        job, _ = submit_job(client, profile, entry, uuid4())
        job_id = job["job_id"]
        execution = subprocess.run(
            [sys.executable, "-m", "backend.cli", job_id],
            cwd=ROOT,
            env=env,
            check=False,
            text=True,
            capture_output=True,
            timeout=20,
        )
        assert execution.returncode == 0, execution.stdout + execution.stderr
        records = client.get("/api/v1/records", params={"job_id": job_id}).json()
        assert len(records) == 1
        record = records[0]
        source_path = f"/api/v1/sources/{profile['source_id']}"
        paths = [
            source_path,
            source_path + f"/versions/{profile['profile_version_id']}",
            f"/api/v1/collection-jobs/{job_id}",
            f"/api/v1/collection-jobs/{job_id}/events",
            f"/api/v1/records/{record['record_id']}",
            f"/api/v1/evidence/{record['evidence_reference']}",
        ]
        before = snapshot(client, paths)
        assert before[2]["status"] == "succeeded"

    pg_engine.dispose()
    restart_database_if_requested(env)
    with server(env, tmp_path / "api-after.log") as (after_pid, restarted):
        assert before_pid != after_pid
        assert snapshot(restarted, paths) == before
        metadata = before[-1]
        _, raw = LocalEvidenceStore(tmp_path).resolve(UUID(metadata["evidence_id"]).hex)
        assert raw == entry["content"].encode()
        assert hashlib.sha256(raw).hexdigest() == metadata["content_hash"]
