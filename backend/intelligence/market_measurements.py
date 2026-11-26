from datetime import timedelta

from pydantic import BaseModel
from sqlalchemy import BigInteger, cast, column, func, select, true
from sqlalchemy.dialects.postgresql import JSONB

from backend.application.jobs import database_now
from .market_catalog import A, activity_query
from .market_sources import SOURCES


class Distribution(BaseModel):
    platform: str
    key: str
    label: str
    works: int
    lower_quartile: float
    median: float
    upper_quartile: float
    observed_from: str
    observed_through: str
    definition: str


def summarize(session, eligible):
    records = eligible.subquery()
    metrics = (
        func.jsonb_array_elements(records.c.payload["metrics"])
        .table_valued(column("value", JSONB))
        .lateral()
    )
    key = metrics.c.value["key"].astext
    label = metrics.c.value["label"].astext
    number = cast(metrics.c.value["value"].astext, BigInteger)
    results = session.execute(
        select(
            records.c.source,
            key.label("key"),
            label.label("label"),
            func.count().label("works"),
            func.percentile_cont(0.25).within_group(number).label("lower_quartile"),
            func.percentile_cont(0.5).within_group(number).label("median"),
            func.percentile_cont(0.75).within_group(number).label("upper_quartile"),
            func.min(records.c.checked).label("observed_from"),
            func.max(records.c.checked).label("observed_through"),
        )
        .select_from(records.join(metrics, true()))
        .where(number.is_not(None))
        .group_by(records.c.source, key, label)
        .order_by(records.c.source, key)
    ).mappings()
    return [
        Distribution(
            platform=SOURCES[r["source"]].platform,
            definition=SOURCES[r["source"]].measure,
            **{
                key: r[key]
                for key in (
                    "key",
                    "label",
                    "works",
                    "lower_quartile",
                    "median",
                    "upper_quartile",
                )
            },
            observed_from=r["observed_from"].isoformat(),
            observed_through=r["observed_through"].isoformat(),
        )
        for r in results
    ]


def distributions(
    sessions, platform: str | None, creator_id: str | None, days: int | None
):
    with sessions() as session:
        now = database_now(session)
        records = activity_query(
            session, platform=platform, creator_id=creator_id
        ).where(A.published <= now)
        if days is not None:
            records = records.where(A.published >= now - timedelta(days=days))
        return summarize(session, records)
