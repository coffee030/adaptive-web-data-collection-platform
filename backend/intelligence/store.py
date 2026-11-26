"""Grant-checked ingestion and read snapshots for campaign intelligence."""

import json
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from pathlib import Path
from secrets import compare_digest
from uuid import uuid4

from pydantic import BaseModel, TypeAdapter, ValidationError
from sqlalchemy import column, func, select, true
from sqlalchemy.dialects.postgresql import JSONB

from backend.application.jobs import database_now
from backend.marketing.store import MarketingError
from backend.persistence.database import settings

from .contracts import Content, ImportDataset, Mode, Profile, Ref
from .models import DatasetRow
from .semantic import INDEX_VERSION, character_grams, content_key

MAX_DATASETS = 2048
MAX_RECORDS = 10000


@dataclass(frozen=True)
class Scope:
    mode: Mode
    workspace: str


DEMO = Scope("demo", "demo")


@dataclass(frozen=True)
class Config:
    model_dir: Path | None = None
    demo_enabled: bool = False
    workspace: str = ""
    public_demo_directory: bool = False

    @classmethod
    def load(cls):
        config = settings()
        path = config.get("MARKETING_MODEL_DIR")
        return cls(
            model_dir=Path(path) if path else None,
            demo_enabled=config.get("MARKETING_DEMO_ENABLED") == "1",
            workspace=config.get("MARKETING_PARTNER_WORKSPACE") or "",
            public_demo_directory=config.get("MARKETING_PUBLIC_DEMO_DIRECTORY") == "1",
        )


def valid_workspace(config: Config) -> bool:
    try:
        TypeAdapter(Ref).validate_python(config.workspace)
        return True
    except ValidationError:
        return False


def partner_token(config: Config) -> str:
    if not valid_workspace(config):
        return ""
    values = settings()
    token = values.get("MARKETING_CUSTOMER_TOKEN") or ""
    operator = values.get("MARKETING_OPERATOR_TOKEN") or ""
    if len(token) < 24 or compare_digest(token.encode(), operator.encode()):
        return ""
    return token


@dataclass(frozen=True)
class Dataset:
    id: str
    body: ImportDataset
    grams: dict[str, dict[str, int]]
    vectors: dict[str, list[float]]
    state: str


@dataclass(frozen=True)
class Snapshot:
    as_of: datetime
    datasets: list[Dataset]
    revision: str


class DatasetStatus(BaseModel):
    dataset_id: str
    state: str
    record_count: int
    imported_at: datetime
    expires_at: datetime | None
    refresh_error: str | None


def active(scope: Scope, now: datetime):
    return select(DatasetRow).where(
        DatasetRow.mode == scope.mode,
        DatasetRow.workspace == scope.workspace,
        DatasetRow.expires_at > now,
        DatasetRow.payload.is_not(None),
    )


def lock_scope(session, scope: Scope) -> None:
    session.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(
                    f"marketing-intelligence:{scope.mode}:{scope.workspace}", 0
                )
            )
        )
    )


def drop_payload(row: DatasetRow, state: str) -> None:
    row.digest = row.payload = row.grams = row.vectors = row.model_version = None
    row.expires_at = row.claim = row.lease_until = row.due_at = None
    row.state = state
    row.refresh_error = None


def dataset_view(row: DatasetRow, now: datetime) -> DatasetStatus:
    expired = row.expires_at is not None and row.expires_at <= now
    return DatasetStatus(
        dataset_id=row.dataset_id,
        state="expired" if expired else row.state,
        record_count=len(row.payload["records"]) if row.payload and not expired else 0,
        imported_at=row.imported_at,
        expires_at=row.expires_at,
        refresh_error=None if expired else row.refresh_error,
    )


