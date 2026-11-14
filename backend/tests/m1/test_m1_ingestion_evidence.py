from hashlib import sha256

import pytest

from backend.core.contracts import CandidateRecord, SourcePosition
from backend.core.evidence import EvidenceError, LocalEvidenceStore
from backend.core.ingestion import ingest
from backend.core.inputs import CapturedInput
from backend.core.profiles import ProfileRepository


def candidates(*payloads):
    return [
        CandidateRecord(
            source_position=SourcePosition(kind="csv_row", index=line), payload=payload
        )
        for line, payload in enumerate(payloads, 2)
    ]


def test_shared_ingestion_preserves_reasons_and_uses_first_valid_identity(csv_config):
    records = candidates(
        {"key": "a1", "title": "", "count": 4, "active": False},
        {"key": "a1", "title": "Trail", "count": "04", "active": "False"},
        {"key": "a1", "title": "Different text", "count": 5, "active": True},
        {"key": "b1", "title": "Other", "count": True, "active": "maybe"},
        {"key": "b1", "title": "Other", "count": "not an int", "active": True},
    )
    result = ingest(records, csv_config.record_schema, "test-source")
    assert len(result.valid) == 1
    assert result.valid[0].payload == {
        "key": "a1",
        "title": "Trail",
        "count": 4,
        "active": False,
        "note": None,
    }
    assert [entry.source_position.index for entry in result.invalid] == [2, 5, 6]
    assert [problem.code for problem in result.invalid[1].problems] == [
        "wrong_type",
        "wrong_type",
    ]
    assert result.invalid[0].problems[0].field == "title"
    assert result.invalid[0].problems[0].code == "required_field"
    assert result.duplicates[0].source_position.index == 4


def test_identity_fallback_is_canonical_and_source_scoped(csv_config):
    first, second = candidates(
        {"title": " Trail ", "count": "004", "active": "true"},
        {"active": True, "count": 4, "title": "Trail", "note": None},
    )
    same_source = ingest([first, second], csv_config.record_schema, "source-a")
    repeat = ingest([second, first], csv_config.record_schema, "source-a")
    other_source = ingest([second], csv_config.record_schema, "source-b")
    assert len(same_source.valid) == len(same_source.duplicates) == 1
    assert same_source.valid[0].source_key is None
    assert (
        same_source.valid[0].record_id
        == repeat.valid[0].record_id
        != other_source.valid[0].record_id
    )


def test_typed_payload_rejects_unknown_fields_and_nonfinite_text(csv_config):
    data = csv_config.record_schema.model_dump()
    next(field for field in data["fields"] if field["name"] == "count")[
        "value_type"
    ] = "number"
    schema = type(csv_config.record_schema).model_validate(data)
    result = ingest(
        candidates({"title": "Trail", "count": "1e999", "active": True, "other": "x"}),
        schema,
        "source",
    )
    assert [
        (problem.code, problem.field) for problem in result.invalid[0].problems
    ] == [("unexpected_field", "other"), ("wrong_type", "count")]


def test_evidence_roundtrip_shared_link_and_no_overwrite(
    tmp_path, csv_source, csv_config
):
    repository = ProfileRepository()
    repository.register_source(csv_source)
    profile = repository.create_draft(csv_source.source_id, csv_config)
    store = LocalEvidenceStore(tmp_path / "evidence")
    document = CapturedInput(b"Name,Count,Active\r\nTrail,4,true\r\n", "listing-sample")
    first = store.save(document, profile, "run-one")
    second = store.save(document, profile, "run-two")
    assert first.evidence_id != second.evidence_id
    assert (
        first.content_hash == second.content_hash == sha256(document.body).hexdigest()
    )
    assert first.captured_at == document.captured_at
    assert first.config_hash == profile.config_hash
    assert first.profile_version_id == profile.profile_version_id
    assert store.resolve(first.evidence_id) == (first, document.body)
    assert store.resolve(second.evidence_id) == (second, document.body)

    processing = ingest(
        candidates(
            {"title": "Trail", "count": 4, "active": True},
            {"title": "Walk", "count": 5, "active": False},
        ),
        csv_config.record_schema,
        csv_source.source_id,
    )
    records = processing.records(csv_config.record_schema, first)
    assert {record.evidence_reference for record in records} == {first.evidence_id}
    assert {record.provenance.run_id for record in records} == {"run-one"}
    assert [record.source_position.index for record in records] == [2, 3]
    assert records[0].provenance.validation_status == "passed"


def test_evidence_missing_tampered_or_unsafe_reference(
    tmp_path, csv_source, csv_config
):
    repository = ProfileRepository()
    repository.register_source(csv_source)
    profile = repository.create_draft(csv_source.source_id, csv_config)
    store = LocalEvidenceStore(tmp_path / "evidence")
    with pytest.raises(EvidenceError, match="malformed"):
        store.resolve("../secret")
    with pytest.raises(EvidenceError, match="missing"):
        store.resolve("0" * 32)
    reference = store.save(
        CapturedInput(b"bytes", "listing-sample"), profile, "run-one"
    )
    content = store.root / reference.evidence_id / "input.bin"
    content.write_bytes(b"tampered")
    with pytest.raises(EvidenceError, match="hash"):
        store.resolve(reference.evidence_id)
    content.unlink()
    with pytest.raises(EvidenceError, match="missing"):
        store.resolve(reference.evidence_id)


def test_evidence_write_failure_is_structured(tmp_path, csv_source, csv_config):
    repository = ProfileRepository()
    repository.register_source(csv_source)
    profile = repository.create_draft(csv_source.source_id, csv_config)
    root = tmp_path / "occupied"
    root.write_bytes(b"not a directory")
    with pytest.raises(EvidenceError) as failure:
        LocalEvidenceStore(root).save(
            CapturedInput(b"csv", "listing-sample"), profile, "run-one"
        )
    assert failure.value.code == "evidence_write_failed"
