"""Eligible catalog projection with evidence at every creator-facing boundary."""

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from pydantic import BaseModel

from .analytics import Historical, history
from .contracts import (
    Audience,
    Content,
    Origin,
    Performance,
    Profile,
    Quote,
)
from .semantic import content_key
from .store import Dataset, Snapshot

AUDIENCE_WINDOW = timedelta(days=90)


class Evidence(BaseModel):
    dataset_id: str
    origin: Origin
    attribution: str
    row_id: str
    reference: str
    source_url: str | None = None
    observed_at: datetime
    expires_at: datetime


class Observed[T](BaseModel):
    data: T
    evidence: Evidence


@dataclass
class EligibleContent:
    record: Observed[Content]
    key: str
    grams: dict[str, int]
    vector: list[float] | None
    performance: Observed[Performance] | None = None


@dataclass
class Creator:
    record: Observed[Profile]
    posts: list[EligibleContent] = field(default_factory=list)
    quotes: list[Observed[Quote]] = field(default_factory=list)
    audiences: list[Observed[Audience]] = field(default_factory=list)

    @property
    def id(self) -> str:
        return self.record.data.creator_id

    def history(self, platform=None) -> Historical:
        return history(
            [
                post.performance.data
                for post in self.posts
                if post.performance
                and (platform is None or post.record.data.platform == platform)
            ]
        )

    def active_quotes(self) -> list[Observed[Quote]]:
        return [
            item
            for item in self.quotes
            if item.data.quote_type == "firm" and item.data.amount_minor is not None
        ]


def evidence(dataset: Dataset, row) -> Evidence:
    grant = dataset.body.grant
    return Evidence(
        dataset_id=dataset.id,
        origin=grant.origin,
        attribution=grant.attribution,
        row_id=row.id,
        reference=row.evidence_ref,
        source_url=str(row.source_url) if row.source_url else None,
        observed_at=row.observed_at,
        expires_at=grant.expires_at,
    )


def _newest(records):
    return sorted(
        records,
        key=lambda item: (
            item.data.observed_at,
            item.evidence.dataset_id,
            item.data.id,
        ),
        reverse=True,
    )


class Catalog:
    def __init__(self, snapshot: Snapshot):
        self.snapshot = snapshot
        self.creators: dict[str, Creator] = {}
        entries = [
            (dataset, row)
            for dataset in snapshot.datasets
            for row in dataset.body.records
            if row.observed_at <= snapshot.as_of
        ]
        for dataset, row in entries:
            if isinstance(row, Profile):
                self.creators[row.creator_id] = Creator(
                    Observed[Profile](data=row, evidence=evidence(dataset, row))
                )
        posts: dict[tuple[str, str], EligibleContent] = {}
        survey = []
        performance = []
        for dataset, row in entries:
            creator = self.creators.get(row.creator_id)
            if creator is None or isinstance(row, Profile):
                continue
            accounts = creator.record.data.accounts
            if not any(account.platform == row.platform for account in accounts):
                continue
            if isinstance(row, Content):
                if not any(
                    account.platform == row.platform
                    and account.account_id == row.account_id
                    for account in accounts
                ):
                    continue
                key = content_key(row.text)
                post = EligibleContent(
                    Observed[Content](data=row, evidence=evidence(dataset, row)),
                    key,
                    dataset.grams[key],
                    dataset.vectors.get(key),
                )
                creator.posts.append(post)
                posts[row.platform, row.id] = post
            elif isinstance(row, Performance):
                performance.append(
                    Observed[Performance](data=row, evidence=evidence(dataset, row))
                )
            elif isinstance(row, Quote) and row.valid_until > snapshot.as_of:
                creator.quotes.append(
                    Observed[Quote](data=row, evidence=evidence(dataset, row))
                )
            elif (
                isinstance(row, Audience)
                and row.period_end > snapshot.as_of - AUDIENCE_WINDOW
            ):
                survey.append(
                    Observed[Audience](data=row, evidence=evidence(dataset, row))
                )
        for item in _newest(performance):
            row = item.data
            post = posts.get((row.platform, row.post_id))
            if (
                post
                and not post.performance
                and (
                    post.record.data.creator_id == row.creator_id
                    and row.window_end
                    == post.record.data.published_at + timedelta(days=7)
                )
            ):
                post.performance = item
        groups = set()
        for item in _newest(survey):
            row = item.data
            group = (row.creator_id, row.platform, row.market)
            if group not in groups:
                self.creators[row.creator_id].audiences.append(item)
                groups.add(group)
        for creator in self.creators.values():
            creator.posts.sort(
                key=lambda post: (post.record.data.published_at, post.record.data.id),
                reverse=True,
            )
            creator.quotes = _newest(creator.quotes)


class CreatorSummary(BaseModel):
    profile: Observed[Profile]
    post_count: int
    pricing: str
    audience: str


class PostDetail(BaseModel):
    content: Observed[Content]
    performance: Observed[Performance] | None


class CreatorDetail(CreatorSummary):
    posts: list[PostDetail]
    historical: Historical | None
    historical_by_platform: dict[str, Historical]
    quotes: list[Observed[Quote]]
    audiences: list[Observed[Audience]]


def summary(creator: Creator) -> CreatorSummary:
    return CreatorSummary(
        profile=creator.record,
        post_count=len(creator.posts),
        pricing="available" if creator.active_quotes() else "unknown",
        audience="available"
        if any(row.data.share is not None for row in creator.audiences)
        else "unknown",
    )


def detail(creator: Creator) -> CreatorDetail:
    platforms = sorted({account.platform for account in creator.record.data.accounts})
    historical = {platform: creator.history(platform) for platform in platforms}
    return CreatorDetail(
        **summary(creator).model_dump(),
        posts=[
            PostDetail(content=post.record, performance=post.performance)
            for post in creator.posts[:20]
        ],
        historical=historical[platforms[0]] if len(platforms) == 1 else None,
        historical_by_platform=historical,
        quotes=creator.active_quotes(),
        audiences=creator.audiences,
    )
