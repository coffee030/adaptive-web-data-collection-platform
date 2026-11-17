import hashlib
import socket
from contextlib import contextmanager
from http.server import ThreadingHTTPServer
from threading import Thread
from typing import ClassVar
from urllib.parse import parse_qs, urlsplit

import pytest
from curl_cffi import CurlOpt
from curl_cffi.requests.exceptions import ConnectionError, Timeout
from pydantic import ValidationError

from backend.core import public_network, web_adapter
from backend.core.contracts import ExtractionConfiguration, Source
from backend.core.evidence import LocalEvidenceStore
from backend.core.inputs import InputError, KeywordInput, WebInput
from backend.core.origin_rate import RequestCooldown
from backend.core.profiles import ProfileError, ProfileRepository
from backend.core.robots import parse_policy
from backend.core.runner import CollectionRunner
from backend.core.search import initial_input
from backend.tests.m3_fixture_site import FixtureHandler
from backend.tests.m7_fixture import KEYWORD, search_config

HTTPS = "https://public.example"


class TestRate:
    __test__ = False

    def __init__(self):
        self.timings = []

    @contextmanager
    def request(self, origin, interval_ms, deadline):
        timing = RequestCooldown(interval_ms)
        self.timings.append(timing)
        yield timing


@pytest.fixture
def website():
    class Handler(FixtureHandler):
        metrics: ClassVar[list[tuple[str, float, float]]] = []

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}", Handler.metrics
        finally:
            server.shutdown()
            thread.join()


def source(origin, **updates):
    return Source.model_validate(
        {
            "source_id": "fixture",
            "source_name": "Controlled search",
            "adapter_type": "web",
            "permission_reference": "Controlled test",
            "approval_status": "approved",
            "allowed_origins": [origin],
            **updates,
        }
    )


def setup(tmp_path, origin, layout="cards", *, rate=None, search=None, **updates):
    config = search_config(origin, layout)
    config["search"].update(search or {})
    config.update(updates)
    profile_config = ExtractionConfiguration.model_validate(config)
    profiles = ProfileRepository.from_snapshot(source(origin))
    runner = CollectionRunner(
        profiles, LocalEvidenceStore(tmp_path), rate=rate or TestRate()
    )
    draft = profiles.create_draft("fixture", profile_config)
    return runner, draft


def approve(runner, draft, keyword="quick"):
    version = draft.profile_version_id
    report = runner.validate(version, KeywordInput(keyword))
    assert report.passed, report.error
    runner.profiles.approve(version, approver="tester", report_id=report.report_id)
    return version


@pytest.mark.parametrize("layout", ["cards", "catalog"])
def test_two_search_layouts_preserve_keyword_and_detail_lineage(
    tmp_path, website, layout
):
    origin, requests = website
    runner, draft = setup(tmp_path, origin, layout)
    assert (
        runner.preview(draft.profile_version_id, KeywordInput(KEYWORD))[0].payload[
            "title"
        ]
        == "Alpha"
    )
    version = approve(runner, draft, KEYWORD)
    requests.clear()
    result = runner.run(version, KeywordInput(KEYWORD))
    assert result.status == "partial" and result.error is None
    assert [item.capture_kind for item in result.all_evidence] == [
        "search",
        "search",
        "detail",
        "detail",
        "detail",
    ]
    assert [item.page_number for item in result.all_evidence] == [1, 2, 3, 4, 5]
    assert len(requests) == 6 and requests[0][0] == "/robots.txt"
    parameter = "q" if layout == "cards" else "term"
    for item in result.all_evidence[:2]:
        assert parse_qs(urlsplit(item.original_location).query)[parameter] == [KEYWORD]
    alpha, beta, rejected = result.all_evidence[2:]
    assert {
        item.payload["title"]: item.evidence_reference for item in result.records
    } == {
        "Alpha": alpha.evidence_id,
        "Beta": beta.evidence_id,
    }
    assert result.invalid[0].evidence_reference == rejected.evidence_id
    for item in result.all_evidence:
        reference, raw = runner.evidence.resolve(item.evidence_id)
        assert (
            reference == item and hashlib.sha256(raw).hexdigest() == item.content_hash
        )
        assert (
            item.config_hash == draft.config_hash and item.profile_version_id == version
        )


