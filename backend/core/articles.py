"""Project accepted search-detail records through an approved Article mapping."""

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from unicodedata import normalize
from urllib.parse import urlsplit

from .contracts import (
    ArticleMapping,
    EvidenceReference,
    GenericRecord,
    Scalar,
    Source,
    canonical_json,
)
from .inputs import InputError
from .web_adapter import checked_url, url_key

MAX_ARTICLE_PAYLOAD_BYTES = 1024 * 1024


@dataclass(frozen=True)
class ArticleProjection:
    identity_hash: str
    identity_kind: str
    url: str
    content: dict[str, str | None]
    raw_payload: dict[str, Scalar]


def _mapped_url(
    source: Source, evidence: EvidenceReference, value: Scalar
) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        validated, origin = checked_url(source, value)
        _, detail_origin = checked_url(source, evidence.original_location)
        # Legacy fixture rules are looser than public HTTPS. Keep article URLs printable.
        if (
            origin == detail_origin
            and validated.isascii()
            and urlsplit(validated).netloc
        ):
            normalized = url_key(validated)
            return normalized if len(normalized) <= 2048 else None
    except (InputError, ValueError):
        return None
    return None


def _text(value: Scalar) -> str | None:
    return (
        (normalize("NFC", " ".join(value.split())) or None)
        if isinstance(value, str)
        else None
    )


def _publication_time(value: str) -> str:
    published = datetime.fromisoformat(value)
    if published.utcoffset() is None:
        raise ValueError("Publication timestamp requires an explicit timezone")
    return published.astimezone(UTC).isoformat()


def article_projection(
    source: Source,
    mapping: ArticleMapping,
    record: GenericRecord,
    evidence: EvidenceReference,
    candidate_count: int,
) -> ArticleProjection | None:
    if (
        evidence.capture_kind != "detail"
        or not 200 <= (evidence.http_status or 0) < 300
    ):
        return None
    raw = record.extracted_payload
    if raw is None:
        return None
    try:
        raw_json = json.dumps(raw, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (ValueError, UnicodeError):
        return None
    if len(raw_json) > MAX_ARTICLE_PAYLOAD_BYTES or any(
        isinstance(value, str) and "\x00" in value for value in raw.values()
    ):
        return None

    def value(field: str | None) -> Scalar:
        return record.payload.get(field) if field is not None else None

    canonical = _mapped_url(source, evidence, value(mapping.canonical_url))
    detail = _mapped_url(source, evidence, evidence.original_location)
    url = canonical or detail
    if url is None:
        return None

    if mapping.stable_id:
        identity = value(mapping.stable_id)
        if type(identity) is not int and (
            not isinstance(identity, str)
            or not identity.isprintable()
            or len(identity) > 512
        ):
            return None
        kind = "key"
    else:
        if candidate_count != 1 or (mapping.canonical_url and canonical is None):
            return None
        identity, kind = url, "url"

    content = {
        field: _text(value(getattr(mapping, field)))
        for field in ("title", "author", "published_at", "summary", "body")
    }
    if content["title"] is None:
        return None
    if published := content["published_at"]:
        try:
            content["published_at"] = _publication_time(published)
        except (ValueError, OverflowError):
            return None

    return ArticleProjection(
        identity_hash=hashlib.sha256(canonical_json([kind, identity])).hexdigest(),
        identity_kind=kind,
        url=url,
        content=content,
        raw_payload=raw,
    )
