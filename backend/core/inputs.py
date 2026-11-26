"""Controlled inputs and captured document metadata."""

from dataclasses import dataclass, field
from datetime import UTC, datetime

from .contracts import CaptureKind, CollectionError, RenderedEvidence


@dataclass(frozen=True)
class WebInput:
    url: str


@dataclass(frozen=True)
class KeywordInput:
    keyword: str


@dataclass(frozen=True)
class CsvInput:
    dataset_id: str
    content: bytes


@dataclass(frozen=True)
class CapturedInput:
    body: bytes
    location: str
    http_status: int | None = None
    content_type: str | None = None
    requested_location: str | None = None
    captured_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    retry_after_seconds: int | None = None
    page_number: int = 1
    capture_kind: CaptureKind = "input"
    publisher_csp: str | None = None
    rendered_body: bytes | None = None
    rendered_dom: RenderedEvidence | None = None


class InputError(ValueError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        capture: CapturedInput | None = None,
        http_status: int | None = None,
        retry_after_seconds: int | None = None,
    ) -> None:
        super().__init__(message)
        self.error = CollectionError(
            code=code,
            message=message,
            http_status=capture.http_status if capture else http_status,
            retry_after_seconds=capture.retry_after_seconds
            if capture
            else retry_after_seconds,
        )
        self.capture = capture
