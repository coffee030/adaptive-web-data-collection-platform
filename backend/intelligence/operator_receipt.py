"""Read the latest successful Core receipt and current customer publication state."""

from fastapi import Request
from sqlalchemy import select

from backend.persistence.models import JobRow, SourceRow

from .public_feed import DirectoryRow


def receipt(job):
    if job is None:
        return None
    return {
        "job_id": job.id,
        "finished_at": job.finished_at,
        "state": job.status,
        "accepted": job.valid_count,
        "invalid": job.invalid_count,
        "duplicates": job.duplicate_count,
    }


def publication_status(request: Request, feed_id: int, read_snapshot):
    sessions = request.app.state.sessions
    with sessions() as session:
        feed = session.get(DirectoryRow, feed_id)
        if not feed:
            return {"state": "unconfigured", "publication": "unavailable"}
        source = session.get(SourceRow, feed.source_id)
        pending = session.get(JobRow, feed.pending) if feed.pending else None
        jobs = (
            select(JobRow)
            .where(
                JobRow.source_id == feed.source_id,
                JobRow.profile_version_id == feed.profile_id,
                JobRow.finished_at.is_not(None),
            )
            .order_by(JobRow.finished_at.desc(), JobRow.id.desc())
        )
        latest = session.scalar(jobs.limit(1))
        success = session.scalar(
            jobs.where(JobRow.status == "succeeded", JobRow.invalid_count == 0).limit(1)
        )
        status = {
            "state": source.approval_status,
            "next_check": feed.next_attempt,
            "error": feed.error,
            "collection": pending.status if pending else None,
            "last_success": receipt(success),
            "last_attempt": receipt(latest),
        }
    visible = read_snapshot(sessions)
    status.update(
        publication=visible.state,
        observed=visible.observed,
        expires=visible.expires,
        visible_count=len(visible.profiles if feed_id == 1 else visible.contributors),
    )
    return status
