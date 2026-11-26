"""Search approved public activity and inspect platform-specific measurement history."""

from collections import Counter
from datetime import datetime, timedelta, timezone
import re

from sqlalchemy import distinct, func, select, true

from backend.application.jobs import database_now
from backend.marketing.store import MarketingError
from backend.persistence.models import JobRow, SourceRow

from .market_models import MarketActivity as A, MarketMeasure, MarketSource, MarketBatch
from .market_sources import FRESH, SOURCES
from .market_collection import allowed
from .operator_receipt import receipt

ALIASES = {
    "transit": "transport",
    "dining": "food",
    "cuisine": "food",
    "restaurant": "food",
    "restaurants": "food",
    "平價": "affordable",
    "平价": "affordable",
    "cheap": "affordable",
    "budget": "affordable",
    "hiking": "outdoor",
    "outdoors": "outdoor",
    "birdwatching": "birds",
    "birding": "birds",
    "bird": "birds",
    "wildlife": "nature",
    "photographer": "photography",
    "photographers": "photography",
    "野生動物": "nature",
    "大自然": "nature",
    "自然": "nature",
    "觀鳥": "birds",
    "觀鸟": "birds",
    "鳥類": "birds",
    "昆蟲": "insects",
    "戶外": "outdoor",
    "攝影": "photography",
    "港鐵": "mtr",
    "港铁": "mtr",
    "美食": "food",
    "餐廳": "food",
    "飲食": "food",
    "餐厅": "food",
    "交通": "transit",
    "旅行": "travel",
    "旅遊": "travel",
}
STOP = {
    "hong",
    "kong",
    "hk",
    "creators",
    "creator",
    "find",
    "for",
    "photos",
    "about",
    "in",
    "who",
    "cover",
    "covering",
    "local",
    "the",
    "and",
}
HK_TIME = timezone(timedelta(hours=8))


def pieces(value):
    s = (value or "").casefold().replace("香港", " ")
    for src, dest in ALIASES.items():
        if not src.isascii():
            s = s.replace(src, " " + dest + " ")
    return [
        ALIASES.get(token, token)
        for token in re.findall(r"[^\W_]+", s)
        if token not in STOP
    ][:12]


def visible_sources(session):
    sources = list(
        session.scalars(
            select(MarketSource).where(
                MarketSource.revision.is_not(None),
                MarketSource.observed > database_now(session) - FRESH,
            )
        )
    )
    return [
        s.key
        for s in sources
        if allowed(session, s) and s.error != "publisher_access_blocked"
    ]


def activity_query(session, q="", platform=None, topic=None, creator_id=None):
    keys = visible_sources(session)
    if platform:
        keys = [k for k in keys if platform in (SOURCES[k].platform, k)]
    statement = select(A).where(
        A.source.in_(keys), A.checked > database_now(session) - FRESH
    )
    if topic:
        statement = statement.where(A.topics.any(topic))
    if creator_id:
        statement = statement.where(A.creator_id == creator_id)
    for word in pieces(q):
        statement = statement.where(A.search_text.contains(word, autoescape=True))
    return statement


def item(row):
    return dict(
        row.payload,
        platform=SOURCES[row.source].platform,
        source_key=row.source,
        observed_at=row.checked.isoformat(),
        core_record_id=str(row.core_record),
    )


def buckets(counts):
    return [
        {"value": k, "count": v}
        for k, v in sorted(counts.items(), key=lambda p: (-p[1], p[0].casefold()))
    ]


def facets(session, scope, creator=False):
    keys = scope.subquery()
    count = func.count(distinct(keys.c.creator_id)) if creator else func.count()
    p = session.execute(select(keys.c.source, count).group_by(keys.c.source))
    topics = func.unnest(keys.c.topics).table_valued("topic").render_derived().lateral()
    t = session.execute(
        select(topics.c.topic, count)
        .select_from(keys.join(topics, true()))
        .group_by(topics.c.topic)
    )
    return {
        "platforms": buckets({SOURCES[k].platform: v for k, v in p}),
        "topics": buckets(dict(t.all())),
    }


def related_dining(result, q, platform, topic, search, sessions, **filters):
    if (
        result["total"]
        or topic not in (None, "Dining", "Food")
        or not {"affordable", "food"}.issubset(pieces(q))
    ):
        return result
    related = search(
        sessions,
        q="food",
        platform=platform,
        topic=topic or "Dining",
        page_size=3,
        **filters,
    )
    if related["total"]:
        result["related"] = dict(
            query="food",
            topic=topic or "Dining",
            total=related["total"],
            items=related["items"],
            basis="dining_coverage_without_price_evidence",
        )
    return result


