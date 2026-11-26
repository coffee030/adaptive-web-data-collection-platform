"""Poll PostgreSQL for due dispatch and expired execution leases."""

import argparse
import logging
import os
from pathlib import Path
from collections.abc import Callable
from datetime import timedelta
from time import monotonic, sleep
from uuid import UUID

from kombu.exceptions import OperationalError as BrokerConnectionError
from redis.exceptions import RedisError
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from backend.application.jobs import Jobs, database_now
from backend.core.contracts import CollectionError
from backend.intelligence.indexing import INDEX_CLAIM_WINDOW, Indexing
from backend.intelligence import commons_works, public_directory, public_feed
from backend.intelligence.refresh import refresh_partner_files
from backend.intelligence.store import Config as IntelligenceConfig
from backend.marketing.pipeline import CLAIM_WINDOW as MARKETING_CLAIM_WINDOW
from backend.marketing.pipeline import Pipeline
from backend.marketing.store import ResearchSettings
from backend.persistence.database import database_url, make_engine, session_factory
from backend.persistence.models import JobRow

from .celery_app import INTELLIGENCE_TASK, MARKETING_TASK, TASK, app

LOGGER = logging.getLogger(__name__)
POLL_SECONDS = 1
BATCH_SIZE = 20
DISPATCH_RETRY = timedelta(seconds=5)
CLAIM_WINDOW = timedelta(seconds=120)
MARKETING_POLL_SECONDS = 5
MARKETING_CLEANUP_SECONDS = 60


def publish_job(job_id: UUID) -> None:
    app.send_task(
        TASK, args=[str(job_id)], retry=False, expires=CLAIM_WINDOW.total_seconds()
    )


def publish_marketing(run_id: UUID) -> None:
    app.send_task(
        MARKETING_TASK,
        args=[str(run_id)],
        retry=False,
        expires=MARKETING_CLAIM_WINDOW.total_seconds(),
    )


def publish_intelligence(dataset_id: UUID, claim: UUID) -> None:
    app.send_task(
        INTELLIGENCE_TASK,
        args=[str(dataset_id), str(claim)],
        retry=False,
        expires=INDEX_CLAIM_WINDOW.total_seconds(),
    )


class Dispatcher:
    def __init__(self, sessions, publish: Callable[[UUID], None] = publish_job):
        self.jobs = Jobs(sessions)
        self.publish = publish
        self.broker_resume_at = 0.0

    def recover_one(self) -> bool:
        with self.jobs.sessions.begin() as session:
            row = session.scalar(
                select(JobRow)
                .where(
                    JobRow.status == "running",
                    JobRow.lease_expires_at <= func.now(),
                )
                .order_by(JobRow.lease_expires_at, JobRow.id)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
            if row is None:
                return False
            error = CollectionError(
                code="worker_lost", message="Execution lease expired before completion"
            )
            self.jobs._add_event(session, row, "WORKER_LOST", error=error)
            self.jobs.retry(
                session, row, error, timedelta(seconds=5), kind="RECOVERY_REQUESTED"
            )
            return True

    def dispatch_one(self) -> bool:
        with self.jobs.sessions.begin() as session:
            row = session.scalar(
                select(JobRow)
                .where(JobRow.status == "pending", JobRow.dispatch_due_at <= func.now())
                .order_by(JobRow.dispatch_due_at, JobRow.id)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
            if row is None:
                return False
            row.dispatch_attempts += 1
            try:
                self.publish(row.id)
            except (BrokerConnectionError, RedisError, OSError) as error:
                LOGGER.warning(
                    "Job %s broker publish failed (%s)", row.id, type(error).__name__
                )
                self.broker_resume_at = monotonic() + DISPATCH_RETRY.total_seconds()
                row.dispatch_error_code = "broker_unavailable"
                row.dispatch_due_at = database_now(session) + DISPATCH_RETRY
                self.jobs._add_event(
                    session,
                    row,
                    "DISPATCH_FAILED",
                    error=CollectionError(
                        code="broker_unavailable",
                        message="Broker publication could not be confirmed",
                    ),
                )
                return False
            row.last_dispatched_at = database_now(session)
            row.dispatch_error_code = None
            row.dispatch_due_at = row.last_dispatched_at + CLAIM_WINDOW
            self.jobs._add_event(session, row, "DISPATCHED")
            return True

    def poll(self) -> None:
        for _ in range(BATCH_SIZE):
            if not self.recover_one():
                break
        if monotonic() < self.broker_resume_at:
            return
        for _ in range(BATCH_SIZE):
            if not self.dispatch_one():
                break


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="Run one bounded poll")
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    engine = make_engine(database_url())
    sessions = session_factory(engine)
    dispatcher = Dispatcher(sessions)
    marketing = Pipeline(sessions, ResearchSettings.load())
    intelligence = Indexing(sessions, IntelligenceConfig.load())
    partner_directory = os.getenv("MARKETING_PARTNER_REFRESH_DIR")
    try:
        if args.once:
            dispatcher.poll()
            marketing.maintain()
            marketing.dispatch(publish_marketing)
            if partner_directory:
                refresh_partner_files(intelligence, Path(partner_directory))
            if intelligence.config.workspace or intelligence.config.public_demo_directory:
                public_directory.refresh(sessions)
                public_feed.refresh(sessions, commons_works.feed())
            intelligence.maintain()
            intelligence.dispatch(publish_intelligence)
            return
        LOGGER.info("Collection dispatcher polling PostgreSQL")
        marketing_due = 0.0
        cleanup_due = 0.0
        indexing_due = 0.0
        indexing_cleanup_due = 0.0
        while True:
            try:
                dispatcher.poll()
            except SQLAlchemyError as error:
                LOGGER.warning(
                    "Dispatcher database operation failed (%s)", type(error).__name__
                )
            if monotonic() >= marketing_due:
                interval = (
                    MARKETING_POLL_SECONDS
                    if marketing.config.enabled
                    else MARKETING_CLEANUP_SECONDS
                )
                marketing_due = monotonic() + interval
                try:
                    purge = monotonic() >= cleanup_due
                    marketing.maintain(purge=purge)
                    if purge:
                        cleanup_due = monotonic() + MARKETING_CLEANUP_SECONDS
                    marketing.dispatch(publish_marketing)
                except SQLAlchemyError as error:
                    LOGGER.warning(
                        "Marketing dispatcher database operation failed (%s)",
                        type(error).__name__,
                    )
            if monotonic() >= indexing_due:
                interval = (
                    MARKETING_POLL_SECONDS
                    if intelligence.config.model_dir
                    else MARKETING_CLEANUP_SECONDS
                )
                indexing_due = monotonic() + interval
                try:
                    purge = monotonic() >= indexing_cleanup_due
                    intelligence.maintain(purge=purge)
                    if purge:
                        if intelligence.config.workspace or intelligence.config.public_demo_directory:
                            public_directory.refresh(sessions)
                            public_feed.refresh(sessions, commons_works.feed())
                        if partner_directory:
                            refresh_partner_files(intelligence, Path(partner_directory))
                        indexing_cleanup_due = monotonic() + MARKETING_CLEANUP_SECONDS
                    intelligence.dispatch(publish_intelligence)
                except SQLAlchemyError as error:
                    LOGGER.warning(
                        "Intelligence dispatcher database operation failed (%s)",
                        type(error).__name__,
                    )
            sleep(POLL_SECONDS)
    except KeyboardInterrupt:
        pass
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
