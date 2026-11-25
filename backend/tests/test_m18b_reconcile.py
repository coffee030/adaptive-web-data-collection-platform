"""Check the offline reconciler against production CSV and JSON bytes."""

import csv
import io
import json

import pytest

from backend.application.record_export import encode_records
from backend.core.contracts import Contract
from backend.experiments.m18b_reconcile import compare


class ExampleRecord(Contract):
    record_id: str
    job_id: str = "job"
    source_id: str = "source"
    source_record_key: str | None
    payload: dict


@pytest.fixture
def exports():
    keys = {
        "protected": "-123",
        "ordinary": "publication",
        "literal": "'-123",
        "null": None,
    }
    records = [
        ExampleRecord(
            record_id=identity,
            source_record_key=key,
            payload={"nested": {"value": "-123", "items": ["'quote", None, 3]}},
        )
        for identity, key in keys.items()
    ]
    reference = [record.model_dump(mode="json") for record in records]
    fields = tuple(ExampleRecord.model_fields)
    csv_text = encode_records(records, fields, "csv").decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(csv_text, newline=""), strict=True))
    json_rows = json.loads(encode_records(records, fields, "json"))
    return reference, rows, json_rows


def test_reconcile_escaped_strings_nested_payload_and_nulls(exports):
    reference, csv_rows, json_rows = exports

    assert [row["source_record_key"] for row in csv_rows] == [
        "'-123",
        "publication",
        "'-123",
        "",
    ]
    assert json.loads(csv_rows[0]["payload"]) == reference[0]["payload"]
    assert json_rows == reference
    assert json_rows[0]["source_record_key"] == "-123"
    for rows, as_csv in ((csv_rows, True), (json_rows, False)):
        result = compare(rows, reference, as_csv=as_csv)
        assert not any(
            result[field]
            for field in ("missing", "extra", "repeated", "field_differences")
        )


@pytest.mark.parametrize(
    ("index", "field", "corrupt"),
    [
        (0, "source_record_key", "-123"),
        (0, "source_record_key", "'-456"),
        (1, "source_record_key", "'publication"),
        (2, "source_record_key", "''-123"),
        (0, "payload", '{"nested":{"value":"changed"}}'),
    ],
)
def test_reconcile_reports_corrupted_csv_cells(exports, index, field, corrupt):
    reference, csv_rows, _ = exports
    csv_rows[index][field] = corrupt

    result = compare(csv_rows, reference, as_csv=True)

    assert result["field_differences"] == {reference[index]["record_id"]: [field]}


@pytest.mark.parametrize("as_csv", [True, False])
def test_reconcile_reports_missing_extra_and_repeated_ids(exports, as_csv):
    reference, csv_rows, json_rows = exports
    rows = csv_rows if as_csv else json_rows
    altered = [rows[0], rows[0], rows[2], rows[3] | {"record_id": "extra"}]

    result = compare(altered, reference, as_csv=as_csv)

    assert result["missing"] == {"ordinary": 1, "null": 1}
    assert result["extra"] == {"protected": 1, "extra": 1}
    assert result["repeated"] == {"protected": 2}
