import json
from pathlib import Path
import socket
from uuid import uuid4

import pytest
from pydantic import TypeAdapter, ValidationError
from sqlalchemy.orm import Session

from backend.intelligence import research_preparation
from backend.intelligence.research_contracts import NewResearch
from backend.intelligence.research_preparation import prepare, validate_confirmation
from backend.intelligence.research_preparation_contracts import (
    ConfirmedResearch,
    ResearchPreparation,
)
from backend.marketing.store import MarketingError


def research_fixture():
    return json.loads(
        (Path(__file__).parent / "fixtures" / "pr26b_research.json").read_text(
            encoding="utf-8"
        )
    )


def preparation(text=None, **updates):
    data = research_fixture()["preparation"]
    if text is not None:
        data["brief"]["campaign"]["description"] = text
    return ResearchPreparation.model_validate(data | updates)


def confirmed_request(proposal, **updates):
    return ConfirmedResearch.model_validate(
        proposal.preparation.model_dump(mode="json")
        | {
            "request_key": str(uuid4()),
            "confirmation": {
                "action": "confirm",
                "version": proposal.finalized.version,
                "proposal_fingerprint": proposal.fingerprint,
            },
        }
        | updates
    )


def test_preview_is_deterministic_and_has_no_execution_side_effects(monkeypatch):
    def unexpected(*args, **kwargs):
        pytest.fail("preview touched the network, clock-backed persistence or worker")

    from celery import Celery

    monkeypatch.setattr(socket, "socket", unexpected)
    monkeypatch.setattr(Session, "execute", unexpected)
    monkeypatch.setattr(Session, "flush", unexpected)
    monkeypatch.setattr(Celery, "send_task", unexpected)
    request = preparation()
    initial = request.model_dump_json()
    proposal = prepare("one", request)
    assert proposal.model_dump_json() == prepare("one", request).model_dump_json()
    assert proposal.fingerprint != prepare("two", request).fingerprint
    assert request.model_dump_json() == initial
    assert proposal.finalized.status == "ready"
    assert proposal.finalized.criteria.max_evidence_age_days == 30
    assert proposal.finalized.fields["platform"].origin == "application_default"
    assert (
        prepare("one", preparation(provenance={})).finalized.fields["platform"].origin
        == "legacy"
    )
    assert "confirmation" not in proposal.model_dump()


def test_only_typed_decisions_resolve_ambiguity_and_leave_initial_audit():
    text = (
        "Find affordable dining reviews in the past 2 months. Do not require Cantonese."
    )
    initial = prepare("one", preparation(text))
    assert initial.finalized.status == "needs_review"
    assert initial.effective_brief is None
    with pytest.raises(MarketingError) as issue:
        validate_confirmation("one", confirmed_request(initial))
    assert issue.value.code == "research_criteria_unresolved"

    age = {"publication_age": {"max_evidence_age_days": None}}
    partial = prepare("one", preparation(text, decisions=age))
    assert partial.finalized.status == "needs_review"
    age_field = partial.finalized.fields["max_evidence_age_days"]
    assert age_field.state == "resolved" and age_field.origin == "explicit"
    assert age_field.references[0].field == "max_evidence_age_days"
    complete = prepare(
        "one",
        preparation(
            text,
            decisions=age
            | {"language": {"language": "yue", "require_language": False}},
        ),
    )
    assert complete.initial == initial.initial
    assert complete.finalized.status == "ready"
    assert complete.finalized.criteria.max_evidence_age_days is None
    assert complete.effective_brief.campaign.language == "yue"
    assert complete.effective_brief.campaign.require_language is False
    assert validate_confirmation("one", confirmed_request(complete)) == complete


def test_finalized_platform_relationship_deliverable_and_exclusions():
    text = "Find YouTube dining creators. Do not create short videos."
    original = prepare("one", preparation(text, provenance={"platform": "explicit"}))
    assert original.finalized.status == "needs_review"
    assert {issue.field for issue in original.initial.issues} >= {
        "platform",
        "deliverable",
    }
    proposal = prepare(
        "one",
        preparation(
            text,
            decisions={
                "platforms": {
                    "platform": "youtube",
                    "alternative_platforms": ["tiktok"],
                    "excluded_platforms": ["facebook"],
                    "platform_intent": "comparison",
                },
                "deliverable": "dedicated_video",
            },
        ),
    )
    assert proposal.finalized.status == "ready"
    assert proposal.finalized.criteria.excluded_platforms == ("facebook",)
    assert proposal.finalized.criteria.platform_intent == "comparison"
    assert proposal.effective_brief.campaign.platform == "youtube"
    assert proposal.effective_brief.campaign.deliverable == "dedicated_video"
    assert proposal.effective_brief.alternative_platforms == ["tiktok"]


