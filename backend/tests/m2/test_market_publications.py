import csv
import io
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.api.app import create_app
from backend.application.execution import JobExecutor
from backend.core.evidence import LocalEvidenceStore
from backend.intelligence import market_catalog as catalog
from backend.intelligence import market_collection as collection
from backend.intelligence.market_models import MarketBatch, MarketSource
from backend.intelligence.market_sources import (
    SOURCES,
    PublisherError,
    nature_rows,
    video_rows,
)


def test_publication_rights_and_geography_are_per_work():
    now = datetime.now(UTC)

    class Source:
        def json(self, *args):
            valid = {
                "id": 12,
                "place_ids": [7613],
                "created_at": now.isoformat(),
                "license_code": "cc-by",
                "photos": [{"license_code": "cc0"}],
                "user": {"id": 1, "login": "publisher"},
                "taxon": {"name": "Aves", "iconic_taxon_name": "Aves"},
                "faves_count": 0,
            }
            return {
                "total_results": 5,
                "results": [
                    valid,
                    dict(valid, place_ids=[1]),
                    dict(valid, license_code="cc-by-nc"),
                    dict(valid, photos=[{"license_code": "cc-by-nc-sa"}]),
                    dict(valid, user={"login": "invalid/profile"}),
                ],
            }, {}

    [row] = nature_rows(Source(), now, sample=True)
    assert row["metrics"] == [
        {"key": "favorites", "label": "Observation favorites", "value": 0}
    ]
    assert row["profile_url"] == "https://www.inaturalist.org/people/publisher"
    assert "location" not in row

    class Videos:
        def json(self, *args):
            item = {
                "uuid": "local",
                "name": "Hong Kong MTR",
                "channel": {
                    "url": "https://video.canadiancivil.com/video-channels/transit",
                    "displayName": "Transit",
                    "host": "video.canadiancivil.com",
                },
                "account": {
                    "host": "video.canadiancivil.com",
                    "url": "https://video.canadiancivil.com/accounts/publisher",
                    "displayName": "Publisher",
                },
                "url": "https://video.canadiancivil.com/videos/watch/local",
                "publishedAt": now.isoformat(),
                "isLocal": True,
                "nsfw": False,
                "privacy": {"id": 1},
                "licence": {"id": 1},
                "views": 12,
                "likes": 0,
            }
            return {
                "total": 4,
                "data": [
                    item,
                    dict(item, isLocal=False),
                    dict(item, licence={"id": 3}),
                    dict(item, nsfw=True),
                ],
            }, {}

    [video] = video_rows(Videos(), now)
    assert [m["value"] for m in video["metrics"]] == [12, 0]


