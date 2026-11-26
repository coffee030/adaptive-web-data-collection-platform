from uuid import uuid4

from fastapi.testclient import TestClient
from test_company_workspaces import BASE, DATA, DRAFT
from test_intelligence import (
    BRIEF,
    CUSTOMER_TOKEN,
    OP,
    OPERATOR_TOKEN,
    WORKSPACE,
    demo_body,
    grant,
    timestamps,
)

from backend.api.app import create_app
from backend.intelligence.contracts import ORIGINS


def test_saved_allocation_requires_current_source_permissions(
    pg_engine, monkeypatch, tmp_path
):
    monkeypatch.setenv("MARKETING_PILOT_PASSWORD", "controlled-local-workspace")
    monkeypatch.setenv("MARKETING_PARTNER_WORKSPACE", WORKSPACE)
    monkeypatch.setenv("MARKETING_CUSTOMER_TOKEN", CUSTOMER_TOKEN)
    monkeypatch.setenv("MARKETING_OPERATOR_TOKEN", OPERATOR_TOKEN)
    app = create_app(engine=pg_engine, evidence_root=tmp_path)
    with TestClient(app, base_url="http://localhost") as client:
        credentials = {
            "username": "allocation-planner",
            "password": "controlled-test-login",
        }
        company = client.post(
            BASE + "/registry",
            json={**credentials, "name": "Allocation test"},
            headers=OP,
        )
        assert company.status_code == 201
        assert client.post(BASE + "/session", json=credentials).status_code == 200
        _, end = timestamps()
        sources = DATA + "/operator/partner/datasets/"
        for record in demo_body()["records"]:
            if record["creator_id"] not in ("a", "b") or record["id"] == "a-post-copy":
                continue
            permission = grant(
                ORIGINS[record["kind"]],
                end,
                record["creator_id"],
                pilot_analytics=True,
                commercial_display=True,
                company_plan_export=True,
            )
            response = client.put(
                sources + record["id"],
                params={"company": company.json()["id"]},
                headers=OP,
                json={"grant": permission, "records": [record]},
            )
            assert response.status_code == 200, response.text
        uri = BASE + "/campaigns/" + str(uuid4())
        assert (
            client.put(
                uri, json={"version": 0, "draft": {**DRAFT, "evaluation": BRIEF}}
            ).status_code
            == 200
        )
        report = client.post(DATA + "/partner/campaign-briefs", json=BRIEF).json()
        assert report["plan"]["selected"] == ["a", "b"]
        receipt = report["allocation_export_receipt"]
        url = uri + "/export"
        approved = client.get(url, params={"version": 1, "allocation": receipt})
        assert approved.status_code == 200
        assert "receipt-a-quote" in approved.text and "receipt-b-post" in approved.text
        assert "Selected creator" not in client.get(url, params={"version": 1}).text
        assert (
            client.get(url, params={"version": 1, "allocation": "0" * 64}).status_code
            == 409
        )
        assert (
            client.delete(
                sources + "a-quote",
                params={"company": company.json()["id"]},
                headers=OP,
            ).status_code
            == 204
        )
        assert (
            client.get(url, params={"version": 1, "allocation": receipt}).status_code
            == 409
        )
        extra = next(r for r in demo_body()["records"] if r["id"] == "a-post-copy")
        permission = grant(
            "creator_authored", end, "a", pilot_analytics=True, commercial_display=True
        )
        limited = client.put(
            sources + "new-post",
            params={"company": company.json()["id"]},
            headers=OP,
            json={"grant": permission, "records": [extra]},
        )
        assert limited.status_code == 200
        assert (
            client.post(DATA + "/partner/campaign-briefs", json=BRIEF).json()[
                "allocation_export_receipt"
            ]
            is None
        )
        assert (
            client.get(url, params={"version": 1, "allocation": receipt}).status_code
            == 403
        )
