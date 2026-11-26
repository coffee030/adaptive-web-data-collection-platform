import hashlib
import json
from collections import defaultdict

from backend.application.jobs import database_now
from backend.marketing.store import MarketingError
from . import commons_works, market_catalog, public_directory, public_feed, work_search
from .catalog import Catalog
from .recommend import recommend
from .research_contracts import BusinessBrief
from .retrieval import query_topics, required_words
from .semantic import character_grams, embed, tfidf_scores
from .store import Scope


PUBLIC_FEEDS = (public_directory.feed(), commons_works.feed())
BROAD_TERMS = {
    "dining": ("dining", "food"),
    "outdoors": ("hiking", "outdoors"),
    "budget": ("affordable", "budget"),
    "technology": ("technology", "software"),
}


def discovery_queries(brief):
    full = brief.discovery_focus or brief.campaign.description
    subjects = sorted(query_topics(full) or query_topics(brief.product))
    if brief.discovery_focus:
        focus = brief.discovery_focus
    elif subjects:
        focus = " ".join(BROAD_TERMS.get(topic, (topic,))[0] for topic in subjects)
    else:
        words = [
            w
            for w in required_words(full)
            if w
            not in {
                "recommend",
                "launch",
                "business",
                "want",
                "promote",
                "which",
                "best",
                "suitable",
                "research",
                "company",
                "could",
                "would",
                "should",
            }
        ]
        focus = " ".join(words[:8]) or brief.product[:120]
    broad = [
        BROAD_TERMS.get(topic, (topic,))[-1] for topic in subjects if topic != "budget"
    ]
    if not subjects:
        broad.extend(
            word for word in market_catalog.pieces(brief.product) if len(word) > 2
        )
        broad.extend(word for word in market_catalog.pieces(focus) if len(word) > 2)
    return focus[:120], list(dict.fromkeys([focus[:120], *broad]))[:4]


def source_states(sessions):
    states = []
    for spec in PUBLIC_FEEDS:
        state, observed, _, _ = public_feed.records(sessions, spec)
        with sessions() as session:
            feed = session.get(public_feed.DirectoryRow, spec.row_id)
            active = public_feed.approved(session, feed, spec)
            states.append(
                {
                    "key": str(spec.row_id),
                    "name": spec.name,
                    "state": state,
                    "revision": str(feed.published or feed.pending or "")
                    if active
                    else "",
                    "pending": bool(active and feed.pending),
                    "refresh_due": bool(
                        active and feed.next_attempt <= database_now(session)
                    ),
                    "observed_at": observed.isoformat() if observed else None,
                    "error": feed.error if active else None,
                }
            )
    return [
        *states,
        *[
            {**s, "state": s["publication"]}
            for s in market_catalog.research_sources(sessions)
        ],
    ]


def collect_due(sessions, states):
    errors = {}
    for source in states:
        if not source.get("refresh_due") and not source.get("pending"):
            continue
        spec = next((f for f in PUBLIC_FEEDS if str(f.row_id) == source["key"]), None)
        try:
            if spec:
                public_feed.refresh(sessions, spec)
            elif source.get("refresh_due"):
                market_catalog.request_refresh(sessions, source["key"])
        except MarketingError as error:
            errors[source["key"]] = error.code
    return errors


