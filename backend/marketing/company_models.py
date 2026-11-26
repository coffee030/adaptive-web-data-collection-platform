from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    String,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.persistence.models import Base


class CompanyRow(Base):
    __tablename__ = "marketing_companies"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)


class MemberRow(Base):
    __tablename__ = "marketing_company_members"
    __table_args__ = (
        CheckConstraint("role IN ('admin', 'member')", name="company_member_role"),
    )
    username: Mapped[str] = mapped_column(String(80), primary_key=True)
    company_id: Mapped[str] = mapped_column(
        ForeignKey("marketing_companies.id"), index=True
    )
    role: Mapped[str] = mapped_column(String(8))
    password_hash: Mapped[str] = mapped_column(String(192))
    failed_attempts: Mapped[int]
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CompanySessionRow(Base):
    __tablename__ = "marketing_company_sessions"
    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    username: Mapped[str] = mapped_column(
        ForeignKey("marketing_company_members.username", ondelete="CASCADE")
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class CompanyCampaignRow(Base):
    __tablename__ = "marketing_company_campaigns"
    company_id: Mapped[str] = mapped_column(
        ForeignKey("marketing_companies.id"), primary_key=True
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    version: Mapped[int]
    draft: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(12), server_default="planning")
    tracking_version: Mapped[int] = mapped_column(server_default="0")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class CampaignPeriodRow(Base):
    __tablename__ = "marketing_campaign_periods"
    __table_args__ = (
        ForeignKeyConstraint(
            ["company_id", "campaign_id"],
            [
                "marketing_company_campaigns.company_id",
                "marketing_company_campaigns.id",
            ],
            ondelete="CASCADE",
        ),
    )
    company_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    campaign_id: Mapped[UUID] = mapped_column(primary_key=True)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    channel: Mapped[str] = mapped_column(String(60))
    period_start: Mapped[date]
    period_end: Mapped[date]
    report: Mapped[dict] = mapped_column(JSONB)
    recorded_by: Mapped[str] = mapped_column(String(80))
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
