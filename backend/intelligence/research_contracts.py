from typing import Annotated
from uuid import UUID

from pydantic import Field, StringConstraints, model_validator

from .contracts import Campaign, Platform, StrictModel


Text = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=2, max_length=300)
]


class BusinessBrief(StrictModel):
    campaign: Campaign
    product: Text
    audience: Text
    discovery_focus: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)
        ]
        | None
    ) = None
    test_share: int = Field(default=60, ge=10, le=90)
    alternative_platforms: list[Platform] = Field(default_factory=list, max_length=2)

    @model_validator(mode="after")
    def distinct_channels(self):
        channels = [self.campaign.platform, *self.alternative_platforms]
        if len(channels) != len(set(channels)):
            raise ValueError("Choose distinct channels for comparison")
        return self


class NewResearch(StrictModel):
    request_key: UUID
    brief: BusinessBrief
    campaign_id: UUID | None = None
