"""Persist idempotent Source registration intents."""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("sources", sa.Column("request_key", sa.Uuid()))
    op.add_column("sources", sa.Column("request_hash", sa.String(64)))
    op.create_unique_constraint("uq_source_request_key", "sources", ["request_key"])
    op.create_check_constraint(
        "ck_source_request_intent",
        "sources",
        "(request_key IS NULL) = (request_hash IS NULL)",
    )


def downgrade():
    raise RuntimeError("Source request keys must be preserved")
