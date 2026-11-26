"""Publication generations and measured history of verified external activity."""

from datetime import datetime
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.persistence.models import Base


class MarketSource(Base):
    __tablename__ = "market_sources"
    key: Mapped[str] = mapped_column(sa.String(40), primary_key=True)
    source_id: Mapped[UUID] = mapped_column(sa.ForeignKey("sources.id"), unique=True)
    profile_id: Mapped[UUID] = mapped_column(sa.ForeignKey("profile_versions.id"))
    next_check: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    observed: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    full_checked: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    revision: Mapped[UUID | None]
    generation: Mapped[UUID | None]
    started: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    full: Mapped[bool] = mapped_column(default=True)
    queued: Mapped[bool] = mapped_column(default=False)
    error: Mapped[str | None] = mapped_column(sa.String(64))
    receipt: Mapped[dict | None] = mapped_column(JSONB)


class MarketBatch(Base):
    __tablename__ = "market_batches"
    job_id: Mapped[UUID] = mapped_column(
        sa.ForeignKey("collection_jobs.id"), primary_key=True
    )
    source: Mapped[str] = mapped_column(sa.ForeignKey("market_sources.key"))
    generation: Mapped[UUID] = mapped_column(index=True)


class MarketActivity(Base):
    __tablename__ = "market_activity"
    __table_args__ = (
        sa.Index("ix_market_creator_date", "creator_id", "published"),
        sa.Index("ix_market_source_checked", "source", "checked"),
        sa.Index("ix_market_topics", "topics", postgresql_using="gin"),
    )
    id: Mapped[str] = mapped_column(sa.String(100), primary_key=True)
    source: Mapped[str] = mapped_column(sa.ForeignKey("market_sources.key"))
    creator_id: Mapped[str] = mapped_column(sa.String(32))
    published: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    checked: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    topics: Mapped[list[str]] = mapped_column(ARRAY(sa.String(100)))
    search_text: Mapped[str] = mapped_column(sa.Text)
    generation: Mapped[UUID]
    payload: Mapped[dict] = mapped_column(JSONB)
    core_record: Mapped[UUID] = mapped_column(sa.ForeignKey("generic_records.id"))


class MarketMeasure(Base):
    __tablename__ = "market_measurements"
    activity_id: Mapped[str] = mapped_column(
        sa.ForeignKey("market_activity.id", ondelete="CASCADE"), primary_key=True
    )
    observed: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), primary_key=True
    )
    metrics: Mapped[list[dict]] = mapped_column(JSONB)
