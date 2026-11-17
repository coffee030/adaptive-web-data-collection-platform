"""Serve only the committed HTML fixtures on the isolated Compose network."""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from time import monotonic
from typing import ClassVar
from urllib.parse import urlsplit

from .demo_fixture import SYNTHETIC, demo_page
from .m6_fixture import PAGES
from .m7_fixture import fixture_page

TABLE = (Path(__file__).parent / "fixtures" / "m0" / "table.html").read_bytes()
DEMO_MODE = os.environ.get("PLATFORM_SYNTHETIC_DEMO") == "1"


class FixtureHandler(BaseHTTPRequestHandler):
    metrics: ClassVar[list[tuple[str, float, float]]] = []
    metrics_lock = Lock()
    demo_revision = 1

    def do_POST(self):
        if not DEMO_MODE or self.path not in {"/demo-revision/1", "/demo-revision/2"}:
            self.send_error(404)
            return
        type(self).demo_revision = int(self.path[-1])
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        started = monotonic()
        path = urlsplit(self.path).path
        headers = {}
        status = 200
        if self.path == "/robots.txt":
            content_type = "text/plain; charset=utf-8"
            allowed = "".join(f"Allow: {path}\n" for path in PAGES)
            if DEMO_MODE:
                allowed += "Allow: /demo/\n"
            body = f"User-agent: *\nAllow: /table.html\nAllow: /m7/\n{allowed}Disallow: /\n".encode()
        elif path == "/m7-metrics":
            content_type = "application/json"
            with self.metrics_lock:
                body = json.dumps(self.metrics).encode()
        elif path.startswith(("/m7/cards/", "/m7/catalog/")):
            content_type = "text/html; charset=utf-8"
            status, body, headers = fixture_page(self.path)
            if DEMO_MODE and status == 200 and "/detail/" in path:
                note = f'<p class="dataset">{SYNTHETIC}</p>'.encode()
                body = body.replace(b"</article>", note + b"</article>").replace(
                    b"<dl>", b'<dl data-dataset="' + SYNTHETIC.encode() + b'">'
                )
        elif DEMO_MODE and path.startswith("/demo/"):
            content_type = "text/html; charset=utf-8"
            status, body = demo_page(self.path, type(self).demo_revision)
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
