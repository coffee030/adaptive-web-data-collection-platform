from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints, model_validator

from .contracts import Campaign, Platform, Scenario, StrictModel


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
    scenario: Scenario | None = None
    discovery_scope: Literal["campaign_channels", "all_sources"] = "campaign_channels"
    max_evidence_age_days: int | None = Field(default=None, ge=1, le=3650)

    @model_validator(mode="after")
    def distinct_channels(self):
        channels = [self.campaign.platform, *self.alternative_platforms]
        if len(channels) != len(set(channels)):
            raise ValueError("Choose distinct channels for comparison")
        if self.scenario and self.scenario.currency != self.campaign.currency:
            raise ValueError("Use the campaign currency for outcome assumptions")
        return self


class NewResearch(StrictModel):
    request_key: UUID
    brief: BusinessBrief
    campaign_id: UUID | None = None
