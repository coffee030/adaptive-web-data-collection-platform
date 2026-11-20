"""PostgreSQL tests use a disposable schema in an explicitly selected test database."""

import os
from contextlib import contextmanager
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import event

from backend.application.inputs import CsvEntry
from backend.application.jobs import Jobs
from backend.application.profiles import Profiles
from backend.core.contracts import CsvMappingConfiguration, Source
from backend.core.evidence import LocalEvidenceStore
from backend.persistence.database import make_engine, session_factory
from backend.persistence.models import EventRow

ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture
def pg_url():
    url = os.environ.get("M2_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set M2_TEST_DATABASE_URL to an isolated PostgreSQL test database")
    return url


@pytest.fixture
def pg_schema(pg_url):
    schema = f"m2_test_{uuid4().hex}"
    admin = make_engine(pg_url)
    with admin.begin() as connection:
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
    try:
        yield schema
    finally:
        with admin.begin() as connection:
            connection.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
        admin.dispose()


@pytest.fixture
def pg_engine(pg_url, pg_schema, request):
    engine = make_engine(pg_url)

    @event.listens_for(engine, "connect")
    def set_search_path(connection, _):
        connection.autocommit = True
        try:
            connection.execute(f'SET search_path TO "{pg_schema}"')
        finally:
            connection.autocommit = False

    try:
        config = Config(ROOT / "alembic.ini")
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            revision = getattr(request, "param", "head")
            command.upgrade(config, revision)
            if revision == "head":
                command.check(config)
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def sessions(pg_engine):
    return session_factory(pg_engine)


@pytest.fixture
def legacy_execution_events(monkeypatch):
    """Seed execution events using the columns available before revision 0010."""

    def write_event(session, job, kind, *, error=None):
        fields = {
            "id": uuid4(),
            "job_id": job.id,
            "status": job.status,
            "kind": kind,
            "execution_attempt": job.execution_attempt,
            "error": error.model_dump(mode="json") if error else None,
        }
        session.execute(EventRow.__table__.insert().values(**fields))
        return EventRow(**fields)

    @contextmanager
    def legacy_writer():
        with monkeypatch.context() as patch:
            patch.setattr(Jobs, "_add_event", staticmethod(write_event))
            yield

    return legacy_writer


@pytest.fixture
def csv_source():
    return Source(
        source_id=uuid4().hex,
        source_name="Controlled CSV",
        adapter_type="csv",
        permission_reference="fixture consent",
        approval_status="approved",
        allowed_datasets=("listings",),
    )


@pytest.fixture
def config():
    return CsvMappingConfiguration(
        config_schema_version="1",
        record_schema={
            "record_type": "listing",
            "schema_version": "1",
            "identity_field": "name",
            "fields": [{"name": "name"}, {"name": "count", "value_type": "integer"}],
        },
        columns=[
            {"name": "name", "column": "Name"},
            {"name": "count", "column": "Count"},
        ],
    )


@pytest.fixture
def job_setup(sessions, csv_source, config, tmp_path):
    profiles = Profiles(sessions)
    profiles.register_source(csv_source)
    source = UUID(csv_source.source_id)
    draft = profiles.create_draft(source, config)
    entry = CsvEntry(
        adapter_type="csv", dataset_id="listings", content="Name,Count\nAlpha,2\n"
    )
    return (
        profiles,
        source,
        UUID(draft.profile_version_id),
        entry,
        LocalEvidenceStore(tmp_path),
    )


def approve_job_profile(setup):
    profiles, source, version, entry, evidence = setup
    report = profiles.validate(source, version, entry.collection_input(), evidence)
    return profiles.approve(
        source,
        version,
        approver="operator",
        report_id=UUID(report.report_id),
        config_hash=report.config_hash,
    )
