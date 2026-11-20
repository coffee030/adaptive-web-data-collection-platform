"""Small static sites for the M22A audit and the reserved operator tasks."""

import sys
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

KEYWORD = "C++ & tea"
ROBOTS = b"User-agent: *\nAllow: /m22a/\nDisallow: /\n"
MANUAL = b"<h1>Search options</h1><form method=post><input name=term></form>"
SCRIPT_ONLY = (
    b"<h1>Search</h1><button id=search>Search</button><script src=app.js></script>"
)

SAMPLES = {
    "reference": (("alpha", "Alpha outlook", 10), ("beta", "Beta outlook", 20)),
    "a": (("harbor", "Harbor outlook", 12), ("rail", "Rail outlook", 24)),
    "b": (("solar", "Solar outlook", 14), ("wind", "Wind outlook", 28)),
}
TASK_KEYWORDS = {"reference": KEYWORD, "a": "spring update", "b": "autumn update"}


def fixture_html(target: str) -> str | None:
    parsed = urlsplit(target)
    parts = parsed.path.split("/")
    if len(parts) < 5 or parts[1] != "m22a":
        return None
    _, _, layout, variant, *route = parts
    if layout not in {"cards", "catalog"} or variant not in SAMPLES:
        return None
    scope = f"/m22a/{layout}/{variant}"
    cards = layout == "cards"
    key = "q" if cards else "term"
    query_form = (
        f'<form method="get" action="{scope}/search">'
        f'<label>Search <input type="search" name="{key}"></label>'
        '<button type="submit">Search</button></form>'
    )
    if route == [""]:
        return query_form if cards else f'<a href="{scope}/find">Search the catalog</a>'
    if route == ["find"] and not cards:
        return query_form
    if route == ["manual"] and not cards:
        return MANUAL.decode()
    if route == ["script-only"]:
        return SCRIPT_ONLY.decode()

    rows = SAMPLES[variant]
    if route == ["search"]:
        rows = (
            rows if parse_qs(parsed.query).get(key) == [TASK_KEYWORDS[variant]] else ()
        )
        links = [
            f'<a class="publication" href="{scope}/detail/{slug}">{escape(title)}</a>'
            for slug, title, _ in rows
        ]
        decoy = f'<a href="{scope}/detail/about">About this collection</a>'
        if cards:
            return (
                "<ul>" + "".join(f"<li>{link} {decoy}</li>" for link in links) + "</ul>"
            )
        return (
            "<table><tbody>"
            + "".join(f"<tr><td>{link}</td><td>{decoy}</td></tr>" for link in links)
            + "</tbody></table>"
        )
    if len(route) == 2 and route[0] == "detail":
        name = route[1]
        if name == "about":
            return "<h1>About this collection</h1>"
        for slug, title, count in rows:
            if slug == name:
                content = (
                    f'<article><h2>{title}</h2><p class="count">{count}</p></article>'
                    if cards
                    else f"<main><dl><dt>{title}</dt><dd>{count}</dd></dl></main>"
                )
                return f"<header><h1>Publications portal</h1></header>{content}"
    return None


class FixtureHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/robots.txt":
            body, media = ROBOTS, "text/plain"
        elif (html := fixture_html(self.path)) is not None:
            body = ('<!doctype html><link rel="icon" href="data:,">' + html).encode()
            media = "text/html"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", f"{media}; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    # The default serves the operator's loopback copy. Compose supplies its internal bind.
    host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
    with ThreadingHTTPServer((host, 8001), FixtureHandler) as server:
        server.serve_forever()
