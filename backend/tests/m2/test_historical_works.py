import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.api.app import create_app
from backend.application.execution import JobExecutor
from backend.core.evidence import LocalEvidenceStore
from backend.intelligence import commons_works, public_feed, work_search
from backend.intelligence.install_public_research import install
from backend.persistence.models import RecordRow

PUBLIC = "/api/v1/marketing/intelligence/public-research/works"
PARTNER = "/api/v1/marketing/intelligence/partner/public-works"


def test_works_require_permission_credit_date_and_approved_image_location():
    page = dict(
        ns=6,
        pageid=96222071,
        lastrevid=11,
        title="File:Hong Kong dish.jpg",
        imageinfo=[
            {
                "mime": "image/jpeg",
                "thumburl": "https://unknown.invalid/x.jpg",
                "extmetadata": {
                    k: {"value": v}
                    for k, v in {
                        "Artist": '<a title="User:Example" href="//commons.wikimedia.org/wiki/User:Example">Example</a>',
                        "Credit": "Own work",
                        "ImageDescription": {
                            "en": "Hong Kong food",
                            "zh-hant": "香港美食",
                        },
                        "DateTimeOriginal": "2020-01-02",
                        "LicenseUrl": "https://creativecommons.org/licenses/by/4.0/",
                        "LicenseShortName": "CC BY 4.0",
                    }.items()
                },
            }
        ],
    )
    checked = datetime.now(UTC)
    sample = commons_works.normalize(page, checked)
    assert sample["local_excerpt"] == "香港美食" and sample["thumbnail_url"] is None
    for field, value in (
        ("LicenseUrl", "https://creativecommons.org/licenses/by-nc/4.0/"),
        ("DateTimeOriginal", "unknown"),
        ("Artist", "unknown uploader"),
        ("Restrictions", "restricted"),
        ("NonFree", "yes"),
    ):
        meta = page["imageinfo"][0]["extmetadata"]
        saved = meta.get(field)
        meta[field] = {"value": value}
        assert commons_works.normalize(page, checked) is None
        if saved:
            meta[field] = saved
        else:
            del meta[field]
    assert (
        commons_works.normalize(
            dict(page, templates=[{"title": "Template:Delete"}]), checked
        )
        is None
    )


def test_public_historical_work_lifecycle(sessions, pg_engine, tmp_path, monkeypatch):
    captured = datetime.now(UTC)
    bundled = json.loads(
        Path(commons_works.__file__)
        .with_name("commons-works.json")
        .read_text(encoding="utf-8")
    )["records"]
    monkeypatch.setattr(commons_works, "release_snapshot", lambda: (captured, bundled))
    monkeypatch.setattr(
        commons_works, "acquire", lambda: [r for r in bundled if r["name"] == "N509FZ"]
    )
    spec = commons_works.feed()
    evidence = LocalEvidenceStore(tmp_path)
    assert install(sessions, evidence, spec) == "validated and scheduled"
    with sessions() as session:
        job = session.get(public_feed.DirectoryRow, spec.row_id).pending
    assert work_search.snapshot(sessions).state == "unavailable"
    JobExecutor(sessions, evidence).execute(job)
    monkeypatch.setenv("MARKETING_PUBLIC_DEMO_DIRECTORY", "1")
    monkeypatch.setenv("MARKETING_DEMO_ENABLED", "1")
    monkeypatch.setenv("MARKETING_PARTNER_WORKSPACE", "")
    with TestClient(
        create_app(engine=pg_engine, evidence_root=tmp_path),
        base_url="http://localhost",
    ) as client:

        def results(q):
            response = client.get(PUBLIC, params={"q": q})
            assert (
                response.status_code == 200
                and response.headers["cache-control"] == "no-store"
            )
            return response.json()["contributors"]

        assert client.get(PARTNER).status_code == 403
        leads = results("Hong Kong creators covering affordable local dining")
        assert [r["name"] for r in leads] == [
            "N509FZ",
            "JamezKinaLoon V802",
            "Ilya Yakubovich",
            "See-ming Lee",
        ]
        assert results("香港平價美食") == leads
        assert all(r["match_basis"] == "historical_cost" for r in leads)
        assert all(
            r["campaign_quote"] is None
            and r["audience"] is None
            and r["performance"] is None
            for r in leads
        )
        (meatball,) = [w for w in leads[0]["matched_works"] if w["id"] == "96222071"]
        assert (
            meatball["excerpt"] == "Sold for HKD17."
            and meatball["date"] == "2018-09-08"
        )
        assert (
            meatball["thumbnail_url"]
            and meatball["text_license_url"]
            and UUID(meatball["record_id"])
        )
        assert sorted(
            w["id"] for r in results("meals under HK$33") for w in r["matched_works"]
        ) == ["153237769", "96222071"]
        menu = next(c for c in leads if c["name"] == "JamezKinaLoon V802")[
            "matched_works"
        ][0]
        assert (
            menu["date"] == "2024-09-26"
            and "HK$25" in menu["visual_evidence"]["interpretation"]
        )
        assert (
            commons_works.menu_observation(
                153237769, {"sha1": "replacement"}, leads[1]["profile_url"]
            )
            is None
        )
        assert results("Cantonese-speaking creator age 18 to 24") == []
        assert results("quantum cryptography") == []
        assert any(lead["name"] == "Mk2010" for lead in results("茶餐廳"))
        for name, platform in (
            ("See-ming Lee", "Flickr"),
            ("Ilya Yakubovich", "500px"),
        ):
            source = results(name)[0]["matched_works"][0]
            assert (
                platform == source["platform"]
                and source["archive_url"] != source["original_url"]
            )
    public_feed.refresh(sessions, spec)
    assert work_search.snapshot(sessions).state == "unavailable"
    with sessions() as session:
        replacement = session.get(public_feed.DirectoryRow, spec.row_id).pending
    JobExecutor(sessions, evidence).execute(replacement)
    assert [c.name for c in work_search.snapshot(sessions).contributors] == ["N509FZ"]
    with sessions.begin() as session:
        for row in session.scalars(
            select(RecordRow).where(RecordRow.job_id == replacement)
        ):
            row.payload = dict(
                row.payload, checked=(captured - timedelta(days=8)).isoformat()
            )
    assert work_search.snapshot(sessions).state == "expired"

    from backend.application.profiles import Profiles

    with sessions() as session:
        source_id = session.get(public_feed.DirectoryRow, spec.row_id).source_id
    Profiles(sessions).set_authorization(source_id, "revoked")
    assert work_search.snapshot(sessions).contributors == []
    assert install(sessions, evidence, spec) == "operator decision preserved"
    profiles = Profiles(sessions)
    review = public_feed.prepare(profiles, evidence, spec)
    public_feed.refresh(sessions, spec)
    assert work_search.snapshot(sessions).state == "unavailable"
    with sessions() as session:
        held = session.get(public_feed.DirectoryRow, spec.row_id)
        assert held.pending is None and held.error == "directory_review_required"
    public_feed.activate(
        sessions,
        profiles,
        review["source_id"],
        review["profile_id"],
        review["report_id"],
        spec,
        approver="Test operator",
    )
    from backend.marketing.store import MarketingError

    def blocked():
        raise MarketingError(503, "directory_source_blocked", "Access declined")

    from dataclasses import replace

    public_feed.refresh(sessions, replace(spec, acquire=blocked))
    assert install(sessions, evidence, spec) == "operator decision preserved"
    assert work_search.snapshot(sessions).state == "unavailable"
    with sessions() as session:
        assert (
            session.get(public_feed.DirectoryRow, spec.row_id).error
            == "directory_source_blocked"
        )
