from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from backend.application.profiles import Profiles
from backend.core.profiles import ProfileError
from backend.persistence.database import session_factory
from backend.persistence.profiles import ProfileStorage


def test_source_and_version_round_trip(pg_engine, csv_source, config):
    first = Profiles(session_factory(pg_engine))
    first.register_source(csv_source)
    source_id = UUID(csv_source.source_id)
    draft = first.create_draft(source_id, config)
    pg_engine.dispose()
    restarted = Profiles(session_factory(pg_engine))
    assert restarted.get_source(source_id) == csv_source
    assert restarted.get_version(source_id, UUID(draft.profile_version_id)) == draft
    assert draft.config_hash == config.config_hash()
    with pytest.raises(ProfileError, match="does not exist"):
        restarted.get_version(uuid4(), UUID(draft.profile_version_id))


def test_version_constraints(sessions, csv_source, config):
    profiles = Profiles(sessions)
    profiles.register_source(csv_source)
    draft = profiles.create_draft(UUID(csv_source.source_id), config)
    with pytest.raises(IntegrityError) as duplicate, sessions.begin() as session:
        ProfileStorage(session).add_profile(
            draft.model_copy(update={"profile_version_id": uuid4().hex})
        )
    assert duplicate.value.orig.diag.constraint_name == "uq_profile_source_version"

    with pytest.raises(IntegrityError) as invalid, sessions.begin() as session:
        ProfileStorage(session).add_profile(
            draft.model_copy(
                update={"source_id": uuid4().hex, "profile_version_id": uuid4().hex}
            )
        )
    assert invalid.value.orig.sqlstate == "23503"


def test_concurrent_draft_creation(sessions, csv_source, config):
    profiles = Profiles(sessions)
    profiles.register_source(csv_source)
    source_id = UUID(csv_source.source_id)
    with ThreadPoolExecutor(max_workers=2) as pool:
        versions = list(
            pool.map(lambda _: profiles.create_draft(source_id, config), range(2))
        )
    assert sorted(item.version for item in versions) == [1, 2]
