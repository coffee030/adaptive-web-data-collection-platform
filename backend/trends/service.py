from datetime import UTC, date, datetime, time, timedelta
from hashlib import sha256
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from sqlalchemy import func, select

from backend.application.jobs import TERMINAL, database_now, stage_job
from backend.core.contracts import Source
from backend.core.profiles import ProfileError
from backend.persistence.models import JobRow, ProfileRow, RecordRow, SourceRow

from . import wikimedia
from .models import WikiBatch, WikiProvider, WikiWatch

SOURCE_KEY = uuid5(
    NAMESPACE_URL, "https://wikimedia.org/aqs/core/daily-article-pageviews/v1"
)
RETRY = timedelta(hours=1)
SPACING = timedelta(milliseconds=1150)
EXPECTED_DELAY_DAYS = 2
RECHECK_DAYS = 3


class TrendError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code


def provider(session, *, lock=False, skip=False):
    return session.get(
        WikiProvider, 1, with_for_update={"skip_locked": skip} if lock else None
    )


def approved(session, row, *, lock=False):
    if not row.source_id or not row.profile_id:
        return False
    source = session.get(SourceRow, row.source_id, with_for_update=lock)
    profile = session.get(ProfileRow, row.profile_id, with_for_update=lock)
    return bool(
        source
        and profile
        and source.approval_status == "approved"
        and source.request_key == SOURCE_KEY
        and source.permission_reference == wikimedia.POLICY
        and profile.approval_status == "approved"
        and profile.source_id == source.id
        and profile.config_hash == wikimedia.MAPPING.config_hash()
    )


def outcome(row):
    return {
        "id": row.id,
        "project": row.project,
        "article": row.article,
        "topic": row.topic,
        "active": row.active,
        "start_day": row.start_day,
        "next_day": row.next_day,
        "due_at": row.due_at,
        "last_capture_at": row.last_capture_at,
        "last_error": row.last_error,
        "last_job": row.last_job,
        "pending_job": row.pending_job,
    }


def provider_status(session, row):
    return {
        "configured": bool(row.source_id),
        "source_id": row.source_id,
        "profile_id": row.profile_id,
        "authorized": approved(session, row),
        "blocked": row.blocked,
        "last_error": row.last_error,
        "next_request_at": row.next_request_at,
        "metric": wikimedia.METRIC,
        "value_unit": "pageviews",
        "project_basis": "Wikipedia language edition",
        "reader_geography": None,
        "policy": wikimedia.POLICY,
        "data_license": wikimedia.LICENSE,
    }


def request_provider(session, row, now, fetch):
    if row.blocked:
        raise TrendError(
            403, "publisher_access_blocked", "Review the publisher's access decision."
        )
    if row.next_request_at and row.next_request_at > now:
        status = 429 if row.last_error == "publisher_rate_limited" else 503
        raise TrendError(
            status,
            "publisher_wait",
            f"Next allowed provider request: {row.next_request_at.isoformat()}.",
        )
    try:
        data = fetch()
    except wikimedia.ProviderError as error:
        row.last_error = error.code
        row.blocked = error.retry is None
        if not row.blocked:
            row.next_request_at = database_now(session) + error.retry
        return None
    row.next_request_at = database_now(session) + SPACING
    row.last_error = None
    return data


def failed_provider(row):
    status = (
        403
        if row.blocked
        else 429
        if row.last_error == "publisher_rate_limited"
        else 503
    )
    return TrendError(
        status,
        row.last_error,
        "The publisher did not provide eligible data. See provider status.",
    )


def discovery(sessions, query):
    with sessions.begin() as session:
        row = provider(session, lock=True)
        if row.source_id and not approved(session, row):
            raise TrendError(
                403,
                "source_not_approved",
                "The configured Wikimedia source has been disabled.",
            )
        data = request_provider(
            session,
            row,
            database_now(session),
            lambda: wikimedia.discover(query.project, query.day, query.limit),
        )
        error = failed_provider(row) if data is None else None
    if error:
        raise error
    return {
        "source": "Wikimedia Analytics API",
        "reader_geography": None,
        "data_license": wikimedia.LICENSE,
        **data,
    }


