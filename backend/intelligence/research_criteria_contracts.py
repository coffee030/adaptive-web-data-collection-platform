"""Internal, versioned contracts for previewing research criteria."""

from typing import Annotated, Literal

from pydantic import Field, model_validator

from .contracts import (
    Currency,
    Deliverable,
    Language,
    Market,
    Money,
    Platform,
    Ref,
    Share,
    StrictModel,
)


CriteriaVersion = Literal["research-criteria-v1"]
StructuredOrigin = Literal["explicit", "application_default", "legacy"]
CriteriaOrigin = Literal["explicit", "application_default", "legacy", "text", "absent"]
StructuredField = Literal[
    "platform",
    "alternative_platforms",
    "deliverable",
    "max_evidence_age_days",
    "language",
    "require_language",
    "market",
    "minimum_market_share",
    "budget_minor",
    "currency",
    "minimum_creators",
    "maximum_creators",
    "required_facts",
    "preferred_facts",
]
CriteriaField = StructuredField | Literal["platform_intent", "excluded_platforms"]
ResearchTextField = Literal["research_text", "product", "discovery_focus"]
CreatorCount = Annotated[int, Field(strict=True, ge=1, le=8)]
AgeInput = Annotated[int, Field(strict=True)]
Alternatives = Annotated[tuple[Platform, ...], Field(max_length=2)]
Facts = Annotated[tuple[Ref, ...], Field(max_length=10)]
PlatformIntent = Literal["single", "comparison", "alternatives"]

MIN_AGE_DAYS = 1
MAX_AGE_DAYS = 3650


class CriteriaValues(StrictModel):
    platform: Platform | None = None
    alternative_platforms: Alternatives | None = None
    deliverable: Deliverable | None = None
    language: Language | None = None
    require_language: Annotated[bool, Field(strict=True)] | None = None
    market: Market | None = None
    minimum_market_share: Share | None = None
    budget_minor: Money | None = None
    currency: Currency | None = None
    minimum_creators: CreatorCount | None = None
    maximum_creators: CreatorCount | None = None
    required_facts: Facts | None = None
    preferred_facts: Facts | None = None


class ResearchCriteriaInput(CriteriaValues):
    research_text: str = ""
    product: str | None = None
    discovery_focus: str | None = None
    audience: str | None = None
    # Keep out-of-range integers available for an invalid resolution and its issue.
    max_evidence_age_days: AgeInput | None = None
    provenance: dict[StructuredField, StructuredOrigin] = Field(default_factory=dict)

    @model_validator(mode="after")
    def provenance_refers_to_supplied_fields(self):
        for name in self.provenance:
            if name not in self.model_fields_set or (
                getattr(self, name) is None and name != "max_evidence_age_days"
            ):
                raise ValueError(f"Provenance requires a supplied value for {name}")
        return self


class ResolvedResearchCriteria(CriteriaValues):
    max_evidence_age_days: (
        Annotated[int, Field(strict=True, ge=MIN_AGE_DAYS, le=MAX_AGE_DAYS)] | None
    ) = None
    platform_intent: PlatformIntent | None = None
    excluded_platforms: tuple[Platform, ...] | None = None


class CriteriaReference(StrictModel):
    field: CriteriaField | ResearchTextField
    matched_text: str | None = None


class CriteriaCandidate(StrictModel):
    value: bool | int | str | tuple[str, ...] | None
    origin: Literal["explicit", "application_default", "legacy", "text"]
    references: tuple[CriteriaReference, ...]


class CriteriaFieldResolution(StrictModel):
    state: Literal["resolved", "absent", "unresolved", "invalid"]
    origin: CriteriaOrigin | None = None
    references: tuple[CriteriaReference, ...] = ()


class CriteriaIssue(StrictModel):
    code: Literal[
        "age_out_of_range",
        "vague_age",
        "unsupported_age",
        "conflicting_criteria",
        "application_default_displaced",
        "ambiguous_platforms",
        "excluded_platform_selected",
        "duplicate_platforms",
        "main_platform_required",
        "ambiguous_deliverable",
        "ambiguous_language",
        "language_strength_required",
        "language_required",
        "market_required",
        "currency_required",
        "creator_count_order",
    ]
    field: CriteriaField
    severity: Literal["review", "invalid", "notice"]
    explanation: str
    action: str
    candidates: tuple[CriteriaCandidate, ...] = ()
    references: tuple[CriteriaReference, ...] = ()


class ResearchCriteriaResolution(StrictModel):
    version: CriteriaVersion = "research-criteria-v1"
    status: Literal["ready", "needs_review", "invalid"]
    original_input: ResearchCriteriaInput
    criteria: ResolvedResearchCriteria
    fields: dict[CriteriaField, CriteriaFieldResolution]
    issues: tuple[CriteriaIssue, ...] = ()
    defaults: dict[StructuredField, CriteriaCandidate] = Field(default_factory=dict)
    assumptions: tuple[str, ...] = ()
