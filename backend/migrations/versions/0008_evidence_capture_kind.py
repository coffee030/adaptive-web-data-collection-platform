"""Distinguish search and detail captures while retaining existing evidence."""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "raw_evidence",
        sa.Column("capture_kind", sa.String(), server_default="input", nullable=False),
    )
    op.create_check_constraint(
        "ck_evidence_capture_kind",
        "raw_evidence",
        "capture_kind IN ('input', 'search', 'detail')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_evidence_capture_kind", "raw_evidence", type_="check")
    op.drop_column("raw_evidence", "capture_kind")
