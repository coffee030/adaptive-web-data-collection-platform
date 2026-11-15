"""Versioned data exchanged by the collection services."""

import hashlib
import json
import os
import re
from datetime import datetime
from typing import Annotated, Literal
from urllib.parse import unquote, urlsplit

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationInfo,
    field_validator,
    model_validator,
)

Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)
]
SelectorText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1024)
]
Positive = Annotated[int, Field(strict=True, ge=1)]
Count = Annotated[int, Field(strict=True, ge=0)]
Sha256 = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
Scalar = str | int | float | bool | None
AdapterType = Literal["web", "csv"]
SchemaVersion = Literal["1"]
MAX_HTML_PAGES = 5
MAX_DETAIL_PAGES = 10
MAX_SEARCH_REQUESTS = 20
MAX_SEARCH_SECONDS = 45
MAX_SEARCH_BODY_BYTES = 1024 * 1024
MAX_JOB_ATTEMPTS = 3
CaptureKind = Literal["input", "search", "detail"]
PathPrefix = Annotated[str, StringConstraints(min_length=1, max_length=512)]


class Contract(BaseModel):
    model_config = ConfigDict(
        extra="forbid", frozen=True, allow_inf_nan=False, revalidate_instances="always"
    )


def canonical_json(value: object) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False
    ).encode("ascii")


def loopback_origin(value: str) -> str:
    if any(ord(char) <= 32 or char in "\\\x7f" for char in value):
        raise ValueError("Invalid origin characters")
    parts = urlsplit(value)
    port = parts.port
    if (
        parts.scheme != "http"
        or parts.hostname != "127.0.0.1"
        or parts.netloc != f"127.0.0.1:{port}"
        or not port
        or value != f"http://127.0.0.1:{port}"
    ):
        raise ValueError("Expected a literal http://127.0.0.1:PORT origin")
    return value


COMPOSE_FIXTURE_ORIGIN = "http://collection-fixture:8001"
DNS_LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
PUBLIC_HOST = re.compile(rf"(?:{DNS_LABEL}\.)+[a-z](?:[a-z0-9-]{{0,61}}[a-z0-9])?")


def path_segments(path: str) -> tuple[str, ...]:
    """Use the same unambiguous path interpretation for policy and transport."""
    if (
        not path.startswith("/")
        or "//" in path
        or not path.isascii()
        or re.search(r"%(?![0-9a-fA-F]{2})", path)
    ):
        raise ValueError("Use an absolute URL path with valid percent escapes")
    segments = tuple(unquote(segment, errors="strict") for segment in path.split("/"))
    for segment in segments:
        if segment in {".", ".."} or any(
            char in "/\\%;?#" or ord(char) < 32 or ord(char) == 127 for char in segment
        ):
            raise ValueError("Ambiguous URL path segment")
    return segments


def controlled_origin(value: str) -> str:
    if value == COMPOSE_FIXTURE_ORIGIN and os.environ.get("M3_COMPOSE_FIXTURE") == "1":
        return value
    if value.startswith("https://"):
        host = value.removeprefix("https://")
        if len(host) > 253 or not PUBLIC_HOST.fullmatch(host):
            raise ValueError("Use a lowercase HTTPS DNS origin on the default port")
        return value
    return loopback_origin(value)


class Source(Contract):
    source_id: Name
    source_name: Name
    adapter_type: AdapterType
    permission_reference: Name
    approval_status: Literal["pending", "approved", "revoked"] = "pending"
    allowed_origins: tuple[str, ...] = ()
    allowed_datasets: tuple[Name, ...] = ()
    allowed_paths: dict[str, tuple[PathPrefix, ...]] = Field(
        default_factory=dict, exclude_if=lambda value: not value
    )
    min_request_interval_ms: Annotated[int, Field(strict=True, ge=1000, le=10_000)] = (
        Field(default=1000, exclude_if=lambda value: value == 1000)
    )

    @model_validator(mode="after")
    def check_policy(self):
        if self.adapter_type == "web":
            if not self.allowed_origins or self.allowed_datasets:
                raise ValueError("Web sources require origins only")
            for origin in self.allowed_origins:
                controlled_origin(origin)
            for origin, prefixes in self.allowed_paths.items():
                if origin not in self.allowed_origins or not 1 <= len(prefixes) <= 16:
                    raise ValueError(
                        "Path prefixes require a registered origin and 1–16 paths"
                    )
                for prefix in prefixes:
                    path_segments(prefix)
                    if any(ord(char) <= 32 for char in prefix) or "//" in prefix:
                        raise ValueError("Invalid path prefix")
        elif (
            not self.allowed_datasets
            or self.allowed_origins
            or self.allowed_paths
            or self.min_request_interval_ms != 1000
        ):
            raise ValueError("CSV sources require dataset IDs only")
        return self


