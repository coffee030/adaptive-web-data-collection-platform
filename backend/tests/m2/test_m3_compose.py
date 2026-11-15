"""Verify the full Compose profile using its running API, containers and volumes."""

import hashlib
import os
import shlex
import subprocess
from contextlib import contextmanager
from datetime import datetime
from time import monotonic, sleep
from uuid import UUID, uuid4

import httpx2
import pytest
from conftest import ROOT
from test_vertical_slice import create_approved_source, submit_job

from backend.core.contracts import COMPOSE_FIXTURE_ORIGIN
from backend.tests.m6_fixture import CONFIGURATION, PAGES, ROOT_PATH


@pytest.fixture
def compose():
    project = os.environ.get("M3_TEST_COMPOSE_PROJECT")
    url = os.environ.get("M3_TEST_COMPOSE_API_URL")
    if not project or not url:
        pytest.skip("Set M3_TEST_COMPOSE_PROJECT and M3_TEST_COMPOSE_API_URL")
    if not project.startswith("collection-m3-test"):
        pytest.fail("Select a dedicated collection-m3-test Compose project")

    return [
        "docker",
        "compose",
        "-p",
        project,
        "-f",
        "compose.yaml",
        "-f",
        "compose.fixture.yaml",
        *shlex.split(os.environ.get("M3_TEST_COMPOSE_EXTRA_ARGS", "")),
    ], url


def compose_command(prefix, *args):
    return subprocess.run(
        [*prefix, *args],
        check=True,
        cwd=ROOT,
        capture_output=True,
        timeout=110,
    ).stdout


PSQL = (
    "exec",
    "-T",
    "postgres",
    "sh",
    "-c",
    'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"',
)


def evidence_lock_exists(prefix, *, granted):
    condition = "granted" if granted else "NOT granted"
    return (
        compose_command(
            prefix,
            *PSQL,
            "psql",
            "-c",
            "SELECT EXISTS (SELECT 1 FROM pg_locks "
            "WHERE relation = 'raw_evidence'::regclass "
            f"AND {condition})",
        ).strip()
        == b"t"
    )


@contextmanager
def block_evidence_publication(prefix):
    with subprocess.Popen(
        [*prefix, *PSQL],
        cwd=ROOT,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    ) as connection:
        connection.stdin.write(
            b"BEGIN; LOCK TABLE raw_evidence IN ACCESS EXCLUSIVE MODE;\n"
        )
        connection.stdin.flush()
        try:
            wait_for(
                lambda: evidence_lock_exists(prefix, granted=True),
                seconds=15,
            )
            yield
        finally:
            _, stderr = connection.communicate(timeout=10)
            assert connection.returncode == 0, stderr.decode(errors="replace")


def wait_for(check, seconds=35):
    deadline = monotonic() + seconds
    while monotonic() < deadline:
        try:
            result = check()
            if result:
                return result
        except httpx2.RequestError:
            pass
        sleep(0.5)
    raise AssertionError("Timed out waiting for Compose integration state")


def snapshot(client, paths):
    result = {}
    for path in paths:
        response = client.get(path)
        assert response.status_code == 200, response.text
        result[path] = response.json()
    return result