def check_import(session, scope, now, dataset_id, body):
    others = (
        active(scope, now)
        .where(DatasetRow.dataset_id != dataset_id)
        .with_only_columns(DatasetRow.payload)
        .subquery()
    )
    size = session.execute(
        select(
            func.count(),
            func.coalesce(
                func.sum(func.jsonb_array_length(others.c.payload["records"])), 0
            ),
        ).select_from(others)
    ).one()
    if size[0] >= MAX_DATASETS or size[1] + len(body.records) > MAX_RECORDS:
        raise MarketingError(409, "catalog_limit", "Workspace catalog limit reached")
    creators = set()
    accounts = set()
    posts = set()
    kinds = set()

    def duplicate_profile():
        raise MarketingError(
            409, "duplicate_creator_identity", "Creator or account already registered"
        )

    def duplicate_post():
        raise MarketingError(
            409, "duplicate_post_identity", "Platform post already registered"
        )

    for row in body.records:
        if isinstance(row, Profile):
            identities = {(a.platform, a.account_id) for a in row.accounts}
            if row.creator_id in creators or accounts & identities:
                duplicate_profile()
            creators.add(row.creator_id)
            accounts.update(identities)
            kinds.add("profile")
        elif isinstance(row, Content):
            key = (row.platform, row.id)
            if key in posts:
                duplicate_post()
            posts.add(key)
            kinds.add("content")
    if not kinds:
        return
    records = (
        func.jsonb_array_elements(others.c.payload["records"])
        .table_valued(column("value", JSONB))
        .lateral()
    )
    record = records.c.value
    existing = (
        select(
            record["kind"].astext,
            record["creator_id"].astext,
            record["accounts"],
            record["platform"].astext,
            record["id"].astext,
        )
        .select_from(others.join(records, true()))
        .where(record["kind"].astext.in_(kinds))
    )
    for kind, creator, account_list, platform, row_id in session.execute(
        existing
    ).yield_per(256):
        if kind == "profile" and (
            creator in creators
            or any((a["platform"], a["account_id"]) in accounts for a in account_list)
        ):
            duplicate_profile()
        if kind == "content" and (platform, row_id) in posts:
            duplicate_post()


