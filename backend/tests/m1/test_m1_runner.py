from hashlib import sha256

import pytest

from backend.core.contracts import ExtractionConfiguration, Source
from backend.core.evidence import LocalEvidenceStore
from backend.core.inputs import CsvInput, InputError, WebInput
from backend.core.profiles import ProfileError, ProfileRepository
from backend.core.runner import CollectionRunner


@pytest.fixture
def runner(tmp_path):
    return CollectionRunner(
        ProfileRepository(), LocalEvidenceStore(tmp_path / "evidence")
    )


@pytest.fixture
def web_source(runner, controlled_site):
    origin, _, _ = controlled_site
    source = Source(
        source_id="listing-web",
        source_name="Controlled fixture server",
        adapter_type="web",
        approval_status="approved",
        permission_reference="synthetic-fixture",
        allowed_origins=(origin,),
    )
    runner.profiles.register_source(source)
    return source


def approve(runner, source, config, entry):
    draft = runner.profiles.create_draft(source.source_id, config)
    report = runner.validate(draft.profile_version_id, entry)
    assert report.passed
    return runner.profiles.approve(
        draft.profile_version_id,
        approver="fixture operator",
        report_id=report.report_id,
    )


def test_css_cards_preview_validate_approve_run(
    runner, web_source, controlled_site, cards_config
):
    origin, requests, routes = controlled_site
    entry = WebInput(origin + "/redirect")
    draft = runner.profiles.create_draft(web_source.source_id, cards_config)
    rejected = runner.run(draft.profile_version_id, entry)
    assert rejected.status == "failed" and rejected.error.code == "profile_not_approved"
    assert requests == []
    preview = runner.preview(draft.profile_version_id, entry)
    assert len(preview) == 1 and preview[0].payload["title"] == "North Trail"
    assert (
        runner.profiles.get_version(draft.profile_version_id).approval_status == "draft"
    )
    with pytest.raises(ProfileError, match="current validation"):
        runner.profiles.approve(
            draft.profile_version_id, approver="operator", report_id="missing"
        )
    report = runner.validate(draft.profile_version_id, entry)
    assert report.passed and report.config_hash == draft.config_hash
    assert report.sample_hash == sha256(routes["/cards"][2]).hexdigest()
    approved = runner.profiles.approve(
        draft.profile_version_id, approver="operator", report_id=report.report_id
    )
    result = runner.run(approved.profile_version_id, entry)
    assert result.status == "completed" and len(result.records) == 1
    record = result.records[0]
    assert record.payload["link"] == origin + "/items/a1"
    assert record.source_record_key == "a1"
    assert record.source_position.index == 1
    evidence, body = runner.evidence.resolve(record.evidence_reference)
    assert evidence == result.evidence
    assert evidence.requested_location == origin + "/redirect"
    assert evidence.original_location == origin + "/cards"
    assert evidence.http_status == 200
    assert body == routes["/cards"][2]
    assert record.provenance.config_hash == evidence.config_hash == approved.config_hash
    assert runner.profiles.get_validation(approved.profile_version_id) == report


def test_xpath_table_reuses_core_with_two_records_and_shared_evidence(
    runner, web_source, controlled_site, table_config
):
    origin, _, _ = controlled_site
    entry = WebInput(origin + "/table")
    approved = approve(runner, web_source, table_config, entry)
    result = runner.run(approved.profile_version_id, entry)
    assert result.status == "completed"
    assert [record.payload["title"] for record in result.records] == [
        "River Walk",
        "Lake View",
    ]
    assert result.records[1].payload["note"] is None
    assert {record.evidence_reference for record in result.records} == {
        result.evidence.evidence_id
    }
    assert [record.source_position.kind for record in result.records] == [
        "html_item",
        "html_item",
    ]


def test_csv_same_ingestion_returns_valid_invalid_duplicate_and_evidence(
    runner, csv_source, csv_config, csv_import
):
    runner.profiles.register_source(csv_source)
    sample = CsvInput(
        "listing-sample", b"Key,Name,Count,Active\na1,North Trail,7,true\n"
    )
    approved = approve(runner, csv_source, csv_config, sample)
    first = runner.run(approved.profile_version_id, csv_import)
    repeat = runner.run(approved.profile_version_id, csv_import)
    assert first.status == repeat.status == "partial"
    assert [record.payload for record in first.records] == [
        {"key": "a1", "title": "North Trail", "count": 7, "active": True, "note": None},
        {
            "key": "a2",
            "title": "River Walk",
            "count": 3,
            "active": False,
            "note": "Open",
        },
    ]
    assert [record.record_id for record in first.records] == [
        record.record_id for record in repeat.records
    ]
    assert [record.source_position.index for record in first.records] == [2, 3]
    assert [record.source_position.kind for record in first.records] == [
        "csv_row",
        "csv_row",
    ]
    assert [issue.source_position.index for issue in first.invalid] == [5, 6, 7]
    assert [issue.problems[0].code for issue in first.invalid] == [
        "required_field",
        "wrong_type",
        "invalid_row",
    ]
    assert first.duplicates[0].source_position.index == 4
    record = first.records[1]
    evidence, raw = runner.evidence.resolve(record.evidence_reference)
    assert evidence.evidence_id != repeat.evidence.evidence_id
    assert evidence.original_location == csv_import.dataset_id
    assert raw == csv_import.content
    assert evidence.content_hash == sha256(csv_import.content).hexdigest()
    assert record.provenance.source_id == evidence.source_id == csv_source.source_id
    assert record.provenance.run_id == evidence.run_id == first.run_id
    assert (
        record.provenance.profile_version_id
        == evidence.profile_version_id
        == approved.profile_version_id
    )
    assert record.provenance.validation_status == "passed"