@pytest.mark.parametrize(
    "decision",
    [
        {"publication_age": {"max_evidence_age_days": True}},
        {"language": {"language": None, "require_language": True}},
        {
            "platforms": {
                "platform": "youtube",
                "alternative_platforms": [],
                "excluded_platforms": ["youtube"],
                "platform_intent": "single",
            }
        },
        {
            "platforms": {
                "platform": "youtube",
                "alternative_platforms": [],
                "excluded_platforms": [],
                "platform_intent": "comparison",
            }
        },
    ],
)
def test_invalid_review_decisions_fail_validation(decision):
    with pytest.raises(ValidationError):
        preparation(decisions=decision)


def test_invalid_input_stays_invalid_until_corrected():
    invalid = prepare(
        "one",
        preparation(
            "Find dining creators in the past 0 days",
            decisions={"publication_age": {"max_evidence_age_days": 30}},
        ),
    )
    assert invalid.finalized.status == "invalid"
    assert invalid.effective_brief is None
    assert prepare("one", preparation()).effective_brief.max_evidence_age_days == 30
    with pytest.raises(ValidationError):
        preparation(provenance={"language": "explicit"})


def test_confirmation_binds_company_brief_provenance_decisions_and_version(monkeypatch):
    proposal = prepare("one", preparation())
    submit = confirmed_request(proposal)
    for company, changes in (
        ("two", {}),
        ("one", {"campaign_id": uuid4()}),
        (
            "one",
            {"brief": preparation("Find affordable dining creators 過去30日").brief},
        ),
        ("one", {"provenance": {"platform": "explicit"}}),
        ("one", {"decisions": {"publication_age": {"max_evidence_age_days": 30}}}),
    ):
        with pytest.raises(MarketingError) as issue:
            validate_confirmation(company, confirmed_request(proposal, **changes))
        assert issue.value.code == "research_confirmation_stale"

    resolve = research_preparation.resolve_research_criteria

    def changed(source):
        result = resolve(source)
        return result.model_copy(
            update={"assumptions": ("Updated resolver interpretation.",)}
        )

    monkeypatch.setattr(research_preparation, "resolve_research_criteria", changed)
    with pytest.raises(MarketingError) as issue:
        validate_confirmation("one", submit)
    assert issue.value.code == "research_confirmation_stale"


def test_protocol_selection_and_malformed_confirmation_cannot_validate_as_legacy():
    payload = confirmed_request(prepare("one", preparation())).model_dump(mode="json")
    body = TypeAdapter(NewResearch | ConfirmedResearch)
    assert isinstance(body.validate_python(payload), ConfirmedResearch)
    assert isinstance(
        body.validate_python(
            {name: payload[name] for name in ("request_key", "brief")}
        ),
        NewResearch,
    )
    for malformed in (
        {name: value for name, value in payload.items() if name != "confirmation"},
        payload | {"confirmation": True},
        payload | {"confirmation": payload["confirmation"] | {"version": "forged"}},
        payload | {"protocol": "confirmed-v9"},
    ):
        with pytest.raises(ValidationError):
            body.validate_python(malformed)


@pytest.mark.parametrize(
    "order", ["Compare YouTube and Instagram", "Compare Instagram and YouTube"]
)
def test_comparison_allows_explicit_structured_or_declared_primary(order):
    explicit = prepare(
        "one",
        preparation(
            order,
            provenance={
                "platform": "explicit",
                "alternative_platforms": "application_default",
            },
        ),
    )
    assert explicit.execution.status == "ready"
    assert explicit.effective_brief.campaign.platform == "instagram"
    with_no_provenance = prepare(
        "one",
        preparation(order, provenance={"alternative_platforms": "application_default"}),
    )
    assert with_no_provenance.execution.status == "blocked"
    assert with_no_provenance.execution.issues[0].code == "comparison_primary_required"

    declared = with_no_provenance.preparation.model_dump(mode="json")
    declared["brief"]["product"] = (
        "Instagram as the main platform, with YouTube as an alternative"
    )
    by_text = prepare("one", ResearchPreparation.model_validate(declared))
    assert by_text.execution.status == "ready"
    assert by_text.finalized.criteria.platform_intent == "comparison"
    assert by_text.effective_brief.campaign.platform == "instagram"


def test_platform_decision_does_not_clear_an_unrelated_review_issue():
    body = preparation(
        "Compare Instagram and YouTube, in the past 2 months",
        provenance={
            "platform": "application_default",
            "alternative_platforms": "application_default",
        },
        decisions={
            "platforms": {
                "platform": "youtube",
                "alternative_platforms": ["instagram"],
                "platform_intent": "comparison",
                "excluded_platforms": [],
            }
        },
    )
    proposal = prepare("one", body)
    assert proposal.initial.criteria.platform_intent == "comparison"
    assert proposal.execution.status == "blocked"
    assert proposal.effective_brief is None
    assert {issue.code for issue in proposal.execution.issues} == {"unsupported_age"}
