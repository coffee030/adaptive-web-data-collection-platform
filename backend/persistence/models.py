"""PostgreSQL relational metadata. The Core contracts remain independent of the ORM."""

from datetime import datetime
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()
    )


class SourceRow(Timestamps, Base):
    __tablename__ = "sources"
    __table_args__ = (
        sa.CheckConstraint("adapter_type IN ('web', 'csv')", name="ck_source_adapter"),
        sa.CheckConstraint(
            "approval_status IN ('pending', 'approved', 'revoked')",
            name="ck_source_status",
        ),
        sa.UniqueConstraint("request_key", name="uq_source_request_key"),
        sa.CheckConstraint(
            "(request_key IS NULL) = (request_hash IS NULL)",
            name="ck_source_request_intent",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(sa.String(128))
    adapter_type: Mapped[str] = mapped_column(sa.String(3))
    permission_reference: Mapped[str] = mapped_column(sa.String(128))
    approval_status: Mapped[str] = mapped_column(sa.String(8))
    access_policy: Mapped[dict] = mapped_column(JSONB)
    request_key: Mapped[UUID | None]
    request_hash: Mapped[str | None] = mapped_column(sa.String(64))


class ProfileRow(Timestamps, Base):
    __tablename__ = "profile_versions"
    __table_args__ = (
        sa.UniqueConstraint("source_id", "version", name="uq_profile_source_version"),
        sa.UniqueConstraint(
            "source_id", "id", "config_hash", name="uq_profile_job_pin"
        ),
        sa.ForeignKeyConstraint(
            ["id", "validation_report_id", "config_hash"],
            [
                "profile_validation_reports.profile_version_id",
                "profile_validation_reports.id",
                "profile_validation_reports.config_hash",
            ],
            name="fk_profile_approved_report",
            use_alter=True,
        ),
        sa.CheckConstraint("version > 0 AND revision > 0", name="ck_profile_version"),
        sa.CheckConstraint(
            "(approval_status = 'draft' AND approved_by IS NULL AND approved_at IS NULL "
            "AND validation_report_id IS NULL) OR "
            "(approval_status IN ('approved', 'retired') AND approved_by IS NOT NULL "
            "AND approved_at IS NOT NULL AND validation_report_id IS NOT NULL)",
            name="ck_profile_approval",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    source_id: Mapped[UUID] = mapped_column(sa.ForeignKey("sources.id"))
    version: Mapped[int]
    revision: Mapped[int] = mapped_column(server_default="1")
    configuration: Mapped[dict] = mapped_column(JSONB)
    config_hash: Mapped[str] = mapped_column(sa.String(64))
    approval_status: Mapped[str] = mapped_column(sa.String(8))
    approved_by: Mapped[str | None] = mapped_column(sa.String(128))
    approved_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    validation_report_id: Mapped[UUID | None]


class ValidationRow(Base):
    __tablename__ = "profile_validation_reports"
    __table_args__ = (
        sa.UniqueConstraint(
            "profile_version_id", "id", "config_hash", name="uq_validation_snapshot"
        ),
        sa.Index("ix_validation_latest", "profile_version_id", "revision", "sequence"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    profile_version_id: Mapped[UUID] = mapped_column(
        sa.ForeignKey("profile_versions.id")
    )
    revision: Mapped[int]
    config_hash: Mapped[str] = mapped_column(sa.String(64))
    sequence: Mapped[int] = mapped_column(sa.BigInteger, sa.Identity())
    validated_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    result: Mapped[dict] = mapped_column(JSONB)


class JobRow(Base):
    __tablename__ = "collection_jobs"
    __table_args__ = (
        sa.ForeignKeyConstraint(
            ["source_id", "profile_version_id", "config_hash"],
            [
                "profile_versions.source_id",
                "profile_versions.id",
                "profile_versions.config_hash",
            ],
            name="fk_job_profile_pin",
        ),
        sa.UniqueConstraint("source_id", "request_key", name="uq_job_request"),
        sa.CheckConstraint(
            "(status = 'pending' AND started_at IS NULL AND finished_at IS NULL AND input_payload IS NOT NULL) OR "
            "(status = 'running' AND started_at IS NOT NULL AND finished_at IS NULL AND input_payload IS NOT NULL) OR "
            "(status IN ('succeeded', 'partial', 'failed') AND started_at IS NOT NULL "
            "AND finished_at IS NOT NULL AND input_payload IS NULL)",
            name="ck_job_state",
        ),
        sa.CheckConstraint(
            "valid_count >= 0 AND invalid_count >= 0 AND duplicate_count >= 0",
            name="ck_job_counts",
        ),
        sa.Index("ix_job_status_created", "status", "created_at", "id"),
        sa.Index("ix_job_created", "created_at", "id"),
        sa.CheckConstraint(
            "execution_attempt >= 0 AND dispatch_attempts >= 0 AND "
            "((status = 'running' AND execution_attempt > 0 AND lease_expires_at IS NOT NULL) OR "
            "(status <> 'running' AND lease_expires_at IS NULL)) AND "
            "((status = 'pending') = (dispatch_due_at IS NOT NULL)) AND "
            "(next_attempt_at IS NULL OR (status = 'pending' AND execution_attempt > 0))",
            name="ck_job_attempt",
        ),
        sa.Index(
            "ix_job_dispatch_due",
            "dispatch_due_at",
            "id",
            postgresql_where=sa.text("status = 'pending'"),
        ),
        sa.Index(
            "ix_job_lease_due",
            "lease_expires_at",
            "id",
            postgresql_where=sa.text("status = 'running'"),
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    source_id: Mapped[UUID]
    profile_version_id: Mapped[UUID]
    config_hash: Mapped[str] = mapped_column(sa.String(64))
    request_key: Mapped[UUID | None]
    input_hash: Mapped[str] = mapped_column(sa.String(64))
    input_payload: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    status: Mapped[str] = mapped_column(sa.String(9), server_default="pending")
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )
    started_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    execution_attempt: Mapped[int] = mapped_column(server_default="0")
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True)
    )
    dispatch_due_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    next_attempt_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    last_dispatched_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True)
    )
    dispatch_attempts: Mapped[int] = mapped_column(server_default="0")
    dispatch_error_code: Mapped[str | None] = mapped_column(sa.String(64))
    valid_count: Mapped[int] = mapped_column(server_default="0")
    invalid_count: Mapped[int] = mapped_column(server_default="0")
    duplicate_count: Mapped[int] = mapped_column(server_default="0")
    error: Mapped[dict | None] = mapped_column(JSONB)


class EventRow(Base):
    __tablename__ = "execution_events"
    __table_args__ = (
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'succeeded', 'partial', 'failed')",
            name="ck_event_status",
        ),
        sa.UniqueConstraint("job_id", "sequence", name="uq_event_job_sequence"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    job_id: Mapped[UUID] = mapped_column(sa.ForeignKey("collection_jobs.id"))
    sequence: Mapped[int] = mapped_column(sa.BigInteger, sa.Identity())
    status: Mapped[str] = mapped_column(sa.String(9))
    kind: Mapped[str | None] = mapped_column(sa.String(32))
    execution_attempt: Mapped[int | None]
    worker_instance_id: Mapped[UUID | None]
    execution_origin: Mapped[str | None] = mapped_column(sa.String(6))
    occurred_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )
    error: Mapped[dict | None] = mapped_column(JSONB)


class EvidenceRow(Base):
    __tablename__ = "raw_evidence"
    __mapper_args__ = {"eager_defaults": False}
    __table_args__ = (
        sa.UniqueConstraint("job_id", "page_number", name="uq_evidence_job_page"),
        sa.UniqueConstraint("job_id", "id", name="uq_evidence_job_id"),
        sa.CheckConstraint("page_number > 0", name="ck_evidence_page_number"),
        sa.CheckConstraint(
            "capture_kind IN ('input', 'search', 'detail')",
            name="ck_evidence_capture_kind",
        ),
        sa.CheckConstraint(
            "adapter_type IN ('web', 'csv')", name="ck_evidence_adapter"
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    job_id: Mapped[UUID] = mapped_column(sa.ForeignKey("collection_jobs.id"))
    run_id: Mapped[UUID]
    page_number: Mapped[int] = mapped_column(server_default="1")
    capture_kind: Mapped[str] = mapped_column(server_default="input")
    rendered_dom: Mapped[dict | None] = mapped_column(
        JSONB(none_as_null=True), deferred=True, server_default=sa.FetchedValue()
    )
    storage_reference: Mapped[str] = mapped_column(sa.String(42))
    captured_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    content_type: Mapped[str | None] = mapped_column(sa.Text)
    content_hash: Mapped[str] = mapped_column(sa.String(64))
    adapter_type: Mapped[str] = mapped_column(sa.String(3))
    original_location: Mapped[str] = mapped_column(sa.Text)
    requested_location: Mapped[str | None] = mapped_column(sa.Text)
    http_status: Mapped[int | None]


class EvidenceResult:
    id: Mapped[UUID] = mapped_column(primary_key=True)
    job_id: Mapped[UUID]
    evidence_id: Mapped[UUID]
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )


class RecordRow(EvidenceResult, Base):
    __tablename__ = "generic_records"
    __table_args__ = (
        sa.ForeignKeyConstraint(
            ["job_id", "evidence_id"],
            ["raw_evidence.job_id", "raw_evidence.id"],
            name="fk_record_job_evidence",
        ),
        sa.UniqueConstraint("job_id", "deduplication_key", name="uq_record_job_dedup"),
        sa.CheckConstraint(
            "validation_status = 'passed'", name="ck_record_validation_status"
        ),
        sa.Index("ix_record_created", "created_at", "id"),
        sa.Index("ix_record_job_created", "job_id", "created_at", "id"),
    )

    record_type: Mapped[str] = mapped_column(sa.String(128))
    schema_version: Mapped[str] = mapped_column(sa.String(16))
    source_record_key: Mapped[str | None] = mapped_column(sa.Text)
    deduplication_key: Mapped[str] = mapped_column(sa.String(64))
    validation_status: Mapped[str] = mapped_column(sa.String(6))
    payload: Mapped[dict] = mapped_column(JSONB)
    source_position: Mapped[dict] = mapped_column(JSONB)


class QuarantineRow(EvidenceResult, Base):
    __tablename__ = "quarantined_records"
    __table_args__ = (
        sa.ForeignKeyConstraint(
            ["job_id", "evidence_id"],
            ["raw_evidence.job_id", "raw_evidence.id"],
            name="fk_quarantine_job_evidence",
        ),
        sa.UniqueConstraint(
            "job_id",
            "evidence_id",
            "position_kind",
            "position_index",
            name="uq_quarantine_evidence_position",
        ),
        sa.CheckConstraint(
            "position_kind IN ('html_item', 'csv_row') AND position_index > 0",
            name="ck_quarantine_position",
        ),
    )

    position_kind: Mapped[str] = mapped_column(sa.String(9))
    position_index: Mapped[int]
    problems: Mapped[list] = mapped_column(JSONB)
