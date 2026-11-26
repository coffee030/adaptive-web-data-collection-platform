import logging
from datetime import timedelta
from uuid import UUID, uuid4

from kombu.exceptions import OperationalError as BrokerError
from redis.exceptions import RedisError
from sqlalchemy import func, select

from backend.application.jobs import database_now
from backend.marketing.company_models import CompanyCampaignRow, CompanyRow
from backend.marketing.store import MarketingError
from . import research_analysis
from .research_contracts import BusinessBrief, NewResearch
from .research_models import ResearchRunRow
from .store import IntelligenceStore


LOGGER = logging.getLogger(__name__)
ACTIVE = ("queued", "collecting", "analyzing")
LEASE = timedelta(minutes=4)
COLLECTION_WAIT = timedelta(minutes=3)


def owned(session, company_id, run_id, *, lock=False):
    query = select(ResearchRunRow).where(
        ResearchRunRow.id == run_id, ResearchRunRow.company_id == company_id
    )
    row = session.scalar(query.with_for_update() if lock else query)
    if not row:
        raise MarketingError(
            404, "research_unavailable", "Research is unavailable in this company"
        )
    return row


def receipt(row):
    return {
        "id": row.id,
        "state": row.state,
        "campaign_id": row.campaign_id,
        "brief": row.brief,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "sources": row.sources,
        "error": row.error,
        "last_review": row.review,
    }


def start(session, company_id, body: NewResearch):
    session.get(CompanyRow, company_id, with_for_update=True)
    if (
        body.campaign_id is not None
        and session.get(CompanyCampaignRow, (company_id, body.campaign_id)) is None
    ):
        raise MarketingError(
            404, "campaign_unavailable", "Campaign unavailable in this company"
        )
    request = body.brief.model_dump(mode="json")
    existing = session.scalar(
        select(ResearchRunRow).where(
            ResearchRunRow.company_id == company_id,
            ResearchRunRow.request_key == body.request_key,
        )
    )
    if existing:
        if (
            request
            != BusinessBrief.model_validate(existing.brief).model_dump(mode="json")
            or body.campaign_id != existing.campaign_id
        ):
            raise MarketingError(
                409,
                "research_request_changed",
                "This request key already belongs to a different brief",
            )
        return receipt(existing)
    active = session.scalar(
        select(func.count())
        .select_from(ResearchRunRow)
        .where(
            ResearchRunRow.company_id == company_id, ResearchRunRow.state.in_(ACTIVE)
        )
    )
    if active >= 4:
        raise MarketingError(
            409,
            "research_capacity",
            "Finish or cancel an active research run before starting another",
        )
    now = database_now(session)
    row = ResearchRunRow(
        id=uuid4(),
        company_id=company_id,
        campaign_id=body.campaign_id,
        request_key=body.request_key,
        brief=request,
        state="queued",
        created_at=now,
        updated_at=now,
        due_at=now,
        attempts=0,
        sources=[],
    )
    session.add(row)
    session.flush()
    return receipt(row)


def change(session, company_id, run_id, action):
    session.get(CompanyRow, company_id, with_for_update=True)
    row = owned(session, company_id, run_id, lock=True)
    if action == "cancel":
        if row.state in ACTIVE:
            row.state, row.claim, row.error = "cancelled", None, None
            row.updated_at = database_now(session)
        return receipt(row)
    if row.state in ACTIVE:
        return receipt(row)
    count = session.scalar(
        select(func.count())
        .select_from(ResearchRunRow)
        .where(
            ResearchRunRow.company_id == company_id, ResearchRunRow.state.in_(ACTIVE)
        )
    )
    if count >= 4:
        raise MarketingError(
            409, "research_capacity", "Finish another active research run first"
        )
    row.state, row.claim, row.error, row.revision, row.attempts, row.sources = (
        "queued",
        None,
        None,
        None,
        0,
        [],
    )
    row.updated_at = row.due_at = database_now(session)
    return receipt(row)


def summarize(sources, errors=None):
    errors = errors or {}
    return [
        {
            "key": str(s["key"]),
            "name": s["name"],
            "state": s["state"],
            "pending": bool(
                s.get("pending")
                or s.get("refresh_due")
                and not (errors.get(s["key"]) or s.get("error"))
            ),
            "error": errors.get(s["key"]) or s.get("error"),
            "observed_at": str(s["observed_at"]) if s.get("observed_at") else None,
        }
        for s in sources
    ]


