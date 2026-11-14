from pathlib import Path

import pytest
from cssselect import SelectorSyntaxError

from backend.experiments.scrapling_spike.extraction import (
    Candidate,
    ExtractionConfig,
    Field,
    Query,
    extract,
)

FIXTURES = Path(__file__).parent / "fixtures" / "m0"
PAGE_URL = "http://fixture.invalid/catalogue/page.html"

CARDS = ExtractionConfig(
    Query("css", "article.entry"),
    {
        "key": Field(Query("xpath", "."), "data-key"),
        "title": Field(Query("css", "h2")),
        "url": Field(Query("css", "a"), "href", resolve_url=True),
        "note": Field(Query("css", ".note"), required=False),
    },
)
TABLE = ExtractionConfig(
    Query("xpath", "//table[@id='entries']/tbody/tr"),
    {
        "key": Field(Query("xpath", "./td[1]/a"), "data-code"),
        "title": Field(Query("xpath", "./td[1]/a")),
        "url": Field(Query("xpath", "./td[1]/a"), "href", resolve_url=True),
        "note": Field(Query("xpath", "./td[2]"), required=False),
    },
)


@pytest.mark.parametrize(
    ("filename", "config", "expected"),
    [
        (
            "cards.html",
            CARDS,
            [
                Candidate(
                    {
                        "key": "a1",
                        "title": "North Trail",
                        "url": "http://fixture.invalid/items/a1",
                        "note": "Open",
                    },
                    (),
                ),
                Candidate(
                    {"key": "b2", "title": None, "url": None, "note": None},
                    ("title", "url"),
                ),
            ],
        ),
        (
            "table.html",
            TABLE,
            [
                Candidate(
                    {
                        "key": "c3",
                        "title": "River Walk",
                        "url": "http://fixture.invalid/items/c3",
                        "note": "Closed",
                    },
                    (),
                ),
                Candidate(
                    {
                        "key": "d4",
                        "title": "Lake View",
                        "url": "http://fixture.invalid/items/d4#map",
                        "note": None,
                    },
                    (),
                ),
            ],
        ),
    ],
)
def test_same_extractor_for_two_configured_layouts(filename, config, expected):
    assert (
        extract((FIXTURES / filename).read_text(encoding="utf-8"), PAGE_URL, config)
        == expected
    )


@pytest.mark.parametrize(
    "query",
    [Query("css", "["), Query("xpath", "//*[")],
)
def test_invalid_field_selector_is_not_treated_as_missing(query):
    config = ExtractionConfig(
        Query("css", "article"), {"title": Field(query, required=False)}
    )
    with pytest.raises(SelectorSyntaxError):
        extract("<article>Text</article>", PAGE_URL, config)


def test_valid_record_selector_without_matches_returns_empty_list():
    config = ExtractionConfig(Query("css", ".absent"), {})
    assert extract("<article>Text</article>", PAGE_URL, config) == []
