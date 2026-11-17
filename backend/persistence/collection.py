"""Durable topic, request, and article metadata."""

from datetime import datetime
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .models import Base, Timestamps


class CategoryRow(Timestamps, Base):
    __tablename__ = "categories"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(sa.String(128))
    active: Mapped[bool] = mapped_column(server_default=sa.true())

    __table_args__ = (sa.Index("uq_category_name", sa.func.lower(name), unique=True),)


class TopicRow(Timestamps, Base):
    __tablename__ = "topics"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    category_id: Mapped[UUID] = mapped_column(sa.ForeignKey("categories.id"))
    name: Mapped[str] = mapped_column(sa.String(128))
    active: Mapped[bool] = mapped_column(server_default=sa.true())

    __table_args__ = (
        sa.Index(
            "uq_topic_category_name", category_id, sa.func.lower(name), unique=True
        ),
    )


class TopicBindingRow(Base):
    __tablename__ = "topic_bindings"
    __table_args__ = (
        sa.ForeignKeyConstraint(
            ["source_id", "profile_version_id", "config_hash"],
            [
                "profile_versions.source_id",
                "profile_versions.id",
                "profile_versions.config_hash",
            ],
            name="fk_binding_profile_pin",
        ),
        sa.UniqueConstraint(
            "topic_id", "source_id", "profile_version_id", name="uq_topic_binding"
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    topic_id: Mapped[UUID] = mapped_column(sa.ForeignKey("topics.id"))
    source_id: Mapped[UUID]
    profile_version_id: Mapped[UUID]
    config_hash: Mapped[str] = mapped_column(sa.String(64))
    approved_by: Mapped[str] = mapped_column(sa.String(128))
    approved_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    disabled_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))


class CollectionRequestRow(Base):
    __tablename__ = "collection_requests"
    __table_args__ = (sa.Index("ix_request_created", "created_at", "id"),)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    topic_id: Mapped[UUID] = mapped_column(sa.ForeignKey("topics.id"))
    topic_name: Mapped[str] = mapped_column(sa.String(128))
    keyword: Mapped[str] = mapped_column(sa.String(128))
    request_key: Mapped[UUID] = mapped_column(unique=True)
    intent_hash: Mapped[str] = mapped_column(sa.String(64))
    refresh_of: Mapped[UUID | None] = mapped_column(
        sa.ForeignKey("collection_requests.id")
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )


class RequestJobRow(Base):
    __tablename__ = "collection_request_jobs"
    __table_args__ = (
        sa.UniqueConstraint("request_id", "binding_id", name="uq_request_binding"),
    )
    job_id: Mapped[UUID] = mapped_column(
        sa.ForeignKey("collection_jobs.id"), primary_key=True
    )
    request_id: Mapped[UUID] = mapped_column(sa.ForeignKey("collection_requests.id"))
    binding_id: Mapped[UUID] = mapped_column(sa.ForeignKey("topic_bindings.id"))
    approved_by: Mapped[str] = mapped_column(sa.String(128))
    approved_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))


class ArticleRow(Base):
    __tablename__ = "articles"
    __table_args__ = (
        sa.UniqueConstraint(
            "source_id", "identity_hash", name="uq_source_article_identity"
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    source_id: Mapped[UUID] = mapped_column(sa.ForeignKey("sources.id"))
    identity_hash: Mapped[str] = mapped_column(sa.String(64))
    identity_kind: Mapped[str] = mapped_column(sa.String(3))


class ContentVersionRow(Base):
    __tablename__ = "article_content_versions"
    __table_args__ = (
        sa.UniqueConstraint("article_id", "id", name="uq_article_version_id"),
        sa.UniqueConstraint(
            "article_id", "content_hash", name="uq_article_content_hash"
        ),
        sa.UniqueConstraint("article_id", "version", name="uq_article_version"),
        sa.CheckConstraint("version > 0", name="ck_article_version_positive"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    article_id: Mapped[UUID] = mapped_column(sa.ForeignKey("articles.id"))
    version: Mapped[int]
    content_hash: Mapped[str] = mapped_column(sa.String(64))
    content: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )


class ObservationRow(Base):
    __tablename__ = "article_observations"
    __table_args__ = (
        sa.ForeignKeyConstraint(
            ["article_id", "content_version_id"],
            ["article_content_versions.article_id", "article_content_versions.id"],
            name="fk_observation_article_version",
        ),
        sa.Index(
            "ix_article_latest_observation", "article_id", "captured_at", "record_id"
        ),
    )
    record_id: Mapped[UUID] = mapped_column(
        sa.ForeignKey("generic_records.id"), primary_key=True
    )
    article_id: Mapped[UUID]
    content_version_id: Mapped[UUID]
    captured_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    url: Mapped[str] = mapped_column(sa.String(2048))
    raw_payload: Mapped[dict] = mapped_column(JSONB)