@pytest.mark.parametrize(
    ("keyword", "status", "error", "captures"),
    [
        ("empty", "failed", "empty_search_results", 1),
        ("loop", "partial", "pagination_loop", 2),
        ("bad-next", "partial", "invalid_next_url", 2),
        ("bad-link", "failed", "invalid_detail_url", 1),
        ("detail404", "partial", "http_error", 3),
        ("detail403", "partial", "access_blocked", 3),
        ("detail429", "partial", "rate_limited", 3),
        ("detail503", "partial", "http_error", 3),
        ("redirect", "partial", "redirect_denied", 3),
        ("oversize", "partial", "input_too_large", 2),
    ],
)
def test_search_failure_outcomes(tmp_path, website, keyword, status, error, captures):
    origin, requests = website
    rate = TestRate()
    runner, draft = setup(tmp_path, origin, rate=rate)
    version = approve(runner, draft)
    requests.clear()
    result = runner.run(version, KeywordInput(keyword))
    assert (result.status, result.error.code, len(result.all_evidence)) == (
        status,
        error,
        captures,
    )
    assert len(result.records) == (1 if status == "partial" else 0)
    assert all("169.254" not in path for path, _, _ in requests)
    if keyword == "detail429":
        assert result.error.retry_after_seconds == 33
        assert rate.timings[-1].retry_after_ms == 33_000


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"search": {"result_item_selector": "["}}, "invalid_search_selector"),
        ({"search": {"detail_link_selector": ".missing"}}, "invalid_detail_link"),
        ({"item_selector": "["}, "invalid_selector"),
        (
            {"search": {"pagination": {"next_link_selector": "[", "max_pages": 2}}},
            "invalid_next_selector",
        ),
    ],
)
def test_invalid_rules_cannot_be_approved(tmp_path, website, overrides, code):
    origin, _ = website
    runner, draft = setup(tmp_path, origin, **overrides)
    report = runner.validate(draft.profile_version_id, KeywordInput(KEYWORD))
    assert not report.passed and report.error.code == code
    with pytest.raises(ProfileError, match="passing validation"):
        runner.profiles.approve(
            draft.profile_version_id, approver="tester", report_id=report.report_id
        )


@pytest.mark.parametrize(
    ("limits", "code", "capture_count"),
    [
        ({"max_detail_pages": 1}, "detail_limit_reached", 3),
        (
            {"pagination": {"next_link_selector": "a.next", "max_pages": 1}},
            "page_limit_reached",
            2,
        ),
        ({"max_requests": 3}, "request_limit_reached", 2),
    ],
)
def test_search_request_and_page_budgets(
    tmp_path, website, limits, code, capture_count
):
    origin, _ = website
    runner, draft = setup(tmp_path, origin, search=limits)
    result = runner.run(approve(runner, draft), KeywordInput(KEYWORD))
    assert result.error.code == code
    assert len(result.all_evidence) == capture_count


@pytest.mark.parametrize(
    "url",
    [
        "https://other.example/search",
        "http://public.example/search",
        "https://public.example:443/search",
        "https://PUBLIC.example/search",
        "https://public.example./search",
        "https://user@public.example/search",
        "https://public.example/catalogue/one",
        "https://public.example/catalog/%252e%252e/secret",
        "https://public.example/catalog/%2fsecret",
        "https://public.example/catalog/%2e%2e/secret",
        "https://public.example/catalog/%ff",
        "https://public.example/catalog/%0d",
        "https://public.example/catalog/%ZZ",
    ],
)
def test_https_origin_and_path_denials(url):
    approved = source(HTTPS, allowed_paths={HTTPS: ["/catalog/"]})
    with pytest.raises(InputError) as error:
        web_adapter.checked_url(approved, url)
    assert error.value.error.code == "destination_denied"
    assert (
        web_adapter.checked_url(approved, HTTPS + "/catalog/item?q=a%26b")[1] == HTTPS
    )


def test_public_configuration_and_entry_are_independently_authorized(tmp_path):
    runner, draft = setup(tmp_path, HTTPS)
    with pytest.raises(InputError, match="keyword input"):
        initial_input(
            source(HTTPS), draft.configuration, WebInput(HTTPS + "/m7/cards/search")
        )
    with pytest.raises(ProfileError, match="outside the authorized"):
        ProfileRepository.from_snapshot(source("https://other.example")).create_draft(
            "fixture", draft.configuration
        )
    with pytest.raises(ValidationError, match="absolute URL path"):
        setup(tmp_path, HTTPS, search={"path": "//other.example/%2f"})
    runner.profiles.set_source_authorization(source(HTTPS, approval_status="pending"))
    with pytest.raises(ProfileError, match="not authorized"):
        runner.preview(draft.profile_version_id, KeywordInput("quick"))
    assert (
        runner.run(draft.profile_version_id, KeywordInput("quick")).error.code
        == "profile_not_approved"
    )


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",
        "10.4.3.2",
        "169.254.169.254",
        "168.63.129.16",
        "224.0.0.1",
        "::1",
        "fe80::1",
        "::ffff:1.1.1.1",
        "64:ff9b::a9fe:a9fe",
        "2002:7f00:1::",
    ],
)
def test_dns_rejects_mixed_public_and_unsafe_answers(monkeypatch, ip):
    def answers(host, port, *args):
        assert host == "public.example." and port == 443
        return [(0, 0, 0, "", (address, 443)) for address in ("1.1.1.1", ip)]

    monkeypatch.setattr(socket, "getaddrinfo", answers)
    with pytest.raises(InputError) as error:
        public_network.resolve_public("public.example", 1)
    assert error.value.error.code == "destination_denied"


