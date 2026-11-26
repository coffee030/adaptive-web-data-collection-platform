import csv
import json
import re
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from email.utils import parsedate_to_datetime
from hashlib import sha256
from io import StringIO
from time import monotonic
from unicodedata import normalize
from uuid import NAMESPACE_URL, uuid5

import httpx2
from lxml import etree
from redis.exceptions import RedisError

from backend.application.inputs import CsvEntry
from backend.core.contracts import CsvMappingConfiguration
from backend.core.inputs import InputError
from backend.core.origin_rate import OriginRate
from backend.core.robots import parse_policy
from backend.persistence.database import settings
from .wikimedia import AGENT, ProviderError, retry_after

ORIGIN = "https://trends.google.com"
FEED = ORIGIN + "/trending/rss"
ROBOTS = ORIGIN + "/robots.txt"
POLICY = "https://support.google.com/trends/answer/4365538"
ATTRIBUTION = "Google Trends Trending Now"
DATASET = "google-trending-now"
SOURCE_KEY = uuid5(NAMESPACE_URL, "https://trends.google.com/trending/rss#core-csv")
ACCESS_STOP_KEY = "collection:provider:google-trending-now:access-denied"
METRIC = "google_trending_now_approximate_search_traffic"
MAX_BYTES = 512 * 1024
MAX_ITEMS = 100
ATOM = "{http://www.w3.org/2005/Atom}"
TRAFFIC = "{" + FEED + "}approx_traffic"
BUCKET = re.compile(
    r"((?:[0-9]{1,12}|[0-9]{1,3}(?:,[0-9]{3}){1,3})(?:\.[0-9]{1,3})?)([KMB]?)\+"
)
COLUMNS = (
    "measurement_id",
    "event_id",
    "region",
    "query",
    "published_at",
    "observed_at",
    "traffic_bucket",
    "traffic_lower_bound",
    "metric",
    "source_url",
    "attribution",
    "response_sha256",
)
MAPPING = CsvMappingConfiguration(
    config_schema_version="1",
    adapter_type="csv",
    columns=tuple({"name": field, "column": field} for field in COLUMNS),
    record_schema={
        "record_type": DATASET,
        "schema_version": "1",
        "identity_field": "measurement_id",
        "fields": tuple(
            {
                "name": field,
                "value_type": "integer" if field == "traffic_lower_bound" else "string",
                "required": field not in ("traffic_bucket", "traffic_lower_bound"),
            }
            for field in COLUMNS
        ),
    },
)


def feed_url(market: str) -> str:
    if not isinstance(market, str) or not re.fullmatch(r"[A-Z]{2}", market):
        raise ValueError("Supply a two-letter uppercase market code, for example HK.")
    return f"{FEED}?geo={market}"


def traffic_lower_bound(bucket: str | None) -> int | None:
    if bucket in (None, ""):
        return None
    match = BUCKET.fullmatch(bucket)
    if not match:
        raise ValueError("Unrecognized approximate traffic bucket.")
    value, suffix = match.groups()
    number = (
        Decimal(value.replace(",", ""))
        * {"": 1, "K": 1000, "M": 1000000, "B": 1000000000}[suffix]
    )
    if number != number.to_integral_value() or number > 2**63 - 1:
        raise ValueError("Invalid traffic lower bound.")
    return int(number)


def parse_feed(market: str, body: bytes) -> list[dict]:
    url = feed_url(market)
    try:
        if len(body) > MAX_BYTES:
            raise ValueError("RSS size")
        doc = etree.fromstring(
            body,
            parser=etree.XMLParser(
                resolve_entities=False, load_dtd=False, no_network=True
            ),
        )
        if (
            doc.getroottree().docinfo.doctype
            or doc.tag != "rss"
            or doc.get("version") != "2.0"
        ):
            raise ValueError("RSS envelope")
        (channel,) = doc.findall("channel")
        (self_link,) = [
            link for link in channel.findall(ATOM + "link") if link.get("rel") == "self"
        ]
        if self_link.get("href") != url:
            raise ValueError("Different market")
        items = channel.findall("item")
        if len(items) > MAX_ITEMS:
            raise ValueError("RSS item limit")
        result = []
        for item in items:
            (title,) = item.findall("title")
            (date,) = item.findall("pubDate")
            traffic = item.findall(TRAFFIC)
            if len(traffic) > 1:
                raise ValueError("Duplicate traffic bucket")
            result.append(
                {
                    "query": title.text,
                    "published_at": date.text,
                    "approx_traffic": traffic[0].text if traffic else None,
                }
            )
        return result
    except (ValueError, TypeError, etree.XMLSyntaxError) as error:
        raise ProviderError("publisher_invalid_response") from error


def fetch(client, url, types, limit, cooldown, deadline):
    try:
        with client.stream(
            "GET",
            url,
            headers={"Accept": ", ".join(types)},
            timeout=min(12, max(0.1, deadline - monotonic())),
        ) as reply:
            if reply.headers.get("cf-mitigated", "").lower() == "challenge":
                raise ProviderError("publisher_access_blocked", None)
            if reply.status_code == 429 or (
                500 <= reply.status_code <= 599 and reply.headers.get("retry-after")
            ):
                wait = retry_after(reply.headers.get("retry-after", ""))
                cooldown.retry_after_ms = int(wait.total_seconds() * 1000)
                raise ProviderError(
                    "publisher_rate_limited"
                    if reply.status_code == 429
                    else "publisher_unavailable",
                    wait,
                )
            if reply.status_code in (401, 403, 451) or 300 <= reply.status_code < 400:
                raise ProviderError("publisher_access_blocked", None)
            if reply.status_code != 200:
                raise ProviderError("publisher_unavailable")
            if (
                reply.headers.get("content-type", "").split(";")[0].strip().lower()
                not in types
            ):
                raise ProviderError("publisher_invalid_response")
            if reply.headers.get("content-encoding", "identity").lower() != "identity":
                raise ProviderError("publisher_invalid_response")
            raw = bytearray()
            for part in reply.iter_raw(chunk_size=16384):
                if len(raw) + len(part) > limit or monotonic() > deadline:
                    raise ProviderError("publisher_response_limit")
                raw.extend(part)
            return bytes(raw)
    except httpx2.RequestError as error:
        raise ProviderError("publisher_unavailable") from error


