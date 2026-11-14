from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from time import sleep
from urllib.parse import urlsplit

import pytest

from backend.core.contracts import (
    CsvMappingConfiguration,
    ExtractionConfiguration,
    Source,
)
from backend.core.inputs import CsvInput

FIXTURES = Path(__file__).parents[1] / "fixtures"


@pytest.fixture
def controlled_site():
    requests = []
    cards = (FIXTURES / "m0" / "cards.html").read_bytes()
    cards = (
        cards.split(b'  <article class="entry" data-key="b2">')[0] + b"</main></html>"
    )
    table = (FIXTURES / "m0" / "table.html").read_bytes()
    routes = {
        "/robots.txt": (
            200,
            {"Content-Type": "text/plain"},
            b"User-agent: *\nDisallow: /denied\n",
        ),
        "/cards": (200, {}, cards),
        "/table": (200, {}, table),
        "/changed": (200, {}, b"<html><p>Layout changed</p></html>"),
        "/invalid": (200, {}, b"<article><h2> </h2></article>"),
        "/redirect": (302, {"Location": "/cards"}, b"redirect"),
        "/forbidden-redirect": (
            302,
            {"Location": "http://127.0.0.1:1/cards"},
            b"redirect",
        ),
        "/loop": (302, {"Location": "/loop"}, b"redirect"),
        "/go-denied": (302, {"Location": "/denied"}, b"redirect"),
        "/rate": (429, {"Retry-After": "60"}, b"Too many requests"),
        "/blocked": (403, {}, b"Blocked"),
        "/challenge": (200, {"cf-mitigated": "challenge"}, cards),
        "/error": (500, {}, b"Error"),
        "/oversized": (200, {}, b"x" * (1024 * 1024 + 1)),
        "/slow": (200, {}, cards),
    }

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urlsplit(self.path).path
            requests.append(
                (self.path, {key.lower(): value for key, value in self.headers.items()})
            )
            if path == "/slow":
                sleep(0.4)
            status, headers, body = routes.get(path, (404, {}, b"Missing"))
            self.send_response(status)
            self.send_header("Content-Length", str(len(body)))
            self.send_header(
                "Content-Type", headers.get("Content-Type", "text/html; charset=utf-8")
            )
            for key, value in headers.items():
                if key != "Content-Type":
                    self.send_header(key, value)
            try:
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

        def log_message(self, format, *args):
            pass

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = Thread(
            target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True
        )
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}", requests, routes
        finally:
            server.shutdown()
            thread.join()


@pytest.fixture
def cards_config():
    return ExtractionConfiguration(
        config_schema_version="1",
        record_schema={
            "record_type": "listing",
            "schema_version": "1",
            "identity_field": "key",
            "fields": [
                {"name": "key", "required": False},
                {"name": "title"},
                {"name": "link"},
                {"name": "note", "required": False},
            ],
        },
        selector_type="css",
        item_selector="article.entry",
        fields=[
            {
                "name": "key",
                "selector": ".",
                "selector_type": "xpath",
                "mode": "attribute",
                "attribute": "data-key",
            },
            {"name": "title", "selector": "h2"},
            {
                "name": "link",
                "selector": "a",
                "mode": "attribute",
                "attribute": "href",
                "resolve_url": True,
            },
            {"name": "note", "selector": ".note"},
        ],
    )


@pytest.fixture
def table_config(cards_config):
    return ExtractionConfiguration.model_validate(
        {
            **cards_config.model_dump(),
            "selector_type": "xpath",
            "item_selector": "//table[@id='entries']/tbody/tr",
            "fields": [
                {
                    "name": "key",
                    "selector": "./td[1]/a",
                    "mode": "attribute",
                    "attribute": "data-code",
                },
                {"name": "title", "selector": "./td[1]/a"},
                {
                    "name": "link",
                    "selector": "./td[1]/a",
                    "mode": "attribute",
                    "attribute": "href",
                    "resolve_url": True,
                },
                {"name": "note", "selector": "./td[2]"},
            ],
        }
    )


@pytest.fixture
def csv_config():
    return CsvMappingConfiguration(
        config_schema_version="1",
        record_schema={
            "record_type": "inventory",
            "schema_version": "1",
            "identity_field": "key",
            "fields": [
                {"name": "key", "required": False},
                {"name": "title"},
                {"name": "count", "value_type": "integer"},
                {"name": "active", "value_type": "boolean"},
                {"name": "note", "required": False},
            ],
        },
        columns=[
            {"name": name, "column": column}
            for name, column in [
                ("key", "Key"),
                ("title", "Name"),
                ("count", "Count"),
                ("active", "Active"),
                ("note", "Note"),
            ]
        ],
    )


@pytest.fixture
def csv_source():
    return Source(
        source_id="local-csv",
        source_name="Fixture dataset",
        adapter_type="csv",
        approval_status="approved",
        permission_reference="synthetic-fixture",
        allowed_datasets=("listing-sample", "listing-import"),
    )


@pytest.fixture
def csv_import():
    return CsvInput("listing-import", (FIXTURES / "m1" / "listings.csv").read_bytes())
