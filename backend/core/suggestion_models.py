"""Transient contracts for a pre-draft suggestion."""

from typing import Annotated, Literal

from pydantic import Field

from .contracts import Contract, ExtractionField, KeywordSearch, RecordSchema, Scalar

Address = Annotated[str, Field(min_length=1, max_length=2048)]
Stage = Literal[
    "entry", "robots", "homepage", "navigation", "results", "detail", "mapping"
]
Outcome = Literal[
    "usable",
    "partial",
    "needs_examples",
    "unsupported",
    "denied",
    "budget_exhausted",
    "transient_failure",
]


class SuggestionInput(Contract):
    keyword: Annotated[str, Field(min_length=1, max_length=256)]
    record_schema: RecordSchema | None = None


class Homepage(SuggestionInput):
    mode: Literal["homepage"]
    homepage_url: Address


class Examples(SuggestionInput):
    mode: Literal["examples"]
    results_url: Address
    detail_url: Address


SuggestionRequest = Annotated[Homepage | Examples, Field(discriminator="mode")]


class SuggestionLimits(Contract):
    policy: Literal["controlled_defaults", "public_conservative"]
    reviewed_profile_limits: bool
    max_requests: int
    max_body_bytes: int
    max_total_body_bytes: int
    timeout_seconds: int
    max_seconds: int
    min_request_interval_ms: int


class RequestEntry(Contract):
    stage: Stage
    state: Literal["denied_before_send", "reserved_unsent", "transport_attempt"]


class FieldSuggestion(Contract):
    name: str
    mapping: ExtractionField | None = None
    sample: Scalar = None
    reason: str


class SuggestedMapping(Contract):
    search: KeywordSearch
    record_schema: RecordSchema
    item_selector: str | None = None
    listing_sample: str | None = None
    fields: tuple[FieldSuggestion, ...]


class SuggestionResult(Contract):
    outcome: Outcome
    stage: Stage
    code: str
    reason: str
    limits: SuggestionLimits | None = None
    reserved_requests: int
    actual_attempts: int
    requests: tuple[RequestEntry, ...]
    retry_after_seconds: int | None = None
    proposal: SuggestedMapping | None = None
