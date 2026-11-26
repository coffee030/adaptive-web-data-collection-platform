from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.persistence.models import Base


class ResearchRunRow(Base):
    __tablename__ = "company_research_runs"
    __table_args__ = (
        UniqueConstraint(
            "company_id", "request_key", name="uq_company_research_request"
        ),
        ForeignKeyConstraint(
            ["company_id", "campaign_id"],
            [
                "marketing_company_campaigns.company_id",
                "marketing_company_campaigns.id",
            ],
        ),
        CheckConstraint(
            "state IN ('queued','collecting','analyzing','ready','failed','cancelled')",
            name="research_run_state",
        ),
        Index("ix_company_research_due", "state", "due_at"),
        Index("ix_company_research_recent", "company_id", "created_at"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    company_id: Mapped[str] = mapped_column(ForeignKey("marketing_companies.id"))
    campaign_id: Mapped[UUID | None]
    request_key: Mapped[UUID]
    brief: Mapped[dict] = mapped_column(JSONB)
    state: Mapped[str] = mapped_column(String(12))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    claim: Mapped[UUID | None]
    attempts: Mapped[int]
    sources: Mapped[list] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(String(64))
    revision: Mapped[str | None] = mapped_column(String(64))
    review: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
