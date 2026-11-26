from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from time import monotonic, sleep
from urllib.parse import urldefrag, urljoin, urlsplit

import pytest
from curl_cffi import CurlError
from curl_cffi.requests.exceptions import Timeout
from scrapling.fetchers import Fetcher

USER_AGENT = "FYP-Collection-Spike/0.1"
BODY = b"<html><title>Controlled response</title></html>"


@pytest.fixture
def site(monkeypatch):
    monkeypatch.setenv("NO_PROXY", "127.0.0.1")
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append((self.path, dict(self.headers.items()), monotonic()))
            status, headers = 200, {}
            if self.path == "/slow":
                sleep(0.8)
            elif self.path.startswith("/status/"):
                status = int(self.path.rsplit("/", 1)[1])
                if status == 429:
                    headers["Retry-After"] = "60"
            elif self.path == "/redirect":
                status, headers = 302, {"Location": "/ok"}
            elif self.path == "/redirect-other-port":
                status, headers = 302, {"Location": "http://127.0.0.1:1/never"}
            elif self.path == "/redirect-loop":
                status, headers = 302, {"Location": "/redirect-loop"}

            try:
                self.send_response(status)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(BODY)))
                self.send_header("X-Fixture", "m0")
                for key, value in headers.items():
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(BODY)
            except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                # A timeout case may disconnect before the server writes.
                pass

        def log_message(self, format, *args):
            pass

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = Thread(
            target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True
        )
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}", requests
        finally:
            server.shutdown()
            thread.join()


@pytest.mark.parametrize("status", [200, 403, 429, 500])
@pytest.mark.parametrize(
    "retry_options", [{}, {"retries": 2}], ids=["default", "two-attempts"]
)
def test_response_metadata_and_no_status_retry(site, status, retry_options):
    origin, requests = site
    url = f"{origin}/status/{status}"
    started = monotonic()
    response = Fetcher.get(url, timeout=2, **retry_options)
    print(
        f"status={status} attempts={len(requests)} elapsed={monotonic() - started:.3f}s"
    )
    assert response.status == status
    assert response.url == url
    assert response.headers["x-fixture"] == "m0"
    assert response.body == BODY
    assert response.css("title::text").get() == "Controlled response"
    assert [request[0] for request in requests] == [f"/status/{status}"]
    if status == 429:
        assert response.headers["retry-after"] == "60"


@pytest.mark.parametrize(
    ("retry_options", "expected_attempts"),
    [({}, 3), ({"retries": 0}, 1), ({"retries": 1}, 1), ({"retries": 2}, 2)],
    ids=["default", "zero", "one", "two"],
)
def test_timeout_attempts(site, retry_options, expected_attempts):
    origin, requests = site
    started = monotonic()
    with pytest.raises(Timeout):
        Fetcher.get(f"{origin}/slow", timeout=0.2, **retry_options)
    print(f"timeout attempts={len(requests)} elapsed={monotonic() - started:.3f}s")
    assert [request[0] for request in requests] == ["/slow"] * expected_attempts
    if expected_attempts > 1:
        assert requests[1][2] - requests[0][2] >= 0.9


@pytest.mark.parametrize(
    ("options", "referer"),
    [
        ({}, "https://www.google.com/"),
        ({"stealthy_headers": False}, None),
        ({"impersonate": None}, "https://www.google.com/"),
        (
            {"headers": {"Referer": "https://fixture.invalid/context"}},
            "https://fixture.invalid/context",
        ),
        (
            {
                "impersonate": None,
                "stealthy_headers": False,
                "headers": {"User-Agent": USER_AGENT},
            },
            None,
        ),
    ],
    ids=[
        "default",
        "stealth-off-only",
        "impersonation-off-only",
        "custom-referer",
        "identified",
    ],
)
def test_headers_as_received_by_controlled_server(site, options, referer):
    origin, requests = site
    assert Fetcher.get(f"{origin}/ok", timeout=2, retries=1, **options).status == 200
    headers = {key.lower(): value for key, value in requests[0][1].items()}
    print(f"request headers={headers}")
    assert headers["user-agent"]
    assert headers.get("referer") == referer
    if options.get("headers", {}).get("User-Agent") == USER_AGENT:
        assert headers["user-agent"] == USER_AGENT
        assert "sec-ch-ua" not in headers
    elif options.get("impersonate", "chrome") == "chrome":
        assert "Chrome/" in headers["user-agent"]
        assert "sec-ch-ua" in headers


