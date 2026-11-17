import hashlib

import pytest
from pydantic import ValidationError

from backend.core.contracts import ExtractionConfiguration, Source, canonical_json
from backend.core.evidence import LocalEvidenceStore
from backend.core.inputs import WebInput
from backend.core.profiles import ProfileRepository
from backend.core.runner import CollectionRunner
from backend.tests.m6_fixture import CONFIGURATION, PAGES, ROOT_PATH, page


@pytest.fixture
def approved_run(controlled_site, tmp_path):
    origin, requests, routes = controlled_site
    routes.update({path: (200, {}, body) for path, body in PAGES.items()})

    def run(*, max_pages=3, selector="a.next", extra_origins=()):
        profile_config = ExtractionConfiguration.model_validate(
            CONFIGURATION
            | {"pagination": {"next_link_selector": selector, "max_pages": max_pages}}
        )
        profiles = ProfileRepository()
        source = Source(
            source_id="pages",
            source_name="Controlled pagination",
            adapter_type="web",
            permission_reference="fixture",
            approval_status="approved",
            allowed_origins=(origin, *extra_origins),
        )
        profiles.register_source(source)
        runner = CollectionRunner(profiles, LocalEvidenceStore(tmp_path))
        draft = profiles.create_draft(source.source_id, profile_config)
        start = WebInput(origin + ROOT_PATH + "1")
        report = runner.validate(draft.profile_version_id, start)
        assert report.passed, report
        assert [request[0] for request in requests] == ["/robots.txt", ROOT_PATH + "1"]
        approved = profiles.approve(
            draft.profile_version_id,
            approver="fixture operator",
            report_id=report.report_id,
        )
        requests.clear()
        return runner.run(approved.profile_version_id, start)

    return run


def document_requests(controlled_site):
    return [path for path, _ in controlled_site[1] if path != "/robots.txt"]


def test_three_pages_finish_in_order_with_job_wide_dedup_and_lineage(
    approved_run, controlled_site, tmp_path
):
    result = approved_run()
    assert document_requests(controlled_site) == list(PAGES)
    assert result.status == "partial" and result.error is None
    assert [record.payload["title"] for record in result.records] == [
        "Alpha",
        "Beta",
        "Gamma",
    ]
    assert [item.source_position.index for item in result.invalid] == [2, 2]
    assert len(result.duplicates) == 1
    assert [capture.page_number for capture in result.all_evidence] == [1, 2, 3]
    assert [record.evidence_reference for record in result.records] == [
        capture.evidence_id for capture in result.all_evidence
    ]
    assert [item.evidence_reference for item in result.invalid] == [
        capture.evidence_id for capture in result.all_evidence[1:]
    ]
    assert (
        result.duplicates[0].evidence_reference == result.all_evidence[-1].evidence_id
    )
    for capture, (path, body) in zip(result.all_evidence, PAGES.items(), strict=True):
        assert (
            capture.original_location
            == capture.requested_location
            == controlled_site[0] + path
        )
        assert capture.run_id == result.run_id
        assert capture.content_hash == hashlib.sha256(body).hexdigest()
        assert LocalEvidenceStore(tmp_path).resolve(capture.evidence_id) == (
            capture,
            body,
        )


def test_max_pages_reports_incomplete_without_fetching_next(
    approved_run, controlled_site
):
    result = approved_run(max_pages=2)
    assert document_requests(controlled_site) == list(PAGES)[:2]
    assert result.status == "partial"
    assert result.error.code == "page_limit_reached"
    assert len(result.all_evidence) == len(result.records) == 2


@pytest.mark.parametrize(
    ("target", "code"),
    [
        ("%31#seen", "pagination_loop"),
        ("//127.0.0.1:1/path", "invalid_next_url"),
        ("https://example.test/", "invalid_next_url"),
        ("http:relative", "invalid_next_url"),
        ("/pagination/%2e%2e/1", "invalid_next_url"),
    ],
)
def test_refuses_repeated_or_invalid_next_without_request(
    approved_run, controlled_site, target, code
):
    controlled_site[2][ROOT_PATH + "2"] = (200, {}, page(["Beta"], target))
    result = approved_run(extra_origins=("http://127.0.0.1:1",))
    assert document_requests(controlled_site) == list(PAGES)[:2]
    assert result.status == "partial" and result.error.code == code


def test_revisited_redirect_captured_without_requesting_prior_page(
    approved_run, controlled_site
):
    controlled_site[2][ROOT_PATH + "2"] = (302, {"Location": "1#redirect"}, b"redirect")
    result = approved_run()
    assert document_requests(controlled_site) == list(PAGES)[:2]
    assert result.status == "partial" and result.error.code == "pagination_loop"
    assert result.all_evidence[1].http_status == 302


def test_next_resolves_relative_to_final_redirect_url(approved_run, controlled_site):
    routes = controlled_site[2]
    routes[ROOT_PATH + "2"] = (302, {"Location": "/m6-redirect/second"}, b"redirect")
    routes["/m6-redirect/second"] = (200, {}, page(["Beta"], "third"))
    routes["/m6-redirect/third"] = (200, {}, page(["Gamma"]))
    result = approved_run()
    assert result.status == "completed" and result.error is None
    assert document_requests(controlled_site) == [
        ROOT_PATH + "1",
        ROOT_PATH + "2",
        "/m6-redirect/second",
        "/m6-redirect/third",
    ]
    second = result.all_evidence[1]
    assert second.requested_location.endswith(ROOT_PATH + "2")
    assert second.original_location.endswith("/m6-redirect/second")


@pytest.mark.parametrize(
    ("path", "code", "status"),
    [
        ("/rate", "rate_limited", 429),
        ("/error", "http_error", 500),
        ("/slow", "timeout", None),
    ],
)
def test_later_http_failure_preserves_earlier_capture(
    approved_run, controlled_site, monkeypatch, path, code, status
):
    monkeypatch.setattr("backend.core.web_adapter.TIMEOUT_SECONDS", 0.2)
    controlled_site[2][ROOT_PATH + "2"] = (200, {}, page(["Beta"], path))
    result = approved_run()
    assert document_requests(controlled_site) == [*list(PAGES)[:2], path]
    assert result.status == "partial" and result.error.code == code
    assert result.error.http_status == status
    assert len(result.records) == 2
    assert len(result.all_evidence) == (2 if status is None else 3)
    if status is not None:
        assert result.all_evidence[-1].http_status == status


def test_optional_pagination_preserves_legacy_profile_hash():
    legacy = CONFIGURATION.copy()
    del legacy["pagination"]
    config = ExtractionConfiguration.model_validate(legacy)
    old_dump = config.model_dump(mode="json")
    assert "pagination" not in old_dump
    assert config.config_hash() == hashlib.sha256(canonical_json(old_dump)).hexdigest()
    assert (
        ExtractionConfiguration.model_validate(
            legacy | {"pagination": None}
        ).config_hash()
        == config.config_hash()
    )
    assert (
        ExtractionConfiguration.model_validate(CONFIGURATION).config_hash()
        != config.config_hash()
    )
    with pytest.raises(ValidationError, match="less than or equal to 5"):
        ExtractionConfiguration.model_validate(
            CONFIGURATION
            | {"pagination": {"next_link_selector": "a.next", "max_pages": 6}}
        )
