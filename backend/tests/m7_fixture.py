"""Two static search layouts with distinct result and detail structures."""

from html import escape
from urllib.parse import parse_qs, urlencode, urlsplit

KEYWORD = "C++ & 茶#/"


def search_config(origin: str, layout: str) -> dict:
    cards = layout == "cards"
    return {
        "adapter_type": "web",
        "config_schema_version": "1",
        "selector_type": "css" if cards else "xpath",
        "item_selector": "article" if cards else "//main/dl",
        "fields": [
            {"name": "title", "selector": "h2" if cards else "./dt"},
            {"name": "count", "selector": ".count" if cards else "./dd"},
        ],
        "record_schema": {
            "record_type": "fixture_listing",
            "schema_version": "1",
            "identity_field": "title",
            "fields": [{"name": "title"}, {"name": "count", "value_type": "integer"}],
        },
        "search": {
            "origin": origin,
            "path": f"/m7/{layout}/search",
            "keyword_parameter": "q" if cards else "term",
            "result_item_selector": "li.result" if cards else "//tbody/tr",
            "detail_link_selector": "a.item" if cards else "./td/a",
            "pagination": {
                "next_link_selector": "a.next" if cards else "//footer/a",
                "max_pages": 2,
            },
            "max_detail_pages": 4,
        },
    }


def fixture_page(url: str) -> tuple[int, bytes, dict[str, str]]:
    parts = urlsplit(url)
    _, _, layout, action, *rest = parts.path.split("/")
    cards = layout == "cards"
    query = parse_qs(parts.query)
    keyword = query.get("q" if cards else "term", [""])[0]
    if action == "search":
        page = query.get("page", ["1"])[0]
        names = ["alpha", "alpha#copy"] if page == "1" else ["alpha", "beta", "bad"]
        if not keyword or keyword == "empty":
            names = []
        if keyword in {
            "detail404",
            "detail403",
            "detail429",
            "detail503",
            "redirect",
            "oversize",
        }:
            names = ["alpha", keyword]
        if keyword == "quick":
            names = ["alpha"]
        links = [f"/m7/{layout}/detail/{name}" for name in names]
        if keyword == "bad-link":
            links = ["http://169.254.169.254/latest/meta-data"]
        parameters = {key: values[0] for key, values in query.items()}
        following = "?" + urlencode(parameters | {"page": "2"})
        if keyword == "loop":
            following = "?" + urlencode(parameters)
        if keyword == "bad-next":
            following = "//unauthorized.invalid/m7"
        next_link = (
            f'<footer><a class="next" href="{escape(following)}">Next</a></footer>'
            if page == "1" and len(links) == 2 and names[1].startswith("alpha")
            else ""
        )
        if cards:
            rows = "".join(
                f'<li class="result"><a class="item" href="{link}">Result</a></li>'
                for link in links
            )
            return 200, f"<ul>{rows}</ul>{next_link}".encode(), {}
        rows = "".join(
            f'<tr><td><a href="{link}">Result</a></td></tr>' for link in links
        )
        return 200, f"<table><tbody>{rows}</tbody></table>{next_link}".encode(), {}

    name = rest[0]
    if name.startswith("detail"):
        return int(name.removeprefix("detail")), b"Site response", {"Retry-After": "33"}
    if name == "redirect":
        return 302, b"Redirect", {"Location": "http://169.254.169.254/"}
    if name == "oversize":
        return 200, b"x" * (1024 * 1024 + 1), {}
    number = {"alpha": "10", "beta": "20", "bad": "unknown"}[name]
    if cards:
        return (
            200,
            f'<article><h2>{name.title()}</h2><span class="count">{number}</span></article>'.encode(),
            {},
        )
    return (
        200,
        f"<main><dl><dt>{name.title()}</dt><dd>{number}</dd></dl></main>".encode(),
        {},
    )
