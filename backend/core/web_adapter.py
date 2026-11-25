"""Read a single controlled HTML document through Scrapling."""

import logging
import re
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from email.message import Message
from email.utils import parsedate_to_datetime
from math import ceil
from time import monotonic
from urllib.parse import unquote, urldefrag, urljoin, urlsplit
from urllib.robotparser import RobotFileParser

from cssselect import SelectorSyntaxError
from curl_cffi import CurlError
from curl_cffi.curl import CURL_WRITEFUNC_ERROR
from curl_cffi.requests.exceptions import Timeout
from lxml.etree import XPathError
from scrapling import Selector
from scrapling.core.utils import reset_logger, set_logger
from scrapling.fetchers import Fetcher

from .contracts import (
    CandidateRecord,
    ExtractionConfiguration,
    KeywordSearch,
    NextLinkPagination,
    Source,
    SourcePosition,
    controlled_origin,
    path_segments,
)
from .html_extraction import (
    ExtractionConfig,
    ExtractionSizeLimit,
    Field,
    Query,
    extract,
)
from .inputs import CapturedInput, InputError, WebInput
from .origin_rate import OriginRate
from .public_network import public_get, resolve_public
from .robots import RobotsPolicy, parse_policy

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
    if origin.startswith("https://") or origin in source.allowed_paths:
        try:
            if not url.isascii() or INVALID_ESCAPE.search(parts.query):
                raise ValueError("Invalid URL encoding")
            segments = path_segments(parts.path or "/")
        except ValueError as error:
            raise InputError(
                "destination_denied", "Invalid controlled URL encoding or path"
            ) from error
        prefixes = source.allowed_paths.get(origin, ())
        if prefixes and not any(
            segments[: len(prefix)] == prefix
            for prefix in (
                path_segments(value)[:-1]
                if value.endswith("/")
                else path_segments(value)
                for value in prefixes
            )
        ):
            raise InputError(
                "destination_denied", "URL path is outside the Source allowlist"
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
    requests: "SearchRequests | None" = None,
    duplicate_code: str = "pagination_loop",
    forbidden: set[str] | None = None,
) -> CapturedInput:
    if source.approval_status != "approved":
        raise InputError("source_not_approved", "Source access is not authorized")
    current, origin = checked_url(source, entry.url)
    if requests is None and origin.startswith("https://"):
        raise InputError(
            "keyword_required", "Public HTTPS requires a keyword search profile"
        )
    requested = current
    if visited is not None:
        _check_unvisited(current, visited, code=duplicate_code)
    if check_access is not None:
        check_access()
    robots = requests.robots(origin) if requests is not None else _robots_policy(origin)
    max_redirects = (
        requests.config.max_redirects if requests is not None else MAX_REDIRECTS
    )
    seen = {url_key(current)}
    for hop in range(max_redirects + 1):
        if not robots.can_fetch(USER_AGENT, current):
            raise InputError(
                "robots_denied", "Controlled robots policy disallows the URL"
            )
        if check_access is not None and requests is None:
            check_access()
        if visited is not None:
            visited.add(url_key(current))
        document, location, challenged = (
            requests.get(origin, current) if requests is not None else _get(current)
        )
        document = replace(document, requested_location=requested)
        if _is_access_block(document, challenged):
            message = (
                "Controlled site declared a challenge"
                if challenged
                else "Controlled site returned an unsuccessful status"
            )
            raise InputError(
                "access_blocked",
                message,
                capture=document,
            )
        if document.http_status not in REDIRECTS:
            break
        if not location or hop == max_redirects:
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
        if forbidden is not None and target_key in forbidden:
            raise InputError(
                "invalid_detail_url",
                "Detail redirected to a search page",
                capture=document,
            )
        if target_key in seen:
            raise InputError(
                "redirect_denied",
                "Controlled redirect loop",
                capture=document,
            )
        if visited is not None:
            _check_unvisited(target, visited, capture=document, code=duplicate_code)
        seen.add(target_key)
        current = target

    if document.http_status != 200:
        code = "rate_limited" if document.http_status == 429 else "http_error"
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


def _is_access_block(document: CapturedInput, challenged: bool) -> bool:
    return challenged or document.http_status in (401, 403)


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
    if urlsplit(target)[:2] != urlsplit(current)[:2]:
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
    target: str,
    visited: set[str],
    *,
    capture: CapturedInput | None = None,
    code: str = "pagination_loop",
) -> None:
    if url_key(target) in visited:
        raise InputError(
            code, "Collection traversal revisited a requested URL", capture=capture
        )


def next_page(
    source: Source,
    document: CapturedInput,
    config: ExtractionConfiguration,
    visited: set[str],
    *,
    search_pagination: NextLinkPagination | None = None,
) -> WebInput | None:
    pagination = search_pagination or config.pagination
    if pagination is None:
        return None
    page = Selector(
        _decode_html(document), url=document.location, adaptive=False, huge_tree=False
    )
    try:
        links = Query(config.selector_type, pagination.next_link_selector).select(page)
    except (SelectorSyntaxError, XPathError, TypeError, ValueError) as error:
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


@dataclass(frozen=True)
class RequestLimits:
    max_requests: int
    max_redirects: int
    max_body_bytes: int
    timeout_seconds: int
    max_seconds: int
    min_interval_ms: int = 0