def search_activity(
    sessions, q="", platform=None, topic=None, creator_id=None, page=1, page_size=20
):
    page = max(1, page)
    page_size = max(1, min(100, page_size))
    with sessions() as session:
        scope = activity_query(session, q, platform, topic, creator_id)
        total = session.scalar(select(func.count()).select_from(scope.subquery()))
        rows = session.scalars(
            scope.order_by(A.published.desc(), A.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        result = dict(
            items=[item(r) for r in rows],
            total=total,
            page=page,
            page_size=page_size,
            facets=facets(session, scope),
        )
    return related_dining(
        result, q, platform, topic, search_activity, sessions, creator_id=creator_id
    )


def creator_summary(rows):
    newest = rows[0]
    return dict(
        id=newest.creator_id,
        name=newest.payload["creator_name"],
        platform=SOURCES[newest.source].platform,
        profile_url=newest.payload["profile_url"],
        activity_count=len(rows),
        latest_published_at=newest.published.isoformat(),
        topics=[
            v["value"] for v in buckets(Counter(t for r in rows for t in r.topics))
        ],
        example=item(newest),
    )


def search_creators(
    sessions, q="", platform=None, topic=None, page=1, page_size=20, sort="recent"
):
    page = max(1, page)
    page_size = max(1, min(100, page_size))
    with sessions() as session:
        scope = activity_query(session, q, platform, topic)
        keys = scope.subquery()
        grouped = (
            select(
                keys.c.creator_id,
                func.count().label("activity"),
                func.max(keys.c.published).label("recent"),
                func.min(keys.c.payload["creator_name"].astext).label("name"),
            )
            .group_by(keys.c.creator_id)
            .subquery()
        )
        orders = {
            "recent": grouped.c.recent.desc(),
            "activity": grouped.c.activity.desc(),
            "name": func.lower(grouped.c.name),
        }
        ids = list(
            session.scalars(
                select(grouped.c.creator_id)
                .order_by(orders.get(sort, orders["recent"]), grouped.c.creator_id)
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        groups = {cid: [] for cid in ids}
        for row in session.scalars(
            scope.where(A.creator_id.in_(ids)).order_by(A.published.desc(), A.id)
        ):
            groups[row.creator_id].append(row)
        result = dict(
            items=[creator_summary(group) for group in groups.values() if group],
            total=session.scalar(select(func.count()).select_from(grouped)),
            page=page,
            page_size=page_size,
            facets=facets(session, scope, True),
        )
    return related_dining(
        result, q, platform, topic, search_creators, sessions, sort=sort
    )


def creator_detail(sessions, creator_id):
    with sessions() as session:
        scope = activity_query(session, creator_id=creator_id)
        rows = list(session.scalars(scope.order_by(A.published.desc(), A.id)))
        if not rows:
            raise MarketingError(
                404,
                "market_creator_unavailable",
                "This contributor has no currently eligible publications",
            )
        shown = rows[:20]
        ids = [r.id for r in shown]
        measurements = session.scalars(
            select(MarketMeasure)
            .where(MarketMeasure.activity_id.in_(ids))
            .order_by(MarketMeasure.observed.desc(), MarketMeasure.activity_id)
            .limit(400)
        )
        return dict(
            **creator_summary(rows),
            activity=[item(r) for r in shown],
            measurements=[
                dict(
                    activity_id=m.activity_id,
                    observed_at=m.observed.isoformat(),
                    metrics=m.metrics,
                )
                for m in measurements
            ],
        )


def overview(sessions):
    with sessions() as session:
        now = database_now(session).astimezone(HK_TIME)
        scope = activity_query(session)
        records = scope.subquery()
        rows = session.execute(
            select(
                records.c.source,
                func.count(distinct(records.c.creator_id)),
                func.count(),
                func.max(records.c.published),
                func.count().filter(
                    func.jsonb_array_length(records.c.payload["metrics"]) > 0
                ),
            )
            .group_by(records.c.source)
            .order_by(records.c.source)
        )
        platforms = [
            dict(
                platform=SOURCES[k].platform,
                creator_count=cc,
                activity_count=ac,
                latest_published_at=dt.isoformat(),
                measured_count=mc,
                measurement_scope=SOURCES[k].measure,
            )
            for k, cc, ac, dt, mc in rows
        ]
        months = {}
        for i in range(11, -1, -1):
            y, m = divmod(now.year * 12 + now.month - 1 - i, 12)
            months[f"{y:04d}-{m + 1:02d}"] = 0
        start = datetime.fromisoformat(next(iter(months)) + "-01").replace(
            tzinfo=HK_TIME
        )
        month = func.to_char(
            func.timezone("Asia/Hong_Kong", records.c.published), "YYYY-MM"
        )
        for m, c in session.execute(
            select(month, func.count())
            .where(records.c.published >= start, records.c.published <= now)
            .group_by(month)
        ):
            if m in months:
                months[m] = c
        observed = session.scalar(select(func.max(records.c.checked)))
        return dict(
            creator_count=sum(p["creator_count"] for p in platforms),
            activity_count=sum(p["activity_count"] for p in platforms),
            platforms=platforms,
            latest_by_source=[
                item(row)
                for row in session.scalars(
                    scope.distinct(A.source).order_by(
                        A.source, A.published.desc(), A.id
                    )
                )
            ],
            topics=facets(session, scope)["topics"],
            latest_observed_at=observed.isoformat() if observed else None,
            months=[dict(month=m, activity_count=c) for m, c in months.items()],
            window_start=start.isoformat(),
            window_end=now.isoformat(),
        )


def source_status(sessions, key):
    spec = SOURCES[key]
    with sessions() as session:
        state = session.get(MarketSource, key)
        now = database_now(session)
        current = allowed(session, state)
        disposition = (
            "unconfigured"
            if not state
            else "revoked"
            if session.get(SourceRow, state.source_id).approval_status == "revoked"
            else "approved"
            if current and state.error != "publisher_access_blocked"
            else "review_required"
        )
        obs = state.observed if state else None
        exp = obs + FRESH if obs else None
        publication = (
            "available"
            if disposition == "approved" and state.revision and exp and exp > now
            else "collecting"
            if state and state.queued and disposition == "approved"
            else "expired"
            if exp and exp <= now
            else "unavailable"
        )
        result = dict(
            key=key,
            name=spec.name,
            platform=spec.platform,
            rights_url=spec.rights_url,
            state=disposition,
            publication=publication,
            observed_at=obs.isoformat() if obs else None,
            expires_at=exp.isoformat() if exp else None,
            next_check=state.next_check.isoformat() if state else None,
            pending=bool(state and state.generation),
            revision=str(state.revision)
            if state and state.revision and publication == "available"
            else None,
            visible_count=0,
            creator_count=0,
            last_success=None,
            last_attempt=None,
            error=state.error if state else None,
            refresh_due=bool(
                state
                and current
                and disposition == "approved"
                and state.next_check <= now
                and not state.generation
            ),
            acquisition=state.receipt if state else None,
        )
        if publication == "available":
            result["visible_count"], result["creator_count"] = session.execute(
                select(func.count(), func.count(distinct(A.creator_id))).where(
                    A.source == key, A.checked > now - FRESH
                )
            ).one()
        if state:
            jobs = (
                select(JobRow)
                .join(MarketBatch, MarketBatch.job_id == JobRow.id)
                .where(
                    JobRow.source_id == state.source_id,
                    JobRow.profile_version_id == state.profile_id,
                )
                .order_by(JobRow.created_at.desc(), JobRow.id.desc())
            )
            result["last_attempt"] = receipt(session.scalar(jobs.limit(1)))
            result["last_success"] = receipt(
                session.scalar(
                    jobs.where(
                        JobRow.status == "succeeded", JobRow.invalid_count == 0
                    ).limit(1)
                )
            )
        return result


def research_sources(sessions):
    return [
        s
        for key in SOURCES
        if (s := source_status(sessions, key))["state"] == "approved"
    ]


def request_refresh(sessions, key, *, manual=False):
    if key not in SOURCES:
        raise MarketingError(404, "market_source_unknown", "Unknown publication source")
    with sessions.begin() as session:
        state = session.get(MarketSource, key, with_for_update=True)
        if not allowed(session, state) or state.error == "publisher_access_blocked":
            raise MarketingError(
                409,
                "market_review_required",
                "Review and approve the publisher before collection",
            )
        now = database_now(session)
        if state.generation:
            return {"key": key, "state": "collecting"}
        if state.next_check > now and (state.error or not manual):
            return {"key": key, "state": "backoff" if state.error else "current"}
        if manual and state.observed and state.observed + timedelta(minutes=15) > now:
            return {"key": key, "state": "current"}
        state.next_check = now
        return {"key": key, "state": "scheduled"}
