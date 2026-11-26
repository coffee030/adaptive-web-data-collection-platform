"""Local FastAPI composition root."""

import logging
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg import OperationalError
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException

from backend.application.articles import Articles
from backend.application.collection import Catalog, CollectionRequests
from backend.application.jobs import Jobs
from backend.application.profiles import Profiles
from backend.application.results import Results
from backend.core.csv_adapter import MAX_INPUT_BYTES
from backend.core.evidence import LocalEvidenceStore
from backend.core.inputs import InputError
from backend.core.profiles import ProfileError
from backend.intelligence.api import router as intelligence_router
from backend.intelligence.directory_api import router as directory_router
from backend.intelligence.store import Config as IntelligenceConfig
from backend.intelligence.store import IntelligenceStore
from backend.marketing.api import router as marketing_router
from backend.marketing.company_api import router as company_router
from backend.marketing.pilot_access import require_core_operator
from backend.marketing.store import MarketingError, ResearchSettings, ResearchStore
from backend.persistence.database import (
    database_url,
    evidence_path,
    make_engine,
    session_factory,
    settings,
)

from .articles import router as articles_router
from .collection import router as collection_router
from .jobs import router as jobs_router
from .profiles import router as profiles_router
from .results import router as results_router

LOGGER = logging.getLogger(__name__)
MAX_REQUEST_BYTES = 6 * MAX_INPUT_BYTES + 8192
LOCAL_HOST = re.compile(
    r"(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]{1,5})?", re.IGNORECASE
)

ERROR_STATUSES = {
    "source_not_found": 404,
    "profile_not_found": 404,
    "job_not_found": 404,
    "record_not_found": 404,
    "evidence_not_found": 404,
    "category_not_found": 404,
    "topic_not_found": 404,
    "binding_not_found": 404,
    "collection_request_not_found": 404,
    "article_not_found": 404,
    "article_version_not_found": 404,
    "article_observation_not_found": 404,
    "source_not_approved": 403,
    "destination_denied": 403,
    "dataset_not_allowed": 403,
    "robots_denied": 403,
    "access_blocked": 403,
    "stale_validation": 409,
    "validation_failed": 409,
    "profile_not_draft": 409,
    "profile_not_approved": 409,
    "duplicate_source": 409,
    "source_request_conflict": 409,
    "draft_revision_conflict": 409,
    "draft_revision_required": 428,
    "job_request_conflict": 409,
    "collection_request_conflict": 409,
    "duplicate_catalog_name": 409,
    "duplicate_binding": 409,
    "binding_ineligible": 409,
    "topic_inactive": 409,
    "job_not_pending": 409,
    "job_not_due": 409,
    "invalid_job_transition": 409,
    "record_export_pending": 409,
    "record_export_limit": 413,
}


def error_response(status: int, code: str, message: str, **details) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, **details}},
    )


class LocalConsoleBoundary:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = Headers(scope=scope)
            hosts = headers.getlist("host")
            origins = headers.getlist("origin")
            if len(hosts) != 1 or not LOCAL_HOST.fullmatch(hosts[0]):
                await error_response(
                    403, "local_host_required", "Use a loopback API address"
                )(scope, receive, send)
                return
            if origins and origins != [f"{scope['scheme']}://{hosts[0].lower()}"]:
                await error_response(
                    403, "local_origin_required", "Use the same loopback origin"
                )(scope, receive, send)
                return
        await self.app(scope, receive, send)


class LimitRequestBody:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH"}:
            await self.app(scope, receive, send)
            return
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > MAX_REQUEST_BYTES:
                await error_response(
                    413, "request_too_large", "Request body exceeds the limit"
                )(scope, receive, send)
                return
            if not message.get("more_body"):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, replay, send)