def test_compose_html_csv_broker_stop_and_named_volume_restart(compose, config):
    prefix, url = compose

    def command(*args):
        return compose_command(prefix, *args)

    with httpx2.Client(base_url=url, trust_env=False, timeout=3) as client:
        wait_for(lambda: client.get("/api/v1/health").status_code == 200)
        html_entry = {
            "adapter_type": "web",
            "url": COMPOSE_FIXTURE_ORIGIN + "/table.html",
        }
        html_profile = create_approved_source(
            client,
            {"adapter_type": "web", "allowed_origins": [COMPOSE_FIXTURE_ORIGIN]},
            {
                "adapter_type": "web",
                "config_schema_version": "1",
                "selector_type": "css",
                "item_selector": "#entries tr",
                "fields": [{"name": "title", "selector": "a"}],
                "record_schema": {
                    "record_type": "fixture",
                    "schema_version": "1",
                    "identity_field": "title",
                    "fields": [{"name": "title"}],
                },
            },
            html_entry,
        )
        html_job, _ = submit_job(client, html_profile, html_entry, uuid4())
        html_path = f"/api/v1/collection-jobs/{html_job['job_id']}"
        wait_for(lambda: client.get(html_path).json()["status"] == "succeeded")

        csv_raw = b"Name,Count\nAlpha,2\nBeta,3\nAlpha,4\nInvalid,many\n"
        csv_entry = {
            "adapter_type": "csv",
            "dataset_id": "listings",
            "content": csv_raw.decode(),
        }
        csv_profile = create_approved_source(
            client,
            {"adapter_type": "csv", "allowed_datasets": ["listings"]},
            config.model_dump(mode="json"),
            csv_entry | {"content": "Name,Count\nSample,1\n"},
        )
        command("stop", "redis")
        try:
            job, _ = submit_job(client, csv_profile, csv_entry, uuid4())
            csv_path = f"/api/v1/collection-jobs/{job['job_id']}"
            pending = wait_for(
                lambda: (
                    state
                    if (state := client.get(csv_path).json())["dispatch_error_code"]
                    else None
                )
            )
            assert pending["status"] == "pending"
            assert pending["dispatch_error_code"] == "broker_unavailable"
            assert pending["last_dispatched_at"] is None
        finally:
            command("start", "redis")
        wait_for(lambda: client.get(csv_path).json()["status"] == "partial")
        csv_result = snapshot(client, [csv_path])[csv_path]
        assert csv_result["valid_count"] == 2
        assert csv_result["invalid_count"] == 1
        assert csv_result["duplicate_count"] == 1

        events_path = csv_path + "/events"
        before_duplicate = snapshot(client, [csv_path, events_path])
        command(
            "exec",
            "-T",
            "dispatcher",
            "python",
            "-c",
            "from sys import argv; from uuid import UUID; "
            "from backend.queue.dispatcher import publish_job; publish_job(UUID(argv[1]))",
            job["job_id"],
        )
        skip_message = (
            f"Collection job {job['job_id']} skipped (job_not_pending)".encode()
        )
        wait_for(lambda: skip_message in command("logs", "--no-color", "worker"))
        assert snapshot(client, [csv_path, events_path]) == before_duplicate

        paths = []
        evidence_files = {}
        for completed_job, profile, raw, count in (
            (
                html_job,
                html_profile,
                (ROOT / "backend/tests/fixtures/m0/table.html").read_bytes(),
                2,
            ),
            (job, csv_profile, csv_raw, 2),
        ):
            job_id = completed_job["job_id"]
            job_path = f"/api/v1/collection-jobs/{job_id}"
            source_path = f"/api/v1/sources/{profile['source_id']}"
            records_path = f"/api/v1/records?job_id={job_id}"
            records = client.get(records_path).json()
            assert len(records) == count
            evidence_id = UUID(records[0]["evidence_reference"])
            evidence_path = f"/api/v1/evidence/{evidence_id}"
            metadata = client.get(evidence_path).json()
            assert metadata["job_id"] == job_id
            assert metadata["content_hash"] == hashlib.sha256(raw).hexdigest()
            assert all(
                UUID(record["evidence_reference"]) == evidence_id for record in records
            )
            quarantine_path = job_path + "/quarantine"
            quarantine = snapshot(client, [quarantine_path])[quarantine_path]
            assert len(quarantine) == int(job_id == job["job_id"])
            assert all(
                UUID(item["evidence_reference"]) == evidence_id for item in quarantine
            )
            evidence_files[f"{evidence_id.hex}/input.bin"] = raw
            paths.extend(
                [
                    job_path,
                    job_path + "/events",
                    source_path,
                    source_path + f"/versions/{profile['profile_version_id']}",
                    records_path,
                    evidence_path,
                    quarantine_path,
                ]
            )
        before = snapshot(client, paths)

        def postgres_volume():
            container_id = command("ps", "-q", "postgres").decode().strip()
            assert container_id
            mount = (
                subprocess.run(
                    [
                        "docker",
                        "inspect",
                        "--format",
                        '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}} {{.Name}}{{end}}{{end}}',
                        container_id,
                    ],
                    cwd=ROOT,
                    capture_output=True,
                    check=True,
                    timeout=15,
                )
                .stdout.decode()
                .strip()
            )
            mount_type, name = mount.split()
            assert mount_type == "volume"
            return name

        volume = postgres_volume()
        command("stop", "dispatcher", "worker", "api")
        try:
            command("restart", "postgres", "redis", "collection-fixture")
        finally:
            command("up", "-d", "--wait")
        wait_for(lambda: client.get("/api/v1/health").status_code == 200)
        assert postgres_volume() == volume
        assert snapshot(client, paths) == before
        for reference, raw in evidence_files.items():
            for service in ("api", "worker"):
                assert (
                    command("exec", "-T", service, "cat", f"/data/evidence/{reference}")
                    == raw
                )


