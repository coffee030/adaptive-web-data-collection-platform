"""Verify the full Compose profile using its running API, containers and volumes."""

import hashlib
import json
import os
import re
import shlex
import subprocess
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime
from itertools import pairwise
from time import monotonic, sleep
from uuid import UUID, uuid4

import httpx2
import pytest
from conftest import ROOT
from test_m8_collections import approved, bind, new_intent, response
from test_vertical_slice import create_approved_source, submit_job

from backend.core.contracts import COMPOSE_FIXTURE_ORIGIN
from backend.tests.m6_fixture import CONFIGURATION, PAGES, ROOT_PATH
from backend.tests.m7_fixture import KEYWORD, search_config


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


def m7_fixture_metrics(prefix):
    return json.loads(
        compose_command(
            prefix,
            "exec",
            "-T",
            "collection-fixture",
            "python",
            "-c",
            "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8001/m7-metrics').read().decode())",
        )
    )


def test_m7_two_compose_workers_share_origin_and_preserve_detail_lineage(compose):
    prefix, url = compose
    origin = COMPOSE_FIXTURE_ORIGIN

    with httpx2.Client(base_url=url, timeout=30, trust_env=False) as client:
        registered = [
            create_approved_source(
                client,
                {
                    "adapter_type": "web",
                    "allowed_origins": [origin],
                    "allowed_paths": {origin: [f"/m7/{layout}"]},
                },
                search_config(origin, layout),
                {"adapter_type": "web", "keyword": "quick"},
            )
            for layout in ("cards", "catalog")
        ]
        before = max(end for _, _, end in m7_fixture_metrics(prefix))
        compose_command(
            prefix,
            "up",
            "-d",
            "--no-build",
            "--no-recreate",
            "--scale",
            "worker=2",
            "worker",
        )
        try:
            workers = compose_command(
                prefix, "ps", "--status", "running", "--quiet", "worker"
            ).splitlines()
            assert len(workers) == 2
            jobs = [
                submit_job(
                    client,
                    approved,
                    {"adapter_type": "web", "keyword": KEYWORD},
                    uuid4(),
                )[0]["job_id"]
                for approved in registered
            ]
            paths = [f"/api/v1/collection-jobs/{job}" for job in jobs]

            def states():
                return [client.get(path).json() for path in paths]

            wait_for(
                lambda: all(item["status"] == "running" for item in states()),
                seconds=15,
            )
            wait_for(
                lambda: all(item["status"] == "partial" for item in states()),
                seconds=40,
            )
            for job, path, approved, layout in zip(
                jobs, paths, registered, ("cards", "catalog"), strict=True
            ):
                pages = client.get(path + "/evidence-pages").json()
                assert [item["capture_kind"] for item in pages] == [
                    "search",
                    "search",
                    "detail",
                    "detail",
                    "detail",
                ]
                assert all(
                    UUID(item["profile_version_id"])
                    == UUID(approved["profile_version_id"])
                    for item in pages
                )
                assert client.get(path + "/evidence").json() == pages[0]
                results = client.get("/api/v1/records", params={"job_id": job}).json()
                assert {
                    record["payload"]["title"]: record["evidence_reference"]
                    for record in results
                } == {
                    "Alpha": pages[2]["evidence_id"],
                    "Beta": pages[3]["evidence_id"],
                }
                assert pages[-1]["original_location"].endswith(
                    f"/m7/{layout}/detail/bad"
                )
                assert (
                    client.get(path + "/quarantine").json()[0]["evidence_reference"]
                    == pages[-1]["evidence_id"]
                )

            requests = sorted(
                (
                    request
                    for request in m7_fixture_metrics(prefix)
                    if request[1] >= before
                ),
                key=lambda request: request[1],
            )
            assert len(requests) == 12
            gaps = [
                next_request[1] - previous[2]
                for previous, next_request in pairwise(requests)
            ]
            assert min(gaps) >= 0.97, gaps
            print(
                f"M7 worker jobs {jobs}; {len(requests)} requests; minimum completed-to-start gap {min(gaps):.3f}s"
            )
        finally:
            compose_command(
                prefix,
                "up",
                "-d",
                "--no-build",
                "--no-recreate",
                "--scale",
                "worker=1",
                "worker",
            )


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


