from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

from conftest import approve_job_profile
from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.application.execution import JobExecutor
from backend.application.inputs import CsvEntry
from backend.application.jobs import Jobs

SOURCES = "/api/v1/sources"


def local_client(engine, root):
    return TestClient(
        create_app(engine=engine, evidence_root=root),
        base_url="http://127.0.0.1",
    )


def registration():
    return {
        "source_name": "Closure CSV",
        "adapter_type": "csv",
        "permission_reference": "fixture consent",
        "allowed_datasets": ["listings"],
        "request_key": str(uuid4()),
    }


def test_concurrent_source_intent_and_authorization_replay(pg_engine, tmp_path):
    body = registration()
    barrier = Barrier(2)

    def create(_):
        with local_client(pg_engine, tmp_path) as client:
            barrier.wait(10)
            return client.post(SOURCES, json=body)

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(create, range(2)))
    assert sorted(response.status_code for response in responses) == [200, 201]
    assert responses[0].json() == responses[1].json()
    source = responses[0].json()
    assert source["approval_status"] == "pending"
    path = f"{SOURCES}/{source['source_id']}"
    with local_client(pg_engine, tmp_path) as client:
        assert client.get(SOURCES).json() == [source]
        assert (
            client.patch(
                path + "/authorization", json={"approval_status": "approved"}
            ).status_code
            == 200
        )
        replay = client.post(SOURCES, json=body)
        assert replay.status_code == 200
        assert replay.json()["source_id"] == source["source_id"]
        assert replay.json()["approval_status"] == "approved"
        conflict = client.post(SOURCES, json=body | {"source_name": "Different"})
        assert conflict.status_code == 409
        assert conflict.json()["error"]["code"] == "source_request_conflict"
        separate = client.post(SOURCES, json=body | {"request_key": str(uuid4())})
        assert separate.status_code == 201
        assert separate.json()["source_id"] != source["source_id"]


def test_concurrent_http_draft_put_rejects_stale_revision(pg_engine, job_setup):
    _, source, version, _, store = job_setup
    path = f"{SOURCES}/{source}/versions/{version}"
    with local_client(pg_engine, store.root) as client:
        original = client.get(path).json()
        missing = client.put(path, json={"configuration": original["configuration"]})
        assert missing.status_code == 428
        assert missing.json()["error"]["code"] == "draft_revision_required"

    barrier = Barrier(2)

    def edit(index):
        with local_client(pg_engine, store.root) as client:
            current = client.get(path).json()
            config = current["configuration"]
            config["record_schema"]["record_type"] = f"edit_{index}"
            barrier.wait(10)
            return client.put(
                path,
                json={
                    "configuration": config,
                    "expected_revision": current["revision"],
                },
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(edit, range(2)))
    accepted = next(response for response in responses if response.status_code == 200)
    refused = next(response for response in responses if response.status_code == 409)
    assert refused.json()["error"]["code"] == "draft_revision_conflict"
    assert accepted.json()["revision"] == original["revision"] + 1
    with local_client(pg_engine, store.root) as client:
        assert client.get(path).json() == accepted.json()


def test_capture_metadata_without_results_and_without_capture(
    pg_engine, sessions, job_setup
):
    approve_job_profile(job_setup)
    profiles, source, version, _, store = job_setup
    jobs = Jobs(sessions)
    bad_csv = CsvEntry(
        adapter_type="csv", dataset_id="listings", content="Unexpected\nAlpha\n"
    )
    captured, _ = jobs.create(source, version, bad_csv)
    denied, _ = jobs.create(source, version, bad_csv)
    executor = JobExecutor(sessions, store)

    with local_client(pg_engine, store.root) as client:
        path = f"/api/v1/collection-jobs/{captured.job_id}"
        assert client.get(path + "/evidence").json() is None
        assert executor.execute(captured.job_id).status == "failed"
        assert client.get(path + "/quarantine").json() == []
        assert (
            client.get(
                "/api/v1/records", params={"job_id": str(captured.job_id)}
            ).json()
            == []
        )
        metadata = client.get(path + "/evidence").json()
        assert metadata["job_id"] == str(captured.job_id)
        assert metadata["source_id"] == str(source)
        assert metadata["profile_version_id"] == str(version)
        assert "storage_reference" not in metadata
        assert (
            client.get(f"/api/v1/evidence/{metadata['evidence_id']}").json() == metadata
        )
        profiles.set_authorization(source, "revoked")
        assert executor.execute(denied.job_id).status == "failed"
        assert (
            client.get(f"/api/v1/collection-jobs/{denied.job_id}/evidence").json()
            is None
        )
        assert (
            client.get(f"/api/v1/collection-jobs/{uuid4()}/evidence").status_code == 404
        )


def test_loopback_http_boundary(pg_engine, tmp_path):
    with local_client(pg_engine, tmp_path) as client:
        body = registration() | {"approval_status": "approved"}
        for headers in (
            {"Host": "external.invalid", "Origin": "http://external.invalid"},
            {"Origin": "https://external.invalid"},
            {"Origin": "null"},
            {"Origin": "http://127.0.0.1:4999"},
        ):
            refused = client.post(SOURCES, json=body, headers=headers)
            assert refused.status_code == 403
            assert "access-control-allow-origin" not in refused.headers
        assert client.get(SOURCES).json() == []
        assert (
            client.post(
                SOURCES, json=body, headers={"Origin": "http://127.0.0.1"}
            ).status_code
            == 201
        )
        assert client.post(SOURCES, json=registration()).status_code == 201
