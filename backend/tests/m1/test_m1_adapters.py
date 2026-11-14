from pathlib import Path

import pytest

from backend.core.contracts import ExtractionConfiguration, Source
from backend.core.csv_adapter import MAX_INPUT_BYTES, capture_csv, csv_candidates
from backend.core.inputs import CapturedInput, CsvInput, InputError, WebInput
from backend.core.web_adapter import USER_AGENT, capture_html, html_candidates

FIXTURES = Path(__file__).parents[1] / "fixtures" / "m0"


def fixture_source(origin):
    return Source(
        source_id="local-html",
        source_name="Controlled fixture",
        adapter_type="web",
        approval_status="approved",
        permission_reference="owned-fixture",
        allowed_origins=(origin,),
    )


def test_html_adapters_reuse_parser_for_css_and_xpath(cards_config, table_config):
    base = "http://127.0.0.1:8001/catalogue/page"
    cards = html_candidates(
        CapturedInput((FIXTURES / "cards.html").read_bytes(), base), cards_config
    )
    table = html_candidates(
        CapturedInput((FIXTURES / "table.html").read_bytes(), base), table_config
    )
    assert [item.payload for item in cards] == [
        {
            "key": "a1",
            "title": "North Trail",
            "link": "http://127.0.0.1:8001/items/a1",
            "note": "Open",
        },
        {"key": "b2", "title": None, "link": None, "note": None},
    ]
    assert [item.payload["title"] for item in table] == ["River Walk", "Lake View"]
    assert table[1].payload["link"].endswith("/items/d4#map")
    assert table[1].payload["note"] is None
    assert [item.source_position.index for item in table] == [1, 2]


@pytest.mark.parametrize(
    ("selector", "strategy", "code"),
    [
        (".absent", "css", "no_records"),
        ("[", "css", "invalid_selector"),
        ("//*[", "xpath", "invalid_selector"),
        ("count(//article)", "xpath", "invalid_selector"),
    ],
)
def test_html_selector_errors(cards_config, selector, strategy, code):
    config = ExtractionConfiguration.model_validate(
        {
            **cards_config.model_dump(),
            "selector_type": strategy,
            "item_selector": selector,
        }
    )
    with pytest.raises(InputError) as failure:
        html_candidates(
            CapturedInput(b"<article>Fixture</article>", "http://127.0.0.1:8001"),
            config,
        )
    assert failure.value.error.code == code


def test_csv_optional_columns_utf8_bom_and_physical_line_provenance(
    csv_source, csv_config
):
    body = (
        '\ufeffName,Count,Active\r\n"River\r\nWalk",7,true\r\n山徑,8,false\r\n'.encode()
    )
    document = capture_csv(csv_source, CsvInput("listing-sample", body))
    rows = csv_candidates(document, csv_config)
    assert document.body == body
    assert rows[0].payload == {
        "key": None,
        "title": "River\r\nWalk",
        "count": "7",
        "active": "true",
        "note": None,
    }
    assert [row.source_position.index for row in rows] == [2, 4]


@pytest.mark.parametrize(
    ("content", "code"),
    [
        (b"", "empty_csv"),
        (b"Name,Count,Active\n", "empty_csv"),
        (b"\xff", "invalid_encoding"),
        (b"Name,Active\nTrail,true\n", "missing_columns"),
        (b"Name,Name\nA,B\n", "invalid_header"),
        (b'Name,Count,Active\n"unclosed,3,true', "invalid_csv"),
    ],
)
def test_csv_input_errors(csv_config, content, code):
    with pytest.raises(InputError) as failure:
        csv_candidates(CapturedInput(content, "listing-sample"), csv_config)
    assert failure.value.error.code == code


def test_csv_rejects_unapproved_dataset_and_oversized_input(csv_source):
    for data, code in [
        (CsvInput("other", b"test"), "dataset_not_allowed"),
        (CsvInput("listing-sample", b"x" * (MAX_INPUT_BYTES + 1)), "input_too_large"),
    ]:
        with pytest.raises(InputError) as failure:
            capture_csv(csv_source, data)
        assert failure.value.error.code == code


