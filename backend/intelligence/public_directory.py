"""Publish licensed public directory metadata through the validated Core CSV pipeline."""

import csv
import io
import json
import re
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlencode
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

import httpx2
from pydantic import BaseModel
from sqlalchemy import DateTime, ForeignKey, Integer, String, select
from sqlalchemy.orm import Mapped, mapped_column

from backend.application.inputs import CsvEntry
from backend.application.jobs import Jobs, database_now
from backend.core.contracts import CsvMappingConfiguration, Source
from backend.marketing.store import MarketingError
from backend.persistence.models import Base, JobRow, ProfileRow, RecordRow, SourceRow

from .semantic import character_grams, embed, normalized, tfidf_scores

ITEMS = (
    "Q107994588",
    "Q104173819",
    "Q83612827",
    "Q46865242",
    "Q108830064",
    "Q88180477",
    "Q68069111",
    "Q88071155",
    "Q87068866",
    "Q30946117",
    "Q112720537",
)
LICENSE = "https://www.wikidata.org/wiki/Wikidata:Licensing"
FEED = "hk-wikidata-creator-directory"
FIELDS = (
    "item",
    "name",
    "local_name",
    "description",
    "local_description",
    "revision",
    "checked",
)
CONFIG = CsvMappingConfiguration.model_validate(
    {
        "adapter_type": "csv",
        "config_schema_version": "1",
        "columns": [{"name": f, "column": f} for f in FIELDS],
        "record_schema": {
            "record_type": FEED,
            "schema_version": "1",
            "identity_field": "item",
            "fields": [
                {"name": f, "required": f not in ("local_name", "local_description")}
                for f in FIELDS
            ],
        },
    }
)
KEY = uuid5(NAMESPACE_URL, FEED)
LANGS = ("zh-hk", "zh-hant", "yue", "zh")
FRESH = timedelta(days=7)


class DirectoryRow(Base):
    __tablename__ = "public_directory_feed"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[UUID] = mapped_column(ForeignKey("sources.id"))
    profile_id: Mapped[UUID] = mapped_column(ForeignKey("profile_versions.id"))
    pending: Mapped[UUID | None] = mapped_column(ForeignKey("collection_jobs.id"))
    published: Mapped[UUID | None] = mapped_column(ForeignKey("collection_jobs.id"))
    next_attempt: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(String(64))


class PublicProfile(BaseModel):
    item: str
    revision: str
    name: str
    local_name: str = ""
    description: str
    local_description: str = ""
    evidence_id: UUID
    record_id: UUID


class DirectoryResults(BaseModel):
    state: Literal["available", "unavailable", "expired"]
    observed: datetime | None = None
    expires: datetime | None = None
    retrieval: Literal["directory", "granite_int8", "character_tfidf"] = "directory"
    profiles: list[PublicProfile] = []


def term(entity, group, languages):
    for lang in languages:
        label = entity.get(group, {}).get(lang, {}).get("value")
        if isinstance(label, str) and label.strip():
            if len(label) > 512 or any(ord(ch) < 32 for ch in label):
                raise ValueError("Unexpected upstream label")
            return label.strip()
    return ""


def wikidata_rows(payload):
    entities = payload.get("entities") if isinstance(payload, dict) else None
    if not isinstance(entities, dict) or set(entities) != set(ITEMS):
        raise ValueError("Unexpected upstream scope")
    rows = []
    for item in ITEMS:
        entity = entities[item]
        if (
            entity.get("id") != item
            or "missing" in entity
            or entity.get("type") != "item"
        ):
            continue

        name = term(entity, "labels", ("en",))
        description = term(entity, "descriptions", ("en",))
        version = entity.get("lastrevid")
        if not isinstance(version, int) or version <= 0:
            raise ValueError("Missing source revision")
        if name and description:
            rows.append(
                {
                    "item": item,
                    "name": name,
                    "local_name": term(entity, "labels", LANGS),
                    "description": description,
                    "local_description": term(entity, "descriptions", LANGS),
                    "revision": str(version),
                }
            )
    return rows


