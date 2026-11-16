"""Article latest, version, and observation endpoints."""

from uuid import UUID

from fastapi import APIRouter, Request

from backend.application.articles import (
    ArticleDetail,
    ArticleSummary,
    ArticleVersion,
    Observation,
    ObservationDetail,
    VersionInfo,
)

from .jobs import PageLimit, PageOffset

router = APIRouter(prefix="/articles", tags=["articles"])


@router.get("", response_model=list[ArticleSummary])
def list_articles(
    request: Request,
    limit: PageLimit = 50,
    offset: PageOffset = 0,
    request_id: UUID | None = None,
):
    return request.app.state.articles.list(limit, offset, request_id=request_id)


@router.get("/{article_id}", response_model=ArticleDetail)
def get_article(request: Request, article_id: UUID):
    return request.app.state.articles.get(article_id)


@router.get("/{article_id}/versions", response_model=list[VersionInfo])
def list_versions(
    request: Request, article_id: UUID, limit: PageLimit = 50, offset: PageOffset = 0
):
    return request.app.state.articles.versions(article_id, limit, offset)


@router.get("/{article_id}/versions/{version_id}", response_model=ArticleVersion)
def get_version(request: Request, article_id: UUID, version_id: UUID):
    return request.app.state.articles.version(article_id, version_id)


@router.get("/{article_id}/observations", response_model=list[Observation])
def list_observations(
    request: Request, article_id: UUID, limit: PageLimit = 50, offset: PageOffset = 0
):
    return request.app.state.articles.observations(article_id, limit, offset)


@router.get("/{article_id}/observations/{record_id}", response_model=ObservationDetail)
def get_observation(request: Request, article_id: UUID, record_id: UUID):
    return request.app.state.articles.observation(article_id, record_id)
