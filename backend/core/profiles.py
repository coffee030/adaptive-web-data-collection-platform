"""In-memory Source and Profile lifecycle for the synchronous M1 Core."""

from collections.abc import Callable
from datetime import UTC, datetime
from threading import RLock
from uuid import uuid4

from .contracts import (
    Configuration,
    ProfileValidationReport,
    Source,
    SourceProfileVersion,
)


class ProfileError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class ProfileRepository:
    def __init__(self) -> None:
        self._sources: dict[str, Source] = {}
        self._versions: dict[str, SourceProfileVersion] = {}
        self._reports: dict[str, ProfileValidationReport] = {}
        self._lock = RLock()
        self._check_source_access: Callable[[str], Source] = self.get_source

    @classmethod
    def from_snapshot(
        cls,
        source: Source,
        version: SourceProfileVersion | None = None,
        report: ProfileValidationReport | None = None,
        *,
        check_source_access: Callable[[str], Source] | None = None,
    ) -> "ProfileRepository":
        """Restore trusted state for a single operation without replaying approval."""
        repository = cls()
        repository.register_source(source)
        if version is not None:
            repository._versions[version.profile_version_id] = version
        if report is not None:
            repository._reports[report.profile_version_id] = report
        if check_source_access is not None:
            repository._check_source_access = check_source_access
        return repository

    def register_source(self, source: Source) -> None:
        source = Source.model_validate(source)
        with self._lock:
            if source.source_id in self._sources:
                raise ProfileError(
                    "duplicate_source", "Source ID is already registered"
                )
            self._sources[source.source_id] = source

    def get_source(self, source_id: str) -> Source:
        with self._lock:
            try:
                return self._sources[source_id]
            except KeyError:
                raise ProfileError(
                    "source_not_found", "Source is not registered"
                ) from None

    def set_source_authorization(self, source: Source) -> None:
        source = Source.model_validate(source)
        with self._lock:
            current = self.get_source(source.source_id)
            if current.model_dump(exclude={"approval_status"}) != source.model_dump(
                exclude={"approval_status"}
            ):
                raise ProfileError(
                    "source_policy_changed", "Only source authorization may change"
                )
            self._sources[source.source_id] = source

    def get_version(self, profile_version_id: str) -> SourceProfileVersion:
        with self._lock:
            try:
                return self._versions[profile_version_id]
            except KeyError:
                raise ProfileError(
                    "profile_not_found", "Profile version does not exist"
                ) from None

    def create_draft(
        self, source_id: str, configuration: Configuration
    ) -> SourceProfileVersion:
        with self._lock:
            self._check_adapter(self.get_source(source_id), configuration)
            versions = (
                item.version
                for item in self._versions.values()
                if item.source_id == source_id
            )
            draft = SourceProfileVersion(
                profile_version_id=uuid4().hex,
                source_id=source_id,
                version=max(versions, default=0) + 1,
                configuration=configuration,
                config_hash=configuration.config_hash(),
            )
            self._versions[draft.profile_version_id] = draft
            return draft

    def edit_draft(
        self, profile_version_id: str, configuration: Configuration
    ) -> SourceProfileVersion:
        with self._lock:
            draft = self._require_draft(profile_version_id)
            self._check_adapter(self.get_source(draft.source_id), configuration)
            edited = self._replace(
                draft,
                configuration=configuration,
                config_hash=configuration.config_hash(),
            )
            self._reports.pop(profile_version_id, None)
            return edited

    def draft_for_preview(
        self, profile_version_id: str
    ) -> tuple[SourceProfileVersion, Source]:
        with self._lock:
            draft = self._require_draft(profile_version_id)
            return draft, self.require_authorized(draft.source_id)

    def get_validation(self, profile_version_id: str) -> ProfileValidationReport | None:
        with self._lock:
            self.get_version(profile_version_id)
            return self._reports.get(profile_version_id)

    def _save_validation(
        self, draft: SourceProfileVersion, report: ProfileValidationReport
    ) -> None:
        with self._lock:
            if (
                self._require_draft(draft.profile_version_id) is not draft
                or report.profile_version_id != draft.profile_version_id
                or report.config_hash != draft.config_hash
            ):
                raise ProfileError(
                    "stale_validation", "Draft changed during validation"
                )
            self.require_authorized(draft.source_id)
            self._reports[draft.profile_version_id] = report

    def approve(
        self, profile_version_id: str, *, approver: str, report_id: str
    ) -> SourceProfileVersion:
        with self._lock:
            draft = self._require_draft(profile_version_id)
            self.require_authorized(draft.source_id)
            report = self._reports.get(profile_version_id)
            if (
                report is None
                or report.report_id != report_id
                or report.config_hash != draft.config_hash
            ):
                raise ProfileError(
                    "stale_validation",
                    "Approval requires the current validation report",
                )
            if not report.passed:
                raise ProfileError(
                    "validation_failed",
                    "Only a passing validation report can be approved",
                )
            if not approver.strip():
                raise ProfileError(
                    "approver_required", "An explicit approver is required"
                )
            return self._replace(
                draft,
                approval_status="approved",
                approved_by=approver,
                approved_at=datetime.now(UTC),
                validation_report_id=report.report_id,
            )

    def retire(self, profile_version_id: str) -> SourceProfileVersion:
        with self._lock:
            version = self.get_version(profile_version_id)
            if version.approval_status != "approved":
                raise ProfileError(
                    "profile_not_approved", "Only approved profiles may be retired"
                )
            return self._replace(version, approval_status="retired")

    def approved_for_run(
        self, profile_version_id: str
    ) -> tuple[SourceProfileVersion, Source]:
        with self._lock:
            profile = self.get_version(profile_version_id)
            if profile.approval_status != "approved":
                raise ProfileError(
                    "profile_not_approved", "An approved profile version is required"
                )
            return profile, self.require_authorized(profile.source_id)

    def require_authorized(self, source_id: str) -> Source:
        source = self._check_source_access(source_id)
        if source.approval_status != "approved":
            raise ProfileError("source_not_approved", "Source access is not authorized")
        return source

    def _require_draft(self, profile_version_id: str) -> SourceProfileVersion:
        profile = self.get_version(profile_version_id)
        if profile.approval_status != "draft":
            raise ProfileError(
                "profile_not_draft", "Only draft profiles may be edited or validated"
            )
        return profile

    @staticmethod
    def _check_adapter(source: Source, configuration: Configuration) -> None:
        if source.adapter_type != configuration.adapter_type:
            raise ProfileError(
                "adapter_mismatch", "Source and profile adapters must match"
            )

    def _replace(
        self, profile: SourceProfileVersion, **changes
    ) -> SourceProfileVersion:
        result = SourceProfileVersion.model_validate(
            {**profile.model_dump(), **changes}
        )
        self._versions[profile.profile_version_id] = result
        return result
