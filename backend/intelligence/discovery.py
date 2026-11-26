"""Find corroborating historical material within a single eligible workspace."""

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .catalog import Catalog, Creator, Observed
from .contracts import Content, CreatorFilter
from .retrieval import (
    evidence_match,
    query_topics,
    required_words,
    scores,
    semantic_support,
    topics,
)
from .semantic import normalized

MatchBasis = Literal[
    "name", "description", "post_text", "reviewed_topic", "related_content"
]


@dataclass
class Match:
    creator: Creator
    preview: Observed[Content] | None
    basis: MatchBasis | None
    weight: int = 0
    score: float = 0


def discover(catalog: Catalog, filters: CreatorFilter, model_dir: Path | None):
    query = normalized(filters.query or "")
    pool = []
    for creator in catalog.creators.values():
        if filters.platform and not any(
            a.platform == filters.platform for a in creator.record.data.accounts
        ):
            continue
        audiences = [
            row
            for row in creator.audiences
            if (not filters.platform or row.data.platform == filters.platform)
            and (not filters.market or row.data.market == filters.market)
        ]
        if filters.market and not any(row.data.share is not None for row in audiences):
            continue
        posts = [
            p
            for p in creator.posts
            if (not filters.platform or p.record.data.platform == filters.platform)
            and (not filters.language or filters.language in p.record.data.languages)
        ]
        if posts or not filters.language:
            quotes = [
                row
                for row in creator.quotes
                if not filters.platform or row.data.platform == filters.platform
            ]
            pool.append(
                Creator(
                    record=creator.record,
                    posts=posts,
                    quotes=quotes,
                    audiences=audiences,
                )
            )
    method, similarity = (
        scores(query, [post for creator in pool for post in creator.posts], model_dir)
        if query
        else ("browse", {})
    )
    matches = []
    labels, words = query_topics(query), required_words(query)
    semantic = semantic_support(method, similarity) if not labels else set()
    for creator in pool:
        posts = creator.posts
        first = posts[0].record if posts else None
        if not query:
            matches.append(Match(creator, first, None))
            continue
        data = creator.record.data
        name_match = query in normalized(data.name)
        description_match = query in normalized(data.description)
        match = (
            Match(
                creator,
                first,
                "name" if name_match else "description",
                4 if name_match else 2,
            )
            if name_match or description_match
            else None
        )
        for post in posts:
            text = post.record.data.text
            priority = 3
            basis: MatchBasis = "post_text"
            if query not in normalized(text):
                if post.key not in semantic and not evidence_match(
                    post, labels, words, all_terms=True
                ):
                    continue
                fact_labels = topics(" ".join(post.record.data.reviewed_facts))
                basis = (
                    "reviewed_topic"
                    if labels and labels <= fact_labels
                    else "related_content"
                )
                priority = 1
            score = similarity[post.key]
            if not match or (priority, score) > (match.weight, match.score):
                match = Match(creator, post.record, basis, priority, score)
        if match is not None:
            matches.append(match)
    matches.sort(
        key=lambda row: (
            -row.weight,
            -row.score,
            row.creator.record.data.name.casefold(),
            row.creator.id,
        )
    )
    return method, matches