def setup(sessions, profiles, evidence, body):
    with sessions.begin() as session:
        row = provider(session, lock=True)
        if approved(session, row):
            return provider_status(session, row)
        if (
            row.source_id
            and session.get(SourceRow, row.source_id).approval_status != "approved"
        ):
            raise TrendError(
                403,
                "source_not_approved",
                "Restore the source through the Core approval workflow.",
            )
        if row.source_id:
            replacement = next(
                (
                    version
                    for version, _ in reversed(profiles.list_versions(row.source_id))
                    if version.config_hash == wikimedia.MAPPING.config_hash()
                    and version.approval_status == "approved"
                ),
                None,
            )
            if replacement:
                row.profile_id = UUID(replacement.profile_version_id)
                return provider_status(session, row)
        captured = request_provider(
            session,
            row,
            database_now(session),
            lambda: wikimedia.capture(body.project, body.article, body.day, body.day),
        )
        if captured is None:
            error = failed_provider(row)
        elif not captured[2]:
            error = TrendError(
                409,
                "no_data_from_publisher",
                "Choose a published sample from discovery.",
            )
        else:
            error = None
            sample = wikimedia.entry(body.project, body.article, *captured)
            source, _ = profiles.register_source_once(
                Source(
                    source_id=uuid4().hex,
                    source_name="Wikimedia Analytics API · Wikipedia pageviews",
                    adapter_type="csv",
                    permission_reference=wikimedia.POLICY,
                    approval_status="approved",
                    allowed_datasets=(wikimedia.DATASET,),
                ),
                SOURCE_KEY,
            )
            row.source_id = UUID(source.source_id)
            if source.approval_status == "approved":
                version = next(
                    (
                        p
                        for p, _ in profiles.list_versions(row.source_id)
                        if p.config_hash == wikimedia.MAPPING.config_hash()
                        and p.approval_status != "retired"
                    ),
                    None,
                )
                if version is None:
                    version = profiles.create_draft(row.source_id, wikimedia.MAPPING)
                row.profile_id = UUID(version.profile_version_id)
                if version.approval_status == "draft":
                    report = profiles.validate(
                        row.source_id,
                        row.profile_id,
                        sample.collection_input(),
                        evidence,
                    )
                    if not report.passed:
                        raise ProfileError(
                            "validation_failed",
                            "The Wikimedia mapping failed Core validation",
                        )
                    profiles.approve(
                        row.source_id,
                        row.profile_id,
                        approver=body.approver,
                        report_id=UUID(report.report_id),
                        config_hash=version.config_hash,
                    )
            result = provider_status(session, row)
    if error:
        raise error
    return result


def add_watch(sessions, body):
    with sessions.begin() as session:
        state = provider(session, lock=True)
        if not approved(session, state):
            raise TrendError(
                403,
                "source_not_approved",
                "Approve the Wikimedia source before saving a series.",
            )
        existing = session.scalar(
            select(WikiWatch).where(
                WikiWatch.project == body.project, WikiWatch.article == body.article
            )
        )
        if existing:
            if existing.topic != body.topic:
                raise TrendError(
                    409,
                    "series_already_exists",
                    "This article already has a saved series in another topic.",
                )
            return outcome(existing)
        if session.scalar(select(func.count()).select_from(WikiWatch)) >= 32:
            raise TrendError(
                409,
                "series_limit",
                "This installation has reached its 32-series limit.",
            )
        watch = WikiWatch(
            id=uuid4(),
            project=body.project,
            article=body.article,
            topic=body.topic,
            start_day=body.day,
            next_day=body.day,
            due_at=database_now(session),
            active=True,
        )
        session.add(watch)
        return outcome(watch)


def set_active(sessions, watch_id, body):
    with sessions.begin() as session:
        watch = session.get(WikiWatch, watch_id, with_for_update=True)
        if watch is None:
            raise TrendError(
                404, "series_not_found", "The selected series is unavailable."
            )
        now = database_now(session)
        if body.backfill_from:
            if watch.pending_job:
                raise TrendError(
                    409,
                    "series_busy",
                    "Wait for the current Core job before requesting backfill.",
                )
            if (
                not max(watch.start_day, now.date() - timedelta(days=90))
                <= body.backfill_from
                <= watch.next_day
            ):
                raise TrendError(
                    422,
                    "invalid_backfill_day",
                    "Choose a date in the saved history within the last 90 days.",
                )
            watch.next_day = body.backfill_from
            watch.due_at = now
        if watch.active != body.active:
            watch.active = body.active
            if body.active:
                watch.due_at = now
        return outcome(watch)


def advance(watch, next_day, observed, now, gaps):
    watch.next_day = next_day
    watch.last_capture_at = observed
    watch.last_error = "publisher_dates_missing" if gaps else None
    ready_day = next_day + timedelta(days=EXPECTED_DELAY_DAYS)
    watch.due_at = max(now, datetime.combine(ready_day, time(hour=3), UTC))


def published_batches(watch_ids, start, end):
    return (
        select(WikiBatch.watch_id, WikiBatch.observed_at, RecordRow, JobRow)
        .join(JobRow, JobRow.id == WikiBatch.job_id)
        .join(RecordRow, RecordRow.job_id == JobRow.id)
        .where(
            WikiBatch.watch_id.in_(watch_ids),
            WikiBatch.start_day <= end,
            WikiBatch.next_day > start,
            JobRow.status == "succeeded",
            JobRow.invalid_count == 0,
            JobRow.duplicate_count == 0,
            JobRow.valid_count == WikiBatch.row_count,
        )
        .order_by(WikiBatch.observed_at, JobRow.id, RecordRow.id)
    )


