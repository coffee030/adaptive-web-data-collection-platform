"""Run the bounded M5 evaluation against the disposable Compose fixture stack."""

import argparse
import hashlib
import json
import os
import shlex
import statistics
import subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from time import perf_counter, sleep
from uuid import UUID, uuid4

import httpx2

from backend.core.contracts import CsvMappingConfiguration, ExtractionConfiguration
from backend.core.csv_adapter import csv_candidates
from backend.core.ingestion import ingest
from backend.core.inputs import CapturedInput
from backend.core.web_adapter import html_candidates

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "backend" / "tests" / "fixtures"
ORIGIN = "http://collection-fixture:8001"
HTML = (FIXTURES / "m0" / "table.html").read_bytes()
CSV = (FIXTURES / "m1" / "listings.csv").read_bytes()
HTML_CONFIG = ExtractionConfiguration(
    config_schema_version="1",
    record_schema={
        "record_type": "listing",
        "schema_version": "1",
        "identity_field": "key",
        "fields": [{"name": "key"}, {"name": "title"}],
    },
    selector_type="css",
    item_selector="#entries tr",
    fields=[
        {"name": "key", "selector": "a", "mode": "attribute", "attribute": "data-code"},
        {"name": "title", "selector": "a"},
    ],
)
CSV_CONFIG = CsvMappingConfiguration(
    config_schema_version="1",
    record_schema={
        "record_type": "listing",
        "schema_version": "1",
        "identity_field": "key",
        "fields": [
            {"name": "key"},
            {"name": "title"},
            {"name": "count", "value_type": "integer"},
            {"name": "active", "value_type": "boolean"},
            {"name": "note", "required": False},
        ],
    },
    columns=[
        {"name": name, "column": column}
        for name, column in (
            ("key", "Key"),
            ("title", "Name"),
            ("count", "Count"),
            ("active", "Active"),
            ("note", "Note"),
        )
    ],
)
HTML_RECORDS = {
    1: {"key": "c3", "title": "River Walk"},
    2: {"key": "d4", "title": "Lake View"},
}
CSV_RECORDS = {
    2: {"key": "a1", "title": "North Trail", "count": 7, "active": True, "note": None},
    3: {
        "key": "a2",
        "title": "River Walk",
        "count": 3,
        "active": False,
        "note": "Open",
    },
}
CSV_PROBLEMS = {
    5: ("required_field", "title"),
    6: ("wrong_type", "count"),
    7: ("invalid_row", None),
}
CSV_SAMPLE = "Key,Name,Count,Active,Note\nz1,Sample,1,true,\n"


def request(client, method, path, expected=200, **kwargs):
    started = perf_counter()
    res = client.request(method, path, **kwargs)
    elapsed_ms = (perf_counter() - started) * 1000
    if res.status_code != expected:
        raise RuntimeError(f"{method} {path}: wanted {expected}, got {res.status_code}")
    return res.json(), elapsed_ms


def stage(client, configuration, sample):
    adapter = configuration.adapter_type
    body = {
        "source_name": f"M5 evaluation {adapter} {uuid4().hex[:8]}",
        "adapter_type": adapter,
        "permission_reference": "M5 labelled synthetic fixture",
        "request_key": str(uuid4()),
    } | (
        {"allowed_origins": [ORIGIN]}
        if adapter == "web"
        else {"allowed_datasets": ["listings"]}
    )
    source, _ = request(client, "POST", "/sources", 201, json=body)
    assert source["approval_status"] == "pending"
    source_id = source["source_id"]
    request(
        client,
        "PATCH",
        f"/sources/{source_id}/authorization",
        json={"approval_status": "approved"},
    )
    versions = f"/sources/{source_id}/versions"
    version, _ = request(
        client,
        "POST",
        versions,
        201,
        json={"configuration": configuration.model_dump(mode="json")},
    )
    profile_id = version["profile_version_id"]
    path = f"{versions}/{profile_id}"
    candidates, _ = request(client, "POST", path + "/preview", json=sample)
    assert len(candidates) == (2 if adapter == "web" else 1)
    report, _ = request(client, "POST", path + "/validate", json=sample)
    assert report["passed"] is True
    approved, _ = request(
        client,
        "POST",
        path + "/approve",
        json={
            "report_id": report["report_id"],
            "config_hash": report["config_hash"],
            "approver": "M5 evaluation",
        },
    )
    assert approved["approval_status"] == "approved"
    return {"source_id": source_id, "profile_version_id": profile_id}, approved[
        "config_hash"
    ]


