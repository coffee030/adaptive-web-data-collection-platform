"""Store restricted YouTube research records and durable refresh state."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "marketing_youtube_accounts",
        sa.Column("channel_id", sa.String(length=24), nullable=False),
        sa.Column("creator_id", sa.Uuid(), nullable=False),
        sa.Column("refresh_hours", sa.Integer(), nullable=False),
        sa.Column("next_refresh_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("state", sa.String(length=12), nullable=False),
        sa.Column("scan_truncated", sa.Boolean(), nullable=False),
        sa.Column(
            "snapshot",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "state IN ('pending', 'available', 'unavailable', 'expired', 'withdrawn')",
            name="marketing_account_state",
        ),
        sa.CheckConstraint(
            "refresh_hours BETWEEN 6 AND 168", name="marketing_refresh_hours"
        ),
        sa.PrimaryKeyConstraint("channel_id"),
        sa.UniqueConstraint("creator_id"),
    )
    op.create_index(
        "marketing_accounts_due",
        "marketing_youtube_accounts",
        ["next_refresh_at"],
        unique=False,
    )
    op.create_table(
        "marketing_youtube_provider",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("quota_day", sa.Date(), nullable=True),
        sa.Column(
            "standard_units", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "search_calls", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "blocked", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("resume_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("id = 1", name="marketing_single_provider"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute("INSERT INTO marketing_youtube_provider (id) VALUES (1)")
    op.create_table(
        "marketing_youtube_posts",
        sa.Column("video_id", sa.String(length=11), nullable=False),
        sa.Column("channel_id", sa.String(length=24), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("post", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(
            ["channel_id"],
            ["marketing_youtube_accounts.channel_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("video_id"),
    )
    op.create_index(
        "marketing_posts_channel",
        "marketing_youtube_posts",
        ["channel_id"],
        unique=False,
    )
    op.create_index(
        "marketing_posts_expiration",
        "marketing_youtube_posts",
        ["expires_at"],
        unique=False,
    )
    op.create_table(
        "marketing_youtube_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=12), nullable=False),
        sa.Column("channel_id", sa.String(length=24), nullable=True),
        sa.Column("query", sa.String(length=100), nullable=True),
        sa.Column("query_key", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dispatch_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("available_after", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claim", sa.Uuid(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("standard_units", sa.Integer(), nullable=False),
        sa.Column("search_calls", sa.Integer(), nullable=False),
        sa.Column("error_code", sa.String(length=40), nullable=True),
        sa.CheckConstraint(
            "(kind = 'refresh') = (channel_id IS NOT NULL)",
            name="marketing_run_channel",
        ),
        sa.CheckConstraint(
            "kind IN ('refresh', 'discovery')", name="marketing_run_kind"
        ),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed')",
            name="marketing_run_status",
        ),
        sa.ForeignKeyConstraint(
            ["channel_id"],
            ["marketing_youtube_accounts.channel_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "marketing_refresh_active",
        "marketing_youtube_runs",
        ["channel_id"],
        unique=True,
        postgresql_where=sa.text(
            "channel_id IS NOT NULL AND status IN ('queued', 'running')"
        ),
    )
    op.create_index(
        "marketing_runs_dispatch_due",
        "marketing_youtube_runs",
        ["status", "dispatch_at"],
        unique=False,
    )
    op.create_index(
        "marketing_runs_finished",
        "marketing_youtube_runs",
        ["finished_at"],
        unique=False,
    )
    op.create_index(
        "marketing_runs_query",
        "marketing_youtube_runs",
        ["query_key", "created_at"],
        unique=False,
    )
    op.create_table(
        "marketing_youtube_leads",
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("channel_id", sa.String(length=24), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lead", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(
            ["run_id"], ["marketing_youtube_runs.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("run_id", "channel_id"),
    )
    op.create_index(
        "marketing_leads_channel",
        "marketing_youtube_leads",
        ["channel_id"],
        unique=False,
    )
    op.create_index(
        "marketing_leads_expiration",
        "marketing_youtube_leads",
        ["expires_at"],
        unique=False,
    )


def downgrade():
    op.drop_table("marketing_youtube_leads")
    op.drop_table("marketing_youtube_runs")
    op.drop_table("marketing_youtube_posts")
    op.drop_table("marketing_youtube_provider")
    op.drop_table("marketing_youtube_accounts")
