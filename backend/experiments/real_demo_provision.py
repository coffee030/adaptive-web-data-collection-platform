"""Provision and run the optional Welsh Government live website demo."""

from __future__ import annotations

import argparse
import json
from time import monotonic, sleep
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import UUID, uuid4

from backend.core.contracts import ExtractionConfiguration

API = "http://127.0.0.1:8000/api/v1"
SOURCE_NAME = "Quick Real Demo - Welsh Government Statement"
PERMISSION_REFERENCE = "https://www.gov.wales/copyright-statement"
ORIGIN = "https://www.gov.wales"
DETAIL_PATH = "/written-statement-implications-uk-autumn-budget"
ALLOWED_PATHS = ("/search", DETAIL_PATH)
CATEGORY_NAME = "Real Website Demo"
TOPIC_NAME = "Welsh Government Publications"
KEYWORD = "inflation"
OPERATOR = "Quick Real Demo user"

CONFIGURATION = {
    "adapter_type": "web",
    "config_schema_version": "1",
    "selector_type": "xpath",
    "item_selector": "//html",
    "record_schema": {
        "record_type": "publication",
        "schema_version": "1",
        "identity_field": "publication_url",
        "fields": [
            {"name": "title"},
            {"name": "publication_url"},
            {"name": "published_at", "required": False},
        ],
    },
    "fields": [
        {"name": "title", "selector_type": "css", "selector": "h1"},
        {
            "name": "publication_url",
            "selector_type": "css",
            "selector": 'head link[rel="canonical"]',
            "mode": "attribute",
            "attribute": "href",
        },
        {
            "name": "published_at",
            "selector": "(.//time[@datetime])[1]",
            "mode": "attribute",
            "attribute": "datetime",
        },
    ],
    "search": {
        "origin": ORIGIN,
        "path": "/search",
        "keyword_parameter": "globalkeywords",
        "result_item_selector": (
            '//a[@href="https://www.gov.wales/written-statement-implications-uk-autumn-budget" '
            'or @href="/written-statement-implications-uk-autumn-budget"]'
        ),
        "detail_link_selector": "self::a",
        "max_detail_pages": 1,
        "max_requests": 3,
        "max_redirects": 0,
        "max_body_bytes": 512000,
        "timeout_seconds": 5,
        "max_seconds": 25,
        "max_attempts": 1,
    },
}


