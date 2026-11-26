import csv
import io
from datetime import datetime, timedelta
from hashlib import pbkdf2_hmac, sha256
from secrets import compare_digest, token_bytes, token_urlsafe
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field, SecretStr, StringConstraints
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.application.jobs import database_now
from backend.intelligence.contracts import Campaign, Ref, Scenario, StrictModel
from backend.persistence.database import settings
from .api import NonCacheableRoute, operator_store
from .company_models import CompanyCampaignRow, CompanyRow, CompanySessionRow, MemberRow
from .store import MarketingError

router = APIRouter(
    prefix="/marketing/companies",
    tags=["company workspaces"],
    route_class=NonCacheableRoute,
)
COOKIE = "harbourline_company_session"
Username = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, to_lower=True, pattern=r"^[a-z0-9][a-z0-9._@+-]{2,79}$"
    ),
]
Password = Annotated[SecretStr, Field(min_length=12, max_length=256)]
Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
Role = Literal["admin", "member"]


class Credentials(StrictModel):
    username: Username
    password: Password


class NewMember(Credentials):
    role: Role = "member"


class NewCompany(Credentials):
    name: Name
    claim_existing_pilot: bool = False


class CompanyInfo(BaseModel):
    id: str
    name: str


class MemberInfo(BaseModel):
    username: str
    role: Role


class Identity(CompanyInfo, MemberInfo):
    pass


class CampaignBrief(StrictModel):
    name: Annotated[str, Field(max_length=160)]
    description: Annotated[str, Field(max_length=2000)]
    budget: Annotated[float, Field(ge=0, le=10000000)]
    objective: str
    market: str
    language: str
    platform: str
    deliverable: str
    required: str
    preferred: str
    minAudience: Annotated[float, Field(ge=0, le=100)]
    requireCantonese: bool
    creatorCount: Annotated[int, Field(ge=1, le=40)]
    requiredFacts: str = ""
    preferredFacts: str = ""
    categoryLabels: str = ""


class CampaignDraft(StrictModel):
    brief: CampaignBrief
    saved: bool
    shortlist: list[Ref] = Field(max_length=120)
    lines: list[None] = Field(max_length=0)
    explorer: str = Field(max_length=2000)
    evaluation: Campaign | None = None
    scenario: Scenario | None = None


class Revision(StrictModel):
    version: int = Field(ge=0)
    draft: CampaignDraft


class Saved(Revision):
    id: UUID
    updated_at: datetime


def db(request: Request):
    if not settings().get("MARKETING_PILOT_PASSWORD"):
        raise MarketingError(
            403,
            "accounts_disabled",
            "Company accounts require the local pilot deployment",
        )
    with request.app.state.sessions.begin() as session:
        yield session


Database = Annotated[Session, Depends(db)]


def password_hash(password: SecretStr, salt: str) -> str:
    return pbkdf2_hmac(
        "sha256", password.get_secret_value().encode(), bytes.fromhex(salt), 600000
    ).hex()


def add_member(session: Session, company_id: str, credentials: Credentials, role: Role):
    salt = token_bytes(16).hex()
    member = MemberRow(
        username=credentials.username,
        company_id=company_id,
        role=role,
        password_hash=salt + "." + password_hash(credentials.password, salt),
        failed_attempts=0,
    )
    session.add(member)
    try:
        session.flush()
    except IntegrityError:
        raise MarketingError(
            409, "account_unavailable", "Choose a different account name"
        ) from None
    return MemberInfo(username=member.username, role=role)


@router.get("/registry", dependencies=[Depends(operator_store)])
def list_companies(session: Database) -> list[CompanyInfo]:
    return [
        CompanyInfo(id=row.id, name=row.name)
        for row in session.scalars(select(CompanyRow).order_by(CompanyRow.name))
    ]


