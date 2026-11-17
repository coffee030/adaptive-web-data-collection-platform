"""Read history and latest article content with its exact observation lineage."""

from datetime import datetime
from uuid import UUID

from pydantic import ConfigDict
from sqlalchemy import func, select, true

from backend.core.contracts import Contract, Scalar
from backend.core.profiles import ProfileError
from backend.persistence.collection import (
    ArticleRow,
    CollectionRequestRow,
    ContentVersionRow,
    ObservationRow,
    RequestJobRow,
)
from backend.persistence.models import JobRow, RecordRow, SourceRow

from .collection import _require


class ArticleContent(Contract):
    title: str
    author: str | None
    published_at: datetime | None
    summary: str | None
    body: str | None


class VersionInfo(Contract):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    version: int
    content_hash: str
    created_at: datetime


class ArticleVersion(VersionInfo):
    content: ArticleContent


class Observation(Contract):
    record_id: UUID
    job_id: UUID
    evidence_id: UUID
    profile_version_id: UUID
    config_hash: str
    content_version_id: UUID
    captured_at: datetime
    url: str
    request_id: UUID | None


class ObservationDetail(Observation):
    raw_payload: dict[str, Scalar]


class ArticleSummary(Contract):
    id: UUID
    source_id: UUID
    source_name: str
    title: str
    url: str
    captured_at: datetime
    version: int


class ArticleDetail(ArticleSummary):
    latest_version: ArticleVersion
    latest_observation: Observation


def _latest():
    return (
        select(
            ObservationRow.record_id,
            ObservationRow.content_version_id,
            ObservationRow.captured_at,
            ObservationRow.url,
        )
        .where(ObservationRow.article_id == ArticleRow.id)
        .order_by(ObservationRow.captured_at.desc(), ObservationRow.record_id.desc())
        .limit(1)
        .lateral()
    )


def _observations(article_id):
    return (
        select(
            ObservationRow.record_id,
            JobRow.id.label("job_id"),
            RecordRow.evidence_id,
            JobRow.profile_version_id,
            JobRow.config_hash,
            ObservationRow.content_version_id,
            ObservationRow.captured_at,
            ObservationRow.url,
            RequestJobRow.request_id,
        )
        .select_from(ObservationRow)
        .join(RecordRow, RecordRow.id == ObservationRow.record_id)
        .join(JobRow, JobRow.id == RecordRow.job_id)
        .outerjoin(RequestJobRow, RequestJobRow.job_id == JobRow.id)
        .where(ObservationRow.article_id == article_id)
    )


class Articles:
    def __init__(self, sessions):
        self.sessions = sessions

    def list(self, limit, offset, *, request_id=None):
        latest = _latest()
        query = (
            select(
                ArticleRow.id,
                ArticleRow.source_id,
                SourceRow.name.label("source_name"),
                func.left(ContentVersionRow.content["title"].as_string(), 256).label(
                    "title"
                ),
                latest.c.url,
                latest.c.captured_at,
                ContentVersionRow.version,
            )
            .select_from(ArticleRow)
            .join(SourceRow, SourceRow.id == ArticleRow.source_id)
            .join(latest, true())
            .join(
                ContentVersionRow, ContentVersionRow.id == latest.c.content_version_id
            )
        )
        with self.sessions() as session:
            if request_id is not None:
                _require(
                    session, CollectionRequestRow, request_id, "collection_request"
                )
                observed_in_request = (
                    select(ObservationRow.record_id)
                    .join(RecordRow, RecordRow.id == ObservationRow.record_id)
                    .join(RequestJobRow, RequestJobRow.job_id == RecordRow.job_id)
                    .where(
                        ObservationRow.article_id == ArticleRow.id,
                        RequestJobRow.request_id == request_id,
                    )
                )
                query = query.where(observed_in_request.exists())
            rows = session.execute(
                query.order_by(latest.c.captured_at.desc(), ArticleRow.id.desc())
                .limit(limit)
                .offset(offset)
            ).mappings()
            return [ArticleSummary.model_validate(row) for row in rows]

    def get(self, article_id):
        with self.sessions() as session:
            article = _require(session, ArticleRow, article_id, "article")
            source = session.get(SourceRow, article.source_id)
            latest = (
                session.execute(
                    _observations(article.id)
                    .order_by(
                        ObservationRow.captured_at.desc(),
                        ObservationRow.record_id.desc(),
                    )
                    .limit(1)
                )
                .mappings()
                .one()
            )
            observation = Observation.model_validate(latest)
            version = ArticleVersion.model_validate(
                session.get(ContentVersionRow, observation.content_version_id)
            )
            return ArticleDetail(
                id=article.id,
                source_id=source.id,
                source_name=source.name,
                title=version.content.title,
                url=observation.url,
                captured_at=observation.captured_at,
                version=version.version,
                latest_version=version,
                latest_observation=observation,
            )

    def versions(self, article_id, limit, offset):
        with self.sessions() as session:
            _require(session, ArticleRow, article_id, "article")
            rows = session.scalars(
                select(ContentVersionRow)
                .where(ContentVersionRow.article_id == article_id)
                .order_by(ContentVersionRow.version.desc())
                .limit(limit)
                .offset(offset)
            )
            return [VersionInfo.model_validate(row) for row in rows]

    def version(self, article_id, version_id):
        with self.sessions() as session:
            row = _require(session, ContentVersionRow, version_id, "article_version")
            if row.article_id != article_id:
                raise ProfileError(
                    "article_version_not_found",
                    "Content version does not belong to this article",
                )
            return ArticleVersion.model_validate(row)

    def observations(self, article_id, limit, offset, *, request_id=None):
        with self.sessions() as session:
            _require(session, ArticleRow, article_id, "article")
            query = _observations(article_id)
            if request_id is not None:
                _require(
                    session, CollectionRequestRow, request_id, "collection_request"
                )
                query = query.where(RequestJobRow.request_id == request_id)
            rows = session.execute(
                query.order_by(
                    ObservationRow.captured_at.desc(), ObservationRow.record_id.desc()
                )
                .limit(limit)
                .offset(offset)
            ).mappings()
            return [Observation.model_validate(row) for row in rows]

    def observation(self, article_id, record_id):
        with self.sessions() as session:
            row = (
                session.execute(
                    _observations(article_id)
                    .add_columns(ObservationRow.raw_payload)
                    .where(ObservationRow.record_id == record_id)
                )
                .mappings()
                .one_or_none()
            )
            if row is None:
                raise ProfileError(
                    "article_observation_not_found",
                    "Observation does not exist for this article",
                )
            return ObservationDetail.model_validate(row)
