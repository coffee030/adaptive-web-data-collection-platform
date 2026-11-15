"""Serve only the committed HTML fixtures on the isolated Compose network."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .m6_fixture import PAGES

TABLE = (Path(__file__).parent / "fixtures" / "m0" / "table.html").read_bytes()


class FixtureHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/robots.txt":
            content_type = "text/plain; charset=utf-8"
            allowed = "".join(f"Allow: {path}\n" for path in PAGES)
            body = f"User-agent: *\nAllow: /table.html\n{allowed}Disallow: /\n".encode()
        elif self.path == "/table.html":
            content_type = "text/html; charset=utf-8"
            body = TABLE
        elif self.path in PAGES:
            content_type = "text/html; charset=utf-8"
            body = PAGES[self.path]
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    with ThreadingHTTPServer(("0.0.0.0", 8001), FixtureHandler) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
