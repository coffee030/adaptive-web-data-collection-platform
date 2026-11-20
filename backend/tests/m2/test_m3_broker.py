"""Exercise the real Redis transport and a separate Celery worker process."""

import os
import signal
import socket
import subprocess
import sys
from contextlib import contextmanager
from time import monotonic, sleep, time
from uuid import UUID, uuid4

import pytest
from celery import Celery
from conftest import ROOT
from redis import Redis
from redis.exceptions import RedisError
from sqlalchemy import func, update
from test_process_restart import child_environment, server
from test_vertical_slice import create_approved_source, site, submit_job  # noqa: F401

from backend.core.evidence import LocalEvidenceStore
from backend.persistence.models import JobRow
from backend.queue.celery_app import QUEUE, TASK, VISIBILITY_TIMEOUT, app
from backend.queue.dispatcher import Dispatcher


def wait_for(check, process, description, log_path):
    deadline = monotonic() + 25
    while monotonic() < deadline and process.poll() is None:
        result = check()
        if result:
            return result
        sleep(0.2)
    raise AssertionError(f"{description}\n{log_path.read_text(encoding='utf-8')}")


@contextmanager
def worker(env, log_path, *, name="m3-test", module="backend.queue.celery_app"):
    pool = "solo" if os.name == "nt" else "prefork"
    args = [
        sys.executable,
        "-m",
        "celery",
        "-A",
        f"{module}:app",
        "worker",
        "--loglevel=INFO",
        f"--pool={pool}",
        f"--hostname={name}@%h",
        "--without-gossip",
        "--without-mingle",
    ]
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            args,
            cwd=ROOT,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=os.name != "nt",
        )
        try:
            wait_for(
                lambda: " ready." in log_path.read_text(encoding="utf-8"),
                process,
                "Worker did not become ready",
                log_path,
            )
            yield process
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    kill_worker(process)


def kill_worker(process):
    if os.name == "nt":
        process.kill()
    else:
        os.killpg(process.pid, signal.SIGKILL)
    process.wait(timeout=10)


@pytest.fixture
def broker_url():
    url = os.environ.get("M3_TEST_BROKER_URL")
    if not url:
        pytest.skip("Set M3_TEST_BROKER_URL to an isolated, running Redis broker")
    return url


def broker_producer(url):
    producer = Celery(broker=url)
    producer.conf.update(app.conf.changes)
    producer.conf.broker_url = url
    return producer


@contextmanager
def dispatcher(env, log_path):
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            [sys.executable, "-m", "backend.queue.dispatcher"],
            cwd=ROOT,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            wait_for(
                lambda: "polling PostgreSQL" in log_path.read_text(encoding="utf-8"),
                process,
                "Dispatcher did not start",
                log_path,
            )
            yield process
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def csv_submission(client, config):
    entry = {
        "adapter_type": "csv",
        "dataset_id": "listings",
        "content": "Name,Count\nAlpha,2\n",
    }
    approved = create_approved_source(
        client,
        {"adapter_type": "csv", "allowed_datasets": ["listings"]},
        config.model_dump(mode="json"),
        entry,
    )
    return submit_job(client, approved, entry, uuid4())[0]


def job_status(client, job_id):
    response = client.get(f"/api/v1/collection-jobs/{job_id}")
    assert response.status_code == 200, response.text
    return response.json()


def assert_results(client, job_id, root, raw, count):
    import hashlib

    records = client.get("/api/v1/records", params={"job_id": job_id}).json()
    assert len(records) == count
    response = client.get(f"/api/v1/evidence/{records[0]['evidence_reference']}")
    assert response.status_code == 200
    evidence = response.json()
    assert evidence["content_hash"] == hashlib.sha256(raw).hexdigest()
    assert LocalEvidenceStore(root).resolve(UUID(evidence["evidence_id"]).hex)[1] == raw


