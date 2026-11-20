"""Execute collection messages through the synchronous application service."""

import logging
from functools import lru_cache
from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError

from backend.application.execution import JobExecutor
from backend.core.evidence import LocalEvidenceStore
from backend.core.profiles import ProfileError
from backend.persistence.database import (
    database_url,
    evidence_path,
    make_engine,
    session_factory,
)

from .celery_app import TASK, app, worker_instance_id

LOGGER = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def worker_executor() -> JobExecutor:
    # Called on the first task in the execution process, after prefork.
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
