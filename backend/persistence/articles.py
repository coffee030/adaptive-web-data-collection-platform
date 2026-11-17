"""Publish article observations in the terminal Job transaction."""

from collections import Counter, defaultdict
from hashlib import sha256
from uuid import uuid4, uuid5

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from backend.core.articles import ArticleProjection, article_projection
from backend.core.contracts import (
    ArticleMapping,
    CollectionRunResult,
    EvidenceReference,
    canonical_json,
)

from .collection import ArticleRow, ContentVersionRow, ObservationRow
from .models import JobRow, ProfileRow, SourceRow
from .profiles import source_from_row


def publish_articles(
    session: Session, job: JobRow, result: CollectionRunResult
) -> None:
    if not any(record.extracted_payload is not None for record in result.records):
        return
    configuration = session.get(ProfileRow, job.profile_version_id).configuration
    if not configuration.get("article"):
        return
    mapping = ArticleMapping.model_validate(configuration["article"])
    source = source_from_row(session.get(SourceRow, job.source_id))
    evidence = {item.evidence_id: item for item in result.all_evidence}
    counts = Counter(
        item.evidence_reference
        for item in (*result.records, *result.invalid, *result.duplicates)
    )
    projected: dict[str, list[tuple[ArticleProjection, EvidenceReference, str]]] = (
        defaultdict(list)
    )
    for record in result.records:
        capture = evidence[record.evidence_reference]
        article = article_projection(
            source, mapping, record, capture, counts[capture.evidence_id]
        )
        if article is not None:
            projected[article.identity_hash].append(
                (article, capture, record.record_id)
            )

    if not projected:
        return
    session.flush()  # Observations refer to the just-staged Generic Records.
    # Acquire identity locks in a global order across concurrent publications.
    for identity_hash, observations in sorted(projected.items()):
        projection = observations[0][0]
        if projection.identity_kind == "url" and len(observations) > 1:
            # A page-level canonical URL shared by separate detail results is ambiguous.
            continue
        session.execute(
            insert(ArticleRow)
            .values(
                id=uuid4(),
                source_id=job.source_id,
                identity_hash=identity_hash,
                identity_kind=projection.identity_kind,
            )
            .on_conflict_do_nothing(constraint="uq_source_article_identity")
        )
        article = session.scalars(
            select(ArticleRow)
            .where(
                ArticleRow.source_id == job.source_id,
                ArticleRow.identity_hash == identity_hash,
            )
            .with_for_update()
        ).one()
        for projection, capture, record_key in observations:
            content_version = _version(session, article, projection)
            session.add(
                ObservationRow(
                    record_id=uuid5(job.id, record_key),
                    article_id=article.id,
                    content_version_id=content_version.id,
                    captured_at=capture.captured_at,
                    url=projection.url,
                    raw_payload=projection.raw_payload,
                )
            )


def _version(session, article, projection):
    digest = sha256(canonical_json(projection.content)).hexdigest()
    version = session.scalar(
        select(ContentVersionRow).where(
            ContentVersionRow.article_id == article.id,
            ContentVersionRow.content_hash == digest,
        )
    )
    if version is None:
        last_number = session.scalar(
            select(func.max(ContentVersionRow.version)).where(
                ContentVersionRow.article_id == article.id
            )
        )
        version = ContentVersionRow(
            id=uuid4(),
            article_id=article.id,
            version=(last_number or 0) + 1,
            content_hash=digest,
            content=projection.content,
        )
        session.add(version)
        session.flush()
    return version