def test_real_worker_csv_duplicate_delivery(
    pg_engine, pg_url, pg_schema, tmp_path, config, broker_url
):
    env = child_environment(pg_url, pg_schema, tmp_path)
    env["CELERY_BROKER_URL"] = broker_url
    producer = broker_producer(broker_url)
    entry = {
        "adapter_type": "csv",
        "dataset_id": "listings",
        "content": "Name,Count\nAlpha,2\n",
    }
    log = tmp_path / "worker.log"
    with server(env, tmp_path / "api.log") as (_, client), worker(env, log) as process:
        profile = create_approved_source(
            client,
            {"adapter_type": "csv", "allowed_datasets": ["listings"]},
            config.model_dump(mode="json"),
            entry,
        )
        job, _ = submit_job(client, profile, entry, uuid4())
        job_id = job["job_id"]
        path = f"/api/v1/collection-jobs/{job_id}"
        for _ in range(2):
            producer.send_task(TASK, args=[job_id], queue=QUEUE, ignore_result=True)

        def completed():
            status = client.get(path).json()["status"]
            assert status in {"pending", "running", "succeeded"}
            return status == "succeeded" and "job_not_pending" in log.read_text(
                encoding="utf-8"
            )

        wait_for(completed, process, "Job or duplicate did not finish", log)
        records = client.get("/api/v1/records", params={"job_id": job_id}).json()
        assert len(records) == 1
        assert [event["status"] for event in client.get(f"{path}/events").json()] == [
            "pending",
            "running",
            "succeeded",
        ]
        assert len(list(tmp_path.glob("*/input.bin"))) == 1


def test_real_dispatcher_html_with_two_workers(
    pg_engine, pg_url, pg_schema, tmp_path, broker_url, request
):
    origin = request.getfixturevalue("site")
    env = child_environment(pg_url, pg_schema, tmp_path)
    env["CELERY_BROKER_URL"] = broker_url
    log = tmp_path / "worker.log"
    with (
        server(env, tmp_path / "api.log") as (_, client),
        worker(env, log) as process,
        worker(env, tmp_path / "second.log", name="m3-second"),
        dispatcher(env, tmp_path / "dispatcher.log"),
    ):
        entry = {"adapter_type": "web", "url": origin + "/table.html"}
        approved = create_approved_source(
            client,
            {"adapter_type": "web", "allowed_origins": [origin]},
            {
                "adapter_type": "web",
                "config_schema_version": "1",
                "selector_type": "css",
                "item_selector": "#entries tr",
                "fields": [{"name": "title", "selector": "a"}],
                "record_schema": {
                    "record_type": "listing",
                    "schema_version": "1",
                    "identity_field": "title",
                    "fields": [{"name": "title"}],
                },
            },
            entry,
        )
        job, _ = submit_job(client, approved, entry, uuid4())
        job_id = job["job_id"]
        assert job["status"] == "pending"
        wait_for(
            lambda: job_status(client, job_id)["status"] == "succeeded",
            process,
            "HTML job did not finish",
            log,
        )
        final = job_status(client, job_id)
        assert final["execution_attempt"] == 1
        events = client.get(f"/api/v1/collection-jobs/{job_id}/events").json()
        assert [event["kind"] for event in events] == [
            "JOB_CREATED",
            "DISPATCHED",
            "CLAIMED",
            "SUCCEEDED",
        ]
        assert (
            client.get("/api/v1/collection-jobs", params={"status": "running"}).json()
            == []
        )
        raw = (ROOT / "backend/tests/fixtures/m0/table.html").read_bytes()
        assert_results(client, job_id, tmp_path, raw, 2)


def test_real_broker_outage_keeps_job_pending(
    pg_engine, pg_url, pg_schema, tmp_path, config, broker_url, sessions
):
    redis_server = os.environ.get("M3_TEST_REDIS_SERVER")
    env = child_environment(pg_url, pg_schema, tmp_path)
    log = tmp_path / "worker.log"
    with socket.socket() as reserved:
        reserved.bind(("127.0.0.1", 0))
        port = reserved.getsockname()[1]
        unavailable_url = f"redis://127.0.0.1:{port}/0"
        broker = broker_producer(unavailable_url)
        reserved.close()
        with local_broker(redis_server, port, tmp_path):
            pass
        with server(env, tmp_path / "api.log") as (_, client):
            job_id = csv_submission(client, config)["job_id"]
            publisher = Dispatcher(
                sessions, lambda job_id: broker.send_task(TASK, args=[str(job_id)])
            )
            assert not publisher.dispatch_one()
            pending = job_status(client, job_id)
            assert pending["status"] == "pending"
            assert pending["dispatch_error_code"] == "broker_unavailable"
            assert pending["last_dispatched_at"] is None
            with local_broker(redis_server, port, tmp_path):
                env["CELERY_BROKER_URL"] = (
                    unavailable_url if redis_server else broker_url
                )
                with (
                    worker(env, log) as process,
                    dispatcher(env, tmp_path / "dispatcher.log"),
                ):
                    wait_for(
                        lambda: job_status(client, job_id)["status"] == "succeeded",
                        process,
                        "Job did not finish after broker became reachable",
                        log,
                    )
            final = job_status(client, job_id)
            assert final["dispatch_attempts"] == 2
            assert final["execution_attempt"] == 1


