"""Serialize a complete, bounded download before sending response headers."""

import csv
import io
import json
from collections.abc import Iterable
from typing import Literal

from backend.core.contracts import Contract
from backend.core.csv_export import protect_csv_text
from backend.core.profiles import ProfileError

ExportFormat = Literal["csv", "json"]
MAX_EXPORT_ROWS = 5_000
MAX_EXPORT_BYTES = 8 * 1024 * 1024


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _csv_cell(value):
    if isinstance(value, dict):
        return _json(value)
    if isinstance(value, str):
        return protect_csv_text(value)
    return value


def encode_records(
    records: Iterable[Contract], fields: tuple[str, ...], format: ExportFormat
) -> bytes:
    output = bytearray()
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    closing = b"]\n" if format == "json" else b""

    def append(text: str) -> None:
        encoded = text.encode("utf-8")
        if len(output) + len(encoded) + len(closing) > MAX_EXPORT_BYTES:
            raise ProfileError(
                "record_export_limit", "The export exceeds the 8 MiB download limit"
            )
        output.extend(encoded)

    def append_csv(values) -> None:
        writer.writerow(values)
        append(buffer.getvalue())
        buffer.seek(0)
        buffer.truncate()

    if format == "csv":
        append_csv(fields)
    else:
        append("[")

    for index, record in enumerate(records):
        if index >= MAX_EXPORT_ROWS:
            raise ProfileError(
                "record_export_limit", "The export exceeds the 5,000-record limit"
            )
        row = record.model_dump(mode="json")
        if format == "csv":
            append_csv(_csv_cell(row[field]) for field in fields)
        else:
            append(("," if index else "") + _json(row))

    output.extend(closing)
    return bytes(output)
