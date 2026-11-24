from backend.core.contracts import ExtractionConfiguration
from backend.experiments.real_demo_provision import (
    ALLOWED_PATHS,\n    DETAIL_PATH,
    CONFIGURATION,
    KEYWORD,
    ORIGIN,
    PERMISSION_REFERENCE,
    SOURCE_NAME,
)


def test_real_demo_profile_is_bounded_and_valid():
    configuration = ExtractionConfiguration.model_validate(CONFIGURATION)
    search = configuration.search
    assert search is not None
    assert SOURCE_NAME == "Quick Real Demo - Welsh Government Statement"
    assert PERMISSION_REFERENCE == "https://www.gov.wales/copyright-statement"
    assert ORIGIN == "https://www.gov.wales"
    assert DETAIL_PATH == "/written-statement-implications-uk-autumn-budget"\n    assert ALLOWED_PATHS == ("/search", DETAIL_PATH)
    assert KEYWORD == "inflation"
    assert search.origin == ORIGIN
    assert search.path == "/search"
    assert search.keyword_parameter == "globalkeywords"
    assert search.max_detail_pages == 1
    assert search.max_requests == 3
    assert search.max_redirects == 0
    assert search.max_body_bytes == 512000
    assert search.timeout_seconds == 5
    assert search.max_seconds == 25
    assert search.max_attempts == 1
    assert configuration.record_schema.identity_field == "publication_url"
    assert configuration.fields[0].selector == "h1"
    assert DETAIL_PATH in configuration.search.result_item_selector
    assert [field.name for field in configuration.record_schema.fields] == [
        "title",
        "publication_url",
        "published_at",
    ]
