"""Add durable single-input jobs and ordered execution events."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_unique_constraint(
        "uq_profile_job_pin", "profile_versions", ["source_id", "id", "config_hash"]
    )
    op.create_table(
        "collection_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("profile_version_id", sa.Uuid(), nullable=False),
        sa.Column("config_hash", sa.String(64), nullable=False),
        sa.Column("request_key", sa.Uuid()),
        sa.Column("input_hash", sa.String(64), nullable=False),
        sa.Column("input_payload", JSONB(none_as_null=True)),
        sa.Column("status", sa.String(9), server_default="pending", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("valid_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("invalid_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("duplicate_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("error", JSONB()),
        sa.ForeignKeyConstraint(
            ["source_id", "profile_version_id", "config_hash"],
            [
                "profile_versions.source_id",
                "profile_versions.id",
                "profile_versions.config_hash",
            ],
            name="fk_job_profile_pin",
        ),
        sa.UniqueConstraint("source_id", "request_key", name="uq_job_request"),
        sa.CheckConstraint(
            "(status = 'pending' AND started_at IS NULL AND finished_at IS NULL AND input_payload IS NOT NULL) OR "
            "(status = 'running' AND started_at IS NOT NULL AND finished_at IS NULL AND input_payload IS NOT NULL) OR "
            "(status IN ('succeeded', 'partial', 'failed') AND started_at IS NOT NULL "
            "AND finished_at IS NOT NULL AND input_payload IS NULL)",
            name="ck_job_state",
        ),
        sa.CheckConstraint(
            "valid_count >= 0 AND invalid_count >= 0 AND duplicate_count >= 0",
            name="ck_job_counts",
        ),
    )
    op.create_index(
        "ix_job_status_created", "collection_jobs", ["status", "created_at", "id"]
    )
    op.create_index("ix_job_created", "collection_jobs", ["created_at", "id"])
    op.create_table(
        "execution_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "job_id", sa.Uuid(), sa.ForeignKey("collection_jobs.id"), nullable=False
        ),
        sa.Column("sequence", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("status", sa.String(9), nullable=False),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("error", JSONB()),
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'succeeded', 'partial', 'failed')",
            name="ck_event_status",
        ),
        sa.UniqueConstraint("job_id", "sequence", name="uq_event_job_sequence"),
    )


def downgrade():
    op.drop_table("execution_events")
    op.drop_table("collection_jobs")
    op.drop_constraint("uq_profile_job_pin", "profile_versions", type_="unique")