def test_compose_prefork_recovers_after_worker_container_is_killed(compose, config):
    prefix, url = compose
    raw = b"Name,Count\nAlpha,2\n"
    entry = {"adapter_type": "csv", "dataset_id": "listings", "content": raw.decode()}
    with httpx2.Client(base_url=url, trust_env=False, timeout=3) as client:
        wait_for(lambda: client.get("/api/v1/health").status_code == 200)
        approved = create_approved_source(
            client,
            {"adapter_type": "csv", "allowed_datasets": ["listings"]},
            config.model_dump(mode="json"),
            entry,
        )
        try:
            with block_evidence_publication(prefix):
                job, _ = submit_job(client, approved, entry, uuid4())
                path = f"/api/v1/collection-jobs/{job['job_id']}"
                wait_for(lambda: evidence_lock_exists(prefix, granted=False))
                assert client.get(path).json()["status"] == "running"
                compose_command(prefix, "kill", "-s", "SIGKILL", "worker")
                assert not compose_command(prefix, "ps", "-q", "worker").strip()
            interrupted = client.get(path).json()
            assert interrupted["status"] == "running"
            assert interrupted["execution_attempt"] == 1
        finally:
            compose_command(prefix, "up", "-d", "--wait", "worker")

        wait_for(lambda: client.get(path).json()["status"] == "succeeded", seconds=115)
        final = client.get(path).json()
        assert final["execution_attempt"] == 2
        assert final["valid_count"] == 1
        events = snapshot(client, [f"{path}/events"])[f"{path}/events"]
        lost = [event for event in events if event["kind"] == "WORKER_LOST"]
        assert len(lost) == 1
        assert lost[0]["execution_attempt"] == 1
        assert datetime.fromisoformat(lost[0]["occurred_at"]) >= datetime.fromisoformat(
            interrupted["lease_expires_at"]
        )
        assert sum(event["kind"] == "RECOVERY_REQUESTED" for event in events) == 1
        terminal = [
            event
            for event in events
            if event["status"] in {"succeeded", "partial", "failed"}
        ]
        assert [(event["kind"], event["execution_attempt"]) for event in terminal] == [
            ("SUCCEEDED", 2)
        ]
        print(
            f"Job {job['job_id']} lease expired at {interrupted['lease_expires_at']}; "
            f"worker loss recorded at {lost[0]['occurred_at']}; "
            f"attempt 2 finished at {final['finished_at']}"
        )
        records = client.get("/api/v1/records", params={"job_id": job["job_id"]}).json()
        assert len(records) == 1
        evidence = client.get(
            f"/api/v1/evidence/{records[0]['evidence_reference']}"
        ).json()
        assert evidence["content_hash"] == hashlib.sha256(raw).hexdigest()
        assert (
            compose_command(
                prefix,
                "exec",
                "-T",
                "worker",
                "cat",
                f"/data/evidence/{UUID(evidence['evidence_id']).hex}/input.bin",
            )
            == raw
        )


