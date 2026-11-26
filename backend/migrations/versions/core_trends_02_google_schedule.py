from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "core_trends_02"
down_revision = "core_trends_01"
branch_labels = None
depends_on = None


def upgrade():
    provider = op.create_table(
        "trend_google_provider",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("source_id", sa.Uuid, sa.ForeignKey("sources.id")),
        sa.Column("profile_id", sa.Uuid, sa.ForeignKey("profile_versions.id")),
        sa.Column("blocked", sa.Boolean, nullable=False),
        sa.Column("retry_at", sa.DateTime(timezone=True)),
        sa.Column("last_error", sa.String(64)),
    )
    op.bulk_insert(provider, [{"id": 1, "blocked": False}])
    op.create_table(
        "trend_google_schedules",
        sa.Column("region", sa.String(2), primary_key=True),
        sa.Column("active", sa.Boolean, nullable=False),
        sa.Column("interval_minutes", sa.Integer, nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("claim_id", sa.Uuid),
        sa.Column("claimed_at", sa.DateTime(timezone=True)),
        sa.Column("last_error", sa.String(64)),
        sa.Column("pending_job", sa.Uuid, sa.ForeignKey("collection_jobs.id")),
        sa.Column("last_job", sa.Uuid, sa.ForeignKey("collection_jobs.id")),
        sa.Column("snapshot", JSONB),
        sa.CheckConstraint(
            "interval_minutes BETWEEN 10 AND 1440", name="ck_google_rss_interval"
        ),
        sa.CheckConstraint(
            "(claim_id IS NULL) = (claimed_at IS NULL)", name="ck_google_rss_claim"
        ),
    )
    op.create_table(
        "trend_google_batches",
        sa.Column(
            "job_id", sa.Uuid, sa.ForeignKey("collection_jobs.id"), primary_key=True
        ),
        sa.Column(
            "region",
            sa.String(2),
            sa.ForeignKey("trend_google_schedules.region"),
            nullable=False,
        ),
        sa.Column("event_ids", JSONB, nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("response_sha256", sa.String(64), nullable=False),
        sa.Column("expected_count", sa.Integer, nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "trend_google_events",
        sa.Column(
            "region",
            sa.String(2),
            sa.ForeignKey("trend_google_schedules.region"),
            primary_key=True,
        ),
        sa.Column("event_id", sa.String(64), primary_key=True),
        sa.Column(
            "record_id", sa.Uuid, sa.ForeignKey("generic_records.id"), nullable=False
        ),
        sa.Column("traffic_bucket", sa.String(32)),
    )


def downgrade():
    op.drop_table("trend_google_events")
    op.drop_table("trend_google_batches")
    op.drop_table("trend_google_schedules")
    op.drop_table("trend_google_provider")
