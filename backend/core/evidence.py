"""Store and resolve raw local evidence with a metadata sidecar."""

import hashlib
import re
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from pydantic import ValidationError

from .contracts import EvidenceReference, SourceProfileVersion
from .inputs import CapturedInput

EVIDENCE_ID = re.compile(r"[0-9a-f]{32}")


class EvidenceError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class LocalEvidenceStore:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def save(
        self, document: CapturedInput, profile: SourceProfileVersion, run_id: str
    ) -> EvidenceReference:
        reference = EvidenceReference(
            evidence_id=uuid4().hex,
            source_id=profile.source_id,
            run_id=run_id,
            profile_version_id=profile.profile_version_id,
            config_hash=profile.config_hash,
            adapter_type=profile.configuration.adapter_type,
            original_location=document.location,
            requested_location=document.requested_location,
            captured_at=document.captured_at,
            content_hash=hashlib.sha256(document.body).hexdigest(),
            rendered_dom=document.rendered_dom,
            http_status=document.http_status,
            content_type=document.content_type,
            page_number=document.page_number,
            capture_kind=document.capture_kind,
        )
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            with TemporaryDirectory(prefix=".capture-", dir=self.root) as staging:
                entry = Path(staging) / "entry"
                entry.mkdir()
                (entry / "input.bin").write_bytes(document.body)
                if document.rendered_body is not None:
                    (entry / "rendered.html").write_bytes(document.rendered_body)
                (entry / "metadata.json").write_text(
                    reference.model_dump_json(indent=2), encoding="utf-8"
                )
                entry.rename(self.root / reference.evidence_id)
        except OSError as error:
            raise EvidenceError(
                "evidence_write_failed", "Could not store raw evidence and metadata"
            ) from error
        return reference

    def resolve(self, evidence_id: str) -> tuple[EvidenceReference, bytes]:
        if not EVIDENCE_ID.fullmatch(evidence_id):
            raise EvidenceError("invalid_evidence_id", "Evidence ID is malformed")
        entry = self.root / evidence_id
        metadata, content = entry / "metadata.json", entry / "input.bin"
        if (
            entry.is_symlink()
            or entry.is_junction()
            or metadata.is_symlink()
            or content.is_symlink()
        ):
            raise EvidenceError(
                "evidence_unreadable", "Evidence may not be a symbolic link"
            )
        try:
            reference = EvidenceReference.model_validate_json(metadata.read_bytes())
            body = content.read_bytes()
            if derived := reference.rendered_dom:
                dom = entry / "rendered.html"
                if (
                    dom.is_symlink()
                    or dom.stat().st_size != derived.byte_count
                    or hashlib.sha256(dom.read_bytes()).hexdigest() != derived.sha256
                ):
                    raise EvidenceError(
                        "evidence_integrity_error",
                        "Stored rendered DOM does not match its capture",
                    )
        except FileNotFoundError as error:
            raise EvidenceError(
                "evidence_not_found", "Evidence bytes or metadata are missing"
            ) from error
        except (OSError, ValidationError) as error:
            raise EvidenceError(
                "evidence_unreadable", "Evidence bytes or metadata could not be read"
            ) from error
        if (
            reference.evidence_id != evidence_id
            or hashlib.sha256(body).hexdigest() != reference.content_hash
        ):
            raise EvidenceError(
                "evidence_integrity_error", "Evidence identity or hash does not match"
            )
        return reference, body