def create_app(*, engine=None, evidence_root: Path | None = None) -> FastAPI:
    if evidence_root is None:
        evidence_root = evidence_path()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        active_engine = engine if engine is not None else make_engine(database_url())
        app.state.sessions = session_factory(active_engine)
        app.state.profiles = Profiles(app.state.sessions)
        app.state.jobs = Jobs(app.state.sessions)
        app.state.catalog = Catalog(app.state.sessions)
        app.state.collection_requests = CollectionRequests(app.state.sessions)
        app.state.articles = Articles(app.state.sessions)
        app.state.results = Results(app.state.sessions)
        app.state.marketing = ResearchStore(app.state.sessions, ResearchSettings.load())
        app.state.intelligence = IntelligenceStore(
            app.state.sessions, IntelligenceConfig.load()
        )
        app.state.evidence = LocalEvidenceStore(evidence_root)
        try:
            yield
        finally:
            if engine is None:
                active_engine.dispose()

    app = FastAPI(
        title="Adaptive Web Data Collection Platform", version="2.0", lifespan=lifespan
    )
    app.add_middleware(LimitRequestBody)
    app.add_middleware(LocalConsoleBoundary)
    core_access = (
        [Depends(require_core_operator)]
        if settings().get("MARKETING_PILOT_PASSWORD")
        else []
    )
    for router in (
        profiles_router,
        jobs_router,
        collection_router,
        articles_router,
        results_router,
    ):
        app.include_router(router, prefix="/api/v1", dependencies=core_access)
    app.include_router(marketing_router, prefix="/api/v1")
    app.include_router(company_router, prefix="/api/v1")
    app.include_router(intelligence_router, prefix="/api/v1")
    app.include_router(directory_router, prefix="/api/v1")

    @app.get("/api/v1/health", response_model=dict[str, str], tags=["health"])
    def health(request: Request):
        with request.app.state.sessions() as session:
            session.execute(text("SELECT 1"))
        return {"status": "ok"}

    @app.exception_handler(ProfileError)
    def profile_error(_: Request, error: ProfileError):
        return error_response(
            ERROR_STATUSES.get(error.code, 400), error.code, str(error)
        )

    @app.exception_handler(MarketingError)
    async def marketing_error(_: Request, error: MarketingError):
        response = error_response(error.status, error.code, str(error))
        response.headers["Cache-Control"] = "no-store"
        if error.code in {"pilot_customer_login", "pilot_operator_login"}:
            realm = (
                "Harbourline partner"
                if error.code == "pilot_customer_login"
                else "Harbourline operator"
            )
            response.headers["WWW-Authenticate"] = f'Basic realm="{realm}"'
        return response

    @app.exception_handler(InputError)
    def input_error(_: Request, error: InputError):
        return error_response(
            ERROR_STATUSES.get(error.error.code, 400), error.error.code, str(error)
        )

    @app.exception_handler(RequestValidationError)
    def request_error(_: Request, error: RequestValidationError):
        fields = [
            {"location": list(item["loc"]), "type": item["type"]}
            for item in error.errors()
        ]
        return error_response(
            422, "invalid_request", "Request validation failed", fields=fields
        )

    @app.exception_handler(HTTPException)
    def http_error(_: Request, error: HTTPException):
        return error_response(error.status_code, "http_error", str(error.detail))

    @app.exception_handler(DBAPIError)
    def database_error(_: Request, error: DBAPIError):
        sqlstate = getattr(error.orig, "sqlstate", None)
        if (
            error.connection_invalidated
            or sqlstate in {"57P01", "57P02", "57P03", "53300"}
            or (sqlstate is None and isinstance(error.orig, OperationalError))
        ):
            return error_response(
                503, "database_unavailable", "Database temporarily unavailable"
            )
        LOGGER.error("Database operation failed with SQLSTATE %s", sqlstate)
        return error_response(500, "database_error", "Database operation failed")

    @app.exception_handler(PoolTimeoutError)
    def pool_timeout(_: Request, error: PoolTimeoutError):
        return error_response(
            503, "database_unavailable", "Database temporarily unavailable"
        )

    @app.exception_handler(Exception)
    def internal_error(_: Request, error: Exception):
        LOGGER.error("Unhandled API failure of type %s", type(error).__name__)
        return error_response(500, "internal_error", "Unexpected application error")

    return app