class ResearchRuns(IntelligenceStore):
    def dispatch(self, publish):
        with self.sessions.begin() as session:
            now = database_now(session)
            row = session.scalar(
                select(ResearchRunRow)
                .where(ResearchRunRow.state.in_(ACTIVE), ResearchRunRow.due_at <= now)
                .order_by(ResearchRunRow.due_at, ResearchRunRow.id)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
            if row is None:
                return False
            if row.attempts >= 3:
                row.state, row.error, row.claim, row.updated_at = (
                    "failed",
                    "research_interrupted",
                    None,
                    now,
                )
                return True
            run_id = row.id
            token = row.claim = uuid4()
            row.attempts += 1
            row.due_at = now + LEASE
        try:
            publish(run_id, token)
        except (BrokerError, RedisError, OSError):
            with self.sessions.begin() as session:
                current = session.get(ResearchRunRow, run_id, with_for_update=True)
                if current and current.claim == token:
                    current.claim, current.error = None, "delivery_delayed"
                    current.attempts -= 1
                    current.due_at = database_now(session) + timedelta(seconds=8)
            return False
        return True

    def execute(self, run_id: UUID, claim: UUID):
        with self.sessions.begin() as session:
            row = session.get(ResearchRunRow, run_id, with_for_update=True)
            if not row or row.state not in ACTIVE or row.claim != claim:
                return
            now = database_now(session)
            if row.due_at <= now:
                return
            ticket = row.claim = uuid4()
            row.due_at = now + LEASE
            phase, since, brief, company_id = (
                row.state,
                row.updated_at,
                BusinessBrief.model_validate(row.brief),
                row.company_id,
            )
        error, revision, sources, delay = None, None, None, timedelta()
        review = None
        try:
            if phase == "queued":
                sources = summarize(
                    research_analysis.planned_sources(
                        brief, research_analysis.source_states(self.sessions)
                    )
                )
                following = "collecting"
            elif phase == "collecting":
                statuses = research_analysis.planned_sources(
                    brief, research_analysis.source_states(self.sessions)
                )
                errors = research_analysis.collect_due(self.sessions, statuses)
                sources = summarize(
                    research_analysis.planned_sources(
                        brief, research_analysis.source_states(self.sessions)
                    ),
                    errors,
                )
                waiting = any(s["pending"] for s in sources)
                following = (
                    "collecting"
                    if waiting and now - since < COLLECTION_WAIT
                    else "analyzing"
                )
                if following == "collecting":
                    delay = timedelta(seconds=4)
                elif waiting:
                    error = "collection_still_pending"
            else:
                report, revision = research_analysis.analyze(self, company_id, brief)
                review = research_analysis.saved_review(report, now)
                following = "ready"
        except MarketingError as exc:
            if exc.code == "catalog_changed":
                following, delay, error = "analyzing", timedelta(seconds=3), exc.code
            else:
                following, error = "failed", exc.code
        except Exception as exc:
            LOGGER.error("Research phase %s failed (%s)", phase, type(exc).__name__)
            following, error = "failed", "research_phase_failed"
        with self.sessions.begin() as session:
            row = session.get(ResearchRunRow, run_id, with_for_update=True)
            if not row or row.claim != ticket:
                return
            now = database_now(session)
            if following != row.state:
                row.updated_at = now
            if sources is not None:
                row.sources = sources
            if following == "ready":
                row.revision = revision
                row.review = review
            if error == "catalog_changed" and row.attempts >= 3:
                following = "failed"
            elif error != "catalog_changed":
                row.attempts = 0
            row.state, row.claim, row.error, row.due_at = (
                following,
                None,
                error,
                now + delay,
            )

    def results(self, session, company_id, run_id):
        row = owned(session, company_id, run_id)
        if row.state != "ready":
            raise MarketingError(
                409, "research_pending", "This research run has no finished report yet"
            )
        result, revision = research_analysis.analyze(
            self, company_id, BusinessBrief.model_validate(row.brief)
        )
        if row.revision != revision:
            raise MarketingError(
                409,
                "research_evidence_changed",
                "Source evidence changed. Refresh this research to review current findings.",
            )
        session.refresh(row)
        if row.state != "ready" or row.revision != revision:
            raise MarketingError(
                409, "research_pending", "This research run was reopened"
            )
        return {"run_id": run_id, "analyzed_at": row.updated_at, **result}