def public_examples(store, brief):
    focus, queries = discovery_queries(brief)
    hits = {}
    full_matches = set()
    for query in queries:
        found = market_catalog.search_activity(store.sessions, q=query, page_size=24)
        for record in found["items"]:
            hits.setdefault(record["id"], record)
            if query == focus:
                full_matches.add(record["id"])
    records = list(hits.values())
    method = "source_search"
    if records:
        docs = [
            " ".join(
                filter(
                    None, (r["title"], r["creator_name"], " ".join(r.get("topics", [])))
                )
            )
            for r in records
        ]
        context = " ".join(
            (focus, brief.product, brief.audience, brief.campaign.description)
        )
        vectors = (
            embed(store.config.model_dir, [context, *docs])
            if store.config.model_dir
            else None
        )
        if vectors:
            scores = {
                r["id"]: sum(a * b for a, b in zip(vectors[0], vector, strict=True))
                for r, vector in zip(records, vectors[1:], strict=True)
            }
            method = "granite_int8"
        else:
            scores = tfidf_scores(
                context,
                {
                    r["id"]: character_grams(text)
                    for r, text in zip(records, docs, strict=True)
                },
            )
            method = "character_tfidf"
        records.sort(
            key=lambda r: (
                r["id"] in full_matches,
                scores[r["id"]],
                str(r.get("published_at") or ""),
                r["id"],
            ),
            reverse=True,
        )
    by_platform = defaultdict(list)
    for record in records:
        by_platform[record["platform"]].append(record)
    platform_activity = [
        {
            "platform": platform,
            "activities": len(items),
            "creators": len({r["creator_id"] for r in items}),
            "with_metrics": sum(bool(r.get("metrics")) for r in items),
        }
        for platform, items in sorted(by_platform.items())
    ]
    examples = []
    for record in records[:12]:
        examples.append(
            {
                "id": record["id"],
                "creator_id": record["creator_id"],
                "name": record["creator_name"],
                "title": record["title"],
                "url": record["url"],
                "profile_url": record["profile_url"],
                "excerpt": record.get("excerpt"),
                "core_record_id": record.get("core_record_id"),
                "platform": record["platform"],
                "published_at": record["published_at"],
                "observed_at": record["observed_at"],
                "license_url": record["license_url"],
                "basis": "market_activity"
                if record["id"] in full_matches
                else "related_market_activity",
                "metrics": record.get("metrics", []),
                "topics": record.get("topics", []),
            }
        )
    historical = work_search.snapshot(store.sessions, focus, store.config.model_dir)
    for contributor in historical.contributors[:6]:
        for work in contributor.matched_works[:2]:
            examples.append(
                {
                    "id": work.id,
                    "creator_id": contributor.id,
                    "name": contributor.name,
                    "title": work.title,
                    "excerpt": work.excerpt,
                    "url": work.revision_url,
                    "profile_url": contributor.profile_url,
                    "platform": work.platform,
                    "published_at": work.date.isoformat(),
                    "observed_at": historical.observed.isoformat(),
                    "license_url": work.license_url,
                    "basis": contributor.match_basis,
                    "metrics": [],
                    "topics": [],
                    "core_record_id": str(work.record_id),
                    "visual_evidence": work.visual_evidence.model_dump(mode="json")
                    if work.visual_evidence
                    else None,
                }
            )
    directory = public_directory.snapshot(store.sessions)
    if directory.profiles:
        identity_hits = {}
        for query in queries:
            found = public_directory.search(
                directory.model_copy(deep=True), query, store.config.model_dir
            )
            for profile in found.profiles:
                identity_hits.setdefault(profile.item, profile)
        for profile in list(identity_hits.values())[:4]:
            examples.append(
                {
                    "id": profile.item,
                    "creator_id": "wikidata:" + profile.item,
                    "name": profile.name,
                    "title": profile.description,
                    "excerpt": profile.local_description or None,
                    "url": f"https://www.wikidata.org/wiki/Special:EntityData/{profile.item}.json?revision={profile.revision}",
                    "profile_url": f"https://www.wikidata.org/wiki/{profile.item}",
                    "platform": "Wikidata",
                    "published_at": None,
                    "observed_at": directory.observed.isoformat(),
                    "license_url": public_directory.feed().license_url,
                    "basis": "identity_lead",
                    "metrics": [],
                    "topics": [],
                }
            )
    order = {
        "historical_cost": 0,
        "market_activity": 1,
        "historical_topic": 2,
        "related_market_activity": 3,
        "identity_lead": 4,
    }
    examples.sort(key=lambda item: order.get(item["basis"], 2))
    return {
        "focus": focus,
        "queries": queries,
        "market_ranking": method,
        "historical_ranking": historical.retrieval,
        "historical_criteria": historical.criteria,
        "platform_activity": platform_activity,
        "examples": examples,
        "market_candidates_reviewed": len(records),
    }


