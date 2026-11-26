"""Publish licensed public directory metadata through the validated Core CSV pipeline."""

import csv
import io
import json
import re
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlencode
from uuid import NAMESPACE_URL, UUID, uuid5

import httpx2
from pydantic import BaseModel

from backend.application.inputs import CsvEntry
from backend.core.contracts import CsvMappingConfiguration
from backend.marketing.store import MarketingError
from . import public_feed
from .public_feed import DirectoryRow as DirectoryRow, PublicFeed

from .semantic import character_grams, embed, normalized, tfidf_scores

ITEMS = (
    "Q107994588",
    "Q104173819",
    "Q83612827",
    "Q46865242",
    "Q108830064",
    "Q88180477",
    "Q68069111",
    "Q88071155",
    "Q87068866",
    "Q30946117",
    "Q112720537",
)
LICENSE = "https://www.wikidata.org/wiki/Wikidata:Licensing"
FEED = "hk-wikidata-creator-directory"
FIELDS = (
    "item",
    "name",
    "local_name",
    "description",
    "local_description",
    "revision",
    "checked",
)
CONFIG = CsvMappingConfiguration.model_validate(
    {
        "adapter_type": "csv",
        "config_schema_version": "1",
        "columns": [{"name": f, "column": f} for f in FIELDS],
        "record_schema": {
            "record_type": FEED,
            "schema_version": "1",
            "identity_field": "item",
            "fields": [
                {"name": f, "required": f not in ("local_name", "local_description")}
                for f in FIELDS
            ],
        },
    }
)
KEY = uuid5(NAMESPACE_URL, FEED)
LANGS = ("zh-hk", "zh-hant", "yue", "zh")
FRESH = timedelta(days=7)


class PublicProfile(BaseModel):
    item: str
    revision: str
    name: str
    local_name: str = ""
    description: str
    local_description: str = ""
    evidence_id: UUID
    record_id: UUID


class DirectoryResults(BaseModel):
    state: Literal["available", "unavailable", "expired"]
    observed: datetime | None = None
    expires: datetime | None = None
    retrieval: Literal["directory", "granite_int8", "character_tfidf"] = "directory"
    profiles: list[PublicProfile] = []


def term(entity, group, languages):
    for lang in languages:
        label = entity.get(group, {}).get(lang, {}).get("value")
        if isinstance(label, str) and label.strip():
            if len(label) > 512 or any(ord(ch) < 32 for ch in label):
                raise ValueError("Unexpected upstream label")
            return label.strip()
    return ""


def wikidata_rows(payload):
    entities = payload.get("entities") if isinstance(payload, dict) else None
    if not isinstance(entities, dict) or set(entities) != set(ITEMS):
        raise ValueError("Unexpected upstream scope")
    rows = []
    for item in ITEMS:
        entity = entities[item]
        if (
            entity.get("id") != item
            or "missing" in entity
            or entity.get("type") != "item"
        ):
            continue

        name = term(entity, "labels", ("en",))
        description = term(entity, "descriptions", ("en",))
        version = entity.get("lastrevid")
        if not isinstance(version, int) or version <= 0:
            raise ValueError("Missing source revision")
        if name and description:
            rows.append(
                {
                    "item": item,
                    "name": name,
                    "local_name": term(entity, "labels", LANGS),
                    "description": description,
                    "local_description": term(entity, "descriptions", LANGS),
                    "revision": str(version),
                }
            )
    return rows


