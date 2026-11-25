import socket
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.persistence.database import make_engine
from backend.tests.m7_fixture import search_config


def test_profile_http_lifecycle(pg_engine, tmp_path, config):
    with TestClient(
        create_app(engine=pg_engine, evidence_root=tmp_path),
        base_url="http://127.0.0.1",
    ) as client:
        assert client.get("/api/v1/health").json() == {"status": "ok"}
        reply = client.post(
            "/api/v1/sources",
            json={
                "source_name": "CSV",
                "adapter_type": "csv",
                "allowed_datasets": ["listings"],
                "permission_reference": "fixture consent",
                "approval_status": "approved",
            },
        )
        assert reply.status_code == 201, reply.text
        source = reply.json()
        source_url = f"/api/v1/sources/{source['source_id']}"
        assert client.get(source_url).json() == source
        assert client.get("/api/v1/sources").json() == [source]
        created = client.post(
            source_url + "/versions",
            json={"configuration": config.model_dump(mode="json")},
        )
        assert created.status_code == 201, created.text
        draft = created.json()
        version = source_url + f"/versions/{draft['profile_version_id']}"
        entry = {
            "adapter_type": "csv",
            "dataset_id": "listings",
            "content": "Name,Count\nAlpha,2\n",
        }
        preview = client.post(version + "/preview", json=entry)
        assert preview.status_code == 200, preview.text
        assert preview.json()[0]["payload"]["name"] == "Alpha"
        validated = client.post(version + "/validate", json=entry)
        assert validated.status_code == 200, validated.text
        assert validated.json()["passed"]
        approval = {
            "approver": "local operator",
            "report_id": validated.json()["report_id"],
            "config_hash": draft["config_hash"],
        }
        result = client.post(version + "/approve", json=approval)
        assert result.status_code == 200, result.text
        assert result.json()["approved_by"] == "local operator"
        assert client.post(version + "/approve", json=approval).status_code == 409
        assert client.get(source_url + "/versions").json() == [result.json()]
        openapi = client.get("/openapi.json").json()
        schema = openapi["components"]["schemas"]["ProfileSnapshot"]
        assert "revision" in schema["required"]
        assert "configuration" in schema["required"]
        assert (
            "/api/v1/sources/{source_id}/versions/{version_id}/approve"
            in openapi["paths"]
        )

    with TestClient(
        create_app(engine=pg_engine, evidence_root=tmp_path),
        base_url="http://127.0.0.1",
    ) as restarted:
        assert restarted.get(version).json() == result.json()


def test_http_error_envelope_and_input_limit(pg_engine, tmp_path):
    with TestClient(
        create_app(engine=pg_engine, evidence_root=tmp_path),
        base_url="http://127.0.0.1",
    ) as client:
        missing = client.get(f"/api/v1/sources/{uuid4()}")
        assert missing.status_code == 404
        assert missing.json()["error"]["code"] == "source_not_found"
        invalid = client.post("/api/v1/sources", json={"password": "private"})
        assert invalid.status_code == 422
        assert "private" not in invalid.text
        denied = client.post(
            "/api/v1/sources",
            json={
                "source_name": "Web",
                "adapter_type": "web",
                "permission_reference": "fixture",
                "allowed_origins": ["https://127.0.0.1"],
            },
        )
        assert denied.status_code == 400
        assert denied.json()["error"]["code"] == "invalid_source_policy"
        large = client.post("/api/v1/sources", content=b"x" * (7 * 1024 * 1024))
        assert large.status_code == 413
        assert large.json()["error"]["code"] == "request_too_large"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("source_name", "Invalid\x00name"),
        ("permission_reference", "Invalid\x00reference"),
        ("allowed_datasets", ["Invalid\x00dataset"]),
    ],
)
def test_source_rejects_nul_before_persistence(pg_engine, tmp_path, field, value):
    with TestClient(
        create_app(engine=pg_engine, evidence_root=tmp_path),
        base_url="http://127.0.0.1",
    ) as client:
        source = {
            "source_name": "CSV",
            "adapter_type": "csv",
            "allowed_datasets": ["listings"],
            "permission_reference": "fixture consent",
            field: value,
        }
        reply = client.post("/api/v1/sources", json=source)
        assert reply.status_code == 422, reply.text
        assert reply.json()["error"]["fields"][0]["location"][:2] == ["body", field]
        assert client.get("/api/v1/sources").json() == []


def test_profile_rejects_nul_selector_before_persistence(pg_engine, tmp_path):
    with TestClient(
        create_app(engine=pg_engine, evidence_root=tmp_path),
        base_url="http://127.0.0.1",
    ) as client:
        origin = "http://127.0.0.1:5217"
        source = client.post(
            "/api/v1/sources",
            json={
                "source_name": "Controlled search",
                "adapter_type": "web",
                "allowed_origins": [origin],
                "permission_reference": "fixture consent",
            },
        )
        assert source.status_code == 201, source.text
        versions = f"/api/v1/sources/{source.json()['source_id']}/versions"
        config = search_config(origin, "cards")
        config["item_selector"] = "article\x00"
        reply = client.post(versions, json={"configuration": config})
        assert reply.status_code == 422, reply.text
        assert reply.json()["error"]["fields"][0]["location"][-1] == "item_selector"
        assert client.get(versions).json() == []


def test_database_unavailable_response_does_not_expose_connection_details(tmp_path):
    with socket.socket() as port:
        port.bind(("127.0.0.1", 0))
        url = f"postgresql+psycopg://operator:fake-secret@127.0.0.1:{port.getsockname()[1]}/test"
        engine = make_engine(url)
        try:
            with TestClient(
                create_app(engine=engine, evidence_root=tmp_path),
                base_url="http://127.0.0.1",
            ) as client:
                response = client.get("/api/v1/health")
        finally:
            engine.dispose()
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "database_unavailable"
    assert "fake-secret" not in response.text
