from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from backend.core.contracts import (
    CollectionError,
    CsvMappingConfiguration,
    ExtractionConfiguration,
    ProfileValidationReport,
    Source,
)
from backend.core.profiles import ProfileError, ProfileRepository


def web_config(**updates):
    values = {
        "config_schema_version": "1",
        "record_schema": {
            "record_type": "listing",
            "schema_version": "1",
            "fields": [{"name": "title"}, {"name": "key", "required": False}],
            "identity_field": "key",
        },
        "selector_type": "css",
        "item_selector": "article",
        "fields": [
            {"name": "title", "selector": "h2"},
            {
                "name": "key",
                "selector": ".",
                "selector_type": "xpath",
                "mode": "attribute",
                "attribute": "data-key",
            },
        ],
    }
    return ExtractionConfiguration.model_validate({**values, **updates})


def source(**updates):
    return Source.model_validate(
        {
            "source_id": "fixtures",
            "source_name": "Controlled listings",
            "adapter_type": "web",
            "allowed_origins": ["http://127.0.0.1:8001"],
            "permission_reference": "fixture-owned",
            "approval_status": "approved",
            **updates,
        }
    )


@pytest.fixture
def repository():
    repo = ProfileRepository()
    repo.register_source(source())
    return repo


def validation(repo, draft, **updates):
    report = ProfileValidationReport(
        report_id="report-1",
        profile_version_id=draft.profile_version_id,
        config_hash=draft.config_hash,
        sample_hash="a" * 64,
        valid_count=1,
        validated_at=datetime.now(UTC),
        **updates,
    )
    repo._save_validation(draft, report)
    return report


@pytest.mark.parametrize(
    "updates",
    [
        {"item_selector": ""},
        {"fields": []},
        {"selector_type": "regex"},
        {"adapter_type": "unsupported"},
        {"config_schema_version": "2"},
        {
            "record_schema": {
                "record_type": "listing",
                "schema_version": "2",
                "fields": [{"name": "title"}],
            }
        },
        {"fields": [{"name": "title", "selector": "a", "mode": "attribute"}]},
    ],
)
def test_configuration_rejects_invalid_contract(updates):
    with pytest.raises(ValidationError):
        web_config(**updates)


@pytest.mark.parametrize(
    "origin",
    [
        "http://example.invalid:80",
        "http://localhost:80",
        "http://127.0.0.1",
        "http://127.0.0.1:080",
        "http://user@127.0.0.1:80",
        "https://127.0.0.1:80",
        "http://127.0.0.1:80/path",
        "http://127.0.0.1:80\\x",
    ],
)
def test_source_rejects_noncanonical_or_non_loopback_origins(origin):
    with pytest.raises(ValidationError):
        source(allowed_origins=[origin])


def test_unsupported_adapter_rejected():
    with pytest.raises(ValidationError):
        source(adapter_type="browser")


def test_configuration_hash_ignores_mapping_order():
    original = web_config()
    values = original.model_dump()
    values["fields"] = values["fields"][::-1]
    values["fields"][0]["selector_type"] = "css"
    values["record_schema"]["fields"] = values["record_schema"]["fields"][::-1]
    equivalent = ExtractionConfiguration.model_validate(values)
    assert equivalent.model_dump_json() == original.model_dump_json()
    assert equivalent.config_hash() == original.config_hash()
    assert web_config(item_selector="section").config_hash() != original.config_hash()


def test_csv_mapping_must_cover_schema():
    with pytest.raises(ValidationError, match="cover each schema field"):
        CsvMappingConfiguration(
            config_schema_version="1",
            record_schema=web_config().record_schema,
            columns=[{"name": "title", "column": "Title"}],
        )


def test_draft_edit_invalidates_validation_and_keeps_version(repository):
    draft = repository.create_draft("fixtures", web_config())
    report = validation(repository, draft)
    edited = repository.edit_draft(
        draft.profile_version_id, web_config(item_selector="section")
    )
    assert edited.version == draft.version == 1
    assert edited.config_hash != report.config_hash
    with pytest.raises(ProfileError, match="current validation"):
        repository.approve(
            edited.profile_version_id, approver="operator", report_id=report.report_id
        )
    with pytest.raises(ProfileError, match="changed during validation"):
        repository._save_validation(draft, report)


def test_preview_snapshot_does_not_approve(repository):
    draft = repository.create_draft("fixtures", web_config())
    snapshot, _ = repository.draft_for_preview(draft.profile_version_id)
    assert snapshot.approval_status == "draft"
    with pytest.raises(ProfileError, match="approved profile"):
        repository.approved_for_run(draft.profile_version_id)


def test_invalid_validation_cannot_approve(repository):
    draft = repository.create_draft("fixtures", web_config())
    report = validation(
        repository,
        draft,
        error=CollectionError(code="bad_selector", message="Invalid selector"),
    )
    with pytest.raises(ProfileError, match="passing validation"):
        repository.approve(
            draft.profile_version_id, approver="operator", report_id=report.report_id
        )


def test_source_access_revocation_blocks_approval_and_run(repository):
    draft = repository.create_draft("fixtures", web_config())
    report = validation(repository, draft)
    repository.set_source_authorization(source(approval_status="revoked"))
    with pytest.raises(ProfileError, match="not authorized"):
        repository.approve(
            draft.profile_version_id, approver="operator", report_id=report.report_id
        )
    repository.set_source_authorization(source())
    approved = repository.approve(
        draft.profile_version_id, approver="operator", report_id=report.report_id
    )
    repository.set_source_authorization(source(approval_status="revoked"))
    with pytest.raises(ProfileError, match="not authorized"):
        repository.approved_for_run(approved.profile_version_id)


def test_approval_is_explicit_immutable_and_retirement_preserves_snapshot(repository):
    draft = repository.create_draft("fixtures", web_config())
    report = validation(repository, draft)
    assert repository.get_version(draft.profile_version_id).approval_status == "draft"
    with pytest.raises(ProfileError, match="explicit approver"):
        repository.approve(
            draft.profile_version_id, approver=" ", report_id=report.report_id
        )
    approved = repository.approve(
        draft.profile_version_id, approver="operator", report_id=report.report_id
    )
    assert approved.approved_by == "operator"
    assert approved.validation_report_id == report.report_id
    with pytest.raises(ValidationError, match="frozen"):
        approved.configuration.fields[0].selector = "aside"
    with pytest.raises(ProfileError, match="Only draft"):
        repository.edit_draft(
            approved.profile_version_id, web_config(item_selector="aside")
        )
    second = repository.create_draft("fixtures", web_config(item_selector="section"))
    assert second.version == 2
    assert repository.approved_for_run(approved.profile_version_id)[0] == approved
    retired = repository.retire(approved.profile_version_id)
    assert retired.config_hash == approved.config_hash
    assert retired.approved_at == approved.approved_at
    with pytest.raises(ProfileError, match="approved profile"):
        repository.approved_for_run(retired.profile_version_id)
