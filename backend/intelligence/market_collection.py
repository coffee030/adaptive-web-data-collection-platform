"""Validate publisher mappings, run bounded refreshes and release Core-accepted records."""

import csv
import io
import json
from datetime import UTC, datetime, timedelta
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert

from backend.application.inputs import CsvEntry
from backend.application.jobs import database_now, stage_job
from backend.application.profiles import Profiles
from backend.core.contracts import CsvMappingConfiguration, Source
from backend.marketing.store import MarketingError
from backend.persistence.models import JobRow, ProfileRow, RecordRow, SourceRow

from .market_models import MarketActivity, MarketBatch, MarketMeasure, MarketSource
from .market_sources import FRESH, SOURCES, PublisherError, Reader

FIELDS = ("id", "publication")
CYCLE_LEASE = timedelta(minutes=15)
INTERVAL = timedelta(hours=6)
FULL_INTERVAL = timedelta(hours=24)
CHUNK = 125


def mapping(key):
    return CsvMappingConfiguration.model_validate(
        {
            "adapter_type": "csv",
            "config_schema_version": "1",
            "columns": [{"name": f, "column": f} for f in FIELDS],
            "record_schema": {
                "record_type": "market-" + key,
                "schema_version": "1",
                "identity_field": "id",
                "fields": [{"name": f, "required": True} for f in FIELDS],
            },
        }
    )


def entry(key, records):
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(FIELDS)
    for item in records:
        writer.writerow(
            (item["id"], json.dumps(item, ensure_ascii=False, separators=(",", ":")))
        )
    return CsvEntry(
        adapter_type="csv", dataset_id="market-" + key, content=buffer.getvalue()
    )


def allowed(session, state):
    if not state or state.key not in SOURCES:
        return False
    source = session.get(SourceRow, state.source_id)
    profile = session.get(ProfileRow, state.profile_id)
    return bool(
        source
        and profile
        and source.approval_status == "approved"
        and source.permission_reference == SOURCES[state.key].rights_url
        and profile.source_id == source.id
        and profile.approval_status == "approved"
        and profile.config_hash == mapping(state.key).config_hash()
    )


def clear(state):
    state.generation = state.started = None
    state.queued = False


def install(sessions, evidence, key, *, restore=False):
    spec = SOURCES[key]
    config = mapping(key)
    profiles = Profiles(sessions)
    with sessions.begin() as guard:
        guard.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
            {"key": "harbourline/market/" + key},
        )
        current = guard.get(MarketSource, key, with_for_update=True)
        if current and not restore:
            return (
                "already configured"
                if allowed(guard, current)
                and current.error != "publisher_access_blocked"
                else "operator decision preserved"
            )
        source_key = uuid5(NAMESPACE_URL, "harbourline/market/" + key)
        source, _ = profiles.register_source_once(
            Source(
                source_id=uuid4().hex,
                source_name=spec.name,
                adapter_type="csv",
                permission_reference=spec.rights_url,
                approval_status="approved",
                allowed_datasets=("market-" + key,),
            ),
            source_key,
        )
        source_id = UUID(source.source_id)
        if (
            source.permission_reference != spec.rights_url
            or source.allowed_datasets != ("market-" + key,)
        ):
            raise MarketingError(
                409,
                "market_policy_mismatch",
                "The registered source policy must be reviewed",
            )
        versions = profiles.list_versions(source_id)
        if not restore and (
            source.approval_status != "approved"
            or any(p.approval_status == "retired" for p, _ in versions)
        ):
            return "operator decision preserved"
        sample = list(spec.load(Reader(), datetime.now(UTC), sample=True))
        if not sample:
            raise MarketingError(
                409,
                "market_empty_sample",
                "The publisher returned no eligible sample for mapping validation",
            )
        if source.approval_status != "approved":
            profiles.set_authorization(source_id, "approved")
        profile = next(
            (
                p
                for p, _ in reversed(versions)
                if p.config_hash == config.config_hash()
                and p.approval_status != "retired"
            ),
            None,
        )
        if profile is None:
            profile = profiles.create_draft(source_id, config)
        pid = UUID(profile.profile_version_id)
        if profile.approval_status != "approved":
            report = profiles.validate(
                source_id, pid, entry(key, sample[:8]).collection_input(), evidence
            )
            if not report.passed:
                raise MarketingError(
                    409,
                    "market_validation_failed",
                    "The live sample failed Core validation",
                )
            profiles.approve(
                source_id,
                pid,
                approver="Licensed publisher installation",
                report_id=UUID(report.report_id),
                config_hash=config.config_hash(),
            )
        if not current:
            current = MarketSource(key=key, source_id=source_id, profile_id=pid)
            guard.add(current)
        current.profile_id = pid
        current.observed = current.full_checked = current.revision = current.error = (
            None
        )
        clear(current)
        current.next_check = database_now(guard)
    return "validated and scheduled"


def withdraw(sessions, key):
    with sessions.begin() as session:
        state = session.get(MarketSource, key, with_for_update=True)
        if state:
            Profiles(sessions).set_authorization(state.source_id, "revoked")
            clear(state)
            state.observed = state.full_checked = state.revision = None
            state.error = "operator_withdrawn"
            session.execute(delete(MarketActivity).where(MarketActivity.source == key))