class RecordField(Contract):
    name: Name
    value_type: Literal["string", "integer", "number", "boolean"] = "string"
    required: bool = True


class RecordSchema(Contract):
    record_type: Name
    schema_version: SchemaVersion
    fields: Annotated[tuple[RecordField, ...], Field(min_length=1, max_length=64)]
    identity_field: Name | None = None

    @field_validator("fields")
    @classmethod
    def order_fields(cls, fields):
        if len({field.name for field in fields}) != len(fields):
            raise ValueError("Record field names must be unique")
        return tuple(sorted(fields, key=lambda field: field.name))

    @model_validator(mode="after")
    def check_identity(self):
        if self.identity_field and self.identity_field not in {
            field.name for field in self.fields
        }:
            raise ValueError("Identity field must exist in the record schema")
        return self


class ExtractionField(Contract):
    name: Name
    selector: SelectorText
    selector_type: Literal["css", "xpath"] | None = None
    mode: Literal["text", "attribute"] = "text"
    attribute: Name | None = None
    resolve_url: bool = False

    @model_validator(mode="after")
    def check_attribute(self):
        if (self.mode == "attribute") != (self.attribute is not None):
            raise ValueError("Attribute mode requires an attribute name")
        return self


class CsvColumn(Contract):
    name: Name
    column: Name


class ProfileConfiguration(Contract):
    config_schema_version: SchemaVersion
    record_schema: RecordSchema

    def config_hash(self) -> str:
        return hashlib.sha256(canonical_json(self.model_dump(mode="json"))).hexdigest()


class NextLinkPagination(Contract):
    next_link_selector: SelectorText
    max_pages: Annotated[int, Field(strict=True, ge=1, le=MAX_HTML_PAGES)]


class KeywordSearch(Contract):
    origin: Annotated[str, Field(max_length=261)]
    path: PathPrefix
    keyword_parameter: Annotated[
        str, StringConstraints(pattern=r"^[A-Za-z0-9_.-]{1,64}$")
    ]
    result_item_selector: SelectorText
    detail_link_selector: SelectorText
    pagination: NextLinkPagination | None = None
    max_detail_pages: Annotated[int, Field(strict=True, ge=1, le=MAX_DETAIL_PAGES)] = 5
    max_requests: Annotated[int, Field(strict=True, ge=3, le=MAX_SEARCH_REQUESTS)] = 12
    max_redirects: Annotated[int, Field(strict=True, ge=0, le=2)] = 2
    max_body_bytes: Annotated[
        int, Field(strict=True, ge=512_000, le=MAX_SEARCH_BODY_BYTES)
    ] = MAX_SEARCH_BODY_BYTES
    timeout_seconds: Annotated[int, Field(strict=True, ge=1, le=2)] = 2
    max_seconds: Annotated[int, Field(strict=True, ge=5, le=MAX_SEARCH_SECONDS)] = (
        MAX_SEARCH_SECONDS
    )
    max_attempts: Annotated[int, Field(strict=True, ge=1, le=MAX_JOB_ATTEMPTS)] = (
        MAX_JOB_ATTEMPTS
    )

    @model_validator(mode="after")
    def check_search_target(self):
        controlled_origin(self.origin)
        path_segments(self.path)
        if "//" in self.path or any(ord(char) <= 32 for char in self.path):
            raise ValueError(
                "Search path must be an absolute path without a query or fragment"
            )
        return self


class ExtractionConfiguration(ProfileConfiguration):
    adapter_type: Literal["web"] = "web"
    selector_type: Literal["css", "xpath"]
    item_selector: SelectorText
    fields: Annotated[tuple[ExtractionField, ...], Field(min_length=1, max_length=64)]
    # Omitting absent pagination preserves hashes of existing approved profiles.
    pagination: NextLinkPagination | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    search: KeywordSearch | None = Field(
        default=None, exclude_if=lambda value: value is None
    )

    @field_validator("fields")
    @classmethod
    def order_fields(cls, fields, info: ValidationInfo):
        strategy = info.data.get("selector_type")
        return tuple(
            field.model_copy(update={"selector_type": None})
            if strategy and field.selector_type == strategy
            else field
            for field in sorted(fields, key=lambda field: field.name)
        )

    @model_validator(mode="after")
    def check_mappings(self):
        check_field_mapping(self.fields, self.record_schema)
        if self.search and self.pagination:
            raise ValueError(
                "Configure pagination inside keyword search for a search profile"
            )
        return self


