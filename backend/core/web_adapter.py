"""Read a single controlled HTML document through Scrapling."""

import logging
import re
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime
from email.message import Message
from email.utils import parsedate_to_datetime
from math import ceil
from urllib.parse import unquote, urldefrag, urljoin, urlsplit
from urllib.robotparser import RobotFileParser

from cssselect import SelectorSyntaxError
from curl_cffi import CurlError
from curl_cffi.curl import CURL_WRITEFUNC_ERROR
from curl_cffi.requests.exceptions import Timeout
from scrapling import Selector
from scrapling.core.utils import reset_logger, set_logger
from scrapling.fetchers import Fetcher

from .contracts import (
    CandidateRecord,
    ExtractionConfiguration,
    Source,
    SourcePosition,
    controlled_origin,
)
from .html_extraction import (
    ExtractionConfig,
    ExtractionSizeLimit,
    Field,
    Query,
    extract,
)
from .inputs import CapturedInput, InputError, WebInput

USER_AGENT = "FYP-Collection-Core/1.0"
MAX_BODY_BYTES = 1024 * 1024
MAX_EXTRACTED_VALUE_BYTES = 1024 * 1024
MAX_ITEMS = 10_000
MAX_REDIRECTS = 2
TIMEOUT_SECONDS = 2
REDIRECTS = {301, 302, 303, 307, 308}
PRIVATE_FETCH_LOG = logging.getLogger(__name__ + ".scrapling")
PRIVATE_FETCH_LOG.disabled = True
PERCENT_ESCAPE = re.compile(r"%([0-9a-fA-F]{2})")
INVALID_ESCAPE = re.compile(r"%(?![0-9a-fA-F]{2})")
UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"


def checked_url(source: Source, url: str) -> tuple[str, str]:
    if (
        not url
        or len(url) > 2048
        or any(ord(char) <= 32 or char in "\\\x7f" for char in url)
    ):
        raise InputError("destination_denied", "Invalid controlled URL")
    try:
        parts = urlsplit(url)
        origin = controlled_origin(f"{parts.scheme}://{parts.netloc}")
    except ValueError as error:
        raise InputError("destination_denied", "Invalid controlled URL") from error
    if origin not in source.allowed_origins:
        raise InputError(
            "destination_denied", "URL is outside the authorized controlled origins"
        )
    # Reject ambiguous segments before robots sees a different path from the fetcher.
    for segment in parts.path.split("/"):
        decoded = unquote(segment)
        if decoded in {".", ".."} or "/" in decoded or "\\" in decoded:
            raise InputError("destination_denied", "Invalid controlled URL path")
    return urldefrag(url).url, origin


def capture_html(
    source: Source,
    entry: WebInput,
    *,
    check_access: Callable[[], object] | None = None,
    visited: set[str] | None = None,
) -> CapturedInput:
    if source.approval_status != "approved":
        raise InputError("source_not_approved", "Source access is not authorized")
    current, origin = checked_url(source, entry.url)
    requested = current
    if visited is not None:
        _check_unvisited(current, visited)
    if check_access is not None:
        check_access()
    robots = _robots_policy(origin)
    seen = {url_key(current)}
    for hop in range(MAX_REDIRECTS + 1):
        if not robots.can_fetch(USER_AGENT, current):
            raise InputError(
                "robots_denied", "Controlled robots policy disallows the URL"
            )
        if check_access is not None:
            check_access()
        if visited is not None:
            visited.add(url_key(current))
        document, location, challenged = _get(current)
        document = replace(document, requested_location=requested)
        if challenged:
            raise InputError(
                "access_blocked",
                "Controlled site declared a challenge",
                capture=document,
            )
        if document.http_status not in REDIRECTS:
            break
        if not location or hop == MAX_REDIRECTS:
            raise InputError(
                "redirect_denied",
                "Missing Location or redirect limit exceeded",
                capture=document,
            )
        try:
            target = _same_origin_link(source, current, location)
        except ValueError as error:
            raise InputError(
                "redirect_denied",
                "Redirect destination is outside policy",
                capture=document,
            ) from error
        target_key = url_key(target)
        if target_key in seen:
            raise InputError(
                "redirect_denied",
                "Controlled redirect loop",
                capture=document,
            )
        if visited is not None:
            _check_unvisited(target, visited, capture=document)
        seen.add(target_key)
        current = target

    if document.http_status != 200:
        code = {401: "access_blocked", 403: "access_blocked", 429: "rate_limited"}.get(
            document.http_status, "http_error"
        )
        raise InputError(
            code, "Controlled site returned an unsuccessful status", capture=document
        )
    content_type = _parse_content_type(document)
    if content_type.get_content_type() != "text/html":
        raise InputError(
            "unsupported_content",
            "Controlled response must be text/html",
            capture=document,
        )
    return document


