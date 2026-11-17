"""Read-only views of committed collection results."""

from uuid import UUID

from fastapi import APIRouter, Request, Response

from backend.application.record_export import ExportFormat
from backend.application.results import (
    Evidence,
    QuarantinedRecord,
    Record,
    RecordDetail,
)

from .jobs import ListOrder, PageLimit, PageOffset

router = APIRouter(tags=["results"])

_export_media = {"csv": "text/csv; charset=utf-8", "json": "application/json"}
_export_responses = {
    200: {
        "content": {
            media.split(";")[0]: {"schema": {"type": "string", "format": "binary"}}
            for media in _export_media.values()
        }
    },
    404: {"description": "Job or request does not exist"},
    409: {"description": "The scope still has unfinished jobs"},
    413: {"description": "The complete export would exceed the row or byte limit"},
}


def _export(request, scope, scope_id, format):
    body = request.app.state.results.export_records(scope, scope_id, format)
    return Response(
        body,
        media_type=_export_media[format],
        headers={
            "Content-Disposition": f'attachment; filename="{scope}-{scope_id}-records.{format}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get(
    "/collection-jobs/{job_id}/records/export",
    response_class=Response,
    responses=_export_responses,
)
def export_job_records(request: Request, job_id: UUID, format: ExportFormat):
    return _export(request, "job", job_id, format)


@router.get(
    "/collection-requests/{request_id}/records/export",
    response_class=Response,
    responses=_export_responses,
)
def export_request_records(request: Request, request_id: UUID, format: ExportFormat):
    return _export(request, "request", request_id, format)


@router.get("/records", response_model=list[Record])
def list_records(
    request: Request,
    job_id: UUID | None = None,
    limit: PageLimit = 50,
    offset: PageOffset = 0,
    order: ListOrder = "oldest",
    request_id: UUID | None = None,
):
    return request.app.state.results.list_records(
        job_id, limit, offset, newest_first=order == "newest", request_id=request_id
    )


@router.get("/records/{record_id}", response_model=RecordDetail | Record)
def get_record(request: Request, record_id: UUID, include_lineage: bool = False):
    return request.app.state.results.record(record_id, include_lineage=include_lineage)


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
