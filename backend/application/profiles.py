"""Run M1 profile rules against transaction-scoped snapshots."""

from functools import cached_property
from hashlib import sha256
from time import monotonic
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from backend.core.contracts import (
    Configuration,
    ExtractionConfiguration,
    Sha256,
    Source,
    canonical_json,
)
from backend.core.evidence import LocalEvidenceStore
from backend.core.origin_rate import OriginRate
from backend.core.profiles import ProfileError, ProfileRepository
from backend.core.runner import CollectionInput, CollectionRunner
from backend.core.suggestion_models import SuggestionRequest
from backend.core.suggestions import SuggestionAttempt
from backend.persistence.database import settings
from backend.persistence.models import ProfileRow, SourceRow
from backend.persistence.profiles import (
    ProfileStorage,
    profile_from_row,
    source_from_row,
)


class Profiles:
    def __init__(self, sessions: sessionmaker[Session]):
        self.sessions = sessions

    @cached_property
    def rate(self) -> OriginRate:
        return OriginRate(
            settings().get("CELERY_BROKER_URL") or "redis://127.0.0.1:6379/0"
        )

    def register_source(self, source: Source) -> Source:
        with self.sessions.begin() as session:
            return source_from_row(ProfileStorage(session).add_source(source))

    def register_source_once(self, source: Source, key: UUID) -> tuple[Source, bool]:
        data = source.model_dump(mode="json", exclude={"source_id"})
        digest = sha256(canonical_json(data)).hexdigest()
        with self.sessions.begin() as session:
            row, created = ProfileStorage(session).register_source_once(
                source, key, digest
            )
            return source_from_row(row), created

    def get_source(self, source_id: UUID) -> Source:
        with self.sessions() as session:
            return source_from_row(ProfileStorage(session).source(source_id))

    def list_sources(self):
        with self.sessions() as session:
            return [
                source_from_row(row)
                for row in session.scalars(
                    select(SourceRow).order_by(SourceRow.created_at, SourceRow.id)
                )
            ]

    def set_authorization(self, source_id: UUID, status: str) -> Source:
        with self.sessions.begin() as session:
            row = ProfileStorage(session).source(source_id, lock=True)
            source = source_from_row(row)
            updated = Source.model_validate(
                {**source.model_dump(), "approval_status": status}
            )
            ProfileRepository.from_snapshot(source).set_source_authorization(updated)
            row.approval_status = updated.approval_status
            return updated

    def get_version(self, source_id: UUID, version_id: UUID):
        return self.get_version_snapshot(source_id, version_id)[0]

    def get_version_snapshot(self, source_id: UUID, version_id: UUID):
        with self.sessions() as session:
            row = ProfileStorage(session).profile(source_id, version_id)
            return profile_from_row(row), row.revision

    def list_versions(self, source_id: UUID):
        with self.sessions() as session:
            ProfileStorage(session).source(source_id)
            return [
                (profile_from_row(row), row.revision)
                for row in session.scalars(
                    select(ProfileRow)
                    .where(ProfileRow.source_id == source_id)
                    .order_by(ProfileRow.version)
                )
            ]

    def suggest(self, source_id: UUID, request: SuggestionRequest):
        started = monotonic()
        source = self.get_source(source_id)
        reviewed = []
        if source.adapter_type == "web" and source.approval_status == "approved":
            with self.sessions() as session:
                rows = session.scalars(
                    select(ProfileRow.configuration).where(
                        ProfileRow.source_id == source_id,
                        ProfileRow.approval_status.in_(("approved", "retired")),
                    )
                )
                for row in rows:
                    config = ExtractionConfiguration.model_validate(row)
                    if config.search:
                        reviewed.append(config.search)
        return SuggestionAttempt(
            source, lambda: self.get_source(source_id), self.rate, reviewed, started=started
        ).run(request)

    def create_draft(self, source_id: UUID, configuration: Configuration):
        with self.sessions.begin() as session:
            storage = ProfileStorage(session)
            source = source_from_row(storage.source(source_id, lock=True))
            latest = storage.latest(source_id)
            repo = ProfileRepository.from_snapshot(
                source, profile_from_row(latest) if latest else None
            )
            draft = repo.create_draft(source.source_id, configuration)
            storage.add_profile(draft)
            return draft

    def edit_draft(
        self,
        source_id: UUID,
        version_id: UUID,
        configuration: Configuration,
        *,
        expected_revision: int | None = None,
    ):
        with self.sessions.begin() as session:
            storage, row, repo = self._locked_snapshot(session, source_id, version_id)
            if row.approval_status != "draft":
                raise ProfileError(
                    "profile_not_draft", "Only draft profiles may be edited"
                )
            if expected_revision is None:
                raise ProfileError(
                    "draft_revision_required", "Load the draft revision before saving"
                )
            if row.revision != expected_revision:
                raise ProfileError(
                    "draft_revision_conflict", "Draft changed since it was loaded"
                )
            edited = repo.edit_draft(version_id.hex, configuration)
            storage.save_profile(row, edited)
            row.revision += 1
            return edited

    def preview(
        self,
        source_id: UUID,
        version_id: UUID,
        entry: CollectionInput,
        evidence: LocalEvidenceStore,
    ):
        repo, _ = self._read_snapshot(source_id, version_id)
        return CollectionRunner(repo, evidence, rate=self.rate).preview(
            version_id.hex, entry
        )

    def validate(
        self,
        source_id: UUID,
        version_id: UUID,
        entry: CollectionInput,
        evidence: LocalEvidenceStore,
    ):
        repo, revision = self._read_snapshot(source_id, version_id)
        report = CollectionRunner(repo, evidence, rate=self.rate).validate(
            version_id.hex, entry
        )
        with self.sessions.begin() as session:
            storage, row, current = self._locked_snapshot(
                session, source_id, version_id
            )
            if row.revision != revision:
                raise ProfileError(
                    "stale_validation", "Draft changed during validation"
                )
            draft, _ = current.draft_for_preview(version_id.hex)
            current._save_validation(draft, report)
            storage.add_validation(row, report)
        return report

    def approve(
        self,
        source_id: UUID,
        version_id: UUID,
        *,
        approver: str,
        report_id: UUID,
        config_hash: Sha256,
    ):
        with self.sessions.begin() as session:
            storage, row, repo = self._locked_snapshot(
                session, source_id, version_id, with_report=True
            )
            if row.config_hash != config_hash:
                raise ProfileError(
                    "stale_validation",
                    "Approval requires the current configuration hash",
                )
            approved = repo.approve(
                version_id.hex, approver=approver, report_id=report_id.hex
            )
            storage.save_profile(row, approved)
            return approved

    def retire(self, source_id: UUID, version_id: UUID):
        with self.sessions.begin() as session:
            storage, row, repo = self._locked_snapshot(session, source_id, version_id)
            retired = repo.retire(version_id.hex)
            storage.save_profile(row, retired)
            return retired

    def _read_snapshot(self, source_id: UUID, version_id: UUID):
        with self.sessions() as session:
            storage = ProfileStorage(session)
            source = source_from_row(storage.source(source_id))
            row = storage.profile(source_id, version_id)
            repo = ProfileRepository.from_snapshot(
                source,
                profile_from_row(row),
                check_source_access=self._check_source_access,
            )
            return repo, row.revision

    def _check_source_access(self, source_id: str) -> Source:
        return self.get_source(UUID(source_id))

    @staticmethod
    def _locked_snapshot(session, source_id, version_id, *, with_report=False):
        storage = ProfileStorage(session)
        source = source_from_row(storage.source(source_id, lock=True))
        row = storage.profile(source_id, version_id)
        report = storage.latest_validation(row) if with_report else None
        repo = ProfileRepository.from_snapshot(source, profile_from_row(row), report)
        return storage, row, repo
