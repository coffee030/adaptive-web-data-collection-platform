from datetime import UTC, datetime, timedelta

from backend.intelligence.research_contracts import BusinessBrief
from backend.intelligence.research_match import classify, evidence_intent


NOW = datetime(2026, 11, 26, tzinfo=UTC)


def brief(description, product, platform, deliverable="social_post", **options):
    return BusinessBrief.model_validate(
        {
            "campaign": {
                "description": description,
                "objective": "awareness",
                "budget_minor": 5000000,
                "currency": "HKD",
                "platform": platform,
                "deliverable": deliverable,
            },
            "product": product,
            "audience": "Hong Kong residents",
            **options,
        }
    )


def test_specific_product_is_required_before_ranking_and_recent_channel_work_can_pass():
    b = brief(
        "Find Cantonese Hong Kong creators producing current skincare and sunscreen reviews for a local sunscreen launch. Compare recent Instagram short videos, organic engagement and available audience evidence. Identify gaps for a firm quote.",
        "Local sunscreen",
        "instagram",
    )
    decision = evidence_intent(b, "beauty sun_protection")
    taxon = {
        "title": "Kochi’s Beauty Berry",
        "platform": "iNaturalist",
        "source_key": "inaturalist",
        "topics": ["Plants", "Nature"],
        "published_at": "2026-01-20",
    }
    assert classify(taxon, decision, NOW) is None
    matched = {
        "title": "Cantonese short video review of facial SPF moisturiser",
        "platform": "Instagram",
        "topics": ["護膚", "防曬"],
        "published_at": (NOW - timedelta(days=3)).isoformat(),
    }
    assert classify(matched, decision, NOW) == {"tier": "direct", "scope_notes": []}
    for field, value, reason in [
        ("platform", "PeerTube", "Outside the requested channel"),
        ("published_at", "2025-01-20", "Outside the requested publication window"),
    ]:
        weak = classify({**matched, field: value}, decision, NOW)
        assert weak["tier"] == "context" and reason in weak["scope_notes"]
    unrelated = {
        **matched,
        "title": "Cantonese short video review of botanical Beauty Berry",
        "topics": ["Plants"],
    }
    assert classify(unrelated, decision, NOW) is None


def test_historical_menu_is_context_and_multilingual_direct_evidence_survives():
    b = brief(
        "Find affordable Hong Kong dining videos on YouTube",
        "Neighbourhood dining",
        "youtube",
        "dedicated_video",
    )
    decision = evidence_intent(b, "affordable dining")
    menu = {
        "basis": "historical_cost",
        "title": "Rice menu",
        "platform": "Wikimedia Commons",
        "published_at": "2013-04-07",
    }
    classification = classify(menu, decision, NOW, historical=True)
    assert classification["tier"] == "context"
    assert {"Historical work", "Outside the requested channel"} <= set(
        classification["scope_notes"]
    )
    licensed = {
        "title": "街坊茶餐廳平價午餐",
        "platform": "YouTube",
        "published_at": "2026-11-24",
    }
    assert classify(licensed, decision, NOW)["tier"] == "direct"
    conflict = brief(
        "Find affordable dining videos on YouTube",
        "Neighbourhood dining",
        "instagram",
        "dedicated_video",
    )
    assert (
        classify(licensed, evidence_intent(conflict, "affordable dining"), NOW)["tier"]
        == "context"
    )
    tv = {
        "title": "Hong Kong's food and dining scene",
        "platform": "TVmaze",
        "credit_role": "Series presenter",
        "published_at": "2025-05-02",
    }
    presenter = classify(tv, decision, NOW)
    assert (
        presenter["tier"] == "context"
        and "Affordability is unverified" in presenter["scope_notes"]
        and "Outside the requested channel" in presenter["scope_notes"]
    )
    nature = brief(
        "Show publications about 港鐵 and review the evidence",
        "MTR transit guide",
        "other",
    )
    rail = {
        "title": "The World's Best Public Transport? | Hong Kong MTR Explained",
        "platform": "PeerTube · Canadian Civil",
        "topics": ["Video", "Urban travel"],
        "published_at": "2024-02-22",
    }
    assert classify(rail, evidence_intent(nature, "港鐵"), NOW)["tier"] == "direct"
    plant = brief(
        "Find botanical Beauty Berry photography",
        "Botanical flora guide",
        "other",
        discovery_focus="Beauty Berry",
    )
    assert (
        classify(
            {
                "title": "Kochi’s Beauty Berry",
                "platform": "iNaturalist",
                "source_key": "inaturalist",
                "topics": ["Plants", "Photography"],
                "published_at": "2026-01-20",
            },
            evidence_intent(plant, "Beauty Berry"),
            NOW,
        )["tier"]
        == "direct"
    )
