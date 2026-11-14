from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from uuid import UUID

import pytest
from conftest import ROOT
from sqlalchemy import func, select, update

from backend.application.execution import JobExecutor
from backend.application.inputs import WebEntry
from backend.application.profiles import Profiles
from backend.application.retry import retry_delay
from backend.core.contracts import CollectionError, ExtractionConfiguration, Source
from backend.core.evidence import LocalEvidenceStore
from backend.core.web_adapter import _retry_after
from backend.persistence.models import EvidenceRow, JobRow


@pytest.mark.parametrize(
    ("code", "status", "retry_after", "delay"),
    [
        ("timeout", None, None, 20),
        ("transport_error", None, None, 20),
        ("database_unavailable", None, None, 20),
        ("rate_limited", 429, 90, 90),
        ("http_error", 500, None, 20),
        ("robots_unavailable", 503, 45, 45),
        ("access_blocked", 429, 1, None),
        ("access_blocked", 403, None, None),
        ("robots_unavailable", 403, None, None),
        ("rate_limited", 429, 301, None),
        ("http_error", 404, None, None),
        ("invalid_selector", None, None, None),
        ("evidence_write_failed", None, None, None),
    ],
)
def test_retry_classification(code, status, retry_after, delay):
    error = CollectionError(
        code=code,
        message="fixture",
        http_status=status,
        retry_after_seconds=retry_after,
    )
    assert retry_delay(error, 2) == (
        None if delay is None else timedelta(seconds=delay)
    )


def test_retry_after_accepts_seconds_and_http_date():
    assert _retry_after(" 00030 ") == 30
    assert _retry_after("9" * 10_000) > 300
    assert _retry_after("tomorrow") is None
    future = datetime.now(UTC) + timedelta(seconds=90)
    assert 88 <= _retry_after(format_datetime(future, usegmt=True)) <= 90


@pytest.fixture
def web_job(sessions, tmp_path):
    from collections import deque
    from contextlib import contextmanager
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from threading import Thread
    from time import sleep

    @contextmanager
    def create(responses):
        pending = deque(responses)
        requests = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                requests.append(self.path)
                if self.path == "/robots.txt":
                    self.send_error(404)
                    return
                status, headers, delay = pending.popleft() if pending else (200, {}, 0)
                sleep(delay)
                try:
                    self.send_response(status)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    for key, value in headers.items():
                        self.send_header(key, value)
                    self.end_headers()
                    self.wfile.write(
                        (ROOT / "backend/tests/fixtures/m0/table.html").read_bytes()
                    )
                except OSError:
                    pass

        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                from uuid import uuid4

                origin = f"http://127.0.0.1:{server.server_port}"
                source = Source(
                    source_id=uuid4().hex,
                    source_name="Retry fixture",
                    adapter_type="web",
                    permission_reference="controlled fixture",
                    approval_status="approved",
                    allowed_origins=(origin,),
                )
                config = ExtractionConfiguration(
                    config_schema_version="1",
                    selector_type="css",
                    item_selector="tr:has(td)",
                    fields=[{"name": "name", "selector": "td"}],
                    record_schema={
                        "record_type": "fixture",
                        "schema_version": "1",
                        "identity_field": "name",
                        "fields": [{"name": "name"}],
                    },
                )
                executor = JobExecutor(sessions, LocalEvidenceStore(tmp_path))
                profiles = Profiles(sessions)
                profiles.register_source(source)
                source_id = UUID(source.source_id)
                draft = profiles.create_draft(source_id, config)
                version = UUID(draft.profile_version_id)
                entry = WebEntry(adapter_type="web", url=f"{origin}/table.html")
                report = profiles.validate(
                    source_id, version, entry.collection_input(), executor.evidence
                )
                assert report.passed, report
                profiles.approve(
                    source_id,
                    version,
                    approver="operator",
                    report_id=UUID(report.report_id),
                    config_hash=report.config_hash,
                )
                job, _ = executor.jobs.create(source_id, version, entry)
                yield executor, job.job_id, requests
            finally:
                server.shutdown()
                thread.join()

    return create


