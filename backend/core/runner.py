"""Synchronous preview, validation, and controlled collection."""

import hashlib
from datetime import UTC, datetime
from uuid import uuid4

from .contracts import (
    CandidateRecord,
    CollectionError,
    CollectionRunResult,
    CsvMappingConfiguration,
    EvidenceReference,
    ExtractionConfiguration,
    ProfileValidationReport,
    Source,
    SourceProfileVersion,
)
from .csv_adapter import capture_csv, csv_candidates
from .evidence import EvidenceError, LocalEvidenceStore
from .ingestion import IngestionResult, ingest
from .inputs import CapturedInput, CsvInput, InputError, WebInput
from .profiles import ProfileError, ProfileRepository
from .web_adapter import capture_html, html_candidates

CollectionInput = WebInput | CsvInput


class CollectionRunner:
    def __init__(
        self, profiles: ProfileRepository, evidence: LocalEvidenceStore
    ) -> None:
        self.profiles = profiles
        self.evidence = evidence

    def preview(
        self, profile_version_id: str, entry: CollectionInput
    ) -> tuple[CandidateRecord, ...]:
        draft, source = self.profiles.draft_for_preview(profile_version_id)
        document = self._capture(source, entry)
        return tuple(self._candidates(draft, document)[:5])

    def validate(
        self, profile_version_id: str, entry: CollectionInput
    ) -> ProfileValidationReport:
        draft, source = self.profiles.draft_for_preview(profile_version_id)
        document = None
        result = None
        failure = None
        try:
            document = self._capture(source, entry)
            result = self._process(draft, document)
        except InputError as error:
            document = document or error.capture
            failure = error.error

        report = ProfileValidationReport(
            report_id=uuid4().hex,
            profile_version_id=draft.profile_version_id,
            config_hash=draft.config_hash,
            sample_location=document.location if document else None,
            sample_hash=hashlib.sha256(document.body).hexdigest() if document else None,
            validated_at=datetime.now(UTC),
            valid_count=len(result.valid) if result else 0,
            invalid_count=len(result.invalid) if result else 0,
            duplicate_count=len(result.duplicates) if result else 0,
            invalid=tuple(result.invalid) if result else (),
            error=failure,
        )
        self.profiles._save_validation(draft, report)
        return report

    def run(
        self, profile_version_id: str, entry: CollectionInput
    ) -> CollectionRunResult:
        run_id = uuid4().hex
        evidence = None
        try:
            profile, source = self.profiles.approved_for_run(profile_version_id)
            try:
                document = self._capture(source, entry)
            except InputError as error:
                if error.capture:
                    evidence = self.evidence.save(error.capture, profile, run_id)
                raise
            evidence = self.evidence.save(document, profile, run_id)
            processed = self._process(profile, document)
        except InputError as error:
            return self._failed(run_id, profile_version_id, error.error, evidence)
        except (ProfileError, EvidenceError) as error:
            return self._failed(
                run_id,
                profile_version_id,
                CollectionError(code=error.code, message=str(error)),
                evidence,
            )

        failure = None
        if not processed.valid:
            status = "failed"
            failure = CollectionError(
                code="no_valid_records",
                message="All candidate records failed validation",
            )
        elif processed.invalid:
            status = "partial"
        else:
            status = "completed"
        return CollectionRunResult(
            run_id=run_id,
            profile_version_id=profile_version_id,
            status=status,
            evidence=evidence,
            records=processed.records(profile.configuration.record_schema, evidence),
            invalid=tuple(processed.invalid),
            duplicates=tuple(processed.duplicates),
            error=failure,
        )

    def _capture(self, source: Source, entry: CollectionInput) -> CapturedInput:
        if source.adapter_type == "web" and isinstance(entry, WebInput):
            return capture_html(
                source,
                entry,
                check_access=lambda: self.profiles.require_authorized(source.source_id),
            )
        if source.adapter_type == "csv" and isinstance(entry, CsvInput):
            return capture_csv(source, entry)
        raise InputError(
            "input_adapter_mismatch",
            "Input type does not match the approved source adapter",
        )

    @staticmethod
    def _candidates(
        profile: SourceProfileVersion, document: CapturedInput
    ) -> list[CandidateRecord]:
        configuration = profile.configuration
        if isinstance(configuration, ExtractionConfiguration):
            return html_candidates(document, configuration)
        if isinstance(configuration, CsvMappingConfiguration):
            return csv_candidates(document, configuration)
        raise InputError("input_adapter_mismatch", "Profile has an unsupported adapter")

    def _process(
        self, profile: SourceProfileVersion, document: CapturedInput
    ) -> IngestionResult:
        return ingest(
            self._candidates(profile, document),
            profile.configuration.record_schema,
            profile.source_id,
        )

    @staticmethod
    def _failed(
        run_id: str,
        profile_version_id: str,
        error: CollectionError,
        evidence: EvidenceReference | None,
    ) -> CollectionRunResult:
        return CollectionRunResult(
            run_id=run_id,
            profile_version_id=profile_version_id,
            status="failed",
            evidence=evidence,
            error=error,
        )
