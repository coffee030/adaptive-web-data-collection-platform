"""PostgreSQL configuration and short-lived session factories."""

import os
from pathlib import Path

from dotenv import dotenv_values
from sqlalchemy import URL, create_engine, make_url
from sqlalchemy.orm import Session, sessionmaker

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def settings() -> dict[str, str | None]:
    return {**dotenv_values(PROJECT_ROOT / ".env"), **os.environ}


def evidence_path() -> Path:
    return PROJECT_ROOT / (settings().get("EVIDENCE_ROOT") or "var/evidence")


def database_url() -> URL:
    config = settings()
    if url := config.get("DATABASE_URL"):
        return make_url(url)
    user, password, name = (
        config.get(f"POSTGRES_{key}") for key in ("USER", "PASSWORD", "DB")
    )
    if not all((user, password, name)):
        raise RuntimeError("Set DATABASE_URL or configure PostgreSQL in .env")
    return URL.create(
        "postgresql+psycopg",
        username=user,
        password=password,
        database=name,
        host=config.get("POSTGRES_HOST") or "127.0.0.1",
        port=int(config.get("POSTGRES_PORT") or "5432"),
    )


def make_engine(url: str | URL):
    url = make_url(url)
    if url.drivername != "postgresql+psycopg":
        raise ValueError("Use the postgresql+psycopg database driver")
    options = f"{url.query.get('options', '')} -c timezone=UTC".strip()
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_size=4,
        max_overflow=2,
        hide_parameters=True,
        connect_args={"connect_timeout": 5, "options": options},
    )


def session_factory(engine) -> sessionmaker[Session]:
    return sessionmaker(engine, expire_on_commit=False)