def test_m7_recovers_after_worker_loss_and_keeps_terminal_lineage(compose):
    prefix, url = compose
    origin = COMPOSE_FIXTURE_ORIGIN
    with httpx2.Client(base_url=url, trust_env=False, timeout=25) as client:
        approved = create_approved_source(
            client,
            {"adapter_type": "web", "allowed_origins": [origin]},
            search_config(origin, "cards"),
            {"adapter_type": "web", "keyword": "quick"},
        )
        try:
            with block_evidence_publication(prefix):
                job, _ = submit_job(
                    client,
                    approved,
                    {"adapter_type": "web", "keyword": KEYWORD},
                    uuid4(),
                )
                job_id = UUID(job["job_id"])
                path = f"/api/v1/collection-jobs/{job_id}"
                wait_for(lambda: evidence_lock_exists(prefix, granted=False))
                compose_command(prefix, "kill", "-s", "SIGKILL", "worker")
            assert client.get(path + "/evidence-pages").json() == []
            # Exercise recovery without waiting for the already tested 90-second lease.
            compose_command(
                prefix,
                *PSQL,
                "psql",
                "-c",
                "UPDATE collection_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' "
                f"WHERE id = '{job_id}' AND status = 'running'",
            )
        finally:
            compose_command(prefix, "up", "-d", "--wait", "worker")

        wait_for(lambda: client.get(path).json()["status"] == "partial", seconds=40)
        pages_path = path + "/evidence-pages"
        records_path = f"/api/v1/records?job_id={job_id}"
        events_path = path + "/events"
        paths = [path, pages_path, records_path, events_path, path + "/quarantine"]
        before = snapshot(client, paths)
        assert before[path]["execution_attempt"] == 2
        pages = before[pages_path]
        assert [page["capture_kind"] for page in pages] == [
            "search",
            "search",
            "detail",
            "detail",
            "detail",
        ]
        assert {record["evidence_reference"] for record in before[records_path]} == {
            pages[2]["evidence_id"],
            pages[3]["evidence_id"],
        }
        assert [event["kind"] for event in before[events_path]].count(
            "WORKER_LOST"
        ) == 1
        assert [event["kind"] for event in before[events_path]].count("PARTIAL") == 1
        compose_command(
            prefix,
            "exec",
            "-T",
            "dispatcher",
            "python",
            "-c",
            "from sys import argv; from uuid import UUID; "
            "from backend.queue.dispatcher import publish_job; publish_job(UUID(argv[1]))",
            str(job_id),
        )
        skipped = f"Collection job {job_id} skipped (job_not_pending)".encode()
        wait_for(
            lambda: skipped in compose_command(prefix, "logs", "--no-color", "worker")
        )
        compose_command(prefix, "restart", "redis", "postgres", "api")
        wait_for(lambda: client.get("/api/v1/health").status_code == 200)
        assert snapshot(client, paths) == before
        for page in pages:
            raw = compose_command(
                prefix,
                "exec",
                "-T",
                "api",
                "cat",
                f"/data/evidence/{UUID(page['evidence_id']).hex}/input.bin",
            )
            assert hashlib.sha256(raw).hexdigest() == page["content_hash"]
        print(
            f"M7 Job {job_id} recovered on attempt 2, ignored a duplicate and retained five captures after restart"
        )


def docker_command(*args):
    return subprocess.check_output(
        ["docker", *args], cwd=ROOT, stderr=subprocess.STDOUT, timeout=35
    ).decode(errors="replace")


def worker_ids(container):
    return re.findall(
        r"Collection Worker instance ID: ([0-9a-f-]{36})",
        docker_command("logs", container),
    )


def check_m20_dashboard(url, phase, request_id, job_id, worker_a, worker_b):
    dashboard_dir = os.environ.get("M20_DASHBOARD_DIR")
    if not dashboard_dir:
        print(f"M20 Dashboard {phase} skipped (M20_DASHBOARD_DIR unset)")
        return
    subprocess.run(
        [
            "node",
            "node_modules/@playwright/test/cli.js",
            "test",
            "m20-attempt-identity.integration.ts",
            "--workers=1",
            "--output",
            os.path.join(dashboard_dir, phase),
        ],
        check=True,
        cwd=ROOT / "frontend",
        timeout=95,
        env={
            **os.environ,
            "M4_REAL_API": "1",
            "API_PROXY_TARGET": url,
            "M20_DASHBOARD_PHASE": phase,
            "M20_REQUEST_ID": request_id,
            "M20_JOB_ID": job_id,
            "M20_WORKER_A": worker_a,
            "M20_WORKER_B": worker_b,
        },
    )