class IntelligenceStore:
    def __init__(self, sessions, config: Config):
        self.sessions = sessions
        self.config = config

    @staticmethod
    def _row(session, scope: Scope, dataset_id: str) -> DatasetRow | None:
        return session.scalar(
            select(DatasetRow)
            .where(
                DatasetRow.mode == scope.mode,
                DatasetRow.workspace == scope.workspace,
                DatasetRow.dataset_id == dataset_id,
            )
            .with_for_update()
        )

    def ingest(
        self,
        scope: Scope,
        dataset_id: str,
        body: ImportDataset,
        *,
        expected_imported_at: datetime | None = None,
        create_only: bool = False,
    ) -> DatasetStatus:
        if not body.grant.allows(scope.mode):
            raise MarketingError(
                403,
                "grant_restricted",
                "Dataset grant does not permit this workspace use",
            )
        payload = body.model_dump(mode="json")
        if not body.grant.company_plan_export:
            payload["grant"].pop("company_plan_export", None)
        payload["records"].sort(key=lambda item: item["id"])
        digest = sha256(
            json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()
        ).hexdigest()
        with self.sessions.begin() as session:
            lock_scope(session, scope)
            now = database_now(session)
            if body.grant.expires_at <= now:
                raise MarketingError(409, "grant_expired", "Dataset grant has expired")
            if any(record.observed_at > now for record in body.records):
                raise MarketingError(
                    422, "future_observation", "An observation is dated in the future"
                )
            row = self._row(session, scope, dataset_id)
            if row and row.state == "withdrawn":
                raise MarketingError(
                    409, "dataset_withdrawn", "Dataset identifier has been withdrawn"
                )
            if create_only and row and row.digest != digest:
                raise MarketingError(
                    409,
                    "receipt_exists",
                    "This record was already reviewed with different contents",
                )
            if expected_imported_at is not None:
                if row is None or row.payload is None or row.expires_at <= now:
                    raise MarketingError(
                        409, "refresh_inactive", "Refresh requires an active dataset"
                    )
                if row.payload["grant"] != payload["grant"]:
                    raise MarketingError(
                        403,
                        "refresh_grant_changed",
                        "An operator must review the new grant",
                    )
                if row.digest != digest and row.imported_at != expected_imported_at:
                    raise MarketingError(
                        409, "refresh_conflict", "Refresh references an older dataset"
                    )
            if row and row.digest == digest:
                row.refresh_error = None
                return dataset_view(row, now)
            check_import(session, scope, now, dataset_id, body)
            if row is None:
                row = DatasetRow(
                    id=uuid4(),
                    mode=scope.mode,
                    workspace=scope.workspace,
                    dataset_id=dataset_id,
                )
                session.add(row)
            docs = {
                content_key(item.text): item.text
                for item in body.records
                if isinstance(item, Content)
            }
            preceding_grams = row.grams or {}
            previous = (row.vectors or {}) if row.model_version == INDEX_VERSION else {}
            row.digest, row.payload = digest, payload
            row.grams = {
                key: preceding_grams[key]
                if key in preceding_grams
                else character_grams(text)
                for key, text in docs.items()
            }
            row.vectors = {key: previous[key] for key in docs if key in previous}
            row.model_version = INDEX_VERSION if row.vectors else None
            row.expires_at = body.grant.expires_at
            row.imported_at = now
            row.claim = row.lease_until = None
            row.state = (
                "ready" if not docs or len(row.vectors) == len(docs) else "lexical"
            )
            row.due_at = now if row.state == "lexical" else None
            row.refresh_error = None
            row.index_failures = 0
            return dataset_view(row, now)

    def dataset_ids(self, scope: Scope, after: str | None) -> list[str]:
        query = select(DatasetRow.dataset_id).where(
            DatasetRow.mode == scope.mode, DatasetRow.workspace == scope.workspace
        )
        if after is not None:
            query = query.where(DatasetRow.dataset_id > after)
        with self.sessions() as session:
            return list(
                session.scalars(query.order_by(DatasetRow.dataset_id).limit(50))
            )

    def status(self, scope: Scope, dataset_id: str) -> DatasetStatus:
        with self.sessions.begin() as session:
            row = self._row(session, scope, dataset_id)
            if row is None:
                raise MarketingError(404, "dataset_not_found", "Dataset does not exist")
            return dataset_view(row, database_now(session))

    def withdraw(self, scope: Scope, dataset_id: str) -> None:
        with self.sessions.begin() as session:
            lock_scope(session, scope)
            row = self._row(session, scope, dataset_id)
            if row is None:
                raise MarketingError(404, "dataset_not_found", "Dataset does not exist")
            drop_payload(row, "withdrawn")

    def snapshot(self, scope: Scope) -> Snapshot:
        with self.sessions() as session:
            now = database_now(session)
            datasets = []
            revisions = []
            for row in session.scalars(
                active(scope, now).order_by(DatasetRow.dataset_id)
            ):
                body = ImportDataset.model_validate(row.payload)
                if not body.grant.allows(scope.mode):
                    continue
                vectors = row.vectors if row.model_version == INDEX_VERSION else {}
                datasets.append(
                    Dataset(
                        row.dataset_id, body, row.grams or {}, vectors or {}, row.state
                    )
                )
                revisions.append(f"{row.dataset_id}:{row.digest}")
            return Snapshot(
                now, datasets, sha256("\n".join(revisions).encode()).hexdigest()
            )

    def processing_status(self, scope: Scope) -> tuple[str, set[str], int, int]:
        with self.sessions() as session:
            query = active(scope, database_now(session)).with_only_columns(
                DatasetRow.dataset_id,
                DatasetRow.digest,
                DatasetRow.state,
                DatasetRow.model_version,
            )
            rows = session.execute(query.order_by(DatasetRow.dataset_id)).all()
            signature = "\n".join(f"{row.dataset_id}:{row.digest}" for row in rows)
            return (
                sha256(signature.encode()).hexdigest(),
                {row.state for row in rows},
                len(rows),
                sum(
                    row.state == "ready" and row.model_version == INDEX_VERSION
                    for row in rows
                ),
            )

    def assert_current(self, scope: Scope, revision: str) -> None:
        with self.sessions() as session:
            now = database_now(session)
            rows = active(scope, now).with_only_columns(
                DatasetRow.dataset_id, DatasetRow.digest
            )
            current = "\n".join(
                f"{key}:{digest}"
                for key, digest in session.execute(rows.order_by(DatasetRow.dataset_id))
            )
            if sha256(current.encode()).hexdigest() != revision:
                raise MarketingError(
                    409,
                    "catalog_changed",
                    "Workspace data changed. Repeat the request.",
                )
