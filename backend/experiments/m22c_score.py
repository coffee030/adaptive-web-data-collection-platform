"""Offline M22C scoring and reference readiness checks. Coordinator use only."""

import argparse
import json
import os
from collections import Counter
from datetime import datetime
from hashlib import sha256
from itertools import pairwise
from pathlib import Path
from urllib.parse import urlencode, urlsplit

from pydantic import ValidationError

from backend.core.contracts import (
    COMPOSE_FIXTURE_ORIGIN,
    ExtractionConfiguration,
    Source,
)
from backend.core.ingestion import ingest
from backend.core.inputs import CapturedInput, InputError
from backend.core.search import SearchTraversal
from backend.core.suggestion_models import SuggestedMapping
from backend.core.web_adapter import html_candidates
from backend.experiments.m22a_fixture import KEYWORD, fixture_html

ROOT = Path(".local/m22c")
ORIGIN = COMPOSE_FIXTURE_ORIGIN
REFERENCE = "/m22a/cards/reference/"
KEY = {
    "reference": (("alpha", "Alpha outlook", 10), ("beta", "Beta outlook", 20)),
    "a": (("harbor", "Harbor outlook", 12), ("rail", "Rail outlook", 24)),
    "b": (("solar", "Solar outlook", 14), ("wind", "Wind outlook", 28)),
}


def listing_target(prefix, keyword):
    key = "q" if "/cards/" in prefix else "term"
    return f"{prefix}search?{urlencode({key: keyword})}"


def capture(target):
    markup = fixture_html(target)
    if markup is None:
        raise ValueError(f"Missing frozen replay target {target}")
    # Match FixtureHandler.do_GET, including the wrapper that affects absolute XPath.
    body = ('<!doctype html><link rel="icon" href="data:,">' + markup).encode()
    return CapturedInput(
        body, ORIGIN + target, http_status=200, content_type="text/html"
    )


def score(source, config, prefix, keyword):
    expected = {
        ORIGIN + prefix + "detail/" + slug: {"title": title, "count": count}
        for slug, title, count in KEY[prefix.rstrip("/").rsplit("/", 1)[1]]
    }
    urls = []
    errors = []
    if config.search and config.search.origin == ORIGIN:
        traversal = SearchTraversal(source, config, None, lambda: source)
        try:
            for link in traversal._links(capture(listing_target(prefix, keyword))):
                urls.append(link.url)
        except InputError as exc:
            errors.append(exc.error.code)
    else:
        errors.append("missing_assigned_search_origin")
    # A duplicate correct href is an extra link, with no additional credit.
    correct = set(urls) & expected.keys()
    field_count = 0
    for url, required in expected.items():
        try:
            candidates = html_candidates(capture(url.removeprefix(ORIGIN)), config)
        except InputError as exc:
            errors.append(f"{exc.error.code}:{url}")
            continue
        outcome = ingest(candidates, config.record_schema, source.source_id)
        if len(candidates) != 1 or len(outcome.valid) != 1:
            errors.append(f"ambiguous_or_invalid_typed_record:{url}")
        if url not in correct or len(candidates) != 1:
            continue
        if outcome.valid:
            payload = outcome.valid[0].payload
        else:
            # A bad field must not erase a correct value in the other required
            # field. Use Core ingestion again on each original field separately.
            candidate = candidates[0]
            payload = {}
            for field in config.record_schema.fields:
                if field.name not in required:
                    continue
                schema = config.record_schema.model_copy(
                    update={"fields": (field,), "identity_field": None}
                )
                projected = candidate.model_copy(
                    update={"payload": {field.name: candidate.payload.get(field.name)}}
                )
                single = ingest([projected], schema, source.source_id)
                if single.valid:
                    payload.update(single.valid[0].payload)
        field_count += sum(
            type(payload.get(name)) is type(value) and payload[name] == value
            for name, value in required.items()
        )
    return {
        "correct_detail_links": len(correct),
        "wrong_detail_links": len(urls) - len(correct),
        "missing_detail_links": len(expected) - len(correct),
        "correct_required_fields": field_count,
        "core_errors": errors,
    }