def test_m20_worker_attempt_identity_survives_recovery_and_restart(compose):
    if os.environ.get("M20_TEST_WORKER_IDENTITY") != "1":
        pytest.skip(
            "Set M20_TEST_WORKER_IDENTITY=1 with the dedicated M20 Worker settings"
        )
    prefix, url = compose

    def workers():
        return (
            compose_command(prefix, "ps", "--status", "running", "--quiet", "worker")
            .decode()
            .splitlines()
        )

    def submit(client, keyword):
        parent = response(
            client,
            "POST",
            "/collection-requests",
            201,
            new_intent(topic, binding) | {"keyword": keyword},
        )
        return parent["id"], parent["jobs"][0]["job"]["job_id"]

    (container_a,) = workers()
    identities_a = wait_for(lambda: worker_ids(container_a))
    worker_a = identities_a[-1]
    with httpx2.Client(base_url=url, timeout=25, trust_env=False) as client:
        category = response(
            client,
            "POST",
            "/categories",
            201,
            {"name": f"M20 fixture {uuid4().hex[:8]}"},
        )
        topic = response(
            client,
            "POST",
            "/topics",
            201,
            {"name": "Worker recovery fixture", "category_id": category["id"]},
        )
        binding = bind(client, topic, approved(client, COMPOSE_FIXTURE_ORIGIN, "cards"))
        warmups = []
        for _ in range(2):
            _, warmup = submit(client, "quick")
            path = f"/api/v1/collection-jobs/{warmup}"
            warmups.append(warmup)
            warm = wait_for(
                lambda path=path: (
                    job
                    if (job := client.get(path).json())["status"] == "succeeded"
                    else None
                ),
                seconds=25,
            )
            assert warm["latest_claim_worker_instance_id"] == worker_a
            assert warm["execution_attempt"] == 1
        children = wait_for(
            lambda: (
                matches
                if len(
                    matches := re.findall(
                        r"ForkPoolWorker-(\d+).*Task collection\.execute_job\[.*\] succeeded",
                        docker_command("logs", container_a),
                    )
                )
                >= 2
                else None
            ),
            seconds=12,
        )
        assert children[-2] != children[-1]
        print(
            f"M20 warmup Jobs {warmups} ran on {worker_a} in pool children {children[-2:]}"
        )

        with block_evidence_publication(prefix):
            request_id, job_id = submit(client, KEYWORD)
            path = f"/api/v1/collection-jobs/{job_id}"
            events = path + "/events"
            captures = path + "/evidence-pages"
            records = f"/api/v1/records?job_id={job_id}"
            wait_for(lambda: evidence_lock_exists(prefix, granted=False), seconds=30)
            stale_claim = client.get(path).json()
            assert (stale_claim["status"], stale_claim["execution_attempt"]) == (
                "running",
                1,
            )
            assert stale_claim["latest_claim_worker_instance_id"] == worker_a
            assert client.get(events).json()[-1]["worker_instance_id"] == worker_a
            compose_command(
                prefix,
                "up",
                "-d",
                "--no-build",
                "--no-recreate",
                "--scale",
                "worker=2",
                "worker",
            )
            (container_b,) = set(workers()) - {container_a}
            worker_b = wait_for(lambda: worker_ids(container_b), seconds=15)[-1]
            assert worker_b != worker_a
            assert client.get(path).json() == stale_claim
            docker_command("kill", "--signal", "SIGKILL", container_a)
        assert workers() == [container_b]
        assert client.get(captures).json() == []
        assert client.get(records).json() == []
        print(
            f"M20 Request {request_id}, Job {job_id}, attempt 1 on {worker_a}, lease {stale_claim['lease_expires_at']}; Worker B {worker_b}"
        )

        def awaiting_recovery():
            current = client.get(path).json()
            return current if current["status"] == "pending" else None

        pending = wait_for(awaiting_recovery, seconds=100)
        assert pending["execution_attempt"] == 1
        assert pending["latest_claim_worker_instance_id"] == worker_a
        assert pending["error"]["code"] == "worker_lost"
        wait_for(
            lambda: (
                (job := client.get(path).json())["execution_attempt"] == 2
                and job["status"] == "running"
            ),
            seconds=20,
        )

        docker_command("pause", container_b)
        try:
            running_paths = [path, events, captures, records]
            active = snapshot(client, running_paths)
            assert active[path]["status"] == "running"
            assert active[path]["latest_claim_worker_instance_id"] == worker_b
            assert active[captures] == active[records] == []
            stale_job = {
                key: value
                for key, value in stale_claim.items()
                if not key.startswith("latest_claim_")
            }
            probe = compose_command(
                prefix,
                "exec",
                "-T",
                "api",
                "python",
                "-c",
                "import sys; from backend.application.execution import JobExecutor; "
                "from backend.application.jobs import Job; "
                "from backend.core.contracts import CollectionRunResult; "
                "from backend.core.evidence import LocalEvidenceStore; "
                "from backend.persistence.database import database_url, evidence_path, make_engine, session_factory; "
                "old = Job.model_validate_json(sys.argv[1]); "
                "result = CollectionRunResult(run_id=str(old.job_id), profile_version_id=str(old.profile_version_id), status='completed'); "
                "executor = JobExecutor(session_factory(make_engine(database_url())), LocalEvidenceStore(evidence_path())); "
                "current = executor._publish(old, result); print(current.status, current.execution_attempt)",
                json.dumps(stale_job),
            )
            assert probe.strip() == b"running 2"
            assert snapshot(client, running_paths) == active
        finally:
            docker_command("unpause", container_b)

        wait_for(lambda: client.get(path).json()["status"] == "partial", seconds=35)
        parent_path = f"/api/v1/collection-requests/{request_id}"
        before = snapshot(
            client, [parent_path, path, events, captures, records, path + "/quarantine"]
        )
        job = before[path]
        assert (
            job["job_id"] == before[parent_path]["jobs"][0]["job"]["job_id"] == job_id
        )
        assert job["execution_attempt"] == 2
        assert (job["valid_count"], job["invalid_count"], job["duplicate_count"]) == (
            2,
            1,
            0,
        )
        assert [
            (item["kind"], item["execution_attempt"], item["worker_instance_id"])
            for item in before[events]
        ] == [
            ("JOB_CREATED", 0, None),
            ("DISPATCHED", 0, None),
            ("CLAIMED", 1, worker_a),
            ("WORKER_LOST", 1, worker_a),
            ("RECOVERY_REQUESTED", 1, worker_a),
            ("DISPATCHED", 1, None),
            ("CLAIMED", 2, worker_b),
            ("PARTIAL", 2, worker_b),
        ]
        assert all(event["job_id"] == job_id for event in before[events])
        assert all(
            item["execution_origin"] == "worker"
            for item in before[events]
            if item["worker_instance_id"]
        )
        pages = before[captures]
        assert [page["capture_kind"] for page in pages] == [
            "search",
            "search",
            "detail",
            "detail",
            "detail",
        ]
        assert {
            row["payload"]["title"]: row["evidence_reference"]
            for row in before[records]
        } == {
            "Alpha": pages[2]["evidence_id"],
            "Beta": pages[3]["evidence_id"],
        }
        assert [
            item["evidence_reference"] for item in before[path + "/quarantine"]
        ] == [pages[4]["evidence_id"]]
        compose_command(
            prefix,
            "exec",
            "-T",
            "dispatcher",
            "python",
            "-c",
            "from sys import argv; from uuid import UUID; "
            "from backend.queue.dispatcher import publish_job; publish_job(UUID(argv[1]))",
            job_id,
        )
        wait_for(
            lambda: (
                f"Collection job {job_id} skipped (job_not_pending)"
                in docker_command("logs", container_b)
            )
        )
        assert snapshot(client, before) == before
        check_m20_dashboard(url, "before", request_id, job_id, worker_a, worker_b)

        compose_command(prefix, "restart", "postgres", "redis", "collection-fixture")
        compose_command(
            prefix, "up", "-d", "--wait", "postgres", "redis", "collection-fixture"
        )
        compose_command(prefix, "restart", "api", "dispatcher")
        docker_command("restart", container_b)
        restarted_b = wait_for(
            lambda: (
                ids[-1] if (ids := worker_ids(container_b))[-1] != worker_b else None
            )
        )
        assert restarted_b not in {worker_a, worker_b}
        wait_for(lambda: client.get("/api/v1/health").status_code == 200)
        assert snapshot(client, before) == before
        for page in pages:
            raw = compose_command(
                prefix,
                "exec",
                "-T",
                "api",
                "cat",
                f"/data/evidence/{UUID(page['evidence_id']).hex}/input.bin",
            )
            assert hashlib.sha256(raw).hexdigest() == page["content_hash"]
        check_m20_dashboard(url, "after", request_id, job_id, worker_a, worker_b)
        print(f"M20 restarted Worker B on {restarted_b}; snapshots identical")
        print("M20 acceptance snapshot:", json.dumps(before, ensure_ascii=True))


