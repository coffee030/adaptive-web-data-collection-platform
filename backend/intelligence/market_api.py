"""Company/public demonstration scoped catalogs and operator publisher controls."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request

from backend.marketing.api import NonCacheableRoute, operator_store
from backend.marketing.store import MarketingError

from . import market_catalog as catalog
from . import market_collection as collection
from .api import CustomerScope, Store
from .market_sources import SOURCES
from .market_measurements import Distribution, distributions

router = APIRouter(
    prefix="/marketing/intelligence",
    route_class=NonCacheableRoute,
    tags=["published creator activity"],
)
operators = [Depends(operator_store)]
Page = Annotated[int, Query(ge=1, le=10000)]
Size = Annotated[int, Query(ge=1, le=100)]
Search = Annotated[str, Query(max_length=240)]
Filter = Annotated[str | None, Query(max_length=100)]


def access(scope: CustomerScope, store: Store):
    cfg = store.config
    if scope.mode != "partner" and (
        not cfg.demo_enabled or not cfg.public_demo_directory or cfg.workspace
    ):
        raise MarketingError(
            403,
            "workspace_restricted",
            "Open an authorized company or public research workspace",
        )
    return store.sessions


Sessions = Annotated[object, Depends(access)]


@router.get("/{mode}/market/creators")
def creators(
    sessions: Sessions,
    q: Search = "",
    platform: Filter = None,
    topic: Filter = None,
    sort: Literal["recent", "activity", "name"] = "recent",
    page: Page = 1,
    page_size: Size = 20,
):
    return catalog.search_creators(sessions, q, platform, topic, page, page_size, sort)


@router.get("/{mode}/market/creators/{creator_id}")
def profile(creator_id: str, sessions: Sessions):
    return catalog.creator_detail(sessions, creator_id)


@router.get("/{mode}/market/activity")
def activity(
    sessions: Sessions,
    q: Search = "",
    platform: Filter = None,
    topic: Filter = None,
    creator_id: Filter = None,
    page: Page = 1,
    page_size: Size = 20,
):
    return catalog.search_activity(
        sessions, q, platform, topic, creator_id, page, page_size
    )


@router.get("/{mode}/market/measurements")
def measurements(
    sessions: Sessions,
    platform: Filter = None,
    creator_id: Filter = None,
    days: Annotated[int | None, Query(ge=1, le=3650)] = None,
) -> list[Distribution]:
    return distributions(sessions, platform, creator_id, days)


@router.get("/{mode}/market/overview")
def overview(sessions: Sessions):
    return catalog.overview(sessions)


@router.get("/operator/market/sources", dependencies=operators)
def sources(request: Request):
    return {
        "items": [
            catalog.source_status(request.app.state.sessions, key) for key in SOURCES
        ]
    }


@router.post("/operator/market/sources/{key}/refresh", dependencies=operators)
def refresh(key: str, request: Request):
    return catalog.request_refresh(request.app.state.sessions, key, manual=True)


@router.post("/operator/market/sources/{key}/withdraw", dependencies=operators)
def withdraw(key: str, request: Request):
    if key not in SOURCES:
        raise MarketingError(404, "market_source_unknown", "Unknown publication source")
    collection.withdraw(request.app.state.sessions, key)
    return {"key": key, "state": "revoked"}


@router.post("/operator/market/sources/{key}/restore", dependencies=operators)
def restore(key: str, request: Request):
    if key not in SOURCES:
        raise MarketingError(404, "market_source_unknown", "Unknown publication source")
    collection.install(
        request.app.state.sessions, request.app.state.evidence, key, restore=True
    )
    return {"key": key, "state": "scheduled"}
