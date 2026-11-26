from http.server import ThreadingHTTPServer
from threading import Thread
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from test_vertical_slice import create_approved_source, submit_job

from backend.api.app import create_app
from backend.application.execution import JobExecutor
from backend.core.evidence import LocalEvidenceStore
from backend.tests.rendered_fixture import DIGEST, Fixture


@pytest.mark.parametrize("withdraw", ["source", "profile", None])
def test_rendered_publication_rechecks_permission(
    pg_engine, sessions, monkeypatch, tmp_path, withdraw
):
    with ThreadingHTTPServer(("127.0.0.1", 0), Fixture) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            origin = f"http://127.0.0.1:{server.server_port}"
            monkeypatch.setenv("CORE_RENDER_FIXTURE_ORIGIN", origin)
            with TestClient(
                create_app(engine=pg_engine, evidence_root=tmp_path),
                base_url="http://127.0.0.1",
            ) as client:
                entry = {"adapter_type": "web", "url": origin + "/catalog/products"}
                configuration = {
                    "adapter_type": "web",
                    "config_schema_version": "1",
                    "selector_type": "css",
                    "item_selector": "article",
                    "fields": [{"name": "sku", "selector": ".sku"}],
                    "record_schema": {
                        "record_type": "product",
                        "schema_version": "1",
                        "identity_field": "sku",
                        "fields": [{"name": "sku"}],
                    },
                    "rendering": {
                        "ready_selector": "#catalog-ready",
                        "script_sha256": [DIGEST],
                    },
                }
                profile = create_approved_source(
                    client,
                    {"adapter_type": "web", "allowed_origins": [origin]},
                    configuration,
                    entry,
                )
                job, _ = submit_job(client, profile, entry, uuid4())
                executor = JobExecutor(sessions, LocalEvidenceStore(tmp_path))
                claim, payload = executor.jobs.claim(UUID(job["job_id"]))
                result = executor._run(claim, payload)
                assert len(result.records) == 10 and result.evidence.rendered_dom
                if withdraw == "source":
                    executor.profiles.set_authorization(claim.source_id, "revoked")
                elif withdraw == "profile":
                    executor.profiles.retire(claim.source_id, claim.profile_version_id)
                final = executor._publish(claim, result)
                route = "/api/v1/collection-jobs/" + job["job_id"]
                pages = client.get(route + "/evidence-pages").json()
                records = client.get("/api/v1/records?job_id=" + job["job_id"]).json()
                if withdraw:
                    assert final.status == "failed"
                    assert final.error.code == "render_authorization_changed"
                    assert pages == [] and records == []
                else:
                    assert final.status == "succeeded"
                    assert len(records) == 10
                    [page] = pages
                    assert page[
                        "rendered_dom"
                    ] == result.evidence.rendered_dom.model_dump(mode="json")
                    assert page["content_hash"] == result.evidence.content_hash
                    assert (
                        client.get("/api/v1/evidence/" + page["evidence_id"]).json()
                        == page
                    )
        finally:
            server.shutdown()
            thread.join()