def acquire():
    params = urlencode(
        dict(
            action="wbgetentities",
            format="json",
            ids="|".join(ITEMS),
            props="info|labels|descriptions",
            languages="en|" + "|".join(LANGS),
            maxlag=5,
        )
    )
    try:
        with httpx2.stream(
            "GET",
            "https://www.wikidata.org/w/api.php?" + params,
            headers={
                "User-Agent": "Harbourline/1.0 (https://github.com/coffee030/adaptive-web-data-collection-platform)"
            },
            timeout=6,
            follow_redirects=False,
            trust_env=False,
        ) as response:
            if (
                response.status_code in (401, 403, 429)
                or 300 <= response.status_code < 400
            ):
                raise MarketingError(
                    503,
                    "directory_source_blocked",
                    "Upstream access needs operator review",
                )
            response.raise_for_status()
            data = bytearray()
            for chunk in response.iter_bytes(8192):
                data.extend(chunk)
                if len(data) > 131072:
                    raise ValueError("Upstream response too large")
            return wikidata_rows(json.loads(data))
    except (httpx2.HTTPError, ValueError, TypeError, AttributeError) as exc:
        raise MarketingError(
            503, "directory_source_unavailable", "Wikidata could not be refreshed"
        ) from exc


def release_snapshot():
    capture = json.loads(
        Path(__file__).with_name("wikidata-directory.json").read_text(encoding="utf-8")
    )
    observed = datetime.fromisoformat(capture["observed"])
    records = capture["records"] if observed + FRESH > datetime.now(UTC) else []
    return observed, records


def entry(records, observed=None):
    checked = (observed or datetime.now(UTC)).isoformat()
    content = io.StringIO(newline="")
    writer = csv.DictWriter(content, fieldnames=FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(dict(row, checked=checked) for row in records)
    return CsvEntry(adapter_type="csv", dataset_id=FEED, content=content.getvalue())


def feed():
    return PublicFeed(
        1,
        FEED,
        "Wikidata Hong Kong creator directory",
        LICENSE,
        CONFIG,
        FRESH,
        acquire,
        release_snapshot,
        entry,
    )


def prepare(profiles, evidence):
    return public_feed.prepare(profiles, evidence, feed())


def activate(sessions, profiles, source_id, profile_id, report_id):
    return public_feed.activate(
        sessions,
        profiles,
        source_id,
        profile_id,
        report_id,
        feed(),
        approver="Directory operator",
    )


def refresh(sessions):
    return public_feed.refresh(sessions, feed())


def snapshot(sessions):
    state, observed, expiry, rows = public_feed.records(sessions, feed())
    if state != "available":
        return DirectoryResults(state=state, expires=expiry)
    profiles = [
        PublicProfile.model_validate(
            {
                **{k: v for k, v in row.payload.items() if v is not None},
                "record_id": row.id,
                "evidence_id": row.evidence_id,
            }
        )
        for row in rows
        if row.payload.get("item") in ITEMS
    ]
    return DirectoryResults(
        state="available",
        observed=observed,
        expires=expiry,
        profiles=sorted(profiles, key=lambda p: p.name.casefold()),
    )


@lru_cache(maxsize=2)
def description_vectors(model_dir, texts):
    return embed(model_dir, list(texts))


def search(result, query, model_dir):
    if not query or not result.profiles:
        return result
    texts = tuple(
        normalized(" ".join([p.name, p.local_name, p.description, p.local_description]))
        for p in result.profiles
    )
    terms = set(re.findall(r"[^\W_]+", normalized(query)))
    literal = [normalized(query) in text for text in texts]
    coverage = [len(terms.intersection(re.findall(r"[^\W_]+", text))) for text in texts]
    vectors = description_vectors(model_dir, texts) if model_dir else None
    vector = embed(model_dir, [query]) if vectors is not None else None
    if vector:
        scores = [
            sum(a * b for a, b in zip(vector[0], row, strict=True)) for row in vectors
        ]
        result.retrieval = "granite_int8"
    else:
        lexical = tfidf_scores(
            query, {str(i): character_grams(text) for i, text in enumerate(texts)}
        )
        scores = [lexical[str(i)] for i in range(len(texts))]
        result.retrieval = "character_tfidf"
    indices = sorted(
        range(len(texts)),
        key=lambda i: (literal[i], coverage[i], scores[i]),
        reverse=True,
    )
    result.profiles = [
        result.profiles[i]
        for i in indices
        if literal[i] or (terms and coverage[i] == len(terms))
    ]
    return result
