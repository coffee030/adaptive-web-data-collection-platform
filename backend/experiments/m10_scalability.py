"""Measure the real M10 Compose stack using bounded, synthetic collection Jobs."""

import argparse
import json
import os
import statistics
import subprocess
from contextlib import contextmanager
from pathlib import Path
from threading import Thread
from time import perf_counter, sleep
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx2
import psycopg
from psycopg.rows import dict_row

from backend.experiments.m5_evaluation import (
    CSV,
    CSV_CONFIG,
    CSV_SAMPLE,
    HTML_CONFIG,
    ORIGIN,
    command,
    compose_prefix,
    request,
)
from backend.tests.m7_fixture import search_config

TRIAL_ORDER = (1, 2, 4, 4, 1, 2, 2, 4, 1)
TERMINAL = {"succeeded", "partial", "failed"}
JOBS = """
SELECT id, status, created_at, last_dispatched_at, started_at, finished_at,
       execution_attempt, dispatch_attempts, valid_count, invalid_count,
       duplicate_count, error
FROM collection_jobs WHERE id = ANY(%s)
"""
COUNTS = """
SELECT job_id, 'captures' AS kind, count(*) AS count
FROM raw_evidence WHERE job_id = ANY(%s) GROUP BY job_id
UNION ALL
SELECT job_id, 'records', count(*) FROM generic_records
WHERE job_id = ANY(%s) GROUP BY job_id
"""
DB_STATS = """
SELECT xact_commit, xact_rollback, blks_read, blks_hit, deadlocks, temp_bytes
FROM pg_stat_database WHERE datname = current_database()
"""


def compose_text(prefix, *args):
    return command(*prefix, *args).decode().strip()


def select_environment():
    project = os.environ["M3_TEST_COMPOSE_PROJECT"]
    api = os.environ["M3_TEST_COMPOSE_API_URL"].rstrip("/")
    db = os.environ["M2_TEST_DATABASE_URL"].replace(
        "postgresql+psycopg:", "postgresql:"
    )
    if not project.startswith("collection-m3-test-m10-"):
        raise ValueError("Select a dedicated collection-m3-test-m10-* project")
    prefix = compose_prefix(project)
    if not api.startswith("http://127.0.0.1:") or api != "http://" + compose_text(
        prefix, "port", "api", "8000"
    ):
        raise ValueError("The loopback API must match the selected Compose project")
    endpoint = urlsplit(db)
    if endpoint.hostname != "127.0.0.1" or (
        f"{endpoint.hostname}:{endpoint.port}"
        != compose_text(prefix, "port", "postgres", "5432")
    ):
        raise ValueError(
            "The loopback database must match the selected Compose project"
        )
    return prefix, api, db


def scale(prefix, workers):
    compose_text(
        prefix,
        "up",
        "-d",
        "--no-deps",
        "--no-build",
        "--scale",
        f"worker={workers}",
        "worker",
    )
    code = (
        "import json; from backend.queue.celery_app import app; "
        "print(json.dumps(app.control.inspect(timeout=2).stats() or {}))"
    )
    for _ in range(5):
        active = json.loads(
            compose_text(prefix, "exec", "-T", "worker", "python", "-c", code)
        )
        if len(active) == workers:
            slots = {
                name: item["pool"]["max-concurrency"] for name, item in active.items()
            }
            assert all(value == 1 for value in slots.values()), slots
            return slots
    raise RuntimeError(
        f"Expected {workers} responding Celery workers, saw {list(active)}"
    )


@contextmanager
def resource_samples(prefix):
    ids = compose_text(prefix, "ps", "--status", "running", "-q").splitlines()
    samples = []
    with subprocess.Popen(
        ["docker", "stats", "--format", "{{json .}}", *ids],
        stdout=subprocess.PIPE,
        text=True,
    ) as process:

        def collect():
            decoder = json.JSONDecoder()
            for line in process.stdout:
                offset = line.find("{")
                while offset >= 0:
                    sample, end = decoder.raw_decode(line, offset)
                    samples.append((perf_counter(), sample))
                    offset = line.find("{", end)

        thread = Thread(target=collect, daemon=True)
        thread.start()
        try:
            deadline = perf_counter() + 10
            while len({sample["Name"] for _, sample in samples}) < len(ids):
                if not thread.is_alive() or perf_counter() >= deadline:
                    raise RuntimeError(
                        "Docker stats did not report all project containers"
                    )
                sleep(0.1)
            yield samples
        finally:
            process.terminate()
            thread.join(timeout=5)