def test_compose_multi_page_lineage_survives_worker_loss_and_postgres_restart(compose):
    prefix, url = compose

    def command(*args):
        return compose_command(prefix, *args)

    with httpx2.Client(base_url=url, trust_env=False, timeout=3) as client:
        wait_for(lambda: client.get("/api/v1/health").status_code == 200)
        origin = COMPOSE_FIXTURE_ORIGIN
        entry = {"adapter_type": "web", "url": origin + ROOT_PATH + "1"}
        approved = create_approved_source(
            client,
            {"adapter_type": "web", "allowed_origins": [origin]},
            CONFIGURATION,
            entry,
        )
        try:
            with block_evidence_publication(prefix):
                job, _ = submit_job(client, approved, entry, uuid4())
                job_id = job["job_id"]
                path = f"/api/v1/collection-jobs/{job_id}"
                wait_for(lambda: evidence_lock_exists(prefix, granted=False))
                assert client.get(path).json()["status"] == "running"
                command("kill", "-s", "SIGKILL", "worker")
            assert client.get(path + "/evidence-pages").json() == []
        finally:
            command("up", "-d", "--wait", "worker")

        wait_for(lambda: client.get(path).json()["status"] == "partial", seconds=115)
        records_path = f"/api/v1/records?job_id={job_id}"
        pages_path = path + "/evidence-pages"
        quarantine_path = path + "/quarantine"
        events_path = path + "/events"
        paths = [
            path,
            records_path,
            pages_path,
            quarantine_path,
            events_path,
            path + "/evidence",
        ]
        before = snapshot(client, paths)
        final = before[path]
        assert final["execution_attempt"] == 2 and final["error"] is None
        assert (
            final["valid_count"],
            final["invalid_count"],
            final["duplicate_count"],
        ) == (3, 2, 1)
        assert [event["kind"] for event in before[events_path]].count(
            "WORKER_LOST"
        ) == 1
        assert [event["kind"] for event in before[events_path]].count("PARTIAL") == 1
        pages = before[pages_path]
        assert [item["page_number"] for item in pages] == [1, 2, 3]
        assert before[path + "/evidence"] == pages[0]
        assert len({item["run_id"] for item in pages}) == 1
        assert {
            item["payload"]["title"]: item["evidence_reference"]
            for item in before[records_path]
        } == {
            title: item["evidence_id"]
            for title, item in zip(("Alpha", "Beta", "Gamma"), pages, strict=True)
        }
        assert [
            item["source_position"]["index"] for item in before[quarantine_path]
        ] == [2, 2]
        assert [item["evidence_reference"] for item in before[quarantine_path]] == [
            item["evidence_id"] for item in pages[1:]
        ]

        command(
            "exec",
            "-T",
            "dispatcher",
            "python",
            "-c",
            "from sys import argv; from uuid import UUID; "
            "from backend.queue.dispatcher import publish_job; publish_job(UUID(argv[1]))",
            job_id,
        )
        skip_message = f"Collection job {job_id} skipped (job_not_pending)".encode()
        wait_for(lambda: skip_message in command("logs", "--no-color", "worker"))
        assert snapshot(client, paths) == before

        postgres_id = command("ps", "-q", "postgres")
        command("restart", "postgres", "api")
        wait_for(lambda: client.get("/api/v1/health").status_code == 200)
        assert command("ps", "-q", "postgres") == postgres_id
        assert snapshot(client, paths) == before
        approved_id = UUID(approved["profile_version_id"])
        for capture, (location, raw) in zip(pages, PAGES.items(), strict=True):
            assert capture["original_location"] == origin + location
            assert UUID(capture["profile_version_id"]) == approved_id
            evidence_id = UUID(capture["evidence_id"])
            detail = f"/api/v1/evidence/{evidence_id}"
            assert snapshot(client, [detail])[detail] == capture
            assert capture["content_hash"] == hashlib.sha256(raw).hexdigest()
            for service in ("api", "worker"):
                assert (
                    command(
                        "exec",
                        "-T",
                        service,
                        "cat",
                        f"/data/evidence/{evidence_id.hex}/input.bin",
                    )
                    == raw
                )
        print(
            f"M6 Job {job_id} recovered on attempt 2 and retained three evidence pages after restart"
        )
