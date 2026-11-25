"""Retain the most recent rejected partner delivery reason for operators."""

from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "marketing_intelligence_datasets", sa.Column("refresh_error", sa.String(64))
    )


def downgrade():
    op.drop_column("marketing_intelligence_datasets", "refresh_error")
