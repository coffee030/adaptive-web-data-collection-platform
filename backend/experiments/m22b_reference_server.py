"""Isolated HTTP fixture for M22B verification against M22A reference routes."""

import json
import sys
from http.server import ThreadingHTTPServer
from urllib.parse import parse_qsl, urlsplit

from .m22a_fixture import KEYWORD, FixtureHandler

SCOPES = {
    "/m22a/cards/reference": "q",
    "/m22a/catalog/reference": "term",
}
ROUTES = {
    "/",
    "/find",
    "/manual",
    "/script-only",
    "/search",
    "/detail/alpha",
    "/detail/beta",
    "/detail/about",
}


class ReferenceHandler(FixtureHandler):
    def do_GET(self):
        parts = urlsplit(self.path)
        if self.path == "/robots.txt":
            return super().do_GET()
        for scope, key in SCOPES.items():
            route = parts.path.removeprefix(scope)
            if route not in ROUTES or route == parts.path:
                continue
            if route == "/search" and parse_qsl(parts.query) == [(key, KEYWORD)]:
                return super().do_GET()
            if route != "/search" and not parts.query:
                return super().do_GET()
        self.send_error(404)

    def log_request(self, code="-", size="-"):
        agent = self.headers.get("User-Agent", "")
        if agent == "M22B-Compose-Health/1.0" and self.client_address[0] == "127.0.0.1":
            caller = "compose_health"
        elif agent == "FYP-Collection-Core/1.0":
            caller = "core"
        elif agent.startswith("Mozilla/"):
            caller = "browser"
        else:
            caller = "other"
        print(
            json.dumps({"caller": caller, "status": int(code), "target": self.path}),
            flush=True,
        )

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
    with ThreadingHTTPServer((host, 8001), ReferenceHandler) as server:
        server.serve_forever()