def test_controlled_http_disables_proxy_stealth_and_retries(
    controlled_site, monkeypatch
):
    origin, requests, routes = controlled_site
    for key in (
        "NO_PROXY",
        "no_proxy",
        "ALL_PROXY",
        "all_proxy",
        "HTTP_PROXY",
        "http_proxy",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("http_proxy", f"{origin}/proxy")
    assert (
        capture_html(fixture_source(origin), WebInput(f"{origin}/redirect")).body
        == routes["/cards"][2]
    )
    assert [path for path, _ in requests] == ["/robots.txt", "/redirect", "/cards"]
    for _, headers in requests:
        assert headers["user-agent"] == USER_AGENT
        assert "referer" not in headers and "sec-ch-ua" not in headers


@pytest.mark.parametrize(
    ("endpoint", "code", "paths"),
    [
        (
            "/forbidden-redirect",
            "redirect_denied",
            ["/robots.txt", "/forbidden-redirect"],
        ),
        ("/loop", "redirect_denied", ["/robots.txt", "/loop"]),
        ("/go-denied", "robots_denied", ["/robots.txt", "/go-denied"]),
        ("/denied", "robots_denied", ["/robots.txt"]),
        ("/oversized", "input_too_large", ["/robots.txt", "/oversized"]),
        ("/rate", "rate_limited", ["/robots.txt", "/rate"]),
        ("/blocked", "access_blocked", ["/robots.txt", "/blocked"]),
        ("/challenge", "access_blocked", ["/robots.txt", "/challenge"]),
        ("/error", "http_error", ["/robots.txt", "/error"]),
    ],
)
def test_http_failures_are_bounded(controlled_site, endpoint, code, paths):
    origin, requests, _ = controlled_site
    with pytest.raises(InputError) as failure:
        capture_html(fixture_source(origin), WebInput(origin + endpoint))
    assert failure.value.error.code == code
    assert [path for path, _ in requests] == paths


def test_timeout_sends_one_page_request(controlled_site, monkeypatch):
    origin, requests, _ = controlled_site
    monkeypatch.setattr("backend.core.web_adapter.TIMEOUT_SECONDS", 0.15)
    with pytest.raises(InputError) as failure:
        capture_html(fixture_source(origin), WebInput(origin + "/slow"))
    assert failure.value.error.code == "timeout"
    assert [path for path, _ in requests] == ["/robots.txt", "/slow"]


@pytest.mark.parametrize(
    "path", ["/cards/../denied", "/cards/%2e%2E/denied", "/cards%2f..%2fdenied"]
)
def test_ambiguous_path_cannot_bypass_robots(controlled_site, path):
    origin, requests, routes = controlled_site
    routes["/denied"] = (200, {}, b"<html>Disallowed document</html>")
    with pytest.raises(InputError) as failure:
        capture_html(fixture_source(origin), WebInput(origin + path))
    assert failure.value.error.code == "destination_denied"
    assert requests == []


def test_ambiguous_redirect_path_is_never_requested(controlled_site):
    origin, requests, routes = controlled_site
    routes["/redirect"] = (302, {"Location": origin + "/cards/../denied"}, b"")
    with pytest.raises(InputError) as failure:
        capture_html(fixture_source(origin), WebInput(origin + "/redirect"))
    assert failure.value.error.code == "redirect_denied"
    assert [path for path, _ in requests] == ["/robots.txt", "/redirect"]


def test_controlled_http_does_not_log_input_url(controlled_site, caplog, capsys):
    origin, _, _ = controlled_site
    url = origin + "/cards?token=m5-synthetic-marker"
    document = capture_html(fixture_source(origin), WebInput(url))
    assert document.location == url
    assert "m5-synthetic-marker" not in caplog.text + capsys.readouterr().err


def test_html_rejects_amplified_extraction_output(cards_config):
    html = (
        '<article class="entry"><h2>'
        + "x" * 90_000
        + "</h2></article>"
        + '<article class="entry"></article>' * 100
    )
    fields = [
        field.model_copy(update={"selector_type": "xpath", "selector": "//h2"})
        if field.name == "title"
        else field
        for field in cards_config.fields
    ]
    config = ExtractionConfiguration.model_validate(
        {**cards_config.model_dump(), "fields": fields}
    )
    with pytest.raises(InputError) as failure:
        html_candidates(CapturedInput(html.encode(), "http://127.0.0.1:8001"), config)
    assert failure.value.error.code == "extraction_size_limit"


@pytest.mark.parametrize(
    "url",
    [
        "http://example.invalid/",
        "file:///a",
        "http://localhost:80",
        "//127.0.0.1:1",
        "http://127.0.0.1:1/",
    ],
)
def test_nonapproved_url_rejected_before_network(controlled_site, url):
    origin, requests, _ = controlled_site
    with pytest.raises(InputError) as failure:
        capture_html(fixture_source(origin), WebInput(url))
    assert failure.value.error.code == "destination_denied"
    assert requests == []


def test_adapter_rechecks_loopback_even_with_unvalidated_source_copy(controlled_site):
    origin, requests, _ = controlled_site
    url = "http://fixture.invalid:80"
    source = fixture_source(origin).model_copy(update={"allowed_origins": (url,)})
    with pytest.raises(InputError) as failure:
        capture_html(source, WebInput(url))
    assert failure.value.error.code == "destination_denied"
    assert requests == []


@pytest.mark.parametrize(
    ("robots", "code"),
    [
        ((403, {}, b"Denied"), "robots_unavailable"),
        ((302, {"Location": "/other-robots"}, b""), "robots_unavailable"),
        ((200, {}, b"User-agent: *\nCrawl-delay: 5\n"), "robots_unavailable"),
    ],
)
def test_robots_failure_stops_before_page_request(controlled_site, robots, code):
    origin, requests, routes = controlled_site
    routes["/robots.txt"] = robots
    with pytest.raises(InputError) as failure:
        capture_html(fixture_source(origin), WebInput(origin + "/cards"))
    assert failure.value.error.code == code
    assert [path for path, _ in requests] == ["/robots.txt"]


def test_html_capture_checks_authorization_before_each_hop(controlled_site):
    origin, requests, _ = controlled_site

    def check_access():
        if len(requests) == 2:
            raise InputError("source_not_approved", "Source access is not authorized")

    with pytest.raises(InputError) as failure:
        capture_html(
            fixture_source(origin),
            WebInput(origin + "/redirect"),
            check_access=check_access,
        )
    assert failure.value.error.code == "source_not_approved"
    assert [path for path, _ in requests] == ["/robots.txt", "/redirect"]


def test_html_uses_declared_encoding_without_changing_evidence(cards_config):
    html = '<article class="entry"><h2>Café</h2><a href="/coffee">Link</a></article>'
    document = CapturedInput(
        html.encode("latin-1"),
        "http://127.0.0.1:8001",
        content_type="text/html; charset=iso-8859-1",
    )
    assert html_candidates(document, cards_config)[0].payload["title"] == "Café"
    assert document.body == html.encode("latin-1")


def test_capture_adapters_reject_unauthorized_sources(controlled_site, csv_source):
    origin, requests, _ = controlled_site
    web_source = fixture_source(origin).model_copy(
        update={"approval_status": "pending"}
    )
    csv_source = csv_source.model_copy(update={"approval_status": "pending"})
    with pytest.raises(InputError, match="not authorized"):
        capture_html(web_source, WebInput(origin + "/cards"))
    with pytest.raises(InputError, match="not authorized"):
        capture_csv(csv_source, CsvInput("listing-sample", b"test"))
    assert requests == []
