from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from test_m3_broker import broker_url, dispatcher, wait_for, worker  # noqa: F401
from test_process_restart import child_environment, server

from backend.api.app import create_app
from backend.intelligence.contracts import ImportDataset
from backend.intelligence.indexing import Indexing
from backend.intelligence.models import DatasetRow
from backend.intelligence.store import DEMO, Config, Scope

BASE = "/api/v1/marketing/intelligence"
OPERATOR_TOKEN = "fixture-operator-token-for-intelligence"
CUSTOMER_TOKEN = "fixture-customer-token-for-intelligence"
OP = {"Authorization": f"Bearer {OPERATOR_TOKEN}"}
CUSTOMER = {"Authorization": f"Bearer {CUSTOMER_TOKEN}"}
WORKSPACE = "fixture-pilot"
BRIEF = {
    "description": "親子餐廳 嬰兒車通道 affordable family dining",
    "objective": "awareness",
    "platform": "youtube",
    "deliverable": "video_integration",
    "currency": "HKD",
    "budget_minor": 6000,
    "maximum_creators": 2,
    "minimum_creators": 2,
    "market": "HK",
    "minimum_market_share": "0.5",
    "language": "yue",
    "require_language": True,
    "required_facts": ["stroller_access"],
}


def fixture_embeddings(directory, texts):
    return [[1.0] + [0.0] * 383 for _ in texts]


def timestamps():
    past = datetime.now(UTC) - timedelta(days=1)
    return past, past + timedelta(days=31)


def row(kind, ident, creator, observed, **values):
    return {
        "kind": kind,
        "id": ident,
        "creator_id": creator,
        "evidence_ref": f"receipt-{ident}",
        "observed_at": observed.isoformat(),
        **values,
    }


def grant(origin, end, owner="example-grant-owner", **uses):
    return {
        "origin": origin,
        "owner_ref": owner,
        "authorization_ref": "example-grant",
        "attribution": "Synthetic verification example",
        "expires_at": end.isoformat(),
        **uses,
    }


def demo_body():
    observed, end = timestamps()
    records = []
    for creator in ("a", "b", "c"):
        records.extend(
            [
                row(
                    "profile",
                    f"{creator}-profile",
                    creator,
                    observed,
                    name=f"Fixture {creator}",
                    accounts=[{"platform": "youtube", "account_id": creator}],
                ),
                row(
                    "content",
                    f"{creator}-post",
                    creator,
                    observed,
                    platform="youtube",
                    account_id=creator,
                    published_at=(observed - timedelta(days=8)).isoformat(),
                    text=f"親子餐廳 嬰兒車通道 affordable family dining {creator}",
                    languages=["yue", "en"],
                    reviewed_facts=["stroller_access"],
                ),
                row(
                    "performance",
                    f"{creator}-metric",
                    creator,
                    observed,
                    platform="youtube",
                    post_id=f"{creator}-post",
                    window_end=(observed - timedelta(days=1)).isoformat(),
                    views=1000,
                    likes=30,
                    comments=20,
                ),
                row(
                    "audience",
                    f"{creator}-audience",
                    creator,
                    observed,
                    platform="youtube",
                    market="HK",
                    period_start=(observed - timedelta(days=14)).isoformat(),
                    period_end=(observed - timedelta(days=1)).isoformat(),
                    denominator=100,
                    share="0.7",
                    data_status="observed",
                ),
            ]
        )
    for creator in ("a", "b"):
        records.append(
            row(
                "quote",
                f"{creator}-quote",
                creator,
                observed,
                platform="youtube",
                deliverable="video_integration",
                quote_type="firm",
                currency="HKD",
                amount_minor=3000,
                valid_until=end.isoformat(),
                terms="One integration",
            )
        )
    records.append(
        row(
            "content",
            "a-post-copy",
            "a",
            observed,
            platform="youtube",
            account_id="a",
            published_at=(observed - timedelta(days=8)).isoformat(),
            text="親子餐廳 嬰兒車通道 AFFORDABLE   FAMILY DINING A",
            languages=["yue", "en"],
        )
    )
    return {"grant": grant("synthetic", end, academic_demo=True), "records": records}


def partner_body():
    observed, end = timestamps()
    return {
        "grant": grant(
            "creator_profile",
            end,
            "partner-one",
            pilot_analytics=True,
            commercial_display=True,
        ),
        "records": [
            row(
                "profile",
                "partner-profile",
                "partner-one",
                observed,
                name="Fixture independent owner",
                accounts=[{"platform": "youtube", "account_id": "owner-supplied-id"}],
            )
        ],
    }


