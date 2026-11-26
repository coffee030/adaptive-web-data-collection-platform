from datetime import datetime, timezone

from sqlalchemy import literal, select, union_all
from sqlalchemy.dialects.postgresql import JSONB

from backend.intelligence.market_measurements import summarize
from backend.intelligence.market_sources import SOURCES


def test_quartiles_use_only_observed_counters_and_never_combine_platforms(sessions):
    source, other = list(SOURCES)[:2]
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def work(key, metrics):
        return select(
            literal(key).label("source"),
            literal(now).label("checked"),
            literal({"metrics": metrics}, type_=JSONB).label("payload"),
        )

    def score(value):
        return [{"key": "favorites", "label": "Favorites", "value": value}]

    rows = union_all(
        work(source, score(0)),
        work(source, score(4)),
        work(source, score(8)),
        work(source, score(12)),
        work(source, []),
        work(other, score(80)),
    )
    with sessions() as session:
        result = {r.platform: r for r in summarize(session, rows)}
    measured = result[SOURCES[source].platform]
    assert (
        measured.works,
        measured.lower_quartile,
        measured.median,
        measured.upper_quartile,
    ) == (4, 3, 6, 9)
    assert result[SOURCES[other].platform].median == 80
