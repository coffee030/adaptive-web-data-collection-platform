from datetime import datetime
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.persistence.models import Base


class RssProvider(Base):
    __tablename__ = "trend_google_provider"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[UUID | None] = mapped_column(sa.ForeignKey("sources.id"))
    profile_id: Mapped[UUID | None] = mapped_column(
        sa.ForeignKey("profile_versions.id")
    )
    blocked: Mapped[bool]
    retry_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(sa.String(64))


class RssSchedule(Base):
    __tablename__ = "trend_google_schedules"
    __table_args__ = (
        sa.CheckConstraint(
            "interval_minutes BETWEEN 10 AND 1440", name="ck_google_rss_interval"
        ),
        sa.CheckConstraint(
            "(claim_id IS NULL) = (claimed_at IS NULL)", name="ck_google_rss_claim"
        ),
    )

    region: Mapped[str] = mapped_column(sa.String(2), primary_key=True)
    active: Mapped[bool]
    interval_minutes: Mapped[int]
    due_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    claim_id: Mapped[UUID | None]
    claimed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(sa.String(64))
    pending_job: Mapped[UUID | None] = mapped_column(
        sa.ForeignKey("collection_jobs.id")
    )
    last_job: Mapped[UUID | None] = mapped_column(sa.ForeignKey("collection_jobs.id"))
    snapshot: Mapped[dict | None] = mapped_column(JSONB)


class RssBatch(Base):
    __tablename__ = "trend_google_batches"

    job_id: Mapped[UUID] = mapped_column(
        sa.ForeignKey("collection_jobs.id"), primary_key=True
    )
    region: Mapped[str] = mapped_column(sa.ForeignKey("trend_google_schedules.region"))
    event_ids: Mapped[list[str]] = mapped_column(JSONB)
    observed_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    response_sha256: Mapped[str] = mapped_column(sa.String(64))
    expected_count: Mapped[int]
    published_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))


class RssEvent(Base):
    __tablename__ = "trend_google_events"

    region: Mapped[str] = mapped_column(
        sa.ForeignKey("trend_google_schedules.region"), primary_key=True
    )
    event_id: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    record_id: Mapped[UUID] = mapped_column(sa.ForeignKey("generic_records.id"))
    traffic_bucket: Mapped[str | None] = mapped_column(sa.String(32))
