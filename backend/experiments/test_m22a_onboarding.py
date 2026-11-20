"""Replay preselected paths and compare parsed output to fixed expectations."""

from contextlib import contextmanager
from dataclasses import replace
from urllib.parse import urlsplit

import pytest
from scrapling import Selector

from backend.core import web_adapter
from backend.core.contracts import ExtractionConfiguration, Source
from backend.core.evidence import LocalEvidenceStore
from backend.core.ingestion import ingest
from backend.core.inputs import CapturedInput, InputError, KeywordInput, WebInput
from backend.core.origin_rate import RequestCooldown
from backend.core.profiles import ProfileError, ProfileRepository
from backend.core.runner import CollectionRunner
from backend.core.search import SearchTraversal, initial_input
from backend.core.web_adapter import capture_html, checked_url, html_candidates
from backend.experiments.m22a_fixture import KEYWORD, ROBOTS, fixture_html
from backend.tests.m7_fixture import search_config

ORIGIN = "https://onboarding.example"
CARDS = "/m22a/cards/reference"
CATALOG = "/m22a/catalog/reference"
EXPECTED = (("Alpha outlook", 10), ("Beta outlook", 20))


class FixtureRate:
    @contextmanager
    def request(self, origin, interval_ms, deadline):
        assert origin == ORIGIN
        assert interval_ms >= 2000
        yield RequestCooldown(interval_ms)


@pytest.fixture
def requested(monkeypatch):
    requests = []

    def response(url, *, timeout, max_body, addresses):
        parts = urlsplit(url)
        path_query = parts.path + ("?" + parts.query if parts.query else "")
        requests.append(path_query)
        assert parts.netloc == "onboarding.example"
        assert 0 < timeout <= 2
        assert max_body == 512_000
        assert addresses == ("8.8.8.8",)
        if parts.path == "/robots.txt":
            body, media = ROBOTS, "text/plain"
        else:
            html = fixture_html(path_query)
            assert html is not None, path_query
            body, media = html.encode(), "text/html"
        return (
            CapturedInput(body, url, http_status=200, content_type=media),
            None,
            False,
        )

    # The transport is in memory. No resolver or socket is used by this replay.
    monkeypatch.setattr(web_adapter, "resolve_public", lambda *_: ("8.8.8.8",))
    monkeypatch.setattr(web_adapter, "_get", response)
    return requests


def approved_source(*prefixes):
    return Source(
        source_id="m22a-fixture",
        source_name="Synthetic onboarding source",
        adapter_type="web",
        permission_reference="M22A synthetic fixture only",
        approval_status="approved",
        allowed_origins=(ORIGIN,),
        allowed_paths={ORIGIN: prefixes},
        min_request_interval_ms=2000,
    )


def configuration(layout, path, key, limit):
    config = search_config(ORIGIN, layout)
    config["search"].update(
        path=path,
        keyword_parameter=key,
        result_item_selector="ul > li" if layout == "cards" else "//tbody/tr",
        detail_link_selector="a.publication"
        if layout == "cards"
        else "./td/a[@class='publication']",
        pagination=None,
        max_detail_pages=1,
        max_requests=limit,
        max_redirects=0,
        max_body_bytes=512_000,
        max_seconds=20,
        max_attempts=1,
    )
    return ExtractionConfiguration.model_validate(config)


def traversal_for(source, config):
    profiles = ProfileRepository.from_snapshot(source)
    return SearchTraversal(
        source,
        config,
        FixtureRate(),
        lambda: profiles.require_authorized(source.source_id),
    )


def check_draft(tmp_path, source, config, expected_detail):
    profiles = ProfileRepository.from_snapshot(source)
    draft = profiles.create_draft(source.source_id, config)
    runner = CollectionRunner(
        profiles, LocalEvidenceStore(tmp_path), rate=FixtureRate()
    )
    preview = runner.preview(draft.profile_version_id, KeywordInput(KEYWORD))
    report = runner.validate(draft.profile_version_id, KeywordInput(KEYWORD))
    assert report.passed
    assert (report.valid_count, report.invalid_count, report.duplicate_count) == (
        1,
        0,
        0,
    )
    assert report.sample_location == expected_detail
    assert report.config_hash == draft.config_hash
    return preview[0].payload


def check_payload(payload, expected):
    title, count = expected
    assert payload == {"title": title, "count": str(count)}


