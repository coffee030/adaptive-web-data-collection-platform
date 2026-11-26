from uuid import uuid4

from sqlalchemy import func, update

from backend.persistence.models import WorkerPresenceRow
from backend.queue.presence import OFFLINE_AFTER, detect_offline, record_heartbeat


def test_offline_observation_is_per_instance_and_recovery_requires_a_heartbeat(
    sessions,
):
    missing, active = uuid4(), uuid4()
    for worker in (missing, active):
        record_heartbeat(sessions, worker)
    with sessions.begin() as session:
        session.execute(
            update(WorkerPresenceRow)
            .where(WorkerPresenceRow.instance_id == missing)
            .values(last_heartbeat_at=func.clock_timestamp() - OFFLINE_AFTER)
        )
    detect_offline(sessions)
    with sessions() as session:
        gone = session.get(WorkerPresenceRow, missing)
        first_detection = gone.offline_detected_at
        assert first_detection - gone.last_heartbeat_at >= OFFLINE_AFTER
        assert session.get(WorkerPresenceRow, active).offline_detected_at is None
    detect_offline(sessions)
    with sessions() as session:
        assert (
            session.get(WorkerPresenceRow, missing).offline_detected_at
            == first_detection
        )
    record_heartbeat(sessions, missing)
    with sessions() as session:
        returned = session.get(WorkerPresenceRow, missing)
        assert returned.offline_detected_at is None
        assert returned.last_heartbeat_at > first_detection