def approve(client, label, configuration, sample, **allowed):
    source, _ = request(
        client,
        "POST",
        "/sources",
        201,
        json={
            "source_name": f"M10 {label} {uuid4().hex[:8]}",
            "adapter_type": sample["adapter_type"],
            "permission_reference": "M10 isolated synthetic fixture",
            "request_key": str(uuid4()),
            **allowed,
        },
    )
    source_id = source["source_id"]
    path = f"/sources/{source_id}"
    request(
        client, "PATCH", path + "/authorization", json={"approval_status": "approved"}
    )
    version, _ = request(
        client, "POST", path + "/versions", 201, json={"configuration": configuration}
    )
    version_id = version["profile_version_id"]
    path += f"/versions/{version_id}"
    preview, _ = request(client, "POST", path + "/preview", json=sample)
    assert preview
    report, _ = request(client, "POST", path + "/validate", json=sample)
    assert report["passed"]
    approved, _ = request(
        client,
        "POST",
        path + "/approve",
        json={
            "report_id": report["report_id"],
            "config_hash": report["config_hash"],
            "approver": "M10 evaluation",
        },
    )
    assert approved["approval_status"] == "approved"
    return {"source_id": source_id, "profile_version_id": version_id}


def fixtures(client):
    html = {"adapter_type": "web", "url": ORIGIN + "/table.html"}
    csv = {"adapter_type": "csv", "dataset_id": "listings", "content": CSV_SAMPLE}
    search = {"adapter_type": "web", "keyword": "quick"}
    html_pin = approve(
        client,
        "HTML",
        HTML_CONFIG.model_dump(mode="json"),
        html,
        allowed_origins=[ORIGIN],
    )
    csv_pin = approve(
        client,
        "CSV",
        CSV_CONFIG.model_dump(mode="json"),
        csv,
        allowed_datasets=["listings"],
    )
    search_pin = approve(
        client,
        "search",
        search_config(ORIGIN, "cards"),
        search,
        allowed_origins=[ORIGIN],
        allowed_paths={ORIGIN: ["/m7/cards"]},
    )
    substantial = "Key,Name,Count,Active,Note\n" + "".join(
        f"item-{index:04d},Fixture item {index:04d},{index},true,Synthetic\n"
        for index in range(1200)
    )
    return {
        # Expected terminal status, valid, invalid, duplicate and captured inputs.
        "short": [
            (html_pin, html, ("succeeded", 2, 0, 0, 1)),
            (csv_pin, csv | {"content": CSV.decode()}, ("partial", 2, 3, 1, 1)),
        ]
        * 24,
        "csv": [(csv_pin, csv | {"content": substantial}, ("succeeded", 1200, 0, 0, 1))]
        * 36,
        "shared_origin": [(search_pin, search, ("succeeded", 1, 0, 0, 2))] * 4,
    }


def seconds(later, earlier):
    return (later - earlier).total_seconds()


