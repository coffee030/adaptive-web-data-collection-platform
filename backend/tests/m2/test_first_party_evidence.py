from copy import deepcopy
from datetime import UTC, datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.api.app import create_app
from test_company_workspaces import BASE, DRAFT
from test_intelligence import (
    CUSTOMER_TOKEN,
    OP,
    OPERATOR_TOKEN,
    WORKSPACE,
    partner_body,
)


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


def test_performance_receipts_compare_exact_instants_and_keep_other_windows(
    pg_engine, tmp_path, monkeypatch
):
    monkeypatch.setenv("MARKETING_PILOT_PASSWORD", "local-test-company")
    monkeypatch.setenv("MARKETING_PARTNER_WORKSPACE", WORKSPACE)
    monkeypatch.setenv("MARKETING_OPERATOR_TOKEN", OPERATOR_TOKEN)
    monkeypatch.setenv("MARKETING_CUSTOMER_TOKEN", CUSTOMER_TOKEN)
    monkeypatch.setenv("HARBOURLINE_SELF_REGISTRATION", "1")
    base = "/api/v1/marketing/intelligence"
    app = create_app(engine=pg_engine, evidence_root=tmp_path)
    with TestClient(app, base_url="http://localhost") as client:
        owner = client.post(
            BASE + "/register",
            json={
                "name": "Window verification",
                "username": "window-owner",
                "password": "QA controlled password.",
            },
        ).json()["id"]
        scope = {"company": owner}
        profile = partner_body()
        creator = profile["records"][0]["creator_id"]
        account = profile["records"][0]["accounts"][0]
        url = base + "/operator/partner/receipts"
        lookup = base + "/operator/partner/performance-window"
        post_id = "fixed-window-post"
        target = {
            **scope,
            "creator_id": creator,
            "platform": account["platform"],
            "post_id": post_id,
        }
        assert client.get(lookup, params=target).status_code == 403
        assert (
            client.get(lookup, params=target, headers=OP).json()["status"]
            == "content_unavailable"
        )
        assert client.post(url, params=scope, headers=OP, json=profile).is_success
        start = (
            datetime.now(timezone(timedelta(hours=8))) - timedelta(days=11)
        ).replace(hour=8, minute=30, second=45, microsecond=123456)
        cutoff = start + timedelta(days=7)
        observed = (cutoff + timedelta(hours=1)).isoformat()

        def submit(kind, origin, identifier, publisher=creator, **values):
            response = client.post(
                url,
                params=scope,
                headers=OP,
                json={
                    "grant": {
                        **profile["grant"],
                        "origin": origin,
                        "owner_ref": publisher,
                    },
                    "records": [
                        {
                            "kind": kind,
                            "id": identifier,
                            "creator_id": publisher,
                            "platform": account["platform"],
                            "evidence_ref": "evidence-" + identifier,
                            "observed_at": observed,
                            **values,
                        }
                    ],
                },
            )
            assert response.status_code == 200
            return response.json()

        content = submit(
            "content",
            "creator_authored",
            post_id,
            account_id=account["account_id"],
            text="Controlled transport review",
            published_at=start.isoformat(),
        )
        second = deepcopy(profile)
        second_creator = "second-owner"
        second["grant"]["owner_ref"] = second_creator
        second["records"][0].update(
            id="second-profile",
            creator_id=second_creator,
            name="Second publisher",
            accounts=[
                {"platform": account["platform"], "account_id": "second-account"}
            ],
        )
        assert client.post(url, params=scope, headers=OP, json=second).is_success
        second_publication = {
            "kind": "content",
            "id": post_id,
            "creator_id": second_creator,
            "account_id": "second-account",
            "platform": account["platform"],
            "text": "Second publication",
            "evidence_ref": "second-publication",
            "published_at": start.isoformat(),
            "observed_at": observed,
        }
        payload = {
            "grant": {**second["grant"], "origin": "creator_authored"},
            "records": [second_publication],
        }
        rejected = client.post(url, params=scope, headers=OP, json=payload)
        assert (
            rejected.status_code == 409
            and rejected.json()["error"]["code"] == "duplicate_post_identity"
        )
        second_publication["id"] = "second-publication"
        assert client.post(url, params=scope, headers=OP, json=payload).is_success
        wrong_publication = submit(
            "performance",
            "creator_first_party_performance",
            "wrong-owner-post",
            publisher=second_creator,
            post_id=post_id,
            window_end=cutoff.isoformat(),
            views=13000,
        )
        assert (
            wrong_publication["performance_window"]["status"] == "content_unavailable"
        )
        assert (
            client.get(
                lookup, params={**target, "creator_id": second_creator}, headers=OP
            ).json()["status"]
            == "content_unavailable"
        )
        second_measurement = submit(
            "performance",
            "creator_first_party_performance",
            "second-measurement",
            publisher=second_creator,
            post_id=second_publication["id"],
            window_end=cutoff.isoformat(),
            views=250,
        )
        assert second_measurement["performance_window"]["status"] == "matches"
        second_history = client.get(
            base + "/partner/creators/" + second_creator
        ).json()["historical_by_platform"][account["platform"]]
        assert second_history["median_views"] == {
            "status": "calculated",
            "value": "250",
            "observations": 1,
        }
        linked = client.get(lookup, params=target, headers=OP).json()
        assert linked["status"] == "linked"
        assert datetime.fromisoformat(linked["published_at"]) == start
        assert datetime.fromisoformat(linked["expected_window_end"]) == cutoff
        assert (
            client.get(
                lookup, params={**target, "creator_id": "other"}, headers=OP
            ).json()["status"]
            == "content_unavailable"
        )
        adjacent = cutoff - timedelta(microseconds=1)
        later = submit(
            "performance",
            "creator_first_party_performance",
            "actual-short",
            post_id=post_id,
            window_end=adjacent.isoformat(),
            views=9000,
        )
        assert later["performance_window"]["status"] == "other_window"
        assert (
            datetime.fromisoformat(later["performance_window"]["reported_window_end"])
            == adjacent
        )
        exact = submit(
            "performance",
            "creator_first_party_performance",
            "actual-seven",
            post_id=post_id,
            window_end=cutoff.astimezone(UTC).isoformat(),
            views=700,
            likes=21,
            comments=7,
        )
        assert exact["performance_window"]["status"] == "matches"
        result = client.get(base + "/partner/creators/" + creator).json()
        measured = result["historical_by_platform"][account["platform"]]
        assert measured["median_views"] == {
            "status": "calculated",
            "value": "700",
            "observations": 1,
        }
        assert measured["interaction_rate"]["value"] == "0.04"
        assert result["posts"][0]["other_window"]["data"]["views"] == 9000
        assert (
            result["posts"][0]["performance"]["evidence"]["reference"]
            == "evidence-actual-seven"
        )
        assert client.delete(
            base + "/operator/partner/datasets/" + content["dataset_id"],
            params=scope,
            headers=OP,
        ).is_success
        assert (
            client.get(lookup, params=target, headers=OP).json()["status"]
            == "content_unavailable"
        )
        assert client.get(base + "/partner/creators/" + creator).json()["posts"] == []