@contextmanager
def local_broker(executable, port, root):
    if not executable:
        yield
        return
    log_path = root / "redis.log"
    with log_path.open("a", encoding="utf-8") as log:
        process = subprocess.Popen(
            [
                executable,
                "--bind",
                "127.0.0.1",
                "--port",
                str(port),
                "--save",
                "",
                "--appendonly",
                "no",
            ],
            cwd=root,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            with Redis(
                host="127.0.0.1", port=port, socket_connect_timeout=0.5
            ) as redis:

                def ready():
                    try:
                        return redis.ping()
                    except RedisError:
                        return False

                wait_for(ready, process, "Dedicated Redis did not start", log_path)
                yield
        finally:
            process.terminate()
            process.wait(timeout=10)


def test_real_worker_killed_during_collection_is_recovered(
    pg_engine, pg_url, pg_schema, tmp_path, config, broker_url, sessions
):
    env = child_environment(pg_url, pg_schema, tmp_path)
    env["CELERY_BROKER_URL"] = broker_url
    first_log = tmp_path / "interrupted.log"
    log = tmp_path / "worker.log"
    # Hold a PostgreSQL lock that the worker will encounter at result publication.
    with server(env, tmp_path / "api.log") as (_, client):
        job_id = csv_submission(client, config)["job_id"]
        with sessions.begin() as lock:
            lock.connection().exec_driver_sql(
                "LOCK TABLE raw_evidence IN ACCESS EXCLUSIVE MODE"
            )
            # Acquire the publication lock before the dispatcher can claim the job.
            with (
                worker(env, first_log) as first,
                dispatcher(env, tmp_path / "dispatcher.log"),
            ):
                wait_for(
                    lambda: list(tmp_path.glob("*/input.bin")),
                    first,
                    "Worker did not capture evidence",
                    first_log,
                )
                kill_worker(first)
        running = job_status(client, job_id)
        assert running["status"] == "running"
        assert running["execution_attempt"] == 1
        assert client.get("/api/v1/records", params={"job_id": job_id}).json() == []
        with sessions.begin() as session:
            session.execute(
                update(JobRow)
                .where(JobRow.id == UUID(job_id))
                .values(lease_expires_at=func.now())
            )
        with worker(env, log) as process, dispatcher(env, tmp_path / "recovery.log"):
            wait_for(
                lambda: job_status(client, job_id)["status"] == "succeeded",
                process,
                "Killed job did not recover",
                log,
            )
        final = job_status(client, job_id)
        assert final["execution_attempt"] == 2
        kinds = [
            event["kind"]
            for event in client.get(f"/api/v1/collection-jobs/{job_id}/events").json()
        ]
        assert "WORKER_LOST" in kinds and "RECOVERY_REQUESTED" in kinds
        assert kinds.count("SUCCEEDED") == 1
        assert_results(client, job_id, tmp_path, b"Name,Count\nAlpha,2\n", 1)


def test_real_broker_redelivers_when_worker_dies_before_ack(
    pg_engine, pg_url, pg_schema, tmp_path, config, broker_url
):
    env = child_environment(pg_url, pg_schema, tmp_path)
    task_id = str(uuid4())
    marker = tmp_path / "before-ack"
    env |= {
        "CELERY_BROKER_URL": broker_url,
        "M3_TEST_ACK_TASK_ID": task_id,
        "M3_TEST_ACK_MARKER": str(marker),
    }
    producer = broker_producer(broker_url)
    redis = Redis.from_url(broker_url)
    first_log = tmp_path / "before-ack.log"
    log = tmp_path / "redelivery.log"
    with server(env, tmp_path / "api.log") as (_, client):
        job_id = csv_submission(client, config)["job_id"]
        with worker(env, first_log, module="backend.tests.m3_ack_worker") as first:
            producer.send_task(TASK, args=[job_id], task_id=task_id)
            wait_for(
                marker.is_file,
                first,
                "Worker did not reach late acknowledgement",
                first_log,
            )
            assert job_status(client, job_id)["status"] == "succeeded"
            kill_worker(first)
        before = job_status(client, job_id)
        event_url = f"/api/v1/collection-jobs/{job_id}/events"
        events = client.get(event_url).json()
        # Advance only the interrupted message past Kombu's visibility window.
        unacked = [
            key
            for key, value in redis.hgetall("unacked").items()
            if task_id.encode() in value
        ]
        assert len(unacked) == 1
        redis.zadd(
            "unacked_index", {unacked[0]: time() - VISIBILITY_TIMEOUT - 1}, xx=True
        )
        with producer.connection_for_read() as connection:
            connection.default_channel.qos.restore_visible(interval=1)
        with worker(env, log) as process:
            wait_for(
                lambda: "job_not_pending" in log.read_text(encoding="utf-8"),
                process,
                "The interrupted message was not redelivered",
                log,
            )
        assert job_status(client, job_id) == before
        assert client.get(event_url).json() == events
        assert_results(client, job_id, tmp_path, b"Name,Count\nAlpha,2\n", 1)


def test_second_worker_skips_duplicate_while_first_owns_claim(
    pg_engine, pg_url, pg_schema, tmp_path, config, broker_url, sessions
):
    env = child_environment(pg_url, pg_schema, tmp_path)
    env["CELERY_BROKER_URL"] = broker_url
    producer = broker_producer(broker_url)
    first_log, second_log = tmp_path / "first.log", tmp_path / "second.log"
    with (
        server(env, tmp_path / "api.log") as (_, client),
        worker(env, first_log) as first,
    ):
        job_id = csv_submission(client, config)["job_id"]
        with sessions.begin() as lock:
            lock.connection().exec_driver_sql(
                "LOCK TABLE sources IN ACCESS EXCLUSIVE MODE"
            )
            producer.send_task(TASK, args=[job_id])
            wait_for(
                lambda: job_status(client, job_id)["status"] == "running",
                first,
                "First worker did not claim the job",
                first_log,
            )
            with worker(env, second_log, name="m3-duplicate") as second:
                producer.send_task(TASK, args=[job_id])
                wait_for(
                    lambda: "job_not_pending" in second_log.read_text(encoding="utf-8"),
                    second,
                    "Second worker did not skip the active duplicate",
                    second_log,
                )
        wait_for(
            lambda: job_status(client, job_id)["status"] == "succeeded",
            first,
            "First worker did not finish",
            first_log,
        )
        assert job_status(client, job_id)["execution_attempt"] == 1
        assert_results(client, job_id, tmp_path, b"Name,Count\nAlpha,2\n", 1)


def test_worker_database_unavailable_before_claim_leaves_job_recoverable(
    pg_engine, pg_url, pg_schema, tmp_path, config, broker_url, sessions
):
    from sqlalchemy.engine import make_url

    env = child_environment(pg_url, pg_schema, tmp_path)
    env["CELERY_BROKER_URL"] = broker_url
    producer = broker_producer(broker_url)
    log = tmp_path / "worker.log"
    with server(env, tmp_path / "api.log") as (_, client), socket.socket() as reserved:
        reserved.bind(("127.0.0.1", 0))
        unreachable_url = make_url(env["DATABASE_URL"]).set(
            host="127.0.0.1", port=reserved.getsockname()[1]
        )
        failed_env = env | {
            "DATABASE_URL": unreachable_url.render_as_string(hide_password=False)
        }
        job_id = csv_submission(client, config)["job_id"]
        with worker(failed_env, log) as process:
            assert Dispatcher(
                sessions, lambda value: producer.send_task(TASK, args=[str(value)])
            ).dispatch_one()
            wait_for(
                lambda: (
                    "Collection job state could not be confirmed"
                    in log.read_text(encoding="utf-8")
                ),
                process,
                "Worker did not report PostgreSQL failure",
                log,
            )
        pending = job_status(client, job_id)
        assert pending["status"] == "pending"
        assert pending["execution_attempt"] == 0
        assert pending["dispatch_attempts"] == 1
        with sessions.begin() as session:
            session.execute(
                update(JobRow)
                .where(JobRow.id == UUID(job_id))
                .values(dispatch_due_at=func.now())
            )
        recovery_log = tmp_path / "worker-recovered.log"
        with (
            worker(env, recovery_log) as process,
            dispatcher(env, tmp_path / "dispatcher.log"),
        ):
            wait_for(
                lambda: job_status(client, job_id)["status"] == "succeeded",
                process,
                "Job did not finish after PostgreSQL became reachable",
                recovery_log,
            )
        final = job_status(client, job_id)
        assert final["execution_attempt"] == 1
        assert final["dispatch_attempts"] == 2
