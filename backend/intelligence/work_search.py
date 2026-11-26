"""Find historical evidence; only material tied to a credited work qualifies."""

import json
import re
from collections import defaultdict
from datetime import date, datetime
from functools import lru_cache
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from . import commons_works, public_feed
from backend.marketing.store import MarketingError
from .semantic import embed, normalized


class Pageviews(BaseModel):
    count: int
    month: str
    scope: str
    source_url: str
    license_url: str


class VisualEvidence(BaseModel):
    source_text: str
    interpretation: str
    source_language: str
    image_sha1: str


class Work(BaseModel):
    id: str
    title: str
    date: date
    excerpt: str
    excerpt_language: str
    local_excerpt: str | None
    local_language: str | None
    archive_url: str
    revision_url: str
    original_url: str
    platform: str
    license: str
    license_url: str
    text_license_url: str
    thumbnail_url: str | None
    visual_evidence: VisualEvidence | None = None
    pageviews: Pageviews | None
    record_id: UUID
    evidence_id: UUID


class Contributor(BaseModel):
    id: str
    name: str
    profile_url: str
    match_basis: Literal["historical_cost", "historical_topic", "creator", "browse"]
    matched_works: list[Work]
    campaign_quote: None = None
    audience: None = None
    performance: None = None


class ResearchResults(BaseModel):
    state: Literal["available", "unavailable", "expired"]
    observed: datetime | None = None
    expires: datetime | None = None
    criteria: str = ""
    retrieval: Literal["evidence_filter", "evidence_filter_with_granite"] = (
        "evidence_filter"
    )
    contributors: list[Contributor] = []


FOOD_QUERY = (
    "local dining",
    "food and drink",
    "cuisine",
    "dining",
    "foodie",
    "food",
    "eats",
    "restaurants",
    "restaurant",
    "meals",
    "meal",
    "美食",
    "飲食",
    "餐飲",
    "食評",
    "小食",
)
FOOD_EVIDENCE = (
    "food",
    "lunch",
    "meal",
    "restaurant",
    "cafe",
    "cha chaan teng",
    "dumpling",
    "skewer",
    "meats-on-a-stick",
    "rice",
    "noodles",
    "burger",
    "fish and chips",
    "beef",
    "sandwich",
    "tea",
    "餐",
    "美食",
    "兩餸飯",
    "肉丸",
    "茶點",
    "魚蛋",
    "餃",
)
COST_QUERY = (
    "budget-friendly",
    "budget friendly",
    "affordable",
    "inexpensive",
    "cheap",
    "low cost",
    "budget",
    "平價",
    "平民",
    "便宜",
    "經濟實惠",
    "實惠",
    "低價",
)
COST_DESCRIPTION = (
    "cheap",
    "inexpensive",
    "affordable",
    "budget-friendly",
    "平價",
    "低價",
    "實惠",
    "便宜",
)
TOPICS = (
    (("hiking", "hikes", "行山", "遠足"), ("hiking", "trail", "hike", "行山", "遠足")),
    (
        ("street art", "graffiti", "街頭藝術", "塗鴉"),
        ("street art", "graffiti", "mural", "街頭藝術", "塗鴉"),
    ),
    (
        ("茶餐廳", "cha chaan teng"),
        ("茶餐廳", "cha chaan teng", "hong kong style restaurant"),
    ),
    (("兩餸飯", "two-dish rice"), ("兩餸飯", "two-dish rice")),
)
CONTEXT = (
    "hong kong",
    "hongkong",
    "hk",
    "香港",
    "本地",
    "的",
    "搜尋",
    "創作者",
    "創作人",
    "推薦",
    "尋找",
    "find",
    "i",
    "we",
    "am",
    "are",
    "need",
    "want",
    "looking",
    "searching",
    "campaign",
    "launch",
    "promote",
    "my",
    "our",
    "have",
    "that",
    "to",
    "who",
    "covering",
    "cover",
    "covers",
    "about",
    "for",
    "with",
    "and",
    "or",
    "the",
    "in",
    "a",
    "local",
    "creators",
    "creator",
    "content",
    "historical",
    "work",
    "photographers",
    "photographer",
    "photographs",
    "posts",
    "please",
    "research",
    "show",
    "me",
    "on",
    "specialising",
    "specializing",
)


def token_pattern(token):
    return (
        r"(?<![a-z0-9])" + re.escape(token) + r"(?![a-z0-9])"
        if token.isascii()
        else re.escape(token)
    )


def strip_tokens(query, tokens):
    found = False
    for token in sorted(tokens, key=len, reverse=True):
        query, count = re.subn(token_pattern(token), " ", query)
        found |= bool(count)
    return query, found


def has_any(text, terms):
    return any(term in text for term in terms)


def requirements(query):
    text = normalized(query)
    ceiling = re.search(
        r"(under|below|up to|at most|不高於|低於)\s*(?:hk\$|hkd\s*|港幣\s*)(\d+(?:\.\d+)?)",
        text,
    )
    limit = float(ceiling.group(2)) if ceiling else 50
    strict = bool(ceiling and ceiling.group(1) in ("under", "below", "低於"))
    if ceiling:
        text = text.replace(ceiling.group(), " ")
    text, street = strip_tokens(text, ("street food", "街頭小食", "街頭美食"))
    text, cost = strip_tokens(text, COST_QUERY)
    text, food = strip_tokens(text, FOOD_QUERY)
    cost |= bool(ceiling)
    groups = [("street", "stall", "vendor", "stand", "街頭", "小販")] if street else []
    food |= street
    for tokens, alternatives in TOPICS:
        text, matched = strip_tokens(text, tokens)
        if matched:
            groups.append(alternatives)
    text, _ = strip_tokens(text, CONTEXT)
    residual = re.findall(r"[^\W_]+", text)
    return cost, food, groups, residual, limit, strict, bool(ceiling)