def batch(client, connection, entries, samples=None):
    expected = {}
    before = connection.execute(DB_STATS).fetchone()
    start = perf_counter()
    for pin, entry, expectation in entries:
        job, _ = request(
            client,
            "POST",
            "/collection-jobs",
            201,
            json=pin | {"entry": entry, "request_key": str(uuid4())},
        )
        expected[job["job_id"]] = expectation
    submitted = perf_counter()
    ids = [UUID(job_id) for job_id in expected]
    while True:
        rows = connection.execute(JOBS, (ids,), prepare=False).fetchall()
        end = perf_counter()
        if len(rows) == len(ids) and all(row["status"] in TERMINAL for row in rows):
            break
        if end - start > 120:
            raise RuntimeError(f"Timed out waiting for Jobs {ids}")
        sleep(0.1)
    after = connection.execute(DB_STATS).fetchone()
    within_batch = []
    if samples is not None:
        within_batch = [
            sample | {"offset_s": ts - start}
            for ts, sample in samples
            if start <= ts <= end
        ]
        expected_containers = {sample["Name"] for _, sample in samples}
        if {sample["Name"] for sample in within_batch} != expected_containers:
            raise RuntimeError("Missing Docker resource samples during the batch")
    counts = {
        (str(row["job_id"]), row["kind"]): row["count"]
        for row in connection.execute(COUNTS, (ids, ids), prepare=False)
    }
    for row in rows:
        job_id = str(row["id"])
        observed = tuple(
            row[key]
            for key in ("status", "valid_count", "invalid_count", "duplicate_count")
        )
        assert observed + (counts.get((job_id, "captures"), 0),) == expected[job_id], (
            row
        )
        assert counts.get((job_id, "records"), 0) == row["valid_count"], row
    duration = end - start
    execution_span = seconds(
        max(row["finished_at"] for row in rows), min(row["started_at"] for row in rows)
    )
    events = sorted(
        (row[key], delta)
        for row in rows
        for key, delta in (("started_at", 1), ("finished_at", -1))
    )
    in_flight = 0
    peak = 0
    for _, delta in events:
        in_flight += delta
        peak = max(peak, in_flight)
    jobs = [
        {
            "id": str(row["id"]),
            "status": row["status"],
            "error": row["error"],
            "execution_attempt": row["execution_attempt"],
            "dispatch_attempts": row["dispatch_attempts"],
            "records": row["valid_count"],
            "invalid": row["invalid_count"],
            "duplicates": row["duplicate_count"],
            "captures": counts[(str(row["id"]), "captures")],
            "dispatch_s": seconds(row["last_dispatched_at"], row["created_at"]),
            "claim_s": seconds(row["started_at"], row["last_dispatched_at"]),
            "execution_s": seconds(row["finished_at"], row["started_at"]),
            "latency_s": seconds(row["finished_at"], row["created_at"]),
        }
        for row in rows
    ]
    latencies = sorted(job["latency_s"] for job in jobs)
    records = sum(job["records"] for job in jobs)
    captures = sum(job["captures"] for job in jobs)
    http_pages = sum(
        count[4] for _, entry, count in entries if entry["adapter_type"] == "web"
    )
    return {
        "seconds": duration,
        "submit_seconds": submitted - start,
        "jobs": len(jobs),
        "captures": captures,
        "http_pages": http_pages,
        "http_pages_per_s": http_pages / duration,
        "records": records,
        "jobs_per_s": len(jobs) / duration,
        "captures_per_s": captures / duration,
        "records_per_s": records / duration,
        "execution_span_seconds": execution_span,
        "execution_span_jobs_per_s": len(jobs) / execution_span,
        "median_latency_s": statistics.median(latencies),
        "p95_latency_s": latencies[(95 * len(jobs) + 99) // 100 - 1],
        "peak_concurrent_claims": peak,
        "job_retries": sum(job["execution_attempt"] - 1 for job in jobs),
        "dispatch_retries": sum(job["dispatch_attempts"] - 1 for job in jobs),
        "jobs_with_errors": sum(job["error"] is not None for job in jobs),
        "duplicates": sum(job["duplicates"] for job in jobs),
        "db_stat_deltas": {key: after[key] - before[key] for key in before},
        "docker_stats": within_batch,
        "job_details": jobs,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, required=True, help="New .local/*.jsonl file"
    )
    args = parser.parse_args()
    if not args.output.resolve().is_relative_to(Path(".local").resolve()):
        parser.error("Put raw results under the ignored .local directory")
    prefix, api, db = select_environment()
    with (
        args.output.open("x", encoding="utf-8") as output,
        httpx2.Client(base_url=api + "/api/v1", timeout=30, trust_env=False) as client,
        psycopg.connect(db, autocommit=True, row_factory=dict_row) as connection,
    ):
        for repetition, workers in enumerate(TRIAL_ORDER, 1):
            slots = scale(prefix, workers)
            cases = fixtures(client)
            with resource_samples(prefix) as samples:
                batch(client, connection, cases["csv"][:workers])
                for label, entries in cases.items():
                    result = batch(client, connection, entries, samples)
                    trial = {
                        "trial": repetition,
                        "workers": workers,
                        "workload": label,
                        "slots": slots,
                        **result,
                    }
                    output.write(json.dumps(trial) + "\n")
                    output.flush()
                    print(
                        f"Trial {repetition}: {workers} workers, {label}, "
                        f"{result['jobs_per_s']:.2f} Jobs/s, active {result['peak_concurrent_claims']}",
                        flush=True,
                    )


if __name__ == "__main__":
    main()
