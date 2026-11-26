from datetime import timedelta
from uuid import uuid4

import pytest

from backend.application.jobs import database_now
from backend.intelligence import research_analysis
from backend.intelligence.research_contracts import NewResearch
from backend.intelligence.research_models import ResearchRunRow
from backend.intelligence.research_runs import ResearchRuns, change, owned, start
from backend.intelligence.store import Config
from backend.marketing.company_models import CompanyCampaignRow, CompanyRow
from backend.marketing.store import MarketingError


def new_request(**fields):
    return NewResearch.model_validate(
        {
            "request_key": str(uuid4()),
            "brief": {
                "product": "Neighbourhood café lunch",
                "audience": "Hong Kong weekday diners",
                "campaign": {
                    "description": "Find affordable Hong Kong dining creators",
                    "objective": "awareness",
                    "budget_minor": 120000,
                    "currency": "HKD",
                    "platform": "instagram",
                    "deliverable": "social_post",
                },
                "alternative_platforms": ["youtube"],
                "test_share": 60,
            },
            **fields,
        }
    )


@pytest.fixture
def workspace(sessions):
    with sessions.begin() as session:
        session.add_all(
            [
                CompanyRow(id="one", name="Company One"),
                CompanyRow(id="two", name="Company Two"),
            ]
        )
    return ResearchRuns(sessions, Config())


def advance(workspace):
    messages = []
    assert workspace.dispatch(lambda *args: messages.append(args))
    if messages:
        workspace.execute(*messages[0])
    return messages


def test_durable_research_and_company_scope(workspace):
    request = new_request()
    with workspace.sessions.begin() as session:
        run_id = start(session, "one", request)["id"]
        assert start(session, "one", request)["id"] == run_id
        changed = request.model_copy(
            update={
                "brief": request.brief.model_copy(
                    update={"product": "Different product"}
                )
            }
        )
        with pytest.raises(MarketingError, match="different brief"):
            start(session, "one", changed)
        with pytest.raises(MarketingError, match="unavailable"):
            owned(session, "two", run_id)
    for expected in ["collecting", "analyzing", "ready"]:
        delivered = advance(workspace)
        workspace.execute(*delivered[0])
        with workspace.sessions() as session:
            assert owned(session, "one", run_id).state == expected
    with workspace.sessions() as session:
        result = workspace.results(session, "one", run_id)
        assert [s["budget_minor"] for s in result["strategies"]] == [
            120000,
            72000,
            120000,
        ]
        assert result["strategies"][2]["platform"] == "youtube"
        assert all(
            s["status"] == "needs_evidence" and s["allocated_minor"] is None
            for s in result["strategies"]
        )
        assert not result["research"]["examples"]
        assert result["next_steps"]
        stored = session.get(ResearchRunRow, run_id)
        assert stored.revision and len(stored.review["strategies"]) == 3
        assert all(
            set(item) == {"name", "platform", "currency", "budget_minor", "status"}
            for item in stored.review["strategies"]
        )
    with workspace.sessions.begin() as session:
        owned(session, "one", run_id, lock=True).revision = "superseded"
    with (
        workspace.sessions() as session,
        pytest.raises(MarketingError, match="Source evidence changed"),
    ):
        workspace.results(session, "one", run_id)


def test_cancel_fences_a_worker_and_resume_recovers_expired_lease(workspace):
    with workspace.sessions.begin() as session:
        run_id = start(session, "one", new_request())["id"]
    stale = []
    workspace.dispatch(lambda *a: stale.append(a))
    with workspace.sessions.begin() as session:
        assert change(session, "one", run_id, "cancel")["state"] == "cancelled"
        assert change(session, "one", run_id, "resume")["state"] == "queued"
    workspace.execute(*stale[0])
    abandoned = []
    workspace.dispatch(lambda *a: abandoned.append(a))
    with workspace.sessions.begin() as session:
        row = owned(session, "one", run_id, lock=True)
        assert row.state == "queued"
        row.due_at = database_now(session) - timedelta(seconds=1)
    advance(workspace)
    workspace.execute(*abandoned[0])
    with workspace.sessions() as session:
        assert owned(session, "one", run_id).state == "collecting"


def test_only_company_campaigns_can_be_linked(workspace):
    campaign = uuid4()
    with workspace.sessions.begin() as session:
        session.add(
            CompanyCampaignRow(
                company_id="one",
                id=campaign,
                version=1,
                draft={},
                updated_at=database_now(session),
            )
        )
    with workspace.sessions.begin() as session:
        req = new_request(campaign_id=campaign)
        assert start(session, "one", req)["campaign_id"] == campaign
        with pytest.raises(MarketingError, match="Campaign unavailable"):
            start(session, "two", req)


def test_broker_outage_is_retryable_and_source_failure_does_not_discard_other_evidence(
    workspace, monkeypatch
):
    with workspace.sessions.begin() as session:
        run_id = start(session, "one", new_request())["id"]

    def unavailable(*args):
        raise OSError("broker unavailable")

    assert not workspace.dispatch(unavailable)
    with workspace.sessions.begin() as session:
        row = owned(session, "one", run_id, lock=True)
        assert row.error == "delivery_delayed" and row.attempts == 0
        row.due_at = database_now(session)
    status = [
        {
            "key": "one",
            "name": "Controlled publication",
            "state": "unavailable",
            "pending": False,
            "refresh_due": True,
        }
    ]
    monkeypatch.setattr(research_analysis, "source_states", lambda sessions: status)
    monkeypatch.setattr(
        research_analysis,
        "collect_due",
        lambda sessions, states: {"one": "collection_failed"},
    )
    advance(workspace)
    advance(workspace)
    with workspace.sessions() as session:
        run = owned(session, "one", run_id)
        assert run.state == "analyzing"
        assert run.sources[0]["error"] == "collection_failed"


def test_focus_selects_eligible_refreshes_and_explicit_scenario():
    from backend.intelligence.analytics import scenario

    brief = new_request().brief
    states = [{"key": "2"}, {"key": "inaturalist"}, {"key": "canadian-civil"}]
    assert [s["key"] for s in research_analysis.planned_sources(brief, states)] == ["2"]
    transit = brief.model_copy(
        update={"discovery_focus": "港鐵 transit", "product": "MTR visitor guide"}
    )
    assert [s["key"] for s in research_analysis.planned_sources(transit, states)] == [
        "2",
        "canadian-civil",
    ]
    shaped = brief.model_validate(
        {
            **brief.model_dump(),
            "scenario": {"currency": "HKD", "impressions": 1000, "click_rate": "0.02"},
        }
    )
    result = scenario(shaped.scenario)
    assert result.clicks.value == 20 and result.roi.value is None
