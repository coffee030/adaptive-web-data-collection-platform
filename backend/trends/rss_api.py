from typing import Annotated

from fastapi import APIRouter, Request
from pydantic import Field, StringConstraints, model_validator
from sqlalchemy import select

from backend.core.contracts import Contract, Name

from . import rss_schedule as schedules
from .rss_models import RssSchedule

router = APIRouter(prefix="/trends/google", tags=["Google Trending Now"])
Region = Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}$")]
Interval = Annotated[int, Field(ge=10, le=1440, strict=True)]


class Setup(Contract):
    region: Region
    approver: Name


class Schedule(Contract):
    region: Region
    interval_minutes: Interval = 60


class Update(Contract):
    active: bool | None = None
    interval_minutes: Interval | None = None

    @model_validator(mode="after")
    def has_update(self):
        if self.active is None and self.interval_minutes is None:
            raise ValueError("Change the schedule activity or interval.")
        return self


@router.get("/provider")
def status(request: Request):
    with request.app.state.sessions() as session:
        return schedules.provider_status(session, schedules.provider(session))


@router.post("/provider")
def setup(body: Setup, request: Request):
    state = request.app.state
    return schedules.setup(
        state.sessions, state.profiles, state.evidence, body.region, body.approver
    )


@router.get("/schedules")
def list_schedules(request: Request):
    with request.app.state.sessions() as session:
        rows = session.scalars(select(RssSchedule).order_by(RssSchedule.region))
        return [schedules.outcome(row) for row in rows]


@router.post("/schedules", status_code=201)
def add(body: Schedule, request: Request):
    return schedules.add(request.app.state.sessions, body.region, body.interval_minutes)


@router.patch("/schedules/{region}")
def update(region: Region, body: Update, request: Request):
    return schedules.update(
        request.app.state.sessions, region, body.active, body.interval_minutes
    )


@router.get("/schedules/{region}/snapshot")
def snapshot(region: Region, request: Request):
    return schedules.latest_snapshot(request.app.state.sessions, region)
