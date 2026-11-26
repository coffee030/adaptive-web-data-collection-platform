import csv
import io
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel, Field, StringConstraints, model_validator
from sqlalchemy import BigInteger, cast, delete, func, select

from backend.application.jobs import database_now
from backend.core.csv_export import protect_csv_text
from backend.intelligence.analytics import scenario
from backend.intelligence.contracts import Count, Money, Scenario, StrictModel
from .api import NonCacheableRoute
from .company_api import Database, User
from .company_models import CampaignPeriodRow, CompanyCampaignRow
from .store import MarketingError

router = APIRouter(
    prefix="/marketing/companies/campaigns/{campaign_id}/tracking",
    tags=["campaign reporting"],
    route_class=NonCacheableRoute,
)
Status = Literal["planning", "active", "paused", "completed"]
Version = Annotated[int, Field(strict=True, ge=0)]
Channel = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_lower=True,
        min_length=1,
        max_length=60,
        pattern=r"^[\w .&/+()-]+$",
    ),
]
Evidence = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=2, max_length=240)
]


class ChangeStatus(StrictModel):
    version: Version
    status: Status


class Measurements(StrictModel):
    reach: Count | None = None
    impressions: Count | None = None
    clicks: Count | None = None
    conversions: Count | None = None
    revenue_minor: Money | None = None
    ad_spend_minor: Money | None = None
    campaign_cost_minor: Money | None = None
    contribution_minor: (
        Annotated[int, Field(strict=True, ge=-1_000_000_000, le=1_000_000_000)] | None
    ) = None


class Period(Measurements):
    channel: Channel
    period_start: date
    period_end: date
    source: Evidence
    authorization_ref: Evidence

    @model_validator(mode="after")
    def validate_measurement(self):
        today = datetime.now(timezone(timedelta(hours=8))).date()
        if self.period_end < self.period_start or self.period_end > today:
            raise ValueError(
                "Use a completed reporting period with the end on or after the start"
            )
        if all(getattr(self, field) is None for field in Measurements.model_fields):
            raise ValueError("Enter at least one observed measurement")
        if (
            self.ad_spend_minor is not None
            and self.campaign_cost_minor is not None
            and self.campaign_cost_minor < self.ad_spend_minor
        ):
            raise ValueError("Total campaign cost must include advertising spend")
        return self


class SubmitPeriod(Period):
    version: Version


class ReportedPeriod(Period):
    id: UUID
    recorded_at: datetime
    recorded_by: str


class Totals(BaseModel):
    reach: int | None
    impressions: int | None
    clicks: int | None
    conversions: int | None
    revenue_minor: int | None
    ad_spend_minor: int | None
    campaign_cost_minor: int | None
    contribution_minor: int | None
    ctr: float | None
    conversion_rate: float | None
    roas: float | None
    roi: float | None


class CampaignReport(BaseModel):
    campaign_id: UUID
    name: str
    currency: Literal["HKD"] = "HKD"
    status: Status
    version: int
    period_count: int
    period_offset: int
    periods: list[ReportedPeriod]
    actual: Totals
    planned: dict[str, float | None]
    planned_currency: str | None


def campaign_for(session, company, campaign_id, write=False):
    row = session.get(
        CompanyCampaignRow, (company, campaign_id), with_for_update={"read": not write}
    )
    if row is None:
        raise MarketingError(404, "campaign_unavailable", "Campaign unavailable")
    return row


def report_scope(campaign):
    return (
        CampaignPeriodRow.company_id == campaign.company_id,
        CampaignPeriodRow.campaign_id == campaign.id,
    )


def totals(session, campaign):
    period = CampaignPeriodRow
    columns = [func.count().label("period_count")]
    for key in Measurements.model_fields:
        number = cast(period.report[key].astext, BigInteger)
        columns.extend(
            [func.sum(number).label(key), func.count(number).label(key + "_count")]
        )
    counts = (
        session.execute(
            select(*columns).select_from(period).where(*report_scope(campaign))
        )
        .mappings()
        .one()
    )
    size = counts["period_count"]
    actual = {
        key: int(counts[key]) if size and counts[key + "_count"] == size else None
        for key in Measurements.model_fields
    }
    if size != 1:
        actual["reach"] = None

    def ratio(numerator, denominator):
        return (
            numerator / denominator if numerator is not None and denominator else None
        )

    cost = actual["campaign_cost_minor"]
    contribution = actual["contribution_minor"]
    net = contribution - cost if contribution is not None and cost is not None else None
    return size, Totals(
        **actual,
        ctr=ratio(actual["clicks"], actual["impressions"]),
        conversion_rate=ratio(actual["conversions"], actual["clicks"]),
        roas=ratio(actual["revenue_minor"], actual["ad_spend_minor"]),
        roi=ratio(net, cost),
    )


def planned_results(draft):
    if not draft.get("scenario"):
        return None, {}
    assumptions = Scenario.model_validate(draft["scenario"])
    projection = scenario(assumptions)
    return assumptions.currency, {
        "impressions": assumptions.impressions,
        "clicks": projection.clicks.value,
        "conversions": projection.conversions.value,
        "revenue_minor": projection.attributed_revenue_minor.value,
        "ad_spend_minor": assumptions.advertising_spend_minor,
        "campaign_cost_minor": assumptions.campaign_cost_minor
        if assumptions.campaign_cost_minor is not None
        else assumptions.spend_minor,
        "ctr": assumptions.click_rate,
        "conversion_rate": assumptions.conversion_rate,
        "roas": projection.roas.value,
        "roi": projection.roi.value,
    }


