"""Install only the two fixed public projections selected by the Harbourline launcher."""

from uuid import UUID

from sqlalchemy import select, text

from backend.application.profiles import Profiles
from backend.core.evidence import LocalEvidenceStore
from backend.marketing.store import MarketingError
from backend.persistence.database import (
    database_url,
    evidence_path,
    make_engine,
    session_factory,
)
from backend.persistence.models import SourceRow

from . import commons_works, public_directory, public_feed, market_collection
from .market_sources import SOURCES

MAPPINGS = {
    "hk-wikidata-creator-directory": "72565130ca0199f9b7489ba214c10f8a97882f5de7bbd66e7efdafb2c795df5a",
    "hk-commons-published-works": "fa6907c812a6a35dc37eedb0c9a05c1afeab726035f39045ba5e14e95b82e506",
}


def install(sessions, evidence, spec):
    if spec.config.config_hash() != MAPPINGS.get(spec.dataset):
        raise ValueError("The installed release does not authorize this mapping")
    profiles = Profiles(sessions)
    with sessions.begin() as guard:
        guard.execute(
            text("SELECT pg_advisory_xact_lock(:key)"), {"key": 726300 + spec.row_id}
        )
        existing = guard.get(public_feed.DirectoryRow, spec.row_id)
        if existing:
            return (
                "already configured"
                if public_feed.approved(guard, existing, spec)
                else "operator decision preserved"
            )
        source = guard.scalar(
            select(SourceRow).where(SourceRow.request_key == spec.key)
        )
        if source and (
            source.approval_status != "approved"
            or any(
                profile.approval_status == "retired"
                for profile, _ in profiles.list_versions(source.id)
            )
        ):
            return "operator decision preserved"
        info = public_feed.prepare(profiles, evidence, spec, restore=False)
        public_feed.activate(
            sessions,
            profiles,
            info["source_id"],
            info["profile_id"],
            UUID(info["report_id"]) if info["report_id"] else None,
            spec,
            approver="Harbourline release launcher (pinned public mapping)",
        )
    return "validated and scheduled"


def main():
    engine = make_engine(database_url())
    try:
        sessions = session_factory(engine)
        for key in SOURCES:
            try:
                result = market_collection.install(
                    sessions, LocalEvidenceStore(evidence_path()), key
                )
                print(f"Publisher research: {key}: {result}.")
            except MarketingError as error:
                print(f"Publisher research: {key}: unavailable ({error.code}).")
        for spec in (public_directory.feed(), commons_works.feed()):
            try:
                print(
                    f"Public research: {spec.name}: {install(sessions, LocalEvidenceStore(evidence_path()), spec)}."
                )
            except MarketingError as error:
                print(f"Public research: {spec.name}: unavailable ({error.code}).")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
