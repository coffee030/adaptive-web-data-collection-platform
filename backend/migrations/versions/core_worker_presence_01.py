import sqlalchemy as sa
from alembic import op

revision = "core_worker_presence_01"
down_revision = "core_trends_01"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "worker_presence",
        sa.Column("instance_id", sa.Uuid(), primary_key=True),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("offline_detected_at", sa.DateTime(timezone=True)),
    )


def downgrade():
    op.drop_table("worker_presence")