def test_market_generation_history_withdrawal_and_role_gates(
    sessions, pg_engine, tmp_path, monkeypatch
):
    key = "inaturalist"
    now = datetime.now(UTC)
    publication = dict(
        id="inat-a",
        creator_id=uuid4().hex,
        creator_name="Test Byline",
        profile_url="https://www.inaturalist.org/people/test",
        title="Test Hong Kong bird",
        attribution="Credited test record",
        credit_role="Observation author",
        excerpt=None,
        published_at=now.isoformat(),
        url="https://www.inaturalist.org/observations/10",
        topics=["Birds"],
        license_url="https://creativecommons.org/licenses/by/4.0/",
        metrics=[],
    )
    second = dict(publication, id="inat-b")
    entries = [publication, second]
    observations = []

    def load(reader, now, since=None, sample=False):
        observations.append((since, sample))
        return entries

    monkeypatch.setitem(SOURCES, key, replace(SOURCES[key], load=load))
    evidence = LocalEvidenceStore(tmp_path)
    assert collection.install(sessions, evidence, key) == "validated and scheduled"

    def due(full=False):
        with sessions.begin() as db:
            s = db.get(MarketSource, key)
            s.next_check = now - timedelta(seconds=1)
            if full:
                s.full_checked = None

    def finish_generation():
        with sessions() as db:
            s = db.get(MarketSource, key)
            ids = list(
                db.scalars(
                    select(MarketBatch.job_id).where(
                        MarketBatch.generation == s.generation
                    )
                )
            )
        for id_ in ids:
            JobExecutor(sessions, evidence).execute(id_)
        assert collection.publish(sessions, key)
        assert not collection.publish(sessions, key)

    assert collection.collect(sessions, key)
    finish_generation()
    assert catalog.search_activity(sessions)["total"] == 2
    entries[:] = [
        dict(
            publication,
            metrics=[
                {"key": "favorites", "label": "Observation favorites", "value": 5}
            ],
        )
    ]
    entries.append(dict(entries[0]))
    due()
    assert collection.collect(sessions, key)
    assert observations[-1][0] is not None
    assert not collection.publish(sessions, key)
    previous = catalog.creator_detail(sessions, publication["creator_id"])
    assert previous["activity_count"] == 2 and previous["measurements"] == []
    finish_generation()
    assert catalog.search_activity(sessions)["total"] == 2
    detail = catalog.creator_detail(sessions, publication["creator_id"])
    assert (
        detail["activity_count"] == 2
        and len(detail["measurements"]) == 1
        and detail["measurements"][0]["metrics"][0]["value"] == 5
    )
    due(True)
    assert collection.collect(sessions, key)
    finish_generation()
    assert catalog.search_activity(sessions)["total"] == 1
    assert catalog.overview(sessions)["platforms"][0]["measured_count"] == 1
    assert len(catalog.overview(sessions)["months"]) == 12

    monkeypatch.setenv("MARKETING_DEMO_ENABLED", "1")
    monkeypatch.setenv("MARKETING_PUBLIC_DEMO_DIRECTORY", "1")
    monkeypatch.setenv("MARKETING_PARTNER_WORKSPACE", "")
    with TestClient(
        create_app(engine=pg_engine, evidence_root=tmp_path),
        base_url="http://localhost",
    ) as client:
        home = "/api/v1/marketing/intelligence/"
        good = client.get(
            home + "demo/market/creators", params={"q": "香港觀鳥", "sort": "activity"}
        )
        assert good.status_code == 200 and good.json()["total"] == 1
        assert client.get(home + "partner/market/creators").status_code == 403
        assert client.get(home + "operator/market/sources").status_code in (
            401,
            403,
            503,
        )

    from test_company_workspaces import BASE, DRAFT

    monkeypatch.setenv("MARKETING_PILOT_PASSWORD", "controlled-local-installation")
    monkeypatch.setenv("HARBOURLINE_SELF_REGISTRATION", "1")
    with TestClient(
        create_app(engine=pg_engine, evidence_root=tmp_path),
        base_url="http://localhost",
    ) as company:
        account = company.post(
            BASE + "/register",
            json={
                "username": "rate-worksheet",
                "password": "controlled-qa-login",
                "name": "Test company",
            },
        )
        assert account.status_code == 201
        campaign = BASE + "/campaigns/" + str(uuid4())
        saved = company.put(
            campaign,
            json={
                "version": 0,
                "draft": {
                    **DRAFT,
                    "market_leads": [publication["creator_id"], uuid4().hex],
                },
            },
        )
        assert saved.status_code == 200
        download = company.get(campaign + "/rate-request?version=1")
        assert download.status_code == 200
        sheet = list(csv.reader(io.StringIO(download.content.decode("utf-8-sig"))))
        assert ["Unavailable or withdrawn leads omitted", "1"] in sheet
        work = dict(zip(sheet[-2], sheet[-1], strict=True))
        assert work["Source"] == publication["url"]
        assert work["Attribution"] == "Credited test record"
        assert work["Credited role"] == "Observation author"
        assert work["Availability"] == work["Fee (HKD)"] == ""
        assert company.get(campaign + "/rate-request?version=0").status_code == 409
        company_cookies = company.cookies

    def denied(*args, **kwargs):
        raise PublisherError("publisher_access_blocked")

    monkeypatch.setitem(SOURCES, key, replace(SOURCES[key], load=denied))
    due()
    assert not collection.collect(sessions, key)
    assert catalog.source_status(sessions, key)["state"] == "review_required"
    assert catalog.search_activity(sessions)["total"] == 0
    assert collection.install(sessions, evidence, key) == "operator decision preserved"
    collection.withdraw(sessions, key)
    assert catalog.source_status(sessions, key)["state"] == "revoked"
    with TestClient(
        create_app(engine=pg_engine, evidence_root=tmp_path),
        base_url="http://localhost",
        cookies=company_cookies,
    ) as company:
        assert company.get(campaign + "/rate-request?version=1").status_code == 409
    assert collection.install(sessions, evidence, key) == "operator decision preserved"


