"""Poll PostgreSQL for due dispatch and expired execution leases."""

import argparse
import logging
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
from backend.persistence.database import database_url, make_engine, session_factory
from backend.persistence.models import JobRow

from .celery_app import TASK, app

LOGGER = logging.getLogger(__name__)
POLL_SECONDS = 1
BATCH_SIZE = 20
DISPATCH_RETRY = timedelta(seconds=5)
CLAIM_WINDOW = timedelta(seconds=120)


def publish_job(job_id: UUID) -> None:
    app.send_task(
        TASK, args=[str(job_id)], retry=False, expires=CLAIM_WINDOW.total_seconds()
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
    dispatcher = Dispatcher(session_factory(engine))
    try:
        if args.once:
            dispatcher.poll()
            return
        LOGGER.info("Collection dispatcher polling PostgreSQL")
        while True:
            try:
                dispatcher.poll()
            except SQLAlchemyError as error:
                LOGGER.warning(
                    "Dispatcher database operation failed (%s)", type(error).__name__
                )
            sleep(POLL_SECONDS)
    except KeyboardInterrupt:
        pass
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
