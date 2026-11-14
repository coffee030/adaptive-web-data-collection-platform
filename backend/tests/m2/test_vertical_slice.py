import hashlib
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.application.execution import JobExecutor
from backend.core.evidence import LocalEvidenceStore

FIXTURES = Path(__file__).parents[1] / "fixtures"


@pytest.fixture
def site():
    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

    handler = partial(Handler, directory=FIXTURES / "m0")
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        thread = Thread(
            target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True
        )
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}"
        finally:
            server.shutdown()
            thread.join()


def create_approved_source(client, policy, configuration, sample):
    source = client.post(
        "/api/v1/sources",
        json={
            "source_name": "Controlled fixture",
            "permission_reference": "Project fixture",
            "approval_status": "approved",
            **policy,
        },
    )
    assert source.status_code == 201, source.text
    source_id = source.json()["source_id"]
    created = client.post(
        f"/api/v1/sources/{source_id}/versions", json={"configuration": configuration}
    )
    assert created.status_code == 201, created.text
    draft = created.json()
    version_url = f"/api/v1/sources/{source_id}/versions/{draft['profile_version_id']}"
    preview = client.post(version_url + "/preview", json=sample)
    assert preview.status_code == 200 and preview.json(), preview.text
    validated = client.post(version_url + "/validate", json=sample)
    assert validated.status_code == 200 and validated.json()["passed"], validated.text
    approved = client.post(
        version_url + "/approve",
        json={
            "approver": "fixture operator",
            "report_id": validated.json()["report_id"],
            "config_hash": draft["config_hash"],
        },
    )
    assert (
        approved.status_code == 200 and approved.json()["approval_status"] == "approved"
    ), approved.text
    return approved.json()


def submit_job(client, approved, entry, request_key):
    body = {
        "source_id": approved["source_id"],
        "profile_version_id": approved["profile_version_id"],
        "entry": entry,
        "request_key": str(request_key),
    }
    created = client.post("/api/v1/collection-jobs", json=body)
    assert created.status_code == 201, created.text
    return created.json(), body


@pytest.mark.parametrize("adapter", ["web", "csv"])
def test_controlled_collection_vertical_slice(
    adapter, pg_engine, sessions, tmp_path, request
):
    record_schema = {
        "record_type": "listing",
        "schema_version": "1",
        "identity_field": "key",
        "fields": [{"name": "key"}, {"name": "title"}],
    }
    if adapter == "web":
        origin = request.getfixturevalue("site")
        policy = {"adapter_type": "web", "allowed_origins": [origin]}
        configuration = {
            "adapter_type": "web",
            "config_schema_version": "1",
            "record_schema": record_schema,
            "selector_type": "css",
            "item_selector": "#entries tr",
            "fields": [
                {
                    "name": "key",
                    "selector": "a",
                    "mode": "attribute",
                    "attribute": "data-code",
                },
                {"name": "title", "selector": "a"},
            ],
        }
        raw = (FIXTURES / "m0" / "table.html").read_bytes()
        entry = sample = {"adapter_type": "web", "url": origin + "/table.html"}
        expected = ("succeeded", 2, 0, 0)
    else:
        policy = {"adapter_type": "csv", "allowed_datasets": ["listings"]}
        record_schema["fields"].append({"name": "count", "value_type": "integer"})
        configuration = {
            "adapter_type": "csv",
            "config_schema_version": "1",
            "record_schema": record_schema,
            "columns": [
                {"name": "key", "column": "Key"},
                {"name": "title", "column": "Name"},
                {"name": "count", "column": "Count"},
            ],
        }
        raw = (FIXTURES / "m1" / "listings.csv").read_bytes()
        entry = {
            "adapter_type": "csv",
            "dataset_id": "listings",
            "content": raw.decode("utf-8"),
        }
        sample = entry | {"content": "Key,Name,Count\na0,Sample,1\n"}
        expected = ("partial", 2, 3, 1)

    evidence_store = LocalEvidenceStore(tmp_path)
    executor = JobExecutor(sessions, evidence_store)
    with TestClient(
        create_app(engine=pg_engine, evidence_root=tmp_path),
        base_url="http://127.0.0.1",
    ) as client:
        approved = create_approved_source(client, policy, configuration, sample)
        job, submission = submit_job(client, approved, entry, uuid4())
        job_id = UUID(job["job_id"])
        result = executor.execute(job_id)
        actual = (
            result.status,
            result.valid_count,
            result.invalid_count,
            result.duplicate_count,
        )
        assert actual == expected
        assert (
            client.post("/api/v1/collection-jobs", json=submission).status_code == 200
        )
        job_url = f"/api/v1/collection-jobs/{job_id}"
        assert client.get(job_url).json()["status"] == result.status
        assert [item["status"] for item in client.get(job_url + "/events").json()] == [
            "pending",
            "running",
            result.status,
        ]
        records = client.get("/api/v1/records", params={"job_id": str(job_id)}).json()
        assert len(records) == expected[1]
        assert (
            client.get(
                "/api/v1/records",
                params={"job_id": str(job_id), "limit": 1, "offset": 1},
            ).json()
            == records[1:]
        )
        first = records[0]
        assert first["provenance"]["config_hash"] == approved["config_hash"]
        evidence_id = first["evidence_reference"]
        evidence = client.get(f"/api/v1/evidence/{evidence_id}").json()
        assert evidence["job_id"] == str(job_id)
        assert evidence["profile_version_id"] == job["profile_version_id"]
        assert evidence["content_hash"] == hashlib.sha256(raw).hexdigest()
        assert evidence_store.resolve(UUID(evidence_id).hex)[1] == raw
        assert "storage_reference" not in evidence
        assert client.get(job_url + "/evidence").json() == evidence
        invalid = client.get(job_url + "/quarantine").json()
        assert len(invalid) == expected[2]
        assert all(
            item["evidence_reference"] == evidence_id and item["problems"]
            for item in invalid
        )

    pg_engine.dispose()
    with TestClient(
        create_app(engine=pg_engine, evidence_root=tmp_path),
        base_url="http://127.0.0.1",
    ) as restarted:
        assert restarted.get(f"/api/v1/records/{first['record_id']}").json() == first
        assert restarted.get(f"/api/v1/evidence/{evidence_id}").json() == evidence
        assert restarted.get(job_url).json()["valid_count"] == expected[1]
        assert restarted.get(job_url + "/quarantine").json() == invalid