def strategy(catalog, campaign, model_dir, name):
    report = recommend(catalog, campaign, "partner", model_dir)
    selected = set(report.plan.selected)
    rows = sorted(
        report.recommendations,
        key=lambda candidate: candidate.creator_id not in selected,
    )
    candidates = []
    for row in rows[: max(6, len(selected))]:
        support = row.evidence[0] if row.evidence else None
        candidates.append(
            {
                "id": row.creator_id,
                "name": row.name,
                "selected": row.creator_id in selected,
                "eligible": row.eligible,
                "limitations": row.limitations,
                "quote": row.quote.model_dump(mode="json") if row.quote else None,
                "audience": row.market_evidence.model_dump(mode="json")
                if row.market_evidence
                else None,
                "historical": row.historical.model_dump(mode="json"),
                "content": support.content.model_dump(mode="json") if support else None,
                "factors": row.factors,
                "weight": row.factor_weights,
            }
        )
    quoted = any(c.quote for c in report.recommendations)
    state = report.plan.status
    if state == "infeasible" and (
        not quoted
        or not any(
            c.eligible or "quote_exceeds_budget" in c.limitations
            for c in report.recommendations
        )
    ):
        state = "needs_evidence"
    return {
        "name": name,
        "platform": campaign.platform,
        "budget_minor": campaign.budget_minor,
        "currency": campaign.currency,
        "status": state,
        "selected": report.plan.selected,
        "allocated_minor": report.plan.total_minor,
        "reviewed": report.reviewed_count,
        "exclusions": report.exclusions,
        "candidates": candidates,
        "retrieval": report.retrieval,
        "model_version": report.model_version,
        "topics": report.categories.labels,
        "topic_basis": report.categories.source,
    }


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, default=str, ensure_ascii=False).encode()
    ).hexdigest()


def publication_version(states):
    return sorted(
        (
            str(s["key"]),
            str(s["state"]),
            str(s.get("revision") or ""),
            str(s.get("observed_at") or ""),
        )
        for s in states
    )


def analyze(store, company_id: str, brief: BusinessBrief):
    scope = Scope("partner", company_id)
    before = publication_version(source_states(store.sessions))
    snapshot = store.snapshot(scope)
    catalog = Catalog(snapshot)
    examples = public_examples(store, brief)
    campaign = brief.campaign
    strategies = [strategy(catalog, campaign, store.config.model_dir, "Full budget")]
    test = campaign.model_copy(
        update={"budget_minor": campaign.budget_minor * brief.test_share // 100}
    )
    strategies.append(
        strategy(
            catalog, test, store.config.model_dir, f"{brief.test_share}% test budget"
        )
    )
    for platform in brief.alternative_platforms:
        option = campaign.model_copy(update={"platform": platform})
        strategies.append(
            strategy(catalog, option, store.config.model_dir, "Alternative channel")
        )
    store.assert_current(scope, snapshot.revision)
    if before != publication_version(source_states(store.sessions)):
        raise MarketingError(
            409, "catalog_changed", "Research sources changed during analysis"
        )
    gaps = []
    if not examples["examples"]:
        gaps.append(
            "No source-linked public examples matched this focus. Try a broader topic or a different business question."
        )
    baseline = strategies[0]
    exclusions = set(baseline["exclusions"])
    if not baseline["reviewed"] or "confirmed_quote_unavailable" in exclusions:
        gaps.append(
            "Request current, firm quotes for the selected channel and deliverable before allocating spend."
        )
    if not baseline["reviewed"] or any(
        not c["audience"] for c in baseline["candidates"]
    ):
        gaps.append(
            "Request a recent, authorized audience breakdown to check the intended market."
        )
    if not baseline["candidates"] or all(
        c["historical"]["median_views"]["value"] is None for c in baseline["candidates"]
    ):
        gaps.append(
            "Comparable seven-day post performance is unavailable. Obtain first-party measurements before estimating reach."
        )
    result = {
        "research": examples,
        "strategies": strategies,
        "next_steps": gaps,
        "objective": campaign.objective,
        "audience": brief.audience,
        "product": brief.product,
        "outcome_basis": "No campaign outcomes are predicted. Each allocation uses current firm quotes for the stated deliverable.",
    }
    return result, digest([snapshot.revision, before, result])
