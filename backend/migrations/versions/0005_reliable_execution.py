"""Persist dispatch timing and fence recoverable job attempts."""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "collection_jobs",
        sa.Column(
            "execution_attempt", sa.Integer(), server_default="0", nullable=False
        ),
    )
    for name in (
        "lease_expires_at",
        "dispatch_due_at",
        "last_dispatched_at",
        "next_attempt_at",
    ):
        op.add_column("collection_jobs", sa.Column(name, sa.DateTime(timezone=True)))
    op.add_column(
        "collection_jobs",
        sa.Column(
            "dispatch_attempts", sa.Integer(), server_default="0", nullable=False
        ),
    )
    op.add_column("collection_jobs", sa.Column("dispatch_error_code", sa.String(64)))
    op.add_column("execution_events", sa.Column("kind", sa.String(32)))
    op.add_column("execution_events", sa.Column("execution_attempt", sa.Integer()))
    op.execute("""
        UPDATE collection_jobs
        SET execution_attempt = CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
            lease_expires_at = CASE WHEN status = 'running' THEN clock_timestamp() END,
            dispatch_due_at = CASE WHEN status = 'pending' THEN clock_timestamp() END
        """)
    op.create_check_constraint(
        "ck_job_attempt",
        "collection_jobs",
        "execution_attempt >= 0 AND dispatch_attempts >= 0 AND "
        "((status = 'running' AND execution_attempt > 0 AND lease_expires_at IS NOT NULL) OR "
        "(status <> 'running' AND lease_expires_at IS NULL)) AND "
        "((status = 'pending') = (dispatch_due_at IS NOT NULL)) AND "
        "(next_attempt_at IS NULL OR (status = 'pending' AND execution_attempt > 0))",
    )
    op.create_index(
        "ix_job_dispatch_due",
        "collection_jobs",
        ["dispatch_due_at", "id"],
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        "ix_job_lease_due",
        "collection_jobs",
        ["lease_expires_at", "id"],
        postgresql_where=sa.text("status = 'running'"),
    )


def downgrade():
    op.drop_index("ix_job_lease_due", table_name="collection_jobs")
    op.drop_index("ix_job_dispatch_due", table_name="collection_jobs")
    op.drop_constraint("ck_job_attempt", "collection_jobs", type_="check")
    op.drop_column("execution_events", "execution_attempt")
    op.drop_column("execution_events", "kind")
    for name in (
        "dispatch_error_code",
        "dispatch_attempts",
        "last_dispatched_at",
        "dispatch_due_at",
        "next_attempt_at",
        "lease_expires_at",
        "execution_attempt",
    ):
        op.drop_column("collection_jobs", name)
