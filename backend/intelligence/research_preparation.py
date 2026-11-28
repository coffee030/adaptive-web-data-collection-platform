"""Prepare, confirm and verify a deterministic company research proposal."""

from hashlib import sha256
from hmac import compare_digest
import json

from pydantic import ValidationError

from backend.marketing.store import MarketingError
from .research_contracts import BusinessBrief
from .research_criteria import (
    _platform_mentions,
    _Resolution,
    _text_platform_scopes,
    resolve_research_criteria,
)
from .research_criteria_contracts import (
    CriteriaFieldResolution,
    CriteriaReference,
    ResearchCriteriaResolution,
    ResolvedResearchCriteria,
)
from .research_preparation_contracts import (
    ConfirmedCriteriaSnapshot,
    ConfirmedResearch,
    ResearchExecutionIssue,
    ResearchExecutionReadiness,
    ResearchPreparation,
    ResearchPreview,
    ResearchProposalData,
    ResearchReviewDecisions,
)


def _fingerprint(payload: list[object]) -> str:
    return sha256(
        json.dumps(
            payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode()
    ).hexdigest()


def _proposal_fingerprint(company_id: str, proposal: ResearchProposalData) -> str:
    return _fingerprint(
        [
            "confirmed-research-proposal-v1",
            company_id,
            proposal.model_dump(
                mode="json", include=set(ResearchProposalData.model_fields)
            ),
        ]
    )


def request_fingerprint(body: ConfirmedResearch) -> str:
    return _fingerprint(["confirmed-research-request-v1", body.model_dump(mode="json")])


def _finalize(
    initial: ResearchCriteriaResolution, decisions: ResearchReviewDecisions
) -> ResearchCriteriaResolution:
    if initial.status == "invalid":
        return initial
    overrides = {}
    for choice in (decisions.publication_age, decisions.platforms, decisions.language):
        if choice is not None:
            overrides.update(choice.model_dump())
    if decisions.deliverable is not None:
        overrides["deliverable"] = decisions.deliverable
    if not overrides:
        return initial

    fields = dict(initial.fields)
    for name in overrides:
        explicit = CriteriaReference(field=name)
        fields[name] = CriteriaFieldResolution(
            state="resolved",
            origin="explicit",
            references=(
                explicit,
                *(ref for ref in fields[name].references if ref != explicit),
            ),
        )
    issues = tuple(item for item in initial.issues if item.field not in overrides)
    settled = all(item.state in {"resolved", "absent"} for item in fields.values())
    return initial.model_copy(
        update={
            "status": "ready"
            if settled and all(item.severity == "notice" for item in issues)
            else "needs_review",
            "criteria": ResolvedResearchCriteria.model_validate(
                initial.criteria.model_dump() | overrides
            ),
            "fields": fields,
            "issues": issues,
            "assumptions": ()
            if decisions.platforms is not None
            else initial.assumptions,
        }
    )


def _effective_brief(
    brief: BusinessBrief, resolution: ResearchCriteriaResolution
) -> BusinessBrief:
    criteria = resolution.criteria.model_dump(mode="json")
    campaign = {
        name: criteria[name]
        for name in type(brief.campaign).model_fields
        if name in criteria
    }
    return BusinessBrief.model_validate(
        brief.model_dump(mode="json")
        | {
            "campaign": brief.campaign.model_dump(mode="json") | campaign,
            "alternative_platforms": criteria["alternative_platforms"] or [],
            "max_evidence_age_days": criteria["max_evidence_age_days"],
        }
    )


def _execution_issues(finalized: ResearchCriteriaResolution):
    issues = [
        ResearchExecutionIssue(
            field=issue.field,
            code=issue.code,
            explanation=issue.explanation,
            action=issue.action,
        )
        for issue in finalized.issues
        if issue.severity != "notice"
    ]
    if finalized.status != "ready":
        return issues
    criteria = finalized.criteria
    required = (
        ("platform", "Choose a primary platform that is not excluded."),
        ("deliverable", "Choose the campaign deliverable."),
        ("budget_minor", "Supply the campaign budget in minor currency units."),
        ("currency", "Supply the campaign currency."),
        ("minimum_creators", "Supply the minimum creator count."),
        ("maximum_creators", "Supply the maximum creator count."),
    )
    for name, action in required:
        if getattr(criteria, name) is None:
            issues.append(
                ResearchExecutionIssue(
                    field=name,
                    code="main_platform_required"
                    if name == "platform"
                    else "execution_value_required",
                    explanation="Research execution requires this campaign criterion.",
                    action=action,
                )
            )
    if (
        criteria.platform is not None
        and criteria.platform_intent == "comparison"
        and finalized.fields["platform"].origin != "explicit"
    ):
        # The accepted parser retains structural role declarations in its scopes.
        source = finalized.original_input
        positive, _, _ = _platform_mentions(_Resolution(source))
        has_declared_primary = any(
            scope.primary == criteria.platform
            for scope in _text_platform_scopes(source, positive)
        )
        if not has_declared_primary:
            issues.append(
                ResearchExecutionIssue(
                    field="platform",
                    code="comparison_primary_required",
                    explanation="This comparison does not establish a user-selected primary platform.",
                    action="Choose the primary platform and the comparison channels in a platform decision, then preview again.",
                )
            )
    return issues


def prepare(company_id: str, body: ResearchPreparation) -> ResearchPreview:
    initial = resolve_research_criteria(body.criteria_input())
    finalized = _finalize(initial, body.decisions)
    issues = _execution_issues(finalized)
    executable = finalized.status == "ready" and not issues
    data = ResearchProposalData(
        preparation=body,
        initial=initial,
        finalized=finalized,
        effective_brief=_effective_brief(body.brief, finalized) if executable else None,
    )
    return ResearchPreview(
        **dict(data),
        fingerprint=_proposal_fingerprint(company_id, data),
        execution=ResearchExecutionReadiness(
            status="ready" if executable else "blocked", issues=tuple(issues)
        ),
    )


def validate_confirmation(company_id: str, body: ConfirmedResearch) -> ResearchPreview:
    preparation = ResearchPreparation.model_validate(
        body.model_dump(exclude={"request_key", "confirmation"})
    )
    proposal = prepare(company_id, preparation)
    confirmation = body.confirmation
    if confirmation.version != proposal.finalized.version or not compare_digest(
        confirmation.proposal_fingerprint, proposal.fingerprint
    ):
        raise MarketingError(
            409,
            "research_confirmation_stale",
            "Preview the current proposal before confirming research",
        )
    if proposal.effective_brief is None:
        raise MarketingError(
            422,
            "research_criteria_unresolved",
            "Resolve the blocking research criteria and preview again before confirming research",
            issues=[
                issue.model_dump(mode="json") for issue in proposal.execution.issues
            ],
        )
    return proposal


def read_snapshot(row) -> ConfirmedCriteriaSnapshot | None:
    if row.criteria_version is None and row.confirmed_criteria is None:
        return None
    try:
        snapshot = ConfirmedCriteriaSnapshot.model_validate(row.confirmed_criteria)
        proposal = snapshot.proposal
        confirmation = snapshot.confirmation
        if (
            proposal.effective_brief is not None
            and proposal.finalized.status == "ready"
            and row.criteria_version
            == confirmation.version
            == proposal.finalized.version
            and compare_digest(confirmation.proposal_fingerprint, proposal.fingerprint)
            and compare_digest(
                proposal.fingerprint, _proposal_fingerprint(row.company_id, proposal)
            )
            and proposal.preparation.brief.model_dump(mode="json") == row.brief
            and proposal.preparation.campaign_id == row.campaign_id
            and compare_digest(
                snapshot.request_fingerprint,
                request_fingerprint(
                    ConfirmedResearch(
                        **dict(proposal.preparation),
                        request_key=row.request_key,
                        confirmation=confirmation,
                    )
                ),
            )
        ):
            return snapshot
    except ValidationError:
        pass
    raise MarketingError(
        409,
        "research_snapshot_invalid",
        "The confirmed research criteria could not be verified",
    )


def snapshot_metadata(snapshot: ConfirmedCriteriaSnapshot | None) -> dict:
    if snapshot is None:
        return {}
    return {
        "criteria_version": snapshot.confirmation.version,
        "confirmed_criteria": snapshot.model_dump(
            mode="json", exclude={"request_fingerprint"}
        ),
    }
