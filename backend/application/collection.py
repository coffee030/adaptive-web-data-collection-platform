"""Trusted-local topic administration and transactional collection requests."""

from datetime import datetime
from hashlib import sha256
from typing import Annotated
from uuid import UUID, uuid4

from pydantic import ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError

from backend.application.inputs import WebEntry, check_entry
from backend.application.jobs import (
    TERMINAL,
    Job,
    database_now,
    job_from_row,
    stage_job,
)
from backend.core.contracts import (
    Contract,
    ExtractionConfiguration,
    Name,
    canonical_json,
)
from backend.core.profiles import ProfileError, ProfileRepository
from backend.persistence.collection import (
    CategoryRow,
    CollectionRequestRow,
    RequestJobRow,
    TopicBindingRow,
    TopicRow,
)
from backend.persistence.models import JobRow, ProfileRow, SourceRow
from backend.persistence.profiles import (
    ProfileStorage,
    profile_from_row,
    source_from_row,
)

MAX_BINDINGS = 4


class CatalogEdit(Contract):
    name: Name
    active: bool = True

    @field_validator("name")
    @classmethod
    def printable_name(cls, value):
        if not value.isprintable():
            raise ValueError("Names must use printable characters")
        return value


class Category(CatalogEdit):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    created_at: datetime
    updated_at: datetime


class TopicCreate(CatalogEdit):
    category_id: UUID


class Topic(Category):
    category_id: UUID


class ApproveBinding(Contract):
    source_id: UUID
    profile_version_id: UUID
    approved_by: Name

    @field_validator("approved_by")
    @classmethod
    def printable_operator(cls, value):
        return CatalogEdit.printable_name(value)


class Binding(ApproveBinding):
    id: UUID
    topic_id: UUID
    source_name: str
    profile_version: int
    config_hash: str
    approved_at: datetime
    disabled_at: datetime | None
    eligible: bool


class RefreshRequest(Contract):
    request_key: UUID