@pytest.mark.parametrize(
    ("layout", "scope", "key", "prefix", "hop", "limit"),
    [
        pytest.param("cards", CARDS, "q", "/", None, 4, id="direct-form"),
        pytest.param("catalog", CATALOG, "term", CATALOG, "/find", 5, id="one-hop"),
    ],
)
def test_preselected_path_shares_budget_and_passes_profile_checks(
    tmp_path, requested, layout, scope, key, prefix, hop, limit
):
    source = approved_source(prefix)
    config = configuration(layout, f"{scope}/search", key, limit)
    traversal = traversal_for(source, config)
    home = capture_html(
        source, WebInput(ORIGIN + scope + "/"), requests=traversal.requests
    )
    pages = [scope + "/"]
    form_doc = home
    if hop:
        links = Selector(home.body).css("a::attr(href)").getall()
        assert links == [scope + hop]
        pages += links
        form_doc = capture_html(
            source, WebInput(ORIGIN + links[0]), requests=traversal.requests
        )
    form = Selector(form_doc.body).css("form")
    assert len(form) == 1
    assert form.first.attrib["method"] == "get"
    assert form.first.attrib["action"] == f"{scope}/search"
    assert form.first.css("input::attr(name)").getall() == [key]

    entry = initial_input(source, config, KeywordInput(KEYWORD))
    expected_search = f"{scope}/search?{key}=C%2B%2B+%26+tea"
    assert entry.url == ORIGIN + expected_search
    expected_detail = f"{scope}/detail/alpha"
    first = traversal.sample(entry)
    assert first.location == ORIGIN + expected_detail
    check_payload(html_candidates(first, config)[0].payload, EXPECTED[0])
    assert requested == ["/robots.txt", *pages, expected_search, expected_detail]
    assert traversal.requests.remaining == 0

    # Offline link recall and value checks do not spend additional HTTP requests.
    listing = fixture_html(expected_search)
    assert listing is not None
    assert f"{scope}/detail/about" in listing
    links = list(traversal._links(CapturedInput(listing.encode(), entry.url)))
    assert [link.url for link in links] == [
        f"{ORIGIN}{scope}/detail/alpha",
        f"{ORIGIN}{scope}/detail/beta",
    ]
    second_path = f"{scope}/detail/beta"
    second = fixture_html(second_path)
    assert second is not None
    holdout = CapturedInput(second.encode(), ORIGIN + second_path)
    result = ingest(
        html_candidates(holdout, config), config.record_schema, source.source_id
    )
    title, count = EXPECTED[1]
    assert [record.payload for record in result.valid] == [
        {"title": title, "count": count}
    ]
    assert not result.invalid
    assert not result.duplicates
    assert len(requested) == limit

    requested.clear()
    preview = check_draft(tmp_path, source, config, ORIGIN + expected_detail)
    check_payload(preview, EXPECTED[0])
    assert requested == ["/robots.txt", expected_search, expected_detail] * 2


def test_manual_examples_after_unsupported_post(tmp_path, requested):
    source = approved_source(CATALOG)
    config = configuration("catalog", f"{CATALOG}/search", "term", 3)
    manual_page = fixture_html(f"{CATALOG}/manual")
    assert Selector(manual_page).css("form").first.attrib["method"] == "post"

    listing = f"{ORIGIN}{CATALOG}/search?term=C%2B%2B+%26+tea"
    detail = f"{ORIGIN}{CATALOG}/detail/alpha"
    assert checked_url(source, listing)[0] == listing
    assert checked_url(source, detail)[0] == detail
    assert initial_input(source, config, KeywordInput(KEYWORD)).url == listing
    preview = check_draft(tmp_path, source, config, detail)
    check_payload(preview, EXPECTED[0])
    assert (
        requested
        == [
            "/robots.txt",
            urlsplit(listing).path + "?" + urlsplit(listing).query,
            urlsplit(detail).path,
        ]
        * 2
    )


def test_script_only_has_no_static_get_contract(requested):
    html = fixture_html(f"{CARDS}/script-only")
    assert html is not None
    page = Selector(html)
    assert page.css("button#search")
    assert page.css("script")
    assert not page.css("form")
    assert not requested


