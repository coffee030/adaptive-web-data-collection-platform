"""Approved Profile drafts for the three bundled Demo topics."""

from dataclasses import dataclass

from backend.tests.demo_fixture import (
    MARKET_FIELDS,
    MARKETING_FIELDS,
    SIMULATED,
    SYNTHETIC,
)

ORIGIN = "http://collection-fixture:8001"
OPERATOR = "Bundled M10 Synthetic Demo"


@dataclass(frozen=True)
class Fixture:
    name: str
    path: str
    xpath: bool = False

    @property
    def is_core(self):
        return self.path.startswith("/m7/")

    @property
    def is_market(self):
        return self.path in {"/demo/market-wire", "/demo/economic-ledger"}

    @property
    def label(self):
        return SIMULATED if self.is_market else SYNTHETIC

    @property
    def records(self):
        return 1 if self.is_core else 4

    @property
    def captures(self):
        return 2 if self.is_core else 6

    def configuration(self):
        search = {
            "origin": ORIGIN,
            "path": self.path + "/search",
            "keyword_parameter": "term" if self.xpath else "q",
            "result_item_selector": "//tbody/tr" if self.xpath else "li.result",
            "detail_link_selector": "./td/a" if self.xpath else "a",
        }
        article = {"title": "headline"}
        if self.is_core:
            item = "//main/dl" if self.xpath else "article"
            fields = [
                {"name": "headline", "selector": "./dt" if self.xpath else "h2"},
                {
                    "name": "dataset",
                    "selector": ".",
                    "mode": "attribute",
                    "attribute": "data-dataset",
                }
                if self.xpath
                else {"name": "dataset", "selector": ".dataset"},
            ]
            if self.xpath:
                fields.append({"name": "count", "selector": "./dd"})
            record_type = "catalog_fixture" if self.xpath else "article_fixture"
        else:
            item = "//main" if self.xpath else "article"
            names = MARKET_FIELDS if self.is_market else MARKETING_FIELDS
            fields = [
                {
                    "name": name,
                    "selector": f'./dl/dd[@data-field="{name}"]'
                    if self.xpath
                    else f".{name}",
                }
                for name in (*names, "published_at", "dataset")
            ]
            fields.append(
                {
                    "name": "source_url",
                    "selector": './a[@class="permalink"]'
                    if self.xpath
                    else "a.permalink",
                    "mode": "attribute",
                    "attribute": "href",
                    "resolve_url": True,
                }
            )
            search["pagination"] = {
                "next_link_selector": "//footer/a" if self.xpath else "a.next",
                "max_pages": 2,
            }
            search["max_detail_pages"] = 4
            article.update(
                canonical_url="source_url",
                summary="summary",
                published_at="published_at",
            )
            if not self.is_market:
                article["author"] = "creator"
            record_type = (
                "simulated_market_update" if self.is_market else "synthetic_sponsorship"
            )
        field_types = {"count": "integer", "price": "number", "price_change": "number"}
        return {
            "adapter_type": "web",
            "config_schema_version": "1",
            "selector_type": "xpath" if self.xpath else "css",
            "item_selector": item,
            "fields": fields,
            "record_schema": {
                "record_type": record_type,
                "schema_version": "1",
                "fields": [
                    {
                        "name": field["name"],
                        "value_type": field_types.get(field["name"], "string"),
                    }
                    for field in fields
                ],
            },
            "search": search,
            "article": article,
        }


@dataclass(frozen=True)
class Preset:
    key: str
    category: str
    topic: str
    keyword: str
    fixtures: tuple[Fixture, Fixture]


PRESETS = (
    Preset(
        "core",
        "Core Demonstration",
        "Fixture Listings",
        "quick",
        (
            Fixture("Demo Cards", "/m7/cards"),
            Fixture("Demo Catalog", "/m7/catalog", xpath=True),
        ),
    ),
    Preset(
        "marketing",
        "Marketing Intelligence",
        "Influencer Advertising and Sponsorship",
        "partnership",
        (
            Fixture("Creator Brief (Synthetic)", "/demo/creator-brief"),
            Fixture("Disclosure Desk (Synthetic)", "/demo/disclosure-desk", xpath=True),
        ),
    ),
    Preset(
        "markets",
        "Financial Markets",
        "Market News and Economic Updates",
        "market",
        (
            Fixture("Market Wire (Simulated)", "/demo/market-wire"),
            Fixture("Economic Ledger (Simulated)", "/demo/economic-ledger", xpath=True),
        ),
    ),
)
