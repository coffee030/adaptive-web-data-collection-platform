from datetime import UTC, date, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Request, Response
from pydantic import BeforeValidator, Field, StringConstraints, field_validator
from sqlalchemy import select

from backend.core.contracts import Contract, Name
from backend.persistence.models import JobRow

from . import service, wikimedia
from .models import WikiBatch, WikiWatch

router = APIRouter(prefix="/trends/wikimedia", tags=["Wikimedia trends"])
Project = Annotated[
    str, StringConstraints(max_length=80), BeforeValidator(wikimedia.project_key)
]
Article = Annotated[
    str, StringConstraints(max_length=250), BeforeValidator(wikimedia.article_key)
]


class Scope(Contract):
    project: Project
    day: date

    @field_validator("day")
    @classmethod
    def past_day(cls, value):
        if not wikimedia.FIRST_DAY <= value < datetime.now(UTC).date():
            raise ValueError("Use a completed UTC date on or after 2015-07-01.")
        return value


class Discovery(Scope):
    limit: Annotated[int, Field(ge=1, le=50)] = 20


class Setup(Scope):
    article: Article
    approver: Name


class Watch(Scope):
    article: Article
    topic: Name

    @field_validator("day")
    @classmethod
    def initial_window(cls, value):
        if (
            not timedelta(days=2)
            <= datetime.now(UTC).date() - value
            <= timedelta(days=90)
        ):
            raise ValueError("Choose an initial date between 2 and 90 days ago (UTC).")
        return value


class Activity(Contract):
    active: bool
    backfill_from: date | None = None


@router.get("/provider")
def status(request: Request):
    with request.app.state.sessions() as session:
        return service.provider_status(session, service.provider(session))


@router.post("/discover")
def discover(body: Discovery, request: Request):
    return service.discovery(request.app.state.sessions, body)


@router.post("/provider")
def setup(body: Setup, request: Request):
    state = request.app.state
    return service.setup(state.sessions, state.profiles, state.evidence, body)


@router.get("/series")
def list_series(request: Request):
    with request.app.state.sessions() as session:
        return [
            service.outcome(row)
            for row in session.scalars(
                select(WikiWatch).order_by(
                    WikiWatch.topic, WikiWatch.project, WikiWatch.article
                )
            )
        ]


@router.post("/series")
def add_series(body: Watch, request: Request):
    return service.add_watch(request.app.state.sessions, body)


@router.patch("/series/{watch_id}")
def update_series(watch_id: UUID, body: Activity, request: Request):
    return service.set_active(request.app.state.sessions, watch_id, body)


@router.get("/compare")
def compare(
    request: Request,
    watch_id: Annotated[list[UUID], Query(min_length=1, max_length=8)],
    start: date,
    end: date,
):
    if not wikimedia.FIRST_DAY <= start <= end or (end - start).days >= 90:
        raise service.TrendError(
            422, "invalid_date_window", "Choose an ordered UTC window of up to 90 days."
        )
    return service.compare(
        request.app.state.sessions, list(dict.fromkeys(watch_id)), start, end
    )


@router.get("/captures/{job_id}", response_class=Response)
def capture(job_id: UUID, request: Request):
    with request.app.state.sessions() as session:
        if not service.approved(session, service.provider(session)):
            raise service.TrendError(
                403, "source_not_approved", "The source has no active approval."
            )
        batch = session.get(WikiBatch, job_id)
        job = session.get(JobRow, job_id) if batch else None
        if (
            not job
            or job.status != "succeeded"
            or job.invalid_count
            or job.duplicate_count
            or job.valid_count != batch.row_count
        ):
            raise service.TrendError(
                404, "capture_unavailable", "No published capture for this Core job."
            )
        return Response(
            content=batch.response,
            media_type="application/json",
            headers={
                "X-Content-SHA256": batch.response_sha256,
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "no-store",
            },
        )