def proposal_config(raw):
    proposal = SuggestedMapping.model_validate(raw)
    mapped = tuple(field.mapping for field in proposal.fields if field.mapping)
    omitted = sorted({field.name for field in proposal.fields if not field.mapping})
    schema = proposal.record_schema.model_dump()
    schema["fields"] = [
        field for field in schema["fields"] if field["name"] not in omitted
    ]
    if schema["identity_field"] in omitted:
        schema["identity_field"] = None
    # The omitted mappings receive no credit. Core requires a schema entry for
    # every supplied mapping, so only mapped fields enter typed ingestion.
    return ExtractionConfiguration(
        config_schema_version="1",
        record_schema=schema,
        selector_type="xpath",
        item_selector=proposal.item_selector,
        fields=mapped,
        search=proposal.search,
    ), omitted


def score_proposal(source, raw, prefix, keyword):
    if not raw:
        return {"unscored": "No proposal artifact"}
    try:
        config, omitted = proposal_config(raw)
    except ValidationError:
        return {"unscored": "Proposal has no replayable Core record configuration"}
    return score(source, config, prefix, keyword) | {"unresolved_fields": omitted}


def rows(path):
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8-sig").splitlines()
        if line
    ]


def utc(row):
    return datetime.fromisoformat(row["utc"])


def route(url):
    parsed = urlsplit(url)
    return parsed.path + ("?" + parsed.query if parsed.query else "")


def verify_reference(directory):
    events = rows(directory / "session.jsonl")
    internal = rows(directory / "internal.jsonl")
    mirror = rows(directory / "mirror.jsonl")
    assert not any(event["event"] == "observation_gap" for event in events)
    assert events[-1]["event"] == "rehearsal_finished"
    clock = next(
        event["elapsed_ms"] for event in events if event["event"] == "clock_check"
    )
    assert clock > 0
    assert all(a["mono_ms"] <= b["mono_ms"] for a, b in pairwise(events))
    receipt_counts = {}
    request_rows = [event for event in events if event["event"] == "request"]
    end_by_id = {
        event["id"]: event for event in events if event["event"] == "request_finished"
    }
    result_by_id = {
        event["id"]: event["result"] for event in events if event["event"] == "api_body"
    }
    status_by_id = {
        event["id"]: event["status"] for event in events if event["event"] == "response"
    }
    site = [event for event in request_rows if event["kind"] == "site"]
    search = listing_target(REFERENCE, KEYWORD)
    detail = REFERENCE + "detail/alpha"
    assert [route(event["url"]) for event in site] == [REFERENCE, search, detail]
    mirror_origin = events[0].get("mirror", "http://127.0.0.1:58197")
    assert {urlsplit(event["url"]).netloc for event in site} == {
        urlsplit(mirror_origin).netloc
    }
    assert all(status_by_id[event["id"]] == 200 for event in site)
    assert [
        (row["channel"], row["caller"], row["method"], row["status"], row["target"])
        for row in mirror
    ] == [("mirror", "browser", "GET", 200, route(event["url"])) for event in site]
    # Browser and internal origins are paired only for this fixture and exact targets.
    assert all(
        utc(request) <= utc(receipt) <= utc(end_by_id[request["id"]])
        for request, receipt in zip(site, mirror, strict=True)
    )
    receipt_counts["browser"] = len(site)
    health = [row for row in internal if row["caller"] == "compose_health"]
    assert health and all(
        row["target"] == "/robots.txt" and row["status"] == 200 for row in health
    )
    core = [row for row in internal if row["caller"] == "core"]
    assert len(core) + len(health) == len(internal)
    scoped = [
        event
        for event in request_rows
        if event["kind"] in {"profile-suggestions", "preview", "validate", "approve"}
    ]
    tables = (
        ("policy rejection", []),
        ("discovery", ["/robots.txt", REFERENCE, search, detail]),
        ("preview", ["/robots.txt", search, detail]),
        ("validate", ["/robots.txt", search, detail]),
        ("approval", []),
    )
    matched = []
    for request, (action, targets) in zip(scoped, tables, strict=True):
        finish = end_by_id[request["id"]]
        receipts = [row for row in core if utc(request) <= utc(row) <= utc(finish)]
        assert [
            (row["channel"], row["method"], row["status"], row["target"])
            for row in receipts
        ] == [("internal", "GET", 200, target) for target in targets], (
            action,
            [row["target"] for row in receipts],
        )
        if request["kind"] == "profile-suggestions":
            result = result_by_id[request["id"]]
            counts = Counter(row["state"] for row in result["requests"])
            assert (
                counts["transport_attempt"]
                == result["actual_attempts"]
                == len(receipts)
            )
            assert (
                counts["reserved_unsent"] + counts["transport_attempt"]
                == result["reserved_requests"]
            )
            if receipts:
                assert [row["stage"] for row in result["requests"]] == [
                    "robots",
                    "homepage",
                    "results",
                    "detail",
                ]
            else:
                assert counts == Counter({"denied_before_send": 1})
        receipt_counts[action] = len(receipts)
        matched.extend(receipts)
    assert matched == core
    artifact = json.loads(
        (directory / "artifacts.json").read_text(encoding="utf-8-sig")
    )
    source = Source.model_validate(artifact["source"])
    final = artifact["final"]
    config = ExtractionConfiguration.model_validate(final["configuration"])
    report = artifact["report"]
    assert final["config_hash"] == config.config_hash() == report["config_hash"]
    assert final["profile_version_id"] == report["profile_version_id"]
    assert final["validation_report_id"] == report["report_id"]
    sample = capture(route(report["sample_location"]))
    assert sha256(sample.body).hexdigest() == report["sample_hash"]
    assert final["approval_status"] == "approved" and report["passed"]
    assert (
        config.search.max_requests == 4
        and artifact["suggested"]["proposal"]["search"]["max_requests"] == 3
    )
    final_score = score(source, config, REFERENCE, KEYWORD)
    original_score = score_proposal(
        source, artifact["suggested"]["proposal"], REFERENCE, KEYWORD
    )
    for scorecard in (final_score, original_score):
        assert scorecard["correct_detail_links"] == 2
        assert scorecard["correct_required_fields"] == 4
        assert scorecard["wrong_detail_links"] == scorecard["missing_detail_links"] == 0
        assert not scorecard["core_errors"]
    return {
        "technical_only": True,
        "profile_version_id": final["profile_version_id"],
        "revision": final["revision"],
        "config_hash": final["config_hash"],
        "validation_report_id": final["validation_report_id"],
        "core_and_browser_receipts": receipt_counts,
        "health_probes_in_window": len(health),
        "denied_before_send": 1,
        "final_score": final_score,
        "unedited_proposal_score": original_score,
    }


