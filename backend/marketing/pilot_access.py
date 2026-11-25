"""Browser access for a trusted single-workspace pilot."""

from secrets import compare_digest
from typing import Annotated

from fastapi import Depends
from fastapi.security import (
    HTTPAuthorizationCredentials,
    HTTPBasic,
    HTTPBasicCredentials,
)

from backend.marketing.api import bearer
from backend.marketing.store import MarketingError
from backend.persistence.database import settings

BrowserLogin = Annotated[
    HTTPBasicCredentials | None, Depends(HTTPBasic(auto_error=False))
]
BearerLogin = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]


def matches(secret: str, supplied: str) -> bool:
    return len(secret) >= 24 and compare_digest(secret.encode(), supplied.encode())


def pilot_customer(login: HTTPBasicCredentials | None) -> bool:
    values = settings()
    password = values.get("MARKETING_PILOT_PASSWORD") or ""
    if not password:
        return False
    if (
        any(
            matches(password, values.get(key) or "")
            for key in ("MARKETING_CUSTOMER_TOKEN", "MARKETING_OPERATOR_TOKEN")
        )
        or len(password) < 24
    ):
        raise MarketingError(
            403, "workspace_restricted", "Invalid pilot access settings"
        )
    if login and login.username == "partner" and matches(password, login.password):
        return True
    raise MarketingError(
        401, "pilot_customer_login", "Sign in to the partner workspace"
    )


def require_core_operator(login: BrowserLogin, credential: BearerLogin):
    values = settings()
    operator = values.get("MARKETING_OPERATOR_TOKEN") or ""
    if operator in (
        values.get("MARKETING_PILOT_PASSWORD"),
        values.get("MARKETING_CUSTOMER_TOKEN"),
    ):
        raise MarketingError(
            403, "operator_required", "Invalid pilot operator settings"
        )
    if login and login.username == "operator" and matches(operator, login.password):
        return
    if credential and matches(operator, credential.credentials):
        return
    raise MarketingError(401, "pilot_operator_login", "Sign in to Data Operations")
