import csv
import json
import re
from datetime import UTC, date, datetime, timedelta
from email.utils import parsedate_to_datetime
from hashlib import sha256
from io import StringIO
from urllib.parse import quote

import httpx2

from backend.application.inputs import CsvEntry
from backend.core.contracts import CsvMappingConfiguration

BASE = "https://wikimedia.org/api/rest_v1/metrics/pageviews"
POLICY = "https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html"
LICENSE = "https://creativecommons.org/publicdomain/zero/1.0/"
AGENT = "AdaptiveCollectionCore/1.0 (https://github.com/coffee030/adaptive-web-data-collection-platform)"
DATASET = "wikimedia-daily-article-pageviews"
METRIC = "wikipedia_article_pageviews"
FIRST_DAY = date(2015, 7, 1)
COLUMNS = (
    "observation_id",
    "project",
    "article",
    "day_utc",
    "views",
    "metric",
    "source_url",
    "response_sha256",
)
MAPPING = CsvMappingConfiguration(
    config_schema_version="1",
    adapter_type="csv",
    columns=tuple({"name": field, "column": field} for field in COLUMNS),
    record_schema={
        "record_type": DATASET,
        "schema_version": "1",
        "identity_field": "observation_id",
        "fields": tuple(
            {"name": field, "value_type": "integer" if field == "views" else "string"}
            for field in COLUMNS
        ),
    },
)


class ProviderError(Exception):
    def __init__(self, code, retry=timedelta(hours=1)):
        super().__init__(code)
        self.code = code
        self.retry = retry


def project_key(value):
    if not re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.wikipedia\.org", value):
        raise ValueError(
            "Choose a Wikipedia language edition, such as ja.wikipedia.org."
        )
    return value


def article_key(value):
    title = "_".join(value.split())
    if not 1 <= len(title) <= 250 or title in {".", ".."} or not title.isprintable():
        raise ValueError("Enter a Wikipedia article title.")
    return title


def matching_project(value, requested):
    return value in (requested, requested.removesuffix(".org"))


def retry_after(raw):
    if raw.isascii() and raw.isdigit() and len(raw) <= 9:
        return timedelta(seconds=max(3600, int(raw)))
    try:
        due = parsedate_to_datetime(raw)
        return max(timedelta(hours=1), due - datetime.now(UTC))
    except (TypeError, ValueError, OverflowError):
        return timedelta(hours=1)


def load(url):
    try:
        with httpx2.stream(
            "GET",
            url,
            headers={"User-Agent": AGENT, "Accept": "application/json"},
            follow_redirects=False,
            trust_env=False,
            timeout=10,
        ) as reply:
            if reply.status_code == 429:
                raise ProviderError(
                    "publisher_rate_limited",
                    retry_after(reply.headers.get("retry-after", "")),
                )
            if reply.status_code in (401, 403, 451) or 300 <= reply.status_code < 400:
                raise ProviderError("publisher_access_blocked", None)
            if reply.status_code == 404:
                raise ProviderError("no_data_from_publisher")
            reply.raise_for_status()
            body = bytearray()
            for chunk in reply.iter_bytes(16384):
                body.extend(chunk)
                if len(body) > 1024 * 1024:
                    raise ProviderError("publisher_response_too_large")
            raw = bytes(body)
            return json.loads(raw)["items"], raw
    except httpx2.HTTPError as error:
        raise ProviderError("publisher_unavailable") from error
    except (KeyError, TypeError, ValueError) as error:
        raise ProviderError("publisher_invalid_response") from error


def discover(project, day, limit):
    url = f"{BASE}/top/{project}/all-access/{day:%Y/%m/%d}"
    try:
        items, raw = load(url)
        (result,) = items
        if (
            not matching_project(result["project"], project)
            or result["access"] != "all-access"
            or (int(result["year"]), int(result["month"]), int(result["day"]))
            != (day.year, day.month, day.day)
        ):
            raise ValueError("Response scope")
        articles = result["articles"][:limit]
        if any(
            not isinstance(row["article"], str)
            or type(row["views"]) is not int
            or row["views"] < 0
            or type(row["rank"]) is not int
            or row["rank"] < 1
            for row in articles
        ):
            raise ValueError("Response values")
        return {
            "project": project,
            "day_utc": day,
            "source_url": url,
            "response_sha256": sha256(raw).hexdigest(),
            "articles": [
                {k: row[k] for k in ("article", "views", "rank")} for row in articles
            ],
        }
    except (KeyError, TypeError, ValueError) as error:
        raise ProviderError("publisher_invalid_response") from error


def capture(project, article, start, end):
    url = f"{BASE}/per-article/{project}/all-access/user/{quote(article, safe='')}/daily/{start:%Y%m%d}/{end:%Y%m%d}"
    try:
        items, raw = load(url)
        if not isinstance(items, list):
            raise ValueError("Expected a series")
        seen = {}
        for item in items:
            stamp = item["timestamp"]
            day = date.fromisoformat(f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]}")
            views = item["views"]
            if (
                stamp != f"{day:%Y%m%d}00"
                or not start <= day <= end
                or day in seen
                or type(views) is not int
                or views < 0
                or not matching_project(item["project"], project)
                or item["article"] != article
                or item["access"] != "all-access"
                or item["agent"] != "user"
                or item["granularity"] != "daily"
            ):
                raise ValueError("Response scope or value")
            seen[day] = views
    except (KeyError, TypeError, ValueError) as error:
        raise ProviderError("publisher_invalid_response") from error
    return url, raw, seen


def entry(project, article, url, raw, values):
    digest = sha256(raw).hexdigest()
    csv_text = StringIO(newline="")
    writer = csv.writer(csv_text)
    writer.writerow(COLUMNS)
    for day, views in sorted(values.items()):
        identity = sha256(f"{project}\n{article}\n{day}".encode()).hexdigest()
        writer.writerow((identity, project, article, day, views, METRIC, url, digest))
    return CsvEntry(adapter_type="csv", dataset_id=DATASET, content=csv_text.getvalue())