def complete(session, watch, now):
    job = session.get(JobRow, watch.pending_job)
    if job.status not in TERMINAL:
        return
    batch = session.get(WikiBatch, job.id)
    count = batch.row_count
    if (
        job.status == "succeeded"
        and job.valid_count == count
        and not job.invalid_count
        and not job.duplicate_count
    ):
        advance(watch, batch.next_day, batch.observed_at, now, batch.gap_count)
    else:
        watch.last_error = "core_collection_failed"
        watch.due_at = now + RETRY
    watch.last_job = job.id
    watch.pending_job = None


def poll(sessions):
    with sessions.begin() as session:
        state = provider(session, lock=True, skip=True)
        if state is None or not approved(session, state):
            return
        now = database_now(session)
        for watch in session.scalars(
            select(WikiWatch)
            .where(WikiWatch.pending_job.is_not(None))
            .with_for_update()
        ):
            complete(session, watch, now)
        if state.blocked or state.next_request_at and state.next_request_at > now:
            return
        until = now.date() - timedelta(days=EXPECTED_DELAY_DAYS)
        watch = session.scalar(
            select(WikiWatch)
            .where(
                WikiWatch.active.is_(True),
                WikiWatch.pending_job.is_(None),
                WikiWatch.due_at <= now,
                WikiWatch.next_day <= until,
            )
            .order_by(WikiWatch.due_at, WikiWatch.id)
            .limit(1)
            .with_for_update()
        )
        if watch is None:
            return
        start = max(watch.start_day, watch.next_day - timedelta(days=RECHECK_DAYS))
        end = min(until, watch.next_day + timedelta(days=13))
        result = request_provider(
            session,
            state,
            now,
            lambda: wikimedia.capture(watch.project, watch.article, start, end),
        )
        if result is None:
            watch.last_error = state.last_error
            watch.due_at = state.next_request_at or now + RETRY
            if state.last_error == "no_data_from_publisher" and start < end:
                advance(watch, end + timedelta(days=1), now, now, True)
                state.next_request_at = database_now(session) + SPACING
            return
        if not approved(session, state, lock=True):
            return
        url, raw, values = result
        captured = database_now(session)
        next_day = end + timedelta(days=1)
        known = {
            date.fromisoformat(record.payload["day_utc"]): record.payload["views"]
            for _, _, record, _ in session.execute(
                published_batches([watch.id], start, end)
            )
        }
        changes = {
            day: count for day, count in values.items() if known.get(day) != count
        }
        gaps = (next_day - start).days - len(values)
        if not changes:
            advance(watch, next_day, captured, now, gaps)
            return
        entry = wikimedia.entry(watch.project, watch.article, url, raw, changes)
        job = stage_job(
            session,
            state.source_id,
            state.profile_id,
            wikimedia.MAPPING.config_hash(),
            entry,
        )
        session.add(
            WikiBatch(
                job_id=job.id,
                watch_id=watch.id,
                start_day=start,
                next_day=next_day,
                row_count=len(changes),
                gap_count=gaps,
                observed_at=captured,
                response_sha256=sha256(raw).hexdigest(),
                response=raw,
            )
        )
        watch.pending_job = job.id
        watch.last_error = None


def compare(sessions, keys, start, end):
    with sessions() as session:
        state = provider(session)
        if not approved(session, state):
            raise TrendError(
                403,
                "source_not_approved",
                "Published series are unavailable while the source is unapproved.",
            )
        watches = {
            w.id: w
            for w in session.scalars(select(WikiWatch).where(WikiWatch.id.in_(keys)))
        }
        if set(keys) - watches.keys():
            raise TrendError(
                404, "series_not_found", "A selected series is unavailable."
            )
        batches = session.execute(published_batches(keys, start, end))
        points = {key: {} for key in keys}
        for watch_id, observed, record, job in batches:
            day = record.payload["day_utc"]
            if start.isoformat() <= day <= end.isoformat():
                points[watch_id][day] = {
                    **record.payload,
                    "capture_at": observed,
                    "job_id": job.id,
                    "record_id": record.id,
                    "evidence_id": record.evidence_id,
                }
        grid = [
            (start + timedelta(days=offset)).isoformat()
            for offset in range((end - start).days + 1)
        ]
        return {
            "metric": wikimedia.METRIC,
            "reader_geography": None,
            "data_license": wikimedia.LICENSE,
            "source_policy": wikimedia.POLICY,
            "access": "all-access",
            "agent": "user",
            "day_basis": "UTC",
            "days": grid,
            "series": [
                {
                    **outcome(watches[key]),
                    "points": [points[key].get(day) for day in grid],
                    "coverage": coverage(points[key], grid),
                }
                for key in keys
            ],
        }


def coverage(points, grid):
    observed = sum(day in points for day in grid)
    first = points[grid[0]]["views"] if grid[0] in points else None
    last = points[grid[-1]]["views"] if grid[-1] in points else None
    complete = len(grid) > 1 and observed == len(grid)
    return {
        "observed_days": observed,
        "requested_days": len(grid),
        "baseline_views": first,
        "latest_views": last,
        "change_views": last - first if complete else None,
        "change_percent": 100 * (last - first) / first if complete and first else None,
    }