def claim(sessions, key):
    with sessions.begin() as session:
        state = session.scalar(
            select(MarketSource)
            .where(MarketSource.key == key)
            .with_for_update(skip_locked=True)
        )
        if not allowed(session, state) or state.error == "publisher_access_blocked":
            return None
        now = database_now(session)
        if (
            state.queued
            or state.next_check > now
            or state.generation
            and state.started + CYCLE_LEASE > now
        ):
            return None
        state.generation = uuid4()
        state.started = now
        state.full = (
            not SOURCES[key].incremental
            or not state.full_checked
            or state.full_checked + FULL_INTERVAL <= now
        )
        return state.generation, now, None if state.full else state.observed


def collect(sessions, key):
    claimed = claim(sessions, key)
    if claimed is None:
        return False
    generation, now, since = claimed
    reader = Reader()
    try:
        rows = {item["id"]: item for item in SOURCES[key].load(reader, now, since)}
    except (PublisherError, ValueError, KeyError, TypeError) as error:
        with sessions.begin() as session:
            state = session.get(MarketSource, key, with_for_update=True)
            if state and state.generation == generation:
                state.error = (
                    error.code
                    if isinstance(error, PublisherError)
                    else "publisher_schema_changed"
                )
                state.next_check = database_now(session) + timedelta(
                    seconds=getattr(error, "retry_after", 3600)
                )
                if state.error == "publisher_access_blocked":
                    state.revision = state.observed = state.full_checked = None
                state.receipt = {
                    "requests": reader.requests,
                    "bytes": reader.byte_count,
                    "error": state.error,
                }
                clear(state)
        return False
    with sessions.begin() as session:
        state = session.get(MarketSource, key, with_for_update=True)
        if not allowed(session, state) or state.generation != generation:
            return False
        config = mapping(key)
        values = list(rows.values())
        for offset in range(0, len(values), CHUNK):
            chunk = entry(key, values[offset : offset + CHUNK])
            job = stage_job(
                session,
                state.source_id,
                state.profile_id,
                config.config_hash(),
                chunk,
                request_key=uuid5(generation, str(offset)),
            )
            session.add(MarketBatch(job_id=job.id, source=key, generation=generation))
        state.queued = True
        state.receipt = dict(
            requests=reader.requests,
            bytes=reader.byte_count,
            returned=len(values),
            elapsed_seconds=round((datetime.now(UTC) - now).total_seconds(), 3),
            mode="full" if state.full else "incremental",
        )
        if state.full:
            state.revision = None
    return True


def _publish_rows(session, state, records):
    for start in range(0, len(records), CHUNK):
        entries = []
        measurements = []
        for record in records[start : start + CHUNK]:
            value = json.loads(record.payload["publication"])
            entries.append(
                dict(
                    id=value["id"],
                    source=state.key,
                    creator_id=value["creator_id"],
                    published=datetime.fromisoformat(value["published_at"]),
                    checked=state.started,
                    topics=value["topics"],
                    generation=state.generation,
                    payload=value,
                    core_record=record.id,
                    search_text=" ".join(
                        [
                            value["creator_name"],
                            value["title"],
                            value.get("excerpt") or "",
                            *value["topics"],
                        ]
                    ).casefold(),
                )
            )
            if value["metrics"]:
                measurements.append(
                    dict(
                        activity_id=value["id"],
                        observed=state.started,
                        metrics=value["metrics"],
                    )
                )
        statement = insert(MarketActivity).values(entries)
        session.execute(
            statement.on_conflict_do_update(
                index_elements=[MarketActivity.id],
                set_={
                    col: getattr(statement.excluded, col)
                    for col in entries[0]
                    if col != "id"
                },
            )
        )
        if measurements:
            session.execute(
                insert(MarketMeasure).values(measurements).on_conflict_do_nothing()
            )


def publish(sessions, key):
    with sessions.begin() as session:
        state = session.scalar(
            select(MarketSource)
            .where(MarketSource.key == key)
            .with_for_update(skip_locked=True)
        )
        if not allowed(session, state) or not state.queued:
            return False
        jobs = list(
            session.scalars(
                select(JobRow)
                .join(MarketBatch, MarketBatch.job_id == JobRow.id)
                .where(MarketBatch.generation == state.generation)
            )
        )
        if any(j.status in {"pending", "running"} for j in jobs):
            return False
        now = database_now(session)
        if any(
            j.status != "succeeded"
            or j.invalid_count
            or j.source_id != state.source_id
            or j.profile_version_id != state.profile_id
            for j in jobs
        ):
            state.error = "market_core_validation_failed"
            state.next_check = now + timedelta(hours=1)
            clear(state)
            return False
        records = list(
            session.scalars(
                select(RecordRow)
                .join(MarketBatch, MarketBatch.job_id == RecordRow.job_id)
                .where(
                    MarketBatch.generation == state.generation,
                    RecordRow.record_type == "market-" + key,
                )
            )
        )
        if len(records) != state.receipt["returned"]:
            state.error = "market_record_count_mismatch"
            state.next_check = now + timedelta(hours=1)
            clear(state)
            return False
        _publish_rows(session, state, records)
        if state.full:
            session.execute(
                delete(MarketActivity).where(
                    MarketActivity.source == key,
                    MarketActivity.generation != state.generation,
                )
            )
            state.full_checked = state.started
        session.execute(
            delete(MarketActivity).where(
                MarketActivity.source == key, MarketActivity.checked < now - FRESH
            )
        )
        session.execute(
            delete(MarketMeasure).where(
                MarketMeasure.activity_id.in_(
                    select(MarketActivity.id).where(MarketActivity.source == key)
                ),
                MarketMeasure.observed < now - timedelta(days=90),
            )
        )
        state.observed = state.started
        state.revision = state.generation
        state.error = None
        state.next_check = now + INTERVAL
        clear(state)
    return True
