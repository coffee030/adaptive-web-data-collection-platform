"""Allow ordered page evidence and page-local quarantine positions."""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "raw_evidence",
        sa.Column("page_number", sa.Integer(), server_default="1", nullable=False),
    )
    op.create_check_constraint(
        "ck_evidence_page_number", "raw_evidence", "page_number > 0"
    )
    op.create_unique_constraint(
        "uq_evidence_job_page", "raw_evidence", ["job_id", "page_number"]
    )
    op.drop_constraint("uq_evidence_job", "raw_evidence", type_="unique")
    op.drop_constraint("uq_evidence_run", "raw_evidence", type_="unique")
    op.create_unique_constraint(
        "uq_quarantine_evidence_position",
        "quarantined_records",
        ["job_id", "evidence_id", "position_kind", "position_index"],
    )
    op.drop_constraint(
        "uq_quarantine_job_position", "quarantined_records", type_="unique"
    )


def downgrade():
    op.create_unique_constraint("uq_evidence_job", "raw_evidence", ["job_id"])
    op.create_unique_constraint("uq_evidence_run", "raw_evidence", ["run_id"])
    op.create_unique_constraint(
        "uq_quarantine_job_position",
        "quarantined_records",
        ["job_id", "position_kind", "position_index"],
    )
    op.drop_constraint(
        "uq_quarantine_evidence_position", "quarantined_records", type_="unique"
    )
    op.drop_constraint("uq_evidence_job_page", "raw_evidence", type_="unique")
    op.drop_constraint("ck_evidence_page_number", "raw_evidence", type_="check")
    op.drop_column("raw_evidence", "page_number")