def test_customer_end_to_end_and_permission_isolation(
    pg_engine, sessions, tmp_path, monkeypatch
):
    monkeypatch.setenv("MARKETING_DEMO_ENABLED", "1")
    monkeypatch.setenv("MARKETING_PARTNER_WORKSPACE", WORKSPACE)
    monkeypatch.setenv("MARKETING_OPERATOR_TOKEN", OPERATOR_TOKEN)
    monkeypatch.setenv("MARKETING_CUSTOMER_TOKEN", CUSTOMER_TOKEN)
    monkeypatch.delenv("MARKETING_MODEL_DIR", raising=False)
    demo_path = f"{BASE}/operator/demo/datasets/demo-a"
    partner_path = f"{BASE}/operator/partner/datasets/partner-a"
    with TestClient(
        create_app(engine=pg_engine, evidence_root=tmp_path),
        base_url="http://localhost",
    ) as client:
        capability = client.get("/api/v1/marketing/capabilities").json()
        assert capability["permission_status"] == "additional_permission_pending"
        assert (
            capability["customer_intelligence"]
            == capability["demo_intelligence"]
            == "available"
        )
        assert client.get(BASE + "/partner/creators").status_code == 403
        assert client.get(BASE + "/partner/creators", headers=OP).status_code == 403
        assert client.get(BASE + "/demo/processing").json()["state"] == "empty"
        assert (
            client.put(demo_path, json=demo_body(), headers=CUSTOMER).status_code == 403
        )
        payload = demo_body()
        first = client.put(demo_path, headers=OP, json=payload)
        assert first.status_code == 200, first.text
        assert first.json()["state"] == "lexical"
        payload["records"].reverse()
        assert client.put(demo_path, headers=OP, json=payload).json() == first.json()
        assert (
            client.put(demo_path + "-duplicate", headers=OP, json=payload).status_code
            == 409
        )
        assert (
            client.put(partner_path, headers=OP, json=payload).json()["error"]["code"]
            == "grant_restricted"
        )
        partner = partner_body()
        blocked = {
            "grant": partner["grant"] | {"commercial_display": False},
            "records": partner["records"],
        }
        assert client.put(partner_path, headers=OP, json=blocked).status_code == 403
        restricted = partner | {
            "grant": partner["grant"] | {"origin": "youtube_data_api"}
        }
        assert client.put(partner_path, headers=OP, json=restricted).status_code == 422
        assert client.put(partner_path, headers=OP, json=partner).status_code == 200
        assert [
            item["profile"]["data"]["creator_id"]
            for item in client.get(BASE + "/partner/creators", headers=CUSTOMER).json()[
                "creators"
            ]
        ] == ["partner-one"]
        assert (
            client.get(BASE + "/partner/creators/a", headers=CUSTOMER).status_code
            == 404
        )
        assert client.get(BASE + "/demo/creators/partner-one").status_code == 404

        discovery = client.get(
            BASE + "/demo/creators",
            params={"language": "yue", "market": "HK", "query": "affordable"},
        ).json()
        assert len(discovery["creators"]) == 3
        briefing = client.post(BASE + "/demo/campaign-briefs", json=BRIEF)
        assert briefing.status_code == 200, briefing.text
        assert briefing.headers["cache-control"] == "no-store"
        found = briefing.json()
        assert found["retrieval"] == "character_tfidf"
        assert found["plan"]["selected"] == ["a", "b"]
        assert found["plan"]["total_minor"] == 6000
        candidates = {entry["creator_id"]: entry for entry in found["recommendations"]}
        assert len(candidates["a"]["evidence"]) == 1
        assert (
            candidates["a"]["evidence"][0]["content"]["evidence"]["origin"]
            == "synthetic"
        )
        assert candidates["a"]["historical"]["interaction_rate"]["value"] == "0.05"
        assert (
            candidates["a"]["fee_per_thousand_historical_views_minor"]["value"]
            == "3000"
        )
        assert "confirmed_quote_unavailable" in candidates["c"]["limitations"]
        unsuitable = client.post(
            BASE + "/demo/campaign-briefs",
            json=BRIEF
            | {"minimum_market_share": "0.9", "category_labels": ["Family dining"]},
        ).json()
        assert unsuitable["plan"]["status"] == "infeasible"
        assert unsuitable["categories"] == {
            "source": "supplied",
            "labels": ["Family dining"],
        }
        compared = client.post(
            BASE + "/demo/creators/compare", json={"creator_ids": ["a", "missing"]}
        ).json()
        assert compared["state"] == "incomplete" and compared["unavailable_ids"] == [
            "missing"
        ]
        creator = client.get(BASE + "/demo/creators/a").json()
        assert creator["historical_by_platform"]["youtube"] == creator["historical"]
        assert (
            client.post(
                BASE + "/demo/scenarios",
                json={"currency": "HKD", "impressions": 1000, "click_rate": "0.1"},
            ).json()["clicks"]["value"]
            == "100.0"
        )
        assert (
            client.post(
                "/api/v1/marketing/intelligence-requests",
                json={"query": "YouTube research"},
            ).status_code
            == 403
        )

        with sessions.begin() as session:
            session.execute(
                update(DatasetRow)
                .where(DatasetRow.mode == "demo")
                .values(expires_at=func.now() - timedelta(seconds=1))
            )
        assert client.get(BASE + "/demo/creators").json()["state"] == "empty"
        Indexing(sessions, Config()).maintain()
        with sessions() as session:
            purged = session.scalar(select(DatasetRow).where(DatasetRow.mode == "demo"))
            assert (
                purged.state == "expired"
                and purged.payload is None
                and purged.grams is None
            )
        assert client.delete(partner_path, headers=OP).status_code == 204
        assert client.get(partner_path, headers=OP).json()["state"] == "withdrawn"
        assert client.put(partner_path, headers=OP, json=partner).status_code == 409
        assert (
            client.get(BASE + "/partner/creators", headers=CUSTOMER).json()["state"]
            == "empty"
        )


