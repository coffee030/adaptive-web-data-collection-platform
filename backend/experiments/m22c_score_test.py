"""Reference-only coverage for the two evaluator reporting paths."""

import json

import pytest

from backend.core.contracts import ExtractionConfiguration, Source
from backend.experiments.m22c_score import (
    KEYWORD,
    ORIGIN,
    REFERENCE,
    configured_search,
    score_trial,
)
from backend.tests.m7_fixture import search_config


@pytest.fixture
def reference(tmp_path, monkeypatch):
    monkeypatch.setenv("M3_COMPOSE_FIXTURE", "1")
    source = Source(
        source_id="m22c-test-reference",
        source_name="M22C synthetic reference",
        adapter_type="web",
        approval_status="approved",
        permission_reference="Reference only",
        allowed_origins=(ORIGIN,),
        allowed_paths={ORIGIN: (REFERENCE,)},
    )
    raw = search_config(ORIGIN, "cards")
    raw.update(
        selector_type="xpath",
        item_selector="//article",
        fields=[
            {"name": "title", "selector": "./h2"},
            {"name": "count", "selector": "./p"},
        ],
    )
    raw["search"].update(
        path=f"{REFERENCE}search",
        result_item_selector="//ul/li",
        detail_link_selector="./a[@class='publication']",
        pagination=None,
    )
    return tmp_path, source, raw


def write_reference(reference, *, final=True, proposal=True, unmapped=False):
    directory, source, raw = reference
    config = ExtractionConfiguration.model_validate(raw)
    saved = {
        "configuration": raw,
        "config_hash": config.config_hash(),
        "approval_status": "draft",
    }
    suggestion = {
        "search": raw["search"],
        "record_schema": raw["record_schema"],
        "item_selector": None if unmapped else raw["item_selector"],
        "fields": [
            {
                "name": field["name"],
                "mapping": None if unmapped else field,
                "reason": "Synthetic reference",
            }
            for field in raw["fields"]
        ],
    }
    events = [
        {"event": "rehearsal", "source": source.model_dump(mode="json")},
        {
            "event": "api_body",
            "kind": "profile-suggestions",
            "id": 1,
            "result": {"proposal": suggestion if proposal else None},
        },
    ]
    (directory / "session.jsonl").write_text(
        "\n".join(map(json.dumps, events)), encoding="utf-8"
    )
    if final:
        (directory / "versions.json").write_text(json.dumps([saved]), encoding="utf-8")
    return score_trial(directory, REFERENCE, KEYWORD)


@pytest.mark.parametrize(
    "path,key,status,count,http_status",
    [
        ("search", "q", "assigned_listing", 2, 200),
        ("search", "keyword", "no_assigned_results", 0, 200),
        ("missing-search", "q", "missing", None, 404),
    ],
)
def test_same_selectors_different_configured_targets(
    reference, path, key, status, count, http_status
):
    _, _, raw = reference
    raw["search"].update(path=REFERENCE + path, keyword_parameter=key)
    final = write_reference(reference)
    final_search = {
        "url": f"{ORIGIN}{REFERENCE}{path}?{key}=C%2B%2B+%26+tea",
        "status": status,
        "assigned_results": count,
        "fixture_status": http_status,
    }
    for result in (final, *final["proposals"]):
        assert result["correct_detail_links"] == 2
        assert result["correct_required_fields"] == 4
        assert result["configured_search"] == final_search
    print(json.dumps(final_search))


@pytest.mark.parametrize(
    "path,error",
    [
        ("/m22a/catalog/reference/search", "destination_denied"),
        ("/search", "robots_denied"),
    ],
)
def test_denied_targets_are_unmeasured(reference, path, error):
    _, source, raw = reference
    if error == "robots_denied":
        source = source.model_copy(update={"allowed_paths": {ORIGIN: ("/",)}})
    raw["search"]["path"] = path
    config = ExtractionConfiguration.model_validate(raw)
    result = configured_search(source, config, REFERENCE, KEYWORD)
    assert result["status"] == "denied"
    assert result["error"] == error
    assert result["assigned_results"] is None


def test_encoded_path_is_used_verbatim(reference):
    _, _, raw = reference
    raw["search"]["path"] = f"{REFERENCE}%73earch"
    result = write_reference(reference)["configured_search"]
    assert result["status"] == "missing"
    assert "%73earch?" in result["url"]


def test_missing_artifacts_are_distinct_from_observed_zero(reference):
    final = write_reference(reference, final=False, proposal=False)
    for result in (final, *final["proposals"]):
        assert "unscored" in result
        assert result["configured_search"] == {
            "status": "unavailable",
            "assigned_results": None,
        }


def test_unresolved_proposal_still_checks_its_keyword_entry(reference):
    final = write_reference(reference, unmapped=True)
    [proposal] = final["proposals"]
    assert "unscored" in proposal
    assert proposal["configured_search"] == final["configured_search"]
