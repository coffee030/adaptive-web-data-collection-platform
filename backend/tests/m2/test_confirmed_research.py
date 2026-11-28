from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta
import json
from pathlib import Path
from threading import Barrier
from uuid import UUID, uuid4

from alembic import command
from alembic.config import Config as AlembicConfig
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from conftest import ROOT
from test_company_research import advance

from backend.api.app import create_app
from backend.application.jobs import database_now
from backend.intelligence import research_analysis, research_preparation
from backend.intelligence.research_contracts import NewResearch
from backend.intelligence.research_models import ResearchRunRow
from backend.intelligence.research_preparation import prepare
from backend.intelligence.research_runs import ResearchRuns, change, owned, start
from backend.intelligence.store import Config
from backend.marketing.company_api import add_member, Credentials
from backend.marketing.company_models import CompanyCampaignRow, CompanyRow
from backend.marketing.store import MarketingError
from backend.tests.test_research_preparation import (
    confirmed_request,
    preparation,
    research_fixture,
)


BASE = "/api/v1/marketing/companies"
RUNS = BASE + "/research-runs"


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


def run_count(sessions):
    with sessions() as session:
        return session.scalar(select(func.count()).select_from(ResearchRunRow))


def migrate(engine, target, *, downgrade=False):
    config = AlembicConfig(ROOT / "alembic.ini")
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        (command.downgrade if downgrade else command.upgrade)(config, target)
        if target == "head":
            command.check(config)


@pytest.mark.parametrize("pg_engine", ["0033"], indirect=True)
def test_upgrade_keeps_actual_legacy_digest_and_brief(pg_engine, sessions):
    fixture = research_fixture()
    brief = preparation().brief.model_dump(mode="json")
    run_id, request_key = uuid4(), uuid4()
    with pg_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO marketing_companies (id, name) VALUES ('one', 'Company One')"
            )
        )
        connection.execute(
            text("""
            INSERT INTO company_research_runs
                (id, company_id, request_key, brief, state, created_at,
                 updated_at, due_at, attempts, sources, revision)
            VALUES (:id, 'one', :key, CAST(:brief AS jsonb), 'ready', now(),
                    now(), now(), 0, '[]', :revision)
        """),
            {
                "id": run_id,
                "key": request_key,
                "brief": json.dumps(brief),
                "revision": fixture["legacy_report_revision"],
            },
        )
    migrate(pg_engine, "head")
    workspace = ResearchRuns(sessions, Config())
    with sessions.begin() as session:
        row = owned(session, "one", run_id)
        assert row.brief == brief
        assert row.revision == fixture["legacy_report_revision"]
        assert row.criteria_version is None and row.confirmed_criteria is None
        receipt = start(
            session,
            "one",
            NewResearch(brief=preparation().brief, request_key=request_key),
        )
        assert receipt["id"] == run_id
        assert "confirmed_criteria" not in receipt
        report = workspace.results(session, "one", run_id)
        assert report["research"]["publication_window_days"] == 90
        assert "criteria_version" not in report
    migrate(pg_engine, "0033", downgrade=True)
    migrate(pg_engine, "head")