def score_trial(directory, prefix, keyword):
    events = rows(directory / "session.jsonl")
    source = Source.model_validate(
        next(row["source"] for row in events if row["event"] == "operator")
    )
    assert source.allowed_paths == {ORIGIN: (prefix,)}
    versions_path = directory / "versions.json"
    versions = (
        json.loads(versions_path.read_text(encoding="utf-8-sig"))
        if versions_path.exists()
        else []
    )
    proposals = [
        score_proposal(source, row["result"]["proposal"], prefix, keyword)
        | {"request_id": row["id"]}
        for row in events
        if row["event"] == "api_body"
        and row["kind"] == "profile-suggestions"
        and row["result"].get("proposal")
    ]
    if len(versions) != 1:
        return {"unscored": "No unique final saved snapshot", "proposals": proposals}
    [final] = versions
    config = ExtractionConfiguration.model_validate(final["configuration"])
    assert config.config_hash() == final["config_hash"]
    return score(source, config, prefix, keyword) | {
        "approval_status": final["approval_status"],
        "proposals": proposals,
    }


def main():
    os.environ["M3_COMPOSE_FIXTURE"] = "1"
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    reference = commands.add_parser("reference")
    reference.add_argument("--root", type=Path, default=ROOT)
    trial = commands.add_parser("trial")
    trial.add_argument("directory", type=Path)
    trial.add_argument("prefix")
    trial.add_argument("keyword")
    opts = parser.parse_args()
    if opts.command == "reference":
        result = verify_reference(opts.root / "reference")
        with (opts.root / "technical-readiness.json").open(
            "x", encoding="utf-8"
        ) as handle:
            json.dump(result, handle, indent=2)
    else:
        result = score_trial(opts.directory, opts.prefix, opts.keyword)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
