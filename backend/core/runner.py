"""Synchronous preview, validation, and controlled collection."""

import hashlib
from dataclasses import replace
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
from .web_adapter import capture_html, html_candidates, next_page, url_key

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
            config = draft.configuration
            if isinstance(config, ExtractionConfiguration) and config.pagination:
                visited = {url_key(document.location)}
                if document.requested_location:
                    visited.add(url_key(document.requested_location))
                next_page(source, document, config, visited)
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
        evidence: list[EvidenceReference] = []
        records = []
        invalid = []
        duplicates = []
        failure = None
        try:
            profile, source = self.profiles.approved_for_run(profile_version_id)
            config = profile.configuration
            pagination = (
                config.pagination
                if isinstance(config, ExtractionConfiguration)
                else None
            )
            max_pages = pagination.max_pages if pagination else 1
            visited = set() if pagination else None
            seen: set[str] = set()
            for page_number in range(1, max_pages + 1):
                try:
                    document = self._capture(source, entry, visited=visited)
                except InputError as error:
                    if error.capture:
                        evidence.append(
                            self.evidence.save(
                                replace(error.capture, page_number=page_number),
                                profile,
                                run_id,
                            )
                        )
                    raise
                capture = self.evidence.save(
                    replace(document, page_number=page_number), profile, run_id
                )
                evidence.append(capture)
                processed = self._process(profile, document, seen=seen)
                records.extend(processed.records(config.record_schema, capture))
                lineage = {"evidence_reference": capture.evidence_id}
                invalid.extend(
                    item.model_copy(update=lineage) for item in processed.invalid
                )
                duplicates.extend(
                    item.model_copy(update=lineage) for item in processed.duplicates
                )

                if not isinstance(config, ExtractionConfiguration) or visited is None:
                    break
                following = next_page(source, document, config, visited)
                if following is None:
                    break
                if page_number == max_pages:
                    raise InputError(
                        "page_limit_reached",
                        "Next page exceeds the approved pagination limit",
                    )
                entry = following
        except InputError as error:
            failure = error.error
        except (ProfileError, EvidenceError) as error:
            failure = CollectionError(code=error.code, message=str(error))

        if not records:
            status = "failed"
            failure = failure or CollectionError(
                code="no_valid_records",
                message="All candidate records failed validation",
            )
        elif failure or invalid:
            status = "partial"
        else:
            status = "completed"
        return CollectionRunResult(
            run_id=run_id,
            profile_version_id=profile_version_id,
            status=status,
            evidence=evidence[0] if evidence else None,
            additional_evidence=tuple(evidence[1:]),
            records=tuple(records),
            invalid=tuple(invalid),
            duplicates=tuple(duplicates),
            error=failure,
        )

    def _capture(
        self, source: Source, entry: CollectionInput, *, visited: set[str] | None = None
    ) -> CapturedInput:
        if source.adapter_type == "web" and isinstance(entry, WebInput):
            return capture_html(
                source,
                entry,
                check_access=lambda: self.profiles.require_authorized(source.source_id),
                visited=visited,
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
        self,
        profile: SourceProfileVersion,
        document: CapturedInput,
        *,
        seen: set[str] | None = None,
    ) -> IngestionResult:
        return ingest(
            self._candidates(profile, document),
            profile.configuration.record_schema,
            profile.source_id,
            seen=seen,
        )