def acquire():
    params = urlencode(
        dict(
            action="wbgetentities",
            format="json",
            ids="|".join(ITEMS),
            props="info|labels|descriptions",
            languages="en|" + "|".join(LANGS),
            maxlag=5,
        )
    )
    try:
        with httpx2.stream(
            "GET",
            "https://www.wikidata.org/w/api.php?" + params,
            headers={
                "User-Agent": "Harbourline/1.0 (https://github.com/coffee030/adaptive-web-data-collection-platform)"
            },
            timeout=6,
            follow_redirects=False,
            trust_env=False,
        ) as response:
            if (
                response.status_code in (401, 403, 429)
                or 300 <= response.status_code < 400
            ):
                raise MarketingError(
                    503,
                    "directory_source_blocked",
                    "Upstream access needs operator review",
                )
            response.raise_for_status()
            data = bytearray()
            for chunk in response.iter_bytes(8192):
                data.extend(chunk)
                if len(data) > 131072:
                    raise ValueError("Upstream response too large")
            return wikidata_rows(json.loads(data))
    except (httpx2.HTTPError, ValueError, TypeError, AttributeError) as exc:
        raise MarketingError(
            503, "directory_source_unavailable", "Wikidata could not be refreshed"
        ) from exc


def release_snapshot():
    capture = json.loads(
        Path(__file__).with_name("wikidata-directory.json").read_text(encoding="utf-8")
    )
    observed = datetime.fromisoformat(capture["observed"])
    records = capture["records"] if observed + FRESH > datetime.now(UTC) else []
    return observed, records


