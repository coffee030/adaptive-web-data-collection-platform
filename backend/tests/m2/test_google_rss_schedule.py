from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from hashlib import sha256
from threading import Event
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from backend.api.app import create_app
from backend.application.execution import JobExecutor
from backend.application.jobs import database_now
from backend.core.evidence import LocalEvidenceStore
from backend.persistence.models import JobRow
from backend.trends import google_rss as rss
from backend.trends import rss_schedule as schedule
from backend.trends.rss_models import RssProvider, RssSchedule

ROOT = "/api/v1/trends/google"
START = "Thu, 26 Nov 2026 12:00:00 -0800"


def feed(region, stage, entries=()):
    return {
        "market": region,
        "source_url": rss.feed_url(region),
        "observed_at": f"2026-11-27T05:{stage:02d}:00+08:00",
        "http": 200,
        "attribution": rss.ATTRIBUTION,
        "body_sha256": sha256(str((stage, entries)).encode()).hexdigest(),
        "rows": [
            {"query": query, "published_at": START, "approx_traffic": value}
            for query, value in entries
        ],
    }


@pytest.fixture
def client(pg_engine, tmp_path):
    with TestClient(
        create_app(engine=pg_engine, evidence_root=tmp_path),
        base_url="http://127.0.0.1",
    ) as http:
        yield http


def call(client, method, path, expected=200, body=None):
    response = client.request(method, ROOT + path, json=body)
    assert response.status_code == expected, response.text
    return response.json()


def open_source(client, monkeypatch):
    monkeypatch.setattr(
        rss, "capture", lambda region: feed(region, 0, [("Setup", "100+")])
    )
    return call(
        client, "POST", "/provider", body={"region": "US", "approver": "Test operator"}
    )


def due(sessions, region):
    with sessions.begin() as session:
        session.get(RssSchedule, region).due_at = database_now(session) - timedelta(
            seconds=1
        )


def total_jobs(sessions):
    with sessions() as session:
        return session.scalar(select(func.count()).select_from(JobRow))


def schedule_row(client, region="US"):
    return next(
        row for row in call(client, "GET", "/schedules") if row["region"] == region
    )


def set_active(client, value, region="US"):
    return call(client, "PATCH", f"/schedules/{region}", body={"active": value})


def get_snapshot(client, region="US"):
    return call(client, "GET", f"/schedules/{region}/snapshot")


def test_two_dispatchers_only_stage_one_job_after_real_approval(
    client, sessions, monkeypatch
):
    approval = open_source(client, monkeypatch)
    assert approval["authorized"]
    call(client, "POST", "/schedules", 201, {"region": "US", "interval_minutes": 60})
    call(client, "POST", "/schedules", 409, {"region": "US", "interval_minutes": 30})
    seen = []
    claimed = Event()
    finish = Event()

    def capture(region):
        seen.append(region)
        claimed.set()
        assert finish.wait(timeout=10)
        return feed(region, 1, [("Football", "200+"), ("New with hidden bucket", None)])

    monkeypatch.setattr(rss, "capture", capture)
    same = call(client, "POST", "/provider", body={"region": "US", "approver": "Other"})
    assert same["profile_id"] == approval["profile_id"] and not seen
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(schedule.poll, sessions)
        assert claimed.wait(timeout=10)
        try:
            assert schedule_row(client)["claimed_at"]
            pool.submit(schedule.poll, sessions).result(timeout=10)
            assert (
                get_snapshot(client)["observed_at"] is None
                and total_jobs(sessions) == 0
            )
        finally:
            finish.set()
        first.result(timeout=10)
    assert seen == ["US"]
    assert schedule_row(client)["pending_job"]
    assert get_snapshot(client)["events"] == []
    assert total_jobs(sessions) == 1


def test_cursor_changes_only_after_verified_core_result_and_survives_pause(
    client, sessions, tmp_path, monkeypatch
):
    approval = open_source(client, monkeypatch)
    call(client, "POST", "/schedules", 201, {"region": "US"})
    captures = iter(
        [
            feed("US", 1, [("Football", "200+"), ("First hidden", None)]),
            feed("US", 2, [("Football", "200+")]),
            feed(
                "US",
                3,
                [("Football", "500+"), ("First hidden", None), ("New hidden", None)],
            ),
            feed("US", 4, [("Football", "1000+")]),
            feed("US", 5),
        ]
    )
    monkeypatch.setattr(rss, "capture", lambda _: next(captures))
    executor = JobExecutor(sessions, LocalEvidenceStore(tmp_path))

    schedule.poll(sessions)
    first_job = schedule_row(client)["pending_job"]
    assert executor.execute(UUID(first_job)).valid_count == 2
    assert not get_snapshot(client)["events"]
    schedule.poll(sessions)
    first = get_snapshot(client)
    assert [row["traffic_lower_bound"] for row in first["events"]] == [200, None]
    assert first["events"][0]["response_sha256"] == first["response_sha256"]
    set_active(client, False)
    due(sessions, "US")
    schedule.poll(sessions)
    assert get_snapshot(client) == first and not schedule_row(client)["active"]
    same = call(client, "POST", "/schedules", 201, {"region": "US"})
    assert not same["active"]

    set_active(client, True)
    schedule.poll(sessions)
    unchanged = get_snapshot(client)
    assert unchanged["observed_at"] != first["observed_at"]
    assert unchanged["events"] == first["events"][:1]
    assert schedule_row(client)["last_job"] == first_job and total_jobs(sessions) == 1

    due(sessions, "US")
    schedule.poll(sessions)
    changed_job = schedule_row(client)["pending_job"]
    assert get_snapshot(client) == unchanged
    assert executor.execute(UUID(changed_job)).valid_count == 2
    schedule.poll(sessions)
    changed = get_snapshot(client)
    assert [row["traffic_lower_bound"] for row in changed["events"]] == [
        500,
        None,
        None,
    ]
    assert changed["events"][1] == first["events"][1]
    assert changed["events"][0]["job_id"] == changed_job

    due(sessions, "US")
    schedule.poll(sessions)
    pending = schedule_row(client)["pending_job"]
    source = "/api/v1/sources/" + approval["source_id"] + "/authorization"
    assert client.patch(source, json={"approval_status": "revoked"}).status_code == 200
    assert executor.execute(UUID(pending)).status == "failed"
    schedule.poll(sessions)
    call(client, "GET", "/schedules/US/snapshot", 403)
    assert call(client, "GET", "/provider")["source_approval_status"] == "revoked"
    assert (
        client.get("/api/v1/records/" + first["events"][0]["record_id"]).status_code
        == 200
    )
    assert client.patch(source, json={"approval_status": "approved"}).status_code == 200
    schedule.poll(sessions)
    assert get_snapshot(client) == changed
    assert schedule_row(client)["last_error"] == "core_collection_failed"

    due(sessions, "US")
    schedule.poll(sessions)
    empty = get_snapshot(client)
    assert empty["observed_at"] != changed["observed_at"] and empty["events"] == []
    assert schedule_row(client)["last_job"] == changed_job and total_jobs(sessions) == 3