def test_new_draft_keeps_previous_run_references_and_retired_version_rejects(
    runner, web_source, controlled_site, cards_config, table_config
):
    origin, requests, _ = controlled_site
    entry = WebInput(origin + "/cards")
    first = approve(runner, web_source, cards_config, entry)
    first_run = runner.run(first.profile_version_id, entry)
    second = runner.profiles.create_draft(web_source.source_id, cards_config)
    old_report = runner.validate(second.profile_version_id, entry)
    edited = runner.profiles.edit_draft(second.profile_version_id, table_config)
    with pytest.raises(ProfileError, match="current validation"):
        runner.profiles.approve(
            edited.profile_version_id,
            approver="operator",
            report_id=old_report.report_id,
        )
    again = runner.run(first.profile_version_id, entry)
    assert first_run.records[0].record_id == again.records[0].record_id
    assert (
        first_run.records[0].provenance.config_hash
        == again.records[0].provenance.config_hash
        == first.config_hash
    )
    assert first_run.evidence.profile_version_id != edited.profile_version_id
    runner.profiles.retire(first.profile_version_id)
    count = len(requests)
    assert (
        runner.run(first.profile_version_id, entry).error.code == "profile_not_approved"
    )
    assert len(requests) == count
    assert (
        runner.evidence.resolve(first_run.evidence.evidence_id)[0] == first_run.evidence
    )


@pytest.mark.parametrize(
    ("endpoint", "code"),
    [
        ("/changed", "no_records"),
        ("/blocked", "access_blocked"),
        ("/error", "http_error"),
    ],
)
def test_run_failure_preserves_error_and_original_response(
    runner, web_source, controlled_site, cards_config, endpoint, code
):
    origin, _, routes = controlled_site
    approved = approve(runner, web_source, cards_config, WebInput(origin + "/cards"))
    result = runner.run(approved.profile_version_id, WebInput(origin + endpoint))
    assert (
        result.status == "failed" and result.error.code == code and not result.records
    )
    assert (
        runner.evidence.resolve(result.evidence.evidence_id)[1] == routes[endpoint][2]
    )


def test_invalid_profile_produces_validation_failure_with_no_approval(
    runner, web_source, controlled_site, cards_config
):
    origin, requests, _ = controlled_site
    config = ExtractionConfiguration.model_validate(
        {**cards_config.model_dump(), "item_selector": "["}
    )
    draft = runner.profiles.create_draft(web_source.source_id, config)
    entry = WebInput(origin + "/cards")
    with pytest.raises(InputError) as preview:
        runner.preview(draft.profile_version_id, entry)
    assert preview.value.error.code == "invalid_selector"
    report = runner.validate(draft.profile_version_id, entry)
    assert (
        not report.passed
        and report.error.code == "invalid_selector"
        and report.sample_hash
    )
    with pytest.raises(ProfileError, match="passing validation"):
        runner.profiles.approve(
            draft.profile_version_id, approver="operator", report_id=report.report_id
        )
    count = len(requests)
    assert (
        runner.run(draft.profile_version_id, entry).error.code == "profile_not_approved"
    )
    assert len(requests) == count


def test_all_invalid_records_return_structured_failed_result(
    runner, csv_source, csv_config
):
    runner.profiles.register_source(csv_source)
    approved = approve(
        runner,
        csv_source,
        csv_config,
        CsvInput("listing-sample", b"Name,Count,Active\nTrail,7,true\n"),
    )
    data = CsvInput("listing-import", b"Name,Count,Active\nTrail,many,true\n")
    result = runner.run(approved.profile_version_id, data)
    assert (
        result.status == "failed"
        and result.error.code == "no_valid_records"
        and not result.records
    )
    assert result.invalid[0].problems[0].code == "wrong_type"
    assert runner.evidence.resolve(result.evidence.evidence_id)[1] == data.content


def test_evidence_write_error_prevents_records(runner, csv_source, csv_config):
    runner.profiles.register_source(csv_source)
    data = CsvInput("listing-sample", b"Name,Count,Active\nTrail,7,true\n")
    approved = approve(runner, csv_source, csv_config, data)
    runner.evidence.root.write_bytes(b"not a directory")
    result = runner.run(approved.profile_version_id, data)
    assert result.status == "failed" and result.error.code == "evidence_write_failed"
    assert not result.records and result.evidence is None


def test_revoked_source_and_unapproved_dataset_are_rejected(
    runner, csv_source, csv_config
):
    runner.profiles.register_source(csv_source)
    data = CsvInput("listing-sample", b"Name,Count,Active\nTrail,7,true\n")
    approved = approve(runner, csv_source, csv_config, data)
    other = runner.run(approved.profile_version_id, CsvInput("unknown", data.content))
    assert other.error.code == "dataset_not_allowed" and other.evidence is None
    mismatch = runner.run(approved.profile_version_id, WebInput("http://127.0.0.1:1"))
    assert mismatch.error.code == "input_adapter_mismatch"
    runner.profiles.set_source_authorization(
        csv_source.model_copy(update={"approval_status": "revoked"})
    )
    result = runner.run(approved.profile_version_id, data)
    assert result.error.code == "source_not_approved" and result.evidence is None