@router.post("/registry", status_code=201, dependencies=[Depends(operator_store)])
def create_company(
    body: NewCompany, request: Request, session: Database
) -> CompanyInfo:
    key = "company-" + uuid4().hex
    if body.claim_existing_pilot:
        key = request.app.state.intelligence.config.workspace
        if not key or session.get(CompanyRow, key):
            raise MarketingError(
                409, "pilot_claimed", "The earlier pilot has already been assigned"
            )
    row = CompanyRow(id=key, name=body.name)
    session.add(row)
    try:
        session.flush()
    except IntegrityError:
        raise MarketingError(
            409, "name_taken", "Choose a different company name"
        ) from None
    add_member(session, row.id, body, "admin")
    return CompanyInfo(id=row.id, name=row.name)


def session_digest(request: Request) -> str:
    return sha256(request.cookies.get(COOKIE, "").encode()).hexdigest()


def authenticated(request: Request, session: Session) -> Identity:
    if not settings().get("MARKETING_PILOT_PASSWORD"):
        raise MarketingError(403, "accounts_disabled", "Company accounts are disabled")
    data = session.execute(
        select(MemberRow, CompanyRow.name)
        .join(CompanySessionRow, CompanySessionRow.username == MemberRow.username)
        .join(CompanyRow, CompanyRow.id == MemberRow.company_id)
        .where(
            CompanySessionRow.digest == session_digest(request),
            CompanySessionRow.expires_at > database_now(session),
        )
    ).first()
    if data is None:
        raise MarketingError(401, "company_login_required", "Sign in to your company")
    member, name = data
    expected = request.headers.get("X-Harbourline-Company")
    if expected is not None and expected != member.company_id:
        raise MarketingError(
            409, "company_changed", "This browser is signed into another company"
        )
    return Identity(
        id=member.company_id, name=name, username=member.username, role=member.role
    )


def identity(request: Request, session: Database) -> Identity:
    return authenticated(request, session)


User = Annotated[Identity, Depends(identity)]


def administrator(user: User) -> Identity:
    if user.role != "admin":
        raise MarketingError(
            403, "admin_required", "Company administrator access is required"
        )
    return user


Admin = Annotated[Identity, Depends(administrator)]


@router.get("/session")
def session_info(user: User) -> Identity:
    return user


@router.post("/session")
def sign_in(
    body: Credentials, request: Request, response: Response, session: Database
) -> Identity:
    now = database_now(session)
    member = session.get(MemberRow, body.username, with_for_update=True)
    if member and member.locked_until and member.locked_until > now:
        raise MarketingError(429, "login_delayed", "Wait before signing in again")
    salt, stored = member.password_hash.split(".") if member else ("00" * 16, "")
    if not compare_digest(password_hash(body.password, salt), stored) or not member:
        if member:
            member.failed_attempts += 1
            if member.failed_attempts >= 8:
                member.failed_attempts = 0
                member.locked_until = now + timedelta(minutes=5)
            session.commit()
        raise MarketingError(
            401, "sign_in_failed", "Check your account name and password"
        )
    member.failed_attempts = 0
    member.locked_until = None
    session.execute(
        delete(CompanySessionRow).where(
            (CompanySessionRow.expires_at <= now)
            | (CompanySessionRow.digest == session_digest(request))
        )
    )
    token = token_urlsafe(32)
    session.add(
        CompanySessionRow(
            digest=sha256(token.encode()).hexdigest(),
            username=member.username,
            expires_at=now + timedelta(hours=12),
        )
    )
    response.set_cookie(
        COOKIE,
        token,
        max_age=43200,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="strict",
        path="/api/v1/marketing",
    )
    return Identity(
        id=member.company_id,
        name=session.get(CompanyRow, member.company_id).name,
        username=member.username,
        role=member.role,
    )


@router.delete("/session", status_code=204)
def sign_out(request: Request, session: Database) -> Response:
    session.execute(
        delete(CompanySessionRow).where(
            CompanySessionRow.digest == session_digest(request)
        )
    )
    response = Response(status_code=204)
    response.delete_cookie(
        COOKIE, path="/api/v1/marketing", samesite="strict", httponly=True
    )
    return response


