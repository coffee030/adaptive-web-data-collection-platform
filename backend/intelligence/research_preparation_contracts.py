"""Contracts for explicitly confirmed company research requests."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, StringConstraints, model_validator

from .contracts import Deliverable, Language, Platform, StrictModel
from .research_contracts import BusinessBrief
from .research_criteria_contracts import (
    MAX_AGE_DAYS,
    MIN_AGE_DAYS,
    Alternatives,
    CriteriaField,
    CriteriaVersion,
    PlatformIntent,
    ResearchCriteriaInput,
    ResearchCriteriaResolution,
    StructuredField,
    StructuredOrigin,
)


ResearchProtocol = Literal["confirmed-v1"]
Fingerprint = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]


class PublicationAgeDecision(StrictModel):
    max_evidence_age_days: (
        Annotated[int, Field(strict=True, ge=MIN_AGE_DAYS, le=MAX_AGE_DAYS)] | None
    )


class PlatformDecision(StrictModel):
    platform: Platform
    alternative_platforms: Alternatives
    platform_intent: PlatformIntent
    excluded_platforms: Annotated[tuple[Platform, ...], Field(max_length=4)]

    @model_validator(mode="after")
    def consistent_scope(self):
        targets = (self.platform, *self.alternative_platforms)
        if len(set(targets)) != len(targets):
            raise ValueError("Choose distinct target channels")
        if len(set(self.excluded_platforms)) != len(self.excluded_platforms):
            raise ValueError("Choose distinct excluded channels")
        if set(targets).intersection(self.excluded_platforms):
            raise ValueError("Target channels cannot also be excluded")
        if (self.platform_intent == "single") == bool(self.alternative_platforms):
            raise ValueError(
                "Choose a channel relationship consistent with the targets"
            )
        return self


class LanguageDecision(StrictModel):
    language: Language | None
    require_language: Annotated[bool, Field(strict=True)]

    @model_validator(mode="after")
    def mandatory_language(self):
        if self.require_language and self.language is None:
            raise ValueError("A mandatory language constraint requires a language")
        return self


class ResearchReviewDecisions(StrictModel):
    publication_age: PublicationAgeDecision | None = None
    platforms: PlatformDecision | None = None
    deliverable: Deliverable | None = None
    language: LanguageDecision | None = None


class ResearchPreparation(StrictModel):
    protocol: ResearchProtocol
    brief: BusinessBrief
    campaign_id: UUID | None = None
    provenance: dict[StructuredField, StructuredOrigin] = Field(default_factory=dict)
    decisions: ResearchReviewDecisions = Field(default_factory=ResearchReviewDecisions)

    def criteria_input(self) -> ResearchCriteriaInput:
        brief = self.brief
        return ResearchCriteriaInput(
            **brief.campaign.model_dump(
                include=set(ResearchCriteriaInput.model_fields) - {"provenance"}
            ),
            research_text=brief.campaign.description,
            product=brief.product,
            discovery_focus=brief.discovery_focus,
            audience=brief.audience,
            alternative_platforms=brief.alternative_platforms,
            max_evidence_age_days=brief.max_evidence_age_days,
            provenance=self.provenance,
        )

    @model_validator(mode="after")
    def validate_provenance(self):
        self.criteria_input()
        return self


class ResearchProposalData(StrictModel):
    preparation: ResearchPreparation
    initial: ResearchCriteriaResolution
    finalized: ResearchCriteriaResolution
    effective_brief: BusinessBrief | None


class ResearchProposal(ResearchProposalData):
    fingerprint: Fingerprint


class ResearchExecutionIssue(StrictModel):
    field: CriteriaField
    code: str
    explanation: str
    action: str


class ResearchExecutionReadiness(StrictModel):
    status: Literal["ready", "blocked"]
    issues: tuple[ResearchExecutionIssue, ...] = ()


class ResearchPreview(ResearchProposal):
    execution: ResearchExecutionReadiness


class ResearchConfirmation(StrictModel):
    action: Literal["confirm"]
    version: CriteriaVersion
    proposal_fingerprint: Fingerprint


class ConfirmedResearch(ResearchPreparation):
    request_key: UUID
    confirmation: ResearchConfirmation


class ConfirmedCriteriaSnapshot(StrictModel):
    proposal: ResearchProposal
    confirmation: ResearchConfirmation
    confirmed_at: AwareDatetime
    request_fingerprint: Fingerprint
