"""Descriptive metrics and explicitly assumption-based campaign scenarios."""

from decimal import Decimal
from statistics import median
from typing import Literal

from pydantic import BaseModel

from .contracts import Performance, Scenario


class Measure(BaseModel):
    status: Literal[
        "observed", "calculated", "estimated", "predicted", "assumed", "unavailable"
    ]
    value: Decimal | None
    observations: int | None = None


def calculated(value: Decimal | int | None, count: int | None = None) -> Measure:
    return Measure(
        status="calculated" if value is not None else "unavailable",
        value=value,
        observations=count,
    )


def _median(values: list[int]) -> Decimal | None:
    return Decimal(str(median(values))) if values else None


def interactions(row: Performance) -> int | None:
    if row.likes is not None and row.comments is not None:
        return row.likes + row.comments
    return None


def consistency(values: list[int]) -> Measure:
    center = _median(values)
    if len(values) < 5 or center is None or center == 0:
        return calculated(None, len(values))
    deviation = median(abs(value - center) for value in values)
    return calculated(1 / (1 + deviation / center), len(values))


class Historical(BaseModel):
    window_days: Literal[7] = 7
    median_views: Measure
    median_interactions: Measure
    interaction_rate: Measure
    views_consistency: Measure
    interaction_consistency: Measure


def history(observations: list[Performance]) -> Historical:
    views = [row.views for row in observations if row.views is not None]
    activity = [
        value for row in observations if (value := interactions(row)) is not None
    ]
    comparable = [
        row for row in observations if row.views and interactions(row) is not None
    ]
    rate = (
        Decimal(sum(interactions(row) for row in comparable))
        / sum(row.views for row in comparable)
        if comparable
        else None
    )
    return Historical(
        median_views=calculated(_median(views), len(views)),
        median_interactions=calculated(_median(activity), len(activity)),
        interaction_rate=calculated(rate, len(comparable)),
        views_consistency=consistency(views),
        interaction_consistency=consistency(activity),
    )


class ScenarioResult(BaseModel):
    basis: Literal["assumption_based"] = "assumption_based"
    assumptions: Scenario
    clicks: Measure
    conversions: Measure
    attributed_revenue_minor: Measure
    roas: Measure
    roi: Measure


def scenario(assumptions: Scenario) -> ScenarioResult:
    impressions = assumptions.impressions
    rate = assumptions.click_rate
    conversion_rate = assumptions.conversion_rate
    value = assumptions.value_per_conversion_minor
    spend = assumptions.spend_minor
    clicks = (
        impressions * rate if impressions is not None and rate is not None else None
    )
    conversions = (
        clicks * conversion_rate
        if clicks is not None and conversion_rate is not None
        else None
    )
    revenue = (
        conversions * value if conversions is not None and value is not None else None
    )
    return ScenarioResult(
        assumptions=assumptions,
        clicks=calculated(clicks),
        conversions=calculated(conversions),
        attributed_revenue_minor=calculated(revenue),
        roas=calculated(revenue / spend if revenue is not None and spend else None),
        roi=calculated(
            (revenue - spend) / spend if revenue is not None and spend else None
        ),
    )
