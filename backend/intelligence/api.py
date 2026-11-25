"""Campaign, catalog and operator endpoints for the separate intelligence store."""

from secrets import compare_digest
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel

from backend.marketing.api import NonCacheableRoute, bearer, operator_store
from backend.marketing.pilot_access import BrowserLogin, pilot_customer
from backend.marketing.store import MarketingError

from .analytics import ScenarioResult, scenario
from .catalog import Catalog, CreatorDetail, CreatorSummary, Observed, detail, summary
from .contracts import (
    Campaign,
    CompareRequest,
    Content,
    Platform,
    Deliverable,
    CreatorFilter,
    ImportDataset,
    Mode,
    Ref,
    Scenario,
)
from .recommend import CampaignResult, recommend
from .store import (
    DEMO,
    Config,
    DatasetStatus,
    IntelligenceStore,
    Scope,
    partner_token,
    valid_workspace,
)

router = APIRouter(
    prefix="/marketing/intelligence",
    tags=["marketing intelligence"],
    route_class=NonCacheableRoute,
)
credentials_dependency = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]


def scope_for(mode: Mode, config: Config, *, administrative: bool = False) -> Scope:
    if mode == "demo" and (config.demo_enabled or administrative):
        return DEMO
    if mode == "partner" and (
        valid_workspace(config) if administrative else partner_token(config)
    ):
        return Scope("partner", config.workspace)
    raise MarketingError(
        403, "workspace_restricted", "This intelligence workspace is unavailable"
    )


def customer_scope(
    mode: Mode,
    request: Request,
    credentials: credentials_dependency,
    login: BrowserLogin,
) -> Scope:
    config = request.app.state.intelligence.config
    scope = scope_for(mode, config)
    if mode == "partner":
        expected = partner_token(config)
        if credentials is None and pilot_customer(login):
            return scope
        actual = credentials.credentials if credentials else ""
        if not expected or not compare_digest(actual.encode(), expected.encode()):
            raise MarketingError(
                403, "workspace_restricted", "Partner workspace access is required"
            )
    return scope


CustomerScope = Annotated[Scope, Depends(customer_scope)]


def intelligence(request: Request) -> IntelligenceStore:
    return request.app.state.intelligence


Store = Annotated[IntelligenceStore, Depends(intelligence)]


class DiscoveryItem(CreatorSummary):
    preview: Observed[Content] | None


class DiscoveryResponse(BaseModel):
    mode: Mode
    state: Literal["available", "empty"]
    creators: list[DiscoveryItem]


class Comparison(BaseModel):
    mode: Mode
    state: Literal["available", "empty", "incomplete"]
    creators: list[CreatorDetail]
    unavailable_ids: list[str]


class Processing(BaseModel):
    revision: str
    mode: Mode
    state: Literal["empty", "preparing", "ready", "fallback"]
    eligible_datasets: int
    indexed_datasets: int


@router.get("/{mode}/creators")
def discover_creators(
    scope: CustomerScope,
    store: Store,
    filters: Annotated[CreatorFilter, Query()],
) -> DiscoveryResponse:
    snapshot = store.snapshot(scope)
    creators = []
    for creator in Catalog(snapshot).creators.values():
        preview = creator.preview(filters)
        if creator.matches(filters, preview):
            creators.append(
                DiscoveryItem(**summary(creator).model_dump(), preview=preview)
            )
    creators.sort(
        key=lambda item: (
            item.profile.data.name.casefold(),
            item.profile.data.creator_id,
        )
    )
    store.assert_current(scope, snapshot.revision)
    return DiscoveryResponse(
        mode=scope.mode, state="available" if creators else "empty", creators=creators
    )


class BriefOptions(BaseModel):
    mode: Mode
    reviewed_facts: list[str]
    quoted_deliverables: list[Deliverable]