def difference_ms(later, earlier):
    return (
        datetime.fromisoformat(later) - datetime.fromisoformat(earlier)
    ).total_seconds() * 1000


def job(client, case):
    pin, config_hash, entry, raw, expected_records, problems = case
    is_web = entry["adapter_type"] == "web"
    body = pin | {"entry": entry, "request_key": str(uuid4())}
    started = perf_counter()
    created, submit_ms = request(client, "POST", "/collection-jobs", 201, json=body)
    job_id = created["job_id"]
    path = f"/collection-jobs/{job_id}"
    while True:
        current, detail_ms = request(client, "GET", path)
        if current["status"] in {"succeeded", "partial", "failed"}:
            finished = perf_counter()
            break
        if perf_counter() - started > 25:
            raise RuntimeError(f"Job {job_id} did not complete in 25 s")
        sleep(0.075)
    assert current["status"] == ("succeeded" if is_web else "partial")
    assert current["execution_attempt"] == 1
    assert current["dispatch_attempts"] == 1
    assert current["config_hash"] == config_hash
    assert (
        current["valid_count"],
        current["invalid_count"],
        current["duplicate_count"],
    ) == (
        2,
        len(problems),
        0 if is_web else 1,
    )
    replay, _ = request(client, "POST", "/collection-jobs", json=body)
    assert replay == current
    records, records_ms = request(client, "GET", "/records", params={"job_id": job_id})
    quarantine, _ = request(client, "GET", path + "/quarantine")
    evidence, _ = request(client, "GET", path + "/evidence")
    events, _ = request(client, "GET", path + "/events")
    assert [event["kind"] for event in events] == [
        "JOB_CREATED",
        "DISPATCHED",
        "CLAIMED",
        current["status"].upper(),
    ]
    assert evidence["content_hash"] == hashlib.sha256(raw).hexdigest()
    assert evidence["config_hash"] == config_hash
    assert evidence["job_id"] == job_id
    for key, value in pin.items():
        assert UUID(evidence[key]) == UUID(value)
    assert len(records) == len(expected_records)
    assert {
        record["source_position"]["index"]: record["payload"] for record in records
    } == expected_records
    assert len({record["deduplication_key"] for record in records}) == len(records)
    for record in records:
        assert record["source_position"]["kind"] == (
            "html_item" if is_web else "csv_row"
        )
        assert record["record_type"] == "listing" and record["schema_version"] == "1"
        assert record["provenance"]["config_hash"] == config_hash
        assert UUID(record["provenance"]["run_id"]) == UUID(evidence["run_id"])
        assert record["validation_status"] == "passed"
    assert len(quarantine) == len(problems)
    assert {
        row["source_position"]["index"]: (
            row["problems"][0]["code"],
            row["problems"][0]["field"],
        )
        for row in quarantine
        if len(row["problems"]) == 1
    } == problems
    for row in [*records, *quarantine]:
        assert (
            row["job_id"] == job_id
            and row["evidence_reference"] == evidence["evidence_id"]
        )
        for key, value in pin.items():
            assert UUID(row[key]) == UUID(value)
    return {
        "job_id": job_id,
        "evidence_id": evidence["evidence_id"],
        "sha256": evidence["content_hash"],
        "source_id": pin["source_id"],
        "profile_id": pin["profile_version_id"],
        "record_id": records[0]["record_id"],
        "accepted": len(records),
        "rejected": len(quarantine),
        "duplicates": current["duplicate_count"],
        "submit_ms": submit_ms,
        "detail_ms": detail_ms,
        "records_ms": records_ms,
        "dispatch_ms": difference_ms(
            current["last_dispatched_at"], current["created_at"]
        ),
        "execution_ms": difference_ms(current["finished_at"], current["started_at"]),
        "end_to_end_ms": (finished - started) * 1000,
    }


def compose_prefix(project):
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
    ]


def command(*args):
    return subprocess.check_output(args, cwd=ROOT, timeout=30)


def container_usage(prefix):
    ids = command(*prefix, "ps", "-q").decode().split()
    output = command(
        "docker", "stats", "--no-stream", "--format", "{{json .}}", *ids
    ).decode()
    return [
        {key: row[key] for key in ("Name", "CPUPerc", "MemUsage")}
        for row in map(json.loads, output.splitlines())
    ]


