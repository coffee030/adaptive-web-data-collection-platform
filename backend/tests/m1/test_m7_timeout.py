"""Verify the opt-in Search timeout and the existing request deadline."""

import shutil
import ssl
import subprocess
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from time import monotonic, sleep

import pytest
from curl_cffi import CurlOpt
from pydantic import ValidationError

from backend.core import public_network, web_adapter
from backend.core.contracts import ExtractionConfiguration
from backend.core.inputs import CapturedInput, InputError
from backend.core.origin_rate import RequestCooldown
from backend.tests.m1.test_m7_search import HTTPS, TestRate, source
from backend.tests.m7_fixture import search_config


def test_timeout_is_opt_in_and_preserves_the_default_configuration_hash():
    config = search_config(HTTPS, "cards")
    implicit = ExtractionConfiguration.model_validate(config)
    config["search"]["timeout_seconds"] = 2
    explicit = ExtractionConfiguration.model_validate(config)

    assert implicit.search.timeout_seconds == 2
    assert implicit.model_dump(mode="json") == explicit.model_dump(mode="json")
    assert explicit.config_hash() == (
        "84fd96fa5cc9866009c2fe4f2d5657feb0c5bd9c37b9a27e5f222fccc03a7360"
    )
    config["search"]["timeout_seconds"] = 5
    opted_in = ExtractionConfiguration.model_validate(config)
    assert opted_in.search.timeout_seconds == 5
    assert opted_in.config_hash() != explicit.config_hash()


@pytest.mark.parametrize("value", [1, 2, 3, 4, 5])
def test_timeout_accepts_one_to_five_whole_seconds(value):
    config = search_config(HTTPS, "cards")
    config["search"]["timeout_seconds"] = value
    assert ExtractionConfiguration.model_validate(config).search.timeout_seconds == value


@pytest.mark.parametrize("value", [0, 6, 3.5, "5", True])
def test_timeout_rejects_out_of_range_or_non_integer_values(value):
    config = search_config(HTTPS, "cards")
    config["search"]["timeout_seconds"] = value
    with pytest.raises(ValidationError, match=r"search\.timeout_seconds"):
        ExtractionConfiguration.model_validate(config)


@pytest.mark.parametrize(
    ("traversal_age", "dns_time", "dns_budget", "transfer_budget"),
    [
        (0, 1.25, 5.0, 3.75),
        (11, 1.25, 2.0, 0.75),
        (11, 2.0, 2.0, None),
        (13, 0, None, None),
    ],
)
def test_pacing_and_dns_share_the_correct_deadlines(
    monkeypatch, traversal_age, dns_time, dns_budget, transfer_budget,
):
    now = 100.0
    monkeypatch.setattr(web_adapter, "monotonic", lambda: now)
    observed = {}

    class Rate:
        @contextmanager
        def request(self, origin, interval_ms, deadline):
            nonlocal now
            assert (origin, interval_ms, deadline) == (HTTPS, 2000, 115.0)
            now += 2
            yield RequestCooldown(interval_ms)

    def resolve(host, timeout):
        nonlocal now
        assert host == "public.example"
        observed["dns"] = timeout
        now += dns_time
        return ("1.1.1.1",)

    def get(url, *, timeout, max_body, addresses):
        assert addresses == ("1.1.1.1",)
        observed["transfer"] = timeout
        return CapturedInput(b"response", url, http_status=200), None, False

    monkeypatch.setattr(web_adapter, "resolve_public", resolve)
    monkeypatch.setattr(web_adapter, "_get", get)
    config = search_config(HTTPS, "cards")
    config["search"].update(timeout_seconds=5, max_seconds=15)
    requests = web_adapter.SearchRequests(
        source(HTTPS, min_request_interval_ms=2000),
        ExtractionConfiguration.model_validate(config).search,
        Rate(),
        lambda: None,
    )
    now += traversal_age
    if transfer_budget is None:
        with pytest.raises(InputError, match="exhausted its time budget") as failure:
            requests.get(HTTPS, HTTPS + "/search")
        assert failure.value.error.code == "timeout"
    else:
        requests.get(HTTPS, HTTPS + "/search")

    assert observed.get("dns") == dns_budget
    assert observed.get("transfer") == transfer_budget


@pytest.fixture(scope="module")
def delayed_https(tmp_path_factory):
    openssl = shutil.which("openssl")
    if openssl is None:
        pytest.skip("OpenSSL is required to generate the local TLS fixture certificate")
    root = tmp_path_factory.mktemp("m7-tls")
    certificate, key = root / "localhost.crt", root / "localhost.key"
    subprocess.run(
        [
            openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
            "-subj", "/CN=public.example", "-addext", "subjectAltName=DNS:public.example",
            "-out", str(certificate), "-keyout", str(key),
        ],
        check=True, capture_output=True, timeout=12,
    )

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            body = b"<p>delayed local response</p>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            sleep(int(self.path.rsplit("/", 1)[-1]))
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
                pass  # The timed-out client has already closed its connection.

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certificate, key)
    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        server.socket = context.wrap_socket(server.socket, server_side=True)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield server.server_port, certificate
        finally:
            server.shutdown()
            thread.join()


@pytest.mark.parametrize(
    ("timeout", "delay", "elapsed", "expected_status"),
    [(2, 3, 2, None), (5, 3, 3, 200), (5, 6, 5, None)],
)
def test_real_curl_transfer_deadline(
    monkeypatch, delayed_https, timeout, delay, elapsed, expected_status,
):
    port, certificate = delayed_https
    real_session = public_network.Session

    def fixture_session(*, trust_env, curl_options):
        assert curl_options[CurlOpt.RESOLVE] == ["public.example:443:127.0.0.1"]
        return real_session(
            trust_env=trust_env,
            curl_options={
                **curl_options,
                CurlOpt.CAINFO: str(certificate),
                CurlOpt.RESOLVE: [f"public.example:{port}:127.0.0.1"],
            },
        )

    # Substitute only the test destination and CA. The request still goes through
    # SearchRequests, the production curl transport, hostname and peer verification.
    monkeypatch.setattr(public_network, "Session", fixture_session)
    monkeypatch.setattr(
        web_adapter, "resolve_public", lambda host, seconds: ("127.0.0.1",)
    )
    config = search_config(HTTPS, "cards")
    config["search"]["timeout_seconds"] = timeout
    requests = web_adapter.SearchRequests(
        source(HTTPS), ExtractionConfiguration.model_validate(config).search,
        TestRate(), lambda: None,
    )
    start = monotonic()
    url = f"{HTTPS}:{port}/delay/{delay}"
    if expected_status is None:
        with pytest.raises(InputError) as failure:
            requests.get(HTTPS, url)
        assert failure.value.error.code == "timeout"
    else:
        document, _, _ = requests.get(HTTPS, url)
        assert document.http_status == expected_status
        assert document.body == b"<p>delayed local response</p>"
    measured = monotonic() - start
    print(f"timeout={timeout}s delay={delay}s outcome={expected_status or 'timeout'} elapsed={measured:.3f}s")
    assert measured == pytest.approx(elapsed, abs=1)