def test_television_requires_verified_presenter_and_does_not_equate_street_food_to_price():
    from backend.intelligence.market_television import food_programmes

    now = datetime.now(UTC)
    show = dict(
        id=1,
        name="Hong Kong kitchen",
        genres=["Food"],
        type="Reality",
        summary="Chef Ada leads a series on street food.",
        url="https://www.tvmaze.com/shows/1/hong-kong-kitchen",
        officialSite="https://broadcaster.invalid/show",
    )
    host = dict(
        person=dict(id=2, name="Ada", url="https://www.tvmaze.com/people/2/ada"),
        character={"name": "Presenter"},
    )
    actor = dict(
        person=dict(
            id=3, name="Uncredited", url="https://www.tvmaze.com/people/3/test"
        ),
        character={"name": "Visitor"},
    )
    fresh = dict(
        id=4,
        name="Episode 1",
        airdate=now.date().isoformat(),
        airstamp=now.isoformat(),
        url="https://www.tvmaze.com/episodes/4/test",
        summary="<p>Traditional street food in Kowloon.</p>",
    )

    class LiveFormat:
        def json(self, url, arg):
            if url.endswith("/cast"):
                return [host, actor], {}
            if url.endswith("/episodes"):
                return [
                    fresh,
                    dict(fresh, id=5, airdate="2001-01-15"),
                    dict(fresh, id=6, summary=None),
                ], {}
            return [dict(show=show), dict(show=dict(show, id=13, type="Scripted"))], {}

    hits = list(food_programmes(LiveFormat(), now))
    assert [v["creator_name"] for v in hits] == ["Ada", "Ada"]
    assert [v["excerpt_scope"] for v in hits] == [
        "Episode synopsis",
        "Series description",
    ]
    assert all(
        v["credit_role"] == "Series presenter"
        and v["metrics"] == []
        and v["affordability_evidence"] is None
        for v in hits
    )
    assert hits[0]["license_url"] == "https://creativecommons.org/licenses/by-sa/4.0/"


def test_related_dining_preserves_price_gap_and_requested_scope():
    calls = []

    def find(sessions, **filters):
        calls.append(filters)
        return {"items": [{"name": "Source-credited guest"}], "total": 1}

    result = catalog.related_dining(
        {"total": 0, "items": []},
        "香港平價美食",
        "Television · TVmaze",
        None,
        find,
        None,
    )
    assert result["total"] == 0 and result["items"] == []
    assert result["related"]["basis"] == "dining_coverage_without_price_evidence"
    assert calls == [
        {
            "q": "food",
            "platform": "Television · TVmaze",
            "topic": "Dining",
            "page_size": 3,
        }
    ]
    assert "related" not in catalog.related_dining(
        {"total": 0}, "skincare", None, None, find, None
    )
    assert "related" not in catalog.related_dining(
        {"total": 1}, "affordable dining", None, None, find, None
    )