def summarize(samples):
    return {
        "n": len(samples),
        "min": min(samples),
        "median": statistics.median(samples),
        "max": max(samples),
    }


def processing():
    generated = "Key,Name,Count,Active,Note\n" + "".join(
        f"k{i},Item {i},{i},true,\n" for i in range(500)
    )
    metrics = {}
    for name, candidate_fn, config, document, counts in (
        (
            "html",
            html_candidates,
            HTML_CONFIG,
            CapturedInput(HTML, ORIGIN + "/table.html"),
            (2, 0, 0),
        ),
        ("csv", csv_candidates, CSV_CONFIG, CapturedInput(CSV, "listings"), (2, 3, 1)),
        (
            "csv500",
            csv_candidates,
            CSV_CONFIG,
            CapturedInput(generated.encode(), "listings"),
            (500, 0, 0),
        ),
    ):
        times = []
        for _ in range(11):
            started = perf_counter()
            candidates = candidate_fn(document, config)
            result = ingest(candidates, config.record_schema, "M5-evaluation")
            times.append((perf_counter() - started) * 1000)
            assert (
                len(result.valid),
                len(result.invalid),
                len(result.duplicates),
            ) == counts
        metrics[name] = {
            "bytes": len(document.body),
            "candidates": sum(counts),
            "milliseconds": summarize(times[1:]),
        }
    return metrics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, choices=(1, 2), required=True)
    args = parser.parse_args()
    project = os.environ.get("M3_TEST_COMPOSE_PROJECT", "")
    api = os.environ.get("M3_TEST_COMPOSE_API_URL", "").rstrip("/")
    if not project.startswith("collection-m3-test-") or not api.startswith(
        "http://127.0.0.1:"
    ):
        parser.error("Select the dedicated loopback Compose fixture project")
    prefix = compose_prefix(project)
    binding = command(*prefix, "port", "api", "8000").decode().strip()
    if api != f"http://{binding}":
        parser.error("API URL does not match the dedicated Compose service")
    workers = command(*prefix, "ps", "-q", "worker").decode().split()
    if len(workers) != args.workers:
        parser.error("Active Compose worker count differs from --workers")
    with httpx2.Client(base_url=api + "/api/v1", timeout=5, trust_env=False) as client:
        web = {"adapter_type": "web", "url": ORIGIN + "/table.html"}
        csv = {"adapter_type": "csv", "dataset_id": "listings", "content": CSV_SAMPLE}
        html_case = (*stage(client, HTML_CONFIG, web), web, HTML, HTML_RECORDS, {})
        csv_case = (
            *stage(client, CSV_CONFIG, csv),
            csv | {"content": CSV.decode()},
            CSV,
            CSV_RECORDS,
            CSV_PROBLEMS,
        )
        labelled = {"html": job(client, html_case), "csv": job(client, csv_case)}
        for name, data in labelled.items():
            evidence = UUID(data["evidence_id"])
            stored = command(
                *prefix,
                "exec",
                "-T",
                "api",
                "cat",
                f"/data/evidence/{evidence.hex}/input.bin",
            )
            assert stored == (HTML if name == "html" else CSV)
        idle = container_usage(prefix)
        started = perf_counter()
        with (
            ThreadPoolExecutor(max_workers=1) as monitor,
            ThreadPoolExecutor(max_workers=4) as pool,
        ):
            under_load = monitor.submit(container_usage, prefix)
            warm = []
            for _ in range(3):
                warm.extend(
                    pool.map(
                        lambda case: job(client, case),
                        (html_case, csv_case, html_case, csv_case),
                    )
                )
            seconds = perf_counter() - started
            usage = under_load.result()
        print(
            json.dumps(
                {
                    "workers": args.workers,
                    "labelled_first_jobs": labelled,
                    "warm_jobs": len(warm),
                    "warm_seconds": seconds,
                    "jobs_per_second": len(warm) / seconds,
                    "accepted_records_per_second": sum(
                        item["accepted"] for item in warm
                    )
                    / seconds,
                    "warm_metrics_ms": {
                        key: summarize([row[key] for row in warm])
                        for key in warm[0]
                        if key.endswith("_ms")
                    },
                    "warm_job_ids": [row["job_id"] for row in warm],
                    "idle_sample": idle,
                    "load_interval_sample": usage,
                    "processing_microbenchmark": processing(),
                },
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
