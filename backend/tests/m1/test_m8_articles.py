"""Article mapping and identity rules independent of transport and PostgreSQL."""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from backend.core.articles import article_projection
from backend.core.contracts import (
    ArticleMapping,
    CandidateRecord,
    EvidenceReference,
    ExtractionConfiguration,
    Source,
)
from backend.core.ingestion import ingest
from backend.tests.m7_fixture import search_config

ORIGIN = "https://example.com"
CONFIG = search_config(ORIGIN, "cards")


@pytest.fixture
def captures():
    source = Source(
        source_id="source",
        source_name="Fixture",
        adapter_type="web",
        permission_reference="fixture",
        approval_status="approved",
        allowed_origins=[ORIGIN],
        allowed_paths={ORIGIN: ["/m7/cards"]},
    )
    evidence = EvidenceReference(
        evidence_id="evidence",
        source_id=source.source_id,
        run_id="execution",
        profile_version_id="profile",
        config_hash="a" * 64,
        adapter_type="web",
        original_location=ORIGIN + "/m7/cards/detail/%7e1#fragment",
        captured_at=datetime.now(UTC),
        content_hash="b" * 64,
        http_status=200,
        capture_kind="detail",
    )
    return source, evidence


def generic_record(evidence):
    config = ExtractionConfiguration.model_validate(CONFIG)
    schema = config.record_schema
    item = CandidateRecord(
        source_position={"kind": "html_item", "index": 1},
        payload={"title": "A  title", "count": "007"},
    )
    result = ingest(
        [item],
        schema,
        evidence.source_id,
        article_detail_url=evidence.original_location,
    )
    (record,) = result.records(schema, evidence)
    return record


def test_multi_item_detail_keeps_separate_stable_ids(captures):
    source, evidence = captures
    schema = ExtractionConfiguration.model_validate(CONFIG).record_schema
    candidates = [
        CandidateRecord(
            source_position={"kind": "html_item", "index": index},
            payload={"title": "Shared headline", "count": str(index)},
        )
        for index in (1, 2)
    ]
    result = ingest(
        candidates,
        schema,
        source.source_id,
        article_detail_url=evidence.original_location,
        article_stable_id="count",
    )
    assert len(result.valid) == 2
    projections = [
        article_projection(
            source,
            ArticleMapping(title="title", stable_id="count"),
            record,
            evidence,
            2,
        )
        for record in result.records(schema, evidence)
    ]
    assert len({item.identity_hash for item in projections}) == 2


def test_default_url_identity_normalization_and_failed_capture(captures):
    source, evidence = captures
    record = generic_record(evidence)
    mapping = ArticleMapping(title="title")
    article = article_projection(source, mapping, record, evidence, 1)
    assert article.url == ORIGIN + "/m7/cards/detail/~1"
    assert article.content["title"] == "A title"
    assert article.raw_payload["count"] == "007"
    cleaned = evidence.model_copy(update={"original_location": article.url})
    assert (
        article_projection(source, mapping, record, cleaned, 1).identity_hash
        == article.identity_hash
    )
    assert article_projection(source, mapping, record, evidence, 2) is None
    assert (
        article_projection(
            source, mapping, record, evidence.model_copy(update={"http_status": 404}), 1
        )
        is None
    )


def test_validated_canonical_urls_and_explicit_stable_keys(captures):
    source, evidence = captures
    record = generic_record(evidence)
    for url in ("https://outside.example/m7/cards/1", ORIGIN + "/outside", None):
        candidate = record.model_copy(update={"payload": record.payload | {"url": url}})
        assert (
            article_projection(
                source,
                ArticleMapping(title="title", canonical_url="url"),
                candidate,
                evidence,
                1,
            )
            is None
        )
    url = ORIGIN + "/m7/cards/1?lang=en#section"
    candidate = record.model_copy(update={"payload": record.payload | {"url": url}})
    canonical = article_projection(
        source,
        ArticleMapping(title="title", canonical_url="url"),
        candidate,
        evidence,
        1,
    )
    assert canonical.url == url.split("#")[0]

    mapping = ArticleMapping(title="title", stable_id="count")
    first = article_projection(source, mapping, record, evidence, 2)
    moved = evidence.model_copy(
        update={"original_location": ORIGIN + "/m7/cards/detail/moved"}
    )
    assert (
        article_projection(source, mapping, record, moved, 2).identity_hash
        == first.identity_hash
    )
    different = record.model_copy(update={"payload": record.payload | {"count": 8}})
    assert (
        article_projection(source, mapping, different, evidence, 2).identity_hash
        != first.identity_hash
    )
    missing = record.model_copy(update={"payload": record.payload | {"count": None}})
    assert article_projection(source, mapping, missing, evidence, 1) is None


def test_publication_timestamp_requires_comparable_value(captures):
    source, evidence = captures
    record = generic_record(evidence)
    mapping = ArticleMapping(title="title", published_at="published")
    with_timestamp = record.model_copy(
        update={"payload": record.payload | {"published": "2026-11-16T12:00:00+08:00"}}
    )
    normalized = article_projection(source, mapping, with_timestamp, evidence, 1)
    assert normalized.content["published_at"] == "2026-11-16T04:00:00+00:00"
    invalid = record.model_copy(
        update={"payload": record.payload | {"published": "2026-11-16"}}
    )
    assert article_projection(source, mapping, invalid, evidence, 1) is None
    assert (
        article_projection(source, mapping, record, evidence, 1).content["published_at"]
        is None
    )


def test_mapping_is_opt_in_validated_and_pinned():
    config = ExtractionConfiguration.model_validate(CONFIG)
    assert "article" not in config.model_dump()
    assert (
        ExtractionConfiguration.model_validate(CONFIG | {"article": None}).config_hash()
        == config.config_hash()
    )
    article = {"title": "title", "stable_id": "count"}
    assert (
        ExtractionConfiguration.model_validate(
            CONFIG | {"article": article}
        ).config_hash()
        != config.config_hash()
    )
    for invalid in (
        {"title": "count"},
        {"title": "unknown"},
        {"title": "title", "author": "count"},
    ):
        with pytest.raises(ValidationError):
            ExtractionConfiguration.model_validate(CONFIG | {"article": invalid})
    with pytest.raises(ValidationError, match="requires keyword search"):
        ExtractionConfiguration.model_validate(
            CONFIG | {"search": None, "article": article}
        )
