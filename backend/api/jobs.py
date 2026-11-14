"""HTTP endpoints for durable collection jobs."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Query, Request, Response

from backend.application.inputs import Entry
from backend.application.jobs import ExecutionEvent, Job, JobStatus
from backend.core.contracts import Contract

router = APIRouter(prefix="/collection-jobs", tags=["collection jobs"])
PageLimit = Annotated[int, Query(ge=1, le=100)]
PageOffset = Annotated[int, Query(ge=0, le=2_147_483_647)]
ListOrder = Literal["oldest", "newest"]


class CreateJob(Contract):
    source_id: UUID
    profile_version_id: UUID
    entry: Entry
    request_key: UUID | None = None


@router.post("", response_model=Job, status_code=201, responses={200: {"model": Job}})
def create_job(request: Request, response: Response, body: CreateJob):
    job, created = request.app.state.jobs.create(
        body.source_id, body.profile_version_id, body.entry, body.request_key
    )
    if not created:
        response.status_code = 200
    return job


@router.get("", response_model=list[Job])
def list_jobs(
    request: Request,
    limit: PageLimit = 50,
    offset: PageOffset = 0,
    status: JobStatus | None = None,
    order: ListOrder = "oldest",
):
    return request.app.state.jobs.list_jobs(
        limit, offset, status=status, newest_first=order == "newest"
    )


@router.get("/{job_id}", response_model=Job)
def get_job(request: Request, job_id: UUID):
    return request.app.state.jobs.get(job_id)


@router.get("/{job_id}/events", response_model=list[ExecutionEvent])
def list_events(request: Request, job_id: UUID):
    return request.app.state.jobs.events(job_id)
