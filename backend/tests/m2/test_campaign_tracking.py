from uuid import uuid4

from fastapi.testclient import TestClient

from backend.api.app import create_app
from test_company_workspaces import BASE, DRAFT


def test_registration_tracking_corrections_and_isolation(
    pg_engine, monkeypatch, tmp_path
):
    monkeypatch.setenv("MARKETING_PILOT_PASSWORD", "isolated-workstation")
    app = create_app(engine=pg_engine, evidence_root=tmp_path)
    register = {
        "name": "Test Agency",
        "username": "test-agency",
        "password": "Isolated test only!",
    }
    with TestClient(app, base_url="http://localhost") as client:
        assert client.post(BASE + "/register", json=register).status_code == 403
        monkeypatch.setenv("HARBOURLINE_SELF_REGISTRATION", "1")
        assert (
            client.post(
                BASE + "/register", json={**register, "claim_existing_pilot": True}
            ).status_code
            == 422
        )
        assert (
            client.post(
                BASE + "/register",
                json=register,
                headers={"Origin": "https://unrelated.example"},
            ).status_code
            == 403
        )
        created = client.post(BASE + "/register", json=register)
        assert created.status_code == 201, created.text
        assert client.get(BASE + "/session").json()["id"] == created.json()["id"]
        assert client.get(BASE + "/registry").status_code == 403
        campaign = BASE + "/campaigns/" + str(uuid4())
        assert (
            client.put(campaign, json={"version": 0, "draft": DRAFT}).status_code == 200
        )
        url = campaign + "/tracking"
        assert client.get(url).json()["status"] == "planning"
        assert (
            client.patch(url, json={"version": 0, "status": "active"}).json()["version"]
            == 1
        )
        assert (
            client.patch(url, json={"version": 0, "status": "completed"}).status_code
            == 409
        )
        period = url + "/periods/" + str(uuid4())
        row = {
            "version": 1,
            "channel": "Instagram",
            "source": "=private company statement",
            "authorization_ref": "Company reporting consent",
            "period_start": "2024-01-01",
            "period_end": "2024-01-07",
            "reach": 65,
            "impressions": 100,
            "clicks": 12,
            "conversions": 0,
            "ad_spend_minor": 200,
            "campaign_cost_minor": 300,
            "revenue_minor": 600,
            "contribution_minor": 450,
        }
        report = client.put(period, json=row)
        assert report.status_code == 200, report.text
        data = report.json()
        assert data["version"] == 2
        assert data["actual"]["roas"] == 3
        assert data["actual"]["roi"] == 0.5
        assert data["actual"]["conversions"] == 0
        assert client.put(period, json=row).json()["version"] == 2
        another = url + "/periods/" + str(uuid4())
        assert (
            client.put(
                another, json={**row, "version": 2, "channel": "instagram"}
            ).status_code
            == 409
        )
        row.update(version=2, channel="YouTube")
        del row["clicks"]
        assert client.put(another, json=row).json()["actual"]["clicks"] is None
        assert client.get(url).json()["actual"]["reach"] is None
        assert "Campaign reporting" in client.get(url + "/export").text
        assert "'=private company statement" in client.get(url + "/export").text
        assert client.delete(another + "?version=2").status_code == 409
        removed = client.delete(another + "?version=3").json()
        assert removed["actual"]["clicks"] == 12
        assert removed["actual"]["reach"] == 65
        assert (
            client.put(
                period, json={**row, "version": 4, "period_end": "2023-02-01"}
            ).status_code
            == 422
        )
        client.delete(BASE + "/session")
        assert client.get(url).status_code == 401
        assert (
            client.post(
                BASE + "/register",
                json={**register, "name": "Other", "username": "test-other"},
            ).status_code
            == 201
        )
        assert client.get(url).status_code == 404
        assert client.get(url + "/export").status_code == 404
        assert (
            client.patch(url, json={"version": 4, "status": "completed"}).status_code
            == 404
        )
