from alembic import op
import sqlalchemy as sa

revision = "core_trends_01"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade():
    provider = op.create_table(
        "trend_wikimedia_provider",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("source_id", sa.Uuid, sa.ForeignKey("sources.id")),
        sa.Column("profile_id", sa.Uuid, sa.ForeignKey("profile_versions.id")),
        sa.Column("next_request_at", sa.DateTime(timezone=True)),
        sa.Column("blocked", sa.Boolean, nullable=False),
        sa.Column("last_error", sa.String(64)),
    )
    op.bulk_insert(provider, [{"id": 1, "blocked": False}])
    op.create_table(
        "trend_wikimedia_watches",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("project", sa.String(80), nullable=False),
        sa.Column("article", sa.String(250), nullable=False),
        sa.Column("topic", sa.String(128), nullable=False),
        sa.Column("active", sa.Boolean, nullable=False),
        sa.Column("start_day", sa.Date, nullable=False),
        sa.Column("next_day", sa.Date, nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_capture_at", sa.DateTime(timezone=True)),
        sa.Column("last_error", sa.String(64)),
        sa.Column("pending_job", sa.Uuid, sa.ForeignKey("collection_jobs.id")),
        sa.Column("last_job", sa.Uuid, sa.ForeignKey("collection_jobs.id")),
        sa.UniqueConstraint("project", "article"),
    )
    op.create_table(
        "trend_wikimedia_batches",
        sa.Column(
            "job_id", sa.Uuid, sa.ForeignKey("collection_jobs.id"), primary_key=True
        ),
        sa.Column(
            "watch_id",
            sa.Uuid,
            sa.ForeignKey("trend_wikimedia_watches.id"),
            nullable=False,
        ),
        sa.Column("start_day", sa.Date, nullable=False),
        sa.Column("next_day", sa.Date, nullable=False),
        sa.Column("row_count", sa.Integer, nullable=False),
        sa.Column("gap_count", sa.Integer, nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("response_sha256", sa.String(64), nullable=False),
        sa.Column("response", sa.LargeBinary, nullable=False),
    )
    op.create_index(
        "ix_trend_wikimedia_batches_watch_id", "trend_wikimedia_batches", ["watch_id"]
    )


def downgrade():
    op.drop_table("trend_wikimedia_batches")
    op.drop_table("trend_wikimedia_watches")
    op.drop_table("trend_wikimedia_provider")
