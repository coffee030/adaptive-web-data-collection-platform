from datetime import UTC, datetime
from decimal import Decimal
from itertools import combinations
from random import Random

from backend.intelligence.analytics import history, scenario
from backend.intelligence.contracts import Performance, Scenario
from backend.intelligence.optimizer import Item, optimize
from backend.intelligence.semantic import character_grams, content_key, tfidf_scores


def test_multilingual_lexical_retrieval_preserves_distinct_text():
    docs = {
        "mixed": character_grams("Sham Shui Po lunch run 叫咗蒸飯，慳錢又好食"),
        "yue": character_grams("帶小朋友去親子餐廳，有高凳同嬰兒車通道"),
        "en": character_grams("A desktop keyboard and monitor review"),
    }
    scores = tfidf_scores("親子餐廳 嬰兒車通道", docs)
    assert max(scores, key=scores.get) == "yue"
    assert scores["yue"] > 0.3
    assert scores["en"] == 0
    assert (
        max(
            tfidf_scores("lunch run 蒸飯", docs),
            key=tfidf_scores("lunch run 蒸飯", docs).get,
        )
        == "mixed"
    )
    assert content_key("Ｆixture   嬰兒車") == content_key("fixture 嬰兒車")


def test_exact_selection_matches_exhaustive_reference():
    random = Random(710)
    for _ in range(240):
        items = [
            Item(str(i), random.randrange(8), random.randrange(12))
            for i in range(random.randrange(1, 9))
        ]
        budget = random.randrange(20)
        maximum = random.randrange(1, 7)
        minimum = random.randrange(maximum + 1)
        exhaustive = min(
            (
                (
                    -sum(item.utility for item in group),
                    sum(item.fee_minor for item in group),
                    tuple(item.creator_id for item in group),
                )
                for count in range(minimum, maximum + 1)
                for group in combinations(items, count)
                if sum(item.fee_minor for item in group) <= budget
            ),
            default=None,
        )
        result = optimize(items, budget, minimum, maximum)
        if exhaustive is None:
            assert result.status == "infeasible"
        else:
            assert result.status == "optimal"
            assert (
                -result.utility_units,
                result.total_minor,
                tuple(result.selected),
            ) == exhaustive
    assert optimize([Item("free", 0, 1)], 0, 1, 1).selected == ["free"]
    assert optimize([Item("a", 1, 1)], 1, 1, 1, limit=1).status == "search_limit"


def test_comparable_history_uses_matched_denominators():
    now = datetime.now(UTC)
    samples = [
        Performance(
            kind="performance",
            id=f"metric-{i}",
            creator_id="c",
            evidence_ref="receipt",
            observed_at=now,
            window_end=now,
            platform="youtube",
            post_id=f"p-{i}",
            views=views,
            likes=likes,
            comments=comments,
        )
        for i, (views, likes, comments) in enumerate(
            [(100, 10, 0), (50, None, 3), (0, 0, 0), (300, 20, 10)]
        )
    ]
    result = history(samples)
    assert result.median_views.value == 75
    assert result.median_views.observations == 4
    assert result.median_interactions.value == 10
    assert result.interaction_rate.value == Decimal("0.1")
    assert result.interaction_rate.observations == 2
    assert result.views_consistency.status == "unavailable"
    assert history([]).median_views.value is None


def test_scenario_requires_assumptions_and_keeps_zero_and_unknown_distinct():
    forecast = scenario(
        Scenario(
            currency="HKD",
            impressions=10000,
            click_rate=Decimal("0.02"),
            conversion_rate=Decimal("0.05"),
            value_per_conversion_minor=25000,
            advertising_spend_minor=100000,
            campaign_cost_minor=150000,
            contribution_margin=Decimal("0.4"),
        )
    )
    assert forecast.basis == "assumption_based"
    assert forecast.clicks.value == 200
    assert forecast.conversions.value == 10
    assert forecast.attributed_revenue_minor.value == 250000
    assert forecast.roas.value == Decimal("2.5")
    assert forecast.roi.value.quantize(Decimal(".0001")) == Decimal("-.3333")
    revenue_only = scenario(
        Scenario(
            currency="HKD",
            impressions=100,
            click_rate=Decimal("0.2"),
            conversion_rate=Decimal("0.1"),
            value_per_conversion_minor=500,
            spend_minor=100,
        )
    )
    assert revenue_only.attributed_revenue_minor.value == 1000
    assert revenue_only.roas.status == revenue_only.roi.status == "unavailable"
    zero_margin = scenario(
        Scenario(
            currency="HKD",
            impressions=100,
            click_rate=Decimal("0.2"),
            conversion_rate=Decimal("0.1"),
            value_per_conversion_minor=500,
            campaign_cost_minor=100,
            contribution_margin=Decimal("0"),
        )
    )
    assert zero_margin.roi.value == -1
    unknown = scenario(Scenario(currency="HKD", impressions=0, spend_minor=0))
    assert unknown.clicks.status == "unavailable"
    zero = scenario(
        Scenario(currency="HKD", impressions=0, click_rate=Decimal("0"), spend_minor=0)
    )
    assert zero.clicks.value == 0
    assert zero.roas.status == "unavailable"
