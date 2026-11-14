"""Create durable sources and profile versions."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def timestamps():
    return (
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def upgrade():
    op.create_table(
        "sources",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("adapter_type", sa.String(3), nullable=False),
        sa.Column("permission_reference", sa.String(128), nullable=False),
        sa.Column("approval_status", sa.String(8), nullable=False),
        sa.Column("access_policy", JSONB(), nullable=False),
        *timestamps(),
        sa.CheckConstraint("adapter_type IN ('web', 'csv')", name="ck_source_adapter"),
        sa.CheckConstraint(
            "approval_status IN ('pending', 'approved', 'revoked')",
            name="ck_source_status",
        ),
    )
    op.create_table(
        "profile_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("source_id", sa.Uuid(), sa.ForeignKey("sources.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("configuration", JSONB(), nullable=False),
        sa.Column("config_hash", sa.String(64), nullable=False),
        sa.Column("approval_status", sa.String(8), nullable=False),
        sa.Column("approved_by", sa.String(128)),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column("validation_report_id", sa.Uuid()),
        *timestamps(),
        sa.UniqueConstraint("source_id", "version", name="uq_profile_source_version"),
        sa.CheckConstraint("version > 0 AND revision > 0", name="ck_profile_version"),
        sa.CheckConstraint(
            "(approval_status = 'draft' AND approved_by IS NULL AND approved_at IS NULL "
            "AND validation_report_id IS NULL) OR "
            "(approval_status IN ('approved', 'retired') AND approved_by IS NOT NULL "
            "AND approved_at IS NOT NULL AND validation_report_id IS NOT NULL)",
            name="ck_profile_approval",
        ),
    )


def downgrade():
    op.drop_table("profile_versions")
    op.drop_table("sources")
