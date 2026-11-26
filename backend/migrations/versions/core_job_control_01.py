import sqlalchemy as sa
from alembic import op

revision = "core_job_control_01"
down_revision = "core_worker_presence_01"
branch_labels = None
depends_on = None


def _replace_constraints(*, controls: bool):
    idle = "('pending', 'paused')" if controls else "('pending')"
    active = "('running', 'pausing')" if controls else "('running')"
    cancelled = (
        "(status = 'cancelled' AND finished_at IS NOT NULL AND input_payload IS NULL) OR "
        if controls
        else ""
    )
    statuses = "'pending', 'running', 'succeeded', 'partial', 'failed'"
    if controls:
        statuses += ", 'pausing', 'paused', 'cancelled'"
    op.drop_index("ix_job_lease_due", table_name="collection_jobs")
    op.drop_constraint("ck_job_state", "collection_jobs", type_="check")
    op.drop_constraint("ck_job_attempt", "collection_jobs", type_="check")
    op.drop_constraint("ck_event_status", "execution_events", type_="check")
    op.create_check_constraint(
        "ck_job_state",
        "collection_jobs",
        f"(status IN {idle} AND started_at IS NULL AND finished_at IS NULL AND input_payload IS NOT NULL) OR "
        f"(status IN {active} AND started_at IS NOT NULL AND finished_at IS NULL AND input_payload IS NOT NULL) OR "
        f"{cancelled}(status IN ('succeeded','partial','failed') AND started_at IS NOT NULL "
        "AND finished_at IS NOT NULL AND input_payload IS NULL)",
    )
    op.create_check_constraint(
        "ck_job_attempt",
        "collection_jobs",
        "execution_attempt >= 0 AND dispatch_attempts >= 0 AND "
        f"((status IN {active} AND execution_attempt > 0 AND lease_expires_at IS NOT NULL) OR "
        f"(status NOT IN {active} AND lease_expires_at IS NULL)) AND "
        "((status = 'pending') = (dispatch_due_at IS NOT NULL)) AND "
        f"(next_attempt_at IS NULL OR (status IN {idle} AND execution_attempt > 0))",
    )
    op.create_check_constraint(
        "ck_event_status", "execution_events", f"status IN ({statuses})"
    )
    op.create_index(
        "ix_job_lease_due",
        "collection_jobs",
        ["lease_expires_at", "id"],
        postgresql_where=sa.text(f"status IN {active}"),
    )


def upgrade():
    _replace_constraints(controls=True)


def downgrade():
    used = op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS(SELECT 1 FROM execution_events WHERE status IN ('pausing','paused','cancelled'))"
        )
    )
    if used:
        raise RuntimeError(
            "The previous schema cannot represent recorded job controls. Restore a pre-upgrade backup to preserve history."
        )
    _replace_constraints(controls=False)
