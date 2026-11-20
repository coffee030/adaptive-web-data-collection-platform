"""Reconcile the M18B publication and fixture downloads with local REST records."""

import argparse
import csv
import hashlib
import json
from collections import Counter
from http.client import HTTPConnection
from pathlib import Path
from urllib.parse import urlencode
from uuid import UUID


def get_json(port: int, path: str):
    connection = HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        connection.request("GET", f"/api/v1{path}")
        response = connection.getresponse()
        if response.status != 200:
            raise RuntimeError(f"GET {path} returned HTTP {response.status}")
        return json.load(response)
    finally:
        connection.close()


def records_for_request(port: int, request_id: UUID):
    for offset in range(5_001):
        query = urlencode({"request_id": request_id, "limit": 1, "offset": offset})
        page = get_json(port, f"/records?{query}")
        if not page:
            return
        if len(page) != 1 or offset == 5_000:
            raise RuntimeError("Reference pagination exceeded the export contract")
        yield page[0]


def csv_value(cell, expected):
    if isinstance(expected, dict):
        try:
            return json.loads(cell)
        except (TypeError, ValueError):
            return cell
    return cell


def expected_csv(expected):
    if expected is None:
        return ""
    return expected if isinstance(expected, dict) else str(expected)


def compare(rows, expected, *, as_csv=False):
    ids = Counter(row["record_id"] for row in rows)
    reference_ids = Counter(row["record_id"] for row in expected)
    reference_by_id = {row["record_id"]: row for row in expected}
    field_differences = {}
    for row in rows:
        identity = row["record_id"]
        if identity not in reference_by_id:
            continue
        reference = reference_by_id[identity]
        differing = set(row) ^ set(reference)
        for name in set(row) & set(reference):
            value = reference[name]
            if as_csv:
                actual, target = csv_value(row[name], value), expected_csv(value)
            else:
                actual, target = row[name], value
            if actual != target:
                differing.add(name)
        if differing:
            field_differences[identity] = sorted(str(name) for name in differing)
    return {
        "rows": len(rows),
        "missing": dict(reference_ids - ids),
        "extra": dict(ids - reference_ids),
        "repeated": {identity: count for identity, count in ids.items() if count > 1},
        "field_differences": field_differences,
        "by_source": dict(Counter(row["source_id"] for row in rows)),
        "by_job": dict(Counter(row["job_id"] for row in rows)),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True, help="Local API port")
    parser.add_argument("request_id", type=UUID)
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("json_path", type=Path)
    args = parser.parse_args()
    request = get_json(args.port, f"/collection-requests/{args.request_id}")
    jobs = {child["job"]["job_id"]: child["job"] for child in request["jobs"]}
    if any(job["status"] not in {"succeeded", "partial", "failed"} for job in jobs.values()):
        raise RuntimeError("Wait for all Jobs to finish before comparison")
    expected = list(records_for_request(args.port, args.request_id))
    counts = Counter(row["job_id"] for row in expected)
    accepted = Counter({job_id: job["valid_count"] for job_id, job in jobs.items()})
    if counts != accepted:
        raise RuntimeError("REST Record counts differ from the Request's Job counts")
    for row in expected:
        job = jobs[row["job_id"]]
        if any(row[field] != job[field] for field in ("source_id", "profile_version_id")):
            raise RuntimeError("REST Record lineage does not match the Request's Jobs")
    with args.csv_path.open(encoding="utf-8", newline="") as stream:
        csv_rows = list(csv.DictReader(stream, strict=True))
    json_rows = json.loads(args.json_path.read_text(encoding="utf-8"))
    reports = {"csv": compare(csv_rows, expected, as_csv=True), "json": compare(json_rows, expected)}
    for name, path in (("csv", args.csv_path), ("json", args.json_path)):
        reports[name]["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    summary = {"request_id": str(args.request_id), "reference_rows": len(expected), **reports}
    print(json.dumps(summary, indent=2))
    differences = ("missing", "extra", "repeated", "field_differences")
    return int(any(report[key] for report in reports.values() for key in differences))


if __name__ == "__main__":
    raise SystemExit(main())
