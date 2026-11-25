"""Exact selection for additive creator utility and integer campaign budgets."""

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel


@dataclass(frozen=True)
class Item:
    creator_id: str
    fee_minor: int
    utility: int


class Plan(BaseModel):
    status: Literal["optimal", "infeasible", "search_limit"]
    selected: list[str] = []
    total_minor: int | None = None
    utility_units: int | None = None


def optimize(
    items: list[Item], budget: int, minimum: int, maximum: int, limit: int = 25_000
) -> Plan:
    if not 0 <= minimum <= maximum or budget < 0:
        raise ValueError("Invalid budget or count bounds")
    if len({item.creator_id for item in items}) != len(items):
        raise ValueError("Duplicate creator")
    if any(item.fee_minor < 0 or item.utility < 0 for item in items):
        raise ValueError("Negative fee or utility")

    states = [{0: (0, ())}] + [{} for _ in range(min(maximum, len(items)))]
    for item in sorted(items, key=lambda item: item.creator_id):
        for count in reversed(range(1, len(states))):
            bucket = states[count]
            for cost, (negative, selected) in states[count - 1].items():
                new_cost = cost + item.fee_minor
                if new_cost <= budget:
                    entry = (negative - item.utility, selected + (item.creator_id,))
                    bucket[new_cost] = min(entry, bucket.get(new_cost, entry))
                    if len(bucket) > limit:
                        return Plan(status="search_limit")
            best = 1
            frontier = {}
            for cost, entry in sorted(bucket.items()):
                if entry[0] < best:
                    frontier[cost] = entry
                    best = entry[0]
            states[count] = frontier
        if sum(map(len, states)) > limit:
            return Plan(status="search_limit")

    finalists = (
        (negative, cost, selected)
        for bucket in states[minimum:]
        for cost, (negative, selected) in bucket.items()
    )
    result = min(finalists, default=None)
    if result is None:
        return Plan(status="infeasible")
    negative, cost, selected = result
    return Plan(
        status="optimal",
        selected=list(selected),
        total_minor=cost,
        utility_units=-negative,
    )
