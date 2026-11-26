from alembic import op
import sqlalchemy as sa


revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        "ix_job_finished",
        "collection_jobs",
        ["finished_at"],
        postgresql_where=sa.text("finished_at IS NOT NULL"),
    )
    op.create_index(
        "ix_event_worker_claim_time",
        "execution_events",
        ["occurred_at"],
        postgresql_where=sa.text("kind = 'CLAIMED' AND worker_instance_id IS NOT NULL"),
    )


def downgrade():
    op.drop_index("ix_event_worker_claim_time", table_name="execution_events")
    op.drop_index("ix_job_finished", table_name="collection_jobs")
