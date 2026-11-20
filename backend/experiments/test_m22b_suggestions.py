"""Replay reference routes and independently check the held-back details."""

from contextlib import contextmanager

import pytest
from pydantic import TypeAdapter, ValidationError

from backend.core.contracts import (
    COMPOSE_FIXTURE_ORIGIN,
    ExtractionConfiguration,
    Source,
)
from backend.core.ingestion import ingest
from backend.core.inputs import CapturedInput, InputError
from backend.core.origin_rate import RequestCooldown
from backend.core.search import SearchTraversal
from backend.core.suggestion_models import Examples, Homepage, SuggestionRequest
from backend.core.suggestions import SuggestionAttempt
from backend.core.web_adapter import html_candidates
from backend.experiments.m22a_fixture import KEYWORD, ROBOTS, fixture_html

ORIGIN = COMPOSE_FIXTURE_ORIGIN
CARDS = "/m22a/cards/reference"
CATALOG = "/m22a/catalog/reference"
QUERY = "C%2B%2B+%26+tea"


class Rate:
    @contextmanager
    def request(self, origin, interval, deadline):
        yield RequestCooldown(interval)


@pytest.fixture
def replay(monkeypatch):
    monkeypatch.setenv("M3_COMPOSE_FIXTURE", "1")
    calls = []
    overrides = {}

    def get(url, **options):
        calls.append(url.removeprefix(ORIGIN))
        route = calls[-1]
        assert options["max_body"] == 512_000
        assert 0 < options["timeout"] <= 2
        if route == "/robots.txt":
            robots = overrides.get(route, ROBOTS)
            return (
                CapturedInput(robots, url, http_status=200, content_type="text/plain"),
                None,
                False,
            )
        if route in overrides:
            result = overrides[route]
            if isinstance(result, Exception):
                raise result
            if isinstance(result, tuple):
                status, location = result
                return CapturedInput(b"", url, http_status=status), location, False
        else:
            result = fixture_html(route)
        assert result is not None, f"Unexpected GET {route}"
        return (
            CapturedInput(
                result.encode(), url, http_status=200, content_type="text/html"
            ),
            None,
            False,
        )

    monkeypatch.setattr("backend.core.web_adapter._get", get)
    return calls, overrides


def make_source(*paths, origin=ORIGIN):
    return Source(
        source_id="reference",
        source_name="Reference",
        approval_status="approved",
        adapter_type="web",
        permission_reference="Controlled reference",
        allowed_origins=(origin,),
        allowed_paths={origin: paths},
    )


def homepage(path, origin=ORIGIN):
    return Homepage(mode="homepage", keyword=KEYWORD, homepage_url=origin + path)


def examples(detail="alpha"):
    return Examples(
        mode="examples",
        keyword=KEYWORD,
        results_url=f"{ORIGIN}{CATALOG}/search?term={QUERY}",
        detail_url=f"{ORIGIN}{CATALOG}/detail/{detail}",
    )


def suggest(source, body, *, load=None, rate=None, reviewed=()):
    return SuggestionAttempt(
        source, load or (lambda: source), rate or Rate(), reviewed
    ).run(body)


def as_config(proposal):
    return ExtractionConfiguration(
        config_schema_version="1",
        record_schema=proposal.record_schema,
        selector_type="xpath",
        item_selector=proposal.item_selector,
        fields=tuple(field.mapping for field in proposal.fields),
        search=proposal.search,
    )


@pytest.mark.parametrize(
    "scope,key,hop", [(CARDS, "q", []), (CATALOG, "term", ["/find"])]
)
def test_reference(scope, key, hop, replay):
    calls, _ = replay
    source = make_source(scope)
    results = f"{scope}/search?{key}={QUERY}"
    expected_links = [f"{scope}/detail/alpha", f"{scope}/detail/beta"]
    result = suggest(source, homepage(scope + "/"))
    assert result.outcome == "usable", result
    assert calls == [
        "/robots.txt",
        scope + "/",
        *(scope + path for path in hop),
        results,
        expected_links[0],
    ]
    assert result.actual_attempts == result.reserved_requests == len(calls)
    assert [r.state for r in result.requests] == ["transport_attempt"] * len(calls)
    config = as_config(result.proposal)
    # Score the selectors with Core on both details. Beta is an offline holdout.
    traversal = SearchTraversal(source, config, Rate(), lambda: source)
    listing = CapturedInput(fixture_html(results).encode(), ORIGIN + results)
    assert [link.url for link in traversal._links(listing)] == [
        ORIGIN + path for path in expected_links
    ]
    for path, title, count in zip(
        expected_links, ["Alpha outlook", "Beta outlook"], [10, 20], strict=True
    ):
        detail = CapturedInput(fixture_html(path).encode(), ORIGIN + path)
        outcome = ingest(
            html_candidates(detail, config), config.record_schema, source.source_id
        )
        assert [record.payload for record in outcome.valid] == [
            {"title": title, "count": count}
        ]
        assert not outcome.invalid
    assert expected_links[1] not in calls


