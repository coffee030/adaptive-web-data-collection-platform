"""Retrieve distinct supporting posts, explain ranking, then optimize eligible quotes."""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from math import log1p
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from .analytics import Historical, Measure, calculated
from .catalog import Catalog, Creator, EligibleContent, Evidence, Observed, PostDetail
from .contracts import Audience, Campaign, Mode, Quote
from .optimizer import Item, Plan, optimize
from .semantic import INDEX_VERSION, character_grams, embed, tfidf_scores

TOP_WEIGHTS = (0.6, 0.3, 0.1)
WEIGHTS = {
    "awareness": dict(
        relevance=45,
        performance=20,
        consistency=10,
        cost=10,
        market=10,
        language=5,
        preferences=5,
    ),
    "engagement": dict(
        relevance=45,
        performance=15,
        consistency=15,
        cost=10,
        market=5,
        language=10,
        preferences=5,
    ),
}
CATEGORIES = {
    "beauty": "Beauty cosmetics skincare makeup sunscreen 美容 保養 化妝 防曬",
    "budget": "Budget affordability affordable cost savings price 平價 慳錢 預算",
    "dining": "Dining restaurants cafés food lunch dinner meals 飲食 餐廳 咖啡 午餐 食飯",
    "family": "Family children childcare parents and family outings 親子 家庭 小朋友 嬰兒車",
    "finance": "Personal finance banking savings spending credit 理財 儲蓄 銀行",
    "lifestyle": "Lifestyle everyday routines living spaces home 日常 生活 家居",
    "outdoors": "Outdoors hiking parks trails camping 戶外 行山 公園 露營",
    "sustainability": "Sustainable reuse, repair, recycling and secondhand items 環保 回收 二手 維修",
    "technology": "Technology software devices work equipment 科技 軟件 電腦 設備",
}


class Support(PostDetail):
    similarity: float


class Recommendation(BaseModel):
    creator_id: str
    name: str
    profile_evidence: Evidence
    utility: float | None
    factors: dict[str, float | None]
    factor_weights: dict[str, int]
    evidence: list[Support]
    requirement_evidence: dict[str, Evidence]
    market_evidence: Observed[Audience] | None
    quote: Observed[Quote] | None
    historical: Historical
    fee_per_thousand_historical_views_minor: Measure
    fee_per_historical_interaction_minor: Measure
    eligible: bool
    limitations: list[str]


class Categories(BaseModel):
    source: Literal["suggested", "supplied"]
    labels: list[str]


class CampaignResult(BaseModel):
    state: Literal["available", "empty", "incomplete"]
    mode: Mode
    revision: str
    as_of: datetime
    retrieval: Literal["granite_int8", "character_tfidf"]
    model_version: str | None
    indexing: Literal["ready", "preparing", "fallback"]
    categories: Categories
    recommendations: list[Recommendation]
    unavailable_shortlist_ids: list[str]
    plan: Plan
    campaign: Campaign


@dataclass(frozen=True)
class Candidate:
    creator: Creator
    posts: list[EligibleContent]
    historical: Historical


def _categories(campaign: Campaign) -> Categories:
    if campaign.category_labels is not None:
        return Categories(
            source="supplied", labels=list(dict.fromkeys(campaign.category_labels))
        )
    scores = tfidf_scores(
        campaign.description,
        {label: character_grams(text) for label, text in CATEGORIES.items()},
    )
    selected = sorted(scores, key=lambda label: (-scores[label], label))[:3]
    return Categories(
        source="suggested",
        labels=[label for label in selected if scores[label] >= 0.04],
    )


def _scores(
    query: str, posts: list[EligibleContent], model_dir: Path | None
) -> tuple[str, dict[str, float]]:
    vectors = {post.key: post.vector for post in posts if post.vector is not None}
    grams = {post.key: post.grams for post in posts}
    if (
        vectors
        and vectors.keys() == grams.keys()
        and (query_vectors := embed(model_dir, [query]))
    ):
        query_vector = query_vectors[0]
        return "granite_int8", {
            key: min(
                1.0,
                max(0.0, sum(a * b for a, b in zip(query_vector, vector, strict=True))),
            )
            for key, vector in vectors.items()
        }
    return "character_tfidf", tfidf_scores(query, grams)


