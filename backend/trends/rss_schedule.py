from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import select

from backend.application.jobs import TERMINAL, database_now, stage_job
from backend.core.contracts import Source
from backend.core.profiles import ProfileError
from backend.persistence.models import JobRow, ProfileRow, RecordRow, SourceRow

from . import google_rss as rss
from .rss_models import RssBatch, RssEvent, RssProvider, RssSchedule
from .service import TrendError

CLAIM_LEASE = timedelta(minutes=2)
CORE_RETRY = timedelta(minutes=10)


@dataclass(frozen=True)
class Claim:
    region: str
    id: UUID
    source_id: UUID
    profile_id: UUID


def provider(session, *, lock=False, skip=False):
    return session.get(
        RssProvider, 1, with_for_update={"skip_locked": skip} if lock else None
    )


def authorized(session, state, *, lock=False):
    if not state.source_id or not state.profile_id:
        return False
    source = session.get(SourceRow, state.source_id, with_for_update=lock)
    profile = session.get(ProfileRow, state.profile_id, with_for_update=lock)
    return bool(
        source
        and source.request_key == rss.SOURCE_KEY
        and source.permission_reference == rss.POLICY
        and source.approval_status == "approved"
        and profile
        and profile.source_id == source.id
        and profile.approval_status == "approved"
        and profile.config_hash == rss.MAPPING.config_hash()
    )


def provider_status(session, state):
    source = (
        session.get(SourceRow, state.source_id)
        if state.source_id
        else session.scalar(
            select(SourceRow).where(SourceRow.request_key == rss.SOURCE_KEY)
        )
    )
    return {
        "authorized": authorized(session, state),
        "source_id": source.id if source else None,
        "source_approval_status": source.approval_status if source else None,
        "profile_id": state.profile_id,
        "policy": rss.POLICY,
        "blocked": state.blocked,
        "retry_at": state.retry_at,
        "last_error": state.last_error,
    }


def require_source(session, state):
    if not authorized(session, state):
        raise TrendError(
            403, "source_not_approved", "Approve the Google RSS source in Core."
        )


def require_publisher(state):
    if state.blocked:
        raise TrendError(
            403,
            "publisher_access_blocked",
            "Review the publisher refusal before attempting another acquisition.",
        )


def failure(state, error, now):
    state.last_error = error.code
    if error.retry is None:
        state.blocked = True
        state.retry_at = None
    elif error.code in {
        "publisher_rate_limited",
        "origin_rate_busy",
        "publisher_unavailable",
    }:
        state.retry_at = max(state.retry_at or now, now + error.retry)


def setup(sessions, profiles, evidence, region, approver):
    with sessions.begin() as session:
        state = provider(session, lock=True)
        if authorized(session, state):
            return provider_status(session, state)
        source = session.scalar(
            select(SourceRow).where(SourceRow.request_key == rss.SOURCE_KEY)
        )
        if source and source.approval_status != "approved":
            raise TrendError(
                403,
                "source_not_approved",
                "Restore the existing source through Core Sources.",
            )
        mapping = rss.MAPPING
        versions = (
            [
                version
                for version, _ in profiles.list_versions(source.id)
                if version.config_hash == mapping.config_hash()
            ]
            if source
            else []
        )
        approved_profile = next(
            (
                version
                for version in reversed(versions)
                if version.approval_status == "approved"
            ),
            None,
        )
        if approved_profile:
            state.source_id = source.id
            state.profile_id = UUID(approved_profile.profile_version_id)
            return provider_status(session, state)
        require_publisher(state)
        now = database_now(session)
        if state.retry_at and state.retry_at > now:
            raise TrendError(
                429,
                "publisher_wait",
                f"Publisher retry after {state.retry_at.isoformat()}.",
            )
        try:
            sample = rss.entry(rss.capture(region))
        except rss.ProviderError as error:
            failure(state, error, database_now(session))
            status = (
                403
                if state.blocked
                else 429
                if error.code == "publisher_rate_limited"
                else 503
            )
            rejected = TrendError(
                status, error.code, "A valid Google RSS sample was unavailable."
            )
        else:
            rejected = None
            if source is None:
                registered, _ = profiles.register_source_once(
                    Source(
                        source_id=uuid4().hex,
                        source_name=rss.ATTRIBUTION,
                        adapter_type="csv",
                        permission_reference=rss.POLICY,
                        approval_status="approved",
                        allowed_datasets=(rss.DATASET,),
                    ),
                    rss.SOURCE_KEY,
                )
                if registered.approval_status != "approved":
                    raise TrendError(
                        403,
                        "source_not_approved",
                        "Restore the existing source through Core Sources.",
                    )
                source_id = UUID(registered.source_id)
            else:
                source_id = source.id
            draft = next(
                (
                    version
                    for version in reversed(versions)
                    if version.approval_status == "draft"
                ),
                None,
            )
            if draft is None:
                draft = profiles.create_draft(source_id, mapping)
            profile_id = UUID(draft.profile_version_id)
            report = profiles.validate(
                source_id, profile_id, sample.collection_input(), evidence
            )
            if not report.passed:
                raise ProfileError(
                    "validation_failed",
                    "Google RSS sample did not pass Core validation",
                )
            profiles.approve(
                source_id,
                profile_id,
                approver=approver,
                report_id=UUID(report.report_id),
                config_hash=draft.config_hash,
            )
            state.source_id = source_id
            state.profile_id = profile_id
            state.last_error = None
            state.retry_at = None
            result = provider_status(session, state)
    if rejected:
        raise rejected
    return result


