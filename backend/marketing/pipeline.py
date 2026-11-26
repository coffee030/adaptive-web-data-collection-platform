"""Durable scheduling, bounded execution, and retention for YouTube research."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from uuid import UUID, uuid4

import httpx2
from kombu.exceptions import OperationalError as BrokerConnectionError
from redis.exceptions import RedisError
from sqlalchemy import Date, DateTime, cast, delete, func, select, update
from sqlalchemy.orm import Session

from backend.application.jobs import database_now

from .contracts import DISCOVERY_RETENTION, Lead, Post
from .models import AccountRow, LeadRow, PostRow, ProviderRow, RunRow
from .store import (
    ACTIVE,
    ResearchStore,
    clear_account,
    current_posts,
    lock_provider,
    new_run,
)
from .youtube import Endpoint, ProviderError, Refresh, YouTube

CLAIM_WINDOW = timedelta(seconds=90)
LEASE = timedelta(seconds=100)
MAX_ATTEMPTS = 3
STANDARD_LIMIT = 250
SEARCH_LIMIT = 10
RUN_RETENTION = timedelta(days=7)
PACIFIC = "America/Los_Angeles"


@dataclass(frozen=True)
class Claim:
    id: UUID
    token: UUID
    channel_id: str | None
    query: str | None
    previous: list[Post]


def _provider_day(session: Session) -> date:
    return session.scalar(select(func.timezone(PACIFIC, func.now()).cast(Date)))


def _next_reset(session: Session) -> datetime:
    tomorrow = _provider_day(session) + timedelta(days=1)
    midnight = datetime.combine(tomorrow, time.min)
    return session.scalar(select(func.timezone(PACIFIC, cast(midnight, DateTime()))))


def _mark_terminal(
    row: RunRow, now: datetime, status: str, error: str | None = None
) -> None:
    row.status = status
    row.error_code = error
    row.finished_at = now
    row.query = None
    row.claim = None
    row.lease_until = None


def _reschedule(row: RunRow, at: datetime, error: str) -> None:
    row.status = "queued"
    row.error_code = error
    row.available_after = at
    row.dispatch_at = at
    row.claim = None
    row.lease_until = None


class Pipeline(ResearchStore):
    def maintain(self, *, purge: bool = True) -> None:
        with self.sessions.begin() as session:
            state = lock_provider(session)
            now = database_now(session)
            if purge:
                self._purge(session, now)
            for row in session.scalars(select(RunRow).where(RunRow.status.in_(ACTIVE))):
                if not self.config.enabled or (
                    row.kind == "discovery" and not self.config.discovery
                ):
                    _mark_terminal(row, now, "failed", "research_disabled")
                elif (
                    row.kind == "discovery"
                    and row.created_at <= now - DISCOVERY_RETENTION
                ):
                    _mark_terminal(row, now, "failed", "discovery_request_expired")
                elif row.status == "running" and row.lease_until <= now:
                    if row.attempts < MAX_ATTEMPTS:
                        _reschedule(row, now, "worker_lost")
                    else:
                        self._finish_run(session, row, now, error="worker_lost")
            if self.config.enabled and not state.blocked:
                self._schedule(session, now)

    def _purge(self, session: Session, now: datetime) -> None:
        session.execute(delete(PostRow).where(PostRow.expires_at <= now))
        session.execute(delete(LeadRow).where(LeadRow.expires_at <= now))
        session.execute(
            update(PostRow)
            .where(
                cast(
                    PostRow.post["uploads_provenance"]["expires_at"].astext,
                    DateTime(timezone=True),
                )
                <= now
            )
            .values(post=PostRow.post.delete_path(["uploads_provenance"]))
        )
        session.execute(delete(RunRow).where(RunRow.finished_at <= now - RUN_RETENTION))
        expiring = select(AccountRow).where(AccountRow.snapshot.is_not(None))
        if self.config.enabled:
            expiring = expiring.where(AccountRow.expires_at <= now)
        for account in session.scalars(expiring):
            clear_account(session, account, "expired")
        if not self.config.enabled or not self.config.discovery:
            session.execute(delete(LeadRow))
            session.execute(
                update(RunRow)
                .where(RunRow.query_key.is_not(None))
                .values(query_key=None)
            )

    @staticmethod
    def _schedule(session: Session, now: datetime) -> None:
        active = (
            select(RunRow.channel_id)
            .where(
                RunRow.channel_id == AccountRow.channel_id, RunRow.status.in_(ACTIVE)
            )
            .exists()
        )
        accounts = session.scalars(
            select(AccountRow)
            .where(AccountRow.next_refresh_at <= now, ~active)
            .order_by(AccountRow.next_refresh_at, AccountRow.channel_id)
        )
        for account in accounts:
            session.add(new_run(now, channel_id=account.channel_id))

    def dispatch(self, publish: Callable[[UUID], None]) -> bool:
        if not self.config.enabled:
            return False
        with self.sessions.begin() as session:
            state = lock_provider(session)
            now = database_now(session)
            if state.blocked or (state.resume_at and state.resume_at > now):
                return False
            if session.scalar(
                select(RunRow.id)
                .where(
                    (RunRow.status == "running")
                    | (
                        (RunRow.status == "queued")
                        & (RunRow.available_after <= now)
                        & (RunRow.dispatch_at > now)
                    )
                )
                .limit(1)
            ):
                return False
            due = select(RunRow).where(
                RunRow.status == "queued", RunRow.dispatch_at <= now
            )
            if not self.config.discovery:
                due = due.where(RunRow.kind == "refresh")
            row = session.scalar(
                due.order_by(RunRow.dispatch_at, RunRow.created_at, RunRow.id).limit(1)
            )
            if row is None:
                return False
            try:
                publish(row.id)
            except (BrokerConnectionError, RedisError, OSError):
                row.error_code = "broker_unavailable"
                row.dispatch_at = now + timedelta(seconds=5)
                return False
            row.dispatch_at = now + CLAIM_WINDOW
            return True

    def claim(self, run_id: UUID) -> Claim | None:
        with self.sessions.begin() as session:
            state = lock_provider(session)
            now = database_now(session)
            row = session.get(RunRow, run_id)
            if row is None or row.status != "queued" or row.available_after > now:
                return None
            if not self.config.enabled or (
                row.kind == "discovery" and not self.config.discovery
            ):
                _mark_terminal(row, now, "failed", "research_disabled")
                return None
            if row.kind == "discovery" and row.created_at <= now - DISCOVERY_RETENTION:
                _mark_terminal(row, now, "failed", "discovery_request_expired")
                return None
            if state.blocked or (state.resume_at and state.resume_at > now):
                return None
            if session.scalar(
                select(RunRow.id).where(RunRow.status == "running").limit(1)
            ):
                return None
            row.status = "running"
            row.attempts += 1
            row.claim = uuid4()
            row.lease_until = now + LEASE
            previous = (
                current_posts(session, row.channel_id, now) if row.channel_id else []
            )
            return Claim(run_id, row.claim, row.channel_id, row.query, previous)

    @staticmethod
    def _owned_run(session: Session, claim: Claim, now: datetime) -> RunRow | None:
        row = session.get(RunRow, claim.id)
        if (
            row
            and row.status == "running"
            and row.claim == claim.token
            and row.lease_until > now
        ):
            return row
        return None

    @staticmethod
    def _quota_bucket(session: Session, state: ProviderRow, endpoint: Endpoint) -> str:
        day = _provider_day(session)
        if state.quota_day != day:
            state.quota_day = day
            state.standard_units = state.search_calls = 0
        return "search_calls" if endpoint == "search" else "standard_units"

    def reserve(self, claim: Claim, endpoint: Endpoint) -> None:
        with self.sessions.begin() as session:
            state = lock_provider(session)
            now = database_now(session)
            row = self._owned_run(session, claim, now)
            if row is None:
                raise ProviderError("claim_lost")
            bucket = self._quota_bucket(session, state, endpoint)
            limit = SEARCH_LIMIT if endpoint == "search" else STANDARD_LIMIT
            if getattr(state, bucket) >= limit:
                raise ProviderError("local_quota")
            setattr(state, bucket, getattr(state, bucket) + 1)
            setattr(row, bucket, getattr(row, bucket) + 1)

    def execute(self, run_id: UUID, key: str, http: httpx2.Client) -> None:
        claim = self.claim(run_id)
        if claim is None:
            return
        youtube = YouTube(
            http, key, run_id, lambda endpoint: self.reserve(claim, endpoint)
        )
        try:
            if not key:
                raise ProviderError("credentials_missing")
            if claim.channel_id:
                self.complete(claim, youtube.refresh(claim.channel_id, claim.previous))
            else:
                self.complete(claim, youtube.discover(claim.query))
        except ProviderError as error:
            self.fail(claim, error)

    def complete(self, claim: Claim, result: Refresh | list[Lead]) -> None:
        with self.sessions.begin() as session:
            lock_provider(session)
            now = database_now(session)
            row = self._owned_run(session, claim, now)
            if row is None:
                return
            if isinstance(result, Refresh):
                account = session.get(AccountRow, row.channel_id)
                clear_account(session, account, "unavailable")
                if result.channel is None:
                    session.execute(
                        delete(LeadRow).where(LeadRow.channel_id == row.channel_id)
                    )
                else:
                    account.snapshot = result.channel.model_dump(mode="json")
                    account.state = "available"
                    account.expires_at = result.channel.provenance.expires_at
                    account.scan_truncated = result.truncated
                    session.add_all(
                        PostRow(
                            video_id=post.video_id,
                            channel_id=row.channel_id,
                            expires_at=post.provenance.expires_at,
                            post=post.model_dump(mode="json"),
                        )
                        for post in result.posts
                    )
            else:
                suppressed = set(
                    session.scalars(
                        select(AccountRow.channel_id).where(
                            AccountRow.channel_id.in_(
                                [lead.channel_id for lead in result]
                            ),
                            AccountRow.state.in_(("withdrawn", "unavailable")),
                        )
                    )
                )
                session.add_all(
                    LeadRow(
                        run_id=row.id,
                        channel_id=lead.channel_id,
                        rank=rank,
                        expires_at=lead.provenance.expires_at,
                        lead=lead.model_dump(mode="json"),
                    )
                    for rank, lead in enumerate(result)
                    if lead.channel_id not in suppressed
                )
            self._finish_run(session, row, now)

    def fail(self, claim: Claim, error: ProviderError) -> None:
        with self.sessions.begin() as session:
            state = lock_provider(session)
            now = database_now(session)
            row = self._owned_run(session, claim, now)
            if row is None:
                return
            retry_at = None
            if error.code == "provider_access_blocked":
                state.blocked = True
                for account in session.scalars(
                    select(AccountRow).where(AccountRow.snapshot.is_not(None))
                ):
                    clear_account(session, account, "expired")
                session.execute(delete(LeadRow))
                session.execute(
                    update(RunRow)
                    .where(RunRow.kind == "discovery")
                    .values(query_key=None)
                )
            elif error.code in {"local_quota", "provider_quota"}:
                retry_at = _next_reset(session)
                if error.code == "provider_quota":
                    endpoint = "search" if row.kind == "discovery" else "videos"
                    bucket = self._quota_bucket(session, state, endpoint)
                    setattr(
                        state,
                        bucket,
                        SEARCH_LIMIT if endpoint == "search" else STANDARD_LIMIT,
                    )
            elif error.retry_seconds is not None:
                delay = max(error.retry_seconds, 10 * 2 ** (row.attempts - 1))
                retry_at = now + timedelta(seconds=delay)
                if error.code != "provider_transport":
                    state.resume_at = max(state.resume_at or now, retry_at)
            if (
                retry_at
                and row.attempts < MAX_ATTEMPTS
                and (
                    row.kind != "discovery"
                    or retry_at < row.created_at + DISCOVERY_RETENTION
                )
            ):
                _reschedule(row, retry_at, error.code)
            else:
                self._finish_run(session, row, now, error=error.code, retry_at=retry_at)

    @staticmethod
    def _finish_run(
        session: Session,
        row: RunRow,
        now: datetime,
        *,
        error: str | None = None,
        retry_at: datetime | None = None,
    ) -> None:
        _mark_terminal(row, now, "failed" if error else "succeeded", error)
        if row.channel_id:
            account = session.get(AccountRow, row.channel_id)
            scheduled = now + timedelta(hours=account.refresh_hours)
            account.next_refresh_at = max(scheduled, retry_at or now)