def test_lost_claim_is_fenced_and_publisher_cooldown_survives_restart(
    client, sessions, monkeypatch
):
    open_source(client, monkeypatch)
    call(client, "POST", "/schedules", 201, {"region": "US"})
    call(client, "POST", "/schedules", 201, {"region": "GB"})
    set_active(client, False, "GB")
    old = schedule.claim_next(sessions)
    assert old.region == "US"
    with sessions.begin() as session:
        row = session.get(RssSchedule, "US")
        row.claimed_at = (
            database_now(session) - schedule.CLAIM_LEASE - timedelta(seconds=1)
        )
    stale = feed("US", 1, [("Stale worker", "200+")])
    schedule.record_result(sessions, old, stale, rss.observations(stale))
    assert total_jobs(sessions) == 0 and schedule_row(client)["claimed_at"] is None
    new = schedule.claim_next(sessions)
    assert new.region == old.region and old.id != new.id
    schedule.record_result(sessions, old, stale, rss.observations(stale))
    assert total_jobs(sessions) == 0 and schedule_row(client)["claimed_at"]

    schedule.record_result(
        sessions,
        new,
        error=rss.ProviderError("publisher_rate_limited", timedelta(hours=2)),
    )
    status = call(client, "GET", "/provider")
    assert status["retry_at"] and status["last_error"] == "publisher_rate_limited"
    set_active(client, True, "GB")
    assert schedule.claim_next(sessions) is None
    with sessions.begin() as session:
        session.get(RssProvider, 1).retry_at = database_now(session) - timedelta(
            seconds=1
        )

    active = schedule.claim_next(sessions)
    assert active.region == "GB"
    schedule.record_result(
        sessions, active, error=rss.ProviderError("publisher_access_blocked", None)
    )
    assert call(client, "GET", "/provider")["blocked"]
    due(sessions, "US")
    assert schedule.claim_next(sessions) is None
    call(client, "POST", "/schedules", 403, {"region": "HK"})
    set_active(client, False)
    call(client, "PATCH", "/schedules/US", 403, {"active": True})
    assert total_jobs(sessions) == 0


def test_setup_reuses_the_prior_cli_approved_source_and_profile(client, monkeypatch):
    source = client.post(
        "/api/v1/sources",
        json={
            "source_name": rss.ATTRIBUTION,
            "adapter_type": "csv",
            "allowed_datasets": [rss.DATASET],
            "permission_reference": rss.POLICY,
            "approval_status": "approved",
            "request_key": str(rss.SOURCE_KEY),
        },
    ).json()
    versions = f"/api/v1/sources/{source['source_id']}/versions"
    draft = client.post(
        versions, json={"configuration": rss.MAPPING.model_dump(mode="json")}
    ).json()
    version = versions + "/" + draft["profile_version_id"]
    input_body = rss.entry(feed("US", 1, [("Existing", "100+")])).model_dump(
        mode="json"
    )
    report = client.post(version + "/validate", json=input_body).json()
    assert report["passed"]
    approved = client.post(
        version + "/approve",
        json={
            "approver": "Existing operator",
            "report_id": report["report_id"],
            "config_hash": report["config_hash"],
        },
    )
    assert approved.status_code == 200

    def no_new_capture(_):
        pytest.fail("The deployed CLI approval already contains a validated sample")

    monkeypatch.setattr(rss, "capture", no_new_capture)
    body = {"region": "US", "approver": "Schedule operator"}
    status = call(client, "GET", "/provider")
    assert status["source_approval_status"] == "approved" and not status["authorized"]
    result = call(client, "POST", "/provider", body=body)
    assert result["authorized"] and result["source_id"] == str(
        UUID(source["source_id"])
    )
    assert result["profile_id"] == str(UUID(draft["profile_version_id"]))
