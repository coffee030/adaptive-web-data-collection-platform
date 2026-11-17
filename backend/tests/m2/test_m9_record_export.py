"""Verify downloads against validated records published by the real importer."""

import csv
import io
import json
from uuid import UUID, uuid4

import pytest
from conftest import approve_job_profile
from fastapi.testclient import TestClient
from test_m8_collections import API
from test_vertical_slice import submit_job

from backend.api.app import create_app
from backend.application.execution import JobExecutor
from backend.application.record_export import MAX_EXPORT_ROWS, encode_records
from backend.application.results import Record
from backend.core.contracts import Contract
from backend.core.profiles import ProfileError


@pytest.fixture
def client(pg_engine, tmp_path):
    with TestClient(
        create_app(engine=pg_engine, evidence_root=tmp_path),
        base_url="http://127.0.0.1",
    ) as client:
        yield client


def publish_csv(client, sessions, job_setup, text):
    _, _, _, entry, evidence = job_setup
    approved = approve_job_profile(job_setup).model_dump(mode="json")
    created, _ = submit_job(
        client, approved, entry.model_dump(mode="json") | {"content": text}, uuid4()
    )
    job_id = UUID(created["job_id"])
    path = f"{API}/collection-jobs/{job_id}/records/export"
    pending = client.get(path, params={"format": "json"})
    assert pending.status_code == 409
    assert pending.json()["error"]["code"] == "record_export_pending"
    return JobExecutor(sessions, evidence).execute(job_id), path


def test_job_export_matches_validated_records_and_protects_csv(
    client, sessions, job_setup
):
    job, path = publish_csv(
        client,
        sessions,
        job_setup,
        'Name,Count\n"=1+1, ""茶""\nnext",2\n"=1+1, ""茶""\nnext",2\nInvalid,bad\nSafe,3\n',
    )
    assert (job.status, job.valid_count, job.invalid_count, job.duplicate_count) == (
        "partial",
        2,
        1,
        1,
    )
    expected = client.get(f"{API}/records", params={"job_id": str(job.job_id)}).json()
    assert len(expected) == 2
    detail_url = f"{API}/records/{expected[0]['record_id']}"
    assert client.get(detail_url).json() == expected[0]
    assert client.get(detail_url, params={"include_lineage": "true"}).json() == (
        expected[0] | {"request_id": None, "article_id": None}
    )
    for format in ("csv", "json"):
        reply = client.get(path, params={"format": format})
        assert reply.status_code == 200, reply.text
        assert reply.headers["content-disposition"] == (
            f'attachment; filename="job-{job.job_id}-records.{format}"'
        )
        assert reply.headers["cache-control"] == "no-store"
        assert reply.headers["x-content-type-options"] == "nosniff"
        if format == "json":
            assert reply.json() == expected
        else:
            assert reply.headers["content-type"] == "text/csv; charset=utf-8"
            reader = csv.DictReader(
                io.StringIO(reply.content.decode("utf-8"), newline="")
            )
            assert reader.fieldnames == list(Record.model_fields)
            actual = list(reader)
            assert [row["record_id"] for row in actual] == [
                row["record_id"] for row in expected
            ]
            assert [json.loads(row["payload"]) for row in actual] == [
                row["payload"] for row in expected
            ]
            formula = next(
                row for row in actual if row["source_record_key"].startswith("'=")
            )
            assert (
                "茶" in formula["source_record_key"]
                and "\nnext" in formula["source_record_key"]
            )


def test_export_empty_missing_invalid_and_row_limit(client, sessions, job_setup):
    failed, path = publish_csv(client, sessions, job_setup, "Name,Count\nInvalid,bad\n")
    assert failed.valid_count == 0
    assert client.get(path, params={"format": "json"}).json() == []
    empty_csv = client.get(path, params={"format": "csv"})
    assert empty_csv.text == ",".join(Record.model_fields) + "\r\n"
    assert client.get(path, params={"format": "xlsx"}).status_code == 422
    for scope in ("collection-jobs", "collection-requests"):
        missing = client.get(f"{API}/{scope}/{uuid4()}/records/export?format=json")
        assert missing.status_code == 404

    _, _, _, entry, evidence = job_setup
    # Reuse the approved pin from the empty export.
    created, _ = submit_job(
        client,
        {
            "source_id": str(failed.source_id),
            "profile_version_id": str(failed.profile_version_id),
        },
        entry.model_dump(mode="json")
        | {
            "content": "Name,Count\n"
            + "".join(f"Row {index},1\n" for index in range(MAX_EXPORT_ROWS + 1))
        },
        uuid4(),
    )
    job_id = UUID(created["job_id"])
    assert (
        JobExecutor(sessions, evidence).execute(job_id).valid_count
        == MAX_EXPORT_ROWS + 1
    )
    for format in ("csv", "json"):
        too_many = client.get(
            f"{API}/collection-jobs/{job_id}/records/export?format={format}"
        )
        assert too_many.status_code == 413
        assert too_many.json()["error"]["code"] == "record_export_limit"
        assert "content-disposition" not in too_many.headers


@pytest.mark.parametrize("format", ["csv", "json"])
def test_encoded_byte_limit_and_formula_prefixes(format):
    class Example(Contract):
        value: str

    if format == "csv":
        cells = [
            " =2+2",
            "\ttext",
            "\rnotes",
            "\nnext",
            "\ufeff@SUM(A1)",
            "＋1",
            "normal",
        ]
        encoded = encode_records(
            (Example(value=value) for value in cells), ("value",), format
        )
        assert list(csv.reader(io.StringIO(encoded.decode(), newline=""))) == [
            ["value"],
            *[["'" + value] for value in cells[:-1]],
            [cells[-1]],
        ]
    large = Example(value="茶" * 400_000)
    with pytest.raises(ProfileError, match="8 MiB"):
        encode_records((large for _ in range(8)), ("value",), format)