def test_compose_revocation_after_search_prevents_next_capture(compose):
    prefix, url = compose
    origin = COMPOSE_FIXTURE_ORIGIN
    keyword = f"revoke-{uuid4().hex}"
    with httpx2.Client(base_url=url, trust_env=False, timeout=5) as client:
        approved = create_approved_source(
            client,
            {
                "adapter_type": "web",
                "allowed_origins": [origin],
                "allowed_paths": {origin: ["/m7/cards"]},
            },
            search_config(origin, "cards"),
            {"adapter_type": "web", "keyword": "quick"},
        )
        # Observe the real fixture within Docker to revoke during the origin cooldown.
        watch = """
import json
import sys
from time import monotonic, sleep
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

origin, source_id, keyword = sys.argv[1:]
deadline = monotonic() + 20
while monotonic() < deadline:
    with urlopen(origin + "/m7-metrics", timeout=2) as reply:
        requests = json.load(reply)
    for path, _, _ in requests:
        if parse_qs(urlsplit(path).query).get("q") == [keyword]:
            request = Request(
                f"http://127.0.0.1:8000/api/v1/sources/{source_id}/authorization",
                data=b'{"approval_status":"revoked"}',
                headers={"Content-Type": "application/json"},
                method="PATCH",
            )
            with urlopen(request, timeout=2) as reply:
                assert json.load(reply)["approval_status"] == "revoked"
            print(path)
            sys.exit(0)
    sleep(0.05)
raise RuntimeError("The fixture did not receive the submitted search")
"""
        with ThreadPoolExecutor(max_workers=1) as executor:
            revoke = executor.submit(
                compose_command,
                prefix,
                "exec",
                "-T",
                "api",
                "python",
                "-c",
                watch,
                origin,
                approved["source_id"],
                keyword,
            )
            job, _ = submit_job(
                client, approved, {"adapter_type": "web", "keyword": keyword}, uuid4()
            )
            search = revoke.result(timeout=25).decode().strip()
        assert search == f"/m7/cards/search?q={keyword}"
        job_id = job["job_id"]
        path = f"/api/v1/collection-jobs/{job_id}"
        wait_for(lambda: client.get(path).json()["status"] == "failed")
        pages, records = path + "/evidence-pages", f"/api/v1/records?job_id={job_id}"
        result = snapshot(client, [path, pages, records])
        assert result[path]["execution_attempt"] == 1
        assert result[path]["error"]["code"] == "source_not_approved"
        assert result[records] == []
        served_paths = [path for path, _, _ in m7_fixture_metrics(prefix)]
        assert served_paths[served_paths.index(search) :] == [search]
        [page] = result[pages]
        assert (
            page["capture_kind"] == "search"
            and page["original_location"] == origin + search
        )
        raw = compose_command(
            prefix,
            "exec",
            "-T",
            "api",
            "cat",
            f"/data/evidence/{UUID(page['evidence_id']).hex}/input.bin",
        )
        assert hashlib.sha256(raw).hexdigest() == page["content_hash"]
        print(
            f"Revoked Source after search for Job {job_id}; retained only capture {page['evidence_id']}"
        )
