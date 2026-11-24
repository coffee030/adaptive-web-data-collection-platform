import pytest

from backend.core.contracts import ExtractionConfiguration, Source
from backend.core.inputs import InputError
from backend.core.web_adapter import checked_url
from backend.experiments.real_demo_provision import (
    ALLOWED_PATHS,
    DETAIL_PATH,
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
    assert DETAIL_PATH == "/written-statement-implications-uk-autumn-budget"
    assert ALLOWED_PATHS == ("/search", DETAIL_PATH)
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


def test_real_demo_source_policy_accepts_only_the_reviewed_detail():
    source = Source(
        source_id="real-demo-test",
        source_name=SOURCE_NAME,
        adapter_type="web",
        permission_reference=PERMISSION_REFERENCE,
        approval_status="approved",
        allowed_origins=(ORIGIN,),
        allowed_paths={ORIGIN: ALLOWED_PATHS},
        min_request_interval_ms=2000,
    )
    assert checked_url(source, ORIGIN + DETAIL_PATH)[0] == ORIGIN + DETAIL_PATH
    assert checked_url(source, ORIGIN + "/search?globalkeywords=inflation")[0].startswith(
        ORIGIN + "/search?"
    )
    with pytest.raises(InputError):
        checked_url(source, ORIGIN + "/written-statement-draft-budget-2027-28-2029-30")
