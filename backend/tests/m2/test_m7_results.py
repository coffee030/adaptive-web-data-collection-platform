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
from backend.core import web_adapter
from backend.core.contracts import Source
from backend.core.evidence import LocalEvidenceStore
from backend.core.inputs import InputError, WebInput
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


@pytest.mark.parametrize("at_robots", [False, True])
def test_publisher_503_retry_after_is_shared_across_clients(rate_url, at_robots):
    class Handler(FixtureHandler):
        def do_GET(self):
            if at_robots or self.path != "/robots.txt":
                self.send_response(503)
                self.send_header("Retry-After", "30")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            super().do_GET()

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            origin = f"http://127.0.0.1:{server.server_port}"
            source = Source(
                source_id="retry-after",
                source_name="Controlled retry fixture",
                adapter_type="web",
                permission_reference="Controlled test",
                approval_status="approved",
                allowed_origins=(origin,),
            )
            limits = web_adapter.RequestLimits(3, 0, 512_000, 2, 5)
            requests = web_adapter.SearchRequests(
                source, limits, OriginRate(rate_url), lambda: None
            )
            url = origin + "/m7/cards/search?q=quick"
            with pytest.raises(InputError) as publisher:
                web_adapter.capture_html(source, WebInput(url), requests=requests)
            assert publisher.value.error.http_status == 503
            assert publisher.value.error.retry_after_seconds == 30

            with (
                pytest.raises(InputError) as blocked,
                OriginRate(rate_url).request(origin, 1000, monotonic() + 2),
            ):
                pytest.fail("A separate client acquired the origin before Retry-After")
            assert blocked.value.error.code == "origin_rate_busy"
            assert blocked.value.error.retry_after_seconds in (29, 30)
        finally:
            server.shutdown()
            thread.join()


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
