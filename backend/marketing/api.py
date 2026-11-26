"""Local research controls and a data-free marketing capability contract."""

from secrets import compare_digest
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from fastapi.routing import APIRoute
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, StringConstraints, field_validator

from backend.intelligence.store import partner_token
from backend.persistence.database import settings

from .contracts import Account, Capability, ChannelId, DiscoveryResult, Purpose, Run
from .store import MarketingError, ResearchStore


class NonCacheableRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def uncached(request: Request):
            response = await handler(request)
            response.headers["Cache-Control"] = "no-store"
            return response

        return uncached


router = APIRouter(
    prefix="/marketing", tags=["marketing"], route_class=NonCacheableRoute
)
bearer = HTTPBearer(auto_error=False)


class WatchRequest(BaseModel):
    refresh_hours: int = Field(default=24, ge=6, le=168)


class DiscoveryRequest(BaseModel):
    query: Annotated[str, StringConstraints(min_length=2, max_length=100)]

    @field_validator("query", mode="before")
    @classmethod
    def clean_query(cls, value):
        return " ".join(value.split()) if isinstance(value, str) else value


def operator_store(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> ResearchStore:
    values = settings()
    expected = values.get("MARKETING_OPERATOR_TOKEN") or ""
    token = credentials.credentials if credentials else ""
    if (
        len(expected) < 24
        or expected
        in (
            values.get("MARKETING_CUSTOMER_TOKEN"),
            values.get("MARKETING_PILOT_PASSWORD"),
        )
        or not compare_digest(token.encode(), expected.encode())
    ):
        raise MarketingError(
            403, "operator_required", "Marketing operator access is required"
        )
    return request.app.state.marketing


Operator = Annotated[ResearchStore, Depends(operator_store)]


@router.get("/capabilities")
def capabilities(request: Request) -> Capability:
    config = request.app.state.intelligence.config
    return Capability(
        company_accounts=bool(
            settings().get("MARKETING_PILOT_PASSWORD") and partner_token(config)
        ),
        customer_intelligence="available" if partner_token(config) else "unavailable",
        demo_intelligence="available" if config.demo_enabled else "unavailable",
    )


@router.post(
    "/intelligence-requests", responses={403: {"description": "Permission pending"}}
)
def request_intelligence(payload: DiscoveryRequest) -> None:
    raise MarketingError(
        403,
        "commercial_permission_pending",
        "Customer intelligence is unavailable while additional permissions are pending",
    )


@router.put("/research/accounts/{channel_id}")
def watch(channel_id: ChannelId, payload: WatchRequest, store: Operator) -> Account:
    return store.watch(channel_id, payload.refresh_hours)


@router.get("/research/accounts/{channel_id}")
def account(
    channel_id: ChannelId, store: Operator, purpose: Purpose = "research"
) -> Account:
    return store.read_account(channel_id, purpose)


@router.delete("/research/accounts/{channel_id}", status_code=204)
def withdraw(channel_id: ChannelId, store: Operator) -> Response:
    store.withdraw(channel_id)
    return Response(status_code=204)


@router.post("/research/accounts/{channel_id}/refresh", status_code=202)
def refresh(channel_id: ChannelId, store: Operator) -> Run:
    return store.refresh(channel_id)


@router.post("/research/discoveries", status_code=202)
def discover(payload: DiscoveryRequest, store: Operator) -> Run:
    return store.discover(payload.query)


@router.get("/research/discoveries/{run_id}")
def discovery(
    run_id: UUID, store: Operator, purpose: Purpose = "research"
) -> DiscoveryResult:
    return store.read_discovery(run_id, purpose)


@router.get("/research/runs/{run_id}")
def run(run_id: UUID, store: Operator) -> Run:
    return store.read_run(run_id)


@router.post("/research/provider/resume", status_code=204)
def resume(store: Operator) -> Response:
    store.clear_provider_block()
    return Response(status_code=204)
