from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel

from backend.marketing.api import NonCacheableRoute, operator_store
from backend.marketing.store import MarketingError
from .api import CustomerScope, Store
from .operator_receipt import publication_status
from .public_directory import (
    DirectoryResults,
    DirectoryRow,
    activate,
    prepare,
    search,
    snapshot,
)

router = APIRouter(
    prefix="/marketing/intelligence",
    route_class=NonCacheableRoute,
    tags=["public directory"],
)
operator = [Depends(operator_store)]


class ApproveDirectory(BaseModel):
    source_id: UUID
    profile_id: UUID
    report_id: UUID | None


@router.get("/{mode}/public-directory")
def directory(
    scope: CustomerScope, store: Store, q: Annotated[str, Query(max_length=120)] = ""
) -> DirectoryResults:
    if scope.mode != "partner":
        raise MarketingError(
            403,
            "workspace_restricted",
            "Use the operational workspace for public profiles",
        )
    return directory_results(store, q)


@router.get("/public-research/directory")
def local_research_directory(
    store: Store, q: Annotated[str, Query(max_length=120)] = ""
) -> DirectoryResults:
    config = store.config
    if not config.public_demo_directory or not config.demo_enabled or config.workspace:
        raise MarketingError(403, "workspace_restricted", "Use the isolated demo")
    return directory_results(store, q)


def directory_results(store, q):
    result = snapshot(store.sessions)
    if q.strip():
        result = search(result, q.strip(), store.config.model_dir)
        current = snapshot(store.sessions)
        if result.observed != current.observed or result.state != current.state:
            raise MarketingError(409, "catalog_changed", "Refresh the directory")
    return result


@router.get("/operator/public-directory/status", dependencies=operator)
def status(request: Request):
    return publication_status(request, 1, snapshot)


@router.post("/operator/public-directory/prepare", dependencies=operator)
def prepare_directory(request: Request):
    return prepare(request.app.state.profiles, request.app.state.evidence)


@router.post("/operator/public-directory/approve", dependencies=operator)
def approve_directory(body: ApproveDirectory, request: Request):
    activate(
        request.app.state.sessions,
        request.app.state.profiles,
        body.source_id,
        body.profile_id,
        body.report_id,
    )
    return {"state": "approved"}


@router.post("/operator/public-directory/withdraw", dependencies=operator)
def withdraw_directory(request: Request):
    sessions = request.app.state.sessions
    with sessions.begin() as session:
        feed = session.get(DirectoryRow, 1, with_for_update=True)
        if feed:
            request.app.state.profiles.set_authorization(feed.source_id, "revoked")
            feed.pending = feed.published = None
    return {"state": "revoked"}