@contextmanager
def permitted_request(rate, url, interval_ms, deadline):
    with rate.request(ORIGIN, interval_ms, deadline) as cooldown:
        if rate.redis.exists(ACCESS_STOP_KEY):
            raise ProviderError("publisher_access_blocked", None)
        try:
            yield cooldown
        except ProviderError as error:
            if error.code == "publisher_access_blocked":
                rate.redis.set(
                    ACCESS_STOP_KEY,
                    json.dumps(
                        {"url": url, "recorded_at": datetime.now(UTC).isoformat()}
                    ),
                    nx=True,
                )
            raise


def capture(market: str) -> dict:
    url = feed_url(market)
    deadline = monotonic() + 35
    rate = OriginRate(settings().get("CELERY_BROKER_URL") or "redis://127.0.0.1:6379/0")
    try:
        with httpx2.Client(
            trust_env=False,
            follow_redirects=False,
            headers={"User-Agent": AGENT, "Accept-Encoding": "identity"},
        ) as client:
            with permitted_request(rate, ROBOTS, 1150, deadline) as cooldown:
                robots = fetch(
                    client, ROBOTS, ("text/plain",), 128 * 1024, cooldown, deadline
                )
                if robots.lstrip().startswith(b"<"):
                    raise ProviderError("publisher_robots_unavailable")
                policy = parse_policy(robots, AGENT.split("/")[0])
                if not policy.can_fetch(AGENT, url):
                    raise ProviderError("publisher_access_blocked", None)
                cooldown.interval_ms = max(1150, policy.interval_ms)
            with permitted_request(
                rate, url, max(1150, policy.interval_ms), deadline
            ) as cooldown:
                raw = fetch(
                    client,
                    url,
                    ("application/rss+xml", "application/xml", "text/xml"),
                    MAX_BYTES,
                    cooldown,
                    deadline,
                )
                observed = datetime.now(UTC).isoformat()
        snapshot = {
            "market": market,
            "source_url": url,
            "observed_at": observed,
            "http": 200,
            "attribution": ATTRIBUTION,
            "body_sha256": sha256(raw).hexdigest(),
            "rows": parse_feed(market, raw),
        }
        return snapshot
    except RedisError as error:
        raise ProviderError("origin_rate_unavailable") from error
    except InputError as error:
        if delay := error.error.retry_after_seconds:
            raise ProviderError(error.error.code, timedelta(seconds=delay)) from error
        raise ProviderError(error.error.code) from error
    finally:
        rate.redis.close()


def identity(*parts):
    return sha256(
        json.dumps(parts, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def event_key(market: str, query: str, published_at: str | datetime) -> str:
    feed_url(market)
    query = query.strip()
    if not query or len(query) > 300 or re.search(r"[\x00-\x1f\x7f-\x9f]", query):
        raise ValueError("Query")
    start = (
        parsedate_to_datetime(published_at)
        if isinstance(published_at, str)
        else published_at
    )
    if not start.tzinfo:
        raise ValueError("Missing event timezone")
    return identity(
        DATASET, market, normalize("NFC", query), start.astimezone(UTC).isoformat()
    )


def observations(snapshot: dict) -> list[dict]:
    try:
        market = snapshot["market"]
        url = feed_url(market)
        observed = snapshot["observed_at"]
        instant = datetime.fromisoformat(observed)
        if (
            not instant.tzinfo
            or snapshot["http"] != 200
            or snapshot["source_url"] != url
            or snapshot["attribution"] != ATTRIBUTION
        ):
            raise ValueError("Capture scope")
        digest = snapshot["body_sha256"]
        if (
            not re.fullmatch(r"[0-9a-f]{64}", digest)
            or not isinstance(snapshot["rows"], list)
            or len(snapshot["rows"]) > MAX_ITEMS
        ):
            raise ValueError("Capture bounds")
        seen = {}
        for row in snapshot["rows"]:
            query = row["query"].strip()
            start = parsedate_to_datetime(row["published_at"])
            event = event_key(market, query, start)
            published = start.astimezone(UTC).isoformat()
            bucket = row.get("approx_traffic")
            lower = traffic_lower_bound(bucket)
            if event in seen:
                if seen[event]["traffic_bucket"] != bucket:
                    raise ValueError("Conflicting observation")
                continue
            seen[event] = dict(
                zip(
                    COLUMNS,
                    (
                        identity(event, instant.astimezone(UTC).isoformat()),
                        event,
                        market,
                        query,
                        published,
                        observed,
                        bucket,
                        lower,
                        METRIC,
                        url,
                        ATTRIBUTION,
                        digest,
                    ),
                    strict=True,
                )
            )
        return list(seen.values())
    except (KeyError, TypeError, ValueError, AttributeError, OverflowError) as error:
        raise ProviderError("publisher_invalid_response") from error


def entries(rows: list[dict]) -> CsvEntry:
    if not rows:
        raise ProviderError("no_data_from_publisher")
    output = StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=COLUMNS)
    writer.writeheader()
    writer.writerows(rows)
    return CsvEntry(adapter_type="csv", dataset_id=DATASET, content=output.getvalue())


def entry(snapshot: dict) -> CsvEntry:
    return entries(observations(snapshot))
