"""Classify failures that may safely consume another execution attempt."""

from datetime import timedelta

from backend.core.contracts import CollectionError

MAX_RETRY_AFTER = 300
TRANSIENT = {
    "timeout",
    "transport_error",
    "database_unavailable",
    "origin_rate_unavailable",
}


def retry_delay(error: CollectionError, attempt: int) -> timedelta | None:
    if error.code == "origin_rate_busy":
        delay = max(10 * 2 ** (attempt - 1), error.retry_after_seconds or 0)
        return timedelta(seconds=delay) if delay <= MAX_RETRY_AFTER else None
    if error.code in TRANSIENT:
        return timedelta(seconds=10 * 2 ** (attempt - 1))
    if error.code not in {"rate_limited", "http_error", "robots_unavailable"}:
        return None
    status = error.http_status
    if status == 429:
        delay = 30
    elif status is not None and 500 <= status <= 599:
        delay = 10
    else:
        return None
    retry_after = error.retry_after_seconds or 0
    if retry_after > MAX_RETRY_AFTER:
        return None
    return timedelta(seconds=max(delay * 2 ** (attempt - 1), retry_after))