def _strongest(
    posts: list[EligibleContent], scores: dict[str, float], floor: float
) -> list[EligibleContent]:
    ordered = sorted(posts, key=lambda post: (-scores[post.key], post.record.data.id))
    distinct = {}
    for post in ordered:
        if scores[post.key] >= floor:
            distinct.setdefault(post.key, post)
    return list(distinct.values())[: len(TOP_WEIGHTS)]


def _assess(
    candidate: Candidate,
    campaign: Campaign,
    scores: dict[str, float],
    floor: float,
    scale: float,
) -> Recommendation:
    creator, posts, historical = (
        candidate.creator,
        candidate.posts,
        candidate.historical,
    )
    strongest = _strongest(posts, scores, floor)
    weights = TOP_WEIGHTS[: len(strongest)]
    relevance = (
        sum(
            weight * scores[post.key]
            for weight, post in zip(weights, strongest, strict=True)
        )
        / sum(weights)
        if strongest
        else None
    )
    quote = next(
        (
            item
            for item in creator.active_quotes()
            if item.data.platform == campaign.platform
            and item.data.currency == campaign.currency
            and item.data.deliverable == campaign.deliverable
        ),
        None,
    )
    fee = quote.data.amount_minor if quote else None
    market = next(
        (
            item
            for item in creator.audiences
            if item.data.platform == campaign.platform
            and item.data.market == campaign.market
        ),
        None,
    )
    share = market.data.share if market else None
    language = next(
        (
            post.record.evidence
            for post in posts
            if campaign.language in post.record.data.languages
        ),
        None,
    )
    facts = {
        fact: post.record.evidence
        for post in posts
        for fact in post.record.data.reviewed_facts
    }
    proof = {
        fact: facts[fact]
        for fact in sorted(set(campaign.required_facts))
        if fact in facts
    }
    if language and campaign.require_language:
        proof[f"language:{campaign.language}"] = language
    limitations = []
    if relevance is None:
        limitations.append("insufficient_relevant_content")
    if fee is None:
        limitations.append("confirmed_quote_unavailable")
    elif fee > campaign.budget_minor:
        limitations.append("quote_exceeds_budget")
    if campaign.minimum_market_share is not None and (
        share is None or share < campaign.minimum_market_share
    ):
        limitations.append(
            "required_market_share_unverified"
            if share is None
            else "required_market_share_below_minimum"
        )
    if campaign.require_language and language is None:
        limitations.append("required_language_unverified")
    limitations.extend(
        f"required_fact_unverified:{fact}"
        for fact in sorted(set(campaign.required_facts) - facts.keys())
    )
    eligible = not limitations
    if fee is not None and fee == 0:
        cost_fit = 1.0
    elif fee is not None and campaign.budget_minor:
        cost_fit = max(0.0, 1 - fee / campaign.budget_minor)
    else:
        cost_fit = None
    awareness = campaign.objective == "awareness"
    performance = (
        historical.median_views.value
        if awareness
        else historical.median_interactions.value
    )
    consistency = (
        historical.views_consistency.value
        if awareness
        else historical.interaction_consistency.value
    )
    preferences = set(campaign.preferred_facts)
    factors = {
        "relevance": relevance,
        "performance": log1p(performance) / scale
        if performance is not None and scale
        else (0.0 if performance == 0 else None),
        "consistency": float(consistency) if consistency is not None else None,
        "cost": cost_fit,
        "market": float(share) if share is not None else None,
        "language": (1.0 if language else None) if campaign.language else None,
        "preferences": len(preferences & facts.keys()) / len(preferences)
        if preferences
        else None,
    }
    factor_weights = WEIGHTS[campaign.objective]
    known = {key: value for key, value in factors.items() if value is not None}
    utility = (
        sum(factor_weights[k] * v for k, v in known.items())
        / sum(factor_weights[k] for k in known)
        if relevance is not None
        else None
    )
    if campaign.market and share is None and campaign.minimum_market_share is None:
        limitations.append("target_market_evidence_unavailable")
    if campaign.language and language is None and not campaign.require_language:
        limitations.append("target_language_evidence_unavailable")
    historical_views = historical.median_views.value
    return Recommendation(
        creator_id=creator.id,
        name=creator.record.data.name,
        profile_evidence=creator.record.evidence,
        utility=utility,
        factors=factors,
        factor_weights=factor_weights,
        requirement_evidence=proof,
        market_evidence=market,
        quote=quote,
        historical=historical,
        fee_per_thousand_historical_views_minor=calculated(
            Decimal(fee * 1000) / historical_views
            if fee is not None and historical_views
            else None,
            historical.median_views.observations,
        ),
        fee_per_historical_interaction_minor=calculated(
            Decimal(fee) / historical.median_interactions.value
            if fee is not None and historical.median_interactions.value
            else None,
            historical.median_interactions.observations,
        ),
        evidence=[
            Support(
                content=post.record,
                performance=post.performance,
                similarity=scores[post.key],
            )
            for post in strongest
        ],
        eligible=eligible,
        limitations=limitations,
    )