def outcome(row):
    return {
        "region": row.region,
        "active": row.active,
        "interval_minutes": row.interval_minutes,
        "due_at": row.due_at,
        "claimed_at": row.claimed_at,
        "last_error": row.last_error,
        "pending_job": row.pending_job,
        "last_job": row.last_job,
        "observed_at": row.snapshot["observed_at"] if row.snapshot else None,
    }


def require_schedule(session, region, *, lock=False):
    row = session.get(RssSchedule, region, with_for_update=lock)
    if not row:
        raise TrendError(
            404, "schedule_not_found", "No Google RSS schedule exists for this region."
        )
    return row


def add(sessions, region, interval_minutes):
    with sessions.begin() as session:
        state = provider(session, lock=True)
        require_source(session, state)
        row = session.get(RssSchedule, region)
        if row:
            if row.interval_minutes != interval_minutes:
                raise TrendError(
                    409,
                    "schedule_exists",
                    "A schedule already exists. Edit its interval.",
                )
            return outcome(row)
        require_publisher(state)
        row = RssSchedule(
            region=region,
            active=True,
            interval_minutes=interval_minutes,
            due_at=database_now(session),
        )
        session.add(row)
        return outcome(row)


def update(sessions, region, active, interval_minutes):
    with sessions.begin() as session:
        state = provider(session, lock=True)
        row = require_schedule(session, region, lock=True)
        now = database_now(session)
        if interval_minutes is not None and interval_minutes != row.interval_minutes:
            row.interval_minutes = interval_minutes
            if row.active and not row.claim_id and not row.pending_job:
                row.due_at = now + timedelta(minutes=interval_minutes)
        if active is not None and active != row.active:
            if active:
                require_source(session, state)
                require_publisher(state)
                row.due_at = now
            row.active = active
            row.claim_id = row.claimed_at = None
        return outcome(row)


def complete(row, now, observed_at, digest, event_ids):
    row.snapshot = {
        "observed_at": observed_at.isoformat(),
        "response_sha256": digest,
        "event_ids": event_ids,
    }
    row.last_error = None
    row.due_at = now + timedelta(minutes=row.interval_minutes)


def latest_events(session, region, ids):
    statement = select(RssEvent).where(
        RssEvent.region == region, RssEvent.event_id.in_(ids)
    )
    return {event.event_id: event for event in session.scalars(statement)}


def settle(session, state, row, now):
    job = session.get(JobRow, row.pending_job)
    if job.status not in TERMINAL:
        return
    row.pending_job = None
    row.last_error = "core_collection_failed"
    row.due_at = now + CORE_RETRY
    batch = session.get(RssBatch, job.id)
    if (
        job.status != "succeeded"
        or job.invalid_count
        or job.duplicate_count
        or job.source_id != state.source_id
        or job.profile_version_id != state.profile_id
        or job.valid_count != batch.expected_count
    ):
        return
    records = list(session.scalars(select(RecordRow).where(RecordRow.job_id == job.id)))
    new_events = {record.payload["event_id"]: record for record in records}
    events = latest_events(session, row.region, batch.event_ids)
    if len(new_events) != batch.expected_count or set(batch.event_ids) != set(
        events
    ) | set(new_events):
        return
    for key, record in new_events.items():
        event = events.get(key)
        if not event:
            event = RssEvent(region=row.region, event_id=key)
            session.add(event)
        event.record_id = record.id
        event.traffic_bucket = record.payload.get("traffic_bucket")
    batch.published_at = now
    row.last_job = job.id
    complete(row, now, batch.observed_at, batch.response_sha256, batch.event_ids)


