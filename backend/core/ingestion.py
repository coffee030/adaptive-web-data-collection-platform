"""Validate and deduplicate candidates from either adapter."""

import hashlib
import math
import re
from dataclasses import dataclass

from .contracts import (
    CandidateRecord,
    EvidenceReference,
    GenericRecord,
    Provenance,
    RecordProblem,
    RecordRejection,
    RecordSchema,
    Scalar,
    SourcePosition,
    canonical_json,
)

INTEGER = re.compile(r"[+-]?[0-9]+")
NUMBER = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")


@dataclass
class ValidatedCandidate:
    position: SourcePosition
    payload: dict[str, Scalar]
    source_key: str | None
    record_id: str


@dataclass
class IngestionResult:
    valid: list[ValidatedCandidate]
    invalid: list[RecordRejection]
    duplicates: list[RecordRejection]

    def records(
        self, schema: RecordSchema, evidence: EvidenceReference
    ) -> tuple[GenericRecord, ...]:
        provenance = Provenance(
            source_id=evidence.source_id,
            run_id=evidence.run_id,
            profile_version_id=evidence.profile_version_id,
            config_hash=evidence.config_hash,
        )
        return tuple(
            GenericRecord(
                record_id=entry.record_id,
                record_type=schema.record_type,
                schema_version=schema.schema_version,
                source_record_key=entry.source_key,
                payload=entry.payload,
                source_position=entry.position,
                evidence_reference=evidence.evidence_id,
                provenance=provenance,
            )
            for entry in self.valid
        )


def ingest(
    candidates: list[CandidateRecord], schema: RecordSchema, source_id: str
) -> IngestionResult:
    result = IngestionResult([], [], [])
    seen = set()
    names = {field.name for field in schema.fields}
    for candidate in candidates:
        problems = list(candidate.problems)
        payload = {}
        if not problems:
            problems.extend(
                RecordProblem(
                    code="unexpected_field",
                    field=name,
                    message="Field is outside the record schema",
                )
                for name in sorted(candidate.payload.keys() - names)
            )
            for field in schema.fields:
                raw = candidate.payload.get(field.name)
                raw = raw.strip() if isinstance(raw, str) else raw
                if raw is None or raw == "":
                    payload[field.name] = None
                    if field.required:
                        problems.append(
                            RecordProblem(
                                code="required_field",
                                field=field.name,
                                message="Required field is missing",
                            )
                        )
                    continue
                try:
                    payload[field.name] = _normalize(raw, field.value_type)
                except (ValueError, OverflowError):
                    problems.append(
                        RecordProblem(
                            code="wrong_type",
                            field=field.name,
                            message=f"Expected {field.value_type}",
                        )
                    )

        if problems:
            result.invalid.append(
                RecordRejection(
                    source_position=candidate.source_position, problems=tuple(problems)
                )
            )
            continue

        identity = (
            payload.get(schema.identity_field)
            if schema.identity_field is not None
            else None
        )
        source_key = str(identity) if identity is not None else None
        key_type, key_value = (
            ("identity", identity) if identity is not None else ("payload", payload)
        )
        record_id = hashlib.sha256(
            canonical_json(
                [
                    source_id,
                    schema.record_type,
                    schema.schema_version,
                    key_type,
                    key_value,
                ]
            )
        ).hexdigest()
        if record_id in seen:
            result.duplicates.append(
                RecordRejection(
                    source_position=candidate.source_position,
                    problems=(
                        RecordProblem(
                            code="duplicate",
                            message="Record identity already appeared in this run",
                        ),
                    ),
                )
            )
            continue
        seen.add(record_id)
        result.valid.append(
            ValidatedCandidate(
                candidate.source_position, payload, source_key, record_id
            )
        )
    return result


def _normalize(value: Scalar, value_type: str) -> Scalar:
    if value_type == "string" and isinstance(value, str):
        return value
    if value_type == "integer":
        if type(value) is int:
            return value
        if isinstance(value, str) and INTEGER.fullmatch(value):
            return int(value)
    if value_type == "number" and (
        type(value) in (int, float)
        or isinstance(value, str)
        and NUMBER.fullmatch(value)
    ):
        number = float(value)
        if math.isfinite(number):
            return 0.0 if number == 0 else number
    if value_type == "boolean":
        if isinstance(value, bool):
            return value
        if isinstance(value, str) and value.lower() in ("true", "false"):
            return value.lower() == "true"
    raise ValueError("Value does not match the record field type")