@pytest.mark.parametrize(
    ("failure", "code", "delay"),
    [
        ((429, {"Retry-After": "90"}, 0), "rate_limited", 90),
        ((500, {}, 0), "http_error", 10),
        ((200, {}, 0.4), "timeout", 10),
    ],
)
def test_http_retry_reschedules_then_succeeds(
    web_job, sessions, failure, code, delay, monkeypatch
):
    with web_job([(200, {}, 0), failure]) as (executor, job_id, requests):
        if code == "timeout":
            monkeypatch.setattr("backend.core.web_adapter.TIMEOUT_SECONDS", 0.1)
        pending = executor.execute(job_id)
        assert pending.status == "pending"
        assert pending.error.code == code
        assert pending.execution_attempt == 1
        assert pending.next_attempt_at >= pending.created_at + timedelta(seconds=delay)
        assert pending.next_attempt_at == pending.dispatch_due_at
        assert executor.jobs.events(job_id)[-1].kind == "RETRY_SCHEDULED"
        with sessions.begin() as session:
            assert session.scalar(select(EvidenceRow)) is None
            session.execute(
                update(JobRow)
                .where(JobRow.id == job_id)
                .values(next_attempt_at=func.now(), dispatch_due_at=func.now())
            )
        succeeded = executor.execute(job_id)
        assert succeeded.status == "succeeded"
        assert succeeded.execution_attempt == 2
        assert requests == ["/robots.txt", "/table.html"] * 3
        with sessions() as session:
            assert len(session.scalars(select(EvidenceRow)).all()) == 1


@pytest.mark.parametrize(
    ("response", "expected"),
    [
        ((403, {}, 0), "access_blocked"),
        ((503, {"CF-Mitigated": "challenge"}, 0), "access_blocked"),
    ],
)
def test_http_access_block_is_terminal(web_job, response, expected):
    with web_job([(200, {}, 0), response]) as (executor, job_id, requests):
        final = executor.execute(job_id)
        assert final.status == "failed"
        assert final.error.code == expected
        assert final.execution_attempt == 1
        assert final.next_attempt_at is None
        assert requests == ["/robots.txt", "/table.html"] * 2


def test_http_retries_stop_with_one_committed_evidence(web_job, sessions):
    with web_job([(200, {}, 0)] + [(500, {}, 0)] * 3) as (executor, job_id, requests):
        for _ in range(2):
            assert executor.execute(job_id).status == "pending"
            with sessions.begin() as session:
                session.execute(
                    update(JobRow)
                    .where(JobRow.id == job_id)
                    .values(next_attempt_at=func.now(), dispatch_due_at=func.now())
                )
        failed = executor.execute(job_id)
        assert failed.status == "failed"
        assert failed.execution_attempt == 3
        assert len(requests) == 8
        with sessions() as session:
            assert len(session.scalars(select(EvidenceRow)).all()) == 1


def test_compose_origin_requires_opt_in_and_exact_source_policy(monkeypatch):
    from backend.core.contracts import COMPOSE_FIXTURE_ORIGIN, Source
    from backend.core.inputs import InputError
    from backend.core.web_adapter import checked_url

    policy = {
        "source_id": "fixture",
        "source_name": "Controlled fixture",
        "permission_reference": "Controlled test network",
        "adapter_type": "web",
        "approval_status": "approved",
    }
    monkeypatch.delenv("M3_COMPOSE_FIXTURE", raising=False)
    with pytest.raises(ValueError):
        Source(**policy, allowed_origins=(COMPOSE_FIXTURE_ORIGIN,))
    monkeypatch.setenv("M3_COMPOSE_FIXTURE", "1")
    source = Source(**policy, allowed_origins=(COMPOSE_FIXTURE_ORIGIN,))
    assert (
        checked_url(source, COMPOSE_FIXTURE_ORIGIN + "/table.html")[1]
        == COMPOSE_FIXTURE_ORIGIN
    )
    for denied in (
        "http://postgres:5432/",
        "http://collection-fixture:8002/",
        "http://collection-fixture:8001@127.0.0.1:8001/",
        "http://192.168.1.1:8001/",
        "http://127.0.0.1:8001/",
    ):
        with pytest.raises(InputError, match="controlled"):
            checked_url(source, denied)