def recommend(
    catalog: Catalog, campaign: Campaign, mode: Mode, model_dir: Path | None
) -> CampaignResult:
    shortlist = set(campaign.shortlist or [])
    candidates = [
        Candidate(
            creator,
            [
                post
                for post in creator.posts
                if post.record.data.platform == campaign.platform
            ],
            creator.history(campaign.platform),
        )
        for creator in catalog.creators.values()
        if (not shortlist or creator.id in shortlist)
        and any(
            account.platform == campaign.platform
            for account in creator.record.data.accounts
        )
    ]
    method, scores = _scores(
        campaign.description,
        [post for candidate in candidates for post in candidate.posts],
        model_dir,
    )
    floor = 0.20 if method == "granite_int8" else 0.04
    awareness = campaign.objective == "awareness"
    scale = log1p(
        max(
            (
                (
                    candidate.historical.median_views.value
                    if awareness
                    else candidate.historical.median_interactions.value
                )
                or 0
                for candidate in candidates
            ),
            default=0,
        )
    )
    results = [_assess(item, campaign, scores, floor, scale) for item in candidates]
    results.sort(
        key=lambda item: (item.utility is None, -(item.utility or 0), item.creator_id)
    )
    items = [
        Item(
            item.creator_id,
            item.quote.data.amount_minor,
            round(item.utility * 1_000_000),
        )
        for item in results
        if item.eligible
    ]
    plan = optimize(
        items,
        campaign.budget_minor,
        campaign.minimum_creators,
        campaign.maximum_creators,
    )
    selected = set(plan.selected)
    visible = {item.creator_id for item in results if item.creator_id in selected}
    for item in results:
        if len(visible) >= 40:
            break
        visible.add(item.creator_id)
    states = {dataset.state for dataset in catalog.snapshot.datasets}
    if model_dir is None or "fallback" in states:
        indexing = "fallback"
    elif states & {"lexical", "running"}:
        indexing = "preparing"
    else:
        indexing = "ready"
    return CampaignResult(
        state="empty"
        if not candidates
        else ("available" if plan.status == "optimal" else "incomplete"),
        mode=mode,
        revision=catalog.snapshot.revision,
        as_of=catalog.snapshot.as_of,
        retrieval=method,
        model_version=INDEX_VERSION if method == "granite_int8" else None,
        indexing=indexing,
        categories=_categories(campaign),
        recommendations=[item for item in results if item.creator_id in visible],
        unavailable_shortlist_ids=sorted(shortlist - catalog.creators.keys()),
        plan=plan,
        campaign=campaign,
    )
