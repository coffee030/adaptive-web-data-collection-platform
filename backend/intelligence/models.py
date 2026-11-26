"""Isolated, expiring partner and demonstration datasets."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.persistence.models import Base


class DatasetRow(Base):
    __tablename__ = "marketing_intelligence_datasets"
    __table_args__ = (
        UniqueConstraint(
            "mode", "workspace", "dataset_id", name="intelligence_dataset_identity"
        ),
        CheckConstraint(
            "mode IN ('demo', 'partner')", name="intelligence_dataset_mode"
        ),
        CheckConstraint(
            "state IN ('lexical', 'running', 'ready', 'fallback', 'expired', 'withdrawn')",
            name="intelligence_dataset_state",
        ),
        Index("intelligence_dataset_expiration", "expires_at"),
        Index("intelligence_dataset_index_due", "state", "due_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    mode: Mapped[str] = mapped_column(String(7))
    workspace: Mapped[str] = mapped_column(String(64))
    dataset_id: Mapped[str] = mapped_column(String(64))
    digest: Mapped[str | None] = mapped_column(String(64))
    payload: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    grams: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    vectors: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    model_version: Mapped[str | None] = mapped_column(String(120))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    state: Mapped[str] = mapped_column(String(12))
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    claim: Mapped[UUID | None]
    refresh_error: Mapped[str | None] = mapped_column(String(64))
    index_failures: Mapped[int]