@router.get("/{mode}/brief-options")
def brief_options(
    platform: Platform, scope: CustomerScope, store: Store
) -> BriefOptions:
    snapshot = store.snapshot(scope)
    creators = Catalog(snapshot).creators.values()
    facts = {
        fact
        for creator in creators
        for post in creator.posts
        if post.record.data.platform == platform
        for fact in post.record.data.reviewed_facts
    }
    quoted = {
        quote.data.deliverable
        for creator in creators
        for quote in creator.active_quotes()
        if quote.data.platform == platform and quote.data.currency == "HKD"
    }
    store.assert_current(scope, snapshot.revision)
    return BriefOptions(
        mode=scope.mode,
        reviewed_facts=sorted(facts),
        quoted_deliverables=sorted(quoted),
    )


@router.get("/{mode}/creators/{creator_id}")
def get_creator(creator_id: Ref, scope: CustomerScope, store: Store) -> CreatorDetail:
    snapshot = store.snapshot(scope)
    creator = Catalog(snapshot).creators.get(creator_id)
    if creator is None:
        raise MarketingError(
            404, "creator_unavailable", "Creator is unavailable in this workspace"
        )
    result = detail(creator)
    store.assert_current(scope, snapshot.revision)
    return result


@router.post("/{mode}/creators/compare")
def compare(body: CompareRequest, scope: CustomerScope, store: Store) -> Comparison:
    snapshot = store.snapshot(scope)
    creators = Catalog(snapshot).creators
    requested = list(dict.fromkeys(body.creator_ids))
    selected = [detail(creators[key]) for key in requested if key in creators]
    missing = [key for key in requested if key not in creators]
    store.assert_current(scope, snapshot.revision)
    return Comparison(
        mode=scope.mode,
        creators=selected,
        unavailable_ids=missing,
        state="empty" if not selected else ("incomplete" if missing else "available"),
    )


@router.post("/{mode}/campaign-briefs")
def campaign_brief(
    body: Campaign, scope: CustomerScope, store: Store
) -> CampaignResult:
    snapshot = store.snapshot(scope)
    result = recommend(Catalog(snapshot), body, scope.mode, store.config.model_dir)
    store.assert_current(scope, snapshot.revision)
    return result


@router.post("/{mode}/scenarios")
def calculate_scenario(body: Scenario, scope: CustomerScope) -> ScenarioResult:
    return scenario(body)


@router.get("/{mode}/processing")
def processing(scope: CustomerScope, store: Store) -> Processing:
    revision, states, eligible, indexed = store.processing_status(scope)
    if not states:
        state = "empty"
    elif store.config.model_dir is None or "fallback" in states:
        state = "fallback"
    elif states & {"lexical", "running"}:
        state = "preparing"
    else:
        state = "ready"
    return Processing(
        mode=scope.mode,
        state=state,
        revision=revision,
        eligible_datasets=eligible,
        indexed_datasets=indexed,
    )


@router.get("/operator/{mode}/datasets", dependencies=[Depends(operator_store)])
def dataset_directory(mode: Mode, store: Store, after: Ref | None = None) -> list[str]:
    return store.dataset_ids(scope_for(mode, store.config, administrative=True), after)


@router.put(
    "/operator/{mode}/datasets/{dataset_id}", dependencies=[Depends(operator_store)]
)
def ingest(
    mode: Mode, dataset_id: Ref, body: ImportDataset, store: Store
) -> DatasetStatus:
    return store.ingest(scope_for(mode, store.config), dataset_id, body)


@router.get(
    "/operator/{mode}/datasets/{dataset_id}", dependencies=[Depends(operator_store)]
)
def dataset_status(mode: Mode, dataset_id: Ref, store: Store) -> DatasetStatus:
    return store.status(scope_for(mode, store.config, administrative=True), dataset_id)


@router.delete(
    "/operator/{mode}/datasets/{dataset_id}",
    status_code=204,
    dependencies=[Depends(operator_store)],
)
def withdraw(mode: Mode, dataset_id: Ref, store: Store) -> Response:
    store.withdraw(scope_for(mode, store.config, administrative=True), dataset_id)
    return Response(status_code=204)