class SearchRequests:
    def __init__(
        self,
        source: Source,
        config: KeywordSearch | RequestLimits,
        rate: OriginRate,
        check_access: Callable[[], object],
        *,
        observe: Callable[[bool, str], None] | None = None,
    ):
        self.config = config
        self.rate = rate
        self.check_access = check_access
        self.deadline = monotonic() + config.max_seconds
        self.remaining = config.max_requests
        self.interval_ms = max(
            source.min_request_interval_ms,
            config.min_interval_ms if isinstance(config, RequestLimits) else 0,
        )
        self.observe = observe
        self.policy: RobotsPolicy | None = None

    def robots(self, origin: str) -> RobotsPolicy:
        if self.policy is None:
            self.get(origin, f"{origin}/robots.txt", robots=True)
        assert self.policy is not None
        return self.policy

    def get(
        self, origin: str, url: str, *, robots: bool = False
    ) -> tuple[CapturedInput, str | None, bool]:
        if not self.remaining:
            raise InputError(
                "request_limit_reached",
                "Collection exhausted its approved request budget",
            )
        self.remaining -= 1
        if self.observe is not None:
            self.observe(robots, "reserved_unsent")
        if monotonic() >= self.deadline:
            raise InputError(
                "collection_deadline", "Collection exhausted its approved time budget"
            )
        document = None
        blocked = False
        try:
            with self.rate.request(origin, self.interval_ms, self.deadline) as cooldown:
                self.check_access()
                deadline = min(self.deadline, monotonic() + self.config.timeout_seconds)
                addresses = ()
                if origin.startswith("https://"):
                    addresses = resolve_public(
                        urlsplit(origin).netloc, self._time_left(deadline)
                    )
                timeout = self._time_left(deadline)
                if self.observe is not None:
                    self.observe(robots, "transport_attempt")
                document, location, challenge = _get(
                    url,
                    timeout=timeout,
                    max_body=self.config.max_body_bytes,
                    addresses=addresses,
                )
                blocked = _is_access_block(document, challenge)
                if document.http_status == 429:
                    cooldown.retry_after_ms = (
                        max(30, document.retry_after_seconds or 0) * 1000
                    )
                if robots and not blocked:
                    self.policy = self._read_policy(document)
                    self.interval_ms = max(self.interval_ms, self.policy.interval_ms)
                    cooldown.interval_ms = self.interval_ms
        except InputError as error:
            if not blocked or error.error.code != "origin_rate_unavailable":
                if document is not None and not robots and error.capture is None:
                    raise InputError(
                        error.error.code, str(error), capture=document
                    ) from error
                raise
        if robots and blocked:
            raise InputError(
                "access_blocked",
                "Site blocked access to robots.txt",
                http_status=document.http_status,
            )
        return document, location, challenge

    @staticmethod
    def _time_left(deadline: float) -> float:
        remaining = deadline - monotonic()
        if remaining < 0.001:
            raise InputError("timeout", "Controlled request exhausted its time budget")
        return remaining

    @staticmethod
    def _read_policy(document: CapturedInput) -> RobotsPolicy:
        if document.http_status in (404, 410):
            return RobotsPolicy()
        if (
            document.http_status != 200
            or _parse_content_type(document).get_content_type() != "text/plain"
        ):
            raise InputError(
                "robots_unavailable",
                "Could not obtain a supported robots.txt policy",
                http_status=document.http_status,
                retry_after_seconds=document.retry_after_seconds,
            )
        return parse_policy(document.body, USER_AGENT.split("/", 1)[0])


def _get(
    url: str,
    *,
    timeout: float | None = None,
    max_body: int | None = None,
    addresses: tuple[str, ...] = (),
) -> tuple[CapturedInput, str | None, bool]:
    timeout = TIMEOUT_SECONDS if timeout is None else timeout
    max_body = MAX_BODY_BYTES if max_body is None else max_body
    body = bytearray()
    too_large = False

    def receive(chunk: bytes) -> int:
        nonlocal too_large
        if len(body) + len(chunk) > max_body:
            too_large = True
            return CURL_WRITEFUNC_ERROR
        body.extend(chunk)
        return len(chunk)

    # Scrapling can log the full request or redirect URL. Keep that data in Evidence.
    token = set_logger(PRIVATE_FETCH_LOG)
    try:
        if addresses:
            response, status = public_get(url, timeout, receive, USER_AGENT, addresses)
        else:
            response = Fetcher.get(
                url,
                timeout=timeout,
                retries=1,
                follow_redirects=False,
                stealthy_headers=False,
                impersonate=None,
                headers={"User-Agent": USER_AGENT},
                proxies={"all": ""},
                content_callback=receive,
            )
            status = response.status
    except Timeout as error:
        raise InputError("timeout", "Controlled HTTP request timed out") from error
    except CurlError as error:
        if too_large:
            raise InputError(
                "input_too_large", "HTTP response exceeds the configured byte limit"
            ) from error
        raise InputError("transport_error", "Controlled HTTP request failed") from error
    finally:
        reset_logger(token)
    document = CapturedInput(
        bytes(body),
        url,
        http_status=status,
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
    except (SelectorSyntaxError, XPathError, TypeError, ValueError) as error:
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
