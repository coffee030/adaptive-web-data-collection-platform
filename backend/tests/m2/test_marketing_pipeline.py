from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import UUID

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from test_m3_broker import broker_producer, broker_url, dispatcher, wait_for, worker  # noqa: F401
from test_process_restart import child_environment, server

from backend.api.app import create_app
from backend.application.jobs import database_now
from backend.marketing.models import AccountRow, LeadRow, PostRow, ProviderRow, RunRow
from backend.marketing.pipeline import STANDARD_LIMIT, Pipeline, _provider_day
from backend.marketing.store import MarketingError, ResearchSettings
from backend.marketing.youtube import ProviderError, Refresh
from backend.queue.celery_app import MARKETING_TASK
from backend.tests.marketing_fixture import (
    CHANNEL,
    FIRST,
    OTHER_CHANNEL,
    results,
    standard_response,
)

CONFIG = ResearchSettings(enabled=True, discovery=True)
TOKEN = "fixture-operator-token-for-milestone"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}
ROOT = "/api/v1/marketing"


def run_with(pipeline, run_id, response=standard_response):
    with httpx2.Client(transport=httpx2.MockTransport(response)) as client:
        pipeline.execute(run_id, "fixture", client)


def set_due(sessions, run_id, **fields):
    with sessions.begin() as session:
        session.execute(update(RunRow).where(RunRow.id == run_id).values(**fields))


def counts(sessions):
    with sessions() as session:
        return tuple(
            session.scalar(select(func.count()).select_from(table))
            for table in (PostRow, LeadRow, RunRow)
        )


def test_migrated_research_api_enforces_permissions_and_expires_payloads(
    sessions, pg_engine, tmp_path, monkeypatch
):
    monkeypatch.setenv("MARKETING_OPERATOR_TOKEN", TOKEN)
    monkeypatch.setenv("MARKETING_YOUTUBE_RESEARCH", "1")
    monkeypatch.setenv("MARKETING_YOUTUBE_DISCOVERY", "1")
    pipeline = Pipeline(sessions, CONFIG)
    account = f"{ROOT}/research/accounts/{CHANNEL}"
    with TestClient(
        create_app(engine=pg_engine, evidence_root=tmp_path),
        base_url="http://localhost",
    ) as client:
        assert (
            client.get(f"{ROOT}/capabilities").json()["customer_intelligence"]
            == "unavailable"
        )
        request = client.post(
            f"{ROOT}/intelligence-requests", json={"query": "Synthetic niche"}
        )
        assert request.status_code == 403
        assert request.json()["error"]["code"] == "commercial_permission_pending"
        assert client.put(account, json={}).status_code == 403
        first = client.put(account, json={}, headers=HEADERS).json()
        repeat = client.put(account, json={}, headers=HEADERS).json()
        assert first["creator_id"] == repeat["creator_id"]
        assert first["state"] == "pending"
        pipeline.maintain()
        pipeline.maintain()
        run = client.post(account + "/refresh", headers=HEADERS).json()
        run_with(pipeline, UUID(run["id"]))
        run_with(
            pipeline, UUID(run["id"]), lambda _: pytest.fail("Repeated provider call")
        )
        read = client.get(account, headers=HEADERS)
        assert read.headers["cache-control"] == "no-store"
        assert read.json()["state"] == "available"
        assert read.json()["last_run"]["standard_units"] == 3
        assert [post["video_id"] for post in read.json()["posts"]] == [FIRST]
        for purpose in ("analytics", "aggregation", "training", "commercial", "export"):
            denied = client.get(account, headers=HEADERS, params={"purpose": purpose})
            assert denied.status_code == 403
            assert "Synthetic creator" not in denied.text

        discovery = f"{ROOT}/research/discoveries"
        search = client.post(
            discovery, json={"query": "  Synthetic   niche "}, headers=HEADERS
        ).json()
        run_with(pipeline, UUID(search["id"]))
        repeated = client.post(
            discovery, json={"query": "synthetic niche"}, headers=HEADERS
        ).json()
        assert repeated["id"] == search["id"]
        search_url = discovery + "/" + search["id"]
        found = client.get(search_url, headers=HEADERS).json()
        assert found["run"]["search_calls"] == 1 and found["run"]["standard_units"] == 0
        assert [lead["channel_id"] for lead in found["leads"]] == [
            OTHER_CHANNEL,
            CHANNEL,
        ]
        assert (
            client.get(
                search_url, params={"purpose": "training"}, headers=HEADERS
            ).status_code
            == 403
        )
        assert counts(sessions) == (1, 2, 2)
        assert list(tmp_path.iterdir()) == []

        assert (
            client.delete(
                f"{ROOT}/research/accounts/{OTHER_CHANNEL}", headers=HEADERS
            ).status_code
            == 204
        )
        assert [
            lead["channel_id"]
            for lead in client.get(search_url, headers=HEADERS).json()["leads"]
        ] == [CHANNEL]
        with sessions.begin() as session:
            past = database_now(session) - timedelta(seconds=1)
            session.execute(
                update(AccountRow)
                .where(AccountRow.channel_id == CHANNEL)
                .values(expires_at=past)
            )
            session.execute(update(LeadRow).values(expires_at=past))
            session.execute(
                update(RunRow)
                .where(RunRow.kind == "discovery")
                .values(finished_at=past - timedelta(days=1))
            )
        assert client.get(account, headers=HEADERS).json()["state"] == "expired"
        assert client.get(account, headers=HEADERS).json()["posts"] == []
        assert client.get(search_url, headers=HEADERS).json()["state"] == "expired"
        pipeline.maintain()
        assert counts(sessions) == (0, 0, 2)
        assert client.delete(account, headers=HEADERS).status_code == 204
        assert client.get(account, headers=HEADERS).json()["state"] == "withdrawn"
        assert client.put(account, json={}, headers=HEADERS).status_code == 409
        assert counts(sessions) == (0, 0, 1)


