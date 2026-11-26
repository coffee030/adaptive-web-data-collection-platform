from datetime import UTC, datetime, timedelta

from backend.experiments.marketing_m2.demo_dataset import demo_payload
from backend.intelligence.catalog import Catalog, detail
from backend.intelligence.contracts import (
    Campaign,
    Content,
    CreatorFilter,
    ImportDataset,
)
from backend.intelligence.discovery import discover
from backend.intelligence.recommend import recommend
from backend.intelligence.retrieval import query_topics, semantic_support
from backend.intelligence.semantic import character_grams, content_key
from backend.intelligence.store import Dataset, Snapshot


def catalog_for(payload, observed=None):
    body = ImportDataset.model_validate(payload)
    grams = {
        content_key(row.text): character_grams(row.text)
        for row in body.records
        if isinstance(row, Content)
    }
    dataset = Dataset("fictional", body, grams, {}, "lexical")
    return Catalog(Snapshot(observed or datetime.now(UTC), [dataset], "test"))


def test_multilingual_discovery_returns_grounded_posts_and_abstains():
    catalog = catalog_for(demo_payload())
    for query in (
        "affordable dining",
        "Hong Kong affordable dining",
        "香港平價茶餐廳",
        "cheap eats",
    ):
        method, matches = discover(catalog, CreatorFilter(query=query), None)
        assert method == "character_tfidf"
        assert {item.creator.id for item in matches} == {"c01", "c19"}
        for match in matches:
            assert match.basis == "reviewed_topic"
            assert "affordable_local_lunch" in match.preview.data.reviewed_facts
    for query in ("sunscreen", "防曬"):
        _, matches = discover(catalog, CreatorFilter(query=query), None)
        assert {item.creator.id for item in matches} == {"c03", "c13"}
    assert {
        m.creator.id
        for m in discover(catalog, CreatorFilter(query="咖啡沖煮"), None)[1]
    } == {"c10"}
    for query in (
        "orbital telescope calibration",
        "Hong Kong orbital telescope calibration",
        "affordable telescope",
    ):
        assert not discover(catalog, CreatorFilter(query=query), None)[1]
    assert not discover(
        catalog, CreatorFilter(query="affordable dining", platform="instagram"), None
    )[1]
    assert query_topics("Launch family dining with a campaign budget of HK$12,000") == {
        "family",
        "dining",
    }


def test_relevance_constraints_and_categories_have_distinct_evidence():
    catalog = catalog_for(demo_payload())
    campaign = Campaign(
        description="Hong Kong affordable dining",
        objective="awareness",
        platform="other",
        deliverable="short_video",
        currency="HKD",
        budget_minor=390000,
        minimum_creators=2,
        maximum_creators=2,
    )
    result = recommend(catalog, campaign, "demo", None)
    assert result.reviewed_count == 20
    assert result.plan.selected == ["c01", "c19"]
    assert result.categories.labels == ["budget", "dining"]
    assert result.exclusions["insufficient_relevant_content"] == 18
    insufficient = recommend(
        catalog, campaign.model_copy(update={"budget_minor": 389999}), "demo", None
    )
    assert insufficient.plan.status == "infeasible"
    required = recommend(
        catalog,
        campaign.model_copy(update={"required_facts": ["unverified_requirement"]}),
        "demo",
        None,
    )
    assert required.exclusions["required_fact_unverified:unverified_requirement"] == 20
    assert not any(row.eligible for row in required.recommendations)
    unrelated = recommend(
        catalog,
        campaign.model_copy(
            update={"description": "Hong Kong orbital telescope calibration"}
        ),
        "demo",
        None,
    )
    assert unrelated.categories.labels == []
    assert unrelated.exclusions["insufficient_relevant_content"] == 20
    assert not any(row.evidence for row in unrelated.recommendations)


def test_semantic_only_support_needs_distinct_documents_and_a_conservative_margin():
    values = {"a": 0.845, "b": 0.74, "c": 0.69, "d": 0.71, "e": 0.67}
    assert semantic_support("granite_int8", values) == {"a"}
    assert semantic_support("character_tfidf", values) == set()
    assert semantic_support("granite_int8", {"first": 0.98}) == set()
    assert semantic_support("granite_int8", {**values, "a": 0.79}) == set()


def test_platform_history_and_expired_quotes_stay_out_of_comparisons_and_plans():
    payload = demo_payload()
    profile = next(row for row in payload["records"] if row["id"] == "c01-profile")
    profile["accounts"].append(
        {"platform": "youtube", "account_id": "additional-account"}
    )
    post = next(row for row in payload["records"] if row["id"] == "p03")
    payload["records"].append(
        {
            **post,
            "id": "video-one",
            "platform": "youtube",
            "account_id": "additional-account",
        }
    )
    observed = datetime.fromisoformat(post["observed_at"])
    published = datetime.fromisoformat(post["published_at"])
    payload["records"].append(
        dict(
            kind="performance",
            id="seven-day-views",
            creator_id="c01",
            evidence_ref="dated-observation",
            observed_at=observed,
            platform="youtube",
            post_id="video-one",
            window_end=published + timedelta(days=7),
            views=1300,
        )
    )
    quote = next(row for row in payload["records"] if row["id"] == "c01-quote")
    without_expiry = catalog_for(payload)
    filtered = discover(without_expiry, CreatorFilter(platform="youtube"), None)[1]
    assert len(filtered) == 1 and len(filtered[0].creator.posts) == 1
    assert filtered[0].creator.active_quotes() == []
    quote["valid_until"] = (observed + timedelta(minutes=15)).isoformat()
    catalog = catalog_for(payload)
    profile = detail(catalog.creators["c01"])
    assert profile.historical is None
    assert profile.historical_by_platform["youtube"].median_views.value == 1300
    assert profile.historical_by_platform["other"].median_views.value is None
    assert profile.quotes == []
    assert profile.audiences == []
    result = recommend(
        catalog,
        Campaign(
            description="affordable dining",
            objective="awareness",
            platform="youtube",
            deliverable="short_video",
            currency="HKD",
            budget_minor=390000,
        ),
        "demo",
        None,
    )
    assert result.reviewed_count == 1
    assert result.exclusions["confirmed_quote_unavailable"] == 1
    assert result.plan.status == "infeasible"
