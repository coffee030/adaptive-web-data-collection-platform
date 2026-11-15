"""Serve only the committed HTML fixtures on the isolated Compose network."""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from time import monotonic
from typing import ClassVar
from urllib.parse import urlsplit

from .m6_fixture import PAGES
from .m7_fixture import fixture_page

TABLE = (Path(__file__).parent / "fixtures" / "m0" / "table.html").read_bytes()


class FixtureHandler(BaseHTTPRequestHandler):
    metrics: ClassVar[list[tuple[str, float, float]]] = []
    metrics_lock = Lock()

    def do_GET(self):
        started = monotonic()
        path = urlsplit(self.path).path
        headers = {}
        status = 200
        if self.path == "/robots.txt":
            content_type = "text/plain; charset=utf-8"
            allowed = "".join(f"Allow: {path}\n" for path in PAGES)
            body = f"User-agent: *\nAllow: /table.html\nAllow: /m7/\n{allowed}Disallow: /\n".encode()
        elif path == "/m7-metrics":
            content_type = "application/json"
            with self.metrics_lock:
                body = json.dumps(self.metrics).encode()
        elif path.startswith(("/m7/cards/", "/m7/catalog/")):
            content_type = "text/html; charset=utf-8"
            status, body, headers = fixture_page(self.path)
        elif self.path == "/table.html":
            content_type = "text/html; charset=utf-8"
            body = TABLE
        elif self.path in PAGES:
            content_type = "text/html; charset=utf-8"
            body = PAGES[self.path]
        else:
            self.send_error(404)
            return
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        finally:
            if (path.startswith("/m7/") or path == "/robots.txt") and self.headers.get(
                "User-Agent", ""
            ).startswith("FYP-Collection-Core/"):
                with self.metrics_lock:
                    self.metrics.append((self.path, started, monotonic()))
                    del self.metrics[:-512]


if __name__ == "__main__":
    with ThreadingHTTPServer(("0.0.0.0", 8001), FixtureHandler) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