def test_confirmed_retry_worker_and_report_use_persisted_snapshot(
    workspace, monkeypatch
):
    text = "Find affordable dining creators 最近30日. Exclude Facebook."
    proposal = prepare("one", preparation(text))
    submission = confirmed_request(proposal)
    with workspace.sessions.begin() as session:
        receipt = start(session, "one", submission)
        run_id = receipt["id"]
        row = owned(session, "one", run_id)
        assert row.criteria_version == "research-criteria-v1"
        assert row.confirmed_criteria["proposal"] == proposal.model_dump(
            mode="json", exclude={"execution"}
        )
        assert row.brief == submission.brief.model_dump(mode="json")
        assert "request_fingerprint" not in receipt["confirmed_criteria"]

    def resolver_retired(*args, **kwargs):
        pytest.fail("execution or exact replay invoked the active resolver")

    monkeypatch.setattr(
        research_preparation, "resolve_research_criteria", resolver_retired
    )
    with workspace.sessions.begin() as session:
        assert start(session, "one", submission) == receipt
        for changed in (
            confirmed_request(
                proposal, request_key=submission.request_key, provenance={}
            ),
            NewResearch(brief=submission.brief, request_key=submission.request_key),
        ):
            with pytest.raises(MarketingError) as issue:
                start(session, "one", changed)
            assert issue.value.code == "research_request_changed"
        with pytest.raises(MarketingError) as issue:
            owned(session, "two", run_id)
        assert issue.value.status == 404

    with workspace.sessions() as session:
        today = database_now(session).replace(hour=0, minute=0, second=0, microsecond=0)
    records = []
    for item in research_fixture()["public_evidence"]:
        age = item["age_days"]
        records.append(
            {
                "id": item["id"],
                "creator_name": "Controlled creator",
                "creator_id": item["id"],
                "platform": item["platform"],
                "title": "Affordable dining",
                "url": "https://example.invalid/work",
                "profile_url": "https://example.invalid/creator",
                "observed_at": today.isoformat(),
                "published_at": (today - timedelta(days=age)).isoformat()
                if age is not None
                else None,
                "topics": ["affordable dining"],
                "license_url": "https://example.invalid/license",
            }
        )
    monkeypatch.setattr(
        research_analysis.market_catalog,
        "search_activity",
        lambda *args, **kwargs: {"items": records},
    )
    for expected in ("collecting", "analyzing", "ready"):
        advance(workspace)
        with workspace.sessions() as session:
            assert owned(session, "one", run_id).state == expected
    with workspace.sessions() as session:
        result = workspace.results(session, "one", run_id)
        assert result["confirmed_criteria"] == receipt["confirmed_criteria"]
        research = result["research"]
        assert research["publication_window_days"] == 30
        assert {item["id"]: item["tier"] for item in research["examples"]} == {
            "inside-limit": "direct",
            "outside-limit": "context",
            "unknown-age": "context",
        }
    records[0]["title"] = "Affordable dining: a new title"
    with workspace.sessions() as session, pytest.raises(MarketingError) as issue:
        workspace.results(session, "one", run_id)
    assert issue.value.code == "research_evidence_changed"
    with workspace.sessions.begin() as session:
        row = owned(session, "one", run_id, lock=True)
        row.revision = "superseded"
    with workspace.sessions() as session, pytest.raises(MarketingError) as issue:
        workspace.results(session, "one", run_id)
    assert issue.value.code == "research_evidence_changed"
    with workspace.sessions.begin() as session:
        assert (
            change(session, "one", run_id, "resume")["criteria_version"]
            == "research-criteria-v1"
        )
        row = owned(session, "one", run_id, lock=True)
        modified = deepcopy(row.confirmed_criteria)
        modified["proposal"]["finalized"]["criteria"]["max_evidence_age_days"] = 90
        row.confirmed_criteria = modified
    advance(workspace)
    with workspace.sessions() as session:
        row = owned(session, "one", run_id)
        assert (row.state, row.error) == ("failed", "research_snapshot_invalid")