def test_examples_on_restricted_source(replay):
    calls, _ = replay
    source = make_source(CATALOG + "/search", CATALOG + "/detail")
    result = suggest(source, examples())
    assert result.outcome == "usable", result
    assert calls == [
        "/robots.txt",
        f"{CATALOG}/search?term={QUERY}",
        f"{CATALOG}/detail/alpha",
    ]
    assert result.actual_attempts == 3


def test_examples_must_be_listing_member(replay):
    calls, _ = replay
    result = suggest(make_source(CATALOG), examples("about"))
    assert (result.outcome, result.code) == ("unsupported", "mismatched_example")
    assert calls == ["/robots.txt", f"{CATALOG}/search?term={QUERY}"]


def test_fallback_and_ambiguity(replay):
    calls, overrides = replay
    url = CATALOG + "/manual"
    source = make_source(CATALOG)
    assert suggest(source, homepage(url)).outcome == "needs_examples"
    form = '<form action="search"><input name="q"><button>Search</button></form>'
    overrides[url] = form + form
    assert suggest(source, homepage(url)).code == "ambiguous_form"
    assert calls == ["/robots.txt", url] * 2


def test_wrong_title_is_unresolved(replay):
    _, overrides = replay
    overrides[CARDS + "/detail/alpha"] = (
        "<article><h2>Publications portal</h2><p class=count>10</p></article>"
    )
    result = suggest(make_source(CARDS), homepage(CARDS + "/"))
    assert result.outcome == "partial"
    assert result.proposal.item_selector is None
    assert all(field.mapping is None for field in result.proposal.fields)


def test_misleading_alternate_link_is_not_fetched(replay):
    calls, overrides = replay
    path = f"{CARDS}/search?q={QUERY}"
    overrides[path] = (
        '<ul><li><a href="detail/alpha">Alpha</a><a class="extra" href="detail/about">About</a></li>'
        '<li><a href="detail/beta">Beta</a><a class="extra" href="detail/contact">Contact</a></li></ul>'
    ).replace("<a href=", '<a class="publication" href=')
    result = suggest(make_source(CARDS), homepage(CARDS + "/"))
    assert result.code == "ambiguous_results"
    assert calls == ["/robots.txt", CARDS + "/", path]


def test_denial_and_prohibited_destination(replay):
    calls, overrides = replay
    source = make_source(CARDS)
    first = suggest(source, homepage("/"))
    assert first.outcome == "denied"
    assert first.requests[0].state == "denied_before_send"
    assert not calls
    overrides[CARDS + "/"] = (
        '<form action="/elsewhere"><input type="search" name="q"></form>'
    )
    second = suggest(source, homepage(CARDS + "/"))
    assert second.outcome == "denied"
    assert second.requests[-1].stage == "results"
    assert second.requests[-1].state == "denied_before_send"
    assert calls == ["/robots.txt", CARDS + "/"]


def test_access_revoked_after_reservation(replay):
    calls, _ = replay
    source = make_source(CARDS)

    class RevokedOnResults(Rate):
        checks = 0

        @contextmanager
        def request(self, origin, interval, deadline):
            self.checks += 1
            yield RequestCooldown(interval)

    rate = RevokedOnResults()
    result = suggest(
        source,
        homepage(CARDS + "/"),
        rate=rate,
        load=lambda: (
            source
            if rate.checks < 3
            else source.model_copy(update={"approval_status": "revoked"})
        ),
    )
    assert result.outcome == "denied"
    assert result.requests[-1].state == "reserved_unsent"
    assert result.actual_attempts == 2 and result.reserved_requests == 3
    assert calls == ["/robots.txt", CARDS + "/"]


def test_three_request_ceiling_and_hop_preflight(replay):
    calls, _ = replay
    source = make_source(CATALOG)
    initial = suggest(source, examples())
    calls.clear()
    search = initial.proposal.search
    tight = suggest(source, homepage(CATALOG + "/"), reviewed=(search,))
    assert tight.outcome == "budget_exhausted"
    assert tight.limits.reviewed_profile_limits
    assert not calls
    four = search.model_copy(update={"max_requests": 4})
    no_hop = suggest(source, homepage(CATALOG + "/"), reviewed=(four,))
    assert (no_hop.outcome, no_hop.stage) == ("budget_exhausted", "navigation")
    assert calls == ["/robots.txt", CATALOG + "/"]