@pytest.mark.parametrize("target", [f"{ORIGIN}/", "https://outside.example/find"])
def test_disallowed_entry_stops_before_robots(requested, target):
    source = approved_source(f"{CATALOG}/search", f"{CATALOG}/detail")
    config = configuration("catalog", f"{CATALOG}/search", "term", 3)
    traversal = traversal_for(source, config)
    assert initial_input(source, config, KeywordInput(KEYWORD)).url.startswith(
        ORIGIN + CATALOG
    )
    with pytest.raises(InputError) as denied:
        capture_html(source, WebInput(target), requests=traversal.requests)
    assert denied.value.error.code == "destination_denied"
    assert not requested
    assert traversal.requests.remaining == 3


def test_revoked_source_stops_before_robots(requested):
    source = approved_source("/").model_copy(update={"approval_status": "revoked"})
    config = configuration("cards", f"{CARDS}/search", "q", 4)
    traversal = traversal_for(source, config)
    with pytest.raises(InputError) as denied:
        capture_html(
            source, WebInput(ORIGIN + CARDS + "/"), requests=traversal.requests
        )
    assert denied.value.error.code == "source_not_approved"
    assert not requested


def test_budget_exhausts_before_detail_with_three_request_cap(requested):
    source = approved_source("/")
    config = configuration("cards", f"{CARDS}/search", "q", 3)
    traversal = traversal_for(source, config)
    capture_html(source, WebInput(ORIGIN + CARDS + "/"), requests=traversal.requests)
    with pytest.raises(InputError) as exhausted:
        traversal.sample(initial_input(source, config, KeywordInput(KEYWORD)))
    assert exhausted.value.error.code == "request_limit_reached"
    assert requested == [
        "/robots.txt",
        CARDS + "/",
        f"{CARDS}/search?q=C%2B%2B+%26+tea",
    ]


def test_first_sample_accepts_nonempty_wrong_title_and_misses_later_wrong_link(
    tmp_path, requested, monkeypatch
):
    config = configuration("cards", f"{CARDS}/search", "q", 4)
    # Keep only the first anchor per row and deliberately select the site-wide heading.
    raw = config.model_dump()
    raw["search"]["detail_link_selector"] = "a:first-child"
    raw["item_selector"] = "html"
    next(field for field in raw["fields"] if field["name"] == "title")["selector"] = (
        "h1"
    )
    wrong = ExtractionConfiguration.model_validate(raw)
    source = approved_source("/")
    search_url = ORIGIN + CARDS + "/search?q=C%2B%2B+%26+tea"
    listing = fixture_html(CARDS + "/search?q=C%2B%2B+%26+tea")
    assert listing is not None
    listing_body = listing.replace("/detail/beta", "/detail/about").encode()
    fixture_get = web_adapter._get

    def changed_listing(url, **options):
        document, location, challenge = fixture_get(url, **options)
        if url == search_url:
            document = replace(document, body=listing_body)
        return document, location, challenge

    monkeypatch.setattr(web_adapter, "_get", changed_listing)
    preview = check_draft(tmp_path, source, wrong, ORIGIN + CARDS + "/detail/alpha")
    assert preview == {"title": "Publications portal", "count": "10"}
    assert preview["title"] != EXPECTED[0][0]
    assert len(requested) == 6

    # A second row pointing to a permitted About page is still semantically wrong.
    traversal = traversal_for(source, wrong)
    links = list(traversal._links(CapturedInput(listing_body, search_url)))
    assert [link.url for link in links] == [
        ORIGIN + CARDS + "/detail/alpha",
        ORIGIN + CARDS + "/detail/about",
    ]
    assert links[1].url != ORIGIN + CARDS + "/detail/beta"
    assert len(requested) == 6


def test_broad_anchor_selector_is_rejected(tmp_path, requested):
    config = configuration("cards", f"{CARDS}/search", "q", 4)
    raw = config.model_dump()
    raw["search"]["detail_link_selector"] = "a"
    profiles = ProfileRepository.from_snapshot(approved_source("/"))
    draft = profiles.create_draft(
        "m22a-fixture", ExtractionConfiguration.model_validate(raw)
    )
    runner = CollectionRunner(
        profiles, LocalEvidenceStore(tmp_path), rate=FixtureRate()
    )
    report = runner.validate(draft.profile_version_id, KeywordInput(KEYWORD))
    assert report.error.code == "invalid_detail_link"
    assert not report.passed
    with pytest.raises(ProfileError, match="passing validation report"):
        profiles.approve(
            draft.profile_version_id, approver="test", report_id=report.report_id
        )
    assert requested == ["/robots.txt", f"{CARDS}/search?q=C%2B%2B+%26+tea"]
