"""Shared validation, scheduled refresh and expiry for approved public research feeds."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import DateTime, ForeignKey, Integer, String, select
from sqlalchemy.orm import Mapped, mapped_column
from backend.application.jobs import Jobs, database_now
from backend.core.contracts import CsvMappingConfiguration, Source
from backend.marketing.store import MarketingError
from backend.persistence.models import Base, JobRow, ProfileRow, RecordRow, SourceRow


@dataclass(frozen=True)
class PublicFeed:
    row_id: int
    dataset: str
    name: str
    license_url: str
    config: CsvMappingConfiguration
    fresh: timedelta
    acquire: Callable
    release_snapshot: Callable
    entry: Callable
    hold_during_refresh: bool = False

    @property
    def key(self):
        return uuid5(NAMESPACE_URL, self.dataset)


class DirectoryRow(Base):
    __tablename__ = "public_directory_feed"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[UUID] = mapped_column(ForeignKey("sources.id"))
    profile_id: Mapped[UUID] = mapped_column(ForeignKey("profile_versions.id"))
    pending: Mapped[UUID | None] = mapped_column(ForeignKey("collection_jobs.id"))
    published: Mapped[UUID | None] = mapped_column(ForeignKey("collection_jobs.id"))
    next_attempt: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(String(64))


def approved(session, feed, spec):
    return (
        feed is not None
        and feed.error not in ("directory_review_required", "directory_source_blocked")
        and session.get(SourceRow, feed.source_id).approval_status == "approved"
        and session.get(ProfileRow, feed.profile_id).approval_status == "approved"
        and session.get(ProfileRow, feed.profile_id).config_hash
        == spec.config.config_hash()
    )


def prepare(profiles, evidence, spec, *, restore=True):
    source, _ = profiles.register_source_once(
        Source(
            source_id=uuid4().hex,
            source_name=spec.name,
            adapter_type="csv",
            permission_reference=spec.license_url,
            approval_status="approved",
            allowed_datasets=(spec.dataset,),
        ),
        spec.key,
    )
    source_id = UUID(source.source_id)
    if source.approval_status != "approved":
        if not restore:
            raise MarketingError(409, "source_withdrawn", "The source was withdrawn")
        with profiles.sessions.begin() as session:
            previous = session.get(DirectoryRow, spec.row_id, with_for_update=True)
            if previous:
                previous.pending = previous.published = None
                previous.error = "directory_review_required"
        profiles.set_authorization(source_id, "approved")
    versions = profiles.list_versions(source_id)
    profile = next(
        (
            p
            for p, _ in reversed(versions)
            if p.config_hash == spec.config.config_hash()
            and p.approval_status != "retired"
        ),
        None,
    )
    if profile is None:
        profile = profiles.create_draft(source_id, spec.config)
    profile_id = UUID(profile.profile_version_id)
    observed, records = spec.release_snapshot()
    if not records:
        try:
            records, observed = spec.acquire(), datetime.now(UTC)
        except MarketingError as error:
            if error.code == "directory_source_blocked":
                profiles.set_authorization(source_id, "revoked")
            raise
    if not records:
        raise MarketingError(
            409, "directory_empty", "No eligible directory records to validate"
        )
    report = (
        profiles.validate(
            source_id,
            profile_id,
            spec.entry(records, observed).collection_input(),
            evidence,
        )
        if profile.approval_status == "draft"
        else None
    )
    if report and not report.passed:
        raise MarketingError(
            409,
            "directory_validation_failed",
            "The directory mapping failed validation",
        )
    return {
        "source_id": source_id,
        "profile_id": profile_id,
        "report_id": report.report_id if report else None,
        "count": len(records),
        "example": records[0],
        "observed": observed,
    }


def activate(sessions, profiles, source_id, profile_id, report_id, spec, *, approver):
    source = profiles.get_source(source_id)
    version = profiles.get_version(source_id, profile_id)
    with sessions() as session:
        registered = session.scalar(
            select(SourceRow.id).where(SourceRow.request_key == spec.key)
        )
    if (
        registered != source_id
        or source.permission_reference != spec.license_url
        or source.approval_status != "approved"
        or version.config_hash != spec.config.config_hash()
    ):
        raise MarketingError(
            409, "directory_source_mismatch", "Review the registered directory source"
        )
    if version.approval_status != "approved":
        if not report_id:
            raise MarketingError(
                409, "directory_validation_required", "Validate the mapping first"
            )
        profiles.approve(
            source_id,
            profile_id,
            approver=approver,
            report_id=report_id,
            config_hash=spec.config.config_hash(),
        )
    with sessions.begin() as session:
        row = session.get(DirectoryRow, spec.row_id, with_for_update=True)
        first = row is None
        if first:
            row = DirectoryRow(
                id=spec.row_id,
                source_id=source_id,
                profile_id=profile_id,
                next_attempt=database_now(session),
            )
            session.add(row)
        else:
            if row.error == "directory_source_blocked" or row.profile_id != profile_id:
                row.published = row.pending = None
            row.source_id, row.profile_id = source_id, profile_id
            row.error, row.next_attempt = None, database_now(session)
        observed, records = spec.release_snapshot()
        if first and records:
            job, _ = Jobs(sessions).create(
                source_id,
                profile_id,
                spec.entry(records, observed),
                uuid5(spec.key, f"{profile_id}/release/{observed.isoformat()}"),
            )
            row.pending = job.job_id


def refresh(sessions, spec):
    with sessions.begin() as session:
        feed = session.scalar(
            select(DirectoryRow)
            .where(DirectoryRow.id == spec.row_id)
            .with_for_update(skip_locked=True)
        )
        if not approved(session, feed, spec):
            return
        now = database_now(session)
        if feed.pending:
            job = session.get(JobRow, feed.pending)
            if job.status == "succeeded" and not job.invalid_count:
                feed.published, feed.error = feed.pending, None
            elif job.status in ("pending", "running"):
                return
            else:
                feed.error, feed.next_attempt = (
                    "directory_collection_failed",
                    now + timedelta(hours=1),
                )
            feed.pending = None
        if feed.next_attempt > now or feed.error == "directory_source_blocked":
            return
        try:
            records = spec.acquire()
        except MarketingError as error:
            feed.error = error.code
            if error.code == "directory_source_blocked":
                feed.published = None
            feed.next_attempt = now + timedelta(hours=1)
            return
        if records:
            request_key = uuid5(spec.key, f"{feed.profile_id}/{now.isoformat()}")
            job, _ = Jobs(sessions).create(
                feed.source_id, feed.profile_id, spec.entry(records, now), request_key
            )
            feed.pending = job.job_id
            if spec.hold_during_refresh:
                feed.published = None
        else:
            feed.pending = feed.published = None
        feed.error, feed.next_attempt = None, now + timedelta(days=1)


def records(sessions, spec):
    with sessions() as session:
        feed = session.get(DirectoryRow, spec.row_id)
        if (
            not approved(session, feed, spec)
            or feed.error == "directory_source_blocked"
        ):
            return "unavailable", None, None, []
        job = session.get(JobRow, feed.pending) if feed.pending else None
        if not job or job.status != "succeeded" or job.invalid_count:
            job = session.get(JobRow, feed.published) if feed.published else None
        if (
            not job
            or job.source_id != feed.source_id
            or job.profile_version_id != feed.profile_id
        ):
            return "unavailable", None, None, []

        rows = session.scalars(
            select(RecordRow).where(
                RecordRow.job_id == job.id, RecordRow.record_type == spec.dataset
            )
        )
        rows = list(rows)
        if not rows:
            return "unavailable", None, None, []
        observed = min(datetime.fromisoformat(row.payload["checked"]) for row in rows)
        expiry = observed + spec.fresh
        if expiry <= database_now(session):
            return "expired", None, expiry, []
        return "available", observed, expiry, rows
