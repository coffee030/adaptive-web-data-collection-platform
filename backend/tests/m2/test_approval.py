from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, update
from sqlalchemy.exc import IntegrityError

from backend.application.profiles import Profiles
from backend.core.evidence import LocalEvidenceStore
from backend.core.inputs import CsvInput
from backend.core.profiles import ProfileError
from backend.core.runner import CollectionRunner
from backend.persistence.models import ProfileRow


@pytest.fixture
def draft_context(sessions, csv_source, config, tmp_path):
    profiles = Profiles(sessions)
    profiles.register_source(csv_source)
    source = UUID(csv_source.source_id)
    draft = profiles.create_draft(source, config)
    return (
        profiles,
        source,
        UUID(draft.profile_version_id),
        config,
        LocalEvidenceStore(tmp_path),
    )


def report_for(context, content=b"Name,Count\nAlpha,2\n"):
    profiles, source, version, _, evidence = context
    return profiles.validate(source, version, CsvInput("listings", content), evidence)


def approve(context, report, **changes):
    profiles, source, version, _, _ = context
    args = {
        "approver": "operator",
        "report_id": UUID(report.report_id),
        "config_hash": report.config_hash,
    }
    return profiles.approve(source, version, **(args | changes))


def test_approval_and_retirement_persist(draft_context, sessions, pg_engine):
    report = report_for(draft_context)
    profile = approve(draft_context, report)
    assert profile.approved_by == "operator"
    assert profile.approved_at.utcoffset().total_seconds() == 0
    assert profile.validation_report_id == report.report_id
    pg_engine.dispose()
    _, source, version, config, _ = draft_context
    restarted = Profiles(sessions)
    assert restarted.get_version(source, version) == profile
    with pytest.raises(ProfileError, match="Only draft"):
        restarted.edit_draft(source, version, config)
    with pytest.raises(IntegrityError), sessions.begin() as session:
        session.execute(
            update(ProfileRow)
            .where(ProfileRow.id == version)
            .values(config_hash="0" * 64)
        )
    retired = restarted.retire(source, version)
    assert restarted.get_version(source, version) == retired
    assert retired.approval_status == "retired"
    assert retired.config_hash == profile.config_hash


def test_requires_current_passing_report(draft_context):
    profiles, source, version, config, _ = draft_context
    with pytest.raises(ProfileError, match="current validation report"):
        profiles.approve(
            source,
            version,
            approver="operator",
            report_id=uuid4(),
            config_hash=config.config_hash(),
        )
    failed = report_for(draft_context, b"Name,Count\nAlpha,not-a-number\n")
    assert not failed.passed
    with pytest.raises(ProfileError, match="passing validation report"):
        approve(draft_context, failed)
    passing = report_for(draft_context)
    with pytest.raises(ProfileError, match="current configuration hash"):
        approve(draft_context, passing, config_hash="0" * 64)
    profiles.edit_draft(source, version, config, expected_revision=1)
    with pytest.raises(ProfileError, match="current validation report"):
        approve(draft_context, passing)
    replaced = report_for(draft_context)
    latest = report_for(draft_context)
    with pytest.raises(ProfileError, match="current validation report"):
        approve(draft_context, replaced)
    profiles.set_authorization(source, "revoked")
    with pytest.raises(ProfileError, match="access is not authorized"):
        approve(draft_context, latest)


def test_concurrent_approvals(draft_context):
    report = report_for(draft_context)

    def attempt(index):
        try:
            return approve(
                draft_context, report, approver=f"operator-{index}"
            ).approved_by
        except ProfileError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(attempt, range(2)))
    assert outcomes.count("profile_not_draft") == 1
    profiles, source, version, _, _ = draft_context
    approved = profiles.get_version(source, version)
    assert approved.approved_by in outcomes
    with pytest.raises(ProfileError, match="Only draft"):
        approve(draft_context, report)


def test_validation_cannot_publish_after_concurrent_edit(draft_context, monkeypatch):
    profiles, source, version, config, _ = draft_context
    completed = Event()
    resume = Event()
    validate = CollectionRunner.validate

    def paused_validation(*args):
        report = validate(*args)
        completed.set()
        assert resume.wait(10)
        return report

    monkeypatch.setattr(CollectionRunner, "validate", paused_validation)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(report_for, draft_context)
        try:
            assert completed.wait(10)
            profiles.edit_draft(source, version, config, expected_revision=1)
        finally:
            resume.set()
        with pytest.raises(ProfileError, match="Draft changed"):
            future.result(timeout=10)


def test_approval_rollback_keeps_passing_report(draft_context, sessions):
    report = report_for(draft_context)
    profiles, source, version, _, _ = draft_context

    def fail_after_flush(*_):
        raise RuntimeError("forced rollback")

    event.listen(sessions, "after_flush", fail_after_flush)
    try:
        with pytest.raises(RuntimeError, match="forced rollback"):
            approve(draft_context, report)
    finally:
        event.remove(sessions, "after_flush", fail_after_flush)
    current = profiles.get_version(source, version)
    assert current.approval_status == "draft"
    assert current.approved_by is None
    assert approve(draft_context, report).approval_status == "approved"