class NewRequest(RefreshRequest):
    topic_id: UUID
    keyword: Name
    binding_ids: Annotated[
        tuple[UUID, ...], Field(min_length=1, max_length=MAX_BINDINGS)
    ]

    @field_validator("keyword")
    @classmethod
    def printable_keyword(cls, value):
        return WebEntry(adapter_type="web", keyword=value).keyword

    @field_validator("binding_ids")
    @classmethod
    def distinct_bindings(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("Select distinct bindings")
        return tuple(sorted(value))


class RequestJob(Contract):
    binding_id: UUID
    source_name: str
    profile_version: int
    approved_by: str
    approved_at: datetime
    job: Job


class CollectionRequest(Contract):
    id: UUID
    topic_id: UUID
    topic_name: str
    keyword: str
    created_at: datetime
    refresh_of: UUID | None
    status: str
    finished_at: datetime | None
    jobs: list[RequestJob]


def _require(session, model, identity, kind, *, lock=False):
    row = session.get(model, identity, with_for_update=lock)
    if row is None:
        raise ProfileError(
            f"{kind}_not_found", f"{kind.replace('_', ' ').capitalize()} does not exist"
        )
    return row


def _validated_pin(session, source_id, profile_version_id):
    storage = ProfileStorage(session)
    source = source_from_row(storage.source(source_id, lock=True))
    version = profile_from_row(storage.profile(source_id, profile_version_id))
    ProfileRepository.from_snapshot(source, version).approved_for_run(
        version.profile_version_id
    )
    if (
        not isinstance(version.configuration, ExtractionConfiguration)
        or version.configuration.search is None
    ):
        raise ProfileError(
            "binding_requires_search", "Select an approved keyword-search profile"
        )
    return source, version


class Catalog:
    def __init__(self, sessions):
        self.sessions = sessions

    def list(self, model, view, limit, offset, *, active_only=False, category_id=None):
        query = select(model)
        if active_only:
            query = query.where(model.active)
            if model is TopicRow:
                query = query.join(CategoryRow).where(CategoryRow.active)
        if category_id is not None:
            query = query.where(TopicRow.category_id == category_id)
        with self.sessions() as session:
            rows = session.scalars(
                query.order_by(model.name, model.id).limit(limit).offset(offset)
            )
            return [view.model_validate(row) for row in rows]

    def get(self, model, view, identity, kind):
        with self.sessions() as session:
            return view.model_validate(_require(session, model, identity, kind))

    def save(self, model, view, body, kind, identity=None):
        try:
            with self.sessions.begin() as session:
                if identity is None:
                    if isinstance(body, TopicCreate):
                        _require(session, CategoryRow, body.category_id, "category")
                    row = model(id=uuid4(), **body.model_dump())
                    session.add(row)
                else:
                    row = _require(session, model, identity, kind, lock=True)
                    row.name, row.active = body.name, body.active
                session.flush()
                return view.model_validate(row)
        except IntegrityError as error:
            if error.orig.diag.constraint_name not in {
                "uq_category_name",
                "uq_topic_category_name",
            }:
                raise
            raise ProfileError(
                "duplicate_catalog_name", "This name is already in use"
            ) from error

    def bindings(self, topic_id, limit, offset, *, eligible_only=False):
        with self.sessions() as session:
            topic = _require(session, TopicRow, topic_id, "topic")
            category = session.get(CategoryRow, topic.category_id)
            query = (
                select(TopicBindingRow, SourceRow, ProfileRow)
                .join(SourceRow, SourceRow.id == TopicBindingRow.source_id)
                .join(ProfileRow, ProfileRow.id == TopicBindingRow.profile_version_id)
                .where(TopicBindingRow.topic_id == topic_id)
            )
            if eligible_only:
                if not topic.active or not category.active:
                    return []
                query = query.where(
                    TopicBindingRow.disabled_at.is_(None),
                    SourceRow.approval_status == "approved",
                    ProfileRow.approval_status == "approved",
                )
            rows = session.execute(
                query.order_by(SourceRow.name, ProfileRow.version, TopicBindingRow.id)
                .limit(limit)
                .offset(offset)
            )
            return [
                _binding_view(row, source, version, topic.active and category.active)
                for row, source, version in rows
            ]

    def approve(self, topic_id, body):
        with self.sessions.begin() as session:
            _require(session, TopicRow, topic_id, "topic", lock=True)
            _, version = _validated_pin(
                session, body.source_id, body.profile_version_id
            )
            row = session.scalar(
                insert(TopicBindingRow)
                .values(
                    id=uuid4(),
                    topic_id=topic_id,
                    **body.model_dump(),
                    config_hash=version.config_hash,
                    approved_at=database_now(session),
                )
                .on_conflict_do_nothing(constraint="uq_topic_binding")
                .returning(TopicBindingRow)
            )
            if row is None:
                raise ProfileError(
                    "duplicate_binding",
                    "This topic already has that source/profile binding",
                )
            return self._view(session, row)

    def set_binding(self, topic_id, binding_id, *, approver=None):
        with self.sessions.begin() as session:
            _require(session, TopicRow, topic_id, "topic", lock=True)
            row = _require(session, TopicBindingRow, binding_id, "binding", lock=True)
            if row.topic_id != topic_id:
                raise ProfileError(
                    "binding_not_found", "Binding does not belong to this topic"
                )
            if approver is None:
                if row.disabled_at is None:
                    row.disabled_at = database_now(session)
            else:
                _validated_pin(session, row.source_id, row.profile_version_id)
                if row.disabled_at is not None:
                    row.approved_by = approver
                    row.approved_at = database_now(session)
                    row.disabled_at = None
            return self._view(session, row)

    @staticmethod
    def _view(session, row):
        topic = session.get(TopicRow, row.topic_id)
        category = session.get(CategoryRow, topic.category_id)
        return _binding_view(
            row,
            session.get(SourceRow, row.source_id),
            session.get(ProfileRow, row.profile_version_id),
            topic.active and category.active,
        )


def _binding_view(row, source, profile, active):
    return Binding(
        id=row.id,
        topic_id=row.topic_id,
        source_id=row.source_id,
        source_name=source.name,
        profile_version_id=row.profile_version_id,
        profile_version=profile.version,
        config_hash=row.config_hash,
        approved_by=row.approved_by,
        approved_at=row.approved_at,
        disabled_at=row.disabled_at,
        eligible=active
        and row.disabled_at is None
        and source.approval_status == "approved"
        and profile.approval_status == "approved",
    )


def request_status(jobs):
    states = {item.job.status for item in jobs}
    if states == {"pending"} and not any(item.job.execution_attempt for item in jobs):
        return "pending"
    if not states <= TERMINAL:
        return "running"
    if len(states) == 1:
        return states.pop()
    return "partial"


def _request_jobs(session, request_ids):
    rows = session.execute(
        select(RequestJobRow, JobRow, SourceRow.name, ProfileRow.version)
        .select_from(RequestJobRow)
        .join(JobRow, JobRow.id == RequestJobRow.job_id)
        .join(SourceRow, SourceRow.id == JobRow.source_id)
        .join(ProfileRow, ProfileRow.id == JobRow.profile_version_id)
        .where(RequestJobRow.request_id.in_(request_ids))
        .order_by(JobRow.source_id, JobRow.profile_version_id)
    )
    return [
        (
            link.request_id,
            RequestJob(
                binding_id=link.binding_id,
                source_name=name,
                profile_version=version,
                approved_by=link.approved_by,
                approved_at=link.approved_at,
                job=job_from_row(job),
            ),
        )
        for link, job, name, version in rows
    ]


def _request_view(row, jobs):
    finished = [item.job.finished_at for item in jobs]
    return CollectionRequest(
        id=row.id,
        topic_id=row.topic_id,
        topic_name=row.topic_name,
        keyword=row.keyword,
        created_at=row.created_at,
        refresh_of=row.refresh_of,
        status=request_status(jobs),
        finished_at=max(finished) if finished and all(finished) else None,
        jobs=jobs,
    )


class CollectionRequests:
    def __init__(self, sessions):
        self.sessions = sessions

    def list(self, limit, offset):
        with self.sessions() as session:
            rows = list(
                session.scalars(
                    select(CollectionRequestRow)
                    .order_by(
                        CollectionRequestRow.created_at.desc(),
                        CollectionRequestRow.id.desc(),
                    )
                    .limit(limit)
                    .offset(offset)
                )
            )
            jobs = {row.id: [] for row in rows}
            for request_id, item in _request_jobs(session, list(jobs)):
                jobs[request_id].append(item)
            return [_request_view(row, jobs[row.id]) for row in rows]

    def get(self, request_id):
        with self.sessions() as session:
            row = _require(
                session, CollectionRequestRow, request_id, "collection_request"
            )
            return _request_view(
                row, [item for _, item in _request_jobs(session, [row.id])]
            )

    def create(self, body: NewRequest):
        with self.sessions.begin() as session:
            return self._create(session, body)

    def refresh(self, request_id, key):
        with self.sessions.begin() as session:
            parent = _require(
                session, CollectionRequestRow, request_id, "collection_request"
            )
            jobs = {
                item.binding_id: item for _, item in _request_jobs(session, [parent.id])
            }
            body = NewRequest(
                topic_id=parent.topic_id,
                keyword=parent.keyword,
                request_key=key,
                binding_ids=tuple(jobs),
            )
            return self._create(session, body, parent, jobs)

    def _create(self, session, body, parent=None, parent_jobs=None):
        entry = WebEntry(adapter_type="web", keyword=body.keyword)
        parent_id = parent.id if parent else None
        digest = sha256(
            canonical_json(
                [
                    str(body.topic_id),
                    body.keyword,
                    [str(key) for key in body.binding_ids],
                    str(parent_id),
                ]
            )
        ).hexdigest()
        topic = _require(session, TopicRow, body.topic_id, "topic", lock=True)
        row = session.scalar(
            insert(CollectionRequestRow)
            .values(
                id=uuid4(),
                topic_id=topic.id,
                topic_name=parent.topic_name if parent else topic.name,
                keyword=body.keyword,
                request_key=body.request_key,
                intent_hash=digest,
                refresh_of=parent_id,
            )
            .on_conflict_do_nothing(index_elements=[CollectionRequestRow.request_key])
            .returning(CollectionRequestRow)
        )
        if row is None:
            existing = session.scalars(
                select(CollectionRequestRow).where(
                    CollectionRequestRow.request_key == body.request_key
                )
            ).one()
            if existing.intent_hash != digest:
                raise ProfileError(
                    "collection_request_conflict",
                    "Request key already belongs to another collection",
                )
            return _request_view(
                existing, [item for _, item in _request_jobs(session, [existing.id])]
            ), False

        category = _require(
            session, CategoryRow, topic.category_id, "category", lock=True
        )
        if not topic.active or not category.active:
            raise ProfileError("topic_inactive", "Choose an active topic and category")
        bindings = list(
            session.scalars(
                select(TopicBindingRow)
                .where(
                    TopicBindingRow.topic_id == topic.id,
                    TopicBindingRow.id.in_(body.binding_ids),
                )
                .order_by(TopicBindingRow.source_id, TopicBindingRow.profile_version_id)
            )
        )
        if len(bindings) != len(body.binding_ids) or any(
            binding.disabled_at for binding in bindings
        ):
            raise ProfileError(
                "binding_ineligible", "One or more selected bindings are unavailable"
            )

        jobs = []
        for binding in bindings:
            source, version = _validated_pin(
                session, binding.source_id, binding.profile_version_id
            )
            snapshot = parent_jobs[binding.id] if parent_jobs is not None else binding
            pinned_hash = (
                snapshot.job.config_hash
                if isinstance(snapshot, RequestJob)
                else binding.config_hash
            )
            if pinned_hash != version.config_hash:
                raise ProfileError(
                    "binding_ineligible", "The pinned configuration is unavailable"
                )
            check_entry(source, version.configuration, entry.collection_input())
            job = stage_job(
                session,
                binding.source_id,
                binding.profile_version_id,
                pinned_hash,
                entry,
            )
            session.add(
                RequestJobRow(
                    job_id=job.id,
                    request_id=row.id,
                    binding_id=binding.id,
                    approved_by=snapshot.approved_by,
                    approved_at=snapshot.approved_at,
                )
            )
            jobs.append(
                RequestJob(
                    binding_id=binding.id,
                    source_name=source.source_name,
                    profile_version=version.version,
                    approved_by=snapshot.approved_by,
                    approved_at=snapshot.approved_at,
                    job=job_from_row(job),
                )
            )
        return _request_view(row, jobs), True
