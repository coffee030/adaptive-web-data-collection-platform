"""Execute collection messages through the synchronous application service."""

import logging
from functools import lru_cache
from uuid import UUID

import httpx2
from sqlalchemy.exc import SQLAlchemyError

from backend.application.execution import JobExecutor
from backend.core.evidence import LocalEvidenceStore
from backend.core.profiles import ProfileError
from backend.intelligence.indexing import Indexing
from backend.intelligence.research_runs import ResearchRuns
from backend.intelligence.store import Config as IntelligenceConfig
from backend.marketing.pipeline import Pipeline
from backend.marketing.store import ResearchSettings
from backend.persistence.database import (
    database_url,
    evidence_path,
    make_engine,
    session_factory,
    settings,
)

from .celery_app import (
    INTELLIGENCE_TASK,
    MARKETING_TASK,
    RESEARCH_TASK,
    TASK,
    app,
    worker_instance_id,
)

LOGGER = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def worker_executor() -> JobExecutor:
    return JobExecutor(
        session_factory(make_engine(database_url())),
        LocalEvidenceStore(evidence_path()),
    )


@app.task(name=TASK)
def execute_job(job_id: str) -> None:
    try:
        job_uuid = UUID(job_id)
    except (ValueError, TypeError, AttributeError):
        LOGGER.warning("Discarded collection message with an invalid job UUID")
        return
    try:
        worker_executor().execute(job_uuid, worker_instance_id=worker_instance_id())
    except ProfileError as error:
        if error.code not in {"job_not_found", "job_not_pending", "job_not_due"}:
            raise
        LOGGER.info("Collection job %s skipped (%s)", job_uuid, error.code)
    except SQLAlchemyError as error:
        LOGGER.warning(
            "Collection job %s database error (%s)", job_uuid, type(error).__name__
        )
        raise RuntimeError("Collection job state could not be confirmed") from None


@lru_cache(maxsize=1)
def marketing_pipeline() -> Pipeline:
    return Pipeline(
        session_factory(make_engine(database_url())), ResearchSettings.load()
    )


@app.task(name=MARKETING_TASK)
def execute_youtube_run(run_id: str) -> None:
    try:
        run_uuid = UUID(run_id)
    except (ValueError, TypeError, AttributeError):
        LOGGER.warning("Discarded marketing message with an invalid run UUID")
        return
    try:
        logging.getLogger("httpx2").setLevel(logging.WARNING)
        logging.getLogger("httpcore2").setLevel(logging.WARNING)
        with httpx2.Client(
            timeout=httpx2.Timeout(8, connect=4), trust_env=False
        ) as client:
            marketing_pipeline().execute(
                run_uuid, settings().get("YOUTUBE_API_KEY") or "", client
            )
    except SQLAlchemyError as error:
        LOGGER.warning(
            "Marketing run %s database error (%s)", run_uuid, type(error).__name__
        )
        raise RuntimeError("Marketing run state could not be confirmed") from None


@lru_cache(maxsize=1)
def intelligence_indexer() -> Indexing:
    return Indexing(
        session_factory(make_engine(database_url())), IntelligenceConfig.load()
    )


@app.task(name=INTELLIGENCE_TASK)
def index_intelligence_dataset(dataset_id: str, claim: str) -> None:
    try:
        dataset_uuid, token = UUID(dataset_id), UUID(claim)
    except (ValueError, TypeError, AttributeError):
        LOGGER.warning("Discarded intelligence message with an invalid identity")
        return
    try:
        intelligence_indexer().execute(dataset_uuid, token)
    except SQLAlchemyError as error:
        LOGGER.warning("Intelligence index database error (%s)", type(error).__name__)
        raise RuntimeError("Intelligence index state could not be confirmed") from None


@lru_cache(maxsize=1)
def company_research():
    return ResearchRuns(worker_executor().sessions, IntelligenceConfig.load())


@app.task(name=RESEARCH_TASK, time_limit=165)
def execute_company_research(run_id: str, claim: str) -> None:
    try:
        run_uuid, token = UUID(run_id), UUID(claim)
    except (ValueError, TypeError, AttributeError):
        LOGGER.warning("Discarded company research message with an invalid identity")
        return
    company_research().execute(run_uuid, token)
