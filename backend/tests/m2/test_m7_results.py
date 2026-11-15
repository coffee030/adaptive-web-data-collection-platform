import os
import socket
from http.server import ThreadingHTTPServer
from threading import Thread
from time import monotonic
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from test_m3_reliability import make_retry_due
from test_vertical_slice import create_approved_source, submit_job

from backend.api.app import create_app
from backend.application.execution import JobExecutor
from backend.core.evidence import LocalEvidenceStore
from backend.core.inputs import InputError
from backend.core.origin_rate import OriginRate
from backend.tests.m3_fixture_site import FixtureHandler
from backend.tests.m7_fixture import KEYWORD, search_config


@pytest.fixture
def rate_url(monkeypatch):
    url = os.environ.get("M3_TEST_BROKER_URL")
    if not url:
        pytest.skip("Set M3_TEST_BROKER_URL to an isolated Redis test broker")
    monkeypatch.setenv("CELERY_BROKER_URL", url)
    return url


def test_redis_retry_after_shared_and_unavailable_is_fail_closed(rate_url):
    origin = f"https://{uuid4().hex}.example"
    first, second = OriginRate(rate_url), OriginRate(rate_url)
    with first.request(origin, 1000, monotonic() + 2) as response:
        response.retry_after_ms = 12_000
    with (
        pytest.raises(InputError) as blocked,
        second.request(origin, 1000, monotonic() + 2),
    ):
        pytest.fail("A separate client ignored Retry-After")
    assert blocked.value.error.code == "origin_rate_busy"
    assert blocked.value.error.retry_after_seconds in (11, 12)

    with socket.socket() as port:
        port.bind(("127.0.0.1", 0))
        failed = OriginRate(f"redis://127.0.0.1:{port.getsockname()[1]}/0")
        with (
            pytest.raises(InputError) as unavailable,
            failed.request(origin, 1000, monotonic() + 2),
        ):
            pytest.fail("A rate failure must prevent the request")
    assert unavailable.value.error.code == "origin_rate_unavailable"


@pytest.mark.parametrize("attempt_limit", [1, 2])
def test_search_retry_publishes_only_terminal_evidence(
    pg_engine, sessions, tmp_path, rate_url, attempt_limit
):
    failing = True

    class Handler(FixtureHandler):
        def do_GET(self):
            if failing and self.path == "/m7/cards/detail/beta":
                self.send_error(503)
                return
            super().do_GET()

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            origin = f"http://127.0.0.1:{server.server_port}"
            config = search_config(origin, "cards")
            config["search"]["max_attempts"] = attempt_limit
            with TestClient(
                create_app(engine=pg_engine, evidence_root=tmp_path),
                base_url="http://127.0.0.1",
            ) as client:
                approved = create_approved_source(
                    client,
                    {"adapter_type": "web", "allowed_origins": [origin]},
                    config,
                    {"adapter_type": "web", "keyword": "quick"},
                )
                entry = {"adapter_type": "web", "keyword": KEYWORD}
                job, body = submit_job(client, approved, entry, uuid4())
                path = f"/api/v1/collection-jobs/{job['job_id']}"
                replay = client.post("/api/v1/collection-jobs", json=body)
                assert (
                    replay.status_code == 200
                    and replay.json()["job_id"] == job["job_id"]
                )
                rejected = client.post(
                    "/api/v1/collection-jobs",
                    json={
                        **body,
                        "request_key": str(uuid4()),
                        "entry": {"adapter_type": "web", "url": origin + "/table.html"},
                    },
                )
                assert rejected.json()["error"]["code"] == "keyword_required"
                worker = JobExecutor(sessions, LocalEvidenceStore(tmp_path))
                first = worker.execute(UUID(job["job_id"]))
                assert first.error.http_status == 503
                if attempt_limit == 2:
                    assert (
                        first.status == "pending"
                        and client.get(path + "/evidence-pages").json() == []
                    )
                    prior_captures = {item.name for item in tmp_path.iterdir()}
                    failing = False
                    make_retry_due(sessions, first.job_id)
                    final = worker.execute(first.job_id)
                    assert final.execution_attempt == 2 and final.valid_count == 2
                else:
                    prior_captures = set()
                    final = first
                    assert final.execution_attempt == 1 and final.valid_count == 1
                assert final.status == "partial"
                captures = client.get(path + "/evidence-pages").json()
                assert len(captures) == (5 if attempt_limit == 2 else 4)
                assert all(
                    UUID(item["evidence_id"]).hex not in prior_captures
                    for item in captures
                )
                lineage = {
                    item["evidence_id"]: item["capture_kind"] for item in captures
                }
                records = client.get(
                    "/api/v1/records", params={"job_id": job["job_id"]}
                ).json()
                assert all(
                    lineage[record["evidence_reference"]] == "detail"
                    for record in records
                )
                assert len({item["run_id"] for item in captures}) == 1
        finally:
            server.shutdown()
            thread.join()
