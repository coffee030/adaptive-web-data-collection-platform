"""PostgreSQL storage for the marketing module's research-only source."""

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.persistence.models import Base


class AccountRow(Base):
    __tablename__ = "marketing_youtube_accounts"
    __table_args__ = (
        CheckConstraint(
            "refresh_hours BETWEEN 6 AND 168", name="marketing_refresh_hours"
        ),
        CheckConstraint(
            "state IN ('pending', 'available', 'unavailable', 'expired', 'withdrawn')",
            name="marketing_account_state",
        ),
        Index("marketing_accounts_due", "next_refresh_at"),
    )

    channel_id: Mapped[str] = mapped_column(String(24), primary_key=True)
    creator_id: Mapped[UUID] = mapped_column(unique=True)
    refresh_hours: Mapped[int]
    next_refresh_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    state: Mapped[str] = mapped_column(String(12))
    scan_truncated: Mapped[bool]
    snapshot: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RunRow(Base):
    __tablename__ = "marketing_youtube_runs"
    __table_args__ = (
        CheckConstraint("kind IN ('refresh', 'discovery')", name="marketing_run_kind"),
        CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed')",
            name="marketing_run_status",
        ),
        CheckConstraint(
            "(kind = 'refresh') = (channel_id IS NOT NULL)",
            name="marketing_run_channel",
        ),
        Index(
            "marketing_refresh_active",
            "channel_id",
            unique=True,
            postgresql_where=text(
                "channel_id IS NOT NULL AND status IN ('queued', 'running')"
            ),
        ),
        Index("marketing_runs_dispatch_due", "status", "dispatch_at"),
        Index("marketing_runs_query", "query_key", "created_at"),
        Index("marketing_runs_finished", "finished_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(12))
    channel_id: Mapped[str | None] = mapped_column(
        ForeignKey(AccountRow.channel_id, ondelete="CASCADE")
    )
    query: Mapped[str | None] = mapped_column(String(100))
    query_key: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(12))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dispatch_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    available_after: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    claim: Mapped[UUID | None]
    attempts: Mapped[int]
    standard_units: Mapped[int]
    search_calls: Mapped[int]
    error_code: Mapped[str | None] = mapped_column(String(40))


class PostRow(Base):
    __tablename__ = "marketing_youtube_posts"
    __table_args__ = (
        Index("marketing_posts_channel", "channel_id"),
        Index("marketing_posts_expiration", "expires_at"),
    )

    video_id: Mapped[str] = mapped_column(String(11), primary_key=True)
    channel_id: Mapped[str] = mapped_column(
        ForeignKey(AccountRow.channel_id, ondelete="CASCADE")
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    post: Mapped[dict] = mapped_column(JSONB)


class LeadRow(Base):
    __tablename__ = "marketing_youtube_leads"
    __table_args__ = (
        Index("marketing_leads_channel", "channel_id"),
        Index("marketing_leads_expiration", "expires_at"),
    )

    run_id: Mapped[UUID] = mapped_column(
        ForeignKey(RunRow.id, ondelete="CASCADE"), primary_key=True
    )
    channel_id: Mapped[str] = mapped_column(String(24), primary_key=True)
    rank: Mapped[int]
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    lead: Mapped[dict] = mapped_column(JSONB)


class ProviderRow(Base):
    __tablename__ = "marketing_youtube_provider"
    __table_args__ = (CheckConstraint("id = 1", name="marketing_single_provider"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    quota_day: Mapped[date | None]
    standard_units: Mapped[int] = mapped_column(server_default=text("0"))
    search_calls: Mapped[int] = mapped_column(server_default=text("0"))
    blocked: Mapped[bool] = mapped_column(server_default=text("false"))
    resume_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
