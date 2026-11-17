"""Source and profile transport routes."""

from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Request, Response
from pydantic import Field, ValidationError, computed_field

from backend.application.inputs import Entry
from backend.core.contracts import (
    AdapterType,
    CandidateRecord,
    Configuration,
    Contract,
    Name,
    PathPrefix,
    ProfileValidationReport,
    Sha256,
    Source,
    SourceProfileVersion,
)
from backend.core.profiles import ProfileError

router = APIRouter(prefix="/sources", tags=["sources and profiles"])
VERSIONS = "/{source_id}/versions"
VERSION = VERSIONS + "/{version_id}"


class Authorization(Contract):
    approval_status: Literal["pending", "approved", "revoked"]


class CreateSource(Authorization):
    approval_status: Literal["pending", "approved", "revoked"] = "pending"
    source_name: Name
    adapter_type: AdapterType
    permission_reference: Name
    allowed_origins: tuple[str, ...] = ()
    allowed_datasets: tuple[Name, ...] = ()
    allowed_paths: dict[str, tuple[PathPrefix, ...]] = Field(default_factory=dict)
    min_request_interval_ms: Annotated[int, Field(strict=True, ge=1000, le=10_000)] = (
        1000
    )
    request_key: UUID | None = None

    def to_source(self):
        return Source(source_id=uuid4().hex, **self.model_dump(exclude={"request_key"}))


class VersionBody(Contract):
    configuration: Configuration


class DraftEdit(VersionBody):
    expected_revision: (
        Annotated[int, Field(strict=True, ge=1, le=2147483647)] | None
    ) = None


class ProfileSnapshot(SourceProfileVersion):
    revision: int


def snapshot(profile: SourceProfileVersion, revision: int) -> ProfileSnapshot:
    return ProfileSnapshot(**profile.model_dump(), revision=revision)


class Approval(Contract):
    approver: Name
    report_id: UUID
    config_hash: Sha256


@router.post(
    "", response_model=Source, status_code=201, responses={200: {"model": Source}}
)
def create_source(request: Request, response: Response, body: CreateSource):
    try:
        source = body.to_source()
    except ValidationError as error:
        reason = error.errors(
            include_input=False, include_url=False, include_context=False
        )[0]["msg"]
        raise ProfileError("invalid_source_policy", reason) from error
    if body.request_key is None:
        return request.app.state.profiles.register_source(source)
    result, created = request.app.state.profiles.register_source_once(
        source, body.request_key
    )
    if not created:
        response.status_code = 200
    return result


@router.get("", response_model=list[Source])
def list_sources(request: Request):
    return request.app.state.profiles.list_sources()


@router.get("/{source_id}", response_model=Source)
def get_source(request: Request, source_id: UUID):
    return request.app.state.profiles.get_source(source_id)


@router.patch("/{source_id}/authorization", response_model=Source)
def change_authorization(request: Request, source_id: UUID, body: Authorization):
    return request.app.state.profiles.set_authorization(source_id, body.approval_status)


@router.post(VERSIONS, response_model=ProfileSnapshot, status_code=201)
def create_version(request: Request, source_id: UUID, body: VersionBody):
    draft = request.app.state.profiles.create_draft(source_id, body.configuration)
    return snapshot(draft, 1)


@router.get(VERSIONS, response_model=list[ProfileSnapshot])
def list_versions(request: Request, source_id: UUID):
    return [
        snapshot(*version)
        for version in request.app.state.profiles.list_versions(source_id)
    ]


@router.get(VERSION, response_model=ProfileSnapshot)
def get_version(request: Request, source_id: UUID, version_id: UUID):
    return snapshot(
        *request.app.state.profiles.get_version_snapshot(source_id, version_id)
    )


@router.put(VERSION, response_model=ProfileSnapshot)
def edit_version(request: Request, source_id: UUID, version_id: UUID, body: DraftEdit):
    edited = request.app.state.profiles.edit_draft(
        source_id,
        version_id,
        body.configuration,
        expected_revision=body.expected_revision,
    )
    assert body.expected_revision is not None
    return snapshot(edited, body.expected_revision + 1)


@router.post(VERSION + "/preview", response_model=list[CandidateRecord])
def preview(request: Request, source_id: UUID, version_id: UUID, body: Entry):
    return request.app.state.profiles.preview(
        source_id, version_id, body.collection_input(), request.app.state.evidence
    )


ProfileValidationReport.model_rebuild()


class ValidationResult(ProfileValidationReport):
    @computed_field
    @property
    def passed(self) -> bool:
        return super().passed


@router.post(VERSION + "/validate", response_model=ValidationResult)
def validate(request: Request, source_id: UUID, version_id: UUID, body: Entry):
    report = request.app.state.profiles.validate(
        source_id, version_id, body.collection_input(), request.app.state.evidence
    )
    return ValidationResult.model_validate(report.model_dump())


@router.post(VERSION + "/approve", response_model=ProfileSnapshot)
def approve(request: Request, source_id: UUID, version_id: UUID, body: Approval):
    service = request.app.state.profiles
    approved = service.approve(
        source_id,
        version_id,
        approver=body.approver,
        report_id=body.report_id,
        config_hash=body.config_hash,
    )
    return snapshot(approved, service.get_version_snapshot(source_id, version_id)[1])


@router.post(VERSION + "/retire", response_model=ProfileSnapshot)
def retire(request: Request, source_id: UUID, version_id: UUID):
    service = request.app.state.profiles
    retired = service.retire(source_id, version_id)
    return snapshot(retired, service.get_version_snapshot(source_id, version_id)[1])