def _same_origin_link(source: Source, current: str, reference: str) -> str:
    if (
        not reference
        or len(reference) > 2048
        or any(ord(char) <= 32 or char in "\\\x7f" for char in reference)
        or INVALID_ESCAPE.search(reference)
    ):
        raise ValueError("Malformed link")
    parts = urlsplit(reference)
    if not parts.netloc and (parts.scheme or reference.startswith("//")):
        raise ValueError("Malformed link authority")
    target, _ = checked_url(source, urljoin(current, reference))
    if urlsplit(target).netloc != urlsplit(current).netloc:
        raise ValueError("Cross-origin link")
    return target


def url_key(url: str) -> str:
    parts = urlsplit(url)

    def normalize(match: re.Match[str]) -> str:
        char = chr(int(match[1], 16))
        return char if char in UNRESERVED else match[0].upper()

    return parts._replace(
        path=PERCENT_ESCAPE.sub(normalize, parts.path or "/"),
        query=PERCENT_ESCAPE.sub(normalize, parts.query),
        fragment="",
    ).geturl()


def _check_unvisited(
    target: str, visited: set[str], *, capture: CapturedInput | None = None
) -> None:
    if url_key(target) in visited:
        raise InputError(
            "pagination_loop", "Pagination revisited a requested URL", capture=capture
        )


def next_page(
    source: Source,
    document: CapturedInput,
    config: ExtractionConfiguration,
    visited: set[str],
) -> WebInput | None:
    pagination = config.pagination
    if pagination is None:
        return None
    page = Selector(
        _decode_html(document), url=document.location, adaptive=False, huge_tree=False
    )
    try:
        links = Query(config.selector_type, pagination.next_link_selector).select(page)
    except (SelectorSyntaxError, TypeError, ValueError) as error:
        raise InputError(
            "invalid_next_selector", "Next-link selector is invalid"
        ) from error
    if not links:
        return None
    link = links.first
    if len(links) != 1 or link.tag != "a" or not link.attrib.get("href"):
        raise InputError(
            "invalid_next_url",
            "Next-link selector must match a single anchor with href",
        )
    try:
        target = _same_origin_link(source, document.location, link.attrib["href"])
    except ValueError as error:
        raise InputError(
            "invalid_next_url", "Next-page destination is outside policy or malformed"
        ) from error
    _check_unvisited(target, visited)
    return WebInput(target)


def _robots_policy(origin: str) -> RobotFileParser:
    document, _, challenged = _get(f"{origin}/robots.txt")
    robots = RobotFileParser()
    if challenged:
        raise InputError(
            "access_blocked",
            "Controlled robots request was blocked",
            http_status=document.http_status,
        )
    if document.http_status in (404, 410):
        robots.allow_all = True
    elif document.http_status == 200:
        try:
            robots.parse(document.body.decode("utf-8-sig").splitlines())
        except UnicodeDecodeError as error:
            raise InputError(
                "robots_unavailable", "Controlled robots.txt must be UTF-8"
            ) from error
        if (
            robots.crawl_delay(USER_AGENT) is not None
            or robots.request_rate(USER_AGENT) is not None
        ):
            raise InputError(
                "robots_unavailable",
                "Controlled runner cannot enforce robots timing rules",
            )
    else:
        raise InputError(
            "robots_unavailable",
            "Controlled robots policy could not be obtained",
            http_status=document.http_status,
            retry_after_seconds=document.retry_after_seconds,
        )
    return robots