def test_pinned_https_uses_tls_authority_and_verifies_peer(monkeypatch):
    class Session:
        def __init__(self, *, trust_env, curl_options):
            assert not trust_env
            assert curl_options[CurlOpt.RESOLVE] == [
                "public.example:443:1.1.1.1,[2606:4700:4700::1111]"
            ]
            assert curl_options[CurlOpt.PROXY] == b""

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def get(self, url, *, allow_redirects, verify, **kwargs):
            assert url == HTTPS + "/robots.txt" and not allow_redirects and verify
            return type(
                "Response", (), {"primary_ip": "127.0.0.1", "status_code": 200}
            )()

    monkeypatch.setattr(public_network, "Session", Session)
    with pytest.raises(InputError, match="peer did not match"):
        public_network.public_get(
            HTTPS + "/robots.txt", 1, None, "test", ("1.1.1.1", "2606:4700:4700::1111")
        )


def test_rebinding_rechecks_dns_before_each_redirect_and_connection_errors_are_safe(
    monkeypatch,
):
    config = ExtractionConfiguration.model_validate(search_config(HTTPS, "cards"))
    approved = source(HTTPS)
    addresses = iter(["1.1.1.1", "1.1.1.1", "127.0.0.1"])
    monkeypatch.setattr(
        socket, "getaddrinfo", lambda *args: [(0, 0, 0, "", (next(addresses), 443))]
    )
    calls = []

    def get(url, timeout, receive, ua, pins):
        assert pins == ("1.1.1.1",)
        calls.append(url)
        if url.endswith("robots.txt"):
            receive(b"User-agent: *\nAllow: /\n")
            return type(
                "Response", (), {"headers": {"content-type": "text/plain"}}
            )(), 200
        receive(b"redirect")
        return type(
            "Response", (), {"headers": {"location": "/m7/cards/redirected"}}
        )(), 302

    monkeypatch.setattr(web_adapter, "public_get", get)
    requests = web_adapter.SearchRequests(
        approved, config.search, TestRate(), lambda: None
    )
    with pytest.raises(InputError) as denied:
        web_adapter.capture_html(
            approved,
            initial_input(approved, config, KeywordInput("quick")),
            requests=requests,
        )
    assert denied.value.error.code == "destination_denied" and len(calls) == 2

    def fail(*args):
        raise ConnectionError("untrusted URL or upstream context")

    monkeypatch.setattr(web_adapter, "public_get", fail)
    with pytest.raises(InputError, match="Controlled HTTP request failed"):
        web_adapter._get(HTTPS, addresses=("1.1.1.1",))


def test_robots_uses_specific_groups_longest_match_wildcards_and_strictest_timing():
    policy = parse_policy(
        b"""User-agent: *
Disallow: /
User-agent: FYP-Collection-Core
Disallow: /m7/*?x=*
Allow: /m7/safe?x=yes$
Crawl-delay: 1.25
User-agent: FYP-Collection-Core
Request-rate: 2/3
Disallow: /%70rivate
""",
        "FYP-Collection-Core",
    )
    assert policy.interval_ms == 1500
    assert policy.can_fetch("", HTTPS + "/m7/safe?x=yes")
    assert not policy.can_fetch("", HTTPS + "/m7/safe?x=yes&y=no")
    assert not policy.can_fetch("", HTTPS + "/private")
    assert policy.can_fetch("", HTTPS + "/elsewhere")
    with pytest.raises(InputError, match="exceeds"):
        parse_policy(b"User-agent: *\nCrawl-delay: 90", "FYP-Collection-Core")


@pytest.mark.parametrize(
    ("status", "body", "expected"),
    [
        (200, b"User-agent: *\nDisallow: /m7/\n", "robots_denied"),
        (200, b"\xff", "robots_unavailable"),
        (403, b"Forbidden", "access_blocked"),
        (503, b"Unavailable", "robots_unavailable"),
    ],
)
def test_public_robots_denial_or_unavailable_never_fetches_search(
    monkeypatch, status, body, expected
):
    config = ExtractionConfiguration.model_validate(search_config(HTTPS, "cards"))
    approved = source(HTTPS)
    monkeypatch.setattr(
        socket, "getaddrinfo", lambda *args: [(0, 0, 0, "", ("1.1.1.1", 443))]
    )

    def get(url, timeout, receive, ua, pins):
        assert url == HTTPS + "/robots.txt"
        receive(body)
        return type(
            "Response", (), {"headers": {"content-type": "text/plain"}}
        )(), status

    monkeypatch.setattr(web_adapter, "public_get", get)
    requests = web_adapter.SearchRequests(
        approved, config.search, TestRate(), lambda: None
    )
    with pytest.raises(InputError) as denied:
        web_adapter.capture_html(
            approved,
            initial_input(approved, config, KeywordInput("quick")),
            requests=requests,
        )
    assert denied.value.error.code == expected


def test_pinned_https_timeout_is_reported_without_raw_transport_context(monkeypatch):
    def timeout(*args):
        raise Timeout("untrusted upstream detail")

    monkeypatch.setattr(web_adapter, "public_get", timeout)
    with pytest.raises(InputError, match="Controlled HTTP request timed out") as error:
        web_adapter._get(HTTPS, addresses=("1.1.1.1",))
    assert error.value.error.code == "timeout" and error.value.capture is None