def claim_next(sessions):
    with sessions.begin() as session:
        state = provider(session, lock=True, skip=True)
        if state is None or not authorized(session, state, lock=True):
            return None
        now = database_now(session)
        for row in session.scalars(
            select(RssSchedule)
            .where(RssSchedule.pending_job.is_not(None))
            .with_for_update()
        ):
            settle(session, state, row, now)
        if state.blocked or state.retry_at and state.retry_at > now:
            return None
        if session.scalar(
            select(RssSchedule.region)
            .where(RssSchedule.claimed_at > now - CLAIM_LEASE)
            .limit(1)
        ):
            return None
        row = session.scalar(
            select(RssSchedule)
            .where(
                RssSchedule.active,
                RssSchedule.pending_job.is_(None),
                RssSchedule.due_at <= now,
            )
            .order_by(RssSchedule.due_at, RssSchedule.region)
            .limit(1)
            .with_for_update()
        )
        if row is None:
            return None
        row.claim_id, row.claimed_at = uuid4(), now
        return Claim(row.region, row.claim_id, state.source_id, state.profile_id)


def record_result(sessions, claim, snapshot=None, rows=None, error=None):
    with sessions.begin() as session:
        state = provider(session, lock=True)
        row = require_schedule(session, claim.region, lock=True)
        now = database_now(session)
        if error and error.retry is None:
            failure(state, error, now)
        if row.claim_id != claim.id:
            return
        expired = row.claimed_at + CLAIM_LEASE <= now
        row.claim_id = row.claimed_at = None
        if expired:
            return
        if not authorized(session, state, lock=True) or (
            state.source_id,
            state.profile_id,
        ) != (claim.source_id, claim.profile_id):
            return
        if error:
            failure(state, error, now)
            row.last_error = error.code
            row.due_at = now + (error.retry or timedelta(minutes=row.interval_minutes))
            return
        if state.blocked:
            return
        observed = datetime.fromisoformat(snapshot["observed_at"])
        if row.snapshot and observed <= datetime.fromisoformat(
            row.snapshot["observed_at"]
        ):
            row.last_error = "capture_not_newer"
            row.due_at = now + CORE_RETRY
            return
        ids = [record["event_id"] for record in rows]
        previous = latest_events(session, row.region, ids)
        changes = [
            r
            for r in rows
            if r["event_id"] not in previous
            or previous[r["event_id"]].traffic_bucket != r["traffic_bucket"]
        ]
        state.last_error = None
        state.retry_at = None
        digest = snapshot["body_sha256"]
        if not changes:
            complete(row, now, observed, digest, ids)
            return
        job = stage_job(
            session,
            claim.source_id,
            claim.profile_id,
            rss.MAPPING.config_hash(),
            rss.entries(changes),
            request_key=claim.id,
        )
        session.add(
            RssBatch(
                job_id=job.id,
                region=row.region,
                event_ids=ids,
                observed_at=observed,
                response_sha256=digest,
                expected_count=len(changes),
            )
        )
        row.pending_job = job.id
        row.last_error = None


def poll(sessions):
    claim = claim_next(sessions)
    if not claim:
        return
    try:
        snapshot = rss.capture(claim.region)
        if snapshot.get("market") != claim.region:
            raise rss.ProviderError("publisher_invalid_response")
        rows = rss.observations(snapshot)
    except rss.ProviderError as error:
        record_result(sessions, claim, error=error)
    else:
        record_result(sessions, claim, snapshot=snapshot, rows=rows)


def latest_snapshot(sessions, region):
    with sessions.begin() as session:
        state = session.get(RssProvider, 1, with_for_update={"read": True})
        require_source(session, state)
        row = require_schedule(session, region)
        if not row.snapshot:
            return {
                "region": region,
                "observed_at": None,
                "source_url": None,
                "response_sha256": None,
                "events": [],
            }
        ids = row.snapshot["event_ids"]
        found = session.execute(
            select(RssEvent.event_id, RecordRow)
            .join(RecordRow, RssEvent.record_id == RecordRow.id)
            .where(RssEvent.region == region, RssEvent.event_id.in_(ids))
        )
        events = {
            eid: dict(
                record.payload,
                record_id=record.id,
                job_id=record.job_id,
                evidence_id=record.evidence_id,
            )
            for eid, record in found
        }
        return {
            "region": region,
            "observed_at": row.snapshot["observed_at"],
            "source_url": rss.feed_url(region),
            "response_sha256": row.snapshot["response_sha256"],
            "events": [events[key] for key in ids],
        }
