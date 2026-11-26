"""Normalized marketing data and its source-specific use restrictions."""

from datetime import timedelta
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field, StringConstraints, model_validator

CHANNEL_PATTERN = r"^UC[A-Za-z0-9_-]{22}$"
ChannelId = Annotated[str, StringConstraints(pattern=CHANNEL_PATTERN)]
VideoId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{11}$")]
Purpose = Literal[
    "research", "analytics", "aggregation", "training", "commercial", "export"
]
MetricStatus = Literal["available", "unavailable", "hidden", "expired", "unsupported"]
RunStatus = Literal["queued", "running", "succeeded", "failed"]
RETENTION = timedelta(days=28)
DISCOVERY_RETENTION = timedelta(days=1)
POLICY_URL = "https://developers.google.com/youtube/terms/developer-policies"
SOURCE_URL = "https://www.googleapis.com/youtube/v3/"


class Provenance(BaseModel):
    provider: Literal["youtube_data_api"] = "youtube_data_api"
    policy_url: Literal[POLICY_URL] = POLICY_URL
    endpoint: Literal["channels", "playlistItems", "videos", "search"]
    run_id: UUID
    observed_at: AwareDatetime
    expires_at: AwareDatetime


class Metric(BaseModel):
    status: MetricStatus
    value: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_value(self):
        if (self.status == "available") != (self.value is not None):
            raise ValueError("Only an available metric may have a numeric value")
        return self


class ChannelSnapshot(BaseModel):
    channel_id: ChannelId
    title: str
    url: str
    subscribers: Metric
    provenance: Provenance


class Post(BaseModel):
    video_id: VideoId
    channel_id: ChannelId
    title: str
    published_at: AwareDatetime
    url: str
    duration_iso8601: str | None
    category_id: str | None
    content_format: Literal["unsupported"] = "unsupported"
    views: Metric
    likes: Metric
    comments: Metric
    provenance: Provenance
    uploads_provenance: Provenance | None = None


class Lead(BaseModel):
    channel_id: ChannelId
    title: str
    url: str
    provenance: Provenance


class Run(BaseModel):
    id: UUID
    kind: Literal["refresh", "discovery"]
    status: RunStatus
    created_at: AwareDatetime
    finished_at: AwareDatetime | None
    attempts: int
    standard_units: int
    search_calls: int
    error_code: str | None
    available_after: AwareDatetime | None


class Account(BaseModel):
    creator_id: UUID
    platform: Literal["youtube"] = "youtube"
    channel_id: ChannelId
    refresh_hours: int
    next_refresh_at: AwareDatetime | None
    state: Literal["pending", "available", "unavailable", "expired", "withdrawn"]
    scan_truncated: bool
    last_run: Run | None
    snapshot: ChannelSnapshot | None
    posts: list[Post]


class DiscoveryResult(BaseModel):
    run: Run
    state: Literal["pending", "available", "expired", "unavailable"]
    leads: list[Lead]


class Capability(BaseModel):
    company_accounts: bool = False
    provider: Literal["youtube_data_api"] = "youtube_data_api"
    policy_url: Literal[POLICY_URL] = POLICY_URL
    permission_status: Literal["additional_permission_pending"] = (
        "additional_permission_pending"
    )
    permitted_purposes: tuple[Literal["research"], ...] = ("research",)
    retention_days: int = RETENTION.days
    customer_intelligence: Literal["available", "unavailable"] = "unavailable"
    demo_intelligence: Literal["available", "unavailable"] = "unavailable"


def permits_youtube(purpose: Purpose) -> bool:
    return purpose in Capability().permitted_purposes
