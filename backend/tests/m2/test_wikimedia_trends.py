import json
from datetime import UTC, date, datetime, timedelta
from hashlib import sha256
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.application.execution import JobExecutor
from backend.application.jobs import database_now
from backend.core.evidence import LocalEvidenceStore
from backend.trends import service, wikimedia
from backend.trends.models import WikiProvider

ROOT = "/api/v1/trends/wikimedia"
EDITION = "ja.wikipedia.org"
ARTICLE = "長友佑都"


def test_publisher_projects_accept_only_the_exact_known_suffix(monkeypatch):
    day = date(2026, 11, 24)
    envelope = [
        {
            "project": "ja.wikipedia",
            "access": "all-access",
            "year": "2026",
            "month": "11",
            "day": "24",
            "articles": [{"article": ARTICLE, "rank": 4, "views": 118037}],
        }
    ]
    monkeypatch.setattr(wikimedia, "load", lambda url: (envelope, b"top fixture"))
    assert wikimedia.discover(EDITION, day, 10)["articles"] == [
        {"article": ARTICLE, "rank": 4, "views": 118037}
    ]
    with pytest.raises(wikimedia.ProviderError, match="publisher_invalid_response"):
        wikimedia.discover("es.wikipedia.org", day, 10)


def test_coverage_requires_observed_intervals_and_nonzero_baseline():
    days = ["2026-11-24", "2026-11-25", "2026-11-26"]
    points = {days[0]: {"views": 0}, days[-1]: {"views": 6}}
    assert service.coverage(points, days) == {
        "requested_days": 3,
        "observed_days": 2,
        "baseline_views": 0,
        "latest_views": 6,
        "change_views": None,
        "change_percent": None,
    }
    points[days[1]] = {"views": 3}
    assert service.coverage(points, days)["change_views"] == 6
    assert service.coverage(points, days)["change_percent"] is None


def test_publisher_gaps_backfill_dedup_failure_and_withdrawal(
    pg_engine, sessions, tmp_path, monkeypatch
):
    today = datetime.now(UTC).date()
    days = [today - timedelta(days=n) for n in range(5, 1, -1)]
    observed = {days[1]: 0, days[3]: 14}
    fail = False

    def response(url):
        if fail:
            raise wikimedia.ProviderError("publisher_unavailable")
        start, end = [
            datetime.strptime(value, "%Y%m%d").date()
            for value in url.rsplit("/", 2)[-2:]
        ]
        items = [
            {
                "project": "ja.wikipedia",
                "article": ARTICLE,
                "access": "all-access",
                "agent": "user",
                "granularity": "daily",
                "timestamp": f"{day:%Y%m%d}00",
                "views": views,
            }
            for day, views in observed.items()
            if start <= day <= end
        ]
        return items, json.dumps({"items": items}, ensure_ascii=False).encode()

    def poll():
        with sessions.begin() as session:
            session.get(WikiProvider, 1).next_request_at = database_now(
                session
            ) - timedelta(seconds=1)
        service.poll(sessions)

    monkeypatch.setattr(wikimedia, "load", response)
    with TestClient(
        create_app(engine=pg_engine, evidence_root=tmp_path),
        base_url="http://127.0.0.1",
    ) as client:
        sample = {
            "project": EDITION,
            "article": ARTICLE,
            "day": str(days[-1]),
            "approver": "Test",
        }
        provider = client.post(ROOT + "/provider", json=sample).json()
        assert provider["authorized"] and provider["reader_geography"] is None
        settings = {
            "project": EDITION,
            "article": ARTICLE,
            "day": str(days[0]),
            "topic": "Football",
        }
        watch = client.post(ROOT + "/series", json=settings).json()["id"]
        assert client.post(ROOT + "/series", json=settings).json()["id"] == watch
        poll()
        job_id = client.get(ROOT + "/series").json()[0]["pending_job"]
        comparison = {"watch_id": watch, "start": str(days[0]), "end": str(days[-1])}

        def result():
            return client.get(ROOT + "/compare", params=comparison).json()["series"][0]

        assert result()["points"] == [None] * 4
        executor = JobExecutor(sessions, LocalEvidenceStore(tmp_path))
        assert executor.execute(UUID(job_id)).valid_count == 2
        poll()
        result_initial = result()
        assert [p["views"] if p else None for p in result_initial["points"]] == [
            None,
            0,
            None,
            14,
        ]
        assert result_initial["next_day"] == str(days[-1] + timedelta(days=1))
        elementary_capture = client.get(ROOT + "/captures/" + job_id)
        assert elementary_capture.status_code == 200
        assert (
            sha256(elementary_capture.content).hexdigest()
            == elementary_capture.headers["x-content-sha256"]
        )
        assert (
            result_initial["points"][1]["response_sha256"]
            == elementary_capture.headers["x-content-sha256"]
        )
        observed[days[0]], observed[days[2]], observed[days[3]] = 5, 9, 18

        def backfill():
            update = client.patch(
                ROOT + "/series/" + watch,
                json={"active": True, "backfill_from": str(days[0])},
            )
            assert update.status_code == 200
            poll()
            return client.get(ROOT + "/series").json()[0]

        updated = backfill()
        assert result()["points"] == result_initial["points"]
        assert executor.execute(UUID(updated["pending_job"])).valid_count == 3
        poll()
        latest = result()
        assert [p["views"] for p in latest["points"]] == [5, 0, 9, 18]
        assert (
            latest["points"][3]["observation_id"]
            == result_initial["points"][3]["observation_id"]
        )
        assert latest["coverage"]["change_percent"] == 260
        duplicate = backfill()
        assert (
            duplicate["pending_job"] is None
            and duplicate["last_job"] == latest["last_job"]
        )
        fail = True
        failure = backfill()
        assert failure["last_error"] == "publisher_unavailable"
        assert result()["points"] == latest["points"]
        assert (
            client.get(ROOT + "/provider").json()["last_error"]
            == "publisher_unavailable"
        )
        revoke = client.patch(
            "/api/v1/sources/" + provider["source_id"] + "/authorization",
            json={"approval_status": "revoked"},
        )
        assert revoke.status_code == 200
        assert client.get(ROOT + "/compare", params=comparison).status_code == 403
        assert client.get(ROOT + "/captures/" + job_id).status_code == 403
        assert (
            client.post(
                ROOT + "/discover", json={"project": EDITION, "day": str(days[-1])}
            ).status_code
            == 403
        )
