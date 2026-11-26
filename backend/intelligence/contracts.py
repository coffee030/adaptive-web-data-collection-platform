"""Partner grants and campaign inputs used by the intelligence API."""

from decimal import Decimal
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

Ref = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")]
Label = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
Currency = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]
Market = Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}$")]
Count = Annotated[int, Field(strict=True, ge=0, le=1_000_000_000_000)]
Money = Annotated[int, Field(strict=True, ge=0, le=1_000_000_000)]
Share = Annotated[Decimal, Field(ge=0, le=1, max_digits=7, decimal_places=6)]
Language = Literal["en", "zh-Hant", "yue", "mix"]
Platform = Literal["youtube", "instagram", "tiktok", "facebook", "other"]
Deliverable = Literal[
    "video_integration", "dedicated_video", "short_video", "social_post"
]
Mode = Literal["demo", "partner"]
Origin = Literal[
    "synthetic",
    "creator_profile",
    "creator_authored",
    "creator_quote",
    "creator_first_party_performance",
    "creator_opt_in_survey",
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Grant(StrictModel):
    owner_ref: Ref
    authorization_ref: Ref
    origin: Origin
    attribution: Label
    expires_at: AwareDatetime
    academic_demo: bool = False
    pilot_analytics: bool = False
    commercial_display: bool = False

    def allows(self, mode: Mode) -> bool:
        if mode == "demo":
            return self.origin == "synthetic" and self.academic_demo
        return (
            self.origin != "synthetic"
            and self.pilot_analytics
            and self.commercial_display
        )


class InputRow(StrictModel):
    id: Ref
    creator_id: Ref
    evidence_ref: Ref
    observed_at: AwareDatetime


class PlatformAccount(StrictModel):
    platform: Platform
    account_id: Ref


class Profile(InputRow):
    kind: Literal["profile"]
    name: Label
    accounts: list[PlatformAccount] = Field(min_length=1, max_length=5)
    description: Annotated[str, StringConstraints(max_length=1000)] = ""


class Content(InputRow):
    kind: Literal["content"]
    platform: Platform
    account_id: Ref
    published_at: AwareDatetime
    text: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=2, max_length=1800)
    ]
    languages: list[Language] = Field(default_factory=list, max_length=4)
    reviewed_facts: list[Ref] = Field(default_factory=list, max_length=10)


class Performance(InputRow):
    kind: Literal["performance"]
    platform: Platform
    post_id: Ref
    window_end: AwareDatetime
    views: Count | None = None
    likes: Count | None = None
    comments: Count | None = None


class Quote(InputRow):
    kind: Literal["quote"]
    platform: Platform
    deliverable: Deliverable
    currency: Currency
    amount_minor: Money | None = None
    quote_type: Literal["firm", "indicative"]
    valid_until: AwareDatetime
    terms: Label


class Audience(InputRow):
    kind: Literal["audience"]
    platform: Platform
    period_start: AwareDatetime
    period_end: AwareDatetime
    market: Market
    denominator: Count | None = None
    share: Share | None = None
    data_status: Literal["observed", "suppressed"]
    basis: Literal["opt_in_survey_respondents"] = "opt_in_survey_respondents"


Record = Annotated[
    Profile | Content | Performance | Quote | Audience, Field(discriminator="kind")
]
ORIGINS = {
    "profile": "creator_profile",
    "content": "creator_authored",
    "performance": "creator_first_party_performance",
    "quote": "creator_quote",
    "audience": "creator_opt_in_survey",
}


class ImportDataset(StrictModel):
    grant: Grant
    records: list[Record] = Field(min_length=1, max_length=128)

    @model_validator(mode="after")
    def validate_records(self):
        if len({row.id for row in self.records}) != len(self.records):
            raise ValueError("Row IDs must be unique within a dataset")
        for row in self.records:
            if self.grant.origin != "synthetic" and (
                self.grant.origin != ORIGINS[row.kind]
                or row.creator_id != self.grant.owner_ref
            ):
                raise ValueError(
                    "Record kind and creator must match the independent grant"
                )
            if isinstance(row, Profile):
                accounts = {(item.platform, item.account_id) for item in row.accounts}
                if len(accounts) != len(row.accounts):
                    raise ValueError("Platform accounts must be unique")
            elif isinstance(row, Content) and row.published_at > row.observed_at:
                raise ValueError("Content publication must precede observation")
            elif isinstance(row, Performance) and row.window_end > row.observed_at:
                raise ValueError("An observation must follow its measurement window")
            elif isinstance(row, Quote) and row.valid_until <= row.observed_at:
                raise ValueError(
                    "Quote validity must extend beyond the issue timestamp"
                )
            elif isinstance(row, Audience):
                if not row.period_start < row.period_end <= row.observed_at:
                    raise ValueError("Survey dates must be ordered")
                if (row.share is not None) != (row.data_status == "observed"):
                    raise ValueError("Only observed survey data may include a share")
                if row.share is not None and (
                    row.denominator is None or row.denominator < 30
                ):
                    raise ValueError(
                        "Observed survey shares require at least 30 respondents"
                    )
                if (
                    row.data_status == "suppressed"
                    and row.denominator is not None
                    and row.denominator < 30
                ):
                    raise ValueError(
                        "Suppress the denominator for a survey cohort below 30"
                    )
        return self


class CreatorFilter(StrictModel):
    query: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)
        ]
        | None
    ) = None
    platform: Platform | None = None
    language: Language | None = None
    market: Market | None = None


class CompareRequest(StrictModel):
    creator_ids: list[Ref] = Field(min_length=1, max_length=12)


class Campaign(StrictModel):
    description: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=2, max_length=1000)
    ]
    objective: Literal["awareness", "engagement"]
    budget_minor: Money
    currency: Currency
    platform: Platform
    deliverable: Deliverable
    market: Market | None = None
    minimum_market_share: Share | None = None
    language: Language | None = None
    require_language: bool = False
    required_facts: list[Ref] = Field(default_factory=list, max_length=10)
    preferred_facts: list[Ref] = Field(default_factory=list, max_length=10)
    minimum_creators: int = Field(default=1, ge=1, le=8)
    maximum_creators: int = Field(default=4, ge=1, le=8)
    shortlist: list[Ref] | None = Field(default=None, min_length=1, max_length=40)
    category_labels: list[Label] | None = Field(default=None, max_length=9)

    @model_validator(mode="after")
    def validate_criteria(self):
        if self.minimum_creators > self.maximum_creators:
            raise ValueError("Minimum creators must not exceed maximum creators")
        if self.minimum_market_share is not None and self.market is None:
            raise ValueError("A market is required for a minimum market share")
        if self.require_language and self.language is None:
            raise ValueError("A language is required for the language constraint")
        return self


class Scenario(StrictModel):
    currency: Currency
    impressions: Count | None = None
    click_rate: Share | None = None
    conversion_rate: Share | None = None
    value_per_conversion_minor: Money | None = None
    advertising_spend_minor: Money | None = None
    campaign_cost_minor: Money | None = None
    contribution_margin: Share | None = None
    spend_minor: Money | None = Field(
        default=None, json_schema_extra={"deprecated": True}
    )

    @model_validator(mode="after")
    def consistent_cost(self):
        if (
            self.spend_minor is not None
            and self.campaign_cost_minor is not None
            and self.spend_minor != self.campaign_cost_minor
        ):
            raise ValueError(
                "Legacy spend must match campaign cost when both are supplied"
            )
        return self