def test_unknown_public_cap_is_conservative(replay):
    calls, _ = replay
    origin = "https://onboarding.example"
    result = suggest(make_source(CARDS, origin=origin), homepage(CARDS + "/", origin))
    assert result.outcome == "budget_exhausted"
    assert result.limits.policy == "public_conservative"
    assert result.limits.max_requests == 3 and result.limits.max_seconds == 15
    assert not calls


@pytest.mark.parametrize(
    "data",
    [
        {
            "mode": "homepage",
            "keyword": KEYWORD,
            "homepage_url": ORIGIN + CARDS,
            "max_requests": 20,
        },
        {"mode": "examples", "keyword": KEYWORD, "results_url": ORIGIN + CATALOG},
    ],
)
def test_request_has_mode_specific_inputs_and_no_client_limit(data):
    with pytest.raises(ValidationError):
        TypeAdapter(SuggestionRequest).validate_python(data)


def test_bad_example_inputs_send_nothing(replay):
    calls, _ = replay
    body = examples()
    source = make_source(CATALOG + "/search", CATALOG + "/detail")
    denied = suggest(
        source, body.model_copy(update={"detail_url": ORIGIN + CATALOG + "/manual"})
    )
    assert (denied.outcome, denied.stage) == ("denied", "entry")
    unsupported = suggest(
        source, body.model_copy(update={"results_url": body.results_url + "&lang=en"})
    )
    assert (unsupported.outcome, unsupported.code) == (
        "unsupported",
        "unsupported_examples",
    )
    assert not calls


def test_robots_forbid_page_before_its_transport(replay):
    calls, overrides = replay
    overrides["/robots.txt"] = b"User-agent: *\nDisallow: /\n"
    result = suggest(make_source(CARDS), homepage(CARDS + "/"))
    assert (result.outcome, result.code) == ("denied", "robots_denied")
    assert [row.state for row in result.requests] == [
        "transport_attempt",
        "denied_before_send",
    ]
    assert calls == ["/robots.txt"]


def test_robots_pacing_tightens_preflight(replay):
    calls, overrides = replay
    overrides["/robots.txt"] = ROBOTS + b"Crawl-delay: 10\n"
    result = suggest(make_source(CARDS), homepage(CARDS + "/"))
    assert (result.outcome, result.stage) == ("budget_exhausted", "homepage")
    assert result.limits.min_request_interval_ms == 10_000
    assert calls == ["/robots.txt"]


def test_expired_rate_wait_reserves_without_transport(replay):
    calls, _ = replay

    class RateBusy(Rate):
        @contextmanager
        def request(self, origin, interval, deadline):
            raise InputError(
                "origin_rate_busy", "The cooldown consumed the request budget"
            )
            yield

    result = suggest(make_source(CARDS), homepage(CARDS + "/"), rate=RateBusy())
    assert (result.outcome, result.stage) == ("budget_exhausted", "robots")
    assert result.reserved_requests == 1 and result.actual_attempts == 0
    assert result.requests[0].state == "reserved_unsent"
    assert not calls


@pytest.mark.parametrize(
    "failure,outcome",
    [
        (InputError("timeout", "Timed out"), "transient_failure"),
        ((302, "/private?secret=data"), "denied"),
    ],
)
def test_failed_or_redirected_fetch_counts_once(replay, failure, outcome):
    calls, overrides = replay
    overrides[CARDS + "/"] = failure
    result = suggest(make_source(CARDS), homepage(CARDS + "/"))
    assert result.outcome == outcome
    assert result.actual_attempts == 2
    assert calls == ["/robots.txt", CARDS + "/"]
    assert "secret" not in result.model_dump_json()


def test_development_only_markup_variation(replay):
    calls, overrides = replay
    scope = "/m22a/development"
    overrides[scope + "/"] = (
        '<form action="find"><input name="phrase"><button>Search</button></form>'
    )
    overrides[f"{scope}/find?phrase={QUERY}"] = (
        '<main><section><div class="result"><a href="a">First report</a></div>'
        '<div class="result"><a href="b">Second report</a></div></section></main>'
    )
    overrides[scope + "/a"] = (
        "<main><section><h3>First report</h3><dl><dt>Count</dt><dd>12</dd></dl></section></main>"
    )
    result = suggest(make_source(scope), homepage(scope + "/"))
    assert result.outcome == "usable", result
    assert [field.sample for field in result.proposal.fields] == [12, "First report"]
    assert calls == [
        "/robots.txt",
        scope + "/",
        f"{scope}/find?phrase={QUERY}",
        scope + "/a",
    ]
