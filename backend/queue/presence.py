import logging
from datetime import timedelta
from threading import Event
from time import monotonic
from uuid import UUID

from sqlalchemy import func, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError

from backend.persistence.database import database_url, make_engine, session_factory
from backend.persistence.models import WorkerPresenceRow

HEARTBEAT_SECONDS = 5
WATCHDOG_SECONDS = 5
OFFLINE_AFTER = timedelta(seconds=15)
LOGGER = logging.getLogger(__name__)


def record_heartbeat(sessions, instance_id: UUID) -> None:
    heartbeat = insert(WorkerPresenceRow).values(
        instance_id=instance_id,
        last_heartbeat_at=func.clock_timestamp(),
    )
    with sessions.begin() as session:
        session.execute(
            heartbeat.on_conflict_do_update(
                index_elements=[WorkerPresenceRow.instance_id],
                set_={
                    "last_heartbeat_at": func.clock_timestamp(),
                    "offline_detected_at": None,
                },
            )
        )


def detect_offline(sessions) -> None:
    with sessions.begin() as session:
        session.execute(
            update(WorkerPresenceRow)
            .where(
                WorkerPresenceRow.offline_detected_at.is_(None),
                WorkerPresenceRow.last_heartbeat_at
                <= func.statement_timestamp() - OFFLINE_AFTER,
            )
            .values(offline_detected_at=func.statement_timestamp())
        )


def heartbeat_loop(instance_id: UUID, stopped: Event) -> None:
    engine = make_engine(database_url())
    sessions = session_factory(engine)
    try:
        while not stopped.is_set():
            due = monotonic() + HEARTBEAT_SECONDS
            try:
                record_heartbeat(sessions, instance_id)
            except SQLAlchemyError as error:
                LOGGER.warning("Worker heartbeat failed (%s)", type(error).__name__)
            stopped.wait(max(0, due - monotonic()))
    finally:
        engine.dispose()
