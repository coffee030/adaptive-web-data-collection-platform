from datetime import date, datetime
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from backend.persistence.models import Base


class WikiProvider(Base):
    __tablename__ = "trend_wikimedia_provider"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[UUID | None] = mapped_column(sa.ForeignKey("sources.id"))
    profile_id: Mapped[UUID | None] = mapped_column(
        sa.ForeignKey("profile_versions.id")
    )
    next_request_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    blocked: Mapped[bool] = mapped_column(default=False)
    last_error: Mapped[str | None] = mapped_column(sa.String(64))


class WikiWatch(Base):
    __tablename__ = "trend_wikimedia_watches"
    __table_args__ = (sa.UniqueConstraint("project", "article"),)

    id: Mapped[UUID] = mapped_column(primary_key=True)
    project: Mapped[str] = mapped_column(sa.String(80))
    article: Mapped[str] = mapped_column(sa.String(250))
    topic: Mapped[str] = mapped_column(sa.String(128))
    active: Mapped[bool] = mapped_column(default=True)
    start_day: Mapped[date]
    next_day: Mapped[date]
    due_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    last_capture_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(sa.String(64))
    pending_job: Mapped[UUID | None] = mapped_column(
        sa.ForeignKey("collection_jobs.id")
    )
    last_job: Mapped[UUID | None] = mapped_column(sa.ForeignKey("collection_jobs.id"))


class WikiBatch(Base):
    __tablename__ = "trend_wikimedia_batches"

    job_id: Mapped[UUID] = mapped_column(
        sa.ForeignKey("collection_jobs.id"), primary_key=True
    )
    watch_id: Mapped[UUID] = mapped_column(
        sa.ForeignKey("trend_wikimedia_watches.id"), index=True
    )
    start_day: Mapped[date]
    next_day: Mapped[date]
    row_count: Mapped[int]
    observed_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    gap_count: Mapped[int]
    response_sha256: Mapped[str] = mapped_column(sa.String(64))
    response: Mapped[bytes] = mapped_column(sa.LargeBinary)
