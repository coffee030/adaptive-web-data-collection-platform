"""Operator requests and the only read boundary for YouTube API data."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from hashlib import sha256
from uuid import UUID, uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, sessionmaker

from backend.application.jobs import database_now
from backend.persistence.database import settings

from .contracts import (
    DISCOVERY_RETENTION,
    Account,
    ChannelSnapshot,
    DiscoveryResult,
    Lead,
    Post,
    Purpose,
    Run,
    permits_youtube,
)
from .models import AccountRow, LeadRow, PostRow, ProviderRow, RunRow

ACTIVE = ("queued", "running")
ACCOUNT_LIMIT = 20
DISCOVERY_QUEUE_LIMIT = 10


class MarketingError(Exception):
    def __init__(self, status: int, code: str, message: str, **details):
        super().__init__(message)
        self.status = status
        self.code = code
        self.details = details


@dataclass(frozen=True)
class ResearchSettings:
    enabled: bool = False
    discovery: bool = False

    @classmethod
    def load(cls):
        config = settings()
        return cls(
            enabled=config.get("MARKETING_YOUTUBE_RESEARCH") == "1",
            discovery=config.get("MARKETING_YOUTUBE_DISCOVERY") == "1",
        )


def lock_provider(session: Session) -> ProviderRow:
    return session.scalars(
        select(ProviderRow).where(ProviderRow.id == 1).with_for_update()
    ).one()


def run_view(row: RunRow) -> Run:
    return Run(
        id=row.id,
        kind=row.kind,
        status=row.status,
        created_at=row.created_at,
        finished_at=row.finished_at,
        attempts=row.attempts,
        standard_units=row.standard_units,
        search_calls=row.search_calls,
        error_code=row.error_code,
        available_after=row.available_after if row.status == "queued" else None,
    )


def new_run(
    now: datetime,
    *,
    channel_id: str | None = None,
    query: str | None = None,
    query_key: str | None = None,
) -> RunRow:
    return RunRow(
        id=uuid4(),
        kind="refresh" if channel_id else "discovery",
        channel_id=channel_id,
        query=query,
        query_key=query_key,
        status="queued",
        created_at=now,
        dispatch_at=now,
        available_after=now,
        attempts=0,
        standard_units=0,
        search_calls=0,
    )


def active_refresh(session: Session, channel_id: str) -> RunRow | None:
    return session.scalar(
        select(RunRow).where(RunRow.channel_id == channel_id, RunRow.status.in_(ACTIVE))
    )


def clear_account(session: Session, row: AccountRow, state: str) -> None:
    row.state = state
    row.snapshot = None
    row.expires_at = None
    row.scan_truncated = False
    session.execute(delete(PostRow).where(PostRow.channel_id == row.channel_id))


def current_posts(session: Session, channel_id: str, now: datetime) -> list[Post]:
    rows = session.scalars(
        select(PostRow.post).where(
            PostRow.channel_id == channel_id, PostRow.expires_at > now
        )
    )
    posts = [Post.model_validate(row) for row in rows]
    for post in posts:
        if post.uploads_provenance and post.uploads_provenance.expires_at <= now:
            post.uploads_provenance = None
    return sorted(
        posts, key=lambda post: (post.published_at, post.video_id), reverse=True
    )


class ResearchStore:
    def __init__(self, sessions: sessionmaker[Session], config: ResearchSettings):
        self.sessions = sessions
        self.config = config

    def _require(self, purpose: Purpose, *, discovery: bool = False) -> None:
        if not permits_youtube(purpose):
            raise MarketingError(
                403,
                "commercial_permission_pending",
                "Additional permissions are required for this use of YouTube API data",
            )
        if not self.config.enabled or (discovery and not self.config.discovery):
            raise MarketingError(
                409, "research_disabled", "YouTube research access is disabled"
            )

    @staticmethod
    def _account(session: Session, channel_id: str) -> AccountRow:
        row = session.get(AccountRow, channel_id)
        if row is None:
            raise MarketingError(
                404, "account_not_found", "Research account does not exist"
            )
        return row

    @staticmethod
    def _run(session: Session, run_id: UUID) -> RunRow:
        row = session.get(RunRow, run_id)
        if row is None:
            raise MarketingError(404, "run_not_found", "Research run does not exist")
        return row

    @staticmethod
    def _view(session: Session, row: AccountRow, now: datetime) -> Account:
        snapshot = None
        posts = []
        state = row.state
        if state == "available":
            if row.expires_at is not None and row.expires_at > now:
                snapshot = ChannelSnapshot.model_validate(row.snapshot)
                posts = current_posts(session, row.channel_id, now)
            else:
                state = "expired"
        last_run = session.scalar(
            select(RunRow)
            .where(RunRow.channel_id == row.channel_id)
            .order_by(RunRow.created_at.desc())
            .limit(1)
        )
        return Account(
            creator_id=row.creator_id,
            channel_id=row.channel_id,
            refresh_hours=row.refresh_hours,
            next_refresh_at=row.next_refresh_at,
            state=state,
            scan_truncated=row.scan_truncated if snapshot else False,
            last_run=run_view(last_run) if last_run else None,
            snapshot=snapshot,
            posts=posts,
        )

    def watch(self, channel_id: str, refresh_hours: int) -> Account:
        self._require("research")
        with self.sessions.begin() as session:
            lock_provider(session)
            now = database_now(session)
            row = session.get(AccountRow, channel_id)
            if row is None:
                size = session.scalar(
                    select(func.count())
                    .select_from(AccountRow)
                    .where(AccountRow.state != "withdrawn")
                )
                if size >= ACCOUNT_LIMIT:
                    raise MarketingError(
                        409, "watch_limit", "Research watch limit reached"
                    )
                row = AccountRow(
                    channel_id=channel_id,
                    creator_id=uuid4(),
                    refresh_hours=refresh_hours,
                    next_refresh_at=now,
                    state="pending",
                    scan_truncated=False,
                )
                session.add(row)
            elif row.state == "withdrawn":
                raise MarketingError(
                    409, "account_withdrawn", "Research account was withdrawn"
                )
            elif row.refresh_hours != refresh_hours:
                row.refresh_hours = refresh_hours
                if row.next_refresh_at is not None:
                    row.next_refresh_at = min(
                        row.next_refresh_at, now + timedelta(hours=refresh_hours)
                    )
            return self._view(session, row, now)

    def read_account(self, channel_id: str, purpose: Purpose) -> Account:
        self._require(purpose)
        with self.sessions.begin() as session:
            lock_provider(session)
            return self._view(
                session, self._account(session, channel_id), database_now(session)
            )

    def withdraw(self, channel_id: str) -> None:
        with self.sessions.begin() as session:
            lock_provider(session)
            row = session.get(AccountRow, channel_id)
            if row is None:
                session.add(
                    AccountRow(
                        channel_id=channel_id,
                        creator_id=uuid4(),
                        refresh_hours=24,
                        state="withdrawn",
                        scan_truncated=False,
                    )
                )
            else:
                clear_account(session, row, "withdrawn")
                row.next_refresh_at = None
                session.execute(delete(RunRow).where(RunRow.channel_id == channel_id))
            session.execute(delete(LeadRow).where(LeadRow.channel_id == channel_id))

    def refresh(self, channel_id: str) -> Run:
        self._require("research")
        with self.sessions.begin() as session:
            lock_provider(session)
            account = self._account(session, channel_id)
            if account.state == "withdrawn":
                raise MarketingError(
                    409, "account_withdrawn", "Research account was withdrawn"
                )
            now = database_now(session)
            if row := active_refresh(session, channel_id):
                return run_view(row)
            recent = session.scalar(
                select(RunRow)
                .where(
                    RunRow.channel_id == channel_id,
                    RunRow.created_at > now - timedelta(minutes=15),
                )
                .order_by(RunRow.created_at.desc())
                .limit(1)
            )
            if recent is not None:
                return run_view(recent)
            row = new_run(now, channel_id=channel_id)
            session.add(row)
            return run_view(row)

    def discover(self, query: str) -> Run:
        self._require("research", discovery=True)
        key = sha256(query.casefold().encode()).hexdigest()
        with self.sessions.begin() as session:
            lock_provider(session)
            now = database_now(session)
            recent = session.scalar(
                select(RunRow)
                .where(
                    RunRow.query_key == key,
                    (RunRow.status.in_(ACTIVE))
                    | (
                        (RunRow.status == "succeeded")
                        & (RunRow.finished_at > now - DISCOVERY_RETENTION)
                    )
                    | (RunRow.created_at > now - timedelta(minutes=15)),
                )
                .order_by(RunRow.created_at.desc())
                .limit(1)
            )
            if recent is not None:
                return run_view(recent)
            size = session.scalar(
                select(func.count())
                .select_from(RunRow)
                .where(RunRow.kind == "discovery", RunRow.status.in_(ACTIVE))
            )
            if size >= DISCOVERY_QUEUE_LIMIT:
                raise MarketingError(
                    409, "discovery_queue_full", "Discovery queue limit reached"
                )
            row = new_run(now, query=query, query_key=key)
            session.add(row)
            return run_view(row)

    def read_run(self, run_id: UUID) -> Run:
        with self.sessions() as session:
            return run_view(self._run(session, run_id))

    def read_discovery(self, run_id: UUID, purpose: Purpose) -> DiscoveryResult:
        self._require(purpose, discovery=True)
        with self.sessions.begin() as session:
            lock_provider(session)
            row = self._run(session, run_id)
            if row.kind != "discovery":
                raise MarketingError(
                    404, "discovery_not_found", "Discovery result does not exist"
                )
            now = database_now(session)
            leads = []
            if row.status in ACTIVE:
                state = "pending"
            elif row.status == "failed":
                state = "unavailable"
            elif row.finished_at <= now - DISCOVERY_RETENTION:
                state = "expired"
            else:
                state = "available"
                leads = [
                    Lead.model_validate(lead)
                    for lead in session.scalars(
                        select(LeadRow.lead)
                        .where(LeadRow.run_id == run_id, LeadRow.expires_at > now)
                        .order_by(LeadRow.rank)
                    )
                ]
            return DiscoveryResult(run=run_view(row), state=state, leads=leads)

    def clear_provider_block(self) -> None:
        self._require("research")
        with self.sessions.begin() as session:
            lock_provider(session).blocked = False