class RealDemoError(RuntimeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = build_opener(ProxyHandler({}), NoRedirect())


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RealDemoError(message)


def api(path: str, *, method: str = "GET", body=None, timeout: int = 60):
    payload = None if body is None else json.dumps(body).encode()
    request = Request(API + path, method=method, data=payload, headers={"Content-Type": "application/json"})
    try:
        with OPENER.open(request, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except HTTPError as error:
        details = error.read().decode("utf-8", "replace")[:800]
        raise RealDemoError(f"{method} {path} returned HTTP {error.code}: {details}") from None
    except (TimeoutError, URLError) as error:
        raise RealDemoError(f"{method} {path} could not reach the local Core: {error}") from None


def post(path: str, **body):
    return api(path, method="POST", body=body)


def one(rows, predicate, label):
    matches = [row for row in rows if predicate(row)]
    require(len(matches) <= 1, f"Multiple objects match {label}; use a fresh Normal workspace.")
    return matches[0] if matches else None


def ensure_source(*, authorize: bool = False):
    expected = {
        "source_name": SOURCE_NAME,
        "adapter_type": "web",
        "permission_reference": PERMISSION_REFERENCE,
        "allowed_origins": [ORIGIN],
        "allowed_paths": {ORIGIN: list(ALLOWED_PATHS)},
        "min_request_interval_ms": 2000,
    }
    source = one(
        api("/sources"),
        lambda row: row["source_name"] == SOURCE_NAME,
        SOURCE_NAME,
    )
    if source is None:
        source = post("/sources", **expected)
        print("Created the bounded Welsh Government Source as Pending.", flush=True)
    for key, value in expected.items():
        require(source.get(key) == value, f"Existing Source conflicts on {key}.")
    require(
        source["approval_status"] != "revoked",
        "The Real Demo Source was revoked; review it manually.",
    )
    if authorize and source["approval_status"] == "pending":
        source = api(
            f"/sources/{source['source_id']}/authorization",
            method="PATCH",
            body={"approval_status": "approved"},
        )
    print(f"REAL_DEMO_SOURCE_ID={source['source_id']}", flush=True)
    print(f"REAL_DEMO_SOURCE_STATUS={source['approval_status']}", flush=True)
    return source

def matching_profile(source):
    configuration = ExtractionConfiguration.model_validate(CONFIGURATION)
    expected_hash = configuration.config_hash()
    base = f"/sources/{source['source_id']}/versions"
    profile = one(
        api(base),
        lambda row: row["config_hash"] == expected_hash
        and row["approval_status"] != "retired",
        "the Real Demo Profile",
    )
    return base, configuration, expected_hash, profile


def prepare_profile(source):
    require(
        source["approval_status"] == "approved",
        "Authorize the Real Demo Source before preparing its Profile.",
    )
    base, configuration, expected_hash, profile = matching_profile(source)
    if profile is None:
        profile = post(base, configuration=configuration.model_dump(mode="json"))
        print("Created the reviewed extraction Profile as Draft.", flush=True)
    require(
        profile["config_hash"] == expected_hash,
        "Profile configuration hash changed unexpectedly.",
    )
    print(f"REAL_DEMO_PROFILE_ID={profile['profile_version_id']}", flush=True)
    print(f"REAL_DEMO_CONFIG_HASH={expected_hash}", flush=True)
    if profile["approval_status"] == "approved":
        print("REAL_DEMO_PROFILE_APPROVED=1", flush=True)
        return profile, None
    require(
        profile["approval_status"] == "draft",
        "The matching Real Demo Profile is not an approvable Draft.",
    )
    version = f"{base}/{profile['profile_version_id']}"
    print("Validating the live publisher sample...", flush=True)
    report = post(version + "/validate", adapter_type="web", keyword=KEYWORD)
    if not report["passed"]:
        print(f"REAL_DEMO_VALID_COUNT={report.get('valid_count', 0)}", flush=True)
        print(f"REAL_DEMO_INVALID_COUNT={report.get('invalid_count', 0)}", flush=True)
        print(f"REAL_DEMO_DUPLICATE_COUNT={report.get('duplicate_count', 0)}", flush=True)
        if report.get("sample_location"):
            print(f"REAL_DEMO_SAMPLE_LOCATION={report['sample_location']}", flush=True)
        if report.get("error"):
            print(
                "REAL_DEMO_VALIDATION_ERROR="
                + json.dumps(report["error"], sort_keys=True, separators=(",", ":")),
                flush=True,
            )
        if report.get("invalid"):
            print(
                "REAL_DEMO_INVALID="
                + json.dumps(report["invalid"], sort_keys=True, separators=(",", ":")),
                flush=True,
            )
        raise RealDemoError(
            "Live Profile validation did not pass. The diagnostic lines above show the Core result."
        )
    print("REAL_DEMO_PROFILE_APPROVED=0", flush=True)
    print(f"REAL_DEMO_REPORT_ID={report['report_id']}", flush=True)
    print("REAL_DEMO_VALIDATION=PASS", flush=True)
    return profile, report


def approve_profile(source, report_id: str, config_hash: str):
    base, _, expected_hash, profile = matching_profile(source)
    require(profile is not None, "The Real Demo Profile does not exist.")
    if profile["approval_status"] == "approved":
        return profile
    require(
        profile["approval_status"] == "draft",
        "The Real Demo Profile is not a Draft.",
    )
    require(
        config_hash == expected_hash,
        "The approved configuration hash does not match the current Draft.",
    )
    UUID(report_id)
    profile = post(
        f"{base}/{profile['profile_version_id']}/approve",
        approver=OPERATOR,
        report_id=report_id,
        config_hash=expected_hash,
    )
    require(
        profile["approval_status"] == "approved",
        "Profile approval did not persist.",
    )
    return profile

def ensure_category():
    category = one(api("/categories?limit=100&offset=0"), lambda row: row["name"] == CATEGORY_NAME, CATEGORY_NAME)
    if category is None:
        category = post("/categories", name=CATEGORY_NAME, active=True)
    require(category["active"], "The Real Website Demo category is inactive.")
    return category


def ensure_topic(category):
    query = urlencode({"limit": 100, "offset": 0, "category_id": category["id"]})
    topic = one(api(f"/topics?{query}"), lambda row: row["name"] == TOPIC_NAME, TOPIC_NAME)
    if topic is None:
        topic = post("/topics", category_id=category["id"], name=TOPIC_NAME, active=True)
    require(topic["active"], "The Real Website Demo topic is inactive.")
    return topic


def ensure_binding(topic, source, profile):
    path = f"/topics/{topic['id']}/bindings"
    binding = one(
        api(path + "?limit=100&offset=0"),
        lambda row: row["source_id"] == source["source_id"]
        and row["profile_version_id"] == profile["profile_version_id"],
        "the Real Demo binding",
    )
    if binding is None:
        binding = post(
            path,
            source_id=source["source_id"],
            profile_version_id=profile["profile_version_id"],
            approved_by=OPERATOR,
        )
    elif not binding["eligible"] and binding.get("disabled_at"):
        binding = post(path + f"/{binding['id']}/approve", approved_by=OPERATOR)
    require(binding["eligible"], "The Real Demo binding is not eligible.")
    return binding


def run_collection(topic, binding):
    request = post(
        "/collection-requests",
        topic_id=topic["id"],
        keyword=KEYWORD,
        binding_ids=[binding["id"]],
        request_key=str(uuid4()),
    )
    identity = request["id"]
    print(f"Submitted live Request {identity}.", flush=True)
    deadline = monotonic() + 120
    while request["status"] in {"pending", "running"} and monotonic() < deadline:
        sleep(1)
        request = api(f"/collection-requests/{identity}")
    require(
        request["status"] not in {"pending", "running"},
        f"Live Request {identity} did not finish within 120 seconds.",
    )
    records = api(f"/records?request_id={identity}&limit=50&offset=0")
    print(f"REAL_DEMO_REQUEST_ID={identity}", flush=True)
    print(f"REAL_DEMO_STATUS={request['status']}", flush=True)
    print(f"REAL_DEMO_RECORDS={len(records)}", flush=True)
    if records:
        payload = records[0].get("payload", {})
        print(f"REAL_DEMO_TITLE={payload.get('title', '')}", flush=True)
        print(f"REAL_DEMO_URL={payload.get('publication_url', '')}", flush=True)
    if request["status"] != "succeeded":
        errors = [item["job"].get("error") for item in request["jobs"] if item["job"].get("error")]
        raise RealDemoError(f"Live Request ended {request['status']}. Job errors: {errors or 'none reported'}")
    require(records, "Live Request succeeded but returned no accepted Records.")
    return identity


def parse_args():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="action", required=True)
    source = sub.add_parser("source")
    source.add_argument("--authorize", action="store_true")
    sub.add_parser("profile")
    run = sub.add_parser("run")
    run.add_argument("--report-id")
    run.add_argument("--config-hash")
    return parser.parse_args()


def main() -> int:
    try:
        args = parse_args()
        if args.action == "source":
            ensure_source(authorize=args.authorize)
            return 0
        source = ensure_source()
        require(
            source["approval_status"] == "approved",
            "Source authorization is still pending.",
        )
        if args.action == "profile":
            prepare_profile(source)
            return 0
        _, _, _, profile = matching_profile(source)
        require(
            profile is not None,
            "Prepare and validate the Real Demo Profile before running.",
        )
        if profile["approval_status"] != "approved":
            require(
                args.report_id and args.config_hash,
                "Profile approval requires the explicit validation report and configuration hash.",
            )
            profile = approve_profile(source, args.report_id, args.config_hash)
        category = ensure_category()
        topic = ensure_topic(category)
        binding = ensure_binding(topic, source, profile)
        run_collection(topic, binding)
        print("REAL_DEMO_RESULT=PASS", flush=True)
        return 0
    except (RealDemoError, ValueError) as error:
        print("REAL_DEMO_RESULT=FAIL", flush=True)
        print(f"REAL_DEMO_ERROR={error}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