def test_restart_recovers_leases_and_discards_stale_completion(sessions):
    first = Pipeline(sessions, CONFIG)
    first.watch(CHANNEL, 6)
    with ThreadPoolExecutor(4) as pool:
        runs = list(pool.map(lambda _: first.refresh(CHANNEL), range(4)))
    assert len({run.id for run in runs}) == 1
    run_id = runs[0].id
    crashed = first.claim(run_id)
    assert crashed
    with sessions.begin() as session:
        past = database_now(session) - timedelta(seconds=1)
    set_due(sessions, run_id, lease_until=past)
    restarted = Pipeline(sessions, CONFIG)
    restarted.maintain()
    assert restarted.read_run(run_id).error_code == "worker_lost"
    restarted.complete(crashed, Refresh(None, []))
    assert restarted.read_run(run_id).status == "queued"
    with pytest.raises(ProviderError, match="claim_lost"):
        restarted.reserve(crashed, "channels")
    run_with(restarted, run_id)
    assert restarted.read_run(run_id).attempts == 2
    with sessions.begin() as session:
        session.execute(update(AccountRow).values(next_refresh_at=past))
    restarted.maintain()
    scheduled = restarted.refresh(CHANNEL)
    assert scheduled.id != run_id
    run_with(restarted, scheduled.id, lambda _: results())
    assert restarted.read_account(CHANNEL, "research").state == "unavailable"
    assert counts(sessions)[0] == 0


def test_broker_recovery_and_lineage_expiration(sessions):
    pipeline = Pipeline(sessions, CONFIG)
    pipeline.watch(CHANNEL, 24)
    run = pipeline.refresh(CHANNEL)

    def offline(_):
        raise OSError("isolated broker unavailable")

    assert not pipeline.dispatch(offline)
    assert pipeline.read_run(run.id).error_code == "broker_unavailable"
    assert not pipeline.dispatch(lambda _: pytest.fail("Early broker retransmission"))
    with sessions.begin() as session:
        past = database_now(session) - timedelta(seconds=1)
    set_due(sessions, run.id, dispatch_at=past)
    published = []
    restarted = Pipeline(sessions, CONFIG)
    assert restarted.dispatch(published.append)
    assert not restarted.dispatch(published.append)
    assert published == [run.id]
    run_with(restarted, run.id)
    with sessions.begin() as session:
        post = session.get(PostRow, FIRST)
        post.post = {
            **post.post,
            "uploads_provenance": {
                **post.post["uploads_provenance"],
                "expires_at": past.isoformat(),
            },
        }
    assert (
        restarted.read_account(CHANNEL, "research").posts[0].uploads_provenance is None
    )
    restarted.maintain()
    with sessions() as session:
        assert "uploads_provenance" not in session.get(PostRow, FIRST).post


