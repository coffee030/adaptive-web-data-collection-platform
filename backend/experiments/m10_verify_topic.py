"""Check browser attachments, PostgreSQL lineage and stored Evidence in a fixture project."""

import argparse
import csv
import hashlib
import json
import re
import subprocess
from datetime import datetime
from pathlib import Path
from urllib.request import urlopen
from uuid import UUID

EXPORT = re.compile(r"(request|job)-([0-9a-f-]{36})-records\.(csv|json)")


def docker(*args):
    return subprocess.check_output(["docker", *args], timeout=30)


def service(project, service_name):
    ids = (
        docker(
            "ps",
            "-q",
            "--filter",
            f"label=com.docker.compose.project={project}",
            "--filter",
            f"label=com.docker.compose.service={service_name}",
        )
        .decode()
        .splitlines()
    )
    if len(ids) != 1:
        raise ValueError(f"Expected one active {service_name} in the selected project")
    return ids[0]


def sql(container, query):
    result = docker(
        "exec",
        container,
        "sh",
        "-c",
        'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"',
        "m10",
        query,
    ).decode()
    return [json.loads(row) for row in result.splitlines()]


def stored_records(container, where):
    return sql(
        container,
        f"""
        SELECT jsonb_build_object(
            'record_id', r.id, 'job_id', r.job_id, 'source_id', j.source_id,
            'profile_version_id', j.profile_version_id, 'record_type', r.record_type,
            'schema_version', r.schema_version, 'source_record_key', r.source_record_key,
            'deduplication_key', r.deduplication_key, 'payload', r.payload,
            'source_position', r.source_position, 'validation_status', r.validation_status,
            'evidence_reference', e.id, 'created_at', r.created_at,
            'provenance', jsonb_build_object(
                'source_id', replace(j.source_id::text, '-', ''),
                'run_id', replace(e.run_id::text, '-', ''),
                'profile_version_id', replace(j.profile_version_id::text, '-', ''),
                'config_hash', j.config_hash, 'validation_status', r.validation_status
            )
        )
        FROM generic_records r JOIN collection_jobs j ON j.id = r.job_id
        JOIN raw_evidence e ON e.job_id = r.job_id AND e.id = r.evidence_id
        JOIN collection_request_jobs q ON q.job_id = j.id
        WHERE {where} ORDER BY r.created_at, r.id
    """,
    )


def compare_rows(path, expected, format):
    if format == "json":
        rows = json.loads(path.read_bytes())
    else:
        with path.open(encoding="utf-8", newline="") as stream:
            rows = list(csv.DictReader(stream))
        for row in rows:
            for key in ("payload", "source_position", "provenance"):
                row[key] = json.loads(row[key])
            row["source_record_key"] = row["source_record_key"] or None
    assert rows, f"No browser rows in {path.name}"
    for row in [*rows, *expected]:
        row["created_at"] = datetime.fromisoformat(row["created_at"])
    assert rows == expected, path.name


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--downloads", required=True, type=Path)
    parser.add_argument("--refresh", required=True, type=UUID)
    args = parser.parse_args()
    if not re.fullmatch(
        r"(collection-m3-test-m10-[a-z0-9-]+|adaptive-web-core-local-[0-9a-f]{12})",
        args.project,
    ):
        parser.error(
            "Select a dedicated M10 fixture or isolated Windows Launcher project"
        )
    database = service(args.project, "postgres")
    api = service(args.project, "api")
    address = docker("port", api, "8000/tcp").decode().strip()
    assert re.fullmatch(r"127\.0\.0\.1:\d+", address), address
    request_ids = {args.refresh}
    exports = {}
    for path in sorted(args.downloads.rglob("*-records.*")):
        match = EXPORT.fullmatch(path.name)
        if not match:
            continue
        scope, value, format = match.groups()
        scope_id = UUID(value)
        if scope == "request":
            request_ids.add(scope_id)
        where = (
            f"q.request_id = '{scope_id}'"
            if scope == "request"
            else f"q.job_id = '{scope_id}'"
        )
        rows = stored_records(database, where)
        compare_rows(path, rows, format)
        route = "collection-requests" if scope == "request" else "collection-jobs"
        with urlopen(
            f"http://{address}/api/v1/{route}/{scope_id}/records/export?format={format}",
            timeout=5,
        ) as reply:
            contents = reply.read()
        assert contents == path.read_bytes(), path.name
        exports[path.name] = {
            "records": len(rows),
            "sha256": hashlib.sha256(contents).hexdigest(),
        }
    assert len(exports) == 6 and len(request_ids) == 3, (
        "Expected one complete Topic browser run"
    )

    id_list = ", ".join(f"'{item}'" for item in sorted(request_ids))
    jobs = sql(
        database,
        f"""
        SELECT to_jsonb(s) FROM (
            SELECT q.request_id, j.id AS job_id, j.status, j.profile_version_id, j.config_hash,
                j.valid_count, c.refresh_of, c.keyword
            FROM collection_jobs j
            JOIN collection_request_jobs q ON q.job_id = j.id
            JOIN collection_requests c ON c.id = q.request_id
            WHERE q.request_id IN ({id_list}) ORDER BY c.created_at, j.source_id
        ) s
    """,
    )
    assert len(jobs) == 6 and all(job["valid_count"] == 1 for job in jobs)
    assert [job["status"] for job in jobs] == ["succeeded"] * 4 + ["partial"] * 2
    assert [job["profile_version_id"] for job in jobs[:2]] == [
        job["profile_version_id"] for job in jobs[2:4]
    ]
    assert all(job["refresh_of"] == jobs[0]["request_id"] for job in jobs[2:4])
    history = sql(
        database,
        f"""
        SELECT to_jsonb(s) FROM (
            SELECT a.article_id, a.content_version_id, a.record_id, r.evidence_id,
                v.version, v.content_hash, t.identity_hash, q.request_id
            FROM article_observations a JOIN generic_records r ON r.id = a.record_id
            JOIN article_content_versions v ON v.id = a.content_version_id AND v.article_id = a.article_id
            JOIN articles t ON t.id = a.article_id AND t.source_id = (
                SELECT source_id FROM collection_jobs WHERE id = r.job_id
            )
            JOIN collection_request_jobs q ON q.job_id = r.job_id
            WHERE q.request_id IN ({id_list}) ORDER BY q.request_id, a.article_id
        ) s
    """,
    )
    assert len(history) == 6 and len({row["article_id"] for row in history}) == 2
    assert len({row["content_version_id"] for row in history}) == 2
    assert all(row["version"] == 1 for row in history)
    captures = sql(
        database,
        f"""
        SELECT to_jsonb(s) FROM (
            SELECT e.id, e.job_id, e.capture_kind, e.content_hash
            FROM raw_evidence e JOIN collection_request_jobs q ON q.job_id = e.job_id
            WHERE q.request_id IN ({id_list}) ORDER BY e.job_id, e.page_number
        ) s
    """,
    )
    assert len(captures) >= 12
    evidence_paths = [
        f"/data/evidence/{UUID(row['id']).hex}/input.bin" for row in captures
    ]
    hashes = docker("exec", api, "sha256sum", *evidence_paths).decode().splitlines()
    assert [line.split()[0] for line in hashes] == [
        row["content_hash"] for row in captures
    ]
    capture_kinds = {row["id"]: row["capture_kind"] for row in captures}
    assert all(capture_kinds[row["evidence_id"]] == "detail" for row in history)
    print(
        json.dumps(
            {
                "exports": exports,
                "jobs": jobs,
                "history": history,
                "captures": captures,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