def _get(url: str) -> tuple[CapturedInput, str | None, bool]:
    body = bytearray()
    too_large = False

    def receive(chunk: bytes) -> int:
        nonlocal too_large
        if len(body) + len(chunk) > MAX_BODY_BYTES:
            too_large = True
            return CURL_WRITEFUNC_ERROR
        body.extend(chunk)
        return len(chunk)

    # Scrapling can log the full request or redirect URL. Keep that data in Evidence.
    token = set_logger(PRIVATE_FETCH_LOG)
    try:
        response = Fetcher.get(
            url,
            timeout=TIMEOUT_SECONDS,
            retries=1,
            follow_redirects=False,
            stealthy_headers=False,
            impersonate=None,
            headers={"User-Agent": USER_AGENT},
            proxies={"all": ""},
            content_callback=receive,
        )
    except Timeout as error:
        raise InputError("timeout", "Controlled HTTP request timed out") from error
    except CurlError as error:
        if too_large:
            raise InputError(
                "input_too_large", "HTTP response exceeds the 1 MiB limit"
            ) from error
        raise InputError("transport_error", "Controlled HTTP request failed") from error
    finally:
        reset_logger(token)
    document = CapturedInput(
        bytes(body),
        url,
        http_status=response.status,
        content_type=response.headers.get("content-type"),
        retry_after_seconds=_retry_after(response.headers.get("retry-after")),
    )
    challenge = response.headers.get("cf-mitigated", "").strip().lower() == "challenge"
    return document, response.headers.get("location"), challenge


def _retry_after(value: str | None) -> int | None:
    if not value:
        return None
    value = value.strip()
    if value.isascii() and value.isdecimal():
        # Saturate large values without converting an unbounded integer.
        return min(86_400, int((value.lstrip("0") or "0")[:6]))
    try:
        date = parsedate_to_datetime(value)
        if date.tzinfo is not None:
            return max(0, ceil((date - datetime.now(UTC)).total_seconds()))
    except (ValueError, TypeError, OverflowError):
        return None
    return None


def _parse_content_type(document: CapturedInput) -> Message:
    message = Message()
    message["Content-Type"] = document.content_type or "application/octet-stream"
    return message


def _decode_html(document: CapturedInput) -> str:
    encoding = _parse_content_type(document).get_content_charset() or "utf-8"
    try:
        return document.body.decode(encoding)
    except (LookupError, UnicodeDecodeError) as error:
        raise InputError(
            "invalid_encoding", "HTML bytes do not match the response encoding"
        ) from error


def html_candidates(
    document: CapturedInput, config: ExtractionConfiguration
) -> list[CandidateRecord]:
    html = _decode_html(document)
    rules = {
        field.name: Field(
            Query(field.selector_type or config.selector_type, field.selector),
            attribute=field.attribute,
            resolve_url=field.resolve_url,
        )
        for field in config.fields
    }
    rules_config = ExtractionConfig(
        Query(config.selector_type, config.item_selector), rules
    )
    try:
        records = extract(
            html,
            document.location,
            rules_config,
            max_records=MAX_ITEMS,
            max_value_bytes=MAX_EXTRACTED_VALUE_BYTES,
        )
    except ExtractionSizeLimit as error:
        raise InputError(
            "extraction_size_limit", "HTML extracted values exceed the 1 MiB limit"
        ) from error
    except OverflowError as error:
        raise InputError("row_limit", "HTML exceeds the 10,000 item limit") from error
    except (SelectorSyntaxError, TypeError, ValueError) as error:
        raise InputError(
            "invalid_selector", "Configured selectors could not select HTML nodes"
        ) from error
    if not records:
        raise InputError("no_records", "The item selector matched no records")
    return [
        CandidateRecord(
            source_position=SourcePosition(kind="html_item", index=index),
            payload=record.payload,
        )
        for index, record in enumerate(records, start=1)
    ]