@router.get("/members")
def members(user: Admin, session: Database) -> list[MemberInfo]:
    rows = session.scalars(
        select(MemberRow)
        .where(MemberRow.company_id == user.id)
        .order_by(MemberRow.username)
    )
    return [MemberInfo(username=row.username, role=row.role) for row in rows]


@router.post("/members", status_code=201)
def create_member(body: NewMember, user: Admin, session: Database) -> MemberInfo:
    return add_member(session, user.id, body, body.role)


@router.delete("/members/{username}", status_code=204)
def remove_member(username: Username, user: Admin, session: Database) -> Response:
    session.get(CompanyRow, user.id, with_for_update=True)
    current = session.get(MemberRow, user.username, populate_existing=True)
    if not current or current.role != "admin":
        raise MarketingError(403, "admin_required", "Administrator access is required")
    if username == user.username:
        raise MarketingError(
            409, "active_admin", "Another administrator must remove your membership"
        )
    deleted = session.execute(
        delete(MemberRow).where(
            MemberRow.username == username, MemberRow.company_id == user.id
        )
    )
    if not deleted.rowcount:
        raise MarketingError(404, "member_unavailable", "Member unavailable")
    return Response(status_code=204)


@router.get("/campaigns", response_model_exclude_none=True)
def campaigns(user: User, session: Database) -> list[Saved]:
    rows = session.scalars(
        select(CompanyCampaignRow)
        .where(CompanyCampaignRow.company_id == user.id)
        .order_by(CompanyCampaignRow.updated_at.desc())
    )
    return [Saved.model_validate(row, from_attributes=True) for row in rows]


@router.put("/campaigns/{campaign_id}", response_model_exclude_none=True)
def save_campaign(
    campaign_id: UUID, body: Revision, user: User, session: Database
) -> Saved:
    row = session.get(CompanyCampaignRow, (user.id, campaign_id), with_for_update=True)
    draft = body.draft.model_dump(mode="json", exclude_none=True)
    if row and row.draft == draft:
        return Saved.model_validate(row, from_attributes=True)
    if (row.version if row else 0) != body.version:
        raise MarketingError(409, "campaign_changed", "A newer revision is available")
    updated_at = database_now(session)
    if row is None:
        row = CompanyCampaignRow(id=campaign_id, company_id=user.id, version=0)
        session.add(row)
    row.version += 1
    row.updated_at = updated_at
    row.draft = draft
    try:
        session.flush()
    except IntegrityError:
        raise MarketingError(
            409, "campaign_changed", "A newer revision is available"
        ) from None
    return Saved.model_validate(row, from_attributes=True)


@router.get("/campaigns/{campaign_id}/export")
def export_campaign(
    campaign_id: UUID, version: int, user: User, session: Database
) -> Response:
    row = session.get(CompanyCampaignRow, (user.id, campaign_id))
    if row is None:
        raise MarketingError(404, "campaign_unavailable", "Campaign unavailable")
    if row.version != version:
        raise MarketingError(
            409, "campaign_changed", "Reload the latest saved campaign"
        )
    brief = row.draft["brief"]
    rows = [
        ("Company", user.name),
        ("Campaign", brief["name"]),
        ("Brief", brief["description"]),
        ("Budget cap (HKD)", brief["budget"]),
        ("Required creators", brief["creatorCount"]),
        ("Platform", brief["platform"]),
        ("Deliverable", brief["deliverable"]),
        ("Mandatory notes", brief["required"]),
        ("Optional notes", brief["preferred"]),
        ("Required content evidence", brief["requiredFacts"]),
        ("Preferred evidence", brief["preferredFacts"]),
    ]
    if row.draft.get("scenario"):
        rows.append(("Scenario basis", "Customer supplied assumptions"))
        rows.extend(
            (k.replace("_", " "), v)
            for k, v in row.draft["scenario"].items()
            if v is not None
        )
    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)
    for name, value in rows:
        text = str(value)
        writer.writerow(
            [
                name,
                "'" + text
                if text.lstrip().startswith(("=", "+", "-", "@"))
                or text.startswith(("\t", "\r", "\n"))
                else text,
            ]
        )
    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=harbourline-campaign.csv"
        },
    )