def test_default_safe_mode_blocks_loopback_redirect(site):
    origin, requests = site
    with pytest.raises(CurlError) as failure:
        Fetcher.get(f"{origin}/redirect", timeout=2, retries=1)
    print(f"safe redirect error={failure.value.code}: {failure.value}")
    assert [request[0] for request in requests] == ["/redirect"]


def test_unrestricted_follow_shows_final_url_and_redirect_limit(site):
    origin, requests = site
    response = Fetcher.get(
        f"{origin}/redirect", follow_redirects=True, timeout=2, retries=1
    )
    assert response.status == 200 and response.url == f"{origin}/ok"
    assert [request[0] for request in requests] == ["/redirect", "/ok"]
    history = [(hop.status_code, hop.url) for hop in response.history]
    print(f"followed redirect history={history}")
    assert history == [(302, f"{origin}/redirect")]

    requests.clear()
    with pytest.raises(CurlError) as failure:
        Fetcher.get(
            f"{origin}/redirect-loop",
            follow_redirects=True,
            max_redirects=1,
            timeout=2,
            retries=1,
        )
    assert int(failure.value.code) == 47
    assert [request[0] for request in requests] == ["/redirect-loop", "/redirect-loop"]


def checked_fixture_url(origin, location):
    if any(ord(char) <= 32 or char in "\\\x7f" for char in location):
        raise ValueError("Invalid URL characters")
    target = urldefrag(urljoin(f"{origin}/", location)).url
    parts = urlsplit(target)
    allowed = urlsplit(origin)
    if (parts.scheme, parts.netloc) != (allowed.scheme, allowed.netloc):
        raise ValueError("Destination is outside the controlled test origin")
    return target


@pytest.mark.parametrize(
    "location",
    [
        "file:///never",
        "ftp://127.0.0.1/never",
        "//fixture.invalid/never",
        "http://192.168.0.1/never",
        "http://[::1]/never",
        "http://127.0.0.1:1/never",
        "http://169.254.169.254/never",
        "//user@127.0.0.1/never",
        "http://2130706433/never",
        "\\\\fixture.invalid/never",
    ],
)
def test_fixture_gate_rejects_unsafe_destinations_without_sending(site, location):
    origin, requests = site
    with pytest.raises(ValueError):
        checked_fixture_url(origin, location)
    assert requests == []


@pytest.mark.parametrize("endpoint", ["/redirect", "/redirect-other-port"])
def test_manual_redirect_gate_checks_location_before_next_fetch(site, endpoint):
    origin, requests = site
    options = {
        "follow_redirects": False,
        "timeout": 2,
        "retries": 1,
        "stealthy_headers": False,
        "impersonate": None,
        "headers": {"User-Agent": USER_AGENT},
    }
    response = Fetcher.get(checked_fixture_url(origin, endpoint), **options)
    assert response.status == 302 and response.url == origin + endpoint
    assert [request[0] for request in requests] == [endpoint]
    location = response.headers["location"]
    if endpoint == "/redirect-other-port":
        with pytest.raises(ValueError):
            checked_fixture_url(origin, location)
        assert len(requests) == 1
    else:
        target = checked_fixture_url(origin, location)
        assert checked_fixture_url(origin, "./ok#fragment") == target == f"{origin}/ok"
        assert Fetcher.get(target, **options).url == target
        assert [request[0] for request in requests] == [endpoint, "/ok"]
