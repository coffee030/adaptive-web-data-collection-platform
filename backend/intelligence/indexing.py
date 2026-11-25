"""Schedule and update eligible semantic representations through Celery."""

from collections.abc import Callable
from datetime import timedelta
from uuid import UUID, uuid4

from kombu.exceptions import OperationalError as BrokerConnectionError
from redis.exceptions import RedisError
from sqlalchemy import func, select, tuple_

from backend.application.jobs import database_now

from .contracts import Content, ImportDataset
from .models import DatasetRow
from .semantic import INDEX_VERSION, content_key, embed
from .store import DEMO, IntelligenceStore, drop_payload, valid_workspace

INDEX_CLAIM_WINDOW = timedelta(seconds=120)
RETRY_DELAY = timedelta(minutes=15)
READY_TO_INDEX = ("lexical", "fallback")


def _index_lock(session) -> None:
    session.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended("marketing-intelligence-index", 0)
            )
        )
    )


class Indexing(IntelligenceStore):
    def enabled_scopes(self) -> list[tuple[str, str]]:
        scopes = [(DEMO.mode, DEMO.workspace)] if self.config.demo_enabled else []
        if valid_workspace(self.config):
            scopes.append(("partner", self.config.workspace))
        return scopes

    def maintain(self, *, purge: bool = True) -> None:
        with self.sessions.begin() as session:
            now = database_now(session)
            if purge:
                expired = (
                    select(DatasetRow)
                    .where(DatasetRow.expires_at <= now)
                    .with_for_update()
                )
                for row in session.scalars(expired):
                    drop_payload(row, "expired")
            recovering = (
                select(DatasetRow)
                .where(
                    DatasetRow.state == "running",
                    DatasetRow.lease_until <= now,
                )
                .with_for_update()
            )
            for row in session.scalars(recovering):
                self._fallback(row, now)

    @staticmethod
    def _fallback(row, now) -> None:
        row.index_failures += 1
        row.state = "fallback"
        row.claim = row.lease_until = None
        row.due_at = now + RETRY_DELAY * min(row.index_failures, 4)

    def dispatch(self, publish: Callable[[UUID, UUID], None]) -> bool:
        if self.config.model_dir is None:
            return False
        with self.sessions.begin() as session:
            _index_lock(session)
            now = database_now(session)
            enabled = tuple_(DatasetRow.mode, DatasetRow.workspace).in_(
                self.enabled_scopes()
            )
            busy = (
                select(DatasetRow.id)
                .where(enabled, DatasetRow.expires_at > now)
                .where(
                    (DatasetRow.state == "running")
                    | (DatasetRow.claim.is_not(None) & (DatasetRow.due_at > now))
                )
                .limit(1)
            )
            if session.scalar(busy):
                return False
            row = session.scalar(
                select(DatasetRow)
                .where(
                    enabled,
                    DatasetRow.state.in_(READY_TO_INDEX),
                    DatasetRow.expires_at > now,
                    DatasetRow.due_at <= now,
                )
                .order_by(DatasetRow.due_at, DatasetRow.id)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
            if row is None:
                return False
            token = uuid4()
            try:
                publish(row.id, token)
            except (BrokerConnectionError, RedisError, OSError):
                row.claim = None
                row.due_at = now + timedelta(seconds=10)
                return False
            row.claim = token
            row.due_at = now + INDEX_CLAIM_WINDOW
            return True

    def execute(self, dataset_id: UUID, token: UUID) -> None:
        with self.sessions.begin() as session:
            _index_lock(session)
            now = database_now(session)
            row = session.get(DatasetRow, dataset_id, with_for_update=True)
            if (
                row is None
                or (row.mode, row.workspace) not in self.enabled_scopes()
                or row.claim != token
                or row.state not in READY_TO_INDEX
                or row.expires_at <= now
                or row.due_at <= now
            ):
                return
            body = ImportDataset.model_validate(row.payload)
            if not body.grant.allows(row.mode):
                drop_payload(row, "withdrawn")
                return
            previous = row.vectors if row.model_version == INDEX_VERSION else {}
            docs = {
                content_key(item.text): item.text
                for item in body.records
                if isinstance(item, Content) and content_key(item.text) not in previous
            }
            row.state = "running"
            row.lease_until = now + INDEX_CLAIM_WINDOW

        output = embed(self.config.model_dir, list(docs.values())) if docs else []
        with self.sessions.begin() as session:
            now = database_now(session)
            row = session.get(DatasetRow, dataset_id, with_for_update=True)
            if (
                row is None
                or row.claim != token
                or row.state != "running"
                or row.expires_at <= now
                or row.lease_until <= now
            ):
                return
            if output is None:
                self._fallback(row, now)
                return
            row.vectors = previous | dict(zip(docs, output, strict=True))
            row.model_version = INDEX_VERSION
            row.state = "ready"
            row.claim = row.lease_until = row.due_at = None
            row.index_failures = 0
