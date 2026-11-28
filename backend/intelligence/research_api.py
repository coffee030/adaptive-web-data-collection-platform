from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Request
from sqlalchemy import select

from backend.marketing.api import NonCacheableRoute
from backend.marketing.company_api import Database, User
from .research_contracts import NewResearch
from .research_models import ResearchRunRow
from .research_preparation import prepare
from .research_preparation_contracts import (
    ConfirmedResearch,
    ResearchPreparation,
    ResearchPreview,
)
from .research_runs import ResearchRuns, change, owned, receipt, start


router = APIRouter(
    prefix="/marketing/companies/research-runs",
    route_class=NonCacheableRoute,
    tags=["company research"],
)


@router.post("/preview")
def preview_research(body: ResearchPreparation, user: User) -> ResearchPreview:
    return prepare(user.id, body)


@router.post("")
def submit_research(
    body: NewResearch | ConfirmedResearch, user: User, session: Database
):
    return start(session, user.id, body)


@router.get("")
def recent_research(
    user: User,
    session: Database,
    limit: Annotated[int, Query(ge=1, le=26)] = 10,
    offset: Annotated[int, Query(ge=0, le=2147483647)] = 0,
    campaign_id: UUID | None = None,
):
    query = select(ResearchRunRow).where(ResearchRunRow.company_id == user.id)
    if campaign_id is not None:
        query = query.where(ResearchRunRow.campaign_id == campaign_id)
    runs = session.scalars(
        query.order_by(ResearchRunRow.created_at.desc(), ResearchRunRow.id.desc())
        .offset(offset)
        .limit(limit)
    )
    return [receipt(row) for row in runs]


@router.get("/{run_id}")
def read_research(run_id: UUID, user: User, session: Database):
    return receipt(owned(session, user.id, run_id))


@router.get("/{run_id}/results")
def research_results(run_id: UUID, user: User, session: Database, request: Request):
    store = request.app.state.intelligence
    return ResearchRuns(store.sessions, store.config).results(session, user.id, run_id)


@router.post("/{run_id}/cancel")
def cancel_research(run_id: UUID, user: User, session: Database):
    return change(session, user.id, run_id, "cancel")


@router.post("/{run_id}/resume")
def resume_research(run_id: UUID, user: User, session: Database):
    return change(session, user.id, run_id, "resume")
