"""Explicit mapping between PostgreSQL rows and M1 domain contracts."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from backend.core.contracts import ProfileValidationReport, Source, SourceProfileVersion
from backend.core.profiles import ProfileError

from .models import ProfileRow, SourceRow, ValidationRow


def source_from_row(row: SourceRow) -> Source:
    return Source(
        source_id=row.id.hex,
        source_name=row.name,
        adapter_type=row.adapter_type,
        permission_reference=row.permission_reference,
        approval_status=row.approval_status,
        **row.access_policy,
    )


def profile_from_row(row: ProfileRow) -> SourceProfileVersion:
    return SourceProfileVersion(
        profile_version_id=row.id.hex,
        source_id=row.source_id.hex,
        version=row.version,
        configuration=row.configuration,
        config_hash=row.config_hash,
        approval_status=row.approval_status,
        approved_by=row.approved_by,
        approved_at=row.approved_at,
        validation_report_id=row.validation_report_id.hex
        if row.validation_report_id
        else None,
    )


class ProfileStorage:
    def __init__(self, session: Session):
        self.session = session

    def source(self, source_id: UUID, *, lock: bool = False) -> SourceRow:
        row = self.session.get(SourceRow, source_id, with_for_update=lock)
        if row is None:
            raise ProfileError("source_not_found", "Source is not registered")
        return row

    def profile(self, source_id: UUID, version_id: UUID) -> ProfileRow:
        row = self.session.get(ProfileRow, version_id)
        if row is None or row.source_id != source_id:
            raise ProfileError("profile_not_found", "Profile version does not exist")
        return row

    def latest(self, source_id: UUID) -> ProfileRow | None:
        return self.session.scalar(
            select(ProfileRow)
            .where(ProfileRow.source_id == source_id)
            .order_by(ProfileRow.version.desc())
            .limit(1)
        )

    @staticmethod
    def _source_values(source: Source):
        return {
            "id": UUID(source.source_id),
            "name": source.source_name,
            "adapter_type": source.adapter_type,
            "permission_reference": source.permission_reference,
            "approval_status": source.approval_status,
            "access_policy": source.model_dump(
                mode="json", include={"allowed_origins", "allowed_datasets"}
            ),
        }

    def add_source(self, source: Source) -> SourceRow:
        row = SourceRow(**self._source_values(source))
        self.session.add(row)
        return row

    def register_source_once(self, source: Source, key: UUID, digest: str):
        inserted = self.session.scalar(
            insert(SourceRow)
            .values(**self._source_values(source), request_key=key, request_hash=digest)
            .on_conflict_do_nothing(constraint="uq_source_request_key")
            .returning(SourceRow)
        )
        if inserted is not None:
            return inserted, True
        existing = self.session.scalars(
            select(SourceRow).where(SourceRow.request_key == key)
        ).one()
        if existing.request_hash != digest:
            raise ProfileError(
                "source_request_conflict",
                "Request key belongs to a different registration",
            )
        return existing, False

    def add_profile(self, profile: SourceProfileVersion) -> ProfileRow:
        row = ProfileRow(
            id=UUID(profile.profile_version_id),
            source_id=UUID(profile.source_id),
            version=profile.version,
        )
        self.save_profile(row, profile)
        self.session.add(row)
        return row

    def latest_validation(self, profile: ProfileRow) -> ProfileValidationReport | None:
        row = self.session.scalar(
            select(ValidationRow)
            .where(
                ValidationRow.profile_version_id == profile.id,
                ValidationRow.revision == profile.revision,
            )
            .order_by(ValidationRow.sequence.desc())
            .limit(1)
        )
        if row is None:
            return None
        return ProfileValidationReport(
            report_id=row.id.hex,
            profile_version_id=row.profile_version_id.hex,
            config_hash=row.config_hash,
            validated_at=row.validated_at,
            **row.result,
        )

    def add_validation(
        self, profile: ProfileRow, report: ProfileValidationReport
    ) -> None:
        self.session.add(
            ValidationRow(
                id=UUID(report.report_id),
                profile_version_id=profile.id,
                revision=profile.revision,
                config_hash=report.config_hash,
                validated_at=report.validated_at,
                result=report.model_dump(
                    mode="json",
                    exclude={
                        "report_id",
                        "profile_version_id",
                        "config_hash",
                        "validated_at",
                    },
                ),
            )
        )

    @staticmethod
    def save_profile(row: ProfileRow, profile: SourceProfileVersion) -> None:
        row.configuration = profile.configuration.model_dump(mode="json")
        row.config_hash = profile.config_hash
        row.approval_status = profile.approval_status
        row.approved_by = profile.approved_by
        row.approved_at = profile.approved_at
        row.validation_report_id = (
            UUID(profile.validation_report_id) if profile.validation_report_id else None
        )
