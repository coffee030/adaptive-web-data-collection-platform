from copy import deepcopy
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.api.app import create_app
from test_company_workspaces import BASE, DRAFT
from test_intelligence import CUSTOMER_TOKEN, OP, OPERATOR_TOKEN, WORKSPACE, partner_body


def test_reviewed_receipts_cannot_claim_another_company_or_overwrite_evidence(
    pg_engine, tmp_path, monkeypatch
):
    monkeypatch.setenv("MARKETING_PILOT_PASSWORD", "local-test-company")
    monkeypatch.setenv("MARKETING_PARTNER_WORKSPACE", WORKSPACE)
    monkeypatch.setenv("MARKETING_OPERATOR_TOKEN", OPERATOR_TOKEN)
    monkeypatch.setenv("MARKETING_CUSTOMER_TOKEN", CUSTOMER_TOKEN)
    monkeypatch.setenv("HARBOURLINE_SELF_REGISTRATION", "1")
    app = create_app(engine=pg_engine, evidence_root=tmp_path)
    with TestClient(app, base_url="http://localhost") as client:
        user = client.post(
            BASE + "/register",
            json={
                "name": "Controlled first-party review",
                "username": "approved-test",
                "password": "Local test credential.",
            },
        ).json()
        base = "/api/v1/marketing/intelligence"
        url = base + "/operator/partner/receipts?company=" + user["id"]
        body = partner_body()
        body["records"][0]["source_url"] = "https://example.org/controlled-profile"
        assert client.post(url, json=body).status_code == 403
        published = client.post(url, json=body, headers=OP)
        assert published.status_code == 200, published.text
        assert client.post(url, json=body, headers=OP).json() == published.json()
        modified = deepcopy(body)
        modified["records"][0]["description"] = "Different evidence"
        assert client.post(url, json=modified, headers=OP).status_code == 409
        modified["records"][0]["source_url"] = "https://demo:secret@example.org/unused"
        assert client.post(url, json=modified, headers=OP).status_code == 422
        detail = client.get(base + "/partner/creators/partner-one")
        assert detail.status_code == 200
        assert "https://example.org/controlled-profile" in detail.text
        campaign = BASE + "/campaigns/" + str(uuid4())
        assert (
            client.put(campaign, json={"version": 0, "draft": DRAFT}).status_code == 200
        )
        denied = client.get(campaign + "/rate-request?version=1")
        assert (
            denied.status_code == 409
            and denied.json()["error"]["code"] == "no_current_leads"
        )
        client.delete(
            base
            + "/operator/partner/datasets/"
            + published.json()["dataset_id"]
            + "?company="
            + user["id"],
            headers=OP,
        )
        assert client.get(base + "/partner/creators/partner-one").status_code == 404
        assert client.post(url, json=body, headers=OP).status_code == 409