def test_index_reuses_unchanged_vectors_and_discards_withdrawn_claims(
    sessions, monkeypatch
):
    monkeypatch.setattr("backend.intelligence.indexing.embed", fixture_embeddings)
    indexer = Indexing(sessions, Config(model_dir=Path("fixture")))
    body = demo_body()
    indexer.ingest(DEMO, "batch", ImportDataset.model_validate(body))
    dispatch = []
    assert indexer.dispatch(lambda *args: dispatch.append(args))
    assert not indexer.dispatch(lambda *args: dispatch.append(args))
    indexer.execute(*dispatch.pop())
    original = indexer.snapshot(DEMO).datasets[0].vectors
    assert len(original) == 3
    original_text = next(item for item in body["records"] if item["id"] == "b-post")
    original_text["languages"] = ["en"]
    changed = indexer.ingest(DEMO, "batch", ImportDataset.model_validate(body))
    assert changed.state == "ready"
    assert not indexer.dispatch(lambda *args: dispatch.append(args))
    original_text["text"] += " original article"
    assert (
        indexer.ingest(DEMO, "batch", ImportDataset.model_validate(body)).state
        == "lexical"
    )
    assert indexer.dispatch(lambda *args: dispatch.append(args))
    assert len(indexer.snapshot(DEMO).datasets[0].vectors) == 2

    def withdrawn(directory, texts):
        indexer.withdraw(DEMO, "batch")
        return fixture_embeddings(directory, texts)

    monkeypatch.setattr("backend.intelligence.indexing.embed", withdrawn)
    indexer.execute(*dispatch.pop())
    assert indexer.status(DEMO, "batch").state == "withdrawn"
    assert indexer.snapshot(DEMO).datasets == []
    assert indexer.snapshot(Scope("partner", WORKSPACE)).datasets == []


def test_real_dispatcher_indexes_after_restart(
    pg_engine,
    pg_url,
    pg_schema,
    broker_url,  # noqa: F811
    tmp_path,
):
    env = child_environment(pg_url, pg_schema, tmp_path) | {
        "CELERY_BROKER_URL": broker_url,
        "MARKETING_DEMO_ENABLED": "1",
        "MARKETING_OPERATOR_TOKEN": OPERATOR_TOKEN,
        "MARKETING_MODEL_DIR": "synthetic-index-fixture",
    }
    with server(env, tmp_path / "intelligence-api-first.log") as (_, client):
        result = client.put(
            f"{BASE}/operator/demo/datasets/restart", headers=OP, json=demo_body()
        )
        assert result.status_code == 200
        assert client.get(BASE + "/demo/processing").json()["state"] == "preparing"
    with (
        worker(
            env,
            tmp_path / "intelligence-worker.log",
            module="backend.tests.intelligence_worker",
        ) as process,
        dispatcher(env, tmp_path / "intelligence-dispatcher.log"),
        server(env, tmp_path / "intelligence-api-second.log") as (_, client),
    ):
        wait_for(
            lambda: client.get(BASE + "/demo/processing").json()["state"] == "ready",
            process,
            "Queued index was not built following restart",
            tmp_path / "intelligence-worker.log",
        )
        assert client.get(BASE + "/demo/processing").json()["indexed_datasets"] == 1
        result = client.post(BASE + "/demo/campaign-briefs", json=BRIEF).json()
        assert result["plan"]["selected"] == ["a", "b"]
        assert result["retrieval"] == "character_tfidf"