def test_publisher_cooldown_quota_and_explicit_block(sessions):
    pipeline = Pipeline(sessions, CONFIG)
    pipeline.watch(CHANNEL, 6)
    pipeline.watch(OTHER_CHANNEL, 6)
    run = pipeline.refresh(CHANNEL)
    other = pipeline.refresh(OTHER_CHANNEL)
    run_with(
        pipeline, run.id, lambda _: httpx2.Response(429, headers={"Retry-After": "90"})
    )
    run = pipeline.read_run(run.id)
    assert run.status == "queued" and run.standard_units == 1
    assert run.error_code == "provider_rate_limited"
    with sessions.begin() as session:
        now = database_now(session)
        assert (run.available_after - now).total_seconds() > 80
        assert session.get(ProviderRow, 1).resume_at == run.available_after
        assert session.get(ProviderRow, 1).standard_units == 1
    restarted = Pipeline(sessions, CONFIG)
    assert restarted.claim(other.id) is None
    assert not restarted.dispatch(
        lambda _: pytest.fail("Publisher cooldown was bypassed")
    )
    with sessions.begin() as session:
        provider = session.get(ProviderRow, 1)
        provider.resume_at = None
        provider.quota_day = _provider_day(session)
        provider.standard_units = STANDARD_LIMIT
    run_with(
        restarted,
        other.id,
        lambda _: pytest.fail("Exhausted standard quota made a request"),
    )
    held = restarted.read_run(other.id)
    assert (
        held.status == "queued"
        and held.standard_units == 0
        and held.error_code == "local_quota"
    )
    discovery = restarted.discover("synthetic channel")
    run_with(restarted, discovery.id)
    assert restarted.read_run(discovery.id).search_calls == 1

    with sessions.begin() as session:
        provider = session.get(ProviderRow, 1)
        provider.standard_units = 0
        now = database_now(session)
    set_due(sessions, run.id, available_after=now, dispatch_at=now)
    run_with(restarted, run.id, lambda _: httpx2.Response(403))
    assert restarted.read_run(run.id).error_code == "provider_access_blocked"
    assert counts(sessions)[1] == 0
    assert not restarted.dispatch(lambda _: pytest.fail("Access block was bypassed"))
    restarted.clear_provider_block()
    with sessions() as session:
        assert not session.get(ProviderRow, 1).blocked


def test_withdraw_during_collection_and_disabled_access_purge(sessions):
    pipeline = Pipeline(sessions, CONFIG)
    pipeline.watch(CHANNEL, 6)
    run = pipeline.refresh(CHANNEL)
    run_with(pipeline, run.id)
    assert counts(sessions)[0] == 1
    disabled = Pipeline(sessions, ResearchSettings())
    with pytest.raises(MarketingError, match="disabled"):
        disabled.read_account(CHANNEL, "research")
    disabled.maintain()
    assert counts(sessions)[0] == 0
    discovery = pipeline.discover("test withdrawal")

    def withdraw_during_request(request):
        pipeline.withdraw(CHANNEL)
        return standard_response(request)

    run_with(pipeline, discovery.id, withdraw_during_request)
    assert [
        lead.channel_id
        for lead in pipeline.read_discovery(discovery.id, "research").leads
    ] == [OTHER_CHANNEL]
    assert pipeline.read_account(CHANNEL, "research").state == "withdrawn"


def test_real_dispatcher_celery_and_api_restart(
    pg_engine,
    pg_url,
    pg_schema,
    broker_url,  # noqa: F811
    tmp_path,
):
    env = child_environment(pg_url, pg_schema, tmp_path) | {
        "CELERY_BROKER_URL": broker_url,
        "MARKETING_YOUTUBE_RESEARCH": "1",
        "MARKETING_YOUTUBE_DISCOVERY": "1",
        "MARKETING_OPERATOR_TOKEN": TOKEN,
        "YOUTUBE_API_KEY": "synthetic-fixture",
    }
    account = f"{ROOT}/research/accounts/{CHANNEL}"
    with server(env, tmp_path / "first-api.log") as (_, client):
        created = client.put(account, json={"refresh_hours": 6}, headers=HEADERS).json()
    with (
        worker(
            env, tmp_path / "worker.log", module="backend.tests.marketing_worker"
        ) as process,
        dispatcher(env, tmp_path / "dispatcher.log"),
        server(env, tmp_path / "second-api.log") as (_, client),
    ):

        def available():
            data = client.get(account, headers=HEADERS).json()
            return data if data.get("state") == "available" else None

        data = wait_for(
            available,
            process,
            "Scheduled research did not publish and process",
            tmp_path / "worker.log",
        )
        assert data["creator_id"] == created["creator_id"]
        assert data["posts"][0]["video_id"] == FIRST
        run_id = data["last_run"]["id"]
    broker_producer(broker_url).send_task(MARKETING_TASK, args=[run_id])
    with (
        worker(
            env,
            tmp_path / "restarted-worker.log",
            module="backend.tests.marketing_worker",
        ) as process,
        dispatcher(env, tmp_path / "restarted-dispatcher.log"),
        server(env, tmp_path / "third-api.log") as (_, client),
    ):
        wait_for(
            lambda: (
                " succeeded "
                in (tmp_path / "restarted-worker.log").read_text(encoding="utf-8")
            ),
            process,
            "Repeated delivery was not acknowledged",
            tmp_path / "restarted-worker.log",
        )
        read = client.get(account, headers=HEADERS).json()
        assert read["last_run"]["id"] == run_id
        assert read["last_run"]["attempts"] == 1
        assert read["last_run"]["standard_units"] == 3
        assert len(read["posts"]) == 1