class CsvMappingConfiguration(ProfileConfiguration):
    adapter_type: Literal["csv"] = "csv"
    columns: Annotated[tuple[CsvColumn, ...], Field(min_length=1, max_length=64)]

    @field_validator("columns")
    @classmethod
    def order_columns(cls, columns):
        return tuple(sorted(columns, key=lambda column: column.name))

    @model_validator(mode="after")
    def check_mappings(self):
        check_field_mapping(self.columns, self.record_schema)
        return self


def check_field_mapping(
    mappings: tuple[ExtractionField, ...] | tuple[CsvColumn, ...], schema: RecordSchema
) -> None:
    if tuple(mapping.name for mapping in mappings) != tuple(
        field.name for field in schema.fields
    ):
        raise ValueError("Mappings must cover each schema field exactly once")


Configuration = Annotated[
    ExtractionConfiguration | CsvMappingConfiguration,
    Field(discriminator="adapter_type"),
]


class SourceProfileVersion(Contract):
    profile_version_id: Name
    source_id: Name
    version: Positive
    configuration: Configuration
    config_hash: Sha256
    approval_status: Literal["draft", "approved", "retired"] = "draft"
    approved_by: Name | None = None
    approved_at: datetime | None = None
    validation_report_id: Name | None = None

    @model_validator(mode="after")
    def check_integrity(self):
        if self.config_hash != self.configuration.config_hash():
            raise ValueError("Profile hash must match the configuration")
        approval_fields = (
            self.approved_by,
            self.approved_at,
            self.validation_report_id,
        )
        if self.approval_status == "draft":
            if any(value is not None for value in approval_fields):
                raise ValueError("A draft cannot contain approval metadata")
        elif any(value is None for value in approval_fields):
            raise ValueError("Approval metadata is required")
        return self


class CollectionError(Contract):
    code: Name
    message: str
    http_status: int | None = None
    retry_after_seconds: int | None = None


class RecordProblem(Contract):
    code: Literal[
        "required_field", "wrong_type", "invalid_row", "unexpected_field", "duplicate"
    ]
    field: Name | None = None
    message: str


class SourcePosition(Contract):
    kind: Literal["html_item", "csv_row"]
    index: Positive


class CandidateRecord(Contract):
    source_position: SourcePosition
    payload: dict[Name, Scalar]
    problems: tuple[RecordProblem, ...] = ()


class ProfileValidationReport(Contract):
    report_id: Name
    profile_version_id: Name
    config_hash: Sha256
    sample_location: str | None = None
    sample_hash: Sha256 | None = None
    validated_at: datetime
    valid_count: Count = 0
    invalid_count: Count = 0
    duplicate_count: Count = 0
    invalid: tuple["RecordRejection", ...] = ()
    error: CollectionError | None = None

    @property
    def passed(self) -> bool:
        return (
            self.error is None
            and self.sample_hash is not None
            and self.valid_count > 0
            and self.invalid_count == 0
        )


class EvidenceReference(Contract):
    evidence_id: Name
    source_id: Name
    run_id: Name
    profile_version_id: Name
    config_hash: Sha256
    adapter_type: AdapterType
    original_location: str
    requested_location: str | None = None
    captured_at: datetime
    content_hash: Sha256
    http_status: int | None = None
    content_type: str | None = None
    page_number: Positive = 1
    capture_kind: CaptureKind = Field(
        default="input", exclude_if=lambda value: value == "input"
    )


class Provenance(Contract):
    source_id: Name
    run_id: Name
    profile_version_id: Name
    config_hash: Sha256
    validation_status: Literal["passed"] = "passed"


class GenericRecord(Contract):
    record_id: Sha256
    record_type: Name
    schema_version: SchemaVersion
    source_record_key: str | None
    payload: dict[Name, Scalar]
    source_position: SourcePosition
    evidence_reference: Name
    provenance: Provenance


class RecordRejection(Contract):
    source_position: SourcePosition
    problems: tuple[RecordProblem, ...]
    evidence_reference: Name | None = Field(
        default=None, exclude_if=lambda value: value is None
    )


class CollectionRunResult(Contract):
    run_id: Name
    profile_version_id: Name
    status: Literal["completed", "partial", "failed"]
    evidence: EvidenceReference | None = None
    records: tuple[GenericRecord, ...] = ()
    invalid: tuple[RecordRejection, ...] = ()
    duplicates: tuple[RecordRejection, ...] = ()
    error: CollectionError | None = None
    additional_evidence: tuple[EvidenceReference, ...] = Field(
        default=(), exclude_if=lambda value: not value
    )

    @property
    def all_evidence(self) -> tuple[EvidenceReference, ...]:
        return ((self.evidence,) if self.evidence else ()) + self.additional_evidence