def priced(excerpt, limit, strict):
    prices = re.findall(
        r"\b(?:hkd\s*|hk\$\s*)(\d+(?:\.\d+)?)|(?:港幣|港元)\s*(\d+(?:\.\d+)?)", excerpt
    )
    return any(
        (float(a or b) < limit if strict else float(a or b) <= limit) for a, b in prices
    )


def project(records, query):
    cost, food, groups, residual, limit, strict, explicit = requirements(query)
    criteria = ""
    if cost:
        if explicit:
            criteria = f"A dated description or photographed menu gives a price {'below' if strict else 'at or below'} HK${limit:g}."
        else:
            criteria = (
                "A dated description or photographed menu mentions low cost or a price of HK$50 or less. "
                "HK$50 is this search’s working threshold. All prices are historical."
            )
    grouped = defaultdict(list)
    for row in records:
        work = json.loads(row.payload["work"])
        name = normalized(work["name"])
        menu = work.get("visual_evidence") or {}
        observation = " ".join(
            (menu.get("source_text", ""), menu.get("interpretation", ""))
        )
        text = normalized(
            " ".join(
                x
                for x in (
                    work["title"],
                    work["excerpt"],
                    work.get("local_excerpt"),
                    observation,
                )
                if x
            )
        )
        cost_text = normalized(
            work["excerpt"]
            + " "
            + (work.get("local_excerpt") or "")
            + " "
            + observation
        )
        direct_creator = bool(query.strip()) and normalized(query) == name
        if direct_creator:
            basis = "creator"
        elif normalized(query) in ("hong kong", "hongkong", "hk", "香港"):
            basis = "browse"
        elif query.strip():
            if not (cost or food or groups or residual):
                continue
            if (cost or food) and not has_any(text, FOOD_EVIDENCE):
                continue
            if cost and not (
                priced(cost_text, limit, strict)
                or (not explicit and has_any(cost_text, COST_DESCRIPTION))
            ):
                continue
            if any(not has_any(text, group) for group in groups):
                continue
            if any(term not in text and term not in name for term in residual):
                continue
            basis = "historical_cost" if cost else "historical_topic"
        else:
            basis = "browse"
        grouped[work["creator_id"]].append((work, row.id, row.evidence_id, basis))
    contributors = []
    for identity, group in grouped.items():
        group.sort(key=lambda x: (x[0]["date"], int(x[0]["id"])), reverse=True)
        first, _, _, basis = group[0]
        contributors.append(
            Contributor(
                id=identity,
                name=first["name"],
                profile_url=first["profile_url"],
                match_basis=basis,
                matched_works=[
                    Work.model_validate(dict(work, record_id=rid, evidence_id=eid))
                    for work, rid, eid, _ in group
                ],
            )
        )
    contributors.sort(
        key=lambda c: (
            len({w.date for w in c.matched_works}),
            c.matched_works[0].date,
            c.name,
        ),
        reverse=True,
    )
    return criteria, contributors


@lru_cache(maxsize=4)
def evidence_vectors(model_dir, documents):
    return embed(model_dir, list(documents))


def rerank(contributors, query, model_dir):
    if not model_dir or not query.strip() or len(contributors) < 2:
        return False
    works = [w for c in contributors for w in c.matched_works]
    documents = tuple(
        " ".join(
            filter(
                None,
                (
                    w.title,
                    w.excerpt,
                    w.local_excerpt,
                    w.visual_evidence.interpretation if w.visual_evidence else None,
                ),
            )
        )
        for w in works
    )
    vectors = evidence_vectors(model_dir, documents)
    query_vector = embed(model_dir, [query]) if vectors is not None else None
    if not query_vector:
        return False
    scores = {
        w.id: sum(x * y for x, y in zip(v, query_vector[0], strict=True))
        for w, v in zip(works, vectors, strict=True)
    }
    for c in contributors:
        c.matched_works.sort(key=lambda w: (scores[w.id], w.date, w.id), reverse=True)
    contributors.sort(
        key=lambda c: (
            len({w.date for w in c.matched_works}),
            max(scores[w.id] for w in c.matched_works),
            max(w.date for w in c.matched_works),
            c.name,
        ),
        reverse=True,
    )
    return True


def snapshot(sessions, query="", model_dir=None):
    state, observed, expires, rows = public_feed.records(sessions, commons_works.feed())
    result = ResearchResults(state=state, observed=observed, expires=expires)
    if rows:
        result.criteria, result.contributors = project(rows, query)
        if rerank(result.contributors, query, model_dir):
            result.retrieval = "evidence_filter_with_granite"
            current_state, current_observed, _, _ = public_feed.records(
                sessions, commons_works.feed()
            )
            if (current_state, current_observed) != (state, observed):
                raise MarketingError(
                    409, "catalog_changed", "Refresh the published works"
                )
    return result
