"""Read controlled UTF-8 CSV and map columns to candidate records."""

import csv
from io import StringIO

from .contracts import (
    CandidateRecord,
    CsvMappingConfiguration,
    RecordProblem,
    Source,
    SourcePosition,
)
from .inputs import CapturedInput, CsvInput, InputError

MAX_INPUT_BYTES = 1024 * 1024
MAX_ROWS = 10_000


def capture_csv(source: Source, entry: CsvInput) -> CapturedInput:
    if source.approval_status != "approved":
        raise InputError("source_not_approved", "Source access is not authorized")
    if entry.dataset_id not in source.allowed_datasets:
        raise InputError(
            "dataset_not_allowed", "Dataset is outside the source authorization"
        )
    if len(entry.content) > MAX_INPUT_BYTES:
        raise InputError("input_too_large", "CSV exceeds the 1 MiB input limit")
    return CapturedInput(
        entry.content, entry.dataset_id, content_type="text/csv; charset=utf-8"
    )


def csv_candidates(
    document: CapturedInput, config: CsvMappingConfiguration
) -> list[CandidateRecord]:
    try:
        text = document.body.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise InputError("invalid_encoding", "CSV must be UTF-8") from error

    reader = csv.reader(StringIO(text, newline=""), strict=True)
    try:
        return _read_records(reader, config)
    except csv.Error as error:
        raise InputError(
            "invalid_csv", f"Malformed CSV at physical line {reader.line_num}"
        ) from error


def _read_records(reader, config: CsvMappingConfiguration) -> list[CandidateRecord]:
    columns = next(reader, None)
    if not columns:
        raise InputError("empty_csv", "CSV is missing a header")
    if len(set(columns)) != len(columns) or any(
        not column.strip() for column in columns
    ):
        raise InputError(
            "invalid_header", "CSV header names must be unique and non-empty"
        )
    indexes = {column: index for index, column in enumerate(columns)}
    required_fields = {
        field.name for field in config.record_schema.fields if field.required
    }
    missing = sorted(
        mapping.column
        for mapping in config.columns
        if mapping.name in required_fields and mapping.column not in indexes
    )
    if missing:
        raise InputError(
            "missing_columns", f"Required CSV columns missing: {', '.join(missing)}"
        )

    records = []
    while True:
        start_line = reader.line_num + 1
        row = next(reader, None)
        if row is None:
            break
        if len(records) >= MAX_ROWS:
            raise InputError("row_limit", "CSV exceeds the 10,000 row limit")
        position = SourcePosition(kind="csv_row", index=start_line)
        if len(row) != len(columns):
            records.append(
                CandidateRecord(
                    source_position=position,
                    payload={},
                    problems=(
                        RecordProblem(
                            code="invalid_row", message="Row width differs from header"
                        ),
                    ),
                )
            )
            continue
        payload = {
            mapping.name: row[indexes[mapping.column]]
            if mapping.column in indexes
            else None
            for mapping in config.columns
        }
        records.append(CandidateRecord(source_position=position, payload=payload))

    if not records:
        raise InputError("empty_csv", "CSV has a header but no data rows")
    return records
