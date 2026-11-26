from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from test_intelligence import (
    CUSTOMER_TOKEN,
    OP,
    OPERATOR_TOKEN,
    WORKSPACE,
    partner_body,
)

from backend.api.app import create_app
from backend.intelligence.indexing import Indexing
from backend.intelligence.store import Config
from backend.marketing.company_models import MemberRow

BASE = "/api/v1/marketing/companies"
DATA = "/api/v1/marketing/intelligence"
DRAFT = {
    "saved": True,
    "explorer": "",
    "lines": [],
    "shortlist": ["partner-one"],
    "brief": {
        "name": "Tea launch",
        "description": "Research local tea content",
        "objective": "Local awareness",
        "budget": 1200,
        "market": "Hong Kong",
        "language": "yue",
        "platform": "other",
        "deliverable": "short_video",
        "required": "",
        "preferred": "",
        "minAudience": 0,
        "requireCantonese": True,
        "creatorCount": 1,
    },
}


def test_membership_scopes_campaigns_datasets_exports_and_indexing(
    pg_engine, sessions, monkeypatch, tmp_path
):
    monkeypatch.setenv("MARKETING_PILOT_PASSWORD", "fixture-existing-pilot-password")
    monkeypatch.setenv("MARKETING_PARTNER_WORKSPACE", WORKSPACE)
    monkeypatch.setenv("MARKETING_CUSTOMER_TOKEN", CUSTOMER_TOKEN)
    monkeypatch.setenv("MARKETING_OPERATOR_TOKEN", OPERATOR_TOKEN)
    app = create_app(engine=pg_engine, evidence_root=tmp_path)
    password = "Controlled fixture password"
    with TestClient(app, base_url="http://localhost") as client:

        def sign(username):
            return client.post(
                BASE + "/session", json={"username": username, "password": password}
            )

        ids = []
        for name in ("alpha-lunch", "beta-lunch"):
            account = {"name": name, "username": name, "password": password}
            assert client.post(BASE + "/registry", json=account).status_code == 403
            response = client.post(BASE + "/registry", json=account, headers=OP)
            assert response.status_code == 201, response.text
            ids.append(response.json()["id"])
        assert sign("alpha-lunch").status_code == 200
        member = {"username": "account-planner", "password": password, "role": "member"}
        assert client.post(BASE + "/members", json=member).status_code == 201
        assert client.get(BASE + "/registry").status_code == 403
        route = DATA + "/operator/partner/datasets/released?company=" + ids[0]
        data = partner_body()
        assert client.put(route, json=data).status_code == 403
        assert client.put(route, json=data, headers=OP).status_code == 200
        assert len(client.get(DATA + "/partner/creators").json()["creators"]) == 1
        assert client.get(DATA + "/partner/processing").json()["eligible_datasets"] == 1
        campaign = BASE + "/campaigns/" + str(uuid4())
        receipt = client.put(campaign, json={"version": 0, "draft": DRAFT})
        assert receipt.status_code == 200, receipt.text
        assert receipt.json()["version"] == 1
        assert (
            client.put(campaign, json={"version": 0, "draft": DRAFT}).json()["version"]
            == 1
        )
        changed = {**DRAFT, "shortlist": []}
        assert (
            client.put(campaign, json={"version": 0, "draft": changed}).status_code
            == 409
        )
        assert (
            client.put(campaign, json={"version": 1, "draft": changed}).json()[
                "version"
            ]
            == 2
        )
        assert client.get(campaign + "/export?version=1").status_code == 409
        assert "Tea launch" in client.get(campaign + "/export?version=2").text

        assert sign("beta-lunch").status_code == 200
        assert client.get(BASE + "/campaigns").json() == []
        assert client.get(campaign + "/export?version=2").status_code == 404
        assert client.get(DATA + "/partner/creators").json()["creators"] == []
        assert client.get(DATA + "/partner/processing").json()["eligible_datasets"] == 0
        assert (
            client.get(
                DATA + "/partner/creators", headers={"X-Harbourline-Company": ids[0]}
            ).status_code
            == 409
        )
        assert sign("account-planner").status_code == 200
        assert client.get(BASE + "/members").status_code == 403
        assert (
            client.get(BASE + "/campaigns").json()[0]["draft"]["brief"]["name"]
            == "Tea launch"
        )
        member_cookie = client.cookies.get("harbourline_company_session")
        client.cookies.clear()
        assert sign("alpha-lunch").status_code == 200
        assert client.delete(BASE + "/members/account-planner").status_code == 204
        client.cookies.clear()
        client.cookies.set("harbourline_company_session", member_cookie)
        assert client.get(BASE + "/campaigns").status_code == 401
        assert client.get(campaign + "/export?version=2").status_code == 401
        assert client.get(DATA + "/partner/creators").status_code == 401
        client.cookies.clear()
        assert sign("account-planner").status_code == 401
        assert sign("alpha-lunch").status_code == 200
        assert client.delete(BASE + "/session").status_code == 204
        assert client.get(BASE + "/campaigns").status_code == 401
        with sessions() as session:
            indexer = Indexing(
                sessions, Config(model_dir=tmp_path, workspace=WORKSPACE)
            )
            assert set(indexer.enabled_scopes(session)) == {
                ("partner", work) for work in [WORKSPACE, *ids]
            }
            assert all(
                password not in value
                for value in session.scalars(select(MemberRow.password_hash))
            )


def test_upgrade_claim_preserves_catalog_and_ends_shared_customer_access(
    pg_engine, tmp_path, monkeypatch
):
    monkeypatch.setenv("MARKETING_PILOT_PASSWORD", "old-pilot-signin-for-upgrade")
    monkeypatch.setenv("MARKETING_PARTNER_WORKSPACE", WORKSPACE)
    monkeypatch.setenv("MARKETING_CUSTOMER_TOKEN", CUSTOMER_TOKEN)
    monkeypatch.setenv("MARKETING_OPERATOR_TOKEN", OPERATOR_TOKEN)
    shared = {"Authorization": "Bearer " + CUSTOMER_TOKEN}
    app = create_app(engine=pg_engine, evidence_root=tmp_path)
    with TestClient(app, base_url="http://localhost") as client:
        dataset = DATA + "/operator/partner/datasets/enrolled"
        assert client.put(dataset, headers=OP, json=partner_body()).status_code == 200
        body = {
            "username": "upgrade-owner",
            "password": "controlled-upgrade-pass",
            "name": "Earlier pilot",
            "claim_existing_pilot": True,
        }
        assert (
            client.post(BASE + "/registry", json=body, headers=OP).json()["id"]
            == WORKSPACE
        )
        assert client.get(DATA + "/partner/creators", headers=shared).status_code == 403
        assert client.get(dataset, headers=OP).status_code == 409
        assert (
            client.get(dataset + "?company=" + WORKSPACE, headers=OP).status_code == 200
        )
        assert (
            client.post(
                BASE + "/session",
                json={key: body[key] for key in ["username", "password"]},
            ).status_code
            == 200
        )
        assert len(client.get(DATA + "/partner/creators").json()["creators"]) == 1
        assert client.get("/api/v1/sources").status_code == 401