def period_query(campaign):
    return (
        select(CampaignPeriodRow)
        .where(*report_scope(campaign))
        .order_by(CampaignPeriodRow.period_end.desc(), CampaignPeriodRow.id)
    )


def period_receipt(row):
    return ReportedPeriod(
        id=row.id,
        **row.report,
        recorded_by=row.recorded_by,
        recorded_at=row.recorded_at,
    )


def build_report(session, campaign, offset=0, limit=40):
    count, actual = totals(session, campaign)
    currency, planned = planned_results(campaign.draft)
    periods = session.scalars(period_query(campaign).offset(offset).limit(limit))
    return CampaignReport(
        campaign_id=campaign.id,
        name=campaign.draft["brief"].get("name") or "Untitled campaign",
        status=campaign.status,
        version=campaign.tracking_version,
        period_count=count,
        period_offset=offset,
        periods=[period_receipt(p) for p in periods],
        actual=actual,
        planned=planned,
        planned_currency=currency,
    )


def current_version(row, requested):
    if row.tracking_version != requested:
        raise MarketingError(
            409, "tracking_changed", "Reload the latest campaign report before saving"
        )


@router.get("")
def read_report(
    campaign_id: UUID,
    user: User,
    session: Database,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 40,
) -> CampaignReport:
    return build_report(
        session, campaign_for(session, user.id, campaign_id), offset, limit
    )


@router.patch("")
def change_status(
    campaign_id: UUID, body: ChangeStatus, user: User, session: Database
) -> CampaignReport:
    campaign = campaign_for(session, user.id, campaign_id, True)
    if campaign.status != body.status:
        current_version(campaign, body.version)
        campaign.status = body.status
        campaign.tracking_version += 1
        campaign.updated_at = database_now(session)
    return build_report(session, campaign)


@router.put("/periods/{period_id}")
def record_period(
    campaign_id: UUID,
    period_id: UUID,
    body: SubmitPeriod,
    user: User,
    session: Database,
) -> CampaignReport:
    campaign = campaign_for(session, user.id, campaign_id, True)
    payload = body.model_dump(mode="json", exclude={"version"}, exclude_none=True)
    row = session.get(CampaignPeriodRow, (user.id, campaign_id, period_id))
    if row and row.report == payload:
        return build_report(session, campaign)
    current_version(campaign, body.version)
    overlap = (
        select(CampaignPeriodRow.id)
        .where(
            *report_scope(campaign),
            CampaignPeriodRow.id != period_id,
            CampaignPeriodRow.channel == body.channel,
            CampaignPeriodRow.period_start <= body.period_end,
            CampaignPeriodRow.period_end >= body.period_start,
        )
        .limit(1)
    )
    if session.scalar(overlap):
        raise MarketingError(
            409,
            "reporting_overlap",
            "This channel already has a report covering those dates",
        )
    if row is None:
        row = CampaignPeriodRow(
            id=period_id, campaign_id=campaign_id, company_id=user.id
        )
        session.add(row)
    row.report = payload
    row.channel = body.channel
    row.period_start = body.period_start
    row.period_end = body.period_end
    row.recorded_by = user.username
    row.recorded_at = database_now(session)
    campaign.updated_at = row.recorded_at
    campaign.tracking_version += 1
    return build_report(session, campaign)


@router.delete("/periods/{period_id}")
def withdraw_period(
    campaign_id: UUID,
    period_id: UUID,
    version: Annotated[int, Query(ge=0)],
    user: User,
    session: Database,
) -> CampaignReport:
    campaign = campaign_for(session, user.id, campaign_id, True)
    current_version(campaign, version)
    removed = session.execute(
        delete(CampaignPeriodRow).where(
            *report_scope(campaign), CampaignPeriodRow.id == period_id
        )
    )
    if not removed.rowcount:
        raise MarketingError(404, "period_unavailable", "Reporting period unavailable")
    campaign.tracking_version += 1
    campaign.updated_at = database_now(session)
    return build_report(session, campaign)


@router.get("/export")
def export_report(campaign_id: UUID, user: User, session: Database) -> Response:
    campaign = campaign_for(session, user.id, campaign_id)
    report = build_report(session, campaign, limit=0)
    out = io.StringIO()
    writer = csv.writer(out, quoting=csv.QUOTE_ALL)

    def line(values):
        writer.writerow(
            [
                protect_csv_text(value) if isinstance(value, str) else value
                for value in values
            ]
        )

    line(["Campaign reporting", report.name])
    line(["Company", user.name])
    line(["Status", report.status])
    line(["Reporting currency", report.currency])
    line(["Monetary units", "Minor units (cents)"])
    line(
        [
            "Reporting basis",
            "Company-supplied, non-overlapping channel reports. Reach is unique only within a single report. Missing measurements stay blank.",
        ]
    )
    line(
        [
            "Metric",
            "Reported result",
            "Scenario assumption (" + (report.planned_currency or "unavailable") + ")",
        ]
    )
    for key, value in report.actual.model_dump().items():
        line([key, value, report.planned.get(key)])
    line([])
    keys = [
        "channel",
        "period_start",
        "period_end",
        *Measurements.model_fields,
        "source",
        "authorization_ref",
        "recorded_by",
        "recorded_at",
    ]
    line(keys)
    for row in session.scalars(period_query(campaign).execution_options(yield_per=100)):
        receipt = period_receipt(row).model_dump(mode="json")
        line([receipt.get(key) for key in keys])
    return Response(
        content="\ufeff" + out.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=harbourline-performance.csv"
        },
    )
