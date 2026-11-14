"""Add evidence, generic records and quarantined records."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def result_identity(name):
    return (
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("evidence_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["job_id", "evidence_id"],
            ["raw_evidence.job_id", "raw_evidence.id"],
            name=name,
        ),
    )


def upgrade():
    op.create_table(
        "raw_evidence",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "job_id", sa.Uuid(), sa.ForeignKey("collection_jobs.id"), nullable=False
        ),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("storage_reference", sa.String(42), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("content_type", sa.Text()),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("adapter_type", sa.String(3), nullable=False),
        sa.Column("original_location", sa.Text(), nullable=False),
        sa.Column("requested_location", sa.Text()),
        sa.Column("http_status", sa.Integer()),
        sa.UniqueConstraint("job_id", name="uq_evidence_job"),
        sa.UniqueConstraint("job_id", "id", name="uq_evidence_job_id"),
        sa.UniqueConstraint("run_id", name="uq_evidence_run"),
        sa.CheckConstraint(
            "adapter_type IN ('web', 'csv')", name="ck_evidence_adapter"
        ),
    )
    op.create_table(
        "generic_records",
        *result_identity("fk_record_job_evidence"),
        sa.Column("record_type", sa.String(128), nullable=False),
        sa.Column("schema_version", sa.String(16), nullable=False),
        sa.Column("source_record_key", sa.Text()),
        sa.Column("deduplication_key", sa.String(64), nullable=False),
        sa.Column("validation_status", sa.String(6), nullable=False),
        sa.Column("payload", JSONB(), nullable=False),
        sa.Column("source_position", JSONB(), nullable=False),
        sa.UniqueConstraint("job_id", "deduplication_key", name="uq_record_job_dedup"),
        sa.CheckConstraint(
            "validation_status = 'passed'", name="ck_record_validation_status"
        ),
    )
    op.create_index("ix_record_created", "generic_records", ["created_at", "id"])
    op.create_index(
        "ix_record_job_created", "generic_records", ["job_id", "created_at", "id"]
    )
    op.create_table(
        "quarantined_records",
        *result_identity("fk_quarantine_job_evidence"),
        sa.Column("position_kind", sa.String(9), nullable=False),
        sa.Column("position_index", sa.Integer(), nullable=False),
        sa.Column("problems", JSONB(), nullable=False),
        sa.UniqueConstraint(
            "job_id",
            "position_kind",
            "position_index",
            name="uq_quarantine_job_position",
        ),
        sa.CheckConstraint(
            "position_kind IN ('html_item', 'csv_row') AND position_index > 0",
            name="ck_quarantine_position",
        ),
    )


def downgrade():
    op.drop_table("quarantined_records")
    op.drop_table("generic_records")
    op.drop_table("raw_evidence")
