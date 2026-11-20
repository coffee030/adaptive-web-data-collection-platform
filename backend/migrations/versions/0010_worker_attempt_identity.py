"""Record the owner of new Job execution claims."""

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("execution_events", sa.Column("worker_instance_id", sa.Uuid()))
    op.add_column("execution_events", sa.Column("execution_origin", sa.String(6)))


def downgrade():
    op.drop_column("execution_events", "execution_origin")
    op.drop_column("execution_events", "worker_instance_id")
