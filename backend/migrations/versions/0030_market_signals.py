"""Publish present and historical measurements from licensed external platforms."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

revision = "0030"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade():
    timed = sa.DateTime(timezone=True)
    op.create_table(
        "market_sources",
        sa.Column("key", sa.String(40), primary_key=True),
        sa.Column(
            "source_id",
            sa.Uuid(),
            sa.ForeignKey("sources.id"),
            unique=True,
            nullable=False,
        ),
        sa.Column(
            "profile_id",
            sa.Uuid(),
            sa.ForeignKey("profile_versions.id"),
            nullable=False,
        ),
        sa.Column("next_check", timed, nullable=False),
        sa.Column("observed", timed),
        sa.Column("full_checked", timed),
        sa.Column("revision", sa.Uuid()),
        sa.Column("generation", sa.Uuid()),
        sa.Column("started", timed),
        sa.Column("full", sa.Boolean(), nullable=False),
        sa.Column("queued", sa.Boolean(), nullable=False),
        sa.Column("error", sa.String(64)),
        sa.Column("receipt", JSONB),
    )
    op.create_table(
        "market_batches",
        sa.Column(
            "job_id", sa.Uuid(), sa.ForeignKey("collection_jobs.id"), primary_key=True
        ),
        sa.Column(
            "source", sa.String(40), sa.ForeignKey("market_sources.key"), nullable=False
        ),
        sa.Column("generation", sa.Uuid(), nullable=False),
    )
    op.create_index("ix_market_batches_generation", "market_batches", ["generation"])
    op.create_table(
        "market_activity",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column(
            "source", sa.String(40), sa.ForeignKey("market_sources.key"), nullable=False
        ),
        sa.Column("creator_id", sa.String(32), nullable=False),
        sa.Column("published", timed, nullable=False),
        sa.Column("checked", timed, nullable=False),
        sa.Column("topics", ARRAY(sa.String(100)), nullable=False),
        sa.Column("search_text", sa.Text, nullable=False),
        sa.Column("generation", sa.Uuid(), nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column(
            "core_record",
            sa.Uuid(),
            sa.ForeignKey("generic_records.id"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_market_creator_date", "market_activity", ["creator_id", "published"]
    )
    op.create_index(
        "ix_market_source_checked", "market_activity", ["source", "checked"]
    )
    op.create_index(
        "ix_market_topics", "market_activity", ["topics"], postgresql_using="gin"
    )
    op.create_table(
        "market_measurements",
        sa.Column(
            "activity_id",
            sa.String(100),
            sa.ForeignKey("market_activity.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("observed", timed, primary_key=True),
        sa.Column("metrics", JSONB, nullable=False),
    )


def downgrade():
    for table in (
        "market_measurements",
        "market_activity",
        "market_batches",
        "market_sources",
    ):
        op.drop_table(table)
