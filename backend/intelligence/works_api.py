"""Public historical works use a separate read surface from company marketing eligibility."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from backend.marketing.api import NonCacheableRoute, operator_store
from backend.marketing.store import MarketingError
from . import commons_works, public_feed, work_search
from .api import CustomerScope, Store
from .directory_api import ApproveDirectory
from .operator_receipt import publication_status

router = APIRouter(
    prefix="/marketing/intelligence",
    route_class=NonCacheableRoute,
    tags=["historical works"],
)
operator = [Depends(operator_store)]
Search = Annotated[str, Query(max_length=240)]


@router.get("/public-research/works")
def demo_works(store: Store, q: Search = "") -> work_search.ResearchResults:
    config = store.config
    if not config.public_demo_directory or not config.demo_enabled or config.workspace:
        raise MarketingError(
            403, "workspace_restricted", "Open the public research demo"
        )
    return work_search.snapshot(store.sessions, q, store.config.model_dir)


@router.get("/{mode}/public-works")
def company_works(
    scope: CustomerScope, store: Store, q: Search = ""
) -> work_search.ResearchResults:
    if scope.mode != "partner":
        raise MarketingError(403, "workspace_restricted", "Use company research")
    return work_search.snapshot(store.sessions, q, store.config.model_dir)


@router.get("/operator/public-works/status", dependencies=operator)
def status(request: Request):
    return publication_status(
        request, commons_works.feed().row_id, work_search.snapshot
    )


@router.post("/operator/public-works/prepare", dependencies=operator)
def prepare(request: Request):
    return public_feed.prepare(
        request.app.state.profiles, request.app.state.evidence, commons_works.feed()
    )


@router.post("/operator/public-works/approve", dependencies=operator)
def approve(body: ApproveDirectory, request: Request):
    public_feed.activate(
        request.app.state.sessions,
        request.app.state.profiles,
        body.source_id,
        body.profile_id,
        body.report_id,
        commons_works.feed(),
        approver="Historical works operator",
    )
    return {"state": "approved"}


@router.post("/operator/public-works/withdraw", dependencies=operator)
def withdraw(request: Request):
    with request.app.state.sessions.begin() as session:
        feed = session.get(
            public_feed.DirectoryRow, commons_works.feed().row_id, with_for_update=True
        )
        if feed:
            request.app.state.profiles.set_authorization(feed.source_id, "revoked")
            feed.pending = feed.published = None
    return {"state": "revoked"}
