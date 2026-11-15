"""Read-only views of committed collection results."""

from uuid import UUID

from fastapi import APIRouter, Request

from backend.application.results import Evidence, QuarantinedRecord, Record

from .jobs import ListOrder, PageLimit, PageOffset

router = APIRouter(tags=["results"])


@router.get("/records", response_model=list[Record])
def list_records(
    request: Request,
    job_id: UUID | None = None,
    limit: PageLimit = 50,
    offset: PageOffset = 0,
    order: ListOrder = "oldest",
):
    return request.app.state.results.list_records(
        job_id, limit, offset, newest_first=order == "newest"
    )


@router.get("/records/{record_id}", response_model=Record)
def get_record(request: Request, record_id: UUID):
    return request.app.state.results.record(record_id)


@router.get("/evidence/{evidence_id}", response_model=Evidence)
def get_evidence(request: Request, evidence_id: UUID):
    return request.app.state.results.evidence(evidence_id)


@router.get("/collection-jobs/{job_id}/evidence", response_model=Evidence | None)
def get_job_evidence(request: Request, job_id: UUID):
    return request.app.state.results.job_evidence(job_id)


@router.get("/collection-jobs/{job_id}/evidence-pages", response_model=list[Evidence])
def list_job_evidence(request: Request, job_id: UUID):
    return request.app.state.results.job_evidence_pages(job_id)


@router.get(
    "/collection-jobs/{job_id}/quarantine", response_model=list[QuarantinedRecord]
)
def list_quarantine(
    request: Request,
    job_id: UUID,
    limit: PageLimit = 50,
    offset: PageOffset = 0,
):
    return request.app.state.results.quarantine(job_id, limit, offset)