def entry(records, observed=None):
    checked = (observed or datetime.now(UTC)).isoformat()
    content = io.StringIO(newline="")
    writer = csv.DictWriter(content, fieldnames=FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(dict(row, checked=checked) for row in records)
    return CsvEntry(adapter_type="csv", dataset_id=FEED, content=content.getvalue())


def approved(session, feed):
    return (
        feed is not None
        and session.get(SourceRow, feed.source_id).approval_status == "approved"
        and session.get(ProfileRow, feed.profile_id).approval_status == "approved"
        and session.get(ProfileRow, feed.profile_id).config_hash == CONFIG.config_hash()
    )


def prepare(profiles, evidence):
    source, _ = profiles.register_source_once(
        Source(
            source_id=uuid4().hex,
            source_name="Wikidata Hong Kong creator directory",
            adapter_type="csv",
            permission_reference=LICENSE,
            approval_status="approved",
            allowed_datasets=(FEED,),
        ),
        KEY,
    )
    source_id = UUID(source.source_id)
    if source.approval_status != "approved":
        profiles.set_authorization(source_id, "approved")
    versions = profiles.list_versions(source_id)
    profile = next(
        (
            p
            for p, _ in reversed(versions)
            if p.config_hash == CONFIG.config_hash() and p.approval_status != "retired"
        ),
        None,
    )
    if profile is None:
        profile = profiles.create_draft(source_id, CONFIG)
    profile_id = UUID(profile.profile_version_id)
    observed, records = release_snapshot()
    if not records:
        records, observed = acquire(), datetime.now(UTC)
    if not records:
        raise MarketingError(
            409, "directory_empty", "No eligible directory records to validate"
        )
    report = (
        profiles.validate(
            source_id, profile_id, entry(records, observed).collection_input(), evidence
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


def activate(sessions, profiles, source_id, profile_id, report_id):
    source = profiles.get_source(source_id)
    version = profiles.get_version(source_id, profile_id)
    with sessions() as session:
        registered = session.scalar(
            select(SourceRow.id).where(SourceRow.request_key == KEY)
        )
    if (
        registered != source_id
        or source.permission_reference != LICENSE
        or source.approval_status != "approved"
        or version.config_hash != CONFIG.config_hash()
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
            approver="Directory operator",
            report_id=report_id,
            config_hash=CONFIG.config_hash(),
        )
    with sessions.begin() as session:
        row = session.get(DirectoryRow, 1, with_for_update=True)
        first = row is None
        if first:
            row = DirectoryRow(
                id=1,
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
        observed, records = release_snapshot()
        if first and records:
            job, _ = Jobs(sessions).create(
                source_id,
                profile_id,
                entry(records, observed),
                uuid5(KEY, f"{profile_id}/release/{observed.isoformat()}"),
            )
            row.pending = job.job_id


def refresh(sessions):
    with sessions.begin() as session:
        feed = session.scalar(
            select(DirectoryRow)
            .where(DirectoryRow.id == 1)
            .with_for_update(skip_locked=True)
        )
        if not approved(session, feed):
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
            records = acquire()
        except MarketingError as error:
            feed.error = error.code
            if error.code == "directory_source_blocked":
                feed.published = None
            feed.next_attempt = now + timedelta(hours=1)
            return
        if records:
            request_key = uuid5(KEY, f"{feed.profile_id}/{now.isoformat()}")
            job, _ = Jobs(sessions).create(
                feed.source_id, feed.profile_id, entry(records, now), request_key
            )
            feed.pending = job.job_id
        else:
            feed.pending = feed.published = None
        feed.error, feed.next_attempt = None, now + timedelta(days=1)


def snapshot(sessions):
    with sessions() as session:
        feed = session.get(DirectoryRow, 1)
        if not approved(session, feed) or feed.error == "directory_source_blocked":
            return DirectoryResults(state="unavailable")
        job = session.get(JobRow, feed.pending) if feed.pending else None
        if not job or job.status != "succeeded" or job.invalid_count:
            job = session.get(JobRow, feed.published) if feed.published else None
        if (
            not job
            or job.source_id != feed.source_id
            or job.profile_version_id != feed.profile_id
        ):
            return DirectoryResults(state="unavailable")

        rows = session.scalars(
            select(RecordRow).where(
                RecordRow.job_id == job.id, RecordRow.record_type == FEED
            )
        )
        rows = list(rows)
        if not rows:
            return DirectoryResults(state="unavailable")
        observed = min(datetime.fromisoformat(row.payload["checked"]) for row in rows)
        expiry = observed + FRESH
        if expiry <= database_now(session):
            return DirectoryResults(state="expired", expires=expiry)
        profiles = [
            PublicProfile.model_validate(
                {
                    **{k: v for k, v in row.payload.items() if v is not None},
                    "record_id": row.id,
                    "evidence_id": row.evidence_id,
                }
            )
            for row in rows
            if row.payload.get("item") in ITEMS
        ]
        return DirectoryResults(
            state="available",
            observed=observed,
            expires=expiry,
            profiles=sorted(profiles, key=lambda p: p.name.casefold()),
        )


@lru_cache(maxsize=2)
def description_vectors(model_dir, texts):
    return embed(model_dir, list(texts))


def search(result, query, model_dir):
    if not query or not result.profiles:
        return result
    texts = tuple(
        normalized(" ".join([p.name, p.local_name, p.description, p.local_description]))
        for p in result.profiles
    )
    terms = set(re.findall(r"[^\W_]+", normalized(query)))
    literal = [normalized(query) in text for text in texts]
    coverage = [len(terms.intersection(re.findall(r"[^\W_]+", text))) for text in texts]
    vectors = description_vectors(model_dir, texts) if model_dir else None
    vector = embed(model_dir, [query]) if vectors is not None else None
    if vector:
        scores = [
            sum(a * b for a, b in zip(vector[0], row, strict=True)) for row in vectors
        ]
        result.retrieval = "granite_int8"
    else:
        lexical = tfidf_scores(
            query, {str(i): character_grams(text) for i, text in enumerate(texts)}
        )
        scores = [lexical[str(i)] for i in range(len(texts))]
        result.retrieval = "character_tfidf"
    indices = sorted(
        range(len(texts)),
        key=lambda i: (literal[i], coverage[i], scores[i]),
        reverse=True,
    )
    result.profiles = [
        result.profiles[i]
        for i in indices
        if literal[i] or (not any(literal) and scores[i] > 0)
    ]
    return result
