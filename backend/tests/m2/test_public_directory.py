from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select

from backend.application.execution import JobExecutor
from backend.application.profiles import Profiles
from backend.core.evidence import LocalEvidenceStore
from backend.intelligence import public_directory as library
from backend.persistence.models import RecordRow


def test_directory_projects_validated_records_and_honors_authorization(
    sessions, tmp_path, monkeypatch
):
    upstream = {
        "entities": {
            item: {
                "id": item,
                "type": "item",
                "lastrevid": 17,
                "labels": {
                    "en": {"value": f"Studio {item}"},
                    "zh-hk": {"value": "設計"},
                },
                "descriptions": {"en": {"value": "Hong Kong animation team"}},
                "claims": {"P3744": ["private counters"]},
            }
            for item in library.ITEMS
        }
    }
    rows = library.wikidata_rows(upstream)
    assert len(rows) == 11 and all("claims" not in row for row in rows)
    timestamp = datetime.now(UTC)
    monkeypatch.setattr(library, "release_snapshot", lambda: (timestamp, rows))
    monkeypatch.setattr(library, "acquire", lambda: rows[:2])
    profiles = Profiles(sessions)
    evidence = LocalEvidenceStore(tmp_path)
    preview = library.prepare(profiles, evidence)
    assert library.snapshot(sessions).profiles == []
    library.activate(
        sessions,
        profiles,
        preview["source_id"],
        preview["profile_id"],
        UUID(preview["report_id"]),
    )
    with sessions() as session:
        job = session.get(library.DirectoryRow, 1).pending
    JobExecutor(sessions, evidence).execute(job)
    initial = library.snapshot(sessions)
    assert len(initial.profiles) == 11 and initial.observed == timestamp
    library.refresh(sessions)
    with sessions() as session:
        pending = session.get(library.DirectoryRow, 1).pending
        assert pending != job
    JobExecutor(sessions, evidence).execute(pending)
    updated = library.snapshot(sessions)
    assert len(updated.profiles) == 2
    assert all(item.record_id and item.evidence_id for item in updated.profiles)
    assert library.search(updated, "設計", None).retrieval == "character_tfidf"
    with sessions.begin() as session:
        for row in session.scalars(
            select(RecordRow).where(RecordRow.job_id == pending)
        ):
            row.payload = dict(
                row.payload, checked=(timestamp - timedelta(days=8)).isoformat()
            )
    assert library.snapshot(sessions).state == "expired"
    profiles.set_authorization(preview["source_id"], "revoked")
    assert library.snapshot(sessions).state == "unavailable"