def test_concurrent_replay_is_atomic_and_snapshot_pair_is_enforced(
    workspace, pg_engine
):
    request = confirmed_request(prepare("one", preparation()))
    barrier = Barrier(2, timeout=10)

    def submit():
        barrier.wait()
        with workspace.sessions.begin() as session:
            return start(session, "one", request)["id"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = pool.submit(submit), pool.submit(submit)
        run_id = first.result()
        assert second.result() == run_id
    assert run_count(workspace.sessions) == 1
    with pytest.raises(IntegrityError), workspace.sessions.begin() as session:
        owned(session, "one", run_id).confirmed_criteria = None
    with pytest.raises(DBAPIError, match="confirmed research runs exist"):
        migrate(pg_engine, "0033", downgrade=True)


def test_authenticated_api_preview_and_confirm(
    pg_engine, sessions, monkeypatch, tmp_path
):
    monkeypatch.setenv("MARKETING_PILOT_PASSWORD", "controlled-local-pilot")
    monkeypatch.setenv("HARBOURLINE_SELF_REGISTRATION", "1")
    app = create_app(engine=pg_engine, evidence_root=tmp_path)
    with (
        TestClient(app, base_url="http://localhost") as client,
        TestClient(app, base_url="http://localhost") as other,
    ):

        def register(browser, name):
            response = browser.post(
                BASE + "/register",
                json={
                    "name": name,
                    "username": name,
                    "password": "fixture-only-password",
                },
            )
            assert response.status_code == 201, response.text
            return response.json()["id"]

        request = preparation().model_dump(mode="json")
        assert client.post(RUNS + "/preview", json=request).status_code == 401
        register(client, "alpha-criteria")
        beta = register(other, "beta-criteria")
        preview = client.post(RUNS + "/preview", json=request)
        assert preview.status_code == 200, preview.text
        assert "no-store" in preview.headers["cache-control"]
        proposal = preview.json()
        confirm = {
            "action": "confirm",
            "version": proposal["finalized"]["version"],
            "proposal_fingerprint": proposal["fingerprint"],
        }
        body = request | {"request_key": str(uuid4())}
        unresolved = preparation(
            "Find affordable dining in the past 2 months"
        ).model_dump(mode="json")
        pending = client.post(RUNS + "/preview", json=unresolved).json()
        unresolved_confirmation = confirm | {
            "proposal_fingerprint": pending["fingerprint"]
        }
        response = client.post(
            RUNS,
            json=unresolved
            | {"request_key": str(uuid4()), "confirmation": unresolved_confirmation},
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "research_criteria_unresolved"
        assert client.post(RUNS, json=body).status_code == 422
        assert client.post(RUNS, json=body | {"confirmation": True}).status_code == 422
        assert (
            client.post(
                RUNS,
                json=body
                | {"confirmation": confirm | {"proposal_fingerprint": "0" * 64}},
            ).status_code
            == 409
        )
        assert (
            other.post(RUNS, json=body | {"confirmation": confirm}).status_code == 409
        )
        foreign_campaign = uuid4()
        with sessions.begin() as session:
            session.add(
                CompanyCampaignRow(
                    company_id=beta,
                    id=foreign_campaign,
                    version=1,
                    draft={},
                    updated_at=database_now(session),
                )
            )
        linked = request | {"campaign_id": str(foreign_campaign)}
        link_preview = client.post(RUNS + "/preview", json=linked)
        assert link_preview.status_code == 200
        denied = client.post(
            RUNS,
            json=linked
            | {
                "request_key": str(uuid4()),
                "confirmation": confirm
                | {"proposal_fingerprint": link_preview.json()["fingerprint"]},
            },
        )
        assert denied.status_code == 404
        assert denied.json()["error"]["code"] == "campaign_unavailable"
        assert run_count(sessions) == 0

        body |= {"confirmation": confirm}
        response = client.post(RUNS, json=body)
        assert response.status_code == 200, response.text
        receipt = response.json()
        assert receipt["state"] == "queued"
        assert proposal["execution"] == {"status": "ready", "issues": []}
        assert receipt["confirmed_criteria"]["proposal"] == {
            name: value for name, value in proposal.items() if name != "execution"
        }
        assert client.post(RUNS, json=body).json() == receipt
        run = RUNS + "/" + receipt["id"]
        assert client.get(run).json() == receipt
        assert other.get(run).status_code == 404
        assert other.get(run + "/results").status_code == 404
        assert other.get(RUNS).json() == []
        assert run_count(sessions) == 1


@pytest.mark.parametrize(
    ("description", "code", "scope"),
    [
        (
            "Find affordable dining creators, not Instagram.",
            "main_platform_required",
            "single",
        ),
        ("Compare YouTube and Instagram", "comparison_primary_required", "comparison"),
        ("Compare Instagram and YouTube", "comparison_primary_required", "comparison"),
    ],
)
def test_api_blocks_non_executable_ready_preview_until_explicit_decision(
    pg_engine, sessions, monkeypatch, tmp_path, description, code, scope
):
    monkeypatch.setenv("MARKETING_PILOT_PASSWORD", "controlled-local-pilot")
    monkeypatch.setenv("HARBOURLINE_SELF_REGISTRATION", "1")
    with TestClient(
        create_app(engine=pg_engine, evidence_root=tmp_path),
        base_url="http://localhost",
    ) as client:
        assert (
            client.post(
                BASE + "/register",
                json={
                    "name": "Scope fixture",
                    "username": "scope-fixture",
                    "password": "fixture-only-password",
                },
            ).status_code
            == 201
        )
        original = preparation(
            description,
            provenance={
                "platform": "application_default",
                "alternative_platforms": "application_default",
                "deliverable": "application_default",
            },
        ).model_dump(mode="json")
        response = client.post(RUNS + "/preview", json=original)
        assert response.status_code == 200, response.text
        blocked = response.json()
        assert blocked["initial"] == blocked["finalized"]
        assert blocked["initial"]["status"] == "ready"
        assert blocked["effective_brief"] is None
        assert blocked["execution"]["status"] == "blocked"
        (issue,) = blocked["execution"]["issues"]
        assert (
            issue["field"] == "platform"
            and issue["code"] == code
            and "Choose" in issue["action"]
        )
        no_primary = scope == "single"
        if no_primary:
            assert blocked["initial"]["fields"]["platform"]["state"] == "absent"
            assert blocked["initial"]["criteria"]["excluded_platforms"] == ["instagram"]
        else:
            assert blocked["initial"]["criteria"]["platform_intent"] == "comparison"
            assert blocked["initial"]["assumptions"]
        assert run_count(sessions) == 0
        confirmation = {
            "action": "confirm",
            "version": blocked["finalized"]["version"],
            "proposal_fingerprint": blocked["fingerprint"],
        }
        denied = client.post(
            RUNS,
            json=original | {"request_key": str(uuid4()), "confirmation": confirmation},
        )
        assert denied.status_code == 422
        assert denied.json()["error"]["code"] == "research_criteria_unresolved"
        assert denied.json()["error"]["issues"] == [issue]
        assert run_count(sessions) == 0

        decision = {
            "platforms": {
                "platform": "youtube",
                "alternative_platforms": [] if no_primary else ["instagram"],
                "platform_intent": scope,
                "excluded_platforms": ["instagram"] if no_primary else [],
            }
        }
        revised = original | {"decisions": decision}
        preview = client.post(RUNS + "/preview", json=revised)
        assert preview.status_code == 200, preview.text
        executable = preview.json()
        assert executable["execution"] == {"status": "ready", "issues": []}
        assert executable["initial"] == blocked["initial"]
        assert executable["effective_brief"]["campaign"]["platform"] == "youtube"
        assert (
            executable["finalized"]["criteria"]["excluded_platforms"]
            == decision["platforms"]["excluded_platforms"]
        )
        request = revised | {"request_key": str(uuid4())}
        stale = client.post(RUNS, json=request | {"confirmation": confirmation})
        assert (
            stale.status_code == 409
            and stale.json()["error"]["code"] == "research_confirmation_stale"
        )
        assert run_count(sessions) == 0
        accepted = client.post(
            RUNS,
            json=request
            | {
                "confirmation": confirmation
                | {"proposal_fingerprint": executable["fingerprint"]}
            },
        )
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["state"] == "queued"
        assert run_count(sessions) == 1


def test_pre_correction_confirmed_v1_snapshot_replays_and_preserves_report(
    pg_engine, sessions, monkeypatch, tmp_path
):
    fixture = json.loads(
        (
            Path(__file__).parents[1] / "fixtures" / "pr26b_pre_correction_v1.json"
        ).read_text(encoding="utf-8")
    )
    company, submission, snapshot = (
        fixture[key] for key in ("company_id", "submission", "snapshot")
    )
    run_id = uuid4()
    version = snapshot["confirmation"]["version"]
    captured = datetime.fromisoformat(snapshot["confirmed_at"])
    credentials = {"username": "v1-fixture-member", "password": "fixture-only-password"}
    with sessions.begin() as session:
        session.add(CompanyRow(id=company, name="Compatibility fixture"))
        session.flush()
        add_member(session, company, Credentials(**credentials), "admin")
        session.add(
            ResearchRunRow(
                id=run_id,
                company_id=company,
                request_key=UUID(submission["request_key"]),
                brief=submission["brief"],
                criteria_version=version,
                confirmed_criteria=snapshot,
                state="ready",
                created_at=captured,
                updated_at=captured,
                due_at=captured,
                attempts=0,
                sources=[],
                revision=fixture["report_revision"],
            )
        )

    monkeypatch.setenv("MARKETING_PILOT_PASSWORD", "controlled-local-pilot")
    app = create_app(engine=pg_engine, evidence_root=tmp_path)
    path = RUNS + "/" + str(run_id)
    with TestClient(app, base_url="http://localhost") as client:
        assert client.post(BASE + "/session", json=credentials).status_code == 200
        old_confirmation = submission | {"request_key": str(uuid4())}
        new = client.post(RUNS, json=old_confirmation)
        assert (
            new.status_code == 409
            and new.json()["error"]["code"] == "research_confirmation_stale"
        )

        def must_not_resolve(*args, **kwargs):
            pytest.fail("Stored snapshot interpretation called the active resolver")

        monkeypatch.setattr(
            research_preparation, "resolve_research_criteria", must_not_resolve
        )
        receipt = client.get(path)
        assert receipt.status_code == 200, receipt.text
        prior = receipt.json()
        assert prior["confirmed_criteria"]["proposal"] == snapshot["proposal"]
        assert client.post(RUNS, json=submission).json() == prior
        changed = client.post(RUNS, json=submission | {"provenance": {}})
        assert (
            changed.status_code == 409
            and changed.json()["error"]["code"] == "research_request_changed"
        )
        report = client.get(path + "/results")
        assert report.status_code == 200, report.text
        assert [item["platform"] for item in report.json()["strategies"]] == fixture[
            "expected_platforms"
        ]
        assert client.post(path + "/resume").json()["state"] == "queued"

        workspace = ResearchRuns(sessions, Config())
        for expected in ("collecting", "analyzing", "ready"):
            advance(workspace)
            assert client.get(path).json()["state"] == expected
        after = client.get(path + "/results")
        assert after.status_code == 200, after.text
        assert [item["platform"] for item in after.json()["strategies"]] == fixture[
            "expected_platforms"
        ]
        with sessions() as session:
            row = owned(session, company, run_id)
            assert row.revision == fixture["report_revision"]
            assert row.confirmed_criteria == snapshot
