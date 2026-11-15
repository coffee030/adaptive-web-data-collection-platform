"""Deterministic three-page fixture shared by M6 acceptance tests."""

ROOT_PATH = "/pagination/"
CONFIGURATION = {
    "adapter_type": "web",
    "config_schema_version": "1",
    "selector_type": "css",
    "item_selector": "article",
    "fields": [{"name": "title", "selector": "h2"}],
    "record_schema": {
        "schema_version": "1",
        "record_type": "fixture",
        "identity_field": "title",
        "fields": [{"name": "title"}],
    },
    "pagination": {"next_link_selector": "a.next", "max_pages": 3},
}


def page(titles, next_href=None):
    items = "".join(f"<article><h2>{title}</h2></article>" for title in titles)
    link = f'<a class="next" href="{next_href}">Next</a>' if next_href else ""
    return f"<html><body>{items}{link}</body></html>".encode()


PAGES = {
    ROOT_PATH + "1": page(["Alpha"], "2"),
    ROOT_PATH + "2": page(["Beta", ""], "3"),
    ROOT_PATH + "3": page(["Gamma", "", "Alpha"]),
}
